import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir, getPackageDir, VERSION } from "@earendil-works/pi-coding-agent";

export interface PromptWatchState {
	lastSeenPromptSourceHash?: string;
	lastSeenPiVersion?: string;
	lastSeenPromptSourcePath?: string;
	lastCheckedAt?: string;
}

export interface PromptSourceSnapshot {
	piVersion: string;
	promptSourcePath: string;
	promptSourceHash: string;
}

export interface PromptWatchResult {
	changed: boolean;
	firstRun: boolean;
	previous?: PromptWatchState;
	snapshot: PromptSourceSnapshot;
}

export function hashText(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

export function getStatePath(): string {
	return join(getAgentDir(), "state", "system-prompt-watch.json");
}

export function readState(statePath = getStatePath()): PromptWatchState | undefined {
	if (!existsSync(statePath)) return undefined;

	try {
		return JSON.parse(readFileSync(statePath, "utf8")) as PromptWatchState;
	} catch {
		return undefined;
	}
}

export function writeState(state: PromptWatchState, statePath = getStatePath()): void {
	mkdirSync(dirname(statePath), { recursive: true });
	writeFileSync(statePath, `${JSON.stringify(state, null, "\t")}\n`);
}

/**
 * Walks up the directory tree looking for a Pi package root directory.
 */
export function findPackageRoot(startDir: string): string | undefined {
	let current = startDir;
	while (current && current !== dirname(current)) {
		const pkgJsonPath = join(current, "package.json");
		if (existsSync(pkgJsonPath)) {
			try {
				const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as {
					name?: string;
					piConfig?: unknown;
					bin?: Record<string, string> | string;
				};
				if (
					pkg.name === "@earendil-works/pi-coding-agent" ||
					pkg.piConfig !== undefined ||
					(typeof pkg.bin === "object" && pkg.bin && "pi" in pkg.bin)
				) {
					return current;
				}
			} catch {
				// Ignore malformed package.json and continue walking up
			}
		}
		current = dirname(current);
	}
	return undefined;
}

/**
 * Resolves where Pi is installed using multiple strategies:
 * 1. Explicit override via PI_PACKAGE_DIR environment variable
 * 2. Pi SDK's exported getPackageDir()
 * 3. CLI entry point (process.argv[1]), resolving realpath/symlinks
 * 4. Process executable (process.execPath)
 * 5. Dynamic import.meta.resolve fallback
 */
export async function resolvePiPackageDir(): Promise<string> {
	// 1. Explicit override via PI_PACKAGE_DIR environment variable
	if (process.env.PI_PACKAGE_DIR && existsSync(process.env.PI_PACKAGE_DIR)) {
		return process.env.PI_PACKAGE_DIR;
	}

	// 2. Pi SDK getPackageDir() from the running Pi instance
	try {
		const pkgDir = getPackageDir();
		if (pkgDir && existsSync(pkgDir)) {
			return pkgDir;
		}
	} catch {
		// Ignore and proceed to next strategy
	}

	// 3. Process argv[1] (CLI entry script / symlink)
	if (process.argv[1]) {
		try {
			const realEntry = realpathSync(process.argv[1]);
			const root = findPackageRoot(dirname(realEntry));
			if (root) return root;
		} catch {
			// Ignore resolution errors
		}
	}

	// 4. Process execPath (e.g. standalone binary)
	if (process.execPath) {
		try {
			const realExec = realpathSync(process.execPath);
			const root = findPackageRoot(dirname(realExec));
			if (root) return root;
		} catch {
			// Ignore resolution errors
		}
	}

	// 5. Dynamic import.meta.resolve fallback
	try {
		const packageEntryUrl = await import.meta.resolve("@earendil-works/pi-coding-agent");
		const packageEntry = fileURLToPath(packageEntryUrl);
		const root = findPackageRoot(dirname(packageEntry));
		if (root) return root;
	} catch {
		// Ignore resolution errors
	}

	throw new Error("Unable to resolve Pi installation directory");
}

/**
 * Locates the bundled default system prompt source file in the installed Pi package directory.
 */
export function findPromptSourcePath(packageDir: string): string {
	const candidates = [
		join(packageDir, "dist", "core", "system-prompt.js"),
		join(packageDir, "src", "core", "system-prompt.ts"),
		join(packageDir, "dist", "core", "system-prompt.ts"),
		join(packageDir, "dist", "system-prompt.js"),
		join(packageDir, "core", "system-prompt.js"),
		join(packageDir, "src", "system-prompt.ts"),
		join(packageDir, "packages", "coding-agent", "dist", "core", "system-prompt.js"),
		join(packageDir, "packages", "coding-agent", "src", "core", "system-prompt.ts"),
		join(packageDir, "node_modules", "@earendil-works", "pi-agent-core", "dist", "harness", "system-prompt.js"),
		join(packageDir, "node_modules", "@earendil-works", "pi-agent-core", "src", "harness", "system-prompt.ts"),
	];

	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}

	throw new Error(`Could not find bundled system prompt file in Pi package directory: ${packageDir}`);
}

export async function getPromptSourceSnapshot(explicitPackageDir?: string): Promise<PromptSourceSnapshot> {
	const packageDir = explicitPackageDir ?? (await resolvePiPackageDir());
	const promptSourcePath = findPromptSourcePath(packageDir);
	const promptSource = readFileSync(promptSourcePath, "utf8");

	return {
		piVersion: VERSION,
		promptSourcePath,
		promptSourceHash: hashText(promptSource),
	};
}

export interface CheckPromptOptions {
	previous?: PromptWatchState;
	statePath?: string;
	packageDir?: string;
}

export async function checkPromptSource(options?: CheckPromptOptions): Promise<PromptWatchResult> {
	const statePath = options?.statePath ?? getStatePath();
	const previous = options && "previous" in options ? options.previous : readState(statePath);
	const snapshot = await getPromptSourceSnapshot(options?.packageDir);
	const firstRun = !previous?.lastSeenPromptSourceHash;
	const changed = !firstRun && previous.lastSeenPromptSourceHash !== snapshot.promptSourceHash;

	writeState(
		{
			lastSeenPromptSourceHash: snapshot.promptSourceHash,
			lastSeenPiVersion: snapshot.piVersion,
			lastSeenPromptSourcePath: snapshot.promptSourcePath,
			lastCheckedAt: new Date().toISOString(),
		},
		statePath,
	);

	return {
		changed,
		firstRun,
		previous,
		snapshot,
	};
}
