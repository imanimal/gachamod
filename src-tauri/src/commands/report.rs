//! Logs, crash reports, usage counts and feedback (gacha_core::logs, gacha_core::telemetry), and starting as
//! administrator. Owner: SYSTEM area.
use crate::state::{blocking, AppState};
use gacha_core::Result;
use gacha_core::telemetry::{self, Feedback, UiEvent};
use gacha_core::{devtools, gamecheck, logs};
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
    blocking(move || { for l in lines.iter().take(200) { logs::write(logs::Level::parse(&l.level), &l.text); } Ok(()) }).await
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
