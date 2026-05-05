# Changelog

## [Unreleased]

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
