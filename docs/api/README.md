# API Docs

RPC, gateway, SDK and service API documentation.

Status: Current API index / Mainnet Candidate (where noted)

## Index

| Doc | Topic |
|---|---|
| `00_RPC_GATEWAY_OVERVIEW.md` | Gateway role and boundaries |
| `01_RPC_ENDPOINTS_DRAFT.md` | HTTP endpoint list |
| `02_RPC_RESPONSE_MODELS.md` | Response shapes |
| `03_MINING_POOL_API_DRAFT.md` | Pool HTTP API (prototype) |
| `04_SDK_CLIENT_V0.md` | **`vireon-sdk-rust` client surface (v0)** |

## Honest scope

- Product network: **Mainnet Candidate** (`veiron-mainnet-candidate`), not Mainnet Live.
- Public RPC may be deployed operationally; docs still label draft/prototype where models can change.
- Rust SDK (`vireon-sdk-rust`): L1 wallet/sign/RPC + **public** pool reads + maturity + p2p.
- TypeScript SDK (`vireon-sdk` / `@vireon/sdk`): read-only RPC + pool for JS examples.

## Implementation map

| Surface | Code |
|---|---|
| RPC gateway | `vireon-rpc-gateway/` |
| Rust client SDK | `vireon-sdk-rust/` |
| Wallet CLI (uses SDK blocking RPC) | `vireon-wallet/` |
| Browser native host (uses SDK) | `vireon-browser/host/` |
