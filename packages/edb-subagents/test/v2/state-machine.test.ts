import { describe, expect, it } from "vitest";
import { transitionAgent, transitionRun } from "../../src/v2/coordinator/state-machine.js";
import { InvalidTransitionError } from "../../src/v2/errors.js";
import type { AgentRecord, RunRecord } from "../../src/v2/types.js";

const timestamp = "2026-01-01T00:00:00.000Z";

function agent(state: AgentRecord["state"]): AgentRecord {
	return {
		id: "agt_test",
		parentAgentId: "root",
		createdByRunId: null,
		type: "coder",
		displayName: "Coder",
		sessionFile: null,
		cwd: "/tmp",
		state,
		currentRunId: null,
		childAgentIds: [],
		toolProfile: "coder",
		createdAt: timestamp,
		updatedAt: timestamp,
		lastActiveAt: null,
		disposedAt: null,
	};
}

function run(state: RunRecord["state"]): RunRecord {
	return {
		id: "run_test",
		agentId: "agt_test",
		parentRunId: null,
		requestedByAgentId: "root",
		taskId: null,
		mode: "foreground",
		state,
		prompt: "test",
		segmentCount: 0,
		waitingOnRunIds: [],
		pendingQuestionId: null,
		taskSyncPending: false,
		createdAt: timestamp,
		startedAt: null,
		updatedAt: timestamp,
		completedAt: null,
	};
}

describe("V2 state machines", () => {
	it("follows the foreground agent lifecycle without mutating inputs", () => {
		const created = agent("created");
		const idle = transitionAgent(created, "session_ready");
		const queued = transitionAgent(idle, "enqueue_run");
		const running = transitionAgent(queued, "prompt_segment_start");
		const waiting = transitionAgent(running, "wait_for_child");
		const resumed = transitionAgent(waiting, "child_event");
		expect(resumed.state).toBe("queued");
		expect(created.state).toBe("created");
	});

	it("preserves a logical run across question wait and resume", () => {
		const queued = run("queued");
		const running = transitionRun(queued, "prompt_segment_start");
		const waiting = transitionRun(running, "ask_parent");
		const resumed = transitionRun(waiting, "answer_received");
		expect(resumed.state).toBe("queued");
		expect(resumed.segmentCount).toBe(1);
		expect(resumed.completedAt).toBeNull();
	});

	it("makes terminal runs immutable", () => {
		const completed = run("completed");
		expect(() => transitionRun(completed, "prompt_segment_start")).toThrow(InvalidTransitionError);
		expect(completed.state).toBe("completed");
	});

	it("returns a typed side-effect-free invalid transition", () => {
		const idle = agent("idle");
		try {
			transitionAgent(idle, "answer_received");
			throw new Error("expected transition to fail");
		} catch (error) {
			expect(error).toBeInstanceOf(InvalidTransitionError);
			expect((error as InvalidTransitionError).details).toEqual({
				entityId: "agt_test",
				currentState: "idle",
				event: "answer_received",
			});
		}
		expect(idle.state).toBe("idle");
	});
});
