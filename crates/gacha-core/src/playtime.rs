//! Time spent in each game, counted on this PC from when gachamod sees it start until it closes, for the year card in
//! Settings, Fun extras (src/lib/playtime.ts reads it). Counted here rather than in the window, so play time adds up
//! while gachamod runs in the background with no window. Kept in the settings "stats.played" ({"2026": {"zzz": 5400}},
//! seconds by year and game, the year the session started) and "stats.playedSince" (when counting began, unix ms).
//! Settings, Fun extras has a switch ("stats.playtime", counting unless it is "0") and a reset.

use crate::db::Db;
use chrono::{Datelike, Local, TimeZone};
use std::collections::HashMap;
use std::sync::Mutex;

const PLAYED: &str = "stats.played";
const SINCE: &str = "stats.playedSince";
const TRACK: &str = "stats.playtime";
/// Shorter sessions (a crash at start, a launcher closing) don't count.
const MIN_SECS: i64 = 30;

/// When each running game was first seen, unix ms.
static STARTED: Mutex<Option<HashMap<String, i64>>> = Mutex::new(None);

/// Play time is being counted (on unless the player turned it off).
pub fn tracking(db: &Db) -> bool { db.setting(TRACK).ok().flatten().as_deref() != Some("0") }

/// A game started or stopped (the game-state watcher). A stop adds the session to the year it started in. Nothing is
/// counted while the switch is off, and a session that began before it was turned off is dropped.
pub fn note(db: &Db, game: &str, running: bool) {
    if !tracking(db) {
        if let Some(map) = STARTED.lock().unwrap_or_else(|e| e.into_inner()).as_mut() { map.remove(game); }
        return;
    }
    let now = Local::now().timestamp_millis();
    let from = {
        let mut started = STARTED.lock().unwrap_or_else(|e| e.into_inner());
        let map = started.get_or_insert_with(HashMap::new);
        if running { map.entry(game.to_string()).or_insert(now); return; }
        map.remove(game)
    };
    let Some(from) = from else { return };
    let secs = (now - from) / 1000;
    if secs < MIN_SECS { return; }
    let year = Local.timestamp_millis_opt(from).single().map_or_else(|| Local::now().year(), |d| d.year());
    let before = db.setting(PLAYED).ok().flatten();
    let _ = db.set_setting(PLAYED, &add(before.as_deref(), year, game, secs));
    if db.setting(SINCE).ok().flatten().and_then(|s| s.trim().parse::<i64>().ok()).unwrap_or(0) == 0 {
        let _ = db.set_setting(SINCE, &from.to_string());
    }
}

/// `played` (the setting's JSON, or nothing) with `secs` more for `game` in `year`.
fn add(played: Option<&str>, year: i32, game: &str, secs: i64) -> String {
    let mut all: HashMap<String, HashMap<String, i64>> = played.and_then(|p| serde_json::from_str(p).ok()).unwrap_or_default();
    *all.entry(year.to_string()).or_default().entry(game.to_string()).or_default() += secs;
    serde_json::to_string(&all).unwrap_or_else(|_| "{}".into())
}

#[cfg(test)]
mod tests {
    use super::{add, note, tracking};
    use crate::db::Db;

    #[test]
    fn the_switch_stops_counting() {
        let db = Db::memory().unwrap();
        assert!(tracking(&db));
        db.set_setting("stats.playtime", "0").unwrap();
        assert!(!tracking(&db));
        note(&db, "switch_test_game", true);
        note(&db, "switch_test_game", false);
        assert!(db.setting("stats.played").unwrap().is_none());
    }

    #[test]
    fn adds_to_the_year_and_game() {
        let once = add(None, 2026, "zzz", 100);
        let twice = add(Some(&once), 2026, "zzz", 50);
        let v: serde_json::Value = serde_json::from_str(&add(Some(&twice), 2027, "gi", 7)).unwrap();
        assert_eq!(v["2026"]["zzz"], 150);
        assert_eq!(v["2027"]["gi"], 7);
        // a broken value starts over instead of failing
        assert_eq!(add(Some("not json"), 2026, "hsr", 5), r#"{"2026":{"hsr":5}}"#);
    }
}
