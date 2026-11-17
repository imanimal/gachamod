//! The download queue runner: downloads waiting items (up to three at once), installs them one at a time, emits the
//! "queue" event on every change. Owner: ONLINE area (docs/spec.md, "Downloads").

use crate::state::AppState;
use gacha_core::db::Shared;
use gacha_core::model::events;
use gacha_core::queue::{self, ItemState, Queue, QueueItem};
use gacha_core::{download, install, Error};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

const MAX_DOWNLOADS: usize = 3;
/// About eight progress events a second, for all downloads together.
const EMIT_EVERY: Duration = Duration::from_millis(125);

/// A lock that survives a panic in another holder (the data is still usable for a queue).
pub fn lk<T>(m: &Mutex<T>) -> MutexGuard<'_, T> { m.lock().unwrap_or_else(|e| e.into_inner()) }

/// Send the current queue to the UI.
pub fn emit_snapshot(app: &AppHandle) {
    let st = app.state::<AppState>();
    let snap = lk(&st.queue).snapshot();
    let _ = app.emit(events::QUEUE, &snap);
}

/// Save an item's row (state changes only, not progress).
pub fn persist(db: &Shared, item: &QueueItem) {
    let _ = queue::save_item(&lk(db), item);
}

/// "downloads.keep" is "1": keep archives after installing.
pub fn keep_archives(db: &Shared) -> bool {
    lk(db).setting("downloads.keep").ok().flatten().is_some_and(|v| v == "1")
}

/// "downloads.allParts" is "1": an archive with several mods installs all of them without asking.
pub fn install_all_parts(db: &Shared) -> bool {
    lk(db).setting("downloads.allParts").ok().flatten().is_some_and(|v| v == "1")
}

/// "downloads.otherServers" is not "0": a slow GameBanana download carries on from another of its file servers.
pub fn other_servers(db: &Shared) -> bool {
    lk(db).setting("downloads.otherServers").ok().flatten().as_deref() != Some("0")
}

/// Where an item's download goes: `<data>/downloads/<game>/` and `<fileId>-<name>`.
pub fn download_target(data_dir: &Path, item: &QueueItem) -> (PathBuf, String) {
    let game = download::safe_file_name(&item.req.game);
    let name = if item.req.file_name.trim().is_empty() { "mod.zip".to_string() } else { item.req.file_name.clone() };
    (data_dir.join("downloads").join(game), download::safe_file_name(&format!("{}-{}", item.req.file_id, name)))
}

/// Remove what an unfinished item left on disk: the .part file, unpacked files, and the archive unless archives are
/// kept (never a local file the user dropped).
pub fn discard_files(data_dir: &Path, item: &QueueItem, keep: bool) {
    if item.req.local_path.is_none() {
        let (dir, name) = download_target(data_dir, item);
        let _ = std::fs::remove_file(download::part_path(&dir, &name));
        if !keep { if let Some(a) = &item.archive { let _ = std::fs::remove_file(a); } }
    }
    if let Some(s) = &item.staging { let _ = std::fs::remove_dir_all(s); }
}

/// Another item that isn't finished downloads to the same file, so that file is not this item's to delete.
pub fn shares_file(q: &Queue, data_dir: &Path, item: &QueueItem) -> bool {
    let at = download_target(data_dir, item);
    q.items.iter().any(|o| o.id != item.id && !o.state.finished() && o.req.local_path.is_none() && download_target(data_dir, o) == at)
}

/// Delete unpacked files off the caller's thread: they can be gigabytes.
pub fn remove_staging_later(staging: Option<String>) {
    if let Some(s) = staging { tauri::async_runtime::spawn_blocking(move || { let _ = std::fs::remove_dir_all(s); }); }
}

/// Words a player can act on.
fn readable(e: &Error) -> String {
    match e {
        Error::Network(_) => "GameBanana didn't answer. Check your connection, then press Retry to pick up where it stopped".into(),
        Error::Http { status: 404 | 410, .. } => "GameBanana doesn't have this file anymore. The mod may have a newer one".into(),
        Error::Http { status, .. } => format!("GameBanana answered with an error ({status}). Try again in a minute"),
        other => other.to_string(),
    }
}

