/**
 * pi-session-manager
 *
 * Browse, resume, rename, and delete sessions via the /sessions command
 * or the ctrl+shift+r shortcut.
 *
 * Features:
 *   - Fuzzy search across session titles and first messages
 *   - Workspace / all scope toggle
 *   - Inline rename (current session and archived sessions)
 *   - Delete with confirmation
 *   - Status bar shows active session name
 */

import { unlink } from "node:fs/promises";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { createSessionComponent } from "./component";
import type { SessionAction } from "./types";

// ── Extension ──────────────────────────────────────────────────────────────────

export default function sessionManagerExtension(pi: ExtensionAPI): void {
	// ── Status bar: show session name on start ─────────────────────────────
	pi.on("session_start", async (_e: any, ctx: any) => {
		const name = ctx.sessionManager.getSessionName();
		ctx.ui.setStatus("sm", name ? ctx.ui.theme.fg("accent", `📁 ${name}`) : undefined);
	});

	// ── Command: /sessions ─────────────────────────────────────────────────
	pi.registerCommand("sessions", {
		description: "Browse, resume, rename, and delete sessions",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			if (!ctx.hasUI) return;
			await ctx.waitForIdle();
			await runSessionOverlay(ctx, pi);
		},
	});

	// ── Shortcut: ctrl+shift+r ─────────────────────────────────────────────
	pi.registerShortcut("ctrl+shift+r", {
		description: "Open session manager",
		handler: async (ctx: any) => {
			if (!ctx.hasUI || !ctx.isIdle()) return;
			pi.sendUserMessage("/sessions");
		},
	});
}

// ── Core loop ──────────────────────────────────────────────────────────────────

async function runSessionOverlay(ctx: ExtensionCommandContext, pi: ExtensionAPI): Promise<void> {
	let shouldReopen = false;
	do {
		shouldReopen = false;
		const action = await openOverlay(ctx, pi);
		if (!action) break;
		shouldReopen = await handleAction(action, ctx, pi);
	} while (shouldReopen);
}

// ── Overlay ────────────────────────────────────────────────────────────────────

function openOverlay(ctx: ExtensionCommandContext, pi: ExtensionAPI): Promise<SessionAction | undefined> {
	return (ctx.ui as any).custom(
		(tui: any, theme: any, _keybindings: any, done: (result?: SessionAction) => void) =>
			createSessionComponent(tui, theme, ctx, pi, done),
		{
			overlay: true,
			overlayOptions: {
				anchor: "center" as const,
				width: "60%" as const,
				maxHeight: "80%" as const,
			},
		},
	);
}

// ── Action handlers ────────────────────────────────────────────────────────────

async function handleAction(action: SessionAction, ctx: ExtensionCommandContext, _pi: ExtensionAPI): Promise<boolean> {
	if (action.type === "resume") {
		if (action.data.path === (ctx.sessionManager as any).getSessionFile()) {
			ctx.ui.notify("Already in this session.", "info");
			return false;
		}
		await ctx.switchSession(action.data.path);
		return false;
	}

	if (action.type === "delete") {
		const confirmed = await ctx.ui.confirm("Delete session?", `"${action.data.title}"\n\nThis cannot be undone.`);
		if (confirmed) {
			try {
				await unlink(action.data.path);
				ctx.ui.notify("Deleted.", "info");
			} catch (e: any) {
				ctx.ui.notify(`Failed: ${e.message ?? e}`, "error");
			}
		}
		return true; // reopen — list has changed
	}

	return false;
}
