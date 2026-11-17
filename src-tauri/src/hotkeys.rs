//! In-game hotkeys (gacha_core::hotkeys): registers the combos with Windows while a game runs and switches profile
//! when one is pressed. While no game runs the keys are only checked (registered and let go at once), so they never
//! block other apps outside play.
use crate::state::AppState;
use gacha_core::model::events;
use gacha_core::{hotkeys, launch, profiles};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// Shortcut id -> combo ("Ctrl+Alt+1") for the keys held now.
#[derive(Default)]
pub struct Held(Mutex<HashMap<u32, String>>);

/// A combo Windows wouldn't give the app (another app holds it).
#[derive(Clone, serde::Serialize)]
pub struct Taken { pub combo: String, pub reason: String }

pub fn plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, sc, ev| { if ev.state() == ShortcutState::Pressed { pressed(app, sc); } })
        .build()
}

/// Register every combo again from the database. Returns the combos that couldn't be had.
pub fn sync<R: Runtime>(app: &AppHandle<R>) -> Vec<Taken> {
    let Some(st) = app.try_state::<AppState>() else { return vec![] };
    // each combo with what it does, for the message when another app holds it
    let combos: Vec<(String, &str)> = match st.db.lock() {
        Ok(d) => {
            let mut c: Vec<(String, &str)> = hotkeys::combos(&d).unwrap_or_default().into_iter().map(|k| (k, "switch profiles")).collect();
            // the key that opens the skin menu over each game (gacha_core::live, style "window")
            for (_, set) in gacha_core::live::menu_keys(&d) { if !c.iter().any(|(k, _)| *k == set.key) { c.push((set.key, "open the skin menu")); } }
            // and the key that shows the key list (gacha_core::keylist, style "window")
            for (_, key) in gacha_core::keylist::window_keys(&d) { if !c.iter().any(|(k, _)| *k == key) { c.push((key, "show the key list")); } }
            c
        }
        Err(_) => return vec![],
    };
    let held = app.state::<Held>();
    // held for the whole sync so two at once don't interleave
    let mut map = held.0.lock().unwrap_or_else(|e| e.into_inner());
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    map.clear();
    let mut taken = Vec::new();
    for (combo, job) in combos {
        let sc = match hotkeys::plugin_form(&combo).parse::<Shortcut>() {
            Ok(s) => s,
            Err(e) => { taken.push(Taken { combo, reason: e.to_string() }); continue; }
        };
        match gs.register(sc) {
            Ok(()) => { map.insert(sc.id(), combo); }
            // the words pick the button that opens the key's setting (src/lib/places.ts)
            Err(_) => taken.push(Taken { reason: format!("{combo} is used by another app, so it can't {job}. Pick another key"), combo }),
        }
    }
    if launch::running_in(&launch::processes()).is_empty() {
        let _ = gs.unregister_all();
        map.clear();
    }
    taken
}

/// A game started or stopped: hold the keys while one runs, and say when one is taken.
pub fn on_game_state<R: Runtime>(app: &AppHandle<R>, running: bool) {
    let taken = sync(app);
    if running {
        for t in taken { let _ = app.emit(events::TOAST, serde_json::json!({ "text": t.reason, "bad": true })); }
    }
}

fn pressed<R: Runtime>(app: &AppHandle<R>, sc: &Shortcut) {
    let Some(combo) = app.state::<Held>().0.lock().ok().and_then(|m| m.get(&sc.id()).cloned()) else { return };
    let app = app.clone();
    if let Some(game) = crate::overlay::keys_game_for(&app, &combo) {
        // off the thread that delivers key events: opening may make the window
        tauri::async_runtime::spawn_blocking(move || crate::overlay::toggle_keys(&app, &game));
        return;
    }
    if let Some(game) = crate::overlay::game_for(&app, &combo) {
        // off the thread that delivers key events: opening may make the window
        tauri::async_runtime::spawn_blocking(move || crate::overlay::toggle(&app, &game));
        return;
    }
    // switching renames folders: keep it off the thread that delivers key events
    tauri::async_runtime::spawn_blocking(move || {
        let toast = |text: String, bad: bool| { let _ = app.emit(events::TOAST, serde_json::json!({ "text": text, "bad": bad })); };
        let db = app.state::<AppState>().db.clone();
        for game in launch::running_in(&launch::processes()) {
            let Ok(d) = db.lock() else { return };
            if !hotkeys::enabled(&d) { return; }
            let id = match hotkeys::target(&d, &combo, game) { Ok(Some(id)) => id, _ => continue };
            if profiles::get(&d, id).is_ok_and(|p| p.active) { continue; }
            // the same switch the profile screen makes; it marks the game changed, and the reload watcher presses
            // F10 (unless auto reload is off) since the game is in front
            let r = profiles::activate(&d, id);
            drop(d);
            // live skins switch at once: the game is in front, so the taps reach it
            let missed = gacha_core::live::flush_sends(&db);
            match r {
                Ok(r) => {
                    let _ = app.emit(events::LIBRARY_CHANGED, serde_json::json!({ "game": game }));
                    let mut text = format!("Switched to {}", r.profile.name);
                    if r.vars_pending { text.push_str(". Mod options apply after you close the game"); }
                    toast(format!("{text}."), false);
                    for m in missed { toast(m, false); }
                }
                Err(e) => toast(e.to_string(), true),
            }
        }
    });
}

/// Register the hotkeys again after a profile's combo or a hotkey setting changed.
#[tauri::command]
pub async fn hotkeys_sync(app: AppHandle) -> gacha_core::Result<Vec<Taken>> {
    crate::state::blocking(move || Ok(sync(&app))).await
}
