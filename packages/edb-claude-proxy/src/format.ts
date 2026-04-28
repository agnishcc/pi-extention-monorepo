import * as os from "node:os";

// ── Format helpers ─────────────────────────────────────────────────────────────

/** Format a tool call for single-line display in the TUI. */
export function formatToolCall(name: string, input: Record<string, unknown>): string {
	const shortenPath = (p: string) => {
		const home = os.homedir();
		return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
	};
	switch (name) {
		case "Read": {
			const p = shortenPath(String(input.file_path ?? input.path ?? "..."));
			return `read ${p}`;
		}
		case "Bash": {
			const cmd = String(input.command ?? "...");
			return `$ ${cmd.length > 60 ? `${cmd.slice(0, 60)}…` : cmd}`;
		}
		case "Edit":
		case "Write": {
			const p = shortenPath(String(input.file_path ?? input.path ?? "..."));
			return `${name.toLowerCase()} ${p}`;
		}
		default: {
			const s = JSON.stringify(input);
			return `${name} ${s.length > 50 ? `${s.slice(0, 50)}…` : s}`;
		}
	}
}
