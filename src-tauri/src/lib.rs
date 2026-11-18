//! Tauri shell: window setup, links and files handed to the app, and the command list. All file and mod logic lives in
//! `gacha-core`. Commands are grouped by area (docs/spec.md); an area adds its new commands only inside its own block.

mod background;
mod commands;
mod hotkeys;
mod overlay;
mod render;
mod runner;
mod state;

use gacha_core::model::events;
use tauri::{Emitter, Manager};

/// A link or file the app was started with or handed (a second start passes its arguments here), or a page the
/// menu over the game handed over (`Go`, overlay.rs) while the window was closed.
#[derive(Clone, serde::Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Opened {
    Link { url: String },
    File { path: String },
    Go { game: String, route: Option<serde_json::Value>, ai: Option<serde_json::Value> },
}

fn opened_from_args<I: IntoIterator<Item = String>>(args: I) -> Vec<Opened> {
    args.into_iter().skip(1).filter_map(|a| {
        let lower = a.to_ascii_lowercase();
        // a pack opens its importer; an archive (Open with, or a path on the command line) installs into the current game
        if [".gachamod", ".zip", ".7z", ".rar"].iter().any(|x| lower.ends_with(x)) { Some(Opened::File { path: a }) }
        else if lower.contains("://") && !lower.starts_with("http") { Some(Opened::Link { url: a }) }
        else { None }
    }).collect()
}

fn hand_to_ui(app: &tauri::AppHandle, items: Vec<Opened>) {
    for o in items {
        match &o {
            Opened::Link { url } => { let _ = app.emit(events::DEEP_LINK, serde_json::json!({ "url": url })); }
            Opened::File { path } => { let _ = app.emit(events::OPEN_FILE, serde_json::json!({ "path": path })); }
            Opened::Go { game, route, ai } => { let _ = app.emit_to("main", overlay::GO, serde_json::json!({ "game": game, "route": route, "ai": ai })); }
        }
    }
}

/// Keep these for the main window's page, which asks once it starts (`startup_opened`).
fn pending(app: &tauri::AppHandle, items: Vec<Opened>) {
    if let Some(p) = app.try_state::<Pending>() { p.0.lock().unwrap_or_else(|e| e.into_inner()).extend(items); }
}

/// A screen smaller than the first window's size (1366x768 at 125%, a handheld) gets the window maximized, so the
/// bottom of the sidebar (Play) is never under the taskbar or past the screen's edge.
fn fit_to_screen(w: &tauri::WebviewWindow) {
    let (Ok(Some(m)), Ok(size)) = (w.current_monitor(), w.outer_size()) else { return };
    let area = m.work_area().size;
    if size.width > area.width || size.height > area.height { let _ = w.maximize(); }
}

/// Browser flags as this run started with them: hardware acceleration (setting "app.gpu", Settings > Appearance) and
/// WebView2's own log (`--browser-log`). The windows that share the app's WebView2 folder (the main window, the menu
/// over a game) must all start with the same flags, so a change counts from the next start.
#[derive(Clone, Copy)]
pub struct Flags { pub gpu: bool, pub log: bool }

impl Flags {
    pub fn of<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Flags { app.try_state::<Flags>().map_or(Flags { gpu: true, log: false }, |f| *f) }
}

/// Start gachamod with this to turn hardware acceleration off, for a window that draws black and can't reach
/// Settings. A copy already running saves it and starts again.
const NO_GPU_ARG: &str = "--disable-gpu";

/// Start gachamod with this and WebView2 writes its own log, chrome_debug.log, in its folder. WebView2 opens a
/// console window for it, so it is never on otherwise.
const BROWSER_LOG_ARG: &str = "--browser-log";

/// Hardware acceleration is on unless "app.gpu" is "0". `turn_off` saves it off first.
fn gpu_setting(db: &gacha_core::db::Shared, turn_off: bool) -> bool {
    let Ok(d) = db.lock() else { return !turn_off };
    if turn_off {
        let _ = d.set_setting("app.gpu", "0");
        gacha_core::logs::info("Hardware acceleration turned off by --disable-gpu");
    }
    d.setting("app.gpu").ok().flatten().as_deref() != Some("0")
}

