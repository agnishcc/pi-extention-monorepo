/**
 * pi-claude-proxy
 *
 * Registers a `claude_proxy` tool that lets the pi agent delegate tasks
 * to Claude Code CLI running in non-interactive (--print) mode.
 *
 * Typical uses: code review, security audit, diff analysis, documentation,
 * second-opinion reasoning.
 *
 * Requires: `claude` CLI on PATH (Claude Code ≥ 2.x)
 * Optional: set CLAUDE_PATH env var to point to a specific claude binary.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { findClaudeCli } from "./cli";
import { execute } from "./execute";
import { renderCall, renderResult } from "./render";

// ── Extension ──────────────────────────────────────────────────────────────────

export default function claudeProxyExtension(pi: ExtensionAPI): void {
	const claudePath = findClaudeCli();

	pi.registerTool({
		name: "claude_proxy",
		label: "Claude Proxy",
		description: [
			"Delegate a task to Claude Code CLI running in non-interactive mode.",
			"Best for: code review, security audit, diff analysis, documentation, architectural second opinion.",
			"Claude can explore the codebase autonomously via its Read tool (default).",
			"Supply files[] to inject specific files directly into context.",
		].join(" "),
		promptSnippet:
			"Delegate a task to Claude Code — triggers on 'ask claude', 'check with claude', 'have claude look at', 'get claude to', or requests for code review, security audit, second opinion",
		promptGuidelines: [
			"Use claude_proxy when the user says 'ask claude', 'check with claude', 'have claude look at this', 'get claude to', 'claude should', or any similar phrase that directs a task explicitly to Claude.",
			"Use claude_proxy when the user asks for a code review, security review, architectural review, or wants a Claude second-opinion on a piece of code.",
			"Use claude_proxy with a tailored systemPrompt to give Claude a specific expert persona (e.g. 'You are a senior security engineer').",
			"Pass relevant file paths in the files[] parameter so Claude has precise context without needing to hunt for them.",
		],

		parameters: Type.Object({
			prompt: Type.String({
				description:
					"The task or question for Claude. Be specific: include file names, what to look for, expected output format.",
			}),
			systemPrompt: Type.Optional(
				Type.String({
					description:
						"Expert persona / role for Claude. E.g. 'You are a senior security engineer specialising in Node.js. Identify vulnerabilities and rate their severity.'",
				}),
			),
			model: Type.Optional(
				Type.String({
					description:
						"Claude model alias: 'sonnet' (default), 'opus' (best reasoning), 'haiku' (fast/cheap). Or a full model name.",
				}),
			),
			allowedTools: Type.Optional(
				Type.Array(Type.String(), {
					description:
						'Tools Claude may use during its response. Defaults to ["Read"] for safe read-only exploration. Pass [] to disable all tools.',
				}),
			),
			files: Type.Optional(
				Type.Array(Type.String(), {
					description:
						"File paths (relative to cwd) whose full contents are injected into Claude's context before the prompt.",
				}),
			),
			cwd: Type.Optional(
				Type.String({
					description: "Working directory for the Claude process. Defaults to pi's current working directory.",
				}),
			),
		}),

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			return execute(claudePath, params, signal, onUpdate as any, ctx) as any;
		},

		renderCall,
		renderResult,
	});
}
