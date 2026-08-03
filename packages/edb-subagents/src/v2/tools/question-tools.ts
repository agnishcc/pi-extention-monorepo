import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Coordinator } from "../coordinator/coordinator.js";
import type { RunControl } from "../types.js";
import { markYield } from "./agent-tool.js";

export function createQuestionTools(
	coordinator: Coordinator,
	agentId: string,
	control?: RunControl,
	abort?: () => void,
): ToolDefinition[] {
	const ask = defineTool({
		name: "ask_parent",
		label: "Ask parent",
		description: "Ask the direct parent a question and yield until its answer resumes this run.",
		promptGuidelines: ["ask_parent is yielding and must be the final and sole tool call in its batch."],
		parameters: Type.Object({
			question: Type.String(),
			for_question_id: Type.Optional(Type.String()),
			task_id: Type.Optional(Type.String()),
			timeout_ms: Type.Optional(Type.Number({ minimum: 1 })),
		}),
		async execute(_id, params, signal) {
			const result = await coordinator.askParent(
				coordinator.caller(agentId, signal ?? new AbortController().signal),
				params,
			);
			const questionId = "id" in result ? result.id : result.questionId;
			if (agentId !== "root" && "id" in result) markYield(control, "question", questionId, abort);
			return {
				content: [{ type: "text", text: JSON.stringify(result) }],
				details: result,
				terminate: agentId !== "root" && "id" in result,
			};
		},
	});
	const answer = defineTool({
		name: "answer_child",
		label: "Answer child",
		description: "Answer an open direct-child question and resume the same child run.",
		parameters: Type.Object({
			question_id: Type.String(),
			answer: Type.String(),
			detach: Type.Optional(Type.Boolean()),
		}),
		async execute(_id, params, signal) {
			const result = await coordinator.answerChild(
				coordinator.caller(agentId, signal ?? new AbortController().signal),
				params,
			);
			if (result.waitLinkId) markYield(control, "child_wait", result.waitLinkId, abort);
			return {
				content: [{ type: "text", text: JSON.stringify(result) }],
				details: result,
				terminate: Boolean(result.waitLinkId),
			};
		},
	});
	return [ask, answer];
}
