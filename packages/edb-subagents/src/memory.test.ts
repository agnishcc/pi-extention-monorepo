import { describe, expect, it } from "vitest";
import { isUnsafeName } from "./memory.js";

describe("isUnsafeName", () => {
	it("returns false for safe names", () => {
		expect(isUnsafeName("index")).toBe(false);
		expect(isUnsafeName("index.ts")).toBe(false);
		expect(isUnsafeName("my-agent")).toBe(false);
		expect(isUnsafeName("my_agent_123")).toBe(false);
		expect(isUnsafeName("Agent2")).toBe(false);
	});

	it("returns true for empty name", () => {
		expect(isUnsafeName("")).toBe(true);
	});

	it("returns true for names over 128 chars", () => {
		expect(isUnsafeName("a".repeat(129))).toBe(true);
	});

	it("returns true for names starting with dot", () => {
		expect(isUnsafeName(".git")).toBe(true);
		expect(isUnsafeName(".DS_Store")).toBe(true);
	});

	it("allows underscores in safe names", () => {
		// The regex allows underscores, so node_modules is technically "safe"
		expect(isUnsafeName("node_modules")).toBe(false);
		expect(isUnsafeName("my_agent")).toBe(false);
	});

	it("returns true for names with special characters", () => {
		expect(isUnsafeName("agent@home")).toBe(true);
		expect(isUnsafeName("agent space")).toBe(true);
	});

	it("returns true for leading hyphen", () => {
		expect(isUnsafeName("-agent")).toBe(true);
	});
});
