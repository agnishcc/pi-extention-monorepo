# @agnishc/edb-token-tracker

Pi extension that tracks per-turn LLM token usage for both the main agent and subagents, writing to a local SQLite database at `~/.pi/token-usage.db`.

Designed to work alongside [`@agnishc/edb-subagents`](https://github.com/agnishcc/pi-extention-monorepo/tree/main/packages/edb-subagents).

## Install

```bash
pi install npm:@agnishc/edb-token-tracker
```

Or load directly in the monorepo:

```bash
pi -e ./packages/edb-token-tracker/src/index.ts
```

## How it works

| Source | Event | What's captured |
|---|---|---|
| Main agent turns | `message_end` (pi built-in) | `session_id`, `model`, `caller="main"`, turn number, all token types |
| Subagent turns | `subagents:usage` (from edb-subagents) | Same fields with `caller="subagent"`, plus `agent_id` and `agent_type` |

### Schema

```sql
CREATE TABLE token_detailed (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp   TEXT    NOT NULL,                  -- ISO 8601
    session_id  TEXT    NOT NULL,                  -- pi session ID
    caller      TEXT    NOT NULL,                  -- "main" | "subagent"
    agent_id    TEXT,                              -- null for main
    agent_type  TEXT,                              -- null for main
    model       TEXT    NOT NULL,                  -- "anthropic/claude-sonnet-4-..."
    turn_number INTEGER NOT NULL,                  -- 1-based per session
    input_tokens    INTEGER NOT NULL,
    output_tokens   INTEGER NOT NULL,
    cache_read_tokens  INTEGER DEFAULT 0,
    cache_write_tokens INTEGER DEFAULT 0
);
```

All rows use the parent pi session's `session_id`, so main + subagent tokens for a session are queryable together.

## Example queries

```sql
-- Total tokens per session
SELECT session_id, SUM(input_tokens + output_tokens) AS total_tokens
FROM token_detailed GROUP BY session_id ORDER BY total_tokens DESC;

-- Per-model breakdown
SELECT model, caller, SUM(input_tokens), SUM(output_tokens)
FROM token_detailed GROUP BY model, caller;

-- Subagent usage by type
SELECT agent_type, COUNT(*), SUM(input_tokens + output_tokens)
FROM token_detailed WHERE caller = 'subagent'
GROUP BY agent_type;
```

## Requirements

- `@agnishc/edb-subagents` v0.16+ (for `subagents:usage` events)
- Uses `sql.js` (WASM-based SQLite) — no native compilation needed

## License

MIT
