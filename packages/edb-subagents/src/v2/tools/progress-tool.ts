import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Coordinator } from "../coordinator/coordinator.js";

export function createProgressTool(coordinator: Coordinator, agentId: string) {
	return defineTool({
		name: "report_progress",
		label: "Report progress",
		description: "Record a bounded meaningful progress milestone for the parent.",
		parameters: Type.Object({ message: Type.String(), task_id: Type.Optional(Type.String()) }),
		async execute(_id, params, signal) {
			await coordinator.reportProgress(coordinator.caller(agentId, signal ?? new AbortController().signal), params);
			return { content: [{ type: "text", text: "Progress recorded" }], details: {} };
		},
	});
}
