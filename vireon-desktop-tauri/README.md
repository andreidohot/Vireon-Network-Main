# Vireon Control Center

Cross-platform Tauri 2 desktop application for Vireon Network.

- React 19 + Vite user interface
- typed RPC access through `vireon-sdk-rust`
- wallet keys stored through the `vireon-keystore-helper` sidecar and the OS credential vault
- solo and pool mining through the bundled NVIDIA CUDA FiroPoW 0.9.4 miner
- no CPU mining, OpenCL mining, or host-emulated mining fallback

The canonical network maturity status is defined in
`../docs/release/NETWORK_MATURITY.md`. Packaging a 1.0.0 application does not,
by itself, declare the public network live.

## Requirements

Mining requires an NVIDIA GPU, a compatible NVIDIA driver, and enough VRAM for
the current FiroPoW epoch DAG. Building the bundled miner requires the NVIDIA
CUDA Toolkit (`nvcc`). Release preparation fails if the CUDA kernel cannot be
compiled and linked.

## Windows

```powershell
cd vireon-desktop-tauri
npm ci
npm run prepare:native:sidecars
npx tauri build --bundles nsis,msi
```

Artifacts are written below `src-tauri/target/release/bundle/`.

## Linux

Build on an NVIDIA CUDA-capable Linux host with the Tauri AppImage, deb, and rpm
packaging dependencies installed:

```bash
cd vireon-desktop-tauri
npm ci
bash scripts/prepare-native.sh --with-sidecars
npx tauri build --bundles appimage,deb,rpm
```

From the repository root, `bash scripts/release/build-linux-desktop.sh` collects
the release files and `SHA256SUMS` under `vireon-release/apps/linux/`.

## Development and validation

```powershell
cd vireon-desktop-tauri
npm ci
npm run build
npm test
cargo test --manifest-path src-tauri/Cargo.toml --locked
```

Use `npm run tauri:dev` after `npm run prepare:native` for the desktop shell.
The diagnostic build may start without `nvcc`, but mining remains unavailable;
it never falls back to CPU work.
