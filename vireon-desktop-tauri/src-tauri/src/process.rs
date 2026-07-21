use crate::error::{AppError, AppResult};
use crate::settings::{self, get_rpc_url};
use crate::workspace::{find_workspace_root, local_root, resource_root};
use serde::Deserialize;
use std::fs;
use std::path::PathBuf;
use std::process::Stdio;
use tokio::process::Command;

#[derive(Debug, Clone, Deserialize)]
pub struct MinerStartOptions {
    pub mode: String,
    /// Product compute backend. Legacy values resolve to CUDA.
    #[serde(default)]
    pub backend: Option<String>,
    #[serde(default)]
    pub gpu_intensity: Option<u8>,
    #[serde(default)]
    pub gpu_devices: Option<Vec<String>>,
    pub pool_url: Option<String>,
    pub worker_name: Option<String>,
}

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[cfg(windows)]
const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
#[cfg(windows)]
const STILL_ACTIVE: u32 = 259;

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn OpenProcess(access: u32, inherit: i32, pid: u32) -> *mut std::ffi::c_void;
    fn GetExitCodeProcess(handle: *mut std::ffi::c_void, code: *mut u32) -> i32;
    fn CloseHandle(handle: *mut std::ffi::c_void) -> i32;
}

pub fn is_local_rpc_url(url: &str) -> bool {
    let Ok(parsed) = url::Url::parse(url) else {
        return false;
    };
    matches!(
        parsed.host_str().unwrap_or(""),
        "127.0.0.1" | "localhost" | "::1" | "[::1]"
    )
}

/// Runtime root used for logs/metrics. Prefer user data for packaged installs.
fn runtime_roots() -> AppResult<(PathBuf, PathBuf)> {
    let workspace = find_workspace_root().or_else(|_| {
        // Packaged fallback: resource dir itself is the workspace.
        resource_root().ok_or_else(|| {
            AppError::msg(
                "Cannot locate Vireon install resources. Reinstall Control Center or set VIREON_WORKSPACE_ROOT.",
            )
        })
    })?;
    let local = local_root(&workspace);
    let _ = fs::create_dir_all(local.join("logs"));
    let _ = fs::create_dir_all(local.join("miner"));
    Ok((workspace, local))
}

pub async fn managed_process_running(name: &str) -> bool {
    let Ok((_, local)) = runtime_roots() else {
        return false;
    };
    let pid_path = local.join("logs").join(format!("{name}.pid"));
    let Ok(raw) = fs::read_to_string(pid_path) else {
        return false;
    };
    let pid = raw.trim();
    if !pid.chars().all(|c| c.is_ascii_digit()) {
        return false;
    }
    // Cheap liveness check — never spawn tasklist.exe (hundreds of ms + CPU) on every
    // network snapshot poll; that was stacking with miner DAG work and freezing the UI.
    pid_alive(pid).await
}

async fn pid_alive(pid: &str) -> bool {
    #[cfg(windows)]
    {
        let Ok(pid_u32) = pid.parse::<u32>() else {
            return false;
        };
        // OpenProcess is microseconds vs hundreds of ms for tasklist.exe.
        tokio::task::spawn_blocking(move || unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid_u32);
            if handle.is_null() {
                return false;
            }
            let mut code = 0_u32;
            let ok = GetExitCodeProcess(handle, &mut code) != 0;
            let _ = CloseHandle(handle);
            ok && code == STILL_ACTIVE
        })
        .await
        .unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        Command::new("kill")
            .args(["-0", pid])
            .status()
            .await
            .map(|status| status.success())
            .unwrap_or(false)
    }
}

