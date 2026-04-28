# @agnishc/edb-append-system-prompt

A Pi CLI extension that lets you build up a list of system-prompt snippets that are appended to every agent turn in the current session.

## Features

- **Always appends** — snippets accumulate as a list, never replace the base prompt
- **Confirm before adding** — shows the exact text in a confirm dialog before saving
- **Status bar indicator** — `⊕ N snippets` shown when active snippets exist
- **Delete individual snippets** — select and delete from the list view
- **Persists across `/reload`** — stored in session history, survives extension reloads

## Install

```bash
pi install npm:@agnishc/edb-append-system-prompt
```

## Usage

```
/sys-prompt
```

Opens an overlay with two modes:

- **Compose mode** — write a snippet, press Enter to add (with confirm dialog)
- **List mode** — browse existing snippets, press `d` to delete selected

## License

[MIT](LICENSE) © Agnish Chakraborty
