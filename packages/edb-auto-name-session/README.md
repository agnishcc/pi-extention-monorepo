# @agnishc/edb-auto-name-session

A Pi CLI extension that replaces Pi's default first-message session label with a short generated title.

By default, Pi already shows the first user message in the session picker when no explicit session name exists. This extension watches the first real user prompt in a new unnamed session, sends that prompt to `opencode/big-pickle`, and then stores a cleaner display name with `pi.setSessionName()`.

## Install

```bash
pi install npm:@agnishc/edb-auto-name-session
```

## Use case

Without this extension:
- Pi falls back to the raw first user message as the session label

With this extension:
- Pi keeps the same session flow
- after the first user message, the fallback label is replaced with a concise generated title

Example:

- First prompt: `The next extension to build is auto-name-session. This will use the opencode big pickle model.`
- Generated session name: `Build Auto Name Session`

## Behavior

- Runs once per fresh unnamed session
- Waits until the first user message is actually recorded
- Uses `opencode/big-pickle` to generate a concise title
- Shows an interactive notification while auto-naming runs, then confirms the final title
- Calls `pi.setSessionName()` only if the session is still unnamed
- Leaves already named, resumed, or forked sessions alone

## Requirements

The extension uses the `opencode` provider and the `big-pickle` model.
Configure OpenCode access with either:

```bash
export OPENCODE_API_KEY=...
```

or `/login` in Pi if you store provider credentials there.

## License

[MIT](LICENSE) © Agnish Chakraborty
