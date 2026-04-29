import { describe, expect, it } from "vitest";
import { countUserMessages, extractUserText, sanitizeSessionName, shouldArmAutoNaming } from "./title";

describe("title helpers", () => {
	it("extracts only text parts from user content", () => {
		expect(
			extractUserText([
				{ type: "text", text: "Build an auto name session extension" },
				{ type: "image", source: { type: "base64", data: "abc" } },
				{ type: "text", text: "Use big pickle" },
			]),
		).toBe("Build an auto name session extension\nUse big pickle");
	});

	it("sanitizes labels, quotes, and punctuation", () => {
		expect(sanitizeSessionName('Title: "Auto Name Session".')).toBe("Auto Name Session");
	});

	it("counts only user messages", () => {
		const entries = [
			{ type: "message", message: { role: "user", content: [{ type: "text", text: "one" }] } },
			{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "two" }] } },
			{ type: "custom", customType: "x", data: {} },
		] as any;

		expect(countUserMessages(entries)).toBe(1);
	});

	it("arms only for empty unnamed sessions", () => {
		expect(shouldArmAutoNaming([], undefined)).toBe(true);
		expect(shouldArmAutoNaming([], "Already Named")).toBe(false);
	});
});
