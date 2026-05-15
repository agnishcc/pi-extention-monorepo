import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import {
	Container,
	matchesKey,
	type SettingItem,
	SettingsList,
	Spacer,
	Text,
	truncateToWidth,
} from "@earendil-works/pi-tui";
import type { TodoConfig } from "./config.js";
import { saveTodoConfig } from "./config.js";
import type { FileTaskStore } from "./file-store.js";
import { priorityColor, priorityLabel, renderTaskListResult } from "./state.js";
import type { Task, TaskDetails } from "./types.js";
import { PRIORITY_ORDER } from "./types.js";

// ── /todos interactive viewer ──────────────────────────────────────────────────

export class TodoViewComponent {
	private cursorIndex: number = 0;
	private showCompleted: boolean = true;
	private cachedWidth?: number;
	private cachedLines?: string[];
	private flatTasks: Task[] = [];

	constructor(
		private readonly tasks: Task[],
		private readonly theme: any,
		private readonly onClose: () => void,
	) {
		this.rebuildFlatTasks();
		if (this.flatTasks.length > 0) {
			this.cursorIndex = Math.min(this.cursorIndex, this.flatTasks.length - 1);
		}
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.onClose();
			return;
		}
		if (matchesKey(data, "up") || data === "k") {
			if (this.cursorIndex > 0) this.cursorIndex--;
			this.invalidate();
			return;
		}
		if (matchesKey(data, "down") || data === "j") {
			if (this.cursorIndex < this.flatTasks.length - 1) this.cursorIndex++;
			this.invalidate();
			return;
		}
		if (data === "c") {
			this.showCompleted = !this.showCompleted;
			this.rebuildFlatTasks();
			this.cursorIndex = Math.min(this.cursorIndex, Math.max(0, this.flatTasks.length - 1));
			this.invalidate();
			return;
		}
		if (matchesKey(data, "home") || data === "g") {
			this.cursorIndex = 0;
			this.invalidate();
			return;
		}
		if (matchesKey(data, "end") || data === "G") {
			this.cursorIndex = Math.max(0, this.flatTasks.length - 1);
			this.invalidate();
			return;
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
			th.fg("borderMuted", "─".repeat(3)) +
			th.fg("accent", th.bold(titleText)) +
			th.fg("borderMuted", "─".repeat(sideLen));
		lines.push(truncateToWidth(headerLine, width));
		lines.push("");

		if (this.tasks.length === 0) {
			lines.push(truncateToWidth(`  ${th.fg("dim", "No tasks yet. Ask the agent to plan the work.")}`, width));
		} else {
			// ── Progress bar ──
			const completedCount = this.tasks.filter((t) => t.status === "completed").length;
			const total = this.tasks.length;
			const barWidth = Math.min(20, width - 22);
			const filled = total > 0 ? Math.round((completedCount / total) * barWidth) : 0;
			const empty = barWidth - filled;
			const bar = `[${th.fg("success", "█".repeat(filled))}${th.fg("dim", "░".repeat(empty))}]`;
			const pct = total > 0 ? Math.round((completedCount / total) * 100) : 0;
			lines.push(
				truncateToWidth(
					`  ${bar}  ${th.fg("muted", `${completedCount}/${total}`)} ${th.fg("dim", `(${pct}%)`)}`,
					width,
				),
			);
			lines.push("");

			// ── Build sections ──
			const inProgress = this.tasks.filter((t) => t.status === "in_progress");
			const pending = this.tasks
				.filter((t) => t.status === "pending")
				.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
			const done = this.tasks.filter((t) => t.status === "completed");

			let flatIdx = 0;

			if (inProgress.length > 0) {
				lines.push(
					truncateToWidth(
						`  ${th.fg("accent", th.bold("In Progress"))} ${th.fg("dim", `(${inProgress.length})`)}`,
						width,
					),
				);
				for (const t of inProgress) {
					lines.push(...this.renderTask(t, width, flatIdx));
					flatIdx++;
				}
				lines.push("");
			}

			if (pending.length > 0) {
				lines.push(
					truncateToWidth(`  ${th.fg("muted", th.bold("Pending"))} ${th.fg("dim", `(${pending.length})`)}`, width),
				);
				for (const t of pending) {
					lines.push(...this.renderTask(t, width, flatIdx));
					flatIdx++;
				}
				lines.push("");
			}

			if (done.length > 0 && this.showCompleted) {
				lines.push(
					truncateToWidth(`  ${th.fg("dim", th.bold("Completed"))} ${th.fg("dim", `(${done.length})`)}`, width),
				);
				for (const t of done) {
					lines.push(...this.renderTask(t, width, flatIdx));
					flatIdx++;
				}
				lines.push("");
			} else if (done.length > 0 && !this.showCompleted) {
				lines.push(truncateToWidth(`  ${th.fg("dim", `${done.length} completed — press c to show`)}`, width));
				lines.push("");
			}
		}

		// ── Footer ──
		lines.push(truncateToWidth(th.fg("borderMuted", "─".repeat(width)), width));
		const keys = ["↑↓ navigate", "c toggle completed", "esc close"];
		lines.push(truncateToWidth(`  ${th.fg("dim", keys.join("  •  "))}`, width));
		lines.push("");

		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	private renderTask(task: Task, width: number, flatIdx: number): string[] {
		const th = this.theme;
		const isFocused = flatIdx === this.cursorIndex;

		let icon: string;
		if (task.status === "completed") {
			icon = th.fg("success", "✓");
		} else if (task.status === "in_progress") {
			icon = th.fg("accent", "●");
		} else {
			icon = th.fg("dim", "○");
		}

		const pColor = priorityColor(task.priority);
		const pLabel = th.fg(pColor, priorityLabel(task.priority));

		let contentText: string;
		if (task.status === "completed") {
			contentText = th.fg("dim", th.strikethrough(task.content));
		} else if (task.status === "in_progress") {
			contentText = th.fg("text", th.bold(task.content));
		} else {
			contentText = th.fg("muted", task.content);
		}

		const idHint = th.fg("dim", ` [${task.id}]`);
		const cursor = isFocused ? th.fg("accent", "❯") : " ";

		// Dependency hint
		let depHint = "";
		if (task.blockedBy.length > 0) {
			const openBlockers = task.blockedBy.filter((_bid) => {
				// We only have the flat list, use basic check
				return true; // shown for visibility
			});
			if (openBlockers.length > 0) {
				depHint = th.fg("dim", ` ← blocked by ${openBlockers.map((id) => `#${id}`).join(", ")}`);
			}
		}
		if (task.blocks.length > 0) {
			depHint += th.fg("dim", ` → blocks ${task.blocks.map((id) => `#${id}`).join(", ")}`);
		}

		return [truncateToWidth(`  ${cursor} ${icon} ${pLabel}  ${contentText}${idHint}${depHint}`, width)];
	}

	private rebuildFlatTasks(): void {
		const inProgress = this.tasks.filter((t) => t.status === "in_progress");
		const pending = this.tasks
			.filter((t) => t.status === "pending")
			.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
		const done = this.showCompleted ? this.tasks.filter((t) => t.status === "completed") : [];
		this.flatTasks = [...inProgress, ...pending, ...done];
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	// ── Static tool result renderer ────────────────────────────────────────────

	static renderTaskResult(details: TaskDetails | undefined, expanded: boolean, theme: any): any {
		return renderTaskListResult(details?.tasks ?? [], expanded, theme);
	}
}

// ── Settings panel ──────────────────────────────────────────────────────────────

export async function openTodoSettings(ui: any, cfg: TodoConfig, cwd: string, clearDelayTurns: number): Promise<void> {
	await ui.custom((_tui: any, theme: any, _kb: any, done: (r: undefined) => void) => {
		const items: SettingItem[] = [
			{
				id: "taskScope",
				label: "Task storage",
				description:
					"memory: tasks live only in memory, lost when session ends. " +
					"session: persisted per session (tasks-<sessionId>.json), survives resume. " +
					"project: shared across all sessions (tasks.json). " +
					"Takes effect on next session start.",
				currentValue: cfg.taskScope ?? "session",
				values: ["memory", "session", "project"],
			},
			{
				id: "autoClearCompleted",
				label: "Auto-clear completed tasks",
				description:
					"never: completed tasks stay visible until manually cleared. " +
					"on_list_complete: cleared automatically after all tasks are done. " +
					"on_task_complete: each task cleared shortly after it completes. " +
					`Clearing lags ~${clearDelayTurns} turns.`,
				currentValue: cfg.autoClearCompleted ?? "on_list_complete",
				values: ["never", "on_list_complete", "on_task_complete"],
			},
		];

		const list = new SettingsList(
			items,
			10,
			getSettingsListTheme(),
			(id, newValue) => {
				if (id === "taskScope") {
					cfg.taskScope = newValue as TodoConfig["taskScope"];
					saveTodoConfig(cwd, cfg);
				}
				if (id === "autoClearCompleted") {
					cfg.autoClearCompleted = newValue as TodoConfig["autoClearCompleted"];
					saveTodoConfig(cwd, cfg);
				}
			},
			() => done(undefined),
		);

		class SettingsPanel extends Container {
			handleInput(data: string) {
				list.handleInput(data);
			}
		}

		const root = new SettingsPanel();
		root.addChild(new Text(theme.bold(theme.fg("accent", "⚙  Todo Settings")), 0, 0));
		root.addChild(new Spacer(1));
		root.addChild(list);
		return root;
	});
}

// ── /todos detailed task viewer (select-based) ─────────────────────────────────

export async function openTodosMenu(
	ui: any,
	store: FileTaskStore,
	cfg: TodoConfig,
	cwd: string,
	onTaskUpdate: (taskId: string, status?: string) => void,
): Promise<void> {
	const AUTO_CLEAR_DELAY = 4;

	const mainMenu = async (): Promise<void> => {
		const tasks = store.list();
		const completedCount = tasks.filter((t) => t.status === "completed").length;

		const choices: string[] = [`View all tasks (${tasks.length})`];
		if (completedCount > 0) choices.push(`Clear completed (${completedCount})`);
		if (tasks.length > 0) choices.push(`Clear all (${tasks.length})`);
		choices.push("⚙ Settings");

		const choice = await ui.select("Tasks", choices);
		if (!choice) return;

		if (choice.startsWith("View")) {
			return viewTasks();
		} else if (choice.startsWith("Clear completed")) {
			store.clearCompleted();
			store.deleteFileIfEmpty();
			onTaskUpdate("", undefined);
			return mainMenu();
		} else if (choice.startsWith("Clear all")) {
			store.clearAll();
			store.deleteFileIfEmpty();
			onTaskUpdate("", undefined);
			return mainMenu();
		} else if (choice.startsWith("⚙")) {
			await openTodoSettings(ui, cfg, cwd, AUTO_CLEAR_DELAY);
			return mainMenu();
		}
	};

	const viewTasks = async (): Promise<void> => {
		const tasks = store.list();
		if (tasks.length === 0) {
			await ui.select("No tasks", ["← Back"]);
			return mainMenu();
		}

		const icon = (status: string) => {
			if (status === "completed") return "✔";
			if (status === "in_progress") return "◼";
			return "◻";
		};

		const choices = tasks.map((t) => `${icon(t.status)} #${t.id} [${t.status}] ${t.content}`);
		choices.push("← Back");

		const selected = await ui.select("Tasks", choices);
		if (!selected || selected === "← Back") return mainMenu();

		const match = selected.match(/#([a-z0-9]+)/);
		if (match) return viewTaskDetail(match[1]);
		return viewTasks();
	};

	const viewTaskDetail = async (taskId: string): Promise<void> => {
		const task = store.get(taskId);
		if (!task) return viewTasks();

		const actions: string[] = [];
		if (task.status === "pending") actions.push("▸ Start (in_progress)");
		if (task.status === "in_progress") actions.push("✓ Complete");
		actions.push("✗ Delete");
		actions.push("← Back");

		const deps: string[] = [];
		if (task.blockedBy.length > 0) deps.push(`Blocked by: ${task.blockedBy.map((id) => `#${id}`).join(", ")}`);
		if (task.blocks.length > 0) deps.push(`Blocks: ${task.blocks.map((id) => `#${id}`).join(", ")}`);

		const detailLines = [
			`#${task.id} [${task.status}] ${task.content}`,
			task.description ? `\n${task.description}` : "",
			deps.length > 0 ? `\n${deps.join(" | ")}` : "",
		]
			.filter(Boolean)
			.join("");

		const action = await ui.select(detailLines, actions);

		if (action === "▸ Start (in_progress)") {
			store.update(taskId, { status: "in_progress" });
			onTaskUpdate(taskId, "in_progress");
			return viewTasks();
		} else if (action === "✓ Complete") {
			store.update(taskId, { status: "completed" });
			onTaskUpdate(taskId, "completed");
			return viewTasks();
		} else if (action === "✗ Delete") {
			store.update(taskId, { status: "deleted" });
			onTaskUpdate(taskId, "deleted");
			return viewTasks();
		}
		return viewTasks();
	};

	await mainMenu();
}
