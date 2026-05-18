import { describe, expect, it } from "vitest";
import { formatReset, getStatusEmoji, type ProviderStatus } from "./providers/common.js";
import { isProviderEnabled } from "./settings.js";

describe("isProviderEnabled", () => {
	it("returns true when provider is in enabled list", () => {
		const settings = { enabledProviders: ["claude", "openai"], totalBudget: 100 };
		expect(isProviderEnabled("claude", settings)).toBe(true);
	});

	it("returns false when provider is not in enabled list", () => {
		const settings = { enabledProviders: ["claude"], totalBudget: 100 };
		expect(isProviderEnabled("gemini", settings)).toBe(false);
	});

	it("returns false for empty enabled list", () => {
		const settings = { enabledProviders: [], totalBudget: 100 };
		expect(isProviderEnabled("claude", settings)).toBe(false);
	});
});

describe("formatReset", () => {
	it("returns minutes when date is in the future and under 60 mins", () => {
		const future = new Date(Date.now() + 30 * 60 * 1000);
		const result = formatReset(future);
		expect(result).toMatch(/\d+m/);
	});

	it("returns hours when under 24 hours", () => {
		const future = new Date(Date.now() + 5 * 60 * 60 * 1000);
		const result = formatReset(future);
		expect(result).toMatch(/\d+h/);
	});

	it("returns days when under 7 days", () => {
		const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
		const result = formatReset(future);
		expect(result).toMatch(/\d+d/);
	});

	it("returns month day for dates over a week away", () => {
		const future = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
		const result = formatReset(future);
		expect(result).toMatch(/[A-Z][a-z]+ \d+/);
	});
});

describe("getStatusEmoji", () => {
	it("returns checkmark for none indicator", () => {
		const status: ProviderStatus = { indicator: "none" };
		const result = getStatusEmoji(status);
		expect(result).toBeTruthy();
	});

	it("returns warning for minor indicator", () => {
		const status: ProviderStatus = { indicator: "minor" };
		const result = getStatusEmoji(status);
		expect(result).toBeTruthy();
	});

	it("returns orange for major indicator", () => {
		const status: ProviderStatus = { indicator: "major" };
		const result = getStatusEmoji(status);
		expect(result).toBeTruthy();
	});

	it("returns red for critical indicator", () => {
		const status: ProviderStatus = { indicator: "critical" };
		const result = getStatusEmoji(status);
		expect(result).toBeTruthy();
	});

	it("returns wrench for maintenance indicator", () => {
		const status: ProviderStatus = { indicator: "maintenance" };
		const result = getStatusEmoji(status);
		expect(result).toBeTruthy();
	});

	it("returns empty string for unknown indicator", () => {
		const status: ProviderStatus = { indicator: "unknown" };
		const result = getStatusEmoji(status);
		expect(result).toBe("");
	});

	it("returns empty string for undefined", () => {
		const result = getStatusEmoji(undefined);
		expect(result).toBe("");
	});
});
