import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { loadConfig, resolveColors } from "./config";
import { getFileDiff, getGitDiff, isGitRepo } from "./git";
import { renderWidget } from "./renderer";
import { FileTracker } from "./tracker";
import type { FileEntry, GitDiffSnapshot } from "./types";
import { ChangeType } from "./types";

const WIDGET_KEY = "pi-diff-files";

// Filter modes cycle: all → created → edited → deleted → all
type FilterMode = "all" | "created" | "edited" | "deleted";
const FILTER_CYCLE: FilterMode[] = ["all", "created", "edited", "deleted"];
const FILTER_LABEL: Record<FilterMode, string> = {
	all: "all",
	created: "+created",
	edited: "~edited",
	deleted: "-deleted",
};

// ─── Interactive /diff-files viewer ──────────────────────────────────────────

class FilesViewComponent {
	private mode: "list" | "diff" = "list";
	private cursor = 0;
	private diffScroll = 0;
	private filterMode: FilterMode = "all";
	private statusMsg = "";
	private cachedWidth?: number;
	private cachedLines?: string[];
	private readonly tui: any;

	constructor(
		private readonly entries: ReadonlyArray<FileEntry>,
		private readonly diffs: Map<string, string[]>,
		private readonly theme: any,
		private readonly onClose: () => void,
		tui: any,
	) {
		this.tui = tui;
	}

	// ── Keyboard handling ──────────────────────────────────────────────────────

	handleInput(data: string): void {
		if (this.mode === "list") {
			this.handleListInput(data);
		} else {
			this.handleDiffInput(data);
		}
	}

