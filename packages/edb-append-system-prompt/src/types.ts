// ── Types ──────────────────────────────────────────────────────────────────────

export interface PromptState {
	text: string;
	enabled: boolean;
}

export type OverlayResult = PromptState | undefined;
