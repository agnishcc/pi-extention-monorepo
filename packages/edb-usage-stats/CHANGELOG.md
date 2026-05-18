# Changelog

## [0.10.9] - 2026-05-18

## [0.10.8] - 2026-05-18

## [0.10.6] - 2026-05-15

## [0.10.5] - 2026-05-15

### Changed
- Replaced fixed-width 55-char box layout with `DynamicBorder` (full terminal width, adapts automatically)
- Provider name now uses accent color; label line colored by severity (dim when safe, colored when ≤ 30% remaining)
- Progress bar width now scales with terminal width (18–42 chars) instead of fixed 12 chars
- Bar + usage string on separate lines (label line then bar + `% left`), matching pi-quotas style
- Reset time moved to its own subtitle line (`Resets in …`)
- Loading state now uses animated `Loader` spinner instead of static text
- Removed `waitForIdle()` from command handler — overlay opens immediately even while agent is running

## [0.10.4] - 2026-05-15

## [0.10.3] - 2026-05-15

## [0.8.2] - 2026-05-11

## [0.8.1] - 2026-05-11

## [0.6.0] - 2026-05-11

### Changed
- Migrated all imports and peerDependencies from `@mariozechner/pi-*` to `@earendil-works/pi-*` namespace

## [0.5.1] - 2026-05-05

## [0.5.0] - 2026-05-05

## [0.2.0] - 2026-04-29

### Added
- Initial release: `/usage` command with provider rate window boxes
- Live service status indicators (operational / minor / major / critical / maintenance)
- Provider settings panel with opt-in toggle per provider
- Support for: Claude, Copilot, Gemini, Codex, Antigravity, MiniMax, OpenRouter, Kiro, z.ai
