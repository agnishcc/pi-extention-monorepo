import { describe, expect, it, vi } from "vitest";
import type { PromptComparisonResult } from "./compare";
import {
	formatDiffDisplayLines,
	formatNumberedLines,
	formatSummaryDisplayLines,
	ScrollableTabContent,
	TabbedDiffOverlay,
} from "./overlay";

describe("edb-system-prompt-watch overlay components", () => {
	const mockTheme = {
		fg: (_c: string, s: string) => s,
		bg: (_c: string, s: string) => s,
		bold: (s: string) => s,
	} as any;

	const dummyComparison: PromptComparisonResult = {
		isIdentical: false,
		piVersion: "0.83.0",
		promptSourcePath: "/path/to/system-prompt.js",
		activePrompt: "line 1\nline 2",
		defaultPrompt: "line 1\nline 3",
		missingFromActive: ["missing rule 1"],
		modifiedOrChanged: [{ defaultItem: "default rule", activeItem: "active rule", similarity: 0.8 }],
		uniqueToActive: ["custom rule 1"],
		unifiedDiff: "--- SYSTEM.md\n+++ SYSTEM.md\n@@ -1,2 +1,2 @@\n line 1\n-line 2\n+line 3",
		formattedSummary: "# Summary",
	};

	describe("formatters", () => {
		it("formatDiffDisplayLines styles unified diff lines", () => {
			const lines = formatDiffDisplayLines(dummyComparison.unifiedDiff, mockTheme);
			expect(lines.length).toBeGreaterThan(0);
			expect(lines.some((l) => l.includes("---"))).toBe(true);
			expect(lines.some((l) => l.includes("+line 3"))).toBe(true);
		});

		it("formatNumberedLines formats lines with line numbers", () => {
			const lines = formatNumberedLines("first line\nsecond line", mockTheme);
			expect(lines).toHaveLength(2);
			expect(lines[0]).toContain("1 │ first line");
			expect(lines[1]).toContain("2 │ second line");
		});

		it("formatSummaryDisplayLines formats comparison summary", () => {
			const lines = formatSummaryDisplayLines(dummyComparison, mockTheme);
			const text = lines.join("\n");
			expect(text).toContain("System Prompt Comparison");
			expect(text).toContain("Parts We Don't Have");
			expect(text).toContain("Parts That Have Changed");
			expect(text).toContain("Custom Additions");
		});
	});

	describe("ScrollableTabContent", () => {
		it("handles scrolling and search navigation", () => {
			const tab = new ScrollableTabContent(
				{
					rawText: "line one\nline two\nline three\nline four",
					displayLines: ["line one", "line two", "line three", "line four"],
					theme: mockTheme,
				},
				"TestTab",
			);

			expect(tab.name).toBe("TestTab");
			expect(tab.renderContent(80, 2)).toEqual(["line one", "line two"]);

			// Scroll down
			expect(tab.handleInput("j")).toBe(true);
			expect(tab.renderContent(80, 2)).toEqual(["line two", "line three"]);

			// Search mode
			expect(tab.handleInput("/")).toBe(true);
			expect(tab.handleInput("t")).toBe(true);
			expect(tab.handleInput("w")).toBe(true);
			expect(tab.handleInput("o")).toBe(true);
			expect(tab.handleInput("\r")).toBe(true); // Enter

			expect(tab.getFooterLeft()).toContain("4");
		});
	});

	describe("TabbedDiffOverlay", () => {
		it("switches tabs on Tab key and closes on q/escape", () => {
			const done = vi.fn();
			const tab1 = new ScrollableTabContent({ rawText: "t1", displayLines: ["t1"], theme: mockTheme }, "Tab1");
			const tab2 = new ScrollableTabContent({ rawText: "t2", displayLines: ["t2"], theme: mockTheme }, "Tab2");

			const overlay = new TabbedDiffOverlay({
				title: "Test Overlay",
				subtitle: "test",
				tabs: [tab1, tab2],
				theme: mockTheme,
				done,
			});

			const rendered = overlay.render(80);
			expect(rendered.length).toBeGreaterThan(0);

			// Tab switches to tab 2
			overlay.handleInput("\t");
			// q calls done
			overlay.handleInput("q");
			expect(done).toHaveBeenCalled();
		});
	});
});
