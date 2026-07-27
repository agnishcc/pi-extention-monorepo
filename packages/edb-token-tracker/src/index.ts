/**
 * edb-token-tracker — Per-turn token usage tracker for pi.
 *
 * Captures token usage from both the main agent (via message_end events) and
 * subagents (via subagents:usage events from edb-subagents) into a local SQLite DB.
 *
 * DB location: ~/.pi/token-usage.db
 *
 * Uses sql.js (WASM-based SQLite) to avoid native compilation issues.
 * The DB is loaded into memory on first write, modified, and saved back to disk.
 *
 * Schema:
 *   token_detailed — append-only per-turn rows with session_id, model, caller, tokens
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SqlJsDatabase, SqlJsStatic } from "sql.js";
import initSqlJs from "sql.js";

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

const DB_PATH = join(homedir(), ".pi", "token-usage.db");

let db: SqlJsDatabase | null = null;
let currentSessionId: string | undefined;
let mainTurnCount = 0;

let sqlReady: ReturnType<typeof initSqlJs> | null = null;
let sqlStatic: SqlJsStatic | null = null;

async function getSql(): Promise<SqlJsStatic> {
	if (sqlStatic) return sqlStatic;
	if (!sqlReady) sqlReady = initSqlJs();
	sqlStatic = await sqlReady;
	return sqlStatic;
}

/** Open (or create) the database. */
async function openDb(): Promise<SqlJsDatabase> {
	if (db) return db;
	const SQL = await getSql();
	if (existsSync(DB_PATH)) {
		const buffer = readFileSync(DB_PATH);
		db = new SQL.Database(buffer);
	} else {
		mkdirSync(dirname(DB_PATH), { recursive: true });
		db = new SQL.Database();
	}
	db.exec(`
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
		CREATE INDEX IF NOT EXISTS idx_detailed_session ON token_detailed(session_id);
	`);
	return db;
}

/** Persist the in-memory DB to disk. */
function saveDb(): void {
	if (!db) return;
	try {
		const data = db.export();
		writeFileSync(DB_PATH, Buffer.from(data));
	} catch (err) {
		console.error("[token-tracker] save error:", err);
	}
}

/** Insert a single usage row and persist to disk. */
async function insertRow(
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
): Promise<void> {
	try {
		const d = await openDb();
		d.run(
			`INSERT INTO token_detailed
				(timestamp, session_id, caller, agent_id, agent_type, model, turn_number,
				 input_tokens, output_tokens, cache_read_tokens, cache_write_tokens)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
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
			],
		);
		saveDb();
	} catch (err) {
		// Telemetry must never break the agent — swallow errors.
		console.error("[token-tracker] write error:", err);
	}
}

export default function (pi: ExtensionAPI) {
	// ---- Session start: capture session ID, reset counters ----
	pi.on("session_start", (_event, ctx: ExtensionContext) => {
		currentSessionId = ctx.sessionManager?.getSessionId?.() ?? undefined;
		mainTurnCount = 0;
	});

	// ---- Main agent: per-turn token usage ----
	pi.on("message_end", (_event, ctx: ExtensionContext) => {
		if (_event.message.role !== "assistant") return;
		const usage = (_event.message as any).usage;
		if (!usage) return;

		const sid = currentSessionId ?? "unknown";
		const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "unknown";
		mainTurnCount++;

		// Fire-and-forget: don't await — telemetry must not block agent.
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

		const sid = ev.parentSessionId ?? currentSessionId ?? "unknown";

		// Fire-and-forget: don't await.
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

	// ---- Shutdown: close DB ----
	pi.on("session_shutdown", () => {
		try {
			saveDb();
			db?.close();
		} catch {
			// ignore
		}
		db = null;
		sqlStatic = null;
		sqlReady = null;
		currentSessionId = undefined;
		mainTurnCount = 0;
	});
}
