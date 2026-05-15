# Changelog

## [0.10.6] - 2026-05-15

## [0.10.5] - 2026-05-15

### Changed
- Working indicator no longer includes its own spinner frame in the message — removed double-spinner (the Loader renders the spinner via `setWorkingIndicator`)
- Completion message now uses `setWidget` instead of `setWorkingMessage` so it remains visible after `agent_end` tears down the Loader
- `cancelCompletionTimer` now clears the completion widget immediately when a new agent run starts
- TPS calculator now excludes tool execution time — clock pauses on `tool_execution_start` and resumes on next `message_update`, so TPS reflects actual streaming speed only
- TPS indicator moved to the right side of footer line 2, before the provider/model block
- TPS color is now three-state: red (< 30 t/s), yellow (< 50 t/s), green (≥ 50 t/s); lightning icon remains white
- Usage overlay now uses `DynamicBorder` (full-width, adapts to terminal) replacing the fixed-width 55-char box (imported from `edb-usage-stats`)
- `waitForIdle()` removed from `/usage` command handler — overlay now opens immediately even while the agent is running

## [0.10.4] - 2026-05-15

## [0.10.3] - 2026-05-15

## [0.9.0] - 2026-05-15

### Added
- **Working indicator** (`src/workingIndicator.ts`) — animated status line shown while the agent is processing
  - Claude-style spinner frames (`· ✢ ✳ ✶ ✻ ✽`) at 150ms
  - 162 rotating verbs ("Reticulating...", "Boondoggling...") with 2s rotation
  - Per-character shimmer effect — accent color sweep across the verb text
  - Live elapsed timer ticking every second
  - Tool suffix with Nerd Font icon + rotating witty label (5–10 phrases per tool, 2s rotation)
  - Completion message on agent end: `✓ · Crystallized · 23s`, shown for 3s then cleared
  - Full tool coverage: `bash`, `read`, `write`, `edit`, `ls`, `find`, `grep`, `TaskCreate`, `TaskList`, `TaskGet`, `TaskUpdate`, `TaskOutput`, `TaskStop`, `Agent`, `get_subagent_result`, `steer_subagent`, `ask_user`

### Changed
- Cache read/write indicators now use Nerd Font icons (`󰩺` / `󱀚`) instead of plain `R`/`W` text, with `R`/`W` fallback when Nerd Fonts are unavailable

## [0.8.2] - 2026-05-11

## [0.8.1] - 2026-05-11

## [0.6.0] - 2026-05-11

### Changed
- Migrated all imports and peerDependencies from `@mariozechner/pi-*` to `@earendil-works/pi-*` namespace

## [0.5.1] - 2026-05-05

## [0.5.0] - 2026-05-05

## [0.2.0] - 2026-04-29

### Added
- Initial release: two-line footer with path, git branch, token stats, cost, context %, and model
- Optional third line for extension statuses
- Git dirty/ahead/behind indicators refreshed after every turn
