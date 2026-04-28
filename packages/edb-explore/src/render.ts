import { Text } from "@mariozechner/pi-tui";

// ── TUI rendering ──────────────────────────────────────────────────────────────

export function renderCall(args: any, theme: any): any {
	const q = (args.question as string) ?? "";
	const d = (args.directory as string) ?? "";
	return new Text(
		theme.fg("toolTitle", theme.bold("explore_dir ")) +
			(d ? theme.fg("muted", `${d}  `) : "") +
			theme.fg("dim", `"${q}"`),
		0,
		0,
	);
}

export function renderResult(result: any, _opts: any, theme: any): any {
	const first = result.content[0];
	const text = first?.type === "text" ? first.text : "";
	// Highlight file:line references
	const rendered = text.replace(/([\w./-]+\.\w+:\d+)/g, (match: string) => theme.fg("accent", match));
	return new Text(rendered, 0, 0);
}
