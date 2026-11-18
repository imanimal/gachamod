//! gachamod in the background: running with no window, only a tray icon. The main window's WebView2 is closed then,
//! so gachamod uses almost no memory or CPU, while the menu over the game, its hotkeys, automatic reloads, downloads,
//! play time and updates keep going (they all live in this process, not the window).
//!
//! - Closing the window keeps gachamod in the background or quits, as setting "app.background" says ("1" keep, "0"
//!   quit). Unset, the first close asks (src/shell/CloseAsk.tsx); everything else counts unset as keep.
//! - Quickstart (`gachamod://play`) starts the game without the window: the window is made hidden so its page can run
//!   Play, then closed a few seconds after the game is up. When the game closes gachamod stays in the background, or
//!   quits when "app.background" is "0". "quickstart.open" ("1") opens the window instead, as before.
//! - Anything that needs the player (a question before the game starts, a game that didn't start, the menu over the
//!   game handing over a page, the tray's Open gachamod) brings the window back.
//! - `--background` (an update installed in the background starts the new version with it) starts with no window.
//!
//! Owner: SYSTEM area.

use crate::Opened;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

/// Start with no window, only the tray icon.
pub const BACKGROUND_ARG: &str = "--background";
/// "1": closing the window keeps gachamod in the background; "0": it quits. Unset: the first close asks.
const KEEP: &str = "app.background";
/// The tray menu's words, which the window saves in its language: {"open": .., "play": .., "quit": ..}.
const TRAY_LABELS: &str = "tray.labels";
const TRAY: &str = "gachamod";
/// The window asks whether to keep running (the first close).
const ASK: &str = "app-close-ask";

/// No game this long after a hidden quickstart: the window comes up, so gachamod is never left waiting unseen.
const NO_GAME_AFTER: Duration = Duration::from_secs(120);
/// A game that closes may be starting again (a launcher or Steam restarting it): gachamod waits this long first.
const AFTER_GAME: Duration = Duration::from_secs(15);
/// The hidden window has done its job this long after the game is up, and closes.
const DONE_AFTER_START: Duration = Duration::from_secs(5);
/// The window didn't take up the first-close question (a broken page): gachamod quits as a close always did.
const ASK_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Default)]
pub struct Background {
    /// The main window is hidden because quickstart started a game through it, and nothing has shown it since.
    hidden: AtomicBool,
    /// The main window was closed and gachamod keeps running, with only the tray icon.
    away: AtomicBool,
    /// A game started since the window went hidden.
    ran: AtomicBool,
    /// The main window is being made again.
    making: AtomicBool,
    /// The main window is being made, or its page hasn't asked for what it was opened with yet: links go to
    /// `Pending` rather than an event nobody hears.
    loading: AtomicBool,
    /// The window took up the first-close question.
    asked: AtomicBool,
}

fn st(app: &AppHandle) -> tauri::State<'_, Background> { app.state::<Background>() }

fn main(app: &AppHandle) -> Option<tauri::WebviewWindow> { app.get_webview_window("main") }

fn setting(app: &AppHandle, key: &str) -> Option<String> {
    app.try_state::<crate::state::AppState>().and_then(|s| s.db.lock().ok().and_then(|d| d.setting(key).ok().flatten()))
}

fn keep(app: &AppHandle) -> Option<bool> {
    match setting(app, KEEP).as_deref() { Some("1") => Some(true), Some("0") => Some(false), _ => None }
}

/// gachamod stays in the background once it has no window to show (unset counts as yes).
fn keeps_running(app: &AppHandle) -> bool { keep(app) != Some(false) }

/// gachamod runs with no window on screen: hidden for a quickstart, or in the background.
pub fn windowless(app: &AppHandle) -> bool {
    let b = st(app);
    b.away.load(Ordering::SeqCst) || b.hidden.load(Ordering::SeqCst)
}

