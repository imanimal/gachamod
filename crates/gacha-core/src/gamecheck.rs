//! Check this game (Help menu): a player walks through switching skins while playing, and the results go to the
//! developer. This holds what gachamod reads about the game's setup by itself, whether the game took a pick and
//! whether gachamod opened the menu, and the report sent at the end. docs/testing.md lists the steps. Owner: SYSTEM
//! area.

use crate::db::{Db, Shared};
use crate::error::{Error, Result};
use crate::{devtools, games, launch, live, logs, telemetry};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

/// What gachamod can tell about a game's setup without asking.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Setup {
    pub game: String,
    pub name: String,
    /// The loader: an XXMI importer code ("ZZMI") or "3DMigoto".
    pub importer: String,
    pub via_xxmi: bool,
    pub loader_version: Option<String>,
    pub xxmi_version: Option<String>,
    /// XXMI's window mode for the game ("borderless", "fullscreen"...), when XXMI starts it.
    pub window_mode: Option<String>,
    pub running: bool,
    /// The game runs as administrator. None while it isn't running.
    pub game_admin: Option<bool>,
    pub app_admin: bool,
    /// d3dx.ini `check_foreground_window`: 1 reads keys only while the game is in front.
    pub foreground_check: Option<String>,
    /// d3dx.ini `reload_config`, the key that reloads mods (normally F10).
    pub reload_key: Option<String>,
    pub live_groups: u32,
    pub menu_style: String,
    pub menu_key: String,
    pub menu_pad: bool,
}

pub fn setup(db: &Db, game: &str) -> Result<Setup> {
    let def = games::def(game).ok_or_else(|| Error::Invalid(format!("gachamod doesn't know the game {game}")))?;
    let state = games::list(db)?.into_iter().find(|g| g.id == game).unwrap_or_default();
    let root = db.setting("xxmi.root")?.filter(|s| !s.is_empty());
    let xxmi = state.via_xxmi.then(|| crate::xxmi::status_cached(root.as_deref())).flatten();
    let pids = launch::game_pids(&launch::processes(), game);
    let d3dx = games::importer_dir(db, game).ok().and_then(|i| read_d3dx(&i));
    let menu = live::menu_settings(db, game);
    Ok(Setup {
        game: game.into(),
        name: def.name.into(),
        importer: def.importer.into(),
        via_xxmi: state.via_xxmi,
        loader_version: state.importer_version,
        xxmi_version: xxmi.and_then(|x| x.version),
        window_mode: if state.via_xxmi { crate::xxmi::importer_setting(root.as_deref(), def.importer, "window_mode") } else { None },
        running: !pids.is_empty(),
        game_admin: (!pids.is_empty()).then(|| pids.iter().any(|p| devtools::elevated(*p))),
        app_admin: devtools::self_elevated(),
        foreground_check: d3dx.as_deref().and_then(|t| d3dx_value(t, "check_foreground_window")),
        reload_key: d3dx.as_deref().and_then(|t| d3dx_value(t, "reload_config")),
        live_groups: live::info(db, game).map(|i| i.groups.len() as u32).unwrap_or(0),
        menu_style: menu.style,
        menu_key: menu.key,
        menu_pad: menu.pad,
    })
}

fn read_d3dx(importer: &Path) -> Option<String> {
    std::fs::read(importer.join("d3dx.ini")).ok().map(|b| crate::ini::decode(&b))
}

/// The first value of `key` in an ini's text, in any section, skipping comments.
fn d3dx_value(text: &str, key: &str) -> Option<String> {
    text.lines().map(str::trim).filter(|l| !l.starts_with(';') && !l.starts_with('[')).find_map(|l| {
        let (k, v) = l.split_once('=')?;
        k.trim().eq_ignore_ascii_case(key).then(|| v.split(';').next().unwrap_or("").trim().to_string())
    })
}

fn now_ms() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0) }

/// What the game last saved for a live group, and when it saved (milliseconds since 1970).
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedPick { pub value: Option<u32>, pub saved_at: Option<u64> }

/// The loader saves d3dx_user.ini 5 to 15 seconds after a pick made with a key. A value equal to the pick, saved after
/// it was made, means the game took it.
pub fn saved_pick(db: &Db, game: &str, group: u32) -> Result<SavedPick> {
    let imp = games::importer_dir(db, game)?;
    let value = crate::ini::user_value(&imp, &live::var_name(group)).and_then(|v| v.parse::<f64>().ok()).map(|v| v.max(0.0) as u32);
    let saved_at = std::fs::metadata(imp.join("d3dx_user.ini")).and_then(|m| m.modified()).ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64);
    Ok(SavedPick { value, saved_at })
}

