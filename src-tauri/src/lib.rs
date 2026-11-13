//! Tauri shell: window setup, links and files handed to the app, and the command list. All file and mod logic lives in
//! `gacha-core`. Commands are grouped by area (docs/spec.md); an area adds its new commands only inside its own block.

mod commands;
mod hotkeys;
mod runner;
mod state;

use gacha_core::model::events;
use tauri::{Emitter, Manager};

/// A link or file the app was started with or handed (a second start passes its arguments here).
#[derive(Clone, serde::Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Opened {
    Link { url: String },
    File { path: String },
}

fn opened_from_args<I: IntoIterator<Item = String>>(args: I) -> Vec<Opened> {
    args.into_iter().skip(1).filter_map(|a| {
        let lower = a.to_ascii_lowercase();
        if lower.ends_with(".gachamod") { Some(Opened::File { path: a }) }
        else if lower.contains("://") && !lower.starts_with("http") { Some(Opened::Link { url: a }) }
        else { None }
    }).collect()
}

fn hand_to_ui(app: &tauri::AppHandle, items: Vec<Opened>) {
    for o in items {
        match &o {
            Opened::Link { url } => { let _ = app.emit(events::DEEP_LINK, serde_json::json!({ "url": url })); }
            Opened::File { path } => { let _ = app.emit(events::OPEN_FILE, serde_json::json!({ "path": path })); }
        }
    }
}

/// What the app was started with, for the UI to pick up once it is listening.
#[tauri::command]
fn startup_opened(st: tauri::State<'_, Pending>) -> Vec<Opened> { std::mem::take(&mut *st.0.lock().unwrap()) }

#[derive(Default)]
struct Pending(std::sync::Mutex<Vec<Opened>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // a second start (a gachamod:// link, a double-clicked .gachamod) hands its arguments here and exits
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") { let _ = w.unminimize(); let _ = w.show(); let _ = w.set_focus(); }
            hand_to_ui(app, opened_from_args(argv));
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(hotkeys::plugin())
        .manage(hotkeys::Held::default())
        .manage(Pending::default())
        .setup(|app| {
            // GACHAMOD_DATA moves the app's own data (database, trash, downloads) elsewhere: a portable copy or a test run.
            let data_dir = match std::env::var_os("GACHAMOD_DATA") {
                Some(d) if !d.is_empty() => std::path::PathBuf::from(d),
                _ => app.path().app_data_dir()?,
            };
            let state = state::AppState::new(data_dir)?;
            app.manage(state);
            *app.state::<Pending>().0.lock().unwrap() = opened_from_args(std::env::args());
            runner::start(app.handle().clone());
            // SYSTEM: game start/stop events and automatic F10 reloads; links and .gachamod files nobody else holds
            let handle = app.handle().clone();
            gacha_core::devtools::watch(app.state::<state::AppState>().db.clone(), move |g, r| {
                let _ = handle.emit(events::GAME_STATE, serde_json::json!({ "game": g, "running": r }));
                hotkeys::on_game_state(&handle, r);
            });
            commands::app::start_daily_check(app.handle().clone());
            #[cfg(not(debug_assertions))]
            if let Ok(exe) = std::env::current_exe() { let _ = gacha_core::platform::register_free(&exe); }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // ── skeleton ──
            startup_opened,
            commands::common::app_info,
            commands::common::settings_get,
            commands::common::settings_set,
            commands::common::open_path,
            commands::common::reveal_path,
            commands::common::open_url,
            // ── LIBRARY ──
            commands::library::library_scan,
            commands::library::library_list,
            commands::library::mod_get,
            commands::library::mods_set_enabled,
            commands::library::mod_update_meta,
            commands::library::mod_move,
            commands::library::mods_remove,
            commands::library::trash_list,
            commands::library::trash_restore,
            commands::library::trash_purge,
            commands::library::characters_list,
            commands::library::characters_sync,
            commands::library::mods_mark_updates,
            commands::library::mod_set_preview,
            commands::library::mod_set_preview_data,
            commands::library::mod_clear_preview,
            commands::profiles::profiles_list,
            commands::profiles::profile_create,
            commands::profiles::profile_update,
            commands::profiles::profile_delete,
            commands::profiles::profile_activate,
            commands::profiles::profile_capture,
            hotkeys::hotkeys_sync,
            // ── MODTOOLS ──
            commands::modtools::mod_inspect,
            commands::modtools::mod_set_var,
            commands::modtools::conflicts_scan,
            commands::modtools::lint_scan,
            commands::modtools::hash_lookup,
            commands::modtools::pack_export,
            commands::modtools::pack_inspect,
            commands::modtools::pack_import,
            commands::modtools::imm_detect,
            commands::modtools::imm_takeover,
            // ── ONLINE ──
            commands::online::queue_get,
            commands::online::queue_add,
            commands::online::queue_cancel,
            commands::online::queue_retry,
            commands::online::queue_remove,
            commands::online::queue_clear_finished,
            commands::online::queue_choose,
            commands::online::install_local,
            // ── SYSTEM ──
            commands::system::games_list,
            commands::system::games_detect,
            commands::system::game_set_paths,
            commands::system::game_set_shown,
            commands::system::xxmi_status,
            commands::system::xxmi_open,
            commands::system::launch_config_get,
            commands::system::launch_config_set,
            commands::system::game_launch,
            commands::system::game_running,
            commands::system::dev_status,
            commands::system::dev_log_tail,
            commands::system::dev_clear_shader_cache,
            commands::system::dev_clear_frame_dumps,
            commands::system::dev_reload,
            commands::system::dev_wipe_user_config,
            commands::system::integrations_get,
            commands::system::integration_register,
            commands::system::app_data_dir,
            commands::app::settings_export,
            commands::app::settings_import_preview,
            commands::app::settings_import,
            commands::app::settings_import_undo,
            commands::app::app_update_check,
            commands::app::app_update_install,
        ])
        .run(tauri::generate_context!())
        .expect("error while running gachamod");
}
