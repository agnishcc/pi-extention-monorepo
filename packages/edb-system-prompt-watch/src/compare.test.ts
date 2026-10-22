import { describe, expect, it } from "vitest";
import {
	calculateSimilarity,
	comparePrompts,
	extractBulletPoints,
	getBundledDefaultPrompt,
	readFallbackSystemPrompt,
} from "./compare";

describe("edb-system-prompt-watch prompt comparison", () => {
	describe("extractBulletPoints", () => {
		it("extracts dash and asterisk bullet points", () => {
			const prompt = `
Header
- First guideline
* Second guideline
Regular paragraph
- Third guideline
`;
			const bullets = extractBulletPoints(prompt);
			expect(bullets).toEqual(["First guideline", "Second guideline", "Third guideline"]);
		});
	});

	describe("calculateSimilarity", () => {
		it("returns 1 for identical phrases", () => {
			expect(calculateSimilarity("Be concise", "Be concise")).toBe(1);
		});

		it("returns high score for slightly modified phrases", () => {
			const score = calculateSimilarity("Be concise in your responses", "Be extremely concise in your responses");
			expect(score).toBeGreaterThan(0.7);
		});

		it("returns 0 for completely disjoint phrases", () => {
			expect(calculateSimilarity("apple banana", "car airplane")).toBe(0);
		});
	});

	describe("comparePrompts", () => {
		it("identifies identical prompts correctly", () => {
			const prompt = `You are an expert assistant.

Guidelines:
- Be concise
- Show paths clearly`;

			const result = comparePrompts(prompt, prompt);
			expect(result.isIdentical).toBe(true);
			expect(result.missingFromActive).toHaveLength(0);
			expect(result.modifiedOrChanged).toHaveLength(0);
			expect(result.uniqueToActive).toHaveLength(0);
			expect(result.formattedSummary).toContain("identical");
		});

		it("detects missing upstream items, modified items, and custom additions", () => {
			const defaultPrompt = `You are an expert coding assistant.

Available tools:
- read: Read files
- bash: Execute shell
- edit: Edit files
- write: Write files

Guidelines:
- Be concise in your responses
- Show file paths clearly
- Use bash for file operations like ls, rg, find
- Read documentation before implementing`;

			const activePrompt = `You are an expert coding assistant.

Available tools:
- read: Read files
- bash: Execute shell

Guidelines:
- Be very concise in your responses
- Show file paths clearly
- Always write comprehensive unit tests`;

			const result = comparePrompts(activePrompt, defaultPrompt);

			expect(result.isIdentical).toBe(false);

			// Missing from active: edit, write, use bash, read documentation
			expect(result.missingFromActive).toContain("edit: Edit files");
			expect(result.missingFromActive).toContain("write: Write files");
			expect(result.missingFromActive).toContain("Use bash for file operations like ls, rg, find");
			expect(result.missingFromActive).toContain("Read documentation before implementing");

			// Modified: "Be concise in your responses" vs "Be very concise in your responses"
			expect(result.modifiedOrChanged).toHaveLength(1);
			expect(result.modifiedOrChanged[0]?.defaultItem).toBe("Be concise in your responses");
			expect(result.modifiedOrChanged[0]?.activeItem).toBe("Be very concise in your responses");

			// Custom addition: "Always write comprehensive unit tests"
			expect(result.uniqueToActive).toContain("Always write comprehensive unit tests");

			// Unified diff generated
			expect(result.unifiedDiff).toContain("--- SYSTEM.md");
			expect(result.unifiedDiff).toContain("+++ SYSTEM.md");

			// Formatted summary includes sections
			expect(result.formattedSummary).toContain("Parts We Don't Have");
			expect(result.formattedSummary).toContain("Parts That Have Changed");
			expect(result.formattedSummary).toContain("Custom Additions");
		});
	});

	describe("getBundledDefaultPrompt and readFallbackSystemPrompt", () => {
		it("retrieves the bundled default prompt from installed Pi", async () => {
			const bundled = await getBundledDefaultPrompt();
			expect(bundled.prompt).toBeTruthy();
			expect(bundled.prompt).toContain("You are an expert coding assistant");
			expect(bundled.sourcePath).toBeTruthy();
			expect(bundled.version).toBeTruthy();
		});

		it("readFallbackSystemPrompt returns string without throwing", () => {
			const fallback = readFallbackSystemPrompt("/nonexistent/path");
			expect(typeof fallback).toBe("string");
		});
	});
});
