import { shortenPath } from "./path-utils.js";
import { cleanToolOutputText, previewLines } from "./text.js";
import type { CompactTheme } from "./types.js";

function midLine(theme: CompactTheme, text: string): string {
	return theme.fg("toolOutput", text);
}

function mutedLine(theme: CompactTheme, text: string): string {
	return theme.fg("muted", text);
}

function fileIcon(path: string): string {
	return path.endsWith("/") ? "📁" : "📄";
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function formatExpandedLines(toolName: string, text: string, theme: CompactTheme, args?: any): string[] {
	const cleanText = cleanToolOutputText(text);
	if (!cleanText.trim()) return [];
	if (toolName === "read") return formatReadLines(cleanText, theme);
	if (toolName === "bash") return formatBashLines(cleanText, theme);
	if (toolName === "ls") return formatLsLines(cleanText, theme);
	if (toolName === "find") return formatFindLines(cleanText, theme);
	if (toolName === "grep") return formatGrepLines(cleanText, theme, args);
	return formatGenericLines(cleanText, theme);
}

function formatReadLines(text: string, theme: CompactTheme): string[] {
	const lines = previewLines(text, "head");
	const width = String(lines.length).length;
	return [
		mutedLine(theme, `preview · ${lines.length} line${lines.length === 1 ? "" : "s"}`),
		...lines.map(
			(line, index) => `${theme.fg("dim", String(index + 1).padStart(width, " "))} ${theme.fg("toolOutput", line)}`,
		),
	];
}

function formatBashLines(text: string, theme: CompactTheme): string[] {
	const lines = previewLines(text, "tail");
	return [
		mutedLine(theme, `output · last ${lines.length} line${lines.length === 1 ? "" : "s"}`),
		...lines.map((line) => midLine(theme, line)),
	];
}

function formatLsLines(text: string, theme: CompactTheme): string[] {
	const entries = previewLines(text, "head").sort((a, b) => {
		const dirDelta = Number(b.endsWith("/")) - Number(a.endsWith("/"));
		return dirDelta || a.localeCompare(b);
	});
	return entries.map(
		(entry) => `${fileIcon(entry)} ${theme.fg(entry.endsWith("/") ? "accent" : "toolOutput", entry)}`,
	);
}

function formatFindLines(text: string, theme: CompactTheme): string[] {
	const entries = previewLines(text, "head").map((entry) => shortenPath(entry));
	return entries.map((entry) => `${fileIcon(entry)} ${theme.fg("toolOutput", entry)}`);
}

function formatGrepLines(text: string, theme: CompactTheme, args?: any): string[] {
	const pattern = typeof args?.pattern === "string" && args.pattern.length > 0 ? args.pattern : "";
	const matcher = pattern ? new RegExp(escapeRegExp(pattern), "gi") : null;
	const highlight = (value: string) => {
		if (!matcher) return theme.fg("toolOutput", value);
		matcher.lastIndex = 0;
		return theme.fg(
			"toolOutput",
			value.replace(matcher, (match) => theme.fg("warning", match)),
		);
	};
	return previewLines(text, "head").map((line) => {
		const match = line.match(/^([^:\n]+):(\d+):(.*)$/);
		if (!match) return highlight(line);
		return `${theme.fg("accent", shortenPath(match[1] ?? ""))}${theme.fg("dim", `:${match[2]}:`)}${highlight(match[3] ?? "")}`;
	});
}

function formatGenericLines(text: string, theme: CompactTheme): string[] {
	try {
		const parsed = JSON.parse(text);
		return previewLines(JSON.stringify(parsed, null, 2), "head").map((line) => midLine(theme, line));
	} catch {
		return previewLines(text, "head").map((line) => midLine(theme, line));
	}
}
