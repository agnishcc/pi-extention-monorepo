import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai/compat";
import {
	createAgentSession,
	createExtensionRuntime,
	getAgentDir,
	ModelRuntime,
	type ResourceLoader,
	SessionManager,
	SettingsManager,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { buildChildSystemPrompt } from "../prompts/child-system-prompt.js";
import type { AgentRecord, RunControl } from "../types.js";

export const TOOL_PROFILES: Record<string, string[]> = {
	readonly: ["read", "grep", "find", "ls"],
	researcher: ["read", "grep", "find", "ls"],
	coder: ["read", "grep", "find", "ls", "edit", "write", "bash"],
	tester: ["read", "grep", "find", "ls", "edit", "write", "bash"],
};

function emptyResourceLoader(systemPrompt: string): ResourceLoader {
	return {
		getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
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
		const profileBuiltins = TOOL_PROFILES[agent.toolProfile] ?? TOOL_PROFILES.coder!;
		const builtins = definition?.tools?.length
			? profileBuiltins.filter((tool) => definition.tools!.includes(tool))
			: profileBuiltins;
		const customNames = tools.map((tool) => tool.name);
		const systemPrompt = buildChildSystemPrompt({
			agentId: agent.id,
			parentAgentId: agent.parentAgentId ?? "root",
			type: agent.type,
			description: agent.description,
			basePrompt: definition?.prompt,
		});
		return createAgentSession({
			cwd: agent.cwd,
			agentDir: getAgentDir(),
			model,
			modelRuntime,
			thinkingLevel: (agent.thinking ?? definition?.thinking) as any,
			resourceLoader: emptyResourceLoader(systemPrompt),
			sessionManager,
			settingsManager: SettingsManager.inMemory({ compaction: { enabled: true }, retry: { enabled: false } }),
			tools: [...builtins, ...customNames],
			customTools: tools,
		});
	}
}