pub async fn run_operator(
    command: &str,
    miner_address: Option<&str>,
    miner_options: Option<MinerStartOptions>,
) -> AppResult<String> {
    let allowed = [
        "start",
        "stop",
        "restart",
        "status",
        "mine",
        "validate",
        "backup",
        "miner-start",
        "miner-stop",
    ];
    if !allowed.contains(&command) {
        return Err(AppError::msg(format!(
            "Unsupported operator command: {command}"
        )));
    }

    // Mining never goes through vireon.ps1 - spawn the binary directly against the VPS RPC/pool.
    if command == "miner-start" {
        return start_remote_miner(miner_address, miner_options).await;
    }
    if command == "miner-stop" {
        return stop_managed_service("miner").await;
    }

    let rpc_url = get_rpc_url();
    if !is_local_rpc_url(&rpc_url) {
        match command {
            "start" | "restart" | "stop" | "mine" | "validate" | "backup" => {
                return Err(AppError::msg(format!(
                    "Local stack command '{command}' is disabled. Control Center uses the VPS RPC at {rpc_url}. Use Miner for GPU mining against that gateway."
                )));
            }
            "status" => {
                return Ok(format!(
                    "Remote VPS mode\nRPC: {rpc_url}\nMiner managed: {}\n",
                    managed_process_running("miner").await
                ));
            }
            _ => {}
        }
    }

    run_local_stack_operator(command, miner_address, miner_options).await
}

