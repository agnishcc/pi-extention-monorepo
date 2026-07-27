/**
 * agent-runner.ts — Core execution engine: creates sessions, runs agents, collects results.
 */

import { existsSync } from "node:fs";
import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	type AgentSession,
	type AgentSessionEvent,
	createAgentSession,
	DefaultResourceLoader,
	type ExtensionAPI,
	getAgentDir,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
	BUILTIN_TOOL_NAMES,
	getAgentConfig,
	getConfig,
	getMemoryToolNames,
	getReadOnlyMemoryToolNames,
	getToolNamesForType,
} from "./agent-types.js";
import { buildParentContext, extractText } from "./context.js";
import { DEFAULT_AGENTS } from "./default-agents.js";
import { detectEnv } from "./env.js";
import { buildMemoryBlock, buildReadOnlyMemoryBlock } from "./memory.js";
import { buildAgentPrompt, type PromptExtras } from "./prompts.js";
import { preloadSkills } from "./skill-loader.js";
import type { SubagentType, ThinkingLevel } from "./types.js";

/** Names of tools registered by this extension that subagents must NOT inherit. */
const EXCLUDED_TOOL_NAMES = ["Agent", "get_subagent_result", "steer_subagent", "send_to_agent"];

/**
 * Extract parent session extension file paths from the parent's tool registry.
 * These are passed to the sub-agent's DefaultResourceLoader as additionalExtensionPaths,
 * so sub-agents get access to the same extension tools as the parent session
 * (e.g., TaskCreate, TaskUpdate from edb-todo).
 *
 * Excludes:
 * - Built-in / SDK tools (paths inside node_modules)
 * - Synthetic paths (non-existent on disk)
 * - Extensions where ALL registered tools are in the EXCLUDED_TOOL_NAMES list
 *   (i.e., edb-subagents itself — only has Agent, get_subagent_result, steer_subagent)
 */
function extractParentExtensionPaths(pi: ExtensionAPI): string[] {
	const excluded = new Set(EXCLUDED_TOOL_NAMES);
	const pathTools = new Map<string, string[]>();

	for (const tool of pi.getAllTools()) {
		const p = tool.sourceInfo?.path ?? "";
		if (!p) continue;
		if (!pathTools.has(p)) pathTools.set(p, []);
		pathTools.get(p)!.push(tool.name);
	}

	const result: string[] = [];
	for (const [p, toolNames] of pathTools) {
		if (p.includes("node_modules")) continue;
		if (!existsSync(p)) continue;
		if (toolNames.every((name) => excluded.has(name))) continue;
		result.push(p);
	}
	return result;
}

/** Default max turns. undefined = unlimited (no turn limit). */
let defaultMaxTurns: number | undefined;

/** Normalize max turns. undefined or 0 = unlimited, otherwise minimum 1. */
export function normalizeMaxTurns(n: number | undefined): number | undefined {
	if (n == null || n === 0) return undefined;
	return Math.max(1, n);
}

/** Get the default max turns value. undefined = unlimited. */
export function getDefaultMaxTurns(): number | undefined {
	return defaultMaxTurns;
}
/** Set the default max turns value. undefined or 0 = unlimited, otherwise minimum 1. */
export function setDefaultMaxTurns(n: number | undefined): void {
	defaultMaxTurns = normalizeMaxTurns(n);
}

/** Additional turns allowed after the soft limit steer message. */
let graceTurns = 5;

/** Get the grace turns value. */
export function getGraceTurns(): number {
	return graceTurns;
}
/** Set the grace turns value (minimum 1). */
export function setGraceTurns(n: number): void {
	graceTurns = Math.max(1, n);
}

/**
 * Try to find the right model for an agent type.
 * Priority: explicit option > config.model > parent model.
 */
