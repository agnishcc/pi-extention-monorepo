import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { checkPromptSource } from "./state";

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
				`Pi default system prompt changed (${versionText}). Review your custom SYSTEM.md against the bundled default prompt.`,
				"warning",
			);
		} catch (error: unknown) {
			console.error("[edb-system-prompt-watch] Failed to check Pi default system prompt:", error);
		}
	});
}