async fn start_remote_miner(
    miner_address: Option<&str>,
    miner_options: Option<MinerStartOptions>,
) -> AppResult<String> {
    let address = miner_address.ok_or_else(|| {
        AppError::msg(
            "Create or select a wallet before starting the miner (Miner needs a payout address).",
        )
    })?;
    if !address.starts_with("vire1") {
        return Err(AppError::msg(format!(
            "Wallet address looks invalid for Mainnet Candidate: {address}"
        )));
    }

    let options = miner_options.unwrap_or(MinerStartOptions {
        mode: settings::get().default_miner_mode,
        backend: Some(settings::get().default_miner_backend),
        gpu_intensity: Some(settings::get().default_gpu_intensity),
        gpu_devices: None,
        pool_url: Some(settings::get().default_pool_url),
        worker_name: Some(settings::get().default_worker_name),
    });
    let backend = options
        .backend
        .as_deref()
        .unwrap_or(&settings::get().default_miner_backend)
        .trim()
        .to_ascii_lowercase();
    let backend = match backend.as_str() {
        "gpu" | "cuda" | "auto" => "cuda".to_owned(),
        _ => "cuda".to_owned(),
    };
    let gpu_intensity = options
        .gpu_intensity
        .unwrap_or(settings::get().default_gpu_intensity)
        .clamp(1, 100);
    let gpu_devices = options
        .gpu_devices
        .filter(|items| !items.is_empty())
        .unwrap_or_else(|| settings::get().default_gpu_devices.clone());
    let mode = options.mode.trim().to_ascii_lowercase();
    let mode = if mode == "pool" { "pool" } else { "solo" };
    let mut pool_url = options
        .pool_url
        .unwrap_or_else(|| settings::get().default_pool_url)
        .trim()
        .trim_end_matches('/')
        .to_string();
    if pool_url.is_empty() {
        pool_url = vireon_sdk_rust::DEFAULT_MAINNET_CANDIDATE_POOL.into();
    }
    let worker_name = options
        .worker_name
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "desktop-01".into());
    let rpc_url = get_rpc_url();

    // Short client for light probes; longer client for work/template.
    // User-facing strings are pure ASCII (no Unicode arrows/dashes) so Windows
    // consoles and mis-encoded UI never show mojibake like "Settings A- Network".
    let light = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| AppError::msg(e.to_string()))?;
    let heavy = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(45))
        .build()
        .map_err(|e| AppError::msg(e.to_string()))?;

    if mode == "pool" {
        // Pool mode talks only to the pool URL. Do NOT require public RPC /health.
        let probe = format!("{pool_url}/api/v1/pool/status");
        let response = light.get(&probe).send().await.map_err(|e| {
            AppError::msg(format!(
                "Pool unreachable at {pool_url}: {e}. Expected {}. Check Settings > Network / Mining defaults for the pool URL.",
                vireon_sdk_rust::DEFAULT_MAINNET_CANDIDATE_POOL
            ))
        })?;
        let pool_status = response.status();
        if !pool_status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(AppError::msg(format!(
                "Pool status failed (HTTP {pool_status}) at {probe}. Body: {body}"
            )));
        }
        // Soft work probe: if pool is up but work is temporarily 502/504, still start miner.
        let work = format!(
            "{pool_url}/api/v1/work?miner_address={}&worker_name={}",
            urlencoding_lite(address),
            urlencoding_lite(&worker_name)
        );
        match heavy.get(&work).send().await {
            Ok(work_resp) if work_resp.status().is_success() => {}
            Ok(work_resp) => {
                let status = work_resp.status();
                let body = work_resp.text().await.unwrap_or_default();
                if status.as_u16() == 400 || status.as_u16() == 401 || status.as_u16() == 403 {
                    return Err(AppError::msg(format!(
                        "Pool rejected work for this wallet (HTTP {status}). Detail: {body}"
                    )));
                }
                eprintln!(
                    "vireon: pool work probe HTTP {status} (starting miner anyway). Body: {body}"
                );
            }
            Err(err) => {
                eprintln!("vireon: pool work probe failed ({err}); starting miner anyway");
            }
        }
    } else {
        // Solo: prefer a real mining template. Soft-fail /health so transient
        // DNS/TLS blips do not hard-block miner start when the template still works.
        let health_url = format!("{}/health", rpc_url.trim_end_matches('/'));
        match light.get(&health_url).send().await {
            Ok(health) if health.status().is_success() => {}
            Ok(health) => {
                let code = health.status().as_u16();
                eprintln!(
                    "vireon: RPC health HTTP {code} at {health_url}; continuing with template probe"
                );
            }
            Err(err) => {
                eprintln!(
                    "vireon: RPC health unreachable at {health_url} ({err}); continuing with template probe"
                );
            }
        }
        let probe = format!(
            "{}/mining/template?miner_address={}",
            rpc_url.trim_end_matches('/'),
            urlencoding_lite(address)
        );
        let response = heavy.get(&probe).send().await.map_err(|e| {
            AppError::msg(format!(
                "VPS solo mining template failed at {rpc_url}: {e}. \
                 Check Settings > Network > RPC URL (use https://rpcnode.dohotstudio.com, not 127.0.0.1). \
                 Or switch Miner mode to Pool and use {pool_url}."
            ))
        })?;
        let template_status = response.status();
        if !template_status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(AppError::msg(format!(
                "VPS mining template rejected (HTTP {template_status}). Detail: {body}. \
                 Or switch Miner mode to Pool and use {pool_url}."
            )));
        }
    }

    if managed_process_running("miner").await {
        let _ = stop_managed_service("miner").await;
        tokio::time::sleep(std::time::Duration::from_millis(400)).await;
    }

    let (workspace, local) = runtime_roots()?;
    let miner_dir = local.join("miner");
    let logs_dir = local.join("logs");
    fs::create_dir_all(&miner_dir)?;
    fs::create_dir_all(&logs_dir)?;

    let metrics_path = miner_dir.join("metrics.json");
    let config_path = miner_dir.join("config.toml");
    // TOML string with Windows paths: use forward slashes (accepted by Rust Path).
    let metrics_toml = metrics_path.to_string_lossy().replace('\\', "/");
    let source_block = if mode == "pool" {
        format!(
            r#"[source]
kind = "pool"
url = "{pool_url}"
worker_name = "{worker_name}"
timeout_seconds = 20
"#
        )
    } else {
        format!(
            r#"[source]
kind = "rpc"
url = "{rpc_url}"
timeout_seconds = 20
"#
        )
    };

    let gpu_devices_toml = if gpu_devices.is_empty() {
        String::new()
    } else {
        let items: Vec<String> = gpu_devices
            .iter()
            .map(|d| format!("\"{}\"", d.replace('"', "")))
            .collect();
        format!("gpu_devices = [{}]\n", items.join(", "))
    };
    // Pool mode refreshes work more often so stale jobs are replaced quickly.
    let template_refresh = if mode == "pool" { 3 } else { 5 };
    // Short status interval so Control Center hashrate updates frequently.
    let status_interval = if mode == "pool" { 2 } else { 3 };
    // GPU-only product: intensity scales CUDA work-items.
    // Keep batches modest so:
    //  1) first hashrate sample appears within ~1–2s after DAG warm-up
    //  2) host full-DAG fallback cannot peg the CPU on 300k+ nonce leases
    // Previous defaults (350k–500k) left the UI at 0 H/s while CPU sat at 100%.
    let intensity_u = u64::from(gpu_intensity.clamp(1, 100));
    let gpu_base = 131_072_u64;
    let gpu_batch_size = (gpu_base.saturating_mul(intensity_u) / 100).clamp(16_384, 131_072);
    let nonce_batch_size = gpu_batch_size;
    let gpu_batch_toml = format!("gpu_batch_size = {gpu_batch_size}\n");
    let config = format!(
        r#"schema_version = 4
miner_address = "{address}"
nonce_batch_size = {nonce_batch_size}
template_refresh_seconds = {template_refresh}
status_interval_seconds = {status_interval}
backend_mode = "{backend}"
gpu_intensity = {gpu_intensity}
kernel_validation = true
{gpu_batch_toml}{gpu_devices_toml}metrics_path = "{metrics_toml}"

{source_block}"#
    );
    fs::write(&config_path, config)?;
    // Clear stale metrics so UI flips off "mining" leftovers from a previous session.
    let _ = fs::write(
        &metrics_path,
        serde_json::json!({
            "status": "starting",
            "network_id": "",
            "template_id": "",
            "height": 0,
            "difficulty_leading_zero_bits": 0,
            "backend_mode": backend,
            "active_backend": backend,
            "hashrate_hs": 0.0,
            "hashes_attempted": 0,
            "accepted_blocks": 0,
            "rejected_local": 0,
            "stale": 0,
            "gpu_devices": 0,
            "last_error": null,
            "updated_at_unix_seconds": std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0),
        })
        .to_string(),
    );

    let miner_bin = resolve_binary("vireon-miner")?;
    let stdout_path = logs_dir.join("miner.log");
    let stderr_path = logs_dir.join("miner.err.log");

    // Write a startup banner so the console is never empty.
    let banner = format!(
        "starting vireon-miner\nbinary={}\nconfig={}\nwork_mode={mode}\nbackend={backend}\ngpu_intensity={gpu_intensity}\nrpc={rpc_url}\npool={pool_url}\naddress={address}\n",
        miner_bin.display(),
        config_path.display()
    );
    fs::write(&stdout_path, &banner)?;
    fs::write(&stderr_path, "")?;
    let stdout_file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&stdout_path)?;
    let stderr_file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&stderr_path)?;

    let config_arg = config_path
        .to_str()
        .ok_or_else(|| AppError::msg("Miner config path is not valid UTF-8"))?
        .to_string();

    let mut cmd = Command::new(&miner_bin);
    cmd.args(["--config", &config_arg, "mine"])
        .current_dir(&workspace)
        .env("VIREON_LOCAL_ROOT", &local)
        .env("VIREON_WORKSPACE_ROOT", &workspace)
        .env("VIREON_RPC_URL", &rpc_url)
        .stdout(Stdio::from(stdout_file))
        .stderr(Stdio::from(stderr_file))
        .kill_on_drop(false);

    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let child = cmd.spawn().map_err(|err| {
        AppError::msg(format!(
            "Failed to spawn miner binary {}:\n{err}\nInstall resources must include bin/vireon-miner (or vireon-miner.exe on Windows).",
            miner_bin.display()
        ))
    })?;
    let pid = child
        .id()
        .ok_or_else(|| AppError::msg("Miner process has no PID"))?;
    fs::write(logs_dir.join("miner.pid"), pid.to_string())?;
    drop(child);

    // Brief settle - if the process dies immediately, surface stderr.
    tokio::time::sleep(std::time::Duration::from_millis(700)).await;
    if !managed_process_running("miner").await {
        let err = fs::read_to_string(&stderr_path).unwrap_or_default();
        let out = fs::read_to_string(&stdout_path).unwrap_or_default();
        return Err(AppError::msg(format!(
            "Miner exited immediately after start.\n--- miner.err.log ---\n{}\n--- miner.log ---\n{}",
            err.trim(),
            out.trim()
        )));
    }

    Ok(format!(
        "Miner started (pid {pid})\nWork mode: {mode}\nBackend: {backend}\nGPU intensity: {gpu_intensity}\nWork: {}\nAddress: {address}\nMetrics: {}\nLogs: {}\nBinary: {}",
        if mode == "pool" {
            pool_url
        } else {
            rpc_url
        },
        metrics_path.display(),
        stdout_path.display(),
        miner_bin.display()
    ))
}

