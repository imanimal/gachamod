//! In-game hotkeys: key combos that switch profiles while a game runs, so the player doesn't have to alt-tab.
//! Each profile can have its own combo (the `hotkey` column of `profiles`), and two app-wide combos step to the next
//! or previous profile of the running game. The app registers them with Windows (src-tauri/src/hotkeys.rs); this
//! module holds the combo format and decides which profile a press means.
//!
//! A combo is written like "Ctrl+Alt+1": modifiers in the order Ctrl, Alt, Shift, Win, then one key. It needs Ctrl,
//! Alt or Win so it can't eat normal typing, and F10 is never allowed (it is 3DMigoto's reload key).

use crate::db::Db;
use crate::error::{Error, Result};
use rusqlite::params;

/// "0" turns every in-game hotkey off. On by default.
pub const ENABLED: &str = "hotkeys.enabled";
/// The combo that switches to the next profile of the running game. Empty or missing: off (default).
pub const NEXT: &str = "hotkeys.next";
/// The combo that switches to the previous profile. Empty or missing: off (default).
pub const PREV: &str = "hotkeys.prev";

const KEYS: &[&str] = &["Space", "Up", "Down", "Left", "Right", "Home", "End", "PageUp", "PageDown", "Insert", "Delete"];

/// The key part in its written form ("A", "1", "F5", "Num1", "PageUp"), or None when it isn't one we accept.
fn key_name(k: &str) -> Option<String> {
    let up = k.to_ascii_uppercase();
    if up.len() == 1 && up.chars().all(|c| c.is_ascii_alphanumeric()) { return Some(up); }
    if let Some(n) = up.strip_prefix('F').and_then(|n| n.parse::<u8>().ok()) {
        if (1..=24).contains(&n) { return Some(format!("F{n}")); }
    }
    if let Some(n) = up.strip_prefix("NUMPAD").or_else(|| up.strip_prefix("NUM")) {
        if n.len() == 1 && n.chars().all(|c| c.is_ascii_digit()) { return Some(format!("Num{n}")); }
    }
    KEYS.iter().find(|x| x.eq_ignore_ascii_case(k)).map(|x| x.to_string())
}

/// Check a combo and write it the one standard way: "ctrl + alt + 1" becomes "Ctrl+Alt+1".
pub fn normalize(combo: &str) -> Result<String> {
    let (mut ctrl, mut alt, mut shift, mut win) = (false, false, false, false);
    let mut key = None;
    for part in combo.split('+').map(str::trim) {
        match part.to_ascii_lowercase().as_str() {
            "ctrl" | "control" => ctrl = true,
            "alt" => alt = true,
            "shift" => shift = true,
            "win" | "super" | "meta" => win = true,
            _ => {
                if key.is_some() { return Err(Error::Invalid(format!("{combo} has more than one key. Use one key with Ctrl, Alt or Win"))); }
                key = Some(key_name(part).ok_or_else(|| Error::Invalid(format!("{part} can't be used in a hotkey. Try a letter, a number or F1 to F12")))?);
            }
        }
    }
    let key = key.ok_or_else(|| Error::Invalid("A hotkey needs a key as well as Ctrl, Alt or Win".into()))?;
    if !(ctrl || alt || win) { return Err(Error::Invalid(format!("{key} needs Ctrl, Alt or Win with it, like Ctrl+Alt+{key}"))); }
    if key == "F10" { return Err(Error::Invalid("F10 is the game's reload key. Pick another key".into())); }
    let mut out = Vec::new();
    if ctrl { out.push("Ctrl".to_string()); }
    if alt { out.push("Alt".to_string()); }
    if shift { out.push("Shift".to_string()); }
    if win { out.push("Win".to_string()); }
    out.push(key);
    Ok(out.join("+"))
}

/// The combo in the form the shortcut plugin reads ("Ctrl+Alt+Digit1", "Super+Numpad1").
pub fn plugin_form(combo: &str) -> String {
    combo.split('+').map(|p| match p {
        "Win" => "Super".to_string(),
        k if k.len() == 1 && k.chars().all(|c| c.is_ascii_digit()) => format!("Digit{k}"),
        k if k.starts_with("Num") && k.len() == 4 => format!("Numpad{}", &k[3..]),
        k => k.to_string(),
    }).collect::<Vec<_>>().join("+")
}

pub fn enabled(db: &Db) -> bool { db.setting(ENABLED).ok().flatten().as_deref() != Some("0") }

fn setting_combo(db: &Db, key: &str) -> Option<String> {
    db.setting(key).ok().flatten().and_then(|v| normalize(&v).ok())
}

/// Every combo the app should hold: each profile's own (any game) and the next/previous keys. Empty when the master
/// switch is off.
pub fn combos(db: &Db) -> Result<Vec<String>> {
    if !enabled(db) { return Ok(vec![]); }
    let mut st = db.conn.prepare("SELECT DISTINCT hotkey FROM profiles WHERE hotkey IS NOT NULL AND hotkey <> ''")?;
    let mut out: Vec<String> = st.query_map([], |r| r.get::<_, String>(0))?.filter_map(|r| r.ok()).filter_map(|c| normalize(&c).ok()).collect();
    out.extend([NEXT, PREV].iter().filter_map(|k| setting_combo(db, k)));
    out.sort();
    out.dedup();
    Ok(out)
}

