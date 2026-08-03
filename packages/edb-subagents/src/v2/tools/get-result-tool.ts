import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Coordinator } from "../coordinator/coordinator.js";
import type { RunControl } from "../types.js";
import { TERMINAL_RUN_STATES } from "../types.js";
import { markYield } from "./agent-tool.js";

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
				return { content: [{ type: "text", text: JSON.stringify(run) }], details: undefined };
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
