# @agnishc/edb-context-viewer

Pi CLI extension for inspecting the full LLM context. A single command opens a tabbed overlay where you can explore token usage, the system prompt, tool definitions, messages, and the complete context — all in one place.

## Command

```
/context-viewer
```

Opens a tabbed overlay with five views you can navigate using `Tab` / `Shift+Tab`.

## Tabs

| Tab | What it shows |
|-----|--------------|
| **Stats** | Token distribution grid (10×5 colored blocks) + per-category breakdown table |
| **System** | The full system prompt (includes tools, skills, guidelines, AGENTS.md, etc.) |
| **Tools** | All active tool definitions with descriptions and parameter schemas |
| **Messages** | All session messages (user, assistant, tool calls/results) |
| **Full** | Complete context dump: system prompt + messages + usage stats |

### Stats tab

Visualizes how the context window is used, broken down by category:

- **System Prompt** — the static system prompt text
- **System Tools** — tool definition schemas
- **Tool Calls** — tool call arguments and results
- **Messages** — user/assistant conversation text
- **Available** — unused context window space

Token counts are estimated using a 4-chars-per-token heuristic, then scaled proportionally to match the actual total reported by the API.

## Controls

| Key | Action |
|-----|--------|
| `Tab` | Next tab |
| `Shift+Tab` | Previous tab |
| `↑` / `k` | Scroll up (content tabs) |
| `↓` / `j` | Scroll down (content tabs) |
| `Page Up` / `Ctrl+B` | Scroll up one page |
| `Page Down` / `Ctrl+F` | Scroll down one page |
| `Ctrl+U` / `Ctrl+D` | Scroll half page |
| `Home` / `g` | Jump to top |
| `End` / `G` | Jump to bottom |
| `/` | Search (live matching as you type) |
| `n` / `N` | Next / previous match |
| `y` | Copy full content to clipboard |
| `Escape` / `q` | Close overlay |

## Install

```bash
pi install npm:@agnishc/edb-context-viewer
```

## License

[MIT](LICENSE) © Agnish Chakraborty
