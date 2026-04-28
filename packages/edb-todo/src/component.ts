import { matchesKey, Text, truncateToWidth } from "@mariozechner/pi-tui";
import type { Task, TaskDetails } from "./types";
import { PRIORITY_ORDER, STATUS_ICON } from "./types";

// ── /todos interactive viewer ──────────────────────────────────────────────────

export class TodoViewComponent {
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(
		private readonly tasks: Task[],
		private readonly theme: any,
		private readonly onClose: () => void,
	) {}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.onClose();
		}
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;

		const lines: string[] = [];
		const th = this.theme;

		// ── Header ──
		lines.push("");
		const titleText = " Tasks ";
		const sideLen = Math.max(0, width - titleText.length - 3);
		const headerLine =
			th.fg("borderMuted", "─".repeat(3)) + th.fg("accent", titleText) + th.fg("borderMuted", "─".repeat(sideLen));
		lines.push(truncateToWidth(headerLine, width));
		lines.push("");

		if (this.tasks.length === 0) {
			lines.push(truncateToWidth(`  ${th.fg("dim", "No tasks yet. Ask the agent to plan the work.")}`, width));
		} else {
			// ── Progress bar ──
			const completedCount = this.tasks.filter((t) => t.status === "completed").length;
			const total = this.tasks.length;
			const barWidth = Math.min(24, width - 20);
			const filled = total > 0 ? Math.round((completedCount / total) * barWidth) : 0;
			const empty = barWidth - filled;
			const bar = `[${th.fg("success", "█".repeat(filled))}${th.fg("dim", "░".repeat(empty))}]`;
			lines.push(truncateToWidth(`  ${bar}  ${th.fg("muted", `${completedCount}/${total} done`)}`, width));
			lines.push("");

			// ── In Progress ──
			const inProgress = this.tasks.filter((t) => t.status === "in_progress");
			if (inProgress.length > 0) {
				lines.push(truncateToWidth(`  ${th.fg("accent", "In Progress")}`, width));
				for (const t of inProgress) lines.push(...this.renderTask(t, width));
				lines.push("");
			}

			// ── Pending (sorted by priority) ──
			const pending = this.tasks
				.filter((t) => t.status === "pending")
				.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
			if (pending.length > 0) {
				lines.push(truncateToWidth(`  ${th.fg("muted", "Pending")}`, width));
				for (const t of pending) lines.push(...this.renderTask(t, width));
				lines.push("");
			}

			// ── Completed ──
			const done = this.tasks.filter((t) => t.status === "completed");
			if (done.length > 0) {
				lines.push(truncateToWidth(`  ${th.fg("dim", "Completed")}`, width));
				for (const t of done) lines.push(...this.renderTask(t, width));
				lines.push("");
			}
		}

		// ── Footer ──
		lines.push(truncateToWidth(th.fg("borderMuted", "─".repeat(width)), width));
		lines.push(truncateToWidth(`  ${th.fg("dim", "Press Escape to close")}`, width));
		lines.push("");

		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	private renderTask(task: Task, width: number): string[] {
		const th = this.theme;

		const icon =
			task.status === "completed"
				? th.fg("success", STATUS_ICON.completed)
				: task.status === "in_progress"
					? th.fg("accent", STATUS_ICON.in_progress)
					: th.fg("dim", STATUS_ICON.pending);

		const priorityColor = task.priority === "high" ? "error" : task.priority === "medium" ? "warning" : "dim";
		const pLabel = th.fg(priorityColor, task.priority.toUpperCase().slice(0, 3));

		const contentText =
			task.status === "completed"
				? th.fg("dim", th.strikethrough(task.content))
				: task.status === "in_progress"
					? th.fg("text", th.bold(task.content))
					: th.fg("muted", task.content);

		const idHint = th.fg("dim", ` [${task.id}]`);

		return [truncateToWidth(`    ${icon} ${pLabel}  ${contentText}${idHint}`, width)];
	}

	// ── Tool result rendering ──────────────────────────────────────────────────

	static renderTaskResult(details: TaskDetails | undefined, expanded: boolean, theme: any): any {
		if (!details?.tasks?.length) {
			return new Text(theme.fg("dim", "Task list cleared"), 0, 0);
		}

		const list = details.tasks;
		const doneCount = list.filter((t) => t.status === "completed").length;
		let output = theme.fg("muted", `${doneCount}/${list.length} completed`);

		const display = expanded ? list : list.slice(0, 5);
		for (const t of display) {
			const icon =
				t.status === "completed"
					? theme.fg("success", STATUS_ICON.completed)
					: t.status === "in_progress"
						? theme.fg("accent", STATUS_ICON.in_progress)
						: theme.fg("dim", STATUS_ICON.pending);

			const pColor = t.priority === "high" ? "error" : t.priority === "medium" ? "warning" : "dim";
			const pLabel = theme.fg(pColor, t.priority.toUpperCase().slice(0, 3));
			const content =
				t.status === "completed"
					? theme.fg("dim", theme.strikethrough(t.content))
					: t.status === "in_progress"
						? theme.fg("text", theme.bold(t.content))
						: theme.fg("muted", t.content);

			output += `\n${icon} ${pLabel}  ${content}`;
		}

		if (!expanded && list.length > 5) {
			output += `\n${theme.fg("dim", `... ${list.length - 5} more`)}`;
		}

		return new Text(output, 0, 0);
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}
}
