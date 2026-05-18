export type CompactTheme = {
	fg: (color: any, text: string) => string;
	bg?: (color: any, text: string) => string;
	bold: (text: string) => string;
};

export type BuiltinToolName = "read" | "bash" | "grep" | "find" | "ls" | "edit" | "write";

export type BuiltinTool = {
	description: string;
	parameters: unknown;
	execute: (id: string, params: unknown, signal?: AbortSignal, onUpdate?: unknown, ctx?: unknown) => Promise<unknown>;
};

export type ToolBlockKind = "call" | "result" | "full";
