import {
	Editor,
	type EditorTheme,
	Key,
	matchesKey,
	type SelectItem,
	SelectList,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { snippets } from "./state";
import type { OverlayAction } from "./types";
import { formatAge, wordCount } from "./utils";

// ── Overlay launcher ───────────────────────────────────────────────────────────

export function openOverlay(ctx: any, prefillText?: string): Promise<OverlayAction | undefined> {
	return (ctx.ui as any).custom(
		(tui: any, theme: any, _kb: any, done: (result?: OverlayAction) => void) =>
			createComponent(tui, theme, done, prefillText),
		{
			overlay: true,
			overlayOptions: {
				anchor: "center" as const,
				width: "65%" as const,
				maxHeight: "80%" as const,
			},
		},
	);
}

// ── Component ──────────────────────────────────────────────────────────────────

type Mode = "list" | "composing";

export function createComponent(tui: any, theme: any, done: (result?: OverlayAction) => void, prefillText?: string) {
	const dim = (s: string) => theme.fg("dim", s);
	const accent = (s: string) => theme.fg("accent", s);
	const muted = (s: string) => theme.fg("muted", s);

	let mode: Mode = snippets.length === 0 ? "composing" : "list";

	// ── Editor (composing mode) ────────────────────────────────────────────
	const editorTheme: EditorTheme = {
		borderColor: (s) => theme.fg("accent", s),
		selectList: {
			selectedPrefix: (t) => theme.fg("accent", t),
			selectedText: (t) => theme.fg("accent", t),
			description: (t) => theme.fg("muted", t),
			scrollInfo: (t) => theme.fg("dim", t),
			noMatch: (t) => theme.fg("warning", t),
		},
	};
	const editor = new Editor(tui, editorTheme);
	editor.focused = true;
	if (prefillText) editor.setText(prefillText);

	editor.onSubmit = (text) => {
		const trimmed = text.trim();
		if (trimmed) {
			done({ type: "add", text: trimmed });
		} else if (snippets.length > 0) {
			mode = "list";
			tui.requestRender();
		} else {
			done();
		}
	};

	// ── SelectList (list mode) ─────────────────────────────────────────────
	const selectTheme = {
		selectedPrefix: (t: string) => theme.fg("accent", t),
		selectedText: (t: string) => theme.fg("accent", t),
		description: (t: string) => theme.fg("dim", t),
		scrollInfo: (t: string) => theme.fg("dim", t),
		noMatch: (t: string) => theme.fg("warning", t),
	};

	function buildItems(): SelectItem[] {
		const items: SelectItem[] = [{ value: "__add__", label: accent("＋ Add new snippet"), description: "" }];
		for (const s of snippets) {
			const preview = s.text.replace(/\n/g, " ");
			items.push({
				value: s.id,
				label: truncateToWidth(preview, 55),
				description: `${formatAge(s.createdAt)}  ·  ${wordCount(s.text)} words`,
			});
		}
		return items;
	}

	const list = new SelectList(buildItems(), 12, selectTheme);

	// ── Rendering ──────────────────────────────────────────────────────────

	function renderHeader(width: number): string[] {
		const title = theme.bold(accent(" ✦ System Prompt Snippets"));
		const count = snippets.length === 0 ? muted("none active") : accent(`${snippets.length} active`);
		const gap = Math.max(2, width - visibleWidth(" ✦ System Prompt Snippets") - visibleWidth(count) - 1);
		return [title + " ".repeat(gap) + count];
	}

	function renderBody(width: number): string[] {
		if (mode === "composing") {
			const lines: string[] = [];
			lines.push(dim("  Write your system prompt addition:"));
			lines.push("");
			for (const line of editor.render(width - 2)) {
				lines.push(` ${line}`);
			}
			return lines;
		}
		return list.render(width);
	}

	function renderFooter(width: number): string[] {
		const divider = dim("─".repeat(width));
		if (mode === "composing") {
			return [divider, dim(`  Enter submit  ·  Esc ${snippets.length > 0 ? "back to list" : "close"}`)];
		}
		return [divider, dim("  ↑↓ navigate  ·  Enter select  ·  d delete selected  ·  Esc close")];
	}

	// ── Input handling ─────────────────────────────────────────────────────

	return {
		render(width: number): string[] {
			return [...renderHeader(width), dim("─".repeat(width)), ...renderBody(width), ...renderFooter(width)];
		},

		handleInput(data: string): void {
			if (mode === "composing") {
				if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
					if (snippets.length > 0) {
						mode = "list";
						tui.requestRender();
					} else {
						done();
					}
					return;
				}
				editor.handleInput(data);
				tui.requestRender();
				return;
			}

			// list mode
			if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
				done();
				return;
			}

			if (data === "d") {
				const sel = list.getSelectedItem();
				if (sel && sel.value !== "__add__") {
					const snippet = snippets.find((s) => s.id === sel.value);
					if (snippet) done({ type: "delete", id: snippet.id, text: snippet.text });
				}
				return;
			}

			if (matchesKey(data, Key.enter) || matchesKey(data, Key.return)) {
				const sel = list.getSelectedItem();
				if (!sel) return;
				if (sel.value === "__add__") {
					mode = "composing";
					editor.setText("");
					editor.focused = true;
					tui.requestRender();
				} else {
					const snippet = snippets.find((s) => s.id === sel.value);
					if (snippet) done({ type: "delete", id: snippet.id, text: snippet.text });
				}
				return;
			}

			if (
				matchesKey(data, Key.up) ||
				matchesKey(data, Key.down) ||
				matchesKey(data, Key.pageUp) ||
				matchesKey(data, Key.pageDown)
			) {
				list.handleInput(data);
				tui.requestRender();
				return;
			}
		},

		invalidate(): void {
			editor.invalidate?.();
			list.invalidate();
		},
	};
}
