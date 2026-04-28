import type { SessionManager } from "@mariozechner/pi-coding-agent";

// ── Types ──────────────────────────────────────────────────────────────────────

export type SessionInfo = Awaited<ReturnType<typeof SessionManager.list>>[number];

export interface SessionAction {
	type: "resume" | "delete";
	data: any;
}

export type Mode = "browsing" | "renaming";
