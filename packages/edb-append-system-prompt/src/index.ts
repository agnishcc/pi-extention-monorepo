/**
 * pi-append-system-prompt
 *
 * Manages a list of system-prompt snippets that are appended to every agent
 * turn in the current session.
 *
 * Features:
 *   - Always appends (never replaces) — snippets accumulate as a list
 *   - Confirm dialog before any snippet is added, showing the exact text
 *   - Status bar indicator when snippets are active
 *   - Delete individual snippets
 *   - Persists across /reload via session storage — scoped to this session only
 *
 * Command: /prompt-inject
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { openOverlay } from "./component";
import {
	addSnippet,
	loadFromSession,
	persistSnippets,
	removeSnippet,
	setSnippets,
	snippets,
	updateStatusBar,
} from "./state";

// ── Extension ──────────────────────────────────────────────────────────────────

export default function sysPromptExtension(pi: ExtensionAPI): void {
	// Restore state on session start / reload
	pi.on("session_start", async (_e, ctx) => {
		setSnippets(loadFromSession(ctx));
		updateStatusBar(ctx);
	});

	// Append all snippets to the system prompt before each turn
	pi.on("before_agent_start", async (event) => {
		if (snippets.length === 0) return;
		const addition = snippets.map((s) => s.text).join("\n\n");
		return { systemPrompt: `${event.systemPrompt}\n\n${addition}` };
	});

	pi.registerCommand("prompt-inject", {
		description: "Manage system prompt snippets — add, view, and delete",
		handler: async (_args, ctx: ExtensionCommandContext) => {
			if (!ctx.hasUI) return;
			await ctx.waitForIdle();

			let pendingText: string | undefined;
			let shouldReopen = false;

			do {
				shouldReopen = false;
				const action = await openOverlay(ctx, pendingText);
				pendingText = undefined;

				if (!action) break;

				if (action.type === "add") {
					const preview = action.text.length > 500 ? `${action.text.slice(0, 497)}…` : action.text;
					const confirmed = await ctx.ui.confirm("Add this to your system prompt?", preview);
					if (confirmed) {
						addSnippet(action.text);
						persistSnippets(pi);
						updateStatusBar(ctx);
					} else {
						// Preserve typed text so user doesn't lose their work
						pendingText = action.text;
					}
					shouldReopen = true;
				}

				if (action.type === "delete") {
					const preview = action.text.length > 300 ? `${action.text.slice(0, 297)}…` : action.text;
					const confirmed = await ctx.ui.confirm("Remove this snippet from your system prompt?", preview);
					if (confirmed) {
						removeSnippet(action.id);
						persistSnippets(pi);
						updateStatusBar(ctx);
					}
					shouldReopen = true;
				}
			} while (shouldReopen);
		},
	});
}
