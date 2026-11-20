//! Other apps' keys: recorders and overlays listen for keys in every app, so a key of theirs fires together with
//! gachamod's (Medal takes a screenshot on F7, the key that opens the skin menu). This module reads the keys those
//! apps have set, says which of gachamod's keys they hit, and moves gachamod's key to a free one when the player
//! asks. For Medal it can change the other app's key instead: one value in Medal's database, while Medal is closed,
//! after a copy of the database. Every other app's settings are only read. Where each app keeps its keys and how
//! sure that is: docs/other-app-keys.md.
//!
//! Settings: `otherKeys.kept` (clashes the player chose to keep, as "app|key"), `otherKeys.ask` ("0": never ask in a
//! toast) and `otherKeys.asked` (how often a toast asked about each clash, three times at most). Owner: INGAME area.

use crate::db::Db;
use crate::error::{Error, Result};
use crate::keylist::{self, KeyListSettings};
use crate::live::{self, MenuSettings};
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Clashes the player chose to keep, as "app|key".
pub const KEPT: &str = "otherKeys.kept";
/// "0": never ask about a clash in a toast. The note in the game's panel still shows.
pub const ASK: &str = "otherKeys.ask";
const ASKED: &str = "otherKeys.asked";
/// A toast asks about one clash this often, over all runs. After that only the panel's note does.
const ASK_TIMES: u32 = 3;
/// The mod loaders' own keys, never suggested.
const LOADER_KEYS: [&str; 3] = ["F6", "F10", "F12"];
/// For a key whose job isn't known.
const SHORTCUT: &str = "has a shortcut";

/// A key another app listens for.
#[derive(Debug, Clone, PartialEq)]
pub struct OtherKey {
    pub app_id: &'static str,
    /// "Medal"
    pub app: &'static str,
    /// What the key does there, to follow the app's name: "takes a screenshot".
    pub does: String,
    /// Written like gachamod's own keys: "F7", "Alt+F7".
    pub key: String,
    /// The app's settings couldn't be read, so this is the key it ships with.
    pub by_default: bool,
    /// gachamod can give the app another key here (`change_other_with`).
    pub change: bool,
}

/// Another app's key that is also one of gachamod's.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Clash {
    /// "medal|F7", the same as `app_id` and `key`.
    pub id: String,
    pub app: String,
    pub app_id: String,
    pub does: String,
    pub key: String,
    pub by_default: bool,
    /// Games whose skin menu opens with the key (only games that have the menu).
    pub menu_games: Vec<String>,
    /// Games whose key list shows with the key.
    pub key_list_games: Vec<String>,
    /// The key switches a profile.
    pub profile: bool,
    /// A free key for gachamod. None when only a profile hotkey is hit: the player picks those.
    pub suggestion: Option<String>,
    /// The free key the other app would get, when gachamod can change that app's key. None when it can't.
    pub other_key: Option<String>,
    /// What changing the other app's key needs: "Medal has to be closed first. Quit it from its tray icon".
    pub other_needs: Option<String>,
    /// "Medal takes a screenshot on F7."
    pub text: String,
    /// The same with what the key does in gachamod, for a toast: "Medal takes a screenshot on F7, the key that
    /// opens the skin menu."
    pub ask: String,
}

/// What `move_key` changed.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Moved {
    pub from: String,
    pub to: String,
    pub menu_games: Vec<String>,
    pub key_list_games: Vec<String>,
    /// "The skin menu opens with F9 now"
    pub text: String,
}

/// What `change_other_with` changed.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Changed {
    pub app: String,
    pub app_id: String,
    pub from: String,
    pub to: String,
    /// "Medal takes a screenshot on F9 now"
    pub text: String,
    /// The copy of the app's settings made before the first change in this run, for a button that shows it.
    pub backup: Option<String>,
}

/// A clash the player chose to keep, for the list that takes that back.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KeptKey {
    /// "medal|F7"
    pub id: String,
    pub app: String,
    pub app_id: String,
    pub key: String,
    /// "Medal takes a screenshot on F7." Where the app no longer has the key: "Medal used F7."
    pub text: String,
    /// The app has the key now and it is one of gachamod's, so taking the choice back brings the question back.
    pub active: bool,
}

// ── key names ──

/// A key by the name gachamod writes it with ("F7", "A", "Num1", "PageUp"), from the names other apps use
/// ("OBS_KEY_F7", "VK_UP", "KEY_PAD_1", "Page Up"). None for a key gachamod can't hold, which can't clash.
fn key_name(raw: &str) -> Option<String> {
    let flat: String = raw.trim().to_ascii_uppercase().chars().filter(|c| !matches!(c, ' ' | '_' | '-')).collect();
    let up = ["OBSKEY", "VK", "KEY"].iter().find_map(|p| flat.strip_prefix(p).filter(|r| !r.is_empty())).unwrap_or(&flat);
    let mut cs = up.chars();
    if let (Some(c), None) = (cs.next(), cs.next()) { return c.is_ascii_alphanumeric().then(|| c.to_string()); }
    let digits = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_digit());
    if let Some(n) = up.strip_prefix('F').filter(|n| digits(n)) {
        return n.parse::<u8>().ok().filter(|n| (1..=24).contains(n)).map(|n| format!("F{n}"));
    }
    for p in ["NUMPAD", "NUM", "PAD"] {
        if let Some(n) = up.strip_prefix(p).filter(|n| n.len() == 1 && digits(n)) { return Some(format!("Num{n}")); }
    }
    Some(match up {
        "SPACE" | "SPACEBAR" => "Space",
        "UP" | "UPARROW" | "ARROWUP" => "Up",
        "DOWN" | "DOWNARROW" | "ARROWDOWN" => "Down",
        "LEFT" | "LEFTARROW" | "ARROWLEFT" => "Left",
        "RIGHT" | "RIGHTARROW" | "ARROWRIGHT" => "Right",
        "HOME" => "Home",
        "END" => "End",
        "PAGEUP" | "PGUP" | "PRIOR" => "PageUp",
        "PAGEDOWN" | "PGDN" | "PGDOWN" | "NEXT" => "PageDown",
        "INSERT" | "INS" => "Insert",
        "DELETE" | "DEL" => "Delete",
        _ => return None,
    }.to_string())
}

/// A Windows virtual-key code as a key name.
fn vk_name(vk: u32) -> Option<String> {
    Some(match vk {
        0x30..=0x39 | 0x41..=0x5A => char::from_u32(vk)?.to_string(),
        0x60..=0x69 => format!("Num{}", vk - 0x60),
        0x70..=0x87 => format!("F{}", vk - 0x6F),
        0x20 => "Space".into(),
        0x21 => "PageUp".into(),
        0x22 => "PageDown".into(),
        0x23 => "End".into(),
        0x24 => "Home".into(),
        0x25 => "Left".into(),
        0x26 => "Up".into(),
        0x27 => "Right".into(),
        0x28 => "Down".into(),
        0x2D => "Insert".into(),
        0x2E => "Delete".into(),
        _ => return None,
    })
}

#[derive(Default, Clone, Copy)]
struct Mods { ctrl: bool, alt: bool, shift: bool, win: bool }

impl Mods {
    /// Note a modifier by name. False for a word that isn't one.
    fn add(&mut self, word: &str) -> bool {
        match word.trim().to_ascii_lowercase().as_str() {
            "ctrl" | "control" | "lctrl" | "rctrl" => self.ctrl = true,
            "alt" | "menu" | "lalt" | "ralt" => self.alt = true,
            "shift" | "lshift" | "rshift" => self.shift = true,
            "win" | "windows" | "meta" | "super" | "cmd" | "command" => self.win = true,
            _ => return false,
        }
        true
    }

    /// The combo the way gachamod writes its own: "Ctrl+Alt+M".
    fn with(self, key: &str) -> String {
        let mut out = Vec::new();
        if self.ctrl { out.push("Ctrl"); }
        if self.alt { out.push("Alt"); }
        if self.shift { out.push("Shift"); }
        if self.win { out.push("Win"); }
        out.push(key);
        out.join("+")
    }
}

/// "ALT + F7" or "Ctrl+Shift+S" as a combo: the last part is the key, the ones before it modifiers.
fn plus_combo(text: &str) -> Option<String> {
    let parts: Vec<&str> = text.split('+').map(str::trim).collect();
    let (key, mods) = parts.split_last()?;
    let mut m = Mods::default();
    if !mods.iter().all(|w| m.add(w)) { return None; }
    Some(m.with(&key_name(key)?))
}

fn other(app_id: &'static str, app: &'static str, does: &str, key: String, by_default: bool) -> OtherKey {
    OtherKey { app_id, app, does: does.to_string(), key, by_default, change: false }
}

/// F1 to F24 with nothing held.
fn bare_f(key: &str) -> bool { key.len() > 1 && key.starts_with('F') && key[1..].chars().all(|c| c.is_ascii_digit()) }

// ── reading each app (docs/other-app-keys.md) ──

