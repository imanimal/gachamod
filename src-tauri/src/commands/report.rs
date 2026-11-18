//! Logs, crash reports, usage counts and feedback (gacha_core::logs, gacha_core::telemetry), starting as
//! administrator, and the desktop shortcuts (gacha_core::shortcuts). Owner: SYSTEM area.
use crate::state::{blocking, AppState};
use gacha_core::Result;
use gacha_core::telemetry::{self, Feedback, UiEvent};
use gacha_core::{devtools, gamecheck, logs, shortcuts};
use tauri::State;

fn lock(db: &gacha_core::db::Shared) -> Result<std::sync::MutexGuard<'_, gacha_core::db::Db>> {
    db.lock().map_err(|_| gacha_core::Error::Db("The local database is stuck after an earlier error. Restart gachamod".into()))
}

#[tauri::command]
pub async fn report_state(st: State<'_, AppState>) -> Result<telemetry::State> {
    let db = st.db.clone();
    blocking(move || Ok(telemetry::state(&*lock(&db)?))).await
}

/// Turn usage counts or crash reports on or off.
#[tauri::command]
pub async fn report_set(st: State<'_, AppState>, usage: Option<bool>, crashes: Option<bool>) -> Result<telemetry::State> {
    let db = st.db.clone();
    blocking(move || telemetry::set(&*lock(&db)?, usage, crashes)).await
}

/// Usage events from the window, sent with the next batch.
#[tauri::command]
pub async fn telemetry_events(st: State<'_, AppState>, events: Vec<UiEvent>) -> Result<()> {
    let db = st.db.clone();
    blocking(move || { telemetry::note(&*lock(&db)?, events); Ok(()) }).await
}

#[tauri::command]
pub async fn feedback_send(st: State<'_, AppState>, feedback: Feedback) -> Result<()> {
    telemetry::send_feedback(&st.http, &st.db, feedback).await
}

#[derive(serde::Deserialize)]
pub struct LogLine { level: String, text: String }

/// Lines for gachamod.log from the window (failed calls, warnings).
#[tauri::command]
pub async fn log_write(lines: Vec<LogLine>) -> Result<()> {
    blocking(move || { for l in lines.iter().take(200) { logs::write_from_window(logs::Level::parse(&l.level), &l.text); } Ok(()) }).await
}

/// The end of gachamod.log, at most `max` bytes (for the console).
#[tauri::command]
pub async fn log_tail(max: usize) -> Result<String> {
    blocking(move || Ok(logs::tail(max.min(2_000_000)))).await
}

/// An error in the window's code, kept as a crash report.
#[tauri::command]
pub async fn report_ui_error(message: String, stack: String) -> Result<()> {
    blocking(move || { telemetry::ui_error(&message, &stack); Ok(()) }).await
}

// ── Check this game (gacha_core::gamecheck) ──

/// What gachamod reads about a game's setup by itself.
#[tauri::command]
pub async fn game_check_setup(st: State<'_, AppState>, game: String) -> Result<gamecheck::Setup> {
    let db = st.db.clone();
    blocking(move || gamecheck::setup(&*lock(&db)?, &game)).await
}

/// What the game last saved for a live group, and when.
#[tauri::command]
pub async fn game_check_saved(st: State<'_, AppState>, game: String, group: u32) -> Result<gamecheck::SavedPick> {
    let db = st.db.clone();
    blocking(move || gamecheck::saved_pick(&*lock(&db)?, &game, group)).await
}

/// How gachamod opened the skin menu for the game since `since` (ms since 1970), if it did.
#[tauri::command]
pub fn game_check_menu(game: String, since: u64) -> Option<String> { gamecheck::menu_opened(&game, since) }

#[tauri::command]
pub async fn game_check_send(st: State<'_, AppState>, report: gamecheck::Report) -> Result<()> {
    gamecheck::send(&st.http, &st.db, report).await
}

#[derive(serde::Serialize)]
pub struct AdminState { elevated: bool, always: bool }

fn admin_now() -> AdminState { AdminState { elevated: devtools::self_elevated(), always: devtools::always_admin() } }

#[tauri::command]
pub async fn admin_state() -> Result<AdminState> { blocking(|| Ok(admin_now())).await }

/// Start as administrator every time (from the next start), or stop.
#[tauri::command]
pub async fn admin_set_always(on: bool) -> Result<AdminState> {
    blocking(move || {
        devtools::set_always_admin(on)?;
        logs::info(if on { "gachamod starts as administrator from now on" } else { "gachamod no longer starts as administrator" });
        Ok(admin_now())
    }).await
}

/// Which desktop shortcuts are there: gachamod's, quickstart's and the games' own quickstarts.
#[tauri::command]
pub async fn shortcuts_state() -> Result<shortcuts::State> { blocking(|| Ok(shortcuts::state())).await }

/// Make a desktop shortcut (again).
#[tauri::command]
pub async fn shortcuts_create(st: State<'_, AppState>, kind: shortcuts::Kind) -> Result<shortcuts::State> {
    let (db, data) = (st.db.clone(), st.data_dir.clone());
    blocking(move || {
        let s = shortcuts::create(kind, &*lock(&db)?, &data)?;
        logs::info(format!("Made the {kind:?} shortcut on the desktop"));
        Ok(s)
    }).await
}

/// Take a desktop shortcut away.
#[tauri::command]
pub async fn shortcuts_remove(kind: shortcuts::Kind) -> Result<shortcuts::State> { blocking(move || shortcuts::remove(kind)).await }

/// Make a game's own quickstart on the desktop (again), with the game's icon.
#[tauri::command]
pub async fn shortcuts_create_game(st: State<'_, AppState>, game: String) -> Result<shortcuts::State> {
    let (db, data) = (st.db.clone(), st.data_dir.clone());
    blocking(move || {
        let s = shortcuts::create_game(&game, &*lock(&db)?, &data)?;
        logs::info(format!("Made the {game} quickstart on the desktop"));
        Ok(s)
    }).await
}

#[tauri::command]
pub async fn shortcuts_remove_game(game: String) -> Result<shortcuts::State> { blocking(move || shortcuts::remove_game(&game)).await }

/// The game the quickstart shortcut starts is now `game`: its icon follows.
#[tauri::command]
pub async fn shortcuts_follow(st: State<'_, AppState>, game: String) -> Result<()> {
    let (db, data) = (st.db.clone(), st.data_dir.clone());
    blocking(move || shortcuts::follow(&game, &*lock(&db)?, &data)).await
}
