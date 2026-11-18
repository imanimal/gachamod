//! Switching skins in game without a reload (gacha-core live.rs, docs/ingame.md). Owner: INGAME area.
use crate::state::{blocking, AppState};
use gacha_core::keylist::{self, KeyList, KeyListSettings, ModKeyList};
use gacha_core::live::{self, LiveChange, LiveInfo, MenuSettings, Picked};
use gacha_core::Result;
use tauri::State;

fn lock(db: &gacha_core::db::Shared) -> Result<std::sync::MutexGuard<'_, gacha_core::db::Db>> {
    db.lock().map_err(|_| gacha_core::Error::Db("The local database is stuck after an earlier error. Restart gachamod".into()))
}

#[tauri::command]
pub async fn live_info(st: State<'_, AppState>, game: String) -> Result<LiveInfo> {
    let db = st.db.clone();
    blocking(move || live::info(&*lock(&db)?, &game)).await
}

#[tauri::command]
pub async fn live_add(app: tauri::AppHandle, st: State<'_, AppState>, game: String, ids: Vec<String>) -> Result<LiveChange> {
    let db = st.db.clone();
    blocking(move || {
        let out = live::add(&*lock(&db)?, &game, &ids)?;
        menu_key(&app);
        Ok(out)
    }).await
}

#[tauri::command]
pub async fn live_remove(app: tauri::AppHandle, st: State<'_, AppState>, game: String, ids: Vec<String>) -> Result<LiveChange> {
    let db = st.db.clone();
    blocking(move || {
        let out = live::remove(&*lock(&db)?, &game, &ids)?;
        menu_key(&app);
        Ok(out)
    }).await
}

/// Make every mod that has a character switch in game (and new ones as they arrive), or stop adding new ones.
#[tauri::command]
pub async fn live_set_all(app: tauri::AppHandle, st: State<'_, AppState>, game: String, on: bool) -> Result<LiveChange> {
    let db = st.db.clone();
    blocking(move || {
        let out = live::set_all(&*lock(&db)?, &game, on)?;
        menu_key(&app);
        Ok(out)
    }).await
}

/// The first live character gives a game its menu and the last one leaving takes it away: hold or let go of the
/// menu key, and make or drop the menu window, to match.
fn menu_key(app: &tauri::AppHandle) {
    crate::hotkeys::sync(app);
    crate::overlay::on_game_state(app);
}

/// Change how the skin menu opens while playing, then hold or let go of its key.
#[tauri::command]
pub async fn live_menu_set(app: tauri::AppHandle, st: State<'_, AppState>, game: String, menu: MenuSettings) -> Result<MenuSettings> {
    let db = st.db.clone();
    blocking(move || {
        let set = live::set_menu(&*lock(&db)?, &game, &menu)?;
        menu_key(&app);
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

/// Every mod of the game that has keys, with the key list's settings (gacha-core keylist.rs).
#[tauri::command]
pub async fn keylist_get(st: State<'_, AppState>, game: String) -> Result<KeyList> {
    let db = st.db.clone();
    blocking(move || keylist::list(&*lock(&db)?, &game)).await
}

/// Change the key list's settings, then hold or let go of its key.
#[tauri::command]
pub async fn keylist_set(app: tauri::AppHandle, st: State<'_, AppState>, game: String, settings: KeyListSettings) -> Result<KeyListSettings> {
    let db = st.db.clone();
    blocking(move || {
        let out = keylist::set(&*lock(&db)?, &game, &settings)?;
        menu_key(&app);
        Ok(out)
    }).await
}

/// Show one mod in the key list, leave it out, or go back to automatic (`listed` null).
#[tauri::command]
pub async fn keylist_choose(app: tauri::AppHandle, st: State<'_, AppState>, game: String, mod_id: String, listed: Option<bool>) -> Result<ModKeyList> {
    let db = st.db.clone();
    blocking(move || {
        let out = keylist::choose(&*lock(&db)?, &game, &mod_id, listed)?;
        menu_key(&app);
        Ok(out)
    }).await
}

/// Several picks at once, each `[mod id, listed]` as in keylist_choose.
#[tauri::command]
pub async fn keylist_choose_many(app: tauri::AppHandle, st: State<'_, AppState>, game: String, picks: Vec<(String, Option<bool>)>) -> Result<()> {
    let db = st.db.clone();
    blocking(move || {
        keylist::choose_many(&*lock(&db)?, &game, &picks)?;
        menu_key(&app);
        Ok(())
    }).await
}

/// Pick what a character shows. While the game runs the pick is sent to it (the database isn't held meanwhile).
#[tauri::command]
pub async fn live_pick(st: State<'_, AppState>, game: String, group: u32, slot: u32) -> Result<Picked> {
    let db = st.db.clone();
    blocking(move || {
        let mut picked = live::pick(&*lock(&db)?, &game, group, slot)?;
        picked.note = live::flush_sends(&db).into_iter().next();
        Ok(picked)
    }).await
}
