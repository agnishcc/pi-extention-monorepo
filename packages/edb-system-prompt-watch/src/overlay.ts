import { copyToClipboard as copyTextToClipboard, type Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { PromptComparisonResult } from "./compare";

export const OVERLAY_CONTENT_HEIGHT = 28;

export interface TabContent {
	readonly name: string;
	getAboveContentLine(innerWidth: number): string | null;
	renderContent(innerWidth: number, height: number): string[];
	getFooterLeft(): string;
	readonly footerHints: string;
	handleInput(data: string): boolean;
	invalidate(): void;
}

export class ScrollableTabContent implements TabContent {
	private scrollOffset = 0;
	private searchMode = false;
	private searchQuery = "";
	private searchMatches: number[] = [];
	private currentMatchIndex = -1;
	private copyFlash = false;

	constructor(
		private opts: { rawText: string; displayLines: string[]; theme: Theme },
		public readonly name: string = "",
	) {}

	getAboveContentLine(_innerWidth: number): string | null {
		const th = this.opts.theme;
		if (this.searchMode) {
			return ` ${th.fg("accent", "/")} ${this.searchQuery}${th.fg("dim", "▏")}`;
		}
		if (this.searchMatches.length > 0) {
			return ` ${th.fg("accent", "/")} ${th.fg("text", this.searchQuery)} ${th.fg("dim", "—")} ${th.fg("accent", `${this.currentMatchIndex + 1}/${this.searchMatches.length}`)}`;
		}
		return null;
	}

	getFooterLeft(): string {
		const th = this.opts.theme;
		const total = this.opts.displayLines.length;
		const maxScroll = Math.max(0, total - 1);
		const visibleEnd = Math.min(this.scrollOffset + 1, total);

		const scrollPercent =
			total === 0
				? "All"
				: this.scrollOffset === 0
					? "Top"
					: this.scrollOffset >= maxScroll
						? "Bot"
						: `${Math.round(((this.scrollOffset + 1) / total) * 100)}%`;

		let left = `${visibleEnd}/${total} [${scrollPercent}]`;
		if (this.copyFlash) {
			left += th.fg("success", " ✓ Copied!");
		}
		return left;
	}

	readonly footerHints = "↑↓ scroll · / search · n/N next · y copy";

	handleInput(data: string): boolean {
		if (this.searchMode) {
			if (matchesKey(data, Key.escape)) {
				this.searchMode = false;
				this.searchQuery = "";
				return true;
			}
			if (matchesKey(data, Key.enter)) {
				if (this.searchQuery.length > 0) {
					this.findMatches();
					if (this.searchMatches.length > 0) {
						this.currentMatchIndex = 0;
						this.scrollToMatch();
					}
				}
				this.searchMode = false;
				return true;
			}
			if (matchesKey(data, Key.backspace)) {
				this.searchQuery = this.searchQuery.slice(0, -1);
				this.findMatches();
				if (this.searchMatches.length > 0) {
					this.currentMatchIndex = 0;
					this.scrollToMatch();
				}
				return true;
			}
			if (data.length === 1 && data.charCodeAt(0) >= 32) {
				this.searchQuery += data;
				this.findMatches();
				if (this.searchMatches.length > 0) {
					this.currentMatchIndex = 0;
					this.scrollToMatch();
				}
				return true;
			}
			return true;
		}

		if (matchesKey(data, Key.down) || data === "j") {
			this.scrollOffset++;
			return true;
		}
		if (matchesKey(data, Key.up) || data === "k") {
			this.scrollOffset = Math.max(0, this.scrollOffset - 1);
			return true;
		}
		if (matchesKey(data, Key.home) || data === "g") {
			this.scrollOffset = 0;
			return true;
		}
		if (matchesKey(data, Key.end) || data === "G") {
			this.scrollOffset = Math.max(0, this.opts.displayLines.length - OVERLAY_CONTENT_HEIGHT);
			return true;
		}
		if (matchesKey(data, Key.pageDown) || matchesKey(data, Key.ctrl("f"))) {
			this.scrollOffset += OVERLAY_CONTENT_HEIGHT;
			return true;
		}
		if (matchesKey(data, Key.pageUp) || matchesKey(data, Key.ctrl("b"))) {
			this.scrollOffset = Math.max(0, this.scrollOffset - OVERLAY_CONTENT_HEIGHT);
			return true;
		}
		if (data === "/") {
			this.searchMode = true;
			this.searchQuery = "";
			this.searchMatches = [];
			this.currentMatchIndex = -1;
			return true;
		}
		if (data === "n") {
			if (this.searchMatches.length > 0) {
				this.currentMatchIndex = (this.currentMatchIndex + 1) % this.searchMatches.length;
				this.scrollToMatch();
			}
			return true;
		}
		if (data === "N") {
			if (this.searchMatches.length > 0) {
				this.currentMatchIndex =
					(this.currentMatchIndex - 1 + this.searchMatches.length) % this.searchMatches.length;
				this.scrollToMatch();
			}
			return true;
		}
		if (data === "y") {
			void copyTextToClipboard(this.opts.rawText).then(() => {
				this.copyFlash = true;
				setTimeout(() => {
					this.copyFlash = false;
				}, 1500);
			});
			return true;
		}

		return false;
	}

	private findMatches(): void {
		if (!this.searchQuery) {
			this.searchMatches = [];
			return;
		}
		const q = this.searchQuery.toLowerCase();
		const rawLines = this.opts.rawText.split("\n");
		this.searchMatches = [];
		for (let i = 0; i < rawLines.length; i++) {
			if (rawLines[i]!.toLowerCase().includes(q)) {
				this.searchMatches.push(i);
			}
		}
	}

	private scrollToMatch(): void {
		if (this.currentMatchIndex < 0 || this.currentMatchIndex >= this.searchMatches.length) return;
		const line = this.searchMatches[this.currentMatchIndex]!;
		this.scrollOffset = Math.max(0, line - Math.floor(OVERLAY_CONTENT_HEIGHT / 2));
	}

	renderContent(innerWidth: number, height: number): string[] {
		const lines: string[] = [];
		const total = this.opts.displayLines.length;
		const maxScroll = Math.max(0, total - height);
		this.scrollOffset = Math.min(Math.max(0, this.scrollOffset), maxScroll);

		for (let i = 0; i < height; i++) {
			const idx = this.scrollOffset + i;
			if (idx < total) {
				lines.push(truncateToWidth(this.opts.displayLines[idx]!, innerWidth));
			}
		}
		return lines;
	}

	invalidate(): void {}
}

export class TabbedDiffOverlay {
	private activeTabIndex = 0;

	constructor(
		private opts: {
			title: string;
			subtitle: string;
			tabs: TabContent[];
			theme: Theme;
			done: () => void;
		},
	) {}

	private get activeTab(): TabContent {
		return this.opts.tabs[this.activeTabIndex]!;
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.tab)) {
			this.activeTabIndex = (this.activeTabIndex + 1) % this.opts.tabs.length;
			return;
		}
		if (matchesKey(data, Key.shift("tab"))) {
			this.activeTabIndex = (this.activeTabIndex - 1 + this.opts.tabs.length) % this.opts.tabs.length;
			return;
		}

		const consumed = this.activeTab.handleInput(data);
		if (consumed) return;

		if (matchesKey(data, Key.escape) || data === "q") {
			this.opts.done();
		}
	}

	render(width: number): string[] {
		const th = this.opts.theme;
		const innerW = width - 2;
		const lines: string[] = [];

		const pad = (s: string, len: number) => s + " ".repeat(Math.max(0, len - visibleWidth(s)));
		const row = (content: string) => th.fg("border", "│") + pad(content, innerW) + th.fg("border", "│");
		const borderTop = th.fg("border", `╭${"─".repeat(innerW)}╮`);
		const borderSep = th.fg("border", `├${"─".repeat(innerW)}┤`);
		const borderBottom = th.fg("border", `╰${"─".repeat(innerW)}╯`);

		lines.push(borderTop);
		const title = ` ${th.fg("accent", th.bold(this.opts.title))}  ${th.fg("dim", `(${this.opts.subtitle})`)}`;
		lines.push(row(title));

		let tabBar = " ";
		for (let i = 0; i < this.opts.tabs.length; i++) {
			const tab = this.opts.tabs[i]!;
			if (i === this.activeTabIndex) {
				tabBar += th.fg("accent", th.bold(`[${tab.name}]`));
			} else {
				tabBar += th.fg("dim", `[${tab.name}]`);
			}
			if (i < this.opts.tabs.length - 1) tabBar += " ";
		}
		lines.push(row(tabBar));

		const aboveLine = this.activeTab.getAboveContentLine(innerW);
		if (aboveLine !== null) {
			lines.push(row(` ${aboveLine}`));
		} else {
			lines.push(borderSep);
		}

		const contentLines = this.activeTab.renderContent(innerW, OVERLAY_CONTENT_HEIGHT);
		for (let i = 0; i < OVERLAY_CONTENT_HEIGHT; i++) {
			if (i < contentLines.length) {
				lines.push(row(truncateToWidth(contentLines[i]!, innerW)));
			} else {
				lines.push(row(th.fg("dim", "~")));
			}
		}

		lines.push(borderSep);

		const footerLeft = this.activeTab.getFooterLeft();
		const tabHints = this.opts.tabs.length > 1 ? "Tab switch" : "";
		const activeHints = this.activeTab.footerHints;
		const hintParts = [tabHints, activeHints, "q close"].filter(Boolean);
		const footerHintsText = th.fg("dim", hintParts.join(" · "));

		let footerContent = footerHintsText;
		if (footerLeft) {
			footerContent = th.fg("dim", ` ${footerLeft}  `) + footerHintsText;
		}
		lines.push(row(footerContent));
		lines.push(borderBottom);

		return lines;
	}

	invalidate(): void {
		for (const tab of this.opts.tabs) {
			tab.invalidate();
		}
	}
}

