import * as os from "node:os";
import { describe, expect, it } from "vitest";
import { formatToolCall } from "./format.js";

const HOME = os.homedir();

describe("formatToolCall", () => {
	it("formats Read tool call", () => {
		expect(formatToolCall("Read", { path: "/tmp/foo.ts" })).toBe("read /tmp/foo.ts");
	});

	it("shortens paths starting with home", () => {
		const userPath = `${HOME}/project/src/index.ts`;
		expect(formatToolCall("Read", { path: userPath })).toBe(`read ~${userPath.slice(HOME.length)}`);
	});

	it("formats Bash with truncated long commands", () => {
		const longCmd = `echo ${"x".repeat(80)}`;
		const result = formatToolCall("Bash", { command: longCmd });
		// Format: "$ <60 chars>…" — total ~63 chars
		expect(result.startsWith("$")).toBe(true);
		expect(result.length).toBeLessThan(70);
		expect(result.endsWith("…")).toBe(true);
	});

	it("formats short Bash commands", () => {
		expect(formatToolCall("Bash", { command: "ls -la" })).toBe("$ ls -la");
	});

	it("formats Edit tool call", () => {
		expect(formatToolCall("Edit", { path: "/tmp/foo.ts" })).toBe("edit /tmp/foo.ts");
	});

	it("formats Write tool call", () => {
		expect(formatToolCall("Write", { path: "/tmp/foo.ts" })).toBe("write /tmp/foo.ts");
	});

	it("falls back to JSON for unknown tools", () => {
		expect(formatToolCall("UnknownTool", { arg: "val" })).toBe('UnknownTool {"arg":"val"}');
	});

	it("truncates long JSON for unknown tools", () => {
		const longVal = "x".repeat(80);
		const result = formatToolCall("UnknownTool", { val: longVal });
		expect(result.endsWith("…")).toBe(true);
		expect(result.length).toBeLessThan(70);
	});

	it("handles missing path/command gracefully", () => {
		expect(formatToolCall("Read", {})).toBe("read ...");
		expect(formatToolCall("Bash", {})).toBe("$ ...");
	});
});
