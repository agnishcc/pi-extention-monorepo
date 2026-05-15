import type { FileTaskStore } from "./file-store.js";
import { priorityLabel } from "./state.js";
import { PRIORITY_ORDER } from "./types.js";

// ── System prompt injection ────────────────────────────────────────────────────

export function buildSystemPromptBlock(store: FileTaskStore): string {
	const active = store.activeTasks();
	if (active.length === 0) return "";

	const lines: string[] = [
		"## Current Task List",
		"",
		"You have the following tasks. Update them with `TaskCreate` / `TaskUpdate` as you work:",
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
		const depStr = t.blockedBy.length > 0 ? ` [blocked by ${t.blockedBy.map((id) => `#${id}`).join(", ")}]` : "";
		lines.push(`${icon} [${t.id}] ${pLabel} ${t.content}${suffix}${depStr}`);
	}

	const doneCount = store.list().filter((t) => t.status === "completed").length;
	if (doneCount > 0) {
		lines.push("", `${doneCount}/${store.list().length} tasks completed.`);
	}

	return lines.join("\n");
}

// ── LLM text formatter ─────────────────────────────────────────────────────────

export function formatListForLLM(store: FileTaskStore): string {
	const tasks = store.list();
	if (tasks.length === 0) return "Task list is empty.";
	return tasks
		.map((t) => {
			const icon = t.status === "in_progress" ? "●" : t.status === "completed" ? "✓" : "○";
			const dep = t.blockedBy.length > 0 ? ` [blocked by ${t.blockedBy.map((id) => `#${id}`).join(", ")}]` : "";
			return `${icon} [${priorityLabel(t.priority)}] [${t.id}] ${t.content}${dep}`;
		})
		.join("\n");
}
