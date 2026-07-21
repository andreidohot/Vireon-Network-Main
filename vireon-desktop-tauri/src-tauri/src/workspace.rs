use crate::error::{AppError, AppResult};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

static RESOURCE_ROOT: OnceLock<PathBuf> = OnceLock::new();

/// Called once at app startup so packaged resource paths resolve correctly.
pub fn set_resource_root(path: PathBuf) {
    let _ = RESOURCE_ROOT.set(path);
}

/// Packaged Tauri resource directory, if registered at startup.
pub fn resource_root() -> Option<PathBuf> {
    RESOURCE_ROOT.get().cloned()
}

pub fn find_workspace_root() -> AppResult<PathBuf> {
    if let Ok(configured) = std::env::var("VIREON_WORKSPACE_ROOT") {
        let path = PathBuf::from(configured);
        if is_workspace(&path) || has_operator_script(&path) {
            return Ok(path);
        }
    }

    // Dev preference: monorepo root (cargo workspace) wins over empty resource dirs.
    if cfg!(debug_assertions) {
        if let Some(monorepo) = monorepo_from_manifest() {
            return Ok(monorepo);
        }
    }

    if let Some(resource) = RESOURCE_ROOT.get() {
        for candidate in resource_candidates(resource) {
            if is_workspace(&candidate)
                || has_operator_script(&candidate)
                || has_bundled_node(&candidate)
                || has_bundled_miner(&candidate)
            {
                return Ok(candidate);
            }
        }
        // Last resort for NSIS installs: use the resource dir even if checks are partial.
        return Ok(resource.clone());
    }

    let mut current = std::env::current_dir()?;
    for _ in 0..12 {
        if is_workspace(&current) || has_operator_script(&current) {
            return Ok(current);
        }
        if let Some(parent) = current.parent() {
            current = parent.to_path_buf();
        } else {
            break;
        }
    }

    if let Some(monorepo) = monorepo_from_manifest() {
        return Ok(monorepo);
    }

    Err(AppError::msg(
        "Vireon workspace could not be located. Set VIREON_WORKSPACE_ROOT or run from the monorepo / packaged resources.",
    ))
}

fn monorepo_from_manifest() -> Option<PathBuf> {
    let from_crate = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    // vireon-desktop-tauri/src-tauri -> vireon-desktop-tauri -> monorepo
    if let Some(parent) = from_crate.parent() {
        if is_workspace(parent) {
            return Some(parent.to_path_buf());
        }
        if let Some(grand) = parent.parent() {
            if is_workspace(grand) {
                return Some(grand.to_path_buf());
            }
        }
    }
    None
}

fn resource_candidates(resource: &Path) -> Vec<PathBuf> {
    let mut out = vec![resource.to_path_buf()];
    let nested = resource.join("resources");
    if nested.exists() {
        out.push(nested);
    }
    out
}

pub fn local_root(workspace: &Path) -> PathBuf {
    // Packaged builds keep miner metrics/logs outside the install directory.
    let packaged = has_bundled_node(workspace)
        || has_bundled_miner(workspace)
        || RESOURCE_ROOT.get().is_some();
    if packaged {
        if cfg!(windows) {
            let local_app_data = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| {
                dirs::home_dir()
                    .map(|home| {
                        home.join("AppData")
                            .join("Local")
                            .to_string_lossy()
                            .into_owned()
                    })
                    .unwrap_or_else(|| ".".into())
            });
            return PathBuf::from(local_app_data)
                .join("Vireon")
                .join("ControlCenter")
                .join(".vireon-local");
        }
        return user_data_dir().join(".vireon-local");
    }
    workspace.join(".vireon-local")
}

pub fn user_data_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Vireon")
        .join("ControlCenter")
}

/// Preserve the previous Veiron profile as a rollback source while copying it
/// into the Vireon location on first launch. Existing Vireon files always win.
pub fn migrate_legacy_user_data() -> AppResult<()> {
    let Some(base) = dirs::data_dir() else {
        return Ok(());
    };
    let legacy = base.join("Veiron").join("ControlCenter");
    let current = user_data_dir();
    if legacy.exists() {
        copy_missing_tree(&legacy, &current)?;
    }

    if let Ok(workspace) = find_workspace_root() {
        let old_local = workspace.join(".veiron-local");
        let new_local = workspace.join(".vireon-local");
        if old_local.exists() {
            copy_missing_tree(&old_local, &new_local)?;
        }
    }
    Ok(())
}

fn copy_missing_tree(source: &Path, destination: &Path) -> AppResult<()> {
    if source.is_file() {
        if !destination.exists() {
            if let Some(parent) = destination.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::copy(source, destination)?;
        }
        return Ok(());
    }
    std::fs::create_dir_all(destination)?;
    for entry in std::fs::read_dir(source)? {
        let entry = entry?;
        copy_missing_tree(&entry.path(), &destination.join(entry.file_name()))?;
    }
    Ok(())
}

pub fn settings_path() -> PathBuf {
    user_data_dir().join("settings.json")
}

fn is_workspace(candidate: &Path) -> bool {
    has_bundled_node(candidate)
        || candidate
            .join("scripts")
            .join("local")
            .join("vireon-local.ps1")
            .exists()
        || candidate
            .join("scripts")
            .join("local")
            .join("start-all.sh")
            .exists()
        || candidate.join("vireon-core").join("Cargo.toml").exists()
}

fn has_operator_script(candidate: &Path) -> bool {
    candidate.join("vireon.ps1").exists() || candidate.join("vireon.sh").exists()
}

fn has_bundled_node(candidate: &Path) -> bool {
    let binary = if cfg!(windows) {
        "vireon-node.exe"
    } else {
        "vireon-node"
    };
    candidate.join("bin").join(binary).exists()
}

fn has_bundled_miner(candidate: &Path) -> bool {
    let binary = if cfg!(windows) {
        "vireon-miner.exe"
    } else {
        "vireon-miner"
    };
    candidate.join("bin").join(binary).exists()
}

pub fn keystore_helper_path(_workspace: &Path) -> PathBuf {
    let binary = if cfg!(windows) {
        "vireon-keystore-helper.exe"
    } else {
        "vireon-keystore-helper"
    };

    // 1) Next to the running executable (externalBin install layout)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let candidates = [
                parent.join(binary),
                parent.join("bin").join(binary),
                parent.join("resources").join("bin").join(binary),
            ];
            for path in candidates {
                if path.exists() {
                    return path;
                }
            }
        }
    }

    // 2) Resource root staged layout
    if let Some(resource) = RESOURCE_ROOT.get() {
        for root in resource_candidates(resource) {
            for path in [root.join("bin").join(binary), root.join(binary)] {
                if path.exists() {
                    return path;
                }
            }
        }
    }

    // 3) Tauri project binaries (dev after prepare-native)
    let tauri_bin = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(binary);
    if tauri_bin.exists() {
        return tauri_bin;
    }

    // 4) Local native crate release build
    let native = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("native")
        .join("keystore-helper")
        .join("target")
        .join("release")
        .join(binary);
    if native.exists() {
        return native;
    }

    tauri_bin
}
