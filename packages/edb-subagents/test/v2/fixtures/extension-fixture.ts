import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/**
 * Minimal extension fixture used by extension-loading.test.ts.
 * Registers two tools: one that a researcher definition would list in its
 * `tools:` allowlist (web_search) and one it would not (fixture_hidden_tool),
 * to demonstrate that loading grants both but the session allowlist gates
 * exposure to the model.
 */
export default function extensionFixture(api: { registerTool(tool: unknown): void }): void {
	api.registerTool(
		defineTool({
			name: "web_search",
			label: "Web search",
			description: "Fixture web search tool",
			parameters: Type.Object({ query: Type.String() }),
			async execute() {
				return { content: [{ type: "text", text: "ok" }], details: {} };
			},
		}),
	);
	api.registerTool(
		defineTool({
			name: "fixture_hidden_tool",
			label: "Fixture hidden tool",
			description: "Tool that must stay gated by the allowlist",
			parameters: Type.Object({}),
			async execute() {
				return { content: [{ type: "text", text: "ok" }], details: {} };
			},
		}),
	);
}
