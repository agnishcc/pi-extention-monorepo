# @agnishc/edb-explore

A Pi CLI extension that registers an `explore_dir` tool. It searches a directory across multiple files to answer a question — **without loading any of those files into the main agent's context**.

Spawns a dedicated pi sub-agent scoped to the target directory with only `read` and `bash` tools. The sub-agent does all the file exploration independently and returns a concise answer with exact file paths and line numbers.

## When to use

Use `explore_dir` when **all** of these are true:
1. You need information that lives somewhere in a directory
2. You do not already know which specific file contains it
3. Answering would require reading 3 or more files yourself

**Don't use** when you already know the file (use `read` directly), a single grep would answer it (use `bash`), or you need to edit files.

## Install

```bash
pi install npm:@agnishc/edb-explore
```

## Example

```
explore_dir(
  question: "Where is the auth middleware registered?",
  directory: "./src"
)
```

Returns citations like `src/middleware/auth.ts:42` with one-line explanations.

## Configuration

Set `PI_PATH` env var if the `pi` binary is not on `PATH`.

## License

[MIT](LICENSE) © Agnish Chakraborty
