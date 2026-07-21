# Vireon System Overview

Status: Mainnet Candidate architecture / mixed implementation maturity

Vireon is one system with three logical layers. A layer describes ownership and
trust boundaries; it does not imply that every planned feature in that layer is
implemented.

## Current status by layer

| Layer | Current state |
|---|---|
| Base | Core, node, P2P, RPC, indexer, CUDA miner, and pool prototype implemented for Mainnet Candidate |
| Execution | Planned; no smart-contract VM or production VRC standards |
| Product | Tauri desktop, wallet tooling, explorer, website, SDKs, Android/browser prototypes; several planned surfaces |

## Sources of truth

- `vireon-core` owns protocol validity.
- `vireon-node` owns canonical chain acceptance and persistence.
- `shared/` owns schemas, units, identifiers, and cross-language constants.
- `docs/` owns intended behavior and maturity boundaries.
- `vireon-website` owns public presentation, not protocol truth.

## Cross-system rule

A change in consensus, serialization, fees, addresses, mining work, or network
identity must be reviewed across core, node, wallet, RPC, indexer, explorer,
miner, pool, clients, operations, shared types, and documentation.

See `../source-info/VIREON_02_ARCHITECTURE_AND_PRODUCT_LAYERS.md` for the
canonical layer map.
