# Checkpoint Policy

Status: Implemented / Mainnet Candidate

## Accepted Launch Direction

`TM-110` freezes Vireon's early-network checkpoint direction as:
- social/hardcoded checkpoints in early environments;
- checkpoints carried by node releases;
- progressive relaxation only through an explicit later decision;
- current canonical Mainnet Candidate checkpoint at height `0`.

## Rule

Checkpoint policy ID:
- `vireon-hardcoded-checkpoints-v1`

Checkpoint mode:
- `social-hardcoded-early-network`

Current active canonical checkpoint:
- network: `veiron-mainnet-candidate`
- height: `0`
- hash: `0000f156b7271a3807b16efdf96d21ac30011fbdcd2ce68af7fdd3bc77ae4f3d`

## Current Implementation Note

- `vireon-core` now exposes checkpoint schedules per network;
- `vireon-core` now validates checkpointed heights during chain acceptance and full chain rebuild;
- the current repository pins the deterministic Mainnet Candidate genesis hash as the first canonical checkpoint;
- Devnet and Testnet do not yet pin additional checkpoint heights in the current repository state.

## Relaxation Path

This launch policy assumes:
- new PoW networks are vulnerable during early hashrate growth;
- checkpointing is an early-network safety measure, not a permanent decentralization target.

Any checkpoint removal or relaxation later must:
- be explicit;
- be documented;
- not silently happen through implementation drift.

## Impact Notes

- Core: chain validation must reject blocks at checkpoint heights when the hash mismatches.
- Node: startup and validation built on top of `Chain::from_blocks(...)` inherit checkpoint enforcement automatically.
- Wallet, Explorer and RPC: no user-facing live claim should imply checkpoint independence until policy is explicitly relaxed.
- Docs: public communication should describe checkpointing honestly as an early-network safety rule, not as a forever rule.
