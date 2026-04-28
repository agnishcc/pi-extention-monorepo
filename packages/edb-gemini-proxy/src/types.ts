// ── Gemini stream-json event types ─────────────────────────────────────────────

export interface GeminiInitEvent {
	type: "init";
	timestamp: string;
	session_id: string;
	model: string;
}

export interface GeminiMessageEvent {
	type: "message";
	timestamp: string;
	role: "user" | "assistant";
	content: string;
	/** true = streaming chunk; accumulate content. absent/false = full message */
	delta?: boolean;
}

export interface GeminiToolUseEvent {
	type: "tool_use";
	timestamp: string;
	tool_name: string;
	tool_id: string;
	parameters: Record<string, unknown>;
}

export interface GeminiToolResultEvent {
	type: "tool_result";
	timestamp: string;
	tool_id: string;
	status: "success" | "error";
	output?: string;
	error?: { type: string; message: string };
}

export interface GeminiErrorEvent {
	type: "error";
	timestamp: string;
	severity: "warning" | "error";
	message: string;
}

export interface GeminiResultEvent {
	type: "result";
	timestamp: string;
	status: "success" | "error";
	error?: { type: string; message: string };
	stats?: {
		total_tokens: number;
		input_tokens: number;
		output_tokens: number;
		tool_calls: number;
		duration_ms: number;
		models: Record<string, { total_tokens: number; input_tokens: number; output_tokens: number }>;
	};
}

export type GeminiStreamEvent =
	| GeminiInitEvent
	| GeminiMessageEvent
	| GeminiToolUseEvent
	| GeminiToolResultEvent
	| GeminiErrorEvent
	| GeminiResultEvent;

// ── Internal types ─────────────────────────────────────────────────────────────

export interface ToolCallRecord {
	id: string;
	name: string;
	parameters: Record<string, unknown>;
	status?: "success" | "error";
	output?: string;
}

export interface GeminiProxyDetails {
	sessionId?: string;
	model?: string;
	totalTokens?: number;
	toolCalls: ToolCallRecord[];
	streaming: boolean;
	exitCode?: number;
	filesInjected?: string[];
	durationMs?: number;
}
