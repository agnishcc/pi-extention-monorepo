# Changelog

## [Unreleased]

### Changed

- Replace the shared SQLite write target with Postgres for reliable concurrent token usage writes.
- Add Postgres-backed `/token-db` metrics and schema initialization.

## [0.18.1] - 2026-07-28

### Changed

- Switch SQLite backend from `bun:sqlite` to `node:sqlite`. The extension now loads cleanly when pi runs under Node.js (no Bun runtime required). `node:sqlite` honours `busy_timeout` for cross-process writes, so the multi-session contention case is handled natively rather than via retry.

## [0.17.0] - 2026-07-27

0.16.4] - 2026-07-27

### Added

- Initial release — per-turn token usage tracker for main agent and subagents
- SQLite-backed storage at `~/.pi/token-usage.db`
- Listens to `message_end` (main agent) and `subagents:usage` (subagent) events
- Appends to `token_detailed` table with `session_id`, `model`, `caller`, and all token types
