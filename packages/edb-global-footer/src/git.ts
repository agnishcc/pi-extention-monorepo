import { execSync } from "node:child_process";
import type { GitStatus } from "./types";

// ── Git ────────────────────────────────────────────────────────────────────────

export function parseGitStatus(output: string): GitStatus {
	let branch: string | null = null;
	let dirty = false;
	let ahead = 0;
	let behind = 0;

	for (const line of output.split("\n")) {
		if (!line) continue;
		if (line.startsWith("# branch.head ")) {
			const head = line.slice("# branch.head ".length).trim();
			branch = head && head !== "(detached)" ? head : null;
			continue;
		}
		if (line.startsWith("# branch.ab ")) {
			const match = line.match(/^# branch\.ab \+(\d+) -(\d+)$/);
			if (match) {
				ahead = Number(match[1]) || 0;
				behind = Number(match[2]) || 0;
			}
			continue;
		}
		if (!line.startsWith("# ")) dirty = true;
	}

	return { branch, dirty, ahead, behind };
}

export function readGitStatus(cwd: string): GitStatus | null {
	try {
		const output = execSync("git status --porcelain=v2 --branch 2>/dev/null", {
			cwd,
			encoding: "utf8",
			timeout: 1000,
			stdio: ["ignore", "pipe", "ignore"],
		}).trimEnd();
		return parseGitStatus(output);
	} catch {
		return null;
	}
}
