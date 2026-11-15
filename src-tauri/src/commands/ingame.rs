//! Switching skins in game without a reload (gacha-core live.rs, docs/ingame.md). Owner: INGAME area.
use crate::state::{blocking, AppState};
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

/// Start gachamod again as administrator, so its keys reach a game that runs as one. Windows asks first.
#[tauri::command]
pub async fn app_restart_admin(app: tauri::AppHandle) -> Result<()> {
    blocking(gacha_core::devtools::restart_elevated).await?;
    crate::commands::app::skip_update_on_quit(&app);
    app.exit(0);
    Ok(())
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
