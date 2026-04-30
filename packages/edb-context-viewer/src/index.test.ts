import type { SessionContext } from "@mariozechner/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { buildTotalContextText, formatMessageForDisplay } from "./index";

const context = {
	messages: [
		{
			role: "user",
			content: [
				{ type: "text", text: "Inspect this" },
				{ type: "image", data: "abc", mimeType: "image/png" },
			],
			timestamp: 1,
		},
		{
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "Need context" },
				{ type: "text", text: "I will inspect it." },
				{ type: "toolCall", id: "tool-1", name: "read", arguments: { path: "AGENT.md" } },
			],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "claude-sonnet-4",
			usage: {
				input: 10,
				output: 5,
				cacheRead: 2,
				cacheWrite: 1,
				totalTokens: 18,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "toolUse",
			timestamp: 2,
		},
		{
			role: "toolResult",
			toolCallId: "tool-1",
			toolName: "read",
			content: [{ type: "text", text: "file contents" }],
			isError: false,
			timestamp: 3,
		},
	],
	thinkingLevel: "off",
	model: { provider: "anthropic", modelId: "claude-sonnet-4" },
} satisfies SessionContext;

describe("context viewer formatting", () => {
	it("formats Pi assistant tool calls and usage fields", () => {
		const lines = formatMessageForDisplay(context.messages[1]!, 1);

		expect(lines).toContain("Model: anthropic/claude-sonnet-4");
		expect(lines).toContain("Tokens: input: 10, output: 5, cache-read: 2, cache-write: 1, total: 18");
		expect(lines).toContain("[Thinking: Need context]");
		expect(lines).toContain('[Tool Call: read({"path":"AGENT.md"})]');
	});

	it("formats tool result messages as top-level messages", () => {
		const lines = formatMessageForDisplay(context.messages[2]!, 2);

		expect(lines).toContain("Role: toolResult");
		expect(lines).toContain("Tool: read");
		expect(lines).toContain("Tool Call ID: tool-1");
		expect(lines).toContain("Error: no");
		expect(lines).toContain("file contents");
	});

	it("builds complete context text with usage and model metadata", () => {
		const text = buildTotalContextText(
			"system prompt",
			context,
			{ tokens: 1000, contextWindow: 2000, percent: 50 },
			{ provider: "anthropic", id: "claude-sonnet-4", contextWindow: 2000 },
		);

		expect(text).toContain("SYSTEM PROMPT");
		expect(text).toContain("system prompt");
		expect(text).toContain("MESSAGES");
		expect(text).toContain("[Image: image/png]");
		expect(text).toContain("CONTEXT USAGE");
		expect(text).toContain("Context Window: 1,000 / 2,000 (50.0%)");
	});
});
