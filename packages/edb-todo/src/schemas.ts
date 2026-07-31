import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

// ── Single-task fields (shared between top-level and tasks[] items) ────────────

const TaskItemSchema = Type.Object({
	content: Type.String({
		description: "A brief, actionable title in imperative form (e.g., 'Fix authentication bug in login flow').",
	}),
	description: Type.Optional(
		Type.String({
			description: "Detailed description of what needs to be done, including context and acceptance criteria.",
		}),
	),
	priority: Type.Optional(
		StringEnum(["high", "medium", "low"] as const, { description: "Task priority. Defaults to 'medium'." }),
	),
	activeForm: Type.Optional(
		Type.String({
			description:
				"Present continuous form shown in the spinner when in_progress (e.g., 'Fixing authentication bug').",
		}),
	),
	parentId: Type.Optional(
		Type.String({
			description: "Parent task ID. Creates this as a subtask of the specified task.",
		}),
	),
	groupId: Type.Optional(
		Type.String({
			description:
				"Parallel group ID. Tasks with the same groupId run concurrently. " +
				"A task with blockedByGroup pointing to this groupId starts only when ALL group tasks complete.",
		}),
	),
	metadata: Type.Optional(
		Type.Record(Type.String(), Type.Any(), { description: "Arbitrary key-value metadata to attach to the task." }),
	),
});

// ── TaskCreate schema ──────────────────────────────────────────────────────────

export const TodoCreateParams = Type.Object({
	// ── Batch mode: pass tasks[] to create multiple tasks in one call ──────────
	tasks: Type.Optional(
		Type.Array(TaskItemSchema, {
			description:
				"Create multiple tasks at once. When provided, all top-level single-task fields are ignored. " +
				"Prefer this over calling TaskCreate multiple times.",
		}),
	),
	// ── Single-task fields (used when tasks[] is absent) ──────────────────────
	content: Type.Optional(
		Type.String({
			description: "A brief, actionable title in imperative form (e.g., 'Fix authentication bug in login flow').",
		}),
	),
	description: Type.Optional(
		Type.String({
			description: "Detailed description of what needs to be done, including context and acceptance criteria.",
		}),
	),
	priority: Type.Optional(
		StringEnum(["high", "medium", "low"] as const, { description: "Task priority. Defaults to 'medium'." }),
	),
	activeForm: Type.Optional(
		Type.String({
			description:
				"Present continuous form shown in the spinner when in_progress (e.g., 'Fixing authentication bug').",
		}),
	),
	parentId: Type.Optional(
		Type.String({
			description: "Parent task ID. Creates this as a subtask of the specified task.",
		}),
	),
	groupId: Type.Optional(
		Type.String({
			description:
				"Parallel group ID. Tasks with the same groupId run concurrently. " +
				"A task with blockedByGroup pointing to this groupId starts only when ALL group tasks complete.",
		}),
	),
	metadata: Type.Optional(
		Type.Record(Type.String(), Type.Any(), { description: "Arbitrary key-value metadata to attach to the task." }),
	),
});

// ── TaskGet schema ─────────────────────────────────────────────────────────────

export const TodoGetParams = Type.Object({
	id: Type.String({ description: "The task ID to retrieve." }),
});

// ── TaskUpdate schema ──────────────────────────────────────────────────────────

export const TodoUpdateParams = Type.Object({
	id: Type.String({ description: "The ID of the task to update." }),
	status: Type.Optional(
		Type.Unsafe<"pending" | "in_progress" | "completed" | "blocked" | "failed" | "cancelled" | "deleted">({
			type: "string",
			enum: ["pending", "in_progress", "completed", "blocked", "failed", "cancelled", "deleted"],
			description:
				"New status. Use 'deleted' to permanently remove the task. " +
				"Use 'blocked' when the task is waiting for an answer from the supervisor (set blockQuestion too). " +
				"Use 'failed' when work errors or times out, and 'cancelled' when it is explicitly stopped.",
		}),
	),
	content: Type.Optional(Type.String({ description: "New task title." })),
	description: Type.Optional(Type.String({ description: "New task description." })),
	priority: Type.Optional(StringEnum(["high", "medium", "low"] as const, { description: "New priority." })),
	activeForm: Type.Optional(Type.String({ description: "Spinner text shown when in_progress." })),
	owner: Type.Optional(Type.String({ description: "Owner / agent name." })),
	blockQuestion: Type.Optional(
		Type.String({ description: "Question text when setting status to 'blocked' (waiting for supervisor answer)." }),
	),
	blockedByGroup: Type.Optional(
		Type.String({
			description: "Group ID to wait for. Task starts only when ALL tasks in this group are completed.",
		}),
	),
	metadata: Type.Optional(
		Type.Record(Type.String(), Type.Any(), { description: "Metadata to merge. Set a key to null to delete it." }),
	),
	addBlocks: Type.Optional(
		Type.Array(Type.String(), { description: "Task IDs that this task blocks (bidirectional)." }),
	),
	addBlockedBy: Type.Optional(
		Type.Array(Type.String(), { description: "Task IDs that block this task (bidirectional)." }),
	),
});

// ── Kept for backward compat (unused internally but may be imported by tests) ──

export const TodoRemoveParams = Type.Object({
	ids: Type.Array(Type.String(), { description: "Task IDs to remove from the list permanently." }),
});
