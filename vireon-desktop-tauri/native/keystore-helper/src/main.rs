use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};
use thiserror::Error;
use vireon_core::{
    generate_mnemonic, Address, Amount, MnemonicWordCount, Network, PrivateKey, Transaction,
    WalletDerivationPath,
};
use zeroize::Zeroize;

const SERVICE: &str = "Vireon Desktop";
const LEGACY_SERVICE: &str = "Veiron Desktop";
const LEGACY_ACCOUNT: &str = "mainnet-candidate-default-wallet";
const METADATA_SCHEMA: &str = "vireon-desktop-wallet-metadata-v2";
const LEGACY_METADATA_SCHEMA: &str = "veiron-desktop-wallet-metadata-v2";

fn rpc_url() -> String {
    std::env::var("VIREON_RPC_URL")
        .ok()
        .map(|value| value.trim().trim_end_matches('/').to_owned())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| vireon_sdk_rust::DEFAULT_MAINNET_CANDIDATE_RPC.to_owned())
}

fn rpc_client() -> Result<vireon_sdk_rust::BlockingRpcClient> {
    vireon_sdk_rust::BlockingRpcClient::new(vireon_sdk_rust::NetworkConfig::with_rpc(
        vireon_sdk_rust::Network::MainnetCandidate,
        rpc_url(),
    ))
    .map_err(|error| HelperError::Service(error.to_string()))
}

#[derive(Debug, Error)]
enum HelperError {
    #[error("invalid wallet input: {0}")]
    Input(String),
    #[error("secure credential storage failed: {0}")]
    Credential(String),
    #[error("local wallet metadata failed: {0}")]
    Metadata(String),
    #[error("local service failed: {0}")]
    Service(String),
    #[error("chain state changed; refresh the signing preview")]
    StalePreview,
}

type Result<T> = std::result::Result<T, HelperError>;

#[derive(Debug, Serialize, Deserialize, Clone)]
struct WalletMetadata {
    wallet_id: String,
    display_name: String,
    schema: String,
    network_id: String,
    address: String,
    public_key_hex: String,
    key_origin: String,
    derivation_path: String,
    credential_account: String,
}

#[derive(Deserialize)]
struct Request {
    command: String,
    /// Must match VIREON_KEYSTORE_PARENT_TOKEN from the Control Center parent process.
    #[serde(default)]
    parent_token: Option<String>,
    #[serde(default)]
    wallet_id: Option<String>,
    #[serde(default)]
    display_name: Option<String>,
    /// Accepted for protocol compat only - never used (native dialog import).
    #[serde(default)]
    #[allow(dead_code)]
    recovery_phrase: Option<String>,
    #[serde(default)]
    workspace: Option<PathBuf>,
    #[serde(default)]
    recipient: Option<String>,
    #[serde(default)]
    amount: Option<String>,
    #[serde(default)]
    tip: Option<String>,
    #[serde(default)]
    prepared: Option<PreparedTransaction>,
}

