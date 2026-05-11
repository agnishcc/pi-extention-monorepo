# pi-extention-monorepo — Agent Reference

## What this repo is
A monorepo of Pi CLI extensions published to npm under the `@agnishc` scope.
All packages share lockstep versioning and a single install/publish pipeline.

---

## Repo layout

```
pi-extention-monorepo/
├── packages/             ← one subdirectory per extension package
├── scripts/
│   ├── release.mjs       ← handles bump + changelog + publish + tag + push
│   └── sync-versions.js  ← enforces lockstep versions across all packages
├── test/
│   └── setup.ts          ← shared vitest global setup
├── .husky/
│   ├── pre-commit        ← runs `npm run check` (biome + tsc) before every commit
│   └── pre-push          ← runs `npm run coverage` before every push
├── biome.json            ← linter + formatter (tabs, indent 3, lineWidth 120)
├── tsconfig.base.json    ← strict ESM TS, module Node16, noEmit
├── vitest.config.ts      ← picks up packages/*/**/*.test.ts
└── package.json          ← npm workspaces root ("workspaces": ["packages/*"])
```

---

## Naming convention

| Thing | Pattern | Example |
|---|---|---|
| Package directory | `packages/edb-<name>/` | `packages/edb-advisor/` |
| npm package name | `@agnishc/edb-<name>` | `@agnishc/edb-advisor` |
| pi install command | `pi install npm:@agnishc/edb-<name>` | `pi install npm:@agnishc/edb-advisor` |

---

## Anatomy of a package

Every package under `packages/edb-<name>/` must have:

### `package.json`
```json
{
  "name": "@agnishc/edb-<name>",
  "version": "0.1.0",
  "description": "Pi extension: <short description>",
  "keywords": ["pi-package", "pi-extension", "edb"],
  "type": "module",
  "license": "MIT",
  "author": "Agnish Chakraborty",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/agnishcc/pi-extention-monorepo.git",
    "directory": "packages/edb-<name>"
  },
  "homepage": "https://github.com/agnishcc/pi-extention-monorepo/tree/main/packages/edb-<name>#readme",
  "bugs": { "url": "https://github.com/agnishcc/pi-extention-monorepo/issues" },
  "publishConfig": { "access": "public" },
  "scripts": { "test": "vitest run" },
  "files": ["src", "README.md", "LICENSE", "CHANGELOG.md"],
  "pi": {
    "extensions": ["./src/index.ts"]
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*"
  }
}
```

Key rules:
- **`peerDependencies`** — NOT `dependencies`. Pi installs them when the user runs `pi install`. Use `"*"` for all pi packages.
- **`publishConfig: { "access": "public" }`** — required for scoped packages.
- **`"type": "module"`** — all source is ESM.
- **`"pi"` manifest** — tells pi what to load. Can include `"extensions"`, `"skills"`, `"prompts"`, `"themes"` arrays.
- **No build step** — TypeScript source files are published as-is. Pi executes them directly.
- **`files` array** — explicitly list every file to publish (no wildcards that grab test files).

### `src/index.ts` — extension entry point
```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerMyFeature } from "./my-feature";

export default function (pi: ExtensionAPI): void {
  registerMyFeature(pi);
}
```
- Default export must be a sync or async function taking `ExtensionAPI`.
- All source lives under `src/` — keep `src/index.ts` thin, delegate to named modules.
- Import local files bare (`from "./types"`) — no `.js` extension needed with `moduleResolution: Bundler`.

### `CHANGELOG.md`
```markdown
# Changelog

## [Unreleased]

### Added
- Initial release
```

