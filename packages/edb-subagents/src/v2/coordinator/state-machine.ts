import { InvalidTransitionError } from "../errors.js";
import type { AgentRecord, AgentState, RunRecord, RunState } from "../types.js";

export type AgentEvent =
	| "session_ready"
	| "enqueue_run"
	| "prompt_segment_start"
	| "ask_parent"
	| "wait_for_child"
	| "run_complete"
	| "run_fail"
	| "runtime_unusable"
	| "answer_received"
	| "child_event"
	| "stop"
	| "dispose";

export type RunEvent =
	| "prompt_segment_start"
	| "ask_parent"
	| "foreground_child_started"
	| "final_result"
	| "runtime_error"
	| "cancel"
	| "timeout"
	| "answer_received"
	| "child_question"
	| "child_terminal"
	| "shutdown";

const agentTransitions: Partial<Record<AgentState, Partial<Record<AgentEvent, AgentState>>>> = {
	created: { session_ready: "idle" },
	idle: { enqueue_run: "queued", dispose: "disposed" },
	queued: { prompt_segment_start: "running", stop: "stopping" },
	running: {
		ask_parent: "waiting_parent",
		wait_for_child: "waiting_child",
		run_complete: "idle",
		run_fail: "idle",
		runtime_unusable: "error",
		stop: "stopping",
	},
	waiting_parent: { answer_received: "queued", stop: "stopping" },
	waiting_child: { child_event: "queued", stop: "stopping" },
	stopping: { run_complete: "idle", run_fail: "idle", runtime_unusable: "error" },
	error: { enqueue_run: "queued", dispose: "disposed" },
	disposed: {},
};

const runTransitions: Partial<Record<RunState, Partial<Record<RunEvent, RunState>>>> = {
	queued: { prompt_segment_start: "running", cancel: "cancelled", timeout: "timed_out", shutdown: "interrupted" },
	running: {
		ask_parent: "waiting_parent",
		foreground_child_started: "waiting_child",
		final_result: "completed",
		runtime_error: "failed",
		cancel: "cancelled",
		timeout: "timed_out",
		shutdown: "interrupted",
	},
	waiting_parent: { answer_received: "queued", cancel: "cancelled", timeout: "timed_out", shutdown: "interrupted" },
	waiting_child: {
		child_question: "queued",
		child_terminal: "queued",
		cancel: "cancelled",
		timeout: "timed_out",
		shutdown: "interrupted",
	},
	completed: {},
	failed: {},
	cancelled: {},
	timed_out: {},
	interrupted: {},
};

export function transitionAgent(record: AgentRecord, event: AgentEvent, now = new Date().toISOString()): AgentRecord {
	const next = agentTransitions[record.state]?.[event];
	if (!next) throw new InvalidTransitionError(record.id, record.state, event);
	return {
		...record,
		state: next,
		updatedAt: now,
		lastActiveAt: next === "running" ? now : record.lastActiveAt,
		disposedAt: next === "disposed" ? now : record.disposedAt,
	};
}

export function transitionRun(record: RunRecord, event: RunEvent, now = new Date().toISOString()): RunRecord {
	const next = runTransitions[record.state]?.[event];
	if (!next) throw new InvalidTransitionError(record.id, record.state, event);
	const terminal = ["completed", "failed", "cancelled", "timed_out", "interrupted"].includes(next);
	return {
		...record,
		state: next,
		updatedAt: now,
		startedAt: event === "prompt_segment_start" ? (record.startedAt ?? now) : record.startedAt,
		segmentCount: event === "prompt_segment_start" ? record.segmentCount + 1 : record.segmentCount,
		completedAt: terminal ? now : record.completedAt,
	};
}
