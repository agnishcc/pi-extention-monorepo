import type { TodoMethod, TodoParams } from "@agnishc/edb-protocol";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { DiagnosticLog } from "../diagnostics/diagnostic-log.js";
import { LimitExceededError, TodoUnavailableError } from "../errors.js";
import type { TodoClient } from "../integrations/todo-client.js";
import type { AtomicStore } from "../persistence/atomic-store.js";
import { DurableOutbox } from "../persistence/outbox.js";
import { type RecoverySummary, reconcileSnapshot } from "../persistence/recovery.js";
import { applyRetention } from "../persistence/retention.js";
import { childQuestionMessage, childResultMessage, parentAnswerMessage } from "../prompts/internal-messages.js";
import type { HumanAdapter } from "../questions/human-adapter.js";
import type { QuestionService } from "../questions/question-service.js";
import type { V2AgentDefinition } from "../runtime/agent-definitions.js";
import type { RootAdapter } from "../runtime/root-adapter.js";
import type { RuntimePool } from "../runtime/runtime-pool.js";
import type { SubagentsV2Settings } from "../settings.js";
import { createAgentTool } from "../tools/agent-tool.js";
import { createGetResultTool } from "../tools/get-result-tool.js";
import { createProgressTool } from "../tools/progress-tool.js";
import { createQuestionTools } from "../tools/question-tools.js";
import { createSendTool } from "../tools/send-tool.js";
import { createSteerTool } from "../tools/steer-tool.js";
import { createStopTool } from "../tools/stop-tool.js";
import { createTaskProxyTools } from "../tools/task-proxy-tools.js";
import type {
	AgentId,
	AgentRecord,
	AnswerChildInput,
	AskParentInput,
	CallerContext,
	CoordinatorSnapshotV1,
	MailboxKind,
	MailboxMessage,
	OutboxOperation,
	ProgressInput,
	QuestionRecord,
	RunControl,
	RunId,
	RunReceipt,
	RunRecord,
	RuntimeMessage,
	SegmentOutcome,
	SpawnInput,
	SpawnReceipt,
	StoredResult,
	WaitLink,
} from "../types.js";
import { TERMINAL_RUN_STATES } from "../types.js";
import { AgentRegistry, createId } from "./agent-registry.js";
import { Mailbox } from "./mailbox.js";
import { assertCanManage } from "./permissions.js";
import { RunQueue } from "./run-queue.js";
import { transitionAgent, transitionRun } from "./state-machine.js";
import { WaitLinks } from "./wait-links.js";

export interface CoordinatorOptions {
	rootSessionId: string;
	cwd: string;
	settings: SubagentsV2Settings;
	store: AtomicStore;
	runtimePool: RuntimePool;
	rootAdapter: RootAdapter;
	todoClient: TodoClient;
	questions: QuestionService;
	humanAdapter: HumanAdapter;
	diagnostics?: DiagnosticLog;
	/** Fallback model string ("provider/id") used for subagents:usage when the agent has no explicit model. */
	rootModel?: string;
	/** Emit a subagents:usage event (token-tracker integration). Optional — no-op when omitted. */
	emitUsage?: (payload: Record<string, unknown>) => void;
	/** Trusted project/global specialized definitions shown in the Agent tool description. */
	agentDefinitions?: ReadonlyMap<string, V2AgentDefinition>;
}

export interface AnswerReceipt {
	questionId: string;
	childRunId: string;
	waitLinkId?: string;
}

function now(): string {
	return new Date().toISOString();
}

function assertBoundedText(value: string, label: string, maxBytes: number): void {
	if (!value.trim()) throw new Error(`${label} is required`);
	const bytes = Buffer.byteLength(value, "utf8");
	if (bytes > maxBytes) throw new LimitExceededError(`${label} bytes`, bytes);
}

function mailboxPriority(kind: MailboxKind): 0 | 1 | 2 | 3 {
	if (kind === "stop" || kind === "timeout") return 0;
	if (kind === "parent_answer" || kind === "child_question") return 1;
	if (kind === "steer" || kind.startsWith("child_")) return 2;
	return 3;
}

function truncateUtf8(text: string, maxBytes: number, sessionFile: string): StoredResult {
	const bytes = Buffer.from(text, "utf8");
	if (bytes.length <= maxBytes) return { text, truncated: false, storedBytes: bytes.length, sessionFile };
	let end = maxBytes;
	const decoder = new TextDecoder("utf-8", { fatal: true });
	while (end > 0) {
		try {
			const truncated = decoder.decode(bytes.subarray(0, end));
			return { text: truncated, truncated: true, storedBytes: end, originalBytes: bytes.length, sessionFile };
		} catch {
			end--;
		}
	}
	return { text: "", truncated: true, storedBytes: 0, originalBytes: bytes.length, sessionFile };
}

export class Coordinator {
	registry: AgentRegistry;
	mailbox: Mailbox;
	waits: WaitLinks;
	private queue: RunQueue;
	private outbox: DurableOutbox | undefined;
	private snapshotOutbox: OutboxOperation[] = [];
	private shuttingDown = false;
	private pendingMessages = new Map<RunId, RuntimeMessage>();
	private questionTimers = new Map<string, ReturnType<typeof setTimeout>>();
	recoverySummary: RecoverySummary = { interruptedRunIds: [], preservedQuestionIds: [], reconciledWaitLinkIds: [] };

