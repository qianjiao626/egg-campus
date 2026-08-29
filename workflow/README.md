# Multi-Agent Workflow

`runner.py` is the local coordinator for PM, BA, Dev, QA, and Fixer roles.
Runtime state is intentionally untracked in `workflow/runtime/`.

## Contract

1. PM receives a requirement and writes the requirements document.
2. PM pauses for explicit user confirmation.
3. After confirmation, BA creates the task tree. Every implementation task gets a separate branch and Git worktree from `main`.
4. Dev commits only to its task branch. QA tests that exact branch. A failing branch is never merged to `main`.
5. Fixer branches from the failed Dev branch. QA must pass again before PM merges the verified branch into `main`.

The coordinator only owns state and Git isolation. Product reasoning, code changes, and test verdicts are supplied by real Codex role runs, never fabricated by the runner.

## Commands

```powershell
python workflow/runner.py start
python workflow/runner.py status
python workflow/runner.py submit --requirement "..."
python workflow/runner.py confirm
python workflow/runner.py stop
```

