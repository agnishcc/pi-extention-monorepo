# @agnishc/edb-ask-user

A Pi CLI extension that registers an `ask_user` tool — lets the LLM ask the user structured questions directly in the terminal UI without an extra model round-trip.

## Question types

| Type | UI | Use when |
|------|----|----------|
| `text` | Inline editor | Free-form answer needed |
| `choice` | Numbered option list | Picking from a known set |

Mix both types freely in one call. Single questions show a focused UI; multiple questions show a **tabbed wizard** with a Submit review tab.

## Install

```bash
pi install npm:@agnishc/edb-ask-user
```

## Features

- **No extra LLM call** — answers are collected immediately and returned to the model
- **`allowOther`** on choice questions — adds a "Type something" option that opens an inline editor
- **Multi-step wizard** — tab bar with answered/unanswered indicators and a Submit review tab
- **Pre-filled answers** — revisiting a tab restores the previously entered value

## Example

```json
{
  "questions": [
    { "id": "env",     "label": "Environment", "type": "choice",
      "prompt": "Deploy to which environment?",
      "options": [{ "value": "dev", "label": "Development" }, { "value": "prod", "label": "Production" }] },
    { "id": "message", "label": "Message",     "type": "text",
      "prompt": "Describe this deployment:" }
  ]
}
```

## License

[MIT](LICENSE) © Agnish Chakraborty
