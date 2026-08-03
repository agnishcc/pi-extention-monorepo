import { Editor, type EditorTheme, Key, matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import type { PromptState } from "./types";

// ── Overlay launcher ───────────────────────────────────────────────────────────

export function openOverlay(ctx: any, current: PromptState): Promise<PromptState | undefined> {
	return (ctx.ui as any).custom(
		(tui: any, theme: any, _kb: any, done: (result?: PromptState) => void) =>
			createComponent(tui, theme, done, current),
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

type Focus = "editor" | "toggle";

export function createComponent(tui: any, theme: any, done: (result?: PromptState) => void, current: PromptState) {
	const dim = (s: string) => theme.fg("dim", s);
	const accent = (s: string) => theme.fg("accent", s);
	const muted = (s: string) => theme.fg("muted", s);

	let enabled = current.enabled;
	let focus: Focus = "editor";

	// ── Editor (input field) ────────────────────────────────────────────────
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
	editor.setText(current.text);

	editor.onSubmit = (text) => {
		done({ text: text.trim(), enabled });
	};

	// ── Rendering ──────────────────────────────────────────────────────────

	function renderHeader(width: number): string[] {
		const title = theme.bold(accent(" ✦ System Prompt Injection"));
		const badge = enabled ? accent("● on") : muted("○ off");
		const gap = Math.max(2, width - visibleWidth(" ✦ System Prompt Injection") - visibleWidth(badge) - 1);
		return [title + " ".repeat(gap) + badge];
	}

	function renderToggleLine(): string {
		const cursor = focus === "toggle" ? theme.fg("accent", "▸") : " ";
		const dot = enabled ? accent("●") : dim("○");
		const stateLabel = enabled ? accent(" Enabled") : muted(" Disabled");
		const desc = enabled ? "text is injected into the system prompt" : "text is not injected";
		return ` ${cursor} ${dot}${stateLabel}  ${dim(desc)}`;
	}

	function renderBody(width: number): string[] {
		const lines: string[] = [];
		lines.push(dim("  Write what should be added to the system prompt:"));
		lines.push("");
		for (const line of editor.render(width - 2)) {
			lines.push(` ${line}`);
		}
		lines.push("");
		lines.push(renderToggleLine());
		return lines;
	}

	function renderFooter(width: number): string[] {
		const divider = dim("─".repeat(width));
		if (focus === "toggle") {
			return [divider, dim("  Enter / Space toggle  ·  Tab to text field  ·  Esc close")];
		}
		return [divider, dim("  Enter save  ·  Tab to toggle  ·  Esc close")];
	}

	// ── Input handling ─────────────────────────────────────────────────────

	return {
		render(width: number): string[] {
			return [...renderHeader(width), dim("─".repeat(width)), ...renderBody(width), ...renderFooter(width)];
		},

		handleInput(data: string): void {
			if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
				done();
				return;
			}

			// Tab moves focus between the text field and the toggle button.
			// Free in the editor: without an autocompleteProvider, its tab handler no-ops.
			if (matchesKey(data, Key.tab)) {
				focus = focus === "editor" ? "toggle" : "editor";
				editor.focused = focus === "editor";
				tui.requestRender();
				return;
			}

			if (focus === "editor") {
				editor.handleInput(data);
				tui.requestRender();
				return;
			}

			// Toggle button focus
			if (matchesKey(data, Key.enter) || matchesKey(data, Key.return) || matchesKey(data, Key.space)) {
				enabled = !enabled;
				tui.requestRender();
				return;
			}
		},

		invalidate(): void {
			editor.invalidate?.();
		},
	};
}
