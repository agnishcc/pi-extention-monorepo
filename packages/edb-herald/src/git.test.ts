import { describe, expect, it } from "vitest";
import { parseMode, truncate } from "./git.js";

describe("parseMode", () => {
	it("returns 'commit' for exact 'commit'", () => {
		expect(parseMode("commit")).toBe("commit");
	});

	it("is case-insensitive for 'commit'", () => {
		expect(parseMode("COMMIT")).toBe("commit");
		expect(parseMode("Commit")).toBe("commit");
	});

	it("returns 'pr' for exact 'pr'", () => {
		expect(parseMode("pr")).toBe("pr");
	});

	it("is case-insensitive for 'pr'", () => {
		expect(parseMode("PR")).toBe("pr");
		expect(parseMode("Pr")).toBe("pr");
	});

	it("returns 'both' for exact 'both'", () => {
		expect(parseMode("both")).toBe("both");
	});

	it("is case-insensitive for 'both'", () => {
		expect(parseMode("BOTH")).toBe("both");
		expect(parseMode("Both")).toBe("both");
	});

	it("trims whitespace from input", () => {
		expect(parseMode("  commit  ")).toBe("commit");
		expect(parseMode("  pr  ")).toBe("pr");
		expect(parseMode("  both  ")).toBe("both");
	});

	it("defaults to 'both' for unrecognized input", () => {
		expect(parseMode("anything")).toBe("both");
		expect(parseMode("random")).toBe("both");
	});

	it("returns 'both' for empty string", () => {
		expect(parseMode("")).toBe("both");
	});
});

describe("truncate", () => {
	it("returns text unchanged when under maxLen", () => {
		expect(truncate("hello", 10)).toBe("hello");
	});

	it("returns text unchanged when exactly maxLen", () => {
		expect(truncate("hello", 5)).toBe("hello");
	});

	it("truncates text longer than maxLen", () => {
		const result = truncate("hello world", 5);
		expect(result).toContain("hello");
		expect(result).toContain("...");
		expect(result).toContain("truncated");
	});

	it("omits correct number of characters", () => {
		const result = truncate("hello world", 5);
		// "hello" is 5 chars, rest is " world" (6 chars)
		expect(result).toContain("6 additional");
	});

	it("handles maxLen=0", () => {
		const result = truncate("hello world", 0);
		expect(result).toContain("...");
		expect(result).toContain("truncated");
	});

	it("handles maxLen=1", () => {
		const result = truncate("abc", 1);
		expect(result).toContain("a");
		expect(result).toContain("...");
		expect(result).toContain("2 additional");
	});

	it("handles empty string", () => {
		const result = truncate("", 10);
		expect(result).toBe("");
	});
});
