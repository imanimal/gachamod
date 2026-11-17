//! Moving from other mod managers (gacha-core migrate.rs). Owner: MODTOOLS area.
use crate::state::{blocking, AppState};
use gacha_core::migrate::{self, MigrateOptions, MigrateResult, MigrateUndo, OtherManager};
use gacha_core::Result;
use tauri::State;

/// Other managers that left mods, presets or details for the game. `picked`: a folder or file the user chose
/// (SkinSelectImpact's folder, Fairy's Secret Folder's backup).
#[tauri::command]
pub async fn migrate_detect(st: State<'_, AppState>, game: String, picked: Option<String>) -> Result<Vec<OtherManager>> {
    let db = st.db.clone();
    blocking(move || migrate::detect(&db, &game, picked.as_deref())).await
}

#[tauri::command]
pub async fn migrate_import(st: State<'_, AppState>, game: String, manager: String, options: MigrateOptions) -> Result<MigrateResult> {
    let db = st.db.clone();
    blocking(move || migrate::import(&db, &game, &manager, &options)).await
}

#[tauri::command]
pub async fn migrate_undo(st: State<'_, AppState>, undo: MigrateUndo) -> Result<Vec<String>> {
    let (db, data) = (st.db.clone(), st.data_dir.clone());
    blocking(move || migrate::undo(&db, &data, &undo)).await
}
