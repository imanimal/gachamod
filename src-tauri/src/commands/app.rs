//! Settings export and import, and gachamod's own update check and install. Owner: SYSTEM area.
use crate::state::{blocking, AppState};
use gacha_core::app_update::{self, Asset, UpdateCheck};
use gacha_core::settings_file::{self, ImportSummary};
use gacha_core::{Error, Result};
use std::collections::BTreeMap;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager, State};

/// `{ done, total }` while an update downloads.
pub const UPDATE_PROGRESS: &str = "app-update-progress";

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

fn app_version(app: &AppHandle) -> String { app.package_info().version.to_string() }

/// Look for a newer gachamod. Never fails: no answer from GitHub is `reachable: false`.
#[tauri::command]
pub async fn app_update_check(app: AppHandle, st: State<'_, AppState>) -> Result<UpdateCheck> {
    Ok(app_update::check(&st.http, &app_version(&app)).await)
}

/// Download the installer to the temp folder, start it and quit.
#[tauri::command]
pub async fn app_update_install(app: AppHandle, st: State<'_, AppState>, asset: Asset) -> Result<()> {
    let dir = std::env::temp_dir().join("gachamod-update");
    let emitter = app.clone();
    let mut last = 0u64;
    let path = app_update::download_installer(&st.http, &asset, &dir, move |done, total| {
        // about every 256 KB, so the UI isn't flooded
        if done - last >= 256 * 1024 || total == Some(done) {
            last = done;
            let _ = emitter.emit(UPDATE_PROGRESS, serde_json::json!({ "done": done, "total": total }));
        }
    }).await?;
    app_update::run_installer(&path)?;
    app.exit(0);
    Ok(())
}

/// At start, once a day unless turned off: check quietly and say so in a toast when there is a newer version.
pub fn start_daily_check(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // give the window time to start listening for toasts
        tokio::time::sleep(std::time::Duration::from_secs(12)).await;
        let st = app.state::<AppState>();
        let due = {
            let Ok(d) = st.db.lock() else { return };
            let on = d.setting(app_update::SETTING).ok().flatten().as_deref() != Some("0");
            let last = d.setting(app_update::CHECKED_AT).ok().flatten().and_then(|v| v.parse().ok());
            on && app_update::due(last, gacha_core::db::now())
        };
        if !due { return; }
        let c = app_update::check(&st.http, &app_version(&app)).await;
        if let Ok(d) = st.db.lock() { let _ = d.set_setting(app_update::CHECKED_AT, &gacha_core::db::now().to_string()); }
        if let (true, Some(r)) = (c.available, &c.release) {
            let text = format!("gachamod {} is out. See what's new and install it in Settings, under About", r.version);
            let _ = app.emit(gacha_core::model::events::TOAST, serde_json::json!({ "text": text, "bad": false }));
        }
    });
}
