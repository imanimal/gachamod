//! The skin menu over the game (gacha_core::live, menu style "window"): a small always-on-top window with the app's
//! own UI (src/screens/ingame/Overlay.tsx), opened by the menu key or by pressing both sticks of a controller while a
//! game runs. A window can't show over a game that holds the screen in exclusive fullscreen, so there the same key
//! opens the plainer menu the game draws itself. Owner: INGAME area.
use crate::state::{blocking, AppState};
use gacha_core::model::events;
use gacha_core::{devtools, gamecheck, launch, live, Result};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

pub const LABEL: &str = "overlay";
/// The UI listens for this to load the game the menu was opened for.
const OPENED: &str = "overlay-open";

/// The game the menu is open for.
#[derive(Default)]
pub struct Showing(Mutex<Option<String>>);

fn window<R: Runtime>(app: &AppHandle<R>) -> Option<WebviewWindow<R>> {
    if let Some(w) = app.get_webview_window(LABEL) { return Some(w); }
    let w = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
        .title("gachamod skins").inner_size(460.0, 640.0).decorations(false).resizable(false).always_on_top(true)
        .skip_taskbar(true).visible(false).focused(false).build().ok()?;
    // clicking back into the game (or a pick, which brings the game forward) closes the menu
    let handle = app.clone();
    w.on_window_event(move |e| { if let WindowEvent::Focused(false) = e { hide(&handle); } });
    Some(w)
}

/// Make the window ahead of time when a game with a menu starts, so the first press opens at once, and let it go
/// when no such game runs any more.
pub fn on_game_state<R: Runtime>(app: &AppHandle<R>) {
    let Some(st) = app.try_state::<AppState>() else { return };
    let running = launch::running_in(&launch::processes());
    let wanted = st.db.lock().map(|d| live::menu_keys(&d).iter().any(|(g, _)| running.contains(&g.as_str()))).unwrap_or(false);
    if wanted { let _ = window(app); } else if let Some(w) = app.get_webview_window(LABEL) { let _ = w.destroy(); }
}

pub fn hide<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window(LABEL) { let _ = w.hide(); }
}

/// Down the left side of the game's window, as tall as fits.
fn place<R: Runtime>(w: &WebviewWindow<R>, game: &str) {
    let Some((x, y, _, gh)) = devtools::game_rect(game) else { let _ = w.center(); return };
    let scale = w.scale_factor().unwrap_or(1.0);
    let px = |v: f64| (v * scale).round() as i32;
    let height = ((gh as f64 * 0.72) as i32).clamp(px(360.0), px(780.0)).min(gh.max(px(240.0)));
    let _ = w.set_size(PhysicalSize::new(px(460.0) as u32, height as u32));
    let _ = w.set_position(PhysicalPosition::new(x + px(40.0), y + (gh - height) / 2));
}

/// The menu key or the controller shortcut was pressed while `game` runs.
pub fn toggle<R: Runtime>(app: &AppHandle<R>, game: &str) {
    if app.get_webview_window(LABEL).is_some_and(|w| w.is_visible().unwrap_or(false)) {
        hide(app);
        let _ = devtools::show_game(game);
        return;
    }
    if devtools::exclusive_fullscreen() {
        match live::send_menu_toggle(game) {
            Ok(()) => gamecheck::note_menu(game, "drawn"),
            Err(e) => { let _ = app.emit(events::TOAST, serde_json::json!({ "text": e.to_string(), "bad": true })); }
        }
        return;
    }
    let Some(w) = window(app) else { return };
    gamecheck::note_menu(game, "window");
    if let Ok(mut s) = app.state::<Showing>().0.lock() { *s = Some(game.to_string()); }
    place(&w, game);
    let _ = w.show();
    let _ = w.set_focus();
    #[cfg(windows)]
    if let Ok(h) = w.hwnd() { devtools::raise(h.0 as isize); }
    let _ = app.emit_to(LABEL, OPENED, serde_json::json!({ "game": game }));
}

/// The running game whose menu `combo` opens.
pub fn game_for<R: Runtime>(app: &AppHandle<R>, combo: &str) -> Option<String> {
    let st = app.try_state::<AppState>()?;
    let keys = st.db.lock().ok().map(|d| live::menu_keys(&d))?;
    let running = launch::running_in(&launch::processes());
    keys.into_iter().find(|(g, s)| s.key == combo && running.contains(&g.as_str())).map(|(g, _)| g)
}

/// Both sticks pressed in opens the menu, like the key. The pad is only read while a game with a menu runs.
pub fn watch_pad<R: Runtime>(app: AppHandle<R>) {
    let _ = std::thread::Builder::new().name("gachamod-pad".into()).spawn(move || {
        let mut was_down = false;
        let mut games: Vec<String> = Vec::new();
        let mut tick = 0u32;
        loop {
            // look again every two seconds for which games want it
            if tick % 50 == 0 {
                let running = launch::running_in(&launch::processes());
                games = app.try_state::<AppState>().and_then(|st| st.db.lock().ok().map(|d| live::menu_keys(&d))).unwrap_or_default()
                    .into_iter().filter(|(g, s)| s.pad && running.contains(&g.as_str())).map(|(g, _)| g).collect();
            }
            tick = tick.wrapping_add(1);
            if games.is_empty() {
                was_down = false;
                tick = 0;
                std::thread::sleep(Duration::from_secs(2));
                continue;
            }
            let down = devtools::pad_sticks_down();
            if down && !was_down { toggle(&app, &games[0]); }
            was_down = down;
            std::thread::sleep(Duration::from_millis(40));
        }
    });
}

/// The game the menu was opened for (the UI asks when it loads).
#[tauri::command]
pub fn overlay_game(st: tauri::State<'_, Showing>) -> Option<String> { st.0.lock().ok().and_then(|s| s.clone()) }

/// Close the menu and hand the keys back to the game.
#[tauri::command]
pub async fn overlay_hide(app: AppHandle, game: Option<String>) -> Result<()> {
    hide(&app);
    blocking(move || { if let Some(g) = game { let _ = devtools::show_game(&g); } Ok(()) }).await
}

/// Show a skin from the menu: the same pick as in the app, then the other windows hear the library changed.
#[tauri::command]
pub async fn overlay_pick(app: AppHandle, st: tauri::State<'_, AppState>, game: String, group: u32, slot: u32) -> Result<live::Picked> {
    let db = st.db.clone();
    let g = game.clone();
    let picked = blocking(move || {
        let mut picked = {
            let d = db.lock().map_err(|_| gacha_core::Error::Db("The local database is stuck after an earlier error. Restart gachamod".into()))?;
            live::pick(&d, &g, group, slot)?
        };
        picked.note = live::flush_sends(&db).into_iter().next();
        Ok(picked)
    }).await?;
    let _ = app.emit(events::LIBRARY_CHANGED, serde_json::json!({ "game": game }));
    Ok(picked)
}