function resolveDefaultModel(
	parentModel: Model<any> | undefined,
	registry: { find(provider: string, modelId: string): Model<any> | undefined; getAvailable?(): Model<any>[] },
	configModel?: string,
): Model<any> | undefined {
	if (configModel) {
		const slashIdx = configModel.indexOf("/");
		if (slashIdx !== -1) {
			const provider = configModel.slice(0, slashIdx);
			const modelId = configModel.slice(slashIdx + 1);

			// Build a set of available model keys for fast lookup
			const available = registry.getAvailable?.();
			const availableKeys = available ? new Set(available.map((m: any) => `${m.provider}/${m.id}`)) : undefined;
			const isAvailable = (p: string, id: string) => !availableKeys || availableKeys.has(`${p}/${id}`);

			const found = registry.find(provider, modelId);
			if (found && isAvailable(provider, modelId)) return found;
		}
	}

	return parentModel;
}

/** Info about a tool event in the subagent. */
export interface ToolActivity {
	type: "start" | "end";
	toolName: string;
}

export interface RunOptions {
	/** ExtensionAPI instance — used for pi.exec() instead of execSync. */
	pi: ExtensionAPI;
	/** Manager-assigned id; suffixes session name to disambiguate parallel spawns (e.g. `Explore#a1b2c3d4`). */
	agentId?: string;
	model?: Model<any>;
	maxTurns?: number;
	signal?: AbortSignal;
	isolated?: boolean;
	inheritContext?: boolean;
	thinkingLevel?: ThinkingLevel;
	/** Override working directory (e.g. for worktree isolation). */
	cwd?: string;
	/**
	 * edb-bridge context: injected into the sub-agent's system prompt so edb-bridge + edb-todo
	 * extensions in the sub-agent session can connect back to the orchestrator.
	 */
	bridgeContext?: {
		parentSessionId: string;
		agentId: string;
		storePath?: string;
		taskId?: string;
		agentIsSubtask?: boolean;
	};
	/** Called on tool start/end with activity info. */
	onToolActivity?: (activity: ToolActivity) => void;
	/** Called on streaming text deltas from the assistant response. */
	onTextDelta?: (delta: string, fullText: string) => void;
	onSessionCreated?: (session: AgentSession) => void;
	/** Called at the end of each agentic turn with the cumulative count. */
	onTurnEnd?: (turnCount: number) => void;
	/**
	 * Called once per assistant message_end with that message's usage delta.
	 * Lets callers maintain a lifetime accumulator that survives compaction
	 * (which replaces session.state.messages and resets stats-derived sums).
	 */
	onAssistantUsage?: (usage: { input: number; output: number; cacheRead: number; cacheWrite: number }) => void;
	/**
	 * Called when the session successfully compacts. `tokensBefore` is upstream's
	 * pre-compaction context size estimate. Aborted compactions don't fire.
	 */
	onCompaction?: (info: { reason: "manual" | "threshold" | "overflow"; tokensBefore: number }) => void;
}

export interface RunResult {
	responseText: string;
	session: AgentSession;
	/** True if the agent was hard-aborted (max_turns + grace exceeded). */
	aborted: boolean;
	/** True if the agent was steered to wrap up (hit soft turn limit) but finished in time. */
	steered: boolean;
}

/**
 * Subscribe to a session and collect the last assistant message text.
 * Returns an object with a `getText()` getter and an `unsubscribe` function.
 */
function collectResponseText(session: AgentSession) {
	let text = "";
	const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
		if (event.type === "message_start") {
			text = "";
		}
		if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
			text += event.assistantMessageEvent.delta;
		}
	});
	return { getText: () => text, unsubscribe };
}

/** Get the last assistant text from the completed session history. */
function getLastAssistantText(session: AgentSession): string {
	for (let i = session.messages.length - 1; i >= 0; i--) {
		const msg = session.messages[i];
		if (msg.role !== "assistant") continue;
		const text = extractText(msg.content).trim();
		if (text) return text;
	}
	return "";
}

