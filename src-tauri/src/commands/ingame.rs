//! Switching skins in game without a reload (gacha-core live.rs, docs/ingame.md). Owner: INGAME area.
use crate::state::{blocking, AppState};
use gacha_core::live::{self, LiveChange, LiveInfo, Picked};
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
pub async fn live_add(st: State<'_, AppState>, game: String, ids: Vec<String>) -> Result<LiveChange> {
    let db = st.db.clone();
    blocking(move || live::add(&*lock(&db)?, &game, &ids)).await
}

#[tauri::command]
pub async fn live_remove(st: State<'_, AppState>, game: String, ids: Vec<String>) -> Result<LiveChange> {
    let db = st.db.clone();
    blocking(move || live::remove(&*lock(&db)?, &game, &ids)).await
}

/// Pick what a character shows. While the game runs the pick is sent to it (the database isn't held meanwhile).
#[tauri::command]
pub async fn live_pick(st: State<'_, AppState>, game: String, group: u32, slot: u32) -> Result<Picked> {
    let db = st.db.clone();
    blocking(move || {
        let picked = live::pick(&*lock(&db)?, &game, group, slot)?;
        if picked.send { live::send(&game, group, slot)?; }
        Ok(picked)
    }).await
}
