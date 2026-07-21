use crate::{MinerError, Result};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use vireon_core::{hash_to_hex, Address, Block, BlockHeader, Hash, Transaction};

pub const MINING_PROTOCOL_VERSION: &str = "vireon-mining-v1";

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MiningTemplate {
    pub protocol: String,
    pub template_id: String,
    pub expires_at_unix_seconds: u64,
    pub version: u32,
    pub network_id: String,
    pub height: u64,
    pub previous_hash: String,
    pub merkle_root: String,
    pub base_fee_atomic: u64,
    pub timestamp: u64,
    pub difficulty_leading_zero_bits: u8,
    #[serde(default)]
    pub share_difficulty_leading_zero_bits: Option<u8>,
    #[serde(default)]
    pub nonce_start: u64,
    pub transactions: Vec<Transaction>,
}

impl MiningTemplate {
    pub fn validate_and_build(&self, miner_address: &str) -> Result<Block> {
        if self.protocol != MINING_PROTOCOL_VERSION {
            return Err(MinerError::InvalidTemplate(format!(
                "unsupported protocol {}; expected {MINING_PROTOCOL_VERSION}",
                self.protocol
            )));
        }
        if self.template_id.trim().is_empty() {
            return Err(MinerError::InvalidTemplate(
                "template_id cannot be empty".to_owned(),
            ));
        }
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |duration| duration.as_secs());
        if self.expires_at_unix_seconds <= now {
            return Err(MinerError::InvalidTemplate(format!(
                "template expired at {}",
                self.expires_at_unix_seconds
            )));
        }
        let network = vireon_core::Network::from_network_id(&self.network_id).ok_or_else(|| {
            MinerError::InvalidTemplate(format!("unknown network_id {}", self.network_id))
        })?;
        let address = Address::parse(miner_address)?;
        if address.network() != network {
            return Err(MinerError::InvalidTemplate(format!(
                "miner address belongs to {}, template belongs to {}",
                address.network().network_id(),
                network.network_id()
            )));
        }
        let coinbase = self.transactions.first().ok_or_else(|| {
            MinerError::InvalidTemplate("transactions must include coinbase".to_owned())
        })?;
        if !coinbase.is_coinbase() || coinbase.to != miner_address {
            return Err(MinerError::InvalidTemplate(
                "first transaction must be coinbase paying miner_address".to_owned(),
            ));
        }

        let block = Block {
            header: BlockHeader {
                version: self.version,
                network_id: self.network_id.clone(),
                height: self.height,
                previous_hash: parse_hash("previous_hash", &self.previous_hash)?,
                merkle_root: parse_hash("merkle_root", &self.merkle_root)?,
                base_fee_atomic: self.base_fee_atomic,
                timestamp: self.timestamp,
                nonce: self.nonce_start,
                mix_hash: Hash::zero(),
                difficulty_leading_zero_bits: self.difficulty_leading_zero_bits,
            },
            transactions: self.transactions.clone(),
        };
        let computed_merkle = block.recompute_merkle_root()?;
        if computed_merkle != block.header.merkle_root {
            return Err(MinerError::InvalidTemplate(format!(
                "merkle_root mismatch: expected {}, computed {}",
                self.merkle_root,
                hash_to_hex(&computed_merkle)
            )));
        }
        Ok(block)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct MiningSubmitRequest {
    pub protocol: String,
    pub template_id: String,
    pub nonce: u64,
    /// FiroPoW final hash (hex).
    pub block_hash: String,
    /// FiroPoW mix hash (hex); required for node verification.
    #[serde(default)]
    pub mix_hash: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub miner_address: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worker_name: Option<String>,
}

impl MiningSubmitRequest {
    pub fn from_solution(
        template_id: String,
        nonce: u64,
        final_hash: Hash,
        mix_hash: Hash,
    ) -> Self {
        Self {
            protocol: MINING_PROTOCOL_VERSION.to_owned(),
            template_id,
            nonce,
            block_hash: hash_to_hex(&final_hash),
            mix_hash: hash_to_hex(&mix_hash),
            miner_address: None,
            worker_name: None,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct MiningSubmitResponse {
    pub protocol: String,
    pub status: SubmitStatus,
    pub template_id: String,
    pub block_hash: String,
    pub height: Option<u64>,
    pub reason: Option<String>,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SubmitStatus {
    Accepted,
    Stale,
    Rejected,
    PendingLocal,
}

fn parse_hash(field: &str, value: &str) -> Result<Hash> {
    Hash::from_hex(value)
        .map_err(|error| MinerError::InvalidTemplate(format!("invalid {field}: {error}")))
}
