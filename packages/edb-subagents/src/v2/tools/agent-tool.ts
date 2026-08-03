import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Coordinator } from "../coordinator/coordinator.js";
import type { RunControl } from "../types.js";

export function markYield(
	control: RunControl | undefined,
	reason: "question" | "child_wait",
	entityId: string,
	abort: (() => void) | undefined,
): void {
	if (!control) return;
	control.requestedYield = { reason, entityId };
	if (control.requiresControlledAbort) {
		control.abortReason = reason === "question" ? "suspend_for_question" : "suspend_for_child";
		abort?.();
	}
}

export function createAgentTool(coordinator: Coordinator, agentId: string, control?: RunControl, abort?: () => void) {
	return defineTool({
		name: "Agent",
		label: "Agent",
		description: "Create a persistent recursive child agent. Foreground mode yields and resumes automatically.",
		promptSnippet: "Spawn a recursive child agent in foreground or background",
		promptGuidelines: ["When using foreground mode, treat Agent as a yielding final tool call."],
		parameters: Type.Object({
			prompt: Type.String(),
			description: Type.String(),
			subagent_type: Type.String(),
			run_in_background: Type.Optional(Type.Boolean()),
			model: Type.Optional(Type.String()),
			thinking: Type.Optional(Type.String()),
			max_turns: Type.Optional(Type.Number({ minimum: 1 })),
			task_id: Type.Optional(Type.String()),
			agent_name: Type.Optional(Type.String()),
		}),
		async execute(_id, params, signal) {
			const receipt = await coordinator.spawn(
				coordinator.caller(agentId, signal ?? new AbortController().signal),
				params,
			);
			if (receipt.status === "waiting") markYield(control, "child_wait", receipt.waitLinkId!, abort);
			return {
				content: [{ type: "text", text: JSON.stringify(receipt) }],
				details: receipt,
				terminate: receipt.status === "waiting",
			};
		},
	});
}