	constructor(private readonly options: CoordinatorOptions) {
		this.registry = new AgentRegistry();
		this.mailbox = new Mailbox();
		this.waits = new WaitLinks();
		this.queue = new RunQueue(options.settings.maxConcurrentPrompts, options.settings.maxChildrenPerParent);
	}

	get rootSessionId(): string {
		return this.options.rootSessionId;
	}

	get todoAvailable(): boolean {
		return this.options.todoClient.available;
	}

	listQuestions(): QuestionRecord[] {
		return this.options.questions.all().map((question) => structuredClone(question));
	}

	listOutbox(): OutboxOperation[] {
		return (this.outbox?.all() ?? this.snapshotOutbox).map((operation) => structuredClone(operation));
	}

	listDiagnostics() {
		return this.options.diagnostics?.recent() ?? [];
	}

	async start(): Promise<void> {
		const loaded = await this.options.store.load();
		const snapshot = loaded.snapshot;
		this.recoverySummary = reconcileSnapshot(snapshot);
		if (!snapshot.agents.root) snapshot.agents.root = this.createRoot();
		this.registry = new AgentRegistry({ agents: Object.values(snapshot.agents), runs: Object.values(snapshot.runs) });
		this.options.questions.setRegistry(this.registry);
		this.mailbox = new Mailbox(snapshot.mailbox);
		this.waits = new WaitLinks(Object.values(snapshot.waitLinks));
		for (const question of Object.values(snapshot.questions))
			this.options.questions.questions.set(question.id, question);
		for (const question of this.options.questions.all()) {
			if (question.state === "open" || question.state === "escalated") this.scheduleQuestionTimeout(question);
		}
		this.snapshotOutbox = snapshot.outbox;
		this.outbox = new DurableOutbox(
			snapshot.outbox,
			(operation) => this.deliverOutbox(operation),
			() => this.persist(),
		);
		await this.persist();
		await this.options.diagnostics?.record({
			type: "recovery_action",
			errorCode: loaded.recoveredFromBackup ? "RECOVERED_FROM_BACKUP" : undefined,
		});
		this.outbox.start();
	}

	private createRoot(): AgentRecord {
		const timestamp = now();
		return {
			id: "root",
			parentAgentId: null,
			createdByRunId: null,
			type: "root",
			displayName: "Root",
			sessionFile: null,
			cwd: this.options.cwd,
			state: "idle",
			currentRunId: null,
			childAgentIds: [],
			toolProfile: "coder",
			createdAt: timestamp,
			updatedAt: timestamp,
			lastActiveAt: null,
			disposedAt: null,
		};
	}

	private snapshot(): CoordinatorSnapshotV1 {
		return {
			schemaVersion: 1,
			rootSessionId: this.options.rootSessionId,
			cwd: this.options.cwd,
			revision: 0,
			agents: Object.fromEntries([...this.registry.agents].map(([id, value]) => [id, structuredClone(value)])),
			runs: Object.fromEntries([...this.registry.runs].map(([id, value]) => [id, structuredClone(value)])),
			questions: Object.fromEntries(this.options.questions.all().map((value) => [value.id, structuredClone(value)])),
			waitLinks: Object.fromEntries(this.waits.all().map((value) => [value.id, structuredClone(value)])),
			mailbox: this.mailbox.all().map((value) => structuredClone(value)),
			outbox: (this.outbox?.all() ?? this.snapshotOutbox).map((value) => structuredClone(value)),
			updatedAt: now(),
		};
	}

	private async persist(): Promise<void> {
		const snapshot = this.snapshot();
		applyRetention(snapshot, this.options.settings.retentionDays);
		await this.options.store.commit(snapshot);
	}

	private assertCaller(caller: CallerContext): void {
		if (caller.rootSessionId !== this.options.rootSessionId)
			throw new Error("Caller belongs to a different root session");
		this.registry.getAgent(caller.agentId);
		if (caller.runId && this.registry.getRun(caller.runId).agentId !== caller.agentId)
			throw new Error("Caller run mismatch");
	}

	private profileFor(type: string, parent: AgentRecord): string {
		const requested = /explore|research|read/i.test(type) ? "researcher" : /test/i.test(type) ? "tester" : "coder";
		if (parent.toolProfile === "readonly" || parent.toolProfile === "researcher") return "researcher";
		return requested;
	}

