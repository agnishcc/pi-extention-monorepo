# @agnishc/edb-gemini-proxy

A Pi CLI extension that registers a `gemini_proxy` tool — lets the pi agent delegate tasks to **Google's Gemini CLI** running in headless mode.

## Use cases

- Cross-model second opinion (different perspective from Gemini vs the primary agent)
- Tasks that benefit from Gemini's large context window
- Google Search grounding
- Code review, security audit, diff analysis

## Install

```bash
pi install npm:@agnishc/edb-gemini-proxy
```

## Requirements

- `gemini` CLI on PATH (`npm install -g @google/gemini-cli`)
- Auth: `GEMINI_API_KEY` env var, or run `gemini auth` for OAuth
- Set `GEMINI_PATH` env var to override the binary location

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `prompt` | string | The task for Gemini — be specific |
| `systemPrompt` | string? | Role / instructions prepended to context |
| `model` | string? | e.g. `gemini-2.5-pro`, `gemini-2.5-flash` |
| `approvalMode` | string? | `yolo` (default), `auto_edit`, `plan` (read-only) |
| `files` | string[]? | File paths to inject into Gemini's context |
| `includeDirectories` | string[]? | Additional directories for Gemini's workspace |
| `cwd` | string? | Working directory for the Gemini process |

## TUI

- Collapsed: tool call list + response preview with streaming status
- Expanded (`Ctrl+O`): full markdown response with all tool calls and status icons

## License

[MIT](LICENSE) © Agnish Chakraborty
