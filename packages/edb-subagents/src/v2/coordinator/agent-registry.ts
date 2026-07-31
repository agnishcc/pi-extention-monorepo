import { randomUUID } from "node:crypto";
import { EntityNotFoundError } from "../errors.js";
import type { AgentId, AgentRecord, RunId, RunRecord } from "../types.js";

export function createId(prefix: "agt" | "run" | "qst" | "msg" | "wait" | "op" | "evt"): string {
	return `${prefix}_${randomUUID()}`;
}

export class AgentRegistry {
	readonly agents = new Map<AgentId, AgentRecord>();
	readonly runs = new Map<RunId, RunRecord>();

	constructor(records?: { agents?: AgentRecord[]; runs?: RunRecord[] }) {
		for (const agent of records?.agents ?? []) this.agents.set(agent.id, structuredClone(agent));
		for (const run of records?.runs ?? []) this.runs.set(run.id, structuredClone(run));
	}

	getAgent(id: AgentId): AgentRecord {
		const record = this.agents.get(id);
		if (!record) throw new EntityNotFoundError("Agent", id);
		return record;
	}

	getRun(id: RunId): RunRecord {
		const record = this.runs.get(id);
		if (!record) throw new EntityNotFoundError("Run", id);
		return record;
	}

	setAgent(record: AgentRecord): void {
		this.agents.set(record.id, record);
	}

	setRun(record: RunRecord): void {
		this.runs.set(record.id, record);
	}

	children(parentId: AgentId): AgentRecord[] {
		return [...this.agents.values()].filter((agent) => agent.parentAgentId === parentId);
	}

	descendants(parentId: AgentId): AgentRecord[] {
		const result: AgentRecord[] = [];
		const queue = this.children(parentId);
		while (queue.length > 0) {
			const next = queue.shift()!;
			result.push(next);
			queue.push(...this.children(next.id));
		}
		return result;
	}

	depth(agentId: AgentId): number {
		let current = this.getAgent(agentId);
		let depth = 0;
		while (current.parentAgentId) {
			depth++;
			current = this.getAgent(current.parentAgentId);
		}
		return depth;
	}
}
