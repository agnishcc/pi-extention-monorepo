import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { DottedParagraph, ThinkingParagraph } from "./message-frame.js";

const markdownTheme = {
	heading: (s: string) => s,
	link: (s: string) => s,
	linkUrl: (s: string) => s,
	code: (s: string) => s,
	codeBlock: (s: string) => s,
	codeBlockBorder: (s: string) => s,
	quote: (s: string) => s,
	quoteBorder: (s: string) => s,
	hr: (s: string) => s,
	listBullet: (s: string) => s,
	bold: (s: string) => s,
	italic: (s: string) => s,
	strikethrough: (s: string) => s,
	underline: (s: string) => s,
	highlightCode: (code: string) => code.split("\n"),
};

describe("message frame paragraphs", () => {
	it("keeps thinking lines within width", () => {
		const paragraph = new ThinkingParagraph("x".repeat(200), markdownTheme as any);
		const lines = paragraph.render(40);
		expect(lines.every((line) => visibleWidth(line) <= 40)).toBe(true);
		expect(lines[0]).toContain("✻ thinking:");
	});

	it("cleans old persisted ANSI completion artifacts and keeps only the latest completion", () => {
		const paragraph = new DottedParagraph(
			"Answer\n\n【38;2;128;128;128m✓ · Spelunked · 2s】\n\n✓ · Transmuted · 4s",
			markdownTheme as any,
		);
		const rendered = paragraph.render(80).join("\n");
		expect(rendered).not.toContain("【38");
		expect(rendered).not.toContain("Spelunked");
		expect(rendered).toContain("✓ · Transmuted · 4s");
	});
});
