import { keyHint } from "@earendil-works/pi-coding-agent";
import { MAX_EXPANDED_LINES } from "./constants.js";
import { lineCount, previewLines, textContent } from "./text.js";
import { EmptyBlock, ToolBlock } from "./tool-block.js";
import { callLabel, purple, summaryFor, toolColor, toolIcon } from "./tool-meta.js";
import type { CompactTheme, ToolBlockKind } from "./types.js";

// ── Color resolution ─────────────────────────────────────────────

function resolveColor(toolName: string, args?: any, override?: string): string {
	if (override) return override;
	return toolColor(toolName, args);
}

function makeColorFn(color: string, theme: CompactTheme): (text: string) => string {
	return color === "purple" ? purple : (text: string) => theme.fg(color, text);
}

// ── Line builders ────────────────────────────────────────────────

function topLine(toolName: string, theme: CompactTheme, label: string, args?: any): string {
	const color = toolColor(toolName, args);
	const title = `${toolIcon(toolName)} ${toolName}`;
	const coloredTitle = color === "purple" ? purple(theme.bold(title)) : theme.fg(color, theme.bold(title));
	return `${coloredTitle} ${theme.fg("toolOutput", label)}`;
}

function midLine(_toolName: string, theme: CompactTheme, text: string): string {
	return theme.fg("toolOutput", text);
}

function bottomLine(_toolName: string, _theme: CompactTheme, text = ""): string {
	return text.trimEnd();
}

// ── Block builders ───────────────────────────────────────────────

function toolText(
	kind: ToolBlockKind,
	toolName: string,
	lines: string[],
	theme: CompactTheme,
	borderColor: string,
	args?: any,
): ToolBlock {
	const color = resolveColor(toolName, args, borderColor);
	return new ToolBlock(kind, lines, theme, makeColorFn(color, theme));
}

// ── Renderers ────────────────────────────────────────────────────

export function renderCall(_toolName: string, _args: any, _theme: CompactTheme, _context: any) {
	return new EmptyBlock();
}

export function renderResult(toolName: string, result: any, options: any, theme: CompactTheme, context: any) {
	const args = context?.args;

	if (options?.isPartial) {
		return toolText(
			"full",
			toolName,
			[
				topLine(toolName, theme, callLabel(toolName, args), args),
				bottomLine(toolName, theme, theme.fg("muted", "running…")),
			],
			theme,
			"warning",
			args,
		);
	}

	const summary = summaryFor(toolName, result);
	const text = textContent(result);
	const failed = Boolean(context?.isError || result?.isError);
	const statusColor = failed ? "error" : "success";
	const statusIcon = failed ? "✗" : "✓";
	const expandHint = options?.expanded ? "" : ` ${theme.fg("dim", keyHint("app.tools.expand", "expand"))}`;

	const top = topLine(toolName, theme, callLabel(toolName, args), args);
	const bottom = bottomLine(
		toolName,
		theme,
		`${theme.fg(statusColor, statusIcon)} ${theme.fg("toolOutput", summary)}${expandHint}`,
	);
	const borderColor = failed ? "error" : toolColor(toolName, args) === "purple" ? "purple" : "success";

	if (!options?.expanded || !text.trim()) {
		return toolText("full", toolName, [top, bottom], theme, borderColor, args);
	}

	const diff = toolName === "edit" && typeof result?.details?.diff === "string" ? result.details.diff : "";
	const previewText = diff || text;
	const mode = toolName === "bash" ? "tail" : "head";
	const lines = previewLines(previewText, mode).map((line) => midLine(toolName, theme, line));
	if (lineCount(previewText) > MAX_EXPANDED_LINES) {
		const omitted = lineCount(previewText) - MAX_EXPANDED_LINES;
		lines.push(midLine(toolName, theme, theme.fg("dim", `… ${omitted} more line(s)`)));
	}
	lines.unshift(top);
	lines.push(bottomLine(toolName, theme, `${theme.fg(statusColor, statusIcon)} ${theme.fg("toolOutput", summary)}`));
	return toolText("full", toolName, lines, theme, borderColor, args);
}
