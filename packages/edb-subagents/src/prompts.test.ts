import { describe, expect, it } from "vitest";
import { buildAgentPrompt } from "./prompts.js";
import type { AgentConfig } from "./types.js";

describe("buildAgentPrompt", () => {
	const baseConfig: AgentConfig = {
		name: "Test Agent",
		description: "Test agent",
		extensions: true,
		skills: true,
		promptMode: "replace",
		systemPrompt: "You are a test agent.",
	};

	const baseEnv = {
		cwd: "/tmp/test",
		platform: "darwin",
		isGitRepo: false,
		branch: "",
	};

	it("includes active_agent tag", () => {
		const result = buildAgentPrompt(baseConfig, baseEnv.cwd, baseEnv);
		expect(result).toContain('<active_agent name="Test Agent"/>');
	});

	it("includes environment info", () => {
		const result = buildAgentPrompt(baseConfig, "/tmp/test", baseEnv);
		expect(result).toContain("Working directory: /tmp/test");
	});

	it("includes platform in replace mode", () => {
		const result = buildAgentPrompt(baseConfig, "/tmp/test", baseEnv);
		expect(result).toContain("Platform: darwin");
	});

	it("includes system prompt in replace mode", () => {
		const result = buildAgentPrompt(baseConfig, "/tmp/test", baseEnv);
		expect(result).toContain("You are a test agent.");
	});

	it("includes git info when in git repo", () => {
		const env = { ...baseEnv, isGitRepo: true, branch: "main" };
		const result = buildAgentPrompt(baseConfig, "/tmp/test", env);
		expect(result).toContain("Git repository: yes");
		expect(result).toContain("Branch: main");
	});

	it("includes parent system prompt in append mode", () => {
		const config: AgentConfig = { ...baseConfig, promptMode: "append" };
		const result = buildAgentPrompt(config, "/tmp/test", baseEnv, "You are the parent.");
		expect(result).toContain("You are the parent.");
	});

	it("includes agent instructions in append mode", () => {
		const config: AgentConfig = { ...baseConfig, promptMode: "append" };
		const result = buildAgentPrompt(config, "/tmp/test", baseEnv);
		expect(result).toContain("<agent_instructions>");
	});

	it("includes memory block when provided", () => {
		const result = buildAgentPrompt(baseConfig, "/tmp/test", baseEnv, undefined, {
			memoryBlock: "# Memory\nPrevious work: done",
		});
		expect(result).toContain("Memory");
		expect(result).toContain("Previous work: done");
	});

	it("includes skill blocks when provided", () => {
		const result = buildAgentPrompt(baseConfig, "/tmp/test", baseEnv, undefined, {
			skillBlocks: [{ name: "TestSkill", content: "Test content" }],
		});
		expect(result).toContain("Preloaded Skill: TestSkill");
		expect(result).toContain("Test content");
	});
});