	async spawn(caller: CallerContext, input: SpawnInput): Promise<SpawnReceipt> {
		this.assertCaller(caller);
		if (this.shuttingDown) throw new Error("Coordinator is shutting down");
		assertBoundedText(input.prompt, "Prompt", this.options.settings.maxTranscriptBytes);
		assertBoundedText(input.description, "Description", 2_000);
		assertBoundedText(input.subagent_type, "Subagent type", 200);
		if (input.agent_name) assertBoundedText(input.agent_name, "Agent name", 200);
		const parent = this.registry.getAgent(caller.agentId);
		const depth = this.registry.depth(parent.id) + 1;
		if (depth > this.options.settings.maxDepth) throw new LimitExceededError("hierarchy depth", depth);
		const activeChildren = this.registry
			.children(parent.id)
			.filter((agent) => !["idle", "error", "disposed"].includes(agent.state)).length;
		if (activeChildren >= this.options.settings.maxChildrenPerParent) {
			throw new LimitExceededError("active direct children", activeChildren + 1);
		}
		const activeDescendants = this.registry
			.descendants("root")
			.filter((agent) => !["idle", "error", "disposed"].includes(agent.state)).length;
		if (activeDescendants >= this.options.settings.maxActiveDescendants) {
			throw new LimitExceededError("active descendants", activeDescendants + 1);
		}
		if (input.task_id && !this.todoAvailable) throw new TodoUnavailableError();
		const timestamp = now();
		const agentId = createId("agt");
		const runId = createId("run");
		let agent: AgentRecord = {
			id: agentId,
			parentAgentId: caller.agentId,
			createdByRunId: caller.runId,
			type: input.subagent_type,
			displayName: input.agent_name ?? input.subagent_type,
			description: input.description,
			sessionFile: null,
			cwd: parent.cwd,
			state: "created",
			currentRunId: runId,
			childAgentIds: [],
			model: input.model,
			thinking: input.thinking,
			maxTurns: input.max_turns,
			toolProfile: this.profileFor(input.subagent_type, parent),
			createdAt: timestamp,
			updatedAt: timestamp,
			lastActiveAt: null,
			disposedAt: null,
		};
		agent = transitionAgent(agent, "session_ready", timestamp);
		agent = transitionAgent(agent, "enqueue_run", timestamp);
		const run: RunRecord = {
			id: runId,
			agentId,
			parentRunId: caller.runId,
			requestedByAgentId: caller.agentId,
			taskId: input.task_id ?? null,
			mode: input.run_in_background ? "background" : "foreground",
			state: "queued",
			prompt: input.prompt,
			segmentCount: 0,
			waitingOnRunIds: [],
			pendingQuestionId: null,
			taskSyncPending: Boolean(input.task_id),
			createdAt: timestamp,
			startedAt: null,
			updatedAt: timestamp,
			completedAt: null,
		};
		this.registry.setAgent(agent);
		this.registry.setRun(run);
		parent.childAgentIds = [...parent.childAgentIds, agentId];
		parent.updatedAt = timestamp;
		let waitLink: WaitLink | undefined;
		if (!input.run_in_background) {
			waitLink = {
				id: createId("wait"),
				parentAgentId: caller.agentId,
				parentRunId: caller.runId,
				childAgentId: agentId,
				childRunId: runId,
				state: "waiting",
				createdAt: timestamp,
				updatedAt: timestamp,
			};
			this.waits.add(waitLink);
		}
		await this.persist();
		if (input.task_id) await this.assignTask(run, agent);
		if (waitLink && caller.runId) {
			const parentRun = this.registry.getRun(caller.runId);
			this.registry.setRun({
				...transitionRun(parentRun, "foreground_child_started", timestamp),
				waitingOnRunIds: [...parentRun.waitingOnRunIds, runId],
			});
			this.registry.setAgent(transitionAgent(parent, "wait_for_child", timestamp));
			await this.persist();
		}
		this.pendingMessages.set(runId, { text: input.prompt, kind: "prompt" });
		this.enqueueSegment(runId, 2);
		return waitLink
			? { status: "waiting", agentId, runId, waitLinkId: waitLink.id, resume: "automatic" }
			: { status: "queued", agentId, runId };
	}

	private async assignTask(run: RunRecord, agent: AgentRecord): Promise<void> {
		const operationId = createId("op");
		const operation = this.todoOperation(
			operationId,
			"assign",
			{
				taskId: run.taskId!,
				owner: { agentId: agent.id, runId: run.id },
			},
			{ agentId: run.requestedByAgentId, runId: run.parentRunId },
			run.id,
		);
		this.outbox!.add(operation, false);
		await this.persist();
		try {
			await this.options.todoClient.request(
				"assign",
				(operation.payload as any).params,
				(operation.payload as any).actor,
				operationId,
			);
			operation.state = "delivered";
			operation.deliveredAt = now();
			run.taskSyncPending = false;
			await this.persist();
		} catch (error) {
			operation.state = "failed";
			operation.lastError = error instanceof Error ? error.message : String(error);
			const failedRun = transitionRun(run, "cancel");
			failedRun.stopReason = "runtime_error";
			failedRun.error = {
				code: "TASK_ASSIGNMENT_FAILED",
				message: error instanceof Error ? error.message : String(error),
			};
			this.registry.setRun(failedRun);
			const stoppingAgent = transitionAgent(agent, "stop");
			this.registry.setAgent({ ...transitionAgent(stoppingAgent, "run_fail"), currentRunId: null });
			for (const wait of this.waits.forChildRun(run.id)) this.waits.update(wait.id, { state: "cancelled" });
			await this.persist();
			throw error;
		}
	}

	private enqueueSegment(runId: RunId, priority: number): void {
		const run = this.registry.getRun(runId);
		const agent = this.registry.getAgent(run.agentId);
		this.queue.enqueue({
			runId,
			agentId: agent.id,
			parentAgentId: agent.parentAgentId ?? "root",
			priority,
			run: () => this.executeSegment(runId),
		});
	}

	private async executeSegment(runId: RunId): Promise<void> {
		let run = this.registry.getRun(runId);
		let agent = this.registry.getAgent(run.agentId);
		if (run.state !== "queued" || agent.state !== "queued") return;
		run = transitionRun(run, "prompt_segment_start");
		agent = transitionAgent(agent, "prompt_segment_start");
		this.registry.setRun(run);
		this.registry.setAgent(agent);
		await this.persist();
		await this.options.diagnostics?.record({
			type: "run_state_changed",
			agentId: agent.id,
			runId: run.id,
			taskId: run.taskId ?? undefined,
			previousState: "queued",
			nextState: "running",
		});
		let outcome: SegmentOutcome;
		try {
			const runtime = await this.options.runtimePool.get(agent);
			if (agent.sessionFile) await this.persist();
			outcome = await runtime.runSegment(
				run,
				this.pendingMessages.get(runId) ?? { text: run.prompt, kind: "prompt" },
			);
		} catch (error) {
			outcome = { kind: "failed", error: error instanceof Error ? error : new Error(String(error)) };
		}
		this.pendingMessages.delete(runId);
		await this.handleOutcome(runId, outcome);
	}

