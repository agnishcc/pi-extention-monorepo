/**
 * StatsTabContent — token distribution grid + category breakdown table.
 *
 * Shows a compact model/context summary, then a colored 10×5 grid beside an
 * estimated per-category usage breakdown. The final grid segment is reserved for
 * Pi's auto-compaction response buffer.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { TabContent } from "./tabbed-overlay.js";
import { formatTokens } from "./utils.js";

const GRID_WIDTH = 10;
const GRID_HEIGHT = 5;
const TOTAL_BLOCKS = GRID_WIDTH * GRID_HEIGHT; // 50 blocks = 2% each

const ANSI_RESET = "\x1b[0m";
const ANSI_BOLD = "\x1b[1m";

function fg(hex: string, text: string): string {
	const normalized = hex.replace("#", "");
	const r = Number.parseInt(normalized.slice(0, 2), 16);
	const g = Number.parseInt(normalized.slice(2, 4), 16);
	const b = Number.parseInt(normalized.slice(4, 6), 16);
	return `\x1b[38;2;${r};${g};${b}m${text}${ANSI_RESET}`;
}

function bold(text: string): string {
	return `${ANSI_BOLD}${text}${ANSI_RESET}`;
}

export interface ContextTokenBreakdown {
	total: number;
	contextWindow: number;
	percent: number;
	reserveTokens: number;
	safeAvailable: number;
	systemPrompt: number;
	systemTools: number;
	tools: number;
	skills: number;
	messages: number;
	other: number;
}

export interface StatsModelInfo {
	name: string;
	contextWindow?: number;
}

interface Category {
	key: keyof Pick<
		ContextTokenBreakdown,
		"systemPrompt" | "systemTools" | "tools" | "skills" | "messages" | "safeAvailable" | "reserveTokens"
	>;
	label: string;
	icon: string;
	fallbackIcon: string;
	value: number;
	hex: string;
	block: string;
	includeInGrid: boolean;
}

const CATEGORY_META = {
	systemPrompt: {
		label: "System prompt",
		icon: "󰈙",
		fallbackIcon: "●",
		hex: "#A78BFA",
		block: "󰈙",
	},
	systemTools: {
		label: "System tools",
		icon: "󰒓",
		fallbackIcon: "◆",
		hex: "#22D3EE",
		block: "󰒓",
	},
	tools: {
		label: "Tools",
		icon: "󰐥",
		fallbackIcon: "▲",
		hex: "#34D399",
		block: "󰐥",
	},
	skills: {
		label: "Skills",
		icon: "󰌵",
		fallbackIcon: "✦",
		hex: "#FBBF24",
		block: "󰌵",
	},
	messages: {
		label: "Messages",
		icon: "󰍩",
		fallbackIcon: "■",
		hex: "#60A5FA",
		block: "󰍩",
	},
	safeAvailable: {
		label: "Available",
		icon: "󰋙",
		fallbackIcon: "□",
		hex: "#6B7280",
		block: "󰋙",
	},
	reserveTokens: {
		label: "Auto-compact buffer",
		icon: "󰅐",
		fallbackIcon: "▨",
		hex: "#FB923C",
		block: "󰅐",
	},
} as const;

export class StatsTabContent implements TabContent {
	readonly name = "Stats";
	readonly footerHints = "";

	constructor(
		private breakdown: ContextTokenBreakdown | null,
		private theme: Theme,
		private modelInfo?: StatsModelInfo,
	) {}

	/** Stats view has no interactive search bar — always use border separator. */
	getAboveContentLine(_innerWidth: number): string | null {
		return null;
	}

	getFooterLeft(): string {
		if (!this.breakdown) return "";
		const { total, contextWindow, percent, safeAvailable } = this.breakdown;
		return `${formatTokens(total)} / ${formatTokens(contextWindow)} (${percent.toFixed(1)}%) · ${formatTokens(safeAvailable)} safe left`;
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

		const { total, contextWindow, percent, reserveTokens, safeAvailable } = this.breakdown;
		const modelName = this.modelInfo?.name ?? "unknown model";
		const safeLeftText =
			safeAvailable > 0 ? `${formatTokens(safeAvailable)} safe left` : "auto-compact threshold reached";

		const categories = this.getCategories();
		const gridLines = this.renderGrid(categories);
		const breakdownLines = this.renderBreakdown(categories);

		const lines: string[] = [
			`  ${bold(`${modelName} · ${formatTokens(total)}/${formatTokens(contextWindow)} tokens (${percent.toFixed(1)}%)`)} ${th.fg("dim", `· ${safeLeftText}`)}`,
			"",
			"",
			`  ${th.fg("dim", "Estimated usage by category")}`,
			"",
		];

		const GRID_VIS_W = GRID_WIDTH * 2 - 1;
		const maxRows = Math.max(gridLines.length, breakdownLines.length);
		for (let i = 0; i < maxRows; i++) {
			const leftRaw = gridLines[i] ?? "";
			const leftVisW = visibleWidth(leftRaw);
			const pad = " ".repeat(Math.max(0, GRID_VIS_W - leftVisW));
			const right = breakdownLines[i] ?? "";
			lines.push(`    ${leftRaw}${pad}    ${right}`);
		}

		if (safeAvailable <= 0) {
			lines.push("");
			lines.push(`  ${fg(CATEGORY_META.reserveTokens.hex, "Auto-compact buffer is being used")}`);
		} else {
			lines.push("");
			lines.push(
				`  ${th.fg("dim", `Auto-compact starts after ${formatTokens(contextWindow - reserveTokens)} tokens`)}`,
			);
		}

		while (lines.length < height) lines.push("");
		return lines.slice(0, height);
	}

	private getCategories(): Category[] {
		const b = this.breakdown!;
		return [
			this.category("systemPrompt", b.systemPrompt, true),
			this.category("systemTools", b.systemTools, true),
			this.category("tools", b.tools, true),
			this.category("skills", b.skills, true),
			this.category("messages", b.messages + b.other, true),
			this.category("safeAvailable", b.safeAvailable, true),
			this.category("reserveTokens", b.reserveTokens, true),
		];
	}

	private category(key: Category["key"], value: number, includeInGrid: boolean): Category {
		const meta = CATEGORY_META[key];
		return { key, value, includeInGrid, ...meta };
	}

	private renderGrid(categories: Category[]): string[] {
		const blocks: string[] = [];
		const { contextWindow, reserveTokens } = this.breakdown!;
		const reserveBlockCount = Math.max(1, Math.round((reserveTokens / contextWindow) * TOTAL_BLOCKS));
		const safeBlockCount = Math.max(0, TOTAL_BLOCKS - reserveBlockCount);
		const safeWindow = Math.max(1, contextWindow - reserveTokens);
		const safeCategories = categories.filter((cat) => cat.key !== "reserveTokens");

		for (const cat of safeCategories) {
			let count = Math.round((cat.value / safeWindow) * safeBlockCount);
			if (count === 0 && cat.value > 0) count = 1;
			for (let j = 0; j < count && blocks.length < safeBlockCount; j++) {
				blocks.push(fg(cat.hex, cat.block));
			}
		}

		while (blocks.length < safeBlockCount) {
			blocks.push(fg(CATEGORY_META.safeAvailable.hex, CATEGORY_META.safeAvailable.block));
		}

		for (let i = 0; i < reserveBlockCount && blocks.length < TOTAL_BLOCKS; i++) {
			blocks.push(fg(CATEGORY_META.reserveTokens.hex, CATEGORY_META.reserveTokens.block));
		}

		const gridLines: string[] = [];
		for (let r = 0; r < GRID_HEIGHT; r++) {
			let row = "";
			for (let c = 0; c < GRID_WIDTH; c++) {
				row += blocks[r * GRID_WIDTH + c] ?? fg(CATEGORY_META.safeAvailable.hex, CATEGORY_META.safeAvailable.block);
				if (c < GRID_WIDTH - 1) row += " ";
			}
			gridLines.push(row);
		}
		return gridLines;
	}

	private renderBreakdown(categories: Category[]): string[] {
		const LABEL_W = 21;
		const TOKEN_W = 7;

		return categories.map((cat) => {
			const pct = this.breakdown!.contextWindow > 0 ? (cat.value / this.breakdown!.contextWindow) * 100 : 0;
			const icon = fg(cat.hex, cat.icon);
			const label = fg(cat.hex, cat.label.padEnd(LABEL_W));
			const tokens = fg(cat.hex, formatTokens(cat.value).padStart(TOKEN_W));
			const percent = this.theme.fg("dim", `(${pct.toFixed(1).padStart(5)}%)`);
			return `${icon} ${label} ${tokens} ${percent}`;
		});
	}
}
