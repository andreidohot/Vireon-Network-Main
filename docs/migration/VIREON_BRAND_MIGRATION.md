# Vireon Brand Migration

Status: Mainnet Candidate compatibility policy

The product name is **Vireon**. New package names, executables, environment
variables, UI copy and runtime directories use `Vireon`, `vireon` and `VIREON`.

## Compatibility identifiers

Some serialized identifiers retain the historical `veiron` spelling. They are
protocol or persistence values, not product branding:

- network IDs: `veiron-devnet`, `veiron-testnet`, `veiron-mainnet-candidate`;
- transaction signing domain: `veiron-tx-ed25519-v1`;
- wallet schema IDs already written to disk;
- genesis review and approval standard IDs;
- published wire-test-vector payloads.

Changing any of these values without a separately approved protocol migration
would split the network, change transaction signatures, invalidate genesis
evidence or make existing wallet data unreadable.

## Non-destructive runtime migration

- Desktop startup copies missing Veiron Control Center files into the Vireon
  profile and leaves the legacy profile intact.
- The keystore helper reads a missing Vireon credential from the legacy Veiron
  service, writes an equivalent Vireon credential and retains the old entry.
- VPS repair copies legacy chain/control/pool data into Docker-managed state.
  Legacy services and conflicting containers are stopped and disabled or
  renamed for rollback; they are not deleted.

The active Docker deployment lives only in
`vireon-release/vps-control-plane/`. The `veiron-docker` staging folder was an
import source and must not become a parallel control-plane implementation.