	private async handleOutcome(runId: RunId, outcome: SegmentOutcome): Promise<void> {
		let run = this.registry.getRun(runId);
		// Ignore outcomes that race with (or duplicate) a terminal result — the run is
		// already finalized and notified. Re-processing here would re-run notifications
		// (duplicate "completed" messages to the parent) and can throw on invalid transitions.
		if (TERMINAL_RUN_STATES.has(run.state)) return;
		let agent = this.registry.getAgent(run.agentId);
		if (outcome.kind === "waiting_parent" || outcome.kind === "waiting_child") {
			if (run.state === "running") {
				const event = outcome.kind === "waiting_parent" ? "ask_parent" : "foreground_child_started";
				run = transitionRun(run, event);
				agent = transitionAgent(agent, outcome.kind === "waiting_parent" ? "ask_parent" : "wait_for_child");
				this.registry.setRun(run);
				this.registry.setAgent(agent);
				this.options.runtimePool.touch(agent);
			}
			await this.persist();
			return;
		}
		if (outcome.kind === "completed") {
			run = transitionRun(run, "final_result");
			run.result = truncateUtf8(outcome.text, this.options.settings.maxResultBytes, outcome.sessionFile);
			run.usage = outcome.usage;
			agent = transitionAgent(agent, "run_complete");
		} else if (outcome.kind === "failed") {
			run = transitionRun(run, "runtime_error");
			run.error = { code: "RUNTIME_ERROR", message: outcome.error.message, stack: outcome.error.stack };
			run.usage = outcome.usage;
			agent = transitionAgent(agent, "run_fail");
		} else {
			if (!TERMINAL_RUN_STATES.has(run.state))
				run = transitionRun(run, outcome.reason === "timeout" ? "timeout" : "cancel");
			run.stopReason = outcome.reason;
			run.usage = outcome.usage;
			if (agent.state !== "idle") agent = transitionAgent(agent, "run_fail");
		}
		agent.currentRunId = null;
		this.registry.setRun(run);
		this.registry.setAgent(agent);
		this.options.runtimePool.touch(agent);
		await this.options.diagnostics?.record({
			type: outcome.kind === "failed" ? "runtime_error" : "run_state_changed",
			agentId: agent.id,
			runId: run.id,
			taskId: run.taskId ?? undefined,
			previousState: "running",
			nextState: run.state,
			errorCode: run.error?.code,
		});
		if (!(this.shuttingDown && run.state === "interrupted")) {
			this.enqueueTerminalTaskTransition(run);
			await this.enqueueRunNotification(run);
		}
		this.emitRunUsage(run, agent);
		await this.persist();
		if (!this.shuttingDown) await this.drainMailbox(agent.id);
	}

	/** Emit per-turn subagents:usage events for the token-tracker integration (mirrors V1). */
	private emitRunUsage(run: RunRecord, agent: AgentRecord): void {
		if (!this.options.emitUsage || !run.usage?.length) return;
		for (const u of run.usage) {
			this.options.emitUsage({
				agentId: agent.id,
				agentType: agent.type,
				agentName: agent.displayName,
				model: agent.model ?? this.options.rootModel ?? "unknown",
				turnNumber: u.turnNumber,
				parentSessionId: this.options.rootSessionId,
				input: u.input,
				output: u.output,
				cacheRead: u.cacheRead,
				cacheWrite: u.cacheWrite,
			});
		}
	}

	private enqueueTerminalTaskTransition(run: RunRecord): void {
		if (!run.taskId || !this.todoAvailable) return;
		if (run.state === "interrupted") return;
		const status = run.state === "completed" ? "completed" : run.state === "cancelled" ? "cancelled" : "failed";
		if (status === "completed" && !this.options.settings.autoCompleteLinkedTasks) return;
		run.taskSyncPending = true;
		this.outbox!.add(
			this.todoOperation(
				createId("op"),
				"update",
				{ taskId: run.taskId, patch: { status } },
				{ agentId: run.agentId, runId: run.id },
				run.id,
			),
		);
	}

	private async enqueueRunNotification(run: RunRecord): Promise<void> {
		const waiters = this.waits.forChildRun(run.id);
		if (waiters.length === 0) {
			const agent = this.registry.getAgent(run.agentId);
			if (!agent.parentAgentId) return;
			const kind: MailboxKind =
				run.state === "completed"
					? "child_completed"
					: run.state === "cancelled"
						? "child_cancelled"
						: "child_failed";
			const message = this.createMailbox(agent.parentAgentId, run.agentId, kind, { runId: run.id });
			await this.queueMailboxDelivery(message, run);
			return;
		}
		for (const wait of waiters) {
			this.waits.update(wait.id, { state: "result_delivered" });
			const kind: MailboxKind =
				run.state === "completed"
					? "child_completed"
					: run.state === "cancelled"
						? "child_cancelled"
						: "child_failed";
			const message = this.createMailbox(wait.parentAgentId, run.agentId, kind, {
				runId: run.id,
				waitLinkId: wait.id,
			});
			await this.queueMailboxDelivery(message, run, wait.parentRunId);
		}
	}

