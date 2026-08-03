/**
 * pi-append-system-prompt
 *
 * Single system-prompt injection for the current session: one text snippet
 * appended to the system prompt before every agent turn, with an
 * enable/disable toggle.
 *
 * Features:
 *   - One injection, no list — set it with /prompt-inject
 *   - Input field + toggle button in the overlay (Tab to it, Enter/Space to flip)
 *   - Appended to the system prompt every turn while enabled
 *   - Persists across /reload via session storage — scoped to this session only
 *
 * Command: /prompt-inject
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { openOverlay } from "./component";
import { loadFromSession, persistState, setState, state, updateStatusBar } from "./state";
import { activeInjectionText } from "./utils";

// ── Extension ──────────────────────────────────────────────────────────────────

export default function sysPromptExtension(pi: ExtensionAPI): void {
	// Restore state on session start / reload (empty state for a fresh session)
	pi.on("session_start", async (_e, ctx) => {
		setState(loadFromSession(ctx) ?? { text: "", enabled: false });
		updateStatusBar(ctx);
	});

	// Append the single snippet to the system prompt before each turn
	pi.on("before_agent_start", async (event) => {
		const addition = activeInjectionText(state);
		if (!addition) return;
		return { systemPrompt: `${event.systemPrompt}\n\n${addition}` };
	});

	pi.registerCommand("prompt-inject", {
		description: "Set the text injected into the system prompt (with enable/disable toggle)",
		handler: async (_args, ctx: ExtensionCommandContext) => {
			if (!ctx.hasUI) return;
			await ctx.waitForIdle();

			const result = await openOverlay(ctx, state);
			if (!result) return;

			setState(result);
			persistState(pi);
			updateStatusBar(ctx);
		},
	});
}
