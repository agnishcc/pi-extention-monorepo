import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getGitDiff, isGitRepo } from "./git.js";

describe("isGitRepo", () => {
	it("returns true for git repositories", () => {
		// This repo is a git repo
		expect(isGitRepo(process.cwd())).toBe(true);
	});

	it("returns false for non-git directories", () => {
		const tmp = mkdtempSync(join(tmpdir(), "not-a-repo-"));
		expect(isGitRepo(tmp)).toBe(false);
	});
});

describe("getGitDiff", () => {
	it("returns empty map for non-git directories", () => {
		const tmp = mkdtempSync(join(tmpdir(), "not-a-repo-"));
		const diff = getGitDiff(tmp);
		expect(diff.size).toBe(0);
	});

	it("returns map for git repo", () => {
		const diff = getGitDiff(process.cwd());
		expect(diff instanceof Map).toBe(true);
	});
});
