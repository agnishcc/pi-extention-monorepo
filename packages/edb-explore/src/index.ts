/**
 * pi-explore
 *
 * Registers an `explore_dir` tool that searches a directory across multiple
 * files to answer a question — without loading any of those files into the
 * main agent's context.
 *
 * Spawns a fresh pi process scoped to the target directory with only read +
 * bash tools. The sub-agent does all the file exploration independently and
 * streams progress back via tool notifications. Returns a concise answer with
 * exact file paths and line numbers.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { EXPLORER_SYSTEM_PROMPT, MODEL, PI_BIN } from "./config";
import { renderCall, renderResult } from "./render";
import { runAndParse } from "./runner";

// ── Extension ──────────────────────────────────────────────────────────────────

export default function exploreExtension(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "explore_dir",
		label: "Explore Directory",
		description:
			"Use this tool when you need to find something across multiple files in a directory " +
			"and you do NOT already know which file contains it. It runs a dedicated sub-agent " +
			"that does the exploration independently — none of the files it reads enter your context. " +
			"Returns a direct answer with exact file paths and line numbers. " +
			"Do NOT use this when you already know the file — use read directly instead.",
		promptSnippet:
			"Find something across many files when you don't know which file has it — keeps your context clean",
		promptGuidelines: [
			"Use explore_dir when ALL of these are true: " +
				"(1) you need information that lives somewhere in a directory, " +
				"(2) you do not already know which specific file contains it, " +
				"(3) answering would require reading 3 or more files yourself. " +
				"Examples: 'where is X defined?', 'which files handle Y?', 'find all usages of Z', " +
				"'how is feature W structured?', 'what imports this module?'.",
			"Do NOT use explore_dir when: you already know the file path (use read instead), " +
				"the task is to edit or write files (use read/edit/write directly), " +
				"a single bash grep would answer it (just use bash), " +
				"the user has already pointed you at a specific file.",
			"Pass a precise, self-contained question. The sub-agent has no other context — " +
				"everything it needs to answer must be in the question.",
		],
		parameters: Type.Object({
			question: Type.String({
				description:
					"What to find or answer. Be specific — e.g. 'Where is the auth middleware registered?' " +
					"or 'Which files import the Logger class and what do they do with it?'",
			}),
			directory: Type.Optional(
				Type.String({
					description:
						"Directory to search. Absolute or relative to the current working directory. " +
						"Defaults to the current working directory if omitted.",
				}),
			),
		}),

		async execute(_id, params, signal, onUpdate, ctx) {
			const dir = resolve(ctx.cwd, params.directory ?? ".");

			// ── Guard: directory must exist ─────────────────────────────────
			if (!existsSync(dir)) {
				return {
					content: [{ type: "text", text: `Error: directory not found — ${dir}` }],
					details: { error: "directory_not_found", directory: dir },
				};
			}

			onUpdate?.({ content: [{ type: "text" as const, text: `Exploring ${dir} …` }], details: {} });

			// Stamp the boundary into the prompt so the model sees it explicitly
			const scopedPrompt =
				`Search scope: ${dir}\n` +
				`Do not access files outside this directory.\n\n` +
				`Question: ${params.question}`;

			// ── Spawn pi sub-agent in JSON mode ─────────────────────────────
			const args = [
				"-p",
				scopedPrompt,
				"--mode",
				"json",
				"--model",
				MODEL,
				"--tools",
				"read,bash",
				"--no-extensions",
				"--no-skills",
				"--no-context-files",
				"--no-session",
				"--append-system-prompt",
				EXPLORER_SYSTEM_PROMPT,
			];

			let answer: string;
			try {
				answer = await runAndParse(PI_BIN, args, dir, signal, onUpdate);
			} catch (e: any) {
				return {
					content: [{ type: "text", text: `Exploration failed: ${e.message ?? e}` }],
					details: { error: String(e), directory: dir, question: params.question },
				};
			}

			return {
				content: [{ type: "text", text: answer }],
				details: { directory: dir, question: params.question, model: MODEL },
			};
		},

		renderCall,
		renderResult,
	});
}
