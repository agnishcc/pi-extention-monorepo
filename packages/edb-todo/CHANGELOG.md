# Changelog

## [0.21.1] - 2026-08-06

## [0.21.0] - 2026-08-06

## [0.20.0] - 2026-08-03


## [0.20.1] - 2026-08-03

### Removed
- `edb-bridge` event listeners removed (`bridge:task_updated`, `bridge:notify_parent`, `bridge:ask_supervisor`, `bridge:supervisor_answered`) — the bridge package is dropped; sub-agent task sync now flows through the versioned todo RPC (`edb:todo:v1:*`).

### Added
- `TaskService` application layer shared by the existing tools and the new versioned RPC server (`edb:todo:v1:*` events).
- Idempotency ledger for mutating RPC operations (replay-safe by `operationId`).

### Changed
- File store locking is asynchronous (no synchronous busy-wait); `createMany` is a single transactional write; dependency cycles/self-links are rejected before commit; corrupt files are preserved as `.corrupt-<timestamp>` instead of silently treated as empty.
- Explicit `cancelled`/`failed` handling in schemas, prompt and widget; widget/store cleanup on `session_shutdown`.

## [0.17.0] - 2026-07-27

0.16.0] - 2026-06-22

## [0.12.0] - 2026-05-22

## [0.10.9] - 2026-05-18

### Added
- **Subtask support** — `TaskCreate` gains optional `parentId` param; tasks with a `parentId` render as indented subtasks in the widget
- **Parallel group support** — `TaskCreate` gains optional `groupId` param; tasks in the same group are treated as parallel; a downstream task can set `blockedByGroup` to wait until all tasks in the group complete
- **`blocked` status** — new task lifecycle state for in-progress tasks waiting for a supervisor answer; widget renders ⏸ with question preview
- **`blockQuestion` / `blockMessageId` / `blockedAt` fields** — store the pending question text and bridge message ID when a task is blocked
- **Attribution display** — tasks where `owner` is set show `[agent-id]` in the widget; orchestrator-created tasks (no owner) show no annotation
- **Tree widget rendering** — widget now shows tasks followed by their subtasks (indented), replacing the flat list
- **`blocked` count in widget header** — summary line shows blocked task count in warning colour
- **edb-bridge integration** — listens for `bridge:task_updated` events and refreshes widget when a sub-agent writes to the shared store; emits `bridge:task_updated` after every task mutation so the parent session widget stays in sync
- **`todo:store_path` event** — emits the active store file path so edb-subagents can inject it into sub-agent system prompts
- **System prompt store injection** — reads `<task_store_path>` XML tag from the system prompt (injected by edb-subagents at spawn time) to point sub-agent sessions at the parent's shared task store
- **`isGroupComplete()` / `getReadyTasks()`** — new store helpers for group-join resolution

### Changed
- `TaskList` output now includes subtask annotation (`[subtask of #id]`), owner, blocked question preview, and group wait status
- `TaskGet` output now includes `parentId`, `groupId`, `blockedByGroup`, and blocked question details
- `TaskUpdate` handles `blocked` status transitions: sets `blockedAt`, clears `blockQuestion`/`blockMessageId` on unblock
- Widget `MAX_VISIBLE_TASKS` raised from 10 to 12
- `statusOrder` in `TaskList` updated to include `blocked` (ordered after `in_progress`)

## [0.10.8] - 2026-05-18

## [0.10.6] - 2026-05-15

## [0.10.5] - 2026-05-15

### Changed
- Added `promptSnippet` to all six tools (`TaskCreate`, `TaskList`, `TaskGet`, `TaskUpdate`, `TaskOutput`, `TaskStop`) so they appear in the system prompt's Available tools section

## [0.10.4] - 2026-05-15

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
