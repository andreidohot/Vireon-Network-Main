use axum::serve;
use clap::Parser;
use std::net::SocketAddr;
use std::path::PathBuf;
use tokio::net::TcpListener;
use vireon_mining_pool::{router, PoolConfig, PoolState, PoolStore};

#[derive(Debug, Parser)]
#[command(
    name = "vireon-mining-pool",
    about = "Vireon pooled mining coordinator prototype"
)]
struct Cli {
    #[arg(long, default_value = "vireon-mining-pool/config.toml")]
    config: PathBuf,
    #[arg(long)]
    check_config: bool,
}

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("vireon-mining-pool error: {error}");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();
    let config = PoolConfig::load(&cli.config)?;
    if cli.check_config {
        println!(
            "valid pool config={} network_id={} bind={}:{}",
            cli.config.display(),
            config.network_id,
            config.bind_host,
            config.bind_port
        );
        return Ok(());
    }
    let store = PoolStore::load(config.data_dir.clone(), config.max_stored_shares)?;
    let state = PoolState::new(config.clone(), store)?;
    let address: SocketAddr = format!("{}:{}", config.bind_host, config.bind_port).parse()?;
    let listener = TcpListener::bind(address).await?;
    println!(
        "vireon-mining-pool listening on http://{address} ({})",
        config.status_label
    );
    serve(
        listener,
        router(state).into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;
    Ok(())
}
