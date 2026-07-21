# @vireon/sdk

Public **TypeScript** client for Vireon **Mainnet Candidate / Prototype**.

## Scope

| Included | Not included |
|----------|----------------|
| RPC health, chain status, tip, blocks | Wallet key generation / signing |
| Address balance & account (next nonce) | Smart contracts / VM |
| Pool status, history, miner view, payouts list | Pool admin payout APIs |
| Block maturity helper (`height + N confs`) | Marketplace, Passport, staking |

Network label: **not public live Mainnet**. See `docs/release/NETWORK_MATURITY.md`.

## Install (workspace)

```bash
cd vireon-sdk
npm install
npm run build
```

## Quick start

```ts
import { createVireonClient, poolBlockMaturity } from "@vireon/sdk";

const vireon = createVireonClient({
  rpcUrl: "https://rpcnode.dohotstudio.com",
  poolUrl: "https://rpcnode.dohotstudio.com/pool",
});

const health = await vireon.health();
const chain = await vireon.status();
const pool = await vireon.poolStatus();

console.log(health.network_id, chain.height, pool.connected_workers);

// Maturity: immature until tip >= blockHeight + block_maturity_confirmations (default 12)
const blocks = await vireon.poolBlocksWithMaturity();
for (const b of blocks) {
  console.log(b.height, b.maturity.label, b.maturity.remaining);
}
```

## API surface (v0.1)

### RPC

- `health()`
- `status()`
- `chainTip()`
- `blockByHeight(height)`
- `transaction(hash)`
- `addressBalance(vire1…)`
- `addressAccount(vire1…)`
- `indexerSummary()`
- `p2pStatus()`

### Pool (public)

- `poolStatus()`
- `poolHistory()`
- `poolMiner(address)`
- `poolPayouts()`
- `poolBlocksWithMaturity()`

### Helpers

- `poolBlockMaturity(height, tip, required, statusField?)`

## Examples

See `../vireon-examples/`.

## License

Apache-2.0 (aligns with protocol / tooling direction in `docs/legal/LICENSING_POLICY.md`).
