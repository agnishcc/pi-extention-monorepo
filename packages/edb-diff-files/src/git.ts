import { execSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ChangeType, type FileEntry, type GitDiffSnapshot } from "./types";

/**
 * Check if cwd is inside a git repository.
 */
export function isGitRepo(cwd: string): boolean {
	try {
		execSync("git rev-parse --is-inside-work-tree", {
			cwd,
			stdio: "pipe",
			timeout: 5000,
		});
		return true;
	} catch {
		return false;
	}
}

/**
 * Parse `git diff --name-status HEAD` output into a map.
 *
 * Status codes:
 *   A = Added (Created)
 *   M = Modified (Edited)
 *   D = Deleted
 *   R = Renamed (treated as Added for the destination)
 *   C = Copied (treated as Added for the destination)
 *   T = Type change (treated as Edited)
 */
export function getGitDiff(cwd: string): GitDiffSnapshot {
	const snapshot: GitDiffSnapshot = new Map();

	try {
		const output = execSync("git diff --name-status HEAD", {
			cwd,
			stdio: "pipe",
			timeout: 10000,
			encoding: "utf-8",
		});

		for (const line of output.trim().split("\n")) {
			if (!line.trim()) continue;

			// Format: "STATUS\tpath" or "R100\told\tnew"
			const parts = line.split("\t");
			const status = parts[0]?.trim();
			const path = parts.length >= 3 ? parts[2] : parts[1]; // rename: R100\told\tnew

			if (!status || !path) continue;

			// Resolve absolute path
			const absPath = resolve(cwd, path);

			let changeType: ChangeType;
			switch (status[0]) {
				case "A":
				case "R": // rename destination = new file
				case "C": // copy destination = new file
					changeType = ChangeType.Created;
					break;
				case "D":
					changeType = ChangeType.Deleted;
					break;
				default:
					changeType = ChangeType.Edited;
					break;
			}

			snapshot.set(absPath, changeType);
		}
	} catch {
		// git diff failed (e.g., no HEAD yet, or not a git repo)
		// Return empty snapshot — silent no-op
	}

	return snapshot;
}

/**
 * Get the unified diff for a single tracked file.
 *
 * - Created  → git diff --no-index /dev/null <file>  (always exits 1 when files differ)
 * - Edited   → git diff HEAD -- <file>
 * - Deleted  → git diff HEAD -- <file>  (shows removal)
 *
 * Returns an array of raw diff lines (caller handles colorisation).
 */
export function getFileDiff(cwd: string, entry: FileEntry): string[] {
	try {
		if (entry.changeType === ChangeType.Created) {
			// New file — diff against /dev/null for proper unified-diff format.
			// git exits with code 1 when files differ (the normal case), so spawnSync
			// is used to avoid an exception on non-zero exit.
			const r = spawnSync("git", ["diff", "--no-index", "/dev/null", entry.path], {
				cwd,
				encoding: "utf-8",
				timeout: 10_000,
			});
			if (r.stdout?.trim()) return r.stdout.split("\n");

			// Fallback: render raw file content as additions
			const content = readFileSync(entry.path, "utf-8");
			return [`--- /dev/null`, `+++ b/${entry.relPath}`, ...content.split("\n").map((l) => `+${l}`)];
		}

		// Edited or Deleted — git diff HEAD shows both staged and unstaged changes
		const r = spawnSync("git", ["diff", "HEAD", "--", entry.path], {
			cwd,
			encoding: "utf-8",
			timeout: 10_000,
		});
		if (r.stdout?.trim()) return r.stdout.split("\n");
		return ["(no changes detected vs HEAD)"];
	} catch {
		return ["(error computing diff)"];
	}
}