#[derive(Serialize)]
struct CreateResult {
    metadata: WalletMetadata,
    recovery_confirmed: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct PreparedTransaction {
    recipient: String,
    amount_atomic: String,
    tip_atomic: String,
    base_fee_atomic: String,
    total_atomic: String,
    available_atomic: String,
    nonce: u64,
    chain_tip: String,
}

#[derive(Serialize)]
struct SubmissionResult {
    tx_hash: String,
    lifecycle_status: String,
    mempool_size: usize,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn run() -> Result<()> {
    let mut bytes = Vec::new();
    std::io::stdin()
        .read_to_end(&mut bytes)
        .map_err(metadata_error)?;
    let request: Request = serde_json::from_slice(&bytes).map_err(metadata_error)?;
    bytes.zeroize();
    verify_parent_token(request.parent_token.as_deref())?;
    match request.command.as_str() {
        "metadata" => output(&load_metadata()?),
        "list" => output(&load_wallets()?),
        "select" => output(&select_wallet(&required(request.wallet_id, "wallet_id")?)?),
        "create" => output(&create_wallet(validated_display_name(
            request.display_name,
        )?)?),
        "import" => output(&import_wallet_native(validated_display_name(
            request.display_name,
        )?)?),
        // Disabled: recovery phrase must never arrive via stdin from a WebView (A-H08).
        "import_phrase" => Err(HelperError::Input(
            "import_phrase is disabled; use native import dialog only".into(),
        )),
        "remove" => {
            remove_wallet()?;
            output(&serde_json::Value::Null)
        }
        "prepare" => output(&prepare_transaction(
            required_path(request.workspace, "workspace")?,
            required(request.recipient, "recipient")?,
            required(request.amount, "amount")?,
            required(request.tip, "tip")?,
        )?),
        "sign_submit" => output(&sign_and_submit(
            required_path(request.workspace, "workspace")?,
            request
                .prepared
                .ok_or_else(|| HelperError::Input("prepared transaction is required".into()))?,
        )?),
        _ => Err(HelperError::Input("unsupported helper command".into())),
    }
}

fn verify_parent_token(provided: Option<&str>) -> Result<()> {
    // Dev escape hatch for manual smoke tests only.
    if std::env::var_os("VIREON_KEYSTORE_ALLOW_UNAUTHENTICATED")
        .map(|v| v == "1")
        .unwrap_or(false)
    {
        return Ok(());
    }
    let expected = std::env::var("VIREON_KEYSTORE_PARENT_TOKEN").map_err(|_| {
        HelperError::Input(
            "keystore helper requires VIREON_KEYSTORE_PARENT_TOKEN from Control Center".into(),
        )
    })?;
    let provided = provided.unwrap_or("");
    if provided.is_empty() || provided != expected {
        return Err(HelperError::Input(
            "invalid keystore parent token (spawn only via Control Center)".into(),
        ));
    }
    Ok(())
}

fn output(value: &impl Serialize) -> Result<()> {
    serde_json::to_writer(std::io::stdout(), value).map_err(metadata_error)
}

fn create_wallet(display_name: String) -> Result<CreateResult> {
    let mut mnemonic = generate_mnemonic(MnemonicWordCount::TwentyFour)
        .map_err(|error| HelperError::Input(error.to_string()))?;
    let key = PrivateKey::from_mnemonic(&mnemonic, "", WalletDerivationPath::default())
        .map_err(|error| HelperError::Input(error.to_string()))?;
    let metadata = persist_key(&key, "bip39-created", display_name)?;
    let confirmed = show_recovery_phrase(&mnemonic)?;
    mnemonic.zeroize();
    if !confirmed {
        remove_wallet()?;
        return Err(HelperError::Input(
            "wallet creation cancelled before recovery confirmation".into(),
        ));
    }
    Ok(CreateResult {
        metadata,
        recovery_confirmed: true,
    })
}

fn import_wallet_native(display_name: String) -> Result<WalletMetadata> {
    let mut phrase = prompt_recovery_phrase()?;
    let result = require_twenty_four_words(&phrase).and_then(|()| {
        PrivateKey::from_mnemonic(&phrase, "", WalletDerivationPath::default())
            .map_err(|_| HelperError::Input("recovery phrase is invalid".into()))
            .and_then(|key| persist_key(&key, "bip39-imported", display_name))
    });
    phrase.zeroize();
    result
}

#[allow(dead_code)] // retained for emergency offline tooling; not reachable via commands
fn import_wallet_phrase(display_name: String, mut phrase: String) -> Result<WalletMetadata> {
    let result = require_twenty_four_words(&phrase).and_then(|()| {
        PrivateKey::from_mnemonic(&phrase, "", WalletDerivationPath::default())
            .map_err(|_| HelperError::Input("recovery phrase is invalid".into()))
            .and_then(|key| persist_key(&key, "bip39-imported", display_name))
    });
    phrase.zeroize();
    result
}

fn persist_key(key: &PrivateKey, origin: &str, display_name: String) -> Result<WalletMetadata> {
    let public_key = key.public_key();
    let address = Address::from_public_key_for_network(&public_key, Network::MainnetCandidate);
    let wallet_id = address.to_string();
    let credential_account = format!("mainnet-candidate-wallet-{wallet_id}");
    let metadata = WalletMetadata {
        wallet_id,
        display_name,
        schema: METADATA_SCHEMA.into(),
        network_id: "veiron-mainnet-candidate".into(),
        address: address.to_string(),
        public_key_hex: public_key.to_hex(),
        key_origin: origin.into(),
        derivation_path: "m/44'/7330'/0'/0'/0'".into(),
        credential_account,
    };
    let mut secret = key.to_hex();
    let stored = credential(&metadata.credential_account)?
        .set_password(&secret)
        .map_err(credential_error);
    secret.zeroize();
    stored?;
    if let Err(error) = save_wallet(&metadata) {
        remove_private_key(&metadata.credential_account);
        return Err(error);
    }
    Ok(metadata)
}

fn prepare_transaction(
    _workspace: PathBuf,
    recipient: String,
    amount: String,
    tip: String,
) -> Result<PreparedTransaction> {
    let wallet = load_metadata()?
        .ok_or_else(|| HelperError::Input("create or import a wallet first".into()))?;
    let recipient = Address::parse(&recipient).map_err(|_| {
        HelperError::Input("recipient must be a valid Mainnet Candidate address".into())
    })?;
    if recipient.network() != Network::MainnetCandidate {
        return Err(HelperError::Input(
            "recipient is not a Mainnet Candidate address".into(),
        ));
    }
    let amount = Amount::parse_vire(&amount)
        .map_err(|_| HelperError::Input("amount must be a valid VIRE value".into()))?;
    let tip = Amount::parse_vire(&tip)
        .map_err(|_| HelperError::Input("tip must be a valid VIRE value".into()))?;
    if amount == Amount::ZERO {
        return Err(HelperError::Input(
            "amount must be greater than zero".into(),
        ));
    }

    // VPS-first: never require a local chain copy. Sign against the configured RPC tip.
    let account = fetch_remote_account(&wallet.address)?;
    let base_fee = Amount::from_atomic(account.anticipated_base_fee_atomic);
    let available = Amount::from_atomic(account.balance_atomic);
    let total = amount
        .checked_add(base_fee)
        .and_then(|value| value.checked_add(tip))
        .map_err(service_error)?;
    if available < total {
        return Err(HelperError::Input(format!(
            "insufficient balance: available {}, required {} atomic units",
            available.as_atomic(),
            total.as_atomic()
        )));
    }
    let chain_tip = account
        .tip_hash
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            HelperError::Service("RPC gateway has no tip hash; chain is not ready".into())
        })?;
    Ok(PreparedTransaction {
        recipient: recipient.to_string(),
        amount_atomic: amount.as_atomic().to_string(),
        tip_atomic: tip.as_atomic().to_string(),
        base_fee_atomic: base_fee.as_atomic().to_string(),
        total_atomic: total.as_atomic().to_string(),
        available_atomic: available.as_atomic().to_string(),
        nonce: account.next_nonce,
        chain_tip,
    })
}

