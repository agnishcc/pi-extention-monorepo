import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireModalLock, isModalActive, sleep, wrapText } from "./utils.js";

// Mock visibleWidth to treat each ASCII char as width 1
vi.mock("@earendil-works/pi-tui", () => ({
	visibleWidth: (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").length,
}));

// Reset modal lock between tests
const MODAL_LOCK_SYMBOL = Symbol.for("edb.ask-user.modal-lock");
function resetModalLock() {
	const host = globalThis as Record<symbol, unknown>;
	delete host[MODAL_LOCK_SYMBOL];
}

beforeEach(() => resetModalLock());
afterEach(() => resetModalLock());

describe("wrapText", () => {
	it("returns single empty line for empty input", () => {
		const lines = wrapText("", 40);
		expect(lines).toEqual([""]);
	});

	it("returns single line when text fits", () => {
		const lines = wrapText("hello world", 40);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toBe("hello world");
	});

	it("wraps multiple words across lines", () => {
		const lines = wrapText("one two three four five six seven eight nine ten", 15, 4);
		expect(lines.length).toBeGreaterThan(1);
		// Each line should be <= 15 chars visible width
		for (const line of lines) {
			expect(line.length).toBeLessThanOrEqual(15);
		}
	});

	it("respects maxLines limit", () => {
		const longText = "one two three four five six seven eight nine ten eleven twelve";
		const lines = wrapText(longText, 10, 3);
		expect(lines.length).toBeLessThanOrEqual(3);
	});

	it("adds ellipsis when text exceeds maxLines", () => {
		const lines = wrapText("one two three four five six seven eight nine ten", 10, 2);
		// At least one line should end with ellipsis
		const hasEllipsis = lines.some((l) => l.endsWith("…"));
		expect(hasEllipsis).toBe(true);
	});

	it("handles whitespace-only input", () => {
		const lines = wrapText("   ", 40);
		expect(lines).toEqual([""]);
	});

	it("handles single word longer than width", () => {
		const lines = wrapText("superlongword", 5, 4);
		expect(lines.length).toBeLessThanOrEqual(4);
	});
});

describe("isModalActive", () => {
	it("returns false when no modal is active", () => {
		expect(isModalActive()).toBe(false);
	});

	it("returns true when modal is acquired", () => {
		const release = acquireModalLock();
		expect(isModalActive()).toBe(true);
		release();
	});

	it("returns false after release", () => {
		const release = acquireModalLock();
		release();
		expect(isModalActive()).toBe(false);
	});
});

describe("acquireModalLock", () => {
	it("returns a release function", () => {
		const release = acquireModalLock();
		expect(typeof release).toBe("function");
	});

	it("supports nested locks", () => {
		const release1 = acquireModalLock();
		const release2 = acquireModalLock();
		expect(isModalActive()).toBe(true);
		release1();
		expect(isModalActive()).toBe(true);
		release2();
		expect(isModalActive()).toBe(false);
	});

	it("calling release twice is safe", () => {
		const release = acquireModalLock();
		release();
		expect(() => release()).not.toThrow();
	});
});

describe("sleep", () => {
	it("resolves after specified ms", async () => {
		vi.useFakeTimers();
		const promise = sleep(100);
		expect(isModalActive()).toBe(false); // Not related, just showing fake timers work

		vi.advanceTimersByTime(100);
		await promise;
		vi.useRealTimers();
	});

	it("does not resolve before ms elapses", async () => {
		vi.useFakeTimers();
		let resolved = false;
		sleep(100).then(() => {
			resolved = true;
		});

		vi.advanceTimersByTime(50);
		expect(resolved).toBe(false);

		vi.advanceTimersByTime(50);
		await vi.runAllTimersAsync();
		expect(resolved).toBe(true);
		vi.useRealTimers();
	});
});
