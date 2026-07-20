# Veiron Network

Veiron Network is an independent Proof-of-Work Layer 1 blockchain written primarily in Rust.

The project is currently in **Mainnet Candidate / Prototype** development. It includes a runnable blockchain core, node, wallet, RPC gateway, indexer, explorer, NVIDIA GPU miner, experimental mining pool and desktop Control Center.

> **Veiron Network is not a public live mainnet.**
>
> The current Mainnet Candidate configuration is intended for local development, controlled operator rehearsals and infrastructure testing. It must not be presented as a production network until all public-launch requirements are completed.

---

## Project status

| Area                              | Current status         |
| --------------------------------- | ---------------------- |
| Blockchain core                   | Runnable prototype     |
| Consensus validation              | Implemented            |
| Account ledger                    | Implemented            |
| Signed transactions               | Implemented            |
| Local node                        | Runnable               |
| P2P networking                    | Prototype              |
| RPC gateway                       | Runnable               |
| Wallet CLI                        | Runnable               |
| Desktop wallet and Control Center | Mainnet Candidate      |
| Indexer                           | Runnable prototype     |
| Explorer                          | Runnable               |
| NVIDIA GPU mining                 | Implemented            |
| Mining pool                       | Experimental prototype |
| Public testnet                    | Not currently operated |
| Public mainnet                    | Not launched           |
| Smart contracts                   | Not implemented        |
| Staking                           | Not implemented        |
| DAO governance                    | Not implemented        |
| Passport identity layer           | Not implemented        |
| Marketplace                       | Not implemented        |
| NFTs and custom assets            | Planned                |

The authoritative maturity document is:

```text
docs/release/NETWORK_MATURITY.md
```

A successful build, test suite or release-gate run does not mean that the network is production-ready or publicly launched.

---

## What Veiron is

Veiron is being developed as a mineable Layer 1 network for digital ownership and application infrastructure.

The current implementation focuses on the base blockchain layer:

* blocks and transactions;
* account-based ledger state;
* Proof-of-Work consensus;
* FiroPoW block validation;
* GPU mining;
* mining rewards;
* transaction fees;
* mempool handling;
* fork choice and reorganization handling;
* peer-to-peer synchronization;
* wallet creation and transaction signing;
* RPC access;
* blockchain indexing;
* block and transaction exploration;
* local and controlled VPS operation.

The longer-term product direction includes:

* smart contracts;
* decentralized applications;
* native digital assets;
* NFTs and game items;
* software-license proofs;
* identity and reputation proofs;
* storage commitments;
* encrypted communication permissions;
* developer SDKs;
* creator and application marketplaces.

These future capabilities are part of the project direction, but they must not be described as live until they are implemented, tested and documented.

---

## Network parameters

| Parameter                  | Value            |
| -------------------------- | ---------------- |
| Network name               | Veiron Network   |
| Native asset               | VIRE             |
| Address prefix             | `vire`           |
| Core language              | Rust             |
| Ledger model               | Account-based    |
| Consensus                  | Proof of Work    |
| Mining algorithm           | FiroPoW 0.9.4    |
| Current miner support      | NVIDIA CUDA      |
| Target block time          | 60 seconds       |
| Maximum supply             | 60,000,000 VIRE  |
| Initial block reward       | 19.02587519 VIRE |
| Halving interval           | 1,576,800 blocks |
| Approximate halving period | 3 years          |
| Atomic precision           | 8 decimals       |

Economic and protocol parameters may only be considered final when they are implemented in consensus code, covered by tests and reflected consistently across the documentation.

---

## Repository structure

The repository is organized as a monorepo containing the blockchain protocol, products and operating tools.

```text
Veiron-Network-Main/
├── configs/
├── docs/
├── scripts/
├── shared/
│
├── veiron-core/
├── veiron-node/
├── veiron-rpc-gateway/
├── veiron-wallet/
├── veiron-sdk/
├── veiron-sdk-rust/
├── veiron-indexer/
├── veiron-explorer/
├── veiron-miner/
├── veiron-mining-pool/
├── veiron-desktop/
├── veiron-desktop-tauri/
├── veiron-mobile-core/
├── veiron-browser/
├── veiron-release/
├── veiron-website/
└── Cargo.toml
```

### Core components

#### `veiron-core`

Consensus-critical blockchain logic:

* blocks;
* transactions;
* account state;
* balances and nonces;
* mining rewards;
* fee calculation;
* Proof-of-Work validation;
* FiroPoW;
* difficulty adjustment;
* chain selection;
* reorganization handling;
* checkpoints;
* protocol upgrades;
* address handling;
* signatures;
* wire serialization;
* genesis rules.

