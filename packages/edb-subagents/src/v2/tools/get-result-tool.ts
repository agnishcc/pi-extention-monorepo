import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Coordinator } from "../coordinator/coordinator.js";
import type { RunControl, RunRecord } from "../types.js";
import { TERMINAL_RUN_STATES } from "../types.js";
import { markYield } from "./agent-tool.js";

/**
 * Model-facing view of a run: the fields the caller decides with, nothing more.
 * Internal metadata (usage array, echoed prompt, wait bookkeeping, timestamps)
 * stays out of the model's context — it is persisted and emitted separately
 * (state.json, subagents:usage events → Postgres).
 */
function runSummary(run: RunRecord): Record<string, unknown> {
	const summary: Record<string, unknown> = {
		id: run.id,
		agentId: run.agentId,
		state: run.state,
		segmentCount: run.segmentCount,
		mode: run.mode,
	};
	if (run.result) summary.result = run.result;
	if (run.error) summary.error = run.error;
	if (run.stopReason) summary.stopReason = run.stopReason;
	if (run.usage?.length) {
		const totals = run.usage.reduce(
			(acc, u) => {
				acc.input += u.input;
				acc.output += u.output;
				acc.cacheRead += u.cacheRead;
				acc.cacheWrite += u.cacheWrite;
				return acc;
			},
			{ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		);
		summary.usage = `tokens: ${totals.input.toLocaleString()} in · ${totals.output.toLocaleString()} out · ${totals.cacheRead.toLocaleString()} cacheRead · ${totals.cacheWrite.toLocaleString()} cacheWrite (${run.usage.length} turns)`;
	}
	return summary;
}

export function createGetResultTool(
	coordinator: Coordinator,
	agentId: string,
	control?: RunControl,
	abort?: () => void,
) {
	return defineTool({
		name: "get_subagent_result",
		label: "Get subagent result",
		description: "Inspect a child run, or logically wait for it without holding a prompt permit.",
		parameters: Type.Object({
			agent_id: Type.String(),
			run_id: Type.Optional(Type.String()),
			wait: Type.Optional(Type.Boolean()),
			include_transcript: Type.Optional(Type.Boolean()),
		}),
		async execute(_id, params, signal) {
			const caller = coordinator.caller(agentId, signal ?? new AbortController().signal);
			const agent = coordinator.getAgent(caller, params.agent_id);
			const runId = params.run_id ?? agent.currentRunId;
			if (!runId) throw new Error(`Agent ${agent.id} has no run`);
			const run = coordinator.getRun(caller, runId);
			if (TERMINAL_RUN_STATES.has(run.state) || !params.wait) {
				return { content: [{ type: "text", text: JSON.stringify(runSummary(run)) }], details: undefined };
			}
			const link = await coordinator.registerWait(caller, run.id);
			markYield(control, "child_wait", link.id, abort);
			const receipt = {
				status: "waiting",
				agentId: run.agentId,
				runId: run.id,
				waitLinkId: link.id,
				resume: "automatic",
			};
			return { content: [{ type: "text", text: JSON.stringify(receipt) }], details: undefined, terminate: true };
		},
	});
}
