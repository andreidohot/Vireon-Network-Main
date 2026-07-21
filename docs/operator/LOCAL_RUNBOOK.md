# Local Runbook

Status: Draft / Mainnet Candidate / Prototype

This runbook is for local operator use only. It is not a VPS deployment guide and it does not imply any live public network status.

## Local Layout

The local operator workflow uses one safe workspace-local root:

```text
.vireon-local/
  chain/
  mempool/
  indexer/
  wallets/
    signed-txs/
  logs/
  backups/
  build/
```

Notes:
- wallet private keys stay under `.vireon-local/wallets/`;
- signed transaction files stay under `.vireon-local/wallets/signed-txs/`;
- logs stay under `.vireon-local/logs/`;
- local Cargo build artifacts are redirected into `.vireon-local/build/` so normal repo-hygiene gates are not polluted.

## Prerequisites

- Rust with `cargo`, `rustfmt` and `clippy`
- Node.js with npm
- run commands from the repository root

Windows note:
- the local scripts prefer the rustup-managed cargo shim if it exists at `%USERPROFILE%\.cargo\bin\cargo.exe`.

## Quick Start

PowerShell:

```powershell
.\scripts\local\start-all.ps1
```

Shell:

```bash
bash scripts/local/start-all.sh
```

What starts:
- `vireon-node` in local mainnet-candidate mode
- `vireon-rpc-gateway` bound to `127.0.0.1:10787`
- a one-shot `vireon-indexer` refresh
- `vireon-explorer` dev server if the app exists

## Health Checks

Show local status:

```powershell
.\scripts\local\status-all.ps1
```

Key checks:
- node runtime state
- chain validation
- mempool summary
- RPC `/health`
- RPC `/network`
- latest block view
- index snapshot status
- managed log paths

## Mining One Local Block

PowerShell:

```powershell
.\scripts\local\mine-local-block.ps1
```

Shell:

```bash
bash scripts/local/mine-local-block.sh
```

This mines one block using the local operator chain and refreshes the index snapshot after the block is written.

## Wallet Flow

Create a local wallet:

```powershell
cargo run -p vireon-wallet -- --network mainnet-candidate --wallet-dir .vireon-local/wallets --signed-tx-dir .vireon-local/wallets/signed-txs create-wallet
```

Show the local address:

```powershell
cargo run -p vireon-wallet -- --network mainnet-candidate --wallet-dir .vireon-local/wallets address
```

Check a balance through local RPC:

```powershell
cargo run -p vireon-wallet -- --network mainnet-candidate --wallet-dir .vireon-local/wallets --rpc-base-url http://127.0.0.1:10787 balance <address>
```

Submit a signed transaction if supported:

```powershell
cargo run -p vireon-wallet -- --network mainnet-candidate --wallet-dir .vireon-local/wallets --signed-tx-dir .vireon-local/wallets/signed-txs --rpc-base-url http://127.0.0.1:10787 submit-tx --tx-file .vireon-local/wallets/signed-txs/<tx-hash>.json
```

## Explorer

The explorer reads only the local RPC gateway.

Start through the local wrapper:

```powershell
.\scripts\local\start-all.ps1
```

Or manually:

```powershell
cd vireon-explorer
npm install
$env:VITE_VIREON_RPC_URL = "http://127.0.0.1:10787"
npm run dev -- --host 127.0.0.1 --port 4173
```

## Logs

Local log files are written to:

```text
.vireon-local/logs/
```

Expected files:
- `node.log` / `node.err.log`
- `rpc.log` / `rpc.err.log`
- `explorer.log` / `explorer.err.log`
- `indexer-refresh.log` / `indexer-refresh.err.log`

## Backup

Create a backup:

```powershell
.\scripts\local\backup-local-chain.ps1
```

By default the backup includes:
- chain data
- mempool data
- index snapshot
- local logs
- local genesis marker if present

By default the backup does not include:
- wallet private keys
- wallet JSON files

## Safe Reset

PowerShell:

```powershell
.\scripts\local\reset-local-chain.ps1
```

Shell:

```bash
bash scripts/local/reset-local-chain.sh
```

Behavior:
- stops managed local processes first
- creates a backup automatically unless `--no-backup` is explicitly passed
- clears local chain, mempool and index snapshot
- keeps wallet material in place unless you remove it manually

## Local Smoke Test

PowerShell:

```powershell
.\scripts\local\run-local-smoke-test.ps1
```

Shell:

```bash
bash scripts/local/run-local-smoke-test.sh
```

The smoke test covers:
- release gate or basic validation
- node startup
- chain validation
- one local block mined
- RPC `/health`
- RPC `/network`
- wallet create and address display
- index snapshot refresh
- explorer build if the app exists
