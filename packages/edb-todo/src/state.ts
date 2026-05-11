import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Task, TaskDetails, TaskPriority, TaskStatus } from "./types";

// ── TodoStore ──────────────────────────────────────────────────────────────────

export class TodoStore {
	tasks: Task[] = [];
	idCounter: number = 0;

	generateId(): string {
		return `t${++this.idCounter}`;
	}

	activeTasks(): Task[] {
		return this.tasks.filter((t) => t.status !== "completed");
	}

	setTasks(next: Task[]): void {
		this.tasks = next;
	}

	syncIdCounter(): void {
		for (const t of this.tasks) {
			const m = t.id.match(/^t(\d+)$/);
			if (m) this.idCounter = Math.max(this.idCounter, parseInt(m[1]!, 10));
		}
	}

	removeByIds(ids: string[]): string[] {
		const removed: string[] = [];
		this.tasks = this.tasks.filter((t) => {
			if (ids.includes(t.id)) {
				removed.push(t.id);
				return false;
			}
			return true;
		});
		return removed;
	}

	/** Apply status transitions and stamp timestamps accordingly. */
	applyStatusTransitions(updated: Task[]): void {
		const now = Date.now();
		const existing = new Map(this.tasks.map((t) => [t.id, t]));

		for (const task of updated) {
			const prev = existing.get(task.id);
			if (!prev) {
				// New task — set createdAt
				task.createdAt = task.createdAt ?? now;
				if (task.status === "in_progress") task.startedAt = now;
				if (task.status === "completed") {
					task.startedAt = task.startedAt ?? now;
					task.completedAt = now;
				}
				continue;
			}
			// Existing task — carry forward timestamps, apply transitions
			task.createdAt = prev.createdAt;
			task.startedAt = prev.startedAt;
			task.completedAt = prev.completedAt;

			if (prev.status !== "in_progress" && task.status === "in_progress") {
				task.startedAt = now;
			}
			if (prev.status !== "completed" && task.status === "completed") {
				task.startedAt = task.startedAt ?? now;
				task.completedAt = now;
			}
			// If reverted from completed back to in_progress/pending, clear completedAt
			if (prev.status === "completed" && task.status !== "completed") {
				task.completedAt = undefined;
			}
		}
	}
}

// ── Singleton ──────────────────────────────────────────────────────────────────

export const store = new TodoStore();

// ── Session reconstruction ─────────────────────────────────────────────────────

export function reconstructState(ctx: ExtensionContext): void {
	store.tasks = [];
	store.idCounter = 0;

	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "message") continue;
		const msg = entry.message;
		if (msg.role !== "toolResult" || msg.toolName !== "todo_write") continue;
		const details = msg.details as TaskDetails | undefined;
		if (details?.tasks) {
			store.tasks = details.tasks;
			store.syncIdCounter();
		}
	}
}

// ── Status bar ─────────────────────────────────────────────────────────────────

export function updateWidget(ctx: ExtensionContext): void {
	const active = store.activeTasks();

	if (active.length === 0) {
		ctx.ui.setWidget("pi-todo", undefined);
		ctx.ui.setStatus("pi-todo", undefined);
		return;
	}

	const th = ctx.ui.theme;
	const inProg = active.filter((t) => t.status === "in_progress");
	const pending = active.filter((t) => t.status === "pending");
	const doneCount = store.tasks.filter((t) => t.status === "completed").length;

	const parts: string[] = [];
	if (inProg.length > 0) parts.push(th.fg("accent", `● ${inProg.length} active`));
	if (pending.length > 0) parts.push(th.fg("muted", `○ ${pending.length} pending`));
	if (doneCount > 0) parts.push(th.fg("success", `✓ ${doneCount} done`));
	ctx.ui.setStatus("pi-todo", parts.join("  "));
}

// ── Shared rendering helpers ───────────────────────────────────────────────────

export const PRIORITY_THEME_COLOR: Record<TaskPriority, "error" | "warning" | "dim"> = {
	high: "error",
	medium: "warning",
	low: "dim",
};

export function priorityColor(p: TaskPriority): "error" | "warning" | "dim" {
	return PRIORITY_THEME_COLOR[p];
}

export function priorityLabel(p: TaskPriority): string {
	return p.toUpperCase().slice(0, 1) + p.slice(1);
}

export function statusIcon(status: TaskStatus): string {
	return STATUS_ICON[status];
}

const STATUS_ICON: Record<TaskStatus, string> = {
	pending: "○",
	in_progress: "●",
	completed: "✓",
};
