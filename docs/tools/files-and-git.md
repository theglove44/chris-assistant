---
title: Files & Git
description: File manipulation and git tools for workspace operations
---

# Files & Git

## File Tools

`src/tools/files.ts` provides 5 tools scoped to `WORKSPACE_ROOT` (default `~/Projects`).

### `read_file`

Read a file from the active workspace.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `path` | Yes | Path relative to workspace root |

### `write_file`

Write content to a file in the active workspace. Creates parent directories as needed.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `path` | Yes | Path relative to workspace root |
| `content` | Yes | File content to write |

### `edit_file`

Exact-match find-and-replace edit within a file. Requires exactly one match of `old_string`.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `path` | Yes | Path relative to workspace root |
| `old_string` | Yes | Text to find (must match exactly once) |
| `new_string` | Yes | Replacement text |

### `list_files`

List files with glob pattern matching. Excludes `node_modules` and `.git` directories. Capped at 200 results.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `path` | No | Directory relative to workspace root (default: root) |
| `pattern` | No | Glob pattern to filter files |

### `search_files`

Search file contents with `grep -rn`. Optional glob filter via `--include`.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `query` | Yes | Search string |
| `path` | No | Directory to search in |
| `include` | No | Glob pattern to filter files (e.g. `*.ts`) |

## Path Guard

All paths are resolved relative to the workspace root with a guard that rejects traversal outside it. The guard uses `fs.realpathSync` via a recursive `canonicalize()` helper to follow symlinks before the boundary check. A symlink inside the workspace pointing outside it will be rejected.

## Git Tools

`src/tools/git.ts` provides 3 tools. All use `git -C <workspaceRoot>` to target the active project.

### `git_status`

Shows git status in short format.

No parameters required.

### `git_diff`

Shows git diff output. 50KB truncation on output.

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `staged` | No | `false` | If true, shows staged changes (`--cached`) |

### `git_commit`

Stage files and create a commit.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `message` | Yes | Commit message |
| `files` | No | Array of files to stage before committing |

::: warning No git push
There is no `git_push` tool — this is a deliberate safety choice to prevent unreviewed pushes. All pushes must be done manually.
:::
