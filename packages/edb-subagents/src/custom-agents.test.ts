import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadCustomAgents } from "./custom-agents.js";

describe("loadCustomAgents", () => {
	let cwd: string | undefined;

	afterEach(() => {
		if (cwd) rmSync(cwd, { recursive: true, force: true });
		cwd = undefined;
	});

	it("loads context frontmatter for orchestrator guidance", () => {
		cwd = mkdtempSync(join(tmpdir(), "edb-subagents-"));
		const agentsDir = join(cwd, ".pi", "agents");
		mkdirSync(agentsDir, { recursive: true });
		writeFileSync(
			join(agentsDir, "reviewer.md"),
			`---
description: Security reviewer
context: Use when a change touches authentication, authorization, secrets, or external inputs.
tools: read, grep, find, bash
---

You review security-sensitive code.
`,
			"utf-8",
		);

		const agents = loadCustomAgents(cwd);

		expect(agents.get("reviewer")?.context).toBe(
			"Use when a change touches authentication, authorization, secrets, or external inputs.",
		);
	});
});
