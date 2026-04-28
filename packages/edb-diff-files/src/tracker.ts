import { ChangeType, type FileEntry, type GitDiffSnapshot } from "./types";

/**
 * Session-scoped file change tracker.
 *
 * Two sources of attribution:
 *   1. write/edit tool events — direct, high confidence
 *   2. bash tool events — via git diff before/after snapshot
 *
 * Change type is resolved via git diff at render time.
 * The tracker stores attribution (which files the agent touched),
 * not the final A/M/D status.
 */
export class FileTracker {
	/** Tracks files the agent touched — key is absolute path */
	private entries = new Map<string, FileEntry>();

	/**
	 * Record a file that the agent touched via write/edit.
	 * If already tracked, keeps existing entry (insertion order preserved).
	 * Created wins over Edited (never downgrade).
	 */
	add(path: string, relPath: string, changeType: ChangeType): void {
		const existing = this.entries.get(path);
		if (existing) {
			if (existing.changeType === ChangeType.Created) return;
			if (changeType === ChangeType.Edited) return;
			// Upgrade Edited → Created
			existing.changeType = ChangeType.Created;
			return;
		}

		this.entries.set(path, { path, relPath, changeType });
	}

	/**
	 * Merge bash diff entries into the tracker.
	 * Only adds files that aren't already tracked (write/edit are more reliable).
	 */
	mergeBashDiff(diff: GitDiffSnapshot, cwd: string): void {
		const { relative } = require("node:path");
		for (const [path, changeType] of diff) {
			if (this.entries.has(path)) continue;
			const relPath = relative(cwd, path) || path;
			this.entries.set(path, { path, relPath, changeType });
		}
	}

	/**
	 * Resolve change types from git diff.
	 * Takes the current git diff output and updates tracked entries
	 * to match actual A/M/D status.
	 */
	resolveFromGitDiff(gitDiff: GitDiffSnapshot): void {
		for (const [path, entry] of this.entries) {
			const gitType = gitDiff.get(path);
			if (gitType !== undefined) {
				entry.changeType = gitType;
			}
			// If file not in git diff, keep existing type
			// (e.g., edited then reverted — still shows as tracked)
		}
	}

	getEntries(): ReadonlyArray<FileEntry> {
		return Array.from(this.entries.values());
	}

	clear(): void {
		this.entries.clear();
	}

	get size(): number {
		return this.entries.size;
	}
}
