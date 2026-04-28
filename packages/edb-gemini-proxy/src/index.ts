/**
 * pi-gemini-proxy
 *
 * Registers a `gemini_proxy` tool that lets the pi agent delegate tasks
 * to Google's Gemini CLI running in non-interactive (headless) mode.
 *
 * Typical uses: code review, security audit, diff analysis, second-opinion
 * reasoning — from a model with a different perspective than the primary agent.
 *
 * Requires: `gemini` CLI on PATH (npm install -g @google/gemini-cli)
 * Optional:  set GEMINI_PATH env var to point to a specific binary.
 * Auth:      GEMINI_API_KEY env var, or run `gemini auth` to login via OAuth.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { findGeminiCli } from "./cli";
import { execute } from "./execute";
import { renderCall, renderResult } from "./render";

// ── Extension ──────────────────────────────────────────────────────────────────

export default function geminiProxyExtension(pi: ExtensionAPI): void {
	const geminiPath = findGeminiCli();

	pi.registerTool({
		name: "gemini_proxy",
		label: "Gemini Proxy",
		description: [
			"Delegate a task to Google's Gemini CLI running in non-interactive (headless) mode.",
			"Best for: code review, security audit, diff analysis, cross-model second opinion,",
			"tasks that benefit from Gemini's large context window or Google Search grounding.",
			"Supply files[] to inject specific files into context.",
			"Default approval mode is 'yolo' (auto-approve all tool actions).",
		].join(" "),
		promptSnippet:
			"Delegate a task to Gemini — triggers on 'ask gemini', 'check with gemini', 'have gemini look at', 'get gemini to', or requests for cross-model second opinion, large-context analysis, or Google Search grounding",
		promptGuidelines: [
			"Use gemini_proxy when the user says 'ask gemini', 'check with gemini', 'have gemini look at this', 'get gemini to', or any similar phrase that directs a task explicitly to Gemini.",
			"Use gemini_proxy when the user wants a second opinion from Gemini on code, architecture, or security.",
			"Use gemini_proxy with a tailored systemPrompt to give Gemini a specific expert persona.",
			"Use gemini_proxy with approvalMode 'plan' for read-only analysis without any file modifications.",
			"Pass relevant file paths in the files[] parameter so Gemini has precise context without needing to hunt for them.",
		],

		parameters: Type.Object({
			prompt: Type.String({
				description:
					"The task or question for Gemini. Be specific: include file names, what to look for, expected output format.",
			}),
			systemPrompt: Type.Optional(
				Type.String({
					description:
						"Role / instructions prepended to the context. E.g. 'You are a senior security engineer. Identify vulnerabilities and rate their severity.'",
				}),
			),
			model: Type.Optional(
				Type.String({
					description:
						"Gemini model to use. E.g. 'gemini-2.5-pro', 'gemini-2.5-flash'. Defaults to the CLI's configured default.",
				}),
			),
			approvalMode: Type.Optional(
				Type.Union([Type.Literal("yolo"), Type.Literal("auto_edit"), Type.Literal("plan")], {
					description:
						"Tool approval mode. 'yolo' = auto-approve all (default), 'auto_edit' = auto-approve file edits only, 'plan' = read-only (no writes or shell).",
				}),
			),
			files: Type.Optional(
				Type.Array(Type.String(), {
					description:
						"File paths (relative to cwd) whose full contents are injected into Gemini's context before the prompt.",
				}),
			),
			includeDirectories: Type.Optional(
				Type.Array(Type.String(), {
					description:
						"Additional directory paths to include in Gemini's workspace (Gemini can read files from these dirs using its own Read tool).",
				}),
			),
			cwd: Type.Optional(
				Type.String({
					description: "Working directory for the Gemini process. Defaults to pi's current working directory.",
				}),
			),
		}),

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			return execute(geminiPath, params, signal, onUpdate as any, ctx) as any;
		},

		renderCall,
		renderResult,
	});
}
