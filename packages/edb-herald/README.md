# @agnishc/edb-herald

A Pi CLI extension that acts as a **git commit and PR agent**. It reads the current diff, groups changes into logical commits, shows a plan for your approval, executes commits, then pushes and creates a GitHub PR — all step by step with explicit approval gates.

Herald never commits or pushes without your explicit confirmation.

## Commands

| Command | What it does |
|---------|-------------|
| `/herald` | Full flow: group → commit → push → PR |
| `/herald commit` | Commit only (no push, no PR) |
| `/herald pr` | PR only (assumes commits are already done) |

## Flow

1. Reads `git diff`, `git status`, and `git log`
2. Reads `final-plan.md` if present (for context on what was built)
3. Groups changes into logical commits by concern and layer
4. Generates commit messages following the `better-commits` convention (`✨ feat(scope): subject`)
5. **Shows the full plan — waits for your approval before touching anything**
6. Executes commits one by one
7. Generates PR description from commit history and `final-plan.md`
8. **Shows PR description — waits for your approval**
9. Pushes and creates the PR via `gh pr create`

## Requirements

- `git` on PATH
- `gh` CLI on PATH (for PR creation)

## Install

```bash
pi install npm:@agnishc/edb-herald
```

## License

[MIT](LICENSE) © Agnish Chakraborty
