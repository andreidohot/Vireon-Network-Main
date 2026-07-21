# Vireon Update Policy

Status: Implemented / Mainnet Candidate

## Desktop Control Center

The supported desktop updater lives in
`vireon-desktop-tauri/src-tauri/src/updates.rs`.

- Background polling only detects and announces a newer GitHub release.
- Download and installation require an explicit action in Update Center.
- `SHA256SUMS` is mandatory and every selected asset is checked for declared
  size and SHA-256 before it is executed or installed.
- Equal or older versions are rejected.
- Managed Vireon processes stop through the operator boundary before an
  approved replacement is applied.
- The removed `auto-update-desktop.ps1` path is not supported because it applied
  executable updates without the Control Center approval boundary.

Set `VIREON_DISABLE_AUTO_UPDATE=1` only for debugging the packaged desktop
application. A GitHub token is optional for API rate limits and must remain in
the operating-system credential environment, never in this repository.

## VPS control plane

The Docker VPS control plane has no automatic updater. Operators use the
checksum-verified manual process in
`vireon-release/vps-control-plane/MANUAL_UPGRADE.md`.

Manual upgrades require an exact archive and checksum, a state backup, an
immutable image/source version and post-deploy health verification. The VPS
package never installs a miner.

See `../../vireon-release/vps-control-plane/README.md` for installation and
release asset names.
