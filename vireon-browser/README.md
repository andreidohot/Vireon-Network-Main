# vireon-browser

Status: Prototype / Mainnet Candidate / not store-ready

The browser prototype combines a Manifest V3 extension UI with a Rust native
messaging host. The extension never stores mnemonics or private keys; encrypted
keystore, signing, account composition, and RPC submission stay in the host.

## Security boundary

- default keystore: `.vireon-mainnet/browser-host/wallets/` under the user home;
- Argon2id plus AES-256-GCM encrypted wallet file;
- mnemonic appears only in explicit host CLI recovery flows and is never
  returned to the extension;
- extension send/sign requests require UI confirmation, with optional native OS
  confirmation through `--require-os-confirm`;
- no mining, pool worker, WASM private-key, or unauthenticated dApp-connect path.

## Build and inspect

```powershell
cargo build -p vireon-browser-host --release
cargo run -p vireon-browser-host -- --print-info
cargo run -q -p vireon-browser-host -- --check-health --json
```

Create a recoverable encrypted wallet from the host CLI:

```powershell
cargo run -p vireon-browser-host -- --init-wallet --passphrase "your-long-passphrase"
cargo run -p vireon-browser-host -- --export-public
```

Import recovery words only through the CLI:

```powershell
cargo run -p vireon-browser-host -- --import-mnemonic --mnemonic "word1 word2 ..." --passphrase "..."
```

## Register the native host on Windows

1. Load `vireon-browser/extension` as an unpacked Chrome/Edge extension.
2. Copy its 32-character extension ID.
3. Run:

```powershell
.\scripts\browser\register-native-host.ps1 -ExtensionId <id> -Build -Browser Chrome
```

Use `-Browser All`, `-RequireOsConfirm`, or `-LocalRpc` only when required.
Remove the registration with:

```powershell
.\scripts\browser\unregister-native-host.ps1 -Browser All -RemoveInstallDir
```

Linux registration:

```bash
./scripts/browser/register-native-host.sh --extension-id <id> --build --browser chrome
```

## Development protocol

Run `cargo run -p vireon-browser-host -- --jsonl --local` and send line-delimited
JSON requests such as `{"id":1,"method":"ping"}`. Native browser mode uses the
standard little-endian `u32` length plus UTF-8 JSON framing.

See `../docs/architecture/07_BROWSER_EXTENSION_AND_NATIVE_HOST.md` for the
method and trust-boundary summary.
