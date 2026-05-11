# Changelog

## [Unreleased]

## [0.6.0] - 2026-05-11

### Changed
- Migrated all imports and peerDependencies from `@mariozechner/pi-*` to `@earendil-works/pi-*` namespace

## [0.5.1] - 2026-05-05

### Added
- Expose the current session name to agents by appending it to the system prompt before agent startup.

## [0.5.0] - 2026-05-05

## [0.2.0] - 2026-04-29

### Added
- Initial release: replaces Pi's default first-message session label with a generated session title
- Uses the `opencode/big-pickle` model to generate a concise session title after the first user message
- Shows interactive notifications while auto-naming runs and when the session title is set
