import { activeTasks, tasks } from "./state";
import { PRIORITY_ORDER, STATUS_ICON } from "./types";

// ── System prompt injection ────────────────────────────────────────────────────

/**
 * Build a plain-text task block for system-prompt injection.
 * Only injected when there are active (non-completed) tasks.
 */
export function buildSystemPromptBlock(): string {
	const active = activeTasks();
	if (active.length === 0) return "";

	const lines: string[] = [
		"## Current Task List",
		"",
		"You have the following tasks. Update them with `todo_write` as you work:",
		"",
	];

	const inProg = active.filter((t) => t.status === "in_progress");
	const pending = active
		.filter((t) => t.status === "pending")
		.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);

	for (const t of [...inProg, ...pending]) {
		const icon = STATUS_ICON[t.status];
		const pLabel = `[${t.priority.toUpperCase().slice(0, 3)}]`;
		const suffix = t.status === "in_progress" ? "  ← in progress" : "";
		lines.push(`${icon} ${pLabel} ${t.content}${suffix}`);
	}

	const doneCount = tasks.filter((t) => t.status === "completed").length;
	if (doneCount > 0) {
		lines.push("", `${doneCount}/${tasks.length} tasks completed.`);
	}

	return lines.join("\n");
}

// ── LLM text formatter ─────────────────────────────────────────────────────────

/** Plain text list returned inside tool results (visible to the LLM). */
export function formatListForLLM(): string {
	if (tasks.length === 0) return "Task list is empty.";
	return tasks
		.map((t) => `${STATUS_ICON[t.status]} [${t.priority.toUpperCase().slice(0, 3)}] [${t.id}] ${t.content}`)
		.join("\n");
}