async fn stop_managed_service(name: &str) -> AppResult<String> {
    let (_, local) = runtime_roots()?;
    let pid_path = local.join("logs").join(format!("{name}.pid"));
    let raw = fs::read_to_string(&pid_path).unwrap_or_default();
    let pid = raw.trim().to_string();
    let _ = fs::remove_file(&pid_path);

    if pid.chars().all(|c| c.is_ascii_digit()) && !pid.is_empty() {
        if cfg!(windows) {
            let mut cmd = Command::new("taskkill.exe");
            cmd.args(["/PID", &pid, "/T", "/F"]);
            #[cfg(windows)]
            {
                cmd.creation_flags(CREATE_NO_WINDOW);
            }
            let _ = cmd.output().await;
        } else {
            let _ = Command::new("kill").args(["-TERM", &pid]).output().await;
            tokio::time::sleep(std::time::Duration::from_millis(400)).await;
            let _ = Command::new("kill").args(["-KILL", &pid]).output().await;
        }
    }

    if name == "miner" {
        if cfg!(windows) {
            let mut cmd = Command::new("taskkill.exe");
            cmd.args(["/IM", "vireon-miner.exe", "/F"]);
            #[cfg(windows)]
            {
                cmd.creation_flags(CREATE_NO_WINDOW);
            }
            let _ = cmd.output().await;
        } else {
            let _ = Command::new("pkill")
                .args(["-f", "vireon-miner"])
                .output()
                .await;
        }
        // Mark metrics stopped so UI hashrate/status drop immediately (not leftover "mining").
        let metrics_path = local.join("miner").join("metrics.json");
        let _ = fs::write(
            &metrics_path,
            serde_json::json!({
                "status": "stopped",
                "network_id": "",
                "template_id": "",
                "height": 0,
                "difficulty_leading_zero_bits": 0,
                "backend_mode": "",
                "active_backend": "",
                "hashrate_hs": 0.0,
                "hashes_attempted": 0,
                "accepted_blocks": 0,
                "rejected_local": 0,
                "stale": 0,
                "gpu_devices": 0,
                "last_error": null,
                "updated_at_unix_seconds": std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0),
            })
            .to_string(),
        );
    }

    Ok(if pid.is_empty() {
        format!("{name} stop requested (no pid file)")
    } else {
        format!("{name} stop requested (pid was {pid})")
    })
}

