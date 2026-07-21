# Vireon mining

## Canonical proof of work

| Property | Value |
|---|---|
| Algorithm | FiroPoW 0.9.4 (ProgPoW revision 0.9.4) |
| Vireon PoW version | 1 |
| Period length | 1 block |
| Consensus source | `vireon-core/src/firopow.rs` and vendored `native/crypto/progpow` |
| Product miner | NVIDIA CUDA only |
| Node validation | Canonical host verification of `mix_hash` and `final_hash` |

The miner builds the epoch DAG directly in NVIDIA VRAM and searches all product
nonces in `vireon-miner/kernels/firopow_cuda.cu`. CPU mining, OpenCL mining,
hybrid mining, and host-emulated fallback are not product features.

Host computation remains in the node and miner only for consensus validation
and a three-item DAG parity check during CUDA initialization. Validation does
not search nonce ranges and is not a mining backend.

## Commands

```powershell
$env:VIREON_REQUIRE_CUDA = "1"
cargo build -p vireon-miner --release --locked

$env:VIREON_REQUIRE_CUDA_TEST = "1"
cargo test -p vireon-miner --test pow_parity --locked

cargo run -p vireon-miner --locked -- devices --backend cuda
cargo run -p vireon-miner --locked -- benchmark --device cuda --seconds 10
```

Release preparation sets `VIREON_REQUIRE_CUDA=1` and fails when `nvcc`, the host
C++ compiler, or the CUDA kernel cannot be linked. A diagnostic stub can list a
driver-visible NVIDIA device but cannot mine.

See [GPU_MINING.md](./GPU_MINING.md) for runtime details and
[CUDA_AND_ASIC_RESISTANCE.md](./CUDA_AND_ASIC_RESISTANCE.md) for the security
model.
