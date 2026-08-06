import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Coordinator } from "../coordinator/coordinator.js";
import { formatSpecializedAgentList, type V2AgentDefinition } from "../runtime/agent-definitions.js";
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

export function createAgentTool(
	coordinator: Coordinator,
	agentId: string,
	control?: RunControl,
	abort?: () => void,
	definitions?: ReadonlyMap<string, V2AgentDefinition>,
) {
	const availableAgents = definitions
		? formatSpecializedAgentList(definitions)
		: "Available specialized agents:\n(none configured)";
	return defineTool({
		name: "Agent",
		label: "Agent",
		description: `Create a persistent specialized child agent. Foreground mode yields and resumes automatically.

${availableAgents}

Usage:
- Use "subagent_type" with one of the specialized agent names above.
- Choose the specialized agent whose description best matches the task.
- Provide a clear, detailed "prompt" describing the work.
- Use "run_in_background: true" for independent parallel work; foreground calls yield until completion.
- Treat a foreground Agent call as the final tool call in the batch.

Model and thinking overrides:
- Omit "model" and "thinking" by default.
- Set them only when the user explicitly requests those settings for this specific subagent.
- Do not infer overrides from the task, agent type, or complexity.
- When omitted, the specialized agent definition's configured defaults are used.`,
		promptSnippet: "Spawn a specialized child agent in foreground or background",
		promptGuidelines: [
			"When using foreground mode, treat Agent as a yielding final tool call.",
			"Only set model or thinking when the user explicitly requests an override for that specific subagent.",
		],
		parameters: Type.Object({
			prompt: Type.String({ description: "The task for the specialized agent to perform." }),
			description: Type.String({ description: "A short description of the task shown in the agent UI." }),
			subagent_type: Type.String({ description: "The specialized agent name from the list above." }),
			run_in_background: Type.Optional(
				Type.Boolean({ description: "Run in background and return immediately instead of waiting." }),
			),
			model: Type.Optional(
				Type.String({ description: "Only set when the user explicitly requests a model for this subagent." }),
			),
			thinking: Type.Optional(
				Type.String({
					description: "Only set when the user explicitly requests a thinking level for this subagent.",
				}),
			),
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
