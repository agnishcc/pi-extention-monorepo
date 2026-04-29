# Publish Workflow

This repo publishes **all packages together** in lockstep. Releasing `edb-auto-name-session` also releases every other package in `packages/` at the same new version.

## Before you start

Make sure you have:

- npm publish access for the `@agnishc` scope
- a clean working tree
- all intended changelog entries added under each changed package's `## [Unreleased]`
- GitHub push access to `main`

## Step-by-step

### 1. Review local changes

```bash
git status
```

Confirm only the intended files are changed.

### 2. Review changed package docs and changelogs

At minimum, check:

- `packages/edb-auto-name-session/README.md`
- `packages/edb-auto-name-session/CHANGELOG.md`
- any other changed package `CHANGELOG.md`

Rule: only packages that changed should get new `[Unreleased]` entries.

### 3. Run final validation

```bash
npm run check && npm test
```

If you want the exact same validation the release script uses, also run:

```bash
npm run coverage
```

### 4. Commit the releaseable changes

```bash
git add .
git commit -m "Add edb-auto-name-session"
```

Pick the commit message that matches the actual work.

### 5. Make sure the repo is clean again

```bash
git status
```

The release script refuses to run with uncommitted changes.

### 6. Run a dry publish

```bash
npm run publish:dry
```

This checks packaging and shows what would be published without uploading anything.

Look for:

- no missing files in package tarballs
- correct `README.md`, `LICENSE`, `CHANGELOG.md`, and `src/`
- no test-only junk in published files
- no auth or registry errors

### 7. Choose the release type

Use one of:

```bash
npm run release:patch
npm run release:minor
npm run release:major
```

Guideline:

- `patch` — fixes only
- `minor` — new features, no breaking changes
- `major` — breaking changes

For a new extension package like `edb-auto-name-session`, use:

```bash
npm run release:minor
```

## What `release:*` does

`scripts/release.mjs` performs these steps:

1. verifies the git working tree is clean
2. runs `npm run coverage`
3. bumps all package versions in lockstep
4. syncs inter-package versions
5. promotes each `## [Unreleased]` heading to `## [x.y.z] - YYYY-MM-DD`
6. commits the release and creates tag `vX.Y.Z`
7. publishes all workspaces to npm
8. reinstates fresh `## [Unreleased]` sections
9. commits the post-release changelog reset
10. pushes `main` and the release tag

## After publish

### 1. Verify npm

Check that the new version appears for the package:

```bash
npm view @agnishc/edb-auto-name-session version
```

### 2. Verify install

```bash
pi install npm:@agnishc/edb-auto-name-session
```

### 3. Verify the git state

Confirm:

- release tag exists on remote
- `main` contains both release commits
- local branch is up to date

## Practical example

```bash
git status
npm run check && npm test
git add .
git commit -m "Add edb-auto-name-session"
git status
npm run publish:dry
npm run release:minor
npm view @agnishc/edb-auto-name-session version
pi install npm:@agnishc/edb-auto-name-session
```
