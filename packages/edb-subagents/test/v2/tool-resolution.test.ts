import { describe, expect, it } from "vitest";
import { resolveBuiltins, TOOL_PROFILES } from "../../src/v2/runtime/session-factory.js";

describe("resolveBuiltins (additive tool resolution)", () => {
	it("falls back to the full profile when the definition has no tools list", () => {
		expect(resolveBuiltins("researcher")).toEqual(TOOL_PROFILES.researcher);
		expect(resolveBuiltins("coder")).toEqual(TOOL_PROFILES.coder);
		expect(resolveBuiltins("unknown-profile")).toEqual(TOOL_PROFILES.coder);
	});

	it("unions definition tools on top of the profile instead of intersecting", () => {
		// Before: researcher profile ∩ [write] = [] — reductive.
		// After: researcher profile ∪ [write] includes write AND keeps grep/find/ls.
		expect(resolveBuiltins("researcher", ["write"])).toEqual(["read", "grep", "find", "ls", "write"]);
	});

	it("lets a researcher-profile agent add shell and web tools via definition", () => {
		const tools = resolveBuiltins("researcher", ["bash", "read", "write", "web_search", "fetch_content"]);
		expect(tools).toEqual(["read", "grep", "find", "ls", "bash", "write", "web_search", "fetch_content"]);
	});

	it("deduplicates overlapping names (profile ∪ definition)", () => {
		expect(resolveBuiltins("coder", ["read", "bash", "edit"])).toEqual([
			"read",
			"grep",
			"find",
			"ls",
			"edit",
			"write",
			"bash",
		]);
	});

	it("preserves unknown names for extension-provided tools", () => {
		expect(resolveBuiltins("readonly", ["web_search", "fetch_content"])).toEqual([
			"read",
			"grep",
			"find",
			"ls",
			"web_search",
			"fetch_content",
		]);
	});
});
