import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { BranchToolBlock } from "./branch-tool-block.js";
import type { CompactTheme } from "./types.js";

const theme: CompactTheme = {
	fg: (_color, text) => text,
	bold: (text) => text,
};

describe("BranchToolBlock", () => {
	it("adds spacer and rule lines around the branch block", () => {
		const block = new BranchToolBlock("full", ["top", "bottom"], theme, (text) => text);
		expect(block.render(20)).toEqual([
			" ".repeat(19),
			"─".repeat(19),
			"● top              ",
			"└─ bottom          ",
			"─".repeat(19),
			" ".repeat(19),
		]);
	});

	it("never renders wider than the available width", () => {
		const block = new BranchToolBlock("full", ["x".repeat(100), "y".repeat(100)], theme, (text) => text);
		const lines = block.render(20);
		expect(lines.every((line) => visibleWidth(line) <= 19)).toBe(true);
	});
});
