import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

// ── Tool schemas ───────────────────────────────────────────────────────────────

export const TaskSchema = Type.Object({
	id: Type.Optional(
		Type.String({
			description:
				"Unique task ID. Omit to auto-generate. " +
				"When updating existing tasks use their current ID to preserve identity.",
		}),
	),
	content: Type.String({
		description: "Clear, actionable task description.",
	}),
	status: StringEnum(["pending", "in_progress", "completed"] as const, {
		description:
			"Task status. " +
			"Set to 'in_progress' for the task you are actively working on right now. " +
			"Only one task should be 'in_progress' at a time unless tasks are genuinely parallel.",
	}),
	priority: StringEnum(["high", "medium", "low"] as const, {
		description: "Task priority.",
	}),
});

export const TodoWriteParams = Type.Object({
	tasks: Type.Array(TaskSchema, {
		description:
			"The COMPLETE, updated task list. " +
			"This REPLACES the current list entirely — always include ALL tasks, " +
			"both updated ones and unchanged ones.",
	}),
});
