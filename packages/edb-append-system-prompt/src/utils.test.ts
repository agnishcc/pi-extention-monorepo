import { describe, expect, it } from "vitest";
import { activeInjectionText, statusIndicator } from "./utils.js";

describe("activeInjectionText", () => {
	it("returns empty when disabled", () => {
		expect(activeInjectionText({ text: "hello", enabled: false })).toBe("");
	});

	it("returns empty when enabled but text is empty", () => {
		expect(activeInjectionText({ text: "", enabled: true })).toBe("");
	});

	it("returns empty when enabled but text is whitespace", () => {
		expect(activeInjectionText({ text: "   \n\t ", enabled: true })).toBe("");
	});

	it("returns the trimmed text when enabled", () => {
		expect(activeInjectionText({ text: "  be helpful  ", enabled: true })).toBe("be helpful");
	});
});

describe("statusIndicator", () => {
	it("returns undefined when text is empty", () => {
		expect(statusIndicator({ text: "", enabled: true })).toBeUndefined();
		expect(statusIndicator({ text: "  ", enabled: false })).toBeUndefined();
	});

	it("returns the active label when enabled", () => {
		expect(statusIndicator({ text: "be helpful", enabled: true })).toBe("⊕ inject on");
	});

	it("returns the muted label when disabled but set", () => {
		expect(statusIndicator({ text: "be helpful", enabled: false })).toBe("○ inject off");
	});
});