	private handleListInput(data: string): void {
		const n = this.entries.length;
		if (data === "j" || matchesKey(data, "down")) {
			this.cursor = n > 0 ? Math.min(this.cursor + 1, n - 1) : 0;
			this.rerender();
		} else if (data === "k" || matchesKey(data, "up")) {
			this.cursor = Math.max(0, this.cursor - 1);
			this.rerender();
		} else if (matchesKey(data, "enter")) {
			if (this.entries[this.cursor]) {
				this.mode = "diff";
				this.diffScroll = 0;
				this.rerender();
			}
		} else if (data === "o") {
			const entry = this.entries[this.cursor];
			if (entry) {
				this.statusMsg = this.openFileInEditor(entry.path);
				this.rerender();
			}
		} else if (data === "f") {
			const idx = FILTER_CYCLE.indexOf(this.filterMode);
			this.filterMode = FILTER_CYCLE[(idx + 1) % FILTER_CYCLE.length]!;
			this.cursor = 0;
			this.rerender();
		} else if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.onClose();
		}
	}

	private handleDiffInput(data: string): void {
		const viewH = this.viewportHeight();
		const maxScroll = Math.max(0, this.currentDiffLines().length - viewH);

		if (data === "j" || matchesKey(data, "down")) {
			this.diffScroll = Math.min(this.diffScroll + 1, maxScroll);
			this.rerender();
		} else if (data === "k" || matchesKey(data, "up")) {
			this.diffScroll = Math.max(0, this.diffScroll - 1);
			this.rerender();
		} else if (matchesKey(data, "ctrl+d")) {
			this.diffScroll = Math.min(this.diffScroll + Math.floor(viewH / 2), maxScroll);
			this.rerender();
		} else if (matchesKey(data, "ctrl+u")) {
			this.diffScroll = Math.max(0, this.diffScroll - Math.floor(viewH / 2));
			this.rerender();
		} else if (data === "o") {
			const entry = this.entries[this.cursor];
			if (entry) {
				this.statusMsg = this.openFileInEditor(entry.path);
				this.rerender();
			}
		} else if (matchesKey(data, "escape") || data === "q") {
			this.mode = "list";
			this.statusMsg = "";
			this.rerender();
		}
	}

	private openFileInEditor(filePath: string): string {
		const editorCmd = process.env.VISUAL || process.env.EDITOR;
		if (!editorCmd) {
			this.statusMsg = "No editor configured (set $VISUAL or $EDITOR)";
			return this.statusMsg;
		}

		try {
			this.tui.stop();

			const [editor, ...editorArgs] = editorCmd.split(" ");

			const result = spawnSync(editor, [...editorArgs, filePath], {
				stdio: "inherit",
				shell: process.platform === "win32",
			});

			if (result.status !== 0) {
				this.statusMsg = `Editor exited with status ${result.status}`;
			} else {
				this.statusMsg = `Opened in ${basename(editor)}`;
			}
		} catch {
			this.statusMsg = "Failed to open editor";
		} finally {
			this.tui.start();
			this.tui.requestRender(true);
		}

		return this.statusMsg;
	}

	private filteredEntries(): ReadonlyArray<FileEntry> {
		if (this.filterMode === "all") return this.entries;
		const target =
			this.filterMode === "created"
				? ChangeType.Created
				: this.filterMode === "edited"
					? ChangeType.Edited
					: ChangeType.Deleted;
		return this.entries.filter((e) => e.changeType === target);
	}

	// ── Rendering ──────────────────────────────────────────────────────────────

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
		const lines = this.mode === "list" ? this.renderList(width) : this.renderDiff(width);
		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	private renderList(width: number): string[] {
		const { entries, theme: th } = this;
		const visible = this.filteredEntries();
		const cursor = Math.min(this.cursor, Math.max(0, visible.length - 1));
		const lines: string[] = [];

		// ── Header with filter indicator ──
		lines.push("");
		const filterTag = this.filterMode !== "all" ? th.fg("dim", `  ·${FILTER_LABEL[this.filterMode]}·`) : "";
		const countStr = this.filterMode === "all" ? `${entries.length}` : `${visible.length}/${entries.length}`;
		const title = ` Changed Files (${countStr}) `;
		const sideLen = Math.max(
			0,
			width - title.length - 3 - (this.filterMode !== "all" ? FILTER_LABEL[this.filterMode].length + 4 : 0),
		);
		lines.push(
			truncateToWidth(
				th.fg("borderMuted", "─".repeat(3)) +
					th.fg("accent", title) +
					filterTag +
					th.fg("borderMuted", "─".repeat(Math.max(0, sideLen))),
				width,
			),
		);
		lines.push("");

		if (visible.length === 0) {
			const msg = entries.length === 0 ? "No files changed yet." : `No ${this.filterMode} files.`;
			lines.push(truncateToWidth(`  ${th.fg("dim", msg)}`, width));
		} else {
			for (let i = 0; i < visible.length; i++) {
				const e = visible[i]!;
				const selected = i === cursor;
				const symColor =
					e.changeType === ChangeType.Created
						? "toolDiffAdded"
						: e.changeType === ChangeType.Edited
							? "warning"
							: "toolDiffRemoved";
				const sym = e.changeType === ChangeType.Created ? "+" : e.changeType === ChangeType.Edited ? "~" : "-";
				const arrow = selected ? th.fg("accent", "▶") : " ";
				const nameColor = selected ? "toolTitle" : "muted";

				lines.push(truncateToWidth(` ${arrow} ${th.fg(symColor, sym)} ${th.fg(nameColor, e.relPath)}`, width));
			}
		}

		lines.push("");
		lines.push(truncateToWidth(th.fg("borderMuted", "─".repeat(width)), width));
		if (this.statusMsg) {
			lines.push(truncateToWidth(`  ${th.fg("success", this.statusMsg)}`, width));
		}
		lines.push(
			truncateToWidth(
				`  ${th.fg("dim", "j/k  navigate    Enter  diff    o  open    f  filter    Esc  close")}`,
				width,
			),
		);
		lines.push("");
		return lines;
	}

	private renderDiff(width: number): string[] {
		const { theme: th, cursor, diffScroll } = this;
		const entry = this.entries[cursor];
		const lines: string[] = [];

		if (!entry) return lines;

		const rawDiff = this.currentDiffLines();
		const viewH = this.viewportHeight();
		const maxScroll = Math.max(0, rawDiff.length - viewH);
		const scroll = Math.min(diffScroll, maxScroll);

		// ── Header ──
		lines.push("");
		const symColor =
			entry.changeType === ChangeType.Created
				? "toolDiffAdded"
				: entry.changeType === ChangeType.Edited
					? "warning"
					: "toolDiffRemoved";
		const sym = entry.changeType === ChangeType.Created ? "+" : entry.changeType === ChangeType.Edited ? "~" : "-";
		const title = ` ${sym} ${entry.relPath} `;
		const sideLen = Math.max(0, width - title.length - 3);
		lines.push(
			truncateToWidth(
				th.fg("borderMuted", "─".repeat(3)) + th.fg(symColor, title) + th.fg("borderMuted", "─".repeat(sideLen)),
				width,
			),
		);
		lines.push("");

		// ── Diff body ──
		if (rawDiff.length === 1 && rawDiff[0]?.startsWith("(")) {
			lines.push(truncateToWidth(`  ${th.fg("dim", rawDiff[0])}`, width));
		} else {
			if (scroll > 0) {
				lines.push(truncateToWidth(`  ${th.fg("muted", `↑ ${scroll} lines above`)}`, width));
			}
			for (const raw of rawDiff.slice(scroll, scroll + viewH)) {
				lines.push(truncateToWidth(this.colourDiffLine(raw), width));
			}
			const below = rawDiff.length - scroll - viewH;
			if (below > 0) {
				lines.push(truncateToWidth(`  ${th.fg("muted", `↓ ${below} lines below`)}`, width));
			}
		}

		// ── Footer ──
		lines.push("");
		lines.push(truncateToWidth(th.fg("borderMuted", "─".repeat(width)), width));
		if (this.statusMsg) {
			lines.push(truncateToWidth(`  ${th.fg("success", this.statusMsg)}`, width));
		}
		lines.push(
			truncateToWidth(
				`  ${th.fg("dim", "j/k  scroll    Ctrl+D/U  half-page    o  open in editor    Esc  back to list")}`,
				width,
			),
		);
		lines.push("");
		return lines;
	}

	private colourDiffLine(raw: string): string {
		const th = this.theme;
		if (raw.startsWith("+++") || raw.startsWith("---")) return `  ${th.fg("dim", raw)}`;
		if (raw.startsWith("@@")) return `  ${th.fg("accent", raw)}`;
		if (raw.startsWith("+")) return `  ${th.fg("toolDiffAdded", raw)}`;
		if (raw.startsWith("-")) return `  ${th.fg("toolDiffRemoved", raw)}`;
		if (/^(diff |index |new file|deleted|Binary)/.test(raw)) return `  ${th.fg("dim", raw)}`;
		return `  ${th.fg("dim", raw)}`;
	}

	// ── Helpers ────────────────────────────────────────────────────────────────

	private currentDiffLines(): string[] {
		const entry = this.entries[this.cursor];
		if (!entry) return [];
		return this.diffs.get(entry.path) ?? ["(no diff available)"];
	}

	private viewportHeight(): number {
		return Math.max(5, (process.stdout.rows ?? 40) - 9);
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	/** Invalidate cache and request TUI re-render. */
	private rerender(): void {
		this.invalidate();
		this.tui.requestRender();
	}
}