/// The main window went away because gachamod moved to the background, not because it should quit.
pub fn away(app: &AppHandle) -> bool { st(app).away.load(Ordering::SeqCst) }

/// In the background with nothing going on: no window, no game, no download. A downloaded update can install now.
pub fn idle(app: &AppHandle) -> bool {
    if !away(app) || main(app).is_some() || !gacha_core::launch::running_games().is_empty() { return false; }
    let downloading = app.try_state::<crate::state::AppState>().map(|s| {
        let busy = crate::runner::lk(&s.queue).items.iter().any(|i| i.state.active());
        busy
    });
    downloading == Some(false)
}

// ── starting ──

/// `gachamod://play`, `gachamod://play/zzz` (the same links screens/home/quickstart.ts takes).
fn is_play_link(url: &str) -> bool {
    let u = url.trim().to_ascii_lowercase();
    let Some(rest) = u.strip_prefix("gachamod://play") else { return false };
    if rest.is_empty() { return true; }
    rest.strip_prefix('/').is_some_and(|id| id.trim_end_matches('/').chars().all(|c| c.is_ascii_alphanumeric() || c == '-'))
}

/// This start only carries quickstart links, and the setting leaves the window closed.
pub fn quiet_start(db: &gacha_core::db::Shared, opened: &[Opened]) -> bool {
    !opened.is_empty()
        && opened.iter().all(|o| matches!(o, Opened::Link { url } if is_play_link(url)))
        && db.lock().ok().and_then(|d| d.setting("quickstart.open").ok().flatten()).as_deref() != Some("1")
}

/// The first window's page hasn't asked for what gachamod started with yet.
pub fn starting(app: &AppHandle) { st(app).loading.store(true, Ordering::SeqCst); }

/// Started for a quickstart with the window hidden (the window is made, hidden, by the caller).
pub fn started_hidden(app: &AppHandle) {
    gacha_core::logs::info("Quickstart: starting the game without the window");
    hide_for_game(app);
}

/// Started with `--background`: no window, only the tray icon.
pub fn started_away(app: &AppHandle) {
    gacha_core::logs::info("Started in the background");
    st(app).away.store(true, Ordering::SeqCst);
    tray_on(app);
}

/// The window is (being) made hidden to start a game: show it if no game starts within two minutes.
fn hide_for_game(app: &AppHandle) {
    let b = st(app);
    b.hidden.store(true, Ordering::SeqCst);
    b.away.store(false, Ordering::SeqCst);
    b.ran.store(false, Ordering::SeqCst);
    tray_on(app);
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(NO_GAME_AFTER);
        let b = st(&app);
        if b.hidden.load(Ordering::SeqCst) && !b.ran.load(Ordering::SeqCst) {
            gacha_core::logs::warn("No game started two minutes after quickstart: showing the window");
            show(&app);
        }
    });
}

/// A second start (a link, a file, a shortcut) or the tray's Quickstart, with what it carries.
pub fn second_start(app: &AppHandle, opened: Vec<Opened>) {
    let quiet = app.try_state::<crate::state::AppState>().is_some_and(|s| quiet_start(&s.db, &opened));
    if main(app).is_none() {
        // in the background: the window that opens now picks these up when its page starts
        crate::pending(app, opened);
        if quiet { hide_for_game(app); make_window(app); } else { show(app); }
        return;
    }
    // quickstart while gachamod runs: only the game comes up, unless the setting opens gachamod too
    if !quiet { show(app); }
    deliver(app, opened);
}

/// Hand links and files to the window's page, or keep them for it while it loads.
fn deliver(app: &AppHandle, opened: Vec<Opened>) {
    if st(app).loading.load(Ordering::SeqCst) { crate::pending(app, opened); } else { crate::hand_to_ui(app, opened); }
}

/// The window's page asked for what it was opened with: from now on it hears events.
pub fn page_ready(app: &AppHandle) { st(app).loading.store(false, Ordering::SeqCst); }

