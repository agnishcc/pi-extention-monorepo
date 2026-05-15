# @agnishc/edb-subagents

Claude Code-style autonomous sub-agents for pi. Spawn specialized agents that run in isolated sessions — each with its own tools, system prompt, model, and thinking level. Run them in foreground or background, steer them mid-run, resume completed sessions, and define your own custom agent types.

Forked from [tintinweb/pi-subagents](https://github.com/tintinweb/pi-subagents) and extended as part of the edb monorepo.

## Install

```bash
pi install npm:@agnishc/edb-subagents
```

## Features

- **Live widget** — persistent above-editor widget with animated spinners, live tool activity, token counts, and context utilisation
- **Parallel background agents** — spawn multiple agents concurrently with automatic queuing
- **Conversation viewer** — `/agents` → select a running agent to see its full conversation live
- **Custom agent types** — define agents in `.pi/agents/<name>.md` with YAML frontmatter
- **Mid-run steering** — inject messages into running agents via `steer_subagent`
- **Session resume** — continue a previous agent's full conversation context
- **Graceful turn limits** — agents wrap up cleanly before hard abort
- **Git worktree isolation** — run agents in isolated repo copies
- **Persistent agent memory** — three scopes: project, local, user
- **Scheduled agents** — cron, interval, and one-shot scheduling
- **Cross-extension RPC** — spawn/stop agents from other extensions via `pi.events`

## Quick start

```
Agent({
  subagent_type: "Explore",
  prompt: "Find all files that handle authentication",
  description: "Find auth files",
  run_in_background: true,
})
```

## Custom agents

Create `.pi/agents/<name>.md`:

```markdown
---
description: Security Code Reviewer
tools: read, grep, find, bash
model: anthropic/claude-opus-4-6
thinking: high
max_turns: 30
---

You are a security auditor. Review code for vulnerabilities...
```

## Commands

| Command | Description |
|---|---|
| `/agents` | Interactive agent management — view running agents, manage types, create new agents, settings |

## Attribution

Core implementation by [tintinweb](https://github.com/tintinweb/pi-subagents), MIT licensed.
