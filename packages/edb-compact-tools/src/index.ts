import {
	AssistantMessageComponent,
	createBashTool,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadTool,
	createWriteTool,
	type ExtensionAPI,
	keyHint,
	ToolExecutionComponent,
	UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

type CompactTheme = {
	fg: (color: any, text: string) => string;
	bg?: (color: any, text: string) => string;
	bold: (text: string) => string;
};

type BuiltinToolName = "read" | "bash" | "grep" | "find" | "ls" | "edit" | "write";

type BuiltinTool = {
	description: string;
	parameters: unknown;
	execute: (id: string, params: unknown, signal?: AbortSignal, onUpdate?: unknown, ctx?: unknown) => Promise<unknown>;
};

const MAX_COLLAPSED_TEXT = 120;
const MAX_EXPANDED_LINES = 4000;
const MAX_LINE_CHARS = 120;
const TOOL_EXECUTION_PATCH_SYMBOL = Symbol.for("edb-compact-tools.tool-execution-patch");
const USER_MESSAGE_PATCH_SYMBOL = Symbol.for("edb-compact-tools.user-message-patch");
const ASSISTANT_MESSAGE_PATCH_SYMBOL = Symbol.for("edb-compact-tools.assistant-message-patch");
const USER_MESSAGE_MARKER_SYMBOL = Symbol.for("edb-compact-tools.user-message-marker");
const ASSISTANT_MESSAGE_MARKER_SYMBOL = Symbol.for("edb-compact-tools.assistant-message-marker");
const USER_MESSAGE_EMOJIS = [
	"🦊",
	"🐙",
	"🐸",
	"🐻",
	"🐼",
	"🐨",
	"🦥",
	"🦔",
	"🦫",
	"🦚",
	"🦩",
	"🦉",
	"🐰",
	"🐢",
	"🦎",
	"🦖",
];
const ASSISTANT_MESSAGE_EMOJIS = ["🤖", "🧠", "🦾", "🛸", "💡"];
let activeTheme: CompactTheme | undefined;
const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

function oneLine(value: unknown): string {
	return String(value ?? "")
		.replace(/\s+/g, " ")
		.trim();
}

function clip(text: string, max = MAX_COLLAPSED_TEXT): string {
	return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
}

function lineCount(text: string): number {
	if (!text) return 0;
	return text.split(/\r?\n/).length;
}

function textContent(result: any): string {
	const content = Array.isArray(result?.content) ? result.content : [];
	return content
		.filter((item: any) => item?.type === "text" && typeof item.text === "string")
		.map((item: any) => item.text)
		.join("\n");
}

function outputWasTruncated(text: string): boolean {
	return /\btruncated\b|Full output saved to:/i.test(text);
}

function previewLines(text: string, mode: "head" | "tail", limit = MAX_EXPANDED_LINES): string[] {
	const lines = text.replace(/\s+$/g, "").split(/\r?\n/);
	const selected = mode === "tail" ? lines.slice(-limit) : lines.slice(0, limit);
	return selected.map((line) => clip(line, MAX_LINE_CHARS));
}

function toolColor(toolName: string): string {
	switch (toolName) {
		case "bash":
			return "bashMode";
		case "read":
			return "toolTitle";
		case "grep":
			return "success";
		case "find":
			return "accent";
		case "ls":
			return "warning";
		case "edit":
			return "toolDiffAdded";
		case "write":
			return "accent";
		default:
			return "accent";
	}
}

function toolIcon(toolName: string): string {
	switch (toolName) {
		case "bash":
			return "⚙️";
		case "read":
			return "📖";
		case "grep":
			return "🔎";
		case "find":
			return "🧭";
		case "ls":
			return "📁";
		case "edit":
			return "✏️";
		case "write":
			return "📝";
		default:
			return "🧩";
	}
}

function callLabel(toolName: string, args: any): string {
	if (toolName === "bash") return clip(oneLine(args?.command), 140);
	if (toolName === "read") return clip(oneLine(args?.path), 140);
	if (toolName === "grep") {
		const pattern = oneLine(args?.pattern);
		const path = oneLine(args?.path ?? args?.glob ?? ".");
		return clip(`${pattern}${path ? ` in ${path}` : ""}`, 140);
	}
	if (toolName === "find") return clip(oneLine(args?.path ?? args?.pattern ?? "."), 140);
	if (toolName === "edit") {
		const count = Array.isArray(args?.edits) ? args.edits.length : args?.oldText && args?.newText ? 1 : 0;
		return clip(
			`${oneLine(args?.path ?? args?.file_path)}${count ? ` · ${count} replacement${count === 1 ? "" : "s"}` : ""}`,
			140,
		);
	}
	if (toolName === "write") {
		const bytes = typeof args?.content === "string" ? Buffer.byteLength(args.content, "utf8") : 0;
		return clip(`${oneLine(args?.path ?? args?.file_path)}${bytes ? ` · ${bytes} bytes` : ""}`, 140);
	}
	const compactArgs = oneLine(JSON.stringify(args ?? {}));
	return clip(compactArgs === "{}" ? "" : compactArgs, 140);
}

function summaryFor(toolName: string, result: any): string {
	const text = textContent(result);
	const lines = lineCount(text);
	const truncated = outputWasTruncated(text) ? " · truncated" : "";
	if (toolName === "bash") {
		const exitMatch = text.match(/Exit code:\s*(-?\d+)/i) ?? text.match(/exit(?:ed)?(?: code)?\s*(-?\d+)/i);
		const exit = exitMatch?.[1] ?? (result?.isError ? "1" : "0");
		return `exit ${exit} · ${lines} line${lines === 1 ? "" : "s"}${truncated}`;
	}
	if (toolName === "read") return `${lines} line${lines === 1 ? "" : "s"}${truncated}`;
	if (toolName === "ls") return `${lines} item${lines === 1 ? "" : "s"}${truncated}`;
	if (toolName === "edit") {
		const diff = typeof result?.details?.diff === "string" ? result.details.diff : "";
		const added = diff
			.split(/\r?\n/)
			.filter((line: string) => line.startsWith("+") && !line.startsWith("+++")).length;
		const removed = diff
			.split(/\r?\n/)
			.filter((line: string) => line.startsWith("-") && !line.startsWith("---")).length;
		return diff ? `+${added} -${removed}` : `${lines} line${lines === 1 ? "" : "s"}${truncated}`;
	}
	if (toolName === "write") return `${lines} line${lines === 1 ? "" : "s"}${truncated}`;
	return `${lines} result${lines === 1 ? "" : "s"}${truncated}`;
}

type ToolBlockKind = "call" | "result" | "full";

class EmptyBlock {
	render(): string[] {
		return [];
	}
	invalidate(): void {}
}

class ToolBlock {
	constructor(
		private readonly kind: ToolBlockKind,
		private readonly toolName: string,
		private readonly lines: string[],
		private readonly theme: CompactTheme,
		private readonly borderColor?: string,
	) {}

	render(width: number): string[] {
		const renderWidth = Math.max(8, width - 1);
		const separator = this.theme.fg("borderMuted", "─".repeat(Math.max(8, Math.min(32, renderWidth))));
		const block = this.lines.map((line, index) => {
			if (this.kind === "call") return this.renderTop(line, renderWidth);
			if (this.kind === "full" && index === 0) return this.renderTop(line, renderWidth);
			const isLast = index === this.lines.length - 1;
			return isLast ? this.renderBottom(line, renderWidth) : this.renderBody(line, renderWidth);
		});
		return [separator, "", ...block, ""];
	}

	invalidate(): void {}

	private color(text: string): string {
		return this.theme.fg(this.borderColor ?? toolColor(this.toolName), text);
	}

	private fit(text: string, width: number): string {
		const clipped = truncateToWidth(text, Math.max(1, width), "");
		return `${clipped}${" ".repeat(Math.max(0, width - visibleWidth(clipped)))}`;
	}

	private renderTop(content: string, width: number): string {
		const prefix = this.color("╭─ ");
		const suffix = this.color("╮");
		const innerWidth = Math.max(1, width - 4);
		const fitted = truncateToWidth(content, innerWidth, "");
		const fill = this.color("─".repeat(Math.max(0, innerWidth - visibleWidth(fitted))));
		return `${prefix}${fitted}${fill}${suffix}`;
	}

	private renderBody(content: string, width: number): string {
		const innerWidth = Math.max(1, width - 2);
		return `${this.color("│")}${this.fit(content, innerWidth)}${this.color("│")}`;
	}

	private renderBottom(content: string, width: number): string {
		const prefix = this.color("╰─ ");
		const suffix = this.color("╯");
		const innerWidth = Math.max(1, width - 4);
		const fitted = truncateToWidth(content, innerWidth, "");
		const fill = this.color("─".repeat(Math.max(0, innerWidth - visibleWidth(fitted))));
		return `${prefix}${fitted}${fill}${suffix}`;
	}
}

function topLine(toolName: string, theme: CompactTheme, label: string): string {
	const color = toolColor(toolName);
	const title = `${toolIcon(toolName)} ${toolName}`;
	return `${theme.fg(color, theme.bold(title))} ${theme.fg("toolOutput", label)}`;
}

function midLine(_toolName: string, theme: CompactTheme, text: string): string {
	return theme.fg("toolOutput", text);
}

function bottomLine(_toolName: string, _theme: CompactTheme, text = ""): string {
	return text.trimEnd();
}

function toolText(
	kind: ToolBlockKind,
	toolName: string,
	lines: string[],
	theme: CompactTheme,
	borderColor?: string,
): ToolBlock {
	return new ToolBlock(kind, toolName, lines, theme, borderColor);
}

function renderCall(_toolName: string, _args: any, _theme: CompactTheme, _context: any) {
	return new EmptyBlock();
}

function renderResult(toolName: string, result: any, options: any, theme: CompactTheme, context: any) {
	if (options?.isPartial) {
		return toolText(
			"full",
			toolName,
			[
				topLine(toolName, theme, callLabel(toolName, context?.args)),
				bottomLine(toolName, theme, theme.fg("muted", "running…")),
			],
			theme,
			"warning",
		);
	}

	const summary = summaryFor(toolName, result);
	const text = textContent(result);
	const failed = Boolean(context?.isError || result?.isError);
	const statusColor = failed ? "error" : "success";
	const statusIcon = failed ? "✗" : "✓";
	const expandHint = options?.expanded ? "" : ` ${theme.fg("dim", keyHint("app.tools.expand", "expand"))}`;

	const top = topLine(toolName, theme, callLabel(toolName, context?.args));
	const bottom = bottomLine(
		toolName,
		theme,
		`${theme.fg(statusColor, statusIcon)} ${theme.fg("toolOutput", summary)}${expandHint}`,
	);
	const borderColor = failed ? "error" : "success";

	if (!options?.expanded || !text.trim()) {
		return toolText("full", toolName, [top, bottom], theme, borderColor);
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
	return toolText("full", toolName, lines, theme, borderColor);
}

function padVisible(text: string, width: number): string {
	const clipped = truncateToWidth(text, width, "");
	return `${clipped}${" ".repeat(Math.max(0, width - visibleWidth(clipped)))}`;
}

function stripUserZoneMarkers(line: string): string {
	return line.replaceAll(OSC133_ZONE_START, "").replaceAll(OSC133_ZONE_END, "").replaceAll(OSC133_ZONE_FINAL, "");
}

function randomUserMessageMarker(): string {
	return USER_MESSAGE_EMOJIS[Math.floor(Math.random() * USER_MESSAGE_EMOJIS.length)] ?? "✨";
}

function trimVisualBlankLines(lines: string[]): string[] {
	let start = 0;
	let end = lines.length;
	while (start < end && stripUserZoneMarkers(lines[start] ?? "").trim() === "") start++;
	while (end > start && stripUserZoneMarkers(lines[end - 1] ?? "").trim() === "") end--;
	return lines.slice(start, end);
}

function frameMessage(
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

function frameUserMessage(lines: string[], width: number, theme: CompactTheme, markerText: string): string[] {
	return frameMessage(lines, width, theme, markerText, "accent", "error");
}

function randomAssistantMessageMarker(): string {
	return ASSISTANT_MESSAGE_EMOJIS[Math.floor(Math.random() * ASSISTANT_MESSAGE_EMOJIS.length)] ?? "🤖";
}

function _frameAssistantMessage(lines: string[], width: number, theme: CompactTheme): string[] {
	const marker = randomAssistantMessageMarker();
	return frameMessage(lines, width, theme, marker, "border", "toolTitle");
}

function installGenericToolRendererPatch(pi: ExtensionAPI): void {
	const proto = ToolExecutionComponent?.prototype as any;
	if (!proto || proto[TOOL_EXECUTION_PATCH_SYMBOL]) return;
	const originalGetCallRenderer = proto.getCallRenderer;
	const originalGetResultRenderer = proto.getResultRenderer;
	const originalGetRenderShell = proto.getRenderShell;
	if (
		typeof originalGetCallRenderer !== "function" ||
		typeof originalGetResultRenderer !== "function" ||
		typeof originalGetRenderShell !== "function"
	) {
		return;
	}

	proto.getCallRenderer = function compactFallbackCallRenderer(this: any) {
		const toolName = typeof this?.toolName === "string" ? this.toolName : "tool";
		return (args: any, theme: CompactTheme, context: any) => renderCall(toolName, args, theme, context);
	};

	proto.getResultRenderer = function compactFallbackResultRenderer(this: any) {
		const toolName = typeof this?.toolName === "string" ? this.toolName : "tool";
		return (result: any, options: any, theme: CompactTheme, context: any) =>
			renderResult(toolName, result, options, theme, context);
	};

	proto.getRenderShell = function compactFallbackRenderShell(this: any) {
		return "self";
	};

	proto[TOOL_EXECUTION_PATCH_SYMBOL] = { originalGetCallRenderer, originalGetResultRenderer, originalGetRenderShell };
	pi.on("session_shutdown", () => {
		const state = proto[TOOL_EXECUTION_PATCH_SYMBOL];
		if (!state) return;
		proto.getCallRenderer = state.originalGetCallRenderer;
		proto.getResultRenderer = state.originalGetResultRenderer;
		proto.getRenderShell = state.originalGetRenderShell;
		delete proto[TOOL_EXECUTION_PATCH_SYMBOL];
	});
}

function installMessageRenderers(pi: ExtensionAPI): void {
	const userProto = UserMessageComponent?.prototype as any;
	if (userProto && !userProto[USER_MESSAGE_PATCH_SYMBOL] && typeof userProto.render === "function") {
		const originalRender = userProto.render as (width: number) => string[];
		userProto.render = function compactUserMessageRender(this: any, width: number): string[] {
			const box = this?.contentBox;
			if (box) {
				box.paddingY = 0;
				box.setBgFn?.(undefined);
				box.invalidate?.();
			}
			const frameWidth = Math.max(1, width - 1);
			if (!this[USER_MESSAGE_MARKER_SYMBOL]) this[USER_MESSAGE_MARKER_SYMBOL] = randomUserMessageMarker();
			const rendered = originalRender.call(this, Math.max(1, frameWidth - 2));
			return frameUserMessage(
				rendered,
				frameWidth,
				activeTheme ?? fallbackTheme(),
				this[USER_MESSAGE_MARKER_SYMBOL],
			);
		};
		userProto[USER_MESSAGE_PATCH_SYMBOL] = { originalRender };
	}

	const assistantProto = AssistantMessageComponent?.prototype as any;
	if (
		assistantProto &&
		!assistantProto[ASSISTANT_MESSAGE_PATCH_SYMBOL] &&
		typeof assistantProto.render === "function"
	) {
		const originalRender = assistantProto.render as (width: number) => string[];
		assistantProto.render = function compactAssistantMessageRender(this: any, width: number): string[] {
			const rendered = originalRender.call(this, Math.max(1, width - 3));
			if (this?.hasToolCalls || rendered.length === 0) return rendered;
			const frameWidth = Math.max(1, width - 1);
			if (!this[ASSISTANT_MESSAGE_MARKER_SYMBOL])
				this[ASSISTANT_MESSAGE_MARKER_SYMBOL] = randomAssistantMessageMarker();
			return frameMessage(
				rendered,
				frameWidth,
				activeTheme ?? fallbackTheme(),
				this[ASSISTANT_MESSAGE_MARKER_SYMBOL],
				"border",
				"toolTitle",
			);
		};
		assistantProto[ASSISTANT_MESSAGE_PATCH_SYMBOL] = { originalRender };
	}

	pi.on("session_start", (_event, ctx) => {
		if (ctx.hasUI) activeTheme = ctx.ui.theme as unknown as CompactTheme;
	});
	pi.on("session_shutdown", () => {
		const userState = userProto?.[USER_MESSAGE_PATCH_SYMBOL];
		if (userState) {
			userProto.render = userState.originalRender;
			delete userProto[USER_MESSAGE_PATCH_SYMBOL];
		}
		const assistantState = assistantProto?.[ASSISTANT_MESSAGE_PATCH_SYMBOL];
		if (assistantState) {
			assistantProto.render = assistantState.originalRender;
			delete assistantProto[ASSISTANT_MESSAGE_PATCH_SYMBOL];
		}
		activeTheme = undefined;
	});
}

function fallbackTheme(): CompactTheme {
	return {
		fg: (_color: any, text: string) => text,
		bg: (_color: any, text: string) => text,
		bold: (text: string) => text,
	};
}

function registerDelegatingTool(
	pi: ExtensionAPI,
	name: BuiltinToolName,
	createTool: (cwd: string) => BuiltinTool,
): void {
	const cwd = process.cwd();
	const original = createTool(cwd);
	pi.registerTool({
		name,
		label: name,
		description: original.description,
		promptSnippet: (original as any).promptSnippet,
		parameters: original.parameters as any,
		renderShell: "self",
		async execute(id: string, params: unknown, signal?: AbortSignal, onUpdate?: unknown, ctx?: any) {
			return createTool(ctx?.cwd ?? cwd).execute(id, params, signal, onUpdate, ctx) as any;
		},
		renderCall(args: any, theme: CompactTheme, context: any) {
			return renderCall(name, args, theme, context);
		},
		renderResult(result: any, options: any, theme: CompactTheme, context: any) {
			return renderResult(name, result, options, theme, context);
		},
	} as any);
}

export default function compactTools(pi: ExtensionAPI): void {
	installGenericToolRendererPatch(pi);
	installMessageRenderers(pi);
	registerDelegatingTool(pi, "read", createReadTool as unknown as (cwd: string) => BuiltinTool);
	registerDelegatingTool(pi, "bash", createBashTool as unknown as (cwd: string) => BuiltinTool);
	registerDelegatingTool(pi, "grep", createGrepTool as unknown as (cwd: string) => BuiltinTool);
	registerDelegatingTool(pi, "find", createFindTool as unknown as (cwd: string) => BuiltinTool);
	registerDelegatingTool(pi, "ls", createLsTool as unknown as (cwd: string) => BuiltinTool);
	registerDelegatingTool(pi, "edit", createEditTool as unknown as (cwd: string) => BuiltinTool);
	registerDelegatingTool(pi, "write", createWriteTool as unknown as (cwd: string) => BuiltinTool);
}