The release script promotes `[Unreleased]` → `[x.y.z] - YYYY-MM-DD` on publish.
See [Maintaining CHANGELOGs](#maintaining-changelogs) for the full workflow.

### `README.md` and `LICENSE`
- README should explain what the extension does and how to install it.
- Copy the root `LICENSE` file (MIT).

---

## TypeScript rules (tsconfig.base.json)
- `"module": "ESNext"`, `"moduleResolution": "Bundler"`
- `"allowImportingTsExtensions": true` — import local `.ts` files directly or with no extension
- `"strict": true`
- `"noEmit": true` — no compilation output, source is published directly
- `"target": "ES2022"`
- Import local files bare (`from "./types"`) or with `.ts` extension — **never `.js`**

---

## Linter / formatter (biome.json)
- Indentation: **tabs**, width 3
- Line width: **120**
- `noNonNullAssertion`: off
- `noExplicitAny`: off
- `useConst`: error
- Run: `npm run check` (auto-fixes with `--write`)

---

## Testing (vitest)
- Test files: `packages/*/**/*.test.ts`
- Setup file: `test/setup.ts`
- Coverage: `npm run coverage`
- `passWithNoTests: true` — new packages without tests don't fail CI

---

## Dev workflow

```bash
npm install            # root install wires all workspace symlinks
npm run check          # biome lint+format + tsc type-check (auto-fix)
npm test               # run all tests across all packages
npm run coverage       # tests + coverage report
```

---

## Maintaining CHANGELOGs

All packages use [Keep a Changelog](https://keepachangelog.com) format. Each `packages/edb-<name>/CHANGELOG.md` has a `## [Unreleased]` section at the top.

### When to update

Add entries to `[Unreleased]` **as you make changes** — do not wait until release time.
Only add entries to packages that actually changed.

### Categories

| Category | When to use |
|---|---|
| `### Added` | New features, new tools, new commands |
| `### Changed` | Behavior changes to existing features |
| `### Fixed` | Bug fixes |
| `### Deprecated` | Features that will be removed in a future release |
| `### Removed` | Previously deprecated features now removed |
| `### Security` | Security-relevant fixes |

### Example

```markdown
## [Unreleased]

### Added
- `/usage` command now shows rate-limit reset countdown

### Fixed
- Token counting for cached prompt tokens

## [0.1.0] - 2025-04-29

### Added
- Initial release
```

### Rules

1. **One entry per change** — write concise, user-facing descriptions (not PR numbers or commit hashes).
2. **Only update packages that changed** — if `edb-todo` had fixes but `edb-herald` didn't, only update `edb-todo/CHANGELOG.md`.
3. **Never edit released sections** — once a version is tagged, its changelog section is immutable.
4. **The release script handles the rest** — it promotes `[Unreleased]` → `[version] - date` and re-adds a fresh `[Unreleased]` section automatically.

---

## Versioning & publishing

All packages use **lockstep versioning** — every package shares the same version number, always. The `scripts/sync-versions.js` script enforces this.

### Releasing

```bash
npm run release:patch  # 0.1.0 → 0.1.1  (bug fixes)
npm run release:minor  # 0.1.0 → 0.2.0  (new features, backwards-compatible)
npm run release:major  # 0.1.0 → 1.0.0  (breaking changes)
```

### What the release script does (in order)

1. **Clean check** — verifies no uncommitted changes
2. **Tests** — runs `npm run coverage` (biome + tsc + vitest)
3. **Version bump** — bumps all `packages/*/package.json` versions in lockstep
4. **Dependency sync** — runs `sync-versions.js` to align any inter-package deps
5. **Changelog promotion** — renames `## [Unreleased]` → `## [x.y.z] - YYYY-MM-DD` in each CHANGELOG
6. **Commit + tag** — commits all changes and tags `vX.Y.Z`
7. **Publish** — runs `npm publish -ws --access public` (publishes all packages)
8. **Reinstate [Unreleased]** — adds a fresh `## [Unreleased]` section to each CHANGELOG
9. **Commit + push** — commits the changelog update, pushes `main` and the tag to GitHub

### Dry run

```bash
npm run publish:dry   # runs checks + shows what would be published without uploading
```

### Release checklist

1. Run `git status` and confirm only intended changes are present.
2. Review changed package `README.md` and `CHANGELOG.md` files.
3. Run `npm run check && npm test` (or `npm run coverage` for the exact release validation).
4. Commit the releaseable changes.
5. Run `git status` again — the release script requires a clean tree.
6. Run `npm run publish:dry` and inspect the tarball contents.
7. Run the appropriate release command:
   - `npm run release:patch` for fixes
   - `npm run release:minor` for new features
   - `npm run release:major` for breaking changes
8. Verify npm and installability after publish.

Important: this repo publishes **all packages together** in lockstep.

Full workflow: [docs/publish-workflow.md](docs/publish-workflow.md)

### Manual version bump (without publishing)

```bash
npm run version:patch  # bumps versions + syncs deps + reinstalls, but does NOT publish
npm run version:minor
npm run version:major
```

Use this if you need to bump versions first and publish later.

---

## How users install & update

```bash
# Install a package globally (recommended)
pi install npm:@agnishc/edb-todo

# Install to a project (shared with team via .pi/settings.json)
pi install -l npm:@agnishc/edb-todo

# Try without installing
pi -e npm:@agnishc/edb-todo

# Update all installed pi packages to latest
pi update

# Remove a package
pi remove npm:@agnishc/edb-todo

# List installed packages
pi list
```

> Pinned versions (e.g. `npm:@agnishc/edb-todo@0.1.0`) are skipped by `pi update`.

---

## Adding a new package — checklist

1. Create `packages/edb-<name>/`
2. Add `package.json` (see template above) — version must match all other packages
3. Create `src/index.ts` with default export `(pi: ExtensionAPI) => void`
4. Add implementation files under `src/` (bare imports, no `.js` extension)
5. Add `README.md`, `LICENSE` (copy from root), `CHANGELOG.md` (with `## [Unreleased]`)
6. Run `npm install` at repo root to wire workspace symlinks
7. Run `npm run check` — must pass before committing

---

## pi ExtensionAPI reference (common methods)

```typescript
pi.registerTool({ name, description, parameters, execute })
pi.registerCommand(name, { description, execute })
pi.on("session_start" | "tool_call" | "message" | "input", handler)
pi.setSessionName(name)
pi.getSessionName()
```

Source types are in `@earendil-works/pi-coding-agent`.
Full docs: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`

---

## Repo root
`/Users/agnishcc/Developer/pi-extention-monorepo`
