import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { Task, TaskDetails } from "./types";
import { PRIORITY_ORDER } from "./types";

// ── Module state ───────────────────────────────────────────────────────────────

export let tasks: Task[] = [];
export let idCounter: number = 0;

// ── State helpers ──────────────────────────────────────────────────────────────

export function generateId(): string {
	return `t${++idCounter}`;
}

export function activeTasks(): Task[] {
	return tasks.filter((t) => t.status !== "completed");
}

export function setTasks(next: Task[]): void {
	tasks = next;
}

export function syncIdCounter(): void {
	for (const t of tasks) {
		const m = t.id.match(/^t(\d+)$/);
		if (m) idCounter = Math.max(idCounter, parseInt(m[1]!, 10));
	}
}

// ── Session reconstruction ─────────────────────────────────────────────────────

/**
 * Reconstruct in-memory state by replaying the last todo_write on the branch.
 * Ensures /tree navigation and forking work correctly.
 */
export function reconstructState(ctx: ExtensionContext): void {
	tasks = [];
	idCounter = 0;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "message") continue;
		const msg = entry.message;
		if (msg.role !== "toolResult" || msg.toolName !== "todo_write") continue;
		const details = msg.details as TaskDetails | undefined;
		if (details?.tasks) {
			tasks = details.tasks;
			syncIdCounter();
		}
	}
}

// ── Widget & status bar ────────────────────────────────────────────────────────

export function updateWidget(ctx: ExtensionContext): void {
	const active = activeTasks();

	if (active.length === 0) {
		ctx.ui.setWidget("pi-todo", undefined);
		ctx.ui.setStatus("pi-todo", undefined);
		return;
	}

	const th = ctx.ui.theme;
	const inProg = active.filter((t) => t.status === "in_progress");
	const pending = active.filter((t) => t.status === "pending");
	const doneCount = tasks.filter((t) => t.status === "completed").length;

	// ── Footer status ──
	const parts: string[] = [];
	if (inProg.length > 0) parts.push(th.fg("accent", `→ ${inProg.length} active`));
	if (pending.length > 0) parts.push(th.fg("muted", `○ ${pending.length} pending`));
	if (doneCount > 0) parts.push(th.fg("success", `✓ ${doneCount} done`));
	ctx.ui.setStatus("pi-todo", parts.join("  "));

	// ── Widget: show up to 4 active tasks ─────────────────────────────────
	const displayTasks = [
		...inProg,
		...pending.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]),
	].slice(0, 4);

	const widgetLines: string[] = [""];
	for (const t of displayTasks) {
		const icon = t.status === "in_progress" ? th.fg("accent", "→") : th.fg("dim", "○");
		const pColor = t.priority === "high" ? "error" : t.priority === "medium" ? "warning" : "dim";
		const pLabel = th.fg(pColor, t.priority.toUpperCase().slice(0, 3));
		const content = t.status === "in_progress" ? th.fg("text", th.bold(t.content)) : th.fg("muted", t.content);
		widgetLines.push(`  ${icon} ${pLabel}  ${content}`);
	}
	if (active.length > 4) {
		widgetLines.push(`  ${th.fg("dim", `... ${active.length - 4} more  (/todos for full list)`)}`);
	}
	widgetLines.push("");

	ctx.ui.setWidget("pi-todo", widgetLines);
}
