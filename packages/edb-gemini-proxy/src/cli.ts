import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ── CLI discovery ──────────────────────────────────────────────────────────────

export function findGeminiCli(): string {
	if (process.env.GEMINI_PATH) {
		try {
			fs.accessSync(process.env.GEMINI_PATH, fs.constants.X_OK);
			return process.env.GEMINI_PATH;
		} catch {
			/* fall through */
		}
	}

	try {
		const resolved = execSync("which gemini", {
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		if (resolved) return resolved;
	} catch {
		/* fall through */
	}

	for (const c of [
		"/opt/homebrew/bin/gemini",
		path.join(os.homedir(), ".local/bin/gemini"),
		"/usr/local/bin/gemini",
	]) {
		try {
			fs.accessSync(c, fs.constants.X_OK);
			return c;
		} catch {
			/* continue */
		}
	}

	return "gemini";
}

// ── File context ───────────────────────────────────────────────────────────────

export async function readFileForContext(absPath: string): Promise<string> {
	try {
		const content = await fs.promises.readFile(absPath, "utf-8");
		return `<file path="${absPath}">\n${content}\n</file>`;
	} catch (err) {
		return `<file path="${absPath}" error="${(err as Error).message}" />`;
	}
}
