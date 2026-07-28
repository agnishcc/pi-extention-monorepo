#!/usr/bin/env node
/**
 * One-time migration from the old SQLite token tracker DB to Postgres.
 *
 * Defaults:
 *   source: ~/.pi/token-usage.db
 *   target: postgres://pi_token_tracker:pi_token_tracker@localhost:5432/pi_token_usage
 *
 * Overrides:
 *   SQLITE_TOKEN_DB=/path/to/token-usage.db
 *   PI_TOKEN_TRACKER_DATABASE_URL=postgres://...
 *   DATABASE_URL=postgres://...
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import pg from "pg";

const { Pool } = pg;

const sqlitePath = process.env.SQLITE_TOKEN_DB || join(homedir(), ".pi", "token-usage.db");
const databaseUrl =
	process.env.PI_TOKEN_TRACKER_DATABASE_URL ||
	process.env.DATABASE_URL ||
	"postgres://pi_token_tracker:pi_token_tracker@localhost:5432/pi_token_usage";

if (!existsSync(sqlitePath)) {
	console.error(`SQLite token DB not found: ${sqlitePath}`);
	process.exit(1);
}

const pool = new Pool({
	connectionString: databaseUrl,
	application_name: "token-sqlite-to-postgres-migration",
	max: 2,
});

async function initSchema() {
	await pool.query(`
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
	await pool.query("CREATE INDEX IF NOT EXISTS idx_token_detailed_session ON token_detailed(session_id);");
	await pool.query("CREATE INDEX IF NOT EXISTS idx_token_detailed_model ON token_detailed(model);");
	await pool.query("CREATE INDEX IF NOT EXISTS idx_token_detailed_timestamp ON token_detailed(timestamp);");
	await pool.query("CREATE INDEX IF NOT EXISTS idx_token_detailed_caller ON token_detailed(caller);");
}

async function insertIfMissing(client, row) {
	const values = [
		row.timestamp,
		row.session_id,
		row.caller,
		row.agent_id ?? null,
		row.agent_type ?? null,
		row.model,
		Number(row.turn_number || 0),
		Number(row.input_tokens || 0),
		Number(row.output_tokens || 0),
		Number(row.cache_read_tokens || 0),
		Number(row.cache_write_tokens || 0),
	];

	const result = await client.query(
		`INSERT INTO token_detailed
       (timestamp, session_id, caller, agent_id, agent_type, model, turn_number, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens)
     SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
     WHERE NOT EXISTS (
       SELECT 1 FROM token_detailed
       WHERE timestamp = $1
         AND session_id = $2
         AND caller = $3
         AND agent_id IS NOT DISTINCT FROM $4
         AND agent_type IS NOT DISTINCT FROM $5
         AND model = $6
         AND turn_number = $7
         AND input_tokens = $8
         AND output_tokens = $9
         AND cache_read_tokens = $10
         AND cache_write_tokens = $11
     )`,
		values,
	);

	return result.rowCount || 0;
}

async function main() {
	const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
	const table = sqlite
		.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'token_detailed'")
		.get();

	if (!table) {
		console.error(`SQLite DB does not contain token_detailed: ${sqlitePath}`);
		sqlite.close();
		process.exit(1);
	}

	await initSchema();

	const rows = sqlite.prepare("SELECT * FROM token_detailed ORDER BY id ASC").all();
	const client = await pool.connect();
	let inserted = 0;

	try {
		await client.query("BEGIN");
		for (const row of rows) {
			inserted += await insertIfMissing(client, row);
		}
		await client.query("COMMIT");
	} catch (err) {
		await client.query("ROLLBACK");
		throw err;
	} finally {
		client.release();
		sqlite.close();
		await pool.end();
	}

	console.log(`Migrated ${inserted} new rows from ${sqlitePath} (${rows.length} SQLite rows scanned).`);
}

main().catch(async (err) => {
	console.error(err);
	try {
		await pool.end();
	} catch {
		// ignore
	}
	process.exit(1);
});