	private createMailbox(
		recipientAgentId: AgentId,
		senderAgentId: AgentId | "coordinator",
		kind: MailboxKind,
		payload: unknown,
	): MailboxMessage {
		const message: MailboxMessage = {
			id: createId("msg"),
			recipientAgentId,
			senderAgentId,
			kind,
			priority: mailboxPriority(kind),
			payload,
			state: "pending",
			createdAt: now(),
			deliveredAt: null,
		};
		this.mailbox.push(message);
		return message;
	}

	private async queueMailboxDelivery(
		message: MailboxMessage,
		run?: RunRecord,
		parentRunId?: RunId | null,
	): Promise<void> {
		const text = run ? childResultMessage(message, run) : JSON.stringify(message.payload);
		const kind = message.recipientAgentId === "root" ? "root_message" : "agent_message";
		const agent = run ? this.registry.getAgent(run.agentId) : undefined;
		const payload: Record<string, unknown> = {
			messageId: message.id,
			recipientAgentId: message.recipientAgentId,
			parentRunId,
			text,
		};
		if (run) {
			// Enrich with run/agent info so the root notification renderer can show a rich summary.
			payload.agentId = run.agentId;
			payload.state = run.state;
			payload.taskId = run.taskId;
			payload.startedAt = run.startedAt;
			payload.completedAt = run.completedAt;
			payload.error = run.error?.message;
			payload.resultPreview = run.result ? run.result.text.slice(0, 500) : undefined;
			payload.transcript = run.result?.sessionFile;
			if (agent) {
				payload.agentName = agent.displayName;
				payload.description = agent.description ?? agent.displayName;
			}
		}
		this.outbox!.add({
			id: createId("op"),
			kind,
			payload,
			state: "pending",
			attempts: 0,
			nextAttemptAt: now(),
			createdAt: now(),
		});
		await this.persist();
	}

	private async deliverOutbox(operation: OutboxOperation): Promise<void> {
		const payload = operation.payload as any;
		if (operation.kind === "todo_rpc") {
			await this.options.todoClient.request(payload.method, payload.params, payload.actor, operation.id);
			if (payload.runId && this.registry.runs.has(payload.runId))
				this.registry.getRun(payload.runId).taskSyncPending = false;
			return;
		}
		const message = this.mailbox.all().find((candidate) => candidate.id === payload.messageId);
		if (operation.kind === "root_message") {
			this.options.rootAdapter.deliver(payload.text as string, payload, true);
			if (message) this.mailbox.update(message.id, { state: "delivered", deliveredAt: now() });
			return;
		}
		await this.resumeRecipient(payload.recipientAgentId, payload.parentRunId, payload.text, payload.messageId);
		if (message) this.mailbox.update(message.id, { state: "delivered", deliveredAt: now() });
	}

	private async resumeRecipient(
		agentId: AgentId,
		parentRunId: RunId | null | undefined,
		text: string,
		messageId: string,
	) {
		const agent = this.registry.getAgent(agentId);
		const steering = this.mailbox.pending(agentId).filter((message) => message.kind === "steer");
		if (steering.length > 0) {
			text = `${text}\n\n${steering.map((message) => `Steering: ${(message.payload as any).text}`).join("\n")}`;
			for (const message of steering) this.mailbox.update(message.id, { state: "consumed", deliveredAt: now() });
		}
		if (parentRunId) {
			const run = this.registry.getRun(parentRunId);
			if (run.state === "waiting_child") {
				this.registry.setRun(transitionRun(run, "child_terminal"));
				this.registry.setAgent(transitionAgent(agent, "child_event"));
				this.pendingMessages.set(run.id, { text, kind: "resume", messageId });
				await this.persist();
				this.enqueueSegment(run.id, 0);
				return;
			}
		}
		if (agent.state !== "idle" && agent.state !== "error") throw new Error(`Parent ${agentId} is busy`);
		await this.createFollowupRun(agent, text, "internal", messageId);
	}

	private async drainMailbox(agentId: AgentId): Promise<void> {
		const pending = this.mailbox.pending(agentId)[0];
		if (!pending || agentId === "root") return;
		const agent = this.registry.getAgent(agentId);
		if (agent.state !== "idle" && agent.state !== "error") return;
		pending.state = "consumed";
		await this.createFollowupRun(agent, JSON.stringify(pending.payload), "internal", pending.id);
	}

