# Changelog

## [Unreleased]

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
