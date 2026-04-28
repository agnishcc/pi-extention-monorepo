/**
 * pi-usage-stats
 *
 * Shows AI provider token and rate usage via the /usage command.
 * Supports multiple providers: Claude, Copilot, Gemini, Codex, Antigravity,
 * MiniMax, OpenRouter, Kiro, z.ai.
 *
 * Providers are opt-in — configure via the settings panel (press s).
 * Rate windows, reset timers, and live provider status are all shown.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { UsageComponent } from "./component";

// ── Extension ──────────────────────────────────────────────────────────────────

export default function usageStatsExtension(pi: ExtensionAPI): void {
	pi.registerCommand("usage", {
		description: "Show AI provider token and rate usage",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			if (!ctx.hasUI) return;
			await ctx.waitForIdle();

			await (ctx.ui as any).custom(
				(tui: any, theme: any, _keybindings: any, done: () => void) => {
					const component = new UsageComponent(tui, theme, ctx.modelRegistry, done);
					return {
						render: (width: number) => component.render(width),
						handleInput: (data: string) => component.handleInput(data),
						invalidate: () => component.invalidate(),
					};
				},
				{
					overlay: true,
					overlayOptions: {
						anchor: "center" as const,
						width: "60%" as const,
						maxHeight: "80%" as const,
					},
				},
			);
		},
	});
}
