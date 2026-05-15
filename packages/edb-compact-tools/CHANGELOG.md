# Changelog

## [Unreleased]

## [0.10.6] - 2026-05-15

## [0.10.5] - 2026-05-15

### Changed
- Brightened call label and status summary colors (`dim`/`muted` → `toolOutput`) for improved legibility
- Removed background fill from expanded body lines — output now renders on terminal background for better contrast
- Added blank line after separator and after closing box border for visual breathing room
- Reduced max line width from 180 to 120 characters
- Added `promptSnippet` forwarded from built-in tool definitions so overridden tools (`bash`, `read`, `grep`, `find`, `ls`, `edit`, `write`) still appear in the system prompt's Available tools section

## 0.1.0

- Initial compact outlined renderers for `read`, `bash`, `grep`, `find`, and `ls`.
