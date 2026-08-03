import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentRegistry } from "../../src/v2/coordinator/agent-registry.js";
import { Coordinator } from "../../src/v2/coordinator/coordinator.js";
import { AtomicStore } from "../../src/v2/persistence/atomic-store.js";
import { HumanAdapter } from "../../src/v2/questions/human-adapter.js";
import { QuestionService } from "../../src/v2/questions/question-service.js";
import { RuntimePool } from "../../src/v2/runtime/runtime-pool.js";
import { DEFAULT_V2_SETTINGS } from "../../src/v2/settings.js";
import type {
	AbortReason,
	AgentRecord,
	AgentRuntime,
	RunRecord,
	RuntimeMessage,
	SegmentOutcome,
} from "../../src/v2/types.js";

const directories: string[] = [];

afterEach(async () => {
	await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

interface TestTask {
	id: string;
	status: string;
	owner?: string;
	questionId?: string;
}

class TestTodoClient {
	available = true;
	tasks = new Map<string, TestTask>([["T1", { id: "T1", status: "pending" }]]);
	private operations = new Map<string, unknown>();
	private nextId = 2;

	async request(method: string, params: any, _actor: unknown, operationId?: string): Promise<unknown> {
		if (operationId && this.operations.has(operationId)) return structuredClone(this.operations.get(operationId));
		let result: unknown;
		if (method === "create") {
			const id = `T${this.nextId++}`;
			result = { id, content: params.content, status: "pending" };
			this.tasks.set(id, { id, status: "pending" });
		} else {
			const task = this.tasks.get(params.taskId);
			if (!task) throw new Error(`Task ${params.taskId} not found`);
			if (method === "assign") {
				task.owner = params.owner.agentId;
				task.status = "in_progress";
			} else if (method === "block") {
				task.status = "blocked";
				task.questionId = params.question.questionId;
			} else if (method === "unblock") {
				if (task.questionId !== params.questionId) throw new Error("Question mismatch");
				task.status = "in_progress";
				task.questionId = undefined;
			} else if (method === "update") task.status = params.patch.status ?? task.status;
			result = structuredClone(task);
		}
		if (operationId) this.operations.set(operationId, structuredClone(result));
		return result;
	}

	dispose(): void {}
}

class AcceptanceRuntime implements AgentRuntime {
	private agent!: AgentRecord;
	private calls = 0;
	constructor(
		private readonly script: (agent: AgentRecord, call: number, message: RuntimeMessage) => Promise<SegmentOutcome>,
	) {}
	async load(agent: AgentRecord): Promise<void> {
		this.agent = agent;
		agent.sessionFile ??= `/tmp/${agent.id}.jsonl`;
	}
	async runSegment(_run: RunRecord, message: RuntimeMessage): Promise<SegmentOutcome> {
		return this.script(this.agent, ++this.calls, message);
	}
	async steer(): Promise<void> {}
	async abort(_reason: AbortReason): Promise<void> {}
	async unload(): Promise<void> {}
	async dispose(): Promise<void> {}
}

async function waitFor(predicate: () => boolean, message: string, timeoutMs = 3_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error(message);
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

describe("V2 final acceptance", () => {
	it("runs the full recursive todo, escalation, steering, follow-up, shutdown, and recovery scenario", async () => {
		const directory = await mkdtemp(join(tmpdir(), "edb-subagents-acceptance-"));
		directories.push(directory);
		const todo = new TestTodoClient();
		const rootMessages: string[] = [];
		const releaseB = Promise.withResolvers<void>();
		let coordinator!: Coordinator;
		let originalAgentId = "";
		let sawSteeringOnResume = false;
		const pool = new RuntimePool(
			() =>
				new AcceptanceRuntime(async (agent, call, message) => {
					if (agent.displayName === "A" && call === 1) {
						const task = (await coordinator.taskRequest(
							coordinator.caller(agent.id, new AbortController().signal),
							"create",
							{ content: "Child task" },
							true,
						)) as { id: string };
						const receipt = await coordinator.spawn(coordinator.caller(agent.id, new AbortController().signal), {
							prompt: "Do child work",
							description: "B",
							subagent_type: "tester",
							agent_name: "B",
							task_id: task.id,
						});
						return { kind: "waiting_child", waitLinkId: receipt.waitLinkId!, rotateRuntime: false };
					}
					if (agent.displayName === "B" && call === 1) {
						const question = await coordinator.askParent(
							coordinator.caller(agent.id, new AbortController().signal),
							{
								question: "Which color should I use?",
							},
						);
						return { kind: "waiting_parent", questionId: (question as any).id, rotateRuntime: false };
					}
					if (agent.displayName === "A" && call === 2) {
						const childQuestion = coordinator
							.listQuestions()
							.find((question) => question.fromAgentId !== agent.id)!;
						const escalated = await coordinator.askParent(
							coordinator.caller(agent.id, new AbortController().signal),
							{
								question: "B needs a color and I do not know it.",
								for_question_id: childQuestion.id,
							},
						);
						return { kind: "waiting_parent", questionId: (escalated as any).id, rotateRuntime: false };
					}
					if (agent.displayName === "A" && call === 3) {
						const childQuestion = coordinator
							.listQuestions()
							.find((question) => question.fromAgentId !== agent.id)!;
						const receipt = await coordinator.answerChild(
							coordinator.caller(agent.id, new AbortController().signal),
							{
								question_id: childQuestion.id,
								answer: "cobalt",
							},
						);
						return { kind: "waiting_child", waitLinkId: receipt.waitLinkId!, rotateRuntime: false };
					}
					if (agent.displayName === "B" && call === 2) {
						await releaseB.promise;
						return { kind: "completed", text: "B completed with cobalt", sessionFile: agent.sessionFile! };
					}
					if (agent.displayName === "A" && call === 4) {
						sawSteeringOnResume = message.text.includes("Steering: include verification");
						return { kind: "completed", text: "A completed after B", sessionFile: agent.sessionFile! };
					}
					return {
						kind: "completed",
						text: "A follow-up retained original context",
						sessionFile: agent.sessionFile!,
					};
				}),
			60_000,
		);
		coordinator = new Coordinator({
			rootSessionId: "root_acceptance",
			cwd: directory,
			settings: { ...DEFAULT_V2_SETTINGS, engine: "v2", maxConcurrentPrompts: 1 },
			store: new AtomicStore(directory, "root_acceptance", directory),
			runtimePool: pool,
			rootAdapter: { deliver: (content: string) => rootMessages.push(content) } as any,
			todoClient: todo as any,
			questions: new QuestionService(new AgentRegistry()),
			humanAdapter: new HumanAdapter(),
		});
		await coordinator.start();
		const rootCaller = coordinator.caller("root", new AbortController().signal);
		const a = await coordinator.spawn(rootCaller, {
			prompt: "Do root task",
			description: "A",
			subagent_type: "coder",
			agent_name: "A",
			task_id: "T1",
		});
		originalAgentId = a.agentId;
		await waitFor(
			() =>
				coordinator
					.listQuestions()
					.some((question) => question.toAgentId === "root" && question.state === "escalated"),
			"nested question did not reach root",
		);
		const rootQuestion = coordinator.listQuestions().find((question) => question.toAgentId === "root")!;
		const bId = [...coordinator.registry.agents.values()].find((agent) => agent.displayName === "B")!.id;
		await expect(
			coordinator.askParent(coordinator.caller(bId, new AbortController().signal), {
				question: "Attempt to forge another branch's escalation",
				for_question_id: rootQuestion.id,
			}),
		).rejects.toThrow("cannot escalate");
		const rootAnswer = await coordinator.answerChild(rootCaller, {
			question_id: rootQuestion.id,
			answer: "Use cobalt",
		});
		expect(rootAnswer.waitLinkId).toBeDefined();
		await waitFor(
			() => coordinator.registry.getAgent(originalAgentId).state === "waiting_child",
			"A did not return to waiting for B",
		);
		await coordinator.steer(rootCaller, originalAgentId, "include verification");
		releaseB.resolve();
		await waitFor(
			() => rootMessages.some((message) => message.includes("A completed after B")),
			"root did not receive A result",
		);
		await waitFor(
			() => todo.tasks.get("T1")?.status === "completed" && todo.tasks.get("T2")?.status === "completed",
			"tasks did not complete",
		);
		expect(sawSteeringOnResume).toBe(true);
		expect(todo.tasks.get("T1")?.owner).toBe(originalAgentId);
		expect(todo.tasks.get("T2")?.owner).toBe(bId);

		await coordinator.sendFollowup(rootCaller, originalAgentId, "What context do you retain?");
		await waitFor(
			() => rootMessages.some((message) => message.includes("follow-up retained original context")),
			"first follow-up did not complete",
		);
		await coordinator.shutdown("session_shutdown");

		const resumedMessages: string[] = [];
		const resumedPool = new RuntimePool(
			() =>
				new AcceptanceRuntime(async (agent) => ({
					kind: "completed",
					text: "A answered after coordinator recovery",
					sessionFile: agent.sessionFile!,
				})),
			60_000,
		);
		const resumed = new Coordinator({
			rootSessionId: "root_acceptance",
			cwd: directory,
			settings: { ...DEFAULT_V2_SETTINGS, engine: "v2", maxConcurrentPrompts: 1 },
			store: new AtomicStore(directory, "root_acceptance", directory),
			runtimePool: resumedPool,
			rootAdapter: { deliver: (content: string) => resumedMessages.push(content) } as any,
			todoClient: todo as any,
			questions: new QuestionService(new AgentRegistry()),
			humanAdapter: new HumanAdapter(),
		});
		await resumed.start();
		expect(resumed.registry.getAgent(originalAgentId).state).toBe("idle");
		await resumed.sendFollowup(resumed.caller("root", new AbortController().signal), originalAgentId, "Answer again");
		await waitFor(
			() => resumedMessages.some((message) => message.includes("after coordinator recovery")),
			"recovered follow-up failed",
		);
		expect(resumed.registry.getAgent(originalAgentId).id).toBe(originalAgentId);
		await resumed.shutdown("session_shutdown");
	});
});