#[derive(Debug, Deserialize)]
struct RemoteAccount {
    balance_atomic: u64,
    next_nonce: u64,
    tip_hash: Option<String>,
    anticipated_base_fee_atomic: u64,
}

fn fetch_remote_account(address: &str) -> Result<RemoteAccount> {
    let client = rpc_client()?;
    match client.account(address) {
        Ok(account) => Ok(RemoteAccount {
            balance_atomic: account.balance_atomic,
            next_nonce: account.next_nonce,
            tip_hash: account.tip_hash,
            anticipated_base_fee_atomic: account.anticipated_base_fee_atomic,
        }),
        Err(vireon_sdk_rust::SdkError::RpcHttp { status: 404, .. }) => {
            // Older gateways without /account - refuse invented nonces.
            fetch_remote_account_compat(address)
        }
        Err(error) => Err(HelperError::Service(format!(
            "cannot load account from {}: {error}",
            rpc_url()
        ))),
    }
}

fn fetch_remote_account_compat(address: &str) -> Result<RemoteAccount> {
    // Fail closed (audit A-M04): never invent nonce=1 for spenders on old gateways.
    let _ = address;
    Err(HelperError::Service(
        "RPC gateway is missing GET /addresses/{addr}/account. Upgrade the VPS gateway - refusing to invent next_nonce.".into(),
    ))
}

