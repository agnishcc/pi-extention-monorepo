/**
 * custom-agents.ts — Load user-defined agents from project (.pi/agents/) and global ($PI_CODING_AGENT_DIR/agents/, default ~/.pi/agent/agents/) locations.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { BUILTIN_TOOL_NAMES } from "./agent-types.js";
import type { AgentConfig, MemoryScope, ThinkingLevel } from "./types.js";

/**
 * Scan for custom agent .md files from multiple locations.
 * Discovery hierarchy (higher priority wins):
 *   1. Project: <cwd>/.pi/agents/*.md
 *   2. Global:  $PI_CODING_AGENT_DIR/agents/*.md (default: ~/.pi/agent/agents/*.md)
 *
 * Project-level agents override global ones with the same name.
 * Any name is allowed — names matching defaults (e.g. "Explore") override them.
 */
export function loadCustomAgents(cwd: string): Map<string, AgentConfig> {
	const globalDir = join(getAgentDir(), "agents");
	const projectDir = join(cwd, ".pi", "agents");

	const agents = new Map<string, AgentConfig>();
	loadFromDir(globalDir, agents, "global"); // lower priority
	loadFromDir(projectDir, agents, "project"); // higher priority (overwrites)
	return agents;
}

/** Load agent configs from a directory into the map. */
function loadFromDir(dir: string, agents: Map<string, AgentConfig>, source: "project" | "global"): void {
	if (!existsSync(dir)) return;

	let files: string[];
	try {
		files = readdirSync(dir).filter((f) => f.endsWith(".md"));
	} catch {
		return;
	}

	for (const file of files) {
		const name = basename(file, ".md");

		let content: string;
		try {
			content = readFileSync(join(dir, file), "utf-8");
		} catch {
			continue;
		}

		const { frontmatter: fm, body } = parseFrontmatter<Record<string, unknown>>(content);

		agents.set(name, {
			name,
			displayName: str(fm.display_name),
			description: str(fm.description) ?? name,
			context: str(fm.context),
			builtinToolNames: csvList(fm.tools, BUILTIN_TOOL_NAMES),
			disallowedTools: csvListOptional(fm.disallowed_tools),
			// allowed_tools: whitelist for extension tools (wins over disallowed_tools when both set)
			// extensions: legacy field — string[] format is treated as allowed_tools whitelist
			extensions: parseExtensions(fm.allowed_tools ?? fm.extensions),
			skills: inheritField(fm.skills ?? fm.inherit_skills),
			model: str(fm.model),
			fallbackModels: csvListOptional(fm.fallback_models),
			thinking: str(fm.thinking) as ThinkingLevel | undefined,
			maxTurns: nonNegativeInt(fm.max_turns),
			systemPrompt: body.trim(),
			promptMode: fm.prompt_mode === "append" ? "append" : "replace",
			inheritContext: fm.inherit_context != null ? fm.inherit_context === true : undefined,
			runInBackground: fm.run_in_background != null ? fm.run_in_background === true : undefined,
			isolated: fm.isolated != null ? fm.isolated === true : undefined,
			memory: parseMemory(fm.memory),
			isolation: fm.isolation === "worktree" ? "worktree" : undefined,
			enabled: fm.enabled !== false, // default true; explicitly false disables
			source,
		});
	}
}

// ---- Field parsers ----
// All follow the same convention: omitted → default, "none"/empty → nothing, value → exact.

/** Extract a string or undefined. */
function str(val: unknown): string | undefined {
	return typeof val === "string" ? val : undefined;
}

/** Extract a non-negative integer or undefined. 0 means unlimited for max_turns. */
function nonNegativeInt(val: unknown): number | undefined {
	return typeof val === "number" && val >= 0 ? val : undefined;
}

/**
 * Parse a raw CSV field value into items, or undefined if absent/empty/"none".
 */
function parseCsvField(val: unknown): string[] | undefined {
	if (val === undefined || val === null) return undefined;
	const s = String(val).trim();
	if (!s || s === "none") return undefined;
	const items = s
		.split(",")
		.map((t) => t.trim())
		.filter(Boolean);
	return items.length > 0 ? items : undefined;
}

/**
 * Parse a comma-separated list field with defaults.
 * omitted → defaults; "none"/empty → []; csv → listed items.
 */
function csvList(val: unknown, defaults: string[]): string[] {
	if (val === undefined || val === null) return defaults;
	return parseCsvField(val) ?? [];
}

/**
 * Parse an optional comma-separated list field.
 * omitted → undefined; "none"/empty → undefined; csv → listed items.
 */
function csvListOptional(val: unknown): string[] | undefined {
	return parseCsvField(val);
}

/**
 * Parse a memory scope field.
 * omitted → undefined; "user"/"project"/"local" → MemoryScope.
 */
function parseMemory(val: unknown): MemoryScope | undefined {
	if (val === "user" || val === "project" || val === "local") return val;
	return undefined;
}

/**
 * Parse an inherit field (extensions, skills).
 * omitted/true → true (inherit all); false/"none"/empty → false; csv → listed names.
 */
function inheritField(val: unknown): true | string[] | false {
	if (val === undefined || val === null || val === true) return true;
	if (val === false || val === "none") return false;
	const items = csvList(val, []);
	return items.length > 0 ? items : false;
}

/**
 * Parse the extensions/allowed_tools field.
 * - undefined/null/true → all extension tools (true)
 * - false/"none" → no extension tools (false)
 * - "TaskCreate, ask_supervisor" → whitelist of tool name patterns (string[])
 * - absolute path (legacy executor.md style) → treat as true (path-based extensions
 *   are handled by extractParentExtensionPaths; ignore the path here)
 */
function parseExtensions(val: unknown): true | string[] | false {
	if (val === undefined || val === null || val === true) return true;
	if (val === false || val === "none") return false;
	// Legacy: absolute path string → treat as "all extensions enabled"
	if (typeof val === "string" && (val.startsWith("/") || val.startsWith(".") || val.includes("node_modules"))) {
		return true;
	}
	const items = csvList(val, []);
	return items.length > 0 ? items : true;
}
