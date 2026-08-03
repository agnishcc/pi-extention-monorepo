# @agnishc/edb-append-system-prompt

A Pi CLI extension that sets a single system-prompt injection for the current session.

## Features

- **One injection** — a single snippet appended to the system prompt before every agent turn
- **Toggle button in the popup** — Tab to it, Enter / Space flips enable / disable
- **Input field** — write anything; saved trimmed, exactly as typed otherwise
- **Persists across `/reload`** — stored in session history, scoped to the current session only

## Install

```bash
pi install npm:@agnishc/edb-append-system-prompt
```

## Usage

```
/prompt-inject
```

Opens an overlay with an input field and a toggle button:

- Type your snippet in the text field
- **Tab** moves focus to the toggle button; **Enter** / **Space** flips it on / off
- **Tab** back to the text field and press **Enter** to save
- **Esc** closes without saving

While enabled, the snippet is appended to the system prompt before every agent turn. The status bar shows `⊕ inject on` when active and `○ inject off` when set but disabled.

## License

[MIT](LICENSE) © Agnish Chakraborty