fn sign_and_submit(workspace: PathBuf, prepared: PreparedTransaction) -> Result<SubmissionResult> {
    let wallet = load_metadata()?
        .ok_or_else(|| HelperError::Input("create or import a wallet first".into()))?;
    let refreshed = prepare_transaction(
        workspace.clone(),
        prepared.recipient.clone(),
        format_atomic(parse_atomic(&prepared.amount_atomic)?),
        format_atomic(parse_atomic(&prepared.tip_atomic)?),
    )?;
    if refreshed.nonce != prepared.nonce
        || refreshed.base_fee_atomic != prepared.base_fee_atomic
        || refreshed.chain_tip != prepared.chain_tip
    {
        return Err(HelperError::StalePreview);
    }
    let mut secret = load_private_key(&wallet.credential_account)?;
    let result = PrivateKey::from_hex(&secret)
        .map_err(|_| HelperError::Credential("stored key is invalid".into()))
        .and_then(|key| {
            let address =
                Address::from_public_key_for_network(&key.public_key(), Network::MainnetCandidate);
            if address.to_string() != wallet.address {
                return Err(HelperError::Credential(
                    "stored key does not match public wallet metadata".into(),
                ));
            }
            let tip = Amount::from_atomic(parse_atomic(&prepared.tip_atomic)?);
            let base = Amount::from_atomic(parse_atomic(&prepared.base_fee_atomic)?);
            let max_fee = base.checked_add(tip).map_err(service_error)?;
            let transaction = Transaction::new_signed(
                1,
                prepared.nonce,
                Network::MainnetCandidate,
                &key,
                prepared.recipient,
                Amount::from_atomic(parse_atomic(&prepared.amount_atomic)?),
                max_fee,
                tip,
                None,
            )
            .map_err(service_error)?;
            let response = vireon_wallet::rpc::submit_transaction(&rpc_url(), &transaction)
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

fn wallet_root() -> Result<PathBuf> {
    let root = dirs::data_local_dir().ok_or_else(|| {
        HelperError::Metadata("local application data directory is unavailable".into())
    })?;
    let current = root.join("Vireon").join("Desktop");
    let legacy = root.join("Veiron").join("Desktop");
    if legacy.exists() {
        copy_missing_tree(&legacy, &current)?;
    }
    Ok(current)
}

fn legacy_metadata_path() -> Result<PathBuf> {
    Ok(wallet_root()?.join("wallet.json"))
}

fn wallets_dir() -> Result<PathBuf> {
    Ok(wallet_root()?.join("wallets"))
}

fn active_wallet_path() -> Result<PathBuf> {
    Ok(wallet_root()?.join("active-wallet"))
}

fn migrate_legacy_wallet() -> Result<()> {
    let legacy_path = legacy_metadata_path()?;
    if !legacy_path.exists() || wallets_dir()?.exists() {
        return Ok(());
    }
    #[derive(Deserialize)]
    struct LegacyMetadata {
        network_id: String,
        address: String,
        public_key_hex: String,
        key_origin: String,
        derivation_path: String,
    }
    let legacy: LegacyMetadata =
        serde_json::from_slice(&fs::read(&legacy_path).map_err(metadata_error)?)
            .map_err(metadata_error)?;
    if legacy.network_id != "veiron-mainnet-candidate" {
        return Err(HelperError::Metadata(
            "legacy wallet belongs to another network".into(),
        ));
    }
    let metadata = WalletMetadata {
        wallet_id: legacy.address.clone(),
        display_name: "Primary wallet".into(),
        schema: METADATA_SCHEMA.into(),
        network_id: legacy.network_id,
        address: legacy.address,
        public_key_hex: legacy.public_key_hex,
        key_origin: legacy.key_origin,
        derivation_path: legacy.derivation_path,
        credential_account: LEGACY_ACCOUNT.into(),
    };
    save_wallet(&metadata)?;
    // Keep the legacy metadata in place as a rollback source.
    Ok(())
}

fn load_wallets() -> Result<Vec<WalletMetadata>> {
    migrate_legacy_wallet()?;
    let directory = wallets_dir()?;
    if !directory.exists() {
        return Ok(Vec::new());
    }
    let mut wallets = Vec::new();
    for entry in fs::read_dir(directory).map_err(metadata_error)? {
        let path = entry.map_err(metadata_error)?.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let mut metadata: WalletMetadata =
            serde_json::from_slice(&fs::read(path).map_err(metadata_error)?)
                .map_err(metadata_error)?;
        if metadata.schema == LEGACY_METADATA_SCHEMA {
            metadata.schema = METADATA_SCHEMA.into();
            save_wallet(&metadata)?;
        }
        validate_wallet_metadata(&metadata)?;
        wallets.push(metadata);
    }
    wallets.sort_by(|left, right| {
        left.display_name
            .cmp(&right.display_name)
            .then(left.wallet_id.cmp(&right.wallet_id))
    });
    Ok(wallets)
}

fn load_metadata() -> Result<Option<WalletMetadata>> {
    let wallets = load_wallets()?;
    if wallets.is_empty() {
        return Ok(None);
    }
    let active = fs::read_to_string(active_wallet_path()?).unwrap_or_default();
    Ok(wallets
        .iter()
        .find(|wallet| wallet.wallet_id == active.trim())
        .cloned()
        .or_else(|| wallets.first().cloned()))
}

fn select_wallet(wallet_id: &str) -> Result<WalletMetadata> {
    let wallet = load_wallets()?
        .into_iter()
        .find(|wallet| wallet.wallet_id == wallet_id)
        .ok_or_else(|| HelperError::Input("selected wallet does not exist".into()))?;
    write_atomic(&active_wallet_path()?, wallet.wallet_id.as_bytes())?;
    Ok(wallet)
}

fn save_wallet(metadata: &WalletMetadata) -> Result<()> {
    validate_wallet_metadata(metadata)?;
    let directory = wallets_dir()?;
    fs::create_dir_all(&directory).map_err(metadata_error)?;
    let path = directory.join(format!("{}.json", metadata.wallet_id));
    write_atomic(
        &path,
        &serde_json::to_vec_pretty(metadata).map_err(metadata_error)?,
    )?;
    write_atomic(&active_wallet_path()?, metadata.wallet_id.as_bytes())
}

fn validate_wallet_metadata(metadata: &WalletMetadata) -> Result<()> {
    if !matches!(metadata.schema.as_str(), METADATA_SCHEMA | LEGACY_METADATA_SCHEMA)
        || metadata.network_id != "veiron-mainnet-candidate"
        || metadata.wallet_id != metadata.address
        || metadata.credential_account.trim().is_empty()
    {
        return Err(HelperError::Metadata(
            "unsupported wallet metadata or network".into(),
        ));
    }
    Ok(())
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| HelperError::Metadata("invalid wallet metadata path".into()))?;
    fs::create_dir_all(parent).map_err(metadata_error)?;
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, bytes).map_err(metadata_error)?;
    if path.exists() {
        fs::remove_file(path).map_err(metadata_error)?;
    }
    fs::rename(temporary, path).map_err(metadata_error)
}

fn remove_wallet() -> Result<()> {
    let Some(wallet) = load_metadata()? else {
        return Ok(());
    };
    remove_private_key(&wallet.credential_account);
    let path = wallets_dir()?.join(format!("{}.json", wallet.wallet_id));
    if path.exists() {
        fs::remove_file(path).map_err(metadata_error)?;
    }
    let remaining = load_wallets()?;
    if let Some(next) = remaining.first() {
        write_atomic(&active_wallet_path()?, next.wallet_id.as_bytes())?;
    } else if active_wallet_path()?.exists() {
        fs::remove_file(active_wallet_path()?).map_err(metadata_error)?;
    }
    Ok(())
}

fn credential(account: &str) -> Result<Entry> {
    Entry::new(SERVICE, account).map_err(credential_error)
}
fn legacy_credential(account: &str) -> Result<Entry> {
    Entry::new(LEGACY_SERVICE, account).map_err(credential_error)
}
fn load_private_key(account: &str) -> Result<String> {
    match credential(account)?.get_password() {
        Ok(secret) => Ok(secret),
        Err(current_error) => {
            let secret = legacy_credential(account)?
                .get_password()
                .map_err(|_| credential_error(current_error))?;
            credential(account)?
                .set_password(&secret)
                .map_err(credential_error)?;
            Ok(secret)
        }
    }
}
fn remove_private_key(account: &str) {
    if let Ok(entry) = credential(account) {
        let _ = entry.delete_credential();
    }
}

fn copy_missing_tree(source: &Path, destination: &Path) -> Result<()> {
    if source.is_file() {
        if !destination.exists() {
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent).map_err(metadata_error)?;
            }
            fs::copy(source, destination).map_err(metadata_error)?;
        }
        return Ok(());
    }
    fs::create_dir_all(destination).map_err(metadata_error)?;
    for entry in fs::read_dir(source).map_err(metadata_error)? {
        let entry = entry.map_err(metadata_error)?;
        copy_missing_tree(&entry.path(), &destination.join(entry.file_name()))?;
    }
    Ok(())
}

