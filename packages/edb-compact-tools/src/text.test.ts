import { describe, expect, it } from "vitest";
import { clip, lineCount, oneLine, outputWasTruncated, previewLines, textContent } from "./text.js";

describe("oneLine", () => {
	it("collapses whitespace", () => {
		expect(oneLine("hello   world")).toBe("hello world");
	});

	it("trims edges", () => {
		expect(oneLine("  hello  ")).toBe("hello");
	});

	it("handles null and undefined as empty string", () => {
		expect(oneLine(null)).toBe("");
		expect(oneLine(undefined)).toBe("");
	});
});

describe("clip", () => {
	it("passes through short text", () => {
		expect(clip("hello")).toBe("hello");
	});

	it("truncates long text with ellipsis", () => {
		expect(clip("a".repeat(150))).toBe(`${"a".repeat(119)}…`);
	});

	it("respects custom max", () => {
		expect(clip("hello world", 5)).toBe("hell…");
	});

	it("handles empty string", () => {
		expect(clip("")).toBe("");
	});
});

describe("lineCount", () => {
	it("counts lines", () => {
		expect(lineCount("a\nb\nc")).toBe(3);
	});

	it("handles CRLF", () => {
		expect(lineCount("a\r\nb\r\nc")).toBe(3);
	});

	it("returns 0 for empty", () => {
		expect(lineCount("")).toBe(0);
	});
});

describe("textContent", () => {
	it("extracts text from content array", () => {
		const result = {
			content: [
				{ type: "text", text: "hello" },
				{ type: "text", text: "world" },
			],
		};
		expect(textContent(result)).toBe("hello\nworld");
	});

	it("filters non-text items", () => {
		const result = {
			content: [
				{ type: "text", text: "hello" },
				{ type: "image", text: "world" },
			],
		};
		expect(textContent(result)).toBe("hello");
	});

	it("handles missing content", () => {
		expect(textContent({})).toBe("");
		expect(textContent(null)).toBe("");
	});

	it("joins multiple text items", () => {
		const result = {
			content: [
				{ type: "text", text: "line1" },
				{ type: "text", text: "line2" },
			],
		};
		expect(textContent(result)).toBe("line1\nline2");
	});
});

describe("outputWasTruncated", () => {
	it("detects truncation markers", () => {
		expect(outputWasTruncated("Output truncated")).toBe(true);
		expect(outputWasTruncated("Full output saved to: /tmp/out.txt")).toBe(true);
	});

	it("is case-insensitive", () => {
		expect(outputWasTruncated("TRUNCATED")).toBe(true);
	});

	it("returns false for clean output", () => {
		expect(outputWasTruncated("hello world")).toBe(false);
	});
});

describe("previewLines", () => {
	it("takes head lines by default", () => {
		const lines = "a\nb\nc\nd\ne".split("\n");
		const text = lines.join("\n");
		expect(previewLines(text, "head")).toEqual(["a", "b", "c", "d", "e"]);
	});

	it("takes tail lines when mode is tail", () => {
		const text = "a\nb\nc\nd\ne";
		expect(previewLines(text, "tail", 3)).toEqual(["c", "d", "e"]);
	});

	it("respects limit", () => {
		const text = "a\nb\nc\nd\ne";
		expect(previewLines(text, "head", 3)).toEqual(["a", "b", "c"]);
	});

	it("clips long lines", () => {
		const text = "a".repeat(200);
		expect(previewLines(text, "head", 1)[0]!.length).toBeLessThanOrEqual(121);
	});
});
