$ErrorActionPreference = "Stop"
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cargo run -p vireon-rpc-gateway -- --config vireon-rpc-gateway/config/devnet-rpc.toml
