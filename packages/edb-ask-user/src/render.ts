import { Text, truncateToWidth } from "@earendil-works/pi-tui";
import type { AskQuestion, AskResult } from "./types";

// ── TUI rendering ──────────────────────────────────────────────────────────────

export function renderCall(args: any, theme: any): any {
	const qs = (args.questions as AskQuestion[]) ?? [];
	const count = qs.length;
	let text = theme.fg("toolTitle", theme.bold("ask_user "));
	if (count === 1) {
		const q = qs[0];
		const typeTag = theme.fg("muted", `[${q?.type ?? "?"}] `);
		text += typeTag + theme.fg("muted", q?.prompt ?? "");
	} else {
		text += theme.fg("muted", `${count} questions`);
		const labels = qs.map((q, i) => q.label || `Q${i + 1}`).join(", ");
		if (labels) text += theme.fg("dim", ` (${truncateToWidth(labels, 48)})`);
	}
	return new Text(text, 0, 0);
}

export function renderResult(result: any, _options: any, theme: any): any {
	const details = result.details as AskResult | undefined;
	if (!details) {
		const first = result.content[0];
		return new Text(first?.type === "text" ? first.text : "", 0, 0);
	}
	if (details.cancelled) {
		return new Text(theme.fg("warning", "Cancelled"), 0, 0);
	}

	const lines = details.answers.map((a) => {
		const q = details.questions.find((x) => x.id === a.id);
		const label = q?.label ?? a.id;
		if (a.wasCustom) {
			return (
				theme.fg("success", "✓ ") +
				theme.fg("accent", label) +
				theme.fg("dim", ": ") +
				theme.fg("muted", "(wrote) ") +
				a.label
			);
		}
		const num = a.optionIndex ? `${a.optionIndex}. ` : "";
		return theme.fg("success", "✓ ") + theme.fg("accent", label) + theme.fg("dim", ": ") + num + a.label;
	});
	return new Text(lines.join("\n"), 0, 0);
}
