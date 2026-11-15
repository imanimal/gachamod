//! The menu over the game while playing: its settings, and restarting as administrator so its key reaches a game
//! that runs as one (gacha-core live.rs, src-tauri overlay.rs, docs/ingame.md). Owner: INGAME area.
use crate::state::{blocking, AppState};
use gacha_core::live::{self, MenuInfo, MenuSettings};
use gacha_core::Result;
use tauri::State;

fn lock(db: &gacha_core::db::Shared) -> Result<std::sync::MutexGuard<'_, gacha_core::db::Db>> {
    db.lock().map_err(|_| gacha_core::Error::Db("The local database is stuck after an earlier error. Restart gachamod".into()))
}

#[tauri::command]
pub async fn menu_info(st: State<'_, AppState>, game: String) -> Result<MenuInfo> {
    let db = st.db.clone();
    blocking(move || Ok(live::menu_info(&*lock(&db)?, &game))).await
}

/// Mods that are on and use the menu's key themselves, by name (they fire too when it opens the menu).
#[tauri::command]
pub async fn menu_key_users(st: State<'_, AppState>, game: String) -> Result<Vec<String>> {
    let db = st.db.clone();
    blocking(move || {
        let d = lock(&db)?;
        let set = live::menu_settings(&d, &game);
        Ok(if set.style == "off" { Vec::new() } else { gacha_core::keys::mods_on_key(&d, &game, &set.key) })
    }).await
}

/// Turn the menu on or off or change its key, then hold or let go of the key and make or drop its window to match.
#[tauri::command]
pub async fn menu_set(app: tauri::AppHandle, st: State<'_, AppState>, game: String, menu: MenuSettings) -> Result<MenuSettings> {
    let db = st.db.clone();
    blocking(move || {
        let set = live::set_menu(&*lock(&db)?, &game, &menu)?;
        crate::hotkeys::sync(&app);
        crate::overlay::on_game_state(&app);
        Ok(set)
    }).await
}

/// Start gachamod again as administrator, so its keys reach a game that runs as one. Windows asks first, in front of
/// the window that asked. False: the player said no, and gachamod carries on as it was.
#[tauri::command]
pub async fn app_restart_admin(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<bool> {
    let owner = window.hwnd().map_or(0, |h| h.0 as isize);
    let r = blocking(move || gacha_core::devtools::restart_elevated(owner)).await;
    if !matches!(r, Ok(true)) {
        // Windows' prompt took the keyboard and owned the window for a while: make sure the window takes clicks and
        // keys again
        if window.is_enabled().is_ok_and(|on| !on) {
            gacha_core::logs::warn("the window was left disabled after the administrator prompt");
            let _ = window.set_enabled(true);
        }
        let _ = window.set_focus();
        return r;
    }
    crate::commands::app::skip_update_on_quit(&app);
    app.exit(0);
    Ok(true)
}
