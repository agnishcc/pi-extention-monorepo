import type { CoordinatorSnapshotV1 } from "../types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateSnapshot(value: unknown): value is CoordinatorSnapshotV1 {
	if (!isRecord(value) || value.schemaVersion !== 1) return false;
	if (typeof value.rootSessionId !== "string" || typeof value.cwd !== "string" || !Number.isInteger(value.revision))
		return false;
	if (!isRecord(value.agents) || !isRecord(value.runs) || !isRecord(value.questions) || !isRecord(value.waitLinks))
		return false;
	if (!Array.isArray(value.mailbox) || !Array.isArray(value.outbox) || typeof value.updatedAt !== "string")
		return false;
	return Object.entries(value.agents).every(
		([id, agent]) => isRecord(agent) && agent.id === id && typeof agent.state === "string",
	);
}

export function emptySnapshot(rootSessionId: string, cwd: string): CoordinatorSnapshotV1 {
	return {
		schemaVersion: 1,
		rootSessionId,
		cwd,
		revision: 0,
		agents: {},
		runs: {},
		questions: {},
		waitLinks: {},
		mailbox: [],
		outbox: [],
		updatedAt: new Date().toISOString(),
	};
}
