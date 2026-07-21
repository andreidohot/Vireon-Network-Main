# Vireon CUDA Miner

`vireon-miner` is the FiroPoW 0.9.4 CUDA miner for Vireon GPU PoW.

- NVIDIA CUDA kernels are mandatory; there is no CPU or OpenCL mining path.
- The epoch DAG is generated directly in VRAM from the light cache.
- Every CUDA candidate is revalidated by `vireon-core` before submission.
- Solo and pool sources use the same kernel and nonce allocator.
- Multiple CUDA GPUs receive exact, non-overlapping nonce ranges concurrently.

```powershell
cargo run -p vireon-miner -- devices --backend cuda --json
$env:VIREON_REQUIRE_CUDA_TEST='1'
cargo test -p vireon-miner --test pow_parity cuda_gpu_hashes_match_core_when_device_present
cargo run -p vireon-miner -- benchmark --device cuda --seconds 5
```

The CUDA Toolkit is required to build the sidecar. End users need a supported
NVIDIA driver. Host FiroPoW code in `vireon-core` is consensus validation, not a
product mining backend.
