/**
 * Live per-agent activity observed from the child session's event stream.
 * Feeds the "steps" line in the V2 agent widget (ported from V1's activity
 * descriptions: which tool the child is running, its latest response text,
 * turn/tool counts, and tokens consumed so far).
 */

export interface LiveActivity {
	/** Tool names currently executing (parallel calls supported). */
	tools: Set<string>;
	/** Latest assistant response text (bounded at write time). */
	text: string;
	/** Completed tool executions in the current run. */
	toolUses: number;
	/** Completed turns in the current run. */
	turns: number;
	/** Token total (input + output + cacheWrite) captured so far this run. */
	tokens: number;
}

export class ActivityBoard {
	readonly byAgent = new Map<string, LiveActivity>();

	/** Reset the entry for a new run; returns the fresh entry. */
	reset(agentId: string): LiveActivity {
		const entry: LiveActivity = { tools: new Set(), text: "", toolUses: 0, turns: 0, tokens: 0 };
		this.byAgent.set(agentId, entry);
		return entry;
	}

	/** Get or create the entry for an agent. */
	entry(agentId: string): LiveActivity {
		let entry = this.byAgent.get(agentId);
		if (!entry) entry = this.reset(agentId);
		return entry;
	}

	delete(agentId: string): void {
		this.byAgent.delete(agentId);
	}
}
