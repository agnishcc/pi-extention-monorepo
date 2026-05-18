import { describe, expect, it } from "vitest";
import { formatAge, wordCount } from "./utils.js";

describe("formatAge", () => {
	it("formats seconds", () => {
		const now = Date.now();
		expect(formatAge(now - 0)).toBe("0s ago");
		expect(formatAge(now - 30 * 1000)).toBe("30s ago");
	});

	it("formats minutes", () => {
		const now = Date.now();
		expect(formatAge(now - 60 * 1000)).toBe("1m ago");
		expect(formatAge(now - 5 * 60 * 1000)).toBe("5m ago");
	});

	it("formats hours", () => {
		const now = Date.now();
		expect(formatAge(now - 3600 * 1000)).toBe("1h ago");
		expect(formatAge(now - 12 * 3600 * 1000)).toBe("12h ago");
	});

	it("formats days", () => {
		const now = Date.now();
		expect(formatAge(now - 86400 * 1000)).toBe("1d ago");
		expect(formatAge(now - 7 * 86400 * 1000)).toBe("7d ago");
	});
});

describe("wordCount", () => {
	it("counts words", () => {
		expect(wordCount("hello world")).toBe(2);
		expect(wordCount("one two three")).toBe(3);
	});

	it("ignores extra whitespace", () => {
		expect(wordCount("  hello   world  ")).toBe(2);
	});

	it("returns 0 for empty string", () => {
		expect(wordCount("")).toBe(0);
		expect(wordCount("   ")).toBe(0);
	});

	it("handles newline-separated words", () => {
		expect(wordCount("hello\nworld")).toBe(2);
	});
});
