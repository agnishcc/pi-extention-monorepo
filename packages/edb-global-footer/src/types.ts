// ── Types ──────────────────────────────────────────────────────────────────────

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface GitStatus {
	branch: string | null;
	dirty: boolean;
	ahead: number;
	behind: number;
}
