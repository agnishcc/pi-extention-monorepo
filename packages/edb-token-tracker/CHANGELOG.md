# Changelog

## [Unreleased]

0.16.4] - 2026-07-27

### Added

- Initial release — per-turn token usage tracker for main agent and subagents
- SQLite-backed storage at `~/.pi/token-usage.db`
- Listens to `message_end` (main agent) and `subagents:usage` (subagent) events
- Appends to `token_detailed` table with `session_id`, `model`, `caller`, and all token types
