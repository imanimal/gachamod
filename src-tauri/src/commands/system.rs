//! Games, XXMI, launching, dev tools and Windows integration commands. Owner: SYSTEM area.
//! The database is locked only for reads and writes; disk scans, registry reads and file deletes run without it.
use crate::state::{blocking, AppState};
use gacha_core::db::{Db, Shared};
use gacha_core::devtools::{self, DevStatus};
use gacha_core::games::{self, GamePaths};
use gacha_core::launch::{self, LaunchConfig};
use gacha_core::model::GameState;
use gacha_core::platform::{self, Integration};
use gacha_core::xxmi::{self, XxmiStatus};
use gacha_core::{Error, Result};
use std::sync::MutexGuard;
use tauri::State;

fn lock(db: &Shared) -> Result<MutexGuard<'_, Db>> {
    db.lock().map_err(|_| Error::Invalid("The app's database stopped responding. Restart gachamod".into()))
}

fn xxmi_root(db: &Shared) -> Result<Option<String>> { Ok(lock(db)?.setting("xxmi.root")?.filter(|s| !s.is_empty())) }

fn importer(db: &Shared, game: &str) -> Result<std::path::PathBuf> { games::importer_dir(&*lock(db)?, game) }

#[tauri::command]
pub async fn games_list(st: State<'_, AppState>) -> Result<Vec<GameState>> {
    let db = st.db.clone();
    blocking(move || games::list(&*lock(&db)?)).await
}

#[tauri::command]
pub async fn games_detect(st: State<'_, AppState>) -> Result<Vec<GameState>> {
    let db = st.db.clone();
    blocking(move || {
        let root = xxmi_root(&db)?;
        let found = games::discover(root.as_deref());
        let d = lock(&db)?;
        games::apply(&d, &found)?;
        games::list(&d)
    }).await
}

#[tauri::command]
pub async fn game_set_paths(st: State<'_, AppState>, game: String, paths: GamePaths) -> Result<Vec<GameState>> {
    let db = st.db.clone();
    blocking(move || { let d = lock(&db)?; games::save_paths(&d, &game, &paths)?; games::list(&d) }).await
}

#[tauri::command]
pub async fn game_set_shown(st: State<'_, AppState>, game: String, shown: bool) -> Result<Vec<GameState>> {
    let db = st.db.clone();
    blocking(move || { let d = lock(&db)?; games::set_shown(&d, &game, shown)?; games::list(&d) }).await
}

#[tauri::command]
pub async fn xxmi_status(st: State<'_, AppState>) -> Result<XxmiStatus> {
    let db = st.db.clone();
    blocking(move || { let root = xxmi_root(&db)?; xxmi::status(root.as_deref()) }).await
}

#[tauri::command]
pub async fn xxmi_open(st: State<'_, AppState>) -> Result<()> {
    let db = st.db.clone();
    blocking(move || { let root = xxmi_root(&db)?; xxmi::open(root.as_deref()) }).await
}

#[tauri::command]
pub async fn launch_config_get(st: State<'_, AppState>, game: String) -> Result<LaunchConfig> {
    let db = st.db.clone();
    blocking(move || launch::config(&*lock(&db)?, &game)).await
}

#[tauri::command]
pub async fn launch_config_set(st: State<'_, AppState>, game: String, config: LaunchConfig) -> Result<LaunchConfig> {
    let db = st.db.clone();
    blocking(move || launch::set_config(&*lock(&db)?, &game, &config)).await
}

#[tauri::command]
pub async fn game_launch(st: State<'_, AppState>, game: String, vanilla: bool) -> Result<()> {
    let db = st.db.clone();
    // game-state events come from devtools::watch, which checks processes every 3 seconds
    blocking(move || { let plan = launch::plan(&*lock(&db)?, &game, vanilla)?; launch::start(plan) }).await
}

#[tauri::command]
pub async fn game_running(game: String) -> Result<bool> {
    blocking(move || Ok(launch::running(&game))).await
}

#[tauri::command]
pub async fn dev_status(st: State<'_, AppState>, game: String) -> Result<DevStatus> {
    let db = st.db.clone();
    blocking(move || devtools::status_in(&importer(&db, &game)?)).await
}

#[tauri::command]
pub async fn dev_log_tail(st: State<'_, AppState>, game: String, lines: usize) -> Result<String> {
    let db = st.db.clone();
    blocking(move || devtools::log_tail_in(&importer(&db, &game)?, lines)).await
}

#[tauri::command]
pub async fn dev_clear_shader_cache(st: State<'_, AppState>, game: String) -> Result<u64> {
    let db = st.db.clone();
    blocking(move || devtools::clear_shader_cache_in(&importer(&db, &game)?, &game)).await
}

#[tauri::command]
pub async fn dev_clear_frame_dumps(st: State<'_, AppState>, game: String) -> Result<u64> {
    let db = st.db.clone();
    blocking(move || devtools::clear_frame_dumps_in(&importer(&db, &game)?)).await
}

#[tauri::command]
pub async fn dev_reload(game: String) -> Result<()> {
    blocking(move || devtools::reload_in_game(&game)).await
}

#[tauri::command]
pub async fn dev_wipe_user_config(st: State<'_, AppState>, game: String) -> Result<()> {
    let db = st.db.clone();
    blocking(move || devtools::wipe_user_config_in(&importer(&db, &game)?, &game)).await
}

#[tauri::command]
pub async fn integrations_get() -> Result<Vec<Integration>> {
    blocking(|| platform::integrations(&std::env::current_exe()?)).await
}

#[tauri::command]
pub async fn integration_register(id: String) -> Result<Vec<Integration>> {
    blocking(move || platform::register(&std::env::current_exe()?, &id)).await
}

/// The app's own data folder (database, trash, downloads), for Settings' About section.
#[tauri::command]
pub fn app_data_dir(st: State<'_, AppState>) -> String { st.data_dir.to_string_lossy().into_owned() }
