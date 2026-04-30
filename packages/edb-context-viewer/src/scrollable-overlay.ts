/**
 * ScrollableOverlay — reusable scrollable text viewer rendered as a bordered overlay.
 *
 * Features:
 *   - Line numbers
 *   - Arrow / Page / Home / End / j-k scrolling
 *   - `/` search with live matching, `n`/`N` navigation
 *   - `y` copies the raw content to clipboard
 *   - `Escape` / `q` to close
 */

import { copyToClipboard as copyTextToClipboard, type Theme } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

const CONTENT_HEIGHT = 30;

export interface ScrollableOverlayOptions {
	/** Title shown in the top border */
	title: string;
	/** Subtitle / stats line (e.g. "1,234 chars · 56 lines") */
	subtitle: string;
	/** The raw text to display (used for search & clipboard) */
	rawText: string;
	/** The styled display lines (with ANSI formatting, line numbers, etc.) */
	displayLines: string[];
	/** Active theme */
	theme: Theme;
	/** Called when the user closes the overlay */
	done: () => void;
}

export class ScrollableOverlay {
	private scrollOffset = 0;

	// Search state
	private searchMode = false;
	private searchQuery = "";
	private searchMatches: number[] = [];
	private currentMatchIndex = -1;
	private copyFlash = false;

	constructor(private opts: ScrollableOverlayOptions) {}

	private get visibleLines(): number {
		return CONTENT_HEIGHT;
	}

	handleInput(data: string): void {
		if (this.searchMode) {
			if (matchesKey(data, Key.escape)) {
				this.searchMode = false;
				this.searchQuery = "";
				return;
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
				return;
			}
			if (matchesKey(data, Key.backspace)) {
				this.searchQuery = this.searchQuery.slice(0, -1);
				return;
			}
			if (data.length === 1 && data.charCodeAt(0) >= 32) {
				this.searchQuery += data;
				this.findMatches();
				if (this.searchMatches.length > 0) {
					this.currentMatchIndex = 0;
					this.scrollToMatch();
				}
				return;
			}
			return;
		}

		if (matchesKey(data, Key.escape) || data === "q") {
			this.opts.done();
			return;
		}

		if (matchesKey(data, Key.down) || data === "j") {
			this.scrollDown(1);
		} else if (matchesKey(data, Key.up) || data === "k") {
			this.scrollUp(1);
		} else if (matchesKey(data, Key.home) || data === "g") {
			this.scrollOffset = 0;
		} else if (matchesKey(data, Key.end) || data === "G") {
			this.scrollToBottom();
		} else if (matchesKey(data, Key.pageDown) || matchesKey(data, Key.ctrl("f"))) {
			this.scrollDown(this.visibleLines - 2);
		} else if (matchesKey(data, Key.pageUp) || matchesKey(data, Key.ctrl("b"))) {
			this.scrollUp(this.visibleLines - 2);
		} else if (matchesKey(data, Key.ctrl("d"))) {
			this.scrollDown(Math.floor(this.visibleLines / 2));
		} else if (matchesKey(data, Key.ctrl("u"))) {
			this.scrollUp(Math.floor(this.visibleLines / 2));
		} else if (data === "/") {
			this.searchMode = true;
			this.searchQuery = "";
			this.searchMatches = [];
			this.currentMatchIndex = -1;
		} else if (data === "n") {
			this.nextMatch();
		} else if (data === "N") {
			this.prevMatch();
		} else if (data === "y") {
			void this.copyToClipboard();
		}
	}

	private scrollDown(amount: number): void {
		const maxOffset = Math.max(0, this.opts.displayLines.length - this.visibleLines);
		this.scrollOffset = Math.min(this.scrollOffset + amount, maxOffset);
	}

	private scrollUp(amount: number): void {
		this.scrollOffset = Math.max(0, this.scrollOffset - amount);
	}

