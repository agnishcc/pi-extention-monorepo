import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isExtensionPathLike, resolveExtensionPaths } from "../../src/v2/runtime/extension-resolver.js";

const directories: string[] = [];

afterEach(async () => {
	await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("isExtensionPathLike", () => {
	it("classifies explicit paths as paths and bare names as names", () => {
		expect(isExtensionPathLike("/abs/path/index.ts")).toBe(true);
		expect(isExtensionPathLike("relative/dir/index.ts")).toBe(true);
		expect(isExtensionPathLike("./index.ts")).toBe(true);
		expect(isExtensionPathLike("something.ts")).toBe(true);
		expect(isExtensionPathLike("pi-web-access")).toBe(false);
		expect(isExtensionPathLike("npm:pi-web-access")).toBe(false);
	});
});

describe("resolveExtensionPaths", () => {
	it("passes path-like entries through unchanged", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "edb-resolver-paths-"));
		directories.push(cwd);
		const agentDir = join(cwd, "agent-home");

		const { paths, unresolved } = await resolveExtensionPaths(["/tmp/some-extension/index.ts"], cwd, agentDir);

		expect(paths).toEqual(["/tmp/some-extension/index.ts"]);
		expect(unresolved).toEqual([]);
	});

	it("resolves names from a managed npm install (pi.extensions manifest)", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "edb-resolver-managed-"));
		directories.push(cwd);
		const agentDir = join(cwd, "agent-home");
		const packageRoot = join(agentDir, "npm", "node_modules", "pi-web-access");
		await mkdir(packageRoot, { recursive: true });
		await writeFile(
			join(packageRoot, "package.json"),
			JSON.stringify({ name: "pi-web-access", version: "0.18.0", pi: { extensions: ["./index.ts"] } }),
		);
		await writeFile(join(packageRoot, "index.ts"), "export default function () {}");

		const { paths, unresolved } = await resolveExtensionPaths(["pi-web-access"], cwd, agentDir);

		expect(paths).toEqual([join(packageRoot, "index.ts")]);
		expect(unresolved).toEqual([]);
	});

	it("resolves names from an auto-discovered extension directory (no package.json)", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "edb-resolver-autodir-"));
		directories.push(cwd);
		const agentDir = join(cwd, "agent-home");
		const extensionDir = join(agentDir, "extensions", "pi-statistics");
		await mkdir(extensionDir, { recursive: true });
		await writeFile(join(extensionDir, "index.ts"), "export default function () {}");

		const { paths, unresolved } = await resolveExtensionPaths(["pi-statistics"], cwd, agentDir);

		expect(paths).toEqual([join(extensionDir, "index.ts")]);
		expect(unresolved).toEqual([]);
	});

	it("reports unresolved names without auto-installing", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "edb-resolver-missing-"));
		directories.push(cwd);
		const agentDir = join(cwd, "agent-home");

		const { paths, unresolved } = await resolveExtensionPaths(["pi-web-access"], cwd, agentDir);

		expect(paths).toEqual([]);
		expect(unresolved).toEqual(["pi-web-access"]);
	});

	it("dedupes and handles npm: prefixes and empty entries", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "edb-resolver-misc-"));
		directories.push(cwd);
		const agentDir = join(cwd, "agent-home");
		const extensionDir = join(agentDir, "extensions", "pi-stats");
		await mkdir(extensionDir, { recursive: true });
		await writeFile(join(extensionDir, "index.ts"), "export default function () {}");

		const { paths, unresolved } = await resolveExtensionPaths(
			["/tmp/a.ts", "pi-stats", "npm:pi-stats", "/tmp/a.ts"],
			cwd,
			agentDir,
		);

		expect(paths).toEqual(["/tmp/a.ts", join(extensionDir, "index.ts")]);
		expect(unresolved).toEqual([]);
	});
});
