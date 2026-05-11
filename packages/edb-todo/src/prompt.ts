import { priorityLabel, store } from "./state";
import { PRIORITY_ORDER } from "./types";

// ── System prompt injection ────────────────────────────────────────────────────

export function buildSystemPromptBlock(): string {
	const active = store.activeTasks();
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
		const icon = t.status === "in_progress" ? "●" : "○";
		const pLabel = `[${priorityLabel(t.priority)}]`;
		const suffix = t.status === "in_progress" ? "  ← in progress" : "";
		lines.push(`${icon} ${pLabel} ${t.content}${suffix}`);
	}

	const doneCount = store.tasks.filter((t) => t.status === "completed").length;
	if (doneCount > 0) {
		lines.push("", `${doneCount}/${store.tasks.length} tasks completed.`);
	}

	return lines.join("\n");
}

// ── LLM text formatter ─────────────────────────────────────────────────────────

export function formatListForLLM(): string {
	if (store.tasks.length === 0) return "Task list is empty.";
	return store.tasks
		.map((t) => {
			const icon = t.status === "in_progress" ? "●" : t.status === "completed" ? "✓" : "○";
			return `${icon} [${priorityLabel(t.priority)}] [${t.id}] ${t.content}`;
		})
		.join("\n");
}
