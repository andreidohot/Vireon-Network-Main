# TypeScript `@vireon/sdk` ↔ Rust `vireon-sdk-rust`

Monorepo layout after rename:

| Path | Language | npm / cargo name |
|---|---|---|
| `vireon-sdk/` | TypeScript | `@vireon/sdk` |
| `vireon-sdk-rust/` | Rust | `vireon-sdk-rust` |

## Shared product defaults

| Constant (TS) | Constant (Rust) | Value |
|---|---|---|
| `VIREON_DEFAULT_RPC_URL` | `DEFAULT_MAINNET_CANDIDATE_RPC` | `https://rpcnode.dohotstudio.com` |
| `VIREON_DEFAULT_POOL_URL` | `DEFAULT_MAINNET_CANDIDATE_POOL` | `…/pool` |
| `VIREON_NETWORK_ID` | `Network::MainnetCandidate` / `network_id()` | `veiron-mainnet-candidate` |

## Method parity

| TS | Rust | Notes |
|---|---|---|
| `createVireonClient` / `VireonClient` | `RpcClient::new` / `BlockingRpcClient::new` | |
| `health` | `health` | |
| `status` | `status` | |
| `chainTip` | `tip` | |
| `blockByHeight` | `block_by_height` | |
| `transaction` | `transaction` | |
| `addressBalance` | `balance` | |
| `addressAccount` | `account` | |
| `indexerSummary` | `indexer_summary` | Rust returns typed summary wrapper |
| `p2pStatus` | `p2p_status` | |
| `poolStatus` | `pool_status` | |
| `poolHistory` | `pool_history` | |
| `poolMiner` | `pool_miner` | Rust → `serde_json::Value` (shape varies) |
| `poolPayouts` | `pool_payouts` | same |
| `poolBlocksWithMaturity` | `pool_blocks_with_maturity` | |
| `poolBlockMaturity` | `pool_block_maturity` | pure helper |

## Rust-only (by design)

- Wallet generate / import / sign
- `TransferBuilder`, `submit`, `await_status`
- Typed indexer block/tx/address helpers
- `sync_status`, `supply`, `mempool_status`, `network`, richer block APIs
- Feature flags `native` / `blocking` / `wasm`

## TS-only (by design)

- Zero-dep browser `fetch` injection
- npm publish shape (`dist/`, ESM exports)
- Direct use from Node scripts without compiling Rust

## Do not merge the trees

Landing Rust under `vireon-sdk/` would overwrite `@vireon/sdk` and break `vireon-examples`.
Keep path `vireon-sdk-rust` and document both from `docs/api/`.
