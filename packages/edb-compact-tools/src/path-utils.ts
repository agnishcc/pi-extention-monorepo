import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import { oneLine } from "./text.js";

export function pathExists(value: unknown, cwd = process.cwd()): boolean {
	const path = oneLine(value);
	if (!path) return false;
	try {
		return existsSync(resolve(cwd, path));
	} catch {
		return false;
	}
}

export function shortenPath(value: unknown, cwd = process.cwd()): string {
	const path = oneLine(value);
	if (!path) return "";
	const home = process.env.HOME;
	try {
		const rel = relative(cwd, path);
		if (rel && !rel.startsWith("..") && !rel.startsWith("/")) return rel;
		if (rel === "") return ".";
	} catch {
		// Keep the original value for malformed path-like strings.
	}
	return home && path.startsWith(`${home}/`) ? `~/${path.slice(home.length + 1)}` : path;
}
