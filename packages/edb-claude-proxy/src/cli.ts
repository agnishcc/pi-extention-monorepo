import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ── CLI discovery ──────────────────────────────────────────────────────────────

/** Locate the claude CLI. Checks CLAUDE_PATH env, PATH, then common install dirs. */
export function findClaudeCli(): string {
	if (process.env.CLAUDE_PATH) {
		try {
			fs.accessSync(process.env.CLAUDE_PATH, fs.constants.X_OK);
			return process.env.CLAUDE_PATH;
		} catch {
			/* fall through */
		}
	}

	try {
		const resolved = execSync("which claude", {
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		if (resolved) return resolved;
	} catch {
		/* fall through */
	}

	for (const c of [
		path.join(os.homedir(), ".local/bin/claude"),
		"/usr/local/bin/claude",
		"/opt/homebrew/bin/claude",
	]) {
		try {
			fs.accessSync(c, fs.constants.X_OK);
			return c;
		} catch {
			/* continue */
		}
	}

	return "claude"; // final fallback — let the OS resolve it
}

// ── File context ───────────────────────────────────────────────────────────────

/** Read a file, returning an XML-wrapped content block for Claude's context. */
export async function readFileForContext(absPath: string): Promise<string> {
	try {
		const content = await fs.promises.readFile(absPath, "utf-8");
		return `<file path="${absPath}">\n${content}\n</file>`;
	} catch (err) {
		return `<file path="${absPath}" error="${(err as Error).message}" />`;
	}
}
