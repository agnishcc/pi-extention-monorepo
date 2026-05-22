# Changelog

All notable changes to `@agnishc/edb-bridge` will be documented in this file.

## [0.12.0] - 2026-05-22

### Added

- Initial release
- Unix socket broker with auto-spawn
- `ask_supervisor` tool for sub-agents (blocking question to orchestrator)
- `notify_parent` tool for sub-agents (fire-and-forget progress updates)
- `answer_subagent` tool for orchestrators (reply to pending sub-agent questions)
- Internal `pi.events` API: `bridge:ready`, `bridge:task_updated`
- `PI_BRIDGE_PARENT_SESSION` / `PI_BRIDGE_AGENT_ID` env var support

## [0.10.9] - 2026-05-18
