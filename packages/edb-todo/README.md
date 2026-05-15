# @agnishc/edb-todo

A Pi CLI extension that gives the agent a structured task list to prevent **goal drift** — the tendency for agents to lose track of the original plan as context grows and tool calls accumulate.

## Features

- **6 LLM tools** — `TaskCreate`, `TaskList`, `TaskGet`, `TaskUpdate`, `TaskOutput`, `TaskStop` — matching pi-tasks behavior
- **Persistent widget** — live task list above the editor with animated spinner (✳✽), elapsed time, and blocked-by hints
- **File-backed storage** — memory / session / project scope with file locking and atomic writes
- **Dependency management** — bidirectional `blocks` / `blockedBy` edges with cycle detection
- **Auto-clear completed tasks** — configurable: never / on_list_complete / on_task_complete
- **System-reminder injection** — periodic nudges when task tools haven't been used recently
- **Settings panel** — `/todos → ⚙ Settings` (task storage + auto-clear, saved to `tasks-config.json`)
- **Priority system** — high / medium / low with color coding (Red / Yellow / Dim)

## How it works

1. The agent uses `TaskCreate` to plan multi-step work as a structured task list
2. Before every agent turn, active tasks are injected into the system prompt
3. A live widget above the editor shows tasks with status icons and elapsed time for active tasks
4. Tasks persist to disk per-session (or project-wide) and survive session resume
5. Completed tasks remain visible until auto-cleared or manually removed

## Tools

### `TaskCreate`

Create a structured task. Used proactively for complex multi-step work.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `content` | string | ✓ | Brief actionable title in imperative form |
| `description` | string | | Detailed context and acceptance criteria |
| `priority` | `high` \| `medium` \| `low` | | Default: `medium` |
| `activeForm` | string | | Spinner text when in_progress (e.g., "Running tests") |
| `metadata` | object | | Arbitrary key-value pairs |

### `TaskList`

List all tasks sorted by status (pending first, then in_progress, then completed) and ID.

Returns each task's id, content, status, priority, and open blockedBy entries.

### `TaskGet`

Get full details for a specific task by ID — including description, dependencies, and metadata.

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | The task ID |

### `TaskUpdate`

Update task fields, status, and dependencies.

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Task ID (required) |
| `status` | `pending` \| `in_progress` \| `completed` \| `deleted` | New status (`deleted` permanently removes) |
| `content` | string | New title |
| `description` | string | New description |
| `priority` | `high` \| `medium` \| `low` | New priority |
| `activeForm` | string | Spinner text |
| `owner` | string | Agent/owner name |
| `metadata` | object | Shallow merge (set key to `null` to delete) |
| `addBlocks` | string[] | Task IDs this task blocks |
| `addBlockedBy` | string[] | Task IDs that block this task |

Setting `status: "deleted"` permanently removes the task and cleans up all dependency edges.

Dependencies are bidirectional — `addBlocks: ["t2"]` on task `t1` also adds `blockedBy: ["t1"]` to task `t2`.

### `TaskOutput`

Retrieve output from a running or completed background task process.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `task_id` | string | — | Task ID (required) |
| `block` | boolean | `true` | Wait for completion |
| `timeout` | number | `30000` | Max wait time in ms (max 600000) |

### `TaskStop`

Stop a running background task process. Sends SIGTERM, waits 5 seconds, then SIGKILL. Marks the task as completed.

| Parameter | Type | Description |
|-----------|------|-------------|
| `task_id` | string | Task ID to stop |

## Task lifecycle

```
pending → in_progress → completed
                      → deleted  (permanently removed)
```

## Dependency management

```bash
# Task t2 cannot start until t1 is completed
TaskUpdate { id: "t2", addBlockedBy: ["t1"] }
```

Edges are bidirectional. The widget and `TaskList` show open blockers inline (`› blocked by #t1`). Cycles and self-dependencies produce warnings but are stored.

## Task storage

Configured via `/todos → ⚙ Settings` or the `PI_TODO` environment variable:

| Mode | File | Behaviour |
|------|------|-----------|
| `memory` | *(none)* | In-memory only — tasks lost when session ends |
| `session` *(default)* | `<cwd>/.pi/tasks/tasks-<sessionId>.json` | Per-session, survives resume |
| `project` | `<cwd>/.pi/tasks/tasks.json` | Shared across all sessions in the project |

Settings are saved to `<cwd>/.pi/tasks-config.json`.

### Environment variable override

| Variable | Value | Behaviour |
|----------|-------|-----------|
| `PI_TODO` | `off` | In-memory only (CI/automation) |
| `PI_TODO` | `sprint-1` | Named shared list at `~/.pi/tasks/sprint-1.json` |
| `PI_TODO` | `/abs/path.json` | Explicit absolute file path |

## Auto-clear completed tasks

| Mode | Behaviour |
|------|-----------|
| `never` | Completed tasks stay visible until manually cleared |
| `on_list_complete` *(default)* | Cleared after all tasks complete and a few idle turns pass |
| `on_task_complete` | Each task cleared individually a few turns after completion |

## Widget

Persistent task list rendered above the editor:

```
● 4 tasks (1 done, 1 in progress, 2 open)
  ✔ Design the API
  ✳ Implementing auth…  (42s)
  ◻ Write tests  › blocked by #t2
  ◻ Update docs
```

| Icon | Meaning |
|------|---------|
| `✔` | Completed (strikethrough + dim) |
| `◼` | In-progress |
| `✳`/`✽` | Animated spinner — actively executing (shows elapsed time) |
| `◻` | Pending |

## `/todos` command

```
/todos  — open the interactive task manager
```

Menu options:
- **View all tasks** — select a task to start / complete / delete it
- **Clear completed** — remove all completed tasks
- **Clear all** — remove all tasks
- **⚙ Settings** — configure task storage and auto-clear

## Install

```bash
pi install npm:@agnishc/edb-todo
```

## License

[MIT](LICENSE) © Agnish Chakraborty
