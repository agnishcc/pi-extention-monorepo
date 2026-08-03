import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

export type AgentId = string;
export type RunId = string;
export type QuestionId = string;
export type MessageId = string;
export type WaitLinkId = string;
export type OperationId = string;

export interface DiagnosticEvent {
	eventId: string;
	type: string;
	rootSessionId: string;
	agentId?: AgentId;
	runId?: RunId;
	questionId?: QuestionId;
	taskId?: string;
	previousState?: string;
	nextState?: string;
	durationMs?: number;
	errorCode?: string;
	timestamp: string;
}

export type AgentState =
	| "created"
	| "idle"
	| "queued"
	| "running"
	| "waiting_parent"
	| "waiting_child"
	| "stopping"
	| "error"
	| "disposed";

export type RunState =
	| "queued"
	| "running"
	| "waiting_parent"
	| "waiting_child"
	| "completed"
	| "failed"
	| "cancelled"
	| "timed_out"
	| "interrupted";

export type AbortReason =
	| "suspend_for_question"
	| "suspend_for_child"
	| "cancelled_by_parent"
	| "cancelled_by_human"
	| "timeout"
	| "shutdown"
	| "runtime_error";

export interface AgentRecord {
	id: AgentId;
	parentAgentId: AgentId | null;
	createdByRunId: RunId | null;
	type: string;
	displayName: string;
	description?: string;
	sessionFile: string | null;
	cwd: string;
	state: AgentState;
	currentRunId: RunId | null;
	childAgentIds: AgentId[];
	model?: string;
	thinking?: string;
	maxTurns?: number;
	toolProfile: string;
	createdAt: string;
	updatedAt: string;
	lastActiveAt: string | null;
	disposedAt: string | null;
}

export interface StoredResult {
	text: string;
	truncated: boolean;
	storedBytes: number;
	originalBytes?: number;
	sessionFile: string;
	finalMessageId?: string;
}

export interface StoredError {
	code: string;
	message: string;
	stack?: string;
}

export interface RunRecord {
	id: RunId;
	agentId: AgentId;
	parentRunId: RunId | null;
	requestedByAgentId: AgentId;
	taskId: string | null;
	mode: "foreground" | "background" | "followup" | "internal";
	state: RunState;
	prompt: string;
	segmentCount: number;
	waitingOnRunIds: RunId[];
	pendingQuestionId: QuestionId | null;
	result?: StoredResult;
	error?: StoredError;
	stopReason?: AbortReason;
	taskSyncPending: boolean;
	createdAt: string;
	startedAt: string | null;
	updatedAt: string;
	completedAt: string | null;
	/** Per-turn token usage captured during this run (when the runtime provided it). */
	usage?: TurnUsage[];
}

export interface QuestionRecord {
	id: QuestionId;
	fromAgentId: AgentId;
	fromRunId: RunId;
	toAgentId: AgentId;
	linkedQuestionId: QuestionId | null;
	taskId: string | null;
	state: "open" | "escalated" | "answered" | "expired" | "cancelled";
	text: string;
	answer: string | null;
	createdAt: string;
	answeredAt: string | null;
	expiresAt: string | null;
}

export interface WaitLink {
	id: WaitLinkId;
	parentAgentId: AgentId;
	parentRunId: RunId | null;
	childAgentId: AgentId;
	childRunId: RunId;
	state: "waiting" | "question_delivered" | "result_delivered" | "cancelled";
	createdAt: string;
	updatedAt: string;
}

export type MailboxKind =
	| "child_question"
	| "child_completed"
	| "child_failed"
	| "child_cancelled"
	| "parent_answer"
	| "steer"
	| "followup"
	| "stop"
	| "timeout"
	| "system";

export interface MailboxMessage {
	id: MessageId;
	recipientAgentId: AgentId;
	senderAgentId: AgentId | "coordinator";
	kind: MailboxKind;
	priority: 0 | 1 | 2 | 3;
	payload: unknown;
	state: "pending" | "delivering" | "delivered" | "consumed" | "failed";
	createdAt: string;
	deliveredAt: string | null;
}

export interface OutboxOperation {
	id: OperationId;
	kind: "todo_rpc" | "root_message" | "agent_message";
	payload: unknown;
	state: "pending" | "delivering" | "delivered" | "failed";
	attempts: number;
	nextAttemptAt: string;
	lastError?: string;
	createdAt: string;
	deliveredAt?: string;
}

export interface CoordinatorSnapshotV1 {
	schemaVersion: 1;
	rootSessionId: string;
	cwd: string;
	revision: number;
	agents: Record<AgentId, AgentRecord>;
	runs: Record<RunId, RunRecord>;
	questions: Record<QuestionId, QuestionRecord>;
	waitLinks: Record<WaitLinkId, WaitLink>;
	mailbox: MailboxMessage[];
	outbox: OutboxOperation[];
	updatedAt: string;
}

export interface CallerContext {
	agentId: AgentId;
	runId: RunId | null;
	rootSessionId: string;
	abortSignal: AbortSignal;
}

export interface SpawnInput {
	prompt: string;
	description: string;
	subagent_type: string;
	run_in_background?: boolean;
	model?: string;
	thinking?: string;
	max_turns?: number;
	task_id?: string;
	agent_name?: string;
}

export interface SpawnReceipt {
	status: "queued" | "waiting";
	agentId: AgentId;
	runId: RunId;
	waitLinkId?: WaitLinkId;
	resume?: "automatic";
}

export interface RunReceipt {
	agentId: AgentId;
	runId: RunId;
	status: "queued" | "waiting";
	waitLinkId?: WaitLinkId;
}

export interface AskParentInput {
	question: string;
	for_question_id?: QuestionId;
	task_id?: string;
	timeout_ms?: number;
}

export interface AnswerChildInput {
	question_id: QuestionId;
	answer: string;
	detach?: boolean;
}

export interface ProgressInput {
	message: string;
	task_id?: string;
}

export interface RunControl {
	requestedYield: null | { reason: "question" | "child_wait"; entityId: QuestionId | WaitLinkId };
	abortReason: AbortReason | null;
	requiresControlledAbort?: boolean;
}

export interface RuntimeMessage {
	text: string;
	kind: "prompt" | "resume" | "followup" | "internal";
	messageId?: MessageId;
}

export type SegmentOutcome =
	| { kind: "completed"; text: string; sessionFile: string; finalMessageId?: string; usage?: TurnUsage[] }
	| { kind: "waiting_parent"; questionId: QuestionId; rotateRuntime: boolean }
	| { kind: "waiting_child"; waitLinkId: WaitLinkId; rotateRuntime: boolean }
	| { kind: "failed"; error: Error; usage?: TurnUsage[] }
	| { kind: "aborted"; reason: AbortReason; usage?: TurnUsage[] };

/** Per-turn token usage captured from a child's assistant messages (mirrors the V1 subagents:usage event). */
export interface TurnUsage {
	turnNumber: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

export interface AgentRuntime {
	load(agent: AgentRecord): Promise<void>;
	runSegment(run: RunRecord, message: RuntimeMessage): Promise<SegmentOutcome>;
	steer(message: string): Promise<void>;
	abort(reason: AbortReason): Promise<void>;
	unload(): Promise<void>;
	dispose(): Promise<void>;
}

export type RuntimeFactory = (agent: AgentRecord) => AgentRuntime;
export type CustomTool = ToolDefinition<any, any>;

export const TERMINAL_RUN_STATES = new Set<RunState>(["completed", "failed", "cancelled", "timed_out", "interrupted"]);
