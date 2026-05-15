/**
 * pi-global-footer
 *
 * Renders a two-line status footer for every session:
 *   Line 1 — working directory · git branch (dirty/ahead/behind) · session name
 *   Line 2 — token usage · tps · context window % · model name · thinking level
 *   Line 3 — extension statuses (when any are active)
 *
 * Git status is refreshed after every turn and on branch change events.
 * Token stats update in real-time during streaming.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createFooterRenderer } from "./footer";
import { readGitStatus } from "./git";
import { hasNerdFonts } from "./icons";
import { TpsCalculator } from "./tps";
import type { GitStatus } from "./types";
import { installWorkingIndicator } from "./workingIndicator";

// ── Extension ──────────────────────────────────────────────────────────────────

export default function globalFooterExtension(pi: ExtensionAPI): void {
	installWorkingIndicator(pi);
	let tuiRef: { requestRender: () => void } | null = null;
	let gitStatus: GitStatus | null = null;
	let currentCwd = process.cwd();

	// TPS calculator for live throughput
	const tpsCalculator = new TpsCalculator();

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

			const descriptor = createFooterRenderer(
				ctx,
				() => gitStatus,
				requestRender,
				hasNerdFonts(),
				() => tpsCalculator.getState(),
			)(tui, theme, footerData);

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

	// ── TPS tracking during streaming ─────────────────────────────────────────

	pi.on("turn_start", () => {
		tpsCalculator.resetForTurn();
	});

	pi.on("message_update", (event) => {
		if (!tuiRef) return;
		if (event.message.role !== "assistant") return;
		tpsCalculator.onMessageUpdate(event.message);
		requestRender();
	});

	pi.on("message_end", (event) => {
		if (!tuiRef) return;
		if (event.message.role !== "assistant") return;
		tpsCalculator.onMessageEnd(event.message);
		requestRender();
	});

	pi.on("tool_execution_start", () => {
		tpsCalculator.onToolStart();
	});

	pi.on("tool_execution_end", () => {
		tpsCalculator.onToolEnd();
	});
}
