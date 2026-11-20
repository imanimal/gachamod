//! Tools › Storage: measuring disk space and the cleanups it offers (gacha-core storage.rs). Owner: SYSTEM area.
use crate::state::{blocking, AppState};
use gacha_core::model::ModChange;
use gacha_core::storage::{self, Options, Report};
use gacha_core::{Error, Result};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, State};

fn lock(db: &gacha_core::db::Shared) -> Result<std::sync::MutexGuard<'_, gacha_core::db::Db>> {
    db.lock().map_err(|_| Error::Db("The local database is stuck after an earlier error. Restart gachamod".into()))
}

/// `full` false reads only the library (instant); true walks every folder and compares copies, sending
/// `storage-progress` for each step. `storage_cancel` stops it with what it has.
#[tauri::command]
pub async fn storage_measure(app: AppHandle, st: State<'_, AppState>, full: bool) -> Result<Report> {
    let db = st.db.clone();
    let data = st.data_dir.clone();
    blocking(move || storage::measure(&db, &data, &Options { full, outside: full }, &|s| { let _ = app.emit(storage::PROGRESS_EVENT, s); })).await
}

#[tauri::command]
pub async fn storage_cancel() -> Result<()> {
    storage::cancel();
    Ok(())
}

/// Send copies of a mod to the trash (kept at least 10 minutes, so Undo works with "trash.days" at 0).
#[tauri::command]
pub async fn storage_remove_copies(st: State<'_, AppState>, game: String, ids: Vec<String>) -> Result<ModChange> {
    let db = st.db.clone();
    let data = st.data_dir.clone();
    blocking(move || storage::remove_copies(&*lock(&db)?, &data, &game, &ids)).await
}

/// Move kept archives to the Recycle Bin, leaving the ones a download in the queue still uses.
#[tauri::command]
pub async fn storage_recycle_archives(st: State<'_, AppState>, game: Option<String>) -> Result<u64> {
    let data = st.data_dir.clone();
    let busy: Vec<PathBuf> = {
        let q = st.queue.lock().map_err(|_| Error::Invalid("The download list stopped responding. Restart gachamod".into()))?;
        q.items.iter().filter(|i| !i.state.finished()).flat_map(|i| {
            let (dir, name) = crate::runner::download_target(&data, i);
            [Some(dir.join(name)), i.archive.as_ref().map(PathBuf::from)]
        }).flatten().collect()
    };
    blocking(move || storage::recycle_archives(&data, game.as_deref(), &busy)).await
}

/// Delete something gachamod can make again, or a copy that has no use (gacha-core storage.rs `clear` names the
/// kinds). Unpacked downloads stay while any download is still in the queue. Returns the bytes freed.
#[tauri::command]
pub async fn storage_clear(st: State<'_, AppState>, kind: String, game: Option<String>) -> Result<u64> {
    let db = st.db.clone();
    let data = st.data_dir.clone();
    let busy = if kind == "staging" {
        let q = st.queue.lock().map_err(|_| Error::Invalid("The download list stopped responding. Restart gachamod".into()))?;
        q.items.iter().any(|i| !i.state.finished())
    } else { false };
    blocking(move || storage::clear(&*lock(&db)?, &data, &kind, game.as_deref(), busy)).await
}
