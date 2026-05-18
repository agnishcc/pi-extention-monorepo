import { describe, expect, it } from "vitest";
import * as constants from "./constants.js";

// ── constants ──────────────────────────────────────────────────────────────

describe("ANSI constants", () => {
	it("exports ANSI_PURPLE and ANSI_RESET", () => {
		expect(constants.ANSI_PURPLE).toMatch(/^\x1b\[38;5;\d+m$/);
		expect(constants.ANSI_RESET).toBe("\x1b[0m");
	});

	it("exports emoji arrays", () => {
		expect(constants.USER_MESSAGE_EMOJIS.length).toBeGreaterThan(0);
		expect(constants.ASSISTANT_MESSAGE_EMOJIS.length).toBeGreaterThan(0);
	});

	it("exports OSC133 markers", () => {
		expect(constants.OSC133_ZONE_START).toBe("\x1b]133;A\x07");
		expect(constants.OSC133_ZONE_END).toBe("\x1b]133;B\x07");
		expect(constants.OSC133_ZONE_FINAL).toBe("\x1b]133;C\x07");
	});
});
