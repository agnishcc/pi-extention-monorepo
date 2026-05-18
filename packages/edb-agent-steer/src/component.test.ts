import { beforeEach, describe, expect, it, vi } from "vitest";
import { SteerPromptComponent } from "./component.js";

// Mock external dependencies
vi.mock("@earendil-works/pi-tui", () => ({
	matchesKey: vi.fn((data: string, keyId: string) => data === keyId),
	truncateToWidth: vi.fn((text: string, width: number) => (text.length > width ? `${text.slice(0, width)}…` : text)),
}));

describe("SteerPromptComponent", () => {
	// Mock theme with simple fg function
	const mockTheme = {
		fg: (_key: string, val: string) => val,
	};

	// Mock done callback
	let done: (choice: string) => void;

	beforeEach(() => {
		done = vi.fn();
	});

	describe("handleInput", () => {
		it('calls done("steer") for "s"', () => {
			const component = new SteerPromptComponent("test", mockTheme, done);
			component.handleInput("s");
			expect(done).toHaveBeenCalledWith("steer");
		});

		it('calls done("queue") for "q"', () => {
			const component = new SteerPromptComponent("test", mockTheme, done);
			component.handleInput("q");
			expect(done).toHaveBeenCalledWith("queue");
		});

		it('calls done("discard") for "d"', () => {
			const component = new SteerPromptComponent("test", mockTheme, done);
			component.handleInput("d");
			expect(done).toHaveBeenCalledWith("discard");
		});

		it('calls done("edit") for "e"', () => {
			const component = new SteerPromptComponent("test", mockTheme, done);
			component.handleInput("e");
			expect(done).toHaveBeenCalledWith("edit");
		});

		it('calls done("edit") for "escape"', () => {
			const component = new SteerPromptComponent("test", mockTheme, done);
			component.handleInput("escape");
			expect(done).toHaveBeenCalledWith("edit");
		});

		it("does not call done for unknown keys", () => {
			const component = new SteerPromptComponent("test", mockTheme, done);
			component.handleInput("x");
			component.handleInput("w");
			component.handleInput("");
			expect(done).not.toHaveBeenCalled();
		});
	});

	describe("render", () => {
		it("returns 5 lines", () => {
			const component = new SteerPromptComponent("hello", mockTheme, done);
			const lines = component.render(60);
			expect(lines.length).toBe(5);
		});

		it("includes key hints in last non-empty line", () => {
			const component = new SteerPromptComponent("test", mockTheme, done);
			const lines = component.render(60);
			// Keys should appear somewhere in rendered lines
			const allText = lines.join(" ");
			expect(allText).toContain("steer");
			expect(allText).toContain("queue");
			expect(allText).toContain("discard");
			expect(allText).toContain("edit");
		});

		it("caches result for same width", () => {
			const component = new SteerPromptComponent("test", mockTheme, done);
			const lines1 = component.render(60);
			const lines2 = component.render(60);
			expect(lines1).toBe(lines2); // Same reference
		});

		it("invalidates cache when width changes", () => {
			const component = new SteerPromptComponent("test", mockTheme, done);
			const lines1 = component.render(60);
			const lines2 = component.render(80);
			expect(lines1).not.toBe(lines2); // Different reference
		});

		it("invalidates cache after invalidate()", () => {
			const component = new SteerPromptComponent("test", mockTheme, done);
			const lines1 = component.render(60);
			component.invalidate();
			const lines2 = component.render(60);
			expect(lines1).not.toBe(lines2);
		});
	});

	describe("invalidate", () => {
		it("clears cached width", () => {
			const component = new SteerPromptComponent("test", mockTheme, done);
			component.render(60);
			component.invalidate();
			const lines = component.render(60);
			expect(lines.length).toBe(5);
		});
	});
});
