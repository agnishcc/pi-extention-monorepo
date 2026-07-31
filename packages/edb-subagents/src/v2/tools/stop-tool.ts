import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Coordinator } from "../coordinator/coordinator.js";

export function createStopTool(coordinator: Coordinator, agentId: string) {
	return defineTool({
		name: "stop_subagent",
		label: "Stop subagent",
		description: "Cancel a child and all of its active descendants without completing linked tasks.",
		parameters: Type.Object({ agent_id: Type.String(), reason: Type.Optional(Type.String()) }),
		async execute(_id, params, signal) {
			await coordinator.stop(
				coordinator.caller(agentId, signal ?? new AbortController().signal),
				params.agent_id,
				params.reason,
			);
			return { content: [{ type: "text", text: `Stopped ${params.agent_id}` }], details: {} };
		},
	});
}
