use crate::error::{NodeError, NodeResult};
use atomic_write_file::AtomicWriteFile;
use fs2::FileExt;
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use vireon_core::{hash_to_hex, Block};

pub const CHAIN_FILE_NAME: &str = "chain.jsonl";
pub const CHAIN_LOCK_FILE_NAME: &str = "chain.lock";

pub trait BlockStore {
    fn load_blocks(&self) -> NodeResult<Vec<Block>>;

    fn append_validated<R, F>(&self, candidate: &Block, validate: F) -> NodeResult<R>
    where
        F: FnOnce(&[Block], &Block) -> NodeResult<R>;

    fn replace_validated<R, F>(
        &self,
        expected_tip: &str,
        candidate: &[Block],
        validate: F,
    ) -> NodeResult<R>
    where
        F: FnOnce(&[Block], &[Block]) -> NodeResult<R>;
}

#[derive(Clone, Debug)]
pub struct JsonlBlockStore {
    data_dir: PathBuf,
}

impl JsonlBlockStore {
    pub fn new(data_dir: impl Into<PathBuf>) -> Self {
        Self {
            data_dir: data_dir.into(),
        }
    }

    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }

    fn lock_file_path(&self) -> PathBuf {
        self.data_dir.join(CHAIN_LOCK_FILE_NAME)
    }

    fn open_exclusive_lock(&self) -> NodeResult<File> {
        ensure_data_dir(&self.data_dir)?;
        let lock_file = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .truncate(false)
            .open(self.lock_file_path())?;
        FileExt::lock_exclusive(&lock_file)?;
        Ok(lock_file)
    }

    fn write_blocks_atomically(&self, blocks: &[Block]) -> NodeResult<()> {
        let chain_path = chain_file_path(&self.data_dir);
        let mut file = AtomicWriteFile::open(&chain_path)?;
        for block in blocks {
            serde_json::to_writer(&mut file, block)?;
            file.write_all(b"\n")?;
        }
        file.sync_all()?;
        file.commit()?;
        Ok(())
    }

    /// Append a single validated tip-extension line without rewriting the whole chain.
    /// Used for direct tip growth (mining / direct P2P extension). Reorgs still use
    /// [`write_blocks_atomically`].
    fn append_block_line(&self, block: &Block) -> NodeResult<()> {
        ensure_data_dir(&self.data_dir)?;
        let chain_path = chain_file_path(&self.data_dir);
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&chain_path)?;
        serde_json::to_writer(&mut file, block)?;
        file.write_all(b"\n")?;
        file.sync_all()?;
        Ok(())
    }

    /// Append only when previous_hash links to current tip (or chain is empty).
    /// Does not run full consensus validation — use `append_validated` for that.
    fn append_with_tip_link(&self, block: &Block) -> NodeResult<()> {
        let _lock = self.open_exclusive_lock()?;
        let blocks = match self.load_blocks() {
            Ok(blocks) => blocks,
            Err(NodeError::ChainNotInitialized(_)) => Vec::new(),
            Err(error) => return Err(error),
        };
        if let Some(tip) = blocks.last() {
            let expected_tip = hash_to_hex(&tip.hash());
            let actual_previous = hash_to_hex(&block.header.previous_hash);
            if expected_tip != actual_previous {
                return Err(NodeError::StaleChainTip {
                    expected: expected_tip,
                    actual: actual_previous,
                });
            }
            let expected_height = tip.header.height.saturating_add(1);
            if block.header.height != expected_height {
                return Err(NodeError::Input(format!(
                    "block height {} does not extend tip height {} (expected {})",
                    block.header.height, tip.header.height, expected_height
                )));
            }
        } else if block.header.height != 0 {
            return Err(NodeError::Input(format!(
                "first chain block must be height 0, got {}",
                block.header.height
            )));
        }
        // Genesis / tip extension: O(1) line append + fsync (not full rewrite).
        self.append_block_line(block)
    }

    /// Test/bootstrap footgun: write without tip link check (audit A-H04).
    fn append_unchecked(&self, block: &Block) -> NodeResult<()> {
        let _lock = self.open_exclusive_lock()?;
        // Still use line append so fixture chains scale; callers intentionally skip validation.
        self.append_block_line(block)
    }
}

