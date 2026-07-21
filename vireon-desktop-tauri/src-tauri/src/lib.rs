mod commands;
mod error;
mod health;
mod keystore;
mod logs;
mod network;
mod notify;
mod pool;
mod process;
mod rpc;
mod settings;
mod updates;
mod workspace;

use notify::NotifyState;
use tauri::Manager;
use updates::UpdateService;
use workspace::{migrate_legacy_user_data, set_resource_root};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(UpdateService::default())
        .manage(NotifyState::default())
        .setup(|app| {
            if let Ok(resource_dir) = app.path().resource_dir() {
                set_resource_root(resource_dir);
            }
            migrate_legacy_user_data()?;
            health::ensure_runtime_dirs();

            // Auto-update from GitHub Releases — detect and apply without approval.
            // Set VIREON_DISABLE_AUTO_UPDATE=1 to suppress the background loop.
            let disabled = std::env::var("VIREON_DISABLE_AUTO_UPDATE")
                .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
                .unwrap_or(false);
            if !disabled {
                let handle = app.handle().clone();
                let service = app.state::<UpdateService>().inner().clone();
                service.spawn_auto_loop(handle);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::network_snapshot,
            commands::network_add_seed,
            commands::wallet_metadata,
            commands::wallet_list,
            commands::wallet_select,
            commands::wallet_create,
            commands::wallet_import,
            commands::wallet_remove,
            commands::tx_prepare,
            commands::tx_sign_submit,
            commands::operator_run,
            commands::logs_recent,
            commands::logs_export,
            commands::miner_devices,
            commands::explorer_open,
            commands::explorer_lookup,
            commands::pool_snapshot,
            commands::pool_catalog,
            commands::settings_rpc,
            commands::settings_set_rpc_url,
            commands::settings_get,
            commands::settings_update,
            commands::settings_reset,
            commands::settings_defaults,
            commands::settings_paths,
            commands::settings_diagnostics,
            commands::settings_open_path,
            commands::runtime_health,
            commands::updates_state,
            commands::updates_check,
            commands::updates_download,
            commands::updates_install,
            commands::app_workspace,
            commands::app_version,
            commands::app_minimize,
            commands::app_maximize,
            commands::app_close,
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|error| {
            // Avoid an uncaught panic at the process boundary; surface a clear fatal exit.
            eprintln!("Vireon Control Center failed to start: {error}");
            std::process::exit(1);
        });
}
