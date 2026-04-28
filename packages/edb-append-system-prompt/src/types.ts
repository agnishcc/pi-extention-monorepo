// ── Types ──────────────────────────────────────────────────────────────────────

export interface Snippet {
	id: string;
	text: string;
	createdAt: number;
}

export type OverlayAction = { type: "add"; text: string } | { type: "delete"; id: string; text: string };
