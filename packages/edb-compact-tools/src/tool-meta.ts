import { ANSI_PURPLE, ANSI_RESET } from "./constants.js";
import { clip, lineCount, oneLine, outputWasTruncated, textContent } from "./text.js";

// ── Skill path detection ─────────────────────────────────────────

export function isSkillPath(path: unknown): boolean {
	if (typeof path !== "string") return false;
	return path.includes(".agents/skills/") || path.includes(".pi/agent/skills/");
}

export function purple(text: string): string {
	return `${ANSI_PURPLE}${text}${ANSI_RESET}`;
}

// ── Tool metadata registry ───────────────────────────────────────

type ToolMeta = {
	color: string | ((args?: any) => string);
	icon: string;
	label: (args: any) => string;
	summary: (result: any) => string;
};

const TOOL_REGISTRY: Record<string, ToolMeta> = {
	bash: {
		color: "bashMode",
		icon: "⚙️",
		label: (args) => clip(oneLine(args?.command), 140),
		summary: (result) => {
			const text = textContent(result);
			const lines = lineCount(text);
			const truncated = outputWasTruncated(text) ? " · truncated" : "";
			const exitMatch = text.match(/Exit code:\s*(-?\d+)/i) ?? text.match(/exit(?:ed)?(?: code)?\s*(-?\d+)/i);
			const exit = exitMatch?.[1] ?? (result?.isError ? "1" : "0");
			return `exit ${exit} · ${lines} line${lines === 1 ? "" : "s"}${truncated}`;
		},
	},
	read: {
		color: (args) => (isSkillPath(args?.path) ? "purple" : "toolTitle"),
		icon: "📖",
		label: (args) => clip(oneLine(args?.path), 140),
		summary: (result) => {
			const text = textContent(result);
			const lines = lineCount(text);
			const truncated = outputWasTruncated(text) ? " · truncated" : "";
			return `${lines} line${lines === 1 ? "" : "s"}${truncated}`;
		},
	},
	grep: {
		color: "success",
		icon: "🔎",
		label: (args) => {
			const pattern = oneLine(args?.pattern);
			const path = oneLine(args?.path ?? args?.glob ?? ".");
			return clip(`${pattern}${path ? ` in ${path}` : ""}`, 140);
		},
		summary: (result) => {
			const text = textContent(result);
			const lines = lineCount(text);
			const truncated = outputWasTruncated(text) ? " · truncated" : "";
			return `${lines} result${lines === 1 ? "" : "s"}${truncated}`;
		},
	},
	find: {
		color: "accent",
		icon: "🧭",
		label: (args) => clip(oneLine(args?.path ?? args?.pattern ?? "."), 140),
		summary: (result) => {
			const text = textContent(result);
			const lines = lineCount(text);
			const truncated = outputWasTruncated(text) ? " · truncated" : "";
			return `${lines} result${lines === 1 ? "" : "s"}${truncated}`;
		},
	},
	ls: {
		color: "warning",
		icon: "📁",
		label: (args) => clip(oneLine(args?.path), 140),
		summary: (result) => {
			const text = textContent(result);
			const lines = lineCount(text);
			const truncated = outputWasTruncated(text) ? " · truncated" : "";
			return `${lines} item${lines === 1 ? "" : "s"}${truncated}`;
		},
	},
	edit: {
		color: "toolDiffAdded",
		icon: "✏️",
		label: (args) => {
			const count = Array.isArray(args?.edits) ? args.edits.length : args?.oldText && args?.newText ? 1 : 0;
			return clip(
				`${oneLine(args?.path ?? args?.file_path)}${count ? ` · ${count} replacement${count === 1 ? "" : "s"}` : ""}`,
				140,
			);
		},
		summary: (result) => {
			const text = textContent(result);
			const lines = lineCount(text);
			const truncated = outputWasTruncated(text) ? " · truncated" : "";
			const diff = typeof result?.details?.diff === "string" ? result.details.diff : "";
			const added = diff
				.split(/\r?\n/)
				.filter((line: string) => line.startsWith("+") && !line.startsWith("+++")).length;
			const removed = diff
				.split(/\r?\n/)
				.filter((line: string) => line.startsWith("-") && !line.startsWith("---")).length;
			return diff ? `+${added} -${removed}` : `${lines} line${lines === 1 ? "" : "s"}${truncated}`;
		},
	},
	write: {
		color: "accent",
		icon: "📝",
		label: (args) => {
			const bytes = typeof args?.content === "string" ? Buffer.byteLength(args.content, "utf8") : 0;
			return clip(`${oneLine(args?.path ?? args?.file_path)}${bytes ? ` · ${bytes} bytes` : ""}`, 140);
		},
		summary: (result) => {
			const text = textContent(result);
			const lines = lineCount(text);
			const truncated = outputWasTruncated(text) ? " · truncated" : "";
			return `${lines} line${lines === 1 ? "" : "s"}${truncated}`;
		},
	},
};

const DEFAULT_META: ToolMeta = {
	color: "accent",
	icon: "🧩",
	label: (args) => {
		const compactArgs = oneLine(JSON.stringify(args ?? {}));
		return clip(compactArgs === "{}" ? "" : compactArgs, 140);
	},
	summary: (result) => {
		const text = textContent(result);
		const lines = lineCount(text);
		const truncated = outputWasTruncated(text) ? " · truncated" : "";
		return `${lines} result${lines === 1 ? "" : "s"}${truncated}`;
	},
};

function getMeta(toolName: string): ToolMeta {
	return TOOL_REGISTRY[toolName] ?? DEFAULT_META;
}

export function toolColor(toolName: string, args?: any): string {
	const color = getMeta(toolName).color;
	return typeof color === "function" ? color(args) : color;
}

export function toolIcon(toolName: string): string {
	return getMeta(toolName).icon;
}

export function callLabel(toolName: string, args: any): string {
	return getMeta(toolName).label(args);
}

export function summaryFor(toolName: string, result: any): string {
	return getMeta(toolName).summary(result);
}
