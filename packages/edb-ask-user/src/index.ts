/**
 * pi-ask-user
 *
 * Provides an `ask_user` tool that lets the LLM ask the user structured
 * questions directly in the terminal UI — without an extra model round-trip.
 *
 * Supports three question modes (freely mixed in one call):
 *   - text    : free-form text input via inline editor
 *   - choice  : pick from a numbered option list (single or multiple-select)
 *
 * Single question   → focused UI, no tab bar, immediate return on answer
 * Multiple questions / any multiple-select → tab-based wizard with a Submit tab
 */

import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	type ExtensionAPI,
	formatSize,
	truncateHead,
} from "@earendil-works/pi-coding-agent";
import { createAskUserComponent } from "./component";
import { renderCall, renderResult } from "./render";
import { AskUserParams } from "./schemas";
import type { AskQuestion, AskResult } from "./types";
import { acquireModalLock, isModalActive, sleep, writeTempJson } from "./utils";

// ── Extension ──────────────────────────────────────────────────────────────────

export default function askUserExtension(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "ask_user",
		label: "Ask User",
		description:
			"Ask the user one or more structured questions directly in the terminal UI. " +
			"Supports free-text input, multiple-choice option lists (single or multi-select), " +
			"and multi-step questionnaires. Use this instead of embedding questions in your " +
			"response text to avoid an extra model round-trip and give the user a clear, " +
			"interactive prompt.",
		promptSnippet: "Ask the user a question or questionnaire and get structured answers",
		promptGuidelines: [
			"Use ask_user whenever you need information, a preference, or confirmation from the user before proceeding.",
			"Prefer ask_user over posing questions in your response text — it collects answers immediately without an extra LLM call.",
			"For a single free-form question set type to 'text'. " +
				"For a multiple-choice question set type to 'choice' and provide options. " +
				"Pass several questions together for a multi-step flow.",
			"Set multiple: true on a choice question to allow the user to select several options at once (checkbox style).",
			"A free-text option is always available for choice questions. " +
				"By default, a 'Type something.' option is auto-appended. " +
				"If you want to provide your own free-text option (e.g. 'Other', 'Custom'), " +
				"mark it with isOther: true — this replaces the default and avoids redundancy. " +
				"Use customLabel / customPlaceholder to rename or hint that auto-appended option.",
			"Use the header field to give the overall prompt a title (e.g. 'Deployment settings').",
			"Set overlay: true for prominent confirmations or when terminal context should stay visible.",
		],
		parameters: AskUserParams,

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			// ── Guard: interactive mode only ──────────────────────────────────
			if (!ctx.hasUI) {
				return {
					content: [
						{
							type: "text",
							text: "Error: ask_user requires an interactive terminal (UI not available).",
						},
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

			// Validate choice questions have options
			for (const q of params.questions) {
				if (q.type === "choice" && (!q.options || q.options.length === 0)) {
					return {
						content: [
							{
								type: "text",
								text: `Error: Question "${q.id}" is type 'choice' but has no options.`,
							},
						],
						details: { questions: [], answers: [], cancelled: true } satisfies AskResult,
					};
				}
			}

			// ── Queue behind any active modal ─────────────────────────────────
			while (isModalActive()) {
				if (signal?.aborted) {
					return {
						content: [{ type: "text", text: "Error: Tool call aborted while waiting for active modal." }],
						details: { questions: [], answers: [], cancelled: true } satisfies AskResult,
					};
				}
				await sleep(100);
			}

			// Normalise questions (fill in derived defaults)
			const questions: AskQuestion[] = params.questions.map((q, i) => ({
				...q,
				label: q.label || `Q${i + 1}`,
			}));

			const useOverlay = params.overlay ?? false;
			const overlayOpts = useOverlay
				? {
						overlay: true,
						overlayOptions: {
							anchor: "center" as const,
							maxHeight: "80%" as `${number}%`,
							width: 96,
						},
					}
				: undefined;

			// ── Acquire modal lock + save hardware cursor ─────────────────────
			const releaseModalLock = acquireModalLock();
			let restoreHardwareCursor: (() => void) | undefined;

			let result: AskResult;
			try {
				result = await ctx.ui.custom<AskResult>((tui, theme, _kb, done) => {
					const prev = (tui as any).getShowHardwareCursor?.();
					if (prev !== undefined) {
						(tui as any).setShowHardwareCursor?.(true);
						restoreHardwareCursor = () => (tui as any).setShowHardwareCursor?.(prev);
					}
					return createAskUserComponent(tui, theme, done, questions, {
						header: params.header,
						useOverlay,
					});
				}, overlayOpts);
			} finally {
				restoreHardwareCursor?.();
				releaseModalLock();
			}

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
				if (a.labels && a.labels.length > 1) {
					const parts = a.labels.map((lbl, i) => {
						const idx = a.optionIndices?.[i];
						return idx ? `${idx}. ${lbl}` : lbl;
					});
					return `${label} (${a.id}): user selected: ${parts.join(", ")}`;
				}
				if (a.wasCustom) return `${label} (${a.id}): user wrote: ${a.label}`;
				return `${label} (${a.id}): user selected: ${a.optionIndex}. ${a.label}`;
			});

			const text = lines.join("\n");

			// ── Truncate large responses ──────────────────────────────────────
			const full = JSON.stringify(result, null, 2);
			const truncation = truncateHead(full, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });

			if (!truncation.truncated) {
				return {
					content: [{ type: "text", text }],
					details: result satisfies AskResult,
				};
			}

			const artifact = await writeTempJson(full);
			const omittedLines = Math.max(0, truncation.totalLines - truncation.outputLines);
			const omittedBytes = Math.max(0, truncation.totalBytes - truncation.outputBytes);
			const artifactNote = artifact.path
				? ` Full output saved to: ${artifact.path}`
				: artifact.error
					? ` Full output preservation failed: ${artifact.error}`
					: "";
			const truncationNotice =
				`[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines ` +
				`(${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). ` +
				`${omittedLines} lines (${formatSize(omittedBytes)}) omitted.${artifactNote}]`;

			return {
				content: [{ type: "text", text: `${text}\n\n${truncationNotice}` }],
				details: result satisfies AskResult,
			};
		},

		renderCall,
		renderResult,
	});
}
