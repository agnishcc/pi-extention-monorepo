import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { PromptState } from "./types";
import { statusIndicator } from "./utils";

// ── Module state ───────────────────────────────────────────────────────────────

export let state: PromptState = { text: "", enabled: false };

export const STATUS_KEY = "prompt-inject";
export const ENTRY_TYPE = "sys-prompt-injection";

// ── State helpers ──────────────────────────────────────────────────────────────

export function setState(next: PromptState): void {
	state = { text: next.text, enabled: next.enabled };
}

// ── Session persistence ────────────────────────────────────────────────────────

export function loadFromSession(ctx: any): PromptState | undefined {
	const entries: any[] = ctx.sessionManager.getEntries();
	for (let i = entries.length - 1; i >= 0; i--) {
		const e = entries[i];
		if (e.type === "custom" && e.customType === ENTRY_TYPE) {
			const d = e.data as Partial<PromptState> | undefined;
			if (d) return { text: typeof d.text === "string" ? d.text : "", enabled: d.enabled === true };
		}
	}
	return undefined;
}

export function persistState(pi: ExtensionAPI): void {
	pi.appendEntry(ENTRY_TYPE, state);
}

// ── Status bar ─────────────────────────────────────────────────────────────────

export function updateStatusBar(ctx: any): void {
	const label = statusIndicator(state);
	if (!label) {
		ctx.ui.setStatus(STATUS_KEY, undefined);
		return;
	}
	const color = state.enabled ? "accent" : "muted";
	ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg(color, label));
}
