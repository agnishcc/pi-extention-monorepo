import type { AgentId, RunId } from "../types.js";

interface QueueItem {
	runId: RunId;
	agentId: AgentId;
	parentAgentId: AgentId;
	priority: number;
	createdAt: number;
	run: () => Promise<void>;
}

export class RunQueue {
	private queue: QueueItem[] = [];
	private active = 0;
	private activeByParent = new Map<AgentId, number>();
	private stopped = false;
	private idleWaiters: Array<() => void> = [];

	constructor(
		private readonly maxConcurrent: number,
		private readonly maxPerParent: number,
		private readonly agingMs = 60_000,
	) {}

	enqueue(item: Omit<QueueItem, "createdAt">): void {
		if (this.stopped) throw new Error("Run queue is stopped");
		if (this.queue.some((queued) => queued.runId === item.runId)) return;
		this.queue.push({ ...item, createdAt: Date.now() });
		this.drain();
	}

	cancel(runId: RunId): boolean {
		const index = this.queue.findIndex((item) => item.runId === runId);
		if (index < 0) return false;
		this.queue.splice(index, 1);
		return true;
	}

	stop(): void {
		this.stopped = true;
		this.queue = [];
		this.resolveIdleWaiters();
	}

	whenIdle(): Promise<void> {
		if (this.active === 0) return Promise.resolve();
		return new Promise((resolve) => this.idleWaiters.push(resolve));
	}

	get activeCount(): number {
		return this.active;
	}

	get queuedCount(): number {
		return this.queue.length;
	}

	private drain(): void {
		while (!this.stopped && this.active < this.maxConcurrent) {
			const now = Date.now();
			this.queue.sort((left, right) => {
				const leftPriority = left.priority - Math.floor((now - left.createdAt) / this.agingMs);
				const rightPriority = right.priority - Math.floor((now - right.createdAt) / this.agingMs);
				return leftPriority - rightPriority || left.createdAt - right.createdAt;
			});
			const index = this.queue.findIndex(
				(item) => (this.activeByParent.get(item.parentAgentId) ?? 0) < this.maxPerParent,
			);
			if (index < 0) return;
			const item = this.queue.splice(index, 1)[0]!;
			this.active++;
			this.activeByParent.set(item.parentAgentId, (this.activeByParent.get(item.parentAgentId) ?? 0) + 1);
			void item
				.run()
				.catch((error) => {
					console.error(`[edb-subagents-v2] Queued run ${item.runId} failed:`, error);
				})
				.finally(() => {
					this.active--;
					const parentActive = (this.activeByParent.get(item.parentAgentId) ?? 1) - 1;
					if (parentActive === 0) this.activeByParent.delete(item.parentAgentId);
					else this.activeByParent.set(item.parentAgentId, parentActive);
					this.resolveIdleWaiters();
					this.drain();
				});
		}
	}

	private resolveIdleWaiters(): void {
		if (this.active !== 0) return;
		for (const resolve of this.idleWaiters.splice(0)) resolve();
	}
}