/** Formats unified diff text with ANSI syntax highlighting. */
export function formatDiffDisplayLines(diffText: string, theme: Theme): string[] {
	return diffText.split("\n").map((line) => {
		if (line.startsWith("---") || line.startsWith("+++")) {
			return theme.fg("dim", theme.bold(line));
		}
		if (line.startsWith("@@")) {
			return theme.fg("accent", line);
		}
		if (line.startsWith("+")) {
			return theme.fg("success", line);
		}
		if (line.startsWith("-")) {
			return theme.fg("error", line);
		}
		return theme.fg("text", line);
	});
}

/** Formats numbered lines for raw text display. */
export function formatNumberedLines(text: string, theme: Theme): string[] {
	const rawLines = text.split("\n");
	const numWidth = String(rawLines.length).length;
	return rawLines.map((line, i) => {
		const num = String(i + 1).padStart(numWidth, " ");
		return `${theme.fg("dim", num)} ${theme.fg("dim", "│")} ${line}`;
	});
}

/** Formats summary lines with color styling. */
export function formatSummaryDisplayLines(result: PromptComparisonResult, theme: Theme): string[] {
	const lines: string[] = [];
	const th = theme;

	lines.push(th.fg("accent", th.bold(`=== System Prompt Comparison (Pi v${result.piVersion}) ===`)));
	lines.push(th.fg("dim", `Default Source: ${result.promptSourcePath}`));
	lines.push("");

	if (result.isIdentical) {
		lines.push(th.fg("success", "✓ Your active system prompt is identical to Pi's bundled default system prompt."));
		return lines;
	}

	lines.push(
		th.fg(
			"warning",
			`⚠️ Differences detected: ${result.missingFromActive.length} missing from active, ${result.modifiedOrChanged.length} modified, ${result.uniqueToActive.length} custom.`,
		),
	);
	lines.push("");

	if (result.missingFromActive.length > 0) {
		lines.push(
			th.fg(
				"error",
				th.bold(
					`── ⚠️ Parts We Don't Have (In Pi default, missing from your prompt) [${result.missingFromActive.length}] ──`,
				),
			),
		);
		for (const item of result.missingFromActive) {
			lines.push(`  ${th.fg("error", "+")} ${item}`);
		}
		lines.push("");
	}

	if (result.modifiedOrChanged.length > 0) {
		lines.push(
			th.fg(
				"warning",
				th.bold(`── 🔄 Parts That Have Changed (Modified wording) [${result.modifiedOrChanged.length}] ──`),
			),
		);
		for (const item of result.modifiedOrChanged) {
			lines.push(`  ${th.fg("error", "- [Active]")}  ${item.activeItem}`);
			lines.push(`  ${th.fg("success", "+ [Default]")} ${item.defaultItem}`);
		}
		lines.push("");
	}

	if (result.uniqueToActive.length > 0) {
		lines.push(
			th.fg(
				"accent",
				th.bold(`── ✨ Custom Additions (Unique to your active prompt) [${result.uniqueToActive.length}] ──`),
			),
		);
		for (const item of result.uniqueToActive) {
			lines.push(`  ${th.fg("accent", "*")} ${item}`);
		}
		lines.push("");
	}

	return lines;
}
