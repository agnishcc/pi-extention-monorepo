# @agnishc/edb-system-prompt-watch

A Pi CLI extension that alerts when Pi's bundled default system prompt source changes, and provides an interactive comparison tool (`/prompt-diff`) to see what upstream additions or modifications you are missing.

This is for setups where you use your own `SYSTEM.md`, but still want to know when Pi's upstream default prompt changed so you can review and merge useful updates.

## Features

- **Automatic Startup Alert**: Detects upstream system prompt changes across Pi version updates and prompts you to review.
- **Generic Package Discovery**: Automatically resolves where Pi is installed across global npm, pnpm, yarn, bun, standalone binaries, or development checkouts.
- **Interactive Diff Overlay (`/prompt-diff`)**:
  - **Summary**: Highlights guidelines/tools you don't have, modified guidelines, and your custom additions.
  - **Diff**: Color-coded line-by-line unified diff against the bundled default prompt.
  - **Active Prompt**: Full view of your active system prompt with line numbers.
  - **Default Prompt**: Full view of the upstream bundled default prompt with line numbers.

## Commands

- `/prompt-diff` (or `/system-prompt-diff`) — Opens the interactive tabbed comparison overlay.

## Behavior

On Pi startup, the extension:

1. Dynamically discovers the active `@earendil-works/pi-coding-agent` installation.
2. Hashes the installed system prompt source.
3. Compares it with the baseline stored in `~/.pi/agent/state/system-prompt-watch.json`.
4. Shows a notification if the upstream prompt changed.
5. Updates the baseline hash for subsequent runs.

## Install

```bash
pi install npm:@agnishc/edb-system-prompt-watch
```

## License

[MIT](LICENSE) © Agnish Chakraborty
