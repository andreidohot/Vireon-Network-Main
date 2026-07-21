# Issue state machine (GitHub labels)

Repo: `andreidohot/vireon-network`

## Status labels (exactly one active status preferred)

| Label | Meaning | Next |
|-------|---------|------|
| `status:needs-triage` | Finder (or import) posted; not verified on main | triage → ready / rejected |
| `status:ready` | Confirmed on current GitHub main; Fixer may claim | claim → in-progress |
| `status:in-progress` | Fixer owns the issue | PR open → in-qa |
| `status:in-qa` | PR open; QA running | approve → merge / request changes |
| `status:merged` | Squash-merged to main; issue should be closed | terminal |
| `status:rejected` | FP / dup / stale vs main; issue closed | terminal |
| `status:blocked` | Needs human / design (e.g. large storage rewrite) | human |

Always also apply `pipeline`.

## Agent labels

`agent:finder` · `agent:triage` · `agent:fixer` · `agent:qa` · `agent:integrator`

## Severity (one)

`sev:critical` · `sev:high` · `sev:medium` · `sev:low` · `sev:info`

## Area (one or more)

`security` · `rpc` · `node` · `mining-pool` · `desktop` · `website` · `documentation` · `bug` · `enhancement` · `hygiene`

## Transitions

```text
needs-triage ──triage confirm──► ready ──claim──► in-progress ──PR──► in-qa
      │                                              ▲                  │
      └──reject/dup──► rejected (close)              │            QA fail
                                                     └──────────────────┘
      in-qa ──QA ok + CI──► Integrator merge──► merged (close via Closes #)
```

## Critical gate

If `sev:critical`, Integrator **must not** auto-merge without human confirmation.