fn resolve_binary(name: &str) -> AppResult<PathBuf> {
    let file = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    };

    let mut candidates: Vec<PathBuf> = Vec::new();

    // 1) Packaged resource root (Tauri resource_dir)
    if let Some(resource) = resource_root() {
        candidates.push(resource.join("bin").join(&file));
        candidates.push(resource.join("resources").join("bin").join(&file));
        candidates.push(resource.join(&file));
    }

    // 2) Workspace from finder
    if let Ok(workspace) = find_workspace_root() {
        candidates.push(workspace.join("bin").join(&file));
        candidates.push(workspace.join("resources").join("bin").join(&file));
        candidates.push(workspace.join("target").join("release").join(&file));
    }

    // 3) Next to the running app executable
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.join(&file));
            candidates.push(parent.join("bin").join(&file));
            candidates.push(parent.join("resources").join("bin").join(&file));
            // NSIS layout: exe in app root, resources alongside
            if let Some(grand) = parent.parent() {
                candidates.push(grand.join("resources").join("bin").join(&file));
            }
        }
    }

    // 4) Dev tree
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    candidates.push(manifest.join("resources").join("bin").join(&file));
    candidates.push(manifest.join("binaries").join(&file));

    for path in &candidates {
        if path.exists() {
            return Ok(path.clone());
        }
    }

    Err(AppError::msg(format!(
        "Binary {file} not found. Searched:\n{}",
        candidates
            .iter()
            .map(|p| format!("  - {}", p.display()))
            .collect::<Vec<_>>()
            .join("\n")
    )))
}

