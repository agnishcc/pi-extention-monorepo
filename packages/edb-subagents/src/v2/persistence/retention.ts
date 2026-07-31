import type { CoordinatorSnapshotV1 } from "../types.js";

export function applyRetention(snapshot: CoordinatorSnapshotV1, retentionDays: number, maxTerminalRuns = 200): void {
	const cutoff = Date.now() - retentionDays * 86_400_000;
	const activeRunIds = new Set(
		Object.values(snapshot.runs)
			.filter((run) => !run.completedAt)
			.map((run) => run.id),
	);
	const terminal = Object.values(snapshot.runs)
		.filter((run) => run.completedAt)
		.sort((left, right) => right.completedAt!.localeCompare(left.completedAt!));
	for (const run of terminal.slice(maxTerminalRuns)) {
		if (Date.parse(run.completedAt!) < cutoff && !activeRunIds.has(run.id)) delete snapshot.runs[run.id];
	}
	const terminalMessages = snapshot.mailbox
		.filter((message) => ["delivered", "consumed", "failed"].includes(message.state))
		.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
	const keepTerminalMessages = new Set(terminalMessages.slice(0, 500).map((message) => message.id));
	snapshot.mailbox = snapshot.mailbox.filter(
		(message) => !["delivered", "consumed", "failed"].includes(message.state) || keepTerminalMessages.has(message.id),
	);
	const terminalOperations = snapshot.outbox
		.filter((operation) => operation.state === "delivered" || operation.state === "failed")
		.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
	const keepTerminalOperations = new Set(terminalOperations.slice(0, 500).map((operation) => operation.id));
	snapshot.outbox = snapshot.outbox.filter(
		(operation) =>
			(operation.state !== "delivered" && operation.state !== "failed") || keepTerminalOperations.has(operation.id),
	);
}
