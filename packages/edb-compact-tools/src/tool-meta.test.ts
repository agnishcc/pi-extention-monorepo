import { describe, expect, it } from "vitest";
import { callLabel, isSkillPath, purple, summaryFor, toolColor, toolIcon } from "./tool-meta.js";

describe("isSkillPath", () => {
	it("detects .agents/skills paths", () => {
		expect(isSkillPath(".agents/skills/my-skill/SKILL.md")).toBe(true);
	});

	it("detects .pi/agent/skills paths", () => {
		expect(isSkillPath(".pi/agent/skills/my-skill/SKILL.md")).toBe(true);
	});

	it("returns false for regular paths", () => {
		expect(isSkillPath("/Users/foo/project/src/index.ts")).toBe(false);
	});

	it("returns false for non-string inputs", () => {
		expect(isSkillPath(null)).toBe(false);
		expect(isSkillPath(undefined)).toBe(false);
		expect(isSkillPath(123)).toBe(false);
	});
});

describe("purple", () => {
	it("wraps text with ANSI purple codes", () => {
		const result = purple("hello");
		expect(result).toContain("hello");
		expect(result).toContain("\x1b[38;5;141m");
		expect(result).toContain("\x1b[0m");
	});
});

describe("toolColor", () => {
	it("returns bashMode for bash", () => {
		expect(toolColor("bash")).toBe("bashMode");
	});

	it("returns toolTitle for read (non-skill)", () => {
		expect(toolColor("read", { path: "/tmp/foo.ts" })).toBe("toolTitle");
	});

	it("returns purple for read (skill file)", () => {
		expect(toolColor("read", { path: ".agents/skills/my-skill/SKILL.md" })).toBe("purple");
	});

	it("returns success for grep", () => {
		expect(toolColor("grep")).toBe("success");
	});

	it("returns accent for find", () => {
		expect(toolColor("find")).toBe("accent");
	});

	it("returns warning for ls", () => {
		expect(toolColor("ls")).toBe("warning");
	});

	it("returns toolDiffAdded for edit", () => {
		expect(toolColor("edit")).toBe("toolDiffAdded");
	});

	it("returns accent for write", () => {
		expect(toolColor("write")).toBe("accent");
	});

	it("returns accent for unknown tools", () => {
		expect(toolColor("unknown_tool")).toBe("accent");
	});
});

describe("toolIcon", () => {
	it("returns correct icon per tool", () => {
		expect(toolIcon("bash")).toBe("⚙️");
		expect(toolIcon("read")).toBe("📖");
		expect(toolIcon("grep")).toBe("🔎");
		expect(toolIcon("find")).toBe("🧭");
		expect(toolIcon("ls")).toBe("📁");
		expect(toolIcon("edit")).toBe("✏️");
		expect(toolIcon("write")).toBe("📝");
	});

	it("returns default icon for unknown tools", () => {
		expect(toolIcon("unknown")).toBe("🧩");
	});
});

describe("callLabel", () => {
	it("returns clipped command for bash", () => {
		expect(callLabel("bash", { command: "ls -la" })).toBe("ls -la");
	});

	it("truncates long bash commands", () => {
		const long = `echo ${"x".repeat(150)}`;
		const result = callLabel("bash", { command: long });
		expect(result.length).toBeLessThanOrEqual(143);
		expect(result.endsWith("…")).toBe(true);
	});

	it("returns clipped path for read", () => {
		expect(callLabel("read", { path: "/tmp/foo.ts" })).toBe("/tmp/foo.ts");
	});

	it("formats grep with path", () => {
		expect(callLabel("grep", { pattern: "TODO", path: "/src" })).toBe("TODO in /src");
	});

	it("returns default for grep without path", () => {
		expect(callLabel("grep", { pattern: "TODO" })).toBe("TODO in .");
	});

	it("formats find with path", () => {
		expect(callLabel("find", { path: "/tmp" })).toBe("/tmp");
	});

	it("formats edit with replacement count", () => {
		expect(callLabel("edit", { path: "foo.ts", edits: [{}, {}] })).toBe("foo.ts · 2 replacements");
	});

	it("formats write with bytes", () => {
		expect(callLabel("write", { path: "foo.ts", content: "hello world" })).toBe("foo.ts · 11 bytes");
	});
});

describe("summaryFor", () => {
	it("formats bash exit code", () => {
		const result = { content: [{ type: "text", text: "hello\nexit 0" }] };
		expect(summaryFor("bash", result)).toMatch(/exit 0/);
	});

	it("shows truncated marker when output was truncated", () => {
		const result = { content: [{ type: "text", text: "hello\nOutput truncated" }] };
		expect(summaryFor("bash", result)).toContain("truncated");
	});

	it("formats read line count", () => {
		const result = { content: [{ type: "text", text: "line1\nline2\nline3" }] };
		expect(summaryFor("read", result)).toBe("3 lines");
	});

	it("formats single line as singular", () => {
		const result = { content: [{ type: "text", text: "line1" }] };
		expect(summaryFor("read", result)).toBe("1 line");
	});

	it("formats ls item count", () => {
		const result = { content: [{ type: "text", text: "file1\nfile2" }] };
		expect(summaryFor("ls", result)).toBe("2 items");
	});

	it("formats edit diff stats", () => {
		const result = {
			content: [{ type: "text", text: "done" }],
			details: { diff: "@@ -1,3 +1,4 @@\n+added1\n+added2\n-removed1\n-removed2" },
		};
		expect(summaryFor("edit", result)).toBe("+2 -2");
	});

	it("falls back to line count for edit without diff", () => {
		const result = { content: [{ type: "text", text: "a\nb" }] };
		expect(summaryFor("edit", result)).toBe("2 lines");
	});

	it("formats write line count", () => {
		const result = { content: [{ type: "text", text: "line1\nline2" }] };
		expect(summaryFor("write", result)).toBe("2 lines");
	});

	it("formats grep result count", () => {
		const result = { content: [{ type: "text", text: "match1\nmatch2\nmatch3" }] };
		expect(summaryFor("grep", result)).toBe("3 results");
	});

	it("formats find result count", () => {
		const result = { content: [{ type: "text", text: "file1\nfile2\nfile3\nfile4" }] };
		expect(summaryFor("find", result)).toBe("4 results");
	});

	it("returns '1 result' for single result", () => {
		const result = { content: [{ type: "text", text: "only" }] };
		expect(summaryFor("grep", result)).toBe("1 result");
	});
});
