// ── Types ──────────────────────────────────────────────────────────────────────

export interface ToolCallRecord {
	id: string;
	name: string;
	input: Record<string, unknown>;
	result?: string;
	isError?: boolean;
}

export interface ClaudeProxyDetails {
	sessionId?: string;
	model?: string;
	costUsd?: number;
	streaming: boolean;
	toolCalls: ToolCallRecord[];
	exitCode?: number;
	prompt?: string;
	filesInjected?: string[];
}
