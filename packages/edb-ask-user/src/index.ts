/**
 * pi-ask-user
 *
 * Provides an `ask_user` tool that lets the LLM ask the user structured
 * questions directly in the terminal UI — without an extra model round-trip.
 *
 * Supports three question modes (freely mixed in one call):
 *   - text   : free-form text input via inline editor
 *   - choice : pick from a numbered option list (+ optional "Type something")
 *
 * Single question  → focused UI, no tab bar, immediate return
 * Multiple questions → tab-based wizard with a Submit tab
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createAskUserComponent } from "./component";
import { renderCall, renderResult } from "./render";
import { AskUserParams } from "./schemas";
import type { AskQuestion, AskResult } from "./types";

// ── Extension ──────────────────────────────────────────────────────────────────

export default function askUserExtension(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "ask_user",
		label: "Ask User",
		description:
			"Ask the user one or more structured questions directly in the terminal UI. " +
			"Supports free-text input, multiple-choice option lists, and multi-step " +
			"questionnaires. Use this instead of embedding questions in your response text " +
			"to avoid an extra model round-trip and give the user a clear, interactive prompt.",
		promptSnippet: "Ask the user a question or questionnaire and get structured answers",
		promptGuidelines: [
			"Use ask_user whenever you need information, a preference, or confirmation from the user before proceeding.",
			"Prefer ask_user over posing questions in your response text — it collects answers immediately without an extra LLM call.",
			"For a single free-form question set type to 'text'. " +
				"For a multiple-choice question set type to 'choice' and provide options. " +
				"Pass several questions together for a multi-step flow.",
			"For choice questions, set allowOther to false only when an open-ended answer is not acceptable.",
		],
		parameters: AskUserParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			// ── Guard: interactive mode only ──────────────────────────────────
			if (!ctx.hasUI) {
				return {
					content: [
						{ type: "text", text: "Error: ask_user requires an interactive terminal (UI not available)." },
					],
					details: { questions: [], answers: [], cancelled: true } satisfies AskResult,
				};
			}

			if (params.questions.length === 0) {
				return {
					content: [{ type: "text", text: "Error: No questions provided." }],
					details: { questions: [], answers: [], cancelled: true } satisfies AskResult,
				};
			}

			// Validate: choice questions must have at least one option
			for (const q of params.questions) {
				if (q.type === "choice" && (!q.options || q.options.length === 0)) {
					return {
						content: [{ type: "text", text: `Error: Question "${q.id}" is type 'choice' but has no options.` }],
						details: { questions: [], answers: [], cancelled: true } satisfies AskResult,
					};
				}
			}

			// Normalise questions (fill in derived defaults)
			const questions: AskQuestion[] = params.questions.map((q, i) => ({
				...q,
				label: q.label || `Q${i + 1}`,
				allowOther: true,
			}));

			// ── Build & show the custom TUI ───────────────────────────────────
			const result = await ctx.ui.custom<AskResult>((tui, theme, _kb, done) =>
				createAskUserComponent(tui, theme, done, questions),
			);

			// ── Build response for LLM ────────────────────────────────────────
			if (result.cancelled) {
				return {
					content: [{ type: "text", text: "User cancelled the prompt." }],
					details: result satisfies AskResult,
				};
			}

			const lines = result.answers.map((a) => {
				const q = questions.find((x) => x.id === a.id);
				const label = q?.label ?? a.id;
				if (a.wasCustom) return `${label} (${a.id}): user wrote: ${a.label}`;
				return `${label} (${a.id}): user selected: ${a.optionIndex}. ${a.label}`;
			});

			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: result satisfies AskResult,
			};
		},

		renderCall,
		renderResult,
	});
}
