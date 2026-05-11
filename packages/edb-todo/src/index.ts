/**
 * edb-todo
 *
 * Task management extension that prevents "goal drift" — the tendency for
 * agents to lose track of the original plan as context grows.
 *
 * How it works:
 *   1. The agent uses `todo_write` to plan multi-step work as structured tasks
 *   2. Before every agent turn, active tasks are injected into the system prompt
 *   3. A live widget above the editor shows the task list to the user
 *   4. State is stored in tool-result details and reconstructed from the session
 *      branch, so /tree navigation and forking work correctly
 *
 * Tools:   todo_write   — replace the entire task list (atomic update)
 *          todo_read    — read the current task list
 *          todo_remove  — remove tasks by ID (permanent deletion)
 * Command: /todos       — open interactive full-screen task viewer
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { TodoViewComponent } from "./component";
import { buildSystemPromptBlock, formatListForLLM } from "./prompt";
import { TodoRemoveParams, TodoWriteParams } from "./schemas";
import { reconstructState, store, updateWidget } from "./state";
import type { TaskDetails, TaskPriority, TaskStatus } from "./types";

// ── Extension ──────────────────────────────────────────────────────────────────

export default function todoExtension(pi: ExtensionAPI): void {
	// ── Session lifecycle ──────────────────────────────────────────────────
	pi.on("session_start", async (_event, ctx) => {
		reconstructState(ctx);
		updateWidget(ctx);
	});

	pi.on("session_tree", async (_event, ctx) => {
		reconstructState(ctx);
		updateWidget(ctx);
	});

	// ── System-prompt injection ────────────────────────────────────────────
	pi.on("before_agent_start", async (event, _ctx) => {
		const block = buildSystemPromptBlock();
		if (!block) return;
		return { systemPrompt: `${event.systemPrompt}\n\n${block}` };
	});

	// ── Post-turn widget refresh ───────────────────────────────────────────
	pi.on("agent_end", async (_event, ctx) => {
		updateWidget(ctx);
	});

	// ── Tool: todo_write ───────────────────────────────────────────────────
	pi.registerTool({
		name: "todo_write",
		label: "Tasks",
		description:
			"Write and manage your task list for complex, multi-step work. " +
			"Provide the COMPLETE updated list — this REPLACES the current list entirely.",
		promptSnippet:
			"Create and update a structured task list with statuses (pending / in_progress / completed) and priorities",
		promptGuidelines: [
			"Use todo_write at the start of any complex, multi-step task to break the work into a clear plan. " +
				"Tasks should be specific and atomic (one concrete action each).",
			"Before starting a task, call todo_write to set it to 'in_progress'. " +
				"Only one task should be 'in_progress' at a time unless tasks are genuinely parallel.",
			"Immediately after completing a task, call todo_write to mark it 'completed'. " +
				"Do not batch completions — mark each task done as soon as it is finished. " +
				"Completed tasks remain visible in the list; they are never automatically deleted.",
			"todo_write REPLACES the entire list. Always include ALL tasks (both changed and unchanged) in every call.",
			"To permanently remove tasks, use todo_remove instead of omitting them from todo_write.",
		],
		parameters: TodoWriteParams,

		async execute(_id, params, _signal, _onUpdate, ctx) {
			const now = Date.now();
			const updated = params.tasks.map((t) => ({
				id: t.id ?? store.generateId(),
				content: t.content,
				status: t.status as TaskStatus,
				priority: t.priority as TaskPriority,
				createdAt: now,
			}));

			store.applyStatusTransitions(updated);
			store.setTasks(updated);
			store.syncIdCounter();
			updateWidget(ctx);

			return {
				content: [{ type: "text", text: formatListForLLM() }],
				details: { tasks: [...store.tasks] } satisfies TaskDetails,
			};
		},

		renderCall(args, theme) {
			const list = (args.tasks as any[]) ?? [];
			const inProg = list.filter((t: any) => t.status === "in_progress").length;
			const done = list.filter((t: any) => t.status === "completed").length;
			const total = list.length;

			let text = theme.fg("toolTitle", theme.bold("todo_write "));
			text += theme.fg("muted", `${total} task${total !== 1 ? "s" : ""}`);
			if (inProg > 0) text += `  ${theme.fg("accent", `● ${inProg} active`)}`;
			if (done > 0) text += `  ${theme.fg("success", `✓ ${done} done`)}`;
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme) {
			return TodoViewComponent.renderTaskResult(result.details as TaskDetails | undefined, expanded, theme);
		},
	});

	// ── Tool: todo_read ────────────────────────────────────────────────────
	pi.registerTool({
		name: "todo_read",
		label: "Tasks",
		description: "Read the current task list. Use this to check your tasks and their statuses.",
		promptSnippet: "Read the current task list and statuses",
		parameters: Type.Object({}),

		async execute() {
			return {
				content: [{ type: "text", text: formatListForLLM() }],
				details: { tasks: [...store.tasks] } satisfies TaskDetails,
			};
		},

		renderCall(_args, theme) {
			return new Text(theme.fg("toolTitle", theme.bold("todo_read")), 0, 0);
		},

		renderResult(result, { expanded }, theme) {
			return TodoViewComponent.renderTaskResult(result.details as TaskDetails | undefined, expanded, theme);
		},
	});

	// ── Tool: todo_remove ──────────────────────────────────────────────────
	pi.registerTool({
		name: "todo_remove",
		label: "Tasks",
		description:
			"Permanently remove tasks by ID. Use this to clean up tasks that are no longer relevant. " +
			"Completed tasks normally stay in the list for visibility — only remove if truly unwanted.",
		promptSnippet: "Remove tasks by ID",
		promptGuidelines: [
			"Use todo_remove to permanently delete tasks that are no longer needed. " +
				"Completed tasks remain visible by default — only remove if they clutter the list.",
		],
		parameters: TodoRemoveParams,

		async execute(_id, params, _signal, _onUpdate, ctx) {
			const removed = store.removeByIds(params.ids);
			updateWidget(ctx);

			if (removed.length === 0) {
				return {
					content: [{ type: "text", text: "No matching tasks found." }],
					details: { tasks: [...store.tasks] } satisfies TaskDetails,
				};
			}

			return {
				content: [
					{
						type: "text",
						text: `Removed ${removed.length} task${removed.length !== 1 ? "s" : ""}: ${removed.join(", ")}\n\n${formatListForLLM()}`,
					},
				],
				details: { tasks: [...store.tasks] } satisfies TaskDetails,
			};
		},

		renderCall(args, theme) {
			const ids = (args.ids as string[]) ?? [];
			const idStr = ids.map((id: string) => theme.fg("accent", id)).join(", ");
			return new Text(
				theme.fg("toolTitle", theme.bold("todo_remove ")) + theme.fg("muted", `remove ${idStr}`),
				0,
				0,
			);
		},

		renderResult(result, { expanded }, theme) {
			return TodoViewComponent.renderTaskResult(result.details as TaskDetails | undefined, expanded, theme);
		},
	});

	// ── Command: /todos ────────────────────────────────────────────────────
	pi.registerCommand("todos", {
		description: "Open the interactive task viewer",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify(store.tasks.length === 0 ? "No tasks yet." : formatListForLLM(), "info");
				return;
			}
			await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
				return new TodoViewComponent(store.tasks, theme, () => done());
			});
		},
	});
}