/// What Medal has stored: its list of keys and the switches that turn single keys off.
#[derive(Debug, Default)]
struct MedalSet {
    /// `[{"action":"screenshot","device":"keyboard","type":"short_press","inputs":"F7"}, ...]`
    hotkeys: Option<Vec<serde_json::Value>>,
    shots: Option<bool>,
    game_switch: Option<bool>,
    talk: Option<bool>,
}

/// What changing Medal's key needs, for the button's tip.
const MEDAL_NEEDS: &str = "Medal has to be closed first. Quit it from the tray icon";
const MEDAL_EXES: [&str; 2] = ["Medal.exe", "MedalEncoder.exe"];

/// The key of one entry of Medal's list, when it's a keyboard key gachamod can hold.
fn medal_entry_key(h: &serde_json::Value) -> Option<String> {
    if h.get("device").and_then(|d| d.as_str()).is_some_and(|d| d != "keyboard") { return None; }
    plus_combo(h.get("inputs")?.as_str()?)
}

/// A combo the way Medal writes it: "ALT + F7", "ALT + SHIFT + d". None for keys whose spelling there isn't known.
fn medal_form(combo: &str) -> Option<String> {
    let parts: Vec<&str> = combo.split('+').collect();
    let (key, mods) = parts.split_last()?;
    let key = match *key {
        k if bare_f(k) => k.to_string(),
        k if k.len() == 1 => k.to_ascii_lowercase(),
        _ => return None,
    };
    Some(mods.iter().map(|m| m.to_ascii_uppercase()).chain([key]).collect::<Vec<_>>().join(" + "))
}

/// Medal's keys. It leaves a key out when its switch is off (ScreenshotEnabled for the screenshot key), so those
/// are skipped here too. Without a stored list these are the keys Medal ships with. `stored`: the list is from
/// Medal's database, where gachamod can change a key it can write back exactly the way Medal wrote it.
fn medal_keys(set: &MedalSet, stored: bool) -> Vec<OtherKey> {
    let key = |does: &str, key: &str, by_default: bool| other("medal", "Medal", does, key.to_string(), by_default);
    let shots = set.shots != Some(false);
    let Some(list) = &set.hotkeys else {
        let mut out = vec![key("saves a clip", "F8", true)];
        if shots { out.push(key("takes a screenshot", "F7", true)); }
        return out;
    };
    list.iter().filter_map(|h| {
        let action = h.get("action")?.as_str()?.split(';').next()?.trim();
        let does = match action {
            "clip" => "saves a clip",
            "screenshot" if shots => "takes a screenshot",
            "screenshot" => return None,
            // on unless turned off, and off unless turned on
            "switch_game" if set.game_switch == Some(false) => return None,
            "ptt_hold" if set.talk != Some(true) => return None,
            "segment_toggle" => "starts or stops a recording",
            "bookmark" => "adds a bookmark",
            _ => SHORTCUT,
        };
        let combo = medal_entry_key(h)?;
        let change = stored && medal_form(&combo).as_deref() == h.get("inputs").and_then(|i| i.as_str());
        Some(OtherKey { change, ..key(does, &combo, false) })
    }).collect()
}

/// Medal before it had a database: `%APPDATA%\Medal\store\settings.json`, with the list in
/// `recorder.triggerHotkeys`. Newer Medal copies this file into its database once and then leaves it behind, so it
/// is only read when there is no database. Never written.
pub(crate) fn medal(text: &str) -> Vec<OtherKey> {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(text) else { return vec![] };
    let Some(rec) = v.get("recorder").and_then(|r| r.as_object()) else { return vec![] };
    let flag = |name: &str| rec.get(name).and_then(|b| b.as_bool());
    let set = MedalSet {
        hotkeys: rec.get("triggerHotkeys").and_then(|l| l.as_array()).cloned(),
        shots: flag("screenshotEnabled"), game_switch: flag("gameSwitchEnabled"), talk: flag("pushToTalkKeyEnabled"),
    };
    medal_keys(&set, false)
}

fn medal_open(path: &Path, write: bool) -> Option<Connection> {
    // never creates the file
    let mode = if write { OpenFlags::SQLITE_OPEN_READ_WRITE } else { OpenFlags::SQLITE_OPEN_READ_ONLY };
    let con = Connection::open_with_flags(path, mode | OpenFlags::SQLITE_OPEN_NO_MUTEX).ok()?;
    con.busy_timeout(std::time::Duration::from_millis(if write { 2000 } else { 300 })).ok()?;
    Some(con)
}

/// One of Medal's settings: a row of `key_values`, whose value is SQLite's binary JSON.
fn medal_value(con: &Connection, key: &str) -> Option<serde_json::Value> {
    let text: String = con.query_row("SELECT json(value) FROM key_values WHERE key = ?1", [key], |r| r.get(0)).ok()?;
    serde_json::from_str(&text).ok()
}

/// Medal's database for the account in use, in `%APPDATA%\Medal`: `medal-<user id>.db` when signed in (the `User`
/// row of `medal-guest.db` says who), else `medal-guest.db`.
fn medal_db_path(dir: &Path) -> Option<PathBuf> {
    let guest = dir.join("medal-guest.db");
    let user = medal_open(&guest, false).and_then(|c| medal_value(&c, "User"))
        .filter(|u| u.get("guest").and_then(|g| g.as_bool()) == Some(false))
        .and_then(|u| u.get("userId").map(|id| id.as_str().map_or_else(|| id.to_string(), str::to_string)))
        .filter(|id| !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric()))
        .map(|id| dir.join(format!("medal-{id}.db")))
        .filter(|p| p.is_file());
    user.or_else(|| guest.is_file().then_some(guest))
}

/// Medal's settings from its database: the rows `Hotkeys`, `ScreenshotEnabled`, `GameSwitchHotkeyEnabled` and
/// `PushToTalkEnabled`. None when the file isn't a database Medal has used.
fn medal_db(path: &Path) -> Option<MedalSet> {
    let con = medal_open(path, false)?;
    con.query_row("SELECT count(*) FROM key_values", [], |r| r.get::<_, i64>(0)).ok()?;
    let flag = |key: &str| medal_value(&con, key).and_then(|v| v.as_bool());
    Some(MedalSet {
        hotkeys: medal_value(&con, "Hotkeys").and_then(|v| v.as_array().cloned()),
        shots: flag("ScreenshotEnabled"), game_switch: flag("GameSwitchHotkeyEnabled"), talk: flag("PushToTalkEnabled"),
    })
}

/// Medal's keys from its folder: the database, or the older settings.json when there is none.
pub(crate) fn medal_found(dir: &Path) -> Vec<OtherKey> {
    if let Some(set) = medal_db_path(dir).and_then(|p| medal_db(&p)) { return medal_keys(&set, true); }
    read(&dir.join("store").join("settings.json")).map(|t| medal(&t)).unwrap_or_default()
}

static BACKED_UP: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());

/// Copy Medal's database to `<name>.gachamod.bak` before gachamod's first write to it in this run. What Medal wrote
/// last may still sit in its write-ahead file (`<name>-wal`), so that goes along as `<name>.gachamod.bak-wal`. Returns
/// the copy of the database, for the button that shows it.
fn medal_backup(path: &Path) -> Result<PathBuf> {
    let beside = |suffix: &str| {
        let mut name = path.file_name().map(|n| n.to_os_string()).unwrap_or_default();
        name.push(suffix);
        path.with_file_name(name)
    };
    let bak = beside(".gachamod.bak");
    let mut done = BACKED_UP.lock().unwrap_or_else(|e| e.into_inner());
    if done.iter().any(|p| p == path) { return Ok(bak); }
    std::fs::copy(path, &bak)?;
    let (wal, bak_wal) = (beside("-wal"), beside(".gachamod.bak-wal"));
    if std::fs::metadata(&wal).is_ok_and(|m| m.len() > 0) { std::fs::copy(&wal, &bak_wal)?; } else { let _ = std::fs::remove_file(&bak_wal); }
    done.push(path.to_path_buf());
    Ok(bak)
}

/// The copies gachamod made of Medal's settings, for the row that shows them.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MedalCopy {
    /// One of the copies, the file to show.
    pub path: String,
    /// The folder they are in.
    pub folder: String,
    /// Every copy together, in bytes.
    pub bytes: u64,
    /// How many files there are (a database and its write-ahead file).
    pub files: u32,
}

/// The copies in Medal's folder: `<name>.gachamod.bak` and `<name>.gachamod.bak-wal`. None when there are none.
fn medal_copies_in(dir: &Path) -> Option<MedalCopy> {
    let mut found: Vec<(PathBuf, u64)> = std::fs::read_dir(dir).ok()?.filter_map(|e| e.ok())
        .filter(|e| { let n = e.file_name().to_string_lossy().to_string(); n.ends_with(".gachamod.bak") || n.ends_with(".gachamod.bak-wal") })
        .filter_map(|e| { let m = e.metadata().ok()?; m.is_file().then(|| (e.path(), m.len())) }).collect();
    found.sort();
    let (path, _) = found.first()?.clone();
    Some(MedalCopy { path: path.to_string_lossy().into_owned(), folder: dir.to_string_lossy().into_owned(), bytes: found.iter().map(|f| f.1).sum(), files: found.len() as u32 })
}

