import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
	ASSISTANT_MESSAGE_EMOJIS,
	OSC133_ZONE_END,
	OSC133_ZONE_FINAL,
	OSC133_ZONE_START,
	USER_MESSAGE_EMOJIS,
} from "./constants.js";
import type { CompactTheme } from "./types.js";

// ── Helpers ──────────────────────────────────────────────────────

export function padVisible(text: string, width: number): string {
	const clipped = truncateToWidth(text, width, "");
	return `${clipped}${" ".repeat(Math.max(0, width - visibleWidth(clipped)))}`;
}

export function stripUserZoneMarkers(line: string): string {
	return line.replaceAll(OSC133_ZONE_START, "").replaceAll(OSC133_ZONE_END, "").replaceAll(OSC133_ZONE_FINAL, "");
}

export function randomUserMessageMarker(): string {
	return USER_MESSAGE_EMOJIS[Math.floor(Math.random() * USER_MESSAGE_EMOJIS.length)] ?? "✨";
}

export function randomAssistantMessageMarker(): string {
	return ASSISTANT_MESSAGE_EMOJIS[Math.floor(Math.random() * ASSISTANT_MESSAGE_EMOJIS.length)] ?? "🤖";
}

export function trimVisualBlankLines(lines: string[]): string[] {
	let start = 0;
	let end = lines.length;
	while (start < end && stripUserZoneMarkers(lines[start] ?? "").trim() === "") start++;
	while (end > start && stripUserZoneMarkers(lines[end - 1] ?? "").trim() === "") end--;
	return lines.slice(start, end);
}

// ── Framing ──────────────────────────────────────────────────────

export function frameMessage(
	lines: string[],
	width: number,
	theme: CompactTheme,
	markerText: string,
	borderColor: string,
	markerColor: string,
): string[] {
	if (width < 6) return lines;
	const innerWidth = Math.max(1, width - 2);
	const border = (text: string) => theme.fg(borderColor, text);
	const marker = theme.fg(markerColor, markerText);
	const topFill = Math.max(0, innerWidth - visibleWidth(marker) - 2);
	const top = `${border("╭─")} ${marker}${border("─".repeat(topFill))}${border("╮")}`;
	const body = trimVisualBlankLines(lines).map(
		(line) => `${border("│")}${padVisible(stripUserZoneMarkers(line).trimEnd(), innerWidth)}${border("│")}`,
	);
	const bottom = `${border("╰")}${border("─".repeat(innerWidth))}${border("╯")}`;
	return [`${OSC133_ZONE_START}${top}`, ...body, `${OSC133_ZONE_END}${OSC133_ZONE_FINAL}${bottom}`, ""];
}

export function frameUserMessage(lines: string[], width: number, theme: CompactTheme, markerText: string): string[] {
	return frameMessage(lines, width, theme, markerText, "accent", "error");
}

export function frameAssistantMessage(
	lines: string[],
	width: number,
	theme: CompactTheme,
	markerText?: string,
): string[] {
	const marker = markerText ?? randomAssistantMessageMarker();
	return frameMessage(lines, width, theme, marker, "border", "toolTitle");
}
