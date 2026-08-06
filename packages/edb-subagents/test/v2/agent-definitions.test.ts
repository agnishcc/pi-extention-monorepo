import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadV2AgentDefinitions } from "../../src/v2/runtime/agent-definitions.js";

const directories: string[] = [];

afterEach(async () => {
	await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("V2 agent definitions", () => {
	it("loads arbitrary global agents and gates project overrides on trust", async () => {
		const directory = await mkdtemp(join(tmpdir(), "edb-agent-definitions-"));
		directories.push(directory);
		const agentDirectory = join(directory, "agent-home");
		const projectDirectory = join(directory, "project");
		await mkdir(join(agentDirectory, "agents"), { recursive: true });
		await mkdir(join(projectDirectory, ".pi", "agents"), { recursive: true });
		await writeFile(
			join(agentDirectory, "agents", "security.md"),
			"---\ntools: read, grep\nmax_turns: 8\n---\nGlobal security prompt",
		);
		await writeFile(
			join(projectDirectory, ".pi", "agents", "security.md"),
			"---\ntools: read, bash\n---\nProject security prompt",
		);

		const untrusted = loadV2AgentDefinitions(projectDirectory, false, agentDirectory);
		expect(untrusted.get("security")).toEqual(
			expect.objectContaining({ prompt: "Global security prompt", tools: ["read", "grep"], maxTurns: 8 }),
		);

		const trusted = loadV2AgentDefinitions(projectDirectory, true, agentDirectory);
		expect(trusted.get("security")).toEqual(
			expect.objectContaining({ prompt: "Project security prompt", tools: ["read", "bash"] }),
		);
	});

	it("parses the extensions frontmatter as a trimmed, non-empty list", async () => {
		const directory = await mkdtemp(join(tmpdir(), "edb-agent-extensions-"));
		directories.push(directory);
		const agentDirectory = join(directory, "agent-home");
		await mkdir(join(agentDirectory, "agents"), { recursive: true });
		await writeFile(
			join(agentDirectory, "agents", "web.md"),
			"---\ntools: web_search, read\nextensions: /tmp/pi-web-access/index.ts,  , /tmp/pi-intercom/index.ts\n---\nWeb prompt",
		);

		const definitions = loadV2AgentDefinitions(directory, false, agentDirectory);
		expect(definitions.get("web")).toEqual(
			expect.objectContaining({
				prompt: "Web prompt",
				tools: ["web_search", "read"],
				extensions: ["/tmp/pi-web-access/index.ts", "/tmp/pi-intercom/index.ts"],
			}),
		);
	});

	it("treats non-string extensions values (e.g. `extensions: true`) as undefined", async () => {
		const directory = await mkdtemp(join(tmpdir(), "edb-agent-extensions-true-"));
		directories.push(directory);
		const agentDirectory = join(directory, "agent-home");
		await mkdir(join(agentDirectory, "agents"), { recursive: true });
		await writeFile(
			join(agentDirectory, "agents", "explorer.md"),
			"---\ntools: bash, read, write\nextensions: true\n---\nExplore prompt",
		);

		const definitions = loadV2AgentDefinitions(directory, false, agentDirectory);
		expect(definitions.get("explorer")).toEqual(
			expect.objectContaining({ prompt: "Explore prompt", tools: ["bash", "read", "write"], extensions: undefined }),
		);
	});
});
