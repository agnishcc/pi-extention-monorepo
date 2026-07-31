import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Coordinator } from "../coordinator/coordinator.js";

export function createSteerTool(coordinator: Coordinator, agentId: string) {
	return defineTool({
		name: "steer_subagent",
		label: "Steer subagent",
		description: "Steer a currently running direct child at Pi's safe tool boundary.",
		parameters: Type.Object({ agent_id: Type.String(), message: Type.String() }),
		async execute(_id, params, signal) {
			await coordinator.steer(
				coordinator.caller(agentId, signal ?? new AbortController().signal),
				params.agent_id,
				params.message,
			);
			return { content: [{ type: "text", text: `Steering sent to ${params.agent_id}` }], details: {} };
		},
	});
}
