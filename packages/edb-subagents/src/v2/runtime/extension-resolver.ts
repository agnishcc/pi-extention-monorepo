import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";

export interface ExtensionResolution {
	/** Resolved extension entry paths, ready for the extension loader. */
	paths: string[];
	/** Names that could not be resolved anywhere in the pi extension system. */
	unresolved: string[];
}

/**
 * True for entries that are explicit file paths (absolute, containing a
 * separator, or a .ts/.js file). Everything else is treated as an extension
 * name resolved through pi's extension system. `npm:`-prefixed entries are
 * names (the prefix is stripped before resolution).
 */
export function isExtensionPathLike(entry: string): boolean {
	return (
		entry.includes("/") || entry.includes("\\") || entry.endsWith(".ts") || entry.endsWith(".js") || isAbsolute(entry)
	);
}

/**
 * Find the extension entry point inside an auto-discovered extension
 * directory: package.json `pi.extensions` manifest first, then index.ts/js.
 */
function entryPointInDir(directory: string): string | undefined {
	if (!existsSync(directory)) return undefined;
	const packageJsonPath = join(directory, "package.json");
	if (existsSync(packageJsonPath)) {
		try {
			const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { pi?: { extensions?: string[] } };
			for (const entry of manifest.pi?.extensions ?? []) {
				const resolved = join(directory, entry);
				if (existsSync(resolved)) return resolved;
			}
		} catch {
			// Malformed package.json — fall through to index entry checks.
		}
	}
	for (const candidate of ["index.ts", "index.js"]) {
		const entry = join(directory, candidate);
		if (existsSync(entry)) return entry;
	}
	return undefined;
}

/**
 * Resolve a definition's `extensions:` frontmatter against pi's extension
 * system:
 *
 * - path-like entries are used as-is,
 * - bare names are resolved through `DefaultPackageManager` (managed npm
 *   installs under agentDir/npm and legacy global npm), falling back to the
 *   auto-discovered extension directories (agentDir/extensions and
 *   cwd/.pi/extensions).
 *
 * Missing packages are never auto-installed from a child spawn: names that
 * are not already installed or present in an extension directory are
 * reported as unresolved and skipped.
 */
export async function resolveExtensionPaths(
	entries: string[],
	cwd: string,
	agentDir: string,
): Promise<ExtensionResolution> {
	const paths: string[] = [];
	const names: string[] = [];
	for (const entry of entries) {
		if (isExtensionPathLike(entry)) paths.push(entry);
		else names.push(entry.replace(/^npm:/, ""));
	}

	const unresolved: string[] = [];
	if (names.length) {
		const packageManager = new DefaultPackageManager({
			cwd,
			agentDir,
			settingsManager: SettingsManager.inMemory(),
		});
		for (const name of names) {
			const source = `npm:${name}`;
			// Existence-only check — deliberately avoids resolveExtensionSources'
			// auto-install behavior for missing packages.
			let resolvedPath: string | undefined;
			if (packageManager.getInstalledPath(source, "user")) {
				const result = await packageManager.resolveExtensionSources([source]);
				resolvedPath = result.extensions.find((extension) => extension.enabled !== false && extension.path)?.path;
			}
			resolvedPath ??= [join(agentDir, "extensions", name), join(cwd, ".pi", "extensions", name)]
				.map(entryPointInDir)
				.find((entry): entry is string => entry !== undefined);
			if (resolvedPath) paths.push(resolvedPath);
			else unresolved.push(name);
		}
	}

	return { paths: [...new Set(paths)], unresolved };
}