/// The copies gachamod made of Medal's settings on this PC.
pub fn medal_copies() -> Option<MedalCopy> { medal_copies_in(&env_dir("APPDATA")?.join("Medal")) }

/// Give every key of Medal's list that is `from` the key `to`: one value each inside the `Hotkeys` row, set in
/// place, so the rest of the row and every other row stay byte for byte. Read back afterwards.
fn medal_change(path: &Path, from: &str, to: &str) -> Result<()> {
    let failed = |e: rusqlite::Error| Error::Invalid(format!("Medal's settings couldn't be changed ({e}). Nothing was changed"));
    let new = medal_form(to).ok_or_else(|| Error::Invalid(format!("gachamod can't give Medal {to}")))?;
    let mut con = medal_open(path, true).ok_or_else(|| Error::Invalid("Medal's settings couldn't be opened. Nothing was changed".into()))?;
    let tx = con.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(failed)?;
    let list = medal_value(&tx, "Hotkeys").and_then(|v| v.as_array().cloned()).unwrap_or_default();
    let at: Vec<usize> = list.iter().enumerate().filter(|(_, h)| medal_entry_key(h).as_deref() == Some(from)).map(|(i, _)| i).collect();
    if at.is_empty() { return Err(Error::Invalid(format!("Medal has no key on {from} any more"))); }
    for i in &at {
        tx.execute("UPDATE key_values SET value = jsonb_set(value, ?1, ?2) WHERE key = 'Hotkeys'", rusqlite::params![format!("$[{i}].inputs"), new]).map_err(failed)?;
    }
    tx.commit().map_err(failed)?;
    drop(con);
    let after = medal_db(path).and_then(|s| s.hotkeys).unwrap_or_default();
    let took = at.iter().all(|i| after.get(*i).and_then(|h| h.get("inputs")).and_then(|v| v.as_str()) == Some(new.as_str()));
    if !took { return Err(Error::Invalid(format!("Medal's settings didn't take {to}. A copy from before the change is next to them, ending in .gachamod.bak"))); }
    Ok(())
}

/// The lines of one section of an ini file, as (name, value).
fn ini_section<'a>(text: &'a str, section: &str) -> Vec<(&'a str, &'a str)> {
    let mut inside = false;
    let mut out = Vec::new();
    for line in text.lines().map(|l| l.trim().trim_start_matches('\u{feff}')) {
        if let Some(name) = line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) { inside = name.eq_ignore_ascii_case(section); continue; }
        if !inside || line.starts_with(';') || line.starts_with('#') { continue; }
        if let Some((k, v)) = line.split_once('=') { out.push((k.trim(), v.trim())); }
    }
    out
}

/// OBS Studio: `[Hotkeys]` in the profile's basic.ini, one line per action:
/// `OBSBasic.Screenshot={"bindings":[{"key":"OBS_KEY_F7"}]}`, with `"control":true` and the like for modifiers.
/// OBS ships with no keys set.
pub(crate) fn obs(text: &str) -> Vec<OtherKey> {
    let mut out = Vec::new();
    for (name, value) in ini_section(text, "Hotkeys") {
        let Ok(serde_json::Value::Object(o)) = serde_json::from_str::<serde_json::Value>(value) else { continue };
        let short = name.rsplit('.').next().unwrap_or(name);
        // an older OBS wrote the replay key as ReplayBuffer={"ReplayBuffer.Save":[...]}
        for (list_name, list) in o.iter().filter_map(|(n, l)| l.as_array().map(|l| (n.as_str(), l))) {
            let action = if list_name == "bindings" { short } else { list_name.rsplit('.').next().unwrap_or(short) };
            let does = match action {
                "StartRecording" => "starts recording",
                "StopRecording" => "stops recording",
                "SaveReplayBuffer" | "Save" => "saves a replay",
                "Screenshot" | "SelectedSourceScreenshot" => "takes a screenshot",
                "StartStreaming" => "starts streaming",
                "StopStreaming" => "stops streaming",
                _ => SHORTCUT,
            };
            for b in list {
                let Some(key) = b.get("key").and_then(|k| k.as_str()).and_then(key_name) else { continue };
                let on = |f: &str| b.get(f).and_then(|x| x.as_bool()) == Some(true);
                let m = Mods { ctrl: on("control"), alt: on("alt"), shift: on("shift"), win: on("command") };
                out.push(other("obs", "OBS", does, m.with(&key), false));
            }
        }
    }
    out
}

/// AMD Software: text values under `Software\AMD\DVR` like "Ctrl+Shift,I" (modifiers, a comma, the key) or "none".
/// `HotkeysDisabled` turns them all off.
pub(crate) fn amd(values: &[(String, String)], disabled: bool) -> Vec<OtherKey> {
    if disabled { return vec![]; }
    values.iter().filter(|(n, _)| n.ends_with("Hotkey") || n == "ToggleUpscaling").filter_map(|(name, value)| {
        let (mods, key) = value.rsplit_once(',').unwrap_or(("", value));
        let mut m = Mods::default();
        if !mods.split('+').map(str::trim).filter(|w| !w.is_empty()).all(|w| m.add(w)) { return None; }
        let does = match name.as_str() {
            "TakeScreenshotHotkey" => "takes a screenshot",
            "ToggleDvrRecordingHotkey" => "starts or stops recording",
            "SaveInstantReplayHotkey" | "SaveInGameReplayHotkey" => "saves a replay",
            "SaveInstantGifHotkey" => "saves a GIF",
            "ToggleRsHotkey" | "ToggleDvrToolbarHotkey" => "opens",
            _ => SHORTCUT,
        };
        Some(other("amd", "AMD Software", does, m.with(&key_name(key)?), false))
    }).collect()
}

/// Xbox Game Bar: the player's own shortcuts under `Software\Microsoft\Windows\CurrentVersion\GameDVR`, in pairs:
/// `VKTakeScreenshot` holds a virtual-key code and `VKMTakeScreenshot` its modifiers (Ctrl 1, Alt 2, Shift 4, Win 8).
/// 0 means none. The Win+Alt shortcuts it ships with aren't stored and can't clash.
pub(crate) fn game_bar(values: &[(String, u32)]) -> Vec<OtherKey> {
    values.iter().filter(|(n, v)| n.starts_with("VK") && !n.starts_with("VKM") && *v != 0).filter_map(|(name, vk)| {
        let what = &name[2..];
        let mask = values.iter().find(|(n, _)| n.strip_prefix("VKM") == Some(what)).map_or(0, |(_, v)| *v);
        let m = Mods { ctrl: mask & 1 != 0, alt: mask & 2 != 0, shift: mask & 4 != 0, win: mask & 8 != 0 };
        let does = match what {
            "TakeScreenshot" => "takes a screenshot",
            "ToggleRecording" => "starts or stops recording",
            "SaveHistoricalVideo" => "saves the last moments",
            "ToggleGameBar" => "opens",
            _ => SHORTCUT,
        };
        Some(other("gamebar", "Xbox Game Bar", does, m.with(&vk_name(*vk)?), false))
    }).collect()
}

/// NVIDIA App and GeForce Experience: binary values under `...\ShadowPlay\NVSPCAPS`. `DVRHKeyCount` says how many
/// keys the combo has, and `DVRHKey0`, `DVRHKey1`... each hold one virtual-key code, modifiers first. The keys it
/// ships with all have Alt and aren't written until changed.
pub(crate) fn nvidia(values: &[(String, Vec<u8>)]) -> Vec<OtherKey> {
    let num = |name: &str| values.iter().find(|(n, _)| n == name).and_then(|(_, b)| Some(u32::from_le_bytes(b.get(..4)?.try_into().ok()?)));
    values.iter().filter_map(|(name, _)| name.strip_suffix("Count").filter(|p| p.ends_with("HKey"))).filter_map(|prefix| {
        let count = num(&format!("{prefix}Count")).filter(|n| (1..=4).contains(n))?;
        let mut m = Mods::default();
        let mut key = None;
        for i in 0..count {
            match num(&format!("{prefix}{i}"))? {
                0x10 | 0xA0 | 0xA1 => m.shift = true,
                0x11 | 0xA2 | 0xA3 => m.ctrl = true,
                0x12 | 0xA4 | 0xA5 => m.alt = true,
                0x5B | 0x5C => m.win = true,
                vk => key = Some(vk_name(vk)?),
            }
        }
        let does = match prefix {
            "DVRHKey" => "starts or stops recording",
            "IRToggleHKey" => "turns Instant Replay on or off",
            _ => SHORTCUT,
        };
        Some(other("nvidia", "NVIDIA App", does, m.with(&key?), false))
    }).collect()
}

