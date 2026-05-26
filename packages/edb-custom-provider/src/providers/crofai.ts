/**
 * CrofAI Provider for pi
 *
 * API: OpenAI-compatible Chat Completions
 * Base URL: https://crof.ai/v1
 * Auth: API key via Bearer token
 *
 * Models sourced from GET https://crof.ai/v1/models (June 2025)
 * Usage data is fetched separately by edb-usage-stats.
 */

import type { ExtensionAPI, ProviderModelConfig } from "@earendil-works/pi-coding-agent";

// ── Provider Config ───────────────────────────────────────────────────────────

const PROVIDER = "crofai";
const BASE_URL = "https://crof.ai/v1";

// ── Models ─────────────────────────────────────────────────────────────────────
// Cost is in $/million tokens as per pi convention

const MODELS: ProviderModelConfig[] = [
	{
		id: "deepseek-v4-pro",
		name: "DeepSeek: DeepSeek V4 Pro",
		reasoning: true,
		input: ["text"],
		cost: { input: 0.3, output: 0.5, cacheRead: 0.003, cacheWrite: 0 },
		contextWindow: 1_000_000,
		maxTokens: 131_072,
		compat: { supportsReasoningEffort: true, supportsDeveloperRole: true },
	},
	{
		id: "deepseek-v4-pro-precision",
		name: "DeepSeek: DeepSeek V4 Pro (Precision)",
		reasoning: true,
		input: ["text"],
		cost: { input: 0.7, output: 1.4, cacheRead: 0.006, cacheWrite: 0 },
		contextWindow: 1_000_000,
		maxTokens: 131_072,
		compat: { supportsReasoningEffort: true, supportsDeveloperRole: true },
	},
	{
		id: "deepseek-v4-pro-lightning",
		name: "DeepSeek: DeepSeek V4 Pro (Lightning)",
		reasoning: true,
		input: ["text"],
		cost: { input: 1.7, output: 3.4, cacheRead: 0.1, cacheWrite: 0 },
		contextWindow: 1_000_000,
		maxTokens: 131_072,
		compat: { supportsReasoningEffort: true, supportsDeveloperRole: true },
	},
	{
		id: "deepseek-v4-flash",
		name: "DeepSeek: DeepSeek V4 Flash",
		reasoning: true,
		input: ["text"],
		cost: { input: 0.12, output: 0.21, cacheRead: 0.003, cacheWrite: 0 },
		contextWindow: 1_000_000,
		maxTokens: 131_072,
		compat: { supportsReasoningEffort: true, supportsDeveloperRole: true },
	},
	{
		id: "deepseek-v3.2",
		name: "DeepSeek: DeepSeek V3.2",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.28, output: 0.38, cacheRead: 0.06, cacheWrite: 0 },
		contextWindow: 163_840,
		maxTokens: 163_840,
		compat: { supportsDeveloperRole: true },
	},
	{
		id: "mimo-v2.5-pro",
		name: "Xiaomi: MiMo-V2.5-Pro",
		reasoning: true,
		input: ["text"],
		cost: { input: 0.5, output: 1.5, cacheRead: 0.1, cacheWrite: 0 },
		contextWindow: 1_000_000,
		maxTokens: 131_072,
		compat: { supportsReasoningEffort: true, supportsDeveloperRole: true },
	},
	{
		id: "mimo-v2.5-pro-precision",
		name: "Xiaomi: MiMo-V2.5-Pro (Precision)",
		reasoning: true,
		input: ["text"],
		cost: { input: 0.8, output: 2.5, cacheRead: 0.16, cacheWrite: 0 },
		contextWindow: 1_000_000,
		maxTokens: 131_072,
		compat: { supportsReasoningEffort: true, supportsDeveloperRole: true },
	},
	{
		id: "glm-5.1",
		name: "Z.ai: GLM 5.1",
		reasoning: true,
		input: ["text"],
		cost: { input: 0.45, output: 2.1, cacheRead: 0.09, cacheWrite: 0 },
		contextWindow: 202_752,
		maxTokens: 202_752,
		compat: { supportsReasoningEffort: true, supportsDeveloperRole: true },
	},
	{
		id: "glm-5.1-precision",
		name: "Z.ai: GLM 5.1 (Precision)",
		reasoning: true,
		input: ["text"],
		cost: { input: 0.75, output: 2.9, cacheRead: 0.15, cacheWrite: 0 },
		contextWindow: 202_752,
		maxTokens: 202_752,
		compat: { supportsReasoningEffort: true, supportsDeveloperRole: true },
	},
	{
		id: "glm-5",
		name: "Z.ai: GLM 5",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.48, output: 1.9, cacheRead: 0.1, cacheWrite: 0 },
		contextWindow: 202_752,
		maxTokens: 202_752,
		compat: { supportsDeveloperRole: true },
	},
	{
		id: "glm-4.7",
		name: "Z.AI: GLM 4.7",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.25, output: 1.1, cacheRead: 0.05, cacheWrite: 0 },
		contextWindow: 202_752,
		maxTokens: 202_752,
		compat: { supportsDeveloperRole: true },
	},
	{
		id: "glm-4.7-flash",
		name: "Z.AI: GLM 4.7 Flash",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.04, output: 0.3, cacheRead: 0.008, cacheWrite: 0 },
		contextWindow: 202_752,
		maxTokens: 131_072,
		compat: { supportsDeveloperRole: true },
	},
	{
		id: "kimi-k2.6",
		name: "MoonshotAI: Kimi K2.6",
		reasoning: true,
		input: ["text"],
		cost: { input: 0.5, output: 1.99, cacheRead: 0.1, cacheWrite: 0 },
		contextWindow: 262_144,
		maxTokens: 262_144,
		compat: { supportsReasoningEffort: true, supportsDeveloperRole: true },
	},
	{
		id: "kimi-k2.6-precision",
		name: "MoonshotAI: Kimi K2.6 (Precision)",
		reasoning: true,
		input: ["text"],
		cost: { input: 0.55, output: 2.7, cacheRead: 0.11, cacheWrite: 0 },
		contextWindow: 262_144,
		maxTokens: 262_144,
		compat: { supportsReasoningEffort: true, supportsDeveloperRole: true },
	},
	{
		id: "kimi-k2.5",
		name: "MoonshotAI: Kimi K2.5",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0.35, output: 1.7, cacheRead: 0.07, cacheWrite: 0 },
		contextWindow: 262_144,
		maxTokens: 262_144,
		compat: { supportsReasoningEffort: true, supportsDeveloperRole: true },
	},
	{
		id: "kimi-k2.5-lightning",
		name: "MoonshotAI: Kimi K2.5 (Lightning)",
		reasoning: true,
		input: ["text"],
		cost: { input: 1.0, output: 3.0, cacheRead: 0.2, cacheWrite: 0 },
		contextWindow: 131_072,
		maxTokens: 32_768,
		compat: { supportsReasoningEffort: true, supportsDeveloperRole: true },
	},
	{
		id: "gemma-4-31b-it",
		name: "Google: Gemma 4 31B",
		reasoning: true,
		input: ["text"],
		cost: { input: 0.1, output: 0.3, cacheRead: 0.02, cacheWrite: 0 },
		contextWindow: 262_144,
		maxTokens: 262_144,
		compat: { supportsReasoningEffort: true, supportsDeveloperRole: true },
	},
	{
		id: "minimax-m2.5",
		name: "MiniMax: MiniMax M2.5",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.11, output: 0.95, cacheRead: 0.02, cacheWrite: 0 },
		contextWindow: 204_800,
		maxTokens: 131_072,
		compat: { supportsDeveloperRole: true },
	},
	{
		id: "qwen3.6-27b",
		name: "Qwen: Qwen3.6 27B",
		reasoning: true,
		input: ["text"],
		cost: { input: 0.2, output: 1.5, cacheRead: 0.04, cacheWrite: 0 },
		contextWindow: 262_144,
		maxTokens: 262_144,
		compat: { supportsReasoningEffort: true, supportsDeveloperRole: true },
	},
	{
		id: "qwen3.5-397b-a17b",
		name: "Qwen: Qwen3.5 397B A17B",
		reasoning: true,
		input: ["text"],
		cost: { input: 0.35, output: 1.75, cacheRead: 0.07, cacheWrite: 0 },
		contextWindow: 262_144,
		maxTokens: 262_144,
		compat: { supportsReasoningEffort: true, supportsDeveloperRole: true },
	},
	{
		id: "qwen3.5-9b",
		name: "Qwen: Qwen3.5 9B",
		reasoning: true,
		input: ["text"],
		cost: { input: 0.04, output: 0.15, cacheRead: 0.008, cacheWrite: 0 },
		contextWindow: 262_144,
		maxTokens: 262_144,
		compat: { supportsReasoningEffort: true, supportsDeveloperRole: true },
	},
];

// ── Provider Registration ─────────────────────────────────────────────────────

export function registerCrofAiProvider(pi: ExtensionAPI): void {
	pi.registerProvider(PROVIDER, {
		name: "CrofAi",
		baseUrl: BASE_URL,
		apiKey: "CROFAI_API_KEY",
		api: "openai-completions",
		authHeader: true,
		models: MODELS,
		oauth: {
			name: "CrofAi",
			async login(cb) {
				cb.onAuth({ url: "https://crof.ai/signin" });
				const key = (await cb.onPrompt({ message: "Paste your CrofAi API key:" })).trim();
				if (!key) throw new Error("No CrofAi API key provided");
				// CrofAi keys are long-lived
				return { access: key, refresh: key, expires: Date.now() + 20 * 365 * 86_400_000 };
			},
			async refreshToken(c) {
				return c;
			},
			getApiKey: (c) => c.access,
		},
	});
}
