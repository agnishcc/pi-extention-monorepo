/**
 * TabbedOverlay — a bordered overlay with a tab bar at the top.
 *
 * Manages multiple tab views (StatsTabContent, ScrollableTabContent) and renders
 * the full frame (title, tab bar, borders, footer). Each tab handles its own content
 * rendering and keyboard input.
 *
 * Navigation:
 *   Tab / Shift+Tab  → cycle between tabs
 *   Escape / q       → close the overlay (unless a tab has intercepted the key)
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/** Number of lines shown in the content area of each tab. */
export const CONTENT_HEIGHT = 28;

/**
 * Interface that each tab must implement.
 *
 * Key contract: `handleInput` returns `true` if the key was consumed (so the
 * outer overlay won't act on it). This lets content tabs swallow Escape when
 * in search mode rather than closing the overlay.
 */
export interface TabContent {
	readonly name: string;

	/**
	 * Returns a styled string to render between the tab bar and the content area,
	 * or `null` to render a plain border separator.
	 * Used by scrollable tabs for the live search / match-info row.
	 */
	getAboveContentLine(innerWidth: number): string | null;

	/** Render exactly `height` lines of content. */
	renderContent(innerWidth: number, height: number): string[];

	/** Left portion of the footer row (e.g. scroll position, copy flash). */
	getFooterLeft(): string;

	/** Hint items shown in the footer (right side). Omit Tab / q hints — they are added by TabbedOverlay. */
	readonly footerHints: string;

	/**
	 * Handle a keyboard event. Return `true` if consumed (prevents TabbedOverlay
	 * from acting on the key), `false` to let the outer overlay handle it.
	 */
	handleInput(data: string): boolean;

	/** Reset any cached rendering state. */
	invalidate(): void;
}

export interface TabbedOverlayOptions {
	/** Title text shown in the top header row. */
	title: string;
	/** Subtitle / stats text shown dimmed after the title. */
	subtitle: string;
	/** Ordered list of tab views. */
	tabs: TabContent[];
	/** Active theme. */
	theme: Theme;
	/** Called when the user closes the overlay (Escape / q). */
	done: () => void;
}

export class TabbedOverlay {
	private activeTabIndex = 0;

	constructor(private opts: TabbedOverlayOptions) {}

	private get activeTab(): TabContent {
		return this.opts.tabs[this.activeTabIndex]!;
	}

	handleInput(data: string): void {
		// Tab / Shift+Tab always switch tabs (not delegated to content).
		if (matchesKey(data, Key.tab)) {
			this.activeTabIndex = (this.activeTabIndex + 1) % this.opts.tabs.length;
			return;
		}
		if (matchesKey(data, Key.shift("tab"))) {
			this.activeTabIndex = (this.activeTabIndex - 1 + this.opts.tabs.length) % this.opts.tabs.length;
			return;
		}

		// Delegate to the active tab first. If it consumes the key, stop.
		const consumed = this.activeTab.handleInput(data);
		if (consumed) return;

		// Outer-level: close the overlay.
		if (matchesKey(data, Key.escape) || data === "q") {
			this.opts.done();
		}
	}

	render(width: number): string[] {
		const th = this.opts.theme;
		const innerW = width - 2;
		const lines: string[] = [];

		// ANSI-aware padding: pad styled string to `len` visible columns.
		const pad = (s: string, len: number) => s + " ".repeat(Math.max(0, len - visibleWidth(s)));

		const row = (content: string) => th.fg("border", "│") + pad(content, innerW) + th.fg("border", "│");
		const borderTop = th.fg("border", `╭${"─".repeat(innerW)}╮`);
		const borderSep = th.fg("border", `├${"─".repeat(innerW)}┤`);
		const borderBottom = th.fg("border", `╰${"─".repeat(innerW)}╯`);

		// ── Top border ──────────────────────────────────────────────────────────
		lines.push(borderTop);

		// ── Title row ───────────────────────────────────────────────────────────
		const title = ` ${th.fg("accent", th.bold(this.opts.title))}  ${th.fg("dim", `(${this.opts.subtitle})`)}`;
		lines.push(row(title));

		// ── Tab bar ─────────────────────────────────────────────────────────────
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

		// ── Above-content row (search bar or border) ─────────────────────────────
		const aboveLine = this.activeTab.getAboveContentLine(innerW);
		if (aboveLine !== null) {
			lines.push(row(` ${aboveLine}`));
		} else {
			lines.push(borderSep);
		}

		// ── Content area ─────────────────────────────────────────────────────────
		const contentLines = this.activeTab.renderContent(innerW, CONTENT_HEIGHT);
		for (let i = 0; i < CONTENT_HEIGHT; i++) {
			if (i < contentLines.length) {
				lines.push(row(truncateToWidth(contentLines[i]!, innerW)));
			} else {
				lines.push(row(th.fg("dim", "~")));
			}
		}

		// ── Footer ───────────────────────────────────────────────────────────────
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
