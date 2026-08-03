import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Coordinator } from "../coordinator/coordinator.js";
import type { RunControl } from "../types.js";
import { markYield } from "./agent-tool.js";

export function createSendTool(coordinator: Coordinator, agentId: string, control?: RunControl, abort?: () => void) {
	return defineTool({
		name: "send_to_agent",
		label: "Send to agent",
		description: "Create a follow-up run on an idle persistent child session.",
		parameters: Type.Object({
			agent_id: Type.String(),
			text: Type.String(),
			run_in_background: Type.Optional(Type.Boolean()),
		}),
		async execute(_id, params, signal) {
			const caller = coordinator.caller(agentId, signal ?? new AbortController().signal);
			const receipt = await coordinator.sendFollowup(
				caller,
				params.agent_id,
				params.text,
				!params.run_in_background,
			);
			if (!params.run_in_background) {
				const link = await coordinator.registerWait(caller, receipt.runId);
				receipt.status = "waiting";
				receipt.waitLinkId = link.id;
				markYield(control, "child_wait", link.id, abort);
				coordinator.startQueuedRun(receipt.runId);
			}
			return {
				content: [{ type: "text", text: JSON.stringify(receipt) }],
				details: receipt,
				terminate: receipt.status === "waiting",
			};
		},
	});
}
