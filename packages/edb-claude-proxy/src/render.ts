import { getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import { formatToolCall } from "./format";
import type { ClaudeProxyDetails } from "./types";

// ── TUI rendering ──────────────────────────────────────────────────────────────

export function renderCall(args: any, theme: any): any {
	const prompt = args.prompt ?? "";
	const preview = prompt.length > 80 ? `${prompt.slice(0, 80)}…` : prompt;
	const model = args.model ?? "sonnet";
	const toolsLabel = args.allowedTools
		? (args.allowedTools as string[]).length === 0
			? "no tools"
			: (args.allowedTools as string[]).join(", ")
		: "Read";

	let text =
		theme.fg("toolTitle", theme.bold("claude_proxy ")) +
		theme.fg("accent", `[${model}]`) +
		theme.fg("muted", ` tools: ${toolsLabel}`);

	if (args.systemPrompt) {
		const rolePreview = (args.systemPrompt as string).slice(0, 50);
		text += `\n  ${theme.fg("muted", "role: ")}${theme.fg("dim", rolePreview)}`;
	}

	text += `\n  ${theme.fg("dim", preview)}`;

	if (args.files && (args.files as string[]).length > 0) {
		text += `\n  ${theme.fg("muted", "files: ")}${theme.fg("dim", (args.files as string[]).join(", "))}`;
	}

	return new Text(text, 0, 0);
}

export function renderResult(result: any, { expanded }: any, theme: any): any {
	const details = result.details as ClaudeProxyDetails | undefined;
	const text = result.content[0]?.type === "text" ? result.content[0].text : "(no output)";

	const metaParts: string[] = [];
	if (details?.model) metaParts.push(details.model);
	if (details?.costUsd) metaParts.push(`$${details.costUsd.toFixed(4)}`);
	const meta = metaParts.map((p) => theme.fg("dim", p)).join("  ");

	if (result.isError) {
		const errText = details?.streaming ? "(aborted)" : text;
		return new Text(
			theme.fg("error", "✗ ") +
				theme.fg("toolTitle", theme.bold("Claude")) +
				(meta ? `  ${meta}` : "") +
				`\n${theme.fg("error", errText)}`,
			0,
			0,
		);
	}

	const icon = details?.streaming ? theme.fg("warning", "⏳") : theme.fg("success", "✓");
	const headerLine = `${icon} ${theme.fg("toolTitle", theme.bold("Claude"))}${meta ? `  ${meta}` : ""}`;

	const toolCallLines = (details?.toolCalls ?? []).map(
		(tc) =>
			`  ${theme.fg("muted", "→ ")}${theme.fg("accent", tc.name)}${theme.fg("dim", ` ${formatToolCall(tc.name, tc.input)}`)}${tc.isError ? ` ${theme.fg("error", "[error]")}` : ""}`,
	);

	if (expanded) {
		const mdTheme = getMarkdownTheme();
		const container = new Container();
		container.addChild(new Text(headerLine, 0, 0));
		if (toolCallLines.length > 0) {
			container.addChild(new Spacer(1));
			container.addChild(new Text(theme.fg("muted", "─── Tool calls ───"), 0, 0));
			for (const tl of toolCallLines) container.addChild(new Text(tl, 0, 0));
		}
		if (text) {
			container.addChild(new Spacer(1));
			container.addChild(new Text(theme.fg("muted", "─── Response ───"), 0, 0));
			container.addChild(new Markdown(text.trim(), 0, 0, mdTheme));
		}
		return container;
	}

	// Collapsed view
	const previewLines = text.split("\n").slice(0, 6);
	const previewText = previewLines.join("\n") + (text.split("\n").length > 6 ? "\n…" : "");

	let out = headerLine;
	if (toolCallLines.length > 0) {
		out += `\n${toolCallLines.slice(0, 3).join("\n")}`;
		if (toolCallLines.length > 3) out += `\n  ${theme.fg("muted", `… +${toolCallLines.length - 3} more`)}`;
	}
	if (text) out += `\n${theme.fg("toolOutput", previewText)}`;
	out += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;

	return new Text(out, 0, 0);
}