// The menu openings gachamod handled: game, how ("window": its own menu over the game, "drawn": the one the game
// draws, in exclusive fullscreen), when.
static MENU: Mutex<Vec<(String, &'static str, u64)>> = Mutex::new(Vec::new());

/// gachamod opened the skin menu for a game (its key or the controller shortcut). `how`: "window" or "drawn".
pub fn note_menu(game: &str, how: &'static str) {
    let mut m = MENU.lock().unwrap_or_else(|e| e.into_inner());
    m.retain(|(g, _, _)| g != game);
    m.push((game.to_string(), how, now_ms()));
}

/// How gachamod last opened the menu for a game, if it did after `since` (milliseconds since 1970). None also when
/// the game took the key itself, which gachamod doesn't see.
pub fn menu_opened(game: &str, since: u64) -> Option<String> {
    let m = MENU.lock().unwrap_or_else(|e| e.into_inner());
    m.iter().find(|(g, _, at)| g == game && *at >= since).map(|(_, how, _)| how.to_string())
}

/// What the player sends at the end.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub game: String,
    /// Each step's answer and what gachamod saw, as short plain values (`pick_changed: "yes"`, `pick_saved: true`).
    #[serde(default)]
    pub steps: Map<String, Value>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub contact: Option<String>,
    /// Attach the end of gachamod's log and the loader's log, with the user's folder and name taken out.
    #[serde(default)]
    pub logs: bool,
}

fn body(db: &Db, r: &Report) -> Result<Value> {
    let s = setup(db, &r.game)?;
    let mut p = Map::new();
    let cut = |v: Option<String>| v.map(|v| json!(telemetry::text(&v, 60))).unwrap_or(Value::Null);
    p.insert("game".into(), json!(s.game));
    p.insert("importer".into(), json!(s.importer));
    p.insert("via_xxmi".into(), json!(s.via_xxmi));
    p.insert("loader_version".into(), cut(s.loader_version));
    p.insert("xxmi_version".into(), cut(s.xxmi_version));
    p.insert("window_mode".into(), cut(s.window_mode));
    p.insert("game_running".into(), json!(s.running));
    p.insert("game_admin".into(), json!(s.game_admin));
    p.insert("foreground_check".into(), cut(s.foreground_check));
    p.insert("reload_key".into(), cut(s.reload_key));
    p.insert("live_groups".into(), json!(s.live_groups));
    p.insert("menu_style".into(), json!(s.menu_style));
    p.insert("menu_key".into(), json!(telemetry::text(&s.menu_key, 40)));
    p.insert("menu_pad".into(), json!(s.menu_pad));
    for (k, v) in telemetry::plain(r.steps.clone()) { p.entry(k).or_insert(v); }
    if let Some(n) = r.notes.as_deref().map(str::trim).filter(|n| !n.is_empty()) { p.insert("notes".into(), json!(telemetry::text(n, 8000))); }
    if let Some(c) = r.contact.as_deref().map(str::trim).filter(|c| !c.is_empty()) { p.insert("contact".into(), json!(telemetry::text(c, 200))); }
    if r.logs {
        p.insert("log".into(), json!(logs::scrub(&logs::tail(20_000))));
        let loader = devtools::log_tail(db, &r.game, 200).unwrap_or_default();
        p.insert("loader_log".into(), json!(telemetry::text(&logs::scrub(&loader), 20_000)));
    }
    Ok(telemetry::hand_sent(db, "game check", p))
}

/// Send the results now. Works with usage counts off; it's the player's own choice to send.
pub async fn send(http: &reqwest::Client, db: &Shared, r: Report) -> Result<()> {
    let b = { let d = db.lock().map_err(|_| Error::Invalid("The database is busy. Try again".into()))?; body(&d, &r)? };
    telemetry::post_hand_sent(http, &b, "The check").await?;
    logs::info(format!("game check sent for {}", r.game));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn d3dx_values_skip_comments_and_trailing_notes() {
        let t = "[System]\r\n;check_foreground_window = 0\r\ncheck_foreground_window = 1 ; keys only in front\r\n[Hunting]\r\nreload_config = no_modifiers VK_F10\r\n";
        assert_eq!(d3dx_value(t, "check_foreground_window").as_deref(), Some("1"));
        assert_eq!(d3dx_value(t, "RELOAD_CONFIG").as_deref(), Some("no_modifiers VK_F10"));
        assert_eq!(d3dx_value(t, "hunting"), None);
    }

    #[test]
    fn a_menu_opening_counts_from_the_step_on() {
        note_menu("check-test", "window");
        let at = now_ms();
        assert_eq!(menu_opened("check-test", at.saturating_sub(5000)).as_deref(), Some("window"));
        assert_eq!(menu_opened("check-test", at + 60_000), None);
        assert_eq!(menu_opened("other-test", 0), None);
    }

    #[test]
    fn the_report_keeps_plain_answers_and_drops_the_rest() {
        let db = Db::memory().unwrap();
        let mut steps = Map::new();
        steps.insert("pick_changed".into(), json!("yes"));
        steps.insert("pick_saved".into(), json!(true));
        steps.insert("path".into(), json!("C:\\Users\\x\\Mods"));
        steps.insert("game".into(), json!("not this"));
        let r = Report { game: "zzz".into(), steps, notes: Some("  The menu was on the wrong screen ".into()), contact: None, logs: false };
        let b = body(&db, &r).unwrap();
        let p = &b["batch"][0]["properties"];
        assert_eq!(b["batch"][0]["event"], json!("game check"));
        assert_eq!(p["pick_changed"], json!("yes"));
        assert_eq!(p["pick_saved"], json!(true));
        assert_eq!(p["game"], json!("zzz"));
        assert_eq!(p["notes"], json!("The menu was on the wrong screen"));
        assert!(p.get("path").is_none() && p.get("log").is_none());
    }
}
