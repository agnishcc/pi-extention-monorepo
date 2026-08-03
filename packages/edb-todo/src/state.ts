import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";
import type { FileTaskStore } from "./file-store.js";
import type { Task, TaskPriority, TaskStatus } from "./types.js";

// ── Spinner ───────────────────────────────────────────────────────────────────

const SPINNER = ["✳", "✴", "✵", "✶", "✷", "✸", "✹", "✺", "✻", "✼", "✽"];
const MAX_VISIBLE_TASKS = 12;

function formatDuration(ms: number): string {
	const totalSec = Math.floor(ms / 1000);
	if (totalSec < 60) return `${totalSec}s`;
	const min = Math.floor(totalSec / 60);
	const sec = totalSec % 60;
	if (min < 60) return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
	const hr = Math.floor(min / 60);
	const remMin = min % 60;
	return remMin > 0 ? `${hr}h ${remMin}m` : `${hr}h`;
}

// ── TodoWidget ────────────────────────────────────────────────────────────────

export class TodoWidget {
	private uiCtx: ExtensionUIContext | undefined;
	private store: FileTaskStore;
	private widgetFrame = 0;
	private widgetInterval: ReturnType<typeof setInterval> | undefined;
	/** IDs of tasks currently active (show spinner). */
	private activeTaskIds = new Set<string>();
	/** Per-task start time for elapsed display. */
	private taskStartedAt = new Map<string, number>();
	private tui: any | undefined;
	private widgetRegistered = false;

	constructor(store: FileTaskStore) {
		this.store = store;
	}

	setStore(store: FileTaskStore) {
		this.store = store;
	}

	setUICtx(ctx: ExtensionUIContext) {
		this.uiCtx = ctx;
	}

	setActiveTask(taskId: string | undefined, active = true) {
		if (taskId && active) {
			this.activeTaskIds.add(taskId);
			if (!this.taskStartedAt.has(taskId)) this.taskStartedAt.set(taskId, Date.now());
			this.ensureTimer();
		} else if (taskId) {
			this.activeTaskIds.delete(taskId);
			this.taskStartedAt.delete(taskId);
		}
		this.update();
	}

	private ensureTimer() {
		if (!this.widgetInterval) {
			this.widgetInterval = setInterval(() => this.update(), 200);
		}
	}