`veiron-core` is the primary source of truth for protocol behavior.

#### `veiron-node`

Node runtime and blockchain operation:

* chain loading and persistence;
* mempool;
* block acceptance;
* mining block templates;
* peer-to-peer communication;
* chain synchronization;
* node health and status;
* candidate-network operation.

The current candidate implementation uses JSONL-based chain storage. This is suitable for development and controlled rehearsal, but still requires a production durability review before public launch.

#### `veiron-rpc-gateway`

Versioned access layer between clients and the node:

* public status endpoints;
* block and transaction queries;
* wallet transaction submission;
* mining endpoints;
* indexer integration;
* operator endpoints;
* health reporting.

Public deployment must use appropriate authentication, TLS termination, rate limiting and request limits.

#### `veiron-wallet`

Wallet and transaction tools:

* wallet creation;
* mnemonic generation and import;
* address derivation;
* balance queries;
* transaction construction;
* local signing;
* transaction submission;
* wallet backup warnings.

Private keys, mnemonics and wallet files must never be committed to the repository.

#### `veiron-miner`

Standalone Veiron mining client.

Current scope:

* FiroPoW mining;
* NVIDIA CUDA execution;
* RPC mining;
* pool mining;
* worker statistics;
* block candidate submission.

The current official miner path does not include CPU mining or an OpenCL fallback.

#### `veiron-mining-pool`

Experimental mining-pool implementation:

* worker connections;
* share validation;
* block candidate tracking;
* immature and mature rewards;
* payout accounting;
* pool status;
* miner statistics.

This component is a prototype for controlled testing. It is not currently a production public mining-pool service.

#### `veiron-indexer`

Reads blockchain data and produces queryable records for:

* blocks;
* transactions;
* addresses;
* balances;
* mining rewards;
* chain status;
* explorer APIs.

#### `veiron-explorer`

Web interface for inspecting the candidate blockchain:

* latest blocks;
* block details;
* transaction details;
* address information;
* network status;
* mining information.

#### Veiron Control Center

The desktop Control Center is the primary product interface for Windows and Linux.

It is built with Tauri and is intended to bring together:

* node control;
* wallet access;
* mining;
* explorer;
* network status;
* local operator tools;
* logs and diagnostics.

The current desktop release remains a Mainnet Candidate product and must not be described as a production-mainnet wallet.

---

## Architecture

Veiron is designed around three conceptual layers.

### Base layer

The part currently receiving most of the engineering work:

* consensus;
* VIRE transfers;
* block production;
* Proof of Work;
* transaction validation;
* account state;
* fees;
* mempool;
* chain synchronization;
* final settlement;
* reorganization handling.

### Execution layer

Planned application-execution capabilities:

* smart contracts;
* deterministic WASM execution;
* bounded gas usage;
* contract events;
* fungible-token standards;
* NFT standards;
* application and game logic.

The execution layer is not currently production-implemented.

### Product layer

Applications and services built around the chain:

* wallet;
* explorer;
* indexer;
* SDK;
* Control Center;
* Passport proofs;
* digital licenses;
* storage proofs;
* encrypted communication;
* marketplace integrations.

Only the components explicitly marked as runnable in this README should be considered currently available.

---

## Requirements

### Rust components

* Rust stable;
* Cargo;
* `rustfmt`;
* Clippy.

### Web components

* Node.js 20 or newer;
* npm.

### Desktop application

* Rust toolchain;
* Node.js;
* Tauri platform dependencies;
* Windows or Linux build dependencies.

### GPU miner

* supported NVIDIA GPU;
* compatible NVIDIA driver;
* CUDA environment required by the miner build.

---

## Build and test

From the repository root:

```powershell
cargo fmt --all --check
cargo test --workspace --tests
cargo clippy --workspace --all-targets -- -D warnings
```

These commands validate the Rust workspace members configured in the root `Cargo.toml`.

A passing test suite confirms that the tested behavior passed under the tested environment. It does not represent an external security audit or public-launch approval.

### Build the explorer

```powershell
cd veiron-explorer
npm install
npm run build
```

### Build the SDK examples

```powershell
cd veiron-sdk
npm install
npm run build

cd ../veiron-examples
npm run chain-status
npm run pool-maturity
```

---

## Local operator flow

The repository includes scripts for running the Mainnet Candidate stack locally.

### Start the local stack

