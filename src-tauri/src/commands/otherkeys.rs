//! Keys of other apps that are also gachamod's (gacha-core otherkeys.rs, docs/other-app-keys.md). The other apps'
//! settings are only read, except Medal's key when the player asks for that. Owner: INGAME area.
use crate::state::{blocking, AppState};
use gacha_core::otherkeys::{self, Changed, Clash, Moved};
use gacha_core::Result;
use tauri::State;

fn lock(db: &gacha_core::db::Shared) -> Result<std::sync::MutexGuard<'_, gacha_core::db::Db>> {
    db.lock().map_err(|_| gacha_core::Error::Db("The local database is stuck after an earlier error. Restart gachamod".into()))
}

/// Every key of a known app on this PC that is also one of gachamod's, with a free key to move to.
#[tauri::command]
pub async fn otherkeys_clashes(st: State<'_, AppState>) -> Result<Vec<Clash>> {
    let db = st.db.clone();
    blocking(move || {
        // the other apps' files are read before the database is taken
        let others = otherkeys::found();
        Ok(otherkeys::clashes_with(&*lock(&db)?, &others))
    }).await
}

/// The clashes to ask about in a toast now (at start and when a game starts): each three times in all.
#[tauri::command]
pub async fn otherkeys_ask(st: State<'_, AppState>) -> Result<Vec<Clash>> {
    let db = st.db.clone();
    blocking(move || {
        let others = otherkeys::found();
        Ok(otherkeys::to_ask_with(&*lock(&db)?, &others))
    }).await
}

/// Move gachamod's key from one to another in every game that uses it, then hold the new one.
#[tauri::command]
pub async fn otherkeys_move(app: tauri::AppHandle, st: State<'_, AppState>, from: String, to: String) -> Result<Moved> {
    let db = st.db.clone();
    blocking(move || {
        let out = otherkeys::move_key(&*lock(&db)?, &from, &to)?;
        crate::hotkeys::sync(&app);
        crate::overlay::on_game_state(&app);
        Ok(out)
    }).await
}

/// Give the other app another key, so gachamod keeps its own: Medal only, while it is closed, after a copy of its
/// settings. `undo` puts the old key back. gachamod's own keys don't change, so nothing is registered again.
#[tauri::command]
pub async fn otherkeys_change(st: State<'_, AppState>, app_id: String, from: String, to: String, undo: bool) -> Result<Changed> {
    let db = st.db.clone();
    blocking(move || {
        let others = otherkeys::found();
        otherkeys::change_other_with(&*lock(&db)?, &others, &app_id, &from, &to, undo)
    }).await
}

/// Keep gachamod's key although the app uses it too (`on` false takes that back).
#[tauri::command]
pub async fn otherkeys_keep(st: State<'_, AppState>, app_id: String, key: String, on: bool) -> Result<()> {
    let db = st.db.clone();
    blocking(move || otherkeys::keep(&*lock(&db)?, &app_id, &key, on)).await
}
