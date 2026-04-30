# @agnishc/edb-context-viewer

Pi CLI extension for inspecting the LLM context. Two commands let you see exactly what the model sees:

- **`/system-prompt-data`** — full system prompt with line numbers
- **`/total-context-data`** — complete LLM context (system prompt + all messages + usage stats)

Both open as scrollable overlay popups with search and clipboard copy.

## Commands

| Command | What it shows |
|---------|--------------|
| `/system-prompt-data` | The full system prompt (includes tools, skills, guidelines, AGENTS.md, etc.) |
| `/total-context-data` | System prompt + all messages (user, assistant, tool calls/results) + context usage stats |

## Controls

| Key | Action |
|-----|--------|
| `↑` / `k` | Scroll up |
| `↓` / `j` | Scroll down |
| `Page Up` / `Ctrl+B` | Scroll up one page |
| `Page Down` / `Ctrl+F` | Scroll down one page |
| `Ctrl+U` / `Ctrl+D` | Scroll half page |
| `Home` / `g` | Jump to top |
| `End` / `G` | Jump to bottom |
| `/` | Search (live matching as you type) |
| `n` / `N` | Next / previous match |
| `y` | Copy full content to clipboard |
| `Escape` / `q` | Close popup |

## Install

```bash
pi install npm:@agnishc/edb-context-viewer
```

## License

[MIT](LICENSE) © Agnish Chakraborty