/// Something for the window's page that must arrive even if the window has to be made first (the menu over the game
/// handing over a page): the window comes up with it.
pub fn show_with(app: &AppHandle, item: Opened) {
    if main(app).is_none() || st(app).loading.load(Ordering::SeqCst) { crate::pending(app, vec![item]); show(app); return; }
    show(app);
    crate::hand_to_ui(app, vec![item]);
}

// ── the window ──

/// Make the main window again, off the calling thread (WebView2 can't be made inside an event handler or a command).
/// It's made hidden and shown once it's there, unless it was made for a quickstart.
fn make_window(app: &AppHandle) {
    let b = st(app);
    if main(app).is_some() || b.making.swap(true, Ordering::SeqCst) { return; }
    b.loading.store(true, Ordering::SeqCst);
    let app = app.clone();
    std::thread::spawn(move || {
        let made = crate::open_main(&app);
        let b = st(&app);
        b.making.store(false, Ordering::SeqCst);
        match made {
            Ok(w) if b.away.load(Ordering::SeqCst) => { let _ = w.destroy(); }
            Ok(w) if !b.hidden.load(Ordering::SeqCst) => {
                crate::fit_to_screen(&w);
                let _ = w.show();
                let _ = w.set_focus();
            }
            Ok(_) => {}
            Err(e) => {
                gacha_core::logs::error(format!("The window didn't open: {e}"));
                b.loading.store(false, Ordering::SeqCst);
            }
        }
    });
}

/// Bring the main window up and to the front, making it again when gachamod was in the background. After a hidden
/// start it gets its size for the screen first.
pub fn show(app: &AppHandle) {
    let b = st(app);
    b.away.store(false, Ordering::SeqCst);
    let was_hidden = b.hidden.swap(false, Ordering::SeqCst);
    tray_off(app);
    let Some(w) = main(app) else { make_window(app); return };
    if was_hidden { crate::fit_to_screen(&w); }
    let _ = w.unminimize();
    let _ = w.show();
    let _ = w.set_focus();
}

/// Close the window and keep running with the tray icon. The window's WebView2 goes with it.
fn go_away(app: &AppHandle) {
    let b = st(app);
    b.hidden.store(false, Ordering::SeqCst);
    b.away.store(true, Ordering::SeqCst);
    b.loading.store(false, Ordering::SeqCst);
    let app = app.clone();
    // off the window's own event handler
    std::thread::spawn(move || {
        tray_on(&app);
        if let Some(w) = main(&app) { let _ = w.destroy(); }
        gacha_core::logs::info("Running in the background");
        settle(&app);
    });
}

/// In the background with nothing going on: a downloaded update installs now (and starts again in the background).
fn settle(app: &AppHandle) {
    if idle(app) { crate::commands::app::install_in_background(app); }
}

fn quit(app: &AppHandle) {
    gacha_core::logs::info("Quit from the tray");
    app.exit(0);
}

/// The window's close button, Alt+F4 or Close gachamod when the game starts (`ask` false: never the question).
pub fn close(app: &AppHandle, ask: bool) {
    match keep(app) {
        Some(true) => go_away(app),
        Some(false) => app.exit(0),
        None if !ask => go_away(app),
        None => {
            // the first close: the window asks, and quits as before if its page can't
            st(app).asked.store(false, Ordering::SeqCst);
            let _ = app.emit_to("main", ASK, ());
            let app = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(ASK_TIMEOUT);
                if !st(&app).asked.load(Ordering::SeqCst) {
                    gacha_core::logs::warn("The window didn't ask about running in the background: quitting");
                    app.exit(0);
                }
            });
        }
    }
}

// ── games ──

