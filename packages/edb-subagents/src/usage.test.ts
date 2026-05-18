import { describe, expect, it } from "vitest";
import type { LifetimeUsage } from "./usage.js";
import { getLifetimeTotal, getSessionContextPercent, getSessionTokens } from "./usage.js";

describe("getLifetimeTotal", () => {
	it("returns 0 when undefined", () => {
		expect(getLifetimeTotal(undefined)).toBe(0);
	});

	it("sums tokens from usage object", () => {
		const usage: LifetimeUsage = { input: 100, output: 200, cacheWrite: 50 };
		expect(getLifetimeTotal(usage)).toBe(350);
	});

	it("handles single component", () => {
		const usage: LifetimeUsage = { input: 500, output: 0, cacheWrite: 0 };
		expect(getLifetimeTotal(usage)).toBe(500);
	});
});

describe("getSessionTokens", () => {
	it("returns 0 for undefined session", () => {
		expect(getSessionTokens(undefined)).toBe(0);
	});

	it("returns 0 when getSessionStats throws", () => {
		const badSession = {
			getSessionStats: () => {
				throw new Error("no stats");
			},
		};
		expect(getSessionTokens(badSession as any)).toBe(0);
	});

	it("sums tokens from session stats", () => {
		const session = {
			getSessionStats: () => ({
				tokens: { input: 100, output: 200, cacheWrite: 50 },
			}),
		};
		expect(getSessionTokens(session as any)).toBe(350);
	});
});

describe("getSessionContextPercent", () => {
	it("returns null for undefined session", () => {
		expect(getSessionContextPercent(undefined)).toBeNull();
	});

	it("returns null when getSessionStats throws", () => {
		const badSession = {
			getSessionStats: () => {
				throw new Error("no stats");
			},
		};
		expect(getSessionContextPercent(badSession as any)).toBeNull();
	});

	it("returns context percent from session stats", () => {
		const session = {
			getSessionStats: () => ({
				tokens: { input: 100, output: 200, cacheWrite: 0 },
				contextUsage: { percent: 75 },
			}),
		};
		expect(getSessionContextPercent(session as any)).toBe(75);
	});

	it("returns null when percent is missing", () => {
		const session = {
			getSessionStats: () => ({
				tokens: { input: 100, output: 200, cacheWrite: 0 },
			}),
		};
		expect(getSessionContextPercent(session as any)).toBeNull();
	});
});
