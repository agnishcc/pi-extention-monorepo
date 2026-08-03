# Changelog

## [0.20.0] - 2026-08-03


## [Unreleased]

### Added
- **Live agent widget steps** — the V2 widget now shows what each running agent is doing (active tool, latest response text, thinking) plus turns, tool-use count and a live token total.
- **Interactive `/agents` menu** — status-grouped agent list (running / waiting / done / idle / error / retired) with per-agent actions: open the agent session in a new tmux window (`pi --session`), live-tail a running agent, stop, dispose, show record. New subcommands: `/agents list`, `/agents open <id>`, `/agents tail <id>`.
- **Completion notification cards** — custom message renderer showing a themed summary (icon, agent name, status, duration, error, collapsible result preview, transcript path) with enriched run/agent details on the delivery payload.
- **`subagents:usage` token events** — child runtimes capture per-turn token usage and the coordinator emits one event per turn (agentId, agentType, agentName, model, turnNumber, parentSessionId, input, output, cacheRead, cacheWrite), persisted on the run record for the token tracker.

### Fixed
- Duplicate completion deliveries when `get_subagent_result(wait: true)` is called repeatedly — wait links are now deduplicated per (parent, child run) and terminal runs ignore late outcomes.
- Completion notifications no longer embed the full result text — parents retrieve results once via `get_subagent_result`, which now returns a model-facing run summary instead of the raw record (internal metadata stays out of the model context).
- Bare `/agents` now opens the interactive menu instead of the plain tree (empty-args parsing).

## [0.19.0] - 2026-08-03

### Added
- **Subagent system V2** (`src/v2`, opt-in via `subagents.engine: "v2"`) — recursive agent tree with persistent reusable sessions, parent/child question routing with escalation to the human, logical foreground/background waiting, steering, follow-up, bounded concurrency, atomic state persistence, durable outbox and crash recovery.
- `@agnishc/edb-protocol` dependency for the versioned todo RPC.
- Management commands: `/agents`, `/agents tree`, `/agents questions`, `/agents show`, `/agents stop`, `/agents dispose`, `/agents recovery`, `/agents outbox`.

### Changed
- Task integration now goes through the versioned `TodoClient` RPC instead of direct cross-extension events; children never access todo files directly.

## [0.17.0] - 2026-07-27

0.16.0] - 2026-06-22

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
