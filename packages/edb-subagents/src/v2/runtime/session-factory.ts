import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai/compat";
import {
	createAgentSession,
	createExtensionRuntime,
	discoverAndLoadExtensions,
	getAgentDir,
	type LoadExtensionsResult,
	ModelRuntime,
	type ResourceLoader,
	SessionManager,
	SettingsManager,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { buildChildSystemPrompt } from "../prompts/child-system-prompt.js";
import type { AgentRecord, RunControl } from "../types.js";
import { resolveExtensionPaths } from "./extension-resolver.js";

export const TOOL_PROFILES: Record<string, string[]> = {
	readonly: ["read", "grep", "find", "ls"],
	researcher: ["read", "grep", "find", "ls"],
	coder: ["read", "grep", "find", "ls", "edit", "write", "bash"],
	tester: ["read", "grep", "find", "ls", "edit", "write", "bash"],
};

/**
 * Resolve the builtin tool names for an agent.
 *
 * Additive semantics: the definition's `tools:` list extends the profile
 * allowlist (profile ∪ definition) instead of intersecting it. A definition
 * without `tools:` falls back to the profile alone. Unknown names are passed
 * through untouched — the session layer ignores names that do not resolve to
 * a registered tool, so extension-provided tools (e.g. web_search) surface
 * once the child loads the matching extension.
 */
export function resolveBuiltins(toolProfile: string, definitionTools?: string[]): string[] {
	const profileBuiltins = TOOL_PROFILES[toolProfile] ?? TOOL_PROFILES.coder!;
	if (!definitionTools?.length) return [...profileBuiltins];
	return [...new Set([...profileBuiltins, ...definitionTools])];
}

function emptyExtensionsResult(): LoadExtensionsResult {
	return { extensions: [], errors: [], runtime: createExtensionRuntime() };
}

/**
 * Build a child resource loader. When an extensions result is provided the
 * child exposes exactly those extensions; otherwise it gets none (isolation:
 * children never inherit the parent session's extensions).
 */
export function buildChildResourceLoader(
	systemPrompt: string,
	extensionsResult?: LoadExtensionsResult,
): ResourceLoader {
	return {
		getExtensions: () => extensionsResult ?? emptyExtensionsResult(),
		getSkills: () => ({ skills: [], diagnostics: [] }),
		getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => systemPrompt,
		getAppendSystemPrompt: () => [],
		getSystemPromptSource: () => undefined,
		getAppendSystemPromptSources: () => [],
		extendResources: () => {},
		reload: async () => {},
	};
}

export interface SessionFactoryOptions {
	sessionsDirectory: string;
	rootModel?: Model<any>;
	modelRegistry: {
		getRegisteredProviderIds(): readonly string[];
		getRegisteredNativeProvider(id: string): any;
		getRegisteredProviderConfig(id: string): any;
	};
	createTools(agent: AgentRecord, control: RunControl, abort: () => void): ToolDefinition[];
	resolveDefinition?(agent: AgentRecord):
		| {
				prompt?: string;
				tools?: string[];
				extensions?: string[];
				model?: string;
				thinking?: string;
				maxTurns?: number;
		  }
		| undefined;
}

export class SessionFactory {
	private modelRuntime: ModelRuntime | undefined;

	constructor(private readonly options: SessionFactoryOptions) {}

	private async getModelRuntime(): Promise<ModelRuntime> {
		if (this.modelRuntime) return this.modelRuntime;
		const agentDir = getAgentDir();
		const runtime = await ModelRuntime.create({
			authPath: join(agentDir, "auth.json"),
			modelsPath: join(agentDir, "models.json"),
		});
		for (const providerId of this.options.modelRegistry.getRegisteredProviderIds()) {
			const native = this.options.modelRegistry.getRegisteredNativeProvider(providerId);
			if (native) runtime.registerNativeProvider(native);
			else {
				const config = this.options.modelRegistry.getRegisteredProviderConfig(providerId);
				if (config) runtime.registerProvider(providerId, config);
			}
		}
		this.modelRuntime = runtime;
		return runtime;
	}

	async create(agent: AgentRecord, control: RunControl, abort: () => void) {
		await mkdir(this.options.sessionsDirectory, { recursive: true });
		const modelRuntime = await this.getModelRuntime();
		const definition = this.options.resolveDefinition?.(agent);
		agent.maxTurns ??= definition?.maxTurns;
		const configuredModel = agent.model ?? definition?.model;
		let model = this.options.rootModel;
		if (configuredModel?.includes("/")) {
			const [provider, ...parts] = configuredModel.split("/");
			model = modelRuntime.getModel(provider!, parts.join("/")) ?? model;
		}
		const sessionManager = agent.sessionFile
			? SessionManager.open(agent.sessionFile, this.options.sessionsDirectory, agent.cwd)
			: SessionManager.create(agent.cwd, this.options.sessionsDirectory);
		const tools = this.options.createTools(agent, control, abort);
		const builtins = resolveBuiltins(agent.toolProfile, definition?.tools);
		const customNames = tools.map((tool) => tool.name);
		const systemPrompt = buildChildSystemPrompt({
			agentId: agent.id,
			parentAgentId: agent.parentAgentId ?? "root",
			type: agent.type,
			description: agent.description,
			basePrompt: definition?.prompt,
		});
		// Resolve the definition's `extensions:` frontmatter against pi's
		// extension system (paths as-is, names via the package manager), then
		// load only those. The agentDir argument points at a path that never
		// exists so global (~/.pi/agent/extensions) discovery is disabled; a
		// project's own .pi/extensions may still be discovered, but their tools
		// stay inactive unless listed in the definition's `tools:` allowlist.
		let extensionsResult: LoadExtensionsResult | undefined;
		if (definition?.extensions?.length) {
			const { paths, unresolved } = await resolveExtensionPaths(definition.extensions, agent.cwd, getAgentDir());
			for (const name of unresolved) {
				console.error(
					`[edb-subagents-v2] Could not resolve extension "${name}" for agent ${agent.id} (${agent.type}): not installed via pi and not found in extension directories`,
				);
			}
			if (paths.length) {
				extensionsResult = await discoverAndLoadExtensions(
					paths,
					agent.cwd,
					join(agent.cwd, ".pi", ".no-global-extensions"),
				);
				for (const error of extensionsResult.errors) {
					console.error(
						`[edb-subagents-v2] Failed to load extension for agent ${agent.id} (${agent.type}): ${error.path}: ${error.error}`,
					);
				}
			}
		}
		return createAgentSession({
			cwd: agent.cwd,
			agentDir: getAgentDir(),
			model,
			modelRuntime,
			thinkingLevel: (agent.thinking ?? definition?.thinking) as any,
			resourceLoader: buildChildResourceLoader(systemPrompt, extensionsResult),
			sessionManager,
			settingsManager: SettingsManager.inMemory({ compaction: { enabled: true }, retry: { enabled: false } }),
			tools: [...builtins, ...customNames],
			customTools: tools,
		});
	}
}
