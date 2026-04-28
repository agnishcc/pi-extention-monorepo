import * as os from "node:os";

// ── Format helpers ─────────────────────────────────────────────────────────────

/** Format a Gemini tool call for single-line display in the TUI. */
export function formatToolCall(name: string, params: Record<string, unknown>): string {
	const shortenPath = (p: string) => {
		const home = os.homedir();
		return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
	};

	// Gemini tool names follow snake_case conventions
	switch (name) {
		case "read_file": {
			const p = shortenPath(String(params.path ?? params.absolute_path ?? "..."));
			return `read ${p}`;
		}
		case "write_file":
		case "edit_file":
		case "replace_in_file": {
			const p = shortenPath(String(params.path ?? params.absolute_path ?? "..."));
			return `${name.replace(/_/g, " ")} ${p}`;
		}
		case "run_shell_command": {
			const cmd = String(params.command ?? "...");
			return `$ ${cmd.length > 60 ? `${cmd.slice(0, 60)}…` : cmd}`;
		}
		case "list_directory": {
			const p = shortenPath(String(params.path ?? "."));
			return `ls ${p}`;
		}
		case "search_file_content":
		case "grep_search": {
			const pattern = String(params.pattern ?? params.query ?? "...");
			return `grep ${pattern.length > 30 ? `${pattern.slice(0, 30)}…` : pattern}`;
		}
		case "web_search":
		case "google_web_search": {
			const q = String(params.query ?? "...");
			return `search: ${q.length > 50 ? `${q.slice(0, 50)}…` : q}`;
		}
		default: {
			const s = JSON.stringify(params);
			return `${name} ${s.length > 50 ? `${s.slice(0, 50)}…` : s}`;
		}
	}
}
