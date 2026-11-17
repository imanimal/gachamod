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

static SETTING_UP: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// One click: install XXMI Launcher and the mod loader of each game asked for (with none asked, every XXMI game found
/// on this PC), then look for games again. Steps arrive as "xxmi-setup" events (xxmi_setup::SetupProgress).
#[tauri::command]
pub async fn xxmi_install(app: tauri::AppHandle, st: State<'_, AppState>, games: Option<Vec<String>>) -> Result<Vec<GameState>> {
    use std::sync::atomic::Ordering;
    if SETTING_UP.swap(true, Ordering::SeqCst) {
        return Err(Error::Conflict("gachamod is installing the mod loaders already. It shows how far it got where you started it".into()));
    }
    let r = install_loaders(&app, &st, games).await;
    SETTING_UP.store(false, Ordering::SeqCst);
    r
}

async fn install_loaders(app: &tauri::AppHandle, st: &AppState, want: Option<Vec<String>>) -> Result<Vec<GameState>> {
    use gacha_core::xxmi_setup::{self, SetupProgress, Target};
    use tauri::Emitter;
    let db = st.db.clone();
    let root = xxmi_root(&db)?;
    let r = root.clone();
    let found = blocking(move || Ok(games::discover(r.as_deref()))).await?;
    let saved = games::list(&*lock(&db)?)?;
    let targets: Vec<Target> = games::GAMES.iter().filter(|g| g.xxmi).filter_map(|g| {
        let dir = found.iter().find(|f| f.game == g.id).and_then(|f| f.game_dir.clone())
            .or_else(|| saved.iter().find(|s| s.id == g.id).and_then(|s| s.game_dir.clone()).map(std::path::PathBuf::from).filter(|p| p.is_dir()));
        let asked = match &want { Some(ids) if !ids.is_empty() => ids.iter().any(|i| i == g.id), _ => dir.is_some() };
        asked.then(|| Target { code: g.importer.to_string(), game_dir: dir })
    }).collect();
    let mut emit = |p: SetupProgress| { let _ = app.emit("xxmi-setup", p); };
    xxmi_setup::install(&st.http, &st.data_dir, root.as_deref(), &targets, &mut emit).await?;
    blocking(move || {
        let found = games::discover(root.as_deref());
        let d = lock(&db)?;
        games::apply(&d, &found)?;
        games::list(&d)
    }).await
}

/// What an uninstall left: the games after, and the Mods folders it kept.
#[derive(serde::Serialize)]
pub struct XxmiRemoved { games: Vec<GameState>, kept: Vec<String> }

/// Uninstall the mod loaders of `games` (none given: XXMI Launcher and every loader). Files go to the Recycle Bin and
/// each Mods folder stays. Then the games forget those loaders and are looked for again.
#[tauri::command]
pub async fn xxmi_uninstall(st: State<'_, AppState>, games: Option<Vec<String>>) -> Result<XxmiRemoved> {
    if SETTING_UP.load(std::sync::atomic::Ordering::SeqCst) {
        return Err(Error::Conflict("gachamod is installing the mod loaders. Wait for it to finish".into()));
    }
    let db = st.db.clone();
    blocking(move || {
        let root = xxmi_root(&db)?;
        let ids: Vec<&str> = match &games {
            Some(g) if !g.is_empty() => games::GAMES.iter().filter(|d| d.xxmi && g.iter().any(|x| x == d.id)).map(|d| d.id).collect(),
            _ => games::GAMES.iter().filter(|d| d.xxmi).map(|d| d.id).collect(),
        };
        let codes: Vec<String> = match &games {
            Some(g) if !g.is_empty() => ids.iter().filter_map(|i| games::def(i)).map(|d| d.importer.to_string()).collect(),
            _ => Vec::new(),
        };
        let kept = gacha_core::xxmi_setup::uninstall(root.as_deref(), &codes)?;
        let found = games::discover(root.as_deref());
        let d = lock(&db)?;
        for id in &ids {
            if games::paths(&d, id)?.via_xxmi { games::forget_loader(&d, id)?; }
        }
        games::apply(&d, &found)?;
        Ok(XxmiRemoved { games: games::list(&d)?, kept: kept.into_iter().map(|p| p.to_string_lossy().into_owned()).collect() })
    }).await
}

/// Start over at the next start (gacha_core::reset). The window clears its own storage, then calls app_relaunch.
#[tauri::command]
pub async fn app_reset(st: State<'_, AppState>) -> Result<()> {
    let data = st.data_dir.clone();
    blocking(move || gacha_core::reset::request(&data)).await
}

/// The game a fresh install's setup was named for (`gachamod-setup-zzz.exe`, src-setup look.rs), read once: the
/// note is removed. The window turns on one-game mode for it at the first start.
#[tauri::command]
pub async fn setup_game(st: State<'_, AppState>) -> Result<Option<String>> {
    let file = st.data_dir.join("setup-game.json");
    blocking(move || {
        let Ok(text) = std::fs::read_to_string(&file) else { return Ok(None) };
        let _ = std::fs::remove_file(&file);
        let v: serde_json::Value = serde_json::from_str(text.trim_start_matches('\u{feff}')).unwrap_or_default();
        Ok(v["game"].as_str().filter(|g| games::def(g).is_some()).map(String::from))
    }).await
}

