/**
 * edb-token-tracker — Per-turn token usage tracker for pi.
 *
 * Captures token usage from both the main agent (via message_end events) and
 * subagents (via subagents:usage events from edb-subagents) into a local SQLite DB.
 *
 * DB location: ~/.pi/token-usage.db
 *
 * Uses node:sqlite for native file locking and WAL-mode concurrency. This is
 * safe under multiple parallel pi sessions — each writer waits its turn via
 * busy_timeout instead of stomping the file with a full rewrite.
 *
 * Schema:
 *   token_detailed — append-only per-turn rows with session_id, model, caller, tokens
 */

import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Subagent usage event payload from edb-subagents. */
interface SubagentUsageEvent {
	agentId: string;
	agentType: string;
	agentName?: string;
	model: string;
	turnNumber: number;
	parentSessionId?: string;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

const DB_PATH = `${homedir()}/.pi/token-usage.db`;

let db: DatabaseSync | null = null;
let currentSessionId: string | undefined;
/** The orchestrator's session ID — set on first session_start, never overwritten. */
let mainSessionId: string | undefined;
let mainTurnCount = 0;

/**
 * node:sqlite honours busy_timeout for cross-process writes, so this retry is
 * a defensive backstop for the case where multiple pi sessions boot
 * simultaneously and race on the initial schema setup.
 */
function withRetry<T>(fn: () => T, attempts = 20, baseMs = 25): T {
	let lastErr: unknown;
	for (let i = 0; i < attempts; i++) {
		try {
			return fn();
		} catch (err: any) {
			lastErr = err;
			if (err?.code !== "SQLITE_BUSY") throw err;
			const wait = baseMs * (1 << Math.min(i, 6)) + Math.random() * baseMs;
			const end = Date.now() + wait;
			while (Date.now() < end) {
				/* spin */
			}
		}
	}
	throw lastErr;
}

/** Open (or create) the database with WAL mode and busy timeout. */
function openDb(): DatabaseSync {
	if (db) return db;
	if (!existsSync(dirname(DB_PATH))) {
		mkdirSync(dirname(DB_PATH), { recursive: true });
	}
	db = withRetry(() => new DatabaseSync(DB_PATH));
	withRetry(() => db!.exec("PRAGMA journal_mode = WAL;"));
	withRetry(() => db!.exec("PRAGMA busy_timeout = 5000;"));
	withRetry(() =>
		db!.exec(`
		CREATE TABLE IF NOT EXISTS token_detailed (
			id          INTEGER PRIMARY KEY AUTOINCREMENT,
			timestamp   TEXT    NOT NULL,
			session_id  TEXT    NOT NULL,
			caller      TEXT    NOT NULL,
			agent_id    TEXT,
			agent_type  TEXT,
			model       TEXT    NOT NULL,
			turn_number INTEGER NOT NULL,
			input_tokens    INTEGER NOT NULL,
			output_tokens   INTEGER NOT NULL,
			cache_read_tokens  INTEGER DEFAULT 0,
			cache_write_tokens INTEGER DEFAULT 0
		);
	`),
	);
	withRetry(() => db!.exec(`CREATE INDEX IF NOT EXISTS idx_detailed_session ON token_detailed(session_id);`));
	return db;
}

/** Insert a single usage row. Returns void; WAL handles durability. */
function insertRow(
	sessionId: string,
	caller: "main" | "subagent",
	model: string,
	turnNumber: number,
	input: number,
	output: number,
	cacheRead: number,
	cacheWrite: number,
	agentId?: string,
	agentType?: string,
): void {
	try {
		const d = openDb();
		withRetry(() =>
			d
				.prepare(
					`INSERT INTO token_detailed
				(timestamp, session_id, caller, agent_id, agent_type, model, turn_number,
				 input_tokens, output_tokens, cache_read_tokens, cache_write_tokens)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				)
				.run(
					new Date().toISOString(),
					sessionId,
					caller,
					agentId ?? null,
					agentType ?? null,
					model,
					turnNumber,
					input,
					output,
					cacheRead,
					cacheWrite,
				),
		);
	} catch (err) {
		// Telemetry must never break the agent — swallow errors.
		console.error("[token-tracker] write error:", err);
	}
}

export default function (pi: ExtensionAPI) {
	// ---- Session start: capture session ID, reset counters ----
	pi.on("session_start", (_event, ctx: ExtensionContext) => {
		currentSessionId = ctx.sessionManager?.getSessionId?.() ?? undefined;
		// Track the first (orchestrator) session ID so we can distinguish
		// sub-agent sessions from the main session.
		if (!mainSessionId) mainSessionId = currentSessionId;
		mainTurnCount = 0;
	});

	// ---- Main agent: per-turn token usage ----
	pi.on("message_end", (_event, ctx: ExtensionContext) => {
		// Only track the orchestrator session's assistant messages. Sub-agent
		// sessions also fire message_end, but their usage is captured via the
		// subagents:usage event to get proper caller/agent-id metadata.
		if (currentSessionId !== mainSessionId) return;
		if (_event.message.role !== "assistant") return;
		const usage = (_event.message as any).usage;
		if (!usage) return;

		const sid = currentSessionId ?? "unknown";
		const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "unknown";
		mainTurnCount++;

		insertRow(
			sid,
			"main",
			model,
			mainTurnCount,
			usage.input ?? 0,
			usage.output ?? 0,
			usage.cacheRead ?? 0,
			usage.cacheWrite ?? 0,
		);
	});

	// ---- Subagents: per-turn token usage (from edb-subagents) ----
	pi.events.on("subagents:usage", (payload: unknown) => {
		const ev = payload as SubagentUsageEvent;
		if (!ev || !ev.model) return;

		// Use parentSessionId from the event (bridge session ID), or fall back
		// to the orchestrator's main session ID. Do NOT use currentSessionId
		// which may have been overwritten by a sub-agent session_start.
		const sid = ev.parentSessionId ?? mainSessionId ?? "unknown";

		insertRow(
			sid,
			"subagent",
			ev.model,
			ev.turnNumber,
			ev.input,
			ev.output,
			ev.cacheRead,
			ev.cacheWrite,
			ev.agentId,
			ev.agentType,
		);
	});

	// ---- CLI Command: /token-db viewer ----
	pi.registerCommand("token-db", {
		description: "View SQLite database token usage metrics and recent turn history",
		handler: async (_args: string, ctx: ExtensionContext) => {
			try {
				const d = openDb();
				const totals = d
					.prepare("SELECT COUNT(*), SUM(input_tokens), SUM(output_tokens) FROM token_detailed")
					.get() as unknown as [number, number | null, number | null] | undefined;
				const totalCount = totals?.[0] ?? 0;
				const totalInput = Number(totals?.[1] ?? 0);
				const totalOutput = Number(totals?.[2] ?? 0);

				const recentRows = d
					.prepare(
						"SELECT timestamp, caller, model, turn_number, input_tokens, output_tokens FROM token_detailed ORDER BY id DESC LIMIT 5",
					)
					.all() as unknown as [string, string, string, number, number, number][];

				let out = `📊 Token Database Viewer (~/.pi/token-usage.db)\n\n`;
				out += `• Total Recorded Turns: ${totalCount}\n`;
				out += `• Total Input Tokens: ${totalInput.toLocaleString()}\n`;
				out += `• Total Output Tokens: ${totalOutput.toLocaleString()}\n\n`;
				out += `Recent Turns:\n`;

				for (const r of recentRows) {
					out += `• [${r[1]}] ${r[2]} (turn #${r[3]}) — in: ${r[4]}, out: ${r[5]}\n`;
				}

				ctx.ui.notify(out, "info");
			} catch (err) {
				ctx.ui.notify(`Failed to query database: ${err}`, "error");
			}
		},
	});

	// ---- Shutdown: close DB ----
	pi.on("session_shutdown", () => {
		try {
			db?.close();
		} catch {
			// ignore
		}
		db = null;
		currentSessionId = undefined;
		mainSessionId = undefined;
		mainTurnCount = 0;
	});
}