```powershell
.\scripts\local\start-all.ps1
```

### Check component status

```powershell
.\scripts\local\status-all.ps1
```

### Mine a local block

```powershell
.\scripts\local\mine-local-block.ps1
```

### Run the local smoke test

```powershell
.\scripts\local\run-local-smoke-test.ps1
```

### Back up local chain data

```powershell
.\scripts\local\backup-local-chain.ps1
```

### Stop managed processes

```powershell
.\scripts\local\stop-all.ps1
```

### Reset the local rehearsal chain

```powershell
.\scripts\local\reset-local-chain.ps1
```

Reset commands must never be used against a future public production network.

---

## Manual component startup

### Start the node

```powershell
cargo run -p veiron-node -- --config configs/mainnet-candidate.toml start-node
```

### Check node status

```powershell
cargo run -p veiron-node -- --config configs/mainnet-candidate.toml node-status
```

### Print the configured genesis hash

```powershell
cargo run -p veiron-node -- --config configs/mainnet-candidate.toml print-genesis-hash
```

### Mine a block through the node

```powershell
cargo run -p veiron-node -- --config configs/mainnet-candidate.toml mine-block
```

### Start the RPC gateway

```powershell
cargo run -p veiron-rpc-gateway -- --config configs/rpc.mainnet-candidate.toml
```

### Create a wallet

```powershell
cargo run -p veiron-wallet -- --network mainnet-candidate create-wallet
```

### Index the local chain

```powershell
cargo run -p veiron-indexer -- --network mainnet-candidate index-chain
```

### Start the explorer

```powershell
cd veiron-explorer
npm install
npm run dev
```

---

## Mainnet Candidate meaning

The term **Mainnet Candidate** means that the repository contains configurations and components shaped like a future production network.

It does not mean:

* public mainnet;
* production-ready financial infrastructure;
* externally audited software;
* irreversible launch;
* exchange-ready asset;
* guaranteed network stability;
* guaranteed token value.

The candidate profile uses:

* the `vire` address prefix;
* candidate genesis configuration;
* separated storage;
* candidate network identifiers;
* protected reset behavior;
* production-shaped ports and service names.

It exists so that operators can rehearse the future deployment model without falsely claiming that the network has launched.

---

## Public launch requirements

Veiron must not be described as a live public mainnet until the public-launch gate is completed.

The current launch requirements include:

1. independent genesis verification;
2. multi-host P2P soak testing;
3. public or independently operated bootstrap topology;
4. production storage review;
5. tested backup and restore procedures;
6. disk-failure and corruption recovery testing;
7. RPC abuse and load testing;
8. mining-endpoint abuse testing;
9. external security review;
10. wallet-keystore review;
11. deployment-package review;
12. incident-response procedures;
13. release artifact signing;
14. explicit and documented go-live approval.

See:

```text
docs/release/NETWORK_MATURITY.md
docs/release/MAINNET_CANDIDATE_CHECKLIST.md
docs/security/SECURITY_GATE.md
```

---

## Current limitations

Important current limitations include:

* no public live mainnet;
* no independent external security audit;
* no long-running public multi-host network;
* no production-grade pool payout signer;
* no production mining-pool deployment;
* no smart-contract runtime;
* no staking protocol;
* no DAO;
* no Passport implementation;
* no NFT protocol implementation;
* no marketplace implementation;
* candidate-class chain storage;
* incomplete production DDoS and abuse protection;
* unsigned or partially signed release trust chain;
* limited real-world adversarial testing.

These limitations are expected during development and are documented to prevent prototype functionality from being mistaken for production readiness.

---

## Planned development direction

Development is expected to proceed through controlled technical milestones.

### Base-network maturity

* improve chain storage durability;
* improve synchronization;
* expand fork and reorganization testing;
* harden peer scoring and bans;
* improve seed-node operation;
* add long-running multi-host testing;
* strengthen RPC boundaries;
* improve monitoring and incident response.

### Wallet and product maturity

* hardware-backed or isolated signing paths;
* signed desktop packages;
* signed updater metadata;
* transaction simulation and warnings;
* improved backup and recovery flows;
* read-only browser integrations;
* developer signing helpers without key custody.

### Execution layer research

* deterministic WASM runtime;
* gas metering;
* contract storage;
* contract events;
* execution limits;
* upgrade rules;
* developer testing environment.

### Future product research

* native asset standards;
* software-license proofs;
* NFT and game-item standards;
* Passport proofs;
* file and storage commitments;
* encrypted communication permissions;
* marketplace settlement.

