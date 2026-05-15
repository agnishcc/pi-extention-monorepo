# Changelog

## [0.10.3] - 2026-05-15

## [0.9.0] - 2026-05-15

### Added
- `todo_create` tool — create individual tasks with `content`, `description`, `priority`, `activeForm`, and `metadata`
- `todo_get` tool — retrieve full task details: description, dependencies (`blocks`/`blockedBy`), metadata
- `todo_update` tool — update individual tasks (status, content, description, priority, owner); add dependency edges (`addBlocks`/`addBlockedBy`); `status: "deleted"` permanently removes the task
- **File-backed storage** — tasks now persist to disk with file locking and atomic writes
  - `memory`: in-memory only (lost on session end)
  - `session` *(default)*: per-session file at `<cwd>/.pi/tasks/tasks-<sessionId>.json`
  - `project`: shared across all sessions at `<cwd>/.pi/tasks/tasks.json`
- **Dependency management** — bidirectional `blocks`/`blockedBy` edges with cycle detection and warnings
- **Auto-clear completed tasks** — configurable via settings: `never` / `on_list_complete` *(default)* / `on_task_complete`; turn-based delay so completions linger briefly before disappearing
- **Settings panel** — `/todos → ⚙ Settings` opens a native TUI settings panel (taskScope + autoClearCompleted); saved to `<cwd>/.pi/tasks-config.json`
- **System-reminder injection** — periodic `<system-reminder>` nudges appended to non-task tool results after `REMINDER_INTERVAL` turns of inactivity, encouraging the model to keep tasks up to date
- **Enhanced widget** — animated star spinner (✳✴✵…) for in-progress tasks, elapsed time display (e.g. `42s`, `2m 5s`), blocked-by hints inline
- `PI_TODO` environment variable override: `off` (memory only), named list (`~/.pi/tasks/<name>.json`), or absolute/relative path
- `/todos` command now shows a select-based menu with View / Clear completed / Clear all / Settings

### Changed
- Widget placement changed from status bar to **above editor** (persistent, always visible)
- Session state no longer reconstructed from tool-result branch entries — file-backed store is the source of truth
- `todo_write` now merges `blocks`, `blockedBy`, and `metadata` from existing tasks when a task ID is reused (non-destructive for dependency edges)
- System prompt injection now includes task IDs and blocked-by info
- `priorityLabel` now correctly outputs `High`/`Medium`/`Low`

## [0.8.2] - 2026-05-11

### Added
- `todo_remove` tool — permanently remove tasks by ID
- Interactive keyboard navigation in `/todos` viewer (↑↓/jk, g/G, Home/End)
- Toggle completed task visibility with `c` key in `/todos` viewer
- Timestamps on tasks: `createdAt`, `startedAt`, `completedAt`
- Status transition tracking — timestamps update automatically when tasks move between states
- Percentage display in progress bar

### Changed
- Replaced module-level mutable globals (`tasks`, `idCounter`) with `TodoStore` class
- Deduplicated rendering logic — shared `priorityColor()`, `priorityLabel()` helpers used everywhere
- Priority labels now display as `High`/`Medium`/`Low` instead of `HIG`/`MED`/`LOW`
- In-progress icon changed from `→` to `●` for visual consistency
- `/todos` viewer now shows cursor indicator (`❯`) on focused task
- Section headers show task counts
- Updated widget status bar to use `●` for active count
- `todo_write` prompt guidelines now explicitly state completed tasks are never auto-deleted

### Fixed
- Rendering inconsistency between widget, viewer, and tool results — all now use the same styling

## [0.8.1] - 2026-05-11

## [0.6.0] - 2026-05-11

### Changed
- Migrated all imports and peerDependencies from `@mariozechner/pi-*` to `@earendil-works/pi-*` namespace

## [0.5.1] - 2026-05-05

## [0.5.0] - 2026-05-05

## [0.2.0] - 2026-04-29

### Added
- Initial release: `todo_write` and `todo_read` tools
- Live widget above editor showing up to 4 active tasks
- System-prompt injection before every agent turn to prevent goal drift
- `/todos` command with full-screen interactive viewer and progress bar
- Session branch reconstruction so task state survives `/tree` navigation and forking
