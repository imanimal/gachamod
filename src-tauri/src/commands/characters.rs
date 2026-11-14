//! Owned characters and other managers' mod details. Owner: LIBRARY area.
use crate::state::{blocking, AppState};
use gacha_core::managers::{self, ForeignImport, ForeignInfo, SidecarBack};
use gacha_core::owned::{self, OwnedImport};
use gacha_core::Result;
use std::path::PathBuf;
use tauri::State;

fn lock(db: &gacha_core::db::Shared) -> Result<std::sync::MutexGuard<'_, gacha_core::db::Db>> {
    db.lock().map_err(|_| gacha_core::Error::Db("The local database is stuck after an earlier error. Restart gachamod".into()))
}

#[tauri::command]
pub async fn owned_list(st: State<'_, AppState>, game: String) -> Result<Vec<String>> {
    let db = st.db.clone();
    blocking(move || owned::list(&*lock(&db)?, &game)).await
}

/// Returns the names that changed.
#[tauri::command]
pub async fn owned_set(st: State<'_, AppState>, game: String, names: Vec<String>, owned: bool) -> Result<Vec<String>> {
    let db = st.db.clone();
    blocking(move || owned::set(&*lock(&db)?, &game, &names, owned)).await
}

/// Pasted text or a file's contents read in the webview.
#[tauri::command]
pub async fn owned_import(st: State<'_, AppState>, game: String, text: String) -> Result<OwnedImport> {
    let db = st.db.clone();
    blocking(move || owned::import(&*lock(&db)?, &game, &text)).await
}

#[tauri::command]
pub async fn owned_import_file(st: State<'_, AppState>, game: String, path: String) -> Result<OwnedImport> {
    let db = st.db.clone();
    blocking(move || owned::import_file(&*lock(&db)?, &game, &PathBuf::from(path))).await
}

/// gachamod's own JSON for the owned list (the browser demo saves it as a download).
#[tauri::command]
pub async fn owned_export(st: State<'_, AppState>, game: String) -> Result<String> {
    let db = st.db.clone();
    blocking(move || owned::export(&*lock(&db)?, &game)).await
}

/// Returns how many characters the file lists.
#[tauri::command]
pub async fn owned_export_file(st: State<'_, AppState>, game: String, path: String) -> Result<usize> {
    let db = st.db.clone();
    blocking(move || owned::export_file(&*lock(&db)?, &game, &PathBuf::from(path))).await
}

/// Reads the player's public Enka.Network profile by UID and marks its characters as owned.
#[tauri::command]
pub async fn owned_fetch(st: State<'_, AppState>, game: String, uid: String) -> Result<OwnedImport> {
    let text = owned::fetch_profile(&st.http, &game, &uid).await?;
    let db = st.db.clone();
    blocking(move || owned::import(&*lock(&db)?, &game, &text)).await
}

#[tauri::command]
pub async fn foreign_detect(st: State<'_, AppState>, game: String) -> Result<ForeignInfo> {
    let db = st.db.clone();
    blocking(move || managers::detect(&db, &game)).await
}

#[tauri::command]
pub async fn foreign_import(st: State<'_, AppState>, game: String) -> Result<ForeignImport> {
    let db = st.db.clone();
    blocking(move || managers::import(&db, &game)).await
}

#[tauri::command]
pub async fn foreign_undo(st: State<'_, AppState>, game: String, items: Vec<SidecarBack>) -> Result<()> {
    let db = st.db.clone();
    blocking(move || managers::undo(&db, &game, &items)).await
}
