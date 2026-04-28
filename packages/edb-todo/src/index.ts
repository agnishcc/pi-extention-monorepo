/**
 * pi-todo
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
 * Tools:   todo_write  — replace the entire task list (atomic update)
 *          todo_read   — read the current task list
 * Command: /todos      — open interactive full-screen task viewer
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "typebox";
import { TodoViewComponent } from "./component";
import { buildSystemPromptBlock, formatListForLLM } from "./prompt";
import { TodoWriteParams } from "./schemas";
import { generateId, reconstructState, setTasks, syncIdCounter, tasks, updateWidget } from "./state";
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
	// Active tasks are injected at the start of every agent turn so the model
	// always knows its current plan — the core mechanism that prevents goal drift.
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
				"Do not batch completions — mark each task done as soon as it is finished.",
			"todo_write REPLACES the entire list. Always include ALL tasks (both changed and unchanged) in every call.",
		],
		parameters: TodoWriteParams,

		async execute(_id, params, _signal, _onUpdate, ctx) {
			setTasks(
				params.tasks.map((t) => ({
					id: t.id ?? generateId(),
					content: t.content,
					status: t.status as TaskStatus,
					priority: t.priority as TaskPriority,
				})),
			);
			syncIdCounter();
			updateWidget(ctx);

			return {
				content: [{ type: "text", text: formatListForLLM() }],
				details: { tasks: [...tasks] } satisfies TaskDetails,
			};
		},

		renderCall(args, theme) {
			const list = (args.tasks as any[]) ?? [];
			const inProg = list.filter((t: any) => t.status === "in_progress").length;
			const done = list.filter((t: any) => t.status === "completed").length;
			const total = list.length;
			let text = theme.fg("toolTitle", theme.bold("todo_write "));
			text += theme.fg("muted", `${total} task${total !== 1 ? "s" : ""}`);
			if (inProg > 0) text += `  ${theme.fg("accent", `→ ${inProg} active`)}`;
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
				details: { tasks: [...tasks] } satisfies TaskDetails,
			};
		},

		renderCall(_args, theme) {
			return new Text(theme.fg("toolTitle", theme.bold("todo_read")), 0, 0);
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
				ctx.ui.notify(tasks.length === 0 ? "No tasks yet." : formatListForLLM(), "info");
				return;
			}
			await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
				return new TodoViewComponent(tasks, theme, () => done());
			});
		},
	});
}
