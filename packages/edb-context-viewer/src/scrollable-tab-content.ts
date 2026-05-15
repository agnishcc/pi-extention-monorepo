/**
 * ScrollableTabContent — scrollable text viewer for use inside TabbedOverlay.
 *
 * Same scroll/search/copy logic as ScrollableOverlay, but without an outer frame.
 * Renders only the content lines; the outer frame is handled by TabbedOverlay.
 */

import { copyToClipboard as copyTextToClipboard, type Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { TabContent } from "./tabbed-overlay.js";

export interface ScrollableTabContentOptions {
	/** The raw text to display (used for search & clipboard) */
	rawText: string;
	/** The styled display lines (with ANSI formatting, line numbers, etc.) */
	displayLines: string[];
	/** Active theme */
	theme: Theme;
}

export class ScrollableTabContent implements TabContent {
	private scrollOffset = 0;

	// Search state
	private searchMode = false;
	private searchQuery = "";
	private searchMatches: number[] = [];
	private currentMatchIndex = -1;
	private copyFlash = false;

	constructor(
		private opts: ScrollableTabContentOptions,
		public readonly name: string = "",
	) {}

	/**
	 * Returns the above-content line (search bar or match info),
	 * or null if a plain border separator should be rendered.
	 */
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

	/**
	 * Handle keyboard input. Returns true if the key was consumed (prevents outer
	 * overlay from acting on it — e.g. so Escape exits search mode instead of
	 * closing the overlay).
	 */
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
			return true; // swallow all other keys in search mode
		}

		// Normal mode — handle scroll/search/copy, NOT q/Escape (those go to TabbedOverlay)
		if (matchesKey(data, Key.down) || data === "j") {
			this.scrollDown(1);
			return true;
		}
		if (matchesKey(data, Key.up) || data === "k") {
			this.scrollUp(1);
			return true;
		}
		if (matchesKey(data, Key.home) || data === "g") {
			this.scrollOffset = 0;
			return true;
		}
		if (matchesKey(data, Key.end) || data === "G") {
			this.scrollToBottom();
			return true;
		}
		if (matchesKey(data, Key.pageDown) || matchesKey(data, Key.ctrl("f"))) {
			this.scrollDown(28);
			return true;
		}
		if (matchesKey(data, Key.pageUp) || matchesKey(data, Key.ctrl("b"))) {
			this.scrollUp(28);
			return true;
		}
		if (matchesKey(data, Key.ctrl("d"))) {
			this.scrollDown(14);
			return true;
		}
		if (matchesKey(data, Key.ctrl("u"))) {
			this.scrollUp(14);
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
			this.nextMatch();
			return true;
		}
		if (data === "N") {
			this.prevMatch();
			return true;
		}
		if (data === "y") {
			void this.copyToClipboard();
			return true;
		}

		return false; // not consumed — let TabbedOverlay handle it
	}

	renderContent(innerWidth: number, height: number): string[] {
		const th = this.opts.theme;
		const lines: string[] = [];
		const total = this.opts.displayLines.length;

		// Clamp scroll offset
		const maxScroll = Math.max(0, total - height);
		this.scrollOffset = Math.min(this.scrollOffset, maxScroll);
		this.scrollOffset = Math.max(0, this.scrollOffset);

		for (let i = 0; i < height; i++) {
			const lineIdx = this.scrollOffset + i;
			if (lineIdx < total) {
				let line = this.opts.displayLines[lineIdx]!;

				const isCurrentMatch =
					this.searchMatches.length > 0 &&
					this.currentMatchIndex >= 0 &&
					this.searchMatches[this.currentMatchIndex] === lineIdx;
				const isOtherMatch =
					this.searchMatches.length > 0 && this.searchMatches.includes(lineIdx) && !isCurrentMatch;

				if (isCurrentMatch) {
					line = th.bg("selectedBg", truncateToWidth(line, innerWidth));
				} else if (isOtherMatch) {
					line = th.fg("warning", truncateToWidth(line, innerWidth));
				} else {
					line = truncateToWidth(line, innerWidth);
				}

				lines.push(line);
			} else {
				lines.push(th.fg("dim", "~"));
			}
		}

		return lines;
	}

	invalidate(): void {
		// No cached state
	}

	// ── Private helpers ────────────────────────────────────────────────────────

	private scrollDown(amount: number): void {
		const maxOffset = Math.max(0, this.opts.displayLines.length - 1);
		this.scrollOffset = Math.min(this.scrollOffset + amount, maxOffset);
	}

	private scrollUp(amount: number): void {
		this.scrollOffset = Math.max(0, this.scrollOffset - amount);
	}

	private scrollToBottom(): void {
		this.scrollOffset = Math.max(0, this.opts.displayLines.length - 1);
	}

	private findMatches(): void {
		const query = this.searchQuery.toLowerCase();
		const rawLines = this.opts.rawText.split("\n");
		this.searchMatches = [];
		if (query.length === 0) {
			this.currentMatchIndex = -1;
			return;
		}
		for (let i = 0; i < rawLines.length; i++) {
			if (rawLines[i]!.toLowerCase().includes(query)) {
				this.searchMatches.push(i);
			}
		}
	}

	private scrollToMatch(): void {
		if (this.currentMatchIndex >= 0 && this.currentMatchIndex < this.searchMatches.length) {
			const targetLine = this.searchMatches[this.currentMatchIndex]!;
			const visibleLines = 28; // approximate; TabbedOverlay uses CONTENT_HEIGHT
			if (targetLine < this.scrollOffset || targetLine >= this.scrollOffset + visibleLines) {
				this.scrollOffset = Math.max(0, targetLine - Math.floor(visibleLines / 3));
			}
		}
	}

	private nextMatch(): void {
		if (this.searchMatches.length === 0) return;
		this.currentMatchIndex = (this.currentMatchIndex + 1) % this.searchMatches.length;
		this.scrollToMatch();
	}

	private prevMatch(): void {
		if (this.searchMatches.length === 0) return;
		this.currentMatchIndex = (this.currentMatchIndex - 1 + this.searchMatches.length) % this.searchMatches.length;
		this.scrollToMatch();
	}

	private async copyToClipboard(): Promise<void> {
		this.copyFlash = true;
		try {
			await copyTextToClipboard(this.opts.rawText);
		} catch {
			// Silently fail if clipboard tools aren't available
		}
		setTimeout(() => {
			this.copyFlash = false;
		}, 1500);
	}
}