async fn run_local_stack_operator(
    command: &str,
    miner_address: Option<&str>,
    miner_options: Option<MinerStartOptions>,
) -> AppResult<String> {
    let workspace = find_workspace_root()?;
    let local = local_root(&workspace);
    let _ = fs::create_dir_all(local.join("logs"));

    let windows = cfg!(windows);
    let script = if windows {
        workspace.join("vireon.ps1")
    } else {
        workspace.join("vireon.sh")
    };
    if !script.exists() {
        return Err(AppError::msg(format!(
            "Operator script missing: {}.",
            script.display()
        )));
    }

    let mut args: Vec<String> = Vec::new();
    if windows {
        args.extend([
            "-NoLogo".into(),
            "-NoProfile".into(),
            "-NonInteractive".into(),
            "-ExecutionPolicy".into(),
            "Bypass".into(),
            "-File".into(),
            script.to_string_lossy().into_owned(),
            command.into(),
        ]);
        if command == "start" || command == "restart" {
            args.push("-SkipExplorer".into());
        }
        if command == "miner-start" {
            // Should not be reached for remote mode; keep for local-only.
            let address = miner_address.ok_or_else(|| {
                AppError::msg("Create or import a wallet before starting the miner")
            })?;
            let options = miner_options.unwrap_or(MinerStartOptions {
                mode: "pool".into(),
                backend: Some("cuda".into()),
                gpu_intensity: Some(75),
                gpu_devices: None,
                pool_url: None,
                worker_name: None,
            });
            args.extend(["-MinerAddress".into(), address.into()]);
            if options.mode == "pool" {
                args.extend([
                    "-PoolUrl".into(),
                    options.pool_url.unwrap_or_default(),
                    "-WorkerName".into(),
                    options.worker_name.unwrap_or_default(),
                ]);
            }
        }
    } else {
        args.push(script.to_string_lossy().into_owned());
        args.push(command.into());
    }

    let mut cmd = if windows {
        let mut c = Command::new("powershell.exe");
        c.args(&args);
        c
    } else {
        let mut c = Command::new("bash");
        c.args(&args);
        c
    };

    let bin_dir = workspace.join("bin");
    let path_value = {
        let current = std::env::var("PATH").unwrap_or_default();
        if bin_dir.exists() {
            let sep = if cfg!(windows) { ";" } else { ":" };
            format!("{}{sep}{current}", bin_dir.display())
        } else {
            current
        }
    };

    let rpc_url = get_rpc_url();
    cmd.current_dir(&workspace)
        .env("VIREON_LOCAL_ROOT", &local)
        .env("VIREON_WORKSPACE_ROOT", &workspace)
        .env("VIREON_RPC_URL", &rpc_url)
        .env("PATH", path_value)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = cmd.output().await.map_err(|err| {
        AppError::msg(format!(
            "Failed to spawn operator ({command}) from {}: {err}",
            script.display()
        ))
    })?;

    let mut text = String::new();
    text.push_str(&String::from_utf8_lossy(&output.stdout));
    if !output.stderr.is_empty() {
        if !text.is_empty() {
            text.push('\n');
        }
        text.push_str(&String::from_utf8_lossy(&output.stderr));
    }
    let text = text.trim().to_string();
    let trimmed = if text.len() > 12_000 {
        format!("[earlier output omitted]\n{}", &text[text.len() - 12_000..])
    } else {
        text
    };
    if output.status.success() {
        Ok(trimmed)
    } else {
        Err(AppError::msg(if trimmed.is_empty() {
            format!(
                "Operator command failed with exit code {:?}",
                output.status.code()
            )
        } else {
            trimmed
        }))
    }
}