struct Runner {
    app: AppHandle,
    data: PathBuf,
    db: Shared,
    http: reqwest::Client,
    queue: Arc<Mutex<Queue>>,
    pump: Arc<tokio::sync::Notify>,
    cancel: Arc<Mutex<HashSet<u64>>>,
    active: Mutex<HashSet<u64>>,
    installing: AtomicBool,
    last_emit: Mutex<Instant>,
}

/// Started once from setup: loads the saved queue, clears old unpacked files, then runs the loop.
pub fn start(app: AppHandle) {
    let st = app.state::<AppState>();
    let r = Arc::new(Runner {
        app: app.clone(),
        data: st.data_dir.clone(),
        db: st.db.clone(),
        http: st.http.clone(),
        queue: st.queue.clone(),
        pump: st.pump.clone(),
        cancel: st.cancel.clone(),
        active: Mutex::new(HashSet::new()),
        installing: AtomicBool::new(false),
        last_emit: Mutex::new(Instant::now() - EMIT_EVERY),
    });
    let loaded = queue::Queue::load(&lk(&r.db));
    match loaded {
        Ok(q) => *lk(&r.queue) = q,
        Err(e) => eprintln!("queue: couldn't load the saved queue: {e}"),
    }
    let data = r.data.clone();
    tauri::async_runtime::spawn_blocking(move || install::clean_staging(&data));
    tauri::async_runtime::spawn(async move {
        loop {
            r.tick();
            // every change to the queue wakes this; the timeout is only a fallback, so an idle app stays asleep
            let _ = tokio::time::timeout(Duration::from_secs(30), r.pump.notified()).await;
        }
    });
}

impl Runner {
    fn emit(&self) {
        *lk(&self.last_emit) = Instant::now();
        emit_snapshot(&self.app);
    }

    fn emit_throttled(&self) {
        let due = {
            let mut last = lk(&self.last_emit);
            if last.elapsed() >= EMIT_EVERY { *last = Instant::now(); true } else { false }
        };
        if due { emit_snapshot(&self.app); }
    }

    /// Change an item and save it. None when it is gone.
    fn update(&self, id: u64, f: impl FnOnce(&mut QueueItem)) -> Option<QueueItem> { self.update_if(id, |_| true, f) }

    /// `update`, but only while `ok` holds for the item, checked under the same lock as the change. None when it
    /// doesn't (or the item is gone).
    fn update_if(&self, id: u64, ok: impl FnOnce(&QueueItem) -> bool, f: impl FnOnce(&mut QueueItem)) -> Option<QueueItem> {
        let item = {
            let mut q = lk(&self.queue);
            let i = q.get_mut(id)?;
            if !ok(i) { return None; }
            f(i);
            if !i.state.active() { i.progress = None; }
            i.finished_at = i.state.finished().then(gacha_core::db::now);
            i.clone()
        };
        persist(&self.db, &item);
        Some(item)
    }

    /// Start what can start: downloads into free slots, one install when none runs.
    fn tick(self: &Arc<Self>) {
        let mut downloads = Vec::new();
        let mut install = None;
        {
            let mut q = lk(&self.queue);
            let mut active = lk(&self.active);
            let mut slots = MAX_DOWNLOADS.saturating_sub(active.len());
            let installing = self.installing.load(Ordering::SeqCst);
            for item in q.items.iter_mut() {
                if item.state != ItemState::Waiting { continue; }
                if item.ready_to_install() || item.staging.is_some() {
                    if install.is_none() && !installing {
                        item.state = ItemState::Installing;
                        item.progress = None;
                        install = Some(item.clone());
                    }
                } else if slots > 0 && !active.contains(&item.id) {
                    slots -= 1;
                    item.archive = None;
                    item.progress = None;
                    item.state = ItemState::Downloading { received: 0, total: (item.req.size > 0).then_some(item.req.size) };
                    active.insert(item.id);
                    // a cancel that arrived as the last try ended must not stop this one
                    lk(&self.cancel).remove(&item.id);
                    downloads.push(item.clone());
                }
            }
            if install.is_some() { self.installing.store(true, Ordering::SeqCst); }
        }
        if downloads.is_empty() && install.is_none() { return; }
        for d in &downloads { persist(&self.db, d); }
        if let Some(i) = &install { persist(&self.db, i); }
        self.emit();
        for d in downloads {
            let r = self.clone();
            tauri::async_runtime::spawn(async move { r.run_download(d).await });
        }
        if let Some(i) = install {
            let r = self.clone();
            tauri::async_runtime::spawn(async move { r.run_install(i).await });
        }
    }

