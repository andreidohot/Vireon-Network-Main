# Workspace Scope and Rust Lint Policy

Status: Draft / engineering hygiene  
Related: `docs/release/NETWORK_MATURITY.md`, root `Cargo.toml`

---

## 1. Cargo workspace membership (intentional)

Root `Cargo.toml` lists only crates that:

1. Share the monorepo `Cargo.lock` and dependency versions;
2. Are exercised by `cargo test --workspace` / G1 release-gate;
3. Are pure Rust libraries or binaries (not primary Node/Gradle apps).

### In workspace

| Member | Role |
|---|---|
| `vireon-core` | Protocol |
| `vireon-node` | Node / P2P |
| `vireon-rpc-gateway` | HTTP RPC |
| `vireon-wallet` | Wallet CLI |
| `vireon-indexer` | Indexer |
| `vireon-miner` | NVIDIA CUDA-only FiroPoW miner |
| `vireon-mining-pool` | Pool prototype |
| `vireon-desktop` | egui Control Center (legacy shell) |
| `vireon-mobile-core` | FFI for Android |
| `vireon-release/vps-control-plane/admin-server` | VPS admin agent |

### Out of workspace (by design)

| Path | Why separate |
|---|---|
| `vireon-explorer` | Vite/React; own `package.json` / npm CI |
| `vireon-website` | Marketing + Node server |
| `vireon-desktop-tauri` | Nested `[workspace]` (Tauri requirement); Control Center product path |
| `vireon-android` | Gradle / NDK; consumes `vireon-mobile-core` via scripts |
| `vireon-desktop-tauri/native/keystore-helper` | Nested workspace sidecar binary |
| `vireon-sdk` | TypeScript public client (`npm run build` in-tree); not a Cargo member |
| Empty product shells (`vireon-contracts`, marketplace, …) | Reserved names; no crate / no product |

**This is not an oversight.** Mixing npm/Gradle into `cargo test --workspace` would break G1 and slow every Rust change.

### How to validate excluded trees

| Tree | Check |
|---|---|
| Explorer | `cd vireon-explorer && npm ci && npm run build` |
| Website | `cd vireon-website && npm ci && npm run build` |
| Tauri | `cd vireon-desktop-tauri && npm ci && npm run tauri build` (or check) |
| Android | `cd vireon-android && ./gradlew …` |
| Keystore helper | `cargo check` inside its directory |

---

## 2. `expect` / `unwrap` and static scan noise

### Policy

| Location | Allowed? | Notes |
|---|---|---|
| `#[cfg(test)]` modules / `tests/*.rs` | **Yes** | Prefer clear `expect("reason")` over silent unwrap |
| Production `src/` paths | **Avoid** | Prefer `?`, `map_err`, `ok_or_else` |
| `main` process boundaries | Prefer log + `exit(1)` over panic | Already done for Tauri/desktop entry |

### Why scanners over-count risk

Most `expect`/`unwrap`/`panic!` hits under `vireon-node`, `vireon-mining-pool`, etc. are **test fixtures** (e.g. `p2p.rs` `mod tests`).  
That is acceptable Rust style and does **not** mean production services panic on those lines.

### Recommended scan filters

```text
# Prefer production-only greps (examples):
rg "\.(unwrap|expect)\(" -g '*.rs' -g '!**/tests/**' 
# Then manually skip blocks under #[cfg(test)]

# Or restrict to non-test modules:
rg "\.(unwrap|expect)\(" vireon-core/src vireon-node/src vireon-rpc-gateway/src \
  vireon-wallet/src vireon-miner/src vireon-mining-pool/src vireon-indexer/src
# Exclude lines after "mod tests" in the same file when reviewing.
```

Do **not** force `clippy::unwrap_used = deny` on `--all-targets` until test modules are annotated; it inflates failures without improving production safety.

---

## 3. `#[allow(clippy::…)]` annotations

Known intentional allows:

| Site | Lint | Reason |
|---|---|---|
| `vireon-core` `Block::new_with_version` | `too_many_arguments` | Header fields map 1:1 to consensus fields; a mega-struct would be pure ceremony today |
| `vireon-core` `Transaction::new` / `new_signed` | `too_many_arguments` | Same — wire shape is the API |
| `vireon-node` `p2p` handlers | `too_many_arguments` | Swarm event context; refactor to a context struct is backlog |

When adding new allows: **comment why** next to the attribute. Prefer small context structs for new code.

---

## 4. Desktop CSP (inline styles)

Production CSP (Tauri packaged Control Center):

- **`script-src 'self'`** — no inline scripts (theme boot is an external file).
- **`style-src 'self' 'unsafe-inline'`** — still required for React `style={{ … }}` props used across the Control Center UI.

Tightening further means migrating layout props to CSS classes (large UI pass). Until then:

- Do **not** reintroduce `script-src 'unsafe-inline'` in packaged builds;
- Dev-only Vite HMR exceptions must never ship in packaged apps.

See also desktop security notes in prior CSP/IPC hardening work.

---

## 5. Analysis reports

| Report | Scope |
|---|---|
| `RUST_CODE_ANALYSIS_REPORT.md` (root) | **Superseded summary** — points here + maturity + current residual risks |
| This file | Workspace + lint process |

When re-running static analysis, always state **which crates** and **whether tests are included**.
