# VBOS Versioning

The bot uses a three-part version format:

```text
MAJOR.MEDIUM.MINOR
```

Current version:

```text
7.36.7
- Docker-safe rank-card font rendering and the current Vireon rank-card layout.
```

## Version Meaning

| Part | Example | Meaning | When To Increase |
|---|---:|---|---|
| MAJOR | `4` | Large product-level changes | New core modules, major architecture changes, database migration, large dashboard rebuild, breaking config/API changes |
| MEDIUM | `1` | Medium feature changes | New commands, new dashboard sections, new admin API endpoints, new moderation/community workflows |
| MINOR | `1` | Small changes and fixes | Bug fixes, copy updates, minor UI improvements, small config changes, docs updates |

## Rules

- Do not use old incremental archive labels.
- Use release filenames like `vbos-7.36.0.zip`.
- If `MAJOR` increases, reset `MEDIUM` and `MINOR` to `0`.
- If `MEDIUM` increases, reset `MINOR` to `0`.
- If only fixes or small refinements are made, increase only `MINOR`.

## Examples

```text
4.1.1 -> 4.1.2  Small fix or documentation update
4.1.1 -> 4.2.0  New medium feature, such as permission UI
4.1.1 -> 5.0.0  Major architecture change, such as moving from JSON storage to PostgreSQL
```
