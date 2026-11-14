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

/// Library ids of the mods that are on in a profile.
#[tauri::command]
pub async fn profile_members(st: State<'_, AppState>, id: i64) -> Result<Vec<String>> {
    let db = st.db.clone();
    blocking(move || profiles::members(&*lock(&db)?, id)).await
}

#[tauri::command]
pub async fn profile_snapshot(st: State<'_, AppState>, id: i64) -> Result<profiles::ProfileSnapshot> {
    let db = st.db.clone();
    blocking(move || profiles::snapshot(&*lock(&db)?, id)).await
}

#[tauri::command]
pub async fn profile_restore(st: State<'_, AppState>, snapshot: profiles::ProfileSnapshot) -> Result<Profile> {
    let db = st.db.clone();
    blocking(move || profiles::restore(&*lock(&db)?, &snapshot)).await
}

/// Put mods in a profile on (or listed but off) without switching to it.
#[tauri::command]
pub async fn profile_set_mods(st: State<'_, AppState>, profile_id: i64, mod_ids: Vec<String>, enabled: bool) -> Result<SwitchReport> {
    let db = st.db.clone();
    blocking(move || profiles::set_mods(&*lock(&db)?, profile_id, &mod_ids, enabled)).await
}
