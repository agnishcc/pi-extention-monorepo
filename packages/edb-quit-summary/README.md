# edb-quit-summary

A [pi](https://pi.dev) extension that prints a session summary to your terminal when you quit pi.

When you hit `/quit` (or Ctrl+C twice), pi exits and you'll see a formatted summary like:

```
  ── Session Summary ──

  Session:    Refactor auth module
  Duration:   23m 45s
  Model:      anthropic/claude-sonnet-4-5

  Messages:
    User:       8
    Assistant:  8
    Tool calls: 24

  Tools used:
    edit           12×
    bash            6×
    read            4×
    grep            2×

  Tokens:
    Input:        45.2k  ████████████░░░░
    Output:       12.8k  ████░░░░░░░░░░░░
    Cache read:   38.1k  ███████████░░░░░
    Cache write:   5.3k
    ────────────────────────────────────
    Total:       101.4k

  Cost:        $0.34

  ─────────────────────────────
```

## How It Works

Pi uses an alternate screen buffer for its TUI. When pi exits, the terminal restores the original buffer, wiping anything printed during the session. This extension works around that by:

1. Collecting stats on the `session_shutdown` event (when `reason === "quit"`)
2. Registering a `process.on('exit')` callback that fires **after** the TUI is torn down
3. Writing the formatted summary directly to `process.stdout`

## Installation

### As a pi package (recommended)

```bash
pi install npm:@agnishc/edb-quit-summary
```

### Manual

Copy `src/index.ts` to `~/.pi/agent/extensions/quit-summary.ts`.

## Configuration

No configuration needed — it just works. The summary only prints on quit, not on `/new`, `/resume`, `/fork`, or `/reload`.
