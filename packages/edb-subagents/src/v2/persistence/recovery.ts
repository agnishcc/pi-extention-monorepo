import { transitionAgent, transitionRun } from "../coordinator/state-machine.js";
import type { CoordinatorSnapshotV1 } from "../types.js";

export interface RecoverySummary {
	interruptedRunIds: string[];
	preservedQuestionIds: string[];
	reconciledWaitLinkIds: string[];
}

export function reconcileSnapshot(snapshot: CoordinatorSnapshotV1): RecoverySummary {
	const now = new Date().toISOString();
	const summary: RecoverySummary = { interruptedRunIds: [], preservedQuestionIds: [], reconciledWaitLinkIds: [] };
	for (const run of Object.values(snapshot.runs)) {
		if (run.state === "running" || run.state === "queued") {
			const interrupted = transitionRun(run, "shutdown", now);
			interrupted.stopReason = "shutdown";
			snapshot.runs[run.id] = interrupted;
			summary.interruptedRunIds.push(run.id);
			const agent = snapshot.agents[run.agentId];
			if (agent && (agent.state === "queued" || agent.state === "running")) {
				const stopping = transitionAgent(agent, "stop", now);
				snapshot.agents[agent.id] = { ...transitionAgent(stopping, "run_fail", now), currentRunId: null };
			}
		}
	}
	for (const question of Object.values(snapshot.questions)) {
		if (question.state === "open" || question.state === "escalated") summary.preservedQuestionIds.push(question.id);
	}
	for (const link of Object.values(snapshot.waitLinks)) {
		if (link.state !== "waiting") continue;
		const child = snapshot.runs[link.childRunId];
		if (!child || child.state === "interrupted") {
			link.state = "cancelled";
			link.updatedAt = now;
			summary.reconciledWaitLinkIds.push(link.id);
		}
	}
	return summary;
}
