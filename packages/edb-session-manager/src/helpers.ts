import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { basename } from "node:path";
import type { SessionInfo } from "./types";

// ── Format helpers ─────────────────────────────────────────────────────────────

export function formatAge(date: Date): string {
	const s = Math.floor((Date.now() - date.getTime()) / 1000);
	if (s < 60) return `${s}s`;
	if (s < 3600) return `${Math.floor(s / 60)}m`;
	if (s < 86400) return `${Math.floor(s / 3600)}h`;
	return `${Math.floor(s / 86400)}d`;
}

export function shortCwd(cwd: string): string {
	const home = process.env.HOME || "";
	const s = home ? cwd.replace(home, "~") : cwd;
	const parts = s.split("/").filter(Boolean);
	return parts.length <= 3 ? s : `…/${parts.slice(-3).join("/")}`;
}

export function sessionTitle(s: SessionInfo): string {
	if (s.name) return s.name;
	const f = (s.firstMessage ?? "").trim();
	if (!f) return basename(s.path, ".jsonl");
	return f.length > 60 ? `${f.slice(0, 57)}…` : f;
}

/** Combined text used for fuzzy search (title + first message). */
export function searchText(s: SessionInfo): string {
	return `${sessionTitle(s)} ${s.firstMessage ?? ""}`;
}

// ── Session file helpers ───────────────────────────────────────────────────────

/**
 * Appends a session_info entry directly to a session file,
 * allowing rename of any session (not just the current one).
 */
export function writeSessionName(filePath: string, name: string): void {
	const entry = JSON.stringify({
		id: randomUUID(),
		type: "session_info",
		name: name.trim(),
		timestamp: Date.now(),
	});
	appendFileSync(filePath, `${entry}\n`);
}