/// Close gachamod and open it again.
#[tauri::command]
pub fn app_relaunch(app: tauri::AppHandle) {
    gacha_core::logs::quitting();
    app.restart();
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

/// Turn XXMI's Unsafe Mode off for a game (turning it on needs XXMI Launcher, which signs it).
#[tauri::command]
pub async fn launch_unsafe_off(st: State<'_, AppState>, game: String) -> Result<LaunchConfig> {
    let db = st.db.clone();
    blocking(move || launch::unsafe_off(&*lock(&db)?, &game)).await
}

#[tauri::command]
pub async fn game_launch(st: State<'_, AppState>, game: String, vanilla: bool) -> Result<Option<String>> {
    let db = st.db.clone();
    // game-state events come from devtools::watch, which checks processes every 3 seconds. The database lock is let go
    // while the game starts: that can wait on an admin prompt, or on Steam closing, starting and signing in.
    blocking(move || {
        let plan = launch::plan(&*lock(&db)?, &game, vanilla)?;
        let started = launch::start(plan.clone())?;
        Ok(launch::plan_note(&*lock(&db)?, &game, &plan, vanilla, started))
    }).await
}

/// Before a start: whether to warn that Genshin Impact may stop with "Illegal tool detected" (only reads files).
#[tauri::command]
pub async fn game_kick_check(st: State<'_, AppState>, game: String, vanilla: bool) -> Result<launch::KickCheck> {
    let db = st.db.clone();
    blocking(move || launch::kick_check(&*lock(&db)?, &game, vanilla)).await
}

/// The player did the "Illegal tool detected" fix by hand (or takes that back).
#[tauri::command]
pub async fn game_kick_fix_done(st: State<'_, AppState>, done: bool) -> Result<()> {
    let db = st.db.clone();
    blocking(move || launch::set_kick_fix(&*lock(&db)?, done)).await
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
pub async fn dev_reload(st: State<'_, AppState>, game: String) -> Result<()> {
    let db = st.db.clone();
    blocking(move || {
        let key = devtools::reload_key(&*lock(&db)?, &game);
        devtools::reload_in_game(&game, &key)
    }).await
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

/// Turn the gachamod link handler or the .gachamod file type on or off, and remember it for the next start.
#[tauri::command]
pub async fn integration_set(st: State<'_, AppState>, id: String, on: bool) -> Result<Vec<Integration>> {
    let db = st.db.clone();
    blocking(move || {
        let list = platform::set(&std::env::current_exe()?, &id, on)?;
        lock(&db)?.set_setting(&platform::setting_key(&id), if on { "1" } else { "0" })?;
        Ok(list)
    }).await
}

/// The app's own data folder (database, trash, downloads), for Settings' About section.
#[tauri::command]
pub fn app_data_dir(st: State<'_, AppState>) -> String { st.data_dir.to_string_lossy().into_owned() }

/// The look on screen (theme, scheme, accent, the game, a custom theme's CSS), kept in look.json for gachamod setup:
/// repair and uninstall wear it (src-setup/src/look.rs). lib/theme.ts sends it whenever the theme changes.
#[tauri::command]
pub async fn save_look(st: State<'_, AppState>, look: serde_json::Value) -> Result<()> {
    let file = st.data_dir.join("look.json");
    blocking(move || {
        if !look.is_object() { return Err(Error::Invalid("A look is an object".into())); }
        let text = serde_json::to_string(&look)?;
        if text.len() > 512 * 1024 { return Ok(()); }
        if std::fs::read_to_string(&file).is_ok_and(|old| old == text) { return Ok(()); }
        std::fs::write(&file, text)?;
        Ok(())
    }).await
}

/// gachamod setup next to the app (an installed copy has it; a dev build doesn't).
fn setup_exe() -> Option<std::path::PathBuf> {
    let exe = std::env::current_exe().ok()?.parent()?.join("setup.exe");
    exe.exists().then_some(exe)
}

#[tauri::command]
pub fn setup_available() -> bool { setup_exe().is_some() }

/// Open gachamod setup for repair or uninstall. It runs on its own; a repair closes gachamod when it starts.
#[tauri::command]
pub fn setup_open() -> Result<()> {
    let exe = setup_exe().ok_or_else(|| Error::NotSetUp("gachamod setup isn't next to gachamod. Run the installer again to get it.".into()))?;
    std::process::Command::new(exe).spawn()?;
    Ok(())
}

/// The game's own exe icon as a 256 px PNG in the app's data folder, or null.
#[tauri::command]
pub async fn game_icon(st: State<'_, AppState>, game: String) -> Result<Option<String>> {
    let db = st.db.clone();
    let data = st.data_dir.clone();
    blocking(move || Ok(games::icon(&*lock(&db)?, &data, &game)?.map(|p| p.to_string_lossy().into_owned()))).await
}
