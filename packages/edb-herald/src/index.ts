/**
 * pi-herald
 *
 * Git commit and PR agent. Reads the current diff, groups changes into logical
 * commits, shows a plan for approval, executes commits, then pushes and creates
 * a GitHub PR — all step by step with explicit approval gates.
 *
 * Usage:
 *   /herald          — full flow: commits → push → PR
 *   /herald commit   — commit only (no push, no PR)
 *   /herald pr       — PR only (assumes commits already done)
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { buildTask, isGitRepo, parseMode } from "./git";
import { HERALD_INSTRUCTIONS } from "./instructions";

// ── Extension ──────────────────────────────────────────────────────────────────

export default function heraldExtension(pi: ExtensionAPI): void {
	let pendingInstructions: string | null = null;

	// Inject Herald persona into system prompt just before the agent turn runs
	pi.on("before_agent_start", async (event) => {
		if (!pendingInstructions) return;
		const instructions = pendingInstructions;
		pendingInstructions = null;
		return {
			systemPrompt: `${event.systemPrompt}\n\n---\n\n${instructions}`,
		};
	});

	pi.registerCommand("herald", {
		description: "Git commit and PR agent · [commit|pr] or both",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) return;

			if (!(await isGitRepo(pi, ctx.cwd))) {
				ctx.ui.notify("Not a git repository.", "error");
				return;
			}

			const mode = parseMode(args);
			ctx.ui.notify(`Herald starting — ${mode} mode`, "info");

			const task = await buildTask(pi, mode, ctx.cwd);

			// Arm the system prompt injection for the next agent turn
			pendingInstructions = HERALD_INSTRUCTIONS;

			// Fire the task into the agent
			pi.sendUserMessage(task);
		},
	});
}
