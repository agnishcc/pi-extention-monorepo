import { describe, expect, it } from "vitest";
import { AgentRegistry } from "../../src/v2/coordinator/agent-registry.js";
import { Mailbox } from "../../src/v2/coordinator/mailbox.js";
import { assertCanManage } from "../../src/v2/coordinator/permissions.js";
import { RunQueue } from "../../src/v2/coordinator/run-queue.js";
import type { AgentRecord, MailboxMessage } from "../../src/v2/types.js";

function agent(id: string, parentAgentId: string | null): AgentRecord {
	return {
		id,
		parentAgentId,
		createdByRunId: null,
		type: "coder",
		displayName: id,
		sessionFile: null,
		cwd: "/tmp",
		state: "idle",
		currentRunId: null,
		childAgentIds: [],
		toolProfile: "coder",
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		lastActiveAt: null,
		disposedAt: null,
	};
}

describe("coordinator primitives", () => {
	it("enforces root, descendant, sibling, and ancestor permissions", () => {
		const registry = new AgentRegistry({
			agents: [agent("root", null), agent("a", "root"), agent("b", "a"), agent("sibling", "root")],
		});
		expect(() => assertCanManage(registry, "root", "b")).not.toThrow();
		expect(() => assertCanManage(registry, "a", "b")).not.toThrow();
		expect(() => assertCanManage(registry, "b", "a")).toThrow();
		expect(() => assertCanManage(registry, "a", "sibling")).toThrow();
	});

	it("prioritizes stop and questions while deduplicating messages", () => {
		const mailbox = new Mailbox();
		const make = (
			id: string,
			kind: MailboxMessage["kind"],
			priority: MailboxMessage["priority"],
		): MailboxMessage => ({
			id,
			recipientAgentId: "a",
			senderAgentId: "coordinator",
			kind,
			priority,
			payload: {},
			state: "pending",
			createdAt: `${priority}`,
			deliveredAt: null,
		});
		expect(mailbox.push(make("msg_followup", "followup", 3))).toBe(true);
		expect(mailbox.push(make("msg_question", "child_question", 1))).toBe(true);
		expect(mailbox.push(make("msg_stop", "stop", 0))).toBe(true);
		expect(mailbox.push(make("msg_stop", "stop", 0))).toBe(false);
		expect(mailbox.pending("a").map((message) => message.id)).toEqual(["msg_stop", "msg_question", "msg_followup"]);
	});

	it("holds one permit per active segment and releases it on yield", async () => {
		const queue = new RunQueue(1, 1);
		const order: string[] = [];
		let active = 0;
		let maxActive = 0;
		const finished = Promise.withResolvers<void>();
		for (const id of ["one", "two", "three"]) {
			queue.enqueue({
				runId: id,
				agentId: id,
				parentAgentId: "root",
				priority: 2,
				async run() {
					active++;
					maxActive = Math.max(maxActive, active);
					order.push(id);
					await Promise.resolve();
					active--;
					if (order.length === 3) finished.resolve();
				},
			});
		}
		await finished.promise;
		expect(maxActive).toBe(1);
		expect(order).toEqual(["one", "two", "three"]);
	});
});
