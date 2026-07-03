#!/usr/bin/env bash
# PreToolUse guard: block bare `git push --force` / `-f`.
# This repo has recurring stacked-PR + squash-merge rebase conflicts
# (see memory: git-pr-workflow.md) where a bare force-push can clobber
# a remote branch that moved since the local rebase. Require
# --force-with-lease (or --force-if-includes) instead.
set -euo pipefail

input="$(cat)"
tool_name="$(echo "$input" | jq -r '.tool_name // empty')"

if [ "$tool_name" != "Bash" ]; then
  exit 0
fi

command="$(echo "$input" | jq -r '.tool_input.command // empty')"

# Only care about commands that actually run `git push`.
if ! echo "$command" | grep -qE 'git[[:space:]]+push'; then
  exit 0
fi

# Already using a safe force variant — allow.
if echo "$command" | grep -qE 'force-with-lease|force-if-includes'; then
  exit 0
fi

# Bare --force or short -f flag present — block.
if echo "$command" | grep -qE -- '--force([[:space:]=]|$)|(^|[[:space:]])-f([[:space:]]|$)'; then
  echo "Blocked: bare 'git push --force' (or -f) detected. This project has recurring stacked-PR force-push conflicts — use 'git push --force-with-lease' instead, which fails safely if the remote has commits you don't have locally. See memory: git-pr-workflow.md." >&2
  exit 2
fi

exit 0
