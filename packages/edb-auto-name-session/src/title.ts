import type { SessionEntry } from "@mariozechner/pi-coding-agent";

const MAX_PROMPT_CHARS = 4_000;
const MAX_TITLE_CHARS = 60;

type TextPart = {
	type?: string;
	text?: string;
};

export function shouldArmAutoNaming(entries: SessionEntry[], currentName: string | undefined): boolean {
	return !currentName?.trim() && countUserMessages(entries) === 0;
}

export function countUserMessages(entries: SessionEntry[]): number {
	return entries.filter(isUserMessageEntry).length;
}

export function extractUserText(content: unknown): string {
	if (typeof content === "string") return normalizePrompt(content);
	if (!Array.isArray(content)) return "";

	return normalizePrompt(
		content
			.filter(isTextPart)
			.map((part) => part.text)
			.join("\n"),
	);
}

export function sanitizeSessionName(value: string): string | undefined {
	const firstLine = value
		.replace(/^```[a-z0-9_-]*\s*/i, "")
		.replace(/```$/g, "")
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find(Boolean);

	if (!firstLine) return undefined;

	let title = firstLine
		.replace(/^(title|session name)\s*:\s*/i, "")
		.replace(/^[-*]\s*/, "")
		.replace(/[.?!:;,]+$/g, "")
		.replace(/^['"`]+|['"`]+$/g, "")
		.replace(/\s+/g, " ")
		.trim();

	if (!title) return undefined;
	if (title.length <= MAX_TITLE_CHARS) return title;

	title = title.slice(0, MAX_TITLE_CHARS).trimEnd();
	const lastSpace = title.lastIndexOf(" ");
	if (lastSpace > 20) title = title.slice(0, lastSpace);
	return title.trim() || undefined;
}

function isUserMessageEntry(entry: SessionEntry): entry is SessionEntry & {
	type: "message";
	message: { role: "user"; content: unknown };
} {
	return entry.type === "message" && entry.message.role === "user";
}

function isTextPart(value: unknown): value is TextPart & { type: "text"; text: string } {
	return Boolean(
		value &&
			typeof value === "object" &&
			(value as TextPart).type === "text" &&
			typeof (value as TextPart).text === "string",
	);
}

function normalizePrompt(value: string): string {
	return value.replace(/\r\n/g, "\n").trim().slice(0, MAX_PROMPT_CHARS);
}
