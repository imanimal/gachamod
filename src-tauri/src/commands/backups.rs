//! Backups of mod files the app changed (gacha_core::backups), for Undo, and the list of everything in the backups
//! folder for Settings › Storage. Owner: skeleton.
use crate::state::{blocking, AppState};
use gacha_core::backups::{self, Backup, Entry};
use gacha_core::Result;
use tauri::State;

/// Put a backup's files back. Returns the backup of what was there before (restore that one to redo).
#[tauri::command]
pub async fn backup_restore(st: State<'_, AppState>, id: String) -> Result<Backup> {
    let db = st.db.clone();
    blocking(move || {
        let db = db.lock().unwrap();
        let before = backups::restore(&db, &id)?;
        // an undone rebind: the key list the game draws shows the keys again as they are now
        if before.files.iter().any(|f| f.to_ascii_lowercase().ends_with(".ini")) { gacha_core::keylist::keys_changed(&db, &before.game); }
        Ok(before)
    }).await
}

#[tauri::command]
pub async fn backup_list(st: State<'_, AppState>, game: Option<String>, mod_id: Option<String>) -> Result<Vec<Backup>> {
    let db = st.db.clone();
    blocking(move || backups::list(&db.lock().unwrap(), game.as_deref(), mod_id.as_deref())).await
}

/// Everything in the backups folder, newest first: mod files from before a change, the database's daily copies,
/// settings from before an import and old data from a reset.
#[tauri::command]
pub async fn backup_entries(st: State<'_, AppState>) -> Result<Vec<Entry>> {
    let db = st.db.clone();
    blocking(move || Ok(backups::entries(&db.lock().unwrap()))).await
}

/// Move backups to the Recycle Bin. Returns the bytes moved.
#[tauri::command]
pub async fn backup_recycle(st: State<'_, AppState>, ids: Vec<String>) -> Result<u64> {
    let db = st.db.clone();
    blocking(move || backups::recycle(&db.lock().unwrap(), &ids)).await
}
