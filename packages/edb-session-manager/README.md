# @agnishc/edb-session-manager

A Pi CLI extension for browsing, resuming, renaming, and deleting sessions from a searchable overlay.

## Features

- **Fuzzy search** across session titles and first messages
- **Workspace / all scope toggle** — `Tab` to switch between current-directory sessions and all sessions
- **Inline rename** — rename any session, including ones not currently active
- **Delete with confirmation**
- **Status bar** shows the active session name
- **Shortcut** `Ctrl+Shift+R` to open without typing a command

## Install

```bash
pi install npm:@agnishc/edb-session-manager
```

## Usage

```
/sessions
```

| Key | Action |
|-----|--------|
| `↑↓` | Navigate list |
| `Enter` | Resume selected session |
| `n` | Rename selected session |
| `d` | Delete selected session |
| `Tab` | Toggle workspace / all scope |
| `Esc` | Close |

## License

[MIT](LICENSE) © Agnish Chakraborty
