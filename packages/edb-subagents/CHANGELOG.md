# Changelog

## [0.16.0] - 2026-06-22

## [0.13.0] - 2026-05-23

### Added
- `loadCustomAgents` tests for custom agents context frontmatter parsing.

## [0.12.0] - 2026-05-22

### Fixed
- Add missing `unlinkSync` import

### Added
- Bridge context threading and promptGuidelines on tools

## [0.10.9] - 2026-05-18

### Added
- **edb-bridge integration** — injects `<bridge_parent_session>`, `<bridge_agent_id>`, and `<task_store_path>` XML tags into sub-agent system prompts at spawn time
- **`bridgeContext` option** — new optional field on `SpawnOptions` and `RunOptions`; when present, bridge metadata is embedded into the sub-agent's prompt extras
- **`bridge:ready` listener** — captures the parent session's broker session ID when edb-bridge connects
- **`todo:store_path` listener** — captures the active edb-todo task store path for injection into sub-agents
- **`bridgeContext` threading** — passes bridge context through `manager.spawn()`, `manager.spawnAndWait()`, and the `sharedRunOptions` in `agent-manager.ts`

### Changed
- `prompts.ts` `PromptExtras` gains optional `bridgeContext` field; when set, a `<bridge_context>` XML block is appended to the sub-agent system prompt
- `agent-runner.ts` reads `options.bridgeContext` and populates `extras.bridgeContext` before building the agent prompt

## [0.10.8] - 2026-05-18

### Changed
- Replaced Braille spinner (⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏, 10 frames @ 80ms) with Claude Code–style spinner (· ✢ ✳ ✶ ✻ ✽, 6 frames @ 150ms) to match the global footer's working indicator

## [0.10.6] - 2026-05-15

## [0.10.5] - 2026-05-15

### Changed
- Added `promptSnippet` to all three tools (`Agent`, `get_subagent_result`, `steer_subagent`) so they appear in the system prompt's Available tools section

## [0.10.4] - 2026-05-15

## [0.10.3] - 2026-05-15

### Added
- Initial release — forked from tintinweb/pi-subagents and adapted for the edb monorepo
- Updated all imports from `@mariozechner/*` to `@earendil-works/*`
- Tool description now dynamically reflects only enabled agents (no hardcoded default-agent guidelines)