	private async createFollowupRun(
		agent: AgentRecord,
		text: string,
		mode: "followup" | "internal",
		messageId?: string,
		enqueue = true,
	): Promise<RunReceipt> {
		const timestamp = now();
		const runId = createId("run");
		const previousTaskId =
			mode === "followup"
				? ([...this.registry.runs.values()]
						.filter((run) => run.agentId === agent.id && run.taskId)
						.sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]?.taskId ?? null)
				: null;
		const run: RunRecord = {
			id: runId,
			agentId: agent.id,
			parentRunId: null,
			requestedByAgentId: agent.parentAgentId ?? "root",
			taskId: previousTaskId,
			mode,
			state: "queued",
			prompt: text,
			segmentCount: 0,
			waitingOnRunIds: [],
			pendingQuestionId: null,
			taskSyncPending: Boolean(previousTaskId),
			createdAt: timestamp,
			startedAt: null,
			updatedAt: timestamp,
			completedAt: null,
		};
		agent.currentRunId = runId;
		this.registry.setAgent(transitionAgent(agent, "enqueue_run", timestamp));
		this.registry.setRun(run);
		if (previousTaskId && this.todoAvailable) {
			this.outbox!.add(
				this.todoOperation(
					createId("op"),
					"update",
					{ taskId: previousTaskId, patch: { status: "in_progress" } },
					{ agentId: agent.id, runId },
					runId,
				),
			);
		}
		this.pendingMessages.set(runId, { text, kind: mode === "followup" ? "followup" : "internal", messageId });
		await this.persist();
		if (enqueue) this.enqueueSegment(runId, mode === "internal" ? 1 : 2);
		return { agentId: agent.id, runId, status: "queued" };
	}

	getAgent(caller: CallerContext, agentId: AgentId): AgentRecord {
		this.assertCaller(caller);
		if (caller.agentId !== "root" && caller.agentId !== agentId)
			assertCanManage(this.registry, caller.agentId, agentId);
		return structuredClone(this.registry.getAgent(agentId));
	}

	getRun(caller: CallerContext, runId: RunId): RunRecord {
		this.assertCaller(caller);
		const run = this.registry.getRun(runId);
		if (caller.agentId !== "root" && caller.agentId !== run.agentId)
			assertCanManage(this.registry, caller.agentId, run.agentId);
		return structuredClone(run);
	}

	async registerWait(caller: CallerContext, runId: RunId): Promise<WaitLink> {
		this.assertCaller(caller);
		const childRun = this.registry.getRun(runId);
		assertCanManage(this.registry, caller.agentId, childRun.agentId);
		const child = this.registry.getAgent(childRun.agentId);
		// Idempotent: reuse an existing unresolved wait link for the same parent + child run.
		// Repeated get_subagent_result(wait: true) calls otherwise register one link per call,
		// and completion delivers the full result once per link (duplicate notifications).
		const existing = this.waits
			.all()
			.find(
				(link) =>
					link.parentAgentId === caller.agentId &&
					link.childRunId === runId &&
					(link.state === "waiting" || link.state === "question_delivered"),
			);
		if (existing) return existing;
		const link: WaitLink = {
			id: createId("wait"),
			parentAgentId: caller.agentId,
			parentRunId: caller.runId,
			childAgentId: child.id,
			childRunId: runId,
			state: "waiting",
			createdAt: now(),
			updatedAt: now(),
		};
		this.waits.add(link);
		if (caller.runId) {
			const parentRun = this.registry.getRun(caller.runId);
			this.registry.setRun(transitionRun(parentRun, "foreground_child_started"));
			this.registry.setAgent(transitionAgent(this.registry.getAgent(caller.agentId), "wait_for_child"));
		}
		await this.persist();
		return link;
	}

	async cancelWait(caller: CallerContext, waitLinkId: string): Promise<void> {
		const link = this.waits.get(waitLinkId);
		if (link.parentAgentId !== caller.agentId) throw new Error("Only the waiter can cancel a wait link");
		this.waits.update(waitLinkId, { state: "cancelled" });
		await this.persist();
	}

	async sendFollowup(caller: CallerContext, agentId: AgentId, text: string, deferStart = false): Promise<RunReceipt> {
		this.assertCaller(caller);
		assertBoundedText(text, "Follow-up", this.options.settings.maxTranscriptBytes);
		assertCanManage(this.registry, caller.agentId, agentId);
		const agent = this.registry.getAgent(agentId);
		if (agent.state !== "idle" && agent.state !== "error") throw new Error(`Agent ${agentId} is ${agent.state}`);
		return this.createFollowupRun(agent, text, "followup", undefined, !deferStart);
	}

	startQueuedRun(runId: RunId): void {
		this.enqueueSegment(runId, 2);
	}

	async steer(caller: CallerContext, agentId: AgentId, text: string): Promise<void> {
		this.assertCaller(caller);
		assertBoundedText(text, "Steering message", 4_000);
		assertCanManage(this.registry, caller.agentId, agentId, caller.agentId !== "root");
		const agent = this.registry.getAgent(agentId);
		if (agent.state === "running") {
			await (await this.options.runtimePool.get(agent)).steer(text);
			return;
		}
		if (agent.state === "waiting_child" || agent.state === "waiting_parent" || agent.state === "queued") {
			this.createMailbox(agentId, caller.agentId, "steer", { text: text.slice(0, 4_000) });
			await this.persist();
			return;
		}
		throw new Error(`Agent ${agentId} is ${agent.state}; use send_to_agent for follow-up`);
	}

	async stop(caller: CallerContext, agentId: AgentId, _reason?: string): Promise<void> {
		this.assertCaller(caller);
		assertCanManage(this.registry, caller.agentId, agentId, caller.agentId !== "root");
		const targets = [this.registry.getAgent(agentId), ...this.registry.descendants(agentId)].reverse();
		for (const agent of targets) {
			if (!agent.currentRunId) continue;
			let run = this.registry.getRun(agent.currentRunId);
			if (TERMINAL_RUN_STATES.has(run.state)) continue;
			const previousRunState = run.state;
			this.queue.cancel(run.id);
			this.registry.setAgent(transitionAgent(agent, "stop"));
			run.stopReason = "cancelled_by_parent";
			run = transitionRun(run, "cancel");
			this.registry.setRun(run);
			await this.persist();
			if (previousRunState !== "queued")
				await (await this.options.runtimePool.get(agent)).abort("cancelled_by_parent");
			this.registry.setAgent({
				...transitionAgent(this.registry.getAgent(agent.id), "run_fail"),
				currentRunId: null,
			});
			this.options.runtimePool.touch(this.registry.getAgent(agent.id));
			this.enqueueTerminalTaskTransition(run);
		}
		await this.persist();
	}

	async askParent(
		caller: CallerContext,
		input: AskParentInput,
	): Promise<QuestionRecord | { status: "human_required"; questionId: string }> {
		this.assertCaller(caller);
		assertBoundedText(input.question, "Question", 16_000);
		if (caller.agentId === "root") {
			const questionId = createId("qst");
			const answer = await this.options.humanAdapter.ask({
				originatingAgent: "root",
				hierarchyPath: "root",
				taskId: input.task_id,
				questionId,
				question: input.question,
			});
			return answer.status === "answered"
				? ({ id: questionId, answer: answer.answer } as unknown as QuestionRecord)
				: { status: "human_required", questionId };
		}
		const question = this.options.questions.create(caller, input);
		const run = this.registry.getRun(caller.runId!);
		const agent = this.registry.getAgent(caller.agentId);
		this.registry.setRun({
			...transitionRun(run, "ask_parent"),
			pendingQuestionId: question.id,
			taskSyncPending: question.taskId && this.todoAvailable ? true : run.taskSyncPending,
		});
		this.registry.setAgent(transitionAgent(agent, "ask_parent"));
		if (question.taskId && this.todoAvailable) {
			this.outbox!.add(
				this.todoOperation(
					createId("op"),
					"block",
					{ taskId: question.taskId, question: { questionId: question.id, text: question.text } },
					{ agentId: caller.agentId, runId: caller.runId },
					run.id,
				),
			);
		}
		const message = this.createMailbox(question.toAgentId, caller.agentId, "child_question", {
			questionId: question.id,
		});
		const waitingLink = this.waits.forChildRun(run.id)[0];
		if (waitingLink) this.waits.update(waitingLink.id, { state: "question_delivered" });
		const parentRunId = waitingLink?.parentRunId;
		const text = childQuestionMessage(message, question);
		const kind = question.toAgentId === "root" ? "root_message" : "agent_message";
		this.outbox!.add({
			id: createId("op"),
			kind,
			payload: { messageId: message.id, recipientAgentId: question.toAgentId, parentRunId, text },
			state: "pending",
			attempts: 0,
			nextAttemptAt: now(),
			createdAt: now(),
		});
		await this.persist();
		this.scheduleQuestionTimeout(question);
		return question;
	}

	async answerChild(caller: CallerContext, input: AnswerChildInput): Promise<AnswerReceipt> {
		this.assertCaller(caller);
		assertBoundedText(input.answer, "Answer", 32_000);
		const question = this.options.questions.answer(caller, input.question_id, input.answer);
		const timeout = this.questionTimers.get(question.id);
		if (timeout) clearTimeout(timeout);
		this.questionTimers.delete(question.id);
		const childRun = this.registry.getRun(question.fromRunId);
		const childAgent = this.registry.getAgent(question.fromAgentId);
		this.registry.setRun({
			...transitionRun(childRun, "answer_received"),
			pendingQuestionId: null,
			taskSyncPending: question.taskId && this.todoAvailable ? true : childRun.taskSyncPending,
		});
		this.registry.setAgent(transitionAgent(childAgent, "answer_received"));
		if (question.taskId && this.todoAvailable) {
			this.outbox!.add(
				this.todoOperation(
					createId("op"),
					"unblock",
					{ taskId: question.taskId, questionId: question.id },
					{ agentId: caller.agentId, runId: caller.runId },
					childRun.id,
				),
			);
		}
		const message = this.createMailbox(question.fromAgentId, caller.agentId, "parent_answer", {
			questionId: question.id,
		});
		this.pendingMessages.set(childRun.id, {
			text: parentAnswerMessage(message.id, question),
			kind: "resume",
			messageId: message.id,
		});
		let waitLinkId: string | undefined;
		const existingWait = this.waits.forChildRun(childRun.id).find((link) => link.parentAgentId === caller.agentId);
		if (existingWait && !input.detach) {
			if (caller.runId) {
				const parentRun = this.registry.getRun(caller.runId);
				this.registry.setRun(transitionRun(parentRun, "foreground_child_started"));
				this.registry.setAgent(transitionAgent(this.registry.getAgent(caller.agentId), "wait_for_child"));
			}
			waitLinkId = existingWait.id;
		}
		await this.persist();
		this.enqueueSegment(childRun.id, 0);
		return { questionId: question.id, childRunId: childRun.id, waitLinkId };
	}

	async reportProgress(caller: CallerContext, input: ProgressInput): Promise<void> {
		this.assertCaller(caller);
		const text = input.message.slice(0, 1_000);
		const agent = this.registry.getAgent(caller.agentId);
		if (!agent.parentAgentId) return;
		this.createMailbox(agent.parentAgentId, caller.agentId, "system", { progress: text, taskId: input.task_id });
		await this.persist();
	}

	async taskRequest<M extends TodoMethod>(
		caller: CallerContext,
		method: M,
		params: TodoParams[M],
		mutation: boolean,
	): Promise<unknown> {
		this.assertCaller(caller);
		if (!this.todoAvailable) throw new TodoUnavailableError();
		const actor = { agentId: caller.agentId, runId: caller.runId };
		if (!mutation) return this.options.todoClient.request(method, params, actor);
		const operation = this.todoOperation(createId("op"), method, params, actor, caller.runId ?? undefined);
		this.outbox!.add(operation);
		await this.persist();
		const result = await this.options.todoClient.request(method, params, actor, operation.id);
		operation.state = "delivered";
		operation.deliveredAt = now();
		await this.persist();
		return result;
	}

	private todoOperation<M extends TodoMethod>(
		id: string,
		method: M,
		params: TodoParams[M],
		actor: { agentId: string; runId: string | null },
		runId?: string,
	): OutboxOperation {
		return {
			id,
			kind: "todo_rpc",
			payload: { method, params, actor, runId },
			state: "pending",
			attempts: 0,
			nextAttemptAt: now(),
			createdAt: now(),
		};
	}

	private scheduleQuestionTimeout(question: QuestionRecord): void {
		if (!question.expiresAt) return;
		const delay = Math.max(0, Date.parse(question.expiresAt) - Date.now());
		const timer = setTimeout(() => {
			void this.expireQuestion(question.id).catch((error) => {
				console.error(`[edb-subagents-v2] Failed to expire question ${question.id}:`, error);
			});
		}, delay);
		timer.unref?.();
		this.questionTimers.set(question.id, timer);
	}

	private async expireQuestion(questionId: string): Promise<void> {
		const question = this.options.questions.get(questionId);
		if (question.state !== "open" && question.state !== "escalated") return;
		question.state = "expired";
		this.questionTimers.delete(questionId);
		const run = this.registry.getRun(question.fromRunId);
		const agent = this.registry.getAgent(question.fromAgentId);
		if (run.state === "waiting_parent") {
			this.registry.setRun({
				...transitionRun(run, "timeout"),
				taskSyncPending: question.taskId && this.todoAvailable ? true : run.taskSyncPending,
			});
			const stopping = transitionAgent(agent, "stop");
			this.registry.setAgent({ ...transitionAgent(stopping, "run_fail"), currentRunId: null });
			if (question.taskId && this.todoAvailable) {
				this.outbox!.add(
					this.todoOperation(
						createId("op"),
						"update",
						{
							taskId: question.taskId,
							patch: { status: "failed", metadata: { timeoutQuestionId: question.id } },
						},
						{ agentId: question.fromAgentId, runId: question.fromRunId },
						run.id,
					),
				);
			}
			try {
				await (await this.options.runtimePool.get(agent)).abort("timeout");
			} catch {
				// The controlled-wait runtime may already be unloaded.
			}
		}
		const message = this.createMailbox(question.toAgentId, "coordinator", "timeout", { questionId });
		await this.queueMailboxDelivery(message, undefined, null);
		await this.persist();
	}

	caller(agentId: AgentId, abortSignal: AbortSignal): CallerContext {
		const agent = this.registry.getAgent(agentId);
		return { agentId, runId: agent.currentRunId, rootSessionId: this.options.rootSessionId, abortSignal };
	}

	createAgentTools(agentId: AgentId, control?: RunControl, abort?: () => void): ToolDefinition[] {
		const tools: ToolDefinition[] = [
			createAgentTool(this, agentId, control, abort, this.options.agentDefinitions),
			createGetResultTool(this, agentId, control, abort),
			createSendTool(this, agentId, control, abort),
			createSteerTool(this, agentId),
			createStopTool(this, agentId),
			...createQuestionTools(this, agentId, control, abort),
			createProgressTool(this, agentId),
		];
		if (this.todoAvailable) tools.push(...this.createTaskProxyTools(agentId));
		return tools;
	}

	createTaskProxyTools(agentId: AgentId): ToolDefinition[] {
		return this.todoAvailable ? createTaskProxyTools(this, agentId) : [];
	}

	async disposeAgent(caller: CallerContext, agentId: AgentId): Promise<void> {
		assertCanManage(this.registry, caller.agentId, agentId);
		const agent = this.registry.getAgent(agentId);
		if (!["idle", "error"].includes(agent.state)) throw new Error(`Agent ${agentId} must be idle before disposal`);
		this.registry.setAgent(transitionAgent(agent, "dispose"));
		await this.options.runtimePool.dispose(agentId);
		await this.persist();
	}

	async shutdown(_reason: "session_shutdown" | "process_exit"): Promise<void> {
		if (this.shuttingDown) return;
		this.shuttingDown = true;
		this.queue.stop();
		for (const timer of this.questionTimers.values()) clearTimeout(timer);
		this.questionTimers.clear();
		await this.outbox?.dispose();
		for (const run of this.registry.runs.values()) {
			if (TERMINAL_RUN_STATES.has(run.state)) continue;
			run.stopReason = "shutdown";
			this.registry.setRun(transitionRun(run, "shutdown"));
			const agent = this.registry.getAgent(run.agentId);
			try {
				if (agent.state === "running" || agent.state.startsWith("waiting")) {
					await (await this.options.runtimePool.get(agent)).abort("shutdown");
				}
			} catch {
				// Runtime may never have loaded.
			}
			if (agent.state !== "idle") {
				const stopping = transitionAgent(agent, "stop");
				this.registry.setAgent({ ...transitionAgent(stopping, "run_fail"), currentRunId: null });
			}
		}
		await this.queue.whenIdle();
		await this.persist();
		await this.options.store.flush();
		await this.options.runtimePool.dispose();
		this.options.todoClient.dispose();
		await this.options.diagnostics?.flush();
	}
}
