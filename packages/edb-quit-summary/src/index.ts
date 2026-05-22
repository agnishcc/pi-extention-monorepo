/**
 * edb-quit-summary
 *
 * Prints a session summary to the terminal when you quit pi.
 * Uses process.on('exit') to print after the TUI alternate screen buffer
 * is restored, so the summary is visible in the user's terminal.
 *
 * Layout: understated title, raccoon ASCII art on the left, stats on the right.
 * Dynamically scales to terminal width — hides art on narrow terminals.
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

// ── Raccoon mark ───────────────────────────────────────────────────────────────
//
// Small, understated raccoon mask. Each entry has:
//   text    — plain text (used for width measurement)
//   colored — ANSI-coloured version

const RACCOON: { text: string; colored: string }[] = [
	{ text: "  /\\_/\\  ", colored: `  ${d("/\\_/\\")}  ` },
	{ text: " < ▓ ▓ > ", colored: ` < ${d("▓")} ${d("▓")} > ` },
	{ text: "   \\___/  ", colored: `   ${d("\\___/")}  ` },
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
	return `${s.slice(0, max - 1)}…`;
}

/** Truncate an ANSI string to a max visible length, preserving escape codes. */
function truncateAnsi(s: string, max: number): string {
	if (max <= 0) return "";
	if (visLen(s) <= max) return s;

	let out = "";
	let visible = 0;
	const target = Math.max(0, max - 1);

	for (let i = 0; i < s.length && visible < target; i++) {
		if (s[i] === "\x1b") {
			const end = s.indexOf("m", i);
			if (end === -1) break;
			out += s.slice(i, end + 1);
			i = end;
			continue;
		}

		out += s[i];
		visible++;
	}

	return `${out}${RESET}…`;
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
		rows.push({ type: "info", label: d("Session"), value: b(truncate(s.sessionName, 42)) });
	}
	rows.push({ type: "info", label: d("Duration"), value: w(formatDuration(duration)) });
	if (s.model) {
		const modelStr = s.provider
			? `${d(`${truncate(s.provider, 12)}/`)}${truncate(s.model, 28)}`
			: truncate(s.model, 34);
		rows.push({ type: "info", label: d("Model"), value: modelStr });
	}

	rows.push({ type: "spacer", label: "", value: "" });
	rows.push({
		type: "info",
		label: d("Messages"),
		value: `${g(String(s.userMessages))} user ${d("/")} ${bl(String(s.assistantMessages))} assistant`,
	});

	if (s.toolCalls > 0) {
		const topTools = Array.from(s.toolCounts.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, 4)
			.map(([name, count]) => `${truncate(name, 12)} ${d(`${count}×`)}`)
			.join(d("  ·  "));
		rows.push({
			type: "info",
			label: d("Tools"),
			value: `${b(String(s.toolCalls))}${topTools ? d("  ·  ") + topTools : ""}`,
		});
	}

	if (totalTok > 0) {
		rows.push({ type: "spacer", label: "", value: "" });
		rows.push({
			type: "info",
			label: d("Tokens"),
			value: `${b(formatTokens(totalTok))} ${d("total")}  ${y(formatTokens(s.inputTokens))} ${d("in")}  ${g(formatTokens(s.outputTokens))} ${d("out")}`,
		});
		if (s.cacheRead > 0 || s.cacheWrite > 0) {
			rows.push({
				type: "info",
				label: d("Cache"),
				value: `${bl(formatTokens(s.cacheRead))} ${d("read")}  ${d(formatTokens(s.cacheWrite))} ${d("write")}`,
			});
		}
	}

	if (s.totalCost > 0) {
		const costCol = s.totalCost < 1 ? g : s.totalCost < 5 ? y : m;
		rows.push({ type: "info", label: d("Cost"), value: b(costCol(formatCost(s.totalCost))) });
	}

	if (s.sessionId) {
		rows.push({ type: "spacer", label: "", value: "" });
		rows.push({ type: "info", label: d("Resume"), value: d(`pi --resume=${s.sessionId}`) });
	}

	return rows;
}

// ── Renderer ───────────────────────────────────────────────────────────────────

function render(stats: SessionStats): string {
	const termWidth = process.stdout.columns || 80;
	const margin = termWidth >= 72 ? "  " : "";
	const availableWidth = Math.max(32, termWidth - visLen(margin) * 2);

	const rows = buildStatRows(stats);
	const maxLabelW = Math.max(0, ...rows.filter((row) => row.type !== "spacer").map((row) => visLen(row.label)));
	const rawStatLines = rows.map((row) => {
		if (row.type === "spacer") return "";
		return `${padTo(row.label, maxLabelW)}  ${row.value}`;
	});

	const artWidth = Math.max(...RACCOON.map((line) => visLen(line.text)));
	const gapWidth = 4;
	const minStatWidth = 32;
	const artFits = availableWidth >= artWidth + gapWidth + minStatWidth;
	const statWidth = artFits ? availableWidth - artWidth - gapWidth : availableWidth;
	const statLines = rawStatLines.map((line) => truncateAnsi(line, statWidth));

	const bodyWidth = artFits
		? artWidth + gapWidth + Math.max(0, ...statLines.map((line) => visLen(line)))
		: Math.max(0, ...statLines.map((line) => visLen(line)));
	const title = `${b(c("Session Summary"))} ${d("/ quit")}`;
	const ruleWidth = Math.min(availableWidth, Math.max(28, visLen(title), bodyWidth));
	const rule = d("─".repeat(ruleWidth));

	const out: string[] = ["", `${margin}${title}`, `${margin}${rule}`];

	if (!artFits) {
		for (const line of statLines) {
			out.push(line ? `${margin}${line}` : "");
		}
		out.push("");
		return out.join("\n");
	}

	const artHeight = RACCOON.length;
	const statHeight = statLines.length;
	const totalLines = Math.max(artHeight, statHeight);
	const artTop = Math.floor((totalLines - artHeight) / 2);
	const statTop = Math.floor((totalLines - statHeight) / 2);

	for (let i = 0; i < totalLines; i++) {
		const artIndex = i - artTop;
		const statIndex = i - statTop;
		const art = artIndex >= 0 && artIndex < RACCOON.length ? RACCOON[artIndex]!.colored : "";
		const artPad = artWidth - (artIndex >= 0 && artIndex < RACCOON.length ? visLen(RACCOON[artIndex]!.text) : 0);
		const stat = statIndex >= 0 && statIndex < statLines.length ? statLines[statIndex]! : "";
		out.push(`${margin}${art}${" ".repeat(Math.max(0, artPad + gapWidth))}${stat}`);
	}

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
