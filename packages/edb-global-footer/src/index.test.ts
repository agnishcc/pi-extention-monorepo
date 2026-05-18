import { describe, expect, it } from "vitest";
import { formatThinkingLabel, formatTokens, sanitizeStatusText } from "./format.js";
import { parseGitStatus } from "./git.js";
import { withIcon } from "./icons.js";
import { formatTps } from "./tps.js";

describe("formatTokens", () => {
	it("formats small numbers without suffix", () => {
		expect(formatTokens(0)).toBe("0");
		expect(formatTokens(999)).toBe("999");
	});

	it("formats K suffix for thousands", () => {
		expect(formatTokens(1000)).toBe("1.0k");
		expect(formatTokens(1500)).toBe("1.5k");
		expect(formatTokens(9500)).toBe("9.5k");
	});

	it("formats M suffix for millions", () => {
		expect(formatTokens(1_000_000)).toBe("1.0M");
		expect(formatTokens(1_500_000)).toBe("1.5M");
	});

	it("formats M suffix for billions", () => {
		expect(formatTokens(1_000_000_000)).toBe("1000M");
	});
});

describe("formatThinkingLabel", () => {
	it("returns MI for minimal", () => {
		expect(formatThinkingLabel("minimal")).toBe("MI");
	});

	it("returns L for low", () => {
		expect(formatThinkingLabel("low")).toBe("L");
	});

	it("returns M for medium", () => {
		expect(formatThinkingLabel("medium")).toBe("M");
	});

	it("returns H for high", () => {
		expect(formatThinkingLabel("high")).toBe("H");
	});

	it("returns XH for xhigh", () => {
		expect(formatThinkingLabel("xhigh")).toBe("XH");
	});

	it("returns empty string for off", () => {
		expect(formatThinkingLabel("off")).toBe("");
	});
});

describe("sanitizeStatusText", () => {
	it("replaces newlines with spaces", () => {
		expect(sanitizeStatusText("hello\nworld")).toBe("hello world");
	});

	it("replaces carriage returns with spaces", () => {
		expect(sanitizeStatusText("hello\rworld")).toBe("hello world");
	});

	it("replaces tabs with spaces", () => {
		expect(sanitizeStatusText("hello\tworld")).toBe("hello world");
	});

	it("collapses multiple spaces", () => {
		expect(sanitizeStatusText("hello    world")).toBe("hello world");
	});

	it("handles combined edge cases", () => {
		expect(sanitizeStatusText("hello\r\n\tworld")).toBe("hello world");
	});
});

describe("parseGitStatus", () => {
	it("parses branch from porcelain=v2 format", () => {
		const output = `# branch.oid abc1234
# branch.head main
# branch.upstream origin/main
# branch.ab +1 -2
 M file.txt`;
		const result = parseGitStatus(output);
		expect(result.branch).toBe("main");
		expect(result.ahead).toBe(1);
		expect(result.behind).toBe(2);
		expect(result.dirty).toBe(true);
	});

	it("handles detached HEAD", () => {
		const output = `# branch.oid abc1234
# branch.head (detached at abc1234)
`;
		const result = parseGitStatus(output);
		expect(result.branch).toBeNull();
	});

	it("marks dirty when non-comment lines present", () => {
		const output = `# branch.oid abc1234
# branch.head main
 M modified.txt`;
		const result = parseGitStatus(output);
		expect(result.dirty).toBe(true);
	});
});

describe("withIcon", () => {
	it("combines icon and text", () => {
		expect(withIcon("🚀", "Launch")).toBe("🚀 Launch");
	});

	it("returns text only when icon is empty", () => {
		expect(withIcon("", "Launch")).toBe("Launch");
	});
});

describe("formatTps", () => {
	it("formats 0 tps as 0", () => {
		expect(formatTps(0)).toBe("0");
	});

	it("formats single tps", () => {
		expect(formatTps(1)).toBe("1.0");
	});

	it("formats multiple tps", () => {
		expect(formatTps(10)).toBe("10");
	});

	it("rounds large tps", () => {
		expect(formatTps(15.7)).toBe("16");
	});
});
