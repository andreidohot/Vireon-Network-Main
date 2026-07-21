# vireon-node

Status: Mainnet Candidate / Prototype / not public Mainnet

`vireon-node` owns canonical chain persistence, mempool admission, mining
templates, submitted-block validation, and libp2p synchronization around
`vireon-core` consensus.

## P2P v3 and fork choice

- TCP transport with Noise encryption and Yamux multiplexing;
- persistent node identity and handshake binding to protocol version, network
  ID, chain magic, and actual genesis hash;
- signed transaction and miner-presence gossip;
- exponential block locators and header-first verification before bodies;
- bounded direct-extension and divergent-branch synchronization;
- adoption only after full validation and strictly greater cumulative work;
- deterministic equal-work retention;
- atomic canonical JSONL replacement and detached-transaction mempool recovery;
- persistent peer reputation, temporary bans, and refusal of banned peers.

All connected nodes must use P2P protocol v3. Staged reorganization is bounded
to 2,048 blocks. Durable branch storage, deep-reorg recovery, broader discovery,
resume, and multi-host soak remain production gates.

## Persistence and safety

- tip growth uses locked append plus fsync;
- validated reorganization uses atomic whole-chain replacement;
- candidate genesis review/approval and height-zero checkpoint are mandatory;
- wrong network/genesis, broken linkage, invalid PoW/difficulty/version/time,
  duplicate transactions, invalid state, and coinbase overpayment are rejected;
- Mainnet Candidate reset is unavailable and regeneration requires explicit
  `--force-genesis` review flow;
- `JsonlBlockStore` is the current auditable candidate backend, not the final
  production storage decision.

## Mining integration

`create_block_template` creates a bounded immutable nonce-zero candidate.
`submit_mined_block` rechecks current tip, consensus work, state, and mempool
effects under lock before atomic persistence. Miners cannot select reward, fees,
timestamp, difficulty, transactions, or network identity.

## Primary commands

- `start-node`, `node-status`, `validate-chain`, `peers`, `shutdown`;
- `mempool-status`, `balance`, `state`, `submit-tx`;
- `print-genesis-hash`, `export-genesis-review`, `approve-genesis`,
  `genesis-approval-status`;
- operator/test block helpers documented by the CLI.

`configs/mainnet-candidate.toml` is the default product/operator configuration.
Devnet/Testnet configurations are internal test profiles.
