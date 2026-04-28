# @agnishc/edb-global-footer

A Pi CLI extension that renders a persistent two-line (plus optional third line) status footer at the bottom of every session.

```
~/Developer/my-project  main *  ↑2  my-session-name
↑12.4k ↓3.2k R8.1k $0.042  (anthropic)  claude-sonnet-4
⊕ 2 snippets  → 3 active  ✓ 5 done
```

**Line 1** — Working directory · git branch (dirty `*`, ahead `↑N`, behind `↓N`) · session name

**Line 2** — Token usage (input/output/cache-read/cache-write) · cost · context window % · model name · thinking level

**Line 3** — Active extension statuses (shown only when extensions set a status)

Git status is refreshed after every turn and on branch change events.

## Install

```bash
pi install npm:@agnishc/edb-global-footer
```

## License

[MIT](LICENSE) © Agnish Chakraborty
