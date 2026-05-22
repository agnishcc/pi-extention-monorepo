/**
 * edb-quit-summary
 *
 * Prints a session summary to the terminal when you quit pi.
 * Uses process.on('exit') to print after the TUI alternate screen buffer
 * is restored, so the summary is visible in the user's terminal.
 *
 * Layout: raccoon ASCII art on the left, stats on the right.
 * Dynamically scales to terminal width — hides art on narrow terminals,
 * shrinks bars to fit available space.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ── ANSI helpers ───────────────────────────────────────────────────────────────

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const MAGENTA = "\x1b[35m";
const BLUE = "\x1b[34m";
const WHITE = "\x1b[37m";

const b = (t: string) => `${BOLD}${t}${RESET}`;
const d = (t: string) => `${DIM}${t}${RESET}`;
const c = (t: string) => `${CYAN}${t}${RESET}`;
const g = (t: string) => `${GREEN}${t}${RESET}`;
const y = (t: string) => `${YELLOW}${t}${RESET}`;
const m = (t: string) => `${MAGENTA}${t}${RESET}`;
const bl = (t: string) => `${BLUE}${t}${RESET}`;
const w = (t: string) => `${WHITE}${t}${RESET}`;

// ── Raccoon ────────────────────────────────────────────────────────────────────
//
// 9 lines. Each entry has:
//   text    — plain text (used for width measurement)
//   colored — ANSI-coloured version
// All text fields are exactly 12 visible chars.

const RACCOON: { text: string; colored: string }[] = [
	{ text: "   /\\  /\\   ", colored: `   ${d("/\\")}  ${d("/\\")}   ` },
	{ text: "  (  oo  )  ", colored: `  ( ${b(" oo ")} )  ` },
	{ text: " ( ,-___-, )", colored: ` ( ,${d("_____")}, )` },
	{ text: "  \\_______/ ", colored: `  ${d("\\______/")}  ` },
	{ text: "  /       \\ ", colored: `  /       \\  ` },
	{ text: " ( | | | | )", colored: ` ( ${d("| | | |")} )` },
	{ text: "  \\ ===== / ", colored: `  \\ ${d("=====")} /  ` },
	{ text: "   \\     /  ", colored: `   \\     /   ` },
	{ text: "    `---'   ", colored: `    \`---'    ` },
];

// ── Formatters ─────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s`;
	const mn = Math.floor(s / 60),
		sec = s % 60;
	if (mn < 60) return sec > 0 ? `${mn}m ${sec}s` : `${mn}m`;
	const h = Math.floor(mn / 60),
		min = mn % 60;
	return min > 0 ? `${h}h ${min}m` : `${h}h`;
}

function formatCost(cost: number): string {
	if (cost < 0.001) return "$0.00";
	if (cost < 0.01) return `$${cost.toFixed(3)}`;
	return `$${cost.toFixed(2)}`;
}

function formatTokens(n: number): string {
	if (n < 1_000) return `${n}`;
	if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}k`;
	return `${(n / 1_000_000).toFixed(2)}M`;
}

/** Strip ANSI escape codes; return visible character count. */
function visLen(s: string): number {
	return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

/** Pad/truncate a string (which may contain ANSI) to an exact visible width. */
function padTo(s: string, width: number): string {
	const vis = visLen(s);
	if (vis >= width) return s;
	return s + " ".repeat(width - vis);
}

/** Truncate a plain string to a max length, appending "…" if truncated. */
function truncate(s: string, max: number): string {
	if (s.length <= max) return s;
	return s.slice(0, max - 1) + "…";
}

// ── Stats collection ───────────────────────────────────────────────────────────

interface SessionStats {
	sessionName: string | undefined;
	sessionId: string | undefined;
	startTime: number;
	endTime: number;
	userMessages: number;
	assistantMessages: number;
	toolCalls: number;
	toolCounts: Map<string, number>;
	inputTokens: number;
	outputTokens: number;
	cacheRead: number;
	cacheWrite: number;
	totalCost: number;
	model: string;
	provider: string;
}

function collectStats(ctx: any): SessionStats {
	const entries: any[] = ctx.sessionManager.getEntries();
	const sessionName: string | undefined = ctx.sessionManager.getSessionName?.();
	const sessionId: string | undefined = ctx.sessionManager.getSessionId?.();

	let startTime = 0;
	let endTime = 0;
	let userMessages = 0;
	let assistantMessages = 0;
	let toolCalls = 0;
	const toolCounts = new Map<string, number>();
	let inputTokens = 0;
	let outputTokens = 0;
	let cacheRead = 0;
	let cacheWrite = 0;
	let totalCost = 0;
	let lastModel = "";
	let lastProvider = "";

	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const msg = entry.message;
		const ts: number = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;

		if (ts > 0) {
			if (startTime === 0 || ts < startTime) startTime = ts;
			if (ts > endTime) endTime = ts;
		}

		if (msg.role === "user") {
			userMessages++;
		} else if (msg.role === "assistant") {
			assistantMessages++;
			if (msg.usage) {
				inputTokens += msg.usage.input ?? 0;
				outputTokens += msg.usage.output ?? 0;
				cacheRead += msg.usage.cacheRead ?? 0;
				cacheWrite += msg.usage.cacheWrite ?? 0;
				if (msg.usage.cost) totalCost += msg.usage.cost.total ?? 0;
			}
			if (Array.isArray(msg.content)) {
				for (const block of msg.content) {
					if (block.type === "toolCall") {
						toolCalls++;
						const name: string = block.name ?? "unknown";
						toolCounts.set(name, (toolCounts.get(name) ?? 0) + 1);
					}
				}
			}
			if (msg.provider) lastProvider = msg.provider;
			if (msg.model) lastModel = msg.model;
		}
	}

	return {
		sessionName,
		sessionId,
		startTime,
		endTime,
		userMessages,
		assistantMessages,
		toolCalls,
		toolCounts,
		inputTokens,
		outputTokens,
		cacheRead,
		cacheWrite,
		totalCost,
		model: lastModel,
		provider: lastProvider,
	};
}

