import { Markdown, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { OSC133_ZONE_END, OSC133_ZONE_FINAL, OSC133_ZONE_START, USER_MESSAGE_EMOJIS } from "./constants.js";
import type { CompactTheme } from "./types.js";

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const TRANSPARENT_BG = "\x1b[49m";
const RESET = "\x1b[0m";

// ── Helpers ──────────────────────────────────────────────────────

export function stripAnsi(text: string): string {
	return text.replace(ANSI_RE, "");
}

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

export function trimVisualBlankLines(lines: string[]): string[] {
	let start = 0;
	let end = lines.length;
	while (start < end && stripUserZoneMarkers(stripAnsi(lines[start] ?? "")).trim() === "") start++;
	while (end > start && stripUserZoneMarkers(stripAnsi(lines[end - 1] ?? "")).trim() === "") end--;
	return lines.slice(start, end);
}

function stripBackgroundAnsi(text: string): string {
	return text.replace(/\x1b\[([0-9;]*)m/g, (_match, paramsText: string) => {
		const params = paramsText === "" ? ["0"] : paramsText.split(";");
		const kept: string[] = [];
		for (let i = 0; i < params.length; i++) {
			const code = Number(params[i] || "0");
			if (code === 48) {
				const mode = Number(params[i + 1] || "0");
				i += mode === 2 ? 4 : mode === 5 ? 2 : 0;
				continue;
			}
			if (code === 49 || (code >= 40 && code <= 47) || (code >= 100 && code <= 107)) continue;
			kept.push(params[i]!);
		}
		return kept.length === 0 ? "" : `\x1b[${kept.join(";")}m`;
	});
}

function trimAnsiRight(text: string): string {
	let trimmed = text;
	while (true) {
		const next = trimmed.replace(/[ \t]+((?:\x1b\[[0-9;]*m)*)$/g, "$1");
		if (next === trimmed) return trimmed;
		trimmed = next;
	}
}

function cleanMessageLine(line: string): string {
	return `${TRANSPARENT_BG}${trimAnsiRight(stripBackgroundAnsi(stripUserZoneMarkers(line)))}${TRANSPARENT_BG}`;
}

function borderFn(theme: CompactTheme): (text: string) => string {
	return (text: string) => theme.fg("borderMuted", text);
}

function roundedUserBorder(width: number, top: boolean, theme: CompactTheme, markerText: string): string {
	const border = borderFn(theme);
	if (width <= 1) return `${border("│")}${RESET}${TRANSPARENT_BG}`;
	const left = top ? "╭" : "╰";
	const right = top ? "╮" : "╯";
	if (!top || width < 14)
		return `${border(left + "─".repeat(Math.max(0, width - 2)) + right)}${RESET}${TRANSPARENT_BG}`;
	const label = ` ${markerText} User `;
	const prefix = "─";
	const suffixWidth = Math.max(0, width - 2 - visibleWidth(prefix) - visibleWidth(label));
	return `${border(left + prefix)}${TRANSPARENT_BG}${theme.fg("error", label)}${border("─".repeat(suffixWidth) + right)}${RESET}${TRANSPARENT_BG}`;
}

function borderedMessageLine(line: string, width: number, theme: CompactTheme): string {
	const border = borderFn(theme);
	const innerWidth = Math.max(1, width - 4);
	const content = truncateToWidth(cleanMessageLine(line), innerWidth, "");
	return `${border("│")}${TRANSPARENT_BG} ${padVisible(content, innerWidth)} ${border("│")}${RESET}${TRANSPARENT_BG}`;
}

// ── User message framing: cc-tools geometry + edb emoji marker ─────

export function frameUserMessage(lines: string[], width: number, theme: CompactTheme, markerText: string): string[] {
	if (width < 6) return lines;
	const borderWidth = Math.max(1, width);
	const body = trimVisualBlankLines(lines);
	const rendered = [
		roundedUserBorder(borderWidth, true, theme, markerText),
		...body.map((line) => borderedMessageLine(line, borderWidth, theme)),
		roundedUserBorder(borderWidth, false, theme, markerText),
	];
	rendered[0] = OSC133_ZONE_START + rendered[0];
	rendered[rendered.length - 1] += OSC133_ZONE_END + OSC133_ZONE_FINAL;
	return [...rendered, ""];
}

// ── Assistant message paragraphs: cc-tools dotted final/thinking style ─

function cleanPersistedAnsiArtifacts(line: string): string {
	// Older completion lines were accidentally persisted with ANSI escapes. In some terminals
	// those escapes come back through markdown as visible fragments like "【38;2;...m".
	if (!line.includes("✓ ·")) return line;
	return line.replace(/【(?:\d{1,3};)*\d{1,3}m/g, "").replaceAll("】", "");
}

function sanitizeRenderedTextBlockLines(lines: string[]): string[] {
	return trimVisualBlankLines(lines).map((line) =>
		trimAnsiRight(cleanPersistedAnsiArtifacts(stripBackgroundAnsi(line))),
	);
}

function isCompletionLine(line: string): boolean {
	return /^✓ · .+ · \d/.test(stripAnsi(line).trim());
}

function muted(text: string): string {
	return `\x1b[38;5;244m${text}${RESET}`;
}

export class DottedParagraph {
	private md: InstanceType<typeof Markdown>;
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(text: string, markdownTheme: ConstructorParameters<typeof Markdown>[3]) {
		this.md = new Markdown(text, 0, 0, markdownTheme);
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
		this.md.invalidate();
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
		const prefixWidth = 3;
		if (width <= prefixWidth) {
			this.cachedWidth = width;
			this.cachedLines = [" ● "];
			return this.cachedLines;
		}
		const lines = sanitizeRenderedTextBlockLines(this.md.render(width - prefixWidth));
		let lastCompletionIndex = -1;
		for (let index = lines.length - 1; index >= 0; index--) {
			if (isCompletionLine(lines[index] ?? "")) {
				lastCompletionIndex = index;
				break;
			}
		}
		let dotPlaced = false;
		const rendered = lines.flatMap((line, index) => {
			if (isCompletionLine(line)) {
				if (index !== lastCompletionIndex) return [];
				return [`   ${muted(stripAnsi(line).trim())}`];
			}
			if (!dotPlaced && stripAnsi(line).trim()) {
				dotPlaced = true;
				return [` ● ${line}`];
			}
			return [`   ${line}`];
		});
		this.cachedWidth = width;
		this.cachedLines = rendered;
		return rendered;
	}
}

export class ThinkingParagraph {
	private md: InstanceType<typeof Markdown>;
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(
		text: string,
		markdownTheme: ConstructorParameters<typeof Markdown>[3],
		defaultTextStyle?: ConstructorParameters<typeof Markdown>[4],
	) {
		const fallbackMuted = "\x1b[38;5;244m";
		const color =
			typeof defaultTextStyle?.color === "function"
				? defaultTextStyle.color
				: (s: string) => `${fallbackMuted}${s}${RESET}`;
		const italic = "\x1b[3m";
		const wrap = (s: string) => `${italic}${color(s)}${RESET}`;
		const plainTheme: ConstructorParameters<typeof Markdown>[3] = {
			...(markdownTheme as any),
			heading: wrap,
			link: wrap,
			linkUrl: wrap,
			code: wrap,
			codeBlock: wrap,
			codeBlockBorder: wrap,
			quote: wrap,
			quoteBorder: wrap,
			hr: wrap,
			listBullet: wrap,
			bold: wrap,
			italic: wrap,
			strikethrough: wrap,
			underline: wrap,
			highlightCode: (code: string) => code.split("\n").map(wrap),
		};
		const plainStyle: ConstructorParameters<typeof Markdown>[4] = { italic: true, color: wrap };
		this.md = new Markdown(text, 0, 0, plainTheme, plainStyle);
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
		this.md.invalidate();
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
		const label = "✻ thinking:";
		const firstPrefixWidth = visibleWidth(` ${label} `);
		const continuationPrefixWidth = 3;
		const prefix = `\x1b[38;5;244m${label}\x1b[0m`;
		if (width <= firstPrefixWidth) {
			this.cachedWidth = width;
			this.cachedLines = [truncateToWidth(` ${prefix} `, width, "")];
			return this.cachedLines;
		}
		const firstLineWidth = Math.max(1, width - firstPrefixWidth);
		const continuationWidth = Math.max(1, width - continuationPrefixWidth);
		const sourceLines = sanitizeRenderedTextBlockLines(this.md.render(continuationWidth));
		let symbolPlaced = false;
		const rendered: string[] = [];
		for (const sourceLine of sourceLines) {
			if (!symbolPlaced && stripAnsi(sourceLine).trim()) {
				symbolPlaced = true;
				const first = truncateToWidth(sourceLine, firstLineWidth, "");
				rendered.push(` ${prefix} ${first}`);
				continue;
			}
			rendered.push(`   ${truncateToWidth(sourceLine, continuationWidth, "")}`);
		}
		this.cachedWidth = width;
		this.cachedLines = rendered;
		return rendered;
	}
}
