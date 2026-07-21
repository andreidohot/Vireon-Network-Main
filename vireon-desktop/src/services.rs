use crate::secure::{self, DesktopError, Result, WalletMetadata};
use serde::Deserialize;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use vireon_core::{
    generate_mnemonic, hash_to_hex, next_base_fee, Address, Amount, MnemonicWordCount, Network,
    PrivateKey, Transaction, WalletDerivationPath,
};
use zeroize::Zeroize;

pub const RPC_URL: &str = "https://rpcnode.dohotstudio.com";

#[derive(Clone)]
pub struct CreatedWallet {
    pub metadata: WalletMetadata,
    pub mnemonic: String,
}

#[derive(Clone, Default)]
pub struct NetworkSnapshot {
    pub online: bool,
    pub status_label: String,
    pub height: Option<u64>,
    pub block_count: usize,
    pub mempool_count: usize,
    pub balance_atomic: Option<u64>,
    pub emitted_supply_atomic: Option<u64>,
    pub max_supply_atomic: Option<u64>,
    pub tip_hash: Option<String>,
    pub indexed_height: Option<u64>,
    pub indexed_blocks: usize,
    pub indexed_transactions: usize,
    pub indexed_addresses: usize,
    pub latest_block_timestamp: Option<u64>,
    pub latest_block_transactions: usize,
    pub latest_block_reward_atomic: Option<u64>,
    pub latest_block_fees_atomic: Option<u64>,
    pub node_running: bool,
    pub rpc_running: bool,
    pub indexer_ready: bool,
    pub miner_running: bool,
    pub miner_hashrate_hs: Option<f64>,
    pub miner_threads: Option<usize>,
    pub miner_height: Option<u64>,
    pub miner_accepted_blocks: Option<u64>,
    pub local_peer_id: Option<String>,
    pub p2p_listen_addresses: Vec<String>,
    pub connected_peer_count: usize,
    pub validated_peer_count: usize,
    pub mining_peer_count: usize,
    pub validating_peer_count: usize,
    pub p2p_syncing: bool,
    pub p2p_error: Option<String>,
    pub recent_blocks: Vec<DesktopBlock>,
    pub recent_transactions: Vec<DesktopTransaction>,
    pub peers: Vec<DesktopPeer>,
    pub detail: String,
}

#[derive(Clone, Default, Deserialize)]
pub struct DesktopBlock {
    pub height: u64,
    pub hash: String,
    pub previous_hash: String,
    pub merkle_root: String,
    pub timestamp: u64,
    pub nonce: u64,
    pub difficulty_leading_zero_bits: u8,
    pub transaction_count: usize,
    pub miner_address: String,
    pub coinbase_payout_atomic: u64,
    pub miner_reward_atomic: u64,
    pub fees_atomic: u64,
    pub burned_fees_atomic: u64,
    pub priority_fees_atomic: u64,
    pub base_fee_atomic: u64,
    pub transaction_hashes: Vec<String>,
}

#[derive(Clone, Default, Deserialize)]
pub struct DesktopTransaction {
    pub lifecycle_status: String,
    pub hash: String,
    pub block_height: u64,
    pub transaction_index: usize,
    pub nonce: u64,
    pub from: Option<String>,
    pub to: String,
    pub amount_atomic: u64,
    pub effective_fee_atomic: u64,
    pub burned_fee_atomic: u64,
    pub effective_priority_fee_atomic: u64,
    pub authorization_state: String,
}

#[derive(Clone, Default, Deserialize)]
pub struct DesktopPeer {
    pub peer_id: String,
    pub address: Option<String>,
    pub handshake_validated: bool,
    pub best_height: Option<u64>,
    pub validating: bool,
    pub mining: bool,
    pub last_error: Option<String>,
}

#[derive(Default, Deserialize)]
struct RpcIndexData {
    blocks_by_height: BTreeMap<u64, DesktopBlock>,
    transactions_by_hash: BTreeMap<String, DesktopTransaction>,
}

