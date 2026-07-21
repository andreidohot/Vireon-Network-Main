# Mainnet Candidate Genesis

Status: Draft / Mainnet Candidate / Prototype

Canonical files:
- node config: `configs/mainnet-candidate.toml`
- genesis config: `configs/genesis.mainnet-candidate.toml`
- genesis review: `docs/release/GENESIS_REVIEW.mainnet-candidate.json`
- genesis approval: `docs/release/GENESIS_APPROVAL.mainnet-candidate.json`

Deterministic genesis inputs:
- network ID: `veiron-mainnet-candidate`
- human name: `Vireon Mainnet Candidate`
- address prefix: `vire`
- timestamp: `1720000000`
- difficulty leading zero bits: `16`
- recipient strategy: `default_miner_address`

Resolved deterministic recipient address:
- `vire1qr4y5mrru2w9yz4774g8kyewchue23mk46ltu7ujgg0w56g5gmfzc8s6fh0`

Deterministic genesis hash:
- `0000f156b7271a3807b16efdf96d21ac30011fbdcd2ce68af7fdd3bc77ae4f3d`

Current pinned review hash:
- `751e18b949e408119505cee9150739ce8f35db179d73a9e17b06c4df0e3cbe08`

The earlier `0000a26d...` hash was superseded by the FiroPoW candidate reset and
must not be used to initialize or validate the current candidate chain.

Current repository approval note:
- the committed approval file is a Draft / Mainnet Candidate / Prototype repository artifact;
- it exists so the current local candidate workflow can prove generation, review and pinning end to end;
- it does not claim public launch approval or external independent verification.

Safety rules:
- the node must refuse accidental chain-root regeneration for Mainnet Candidate unless `--force-genesis` is passed explicitly;
- the node must refuse startup or validation when the active deterministic genesis hash does not match the pinned approval record;
- changing `configs/mainnet-candidate.toml` or `configs/genesis.mainnet-candidate.toml` requires regenerating the review manifest and approval record.

Operator workflow:

```powershell
cargo run -p vireon-node -- --config configs/mainnet-candidate.toml print-genesis-hash
cargo run -p vireon-node -- --config configs/mainnet-candidate.toml export-genesis-review --output docs/release/GENESIS_REVIEW.mainnet-candidate.json
cargo run -p vireon-node -- --config configs/mainnet-candidate.toml approve-genesis --review-file docs/release/GENESIS_REVIEW.mainnet-candidate.json --approved-by <name> --output docs/release/GENESIS_APPROVAL.mainnet-candidate.json
cargo run -p vireon-node -- --config configs/mainnet-candidate.toml genesis-approval-status
```
