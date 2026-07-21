# Vireon Desktop

Status: Draft / Mainnet Candidate / Prototype / Not Mainnet Live

Native Windows 11 wallet and operator control-center prototype. It presents wallet, transaction signing, node validation, RPC, indexer, mining, explorer status, logs and backups through one application while retaining separate auditable Rust sidecars internally.

Recovery phrases are held in memory only and are never written by the app. Signed transactions are submitted directly and are not saved by the desktop app. Public wallet metadata contains no secret material and lives under `%LOCALAPPDATA%\Vireon\Desktop`.

```powershell
cargo run -p vireon-desktop
cargo build -p vireon-desktop --release
```

The source build uses the workspace scripts. The Windows package includes release sidecars for node, RPC, indexer and miner, so end users do not need Rust or Cargo. Runtime chain, mempool, index, miner and log data is stored under `%LOCALAPPDATA%\Vireon\ControlCenter\.vireon-local`; wallet secrets remain in Windows Credential Manager.

## Control Center areas

- Overview: dense chain, wallet, miner, index, supply, mempool and component health dashboard.
- Wallet Center: active balance, derivation, protected-key status, real address QR and indexed wallet activity.
- Send & Receive: exact amount, base-fee burn and priority-tip preview before local signing, plus the active receive address.
- Miner: CPU worker controls, current hashrate, template height, accepted blocks and honest telemetry availability states.
- Explorer: local search and chain/index summary with a hand-off to the full localhost React explorer.
- Blocks: recent indexed blocks and consensus fields including hashes, Merkle root, PoW difficulty, nonce, reward and fees.
- Transactions: recent mined transfers with authorization, lifecycle, fee and account activity fields.
- Nodes: local sidecar controls, P2P identity, connected peers, handshake status, roles, chain sync, logs and backups.
- Rewards: block rewards, priority fees and burned base fees calculated from the visible local index window.
- Assets: clearly labeled Planned/Research surfaces for native assets, NFTs, licenses, Passport and file proofs. These are not implemented or live.
- Settings & Security: active network/RPC boundaries, wallet creation/import, one-time recovery display and Windows Credential Manager details.

The native UI uses `services.rs` as its data-adapter boundary. It reads real localhost RPC, indexer, P2P and miner state. It does not generate market prices, pool shares, GPU telemetry, fiat valuations or production claims when those data sources do not exist.

Vireon is PoW. The application does not invent staking or delegated validator rights; a running full node independently validates the chain.
Every running full node is shown as a `Full Validator`: it has equal authority to verify and reject invalid genesis, PoW, blocks, transactions, supply and state. No stake, license or central permission grants additional consensus rights.

Only one local Vireon stack may own the candidate RPC and P2P ports. Startup fails with the owning process and path when another source or packaged installation already uses `10787` or `20787`, preventing the desktop, node and miner from silently reading different chains.

## Windows packages

```powershell
.\scripts\release\build-windows-installer.ps1
```

This produces a portable ZIP and, when Inno Setup 6 is installed, a per-user Windows installer under `release-artifacts/`. Code signing and automatic updates remain separate release gates.

The installer contains explicit network, persistent-data and wallet-safety steps. Chain, mempool, index, logs, backups and the P2P identity are retained under `%LOCALAPPDATA%\Vireon\ControlCenter\.vireon-local` during upgrades and uninstall. No public seed node is bundled in the current candidate package.