// ── Stat rows ─────────────────────────────────────────────────────────────────
//
// Two row types:
//   info  — label + free-form value (session name, model, tool list, etc.)
//   bar   — label + right-padded numeric value + fill bar
//   spacer — empty separator line

type StatRowType = "info" | "spacer";

interface StatRow {
	type: StatRowType;
	label: string; // coloured label
	value: string; // coloured value
}

function buildStatRows(s: SessionStats): StatRow[] {
	const rows: StatRow[] = [];
	const duration = s.endTime > 0 && s.startTime > 0 ? s.endTime - s.startTime : 0;
	const totalTok = s.inputTokens + s.outputTokens + s.cacheRead + s.cacheWrite;

	if (s.sessionName) {
		rows.push({ type: "info", label: c("session"), value: b(truncate(s.sessionName, 40)) });
	}
	rows.push({ type: "info", label: c("duration"), value: w(formatDuration(duration)) });
	if (s.model) {
		const modelStr = s.provider
			? `${d(truncate(s.provider, 12) + "/")}${truncate(s.model, 24)}`
			: truncate(s.model, 28);
		rows.push({ type: "info", label: c("model"), value: modelStr });
	}

	rows.push({ type: "spacer", label: "", value: "" });

	rows.push({
		type: "info",
		label: c("messages"),
		value: `${g(String(s.userMessages))} user  ${bl(String(s.assistantMessages))} asst`,
	});

	if (s.toolCalls > 0) {
		const topTools = Array.from(s.toolCounts.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, 3)
			.map(([n, cnt]) => `${n}${d(" " + String(cnt) + "\u00d7")}`)
			.join("  ");
		rows.push({
			type: "info",
			label: c("tools"),
			value: `${b(String(s.toolCalls))}  ${topTools}`,
		});
	}

	rows.push({ type: "spacer", label: "", value: "" });

	if (totalTok > 0) {
		rows.push({ type: "info", label: c("input"), value: y(formatTokens(s.inputTokens)) });
		rows.push({ type: "info", label: c("output"), value: g(formatTokens(s.outputTokens)) });
		if (s.cacheRead > 0) {
			rows.push({ type: "info", label: c("c.read"), value: bl(formatTokens(s.cacheRead)) });
		}
		if (s.cacheWrite > 0) {
			rows.push({ type: "info", label: c("c.write"), value: d(formatTokens(s.cacheWrite)) });
		}
		rows.push({ type: "info", label: c("total"), value: b(formatTokens(totalTok)) });
	}

	if (s.totalCost > 0) {
		rows.push({ type: "spacer", label: "", value: "" });
		const costCol = s.totalCost < 1 ? g : s.totalCost < 5 ? y : m;
		rows.push({ type: "info", label: c("cost"), value: b(costCol(formatCost(s.totalCost))) });
	}

	// Resume command
	if (s.sessionId) {
		rows.push({ type: "spacer", label: "", value: "" });
		rows.push({ type: "info", label: c("resume"), value: d(`pi --resume=${s.sessionId}`) });
	}

	return rows;
}

