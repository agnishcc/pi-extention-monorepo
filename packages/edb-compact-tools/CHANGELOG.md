# Changelog

## [Unreleased]

## [0.10.9] - 2026-05-18

## [0.10.8] - 2026-05-18

## [0.11.0] - 2026-05-18

### Changed
- **Breaking:** Modularized codebase into 9 focused modules for better maintainability
  - `types.ts` — shared TypeScript types (`CompactTheme`, `BuiltinToolName`, `BuiltinTool`, `ToolBlockKind`)
  - `constants.ts` — rendering limits, patch symbols, emoji sets, OSC133 markers, ANSI codes
  - `text.ts` — text utility functions (`oneLine`, `clip`, `lineCount`, `textContent`, etc.)
  - `tool-meta.ts` — tool metadata registry with per-tool colors, icons, labels, and summaries
  - `tool-block.ts` — `EmptyBlock` and `ToolBlock` classes (box-drawing renderer)
  - `tool-renderer.ts` — `renderCall` and `renderResult` functions
  - `message-frame.ts` — message framing functions for user/assistant messages
  - `patches.ts` — tool and message renderer installation
  - `index.ts` — thin entry point

### Added
- Purple outline color for `read` tool when reading skill files (`.agents/skills/` or `.pi/agent/skills/`)
- `tool-meta.ts` uses a declarative registry object pattern for tool metadata
- `frameAssistantMessage` export (renamed from `_frameAssistantMessage`)

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
