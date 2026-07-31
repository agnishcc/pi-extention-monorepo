import type { AgentId, AgentRecord, AgentRuntime, RuntimeFactory } from "../types.js";

interface Entry {
	runtime: AgentRuntime;
	lastUsedAt: number;
	state: AgentRecord["state"];
}

export class RuntimePool {
	private entries = new Map<AgentId, Entry>();
	private timer: ReturnType<typeof setInterval>;

	constructor(
		private readonly factory: RuntimeFactory,
		private readonly idleEvictionMs: number,
	) {
		this.timer = setInterval(
			() => {
				void this.evictIdle().catch((error) => {
					console.error("[edb-subagents-v2] Runtime eviction failed:", error);
				});
			},
			Math.min(idleEvictionMs, 60_000),
		);
		this.timer.unref?.();
	}

	async get(agent: AgentRecord): Promise<AgentRuntime> {
		let entry = this.entries.get(agent.id);
		if (!entry) {
			entry = { runtime: this.factory(agent), lastUsedAt: Date.now(), state: agent.state };
			this.entries.set(agent.id, entry);
		}
		entry.lastUsedAt = Date.now();
		entry.state = agent.state;
		await entry.runtime.load(agent);
		return entry.runtime;
	}

	touch(agent: AgentRecord): void {
		const entry = this.entries.get(agent.id);
		if (entry) {
			entry.lastUsedAt = Date.now();
			entry.state = agent.state;
		}
	}

	private async evictIdle(): Promise<void> {
		const cutoff = Date.now() - this.idleEvictionMs;
		for (const [id, entry] of this.entries) {
			if (entry.state !== "idle" || entry.lastUsedAt > cutoff) continue;
			await entry.runtime.unload();
			this.entries.delete(id);
		}
	}

	async dispose(agentId?: AgentId): Promise<void> {
		if (agentId) {
			const entry = this.entries.get(agentId);
			if (entry) await entry.runtime.dispose();
			this.entries.delete(agentId);
			return;
		}
		clearInterval(this.timer);
		await Promise.all([...this.entries.values()].map((entry) => entry.runtime.dispose()));
		this.entries.clear();
	}
}