    fn still_downloading(&self, id: u64) -> bool {
        matches!(lk(&self.queue).get(id).map(|i| &i.state), Some(ItemState::Downloading { .. }))
    }

    /// Say on a row what it is doing when the bar alone doesn't ("Connecting to gamebanana.com"); "" clears it.
    fn note(&self, id: u64, text: String) {
        {
            let mut q = lk(&self.queue);
            let Some(i) = q.get_mut(id) else { return };
            if text.is_empty() { i.progress = None; } else { i.progress = Some(install::InstallProgress { step: text, ..Default::default() }); }
        }
        self.emit();
    }

    fn on_progress(&self, id: u64, received: u64, total: Option<u64>) -> bool {
        if lk(&self.cancel).contains(&id) { return false; }
        {
            let mut q = lk(&self.queue);
            let Some(i) = q.get_mut(id) else { return false };
            let fallback = (i.req.size > 0).then_some(i.req.size);
            match &mut i.state {
                ItemState::Downloading { received: r, total: t } => { *r = received; *t = total.or(fallback); }
                _ => return false,
            }
        }
        self.emit_throttled();
        true
    }

    async fn run_download(self: Arc<Self>, item: QueueItem) {
        let id = item.id;
        let (dir, name) = download_target(&self.data, &item);
        let url = if item.req.file_id > 0 { format!("https://gamebanana.com/dl/{}", item.req.file_id) } else { item.req.url.clone() };
        let want_md5 = item.req.md5.clone().filter(|m| !m.trim().is_empty()).map(|m| m.trim().to_ascii_lowercase());

        // a finished copy from before (archives kept, or a reinstall) is used as is when it matches
        let done = dir.join(&name);
        let reuse = if done.is_file() {
            self.note(id, "Checking the copy downloaded before".into());
            let p = done.clone();
            let md5 = tauri::async_runtime::spawn_blocking(move || gacha_core::archive::md5_file(&p).ok()).await.ok().flatten();
            match (&want_md5, md5) {
                (Some(w), Some(m)) if *w == m => Some(download::Downloaded { size: std::fs::metadata(&done).map(|m| m.len()).unwrap_or(0), path: done.clone(), md5: m }),
                _ => { let _ = std::fs::remove_file(&done); None }
            }
        } else { None };

        let result = match reuse {
            Some(d) => Ok(d),
            None if url.starts_with("https://") || url.starts_with("http://") => {
                let (r, n) = (self.clone(), self.clone());
                let switch = other_servers(&self.db).then_some(&download::GAMEBANANA);
                download::download_noting(&self.http, &url, &dir, &name, switch, move |rec, total| r.on_progress(id, rec, total), move |t| n.note(id, t)).await
            }
            None => Err(Error::Invalid("This item has no download link. Remove it and queue the file again".into())),
        };

        lk(&self.active).remove(&id);
        let cancelled = lk(&self.cancel).remove(&id);
        let live = !cancelled && self.still_downloading(id);
        match result {
            Ok(d) if !live => { let _ = std::fs::remove_file(&d.path); }
            Ok(d) => {
                if want_md5.as_deref().is_some_and(|w| w != d.md5) {
                    let _ = std::fs::remove_file(&d.path);
                    self.fail(id, "The download was damaged. Try again.".into(), &item);
                } else {
                    let path = d.path.to_string_lossy().into_owned();
                    let still = |i: &QueueItem| matches!(i.state, ItemState::Downloading { .. });
                    match self.update_if(id, still, |i| { i.archive = Some(path.clone()); i.state = ItemState::Waiting; }) {
                        Some(i) => { let _ = queue::record_download(&lk(&self.db), &i, &path, d.size, &d.md5); }
                        // cancelled or removed just as it finished: it stays that way
                        None => { lk(&self.cancel).remove(&id); let _ = std::fs::remove_file(&d.path); }
                    }
                    self.emit();
                }
            }
            Err(_) if !live => { let _ = std::fs::remove_file(download::part_path(&dir, &name)); }
            Err(e) => self.fail(id, readable(&e), &item),
        }
        self.pump.notify_one();
    }