fn parse_atomic(value: &str) -> Result<u64> {
    value
        .parse()
        .map_err(|_| HelperError::Input("invalid atomic value".into()))
}
fn format_atomic(value: u64) -> String {
    format!(
        "{}.{:08}",
        value / vireon_core::ATOMIC_UNITS_PER_VIRE,
        value % vireon_core::ATOMIC_UNITS_PER_VIRE
    )
}
fn required(value: Option<String>, name: &str) -> Result<String> {
    value.ok_or_else(|| HelperError::Input(format!("{name} is required")))
}
fn validated_display_name(value: Option<String>) -> Result<String> {
    let name = value
        .unwrap_or_else(|| "Primary wallet".into())
        .trim()
        .to_owned();
    if name.is_empty() || name.chars().count() > 48 || name.chars().any(char::is_control) {
        return Err(HelperError::Input(
            "wallet display name must contain 1 to 48 printable characters".into(),
        ));
    }
    Ok(name)
}
fn require_twenty_four_words(phrase: &str) -> Result<()> {
    if phrase.split_whitespace().count() != 24 {
        return Err(HelperError::Input(
            "recovery phrase must contain exactly 24 words".into(),
        ));
    }
    Ok(())
}
fn required_path(value: Option<PathBuf>, name: &str) -> Result<PathBuf> {
    value.ok_or_else(|| HelperError::Input(format!("{name} is required")))
}
fn credential_error(error: impl std::fmt::Display) -> HelperError {
    HelperError::Credential(error.to_string())
}
fn metadata_error(error: impl std::fmt::Display) -> HelperError {
    HelperError::Metadata(error.to_string())
}
fn service_error(error: impl std::fmt::Display) -> HelperError {
    HelperError::Service(error.to_string())
}

