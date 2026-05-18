// ── Rendering limits ──────────────────────────────────────────────
export const MAX_COLLAPSED_TEXT = 120;
export const MAX_EXPANDED_LINES = 4000;
export const MAX_LINE_CHARS = 120;

// ── Patch markers (prevent double-patching) ──────────────────────
export const TOOL_EXECUTION_PATCH_SYMBOL = Symbol.for("edb-compact-tools.tool-execution-patch");
export const USER_MESSAGE_PATCH_SYMBOL = Symbol.for("edb-compact-tools.user-message-patch");
export const ASSISTANT_MESSAGE_PATCH_SYMBOL = Symbol.for("edb-compact-tools.assistant-message-patch");
export const USER_MESSAGE_MARKER_SYMBOL = Symbol.for("edb-compact-tools.user-message-marker");
export const ASSISTANT_MESSAGE_MARKER_SYMBOL = Symbol.for("edb-compact-tools.assistant-message-marker");

// ── Emoji sets ───────────────────────────────────────────────────
export const USER_MESSAGE_EMOJIS = [
	"🦊",
	"🐙",
	"🐸",
	"🐻",
	"🐼",
	"🐨",
	"🦥",
	"🦔",
	"🦫",
	"🦚",
	"🦩",
	"🦉",
	"🐰",
	"🐢",
	"🦎",
	"🦖",
];

export const ASSISTANT_MESSAGE_EMOJIS = ["🤖", "🧠", "🦾", "🛸", "💡"];

// ── OSC133 shell integration markers ─────────────────────────────
export const OSC133_ZONE_START = "\x1b]133;A\x07";
export const OSC133_ZONE_END = "\x1b]133;B\x07";
export const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

// ── ANSI color codes ─────────────────────────────────────────────
export const ANSI_PURPLE = "\x1b[38;5;141m";
export const ANSI_RESET = "\x1b[0m";
