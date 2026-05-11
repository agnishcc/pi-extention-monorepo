# @agnishc/edb-todo

A Pi CLI extension that gives the agent a structured task list to prevent **goal drift** — the tendency for agents to lose track of the original plan as context grows and tool calls accumulate.

## How it works

1. The agent calls `todo_write` to plan multi-step work as an explicit task list
2. Before every agent turn, active tasks are injected into the system prompt so the model always knows what remains and what it's currently doing
3. A live widget above the editor shows the current task list at all times
4. State is reconstructed from the session branch, so `/tree` navigation and forking work correctly
5. Completed tasks remain visible in the list — they are never auto-deleted, providing a full audit trail

## Tools

| Tool | Description |
|------|-------------|
| `todo_write` | Replace the entire task list (atomic update) — always pass all tasks |
| `todo_read` | Read the current task list and statuses |
| `todo_remove` | Permanently remove tasks by ID — use for cleanup, not for completed tasks |

## Task statuses

| Status | Icon | Meaning |
|--------|------|---------|
| `pending` | `○` | Not started |
| `in_progress` | `●` | Actively working — only one at a time |
| `completed` | `✓` | Done — remains in the list |

## Task priorities

| Priority | Label | Color |
|----------|-------|-------|
| `high` | High | Red |
| `medium` | Medium | Yellow |
| `low` | Low | Dim |

## Interactive viewer

```
/todos       — open the full-screen task viewer
```

Keyboard controls in the viewer:

| Key | Action |
|-----|--------|
| `↑` / `k` | Move cursor up |
| `↓` / `j` | Move cursor down |
| `g` / `Home` | Jump to first task |
| `G` / `End` | Jump to last task |
| `c` | Toggle completed tasks visibility |
| `Esc` / `Ctrl+C` | Close viewer |

## Install

```bash
pi install npm:@agnishc/edb-todo
```

## License

[MIT](LICENSE) © Agnish Chakraborty