/**
 * Wire an AbortSignal to abort a session.
 * Returns a cleanup function to remove the listener.
 */
function forwardAbortSignal(session: AgentSession, signal?: AbortSignal): () => void {
	if (!signal) return () => {};
	const onAbort = () => session.abort();
	signal.addEventListener("abort", onAbort, { once: true });
	return () => signal.removeEventListener("abort", onAbort);
}

export async function runAgent(
	ctx: ExtensionContext,
	type: SubagentType,
	prompt: string,
	options: RunOptions,
): Promise<RunResult> {
	const config = getConfig(type);
	const agentConfig = getAgentConfig(type);

	// Resolve working directory: worktree override > parent cwd
	const effectiveCwd = options.cwd ?? ctx.cwd;

	const env = await detectEnv(options.pi, effectiveCwd);

	// Get parent system prompt for append-mode agents
	const parentSystemPrompt = ctx.getSystemPrompt();

	// Build prompt extras (memory, skill preloading)
	const extras: PromptExtras = {};

	// Inject edb-bridge context if provided (enables ask_supervisor, notify_parent, shared task store)
	if (options.bridgeContext) {
		extras.bridgeContext = options.bridgeContext;
	}

	// Resolve extensions/skills: isolated overrides to false
	const extensions = options.isolated ? false : config.extensions;
	const skills = options.isolated ? false : config.skills;

	// Extract parent session extension paths so sub-agents inherit the same extension
	// tools (e.g. TaskCreate/TaskUpdate from edb-todo). Without this, sub-agents
	// running in a session started with `-ne -e <path>` would have no extension tools
	// because the DefaultResourceLoader doesn't know about the parent's explicit -e paths.
	const parentExtensionPaths = extensions !== false ? extractParentExtensionPaths(options.pi) : [];

	// Skill preloading: when skills is string[], preload their content into prompt
	if (Array.isArray(skills)) {
		const loaded = preloadSkills(skills, effectiveCwd);
		if (loaded.length > 0) {
			extras.skillBlocks = loaded;
		}
	}

	let toolNames = getToolNamesForType(type);

	// Persistent memory: detect write capability and branch accordingly.
	// Account for disallowedTools — a tool in the base set but on the denylist is not truly available.
	if (agentConfig?.memory) {
		const existingNames = new Set(toolNames);
		const denied = agentConfig.disallowedTools ? new Set(agentConfig.disallowedTools) : undefined;
		const effectivelyHas = (name: string) => existingNames.has(name) && !denied?.has(name);
		const hasWriteTools = effectivelyHas("write") || effectivelyHas("edit");

		if (hasWriteTools) {
			// Read-write memory: add any missing memory tool names (read/write/edit)
			const extraNames = getMemoryToolNames(existingNames);
			if (extraNames.length > 0) toolNames = [...toolNames, ...extraNames];
			extras.memoryBlock = buildMemoryBlock(agentConfig.name, agentConfig.memory, effectiveCwd);
		} else {
			// Read-only memory: only add read tool name, use read-only prompt
			const extraNames = getReadOnlyMemoryToolNames(existingNames);
			if (extraNames.length > 0) toolNames = [...toolNames, ...extraNames];
			extras.memoryBlock = buildReadOnlyMemoryBlock(agentConfig.name, agentConfig.memory, effectiveCwd);
		}
	}

	// Build system prompt from agent config
	let systemPrompt: string;
	if (agentConfig) {
		systemPrompt = buildAgentPrompt(agentConfig, effectiveCwd, env, parentSystemPrompt, extras);
	} else {
		// Unknown type fallback: spread the canonical general-purpose config (defensive —
		// unreachable in practice since index.ts resolves unknown types before calling runAgent).
		const fallback = DEFAULT_AGENTS.get("general-purpose");
		if (!fallback) throw new Error(`No fallback config available for unknown type "${type}"`);
		systemPrompt = buildAgentPrompt({ ...fallback, name: type }, effectiveCwd, env, parentSystemPrompt, extras);
	}

	// When skills is string[], we've already preloaded them into the prompt.
	// Still pass noSkills: true since we don't need the skill loader to load them again.
	const noSkills = skills === false || Array.isArray(skills);

	const agentDir = getAgentDir();

	// Load extensions/skills: true or string[] → load; false → don't.
	// Suppress AGENTS.md/CLAUDE.md and APPEND_SYSTEM.md — upstream's
	// buildSystemPrompt() re-appends both AFTER systemPromptOverride, which
	// would defeat prompt_mode: replace and isolated: true. Parent context, if
	// wanted, reaches the subagent via prompt_mode: append (parentSystemPrompt
	// is embedded in systemPromptOverride) or inherit_context (conversation).
	const loader = new DefaultResourceLoader({
		cwd: effectiveCwd,
		agentDir,
		// When we have explicit parent extension paths, suppress standard discovery so
		// sub-agents don't accidentally pick up globally installed extensions the parent
		// didn't opt into (e.g. when parent was started with -ne). Standard discovery
		// is kept when there are no explicit paths (parent has no extensions).
		noExtensions: extensions === false || parentExtensionPaths.length > 0,
		additionalExtensionPaths: parentExtensionPaths,
		noSkills,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		systemPromptOverride: () => systemPrompt,
		appendSystemPromptOverride: () => [],
	});
	await loader.reload();

	// Resolve model: explicit option > config.model > parent model
	const model = options.model ?? resolveDefaultModel(ctx.model, ctx.modelRegistry, agentConfig?.model);

	// Resolve thinking level: explicit option > agent config > undefined (inherit)
	const thinkingLevel = options.thinkingLevel ?? agentConfig?.thinking;

	const sessionOpts: Parameters<typeof createAgentSession>[0] = {
		cwd: effectiveCwd,
		agentDir,
		sessionManager: SessionManager.inMemory(effectiveCwd),
		settingsManager: SettingsManager.create(effectiveCwd, agentDir),
		modelRegistry: ctx.modelRegistry,
		model,
		// Do NOT pass tools: [...] or noTools here. Passing tools: toolNames creates a
		// hard allowedToolNames restriction that permanently blocks extension tools from
		// the registry even after bindExtensions() registers them (setActiveToolsByName
		// silently ignores names not in the registry). Using noTools: "all" empties the
		// registry entirely. Instead, let the session use its default (full registry:
		// all built-ins + all extension tools from the loader), then restrict via
		// setActiveToolsByName after bindExtensions().
		resourceLoader: loader,
	};
	if (thinkingLevel) {
		sessionOpts.thinkingLevel = thinkingLevel;
	}

	const { session } = await createAgentSession(sessionOpts);

	const baseSessionName = agentConfig?.name ?? type;
	session.setSessionName(options.agentId ? `${baseSessionName}#${options.agentId.slice(0, 8)}` : baseSessionName);

	// Bind extensions FIRST so that extension tools (e.g. TaskCreate from edb-todo)
	// are registered before we query the active tool set. This ensures extension
	// tools are available for filtering (vs. being invisible at query time).
	await session.bindExtensions({
		onError: (err) => {
			options.onToolActivity?.({
				type: "end",
				toolName: `extension-error:${err.extensionPath}`,
			});
		},
	});

	// Build disallowed tools set from agent config
	const disallowedSet = agentConfig?.disallowedTools ? new Set(agentConfig.disallowedTools) : undefined;

	// Filter active tools: remove our own tools to prevent nesting,
	// apply extension allowlist if specified, and apply disallowedTools denylist.
	//
	// SOURCE: Use extensionRunner.getAllRegisteredTools() for extension tools — this
	// bypasses any session-level allowlist restriction and gives us ALL tools registered
	// by extensions. Combined with BUILTIN_TOOL_NAMES we get a complete picture.
	//
	// createAgentSession is called without tools/noTools so the session uses its default
	// (full registry, all built-ins + extension tools from the loader, no allowlist).
	// setActiveToolsByName then restricts to exactly what this agent type should have.
	//
	// Built-in tools (bash, read, edit, write, grep, find, ls) are gated by the
	// per-agent builtinToolNames config. Extension tools (TaskCreate, ask_supervisor…)
	// are gated by the extensions config (true = all, string[] = allowlist, false = none).
	if (extensions !== false) {
		const builtinToolNameSet = new Set(toolNames);
		const allBuiltins = new Set(BUILTIN_TOOL_NAMES);
		// Get all extension tools from the extension runner (not filtered by any allowlist)
		const registeredExtensionToolNames = session.extensionRunner
			.getAllRegisteredTools()
			.map((t) => t.definition.name);
		// Combine: built-in tools + all registered extension tools
		const allKnown = [...new Set([...BUILTIN_TOOL_NAMES, ...registeredExtensionToolNames])];
		const activeTools = allKnown.filter((t) => {
			if (EXCLUDED_TOOL_NAMES.includes(t)) return false;
			// Built-in tools: respect the per-agent builtinToolNames allowlist
			if (allBuiltins.has(t)) return builtinToolNameSet.has(t);
			// Extension tools: whitelist (allowed_tools) wins over blacklist (disallowed_tools)
			if (Array.isArray(extensions)) {
				// Whitelist mode — disallowedTools is ignored
				return extensions.some((ext) => t.startsWith(ext) || t.includes(ext));
			}
			// Blacklist mode — exclude disallowed tools
			if (disallowedSet?.has(t)) return false;
			return true; // extensions === true → include all extension tools
		});
		session.setActiveToolsByName(activeTools);
	} else if (disallowedSet) {
		// Even with extensions disabled, apply denylist to built-in tools
		const activeTools = session.getActiveToolNames().filter((t) => !disallowedSet.has(t));
		session.setActiveToolsByName(activeTools);
	}

	options.onSessionCreated?.(session);

	// Track turns for graceful max_turns enforcement
	let turnCount = 0;
	const maxTurns = normalizeMaxTurns(options.maxTurns ?? agentConfig?.maxTurns ?? defaultMaxTurns);
	let softLimitReached = false;
	let aborted = false;

	let currentMessageText = "";
	const unsubTurns = session.subscribe((event: AgentSessionEvent) => {
		if (event.type === "turn_end") {
			turnCount++;
			options.onTurnEnd?.(turnCount);
			if (maxTurns != null) {
				if (!softLimitReached && turnCount >= maxTurns) {
					softLimitReached = true;
					session.steer("You have reached your turn limit. Wrap up immediately — provide your final answer now.");
				} else if (softLimitReached && turnCount >= maxTurns + graceTurns) {
					aborted = true;
					session.abort();
				}
			}
		}
		if (event.type === "message_start") {
			currentMessageText = "";
		}
		if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
			currentMessageText += event.assistantMessageEvent.delta;
			options.onTextDelta?.(event.assistantMessageEvent.delta, currentMessageText);
		}
		if (event.type === "tool_execution_start") {
			options.onToolActivity?.({ type: "start", toolName: event.toolName });
		}
		if (event.type === "tool_execution_end") {
			options.onToolActivity?.({ type: "end", toolName: event.toolName });
		}
		if (event.type === "message_end" && event.message.role === "assistant") {
			const u = (event.message as any).usage;
			if (u)
				options.onAssistantUsage?.({
					input: u.input ?? 0,
					output: u.output ?? 0,
					cacheRead: u.cacheRead ?? 0,
					cacheWrite: u.cacheWrite ?? 0,
				});
		}
		if (event.type === "compaction_end" && !event.aborted && event.result) {
			options.onCompaction?.({ reason: event.reason, tokensBefore: event.result.tokensBefore });
		}
	});

	const collector = collectResponseText(session);
	const cleanupAbort = forwardAbortSignal(session, options.signal);

	// Build the effective prompt: optionally prepend parent context
	let effectivePrompt = prompt;
	if (options.inheritContext) {
		const parentContext = buildParentContext(ctx);
		if (parentContext) {
			effectivePrompt = parentContext + prompt;
		}
	}

	try {
		await session.prompt(effectivePrompt);
	} finally {
		unsubTurns();
		collector.unsubscribe();
		cleanupAbort();
	}

	const responseText = collector.getText().trim() || getLastAssistantText(session);
	return { responseText, session, aborted, steered: softLimitReached };
}

