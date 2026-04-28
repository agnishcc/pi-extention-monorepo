# @agnishc/edb-diff-files

A Pi CLI extension that tracks every file the agent touches during a session and shows them in a live widget above the editor. Opens a full-screen diff viewer on demand.

## Features

- **Live widget** — updates above the editor after every turn showing `+ created`, `~ edited`, `- deleted` files
- **Flash notification** — briefly highlights newly added files at the end of each turn
- **Footer status** — compact `D(+N ~N -N)` indicator always visible
- **Inline diff viewer** — press Enter on any file to see a syntax-coloured unified diff
- **Filter by type** — cycle through all / created / edited / deleted with `f`
- **Open in editor** — press `o` to open the file in your configured GUI editor

## Install

```bash
pi install npm:@agnishc/edb-diff-files
```

## Usage

```
/diff-files
```

| Key | Action |
|-----|--------|
| `j`/`k` or `↑`/`↓` | Navigate file list |
| `Enter` | Open inline diff for selected file |
| `o` | Open file in GUI editor |
| `f` | Cycle filter: all → created → edited → deleted |
| `Esc` | Close / back to list |

## Configuration

Set via environment variables or `~/.pi/settings.json`:

| Variable | Default | Description |
|----------|---------|-------------|
| `FILES_WIDGET_MAX_LINES` | `8` | Max files shown in widget |
| `FILES_WIDGET_SHOW_HEADER` | `true` | Show "N files changed" header |
| `FILES_WIDGET_INCLUDE_DELETED` | `false` | Include deleted files in widget |

## License

[MIT](LICENSE) © Agnish Chakraborty
