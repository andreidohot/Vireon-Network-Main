use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use thiserror::Error;
use zeroize::Zeroize;

const SERVICE: &str = "Vireon Desktop";
const ACCOUNT: &str = "mainnet-candidate-default-wallet";

#[derive(Debug, Error)]
pub enum DesktopError {
    #[error("invalid wallet input: {0}")]
    Input(String),
    #[error("Windows credential storage failed: {0}")]
    Credential(String),
    #[error("local wallet metadata failed: {0}")]
    Metadata(String),
    #[error("local service failed: {0}")]
    Service(String),
    #[error("chain state changed; refresh the signing preview")]
    StalePreview,
}

pub type Result<T> = std::result::Result<T, DesktopError>;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct WalletMetadata {
    pub schema: String,
    pub network_id: String,
    pub address: String,
    pub public_key_hex: String,
    pub key_origin: String,
    pub derivation_path: String,
}

impl WalletMetadata {
    pub fn new(address: String, public_key_hex: String, key_origin: &str) -> Self {
        Self {
            schema: "vireon-desktop-wallet-metadata-v1".to_owned(),
            network_id: "veiron-mainnet-candidate".to_owned(),
            address,
            public_key_hex,
            key_origin: key_origin.to_owned(),
            derivation_path: "m/44'/7330'/0'/0'/0'".to_owned(),
        }
    }
}

pub fn metadata_path() -> Result<PathBuf> {
    dirs::data_local_dir()
        .map(|root| root.join("Vireon").join("Desktop").join("wallet.json"))
        .ok_or_else(|| DesktopError::Metadata("LOCALAPPDATA is unavailable".to_owned()))
}

pub fn load_metadata() -> Result<Option<WalletMetadata>> {
    let path = metadata_path()?;
    if !path.exists() {
        return Ok(None);
    }
    let bytes = fs::read(path).map_err(metadata_error)?;
    let metadata: WalletMetadata = serde_json::from_slice(&bytes).map_err(metadata_error)?;
    if metadata.schema != "vireon-desktop-wallet-metadata-v1"
        || metadata.network_id != "veiron-mainnet-candidate"
    {
        return Err(DesktopError::Metadata(
            "unsupported wallet metadata or network".to_owned(),
        ));
    }
    Ok(Some(metadata))
}

pub fn save_metadata(metadata: &WalletMetadata) -> Result<()> {
    let path = metadata_path()?;
    let parent = path
        .parent()
        .ok_or_else(|| DesktopError::Metadata("invalid metadata path".to_owned()))?;
    fs::create_dir_all(parent).map_err(metadata_error)?;
    let temporary = path.with_extension("json.tmp");
    fs::write(
        &temporary,
        serde_json::to_vec_pretty(metadata).map_err(metadata_error)?,
    )
    .map_err(metadata_error)?;
    if path.exists() {
        fs::remove_file(&path).map_err(metadata_error)?;
    }
    fs::rename(temporary, path).map_err(metadata_error)
}

fn credential() -> Result<Entry> {
    Entry::new(SERVICE, ACCOUNT).map_err(credential_error)
}

pub fn store_private_key(secret: &mut String) -> Result<()> {
    let result = credential()?.set_password(secret).map_err(credential_error);
    secret.zeroize();
    result
}

pub fn load_private_key() -> Result<String> {
    credential()?.get_password().map_err(credential_error)
}

pub fn remove_private_key() {
    if let Ok(entry) = credential() {
        let _ = entry.delete_credential();
    }
}

fn credential_error(error: impl std::fmt::Display) -> DesktopError {
    DesktopError::Credential(error.to_string())
}

fn metadata_error(error: impl std::fmt::Display) -> DesktopError {
    DesktopError::Metadata(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_metadata_has_no_secret_fields() {
        let metadata = WalletMetadata::new(
            "vire1public".to_owned(),
            "public-key".to_owned(),
            "bip39-created",
        );
        let json = serde_json::to_string(&metadata).expect("serialize metadata");
        assert!(!json.contains("mnemonic"));
        assert!(!json.contains("private_key"));
        assert!(!json.contains("secret"));
    }
}
