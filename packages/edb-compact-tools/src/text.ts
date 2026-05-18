import { MAX_COLLAPSED_TEXT, MAX_EXPANDED_LINES, MAX_LINE_CHARS } from "./constants.js";

export function oneLine(value: unknown): string {
	return String(value ?? "")
		.replace(/\s+/g, " ")
		.trim();
}

export function clip(text: string, max = MAX_COLLAPSED_TEXT): string {
	return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
}

export function lineCount(text: string): number {
	if (!text) return 0;
	return text.split(/\r?\n/).length;
}

export function textContent(result: any): string {
	const content = Array.isArray(result?.content) ? result.content : [];
	return content
		.filter((item: any) => item?.type === "text" && typeof item.text === "string")
		.map((item: any) => item.text)
		.join("\n");
}

export function outputWasTruncated(text: string): boolean {
	return /\btruncated\b|Full output saved to:/i.test(text);
}

export function previewLines(text: string, mode: "head" | "tail", limit = MAX_EXPANDED_LINES): string[] {
	const lines = text.replace(/\s+$/g, "").split(/\r?\n/);
	const selected = mode === "tail" ? lines.slice(-limit) : lines.slice(0, limit);
	return selected.map((line) => clip(line, MAX_LINE_CHARS));
}
