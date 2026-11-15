//! The menu over the game (its settings are gacha_core::live's menu settings): a small always-on-top window with the
//! app's own UI (src/screens/ingame/Overlay.tsx), opened by the menu key or by pressing both sticks of a controller
//! while a game runs. Picking a character's skin turns it on and the character's other mods off; the menu closes and
//! the game reloads its mods when it is back in front. A window can't show over a game that holds the screen in
//! exclusive fullscreen, so there the key only says so. Owner: INGAME area.
use crate::state::{blocking, AppState};
use gacha_core::model::events;
use gacha_core::{devtools, gamecheck, launch, library, live, Result};
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
        .title("gachamod menu").inner_size(960.0, 640.0).decorations(false).resizable(false).always_on_top(true)
        .skip_taskbar(true).visible(false).focused(false).build().ok()?;
    // clicking back into the game closes the menu
    let handle = app.clone();
    w.on_window_event(move |e| { if let WindowEvent::Focused(false) = e { hide(&handle); } });
    Some(w)
}

/// Make the window ahead of time when a game whose menu is on starts, so the first press opens at once, and let it
/// go when no such game runs any more.
pub fn on_game_state<R: Runtime>(app: &AppHandle<R>) {
    let Some(st) = app.try_state::<AppState>() else { return };
    let running = launch::running_in(&launch::processes());
    let wanted = st.db.lock().map(|d| live::menu_keys(&d).iter().any(|(g, _)| running.contains(&g.as_str()))).unwrap_or(false);
    if wanted { let _ = window(app); } else if let Some(w) = app.get_webview_window(LABEL) { let _ = w.destroy(); }
}

pub fn hide<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window(LABEL) { let _ = w.hide(); }
}

/// Down the left side of the game's window: wide enough for the characters and a grid of skins, as tall as fits,
/// and never wider or taller than the game.
fn place<R: Runtime>(w: &WebviewWindow<R>, game: &str) {
    let Some((x, y, gw, gh)) = devtools::game_rect(game) else { let _ = w.center(); return };
    let scale = w.scale_factor().unwrap_or(1.0);
    let px = |v: f64| (v * scale).round() as i32;
    let margin = px(40.0);
    let height = ((gh as f64 * 0.78) as i32).clamp(px(420.0), px(860.0)).min(gh.max(px(240.0)));
    let width = ((gw as f64 * 0.58) as i32).clamp(px(640.0), px(1040.0)).min((gw - margin).max(px(360.0)));
    let _ = w.set_size(PhysicalSize::new(width as u32, height as u32));
    let _ = w.set_position(PhysicalPosition::new(x + margin.min((gw - width).max(0)), y + (gh - height) / 2));
}

/// The menu key or the controller shortcut was pressed while `game` runs.
pub fn toggle<R: Runtime>(app: &AppHandle<R>, game: &str) {
    if app.get_webview_window(LABEL).is_some_and(|w| w.is_visible().unwrap_or(false)) {
        hide(app);
        let _ = devtools::show_game(game);
        return;
    }
    if devtools::exclusive_fullscreen() {
        // nothing can show over it: say so in gachamod's window, where it is seen after the game
        gamecheck::note_menu(game, "fullscreen");
        let name = gacha_core::games::def(game).map_or("the game", |g| g.name);
        let text = format!("The menu can't show over {name} in exclusive fullscreen. Set the game to borderless or windowed in its display settings");
        let _ = app.emit(events::TOAST, serde_json::json!({ "text": text, "bad": true }));
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

/// Pick a character's skin from the menu: `id` turns on and the character's other mods turn off (no id: all of them
/// off, so the character wears the game's own look). The game reloads its mods once it is back in front (the menu
/// closes for that, see Overlay.tsx). Returns what went wrong ("Couldn't change ..."), if anything.
#[tauri::command]
pub async fn overlay_pick(app: AppHandle, st: tauri::State<'_, AppState>, game: String, character: String, id: Option<String>) -> Result<Vec<String>> {
    let db = st.db.clone();
    let g = game.clone();
    let notes = blocking(move || {
        let d = db.lock().map_err(|_| gacha_core::Error::Db("The local database is stuck after an earlier error. Restart gachamod".into()))?;
        let change = match id {
            Some(id) => library::set_enabled_with(&d, &g, &[id], true, Some(true))?,
            None => {
                let on: Vec<String> = library::list(&d, &g)?.into_iter()
                    .filter(|m| m.enabled && m.character.as_deref().is_some_and(|c| c.eq_ignore_ascii_case(&character)))
                    .map(|m| m.id).collect();
                if on.is_empty() { return Ok(Vec::new()); }
                library::set_enabled(&d, &g, &on, false)?
            }
        };
        // what went wrong keeps the menu open to say so; the rest (sub-mods that went along) the cards show
        Ok(change.notes.into_iter().filter(|n| n.starts_with("Couldn't")).collect())
    }).await?;
    gamecheck::note_menu(&game, "picked");
    let _ = app.emit(events::LIBRARY_CHANGED, serde_json::json!({ "game": game }));
    Ok(notes)
}