	private scrollToBottom(): void {
		this.scrollOffset = Math.max(0, this.opts.displayLines.length - this.visibleLines);
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
			if (targetLine < this.scrollOffset || targetLine >= this.scrollOffset + this.visibleLines) {
				this.scrollOffset = Math.max(0, targetLine - Math.floor(this.visibleLines / 3));
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

	render(width: number): string[] {
		const th = this.opts.theme;
		const innerW = width - 2;
		const lines: string[] = [];

		const pad = (s: string, len: number) => {
			const vis = visibleWidth(s);
			return s + " ".repeat(Math.max(0, len - vis));
		};

		const row = (content: string) => th.fg("border", "│") + pad(content, innerW) + th.fg("border", "│");
		const borderTop = th.fg("border", `╭${"─".repeat(innerW)}╮`);
		const borderSep = th.fg("border", `├${"─".repeat(innerW)}┤`);
		const borderBottom = th.fg("border", `╰${"─".repeat(innerW)}╯`);

		// ── Title bar ──
		const title = ` ${th.fg("accent", th.bold(this.opts.title))}  ${th.fg("dim", `(${this.opts.subtitle})`)}`;
		lines.push(borderTop);
		lines.push(row(title));

		// ── Search bar or separator ──
		if (this.searchMode) {
			const searchContent = ` ${th.fg("accent", "/")} ${this.searchQuery}${th.fg("dim", "▏")}`;
			lines.push(row(searchContent));
		} else if (this.searchMatches.length > 0) {
			const matchInfo = ` ${th.fg("accent", "/")} ${th.fg("text", this.searchQuery)} ${th.fg("dim", "—")} ${th.fg("accent", `${this.currentMatchIndex + 1}/${this.searchMatches.length}`)}`;
			lines.push(row(matchInfo));
		} else {
			lines.push(borderSep);
		}

		// ── Content lines ──
		const maxScroll = Math.max(0, this.opts.displayLines.length - this.visibleLines);
		this.scrollOffset = Math.min(this.scrollOffset, maxScroll);
		this.scrollOffset = Math.max(0, this.scrollOffset);

		for (let i = 0; i < this.visibleLines; i++) {
			const lineIdx = this.scrollOffset + i;
			if (lineIdx < this.opts.displayLines.length) {
				let line = this.opts.displayLines[lineIdx]!;

				const isCurrentMatch =
					this.searchMatches.length > 0 &&
					this.currentMatchIndex >= 0 &&
					this.searchMatches[this.currentMatchIndex] === lineIdx;
				const isOtherMatch =
					this.searchMatches.length > 0 && this.searchMatches.includes(lineIdx) && !isCurrentMatch;

				if (isCurrentMatch) {
					line = th.bg("selectedBg", truncateToWidth(line, innerW));
				} else if (isOtherMatch) {
					line = th.fg("warning", truncateToWidth(line, innerW));
				} else {
					line = truncateToWidth(line, innerW);
				}

				lines.push(row(line));
			} else {
				lines.push(row(th.fg("dim", "~")));
			}
		}

		// ── Footer ──
		lines.push(borderSep);

		const scrollPercent =
			this.opts.displayLines.length <= this.visibleLines
				? "All"
				: this.scrollOffset === 0
					? "Top"
					: this.scrollOffset >= maxScroll
						? "Bot"
						: `${Math.round(((this.scrollOffset + this.visibleLines) / this.opts.displayLines.length) * 100)}%`;

		let statusLeft = th.fg(
			"dim",
			` ${this.scrollOffset + 1}-${Math.min(this.scrollOffset + this.visibleLines, this.opts.displayLines.length)} of ${this.opts.displayLines.length} [${scrollPercent}] `,
		);

		if (this.copyFlash) {
			statusLeft += th.fg("success", "✓ Copied! ");
		}

		const helpItems = ["↑↓ scroll", "/ search", "n/N next", "y copy", "q close"];
		const helpText = th.fg("dim", helpItems.join(" · "));

		lines.push(row(statusLeft + helpText));
		lines.push(borderBottom);

		return lines;
	}

	invalidate(): void {
		// No cached state to clear — rebuilds from opts every render
	}
}
