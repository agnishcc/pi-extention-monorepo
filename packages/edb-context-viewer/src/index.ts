/**
 * edb-context-viewer
 *
 * Single command for inspecting the full LLM context in a tabbed overlay:
 *
 *   /context-viewer  — opens a tabbed overlay with:
 *                       [Stats]  token distribution grid + category breakdown
 *                       [System] full system prompt (scrollable)
 *                       [Tools]  active tool definitions (scrollable)
 *                       [Messages] all session messages (scrollable)
 *                       [Full]   complete context dump (scrollable)
 *
 * Tab / Shift+Tab navigates between views.
 * Each content tab supports: line numbers, scroll, live search (/), clipboard copy (y).
 */

import {
	buildSessionContext,
	type ContextUsage,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type SessionContext,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import { ScrollableTabContent } from "./scrollable-tab-content.js";
import { type ContextTokenBreakdown, StatsTabContent } from "./stats-tab-content.js";
import { TabbedOverlay } from "./tabbed-overlay.js";
import { formatTokens } from "./utils.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Build display lines with line numbers from raw text. */
export function buildNumberedLines(text: string, theme: Theme): string[] {
	const rawLines = text.split("\n");
	const numWidth = String(rawLines.length).length;
	return rawLines.map((line, i) => {
		const num = String(i + 1).padStart(numWidth, " ");
		return `${theme.fg("dim", num)} ${theme.fg("dim", "│")} ${line}`;
	});
}

function formatImageBlock(block: any): string {
	const label = block.mimeType ?? block.source?.type ?? "unknown";
	return `[Image: ${label}]`;
}

function formatContent(content: unknown): string[] {
	if (typeof content === "string") return [content];
	if (!Array.isArray(content)) return [];

	const lines: string[] = [];
	for (const block of content) {
		if (!block || typeof block !== "object") {
			lines.push(String(block));
			continue;
		}

		switch ((block as any).type) {
			case "text":
				lines.push((block as any).text ?? "");
				break;
			case "thinking":
				lines.push(`[Thinking: ${(block as any).thinking ?? ""}]`);
				break;
			case "toolCall":
				lines.push(`[Tool Call: ${(block as any).name}(${JSON.stringify((block as any).arguments ?? {})})]`);
				break;
			case "image":
				lines.push(formatImageBlock(block));
				break;
			default:
				lines.push(`[${(block as any).type ?? "unknown"}]`);
		}
	}
	return lines;
}

function formatUsage(usage: any): string | undefined {
	if (!usage) return undefined;

	const parts: string[] = [];
	if (usage.input != null) parts.push(`input: ${usage.input}`);
	if (usage.output != null) parts.push(`output: ${usage.output}`);
	if (usage.cacheRead != null) parts.push(`cache-read: ${usage.cacheRead}`);
	if (usage.cacheWrite != null) parts.push(`cache-write: ${usage.cacheWrite}`);
	if (usage.totalTokens != null) parts.push(`total: ${usage.totalTokens}`);
	return parts.length > 0 ? `Tokens: ${parts.join(", ")}` : undefined;
}

export function formatMessageForDisplay(message: SessionContext["messages"][number], index: number): string[] {
	const msg = message as any;
	const lines: string[] = ["", `──── Message ${index + 1} ────`, `Role: ${msg.role ?? "unknown"}`];

	if (msg.role === "assistant") {
		if (msg.provider || msg.model) lines.push(`Model: ${[msg.provider, msg.model].filter(Boolean).join("/")}`);
		const usage = formatUsage(msg.usage);
		if (usage) lines.push(usage);
		if (msg.stopReason) lines.push(`Stop: ${msg.stopReason}`);
		if (msg.errorMessage) lines.push(`Error: ${msg.errorMessage}`);
	}

	if (msg.role === "toolResult") {
		lines.push(`Tool: ${msg.toolName ?? "unknown"}`);
		lines.push(`Tool Call ID: ${msg.toolCallId ?? "unknown"}`);
		lines.push(`Error: ${msg.isError ? "yes" : "no"}`);
	}

	lines.push(...formatContent(msg.content));
	return lines;
}

interface ContextViewerModelInfo {
	provider: string;
	id: string;
	contextWindow?: number;
}

export function buildTotalContextText(
	systemPrompt: string,
	context: SessionContext,
	usage: ContextUsage | undefined,
	model: ContextViewerModelInfo | undefined,
): string {
	const sections: string[] = [];

	sections.push("═══════════════════════════════════════════════════════");
	sections.push("SYSTEM PROMPT");
	sections.push("═══════════════════════════════════════════════════════");
	sections.push(systemPrompt);
	sections.push("");

	sections.push("═══════════════════════════════════════════════════════");
	sections.push("MESSAGES");
	sections.push("═══════════════════════════════════════════════════════");

	if (context.messages.length > 0) {
		for (let i = 0; i < context.messages.length; i++) {
			sections.push(...formatMessageForDisplay(context.messages[i]!, i));
		}
	} else {
		sections.push("(no messages yet)");
	}

	sections.push("");
	sections.push("═══════════════════════════════════════════════════════");
	sections.push("CONTEXT USAGE");
	sections.push("═══════════════════════════════════════════════════════");
	if (usage) {
		sections.push(`Tokens: ${usage.tokens?.toLocaleString() ?? "unknown"}`);
		if (model) {
			sections.push(`Model: ${model.provider}/${model.id}`);
			const contextWindow = model.contextWindow ?? usage.contextWindow;
			if (contextWindow) {
				const pct = usage.percent ?? (usage.tokens == null ? null : (usage.tokens / contextWindow) * 100);
				sections.push(
					`Context Window: ${usage.tokens?.toLocaleString() ?? "unknown"} / ${contextWindow.toLocaleString()} (${pct == null ? "unknown" : `${pct.toFixed(1)}%`})`,
				);
			}
		}
	} else {
		sections.push("(no usage data available)");
	}

	return sections.join("\n");
}

/** Format active tool definitions as readable text for the Tools tab. */
function buildToolsText(activeToolDefs: { name: string; description?: string; parameters?: unknown }[]): string {
	if (activeToolDefs.length === 0) return "(no active tools)";

	const sections: string[] = [];
	for (const tool of activeToolDefs) {
		sections.push(`${"─".repeat(56)}`);
		sections.push(`Tool: ${tool.name}`);
		if (tool.description) {
			sections.push(`Description: ${tool.description}`);
		}
		if (tool.parameters) {
			sections.push("Parameters:");
			const params = tool.parameters as any;
			if (params?.properties) {
				for (const [key, val] of Object.entries(params.properties)) {
					const v = val as any;
					const required = params.required?.includes(key) ? "" : " (optional)";
					const type = v.type ?? "unknown";
					const desc = v.description ? `: ${v.description}` : "";
					sections.push(`  ${key} (${type}${required})${desc}`);
				}
			} else {
				sections.push(`  ${JSON.stringify(tool.parameters, null, 2).split("\n").join("\n  ")}`);
			}
		}
		sections.push("");
	}

	return sections.join("\n");
}

/** Build the token breakdown, scaling raw char-based estimates to match actual token count. */
function buildTokenBreakdown(
	systemPrompt: string,
	activeToolDefs: unknown[],
	branch: { type: string; message?: any; summary?: string }[],
	usage: ContextUsage | undefined,
): ContextTokenBreakdown | null {
	if (!usage?.tokens || !usage.contextWindow) return null;

	const estimateTokens = (text: string) => Math.ceil(text.length / 4);

	const systemRaw = estimateTokens(systemPrompt);
	const toolDefsRaw = estimateTokens(JSON.stringify(activeToolDefs));

	let msgTokensRaw = 0;
	let toolCallTokensRaw = 0;
	let toolResultTokensRaw = 0;

	for (const entry of branch) {
		if (entry.type === "message" && entry.message) {
			const m = entry.message;

			if (m.role === "user") {
				if (typeof m.content === "string") msgTokensRaw += estimateTokens(m.content);
				else if (Array.isArray(m.content)) {
					for (const p of m.content) {
						if (p?.type === "text") msgTokensRaw += estimateTokens(p.text ?? "");
					}
				}
			} else if (m.role === "assistant") {
				if (typeof m.content === "string") msgTokensRaw += estimateTokens(m.content);
				else if (Array.isArray(m.content)) {
					for (const p of m.content) {
						if (p?.type === "text") msgTokensRaw += estimateTokens(p.text ?? "");
						else if (p?.type === "toolCall") toolCallTokensRaw += estimateTokens(JSON.stringify(p));
					}
				}
			} else if (m.role === "toolResult") {
				if (Array.isArray(m.content)) {
					for (const p of m.content) {
						if (p?.type === "text") toolResultTokensRaw += estimateTokens(p.text ?? "");
					}
				}
			} else if (m.role === "bashExecution") {
				toolCallTokensRaw += estimateTokens(m.command ?? "");
				toolResultTokensRaw += estimateTokens(m.output ?? "");
			}
		} else if (entry.type === "branch_summary" || entry.type === "compaction") {
			msgTokensRaw += estimateTokens((entry as any).summary ?? "");
		}
	}

	const totalRaw = systemRaw + toolDefsRaw + msgTokensRaw + toolCallTokensRaw + toolResultTokensRaw;
	const ratio = totalRaw > 0 ? usage.tokens / totalRaw : 1;

	const sys = Math.round(systemRaw * ratio);
	const tools = Math.round(toolDefsRaw * ratio);
	const msgs = Math.round(msgTokensRaw * ratio);
	const toolCalls = Math.round((toolCallTokensRaw + toolResultTokensRaw) * ratio);
	const accounted = sys + tools + msgs + toolCalls;

	return {
		total: usage.tokens,
		contextWindow: usage.contextWindow,
		percent: usage.percent ?? (usage.tokens / usage.contextWindow) * 100,
		systemPrompt: sys,
		systemTools: tools,
		toolCalls,
		messages: msgs,
		other: Math.max(0, usage.tokens - accounted),
	};
}

/** Overlay options shared across all tabs. */
const OVERLAY_OPTIONS = {
	overlay: true,
	overlayOptions: {
		anchor: "center" as const,
		width: "90%" as const,
		minWidth: 60,
		maxHeight: "90%" as const,
	},
};

// ── Extension ──────────────────────────────────────────────────────────────────

export default function contextViewerExtension(pi: ExtensionAPI): void {
	pi.registerCommand("context-viewer", {
		description: "Inspect context usage, system prompt, tools, messages, and full LLM context in a tabbed overlay",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			if (!ctx.hasUI) return;

			// ── Gather data ─────────────────────────────────────────────────────
			const systemPrompt = ctx.getSystemPrompt() ?? "";
			const usage = ctx.getContextUsage();

			const allTools = pi.getAllTools();
			const activeToolNames = pi.getActiveTools();
			const activeToolDefs = allTools.filter((t) => activeToolNames.includes(t.name));

			const branch = ctx.sessionManager.getBranch();
			const context = buildSessionContext(ctx.sessionManager.getEntries(), ctx.sessionManager.getLeafId());

			const breakdown = buildTokenBreakdown(systemPrompt, activeToolDefs, branch, usage);
			const toolsText = buildToolsText(activeToolDefs);
			const fullText = buildTotalContextText(systemPrompt, context, usage, ctx.model);

			// ── Subtitle ────────────────────────────────────────────────────────
			const subtitle =
				usage?.tokens != null && usage.contextWindow != null
					? `${formatTokens(usage.tokens)} / ${formatTokens(usage.contextWindow)} (${(usage.percent ?? (usage.tokens / usage.contextWindow) * 100).toFixed(1)}%)`
					: "no usage data yet";

			// ── Build and open the overlay ──────────────────────────────────────
			await ctx.ui.custom<void>((_tui, theme, _keybindings, done) => {
				// Build messages text for the Messages tab
				const messagesLines: string[] = [];
				if (context.messages.length > 0) {
					for (let i = 0; i < context.messages.length; i++) {
						messagesLines.push(...formatMessageForDisplay(context.messages[i]!, i));
					}
				} else {
					messagesLines.push("(no messages yet)");
				}
				const messagesText = messagesLines.join("\n");

				const tabs = [
					new StatsTabContent(breakdown, theme),
					new ScrollableTabContent(
						{ rawText: systemPrompt, displayLines: buildNumberedLines(systemPrompt, theme), theme },
						"System",
					),
					new ScrollableTabContent(
						{ rawText: toolsText, displayLines: buildNumberedLines(toolsText, theme), theme },
						"Tools",
					),
					new ScrollableTabContent(
						{ rawText: messagesText, displayLines: buildNumberedLines(messagesText, theme), theme },
						"Messages",
					),
					new ScrollableTabContent(
						{ rawText: fullText, displayLines: buildNumberedLines(fullText, theme), theme },
						"Full",
					),
				];

				return new TabbedOverlay({
					title: "Context Viewer",
					subtitle,
					tabs,
					theme,
					done,
				});
			}, OVERLAY_OPTIONS);
		},
	});
}