	/** Render a single task row. indent=0 for top-level, indent=1 for subtasks. */
	private renderTask(
		task: Task,
		isActive: boolean,
		spinnerChar: string,
		indent: number,
		theme: any,
		w: number,
	): string {
		const truncate = (line: string) => truncateToWidth(line, w);
		const pad = `  ${"  ".repeat(indent)}`;

		let icon: string;
		if (isActive) {
			icon = theme.fg("accent", spinnerChar);
		} else if (task.status === "completed") {
			icon = theme.fg("success", "✔");
		} else if (task.status === "in_progress") {
			icon = theme.fg("accent", "◼");
		} else if (task.status === "blocked") {
			icon = theme.fg("warning", "⏸");
		} else if (task.status === "failed") {
			icon = theme.fg("error", "✗");
		} else if (task.status === "cancelled") {
			icon = theme.fg("dim", "⊘");
		} else {
			icon = "◻";
		}

		// Attribution: show [owner] only when set (i.e. updated by a sub-agent)
		const ownerTag = task.owner ? theme.fg("dim", ` [${task.owner}]`) : "";

		let suffix = "";

		if (task.status === "blocked" && task.blockQuestion) {
			const preview = task.blockQuestion.slice(0, 50);
			suffix = theme.fg("warning", ` waiting: "${preview}${task.blockQuestion.length > 50 ? "…" : ""}"`);
		} else if (task.status === "pending") {
			// Sequential blockedBy
			const openBlockers = task.blockedBy.filter((bid) => {
				const blocker = this.store.get(bid);
				return blocker && blocker.status !== "completed";
			});
			if (openBlockers.length > 0) {
				suffix = theme.fg("dim", ` › blocked by ${openBlockers.map((id) => `#${id}`).join(", ")}`);
			}
			// Group blocker
			if (!suffix && task.blockedByGroup && !this.store.isGroupComplete(task.blockedByGroup)) {
				suffix = theme.fg("dim", ` › waiting for group [${task.blockedByGroup}]`);
			}
		}

		let text: string;
		if (isActive) {
			const form = task.activeForm || task.content;
			const startedAt = this.taskStartedAt.get(task.id) ?? Date.now();
			const elapsed = formatDuration(Date.now() - startedAt);
			const stats = theme.fg("dim", `(${elapsed})`);
			text = `${pad}${icon} ${theme.fg("accent", `${form}…`)} ${stats}${ownerTag}`;
		} else if (task.status === "completed") {
			text = `${pad}${icon} ${theme.fg("dim", theme.strikethrough(task.content))}${ownerTag}`;
		} else if (task.status === "blocked") {
			text = `${pad}${icon} ${theme.fg("muted", task.content)}${ownerTag}`;
		} else if (task.status === "failed") {
			text = `${pad}${icon} ${theme.fg("error", task.content)}${ownerTag}`;
		} else if (task.status === "cancelled") {
			text = `${pad}${icon} ${theme.fg("dim", task.content)}${ownerTag}`;
		} else {
			text = `${pad}${icon} ${task.content}${ownerTag}`;
		}

		return truncate(text + suffix);
	}

	private renderWidget(tui: any, theme: any): string[] {
		const tasks = this.store.list();
		const w: number = tui.terminal?.columns ?? 80;

		if (tasks.length === 0) return [];

		const completed = tasks.filter((t) => t.status === "completed");
		const inProgress = tasks.filter((t) => t.status === "in_progress");
		const blocked = tasks.filter((t) => t.status === "blocked");
		const failed = tasks.filter((t) => t.status === "failed");
		const cancelled = tasks.filter((t) => t.status === "cancelled");
		const pending = tasks.filter((t) => t.status === "pending");

		const parts: string[] = [];
		if (completed.length > 0) parts.push(`${completed.length} done`);
		if (inProgress.length > 0) parts.push(`${inProgress.length} in progress`);
		if (blocked.length > 0) parts.push(theme.fg("warning", `${blocked.length} blocked`));
		if (failed.length > 0) parts.push(theme.fg("error", `${failed.length} failed`));
		if (cancelled.length > 0) parts.push(theme.fg("dim", `${cancelled.length} cancelled`));
		if (pending.length > 0) parts.push(`${pending.length} open`);
		const statusText = `${tasks.length} task${tasks.length !== 1 ? "s" : ""} (${parts.join(", ")})`;

		const spinnerChar = SPINNER[this.widgetFrame % SPINNER.length]!;
		const lines: string[] = [truncateToWidth(`${theme.fg("accent", "●")} ${theme.fg("accent", statusText)}`, w)];

		// Build subtask map for tree rendering
		const childrenOf = new Map<string, Task[]>();
		for (const t of tasks) {
			if (t.parentId) {
				const arr = childrenOf.get(t.parentId) ?? [];
				arr.push(t);
				childrenOf.set(t.parentId, arr);
			}
		}

		// Render top-level tasks followed by their subtasks
		const topLevel = tasks.filter((t) => !t.parentId);
		let rendered = 0;

		for (const task of topLevel) {
			if (rendered >= MAX_VISIBLE_TASKS) break;
			const isActive = this.activeTaskIds.has(task.id) && task.status === "in_progress";
			lines.push(this.renderTask(task, isActive, spinnerChar, 0, theme, w));
			rendered++;

			const children = childrenOf.get(task.id) ?? [];
			for (const child of children) {
				if (rendered >= MAX_VISIBLE_TASKS) break;
				const childActive = this.activeTaskIds.has(child.id) && child.status === "in_progress";
				lines.push(this.renderTask(child, childActive, spinnerChar, 1, theme, w));
				rendered++;
			}
		}

		if (tasks.length > MAX_VISIBLE_TASKS) {
			lines.push(truncateToWidth(theme.fg("dim", `    … and ${tasks.length - MAX_VISIBLE_TASKS} more`), w));
		}

		return lines;
	}

	update() {
		if (!this.uiCtx) return;
		const tasks = this.store.list();

		if (tasks.length === 0) {
			if (this.widgetRegistered) {
				this.uiCtx.setWidget("pi-todo", undefined);
				this.widgetRegistered = false;
			}
			if (this.widgetInterval) {
				clearInterval(this.widgetInterval);
				this.widgetInterval = undefined;
			}
			return;
		}

		// Prune stale active IDs
		for (const id of this.activeTaskIds) {
			const t = this.store.get(id);
			if (!t || t.status !== "in_progress") {
				this.activeTaskIds.delete(id);
				this.taskStartedAt.delete(id);
			}
		}

		const hasActiveSpinner = tasks.some((t) => this.activeTaskIds.has(t.id) && t.status === "in_progress");
		if (hasActiveSpinner) {
			this.ensureTimer();
		} else if (this.widgetInterval) {
			clearInterval(this.widgetInterval);
			this.widgetInterval = undefined;
		}

		this.widgetFrame++;

		if (!this.widgetRegistered) {
			this.uiCtx.setWidget(
				"pi-todo",
				(tui, theme) => {
					this.tui = tui;
					return {
						render: () => this.renderWidget(tui, theme),
						invalidate: () => {},
					};
				},
				{ placement: "aboveEditor" },
			);
			this.widgetRegistered = true;
		} else if (this.tui) {
			this.tui.requestRender();
		}
	}

	dispose() {
		if (this.widgetInterval) {
			clearInterval(this.widgetInterval);
			this.widgetInterval = undefined;
		}
		if (this.uiCtx) {
			this.uiCtx.setWidget("pi-todo", undefined);
		}
		this.widgetRegistered = false;
		this.tui = undefined;
	}
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
	return p.charAt(0).toUpperCase() + p.slice(1);
}

export function statusIcon(status: TaskStatus): string {
	if (status === "completed") return "✓";
	if (status === "in_progress") return "●";
	if (status === "blocked") return "⏸";
	if (status === "failed") return "✗";
	if (status === "cancelled") return "⊘";
	return "○";
}

// ── Tool result rendering (inline) ─────────────────────────────────────────────

export function renderTaskListResult(tasks: Task[], expanded: boolean, theme: any): any {
	if (!tasks?.length) return new Text(theme.fg("dim", "Task list cleared"), 0, 0);

	const doneCount = tasks.filter((t) => t.status === "completed").length;
	const inProgCount = tasks.filter((t) => t.status === "in_progress").length;
	const blockedCount = tasks.filter((t) => t.status === "blocked").length;
	const failedCount = tasks.filter((t) => t.status === "failed").length;
	const cancelledCount = tasks.filter((t) => t.status === "cancelled").length;
	const total = tasks.length;

	const parts: string[] = [];
	if (inProgCount > 0) parts.push(theme.fg("accent", `● ${inProgCount} active`));
	if (blockedCount > 0) parts.push(theme.fg("warning", `⏸ ${blockedCount} blocked`));
	if (failedCount > 0) parts.push(theme.fg("error", `✗ ${failedCount} failed`));
	if (cancelledCount > 0) parts.push(theme.fg("dim", `⊘ ${cancelledCount} cancelled`));
	parts.push(theme.fg("success", `✓ ${doneCount}/${total} done`));
	let output = parts.join("  ");

	const display = expanded ? tasks : tasks.slice(0, 5);
	for (const t of display) {
		const icon =
			t.status === "completed"
				? theme.fg("success", "✓")
				: t.status === "in_progress"
					? theme.fg("accent", "●")
					: t.status === "blocked"
						? theme.fg("warning", "⏸")
						: t.status === "failed"
							? theme.fg("error", "✗")
							: t.status === "cancelled"
								? theme.fg("dim", "⊘")
								: theme.fg("dim", "○");
		const pColor = priorityColor(t.priority);
		const pLabel = theme.fg(pColor, priorityLabel(t.priority));
		const ownerTag = t.owner ? theme.fg("dim", ` [${t.owner}]`) : "";
		const subtaskIndent = t.parentId ? "  " : "";
		const content =
			t.status === "completed"
				? theme.fg("dim", theme.strikethrough(t.content))
				: t.status === "in_progress"
					? theme.fg("text", theme.bold(t.content))
					: t.status === "blocked"
						? theme.fg("muted", t.content)
						: t.status === "failed"
							? theme.fg("error", t.content)
							: t.status === "cancelled"
								? theme.fg("dim", t.content)
								: theme.fg("muted", t.content);
		output += `\n${subtaskIndent}${icon} ${pLabel}  ${content}${ownerTag}`;
	}

	if (!expanded && tasks.length > 5) {
		output += `\n${theme.fg("dim", `... ${tasks.length - 5} more`)}`;
	}

	return new Text(output, 0, 0);
}
