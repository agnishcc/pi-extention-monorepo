import type { SessionManager } from "@earendil-works/pi-coding-agent";

// ── Types ──────────────────────────────────────────────────────────────────────

export type SessionInfo = Awaited<ReturnType<typeof SessionManager.list>>[number];

export interface SessionAction {
	type: "resume" | "delete";
	data: any;
}

export type Mode = "browsing" | "renaming";
