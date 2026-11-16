//! The key list: each mod's toggle keys, shown while playing (docs/ingame.md, "The key list"). Many mods show their
//! own key help in game (a picture or panel behind a key of their own); those are left out unless the player wants
//! them. The list shows in two places: the Keys tab of gachamod's menu over the game (Overlay.tsx), and a panel the
//! game draws in its top right corner for the character on screen (live/menu.rs), which also works in exclusive
//! fullscreen. Both ride on the in-game menu, so the game needs characters that switch in game (live.rs).
//!
//! Settings, per game: `<game>.keyList` ("0" turns it off), `<game>.keyListStyle` ("window" or "game"),
//! `<game>.keyListKey` (a hotkey, F8 by default), `<game>.keyListOwn` ("1": also mods with their own help), and the
//! player's pick per mod in `keyList.pick.<game>` (mod id -> shown or not). Owner: INGAME area.

use crate::db::Db;
use crate::error::{Error, Result};
use crate::keys::{self, KeyEntry};
use crate::model::ModEntry;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

/// F6 and F12 are the loaders' own keys, F7 opens the skin menu, F10 reloads.
pub const KEY: &str = "F8";

/// The key list is held back for now: off everywhere, and the UI hides it (`KEY_LIST_SHOWN` in src/lib/api/keylist.ts).
/// Set both to true to bring it back; the player's saved settings are kept meanwhile.
pub const SHOWN: bool = false;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KeyRow {
    /// Readable ("F6", "Ctrl+H", "Pad LB+Pad A"), keys turned off left out.
    pub keys: Vec<String>,
    /// What it changes ("Jacket").
    pub what: String,
    /// "cycle", "toggle", "hold" or "activate".
    pub kind: String,
    /// Values a cycle steps through (2 for an on/off switch), 0 for hold and activate.
    pub options: u32,
    /// It only works while the character is on screen.
    pub on_screen: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModKeyList {
    pub mod_id: String,
    pub name: String,
    pub character: Option<String>,
    pub preview: Option<String>,
    pub live: bool,
    /// On, or the live skin its character shows now.
    pub showing: bool,
    /// The mod shows its own key help in game.
    pub own_help: bool,
    /// The key that shows it, when one was found.
    pub help_key: Option<String>,
    /// The player's own pick (None: automatic).
    pub choice: Option<bool>,
    /// It shows in the key lists.
    pub listed: bool,
    pub rows: Vec<KeyRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KeyListSettings { pub on: bool, pub style: String, pub key: String, pub own: bool }

impl Default for KeyListSettings {
    fn default() -> Self { KeyListSettings { on: true, style: "window".into(), key: KEY.into(), own: false } }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyList { pub settings: KeyListSettings, pub available: bool, pub mods: Vec<ModKeyList> }

// ── settings ──

fn picks_key(game: &str) -> String { format!("keyList.pick.{game}") }
fn picks(db: &Db, game: &str) -> HashMap<String, bool> { db.setting_json(&picks_key(game)).ok().flatten().unwrap_or_default() }

pub fn settings(db: &Db, game: &str) -> KeyListSettings {
    let get = |k: &str| db.setting(&format!("{game}.{k}")).ok().flatten();
    KeyListSettings {
        on: SHOWN && get("keyList").as_deref() != Some("0"),
        style: if get("keyListStyle").as_deref() == Some("game") { "game" } else { "window" }.into(),
        key: get("keyListKey").and_then(|k| crate::hotkeys::normalize_menu(&k).ok()).unwrap_or_else(|| KEY.into()),
        own: get("keyListOwn").as_deref() == Some("1"),
    }
}

/// Change the settings, then write live.ini again (the game reloads once for a drawn list).
pub fn set(db: &Db, game: &str, s: &KeyListSettings) -> Result<KeyListSettings> {
    if !["window", "game"].contains(&s.style.as_str()) { return Err(Error::Invalid("Pick Over the game or Inside the game".into())); }
    let key = crate::hotkeys::normalize_menu(&s.key)?;
    // a key list that's off holds no key, so it can't clash
    if s.on {
        if key == crate::live::menu_settings(db, game).key { return Err(Error::Invalid(format!("{key} already opens the skin menu. Pick another key"))); }
        if crate::hotkeys::combos(db).unwrap_or_default().contains(&key) { return Err(Error::Invalid(format!("{key} already switches a profile. Pick another key"))); }
    }
    db.set_setting(&format!("{game}.keyList"), if s.on { "1" } else { "0" })?;
    db.set_setting(&format!("{game}.keyListStyle"), &s.style)?;
    db.set_setting(&format!("{game}.keyListKey"), &key)?;
    db.set_setting(&format!("{game}.keyListOwn"), if s.own { "1" } else { "0" })?;
    crate::live::menu_sync(db, game);
    Ok(settings(db, game))
}

/// Show (Some(true)) or leave out (Some(false)) one mod, or go back to automatic (None).
pub fn choose(db: &Db, game: &str, mod_id: &str, listed: Option<bool>) -> Result<ModKeyList> {
    let m = crate::library::get(db, game, mod_id)?;
    let mut all = picks(db, game);
    match listed { Some(v) => { all.insert(mod_id.to_string(), v); } None => { all.remove(mod_id); } }
    db.set_setting_json(&picks_key(game), &all)?;
    crate::live::menu_sync(db, game);
    let live = crate::live::groups_by_mod(db, game);
    of_mod(&m, live.contains_key(&m.id), &all, settings(db, game).own).ok_or_else(|| Error::Invalid(format!("{} has no keys", m.name)))
}

// ── reading a mod ──

/// The rows of a mod's keys, the sections with every key off left out.
pub(crate) fn rows(entries: &[KeyEntry]) -> Vec<KeyRow> {
    entries.iter().filter(|e| !e.off).filter_map(|e| {
        let mut keys: Vec<String> = Vec::new();
        for l in e.lines.iter().filter(|l| !l.off && !l.label.is_empty()) {
            if !keys.contains(&l.label) { keys.push(l.label.clone()); }
        }
        if keys.is_empty() { return None; }
        let options = match e.kind.as_str() {
            "cycle" => e.vars.iter().map(|v| v.values.len() as u32).max().unwrap_or(0),
            "toggle" => 2,
            _ => 0,
        };
        Some(KeyRow { keys, what: e.name.clone(), kind: e.kind.clone(), options, on_screen: e.on_screen })
    }).collect()
}

/// Words that name a help picture or panel. Long ones count anywhere in a name, short ones only as a whole word.
const HELP_ANY: &[&str] = &["help", "info", "guide", "hint", "tutorial", "instruction", "keybind", "hotkey", "cheat", "legend", "tooltip", "controls", "readme"];
const HELP_WORD: &[&str] = &["ui", "hud", "menu", "keys", "tips", "panel", "manual"];

/// Split "KeyToggleHelp" or "show_info2" into lowercase words.
fn words(s: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut prev_lower = false;
    for c in s.chars() {
        if !c.is_alphabetic() {
            if !cur.is_empty() { out.push(std::mem::take(&mut cur)); }
            prev_lower = false;
            continue;
        }
        if c.is_uppercase() && prev_lower && !cur.is_empty() { out.push(std::mem::take(&mut cur)); }
        prev_lower = c.is_lowercase();
        cur.extend(c.to_lowercase());
    }
    if !cur.is_empty() { out.push(cur); }
    out
}

pub(crate) fn names_help(s: &str) -> bool {
    let lower = s.to_lowercase();
    if HELP_ANY.iter().any(|w| lower.contains(w)) { return true; }
    words(s).iter().any(|w| HELP_WORD.contains(&w.as_str()))
}

/// Whether the mod shows its own key help, and the key that shows it. A key section whose name or variables name a
/// help panel ("[KeyHelp]", "$showinfo") counts, and so does a picture with such a name ("ToggleGuide.dds") behind
/// any key of the mod.
pub(crate) fn own_help(dir: &Path, inis: &[String], entries: &[KeyEntry]) -> (bool, Option<String>) {
    let section_name = |e: &KeyEntry| e.section.strip_prefix("Key").or_else(|| e.section.strip_prefix("key")).unwrap_or(&e.section).to_string();
    let label = |e: &KeyEntry| e.lines.iter().find(|l| !l.off && !l.pad).or_else(|| e.lines.iter().find(|l| !l.off)).map(|l| l.label.clone());
    if let Some(e) = entries.iter().filter(|e| !e.off).find(|e| names_help(&section_name(e)) || e.vars.iter().any(|v| names_help(&v.var))) {
        return (true, label(e));
    }
    if entries.iter().all(|e| e.off) { return (false, None); }
    for rel in inis {
        let Ok(bytes) = std::fs::read(dir.join(rel)) else { continue };
        let text = String::from_utf8_lossy(&bytes);
        for line in text.lines() {
            let t = line.trim();
            if t.starts_with(';') { continue; }
            let Some((k, v)) = t.split_once('=') else { continue };
            if !k.trim().eq_ignore_ascii_case("filename") { continue; }
            let file = v.trim().trim_matches('"').replace('\\', "/");
            let name = file.rsplit('/').next().unwrap_or(&file).to_lowercase();
            let picture = [".dds", ".png", ".jpg", ".jpeg"].iter().any(|x| name.ends_with(x));
            let stem = name.rsplit_once('.').map_or(name.as_str(), |(s, _)| s);
            if picture && (names_help(stem) || stem.contains("toggle")) { return (true, None); }
        }
    }
    (false, None)
}

fn of_mod(m: &ModEntry, live: bool, picks: &HashMap<String, bool>, own: bool) -> Option<ModKeyList> {
    let dir = Path::new(&m.path);
    if !dir.is_dir() { return None; }
    let k = keys::keys_in(&m.id, dir);
    let rows = rows(&k.keys);
    if rows.is_empty() { return None; }
    let (own_help, help_key) = own_help(dir, &k.inis, &k.keys);
    let choice = picks.get(&m.id).copied();
    Some(ModKeyList {
        mod_id: m.id.clone(), name: m.name.clone(), character: m.character.clone(), preview: m.preview.clone(),
        live, showing: m.enabled, own_help, help_key, choice, listed: choice.unwrap_or(own || !own_help), rows,
    })
}

/// Every mod of the game that has keys: showing ones first, then by character and name.
pub fn list(db: &Db, game: &str) -> Result<KeyList> {
    let set = settings(db, game);
    let live = crate::live::groups_by_mod(db, game);
    let picks = picks(db, game);
    let mods = crate::library::list(db, game)?;
    // mods that are on, and live skins on standby (their folders are on too)
    let mut out: Vec<ModKeyList> = mods.iter().filter(|m| m.has_keys && m.loaded())
        .filter_map(|m| of_mod(m, live.contains_key(&m.id), &picks, set.own)).collect();
    let low = |s: &Option<String>| s.as_deref().map_or_else(|| "\u{10ffff}".to_string(), str::to_lowercase);
    out.sort_by(|a, b| b.showing.cmp(&a.showing).then(low(&a.character).cmp(&low(&b.character))).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(KeyList { settings: set, available: !live.is_empty(), mods: out })
}

/// The listed mods among `ids` with their rows, for the panel the game draws (live skins only: the game knows which
/// character is on screen from them). Empty when the key list is off.
pub(crate) fn listed_rows(db: &Db, game: &str, ids: &[&str]) -> HashMap<String, (String, Vec<KeyRow>)> {
    let set = settings(db, game);
    if !set.on { return HashMap::new(); }
    let picks = picks(db, game);
    let mods = crate::library::list(db, game).unwrap_or_default();
    mods.iter().filter(|m| ids.contains(&m.id.as_str()))
        .filter_map(|m| of_mod(m, true, &picks, set.own))
        .filter(|k| k.listed)
        .map(|k| (k.mod_id.clone(), (k.name, k.rows)))
        .collect()
}

/// The games whose key list key the app holds (the list shows in gachamod's window), with that key.
pub fn window_keys(db: &Db) -> Vec<(String, String)> {
    crate::live::menu_keys_all(db).into_iter().filter_map(|(g, reach)| {
        let s = settings(db, &g);
        (s.on && s.style == "window" && reach).then_some((g, s.key))
    }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keys::KeyLine;

    fn entry(section: &str, var: &str, kind: &str, values: &[&str], key: &str) -> KeyEntry {
        KeyEntry {
            ini: "a.ini".into(), section: section.into(), kind: kind.into(), name: section.trim_start_matches("Key").into(),
            vars: vec![crate::ini::KeyVar { var: var.into(), values: values.iter().map(|s| s.to_string()).collect() }],
            lines: vec![KeyLine { field: "key".into(), value: key.into(), label: key.into(), ..Default::default() }],
            ..Default::default()
        }
    }

    #[test]
    fn help_names() {
        assert!(names_help("Help"));
        assert!(names_help("showinfo"));
        assert!(names_help("ToggleUI"));
        assert!(names_help("show_keys"));
        assert!(!names_help("Suit"));
        assert!(!names_help("Jacket"));
        assert!(!names_help("swapvar"));
        assert!(!names_help("Building"));
    }

    #[test]
    fn own_help_from_a_key_or_a_picture() {
        let dir = std::env::temp_dir().join(format!("gachamod-keylist-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let jacket = entry("KeyJacket", "jacket", "cycle", &["0", "1", "2"], "F6");
        let help = entry("KeyHelp", "swapvar", "toggle", &["0", "1"], "H");
        assert_eq!(own_help(&dir, &[], &[jacket.clone(), help]), (true, Some("H".into())));
        std::fs::write(dir.join("a.ini"), "[ResourceGuide]\nfilename = Textures/ToggleGuide.dds\n").unwrap();
        assert_eq!(own_help(&dir, &["a.ini".into()], std::slice::from_ref(&jacket)), (true, None));
        std::fs::write(dir.join("a.ini"), "[ResourceBody]\nfilename = Body.dds\n").unwrap();
        assert_eq!(own_help(&dir, &["a.ini".into()], &[jacket]), (false, None));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rows_skip_keys_that_are_off() {
        let mut off = entry("KeyHat", "hat", "toggle", &["0", "1"], "J");
        off.off = true;
        let r = rows(&[entry("KeyJacket", "jacket", "cycle", &["0", "1", "2"], "F6"), off]);
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].options, 3);
        assert_eq!(r[0].keys, vec!["F6".to_string()]);
    }
}
