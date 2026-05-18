import { beforeEach, describe, expect, it } from "vitest";
import { getAgentConfig, getAvailableTypes, getToolNamesForType, registerAgents, resolveType } from "./agent-types.js";
import type { AgentConfig } from "./types.js";

describe("agent-types registry", () => {
	beforeEach(() => {
		// Reset registry by re-registering empty map
		registerAgents(new Map());
	});

	it("registerAgents adds types to registry", () => {
		const config: AgentConfig = {
			name: "test",
			description: "Test agent",
			model: "test/model",
			extensions: true,
			skills: true,
			promptMode: "append",
			systemPrompt: "Test",
		};
		registerAgents(new Map([["test", config]]));
		expect(getAvailableTypes()).toContain("test");
	});

	it("resolveType returns config for registered type", () => {
		const config: AgentConfig = {
			name: "coder",
			description: "Coder agent",
			model: "test/model",
			extensions: true,
			skills: true,
			promptMode: "append",
			systemPrompt: "You are a coder",
		};
		registerAgents(new Map([["coder", config]]));
		const resolved = resolveType("coder");
		expect(resolved).toBe("coder");
	});

	it("resolveType is case-insensitive", () => {
		const config: AgentConfig = {
			name: "Coder",
			description: "Coder",
			model: "m",
			extensions: true,
			skills: true,
			promptMode: "append",
			systemPrompt: "Test",
		};
		registerAgents(new Map([["Coder", config]]));
		expect(resolveType("CODER")).toBe("Coder");
		expect(resolveType("coder")).toBe("Coder");
	});

	it("resolveType returns undefined for unknown type", () => {
		registerAgents(new Map());
		expect(resolveType("nonexistent")).toBeUndefined();
	});

	it("getAgentConfig returns config for registered type", () => {
		const config: AgentConfig = {
			name: "reviewer",
			description: "Reviewer",
			model: "test/model",
			extensions: true,
			skills: true,
			promptMode: "append",
			systemPrompt: "You are a reviewer",
		};
		registerAgents(new Map([["reviewer", config]]));
		const result = getAgentConfig("reviewer");
		expect(result?.name).toBe("reviewer");
	});

	it("getAgentConfig returns undefined for unknown type", () => {
		registerAgents(new Map());
		expect(getAgentConfig("nonexistent")).toBeUndefined();
	});

	it("getAvailableTypes excludes disabled agents", () => {
		const config: AgentConfig = {
			name: "disabled",
			description: "Disabled",
			model: "test/model",
			enabled: false,
			extensions: true,
			skills: true,
			promptMode: "append",
			systemPrompt: "Disabled",
		};
		registerAgents(new Map([["disabled", config]]));
		expect(getAvailableTypes()).not.toContain("disabled");
	});

	it("getToolNamesForType returns tools for registered type", () => {
		const config: AgentConfig = {
			name: "coder",
			description: "Coder",
			model: "m",
			builtinToolNames: ["read", "write", "bash"],
			extensions: true,
			skills: true,
			promptMode: "append",
			systemPrompt: "Test",
		};
		registerAgents(new Map([["coder", config]]));
		const tools = getToolNamesForType("coder");
		expect(tools).toContain("read");
		expect(tools).toContain("write");
	});

	it("getToolNamesForType returns default tools when not specified", () => {
		const config: AgentConfig = {
			name: "custom",
			description: "Custom",
			model: "m",
			extensions: true,
			skills: true,
			promptMode: "append",
			systemPrompt: "Test",
		};
		registerAgents(new Map([["custom", config]]));
		const tools = getToolNamesForType("custom");
		expect(tools).toContain("read");
	});
});