/// Steam: `InGameOverlayScreenshotHotKey` and `InGameOverlayShortcutKey` in the signed-in account's localconfig.vdf,
/// written like "KEY_F12" or "Shift\tKEY_TAB". Steam writes them only once they were changed, so a file without the
/// screenshot key counts as F12, the key it ships with.
pub(crate) fn steam(text: &str) -> Vec<OtherKey> {
    let value = |name: &str| text.lines().find_map(|l| {
        let mut q = l.split('"');
        if !q.nth(1)?.eq_ignore_ascii_case(name) { return None; }
        q.nth(1).map(|v| v.replace("\\t", "\t"))
    });
    let combo = |v: &str| {
        let parts: Vec<&str> = v.split_whitespace().collect();
        let (key, mods) = parts.split_last()?;
        let mut m = Mods::default();
        if !mods.iter().all(|w| m.add(w)) { return None; }
        Some(m.with(&key_name(key)?))
    };
    let mut out = Vec::new();
    match value("InGameOverlayScreenshotHotKey") {
        Some(v) if !v.eq_ignore_ascii_case("default") => {
            if let Some(k) = combo(&v) { out.push(other("steam", "Steam", "takes a screenshot", k, false)); }
        }
        _ => out.push(other("steam", "Steam", "takes a screenshot", "F12".into(), true)),
    }
    if let Some(k) = value("InGameOverlayShortcutKey").and_then(|v| combo(&v)) { out.push(other("steam", "Steam", "opens the overlay", k, false)); }
    out
}

/// Bandicam: its key names in the registry aren't known, so these are the keys it ships with.
pub(crate) fn bandicam() -> Vec<OtherKey> {
    [("starts or stops recording", "F12"), ("takes a screenshot", "F11"), ("shows or hides the FPS counter", "F9")]
        .into_iter().map(|(does, key)| other("bandicam", "Bandicam", does, key.to_string(), true)).collect()
}

// ── this PC ──

/// A small text file, or None when it's missing, too big or can't be read.
fn read(path: &Path) -> Option<String> {
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() > 32 * 1024 * 1024 { return None; }
    let bytes = std::fs::read(path).ok()?;
    Some(String::from_utf8_lossy(&bytes).trim_start_matches('\u{feff}').to_string())
}

fn env_dir(var: &str) -> Option<PathBuf> { std::env::var_os(var).filter(|v| !v.is_empty()).map(PathBuf::from) }

fn obs_found() -> Vec<OtherKey> {
    let Some(root) = env_dir("APPDATA").map(|d| d.join("obs-studio")) else { return vec![] };
    let profiles = root.join("basic").join("profiles");
    // the profile in use: [Basic] ProfileDir in user.ini (OBS 31 and later) or global.ini
    let active = ["user.ini", "global.ini"].iter().filter_map(|f| read(&root.join(f)))
        .find_map(|t| ini_section(&t, "Basic").into_iter().find(|(k, _)| *k == "ProfileDir").map(|(_, v)| v.to_string()))
        .filter(|d| !d.is_empty() && !d.contains(['/', '\\']) && !d.contains(".."))
        .map(|d| profiles.join(d)).filter(|d| d.is_dir());
    let dirs = match active {
        Some(d) => vec![d],
        None => std::fs::read_dir(&profiles).map(|r| r.filter_map(|e| e.ok()).map(|e| e.path()).collect()).unwrap_or_default(),
    };
    dirs.iter().filter_map(|d| read(&d.join("basic.ini"))).flat_map(|t| obs(&t)).collect()
}

/// The localconfig.vdf of the Steam account used last.
fn steam_config() -> Option<String> {
    let users = std::fs::read_dir(steam_root()?.join("userdata")).ok()?;
    let newest = users.filter_map(|e| e.ok()).map(|e| e.path().join("config").join("localconfig.vdf"))
        .filter_map(|p| Some((std::fs::metadata(&p).ok()?.modified().ok()?, p)))
        .max_by_key(|(at, _)| *at)?;
    read(&newest.1)
}

#[cfg(windows)]
fn steam_root() -> Option<PathBuf> {
    reg::text(false, r"Software\Valve\Steam", "SteamPath").map(|p| PathBuf::from(p.replace('/', "\\")))
}
#[cfg(not(windows))]
fn steam_root() -> Option<PathBuf> { None }

#[cfg(windows)]
mod reg {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, REG_BINARY, REG_DWORD};
    use winreg::types::FromRegValue;
    use winreg::{RegKey, RegValue};

    fn open(machine: bool, path: &str) -> Option<RegKey> {
        RegKey::predef(if machine { HKEY_LOCAL_MACHINE } else { HKEY_CURRENT_USER }).open_subkey(path).ok()
    }
    fn values(machine: bool, path: &str) -> Vec<(String, RegValue)> {
        open(machine, path).map(|k| k.enum_values().filter_map(|v| v.ok()).collect()).unwrap_or_default()
    }

    pub fn exists(machine: bool, path: &str) -> bool { open(machine, path).is_some() }
    pub fn text(machine: bool, path: &str, name: &str) -> Option<String> { open(machine, path)?.get_value::<String, _>(name).ok() }
    pub fn number(machine: bool, path: &str, name: &str) -> Option<u32> { open(machine, path)?.get_value::<u32, _>(name).ok() }
    pub fn texts(machine: bool, path: &str) -> Vec<(String, String)> {
        values(machine, path).into_iter().filter_map(|(n, v)| Some((n, String::from_reg_value(&v).ok()?))).collect()
    }
    pub fn numbers(machine: bool, path: &str) -> Vec<(String, u32)> {
        values(machine, path).into_iter().filter(|(_, v)| v.vtype == REG_DWORD).filter_map(|(n, v)| Some((n, u32::from_reg_value(&v).ok()?))).collect()
    }
    pub fn binaries(machine: bool, path: &str) -> Vec<(String, Vec<u8>)> {
        values(machine, path).into_iter().filter(|(_, v)| v.vtype == REG_BINARY || v.vtype == REG_DWORD).map(|(n, v)| (n, v.bytes)).collect()
    }
}

#[cfg(windows)]
fn registry_found() -> Vec<OtherKey> {
    const AMD: &str = r"Software\AMD\DVR";
    let mut out = Vec::new();
    // the PC's values, with the player's own on top
    let mut keys = reg::texts(true, AMD);
    for (name, value) in reg::texts(false, AMD) {
        keys.retain(|(n, _)| *n != name);
        keys.push((name, value));
    }
    let off = [false, true].iter().any(|m| reg::number(*m, AMD, "HotkeysDisabled") == Some(1));
    out.extend(amd(&keys, off));
    out.extend(game_bar(&reg::numbers(false, r"Software\Microsoft\Windows\CurrentVersion\GameDVR")));
    out.extend(nvidia(&reg::binaries(false, r"Software\NVIDIA Corporation\Global\ShadowPlay\NVSPCAPS")));
    if reg::exists(false, r"Software\BANDISOFT\BANDICAM\OPTION") { out.extend(bandicam()); }
    out
}
#[cfg(not(windows))]
fn registry_found() -> Vec<OtherKey> { Vec::new() }

/// Every key the known apps on this PC listen for. A missing or odd file is nothing found, never an error. It reads
/// a few small files and registry keys, so call it before taking the database.
pub fn found() -> Vec<OtherKey> {
    let mut out = Vec::new();
    if let Some(dir) = env_dir("APPDATA") { out.extend(medal_found(&dir.join("Medal"))); }
    out.extend(obs_found());
    if let Some(t) = steam_config() { out.extend(steam(&t)); }
    out.extend(registry_found());
    out
}

// ── clashes ──

/// gachamod's own keys.
#[derive(Debug, Clone, Default)]
pub(crate) struct Ours {
    /// (game, the key that opens its skin menu, the game has the menu)
    pub menu: Vec<(String, String, bool)>,
    /// (game, the key that shows its key list, the list is on and the game has the menu)
    pub list: Vec<(String, String, bool)>,
    /// Profile hotkeys.
    pub combos: Vec<String>,
}

fn ours(db: &Db) -> Ours {
    let mut o = Ours { combos: crate::hotkeys::combos(db).unwrap_or_default(), ..Default::default() };
    for g in crate::games::GAMES {
        // the menu exists once a character switches in game, and the key list rides on it
        let has_menu = live::has_groups(db, g.id);
        o.menu.push((g.id.to_string(), live::menu_settings(db, g.id).key, has_menu));
        let list = keylist::settings(db, g.id);
        o.list.push((g.id.to_string(), list.key, list.on && has_menu));
    }
    o
}

/// One entry per app and key. A key with two jobs keeps the first that has a name, and can be changed only when
/// both can.
fn merged(others: &[OtherKey]) -> Vec<OtherKey> {
    let mut out: Vec<OtherKey> = Vec::new();
    for o in others {
        match out.iter_mut().find(|x| x.app_id == o.app_id && x.key == o.key) {
            Some(x) => {
                if x.does == SHORTCUT && o.does != SHORTCUT { x.does = o.does.clone(); }
                x.change &= o.change;
            }
            None => out.push(o.clone()),
        }
    }
    out
}

/// A key nothing uses: a bare F key first, then one with Ctrl. Alt is left out (NVIDIA's keys all have it, and they
/// can't be read until changed), and so are F1 to F5, which the games use themselves.
fn suggest(used: &HashSet<String>) -> Option<String> {
    ["F9", "F11", "F8", "Ctrl+F9", "Ctrl+F8", "Ctrl+F7", "Ctrl+Alt+F9", "Ctrl+Alt+F8", "Ctrl+Alt+F7"]
        .iter().map(|k| k.to_string()).find(|k| !used.contains(k))
}

