# Vireon multi-agent pipeline

Continuous agent workflow for [andreidohot/vireon-network](https://github.com/andreidohot/vireon-network).

## GitHub is the source of truth

Agents **must not** inspect a dirty local Desktop tree.

1. `git fetch origin`
2. Use a clean worktree at `origin/main` (see `sync-github-mirror.ps1`)
3. Cite `repo + commit SHA + path` in every finding
4. Fixers branch from `origin/main` only
5. Integrator squash-merges PRs to GitHub `main` after QA + CI

Local clone may host worktrees and run `gh` / git. Product code for review lives only on GitHub.

## Stages

| Stage | Agent | Output |
|-------|--------|--------|
| Find | Finder × N | GitHub issues (`status:needs-triage`) |
| Triage | Triage | confirm/reject + severity/area labels |
| Fix | Fixer × N | PR from clean worktree (`Closes #N`) |
| QA | QA | `QA: APPROVED` or changes requested |
| Land | Integrator | squash merge → `main` |

See [STATE_MACHINE.md](./STATE_MACHINE.md), [AGENTS.md](./AGENTS.md), [ORCHESTRATOR.md](./ORCHESTRATOR.md).

## Operator commands

```powershell
# One-time labels
.\scripts\pipeline\bootstrap-labels.ps1

# Clean mirror of GitHub main
.\scripts\pipeline\sync-github-mirror.ps1

# Import existing open issues into triage queue
.\scripts\pipeline\import-backlog.ps1

# Show queues
.\scripts\pipeline\list-queue.ps1

# Full cycle modes: once | drain | watch
.\scripts\pipeline\run-cycle.ps1 -Mode drain
```

## Layout

```
.review/pipeline/
  README.md
  STATE_MACHINE.md
  AGENTS.md
  ORCHESTRATOR.md
  runs/                 # cycle summaries (committed keep)
  worktrees/            # gitignored clean checkouts
scripts/pipeline/       # automation
```
