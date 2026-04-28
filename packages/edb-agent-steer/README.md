# @agnishc/edb-agent-steer

A Pi CLI extension that intercepts messages sent while the agent is already running and presents a compact single-keypress prompt:

```
  ↵  "your message here"

  s steer   q queue   d discard   e edit
```

| Action | Behaviour |
|--------|-----------|
| `s` steer | Delivers the message before the next LLM call (same turn) |
| `q` queue | Delivers the message after the agent fully finishes |
| `d` discard | Throws the message away |
| `e` edit / Esc | Restores the text to the editor |

When the agent is **idle**, messages pass through normally — no prompt appears.

Also registers a `/steer <text>` command that bypasses the prompt and steers directly.

## Install

```bash
pi install npm:@agnishc/edb-agent-steer
```

## Usage

Just type while the agent is running. The prompt appears automatically.

```
/steer reconsider the approach — use a queue instead
```

## License

[MIT](LICENSE) © Agnish Chakraborty
