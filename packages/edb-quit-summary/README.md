# edb-quit-summary

A [pi](https://pi.dev) extension that prints a session summary to your terminal when you quit pi.

When you hit `/quit` (or Ctrl+C twice), pi exits and you'll see a compact summary like:

```
  Session Summary / quit
  ─────────────────────────────────────────────────────
    /\_/\      Session   Refactor auth module
   < ▓ ▓ >     Duration  23m 45s
     \___/     Model     anthropic/claude-sonnet-4-5

               Messages  8 user / 8 assistant
               Tools     24 · edit 12× · bash 6× · read 4×

               Tokens    101.4k total  45.2k in  12.8k out
               Cost      $0.34
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
