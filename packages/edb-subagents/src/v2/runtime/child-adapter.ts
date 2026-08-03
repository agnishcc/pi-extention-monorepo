import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type {
	AbortReason,
	AgentRecord,
	AgentRuntime,
	RunControl,
	RunRecord,
	RuntimeMessage,
	SegmentOutcome,
} from "../types.js";
import { createRunControl } from "./run-control.js";
import type { SessionFactory } from "./session-factory.js";

function assistantText(session: AgentSession): string {
	const message = [...session.messages].reverse().find((candidate) => candidate.role === "assistant");
	if (!message || message.role !== "assistant") return "";
	return message.content
		.filter((content): content is { type: "text"; text: string } => content.type === "text")
		.map((content) => content.text)
		.join("\n")
		.trim();
}

export class ChildRuntime implements AgentRuntime {
	private session: AgentSession | undefined;
	private agent: AgentRecord | undefined;
	private control: RunControl = createRunControl();
	private running = false;
	private abortReason: AbortReason | null = null;
	private currentRunId: string | undefined;
	private runTurns = 0;
	private turnLimitReached = false;

	constructor(private readonly factory: SessionFactory) {}

	async load(agent: AgentRecord): Promise<void> {
		this.agent = agent;
		if (this.session) return;
		this.control = createRunControl();
		const created = await this.factory.create(agent, this.control, () => {
			if (this.control.abortReason) void this.session?.abort();
		});
		this.session = created.session;
		this.session.subscribe((event) => {
			if (event.type === "turn_end" && this.agent?.maxTurns && this.currentRunId) {
				this.runTurns++;
				if (this.runTurns === this.agent.maxTurns) {
					void this.session?.steer("You have reached your turn limit. Provide your final answer now.");
				} else if (this.runTurns >= this.agent.maxTurns + 2) {
					this.turnLimitReached = true;
					void this.session?.abort();
				}
			}
			if (event.type !== "message_end" || event.message.role !== "assistant") return;
			this.control.requiresControlledAbort =
				event.message.content.filter((part) => part.type === "toolCall").length > 1;
		});
		agent.sessionFile = this.session.sessionFile ?? null;
	}

	async runSegment(run: RunRecord, message: RuntimeMessage): Promise<SegmentOutcome> {
		if (!this.agent) throw new Error("Runtime was not loaded");
		await this.load(this.agent);
		if (!this.session || this.running) throw new Error("Session already has an active prompt segment");
		if (this.currentRunId !== run.id) {
			this.currentRunId = run.id;
			this.runTurns = 0;
			this.turnLimitReached = false;
		}
		this.running = true;
		this.control.requestedYield = null;
		this.control.abortReason = null;
		this.control.requiresControlledAbort = false;
		this.abortReason = null;
		try {
			await this.session.prompt(message.text);
			const requestedYield = this.control.requestedYield as RunControl["requestedYield"];
			const controlledAbort = this.control.abortReason as AbortReason | null;
			if (requestedYield?.reason === "question") {
				return {
					kind: "waiting_parent",
					questionId: requestedYield.entityId,
					rotateRuntime: controlledAbort === "suspend_for_question",
				};
			}
			if (requestedYield?.reason === "child_wait") {
				return {
					kind: "waiting_child",
					waitLinkId: requestedYield.entityId,
					rotateRuntime: controlledAbort === "suspend_for_child",
				};
			}
			if (this.abortReason) return { kind: "aborted", reason: this.abortReason };
			if (this.turnLimitReached) return { kind: "failed", error: new Error("Child exceeded its turn limit") };
			const lastAssistant = [...this.session.messages].reverse().find((candidate) => candidate.role === "assistant");
			if (lastAssistant?.role === "assistant" && lastAssistant.stopReason === "error") {
				return { kind: "failed", error: new Error(lastAssistant.errorMessage ?? "Child model error") };
			}
			return {
				kind: "completed",
				text: assistantText(this.session),
				sessionFile: this.session.sessionFile ?? "",
			};
		} catch (error) {
			const requestedYield = this.control.requestedYield as RunControl["requestedYield"];
			if (requestedYield?.reason === "question") {
				return { kind: "waiting_parent", questionId: requestedYield.entityId, rotateRuntime: true };
			}
			if (requestedYield?.reason === "child_wait") {
				return { kind: "waiting_child", waitLinkId: requestedYield.entityId, rotateRuntime: true };
			}
			if (this.abortReason) return { kind: "aborted", reason: this.abortReason };
			if (this.turnLimitReached) return { kind: "failed", error: new Error("Child exceeded its turn limit") };
			return { kind: "failed", error: error instanceof Error ? error : new Error(String(error)) };
		} finally {
			this.running = false;
			const controlledAbort = this.control.abortReason as AbortReason | null;
			if (controlledAbort?.startsWith("suspend_for_")) await this.unload();
		}
	}

	async steer(message: string): Promise<void> {
		if (!this.session?.isStreaming) throw new Error("Agent is not running; use send_to_agent for a follow-up");
		await this.session.steer(message);
	}

	async abort(reason: AbortReason): Promise<void> {
		this.abortReason = reason;
		this.control.abortReason = reason;
		await this.session?.abort();
	}

	async unload(): Promise<void> {
		this.session?.dispose();
		this.session = undefined;
	}

	async dispose(): Promise<void> {
		await this.unload();
		this.agent = undefined;
	}
}