    fn fail(&self, id: u64, message: String, item: &QueueItem) {
        self.update(id, |i| { i.staging = None; i.choose.clear(); i.state = ItemState::Failed { message: message.clone() }; });
        self.emit();
        // the UI adds a way to fix it when the game has no Mods folder yet (App.tsx)
        let text = format!("Couldn't install {}: {message}", item.name());
        let _ = self.app.emit(events::TOAST, serde_json::json!({ "text": text, "bad": true, "failed": { "game": item.req.game, "item": id } }));
    }

    async fn fetch_preview(&self, url: &str, staging: &Path) {
        let Ok(resp) = self.http.get(url).timeout(Duration::from_secs(8)).send().await else { return };
        if !resp.status().is_success() { return; }
        let ext = match resp.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("") {
            t if t.contains("png") => "png",
            t if t.contains("webp") => "webp",
            t if t.contains("gif") => "gif",
            _ => "jpg",
        };
        let Ok(Ok(bytes)) = tokio::time::timeout(Duration::from_secs(8), resp.bytes()).await else { return };
        if bytes.is_empty() || bytes.len() > 20 << 20 { return; }
        let _ = std::fs::write(staging.join(format!("{}.{ext}", install::PREVIEW_STEM)), &bytes);
    }

    async fn run_install(self: Arc<Self>, item: QueueItem) {
        let id = item.id;
        let result = self.clone().install(&item).await;
        self.installing.store(false, Ordering::SeqCst);
        match result {
            Ok((staging, o)) if o.needs_choice.is_some() => {
                let candidates = o.needs_choice.unwrap_or_default();
                let s = staging.to_string_lossy().into_owned();
                self.update(id, |i| { i.staging = Some(s.clone()); i.choose.clear(); i.state = ItemState::NeedsChoice { candidates: candidates.clone() }; });
                self.emit();
                let _ = self.app.emit(events::VARIANTS_NEEDED, serde_json::json!({ "id": id, "game": item.req.game, "name": item.name(), "candidates": candidates }));
            }
            Ok((_, o)) => {
                let ids: Vec<String> = o.installed.iter().map(|m| m.id.clone()).collect();
                let archive = item.archive.clone();
                let keep = keep_archives(&self.db);
                self.update(id, |i| {
                    i.staging = None;
                    i.choose.clear();
                    if !keep && i.req.local_path.is_none() { i.archive = None; }
                    i.state = ItemState::Done { mod_ids: ids.clone() };
                });
                if !keep && item.req.local_path.is_none() { if let Some(a) = archive { let _ = std::fs::remove_file(a); } }
                self.emit();
                let _ = self.app.emit(events::LIBRARY_CHANGED, serde_json::json!({ "game": item.req.game }));
                let name = o.installed.first().map(|m| m.name.clone()).filter(|_| o.installed.len() == 1).unwrap_or_else(|| item.name());
                let character = o.installed.first().and_then(|m| m.character.clone()).or_else(|| item.req.meta.character.clone());
                let verb = if item.req.meta.replaces.is_some() { "Updated" } else { "Installed" };
                let what = if o.bundle && o.installed.len() > 1 { format!("{} mods from {}", o.installed.len(), item.name()) }
                    else if o.installed.len() > 1 { format!("{} variants of {name}", o.installed.len()) } else { name };
                let character = if o.bundle { None } else { character };
                let mut text = match character { Some(c) => format!("{verb} {what} for {c}"), None => format!("{verb} {what}") };
                if !o.notes.is_empty() { text = format!("{text}. {}", o.notes.join(". ")); }
                // the toast opens the mod; a new one (not an update) is turned on by the UI first (library/afterInstall.ts)
                let open = o.installed.first().map(|m| serde_json::json!({ "game": item.req.game, "modId": m.id }));
                let fresh: Vec<&String> = if item.req.meta.replaces.is_none() { ids.iter().collect() } else { Vec::new() };
                let _ = self.app.emit(events::TOAST, serde_json::json!({ "text": text, "bad": false, "open": open, "installed": fresh }));
            }
            Err(e) => {
                // a broken archive is fetched again on Retry
                if e.to_string().starts_with(gacha_core::archive::DAMAGED) && item.req.local_path.is_none() {
                    if let Some(a) = &item.archive { let _ = std::fs::remove_file(a); }
                    self.update(id, |i| i.archive = None);
                }
                self.fail(id, readable(&e), &item);
            }
        }
        self.pump.notify_one();
    }

