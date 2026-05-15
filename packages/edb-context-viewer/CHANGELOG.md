# Changelog

## [Unreleased]

## [0.10.4] - 2026-05-15

## [0.10.3] - 2026-05-15

## [0.9.0] - 2026-05-15

### Changed
- Replaced `/system-prompt-data` and `/total-context-data` commands with a single unified `/context-viewer` command
- New tabbed overlay UI with five tabs: **Stats**, **System**, **Tools**, **Messages**, **Full**
- Tab navigation with `Tab` / `Shift+Tab`

### Added
- **Stats tab** — token distribution grid (10×5 colored blocks) + per-category breakdown table, inspired by [pi-context](https://github.com/ttttmr/pi-context)
- **Tools tab** — scrollable view of all active tool definitions with parameter schemas
- `formatTokens` utility (k/M suffixes)
- `StatsTabContent`, `ScrollableTabContent`, `TabbedOverlay` components

## [0.8.2] - 2026-05-11

## [0.8.1] - 2026-05-11

## [0.6.0] - 2026-05-11

### Changed
- Migrated all imports and peerDependencies from `@mariozechner/pi-*` to `@earendil-works/pi-*` namespace

## [0.5.1] - 2026-05-05

## [0.5.0] - 2026-05-05

## [0.4.0] - 2026-04-30

### Added
- `/system-prompt-data` command — scrollable overlay showing the full system prompt with line numbers, search, and clipboard copy
- `/total-context-data` command — scrollable overlay showing the complete LLM context (system prompt + all messages) with search and clipboard copy
