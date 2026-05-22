import { describe, expect, it } from "vitest";
import { renderResult } from "./tool-renderer.js";
import type { CompactTheme } from "./types.js";

const theme: CompactTheme = {
	fg: (_color, text) => text,
	bold: (text) => text,
};

function textResult(text: string) {
	return { content: [{ type: "text", text }] };
}

describe("renderResult expanded views", () => {
	it("renders read output with line numbers", () => {
		const block = renderResult("read", textResult("alpha\nbeta"), { expanded: true }, theme, {
			args: { path: "file.ts" },
		});
		const lines = block.render(80).join("\n");
		expect(lines).toContain("1 alpha");
		expect(lines).toContain("2 beta");
	});

	it("renders ls output with file and folder icons", () => {
		const block = renderResult("ls", textResult("src/\npackage.json"), { expanded: true }, theme, {
			args: { path: "." },
		});
		const lines = block.render(80).join("\n");
		expect(lines).toContain("📁 src/");
		expect(lines).toContain("📄 package.json");
	});

	it("renders grep output with path and line metadata", () => {
		const block = renderResult("grep", textResult("src/a.ts:12:const value = 1"), { expanded: true }, theme, {
			args: { pattern: "value", path: "src" },
		});
		const lines = block.render(80).join("\n");
		expect(lines).toContain("src/a.ts:12:const value = 1");
	});
});