/**
 * Send a new prompt to an existing session (resume).
 */
export async function resumeAgent(
	session: AgentSession,
	prompt: string,
	options: {
		onToolActivity?: (activity: ToolActivity) => void;
		onAssistantUsage?: (usage: { input: number; output: number; cacheRead: number; cacheWrite: number }) => void;
		onCompaction?: (info: { reason: "manual" | "threshold" | "overflow"; tokensBefore: number }) => void;
		signal?: AbortSignal;
	} = {},
): Promise<string> {
	const collector = collectResponseText(session);
	const cleanupAbort = forwardAbortSignal(session, options.signal);

	const unsubEvents =
		options.onToolActivity || options.onAssistantUsage || options.onCompaction
			? session.subscribe((event: AgentSessionEvent) => {
					if (event.type === "tool_execution_start")
						options.onToolActivity?.({ type: "start", toolName: event.toolName });
					if (event.type === "tool_execution_end")
						options.onToolActivity?.({ type: "end", toolName: event.toolName });
					if (event.type === "message_end" && event.message.role === "assistant") {
						const u = (event.message as any).usage;
						if (u)
							options.onAssistantUsage?.({
								input: u.input ?? 0,
								output: u.output ?? 0,
								cacheRead: u.cacheRead ?? 0,
								cacheWrite: u.cacheWrite ?? 0,
							});
					}
					if (event.type === "compaction_end" && !event.aborted && event.result) {
						options.onCompaction?.({ reason: event.reason, tokensBefore: event.result.tokensBefore });
					}
				})
			: () => {};

	try {
		await session.prompt(prompt);
	} finally {
		collector.unsubscribe();
		unsubEvents();
		cleanupAbort();
	}

	return collector.getText().trim() || getLastAssistantText(session);
}

