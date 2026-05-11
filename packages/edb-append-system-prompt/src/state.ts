import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Snippet } from "./types";

// ── Module state ───────────────────────────────────────────────────────────────

export let snippets: Snippet[] = [];

export const STATUS_KEY = "sys-prompt";
export const ENTRY_TYPE = "sys-prompt-snippets";

// ── State helpers ──────────────────────────────────────────────────────────────

export function addSnippet(text: string): void {
	snippets.push({ id: randomUUID(), text: text.trim(), createdAt: Date.now() });
}

export function removeSnippet(id: string): void {
	snippets = snippets.filter((s) => s.id !== id);
}

export function setSnippets(next: Snippet[]): void {
	snippets = next;
}

// ── Session persistence ────────────────────────────────────────────────────────

export function loadFromSession(ctx: any): Snippet[] {
	const entries: any[] = ctx.sessionManager.getEntries();
	for (let i = entries.length - 1; i >= 0; i--) {
		const e = entries[i];
		if (e.type === "custom" && e.customType === ENTRY_TYPE) {
			return (e.data?.snippets as Snippet[]) ?? [];
		}
	}
	return [];
}

export function persistSnippets(pi: ExtensionAPI): void {
	pi.appendEntry(ENTRY_TYPE, { snippets });
}

// ── Status bar ─────────────────────────────────────────────────────────────────

export function updateStatusBar(ctx: any): void {
	if (snippets.length === 0) {
		ctx.ui.setStatus(STATUS_KEY, undefined);
		return;
	}
	const label = snippets.length === 1 ? "1 snippet" : `${snippets.length} snippets`;
	ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("accent", `⊕ ${label}`));
}
