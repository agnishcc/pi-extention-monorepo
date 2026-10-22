import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	checkPromptSource,
	findPackageRoot,
	findPromptSourcePath,
	getPromptSourceSnapshot,
	getStatePath,
	hashText,
	readState,
	resolvePiPackageDir,
	writeState,
} from "./state";

describe("edb-system-prompt-watch state and resolution", () => {
	let testTempDir: string;
	let originalEnvPkgDir: string | undefined;

	beforeEach(() => {
		originalEnvPkgDir = process.env.PI_PACKAGE_DIR;
		testTempDir = join(tmpdir(), `pi-prompt-watch-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(testTempDir, { recursive: true });
	});

	afterEach(() => {
		if (originalEnvPkgDir !== undefined) {
			process.env.PI_PACKAGE_DIR = originalEnvPkgDir;
		} else {
			delete process.env.PI_PACKAGE_DIR;
		}
		if (existsSync(testTempDir)) {
			rmSync(testTempDir, { recursive: true, force: true });
		}
	});

	describe("hashText", () => {
		it("generates consistent sha256 hash for given text", () => {
			const text = "test system prompt";
			const hash1 = hashText(text);
			const hash2 = hashText(text);
			expect(hash1).toBe(hash2);
			expect(hash1).toHaveLength(64);
		});
	});

	describe("readState and writeState", () => {
		it("returns undefined if state file does not exist", () => {
			const nonExistentState = join(testTempDir, "state", "missing.json");
			expect(readState(nonExistentState)).toBeUndefined();
		});

		it("writes and reads state correctly", () => {
			const statePath = join(testTempDir, "state", "test-state.json");
			const state = {
				lastSeenPromptSourceHash: "abc123hash",
				lastSeenPiVersion: "0.83.0",
				lastSeenPromptSourcePath: "/path/to/prompt.js",
				lastCheckedAt: "2026-08-26T12:00:00.000Z",
			};

			writeState(state, statePath);
			const loaded = readState(statePath);
			expect(loaded).toEqual(state);
		});

		it("returns default state path within agent directory", () => {
			const defaultPath = getStatePath();
			expect(defaultPath).toContain("system-prompt-watch.json");
		});
	});

	describe("findPackageRoot", () => {
		it("identifies package root with @earendil-works/pi-coding-agent name", () => {
			const mockPkgDir = join(testTempDir, "mock-pi");
			const nestedDir = join(mockPkgDir, "dist", "core");
			mkdirSync(nestedDir, { recursive: true });
			writeFileSync(
				join(mockPkgDir, "package.json"),
				JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "1.0.0" }),
			);

			const found = findPackageRoot(nestedDir);
			expect(found).toBe(mockPkgDir);
		});

		it("identifies package root with piConfig", () => {
			const mockPkgDir = join(testTempDir, "mock-custom-pi");
			const nestedDir = join(mockPkgDir, "some", "nested", "path");
			mkdirSync(nestedDir, { recursive: true });
			writeFileSync(
				join(mockPkgDir, "package.json"),
				JSON.stringify({ name: "my-pi", piConfig: { configDir: ".pi" } }),
			);

			const found = findPackageRoot(nestedDir);
			expect(found).toBe(mockPkgDir);
		});

		it("returns undefined if no package root found", () => {
			const emptyDir = join(testTempDir, "empty");
			mkdirSync(emptyDir, { recursive: true });
			expect(findPackageRoot(emptyDir)).toBeUndefined();
		});
	});

	describe("findPromptSourcePath", () => {
		it("finds dist/core/system-prompt.js if present", () => {
			const mockPkg = join(testTempDir, "pkg1");
			const targetDir = join(mockPkg, "dist", "core");
			mkdirSync(targetDir, { recursive: true });
			const promptFile = join(targetDir, "system-prompt.js");
			writeFileSync(promptFile, "export function buildSystemPrompt() {}");

			expect(findPromptSourcePath(mockPkg)).toBe(promptFile);
		});

		it("finds src/core/system-prompt.ts if dist not present", () => {
			const mockPkg = join(testTempDir, "pkg2");
			const targetDir = join(mockPkg, "src", "core");
			mkdirSync(targetDir, { recursive: true });
			const promptFile = join(targetDir, "system-prompt.ts");
			writeFileSync(promptFile, "export function buildSystemPrompt() {}");

			expect(findPromptSourcePath(mockPkg)).toBe(promptFile);
		});

		it("throws error if no candidate system prompt file exists", () => {
			const mockPkg = join(testTempDir, "pkg-empty");
			mkdirSync(mockPkg, { recursive: true });

			expect(() => findPromptSourcePath(mockPkg)).toThrowError(/Could not find bundled system prompt file/);
		});
	});

	describe("resolvePiPackageDir", () => {
		it("prioritizes PI_PACKAGE_DIR environment variable when set", async () => {
			const customDir = join(testTempDir, "custom-pi-dir");
			mkdirSync(customDir, { recursive: true });
			process.env.PI_PACKAGE_DIR = customDir;

			const resolved = await resolvePiPackageDir();
			expect(resolved).toBe(customDir);
		});

		it("resolves the installed Pi package directory", async () => {
			delete process.env.PI_PACKAGE_DIR;
			const resolved = await resolvePiPackageDir();
			expect(resolved).toBeTruthy();
			expect(existsSync(resolved)).toBe(true);
		});
	});

	describe("getPromptSourceSnapshot and checkPromptSource", () => {
		it("generates a prompt source snapshot with version and hash", async () => {
			const mockPkg = join(testTempDir, "mock-snapshot-pkg");
			const coreDir = join(mockPkg, "dist", "core");
			mkdirSync(coreDir, { recursive: true });
			writeFileSync(join(mockPkg, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent" }));
			writeFileSync(join(coreDir, "system-prompt.js"), "snapshot test content");

			const snapshot = await getPromptSourceSnapshot(mockPkg);
			expect(snapshot.promptSourcePath).toBe(join(coreDir, "system-prompt.js"));
			expect(snapshot.promptSourceHash).toBe(hashText("snapshot test content"));
			expect(snapshot.piVersion).toBeTruthy();
		});

		it("detects first run and creates baseline snapshot", async () => {
			const mockPkg = join(testTempDir, "mock-pkg");
			const coreDir = join(mockPkg, "dist", "core");
			mkdirSync(coreDir, { recursive: true });
			writeFileSync(join(mockPkg, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent" }));
			writeFileSync(join(coreDir, "system-prompt.js"), "original prompt text");

			const stateFile = join(testTempDir, "state.json");
			const result = await checkPromptSource({ statePath: stateFile, packageDir: mockPkg });

			expect(result.firstRun).toBe(true);
			expect(result.changed).toBe(false);
			expect(result.snapshot.promptSourceHash).toBe(hashText("original prompt text"));

			const savedState = readState(stateFile);
			expect(savedState?.lastSeenPromptSourceHash).toBe(hashText("original prompt text"));
		});

		it("detects when prompt source changes", async () => {
			const mockPkg = join(testTempDir, "mock-pkg");
			const coreDir = join(mockPkg, "dist", "core");
			mkdirSync(coreDir, { recursive: true });
			writeFileSync(join(mockPkg, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent" }));
			writeFileSync(join(coreDir, "system-prompt.js"), "v1 prompt text");

			const stateFile = join(testTempDir, "state.json");
			const firstResult = await checkPromptSource({ statePath: stateFile, packageDir: mockPkg });
			expect(firstResult.firstRun).toBe(true);
			expect(firstResult.changed).toBe(false);

			// Now modify the prompt file
			writeFileSync(join(coreDir, "system-prompt.js"), "v2 updated prompt text");

			const secondResult = await checkPromptSource({ statePath: stateFile, packageDir: mockPkg });

			expect(secondResult.firstRun).toBe(false);
			expect(secondResult.changed).toBe(true);
			expect(secondResult.snapshot.promptSourceHash).toBe(hashText("v2 updated prompt text"));
		});

		it("detects when prompt source is unchanged", async () => {
			const mockPkg = join(testTempDir, "mock-pkg");
			const coreDir = join(mockPkg, "dist", "core");
			mkdirSync(coreDir, { recursive: true });
			writeFileSync(join(mockPkg, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent" }));
			writeFileSync(join(coreDir, "system-prompt.js"), "stable prompt text");

			const stateFile = join(testTempDir, "state.json");
			await checkPromptSource({ statePath: stateFile, packageDir: mockPkg });

			const secondResult = await checkPromptSource({ statePath: stateFile, packageDir: mockPkg });

			expect(secondResult.firstRun).toBe(false);
			expect(secondResult.changed).toBe(false);
		});
	});
});