#[derive(Clone)]
pub struct PreparedTransaction {
    pub recipient: String,
    pub amount_atomic: u64,
    pub tip_atomic: u64,
    pub base_fee_atomic: u64,
    pub total_atomic: u64,
    pub available_atomic: u64,
    pub nonce: u64,
    chain_tip: String,
}

#[derive(Clone)]
pub struct SubmissionResult {
    pub tx_hash: String,
    pub lifecycle_status: String,
    pub mempool_size: usize,
}

#[derive(Clone, Copy)]
pub enum OperatorCommand {
    Start,
    Stop,
    Restart,
    Status,
    Mine,
    Validate,
    Backup,
    StartMiner,
    StopMiner,
}

impl OperatorCommand {
    fn name(self) -> &'static str {
        match self {
            Self::Start => "start",
            Self::Stop => "stop",
            Self::Restart => "restart",
            Self::Status => "status",
            Self::Mine => "mine",
            Self::Validate => "validate",
            Self::Backup => "backup",
            Self::StartMiner => "miner-start",
            Self::StopMiner => "miner-stop",
        }
    }
}

#[derive(Deserialize)]
struct RpcStatus {
    status_label: String,
    block_count: usize,
    height: Option<u64>,
    tip_hash: Option<String>,
    emitted_supply_atomic: Option<u64>,
}

#[derive(Deserialize, Default)]
struct RpcMempoolStatus {
    pending_count: usize,
}

#[derive(Deserialize, Default)]
struct RpcIndexerStatus {
    initialized: bool,
    indexed_height: Option<u64>,
    indexed_block_count: usize,
}

#[derive(Deserialize, Default)]
struct RpcIndexerSummary {
    transaction_count: usize,
    address_count: usize,
}

#[derive(Deserialize, Default)]
struct RpcLatestBlock {
    timestamp: u64,
    transaction_count: usize,
    transactions: Vec<RpcLatestTransaction>,
}

#[derive(Deserialize, Default)]
struct RpcLatestTransaction {
    amount_atomic: u64,
    #[serde(default)]
    effective_fee_atomic: u64,
    #[serde(default)]
    from: Option<String>,
}

#[derive(Deserialize, Default)]
struct RpcSupply {
    emitted_supply_atomic: u64,
    max_supply_atomic: u64,
}

#[derive(Deserialize)]
struct MinerMetrics {
    hashrate_hs: f64,
    threads: usize,
    height: u64,
    accepted_blocks: u64,
    updated_at_unix_seconds: u64,
}

#[derive(Deserialize, Default)]
struct RpcP2pStatus {
    local_peer_id: String,
    listen_addresses: Vec<String>,
    connected_peer_count: usize,
    validated_peer_count: usize,
    mining_peer_count: usize,
    validating_peer_count: usize,
    syncing: bool,
    #[serde(default)]
    peers: Vec<DesktopPeer>,
    last_error: Option<String>,
    #[serde(default)]
    updated_at_unix_seconds: u64,
}

pub fn create_wallet() -> Result<CreatedWallet> {
    let mnemonic = generate_mnemonic(MnemonicWordCount::TwentyFour)
        .map_err(|error| DesktopError::Input(error.to_string()))?;
    let private_key = PrivateKey::from_mnemonic(&mnemonic, "", WalletDerivationPath::default())
        .map_err(|error| DesktopError::Input(error.to_string()))?;
    let metadata = persist_key(&private_key, "bip39-created")?;
    Ok(CreatedWallet { metadata, mnemonic })
}

pub fn import_wallet(mut phrase: String) -> Result<WalletMetadata> {
    let result = PrivateKey::from_mnemonic(&phrase, "", WalletDerivationPath::default())
        .map_err(|_| DesktopError::Input("recovery phrase is invalid".to_owned()))
        .and_then(|key| persist_key(&key, "bip39-imported"));
    phrase.zeroize();
    result
}

