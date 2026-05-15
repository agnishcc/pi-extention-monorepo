import { Text, truncateToWidth } from "@earendil-works/pi-tui";
import type { AskQuestion, AskResult } from "./types";

// ── TUI rendering ──────────────────────────────────────────────────────────────

export function renderCall(args: any, theme: any): any {
	const qs = (args.questions as AskQuestion[]) ?? [];
	const count = qs.length;
	let text = theme.fg("toolTitle", theme.bold("ask_user "));
	if (args.header) text += theme.fg("accent", `${args.header} `) + theme.fg("dim", "— ");
	if (count === 1) {
		const q = qs[0];
		const typeTag = theme.fg("muted", `[${q?.type ?? "?"}${q?.multiple ? "/multi" : ""}] `);
		text += typeTag + theme.fg("muted", q?.prompt ?? "");
	} else {
		text += theme.fg("muted", `${count} questions`);
		const labels = qs.map((q, i) => q.label || `Q${i + 1}`).join(", ");
		if (labels) text += theme.fg("dim", ` (${truncateToWidth(labels, 48)})`);
	}
	return new Text(text, 0, 0);
}

export function renderResult(result: any, options: any, theme: any): any {
	const details = result.details as AskResult | undefined;
	if (!details) {
		const first = result.content[0];
		return new Text(first?.type === "text" ? first.text : "", 0, 0);
	}
	if (details.cancelled) {
		return new Text(theme.fg("warning", "Cancelled"), 0, 0);
	}

	if (!options?.expanded) {
		// ── Compact mode ──────────────────────────────────────────────────
		const lines = details.answers.map((a) => {
			const q = details.questions.find((x) => x.id === a.id);
			const label = q?.label ?? a.id;
			if (a.labels && a.labels.length > 1) {
				return (
					theme.fg("success", "✓ ") +
					theme.fg("accent", label) +
					theme.fg("dim", ": ") +
					theme.fg("text", a.labels.join(", "))
				);
			}
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
		const expandHint = theme.fg("dim", " · ctrl+o to expand");
		return new Text(lines.join("\n") + expandHint, 0, 0);
	}

	// ── Expanded mode ──────────────────────────────────────────────────────
	const lines: string[] = [];
	for (let i = 0; i < details.questions.length; i++) {
		const q = details.questions[i]!;
		const ans = details.answers.find((a) => a.id === q.id);
		const isLast = i === details.questions.length - 1;
		const branch = theme.fg("muted", isLast ? "  └─ " : "  ├─ ");
		const stem = theme.fg("muted", isLast ? "     " : "  │  ");

		lines.push(`${branch}${theme.fg("accent", theme.bold(q.label ?? q.id))}`);
		lines.push(`${stem}${theme.fg("muted", "Q: ")}${theme.fg("text", q.prompt)}`);

		if (!ans) {
			lines.push(`${stem}  ${theme.fg("warning", "✗ unanswered")}`);
		} else if (ans.labels && ans.labels.length > 0) {
			for (const lbl of ans.labels) {
				const pre = ans.wasCustom ? theme.fg("muted", "(wrote) ") : "";
				lines.push(`${stem}  ${theme.fg("success", "✓")} ${pre}${theme.fg("text", lbl)}`);
			}
		} else {
			const pre = ans.wasCustom ? theme.fg("muted", "(wrote) ") : "";
			lines.push(`${stem}  ${theme.fg("success", "✓")} ${pre}${theme.fg("text", ans.label)}`);
		}

		if (!isLast) lines.push(theme.fg("muted", "  │"));
	}

	return new Text(lines.join("\n"), 0, 0);
}