Planned features are not considered available until code, tests, documentation and user-facing status are all present.

---

## Security

Security-sensitive reports should not be disclosed publicly before maintainers have had a reasonable opportunity to investigate and patch the issue.

Do not include the following in issues, commits, logs or screenshots:

* wallet mnemonics;
* private keys;
* API tokens;
* passwords;
* `.env` files;
* production configuration secrets;
* private RPC credentials;
* database credentials;
* Cloudflare credentials;
* signing keys;
* wallet files.

Security documentation is located under:

```text
docs/security/
```

Before any public mainnet launch, the node, consensus implementation, RPC, miner, wallet, keystore and deployment path require independent security review.

---

## Runtime data

Runtime data must remain outside the Git repository.

Do not commit:

```text
.env
.veiron-local/
.veiron-mainnet/
wallet files
mnemonics
private keys
logs
database dumps
release secrets
local explorer builds
temporary release artifacts
```

Mainnet Candidate wallet data is stored under the user's home directory:

```text
~/.veiron-mainnet/wallets/
```

On Windows this generally resolves inside the current user's profile directory.

---

## Documentation

Primary documentation areas:

```text
docs/protocol/
docs/architecture/
docs/tokenomics/
docs/api/
docs/security/
docs/legal/
docs/release/
docs/engineering/
docs/operator/
```

Documentation must match the behavior of the implemented software.

When code and documentation disagree, consensus-critical behavior must be verified against `veiron-core`, tests and the approved protocol documents before making public claims.

---

## Licensing

The current licensing direction separates protocol infrastructure from proprietary product and operational layers.

General direction:

* protocol and chain-critical components are intended for Apache License 2.0;
* business, administrative and operational components may remain proprietary;
* each distributable component must include an explicit license before public release.

See:

```text
docs/legal/LICENSING_POLICY.md
```

The presence of source code in a public repository does not automatically grant rights beyond the license attached to that code.

---

## Contributing

Veiron is under active development.

Before submitting changes:

1. inspect the affected component and neighboring packages;
2. confirm whether the change affects consensus behavior;
3. update RPC, wallet, indexer, explorer and documentation when applicable;
4. run the relevant tests;
5. run formatting and lint checks;
6. avoid introducing public claims unsupported by code;
7. never commit secrets or wallet material.

Changes affecting any of the following require additional review:

* consensus;
* transaction serialization;
* addresses;
* signatures;
* genesis;
* block rewards;
* difficulty;
* Proof of Work;
* fork choice;
* protocol upgrades;
* wallet derivation;
* network identifiers.

See `AGENTS.md` for repository-wide engineering rules.

---

## Financial and legal notice

VIRE is the native asset planned for the Veiron blockchain protocol.

This repository does not offer:

* guaranteed returns;
* guaranteed mining income;
* guaranteed token value;
* investment advice;
* an exchange listing;
* a public token sale;
* staking rewards;
* guaranteed liquidity.

Mining profitability depends on factors including hardware, electricity cost, network difficulty, reward rules, uptime and future network participation.

Any future token distribution, public sale, marketplace payment system, exchange integration, treasury or reward program must undergo separate technical, economic and legal review.

---

## Honest public wording

The following descriptions are currently appropriate:

* Mainnet Candidate;
* Prototype;
* local operator stack;
* controlled VPS rehearsal;
* experimental mining pool;
* blockchain under active development.

The following descriptions are not currently appropriate:

* live mainnet;
* production mainnet;
* production-ready blockchain;
* audited network;
* live public mining pool;
* live smart-contract platform;
* live NFT ecosystem;
* guaranteed investment;
* guaranteed mining returns.

---

## Project summary

Veiron Network is a Rust-based Proof-of-Work Layer 1 under active development.

The repository already contains a runnable blockchain foundation, including consensus logic, account state, signed transactions, a node, wallet, RPC gateway, indexer, explorer, NVIDIA GPU miner, experimental mining pool and desktop Control Center.

The project remains a Mainnet Candidate prototype. Its next major challenge is not simply adding more features, but proving that the existing base network can operate securely, reliably and independently under real-world conditions.

---

## Maintainer

Veiron Network is currently developed and maintained by:

```text
Founder and lead developer: z3dC0d3
GitHub: andreidohot
```

---

## Disclaimer

This software is under active development and may contain defects, incomplete functionality or breaking changes.

Do not use Mainnet Candidate builds to store funds or assets that you cannot afford to lose.

No part of this repository should be interpreted as financial, legal or investment advice.