pub fn pid_present(service: &str) -> bool {
    runtime_roots()
        .map(|(_, local)| local.join("logs").join(format!("{service}.pid")).exists())
        .unwrap_or(false)
}

pub fn log_bytes(service: &str) -> u64 {
    let Ok((_, local)) = runtime_roots() else {
        return 0;
    };
    let root = local.join("logs");
    let mut total = 0u64;
    for name in [format!("{service}.log"), format!("{service}.err.log")] {
        if let Ok(meta) = fs::metadata(root.join(name)) {
            total = total.saturating_add(meta.len());
        }
    }
    total
}

pub fn metrics_present() -> bool {
    runtime_roots()
        .map(|(_, local)| local.join("miner").join("metrics.json").exists())
        .unwrap_or(false)
}

pub fn node_config_present() -> bool {
    runtime_roots()
        .map(|(_, local)| local.join("node.toml").exists())
        .unwrap_or(false)
}

/// Enumerate NVIDIA CUDA devices via the bundled vireon-miner binary.
pub async fn list_mining_devices() -> AppResult<serde_json::Value> {
    let miner_bin = resolve_binary("vireon-miner")?;

    // Prefer subcommand flag (`devices --json`); fall back to global (`--json devices`)
    // for older sidecars that only accepted the global form.
    let mut last_err = String::new();
    for args in [
        ["devices", "--json"].as_slice(),
        ["--json", "devices"].as_slice(),
    ] {
        let mut cmd = Command::new(&miner_bin);
        cmd.args(args);
        #[cfg(windows)]
        {
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let output = match cmd.output().await {
            Ok(out) => out,
            Err(err) => {
                return Err(AppError::msg(format!(
                    "Failed to list mining devices via {}: {err}",
                    miner_bin.display()
                )));
            }
        };
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if output.status.success() || !stdout.is_empty() {
            if stdout.is_empty() {
                return Ok(serde_json::json!([]));
            }
            // Accept bare array or { "devices": [...] } for forward compatibility.
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&stdout) {
                if value.is_array() {
                    return Ok(value);
                }
                if let Some(arr) = value.get("devices") {
                    return Ok(arr.clone());
                }
            }
            return serde_json::from_str(&stdout).map_err(|err| {
                AppError::msg(format!(
                    "Invalid devices JSON from vireon-miner: {err}\n{stdout}"
                ))
            });
        }
        last_err = if stderr.is_empty() {
            format!(
                "vireon-miner {:?} failed (exit {}). Install a supported NVIDIA driver and use the CUDA-enabled sidecar.",
                args, output.status
            )
        } else {
            stderr
        };
    }

    Err(AppError::msg(last_err))
}

fn urlencoding_lite(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for b in value.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}
