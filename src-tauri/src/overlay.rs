//! The skin menu over the game (gacha_core::live, menu style "window"): a small always-on-top window with the app's
//! own UI (src/screens/ingame/Overlay.tsx), opened by the menu key or by pressing both sticks of a controller while a
//! game runs. A window can't show over a game that holds the screen in exclusive fullscreen, so there the same key
//! opens the plainer menu the game draws itself. The key list key (gacha_core::keylist) opens the same window on its
//! Keys tab, or the key list the game draws. Owner: INGAME area.
use crate::state::{blocking, AppState};
use gacha_core::model::events;
use gacha_core::{devtools, gamecheck, keylist, launch, live, Result};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

pub const LABEL: &str = "overlay";
/// The UI listens for this to load the game the menu was opened for.
const OPENED: &str = "overlay-open";

/// The game the menu is open for.
#[derive(Default)]
pub struct Showing(Mutex<Option<String>>);

/// A pick is being sent to the game. The game comes to the front for it, which must not close the menu.
static PICKING: AtomicBool = AtomicBool::new(false);

fn window<R: Runtime>(app: &AppHandle<R>) -> Option<WebviewWindow<R>> {
    if let Some(w) = app.get_webview_window(LABEL) { return Some(w); }
    // the same browser flags as the main window, or WebView2 won't start a second window in its folder
    let w = crate::browser_flags(WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into())), crate::Flags::of(app))
        .title("gachamod menu").inner_size(960.0, 640.0).decorations(false).resizable(false).always_on_top(true)
        // the game shows through: the page sets how much (the menu's Background setting)
        .transparent(true)
        .skip_taskbar(true).visible(false).focused(false).build().ok()?;
    crate::render::watch_window(&w);
    crate::render::hook_webview(&w);
    // clicking back into the game closes the menu. A pick also brings the game forward, and the menu stays for that
    let handle = app.clone();
    w.on_window_event(move |e| {
        if let WindowEvent::Focused(false) = e { if !PICKING.load(Ordering::Relaxed) { hide(&handle); } }
    });
    Some(w)
}

