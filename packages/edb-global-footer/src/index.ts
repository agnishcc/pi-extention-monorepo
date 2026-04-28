/**
 * pi-global-footer
 *
 * Renders a two-line status footer for every session:
 *   Line 1 — working directory · git branch (dirty/ahead/behind) · session name
 *   Line 2 — token usage · context window % · model name · thinking level
 *   Line 3 — extension statuses (when any are active)
 *
 * Git status is refreshed after every turn and on branch change events.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createFooterRenderer } from "./footer";
import { readGitStatus } from "./git";
import type { GitStatus } from "./types";

// ── Extension ──────────────────────────────────────────────────────────────────

export default function globalFooterExtension(pi: ExtensionAPI): void {
	let tuiRef: { requestRender: () => void } | null = null;
	let gitStatus: GitStatus | null = null;
	let currentCwd = process.cwd();

	const requestRender = () => tuiRef?.requestRender();
	const refreshGit = () => {
		gitStatus = readGitStatus(currentCwd);
	};

	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		currentCwd = ctx.cwd;
		refreshGit();

		ctx.ui.setFooter((tui, theme, footerData) => {
			tuiRef = tui;

			const descriptor = createFooterRenderer(ctx, () => gitStatus, requestRender)(tui, theme, footerData);

			return {
				dispose() {
					descriptor.dispose();
					if (tuiRef === tui) tuiRef = null;
				},
				invalidate: descriptor.invalidate,
				render: descriptor.render,
			};
		});
	});

	pi.on("turn_end", async (_event, ctx) => {
		currentCwd = ctx.cwd;
		refreshGit();
		requestRender();
	});

	pi.on("model_select", async (_event, ctx) => {
		currentCwd = ctx.cwd;
		requestRender();
	});
}
