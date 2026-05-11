/**
 * pi-agent-steer
 *
 * When the user submits a message while the agent is already running, a
 * compact inline prompt appears showing four single-key options:
 *
 *   s  steer   — deliver before the next LLM call (same session)
 *   q  queue   — deliver after the agent fully finishes
 *   d  discard — throw the message away
 *   e  edit    — restore the text to the editor (also: Esc)
 *
 * A single keypress acts immediately — no Enter, no dialog, no Esc conflicts.
 * When the agent is idle the message is passed through normally — no prompt.
 * The /steer <text> slash command skips the prompt entirely and always steers directly.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { SteerPromptComponent } from "./component";
import type { SteerChoice } from "./types";

// ── Extension ──────────────────────────────────────────────────────────────────

export default function steerExtension(pi: ExtensionAPI): void {
	// ── Input interceptor ─────────────────────────────────────────────────────
	pi.on("input", async (event, ctx) => {
		// Only intercept typed messages, not extension-injected ones.
		if (event.source !== "interactive") return { action: "continue" };

		// Don't intercept empty input — Esc in the editor fires input with
		// event.text === "" and we must not block that.
		if (!event.text?.trim()) return { action: "continue" };

		// Agent is idle — pass through normally.
		if (ctx.isIdle()) return { action: "continue" };

		// No interactive UI (print / JSON mode) — pass through.
		if (!ctx.hasUI) return { action: "continue" };

		// Show the single-keypress prompt.
		const choice = await ctx.ui.custom<SteerChoice>(
			(_tui, theme, _kb, done) => new SteerPromptComponent(event.text, theme, done),
		);

		// edit / Esc / unexpected null → restore text to editor, do nothing else.
		if (!choice || choice === "edit") {
			ctx.ui.setEditorText(event.text);
			return { action: "handled" };
		}

		if (choice === "discard") {
			ctx.ui.notify("Message discarded", "info");
			return { action: "handled" };
		}

		if (choice === "steer") {
			pi.sendUserMessage(event.text, { deliverAs: "steer" });
			ctx.ui.notify("◀ Steered — before the next LLM call", "info");
			return { action: "handled" };
		}

		if (choice === "queue") {
			pi.sendUserMessage(event.text, { deliverAs: "followUp" });
			ctx.ui.notify("⏳ Queued — after agent finishes", "info");
			return { action: "handled" };
		}

		return { action: "continue" };
	});

	// ── /steer slash command — explicit steer, bypasses the prompt ────────────
	pi.registerCommand("steer", {
		description: "Steer a message directly into the running agent turn. " + "Usage: /steer <text>",

		handler: async (args, ctx) => {
			const content = args?.trim();

			if (!content) {
				ctx.ui.notify("/steer <text>  — steer text before the next LLM call", "info");
				return;
			}

			const running = !ctx.isIdle();

			if (running) {
				pi.sendUserMessage(content, { deliverAs: "steer" });
			} else {
				pi.sendUserMessage(content);
			}

			ctx.ui.notify(running ? "◀ Steered — before the next LLM call" : "◀ Steered — triggering response", "info");
		},
	});
}
