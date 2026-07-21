use clap::{Parser, Subcommand};
use serde::Serialize;
use std::path::PathBuf;
use vireon_core::{MnemonicWordCount, Network, WalletDerivationPath};
use vireon_wallet::{
    balance, create_wallet, default_chain_data_dir, default_rpc_base_url_for_network,
    default_signed_tx_dir_path, default_wallet_dir_path, export_public_info,
    import_dev_private_key, import_mnemonic_wallet, sign_tx, submit_tx, verify_tx, wallet_address,
    wallet_status,
};

const WALLET_EXAMPLES: &str = "\
Examples:
  # Mainnet-candidate wallets are AES-256-GCM encrypted; set VIREON_WALLET_PASSPHRASE first.
  $env:VIREON_WALLET_PASSPHRASE='your-strong-passphrase'
  vireon-wallet --network mainnet-candidate --wallet-dir .vireon-local/wallets create-wallet --word-count 24
  vireon-wallet --network mainnet-candidate --wallet-dir .vireon-local/wallets import-mnemonic --phrase \"abandon ...\" --account 0 --change 0 --address-index 0
  vireon-wallet --network mainnet-candidate --wallet-dir .vireon-local/wallets address
  vireon-wallet --network mainnet-candidate --rpc-base-url http://127.0.0.1:10787 balance vire1...
  vireon-wallet --network mainnet-candidate --wallet-dir .vireon-local/wallets --signed-tx-dir .vireon-local/wallets/signed-txs --chain-data-dir .vireon-local/chain sign-tx --to vire1... --amount 1.0 --fee 0.01
";

#[derive(Debug, Parser)]
#[command(name = "vireon-wallet")]
#[command(about = "Draft / Mainnet Candidate / Prototype wallet CLI for Vireon Network")]
#[command(after_help = WALLET_EXAMPLES)]
struct Cli {
    #[arg(long, default_value = "mainnet-candidate")]
    network: Network,
    #[arg(long)]
    wallet_dir: Option<PathBuf>,
    #[arg(long)]
    signed_tx_dir: Option<PathBuf>,
    #[arg(long)]
    rpc_base_url: Option<String>,
    #[arg(long)]
    chain_data_dir: Option<PathBuf>,
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    CreateWallet {
        #[arg(long, default_value_t = 24)]
        word_count: u16,
        #[arg(long, default_value_t = 0)]
        account: u32,
        #[arg(long, default_value_t = 0)]
        change: u32,
        #[arg(long, default_value_t = 0)]
        address_index: u32,
    },
    ImportMnemonic {
        #[arg(long)]
        phrase: String,
        #[arg(long, default_value = "")]
        passphrase: String,
        #[arg(long, default_value_t = 0)]
        account: u32,
        #[arg(long, default_value_t = 0)]
        change: u32,
        #[arg(long, default_value_t = 0)]
        address_index: u32,
    },
    ImportPrivateKey {
        #[arg(long)]
        private_key_hex: String,
    },
    Network,
    Address,
    Balance {
        address: String,
    },
    SignTx {
        #[arg(long)]
        to: String,
        #[arg(long)]
        amount: String,
        #[arg(long)]
        fee: String,
    },
    VerifyTx {
        #[arg(long)]
        tx_file: PathBuf,
    },
    SubmitTx {
        #[arg(long)]
        tx_file: PathBuf,
    },
    ExportPublicInfo,
    WalletStatus,
}

fn main() {
    let cli = Cli::parse();
    let wallet_dir = cli
        .wallet_dir
        .or_else(|| default_wallet_dir_path(cli.network).ok())
        .unwrap_or_else(|| PathBuf::from(cli.network.default_data_root()).join("wallets"));
    let signed_tx_dir = cli
        .signed_tx_dir
        .or_else(|| default_signed_tx_dir_path(cli.network).ok())
        .unwrap_or_else(|| PathBuf::from(cli.network.default_data_root()).join("signed-txs"));
    let chain_data_dir = cli
        .chain_data_dir
        .unwrap_or_else(|| default_chain_data_dir(cli.network));
    let rpc_base_url = cli
        .rpc_base_url
        .unwrap_or_else(|| default_rpc_base_url_for_network(cli.network));

    let result = match cli.command {
        Command::CreateWallet {
            word_count,
            account,
            change,
            address_index,
        } => json_output(
            MnemonicWordCount::from_u16(word_count)
                .map_err(vireon_wallet::WalletError::from)
                .and_then(|count| {
                    create_wallet(
                        &wallet_dir,
                        cli.network,
                        count,
                        WalletDerivationPath::new(account, change, address_index),
                    )
                }),
        ),
        Command::ImportMnemonic {
            phrase,
            passphrase,
            account,
            change,
            address_index,
        } => json_output(import_mnemonic_wallet(
            &wallet_dir,
            &phrase,
            &passphrase,
            cli.network,
            WalletDerivationPath::new(account, change, address_index),
        )),
        Command::ImportPrivateKey { private_key_hex } => json_output(import_dev_private_key(
            &wallet_dir,
            &private_key_hex,
            cli.network,
        )),
        Command::Network => json_output(wallet_status(
            cli.network,
            &wallet_dir,
            &signed_tx_dir,
            &rpc_base_url,
        )),
        Command::Address => wallet_address(&wallet_dir),
        Command::Balance { address } => json_output(balance(&rpc_base_url, &address)),
        Command::SignTx { to, amount, fee } => sign_tx(
            &wallet_dir,
            &signed_tx_dir,
            &chain_data_dir,
            &to,
            &amount,
            &fee,
        )
        .and_then(|value| json_output(Ok(value))),
        Command::VerifyTx { tx_file } => json_output(verify_tx(&tx_file)),
        Command::SubmitTx { tx_file } => json_output(submit_tx(&rpc_base_url, &tx_file)),
        Command::ExportPublicInfo => json_output(export_public_info(&wallet_dir)),
        Command::WalletStatus => json_output(wallet_status(
            cli.network,
            &wallet_dir,
            &signed_tx_dir,
            &rpc_base_url,
        )),
    };

    match result {
        Ok(output) => println!("{output}"),
        Err(error) => {
            eprintln!("vireon-wallet error: {error}");
            std::process::exit(1);
        }
    }
}

fn json_output<T: Serialize>(
    value: vireon_wallet::WalletResult<T>,
) -> vireon_wallet::WalletResult<String> {
    value.and_then(|inner| {
        serde_json::to_string_pretty(&inner).map_err(vireon_wallet::WalletError::from)
    })
}
