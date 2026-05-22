# @agnishc/edb-bridge

A Pi CLI extension providing a lightweight inter-session message bus for orchestrator/sub-agent workflows.

## Features

- **Unix socket broker** — auto-spawned, zero config
- **ask_supervisor** — sub-agent blocks until orchestrator answers (10-min timeout)
- **notify_parent** — sub-agent sends fire-and-forget progress updates to orchestrator
- **answer_subagent** — orchestrator replies to a pending sub-agent question
- **Internal pi.events API** — other extensions coordinate via `bridge:ready`, `bridge:task_updated`

## How it works

When edb-bridge is installed, each pi session connects to a shared broker process at startup. Sub-agents get `ask_supervisor` and `notify_parent` tools when `PI_BRIDGE_PARENT_SESSION` is set in their environment. The orchestrator uses `answer_subagent` to respond.

## Environment variables (injected by edb-subagents)

| Variable | Description |
|---|---|
| `PI_BRIDGE_PARENT_SESSION` | Broker session ID of the parent orchestrator |
| `PI_BRIDGE_AGENT_ID` | edb-subagents agent ID (for routing) |

## Internal pi.events API

| Event | Emitted by | Payload |
|---|---|---|
| `bridge:ready` | edb-bridge | `{ sessionId: string }` |
| `bridge:task_updated` | edb-todo | `{ storePath: string }` |

## Install

```bash
pi install npm:@agnishc/edb-bridge
```

## License

MIT © Agnish Chakraborty
