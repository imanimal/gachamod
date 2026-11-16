//! Settings export and import, and gachamod's own updates. Owner: SYSTEM area.
use crate::state::{blocking, AppState};
use gacha_core::app_update::{self, Release, UpdateCheck};
use gacha_core::settings_file::{self, ImportSummary};
use gacha_core::{Error, Result};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

/// `{ done, total }` while an update downloads.
pub const UPDATE_PROGRESS: &str = "app-update-progress";
/// A newer version finished downloading in the background: `{ version }`.
pub const UPDATE_READY: &str = "app-update-ready";

fn lock(db: &gacha_core::db::Shared) -> Result<std::sync::MutexGuard<'_, gacha_core::db::Db>> {
    db.lock().map_err(|_| Error::Invalid("The app's database stopped responding. Restart gachamod".into()))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSummary { pub games: u32, pub profiles: u32, pub settings: u32 }

/// Write the settings file. `ui` is the window's own choices (theme picks, colours, text size).
#[tauri::command]
pub async fn settings_export(st: State<'_, AppState>, path: String, profiles: bool, ui: BTreeMap<String, String>) -> Result<ExportSummary> {
    let db = st.db.clone();
    blocking(move || {
        let f = settings_file::export(&*lock(&db)?, profiles, &ui)?;
        settings_file::write_file(&PathBuf::from(&path), &f)?;
        let settings = f.settings.len() + f.games.iter().map(|g| g.settings.len()).sum::<usize>();
        Ok(ExportSummary { games: f.games.len() as u32, profiles: f.profiles.as_ref().map_or(0, |p| p.len() as u32), settings: settings as u32 })
    }).await
}

/// What importing a file would change, without changing anything.
#[tauri::command]
pub async fn settings_import_preview(st: State<'_, AppState>, path: String) -> Result<ImportSummary> {
    let db = st.db.clone();
    blocking(move || {
        let f = settings_file::read_file(&PathBuf::from(&path))?;
        settings_file::preview(&*lock(&db)?, &f)
    }).await
}

/// Back up the current settings (with the window's `ui` choices), then apply the file.
#[tauri::command]
pub async fn settings_import(st: State<'_, AppState>, path: String, ui: BTreeMap<String, String>) -> Result<ImportSummary> {
    let db = st.db.clone();
    let data_dir = st.data_dir.clone();
    blocking(move || {
        let f = settings_file::read_file(&PathBuf::from(&path))?;
        let d = lock(&db)?;
        let backup = settings_file::save_backup(&data_dir, &settings_file::snapshot(&d, &ui)?)?;
        let mut done = settings_file::apply(&d, &f)?;
        done.backup = backup.to_string_lossy().into_owned();
        Ok(done)
    }).await
}

/// Put back what an import changed. Returns the window's choices from before it.
#[tauri::command]
pub async fn settings_import_undo(st: State<'_, AppState>, backup: String) -> Result<BTreeMap<String, String>> {
    let db = st.db.clone();
    let data_dir = st.data_dir.clone();
    blocking(move || {
        let snap = settings_file::load_backup(&data_dir, &PathBuf::from(&backup))?;
        settings_file::restore(&*lock(&db)?, &snap)?;
        Ok(snap.ui)
    }).await
}


// ── gachamod's own updates ──
//
// Tauri's updater reads latest.json from the newest GitHub release (tauri.conf.json: plugins > updater) and only
// accepts an installer signed with the release key. With automatic updates on (the default), gachamod looks at start
// and every 6 hours, downloads a newer version in the background and installs it when gachamod closes. The toast
// and Settings, About and updates offer to restart now instead. On Windows the installer runs with a small progress window.

const CHECK_EVERY: Duration = Duration::from_secs(6 * 3600);

#[derive(Default)]
pub struct Updates {
    /// The newer version the last check found.
    found: Mutex<Option<Update>>,
    /// A downloaded and verified installer, run when gachamod closes unless the user restarts first.
    ready: Mutex<Option<(Update, Vec<u8>)>>,
    /// One download at a time.
    downloading: AtomicBool,
}

fn app_version(app: &AppHandle) -> String { app.package_info().version.to_string() }

fn auto_on(app: &AppHandle) -> bool {
    let st = app.state::<AppState>();
    let Ok(d) = st.db.lock() else { return false };
    d.setting(app_update::SETTING).ok().flatten().as_deref() != Some("0")
}

fn release_of(u: &Update) -> Release { Release::new(&u.version, u.body.as_deref(), u.date.map(|d| d.to_string())) }

/// What's known without asking the feed again.
fn status(app: &AppHandle, reachable: bool) -> UpdateCheck {
    let up = app.state::<Updates>();
    let ready = up.ready.lock().unwrap().as_ref().map(|(u, _)| u.version.clone());
    let found = up.found.lock().unwrap().as_ref().map(release_of);
    // a download of an older find still counts until something newer is downloaded
    let release = found.or_else(|| up.ready.lock().unwrap().as_ref().map(|(u, _)| release_of(u)));
    let is_ready = matches!((&ready, &release), (Some(v), Some(r)) if *v == r.version);
    UpdateCheck { current: app_version(app), reachable, available: release.is_some(), ready: is_ready, release }
}

