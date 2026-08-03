// ── Injection helpers ──────────────────────────────────────────────────────────

/** The text to inject this turn, or "" when disabled or empty. */
export function activeInjectionText(state: { text: string; enabled: boolean }): string {
	if (!state.enabled) return "";
	return state.text.trim();
}

/** Status-bar label: undefined when empty, "○ inject off" when set-but-disabled, "⊕ inject on" when active. */
export function statusIndicator(state: { text: string; enabled: boolean }): string | undefined {
	if (state.text.trim().length === 0) return undefined;
	return state.enabled ? "⊕ inject on" : "○ inject off";
}
