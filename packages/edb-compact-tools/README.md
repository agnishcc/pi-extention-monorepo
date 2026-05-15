# edb-compact-tools

Pi extension that replaces large built-in tool-call blocks with compact outlined rows.

## Behavior

- Overrides `read`, `bash`, `grep`, `find`, `ls`, `edit`, and `write` renderers.
- Adds a generic compact blanket renderer for every other tool, without hardcoding individual tool names.
- Delegates execution to Pi's built-in tools, so tool behavior is unchanged.
- Collapsed by default: one compact summary row.
- Expanded with Pi's normal tool expand keybinding, usually `ctrl+o`.
- Uses `renderShell: "self"`, so collapsed rows have no filled background; expanded output uses Pi's subtle tool-state background colors.
- Collapsed tools render as one compact full-outline block with two lines: the call line, then the status/summary line. The whole outline turns green on success, red on failure, and yellow while running. Expanding shows the available output inside the same outline.
- Adds a muted separator before each tool block.
- Styles user messages as compact outlined cards with an accent border and a random red emoji marker.
- Styles assistant text messages as compact outlined cards with muted borders.
- Uses an outline color per tool:
  - `bash` -> `bashMode`
  - `read` -> `toolTitle`
  - `grep` -> `success`
  - `find` -> `accent`
  - `ls` -> `warning`
  - `edit` -> `toolDiffAdded`
  - `write` -> `accent`

## Local development

Run Pi with the extension directly:

```bash
pi -e ./packages/edb-compact-tools/src/index.ts
```

Or install as a Pi package after publishing:

```bash
pi install npm:@agnishc/edb-compact-tools
```

## Notes

`edit` expansion shows the unified diff from Pi's normal edit result. `write` expansion shows the normal write result text, not a synthetic full-file diff.
