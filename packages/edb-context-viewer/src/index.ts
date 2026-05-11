/**
 * pi-context-viewer
 *
 * Two commands for inspecting what the LLM sees:
 *
 *   /system-prompt-data  — shows the full system prompt in a scrollable overlay
 *   /total-context-data  — shows the complete LLM context (system prompt + all messages)
 *
 * Both overlays support: line numbers, scroll, live search (/), clipboard copy (y).
 */

import {
	buildSessionContext,
	type ContextUsage,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type SessionContext,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import { ScrollableOverlay } from "./scrollable-overlay";

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

/** Overlay options shared by both commands. */
const OVERLAY_OPTIONS = {
	overlay: true,
	overlayOptions: {
		anchor: "center" as const,
		width: "90%" as const,
		minWidth: 60,
		maxHeight: "80%" as const,
	},
};

// ── Extension ──────────────────────────────────────────────────────────────────

export default function contextViewerExtension(pi: ExtensionAPI): void {
	// ── /system-prompt-data ──
	pi.registerCommand("system-prompt-data", {
		description: "Show the full system prompt in a scrollable popup",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			if (!ctx.hasUI) return;

			const systemPrompt = ctx.getSystemPrompt();
			if (!systemPrompt) {
				ctx.ui.notify("No system prompt available yet. Send a message first.", "warning");
				return;
			}

			const lineCount = systemPrompt.split("\n").length;
			const charCount = systemPrompt.length;

			await ctx.ui.custom<void>((_tui, theme, _keybindings, done) => {
				const displayLines = buildNumberedLines(systemPrompt, theme);
				return new ScrollableOverlay({
					title: "System Prompt",
					subtitle: `${charCount.toLocaleString()} chars · ${lineCount} lines`,
					rawText: systemPrompt,
					displayLines,
					theme,
					done,
				});
			}, OVERLAY_OPTIONS);
		},
	});

	// ── /total-context-data ──
	pi.registerCommand("total-context-data", {
		description: "Show the complete LLM context (system prompt + all messages)",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			if (!ctx.hasUI) return;

			const systemPrompt = ctx.getSystemPrompt() ?? "";
			const context = buildSessionContext(ctx.sessionManager.getEntries(), ctx.sessionManager.getLeafId());
			const fullText = buildTotalContextText(systemPrompt, context, ctx.getContextUsage(), ctx.model);

			await ctx.ui.custom<void>((_tui, theme, _keybindings, done) => {
				const displayLines = buildNumberedLines(fullText, theme);
				return new ScrollableOverlay({
					title: "Total Context Data",
					subtitle: `${fullText.length.toLocaleString()} chars · ${displayLines.length} lines`,
					rawText: fullText,
					displayLines,
					theme,
					done,
				});
			}, OVERLAY_OPTIONS);
		},
	});
}