// ── Renderer ───────────────────────────────────────────────────────────────────

function render(stats: SessionStats): string {
	const termWidth = process.stdout.columns || 80;

	// Raccoon art metrics
	const artVisW = Math.max(...RACCOON.map((l) => visLen(l.text)));
	const artGutter = 3;
	const artTotal = artVisW + artGutter;

	// Show art only when there's at least 48 chars remaining for stats
	const showArt = termWidth >= artTotal + 48;

	// Build rows
	const rows = buildStatRows(stats);

	const maxLabelW = Math.max(0, ...rows.filter((r) => r.type !== "spacer").map((r) => visLen(r.label)));

	// Format each stat line: label (padded) + 2 spaces + value
	const statLines: string[] = rows.map((row) => {
		if (row.type === "spacer") return "";
		const lPad = padTo(row.label, maxLabelW);
		return `${lPad}  ${row.value}`;
	});

	// Max visible width of stat block
	const maxStatVis = Math.max(0, ...statLines.map((l) => visLen(l)));

	// Final box dimensions
	const contentW = showArt ? artTotal + maxStatVis : maxStatVis;
	const boxInner = Math.min(contentW + 2, termWidth - 2);
	const hLine = "─".repeat(boxInner);

	// Merge art + stat lines
	const totalLines = Math.max(RACCOON.length, statLines.length);
	const bodyLines: string[] = [];

	for (let i = 0; i < totalLines; i++) {
		let line = "";

		if (showArt) {
			const artColored = i < RACCOON.length ? RACCOON[i]!.colored : "";
			const artVisW_ = i < RACCOON.length ? visLen(RACCOON[i]!.text) : 0;
			const gap = artTotal - artVisW_;
			line += artColored + " ".repeat(Math.max(0, gap));
		}

		line += i < statLines.length ? statLines[i]! : "";
		bodyLines.push(padTo(` ${line}`, boxInner));
	}

	// Output
	const out: string[] = [];
	out.push("");
	out.push(d(`╭${hLine}╮`));
	for (const bLine of bodyLines) {
		out.push(`${d("│")}${bLine}${d("│")}`);
	}
	out.push(d(`╰${hLine}╯`));
	out.push("");

	return out.join("\n");
}

// ── Extension ──────────────────────────────────────────────────────────────────

export default function quitSummaryExtension(pi: ExtensionAPI): void {
	pi.on("session_shutdown", async (event, ctx) => {
		if (event.reason !== "quit") return;

		const stats = collectStats(ctx);
		const output = render(stats);

		// process.on('exit') fires after the TUI teardown restores the original
		// terminal buffer — the summary is visible in the user's shell.
		process.on("exit", () => {
			process.stdout.write(output);
		});
	});
}
