import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { buildChildResourceLoader } from "../../src/v2/runtime/session-factory.js";

const fixturePath = new URL("./fixtures/extension-fixture.ts", import.meta.url).pathname;
const NO_GLOBAL_EXTENSIONS = ".pi/.no-global-extensions";

const directories: string[] = [];

afterEach(async () => {
	await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("child extension loading", () => {
	it("loads only the listed extensions and exposes their registered tools", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "edb-ext-loading-"));
		directories.push(cwd);

		const result = await discoverAndLoadExtensions([fixturePath], cwd, join(cwd, NO_GLOBAL_EXTENSIONS));

		expect(result.errors).toEqual([]);
		expect(result.extensions).toHaveLength(1);
		const toolNames = [...result.extensions[0]!.tools.keys()];
		expect(toolNames).toContain("web_search");
		expect(toolNames).toContain("fixture_hidden_tool");

		const loader = buildChildResourceLoader("system prompt", result);
		expect(loader.getExtensions().extensions).toHaveLength(1);
	});

	it("reports missing extension paths as errors and continues with an empty set", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "edb-ext-missing-"));
		directories.push(cwd);

		const result = await discoverAndLoadExtensions(
			[join(cwd, "does-not-exist.ts")],
			cwd,
			join(cwd, NO_GLOBAL_EXTENSIONS),
		);

		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]!.path).toContain("does-not-exist.ts");
		expect(result.extensions).toHaveLength(0);
	});

	it("builds a loader with no extensions when none were loaded", () => {
		const loader = buildChildResourceLoader("system prompt");
		expect(loader.getExtensions().extensions).toEqual([]);
		expect(loader.getExtensions().errors).toEqual([]);
	});

	it("keeps the system prompt on the loader regardless of extensions", () => {
		const loader = buildChildResourceLoader("child system prompt");
		expect(loader.getSystemPrompt()).toBe("child system prompt");
	});
});
