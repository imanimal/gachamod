//! Backups of mod files the app changed (gacha_core::backups), for Undo. Owner: skeleton.
use crate::state::{blocking, AppState};
use gacha_core::backups::{self, Backup};
use gacha_core::Result;
use tauri::State;

/// Put a backup's files back. Returns the backup of what was there before (restore that one to redo).
#[tauri::command]
pub async fn backup_restore(st: State<'_, AppState>, id: String) -> Result<Backup> {
    let db = st.db.clone();
    blocking(move || backups::restore(&db.lock().unwrap(), &id)).await
}

#[tauri::command]
pub async fn backup_list(st: State<'_, AppState>, game: Option<String>, mod_id: Option<String>) -> Result<Vec<Backup>> {
    let db = st.db.clone();
    blocking(move || backups::list(&db.lock().unwrap(), game.as_deref(), mod_id.as_deref())).await
}
