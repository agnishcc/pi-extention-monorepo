import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";

export interface V2AgentDefinition {
	description?: string;
	context?: string;
	prompt?: string;
	tools?: string[];
	extensions?: string[];
	model?: string;
	thinking?: string;
	maxTurns?: number;
}

function readDefinition(path: string): V2AgentDefinition | undefined {
	if (!existsSync(path)) return undefined;
	try {
		const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(readFileSync(path, "utf8"));
		const tools =
			typeof frontmatter.tools === "string" ? frontmatter.tools.split(",").map((tool) => tool.trim()) : undefined;
		const extensions =
			typeof frontmatter.extensions === "string"
				? frontmatter.extensions
						.split(",")
						.map((extension) => extension.trim())
						.filter((extension) => extension.length > 0)
				: undefined;
		return {
			description: typeof frontmatter.description === "string" ? frontmatter.description : undefined,
			context: typeof frontmatter.context === "string" ? frontmatter.context : undefined,
			prompt: body.trim(),
			tools,
			extensions,
			model: typeof frontmatter.model === "string" ? frontmatter.model : undefined,
			thinking: typeof frontmatter.thinking === "string" ? frontmatter.thinking : undefined,
			maxTurns: typeof frontmatter.max_turns === "number" ? frontmatter.max_turns : undefined,
		};
	} catch {
		return undefined;
	}
}

function loadDirectory(directory: string, definitions: Map<string, V2AgentDefinition>): void {
	if (!existsSync(directory)) return;
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if ((!entry.isFile() && !entry.isSymbolicLink()) || !entry.name.endsWith(".md")) continue;
		const definition = readDefinition(join(directory, entry.name));
		if (definition) definitions.set(basename(entry.name, ".md"), definition);
	}
}

export function loadV2AgentDefinitions(
	cwd: string,
	trustedProject: boolean,
	agentDir = getAgentDir(),
): Map<string, V2AgentDefinition> {
	const definitions = new Map<string, V2AgentDefinition>();
	loadDirectory(join(agentDir, "agents"), definitions);
	if (trustedProject) loadDirectory(join(cwd, CONFIG_DIR_NAME, "agents"), definitions);
	return definitions;
}

function oneLine(value: string): string {
	return value
		.replace(/[\r\n]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/** Format only user-defined specialized agents for the parent Agent tool description. */
export function formatSpecializedAgentList(definitions: ReadonlyMap<string, V2AgentDefinition>): string {
	if (definitions.size === 0) return "Available specialized agents:\n(none configured)";

	const lines = ["Available specialized agents:"];
	for (const [name, definition] of [...definitions.entries()].sort(([left], [right]) => left.localeCompare(right))) {
		lines.push(`- ${name}: ${oneLine(definition.description ?? "Specialized agent")}`);
		if (definition.context?.trim()) lines.push(`  When to use: ${oneLine(definition.context)}`);
	}
	return lines.join("\n");
}