fn persist_key(key: &PrivateKey, origin: &str) -> Result<WalletMetadata> {
    let public_key = key.public_key();
    let address = Address::from_public_key_for_network(&public_key, Network::MainnetCandidate);
    let metadata = WalletMetadata::new(address.to_string(), public_key.to_hex(), origin);
    let mut secret = key.to_hex();
    secure::store_private_key(&mut secret)?;
    if let Err(error) = secure::save_metadata(&metadata) {
        secure::remove_private_key();
        return Err(error);
    }
    Ok(metadata)
}

pub fn network_snapshot(
    workspace: &Path,
    wallet: Option<&WalletMetadata>,
) -> Result<NetworkSnapshot> {
    let local_root = local_root(workspace);
    let process = |name: &str| managed_process_running(&local_root, name);
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(service_error)?;
    let response = match client.get(format!("{RPC_URL}/status")).send() {
        Ok(response) => response,
        Err(error) => {
            return Ok(NetworkSnapshot {
                node_running: process("node"),
                miner_running: process("miner"),
                detail: format!("Local RPC is offline: {error}"),
                ..Default::default()
            });
        }
    };
    if !response.status().is_success() {
        return Err(DesktopError::Service(format!(
            "local RPC returned {}",
            response.status()
        )));
    }
    let status: RpcStatus = response.json().map_err(service_error)?;
    let mempool = client
        .get(format!("{RPC_URL}/mempool/status"))
        .send()
        .ok()
        .and_then(|response| response.json::<RpcMempoolStatus>().ok())
        .unwrap_or_default();
    let indexer = client
        .get(format!("{RPC_URL}/indexer/status"))
        .send()
        .ok()
        .and_then(|response| response.json::<RpcIndexerStatus>().ok())
        .unwrap_or_default();
    let indexer_summary = client
        .get(format!("{RPC_URL}/indexer/summary"))
        .send()
        .ok()
        .and_then(|response| response.json::<RpcIndexerSummary>().ok())
        .unwrap_or_default();
    let latest_block = client
        .get(format!("{RPC_URL}/blocks/latest"))
        .send()
        .ok()
        .and_then(|response| response.json::<RpcLatestBlock>().ok());
    let supply = client
        .get(format!("{RPC_URL}/supply"))
        .send()
        .ok()
        .and_then(|response| response.json::<RpcSupply>().ok())
        .unwrap_or_default();
    let p2p = client
        .get(format!("{RPC_URL}/p2p/status"))
        .send()
        .ok()
        .and_then(|response| response.json::<RpcP2pStatus>().ok())
        .unwrap_or_default();
    let index_data = client
        .get(format!("{RPC_URL}/indexer/summary"))
        .send()
        .ok()
        .and_then(|response| response.json::<RpcIndexData>().ok())
        .unwrap_or_default();
    let mut recent_blocks = index_data
        .blocks_by_height
        .into_values()
        .collect::<Vec<_>>();
    recent_blocks.sort_by_key(|block| std::cmp::Reverse(block.height));
    recent_blocks.truncate(12);
    let mut recent_transactions = index_data
        .transactions_by_hash
        .into_values()
        .collect::<Vec<_>>();
    recent_transactions.sort_by_key(|transaction| {
        std::cmp::Reverse((transaction.block_height, transaction.transaction_index))
    });
    recent_transactions.truncate(20);
    let balance = wallet
        .map(|wallet| vireon_wallet::balance(RPC_URL, &wallet.address))
        .transpose()
        .map_err(service_error)?
        .map(|response| response.balance_atomic);
    let miner_metrics = fs::read(local_root.join("miner/metrics.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<MinerMetrics>(&bytes).ok());
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let miner_telemetry_fresh = miner_metrics
        .as_ref()
        .is_some_and(|metrics| now.saturating_sub(metrics.updated_at_unix_seconds) <= 30);
    let p2p_telemetry_fresh =
        p2p.updated_at_unix_seconds > 0 && now.saturating_sub(p2p.updated_at_unix_seconds) <= 30;
    Ok(NetworkSnapshot {
        online: true,
        status_label: status.status_label,
        height: status.height,
        block_count: status.block_count,
        mempool_count: mempool.pending_count,
        balance_atomic: balance,
        emitted_supply_atomic: status
            .emitted_supply_atomic
            .or(Some(supply.emitted_supply_atomic)),
        max_supply_atomic: Some(supply.max_supply_atomic),
        tip_hash: status.tip_hash,
        indexed_height: indexer.indexed_height,
        indexed_blocks: indexer.indexed_block_count,
        indexed_transactions: indexer_summary.transaction_count,
        indexed_addresses: indexer_summary.address_count,
        latest_block_timestamp: latest_block.as_ref().map(|block| block.timestamp),
        latest_block_transactions: latest_block
            .as_ref()
            .map_or(0, |block| block.transaction_count),
        latest_block_reward_atomic: latest_block.as_ref().and_then(|block| {
            block
                .transactions
                .iter()
                .find(|transaction| transaction.from.is_none())
                .map(|transaction| transaction.amount_atomic)
        }),
        latest_block_fees_atomic: latest_block.as_ref().map(|block| {
            block
                .transactions
                .iter()
                .map(|transaction| transaction.effective_fee_atomic)
                .sum()
        }),
        node_running: process("node") || (p2p_telemetry_fresh && !p2p.local_peer_id.is_empty()),
        rpc_running: true,
        indexer_ready: indexer.initialized,
        miner_running: process("miner") || miner_telemetry_fresh,
        miner_hashrate_hs: miner_metrics.as_ref().map(|metrics| metrics.hashrate_hs),
        miner_threads: miner_metrics.as_ref().map(|metrics| metrics.threads),
        miner_height: miner_metrics.as_ref().map(|metrics| metrics.height),
        miner_accepted_blocks: miner_metrics
            .as_ref()
            .map(|metrics| metrics.accepted_blocks),
        local_peer_id: (!p2p.local_peer_id.is_empty()).then_some(p2p.local_peer_id),
        p2p_listen_addresses: p2p.listen_addresses,
        connected_peer_count: p2p.connected_peer_count,
        validated_peer_count: p2p.validated_peer_count,
        mining_peer_count: p2p.mining_peer_count,
        validating_peer_count: p2p.validating_peer_count,
        p2p_syncing: p2p.syncing,
        p2p_error: p2p.last_error,
        recent_blocks,
        recent_transactions,
        peers: p2p.peers,
        detail: "RPC verified at https://rpcnode.dohotstudio.com".to_owned(),
    })
}

pub fn prepare_transaction(
    workspace: &Path,
    wallet: &WalletMetadata,
    recipient: &str,
    amount: &str,
    tip: &str,
) -> Result<PreparedTransaction> {
    let recipient = Address::parse(recipient).map_err(|_| {
        DesktopError::Input("recipient must be a valid Mainnet Candidate address".to_owned())
    })?;
    if recipient.network() != Network::MainnetCandidate {
        return Err(DesktopError::Input(
            "recipient is not a Mainnet Candidate address".to_owned(),
        ));
    }
    let amount = Amount::parse_vire(amount)
        .map_err(|_| DesktopError::Input("amount must be a valid VIRE value".to_owned()))?;
    let tip = Amount::parse_vire(tip)
        .map_err(|_| DesktopError::Input("tip must be a valid VIRE value".to_owned()))?;
    if amount == Amount::ZERO {
        return Err(DesktopError::Input(
            "amount must be greater than zero".to_owned(),
        ));
    }

    let chain = vireon_wallet::wallet::load_chain(&workspace.join(".vireon-local/chain"))
        .map_err(service_error)?;
    if chain.network() != Network::MainnetCandidate {
        return Err(DesktopError::Service(
            "local chain is not Mainnet Candidate".to_owned(),
        ));
    }
    let base_fee = next_base_fee(chain.blocks().last());
    let total = amount
        .checked_add(base_fee)
        .and_then(|value| value.checked_add(tip))
        .map_err(service_error)?;
    let available = chain.state().balance_of(&wallet.address);
    if available < total {
        return Err(DesktopError::Input(format!(
            "insufficient balance: available {}, required {} atomic units",
            available.as_atomic(),
            total.as_atomic()
        )));
    }
    let nonce = next_nonce(chain.blocks(), &wallet.address);
    let chain_tip = chain
        .blocks()
        .last()
        .map(|block| hash_to_hex(&block.hash()))
        .unwrap_or_default();
    Ok(PreparedTransaction {
        recipient: recipient.to_string(),
        amount_atomic: amount.as_atomic(),
        tip_atomic: tip.as_atomic(),
        base_fee_atomic: base_fee.as_atomic(),
        total_atomic: total.as_atomic(),
        available_atomic: available.as_atomic(),
        nonce,
        chain_tip,
    })
}

pub fn sign_and_submit(
    workspace: &Path,
    wallet: &WalletMetadata,
    prepared: &PreparedTransaction,
) -> Result<SubmissionResult> {
    let refreshed = prepare_transaction(
        workspace,
        wallet,
        &prepared.recipient,
        &format_atomic(prepared.amount_atomic),
        &format_atomic(prepared.tip_atomic),
    )?;
    if refreshed.nonce != prepared.nonce
        || refreshed.base_fee_atomic != prepared.base_fee_atomic
        || refreshed.chain_tip != prepared.chain_tip
    {
        return Err(DesktopError::StalePreview);
    }
    let mut secret = secure::load_private_key()?;
    let result = PrivateKey::from_hex(&secret)
        .map_err(|_| DesktopError::Credential("stored key is invalid".to_owned()))
        .and_then(|key| {
            let address =
                Address::from_public_key_for_network(&key.public_key(), Network::MainnetCandidate);
            if address.to_string() != wallet.address {
                return Err(DesktopError::Credential(
                    "stored key does not match public wallet metadata".to_owned(),
                ));
            }
            let tip = Amount::from_atomic(prepared.tip_atomic);
            let max_fee = Amount::from_atomic(prepared.base_fee_atomic)
                .checked_add(tip)
                .map_err(service_error)?;
            let transaction = Transaction::new_signed(
                1,
                prepared.nonce,
                Network::MainnetCandidate,
                &key,
                prepared.recipient.clone(),
                Amount::from_atomic(prepared.amount_atomic),
                max_fee,
                tip,
                None,
            )
            .map_err(service_error)?;
            let response = vireon_wallet::rpc::submit_transaction(RPC_URL, &transaction)
                .map_err(service_error)?;
            Ok(SubmissionResult {
                tx_hash: response.tx_hash,
                lifecycle_status: response.lifecycle_status,
                mempool_size: response.mempool_size,
            })
        });
    secret.zeroize();
    result
}

pub fn run_operator(
    workspace: &Path,
    command: OperatorCommand,
    miner_address: Option<&str>,
    miner_threads: usize,
) -> Result<String> {
    let script = workspace.join("vireon.ps1");
    if !script.exists() {
        return Err(DesktopError::Service(format!(
            "operator script not found at {}",
            script.display()
        )));
    }
    let mut process = Command::new("powershell.exe");
    process
        .current_dir(workspace)
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
        ])
        .arg(script)
        .arg(command.name());
    if matches!(command, OperatorCommand::Start | OperatorCommand::Restart) {
        process.arg("-SkipExplorer");
    }
    process.stdout(Stdio::piped()).stderr(Stdio::piped());
    if matches!(command, OperatorCommand::StartMiner) {
        let address = miner_address.ok_or_else(|| {
            DesktopError::Input("create or import a wallet before starting the miner".to_owned())
        })?;
        process
            .args(["-MinerAddress", address, "-MinerThreads"])
            .arg(miner_threads.max(1).to_string());
    }
    let output = process.output().map_err(service_error)?;
    let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
    text.push_str(&String::from_utf8_lossy(&output.stderr));
    if !output.status.success() {
        return Err(DesktopError::Service(trim_output(&text)));
    }
    Ok(trim_output(&text))
}