#[cfg(windows)]
fn show_recovery_phrase(phrase: &str) -> Result<bool> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        MessageBoxW, IDOK, MB_ICONWARNING, MB_OKCANCEL, MB_TOPMOST,
    };
    let text = wide(&format!("Write down these 24 words in order. They will not be shown again.\n\n{phrase}\n\nPress OK only after your offline backup is complete."));
    let title = wide("Vireon recovery phrase - one-time display");
    let result = unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            text.as_ptr(),
            title.as_ptr(),
            MB_OKCANCEL | MB_ICONWARNING | MB_TOPMOST,
        )
    };
    Ok(result == IDOK)
}

#[cfg(windows)]
fn prompt_recovery_phrase() -> Result<String> {
    use std::sync::{
        atomic::{AtomicIsize, Ordering},
        Mutex, OnceLock,
    };
    use windows_sys::Win32::{
        Foundation::{HWND, LPARAM, LRESULT, WPARAM},
        Graphics::Gdi::UpdateWindow,
        System::LibraryLoader::GetModuleHandleW,
        UI::WindowsAndMessaging::{
            CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetMessageW,
            GetWindowTextLengthW, GetWindowTextW, LoadCursorW, PostQuitMessage, RegisterClassW,
            ShowWindow, TranslateMessage, CS_HREDRAW, CS_VREDRAW, CW_USEDEFAULT, ES_AUTOHSCROLL,
            HMENU, IDC_ARROW, MSG, SW_SHOW, WM_COMMAND, WM_CREATE, WM_DESTROY, WNDCLASSW,
            WS_BORDER, WS_CAPTION, WS_CHILD, WS_EX_CLIENTEDGE, WS_OVERLAPPED, WS_SYSMENU,
            WS_VISIBLE,
        },
    };

    static EDIT: AtomicIsize = AtomicIsize::new(0);
    static RESULT: OnceLock<Mutex<Option<String>>> = OnceLock::new();

    unsafe extern "system" fn window_proc(
        window: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match message {
            WM_CREATE => {
                let instance = GetModuleHandleW(std::ptr::null());
                CreateWindowExW(0, wide("STATIC").as_ptr(), wide("Enter the 24-word Vireon recovery phrase. It is passed directly to the Rust keystore and is not exposed to React.").as_ptr(),
                    WS_CHILD | WS_VISIBLE, 20, 20, 660, 36, window, std::ptr::null_mut(), instance, std::ptr::null());
                let edit = CreateWindowExW(
                    WS_EX_CLIENTEDGE,
                    wide("EDIT").as_ptr(),
                    wide("").as_ptr(),
                    WS_CHILD | WS_VISIBLE | WS_BORDER | ES_AUTOHSCROLL as u32,
                    20,
                    66,
                    660,
                    30,
                    window,
                    std::ptr::null_mut(),
                    instance,
                    std::ptr::null(),
                );
                EDIT.store(edit as isize, Ordering::SeqCst);
                CreateWindowExW(
                    0,
                    wide("BUTTON").as_ptr(),
                    wide("Import wallet").as_ptr(),
                    WS_CHILD | WS_VISIBLE,
                    438,
                    116,
                    116,
                    34,
                    window,
                    1usize as HMENU,
                    instance,
                    std::ptr::null(),
                );
                CreateWindowExW(
                    0,
                    wide("BUTTON").as_ptr(),
                    wide("Cancel").as_ptr(),
                    WS_CHILD | WS_VISIBLE,
                    564,
                    116,
                    116,
                    34,
                    window,
                    2usize as HMENU,
                    instance,
                    std::ptr::null(),
                );
                0
            }
            WM_COMMAND => {
                match wparam & 0xffff {
                    1 => {
                        let edit = EDIT.load(Ordering::SeqCst) as HWND;
                        let length = GetWindowTextLengthW(edit);
                        let mut buffer = vec![0u16; length as usize + 1];
                        GetWindowTextW(edit, buffer.as_mut_ptr(), buffer.len() as i32);
                        let phrase = String::from_utf16_lossy(&buffer[..length as usize]);
                        buffer.zeroize();
                        *RESULT
                            .get_or_init(|| Mutex::new(None))
                            .lock()
                            .expect("recovery result lock") = Some(phrase);
                        DestroyWindow(window);
                    }
                    2 => {
                        DestroyWindow(window);
                    }
                    _ => {}
                }
                0
            }
            WM_DESTROY => {
                PostQuitMessage(0);
                0
            }
            _ => DefWindowProcW(window, message, wparam, lparam),
        }
    }

    *RESULT
        .get_or_init(|| Mutex::new(None))
        .lock()
        .map_err(|_| HelperError::Service("recovery dialog lock failed".into()))? = None;
    unsafe {
        let instance = GetModuleHandleW(std::ptr::null());
        let class_name = wide("VireonRecoveryImportWindow");
        let class = WNDCLASSW {
            style: CS_HREDRAW | CS_VREDRAW,
            lpfnWndProc: Some(window_proc),
            hInstance: instance,
            hCursor: LoadCursorW(std::ptr::null_mut(), IDC_ARROW),
            lpszClassName: class_name.as_ptr(),
            ..std::mem::zeroed()
        };
        RegisterClassW(&class);
        let window = CreateWindowExW(
            0,
            class_name.as_ptr(),
            wide("Import Vireon wallet").as_ptr(),
            WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            720,
            210,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            instance,
            std::ptr::null(),
        );
        if window.is_null() {
            return Err(HelperError::Service(
                "could not create recovery import dialog".into(),
            ));
        }
        ShowWindow(window, SW_SHOW);
        UpdateWindow(window);
        let mut message: MSG = std::mem::zeroed();
        while GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) > 0 {
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }
    RESULT
        .get()
        .and_then(|result| result.lock().ok()?.take())
        .filter(|phrase| !phrase.trim().is_empty())
        .ok_or_else(|| HelperError::Input("wallet import cancelled".into()))
}