/// Ask the feed. Never fails: no answer (offline, no release yet) is `reachable: false`.
async fn find(app: &AppHandle) -> UpdateCheck {
    let res = match app.updater_builder().timeout(Duration::from_secs(30)).build() {
        Ok(u) => u.check().await,
        Err(e) => Err(e),
    };
    match res {
        Ok(found) => {
            *app.state::<Updates>().found.lock().unwrap() = found;
            status(app, true)
        }
        Err(e) => {
            gacha_core::logs::info(format!("Update check: {e}"));
            status(app, false)
        }
    }
}

/// Download and check the installer of `u`, keeping it for the restart or the quit.
async fn download(app: &AppHandle, mut u: Update) -> Result<()> {
    let up = app.state::<Updates>();
    if up.downloading.swap(true, Ordering::SeqCst) {
        return Err(Error::Conflict("The update is already downloading".into()));
    }
    // the check's 30 seconds would cut a slow download short
    u.timeout = Some(Duration::from_secs(30 * 60));
    let emitter = app.clone();
    let (mut done, mut last) = (0u64, 0u64);
    let res = u.download(move |chunk, total| {
        done += chunk as u64;
        // about every 256 KB, so the UI isn't flooded
        if done - last >= 256 * 1024 || total == Some(done) {
            last = done;
            let _ = emitter.emit(UPDATE_PROGRESS, serde_json::json!({ "done": done, "total": total }));
        }
    }, || {}).await;
    up.downloading.store(false, Ordering::SeqCst);
    let bytes = res.map_err(|e| Error::Network(format!("The update didn't download: {e}")))?;
    *up.ready.lock().unwrap() = Some((u, bytes));
    Ok(())
}

/// Look for a newer gachamod now.
#[tauri::command]
pub async fn app_update_check(app: AppHandle) -> Result<UpdateCheck> { Ok(find(&app).await) }

/// What the last check found and whether it's downloaded, without going online.
#[tauri::command]
pub fn app_update_status(app: AppHandle) -> UpdateCheck { status(&app, true) }

/// Install the newer version now: download it if it isn't yet, then run the installer, which closes gachamod and
/// opens the new version.
#[tauri::command]
pub async fn app_update_install(app: AppHandle) -> Result<()> {
    let up = app.state::<Updates>();
    let found = up.found.lock().unwrap().clone();
    let have = up.ready.lock().unwrap().as_ref().map(|(u, _)| u.version.clone());
    if let Some(f) = found.filter(|f| have.as_deref() != Some(f.version.as_str())) {
        download(&app, f).await?;
    }
    let Some((u, bytes)) = up.ready.lock().unwrap().take() else {
        return Err(Error::Invalid("There's no update to install. Check for updates first".into()));
    };
    gacha_core::logs::quitting();
    // on Windows this starts the installer and ends the process
    if let Err(e) = u.install(&bytes) {
        *up.ready.lock().unwrap() = Some((u, bytes));
        return Err(Error::Invalid(format!("The installer didn't start: {e}")));
    }
    app.restart()
}

/// Automatic updates: at start and every 6 hours, unless turned off. A newer version downloads quietly and a toast
/// says it's ready.
pub fn start_auto_update(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // give the window time to start listening for the toast
        tokio::time::sleep(Duration::from_secs(12)).await;
        loop {
            if auto_on(&app) {
                let c = find(&app).await;
                let found = app.state::<Updates>().found.lock().unwrap().clone();
                if let (false, Some(u)) = (c.ready, found) {
                    let version = u.version.clone();
                    match download(&app, u).await {
                        Ok(()) => { let _ = app.emit(UPDATE_READY, serde_json::json!({ "version": version })); }
                        Err(e) => gacha_core::logs::warn(format!("Update download: {e}")),
                    }
                }
            }
            tokio::time::sleep(CHECK_EVERY).await;
        }
    });
}

/// At quit: run a downloaded update's installer, without opening gachamod again after. Only with automatic updates
/// on, so turning them off after a download keeps this version.
pub fn install_on_quit(app: &AppHandle) {
    let Some(up) = app.try_state::<Updates>() else { return };
    if !auto_on(app) { return; }
    let Some((u, bytes)) = up.ready.lock().unwrap().take() else { return };
    if let Err(e) = u.restart_after_install(false).install(&bytes) {
        gacha_core::logs::warn(format!("Update install at quit: {e}"));
    }
}

/// gachamod is closing to start again (as administrator): the new copy installs the update itself, so this one
/// doesn't run the installer under it.
pub fn skip_update_on_quit(app: &AppHandle) {
    if let Some(up) = app.try_state::<Updates>() { up.ready.lock().unwrap().take(); }
}