impl BlockStore for JsonlBlockStore {
    fn load_blocks(&self) -> NodeResult<Vec<Block>> {
        load_blocks_from_path(&chain_file_path(&self.data_dir))
    }

    fn append_validated<R, F>(&self, candidate: &Block, validate: F) -> NodeResult<R>
    where
        F: FnOnce(&[Block], &Block) -> NodeResult<R>,
    {
        let _lock = self.open_exclusive_lock()?;
        let blocks = self.load_blocks()?;
        let result = validate(&blocks, candidate)?;

        let expected_tip = blocks.last().map(|block| hash_to_hex(&block.hash()));
        let actual_previous = hash_to_hex(&candidate.header.previous_hash);
        if expected_tip.as_deref() != Some(actual_previous.as_str()) {
            return Err(NodeError::StaleChainTip {
                expected: expected_tip.unwrap_or_else(|| "none".to_owned()),
                actual: actual_previous,
            });
        }
        if let Some(tip) = blocks.last() {
            let expected_height = tip.header.height.saturating_add(1);
            if candidate.header.height != expected_height {
                return Err(NodeError::Input(format!(
                    "block height {} does not extend tip height {} (expected {})",
                    candidate.header.height, tip.header.height, expected_height
                )));
            }
        }

        // Tip extension: O(block) append, not O(chain) rewrite (maturity TM-301 step).
        self.append_block_line(candidate)?;
        Ok(result)
    }

    fn replace_validated<R, F>(
        &self,
        expected_tip: &str,
        candidate: &[Block],
        validate: F,
    ) -> NodeResult<R>
    where
        F: FnOnce(&[Block], &[Block]) -> NodeResult<R>,
    {
        let _lock = self.open_exclusive_lock()?;
        let current = self.load_blocks()?;
        let actual_tip = current
            .last()
            .map(|block| hash_to_hex(&block.hash()))
            .unwrap_or_else(|| "none".to_owned());
        if actual_tip != expected_tip {
            return Err(NodeError::StaleChainTip {
                expected: expected_tip.to_owned(),
                actual: actual_tip,
            });
        }

        let result = validate(&current, candidate)?;
        // Reorg / rewind must rewrite the full file atomically.
        self.write_blocks_atomically(candidate)?;
        Ok(result)
    }
}

pub fn chain_file_path(data_dir: &Path) -> PathBuf {
    data_dir.join(CHAIN_FILE_NAME)
}

pub fn ensure_data_dir(data_dir: &Path) -> NodeResult<()> {
    fs::create_dir_all(data_dir)?;
    Ok(())
}

/// Append a block after tip-link check (previous_hash must match tip when chain is non-empty).
pub fn append_block(data_dir: &Path, block: &Block) -> NodeResult<()> {
    JsonlBlockStore::new(data_dir).append_with_tip_link(block)
}

/// Unchecked append for intentional invalid-chain fixtures in tests only (audit A-H04).
/// Production paths must use [`append_block`] or [`BlockStore::append_validated`].
pub fn append_block_unchecked(data_dir: &Path, block: &Block) -> NodeResult<()> {
    JsonlBlockStore::new(data_dir).append_unchecked(block)
}

pub fn load_blocks(data_dir: &Path) -> NodeResult<Vec<Block>> {
    JsonlBlockStore::new(data_dir).load_blocks()
}

fn load_blocks_from_path(chain_path: &Path) -> NodeResult<Vec<Block>> {
    if !chain_path.exists() {
        return Err(NodeError::ChainNotInitialized(chain_path.to_path_buf()));
    }

    let file = File::open(chain_path)?;
    let reader = BufReader::new(file);
    let mut blocks = Vec::new();

    for (index, line) in reader.lines().enumerate() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let block =
            serde_json::from_str::<Block>(&line).map_err(|error| NodeError::InvalidChainFile {
                path: chain_path.to_path_buf(),
                line: index + 1,
                message: error.to_string(),
            })?;
        blocks.push(block);
    }

    if blocks.is_empty() {
        return Err(NodeError::ChainNotInitialized(chain_path.to_path_buf()));
    }

    // Structural integrity (maturity): catch truncated/corrupt append chains early.
    // Full consensus (PoW, signatures) remains in Chain::from_blocks / validate_chain.
    verify_chain_structure(chain_path, &blocks)?;

    Ok(blocks)
}

