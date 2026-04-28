# pi-extention-monorepo

Monorepo for Pi CLI extensions published to npm under the `@agnishc/edb-*` family. Lockstep versions, single install, single publish pipeline.

## Packages

| Package | Install | Description |
|---------|---------|-------------|
| [`edb-agent-steer`](packages/edb-agent-steer) | `pi install npm:@agnishc/edb-agent-steer` | Intercepts mid-turn messages with a steer / queue / discard / edit prompt |
| [`edb-ask-user`](packages/edb-ask-user) | `pi install npm:@agnishc/edb-ask-user` | `ask_user` tool — structured questions (text, choice, multi-step wizard) |
| [`edb-append-system-prompt`](packages/edb-append-system-prompt) | `pi install npm:@agnishc/edb-append-system-prompt` | Manage per-session system prompt snippets with add / delete UI |
| [`edb-claude-proxy`](packages/edb-claude-proxy) | `pi install npm:@agnishc/edb-claude-proxy` | `claude_proxy` tool — delegate tasks to Claude Code CLI |
| [`edb-diff-files`](packages/edb-diff-files) | `pi install npm:@agnishc/edb-diff-files` | Live widget tracking files changed this session with inline diff viewer |
| [`edb-explore`](packages/edb-explore) | `pi install npm:@agnishc/edb-explore` | `explore_dir` tool — sub-agent directory search that keeps results out of main context |
| [`edb-gemini-proxy`](packages/edb-gemini-proxy) | `pi install npm:@agnishc/edb-gemini-proxy` | `gemini_proxy` tool — delegate tasks to Google Gemini CLI |
| [`edb-global-footer`](packages/edb-global-footer) | `pi install npm:@agnishc/edb-global-footer` | Two-line status footer: path, git branch, token usage, cost, model |
| [`edb-herald`](packages/edb-herald) | `pi install npm:@agnishc/edb-herald` | Git commit and PR agent with explicit approval gates |
| [`edb-session-manager`](packages/edb-session-manager) | `pi install npm:@agnishc/edb-session-manager` | Browse, resume, rename, and delete sessions with fuzzy search |
| [`edb-todo`](packages/edb-todo) | `pi install npm:@agnishc/edb-todo` | Structured task list with live widget and system-prompt injection to prevent goal drift |
| [`edb-usage-stats`](packages/edb-usage-stats) | `pi install npm:@agnishc/edb-usage-stats` | `/usage` command showing token rates, reset timers, and live provider status |

## Development

```bash
npm install          # one install at root; workspace symlinks wired automatically
npm run check        # biome lint + format + tsc --noEmit across all packages
npm test             # run all tests
npm run coverage     # run tests with coverage
```

Pre-commit hooks (husky) run `npm run check` before every commit.
Pre-push hooks run the full test suite with coverage.

## Releasing

All packages version in lockstep. One command cuts a release across all of them:

```bash
npm run release:patch   # 0.1.0 → 0.1.1
npm run release:minor   # 0.1.0 → 0.2.0
npm run release:major   # 0.1.0 → 1.0.0
```

The script bumps every `packages/*/package.json`, promotes each `## [Unreleased]` CHANGELOG heading to `## [X.Y.Z] - YYYY-MM-DD`, commits, tags `vX.Y.Z`, publishes to npm, reinstates `## [Unreleased]`, and pushes `main` + tag.

## Adding a new package

1. `mkdir packages/edb-<name> && mkdir packages/edb-<name>/src`
2. Add `package.json` — name `@agnishc/edb-<name>`, version matching other packages, `"pi": { "extensions": ["./src/index.ts"] }`
3. Add `src/index.ts` — default export `(pi: ExtensionAPI) => void`
4. Add `src/` implementation files — bare imports, no `.js` extension
5. Add `README.md`, `LICENSE` (copy from root), `CHANGELOG.md`
6. `npm install` at root to wire workspace symlinks
7. `npm run check` must pass

See [AGENT.md](AGENT.md) for the full agent reference.

## License

[MIT](LICENSE) © Agnish Chakraborty
