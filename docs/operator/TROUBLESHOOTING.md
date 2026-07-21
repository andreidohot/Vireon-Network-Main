# Troubleshooting

Status: Draft / Mainnet Candidate / Prototype

## `vireon-node` rejects `.vireon-local` paths

Expected fix in this workspace:
- local operator scripts pass `.vireon-local/...` explicitly
- node path validation now allows `.vireon-local` as a safe local operator root

If commands still fail:
- run them from the repository root
- verify the command includes `--data-dir .vireon-local/chain --mempool-dir .vireon-local/mempool`

## RPC starts but reads the wrong chain path

Symptoms:
- `/status` shows uninitialized while the node already wrote blocks

Checks:
- use `configs/rpc.local.toml`
- run from the repository root so relative `.vireon-local/...` paths resolve correctly
- verify `.vireon-local/chain/chain.jsonl` exists

## Explorer cannot build because `tsc` is missing

Cause:
- `vireon-explorer/node_modules` does not exist yet

Fix:

```powershell
cd vireon-explorer
npm install
npm run build
```

## Release gate fails after local explorer work

Cause:
- local operator use may install `vireon-explorer/node_modules`

Fix:
- run the release gate before local smoke work when possible
- if needed, remove `vireon-explorer/node_modules` and rerun the gate

## `cargo` uses the wrong Windows toolchain

Symptoms:
- mismatched host toolchain
- unexpected build failures on Windows

Fix:
- prefer `%USERPROFILE%\.cargo\bin\cargo.exe`
- or run:

```powershell
cargo +stable-x86_64-pc-windows-msvc test --workspace
```

## Ports are already in use

Local defaults:
- RPC: `10787`
- Explorer dev server: `4173`

Fix:
- run `.\scripts\local\stop-all.ps1`
- close stale terminals or lingering processes
- rerun `.\scripts\local\start-all.ps1`

## Reset refuses to proceed

Expected behavior:
- reset creates a backup first unless `--no-backup` is explicitly passed

Examples:

```powershell
.\scripts\local\reset-local-chain.ps1
.\scripts\local\reset-local-chain.ps1 -NoBackup
```

## Wallet balance reads fail

Checks:
- ensure the RPC gateway is running on `http://127.0.0.1:10787`
- verify the wallet command points to that base URL
- verify the address belongs to the active network prefix `vire`

## Indexer looks stale after mining

The current indexer is a one-shot snapshot, not a daemon.

Refresh it manually:

```powershell
cargo run -p vireon-indexer -- --network mainnet-candidate --chain-data-dir .vireon-local/chain --index-dir .vireon-local/indexer index-chain
```

Or use:

```powershell
.\scripts\local\mine-local-block.ps1
```

That wrapper refreshes the local index after mining.
