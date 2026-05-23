# @agnishc/edb-system-prompt-watch

A Pi CLI extension that alerts when Pi's bundled default system prompt source changes.

This is for setups where you use your own `SYSTEM.md`, but still want to know when Pi's upstream default prompt changed so you can manually review and merge any useful updates.

## Behavior

On Pi startup, the extension:

1. Reads the installed `@earendil-works/pi-coding-agent` package version
2. Hashes the installed `dist/core/system-prompt.js`
3. Compares it with the last startup hash stored in `~/.pi/agent/state/system-prompt-watch.json`
4. Shows a warning if the bundled default system prompt source changed
5. Stores the current hash as the new baseline

First run is silent and only stores the baseline.

The extension does not fetch anything from the network and does not modify your custom prompt.

## Install

```bash
pi install npm:@agnishc/edb-system-prompt-watch
```

## License

[MIT](LICENSE) © Agnish Chakraborty
