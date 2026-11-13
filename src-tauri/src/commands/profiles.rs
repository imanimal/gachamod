//! Profile commands. Owner: LIBRARY area.
use crate::state::{blocking, AppState};
use gacha_core::model::{Profile, ProfilePatch};
use gacha_core::profiles::{self, SwitchReport};
use gacha_core::Result;
use tauri::State;

/// The database, or a plain error when an earlier failure left it locked.
fn lock(db: &gacha_core::db::Shared) -> Result<std::sync::MutexGuard<'_, gacha_core::db::Db>> {
    db.lock().map_err(|_| gacha_core::Error::Db("The local database is stuck after an earlier error. Restart gachamod".into()))
}

#[tauri::command]
pub async fn profiles_list(st: State<'_, AppState>, game: String) -> Result<Vec<Profile>> {
    let db = st.db.clone();
    blocking(move || profiles::list(&*lock(&db)?, &game)).await
}

#[tauri::command]
pub async fn profile_create(st: State<'_, AppState>, game: String, name: String, copy_from: Option<i64>) -> Result<Profile> {
    let db = st.db.clone();
    blocking(move || profiles::create(&*lock(&db)?, &game, &name, copy_from)).await
}

#[tauri::command]
pub async fn profile_update(st: State<'_, AppState>, id: i64, patch: ProfilePatch) -> Result<Profile> {
    let db = st.db.clone();
    blocking(move || profiles::update(&*lock(&db)?, id, &patch)).await
}

#[tauri::command]
pub async fn profile_delete(st: State<'_, AppState>, id: i64) -> Result<()> {
    let db = st.db.clone();
    blocking(move || profiles::delete(&*lock(&db)?, id)).await
}

#[tauri::command]
pub async fn profile_activate(st: State<'_, AppState>, id: i64) -> Result<SwitchReport> {
    let db = st.db.clone();
    blocking(move || profiles::activate(&*lock(&db)?, id)).await
}

#[tauri::command]
pub async fn profile_capture(st: State<'_, AppState>, id: i64) -> Result<Profile> {
    let db = st.db.clone();
    blocking(move || profiles::capture(&*lock(&db)?, id)).await
}