/// WebView2 flags for every window. Passing any replaces wry's own, so those are repeated. WebView2 stops drawing a
/// window it thinks other windows cover, and with more than one monitor it can get that wrong and leave the window
/// black until the mouse moves over it, so that check is off. With hardware acceleration off, it also draws without
/// the graphics card. `log` (`--browser-log`) has WebView2 write chrome_debug.log in its folder.
pub fn browser_args(gpu: bool, log: bool) -> String {
    let mut a = String::from("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion");
    if !gpu { a.push_str(" --disable-gpu --disable-gpu-compositing"); }
    if log { a.push_str(" --enable-logging --v=0"); }
    a
}

pub fn browser_flags<'a, R: tauri::Runtime, M: Manager<R>>(b: tauri::WebviewWindowBuilder<'a, R, M>, f: Flags) -> tauri::WebviewWindowBuilder<'a, R, M> {
    b.additional_browser_args(&browser_args(f.gpu, f.log))
}

/// The main window (tauri.conf.json, "create": false), made here so its browser flags can follow the setting.
/// `visible` false: made hidden, for a quickstart that only starts the game, or to show once it's there
/// (background.rs). Closing it goes through `background::close`; it going away ends gachamod unless gachamod moved to
/// the background.
fn main_window(app: &tauri::AppHandle, flags: Flags, visible: bool) -> tauri::Result<tauri::WebviewWindow> {
    let Some(conf) = app.config().app.windows.iter().find(|w| w.label == "main").cloned() else {
        return Err(tauri::Error::WindowNotFound);
    };
    let mut tries = 0;
    loop {
        match browser_flags(tauri::WebviewWindowBuilder::from_config(app, &conf)?, flags).visible(visible).build() {
            Ok(w) => {
                render::watch_window(&w);
                render::hook_webview(&w);
                let handle = app.clone();
                w.on_window_event(move |e| match e {
                    tauri::WindowEvent::CloseRequested { api, .. } => { api.prevent_close(); background::close(&handle, true); }
                    tauri::WindowEvent::Destroyed if !background::away(&handle) => handle.exit(0),
                    _ => {}
                });
                return Ok(w);
            }
            // right after Restart, the closing copy's WebView2 may still run with the other setting for a moment
            Err(e) if tries < 4 && app.get_webview_window("main").is_none() => {
                tries += 1;
                gacha_core::logs::warn(format!("The window didn't open ({e}), trying again"));
                std::thread::sleep(std::time::Duration::from_millis(1000));
            }
            Err(e) => return Err(e),
        }
    }
}

/// The main window made again after gachamod ran in the background, hidden (background.rs shows it).
fn open_main(app: &tauri::AppHandle) -> tauri::Result<tauri::WebviewWindow> { main_window(app, Flags::of(app), false) }

/// What the app was started with, for the UI to pick up once it is listening.
#[tauri::command]
fn startup_opened(app: tauri::AppHandle, st: tauri::State<'_, Pending>) -> Vec<Opened> {
    background::page_ready(&app);
    std::mem::take(&mut *st.0.lock().unwrap_or_else(|e| e.into_inner()))
}

