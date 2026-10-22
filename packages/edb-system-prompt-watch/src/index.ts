import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { comparePrompts, getBundledDefaultPrompt, readFallbackSystemPrompt } from "./compare";
import {
	formatDiffDisplayLines,
	formatNumberedLines,
	formatSummaryDisplayLines,
	ScrollableTabContent,
	TabbedDiffOverlay,
} from "./overlay";
import { checkPromptSource } from "./state";

const OVERLAY_OPTIONS = {
	overlay: true,
	overlayOptions: {
		anchor: "center" as const,
		width: "90%" as const,
		minWidth: 60,
		maxHeight: "90%" as const,
	},
};

export async function handlePromptDiffCommand(_args: string, ctx: ExtensionCommandContext): Promise<void> {
	try {
		const activePrompt = ctx.getSystemPrompt() || readFallbackSystemPrompt(ctx.cwd);
		const bundled = await getBundledDefaultPrompt(undefined, ctx.cwd);
		const comparison = comparePrompts(activePrompt, bundled.prompt, {
			piVersion: bundled.version,
			promptSourcePath: bundled.sourcePath,
		});

		if (!ctx.hasUI) {
			console.log(comparison.formattedSummary);
			return;
		}

		await ctx.ui.custom<void>((_tui, theme, _keybindings, done) => {
			const summaryDisplayLines = formatSummaryDisplayLines(comparison, theme);
			const diffDisplayLines = formatDiffDisplayLines(comparison.unifiedDiff, theme);
			const activeDisplayLines = formatNumberedLines(comparison.activePrompt || "(no active system prompt)", theme);
			const defaultDisplayLines = formatNumberedLines(comparison.defaultPrompt, theme);

			const subtitle = comparison.isIdentical
				? "identical"
				: `${comparison.missingFromActive.length} missing · ${comparison.modifiedOrChanged.length} changed · ${comparison.uniqueToActive.length} custom`;

			const tabs = [
				new ScrollableTabContent(
					{ rawText: comparison.formattedSummary, displayLines: summaryDisplayLines, theme },
					"Summary",
				),
				new ScrollableTabContent(
					{ rawText: comparison.unifiedDiff, displayLines: diffDisplayLines, theme },
					"Diff",
				),
				new ScrollableTabContent(
					{ rawText: comparison.activePrompt, displayLines: activeDisplayLines, theme },
					"Active",
				),
				new ScrollableTabContent(
					{ rawText: comparison.defaultPrompt, displayLines: defaultDisplayLines, theme },
					"Default",
				),
			];

			return new TabbedDiffOverlay({
				title: "System Prompt Comparison",
				subtitle,
				tabs,
				theme,
				done,
			});
		}, OVERLAY_OPTIONS);
	} catch (error: unknown) {
		const msg = error instanceof Error ? error.message : String(error);
		if (ctx.hasUI) {
			ctx.ui.notify(`Failed to compare system prompts: ${msg}`, "error");
		} else {
			console.error("[edb-system-prompt-watch] Failed to compare system prompts:", error);
		}
	}
}

export default function systemPromptWatchExtension(pi: ExtensionAPI): void {
	pi.on("session_start", async (event, ctx) => {
		if (event.reason !== "startup") return;

		try {
			const result = await checkPromptSource();
			if (!result.changed) return;

			const previousVersion = result.previous?.lastSeenPiVersion ?? "unknown";
			const currentVersion = result.snapshot.piVersion;
			const versionText =
				previousVersion === currentVersion ? currentVersion : `${previousVersion} → ${currentVersion}`;

			ctx.ui.notify(
				`Pi default system prompt changed (${versionText}). Run /prompt-diff to review changes against your active prompt.`,
				"warning",
			);
		} catch (error: unknown) {
			console.error("[edb-system-prompt-watch] Failed to check Pi default system prompt:", error);
		}
	});

	pi.registerCommand("prompt-diff", {
		description: "Compare active system prompt against Pi's bundled default system prompt",
		handler: handlePromptDiffCommand,
	});

	pi.registerCommand("system-prompt-diff", {
		description: "Compare active system prompt against Pi's bundled default system prompt (alias)",
		handler: handlePromptDiffCommand,
	});
}