/// The profile a press of `combo` switches `game` to: the game's profile with that combo, else the next or previous
/// profile when it is one of those keys. None when the combo means nothing for this game.
pub fn target(db: &Db, combo: &str, game: &str) -> Result<Option<i64>> {
    let Ok(combo) = normalize(combo) else { return Ok(None) };
    let list = crate::profiles::list(db, game)?;
    if let Some(p) = list.iter().find(|p| p.hotkey.as_deref() == Some(combo.as_str())) { return Ok(Some(p.id)); }
    let step = if setting_combo(db, NEXT).as_deref() == Some(combo.as_str()) { 1 }
        else if setting_combo(db, PREV).as_deref() == Some(combo.as_str()) { -1 }
        else { return Ok(None) };
    if list.len() < 2 { return Ok(None); }
    let at = list.iter().position(|p| p.active).unwrap_or(0) as i64;
    let n = list.len() as i64;
    Ok(Some(list[((at + step).rem_euclid(n)) as usize].id))
}

/// Give a profile its combo (None or empty clears it). Another profile of the same game with the same combo loses
/// it, so one press always means one profile.
pub fn set_for_profile(db: &Db, id: i64, combo: Option<&str>) -> Result<Option<String>> {
    let combo = match combo.map(str::trim).filter(|c| !c.is_empty()) { Some(c) => Some(normalize(c)?), None => None };
    let game: String = db.conn.query_row("SELECT game FROM profiles WHERE id = ?1", [id], |r| r.get(0))?;
    if let Some(c) = &combo {
        db.conn.execute("UPDATE profiles SET hotkey = NULL WHERE game = ?1 AND hotkey = ?2 AND id <> ?3", params![game, c, id])?;
    }
    db.conn.execute("UPDATE profiles SET hotkey = ?1 WHERE id = ?2", params![combo, id])?;
    Ok(combo)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    #[test]
    fn combos_are_written_one_way() {
        assert_eq!(normalize("ctrl + alt + 1").unwrap(), "Ctrl+Alt+1");
        assert_eq!(normalize("Shift+Win+Ctrl+a").unwrap(), "Ctrl+Shift+Win+A");
        assert_eq!(normalize("Alt+numpad3").unwrap(), "Alt+Num3");
        assert_eq!(normalize("Ctrl+pageup").unwrap(), "Ctrl+PageUp");
        assert_eq!(normalize("alt+f5").unwrap(), "Alt+F5");
        assert!(normalize("A").is_err(), "a bare key would eat typing");
        assert!(normalize("Shift+A").is_err());
        assert!(normalize("Ctrl+Alt").is_err());
        assert!(normalize("Ctrl+A+B").is_err());
        assert!(normalize("Ctrl+F10").is_err(), "F10 is the reload key");
        assert!(normalize("Ctrl+Enter").is_err());
    }

    #[test]
    fn plugin_form_uses_key_codes() {
        assert_eq!(plugin_form("Ctrl+Alt+1"), "Ctrl+Alt+Digit1");
        assert_eq!(plugin_form("Win+Num3"), "Super+Numpad3");
        assert_eq!(plugin_form("Alt+F5"), "Alt+F5");
        assert_eq!(plugin_form("Ctrl+PageUp"), "Ctrl+PageUp");
    }

    #[test]
    fn profile_hotkeys_are_stored_and_found() {
        let db = Db::memory().unwrap();
        let game = crate::games::GAMES[0].id;
        let a = crate::profiles::list(&db, game).unwrap()[0].id;
        let b = crate::profiles::create(&db, game, "Second", None).unwrap().id;
        assert_eq!(set_for_profile(&db, a, Some("alt+ctrl+1")).unwrap().as_deref(), Some("Ctrl+Alt+1"));
        assert_eq!(crate::profiles::get(&db, a).unwrap().hotkey.as_deref(), Some("Ctrl+Alt+1"));
        assert_eq!(target(&db, "Ctrl+Alt+1", game).unwrap(), Some(a));
        // the same combo on another profile of the game moves there
        set_for_profile(&db, b, Some("Ctrl+Alt+1")).unwrap();
        assert_eq!(crate::profiles::get(&db, a).unwrap().hotkey, None);
        assert_eq!(target(&db, "Ctrl+Alt+1", game).unwrap(), Some(b));
        assert_eq!(combos(&db).unwrap(), vec!["Ctrl+Alt+1".to_string()]);
        // next and previous wrap around the game's list (the first profile is active)
        db.set_setting(NEXT, "Ctrl+Alt+Right").unwrap();
        db.set_setting(PREV, "Ctrl+Alt+Left").unwrap();
        assert_eq!(target(&db, "Ctrl+Alt+Right", game).unwrap(), Some(b));
        assert_eq!(target(&db, "Ctrl+Alt+Left", game).unwrap(), Some(b));
        assert_eq!(combos(&db).unwrap().len(), 3);
        // the master switch empties the list, clearing removes the combo
        db.set_setting(ENABLED, "0").unwrap();
        assert!(combos(&db).unwrap().is_empty());
        set_for_profile(&db, b, Some("")).unwrap();
        assert_eq!(crate::profiles::get(&db, b).unwrap().hotkey, None);
        assert!(set_for_profile(&db, b, Some("Q")).is_err());
    }
}