/**
 * Send a steering message to a running subagent.
 * The message will interrupt the agent after its current tool execution.
 */
export async function steerAgent(session: AgentSession, message: string): Promise<void> {
	await session.steer(message);
}

/**
 * Get the subagent's conversation messages as formatted text.
 */
export function getAgentConversation(session: AgentSession): string {
	const parts: string[] = [];

	for (const msg of session.messages) {
		if (msg.role === "user") {
			const text = typeof msg.content === "string" ? msg.content : extractText(msg.content);
			if (text.trim()) parts.push(`[User]: ${text.trim()}`);
		} else if (msg.role === "assistant") {
			const textParts: string[] = [];
			const toolCalls: string[] = [];
			for (const c of msg.content) {
				if (c.type === "text" && c.text) textParts.push(c.text);
				else if (c.type === "toolCall")
					toolCalls.push(`  Tool: ${(c as any).name ?? (c as any).toolName ?? "unknown"}`);
			}
			if (textParts.length > 0) parts.push(`[Assistant]: ${textParts.join("\n")}`);
			if (toolCalls.length > 0) parts.push(`[Tool Calls]:\n${toolCalls.join("\n")}`);
		} else if (msg.role === "toolResult") {
			const text = extractText(msg.content);
			const truncated = text.length > 200 ? `${text.slice(0, 200)}...` : text;
			parts.push(`[Tool Result (${msg.toolName})]: ${truncated}`);
		}
	}

	return parts.join("\n\n");
}
