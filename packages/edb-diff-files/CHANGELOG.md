# Changelog

## [0.10.5] - 2026-05-15

## [0.10.4] - 2026-05-15

## [0.10.3] - 2026-05-15

## [0.8.2] - 2026-05-11

## [0.8.1] - 2026-05-11

## [0.6.0] - 2026-05-11

### Changed
- Migrated all imports and peerDependencies from `@mariozechner/pi-*` to `@earendil-works/pi-*` namespace

## [0.5.1] - 2026-05-05

## [0.5.0] - 2026-05-05

### Fixed
- Open in editor (`o` key) now properly opens terminal editors like nvim by stopping the TUI first, matching pi core behavior

## [0.2.0] - 2026-04-29

### Added
- Initial release: session-scoped file change tracker via write/edit tool events and bash diff snapshots
- Live widget with flash notification on new files per turn
- Footer status bar with created/edited/deleted counts
- `/diff-files` command with full-screen list + inline diff viewer
- Filter by change type, open in editor support
- Configurable via env vars and `~/.pi/settings.json`
