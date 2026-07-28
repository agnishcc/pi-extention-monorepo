/**
 * edb-token-tracker — Per-turn token usage tracker for pi.
 *
 * Captures token usage from both the main agent (via message_end events) and
 * subagents (via subagents:usage events from edb-subagents) into Postgres.
 *
 * Default DB URL:
 *   postgres://pi_token_tracker:pi_token_tracker@localhost:5432/pi_token_usage
 *
 * Override with PI_TOKEN_TRACKER_DATABASE_URL or DATABASE_URL.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import pg from "pg";

const { Pool } = pg;

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

const DEFAULT_DATABASE_URL = "postgres://pi_token_tracker:pi_token_tracker@localhost:5432/pi_token_usage";
const DATABASE_URL = process.env.PI_TOKEN_TRACKER_DATABASE_URL ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;

let pool: pg.Pool | null = null;
let initPromise: Promise<void> | null = null;
let currentSessionId: string | undefined;
/** The orchestrator's session ID — set on first session_start, never overwritten. */
let mainSessionId: string | undefined;
let mainTurnCount = 0;

function getPool(): pg.Pool {
	if (pool) return pool;
	pool = new Pool({
		connectionString: DATABASE_URL,
		application_name: "edb-token-tracker",
		max: Number(process.env.PI_TOKEN_TRACKER_PG_POOL_MAX ?? 2),
		idleTimeoutMillis: 30_000,
		connectionTimeoutMillis: 5_000,
	});
	pool.on("error", (err) => {
		console.error("[token-tracker] postgres pool error:", err);
	});
	return pool;
}

async function initSchema(): Promise<void> {
	if (initPromise) return initPromise;
	initPromise = (async () => {
		const p = getPool();
		await p.query(`
			CREATE TABLE IF NOT EXISTS token_detailed (
				id BIGSERIAL PRIMARY KEY,
				timestamp TEXT NOT NULL,
				session_id TEXT NOT NULL,
				caller TEXT NOT NULL,
				agent_id TEXT,
				agent_type TEXT,
				model TEXT NOT NULL,
				turn_number INTEGER NOT NULL,
				input_tokens INTEGER NOT NULL,
				output_tokens INTEGER NOT NULL,
				cache_read_tokens INTEGER DEFAULT 0,
				cache_write_tokens INTEGER DEFAULT 0
			);
		`);
		await p.query("CREATE INDEX IF NOT EXISTS idx_token_detailed_session ON token_detailed(session_id);");
		await p.query("CREATE INDEX IF NOT EXISTS idx_token_detailed_model ON token_detailed(model);");
		await p.query("CREATE INDEX IF NOT EXISTS idx_token_detailed_timestamp ON token_detailed(timestamp);");
		await p.query("CREATE INDEX IF NOT EXISTS idx_token_detailed_caller ON token_detailed(caller);");
	})().catch((err) => {
		initPromise = null;
		throw err;
	});
	return initPromise;
}

/** Insert a single usage row. Telemetry failures must never break the agent. */
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
		await initSchema();
		await getPool().query(
			`INSERT INTO token_detailed
				(timestamp, session_id, caller, agent_id, agent_type, model, turn_number,
				 input_tokens, output_tokens, cache_read_tokens, cache_write_tokens)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
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
	} catch (err) {
		console.error("[token-tracker] postgres write error:", err);
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
		void initSchema();
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

		void insertRow(
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

		void insertRow(
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
		description: "View Postgres token usage metrics and recent turn history",
		handler: async (_args: string, ctx: ExtensionContext) => {
			try {
				await initSchema();
				const totals = await getPool().query<{
					count: string;
					input_sum: string | null;
					output_sum: string | null;
				}>(
					"SELECT COUNT(*) AS count, SUM(input_tokens) AS input_sum, SUM(output_tokens) AS output_sum FROM token_detailed",
				);
				const totalCount = Number(totals.rows[0]?.count ?? 0);
				const totalInput = Number(totals.rows[0]?.input_sum ?? 0);
				const totalOutput = Number(totals.rows[0]?.output_sum ?? 0);

				const recentRows = await getPool().query<{
					timestamp: string;
					caller: string;
					model: string;
					turn_number: number;
					input_tokens: number;
					output_tokens: number;
				}>(
					"SELECT timestamp, caller, model, turn_number, input_tokens, output_tokens FROM token_detailed ORDER BY id DESC LIMIT 5",
				);

				let out = `📊 Token Database Viewer (Postgres)\n\n`;
				out += `• Total Recorded Turns: ${totalCount}\n`;
				out += `• Total Input Tokens: ${totalInput.toLocaleString()}\n`;
				out += `• Total Output Tokens: ${totalOutput.toLocaleString()}\n\n`;
				out += `Recent Turns:\n`;

				for (const r of recentRows.rows) {
					out += `• [${r.caller}] ${r.model} (turn #${r.turn_number}) — in: ${r.input_tokens}, out: ${r.output_tokens}\n`;
				}

				ctx.ui.notify(out, "info");
			} catch (err) {
				ctx.ui.notify(`Failed to query Postgres token database: ${err}`, "error");
			}
		},
	});

	// ---- Shutdown: close DB pool ----
	pi.on("session_shutdown", () => {
		void (async () => {
			try {
				await pool?.end();
			} catch {
				// ignore
			}
			pool = null;
			initPromise = null;
			currentSessionId = undefined;
			mainSessionId = undefined;
			mainTurnCount = 0;
		})();
	});
}
