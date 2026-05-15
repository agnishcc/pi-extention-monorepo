# Changelog

## [Unreleased]

### Changed
- Added `promptSnippet` to all three tools (`Agent`, `get_subagent_result`, `steer_subagent`) so they appear in the system prompt's Available tools section

## [0.10.4] - 2026-05-15

## [0.10.3] - 2026-05-15

### Added
- Initial release — forked from tintinweb/pi-subagents and adapted for the edb monorepo
- Updated all imports from `@mariozechner/*` to `@earendil-works/*`
- Tool description now dynamically reflects only enabled agents (no hardcoded default-agent guidelines)
