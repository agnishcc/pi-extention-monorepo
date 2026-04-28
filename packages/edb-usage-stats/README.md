# @agnishc/edb-usage-stats

A Pi CLI extension that shows AI provider token usage, rate limits, reset timers, and live service status via the `/usage` command.

## Supported providers

| Provider | Usage source |
|----------|-------------|
| Claude (Anthropic) | Anthropic API |
| GitHub Copilot | GitHub API |
| Gemini | Gemini CLI |
| OpenAI Codex | OpenAI API |
| Antigravity | Antigravity API |
| MiniMax | MiniMax API |
| OpenRouter | OpenRouter API |
| Kiro | kiro-cli |
| z.ai | z.ai API |

## Install

```bash
pi install npm:@agnishc/edb-usage-stats
```

## Usage

```
/usage
```

Opens a rate-window box for each enabled provider:

```
╭────────────────────────────╮
│ AI Usage                   │
├────────────────────────────┤
│ Claude                     │
│  Daily   ████░░░░░░  62%   │
│  Hourly  ██████████   0%   │
├────────────────────────────┤
│ r refresh · s settings · Esc close │
╰────────────────────────────╯
```

Press `s` to open the provider settings panel and toggle which providers are shown. Settings persist to `~/.pi/agent/extensions/pi-usage-stats/settings.json`.

## License

[MIT](LICENSE) © Agnish Chakraborty
