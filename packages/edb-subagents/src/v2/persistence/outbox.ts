import type { OperationId, OutboxOperation } from "../types.js";

export type OutboxDelivery = (operation: OutboxOperation) => Promise<void>;

export class DurableOutbox {
	private operations = new Map<OperationId, OutboxOperation>();
	private timer: ReturnType<typeof setTimeout> | undefined;
	private running = false;
	private disposed = false;

	constructor(
		operations: OutboxOperation[],
		private readonly deliver: OutboxDelivery,
		private readonly persist: () => Promise<void>,
		private readonly maxAttempts = 10,
	) {
		for (const operation of operations) this.operations.set(operation.id, structuredClone(operation));
	}

	add(operation: OutboxOperation, schedule = true): boolean {
		if (this.operations.has(operation.id)) return false;
		this.operations.set(operation.id, operation);
		if (schedule) this.schedule(0);
		return true;
	}

	start(): void {
		this.schedule(0);
	}

	all(): OutboxOperation[] {
		return [...this.operations.values()];
	}

	private schedule(delayMs: number): void {
		if (this.disposed || this.timer) return;
		this.timer = setTimeout(() => {
			this.timer = undefined;
			void this.process().catch((error) => {
				console.error("[edb-subagents-v2] Outbox processing failed:", error);
				this.schedule(250);
			});
		}, delayMs);
	}

	private async process(): Promise<void> {
		if (this.running || this.disposed) return;
		this.running = true;
		try {
			const now = Date.now();
			const pending = this.all()
				.filter(
					(operation) =>
						(operation.state === "pending" || operation.state === "delivering") &&
						Date.parse(operation.nextAttemptAt) <= now,
				)
				.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
			for (const operation of pending) {
				operation.state = "delivering";
				operation.attempts++;
				await this.persist();
				try {
					await this.deliver(operation);
					operation.state = "delivered";
					operation.deliveredAt = new Date().toISOString();
					operation.lastError = undefined;
				} catch (error) {
					operation.lastError = error instanceof Error ? error.message : String(error);
					if (operation.attempts >= this.maxAttempts) operation.state = "failed";
					else {
						operation.state = "pending";
						const base = Math.min(30_000, 250 * 2 ** (operation.attempts - 1));
						operation.nextAttemptAt = new Date(Date.now() + base + Math.floor(Math.random() * 100)).toISOString();
					}
				}
				await this.persist();
			}
		} finally {
			this.running = false;
			if (this.all().some((operation) => operation.state === "pending")) this.schedule(250);
		}
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		if (this.timer) clearTimeout(this.timer);
		this.timer = undefined;
		while (this.running) await new Promise((resolve) => setTimeout(resolve, 5));
	}
}