    /// A reporter for `install::with_progress` that shows each step on the item's row.
    fn reporter(self: &Arc<Self>, id: u64, last: Arc<Mutex<install::InstallProgress>>) -> impl Fn(&install::InstallProgress) + 'static {
        let r = self.clone();
        move |p| {
            *lk(&last) = p.clone();
            let p = p.clone();
            r.update_if(id, |i| i.state == ItemState::Installing, move |i| i.progress = Some(p));
            r.emit_throttled();
        }
    }

    async fn install(self: Arc<Self>, item: &QueueItem) -> gacha_core::Result<(PathBuf, install::InstallOutcome)> {
        let last = Arc::new(Mutex::new(install::InstallProgress::default()));
        let kept = item.staging.as_ref().map(PathBuf::from).filter(|p| p.is_dir());
        let staging = match kept {
            Some(s) => s,
            None => {
                let src = item.req.local_path.clone().or_else(|| item.archive.clone())
                    .ok_or_else(|| Error::Invalid("The downloaded file is gone. Press Retry to download it again".into()))?;
                let data = self.data.clone();
                let report = self.reporter(item.id, last.clone());
                let staging = tauri::async_runtime::spawn_blocking(move || install::with_progress(Default::default(), report, || install::stage_any(&data, Path::new(&src)))).await
                    .unwrap_or_else(|e| Err(Error::Invalid(e.to_string())))?;
                if let Some(url) = item.req.meta.preview_url.as_deref().filter(|u| u.starts_with("https://")) {
                    let step = install::InstallProgress { step: "Getting the preview picture".into(), ..lk(&last).clone() };
                    self.update_if(item.id, |i| i.state == ItemState::Installing, |i| i.progress = Some(step));
                    self.emit();
                    self.fetch_preview(url, &staging).await;
                }
                staging
            }
        };
        let (db, data, game, meta, choose, s) = (self.db.clone(), self.data.clone(), item.req.game.clone(), item.req.meta.clone(), item.choose.clone(), staging.clone());
        let all = choose.is_empty() && install_all_parts(&db);
        let (report, start) = (self.reporter(item.id, last.clone()), lk(&last).clone());
        let outcome = tauri::async_runtime::spawn_blocking(move || install::with_progress(start, report, || {
            let o = install::place(&db, &data, &game, &s, &meta, &choose)?;
            match o.needs_choice {
                Some(c) if all => install::place(&db, &data, &game, &s, &meta, &c.into_iter().map(|c| c.key).collect::<Vec<_>>()),
                _ => Ok(o),
            }
        })).await
            .unwrap_or_else(|e| Err(Error::Invalid(e.to_string())))?;
        Ok((staging, outcome))
    }
}