#[cfg(target_os = "linux")]
fn show_recovery_phrase(phrase: &str) -> Result<bool> {
    use std::io::Write;
    use std::process::{Command, Stdio};
    let mut child = Command::new("zenity")
        .args([
            "--text-info",
            "--title=Vireon recovery phrase",
            "--width=720",
            "--height=420",
        ])
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|_| {
            HelperError::Service(
                "install zenity to display the secure Linux recovery dialog".into(),
            )
        })?;
    if let Some(mut input) = child.stdin.take() {
        input.write_all(format!("Write down these 24 words in order. They will not be shown again.\n\n{phrase}\n\nContinue only after your offline backup is complete.\n").as_bytes()).map_err(service_error)?;
    }
    child
        .wait()
        .map(|status| status.success())
        .map_err(service_error)
}

#[cfg(target_os = "linux")]
fn prompt_recovery_phrase() -> Result<String> {
    use std::process::Command;
    let output = Command::new("zenity")
        .args([
            "--entry",
            "--hide-text",
            "--title=Import Vireon wallet",
            "--text=Enter the 24-word recovery phrase",
        ])
        .output()
        .map_err(|_| {
            HelperError::Service("install zenity to use the secure Linux import dialog".into())
        })?;
    if !output.status.success() {
        return Err(HelperError::Input("wallet import cancelled".into()));
    }
    let phrase = String::from_utf8(output.stdout)
        .map_err(metadata_error)?
        .trim()
        .to_owned();
    if phrase.is_empty() {
        return Err(HelperError::Input("wallet import cancelled".into()));
    }
    Ok(phrase)
}

#[cfg(not(any(windows, target_os = "linux")))]
fn show_recovery_phrase(_phrase: &str) -> Result<bool> {
    Err(HelperError::Service(
        "wallet creation is not implemented on this platform".into(),
    ))
}
#[cfg(not(any(windows, target_os = "linux")))]
fn prompt_recovery_phrase() -> Result<String> {
    Err(HelperError::Service(
        "wallet import is not implemented on this platform".into(),
    ))
}

#[cfg(windows)]
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn atomic_format_matches_desktop() {
        assert_eq!(format_atomic(100_000_001), "1.00000001");
        assert_eq!(format_atomic(1), "0.00000001");
    }
}
