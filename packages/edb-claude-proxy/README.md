# @agnishc/edb-claude-proxy

A Pi CLI extension that registers a `claude_proxy` tool — lets the pi agent delegate tasks to **Claude Code CLI** running in non-interactive (`--print`) mode.

## Use cases

- Code review and security audit
- Diff analysis and documentation
- Architectural second opinion
- Any task where a second model perspective is valuable

## Install

```bash
pi install npm:@agnishc/edb-claude-proxy
```

## Requirements

- `claude` CLI on PATH ([Claude Code](https://docs.anthropic.com/claude/docs/claude-code))
- Set `CLAUDE_PATH` env var to override the binary location

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `prompt` | string | The task for Claude — be specific |
| `systemPrompt` | string? | Expert persona (e.g. "You are a senior security engineer") |
| `model` | string? | `sonnet` (default), `opus`, `haiku`, or full model name |
| `allowedTools` | string[]? | Tools Claude may use. Defaults to `["Read"]` |
| `files` | string[]? | File paths to inject into Claude's context |
| `cwd` | string? | Working directory for the Claude process |

## TUI

- Collapsed: shows tool calls (read/bash/edit) and a response preview
- Expanded (`Ctrl+O`): full markdown-rendered response with all tool calls

## License

[MIT](LICENSE) © Agnish Chakraborty