fn game_name(id: &str) -> &'static str { crate::games::def(id).map_or("this game", |g| g.name) }

pub(crate) fn clashes_in(ours: &Ours, others: &[OtherKey], kept: &[String]) -> Vec<Clash> {
    let mut used: HashSet<String> = LOADER_KEYS.iter().map(|k| k.to_string()).collect();
    used.extend(ours.menu.iter().map(|m| m.1.clone()));
    used.extend(ours.list.iter().map(|l| l.1.clone()));
    used.extend(ours.combos.iter().cloned());
    used.extend(others.iter().map(|o| o.key.clone()));
    // two apps on one key get the same suggestion
    let mut free: HashMap<String, String> = HashMap::new();
    let mut out = Vec::new();
    for o in merged(others) {
        let hit = |list: &[(String, String, bool)]| list.iter().filter(|(_, k, on)| *on && *k == o.key).map(|(g, _, _)| g.clone()).collect::<Vec<_>>();
        let (menu_games, key_list_games) = (hit(&ours.menu), hit(&ours.list));
        let profile = ours.combos.contains(&o.key);
        let id = format!("{}|{}", o.app_id, o.key);
        if (menu_games.is_empty() && key_list_games.is_empty() && !profile) || kept.contains(&id) { continue; }
        if !free.contains_key(&o.key) {
            if let Some(s) = suggest(&used) { used.insert(s.clone()); free.insert(o.key.clone(), s); }
        }
        let free_key = free.get(&o.key).cloned();
        // either gachamod takes the free key or the other app does. The other app only gets a bare F key, the one
        // form its settings are known to hold
        let other_key = free_key.clone().filter(|k| o.change && bare_f(k));
        let other_needs = other_key.as_ref().map(|_| MEDAL_NEEDS.to_string());
        let suggestion = if menu_games.is_empty() && key_list_games.is_empty() { None } else { free_key };
        let said = format!("{} {} on {}{}", o.app, o.does, o.key, if o.by_default { " by default" } else { "" });
        let mut jobs = Vec::new();
        if !menu_games.is_empty() { jobs.push("opens the skin menu"); }
        if !key_list_games.is_empty() { jobs.push("shows the key list"); }
        if profile { jobs.push("switches a profile"); }
        let mut games = menu_games.clone();
        for g in &key_list_games { if !games.contains(g) { games.push(g.clone()); } }
        let place = if games.len() == 1 { format!(" in {}", game_name(&games[0])) } else { String::new() };
        let ask = format!("{said}, {} key that {}{place}.", if jobs == ["switches a profile"] { "a" } else { "the" }, jobs.join(" and "));
        out.push(Clash {
            id, app: o.app.to_string(), app_id: o.app_id.to_string(), does: o.does, key: o.key, by_default: o.by_default,
            menu_games, key_list_games, profile, suggestion, other_key, other_needs, text: format!("{said}."), ask,
        });
    }
    out
}

fn kept(db: &Db) -> Vec<String> { db.setting_json(KEPT).ok().flatten().unwrap_or_default() }

/// The clashes between gachamod's keys and `others` (from `found`), the ones the player keeps left out.
pub fn clashes_with(db: &Db, others: &[OtherKey]) -> Vec<Clash> { clashes_in(&ours(db), others, &kept(db)) }

/// The clashes on this PC.
pub fn clashes(db: &Db) -> Vec<Clash> { clashes_with(db, &found()) }

fn app_name(app_id: &str) -> &str {
    match app_id {
        "medal" => "Medal", "obs" => "OBS", "steam" => "Steam", "amd" => "AMD Software",
        "gamebar" => "Xbox Game Bar", "nvidia" => "NVIDIA App", "bandicam" => "Bandicam",
        other => other,
    }
}

fn kept_in(ours: &Ours, others: &[OtherKey], kept: &[String]) -> Vec<KeptKey> {
    // the clashes as they would show without the player's choices
    let live = clashes_in(ours, others, &[]);
    kept.iter().filter_map(|id| {
        let (app_id, key) = id.split_once('|')?;
        let found = live.iter().find(|c| c.id == *id);
        let app = found.map_or_else(|| app_name(app_id).to_string(), |c| c.app.clone());
        let text = found.map_or_else(|| format!("{app} used {key}."), |c| c.text.clone());
        Some(KeptKey { id: id.clone(), app, app_id: app_id.to_string(), key: key.to_string(), text, active: found.is_some() })
    }).collect()
}

/// The clashes the player chose to keep, each with whether it still clashes, so a choice can be taken back from a
/// list. `others` is from `found`.
pub fn kept_with(db: &Db, others: &[OtherKey]) -> Vec<KeptKey> { kept_in(&ours(db), others, &kept(db)) }

fn to_ask_in(db: &Db, all: Vec<Clash>) -> Vec<Clash> {
    if db.setting(ASK).ok().flatten().as_deref() == Some("0") { return vec![]; }
    let before: HashMap<String, u32> = db.setting_json(ASKED).ok().flatten().unwrap_or_default();
    // clashes that are gone drop out, so one that comes back is asked about again
    let mut after: HashMap<String, u32> = HashMap::new();
    let mut out = Vec::new();
    for c in all {
        let n = before.get(&c.id).copied().unwrap_or(0);
        after.insert(c.id.clone(), (n + 1).min(ASK_TIMES));
        if n < ASK_TIMES { out.push(c); }
    }
    if after != before { let _ = db.set_setting_json(ASKED, &after); }
    out
}

/// The clashes to ask about in a toast now (the app asks when it starts and when a game starts): each three times
/// in all, none when the player turned asking off. The panel's note (`clashes`) stays until the key moves or the
/// player keeps it.
pub fn to_ask_with(db: &Db, others: &[OtherKey]) -> Vec<Clash> { to_ask_in(db, clashes_with(db, others)) }

/// Move gachamod's key: every game whose skin menu opens with `from` opens it with `to`, and every key list shown
/// with `from` shows with `to`. Profile hotkeys stay as they are. Undo is the same call the other way round.
pub fn move_key(db: &Db, from: &str, to: &str) -> Result<Moved> {
    let from = crate::hotkeys::normalize_menu(from)?;
    let to = crate::hotkeys::normalize_menu(to)?;
    let mine = ours(db);
    let taken = mine.menu.iter().any(|m| m.1 == to) || mine.combos.contains(&to)
        || crate::games::GAMES.iter().any(|g| { let l = keylist::settings(db, g.id); l.on && l.key == to });
    if from != to && taken { return Err(Error::Invalid(format!("{to} is already one of gachamod's keys. Pick another key"))); }
    let mut out = Moved { from: from.clone(), to: to.clone(), ..Default::default() };
    if from == to { out.text = format!("{to} stays as it is"); return Ok(out); }
    for g in crate::games::GAMES {
        let menu = live::menu_settings(db, g.id);
        if menu.key == from {
            live::set_menu(db, g.id, &MenuSettings { key: to.clone(), ..menu })?;
            out.menu_games.push(g.id.to_string());
        }
        let list = keylist::settings(db, g.id);
        if list.on && list.key == from {
            keylist::set(db, g.id, &KeyListSettings { key: to.clone(), ..list })?;
            out.key_list_games.push(g.id.to_string());
        }
    }
    out.text = match (out.menu_games.is_empty(), out.key_list_games.is_empty()) {
        (false, true) => format!("The skin menu opens with {to} now"),
        (true, false) => format!("The key list shows with {to} now"),
        (false, false) => format!("The skin menu and the key list use {to} now"),
        (true, true) => format!("None of gachamod's keys was {from}"),
    };
    Ok(out)
}

fn change_in(ours: &Ours, others: &[OtherKey], medal_dir: Option<&Path>, running: bool, app_id: &str, from: &str, to: &str, undo: bool) -> Result<Changed> {
    let (Some(from), Some(to)) = (plus_combo(from), plus_combo(to)) else { return Err(Error::Invalid("That key can't be used here".into())) };
    let theirs = merged(others).into_iter().find(|o| o.app_id == app_id && o.key == from)
        .ok_or_else(|| Error::Invalid(format!("No app uses {from} any more")))?;
    // Medal is the only app whose settings gachamod writes
    if !theirs.change || app_id != "medal" {
        return Err(Error::Invalid(format!("gachamod can't change {}'s key. Change it in {} itself", theirs.app, theirs.app)));
    }
    if !undo {
        let ours_has = ours.menu.iter().chain(&ours.list).any(|k| k.1 == to) || ours.combos.contains(&to);
        if !bare_f(&to) || LOADER_KEYS.contains(&to.as_str()) || ours_has || others.iter().any(|o| o.key == to) {
            return Err(Error::Invalid(format!("{to} is already in use. Pick another key")));
        }
    }
    // Medal reads its keys when it starts and writes the whole list back when one changes there
    if running { return Err(Error::Invalid("Medal is running. Quit it from the tray icon, then try again".into())); }
    let path = medal_dir.and_then(medal_db_path).ok_or_else(|| Error::Invalid("Medal's settings weren't found".into()))?;
    let backup = medal_backup(&path)?;
    medal_change(&path, &from, &to)?;
    Ok(Changed {
        app: theirs.app.to_string(), app_id: app_id.to_string(), text: format!("{} {} on {to} now", theirs.app, theirs.does),
        backup: Some(backup.to_string_lossy().into_owned()), from, to,
    })
}

