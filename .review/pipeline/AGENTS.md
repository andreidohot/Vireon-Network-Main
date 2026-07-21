# Multi-agent personas (GitHub-scoped)

All agents receive an absolute path to a **clean worktree** (`mirror-main` or PR head). They must not use the operator’s dirty local main tree for product code.

## Shared rules

- Repo: `andreidohot/vireon-network`
- Inspect only the provided worktree or `git show origin/main:path`
- Ignore `target/`, `node_modules/`, build caches
- Findings cite: repo, commit SHA, path
- English for issue/PR titles and bodies
- No secrets in issues/PRs

## Finder

**Mode:** read-only · parallel by domain  
**Input:** `mirror-main` path + SHA  
**Output:** `scripts/pipeline/post-finding.ps1` or `gh issue create` with labels `pipeline,agent:finder,status:needs-triage`

Domains:

| ID | Paths |
|----|--------|
| finder-rust-core | vireon-core/, vireon-wallet/, shared/ |
| finder-node-rpc | vireon-node/, vireon-rpc-gateway/, vireon-indexer/, vireon-miner/, vireon-mining-pool/ |
| finder-security | configs/, scripts/security/, docs/security/ |
| finder-desktop | vireon-desktop-electron/, vireon-desktop/, vireon-desktop-tauri/, vireon-explorer/, vireon-website/ |
| finder-hygiene | scripts/, docs/, .github/workflows/, README.md |

Cap ~6 findings per domain per wave. No product code edits.

Issue body must include:

```markdown
## Inspected
- repo: andreidohot/vireon-network
- ref: main
- commit: <sha>

## Summary
## Evidence
## Impact
## Suggested fix
## Acceptance criteria
- [ ] ...
```

## Triage

**Mode:** serial · read-only on `mirror-main` (fresh fetch)  
**Input:** open issues with `status:needs-triage`  
**Output:** `scripts/pipeline/triage-apply.ps1 -Decision confirm|reject|duplicate`

- Re-read cited paths on **current** main SHA
- If fixed already → reject as stale
- Set one `sev:*` and area labels on confirm
- Comment with evidence and mirror SHA

## Fixer

**Mode:** write in dedicated worktree from `origin/main`  
**Input:** issue with `status:ready`  
**Steps:**

1. `claim-issue.ps1 -Number N`
2. Branch `agent/fix/N-short-slug` from origin/main
3. Minimal fix + tests when useful
4. Commit `fix(#N): ...`
5. `open-fix-pr.ps1 -Number N -Branch ...`
6. Leave issue `status:in-qa`

One issue per PR. No drive-by refactors. Do not add Desktop-only files.

## QA

**Mode:** read PR worktree · run checks  
**Input:** PR number + issue number  
**Steps:**

1. Checkout PR head worktree
2. Diff vs acceptance criteria
3. `run-checks.ps1 -Worktree <path> ...`
4. `qa-report.ps1 -Pr N -Approved:$true|$false -Body ...`

## Integrator

**Mode:** serial merges  
**Input:** PR with `QA: APPROVED`  
**Steps:**

1. `merge-if-green.ps1 -Pr N` (waits CI; critical gate)
2. Fetch origin; refresh mirror
3. Ensure issue closed / `status:merged`
