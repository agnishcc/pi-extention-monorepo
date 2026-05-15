/**
 * StatsTabContent — token distribution grid + category breakdown table.
 *
 * Adapts the visual dashboard from pi-context (github.com/ttttmr/pi-context)
 * for use inside TabbedOverlay. Shows a colored 10×5 block grid on the left and
 * a per-category token breakdown on the right.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { TabContent } from "./tabbed-overlay.js";
import { formatTokens } from "./utils.js";

const GRID_WIDTH = 10;
const GRID_HEIGHT = 5;
const TOTAL_BLOCKS = GRID_WIDTH * GRID_HEIGHT; // 50 blocks = 2% each

export interface ContextTokenBreakdown {
	total: number;
	contextWindow: number;
	percent: number;
	systemPrompt: number;
	systemTools: number;
	toolCalls: number;
	messages: number;
	other: number;
}

interface Category {
	label: string;
	value: number;
	color: string;
}

export class StatsTabContent implements TabContent {
	readonly name = "Stats";
	readonly footerHints = "";

	constructor(
		private breakdown: ContextTokenBreakdown | null,
		private theme: Theme,
	) {}

	/** Stats view has no interactive search bar — always use border separator. */
	getAboveContentLine(_innerWidth: number): string | null {
		return null;
	}

	getFooterLeft(): string {
		if (!this.breakdown) return "";
		const { total, contextWindow, percent } = this.breakdown;
		return `${formatTokens(total)} / ${formatTokens(contextWindow)} (${percent.toFixed(1)}%)`;
	}

	/** Stats view has no keyboard interactions. */
	handleInput(_data: string): boolean {
		return false;
	}

	invalidate(): void {}

	renderContent(_innerWidth: number, height: number): string[] {
		const th = this.theme;

		if (!this.breakdown) {
			const lines: string[] = [
				"",
				`  ${th.fg("warning", "No context usage data available.")}`,
				`  ${th.fg("dim", "Send a message first, then re-open /context-viewer.")}`,
			];
			while (lines.length < height) lines.push("");
			return lines;
		}

		const { total, contextWindow, percent, systemPrompt, systemTools, toolCalls, messages, other } = this.breakdown;

		const categories: Category[] = [
			{ label: "System Prompt", value: systemPrompt, color: "muted" },
			{ label: "System Tools", value: systemTools, color: "dim" },
			{ label: "Tool Calls", value: toolCalls, color: "success" },
			{ label: "Messages", value: messages, color: "accent" },
		];

		if (other > 10) {
			categories.push({ label: "Other", value: other, color: "dim" });
		}

		const available = Math.max(0, contextWindow - total);

		// ── Build grid blocks ────────────────────────────────────────────────────
		const blocks: { color: string; filled: boolean }[] = [];
		for (const cat of categories) {
			let count = Math.round((cat.value / contextWindow) * TOTAL_BLOCKS);
			if (count === 0 && cat.value > 0) count = 1;
			for (let i = 0; i < count && blocks.length < TOTAL_BLOCKS; i++) {
				blocks.push({ color: cat.color, filled: true });
			}
		}
		while (blocks.length < TOTAL_BLOCKS) {
			blocks.push({ color: "borderMuted", filled: false });
		}

		// ── Render grid rows ─────────────────────────────────────────────────────
		const gridLines: string[] = [];
		for (let r = 0; r < GRID_HEIGHT; r++) {
			let row = "";
			for (let c = 0; c < GRID_WIDTH; c++) {
				const b = blocks[r * GRID_WIDTH + c]!;
				row += th.fg(b.color as Parameters<typeof th.fg>[0], b.filled ? "■" : "□");
				if (c < GRID_WIDTH - 1) row += " ";
			}
			gridLines.push(row);
		}

		// ── Build legend ─────────────────────────────────────────────────────────
		const LABEL_W = 14;
		const TOKEN_W = 7;

		const legendLines: string[] = [];

		// Total usage line (bold, no icon)
		legendLines.push(
			`  ${th.bold(th.fg("text", "Total Usage".padEnd(LABEL_W + 2)))} ` +
				`${th.fg("accent", formatTokens(total).padStart(TOKEN_W))} ` +
				`${th.fg("dim", `(${percent.toFixed(1).padStart(5)}%)`)}`,
		);
		legendLines.push(""); // blank separator before categories

		// Per-category lines
		for (const cat of categories) {
			const pct = ((cat.value / contextWindow) * 100).toFixed(1);
			legendLines.push(
				`${th.fg(cat.color as Parameters<typeof th.fg>[0], "■")} ` +
					`${th.fg("text", cat.label.padEnd(LABEL_W))} ` +
					`${th.fg("accent", formatTokens(cat.value).padStart(TOKEN_W))} ` +
					`${th.fg("dim", `(${pct.padStart(5)}%)`)}`,
			);
		}

		// Available line
		const availPct = ((available / contextWindow) * 100).toFixed(1);
		legendLines.push(
			`${th.fg("borderMuted" as Parameters<typeof th.fg>[0], "□")} ` +
				`${th.fg("dim", "Available".padEnd(LABEL_W))} ` +
				`${th.fg("dim", formatTokens(available).padStart(TOKEN_W))} ` +
				`${th.fg("dim", `(${availPct.padStart(5)}%)`)}`,
		);

		// ── Combine grid + legend side by side ───────────────────────────────────
		// Grid visible width: GRID_WIDTH * 2 - 1 (each "■ " or "□ " = 2, minus trailing space)
		const GRID_VIS_W = GRID_WIDTH * 2 - 1;
		const maxRows = Math.max(gridLines.length, legendLines.length);

		const combined: string[] = [];
		combined.push(""); // top padding

		for (let i = 0; i < maxRows; i++) {
			const leftRaw = gridLines[i] ?? "";
			const leftVisW = visibleWidth(leftRaw);
			const pad = " ".repeat(Math.max(0, GRID_VIS_W - leftVisW));
			const right = legendLines[i] ?? "";
			combined.push(`    ${leftRaw}${pad}    ${right}`);
		}

		combined.push(""); // bottom padding

		// Fill or truncate to content height
		const result: string[] = [];
		for (let i = 0; i < height; i++) {
			result.push(combined[i] ?? "");
		}
		return result;
	}
}
