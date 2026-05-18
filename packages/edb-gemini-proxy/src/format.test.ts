import * as os from "node:os";
import { describe, expect, it } from "vitest";
import { formatToolCall } from "./format.js";

const HOME = os.homedir();

describe("formatToolCall", () => {
	it("formats read_file", () => {
		expect(formatToolCall("read_file", { path: "/tmp/foo.ts" })).toBe("read /tmp/foo.ts");
	});

	it("shortens home paths", () => {
		const userPath = `${HOME}/project/src/index.ts`;
		expect(formatToolCall("read_file", { path: userPath })).toBe(`read ~${userPath.slice(HOME.length)}`);
	});

	it("formats write_file", () => {
		expect(formatToolCall("write_file", { path: "/tmp/foo.ts" })).toBe("write file /tmp/foo.ts");
	});

	it("formats edit_file", () => {
		expect(formatToolCall("edit_file", { path: "/tmp/foo.ts" })).toBe("edit file /tmp/foo.ts");
	});

	it("formats run_shell_command with truncation", () => {
		const longCmd = `echo ${"x".repeat(80)}`;
		const result = formatToolCall("run_shell_command", { command: longCmd });
		expect(result.startsWith("$")).toBe(true);
		expect(result.endsWith("…")).toBe(true);
	});

	it("formats short shell commands", () => {
		expect(formatToolCall("run_shell_command", { command: "ls -la" })).toBe("$ ls -la");
	});

	it("formats list_directory", () => {
		expect(formatToolCall("list_directory", { path: "/tmp" })).toBe("ls /tmp");
	});

	it("formats list_directory with default path", () => {
		expect(formatToolCall("list_directory", {})).toBe("ls .");
	});

	it("formats grep_search with pattern", () => {
		expect(formatToolCall("grep_search", { pattern: "TODO" })).toBe("grep TODO");
	});

	it("truncates long grep patterns", () => {
		const longPattern = "x".repeat(50);
		const result = formatToolCall("grep_search", { pattern: longPattern });
		expect(result.startsWith("grep ")).toBe(true);
		expect(result.endsWith("…")).toBe(true);
	});

	it("formats web_search", () => {
		expect(formatToolCall("web_search", { query: "how to code" })).toBe("search: how to code");
	});

	it("truncates long search queries", () => {
		const longQuery = "x".repeat(80);
		const result = formatToolCall("web_search", { query: longQuery });
		expect(result.startsWith("search: ")).toBe(true);
		expect(result.length).toBeLessThan(65);
	});

	it("falls back to JSON for unknown tools", () => {
		expect(formatToolCall("unknown_tool", { key: "val" })).toBe('unknown_tool {"key":"val"}');
	});

	it("handles missing params gracefully", () => {
		expect(formatToolCall("read_file", {})).toBe("read ...");
	});
});