// ─── Extension ───────────────────────────────────────────────────────────────

export default function diffFilesExtension(pi: any): void {
	const config = loadConfig();
	const tracker = new FileTracker();

	// Bash snapshots: toolCallId → git diff snapshot taken before bash ran
	const bashSnapshots = new Map<string, GitDiffSnapshot>();

	const inGit = isGitRepo(config.cwd);

	function updateWidget(ctx: any, theme?: any): void {
		const colors = resolveColors(theme);

		// Resolve change types from current git state
		if (inGit) {
			const currentDiff = getGitDiff(config.cwd);
			tracker.resolveFromGitDiff(currentDiff);
		}

		const lines = renderWidget(tracker.getEntries(), colors, config);
		if (lines.length > 0) {
			ctx.ui.setWidget(WIDGET_KEY, lines, { placement: "aboveEditor" });
		} else {
			ctx.ui.setWidget(WIDGET_KEY, undefined);
		}

		// ── Footer status (removed — widget already shows diff summary) ─────
	}

	// ── write/edit tool_call ──────────────────────────────────────────────
	pi.on("tool_call", async (event: any, _ctx: any) => {
		if (event.toolName === "write" || event.toolName === "edit") {
			const fp = event.input?.path ?? event.input?.file_path ?? "";
			if (!fp) return;

			const absPath = resolve(config.cwd, fp);
			const relPath = relative(config.cwd, absPath) || absPath;
			let changeType: ChangeType;

			if (event.toolName === "edit") {
				changeType = ChangeType.Edited;
			} else {
				changeType = existsSync(absPath) ? ChangeType.Edited : ChangeType.Created;
			}

			tracker.add(absPath, relPath, changeType);
			return;
		}

		if (event.toolName === "bash" && inGit) {
			const snapshot = getGitDiff(config.cwd);
			bashSnapshots.set(event.toolCallId, snapshot);
		}
	});

	// ── bash tool_result ────────────────────────────────────────────────
	pi.on("tool_result", async (event: any, _ctx: any) => {
		if (event.toolName !== "bash") return;
		if (event.isError) return;

		const before = bashSnapshots.get(event.toolCallId);
		bashSnapshots.delete(event.toolCallId);
		if (!before) return;

		const after = getGitDiff(config.cwd);

		const newEntries: GitDiffSnapshot = new Map();
		for (const [path, changeType] of after) {
			if (!before.has(path)) {
				newEntries.set(path, changeType);
			} else if (before.get(path) !== changeType) {
				newEntries.set(path, changeType);
			}
		}

		if (newEntries.size > 0) {
			tracker.mergeBashDiff(newEntries, config.cwd);
		}
	});

	// ── Flash state ─────────────────────────────────────────────────────
	let sizeAtTurnStart = 0;
	let flashTimer: ReturnType<typeof setTimeout> | null = null;

	function renderFlashWidget(ctx: any, theme: any, addedCount: number): void {
		const colors = resolveColors(theme);
		const entries = tracker.getEntries();
		const visible = config.includeDeleted
			? entries
			: entries.filter((e: FileEntry) => e.changeType !== ChangeType.Deleted);

		const lines: string[] = [];
		lines.push(
			`${colors.fgCreated}↯ ${addedCount} ${addedCount === 1 ? "file" : "files"} added this turn${colors.rst}`,
		);
		const shown = visible.slice(0, Math.max(1, config.maxLines - 1));
		for (const e of shown) {
			const prefix =
				e.changeType === ChangeType.Created
					? `${colors.fgCreated}+${colors.rst}`
					: e.changeType === ChangeType.Edited
						? `${colors.fgEdited}~${colors.rst}`
						: `${colors.fgDeleted}-${colors.rst}`;
			lines.push(` ${prefix} ${colors.fgDim}${e.relPath}${colors.rst}`);
		}
		const remaining = visible.length - shown.length;
		if (remaining > 0) {
			lines.push(`${colors.fgMuted}  … ${remaining} more${colors.rst}`);
		}
		ctx.ui.setWidget(WIDGET_KEY, lines, { placement: "aboveEditor" });
	}

	// ── turn_start ────────────────────────────────────────────────────────
	pi.on("turn_start", async (_event: any, _ctx: any) => {
		sizeAtTurnStart = tracker.size;
	});

	// ── turn_end ────────────────────────────────────────────────────────
	pi.on("turn_end", async (_event: any, ctx: any) => {
		if (tracker.size === 0) return;

		if (flashTimer) {
			clearTimeout(flashTimer);
			flashTimer = null;
		}

		const addedThisTurn = tracker.size - sizeAtTurnStart;

		if (addedThisTurn > 0) {
			renderFlashWidget(ctx, ctx?.theme, addedThisTurn);
			flashTimer = setTimeout(() => {
				flashTimer = null;
				updateWidget(ctx, ctx?.theme);
			}, 1200);
		} else {
			updateWidget(ctx, ctx?.theme);
		}
	});

	// ── session_start ───────────────────────────────────────────────────
	pi.on("session_start", async (_event: any, ctx: any) => {
		tracker.clear();
		bashSnapshots.clear();
		ctx.ui.setWidget(WIDGET_KEY, undefined);
	});

	// ── /diff-files command ─────────────────────────────────────────────────
	pi.registerCommand("diff-files", {
		description: "Show all files changed in this session with inline diff viewer",
		handler: async (_args: any, ctx: any) => {
			const entries = tracker.getEntries();

			if (!ctx.hasUI) {
				if (entries.length === 0) {
					ctx.ui.notify("No files changed yet.", "info");
					return;
				}
				const lines = entries.map((e: FileEntry) => {
					const prefix =
						e.changeType === ChangeType.Created ? "+" : e.changeType === ChangeType.Edited ? "~" : "-";
					return `${prefix} ${e.relPath}`;
				});
				ctx.ui.notify(lines.join("\n"), "info");
				return;
			}

			// Pre-compute diffs for every tracked file before opening the panel.
			const diffs = new Map<string, string[]>();
			if (inGit) {
				for (const entry of entries) {
					diffs.set(entry.path, getFileDiff(config.cwd, entry));
				}
			}

			await ctx.ui.custom((tui: any, theme: any, _kb: any, done: () => void) => {
				return new FilesViewComponent(entries, diffs, theme, () => done(), tui);
			});
		},
	});
}