/// Give another app's key `from` the key `to`, so gachamod keeps its own. Only Medal, only while Medal is closed,
/// and only a free F key (not a loader key, not one of gachamod's, not one any found app uses). `undo` puts an
/// old key back and skips the free-key check, under the same closed rule. `others` is from `found`. The app's
/// settings are copied first (`medal_backup`), one value changes, and it is read back.
pub fn change_other_with(db: &Db, others: &[OtherKey], app_id: &str, from: &str, to: &str, undo: bool) -> Result<Changed> {
    let running = MEDAL_EXES.iter().any(|exe| crate::launch::process_running(exe));
    change_in(&ours(db), others, env_dir("APPDATA").map(|d| d.join("Medal")).as_deref(), running, app_id, from, to, undo)
}

/// Keep gachamod's key although `app` uses it too, so the clash isn't shown or asked about again. `on` false takes
/// that back.
pub fn keep(db: &Db, app_id: &str, key: &str, on: bool) -> Result<()> {
    let id = format!("{app_id}|{key}");
    let mut all = kept(db);
    all.retain(|k| *k != id);
    if on { all.push(id); }
    db.set_setting_json(KEPT, &all)
}

#[cfg(test)]
mod tests {
    use super::*;

    const MEDAL: &str = r#"{"recorder":{"screenshotEnabled":true,"triggerHotkeys":[
        {"action":"clip;length=30","device":"keyboard","type":"short_press","inputs":"F8"},
        {"action":"segment_toggle","device":"keyboard","type":"short_press","inputs":"ALT + F7"},
        {"action":"bookmark","device":"keyboard","type":"short_press","inputs":"F8"},
        {"action":"switch_game","device":"keyboard","type":"short_press","inputs":"F10"},
        {"action":"screenshot","device":"keyboard","type":"short_press","inputs":"F7"},
        {"action":"clip;length=15","device":"gamepad","type":"short_press","inputs":"F9"},
        {"action":"callback;event=dismiss","inputs":"ALT + SHIFT + d","device":"keyboard","type":"short_press"},
        {"action":"callback;event=odd","inputs":"CTRL + PrintScreen","device":"keyboard"}
    ]},"user":{}}"#;

    fn keys(list: &[OtherKey]) -> Vec<(&str, &str)> { list.iter().map(|o| (o.key.as_str(), o.does.as_str())).collect() }

    fn ours_with(menu: &[(&str, &str, bool)], list: &[(&str, &str, bool)], combos: &[&str]) -> Ours {
        let own = |l: &[(&str, &str, bool)]| l.iter().map(|(g, k, on)| (g.to_string(), k.to_string(), *on)).collect();
        Ours { menu: own(menu), list: own(list), combos: combos.iter().map(|c| c.to_string()).collect() }
    }

    #[test]
    fn key_names_from_other_apps() {
        assert_eq!(key_name("f7").as_deref(), Some("F7"));
        assert_eq!(key_name("OBS_KEY_F12").as_deref(), Some("F12"));
        assert_eq!(key_name("VK_UP").as_deref(), Some("Up"));
        assert_eq!(key_name("KEY_PAD_3").as_deref(), Some("Num3"));
        assert_eq!(key_name("Page Up").as_deref(), Some("PageUp"));
        assert_eq!(key_name("d").as_deref(), Some("D"));
        assert_eq!(key_name("VK_K").as_deref(), Some("K"));
        assert_eq!(key_name("PrintScreen"), None);
        assert_eq!(key_name("F25"), None);
        assert_eq!(key_name("F+1"), None);
        assert_eq!(key_name("MOUSE_MIDDLE"), None);
        assert_eq!(plus_combo("ALT + SHIFT + d").as_deref(), Some("Alt+Shift+D"));
        assert_eq!(plus_combo("shift+ctrl+F8").as_deref(), Some("Ctrl+Shift+F8"));
        assert_eq!(plus_combo("Hyper + F8"), None);
        assert_eq!(vk_name(0x76).as_deref(), Some("F7"));
        assert_eq!(vk_name(0x41).as_deref(), Some("A"));
        assert_eq!(vk_name(0x2C), None);
    }

    #[test]
    fn medal_keys_are_read() {
        let got = merged(&medal(MEDAL));
        assert_eq!(keys(&got), vec![
            ("F8", "saves a clip"), ("Alt+F7", "starts or stops a recording"), ("F10", SHORTCUT),
            ("F7", "takes a screenshot"), ("Alt+Shift+D", SHORTCUT),
        ]);
        assert!(got.iter().all(|o| o.app == "Medal" && !o.by_default));
        // screenshots turned off: its key does nothing, and the same for the key that switches games
        let off = MEDAL.replace("\"screenshotEnabled\":true", "\"screenshotEnabled\":false,\"gameSwitchEnabled\":false");
        assert!(!medal(&off).iter().any(|o| o.key == "F7" || o.key == "F10"));
        // push to talk is off until turned on
        let talk = r#"{"recorder":{"triggerHotkeys":[{"action":"ptt_hold","device":"keyboard","inputs":"F9"}]}}"#;
        assert!(medal(talk).is_empty());
        assert_eq!(keys(&medal(&talk.replace("{\"trigger", "{\"pushToTalkKeyEnabled\":true,\"trigger"))), vec![("F9", SHORTCUT)]);
        // an older file without the list: the keys Medal ships with
        let old = medal(r#"{"recorder":{"triggerKey":119}}"#);
        assert_eq!(keys(&old), vec![("F8", "saves a clip"), ("F7", "takes a screenshot")]);
        assert!(old.iter().all(|o| o.by_default));
        // odd files are nothing found
        for odd in ["", "not json", "[]", "{}", r#"{"recorder":7}"#, r#"{"recorder":{"triggerHotkeys":[7,{"action":7},{"action":"clip"},{"action":"clip","inputs":""}]}}"#] {
            assert!(medal(odd).is_empty(), "{odd}");
        }
    }

    #[test]
    fn obs_keys_are_read() {
        let ini = "\u{feff}[General]\nName=Untitled\n\n[Hotkeys]\nOBSBasic.StartRecording={\"bindings\":[{\"key\":\"OBS_KEY_F9\"}]}\n\
            OBSBasic.Screenshot={\"bindings\":[{\"control\":true,\"key\":\"OBS_KEY_F8\"},{\"key\":\"OBS_KEY_F7\"}]}\n\
            ReplayBuffer={\"ReplayBuffer.Save\":[{\"alt\":true,\"shift\":true,\"key\":\"OBS_KEY_NUM1\"}]}\n\
            OBSBasic.ResetStats={\"bindings\":[{\"key\":\"OBS_KEY_MOUSE4\"}]}\nOBSBasic.Transition=nonsense\n[Other]\nX={\"bindings\":[{\"key\":\"OBS_KEY_F1\"}]}\n";
        let mut got = keys(&obs(ini)).into_iter().map(|(k, d)| format!("{k} {d}")).collect::<Vec<_>>();
        got.sort();
        assert_eq!(got, vec!["Alt+Shift+Num1 saves a replay", "Ctrl+F8 takes a screenshot", "F7 takes a screenshot", "F9 starts recording"]);
        assert!(obs("").is_empty() && obs("[Hotkeys]\n").is_empty());
    }

    #[test]
    fn registry_values_are_read() {
        let s = |n: &str, v: &str| (n.to_string(), v.to_string());
        let vals = [s("TakeScreenshotHotkey", "Ctrl+Shift,I"), s("ToggleRsHotkey", "Alt,R"), s("Rotation90Hotkey", "Ctrl+Alt,VK_LEFT"),
            s("MicPushToTalkHotkey", "MOUSE_MIDDLE"), s("SaveInstantGifHotkey", "none"), s("ToggleDvrRecordingHotkey", "F7"), s("InstallDir", "F8")];
        assert_eq!(keys(&amd(&vals, false)), vec![("Ctrl+Shift+I", "takes a screenshot"), ("Alt+R", "opens"), ("Ctrl+Alt+Left", SHORTCUT), ("F7", "starts or stops recording")]);
        assert!(amd(&vals, true).is_empty());

        let n = |name: &str, v: u32| (name.to_string(), v);
        let bar = [n("VKTakeScreenshot", 0x76), n("VKMTakeScreenshot", 0), n("VKToggleRecording", 0x52), n("VKMToggleRecording", 3),
            n("VKToggleGameBar", 0), n("VKMToggleGameBar", 1), n("AppCaptureEnabled", 1)];
        assert_eq!(keys(&game_bar(&bar)), vec![("F7", "takes a screenshot"), ("Ctrl+Alt+R", "starts or stops recording")]);

        let b = |name: &str, v: u32| (name.to_string(), v.to_le_bytes().to_vec());
        let nv = [b("DVRHKeyCount", 2), b("DVRHKey0", 0x12), b("DVRHKey1", 0x78), b("DVRHKey2", 0x41),
            b("IRToggleHKeyCount", 1), b("IRToggleHKey0", 0x76), b("OddHKeyCount", 9), ("ShortHKeyCount".to_string(), vec![1])];
        assert_eq!(keys(&nvidia(&nv)), vec![("Alt+F9", "starts or stops recording"), ("F7", "turns Instant Replay on or off")]);
    }

    #[test]
    fn steam_keys_are_read() {
        let vdf = "\"UserLocalConfigStore\"\n{\n\t\"system\"\n\t{\n\t\t\"InGameOverlayScreenshotHotKey\"\t\t\"KEY_F7\"\n\t\t\"InGameOverlayShortcutKey\"\t\t\"Shift\\tKEY_F1\"\n\t}\n}\n";
        assert_eq!(keys(&steam(vdf)), vec![("F7", "takes a screenshot"), ("Shift+F1", "opens the overlay")]);
        // never changed: F12, the key it ships with
        let plain = steam("\"UserLocalConfigStore\"\n{\n}\n");
        assert_eq!(keys(&plain), vec![("F12", "takes a screenshot")]);
        assert!(plain[0].by_default);
        // turned off
        assert!(steam("\t\"InGameOverlayScreenshotHotKey\"\t\"None\"\n").is_empty());
    }

    #[test]
    fn a_clash_names_the_app_and_a_free_key() {
        let medal = medal(MEDAL);
        let ours = ours_with(&[("zzz", "F7", true), ("gi", "F7", false)], &[("zzz", "F8", false), ("gi", "F8", false)], &[]);
        let got = clashes_in(&ours, &medal, &[]);
        assert_eq!(got.len(), 1, "{got:?}");
        let c = &got[0];
        assert_eq!((c.id.as_str(), c.app.as_str(), c.key.as_str()), ("medal|F7", "Medal", "F7"));
        assert_eq!(c.menu_games, vec!["zzz".to_string()]);
        assert_eq!(c.text, "Medal takes a screenshot on F7.");
        assert_eq!(c.ask, "Medal takes a screenshot on F7, the key that opens the skin menu in Zenless Zone Zero.");
        // F8 is Medal's and the key list's, F10 the reload key
        assert_eq!(c.suggestion.as_deref(), Some("F9"));
        // keys read from the older settings.json can't be changed
        assert_eq!((c.other_key.as_deref(), c.other_needs.as_deref()), (None, None));
        // kept: not shown again
        assert!(clashes_in(&ours, &medal, &["medal|F7".to_string()]).is_empty());
        // no game has the menu yet: nothing to ask
        assert!(clashes_in(&ours_with(&[("zzz", "F7", false)], &[], &[]), &medal, &[]).is_empty());
    }

    #[test]
    fn suggestions_stay_off_keys_in_use() {
        let other = |app_id, app, key: &str| other(app_id, app, "takes a screenshot", key.to_string(), false);
        // F9 is another game's menu key, F11 Bandicam's
        let mut others = vec![other("medal", "Medal", "F7"), other("obs", "OBS", "F7"), other("medal", "Medal", "F8")];
        others.extend(bandicam());
        let ours = ours_with(&[("zzz", "F7", true), ("gi", "F9", true)], &[("zzz", "F8", true), ("gi", "Ctrl+F9", false)], &["Ctrl+F8"]);
        let got = clashes_in(&ours, &others, &[]);
        let of = |id: &str| got.iter().find(|c| c.id == id).unwrap_or_else(|| panic!("{id} in {got:?}"));
        // both apps on F7 get the same key, and the key list gets another
        assert_eq!(of("medal|F7").suggestion.as_deref(), Some("Ctrl+F7"));
        assert_eq!(of("obs|F7").suggestion.as_deref(), Some("Ctrl+F7"));
        assert_eq!(of("medal|F8").suggestion.as_deref(), Some("Ctrl+Alt+F9"));
        assert_eq!(of("medal|F8").ask, "Medal takes a screenshot on F8, the key that shows the key list in Zenless Zone Zero.");
        let by_default = of("bandicam|F9");
        assert_eq!(by_default.text, "Bandicam shows or hides the FPS counter on F9 by default.");
        assert_eq!(by_default.menu_games, vec!["gi".to_string()]);
        for c in &got {
            let s = c.suggestion.as_deref().unwrap();
            assert!(!LOADER_KEYS.contains(&s) && !others.iter().any(|o| o.key == s), "{s}");
            assert!(!ours.menu.iter().chain(&ours.list).any(|m| m.1 == s) && !ours.combos.iter().any(|k| k == s), "{s}");
        }
    }

    #[test]
    fn a_profile_hotkey_gets_no_suggestion() {
        let others = [other("amd", "AMD Software", "takes a screenshot", "Ctrl+Shift+I".into(), false)];
        let got = clashes_in(&ours_with(&[("zzz", "F7", true)], &[], &["Ctrl+Shift+I"]), &others, &[]);
        assert_eq!(got.len(), 1);
        assert!(got[0].profile && got[0].suggestion.is_none());
        assert_eq!(got[0].ask, "AMD Software takes a screenshot on Ctrl+Shift+I, a key that switches a profile.");
    }

    #[test]
    fn moving_and_keeping() {
        let db = Db::memory().unwrap();
        let games: Vec<&str> = crate::games::GAMES.iter().map(|g| g.id).collect();
        let (a, b) = (games[0], games[1]);
        live::set_menu(&db, b, &MenuSettings { key: "Ctrl+Alt+M".into(), ..live::menu_settings(&db, b) }).unwrap();
        let moved = move_key(&db, "f7", "F9").unwrap();
        assert_eq!((moved.from.as_str(), moved.to.as_str()), ("F7", "F9"));
        assert!(moved.menu_games.contains(&a.to_string()) && !moved.menu_games.contains(&b.to_string()));
        assert_eq!(moved.text, "The skin menu opens with F9 now");
        assert_eq!(live::menu_settings(&db, a).key, "F9");
        assert_eq!(live::menu_settings(&db, b).key, "Ctrl+Alt+M");
        // a key gachamod has already is refused, and nothing moves
        assert!(move_key(&db, "F9", "Ctrl+Alt+M").is_err());
        assert!(move_key(&db, "F9", "F10").is_err());
        assert_eq!(live::menu_settings(&db, a).key, "F9");
        // undo is the same call the other way round
        assert_eq!(move_key(&db, "F9", "F7").unwrap().menu_games, moved.menu_games);
        assert_eq!(live::menu_settings(&db, a).key, "F7");
        assert!(move_key(&db, "F11", "F9").unwrap().menu_games.is_empty());

        keep(&db, "medal", "F7", true).unwrap();
        keep(&db, "medal", "F7", true).unwrap();
        assert_eq!(kept(&db), vec!["medal|F7".to_string()]);
        keep(&db, "medal", "F7", false).unwrap();
        assert!(kept(&db).is_empty());
    }

    #[test]
    fn kept_choices_are_listed() {
        let ours = ours_with(&[("zzz", "F7", true)], &[], &[]);
        let kept = vec!["medal|F7".to_string(), "obs|F5".to_string(), "odd".to_string()];
        let got = kept_in(&ours, &medal(MEDAL), &kept);
        // an id that isn't "app|key" is left out; a choice for a clash that is gone stays listed so it can be cleared
        assert_eq!(got.len(), 2, "{got:?}");
        assert_eq!((got[0].app.as_str(), got[0].text.as_str(), got[0].active), ("Medal", "Medal takes a screenshot on F7.", true));
        assert_eq!((got[1].app.as_str(), got[1].text.as_str(), got[1].active), ("OBS", "OBS used F5.", false));
    }

    #[test]
    fn a_clash_is_asked_about_a_few_times() {
        let db = Db::memory().unwrap();
        let all = || clashes_in(&ours_with(&[("zzz", "F7", true)], &[], &[]), &medal(MEDAL), &[]);
        for _ in 0..ASK_TIMES { assert_eq!(to_ask_in(&db, all()).len(), 1); }
        assert!(to_ask_in(&db, all()).is_empty());
        assert!(to_ask_in(&db, all()).is_empty());
        // gone and back: asked again
        assert!(to_ask_in(&db, vec![]).is_empty());
        assert_eq!(to_ask_in(&db, all()).len(), 1);
        db.set_setting(ASK, "0").unwrap();
        assert!(to_ask_in(&db, all()).is_empty());
    }

    // ── Medal's database, made in a temp folder the way Medal makes it ──

    /// The list in the order Medal writes it.
    const HOTKEYS: &str = r#"[{"action":"clip;length=30","device":"keyboard","type":"short_press","inputs":"F8"},{"action":"segment_toggle","device":"keyboard","type":"short_press","inputs":"ALT + F7"},{"action":"bookmark","device":"keyboard","type":"short_press","inputs":"F8"},{"action":"switch_game","device":"keyboard","type":"short_press","inputs":"F10"},{"action":"screenshot","device":"keyboard","type":"short_press","inputs":"F7"}]"#;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("gachamod-otherkeys-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn make_db(path: &Path, rows: &[(&str, &str)]) {
        let con = Connection::open(path).unwrap();
        con.query_row("PRAGMA journal_mode = WAL", [], |r| r.get::<_, String>(0)).unwrap();
        con.execute("CREATE TABLE key_values (key TEXT UNIQUE NOT NULL, value BLOB NOT NULL)", []).unwrap();
        for (k, v) in rows { con.execute("INSERT INTO key_values VALUES (?1, jsonb(?2))", [k, v]).unwrap(); }
    }

    /// (the value as JSON text, its bytes in hex, its type)
    fn row(path: &Path, key: &str) -> (String, String, String) {
        let con = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        con.query_row("SELECT json(value), hex(value), typeof(value) FROM key_values WHERE key = ?1", [key], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap()
    }

    #[test]
    fn medals_database_is_read() {
        let dir = temp("read");
        let guest = dir.join("medal-guest.db");
        let user = dir.join("medal-12345.db");
        let guest_keys = HOTKEYS.replace("\"F7\"", "\"F6\"");
        make_db(&guest, &[("User", r#"{"userId":"12345","guest":false}"#), ("Hotkeys", guest_keys.as_str())]);
        make_db(&user, &[("Hotkeys", HOTKEYS), ("ScreenshotEnabled", "true"), ("PushToTalkEnabled", "false")]);
        // signed in: that account's database
        assert_eq!(medal_db_path(&dir), Some(user.clone()));
        let got = merged(&medal_found(&dir));
        assert_eq!(keys(&got), vec![("F8", "saves a clip"), ("Alt+F7", "starts or stops a recording"), ("F10", SHORTCUT), ("F7", "takes a screenshot")]);
        assert!(got.iter().all(|o| o.change && !o.by_default), "{got:?}");
        // screenshots turned off there
        Connection::open(&user).unwrap().execute("UPDATE key_values SET value = jsonb('false') WHERE key = 'ScreenshotEnabled'", []).unwrap();
        assert!(!medal_found(&dir).iter().any(|o| o.key == "F7"));
        // signed out: the guest database
        Connection::open(&guest).unwrap().execute("UPDATE key_values SET value = jsonb(?1) WHERE key = 'User'", [r#"{"userId":"12345","guest":true}"#]).unwrap();
        assert_eq!(medal_db_path(&dir), Some(guest.clone()));
        assert!(medal_found(&dir).iter().any(|o| o.key == "F6" && o.does == "takes a screenshot"));
        // no list stored: the keys Medal ships with, which can't be changed
        Connection::open(&guest).unwrap().execute("DELETE FROM key_values WHERE key = 'Hotkeys'", []).unwrap();
        let shipped = medal_found(&dir);
        assert_eq!(keys(&shipped), vec![("F8", "saves a clip"), ("F7", "takes a screenshot")]);
        assert!(shipped.iter().all(|o| o.by_default && !o.change));
        // a key Medal spells its own way can't be written back, so it can't be changed
        let odd = MedalSet { hotkeys: serde_json::from_str(r#"[{"action":"screenshot","inputs":"Alt + F7"},{"action":"clip","inputs":"NUMPAD 1"}]"#).unwrap(), ..Default::default() };
        assert!(medal_keys(&odd, true).iter().all(|o| !o.change));
        // no database: the older settings.json, read only
        let old = temp("read-old");
        std::fs::create_dir_all(old.join("store")).unwrap();
        std::fs::write(old.join("store").join("settings.json"), MEDAL).unwrap();
        let legacy = medal_found(&old);
        assert!(legacy.iter().any(|o| o.key == "F7") && legacy.iter().all(|o| !o.change));
        // a file that isn't Medal's database, and an empty folder
        std::fs::write(old.join("medal-guest.db"), "not a database").unwrap();
        assert!(medal_found(&old).iter().any(|o| o.key == "F7"));
        let none = temp("read-none");
        assert!(medal_found(&none).is_empty());
        for d in [dir, old, none] { let _ = std::fs::remove_dir_all(d); }
    }

    #[test]
    fn medals_key_changes_in_place() {
        let dir = temp("change");
        let db = dir.join("medal-guest.db");
        make_db(&db, &[("Hotkeys", HOTKEYS), ("ScreenshotEnabled", "true"), ("VolumeRoots", r#"{"b":"D:\\Clips","a":[3,1,2]}"#)]);
        let before = std::fs::read(&db).unwrap();
        let ours = ours_with(&[("zzz", "F7", true)], &[("zzz", "F8", false)], &["Ctrl+Alt+1"]);
        let found = || medal_found(&dir);
        let change = |from: &str, to: &str, running: bool, undo: bool| change_in(&ours, &found(), Some(dir.as_path()), running, "medal", from, to, undo);

        // the clash offers the same free key to either app
        let all = clashes_in(&ours, &found(), &[]);
        let clash = &all[0];
        assert_eq!((clash.suggestion.as_deref(), clash.other_key.as_deref()), (Some("F9"), Some("F9")));
        assert_eq!(clash.other_needs.as_deref(), Some(MEDAL_NEEDS));

        // refused while Medal runs, and for a key that isn't free: nothing is written, not even the copy
        assert!(change("F7", "F9", true, false).unwrap_err().to_string().contains("Quit it from the tray icon"));
        for taken in ["F8", "F10", "F12", "F7", "Ctrl+Alt+1", "Ctrl+F9", "Alt+F7"] { assert!(change("F7", taken, false, false).is_err(), "{taken}"); }
        assert!(change("F5", "F9", false, false).is_err(), "Medal has no key on F5");
        assert!(change_in(&ours, &obs("[Hotkeys]\nOBSBasic.Screenshot={\"bindings\":[{\"key\":\"OBS_KEY_F7\"}]}\n"), Some(dir.as_path()), false, "obs", "F7", "F9", false).is_err());
        assert_eq!(std::fs::read(&db).unwrap(), before);
        assert!(!dir.join("medal-guest.db.gachamod.bak").exists() && medal_copies_in(&dir).is_none());

        // one value changes; the list keeps its order and the other rows their bytes
        let others = [row(&db, "ScreenshotEnabled"), row(&db, "VolumeRoots")];
        let done = change("F7", "F9", false, false).unwrap();
        assert_eq!((done.from.as_str(), done.to.as_str(), done.text.as_str()), ("F7", "F9", "Medal takes a screenshot on F9 now"));
        let (text, _, kind) = row(&db, "Hotkeys");
        assert_eq!(text, HOTKEYS.replace("\"inputs\":\"F7\"}", "\"inputs\":\"F9\"}"));
        assert_eq!(kind, "blob");
        assert_eq!([row(&db, "ScreenshotEnabled"), row(&db, "VolumeRoots")], others);
        // the copy from before the first write
        assert_eq!(std::fs::read(dir.join("medal-guest.db.gachamod.bak")).unwrap(), before);
        // the copy is found and measured, and the change says where it is
        let copies = medal_copies_in(&dir).unwrap();
        assert!(copies.path.ends_with("medal-guest.db.gachamod.bak") && copies.bytes >= before.len() as u64 && copies.files >= 1);
        assert_eq!(done.backup.as_deref(), Some(copies.path.as_str()));
        // gachamod keeps F7 and nothing clashes
        assert!(found().iter().any(|o| o.key == "F9" && o.does == "takes a screenshot"));
        assert!(clashes_in(&ours, &found(), &[]).is_empty());

        // undo puts the old key back although gachamod uses it, byte for byte, under the same closed rule
        assert!(change("F9", "F7", true, true).is_err());
        change("F9", "F7", false, true).unwrap();
        assert_eq!(row(&db, "Hotkeys").0, HOTKEYS);
        // the copy is taken once per run, so it still holds the first state
        assert_eq!(std::fs::read(dir.join("medal-guest.db.gachamod.bak")).unwrap(), before);

        // a key with two jobs moves both
        change("F8", "F11", false, false).unwrap();
        assert_eq!(row(&db, "Hotkeys").0.matches("\"inputs\":\"F11\"").count(), 2);
        assert!(!found().iter().any(|o| o.key == "F8"));
        // a key with a modifier goes back the way Medal wrote it
        change("Alt+F7", "F9", false, false).unwrap();
        change("F9", "Alt+F7", false, true).unwrap();
        assert!(row(&db, "Hotkeys").0.contains("\"inputs\":\"ALT + F7\""));

        // settings from the older file can't be changed
        let old = temp("change-old");
        std::fs::create_dir_all(old.join("store")).unwrap();
        std::fs::write(old.join("store").join("settings.json"), MEDAL).unwrap();
        assert!(change_in(&ours, &medal_found(&old), Some(old.as_path()), false, "medal", "F7", "F9", false).is_err());
        assert_eq!(std::fs::read_to_string(old.join("store").join("settings.json")).unwrap(), MEDAL);
        for d in [dir, old] { let _ = std::fs::remove_dir_all(d); }
    }
}