#[derive(Default)]
struct Pending(std::sync::Mutex<Vec<Opened>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();
    // started again as administrator: wait for the copy that asked to be gone
    gacha_core::devtools::after_restart(&std::env::args().collect::<Vec<_>>());
    // a start that isn't an administrator's while an administrator's copy runs: hand that copy the link or file and
    // quit (Windows hides it from the single-instance check)
    if gacha_core::devtools::hand_to_elevated_copy(&context.config().identifier) { return; }
    tauri::Builder::default()
        // a second start (a gachamod:// link, a double-clicked .gachamod) hands its arguments here and exits
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // SYSTEM: gachamod.exe --disable-gpu while it runs: saved, and gachamod starts again without it
            if argv.iter().any(|a| a == NO_GPU_ARG) && app.try_state::<Flags>().is_some_and(|f| f.gpu) {
                if let Some(st) = app.try_state::<state::AppState>() { gpu_setting(&st.db, true); }
                gacha_core::logs::quitting();
                app.restart();
            }
            // SYSTEM: an update's new version starting in the background while this copy still runs: nothing to do
            if argv.iter().any(|a| a == background::BACKGROUND_ARG) { return; }
            background::second_start(app, opened_from_args(argv));
        }))
        .plugin(tauri_plugin_dialog::init())
        // SYSTEM: gachamod's own updates (commands/app.rs)
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(commands::app::Updates::default())
        .plugin(hotkeys::plugin())
        .manage(hotkeys::Held::default())
        .manage(overlay::Showing::default())
        .manage(Pending::default())
        .manage(background::Background::default())
        // EXTENSIONS: extension pages and their files (http://gmext.localhost/<id>/<file> on Windows)
        .register_asynchronous_uri_scheme_protocol("gmext", |ctx, req, responder| {
            let app = ctx.app_handle().clone();
            std::thread::spawn(move || responder.respond(commands::extensions::serve(&app, &req)));
        })
        .setup(|app| {
            // GACHAMOD_DATA moves the app's own data (database, trash, downloads) elsewhere: a portable copy or a test run.
            let data_dir = match std::env::var_os("GACHAMOD_DATA") {
                Some(d) if !d.is_empty() => std::path::PathBuf::from(d),
                _ => app.path().app_data_dir()?,
            };
            // SYSTEM: gachamod's own log, and a crash file for every panic
            let logs_dir = gacha_core::logs::init(&data_dir);
            gacha_core::logs::catch_panics(env!("CARGO_PKG_VERSION"));
            gacha_core::logs::started(env!("CARGO_PKG_VERSION"));
            // SYSTEM: Reset gachamod left a note: start over before anything opens the database
            match gacha_core::reset::finish(&data_dir) {
                Ok(Some(old)) => gacha_core::logs::info(format!("Started over. The old data is in {}", old.display())),
                Ok(None) => {}
                Err(e) => gacha_core::logs::error(format!("Couldn't start over: {e}")),
            }
            gacha_core::devtools::accept_hand_offs(&app.config().identifier);
            let state = state::AppState::new(data_dir)?;
            // SYSTEM: the window opens once hardware acceleration is known, before anything else can open one
            let gpu = gpu_setting(&state.db, std::env::args().any(|a| a == NO_GPU_ARG));
            // SYSTEM: the rendering log (render.rs) watches the windows from the moment they open
            gacha_core::render_log::init(&logs_dir, render::setting(&state.db));
            let log = std::env::args().any(|a| a == BROWSER_LOG_ARG);
            // SYSTEM: a quickstart start keeps the window hidden while it starts the game, and --background (an
            // update installed in the background) starts with no window at all (background.rs)
            let opened = opened_from_args(std::env::args());
            let away = std::env::args().any(|a| a == background::BACKGROUND_ARG);
            let hidden = !away && background::quiet_start(&state.db, &opened);
            app.manage(state);
            // the console (src/dev/console) shows the log as it's written
            let logs_to = app.handle().clone();
            gacha_core::logs::set_sink(move |level, text| { let _ = logs_to.emit(events::APP_LOG, serde_json::json!({ "level": level.name(), "text": text })); });
            app.manage(Flags { gpu, log });
            if away {
                background::started_away(app.handle());
            } else {
                background::starting(app.handle());
                let main = main_window(app.handle(), Flags { gpu, log }, !hidden)?;
                // a hidden window gets its size when it's first shown (background::show)
                if hidden { background::started_hidden(app.handle()); } else { fit_to_screen(&main); }
            }
            let sys = app.handle().clone();
            std::thread::spawn(move || render::write_system(&sys, gpu, log));
            render::start(app.handle().clone());
            *app.state::<Pending>().0.lock().unwrap() = opened;
            runner::start(app.handle().clone());
            // BACKEND: trash older than "trash.days" leaves its files and keeps its details in the archive
            if let Ok(db) = app.state::<state::AppState>().db.lock() { let _ = gacha_core::library::purge_expired(&db); }
            // LIBRARY: each game's Mods folder is watched, so mods added, renamed or removed outside gachamod show up
            // at once (gacha_core::watch runs the same scan as Rescan and says when the list changed)
            let watched = app.handle().clone();
            gacha_core::watch::start(app.state::<state::AppState>().db.clone(), move |g| {
                let _ = watched.emit(events::LIBRARY_CHANGED, serde_json::json!({ "game": g }));
            });
            // INGAME: live.ini says who holds the menu key for this run (its pictures may be drawn again: off the
            // main thread)
            let live_db = app.state::<state::AppState>().db.clone();
            std::thread::spawn(move || { if let Ok(d) = live_db.lock() { gacha_core::live::on_start(&d); } });
            // SYSTEM: game start/stop events and automatic F10 reloads; links and .gachamod files nobody else holds
            let handle = app.handle().clone();
            let notes = app.handle().clone();
            let follow = app.handle().clone();
            gacha_core::devtools::watch(app.state::<state::AppState>().db.clone(), move |g, r| {
                let _ = handle.emit(events::GAME_STATE, serde_json::json!({ "game": g, "running": r }));
                // INGAME: a game that runs as administrator decides who holds the menu key
                if r { if let Ok(d) = handle.state::<state::AppState>().db.lock() { gacha_core::live::note_elevation(&d, g); } }
                // SETTINGS/AI: play time for the year card, counted here so it adds up with no window
                if let Ok(d) = handle.state::<state::AppState>().db.lock() { gacha_core::playtime::note(&d, g, r); }
                hotkeys::on_game_state(&handle, r);
                overlay::on_game_state(&handle);
                background::on_game_state(&handle, r);
            }, move |_, text| { let _ = notes.emit(events::TOAST, serde_json::json!({ "text": text, "bad": false })); }, move |g| {
                // INGAME: the game saved its values: picks made in its own menu show in the app's windows too
                let (moved, here) = follow.state::<state::AppState>().db.lock()
                    .map(|d| (gacha_core::live::follow_game(&d, g), gacha_core::live::on_screen_moved(&d, g))).unwrap_or((false, false));
                if moved { let _ = follow.emit(events::LIBRARY_CHANGED, serde_json::json!({ "game": g })); }
                // the menu over the game follows who is on screen while the player hasn't moved in it yet
                if here { overlay::on_screen_changed(&follow, g); }
            });
            // INGAME: both sticks pressed in opens the skin menu. The menu window is made again whenever its key is
            // pressed, so the main window going away ends the app (main_window) unless it went to the background
            overlay::watch_pad(app.handle().clone());
            commands::app::start_auto_update(app.handle().clone());
            // SYSTEM: usage counts and crash reports go out every few minutes and at quit, when they're on
            let (http, tdb) = { let s = app.state::<state::AppState>(); (s.http.clone(), s.db.clone()) };
            if let Ok(d) = tdb.lock() { gacha_core::telemetry::note_start(&d); }
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                loop {
                    gacha_core::telemetry::flush(&http, &tdb).await;
                    tokio::time::sleep(std::time::Duration::from_secs(300)).await;
                }
            });
            let off = app.state::<state::AppState>().db.lock().map(|db| gacha_core::platform::turned_off(&db)).unwrap_or_default();
            if let Ok(exe) = std::env::current_exe() { let _ = gacha_core::platform::register_free(&exe, &off); }
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
            commands::backups::backup_restore,
            commands::backups::backup_list,
            // ── LIBRARY ──
            commands::library::library_scan,
            commands::library::library_list,
            commands::library::mod_get,
            commands::library::mod_parts,
            commands::library::mod_set_part,
            commands::library::mods_merge,
            commands::library::mods_set_enabled,
            commands::library::mods_overlapping,
            commands::library::mod_update_meta,
            commands::library::mod_move,
            commands::library::mods_remove,
            commands::library::trash_list,
            commands::library::trash_restore,
            commands::library::trash_purge,
            commands::library::characters_list,
            commands::library::characters_sync,
            commands::characters::owned_list,
            commands::characters::owned_set,
            commands::characters::owned_import,
            commands::characters::owned_import_file,
            commands::characters::owned_export,
            commands::characters::owned_export_file,
            commands::characters::owned_fetch,
            commands::characters::foreign_detect,
            commands::characters::foreign_import,
            commands::characters::foreign_undo,
            commands::library::mods_mark_updates,
            commands::library::mod_set_preview,
            commands::library::mod_set_preview_data,
            commands::library::mod_custom_preview,
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
            commands::modtools::conflict_ignore,
            commands::modtools::conflict_drop,
            commands::modtools::lint_scan,
            commands::modtools::lint_fix,
            commands::modtools::merged_split,
            commands::account::gb_account,
            commands::account::gb_sign_in,
            commands::account::gb_sign_out,
            commands::account::gb_follow,
            commands::account::gb_like,
            commands::account::gb_subscribe,
            commands::account::gb_thank,
            commands::account::gb_mod_me,
            commands::account::gb_following,
            commands::account::gb_content_settings,
            commands::modtools::fixes_info,
            commands::modtools::fixes_health,
            commands::modtools::fixes_apply,
            commands::modtools::fixers_list,
            commands::modtools::fixers_download,
            commands::modtools::fixers_github,
            commands::modtools::fixers_run,
            commands::modtools::fixers_run_all,
            commands::modtools::fixers_stop_waiting,
            commands::modtools::mod_mesh,
            commands::ingame::live_info,
            commands::ingame::live_add,
            commands::ingame::live_remove,
            commands::ingame::live_pick,
            commands::ingame::live_menu_set,
            commands::ingame::live_set_all,
            commands::ingame::keylist_get,
            commands::ingame::keylist_set,
            commands::ingame::keylist_choose,
            commands::ingame::keylist_choose_many,
            commands::ingame::app_restart_admin,
            commands::otherkeys::otherkeys_clashes,
            commands::otherkeys::otherkeys_ask,
            commands::otherkeys::otherkeys_move,
            commands::otherkeys::otherkeys_change,
            commands::otherkeys::otherkeys_keep,
            // ── SYSTEM: logs, crash reports, usage counts, feedback, administrator ──
            commands::report::report_state,
            commands::report::report_set,
            commands::report::telemetry_events,
            commands::report::feedback_send,
            commands::report::log_write,
            commands::report::log_tail,
            commands::report::report_ui_error,
            render::render_events,
            render::render_state,
            commands::report::admin_state,
            commands::report::admin_set_always,
            commands::report::shortcuts_state,
            commands::report::shortcuts_create,
            commands::report::shortcuts_remove,
            commands::report::shortcuts_create_game,
            commands::report::shortcuts_remove_game,
            commands::report::shortcuts_follow,
            commands::report::game_check_setup,
            commands::report::game_check_saved,
            commands::report::game_check_menu,
            commands::report::game_check_send,
            overlay::overlay_game,
            overlay::overlay_hide,
            overlay::overlay_pick,
            overlay::overlay_open_app,
            commands::modtools::hash_lookup,
            commands::modtools::pack_plan,
            commands::modtools::pack_export,
            commands::modtools::pack_inspect,
            commands::modtools::pack_import,
            commands::modtools::imm_detect,
            commands::modtools::imm_takeover,
            commands::modtools::nrmm_detect,
            commands::modtools::nrmm_takeover,
            commands::migrate::migrate_detect,
            commands::migrate::migrate_import,
            commands::migrate::migrate_undo,
            commands::modtools::keys_list,
            commands::modtools::keys_rebind,
            commands::modtools::keys_set_off,
            commands::modtools::keys_put_back,
            commands::modtools::keys_on_screen,
            commands::modtools::keys_on_screen_all,
            commands::modtools::keys_on_screen_mods,
            commands::modtools::keys_clashes,
            commands::modtools::keys_outline,
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
            commands::system::xxmi_install,
            commands::system::xxmi_uninstall,
            commands::system::app_reset,
            commands::system::app_relaunch,
            commands::system::setup_game,
            commands::system::launch_config_get,
            commands::system::launch_config_set,
            commands::system::launch_unsafe_off,
            commands::system::game_launch,
            commands::system::game_kick_check,
            commands::system::game_kick_fix_done,
            commands::system::game_running,
            commands::system::dev_status,
            commands::system::dev_log_tail,
            commands::system::dev_clear_shader_cache,
            commands::system::dev_clear_frame_dumps,
            commands::system::dev_reload,
            commands::system::dev_wipe_user_config,
            commands::system::dev_unwipe_user_config,
            commands::storage::storage_measure,
            commands::storage::storage_cancel,
            commands::storage::storage_remove_copies,
            commands::storage::storage_recycle_archives,
            commands::system::integrations_get,
            commands::system::integration_set,
            commands::system::app_data_dir,
            commands::system::save_look,
            commands::system::setup_available,
            commands::system::setup_open,
            background::app_show,
            background::app_close,
            background::app_close_asked,
            // ── BACKEND ──
            commands::library::mod_fetch_preview,
            commands::library::archive_list,
            commands::library::archive_forget,
            commands::profiles::profile_members,
            commands::profiles::profile_snapshot,
            commands::profiles::profile_restore,
            commands::profiles::profile_set_mods,
            commands::system::game_icon,
            commands::app::settings_export,
            commands::app::settings_import_preview,
            commands::app::settings_import,
            commands::app::settings_import_undo,
            commands::app::app_update_check,
            commands::app::app_update_status,
            commands::app::app_update_install,
            // ── SETTINGS/AI ──
            commands::ai::ai_chatbots_installed,
            // ── EXTENSIONS ──
            commands::extensions::extensions_list,
            commands::extensions::extensions_repos,
            commands::extensions::extensions_install,
            commands::extensions::extensions_install_file,
            commands::extensions::extensions_link_folder,
            commands::extensions::extensions_remove,
            commands::extensions::extensions_restore,
            commands::extensions::extensions_set_enabled,
            commands::extensions::extensions_themes,
            commands::extensions::extensions_needs,
            commands::extensions::extensions_open_app,
            commands::extensions::extensions_fetch,
            commands::extensions::extensions_read_file,
            commands::extensions::extensions_list_dir,
            commands::extensions::extensions_storage_get,
            commands::extensions::extensions_storage_set,
            commands::extensions::extensions_pack_folder,
            commands::extensions::extensions_pack_theme,
        ])
        .build(context)
        .expect("error while running gachamod")
        .run(|app, e| {
            // the last window closed while gachamod runs in the background: keep running (app.exit still quits)
            if let tauri::RunEvent::ExitRequested { code: None, api, .. } = &e {
                if background::away(app) { api.prevent_exit(); }
            }
            if let tauri::RunEvent::Exit = e {
                gacha_core::logs::quitting();
                // what's left to send goes now, for a few seconds at most
                if let Some(s) = app.try_state::<state::AppState>() {
                    let (http, db) = (s.http.clone(), s.db.clone());
                    tauri::async_runtime::block_on(async move {
                        let _ = tokio::time::timeout(std::time::Duration::from_secs(3), gacha_core::telemetry::flush(&http, &db)).await;
                    });
                }
                // last: a downloaded update installs now (this ends the process)
                commands::app::install_on_quit(app);
            }
        });
}

#[cfg(test)]
mod tests {
    use super::browser_args;

    #[test]
    fn webview2_logs_only_when_asked() {
        assert!(!browser_args(true, false).contains("--enable-logging"));
        assert!(!browser_args(false, false).contains("--enable-logging"));
        assert!(browser_args(true, true).contains("--enable-logging"));
        assert!(browser_args(false, false).contains("--disable-gpu"));
        assert!(!browser_args(true, false).contains("--disable-gpu"));
    }
}