/// Make the window ahead of time when a game with a menu starts, so the first press opens at once, and let it go
/// when no such game runs any more.
pub fn on_game_state<R: Runtime>(app: &AppHandle<R>) {
    let Some(st) = app.try_state::<AppState>() else { return };
    let running = launch::running_in(&launch::processes());
    // the skin menu's key or the key list's key may be the app's, each on its own
    let wanted = st.db.lock().map(|d| {
        live::menu_keys(&d).iter().any(|(g, _)| running.contains(&g.as_str()))
            || keylist::window_keys(&d).iter().any(|(g, _)| running.contains(&g.as_str()))
    }).unwrap_or(false);
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

/// Put the menu back in front with the keyboard, if it is open, and the mouse cursor back where it was (`cursor`):
/// the game held it in the middle of its window while it was in front.
fn refocus<R: Runtime>(app: &AppHandle<R>, cursor: Option<(i32, i32)>) {
    let Some(w) = app.get_webview_window(LABEL).filter(|w| w.is_visible().unwrap_or(false)) else { return };
    let _ = w.set_focus();
    #[cfg(windows)]
    if let Ok(h) = w.hwnd() { devtools::raise(h.0 as isize); }
    if let Some(at) = cursor { devtools::put_cursor(at); }
}

/// The menu key or the controller shortcut was pressed while `game` runs.
pub fn toggle<R: Runtime>(app: &AppHandle<R>, game: &str) {
    if app.get_webview_window(LABEL).is_some_and(|w| w.is_visible().unwrap_or(false)) {
        hide(app);
        let _ = devtools::show_game(game);
        return;
    }
    // the window over the game always, unless this game holds the screen in exclusive fullscreen right now
    if devtools::exclusive_fullscreen(game) {
        if !drawn_menu(app, game) {
            let _ = app.emit(events::TOAST, serde_json::json!({ "text": fullscreen_text(game), "bad": true }));
            return;
        }
        match live::send_menu_toggle(game) {
            Ok(()) => gamecheck::note_menu(game, "drawn"),
            Err(e) => { let _ = app.emit(events::TOAST, serde_json::json!({ "text": e.to_string(), "bad": true })); }
        }
        return;
    }
    gamecheck::note_menu(game, "window");
    open(app, game, None);
}

/// The game has the menu it draws itself (`live::drawn_menu_open`, or tester options are on).
fn drawn_menu<R: Runtime>(app: &AppHandle<R>, game: &str) -> bool {
    app.try_state::<AppState>().and_then(|st| st.db.lock().ok().map(|d| live::allowed(&d, game))).unwrap_or(false)
}

fn fullscreen_text(game: &str) -> String {
    let name = gacha_core::games::def(game).map_or("The game", |g| g.name);
    format!("{name} runs in exclusive fullscreen, where no window can show over it. Set the window mode to borderless to use the skin menu")
}

/// Show the menu window over `game`, on `tab` ("keys") or where it was.
fn open<R: Runtime>(app: &AppHandle<R>, game: &str, tab: Option<&str>) {
    let Some(w) = window(app) else { return };
    if let Ok(mut s) = app.state::<Showing>().0.lock() { *s = Some(game.to_string()); }
    place(&w, game);
    let _ = w.show();
    let _ = w.set_focus();
    #[cfg(windows)]
    if let Ok(h) = w.hwnd() { devtools::raise(h.0 as isize); }
    let payload = match tab {
        Some(t) => serde_json::json!({ "game": game, "tab": t }),
        None => serde_json::json!({ "game": game }),
    };
    let _ = app.emit_to(LABEL, OPENED, payload);
}

/// The game saved a change in who is on screen (`live::on_screen_moved`). The menu, when it shows for that game, asks
/// again, so a character switched in just before it opened still comes first.
pub fn on_screen_changed<R: Runtime>(app: &AppHandle<R>, game: &str) {
    if !app.get_webview_window(LABEL).is_some_and(|w| w.is_visible().unwrap_or(false)) { return; }
    let showing = app.try_state::<Showing>().and_then(|s| s.0.lock().ok().map(|g| g.as_deref() == Some(game))).unwrap_or(false);
    if showing { let _ = app.emit_to(LABEL, HERE, serde_json::json!({ "game": game })); }
}

/// The UI listens for this to read again who is on screen.
const HERE: &str = "overlay-here";

/// The key list key was pressed while `game` runs: the Keys tab of the menu window, or in exclusive fullscreen the
/// key list the game draws. A press while the window shows closes it.
pub fn toggle_keys<R: Runtime>(app: &AppHandle<R>, game: &str) {
    if app.get_webview_window(LABEL).is_some_and(|w| w.is_visible().unwrap_or(false)) {
        hide(app);
        let _ = devtools::show_game(game);
        return;
    }
    if devtools::exclusive_fullscreen(game) {
        if !drawn_menu(app, game) {
            let _ = app.emit(events::TOAST, serde_json::json!({ "text": fullscreen_text(game), "bad": true }));
            return;
        }
        if let Err(e) = live::send_keys_toggle(game) {
            let _ = app.emit(events::TOAST, serde_json::json!({ "text": e.to_string(), "bad": true }));
        }
        return;
    }
    open(app, game, Some("keys"));
}

/// The running game whose key list `combo` shows.
pub fn keys_game_for<R: Runtime>(app: &AppHandle<R>, combo: &str) -> Option<String> {
    let st = app.try_state::<AppState>()?;
    let keys = st.db.lock().ok().map(|d| keylist::window_keys(&d))?;
    let running = launch::running_in(&launch::processes());
    keys.into_iter().find(|(g, k)| k == combo && running.contains(&g.as_str())).map(|(g, _)| g)
}

/// The running game whose menu `combo` opens.
pub fn game_for<R: Runtime>(app: &AppHandle<R>, combo: &str) -> Option<String> {
    let st = app.try_state::<AppState>()?;
    let keys = st.db.lock().ok().map(|d| live::menu_keys(&d))?;
    let running = launch::running_in(&launch::processes());
    keys.into_iter().find(|(g, s)| s.key == combo && running.contains(&g.as_str())).map(|(g, _)| g)
}

/// A controller's buttons that open the menu, like the key: both sticks pressed in until the player picks others
/// (`MenuSettings::binds`, "open"). The pad is only read while a game with a menu runs.
pub fn watch_pad<R: Runtime>(app: AppHandle<R>) {
    let _ = std::thread::Builder::new().name("gachamod-pad".into()).spawn(move || {
        let mut was_down = false;
        // each game with the button sets that open its menu
        let mut games: Vec<(String, Vec<Vec<String>>)> = Vec::new();
        let mut tick = 0u32;
        loop {
            // look again every two seconds for which games want it
            if tick % 50 == 0 {
                let running = launch::running_in(&launch::processes());
                games = app.try_state::<AppState>().and_then(|st| st.db.lock().ok().map(|d| live::menu_keys(&d))).unwrap_or_default()
                    .into_iter().filter(|(g, s)| s.pad && running.contains(&g.as_str()))
                    .map(|(g, s)| { let sets = s.binds_of("open").iter().map(|b| b.split_whitespace().map(String::from).collect()).collect(); (g, sets) }).collect();
            }
            tick = tick.wrapping_add(1);
            if games.is_empty() {
                was_down = false;
                tick = 0;
                std::thread::sleep(Duration::from_secs(2));
                continue;
            }
            let held = games.iter().find(|(_, sets)| sets.iter().any(|s| devtools::pad_down(s))).map(|(g, _)| g.clone());
            if let Some(g) = &held { if !was_down { toggle(&app, g); } }
            was_down = held.is_some();
            std::thread::sleep(Duration::from_millis(40));
        }
    });
}

/// The game the menu was opened for (the UI asks when it loads).
#[tauri::command]
pub fn overlay_game(st: tauri::State<'_, Showing>) -> Option<String> { st.0.lock().ok().and_then(|s| s.clone()) }

/// The app's own window listens for this to show what the menu handed over.
pub const GO: &str = "app-go";

/// A page the menu doesn't have (Settings, Tools) or a job for the AI helper: gachamod's own window comes to the
/// front with it, made again first when gachamod runs in the background (background.rs). The menu loses the keyboard
/// to that window and closes.
#[tauri::command]
pub fn overlay_open_app(app: AppHandle, game: String, route: Option<serde_json::Value>, ai: Option<serde_json::Value>) {
    crate::background::show_with(&app, crate::Opened::Go { game, route, ai });
}

/// Close the menu and hand the keys back to the game.
#[tauri::command]
pub async fn overlay_hide(app: AppHandle, game: Option<String>) -> Result<()> {
    hide(&app);
    blocking(move || { if let Some(g) = game { let _ = devtools::show_game(&g); } Ok(()) }).await
}

/// Show a skin from the menu: the same pick as in the app, then the other windows hear the library changed.
/// `close` (the menu's "Close after picking"): the pick closes the menu and leaves the game in front, also when the
/// skin waits for a reload (the game coming forward is what lets the app press the reload key). Only a pick whose keys
/// didn't reach the game keeps the menu, so its note shows.
#[tauri::command]
pub async fn overlay_pick(app: AppHandle, st: tauri::State<'_, AppState>, game: String, group: u32, slot: u32, close: Option<bool>) -> Result<live::Picked> {
    let db = st.db.clone();
    let g = game.clone();
    // the keys go to the game, so the game comes forward while they are sent: the menu stays up through that, and
    // the cursor goes back where it was afterwards
    PICKING.store(true, Ordering::Relaxed);
    let cursor = devtools::cursor();
    let picked = blocking(move || {
        let mut picked = {
            let d = db.lock().map_err(|_| gacha_core::Error::Db("The local database is stuck after an earlier error. Restart gachamod".into()))?;
            live::pick(&d, &g, group, slot)?
        };
        picked.note = live::flush_sends(&db).into_iter().next();
        Ok(picked)
    }).await;
    if close.unwrap_or(false) && picked.as_ref().is_ok_and(|p| p.note.is_none()) {
        hide(&app);
        let g = game.clone();
        let _ = blocking(move || { let _ = devtools::show_game(&g); Ok(()) }).await;
        PICKING.store(false, Ordering::Relaxed);
        let _ = app.emit(events::LIBRARY_CHANGED, serde_json::json!({ "game": game }));
        return picked;
    }
    // and takes the keyboard back. The focus change arrives a moment later: only after it does losing focus close
    // the menu again
    refocus(&app, cursor);
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(400)).await;
        refocus(&handle, cursor);
        tokio::time::sleep(Duration::from_millis(150)).await;
        PICKING.store(false, Ordering::Relaxed);
    });
    let picked = picked?;
    let _ = app.emit(events::LIBRARY_CHANGED, serde_json::json!({ "game": game }));
    Ok(picked)
}