pub fn recent_logs(workspace: &Path, service: &str, lines: usize) -> Result<String> {
    if !matches!(service, "node" | "rpc" | "miner" | "explorer") {
        return Err(DesktopError::Input("unsupported log service".to_owned()));
    }
    let root = local_root(workspace).join("logs");
    let read = |path: PathBuf| -> String {
        fs::read_to_string(path)
            .ok()
            .map(|text| {
                text.lines()
                    .rev()
                    .take(lines)
                    .collect::<Vec<_>>()
                    .into_iter()
                    .rev()
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .unwrap_or_default()
    };
    let stdout = read(root.join(format!("{service}.log")));
    let stderr = read(root.join(format!("{service}.err.log")));
    Ok(trim_output(&format!("{stdout}\n{stderr}")))
}

pub fn open_explorer() -> Result<()> {
    open_explorer_path("dashboard")
}

pub fn open_explorer_path(path: &str) -> Result<()> {
    let path = path.trim_start_matches('/');
    webbrowser::open(&format!("{RPC_URL}/{path}"))
        .map(|_| ())
        .map_err(service_error)
}

fn local_root(workspace: &Path) -> PathBuf {
    if workspace.join("bin/vireon-node.exe").exists() {
        dirs::data_local_dir()
            .unwrap_or_else(|| workspace.to_path_buf())
            .join("Vireon/ControlCenter/.vireon-local")
    } else {
        workspace.join(".vireon-local")
    }
}

fn managed_process_running(local_root: &Path, name: &str) -> bool {
    let Ok(pid) = fs::read_to_string(local_root.join("logs").join(format!("{name}.pid"))) else {
        return false;
    };
    let pid = pid.trim();
    if pid.parse::<u32>().is_err() {
        return false;
    }
    Command::new("tasklist.exe")
        .args(["/FI", &format!("PID eq {pid}"), "/NH"])
        .output()
        .ok()
        .is_some_and(|output| String::from_utf8_lossy(&output.stdout).contains(pid))
}

pub fn find_workspace_root() -> PathBuf {
    if let Some(value) = std::env::var_os("VIREON_WORKSPACE_ROOT") {
        let path = PathBuf::from(value);
        if is_workspace(&path) {
            return path;
        }
    }
    if let Ok(executable) = std::env::current_exe() {
        for path in executable.ancestors() {
            if is_workspace(path) {
                return path.to_path_buf();
            }
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .to_path_buf()
}

fn is_workspace(path: &Path) -> bool {
    path.join("scripts/local/vireon-local.ps1").exists()
}

fn next_nonce(blocks: &[vireon_core::Block], address: &str) -> u64 {
    blocks
        .iter()
        .flat_map(|block| block.transactions.iter())
        .filter(|transaction| transaction.from.as_deref() == Some(address))
        .map(|transaction| transaction.nonce)
        .max()
        .map_or(1, |nonce| nonce + 1)
}

pub fn format_atomic(value: u64) -> String {
    format!(
        "{}.{:08}",
        value / vireon_core::ATOMIC_UNITS_PER_VIRE,
        value % vireon_core::ATOMIC_UNITS_PER_VIRE
    )
}

fn trim_output(value: &str) -> String {
    const LIMIT: usize = 12_000;
    if value.len() <= LIMIT {
        return value.trim().to_owned();
    }
    let start = value
        .char_indices()
        .find(|(index, _)| *index >= value.len() - LIMIT)
        .map(|(index, _)| index)
        .unwrap_or(0);
    format!("[earlier output omitted]\n{}", value[start..].trim())
}

fn service_error(error: impl std::fmt::Display) -> DesktopError {
    DesktopError::Service(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_format_is_exact() {
        assert_eq!(format_atomic(100_000_001), "1.00000001");
        assert_eq!(format_atomic(1), "0.00000001");
    }

    #[test]
    fn source_workspace_is_discoverable() {
        assert!(is_workspace(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .expect("workspace")
        ));
    }
}
