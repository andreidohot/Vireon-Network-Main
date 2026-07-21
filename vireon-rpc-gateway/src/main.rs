use axum::serve;
use clap::Parser;
use std::net::SocketAddr;
use std::path::PathBuf;
use tokio::net::TcpListener;
use vireon_rpc_gateway::{router, RpcConfig, RpcState};

const DEFAULT_RPC_CONFIG_PATH: &str = "configs/rpc.mainnet-candidate.toml";
const DEFAULT_NODE_CONFIG_PATH: &str = "configs/mainnet-candidate.toml";
const RPC_EXAMPLES: &str = "\
Examples:
  vireon-rpc-gateway --config configs/rpc.local.toml --node-config configs/local.toml
  vireon-rpc-gateway --config configs/rpc.mainnet-candidate.toml --node-config configs/mainnet-candidate.toml
";

#[derive(Debug, Parser)]
#[command(name = "vireon-rpc-gateway")]
#[command(about = "Mainnet Candidate RPC gateway with explicit endpoint exposure profiles")]
#[command(after_help = RPC_EXAMPLES)]
struct Cli {
    #[arg(long, default_value = DEFAULT_RPC_CONFIG_PATH)]
    config: PathBuf,
    #[arg(long, default_value = DEFAULT_NODE_CONFIG_PATH)]
    node_config: PathBuf,
    #[arg(long, default_value_t = false)]
    check_config: bool,
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();
    let result = async {
        let config = RpcConfig::load_from_path(&cli.config)?;
        if cli.check_config {
            println!(
                "valid RPC config={} network_id={} access_mode={:?}",
                cli.config.display(),
                config.network_id,
                config.access_mode
            );
            return Ok::<(), vireon_rpc_gateway::RpcError>(());
        }
        let state = RpcState::new(config.clone()).with_node_config_path(cli.node_config.clone());
        let app = router(state);
        let addr: SocketAddr = format!("{}:{}", config.bind_host, config.bind_port)
            .parse::<SocketAddr>()
            .map_err(|error| vireon_rpc_gateway::RpcError::Config(error.to_string()))?;

        let listener = TcpListener::bind(addr).await?;
        println!(
            "vireon-rpc-gateway listening on http://{}:{} (config={}, node_config={}, network_id={}, {}, access_mode={:?})",
            config.bind_host,
            config.bind_port,
            cli.config.display(),
            cli.node_config.display(),
            config.network_id,
            config.status_label,
            config.access_mode
        );
        serve(listener, app).await?;
        Ok::<(), vireon_rpc_gateway::RpcError>(())
    }
    .await;

    if let Err(error) = result {
        eprintln!("vireon-rpc-gateway error: {error}");
        std::process::exit(1);
    }
}
