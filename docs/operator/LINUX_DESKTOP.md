# Linux Desktop - Vireon Control Center

Status: **1.0.0 Mainnet Candidate / Prototype** (not public Mainnet)

Linux and Windows use the same React/Tauri codebase. The product surface covers
wallet, NVIDIA CUDA FiroPoW mining, pool, explorer, local node/RPC sidecars,
settings, recovery, and user-approved updates.

## Supported packages

| Distribution | Artifact |
|---|---|
| Ubuntu 22.04+/24.04 and Debian 12+ | `.deb` and `.AppImage` |
| Arch Linux | `.AppImage` or the included `PKGBUILD` |
| Fedora/RHEL-like | `.rpm` and `.AppImage` |

## Mining requirement

The bundled miner is NVIDIA CUDA-only. Building the release requires the CUDA
Toolkit and `nvcc`; running the miner requires a compatible NVIDIA driver and
enough VRAM for the FiroPoW DAG. AMD/Intel OpenCL mining and CPU mining are not
included and there is no host fallback.

## Build host prerequisites

Install Rust, Node.js 20+, the NVIDIA CUDA Toolkit, and the platform Tauri
dependencies. Example for Ubuntu/Debian:

```bash
sudo apt update
sudo apt install -y \
  build-essential curl wget file pkg-config patchelf fakeroot rpm \
  libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
  librsvg2-dev libssl-dev libsecret-1-dev libsoup-3.0-dev \
  libjavascriptcoregtk-4.1-dev libarchive-tools zenity
nvcc --version
```

Install the CUDA Toolkit from NVIDIA's repository for the build distribution;
the distribution `nvidia-cuda-toolkit` package may be too old for current GPUs.

## Build

From the repository root on Linux:

```bash
bash scripts/release/build-linux-desktop.sh
```

To select packages:

```bash
bash scripts/release/build-linux-desktop.sh --bundles deb,appimage,rpm
```

The script sets `VIREON_REQUIRE_CUDA=1`; it fails instead of producing a
CPU-mining or stub-mining artifact. Output is collected under:

```text
vireon-release/apps/linux/
  *.deb
  *.AppImage
  *.rpm
  INSTALL.txt
  SHA256SUMS
```

## Install

```bash
# Ubuntu / Debian
sudo apt install ./vireon-release/apps/linux/*.deb

# AppImage
chmod +x vireon-release/apps/linux/*.AppImage
./vireon-release/apps/linux/*.AppImage

# Fedora
sudo dnf install ./vireon-release/apps/linux/*.rpm
```

Wallet secrets use Secret Service (GNOME Keyring/KWallet through libsecret).
Verify `SHA256SUMS` before installation. Network maturity remains governed by
`docs/release/NETWORK_MATURITY.md`.