/// A game started or stopped. Without a window, the hidden one closes once the game is up, and when the last game
/// closes (and stays closed) gachamod stays in the background or quits.
pub fn on_game_state(app: &AppHandle, running: bool) {
    let b = st(app);
    if running {
        if !b.hidden.load(Ordering::SeqCst) { return; }
        b.ran.store(true, Ordering::SeqCst);
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(DONE_AFTER_START);
            if st(&app).hidden.load(Ordering::SeqCst) && !gacha_core::launch::running_games().is_empty() { go_away(&app); }
        });
        return;
    }
    if !windowless(app) { return; }
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(AFTER_GAME);
        if !windowless(&app) || !gacha_core::launch::running_games().is_empty() { return; }
        if !keeps_running(&app) {
            gacha_core::logs::info("The game closed and gachamod isn't set to stay in the background: quitting");
            app.exit(0);
        } else if st(&app).hidden.load(Ordering::SeqCst) {
            go_away(&app);
        } else {
            settle(&app);
        }
    });
}

// ── the tray icon ──

/// The tray icon, while gachamod runs with no window on screen. Click: open gachamod. Menu: Open gachamod,
/// Quickstart, Quit gachamod.
fn tray_on(app: &AppHandle) {
    if app.tray_by_id(TRAY).is_some() { return; }
    let words: serde_json::Value = setting(app, TRAY_LABELS).and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    let word = |k: &str, fallback: &str| words.get(k).and_then(|v| v.as_str()).filter(|s| !s.trim().is_empty()).unwrap_or(fallback).to_string();
    let built = (|| -> tauri::Result<()> {
        let menu = MenuBuilder::new(app)
            .item(&MenuItemBuilder::with_id("open", word("open", "Open gachamod")).build(app)?)
            .item(&MenuItemBuilder::with_id("play", word("play", "Quickstart")).build(app)?)
            .separator()
            .item(&MenuItemBuilder::with_id("quit", word("quit", "Quit gachamod")).build(app)?)
            .build()?;
        let mut tray = TrayIconBuilder::with_id(TRAY).tooltip("gachamod").menu(&menu).show_menu_on_left_click(false)
            .on_menu_event(|app, e| match e.id().as_ref() {
                "open" => show(app),
                "play" => second_start(app, vec![Opened::Link { url: gacha_core::shortcuts::PLAY_LINK.into() }]),
                "quit" => quit(app),
                _ => {}
            })
            .on_tray_icon_event(|tray, e| {
                if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e { show(tray.app_handle()); }
            });
        if let Some(icon) = app.default_window_icon() { tray = tray.icon(icon.clone()); }
        tray.build(app)?;
        Ok(())
    })();
    if let Err(e) = built { gacha_core::logs::warn(format!("The tray icon didn't show: {e}")); }
}

/// Off the calling thread: this runs from the tray icon's own click. Left alone if gachamod went windowless again
/// meanwhile.
fn tray_off(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || { if !windowless(&app) { let _ = app.remove_tray_by_id(TRAY); } });
}

// ── commands ──

/// The UI needs the player (a question, a game that didn't start): show the window.
#[tauri::command]
pub fn app_show(app: AppHandle) { show(&app); }

/// Close the window the way its close button does. `ask` false: never the first-close question (Close gachamod when
/// the game starts).
#[tauri::command]
pub fn app_close(app: AppHandle, ask: bool) { close(&app, ask); }

/// The window took up the first-close question (within two seconds, or gachamod quits as before).
#[tauri::command]
pub fn app_close_asked(app: AppHandle) { st(&app).asked.store(true, Ordering::SeqCst); }

#[cfg(test)]
mod tests {
    use super::is_play_link;

    #[test]
    fn play_links() {
        assert!(is_play_link("gachamod://play"));
        assert!(is_play_link("gachamod://play/"));
        assert!(is_play_link("GACHAMOD://play/zzz"));
        assert!(is_play_link("gachamod://play/zzz/"));
        assert!(!is_play_link("gachamod://play/zzz/x"));
        assert!(!is_play_link("gachamod://playlist"));
        assert!(!is_play_link("gachamod://mod/123"));
    }
}
