//! Download queue and local install commands. Owner: ONLINE area. The runner is in ../runner.rs.
//! Each command changes the queue, saves the item, wakes the runner and returns (and emits) the new snapshot.
use crate::runner::{discard_files, discard_unpacked, emit_snapshot, keep_archives, lk, persist, remove_staging_later, shares_file};
use crate::state::AppState;
use gacha_core::install::{InstallMeta, InstallOutcome};
use gacha_core::queue::{self, ItemState, QueueItem, QueueRequest, QueueSnapshot};
use gacha_core::{Error, Result};
use tauri::State;

fn done(app: &tauri::AppHandle, st: &AppState) -> QueueSnapshot {
    st.pump.notify_one();
    emit_snapshot(app);
    lk(&st.queue).snapshot()
}

#[tauri::command]
pub fn queue_get(st: State<'_, AppState>) -> QueueSnapshot { lk(&st.queue).snapshot() }

#[tauri::command]
pub async fn queue_add(app: tauri::AppHandle, st: State<'_, AppState>, req: QueueRequest) -> Result<QueueSnapshot> {
    if gacha_core::games::def(&req.game).is_none() { return Err(Error::Invalid("Pick a game first".into())); }
    if req.file_id == 0 && req.url.trim().is_empty() && req.local_path.is_none() {
        return Err(Error::Invalid("That file has no download link".into()));
    }
    let item = lk(&st.queue).add(req);
    persist(&st.db, &item);
    Ok(done(&app, &st))
}

#[tauri::command]
pub async fn queue_cancel(app: tauri::AppHandle, st: State<'_, AppState>, id: u64) -> Result<QueueSnapshot> {
    let keep = keep_archives(&st.db);
    let (item, staging) = {
        let mut q = lk(&st.queue);
        let item = q.require(id)?;
        match item.state {
            ItemState::Installing => return Err(Error::Invalid("It's being installed right now and will be done in a moment".into())),
            ItemState::Downloading { .. } => { lk(&st.cancel).insert(id); }
            ItemState::Waiting | ItemState::NeedsChoice { .. } => {}
            _ => return Ok(q.snapshot()),
        }
        let was_downloading = matches!(item.state, ItemState::Downloading { .. });
        let mut before = item.clone();
        // the unpacked files go once the lock is free: only single files are deleted here
        let staging = before.staging.take();
        item.state = ItemState::Cancelled;
        item.finished_at = Some(gacha_core::db::now());
        item.staging = None;
        item.choose.clear();
        // the .part stays either way, so Retry resumes (the download task leaves it too)
        if !was_downloading { discard_unpacked(&before, keep); }
        if !keep && item.req.local_path.is_none() { item.archive = None; }
        (item.clone(), if was_downloading { None } else { staging })
    };
    remove_staging_later(staging);
    persist(&st.db, &item);
    Ok(done(&app, &st))
}

#[tauri::command]
pub async fn queue_retry(app: tauri::AppHandle, st: State<'_, AppState>, id: u64) -> Result<QueueSnapshot> {
    let item = {
        let mut q = lk(&st.queue);
        let item = q.require(id)?;
        if !matches!(item.state, ItemState::Failed { .. } | ItemState::Cancelled) { return Ok(q.snapshot()); }
        item.state = ItemState::Waiting;
        item.finished_at = None;
        item.clone()
    };
    persist(&st.db, &item);
    Ok(done(&app, &st))
}

#[tauri::command]
pub async fn queue_remove(app: tauri::AppHandle, st: State<'_, AppState>, id: u64) -> Result<QueueSnapshot> {
    let keep = keep_archives(&st.db);
    let (gone, staging) = {
        let mut q = lk(&st.queue);
        let item = q.require(id)?.clone();
        let mut staging = None;
        match item.state {
            ItemState::Installing => return Err(Error::Invalid("It's being installed right now. Remove it once it's done".into())),
            ItemState::Downloading { .. } => { lk(&st.cancel).insert(id); }
            ItemState::Waiting | ItemState::NeedsChoice { .. } => {
                staging = item.staging.clone();
                discard_files(&st.data_dir, &QueueItem { staging: None, ..item.clone() }, keep);
            }
            // a failed or cancelled item keeps its archive and .part for Retry: once the row is gone nothing else would
            // clean them
            ItemState::Failed { .. } | ItemState::Cancelled if !shares_file(&q, &st.data_dir, &item) => discard_files(&st.data_dir, &item, keep),
            _ => {}
        }
        (q.remove(id), staging)
    };
    remove_staging_later(staging);
    if gone.is_some() { let _ = queue::delete_item(&lk(&st.db), id); }
    Ok(done(&app, &st))
}

#[tauri::command]
pub async fn queue_clear_finished(app: tauri::AppHandle, st: State<'_, AppState>) -> Result<QueueSnapshot> {
    let keep = keep_archives(&st.db);
    let gone = {
        let mut q = lk(&st.queue);
        let gone = q.clear_finished();
        // failed items leave an archive or a .part with no row pointing at it (unless the file is queued again)
        for i in gone.iter().filter(|i| matches!(i.state, ItemState::Failed { .. } | ItemState::Cancelled)) {
            if !shares_file(&q, &st.data_dir, i) { discard_files(&st.data_dir, i, keep); }
        }
        gone
    };
    {
        let db = lk(&st.db);
        for i in &gone { let _ = queue::delete_item(&db, i.id); }
    }
    Ok(done(&app, &st))
}

/// Answer a NeedsChoice item with the candidate keys to install (empty cancels it).
#[tauri::command]
pub async fn queue_choose(app: tauri::AppHandle, st: State<'_, AppState>, id: u64, keys: Vec<String>) -> Result<QueueSnapshot> {
    if keys.is_empty() { return queue_cancel(app, st, id).await; }
    let item = {
        let mut q = lk(&st.queue);
        let item = q.require(id)?;
        if !matches!(item.state, ItemState::NeedsChoice { .. }) {
            return Err(Error::Invalid("That download isn't waiting for a choice anymore".into()));
        }
        item.choose = keys;
        item.state = ItemState::Waiting;
        item.clone()
    };
    persist(&st.db, &item);
    Ok(done(&app, &st))
}

/// Install archives or folders from disk (drag and drop, or a file picker). Each path becomes a queue item without a
/// download step, so it gets the same progress, variant picker and toasts. Folders are copied, never moved.
/// `choose` (candidate keys) applies when there is one path. Returns right away; results arrive as queue events.
#[tauri::command]
pub async fn install_local(app: tauri::AppHandle, st: State<'_, AppState>, game: String, paths: Vec<String>, choose: Vec<String>) -> Result<InstallOutcome> {
    if gacha_core::games::def(&game).is_none() { return Err(Error::Invalid("Pick a game first".into())); }
    let paths: Vec<String> = paths.into_iter().filter(|p| !p.trim().is_empty()).collect();
    if paths.is_empty() { return Err(Error::Invalid("Nothing to install".into())); }
    let one = paths.len() == 1;
    let mut added = 0;
    for p in &paths {
        let path = std::path::Path::new(p);
        if !path.exists() { return Err(Error::Invalid(format!("\"{p}\" isn't there anymore"))); }
        let file_name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let name = if path.is_dir() { file_name.clone() } else { path.file_stem().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default() };
        let req = QueueRequest {
            game: game.clone(), file_name, local_path: Some(p.clone()),
            size: std::fs::metadata(path).map(|m| if m.is_file() { m.len() } else { 0 }).unwrap_or(0),
            meta: InstallMeta { name: Some(name), ..Default::default() }, ..Default::default()
        };
        let item = {
            let mut q = lk(&st.queue);
            let mut item = q.add(req);
            if one && !choose.is_empty() {
                if let Some(i) = q.get_mut(item.id) { i.choose = choose.clone(); item = i.clone(); }
            }
            item
        };
        persist(&st.db, &item);
        added += 1;
    }
    done(&app, &st);
    let note = if added == 1 { "Installing 1 mod".to_string() } else { format!("Installing {added} mods") };
    Ok(InstallOutcome { notes: vec![note], ..Default::default() })
}