/// Verify contiguous heights and previous_hash links without full consensus revalidation.
pub fn verify_chain_structure(chain_path: &Path, blocks: &[Block]) -> NodeResult<()> {
    if blocks.is_empty() {
        return Ok(());
    }
    if blocks[0].header.height != 0 {
        return Err(NodeError::InvalidChainFile {
            path: chain_path.to_path_buf(),
            line: 1,
            message: format!(
                "genesis height must be 0, found {}",
                blocks[0].header.height
            ),
        });
    }
    for index in 1..blocks.len() {
        let prev = &blocks[index - 1];
        let block = &blocks[index];
        let line = index + 1;
        let expected_height = prev.header.height.saturating_add(1);
        if block.header.height != expected_height {
            return Err(NodeError::InvalidChainFile {
                path: chain_path.to_path_buf(),
                line,
                message: format!(
                    "non-contiguous height: expected {expected_height}, found {}",
                    block.header.height
                ),
            });
        }
        let expected_prev = hash_to_hex(&prev.hash());
        let actual_prev = hash_to_hex(&block.header.previous_hash);
        if expected_prev != actual_prev {
            return Err(NodeError::InvalidChainFile {
                path: chain_path.to_path_buf(),
                line,
                message: format!(
                    "broken previous_hash link: expected {expected_prev}, found {actual_prev}"
                ),
            });
        }
    }
    Ok(())
}

pub fn reset_data_dir(data_dir: &Path) -> NodeResult<()> {
    if data_dir.exists() {
        fs::remove_dir_all(data_dir)?;
    }
    fs::create_dir_all(data_dir)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use vireon_core::{devnet_genesis, Address, PrivateKey};

    fn miner_address() -> String {
        Address::from_public_key_for_network(
            &PrivateKey::generate().public_key(),
            vireon_core::Network::Devnet,
        )
        .to_string()
    }

    #[test]
    fn tip_append_grows_file_without_losing_history() {
        let dir = tempfile::tempdir().expect("temp");
        let store = JsonlBlockStore::new(dir.path());
        let miner = miner_address();
        let genesis = devnet_genesis(&miner).expect("genesis");
        store.append_with_tip_link(&genesis).expect("genesis");
        let after_g = fs::metadata(chain_file_path(dir.path()))
            .expect("meta")
            .len();
        // Tip-link only cares about previous_hash; body validity is checked by consensus callers.
        let mut child = genesis.clone();
        child.header.height = 1;
        child.header.previous_hash = genesis.hash();
        store.append_with_tip_link(&child).expect("child");
        let after_c = fs::metadata(chain_file_path(dir.path()))
            .expect("meta2")
            .len();
        assert!(after_c > after_g, "append should grow the chain file");
        let loaded = store.load_blocks().expect("load");
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].header.height, 0);
        assert_eq!(loaded[1].header.height, 1);
    }

    #[test]
    fn replace_validated_rewrites_full_file() {
        let dir = tempfile::tempdir().expect("temp");
        let store = JsonlBlockStore::new(dir.path());
        let miner = miner_address();
        let genesis = devnet_genesis(&miner).expect("genesis");
        store.append_with_tip_link(&genesis).expect("genesis");
        let tip = hash_to_hex(&genesis.hash());
        let only_genesis = vec![genesis.clone()];
        store
            .replace_validated(&tip, &only_genesis, |_cur, _cand| Ok(()))
            .expect("replace");
        let loaded = store.load_blocks().expect("load");
        assert_eq!(loaded.len(), 1);
    }

    #[test]
    fn load_rejects_broken_previous_hash_link() {
        let dir = tempfile::tempdir().expect("temp");
        let store = JsonlBlockStore::new(dir.path());
        let miner = miner_address();
        let genesis = devnet_genesis(&miner).expect("genesis");
        store.append_with_tip_link(&genesis).expect("genesis");
        let mut orphan = genesis.clone();
        orphan.header.height = 1;
        // Intentionally wrong previous_hash (not tip).
        orphan.header.previous_hash = vireon_core::Hash::zero();
        store
            .append_unchecked(&orphan)
            .expect("write corrupt fixture");
        let err = store.load_blocks().expect_err("must reject broken link");
        assert!(
            matches!(err, NodeError::InvalidChainFile { .. }),
            "unexpected error: {err}"
        );
    }
}
