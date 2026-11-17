//! Switching a character's skins in game without a reload (docs/ingame.md 7.1 and 7.2).
//!
//! A live group is one character's mods. All of them stay loaded, and each mod's draw sections only run while the
//! group's number in `Mods\gachamod live\live.ini` equals that mod's slot, so changing the number swaps the skin at
//! once. While the game runs the app sets the number with keys nothing else uses: it holds Clear, holds some of F13
//! to F22 as the bits of a number, and taps F23 (that number is the group) and then F24 (show that slot). Keys only,
//! because a game that hides the cursor snaps it back to the middle every frame. With the game closed the app writes
//! the saved value.
//!
//! The ini edits are fenced (`; gachamod:begin` ... `; gachamod:end`, `; gachamod:was` before a changed key condition,
//! `; gachamod:added` before an added line) so taking a mod out again removes exactly what was added. Files are read
//! byte for byte (each byte one char), so text in any encoding comes back unchanged.
//!
//! The player picks a skin in one of two menus (the game's setting "<game>.liveMenu"): gachamod's own window over
//! the game ("window", src-tauri overlay.rs), or a plainer menu the game draws itself ("game", menu.rs), which is
//! also what opens when the game holds the screen in exclusive fullscreen. Owner: INGAME area.

mod menu;

use crate::backups;
use crate::db::Db;
use crate::error::{Error, Result};
use crate::keys::{ModBackup, ModSkip};
use crate::model::{ModChange, ModEntry};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};

/// Games where the menu the game draws has been checked with the real game. Switching in game is on by default
/// there (`on_start`).
pub const CHECKED: &[&str] = &["zzz", "gi"];

/// Games that draw the way the checked ones do: miHoYo's Unity engine, loaded by an XXMI importer of GIMI's line in
/// hook mode. The drawn menu is open there too; switching in game stays off until the player turns it on.
pub const SIMILAR: &[&str] = &["hsr", "hi3"];

/// The menu the game draws needs no tester options in this game. In the others it is a tester option (`TESTER`);
/// switching in game itself and the window over the game work in every game.
pub fn drawn_menu_open(game: &str) -> bool { CHECKED.contains(&game) || SIMILAR.contains(&game) }

/// Tester options are on: "1" only once the player turned them on and confirmed the risks the app showed. The older
/// "ui.tester" switch was set without that question and isn't read any more.
pub const TESTER: &str = "ui.testerOk";

/// Whether the menu the game draws can be used in this game: one it is open in, or tester options are on.
pub fn allowed(db: &Db, game: &str) -> bool {
    drawn_menu_open(game) || db.setting(TESTER).ok().flatten().as_deref() == Some("1")
}

fn drawn_menu_allowed(db: &Db, game: &str) -> Result<()> {
    if allowed(db, game) { return Ok(()); }
    let name = crate::games::def(game).map_or("this game", |g| g.name);
    Err(Error::Invalid(format!("The menu the game draws is a tester option in {name}. Turn on Tester options in Settings, Feedback to try it")))
}

/// The folder under Mods that holds live.ini. The library scan skips it.
pub const DIR: &str = "gachamod live";
const BEGIN: &str = "; gachamod:begin";
const END: &str = "; gachamod:end";
const WAS: &str = "; gachamod:was ";
const ADDED: &str = "; gachamod:added";
/// Ten keys carry a number, so groups and slots stay under 1024.
const BITS: u32 = 10;
const MAX_GROUPS: u32 = 600;
const MAX_SLOTS: u32 = 600;

fn gate(group: u32, slot: u32) -> String { format!("$\\gachamod\\live\\g{group} == {slot}") }
/// A skin's keys also rest while the game's own menu is open, so its arrow keys don't flip the mod's options.
fn key_gate(group: u32, slot: u32) -> String { format!("{} && $\\gachamod\\live\\open == 0", gate(group, slot)) }
/// The line a gated section runs when it draws, which tells the menu the character is on screen.
const SEEN: &str = "run = CommandList\\gachamod\\live\\Seen";
pub(crate) fn var_name(group: u32) -> String { format!("gachamod\\live\\g{group}") }
/// The saved value that says a group's character is on screen (`menu::constants`, `CommandListOnScreen`).
fn on_screen_name(group: u32) -> String { format!("gachamod\\live\\o{group}") }

/// The groups among `groups` whose character the game saved as on screen, in that order.
fn on_screen(importer: &Path, groups: impl Iterator<Item = u32>) -> Vec<u32> {
    groups.filter(|n| crate::ini::user_value(importer, &on_screen_name(*n)).and_then(|v| v.parse::<f64>().ok()).is_some_and(|v| v >= 0.5)).collect()
}

// ── what the app remembers (setting "live.<game>") ──

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct Store {
    groups: Vec<GroupRec>,
    /// Mods the player took out by hand. "Every character" (the setting "<game>.liveAll") leaves these alone.
    #[serde(default)]
    out: Vec<String>,
    /// Groups whose pick the running game didn't get (gachamod's keys couldn't reach it). live.ini asks for them once,
    /// at the game's next load (F10), under the number `ask`; the game keeps the last number it took in `$asked`.
    /// Until it has, what the game saves for these groups is older than the app's pick and isn't read back.
    #[serde(default)]
    waiting: Vec<u32>,
    #[serde(default)]
    ask: u32,
}

/// The saved value that says which request in live.ini the game took last.
const ASKED: &str = "gachamod\\live\\asked";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct GroupRec {
    n: u32,
    character: String,
    /// The slot showing (0: none of them, the game's own look).
    active: u32,
    /// Slots are never reused while the group lives, so a mod's number never changes under it.
    next: u32,
    slots: Vec<SlotRec>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct SlotRec { slot: u32, mod_id: String }

fn key(game: &str) -> String { format!("live.{game}") }
fn load(db: &Db, game: &str) -> Store { db.setting_json::<Store>(&key(game)).ok().flatten().unwrap_or_default() }
fn save(db: &Db, game: &str, s: &Store) -> Result<()> { db.set_setting_json(&key(game), s) }

// ── what the UI gets ──

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LiveMod { pub mod_id: String, pub slot: u32, pub name: String, pub enabled: bool, pub preview: Option<String> }

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LiveGroup {
    pub group: u32, pub character: String, pub active: u32, pub mods: Vec<LiveMod>,
    /// The app's pick couldn't be keyed in, so the game shows it at its next reload.
    pub waiting: bool,
}

/// A character with two or more mods that aren't all live yet.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LiveReady { pub character: String, pub mods: Vec<LiveMod> }

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LiveInfo {
    pub groups: Vec<LiveGroup>, pub ready: Vec<LiveReady>, pub running: bool, pub menu: MenuSettings,
    /// The panel's one switch: every mod that has a character switches in game, and new ones join by themselves
    /// ("<game>.liveAll"). On by default in the checked games (`on_start`).
    pub all: bool,
    /// The game runs as administrator and gachamod doesn't, so gachamod's keys never reach it: the game's own menu
    /// is the one that opens, and the player presses F10 after a change.
    pub blocked: bool,
    /// The menu the game draws can be used here: a game it is open in, or tester options are on (`allowed`).
    pub allowed: bool,
    /// The drawn menu needs no tester options here (`drawn_menu_open`). Elsewhere it is marked as a tester option,
    /// also once they are on.
    pub checked: bool,
    /// The groups whose character the game last saved as on screen (`$o<group>` in d3dx_user.ini), in the order of
    /// `groups`. Empty while the game isn't running: values left from its last run say nothing.
    pub on_screen: Vec<u32>,
}

/// How the skin menu opens while playing. `style`: "window" (gachamod's menu over the game; the game draws its own
/// when it is in exclusive fullscreen) or "game" (always the one the game draws). `key` is written like a
/// hotkey ("F7", "Ctrl+Alt+M"). `pad`: a controller works the menu too. `fast_save`: the game saves its values
/// every second, so a pick made in its own menu shows in the app at once (`fast_saves`). `binds`: the keys of
/// everything else the menu does (`MENU_BINDS`), each thing with its 3DMigoto bindings; a thing left out of a
/// change keeps its keys.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MenuSettings {
    pub style: String, pub key: String, pub pad: bool, #[serde(default = "yes")] pub fast_save: bool,
    #[serde(default)] pub binds: BTreeMap<String, Vec<String>>,
}

fn yes() -> bool { true }

impl Default for MenuSettings {
    fn default() -> Self { MenuSettings { style: "window".into(), key: MENU_KEY.into(), pad: true, fast_save: true, binds: default_binds() } }
}

impl MenuSettings {
    /// The keys of one thing the menu does, a controller's left out when `pad` is off.
    pub fn binds_of(&self, action: &str) -> Vec<String> {
        self.binds.get(action).into_iter().flatten().filter(|b| self.pad || !is_pad(b)).cloned().collect()
    }
}

/// What a key can do in the skin menu: its name, its keys until the player picks others (3DMigoto bindings, a
/// keyboard key then a controller's button) and what it does, for messages. "open" holds only a controller's
/// buttons: the keyboard key that opens the menu is `MenuSettings::key`, which the app itself listens for.
pub const MENU_BINDS: &[(&str, &[&str], &str)] = &[
    ("open", &["XB_LEFT_THUMB XB_RIGHT_THUMB"], "opens the menu"),
    ("up", &["VK_UP", "XB_DPAD_UP"], "moves up"),
    ("down", &["VK_DOWN", "XB_DPAD_DOWN"], "moves down"),
    // Enter works too but the hints name the first key: games open their chat on Enter
    ("show", &["VK_RIGHT", "XB_DPAD_RIGHT", "VK_RETURN", "XB_A"], "shows the row"),
    ("back", &["VK_LEFT", "XB_DPAD_LEFT"], "goes back to the characters"),
    ("close", &["XB_B"], "closes the menu"),
    ("keys", &["XB_Y"], "shows the key list"),
];
/// Keys one thing can have.
const MAX_BINDS: usize = 4;

fn default_binds() -> BTreeMap<String, Vec<String>> {
    MENU_BINDS.iter().map(|(a, keys, _)| (a.to_string(), keys.iter().map(|k| k.to_string()).collect())).collect()
}

fn is_pad(binding: &str) -> bool { binding.split_whitespace().any(|t| t.to_ascii_uppercase().starts_with("XB")) }

/// The menu's keys after a change, checked: each written one way, no key doing two things, at most four for one.
/// A thing `new` leaves out keeps what it had. `key` is the keyboard key that opens the menu.
fn checked_binds(new: &BTreeMap<String, Vec<String>>, was: &BTreeMap<String, Vec<String>>, key: &str) -> Result<BTreeMap<String, Vec<String>>> {
    let menu_key = crate::keys::clean_binding(&crate::hotkeys::migoto_form(key)).unwrap_or_default();
    let mut seen: Vec<(String, &str)> = vec![(menu_key, "opens the menu")];
    let mut out = BTreeMap::new();
    for (action, _, what) in MENU_BINDS {
        let mut clean: Vec<String> = Vec::new();
        for b in new.get(*action).or_else(|| was.get(*action)).into_iter().flatten() {
            let b = crate::keys::clean_binding(b)?;
            if clean.contains(&b) { continue; }
            let label = crate::ini::binding_label(&b);
            if *action == "open" && !is_pad(&b) {
                return Err(Error::Invalid(format!("{label} is a keyboard key. Set it as the key that opens the menu. This row takes a controller's buttons")));
            }
            if let Some((_, does)) = seen.iter().find(|(k, _)| *k == b) { return Err(Error::Invalid(format!("{label} already {does}. Pick another key"))); }
            clean.push(b);
        }
        if clean.len() > MAX_BINDS { return Err(Error::Invalid(format!("One thing can have {MAX_BINDS} keys. Remove one first"))); }
        seen.extend(clean.iter().map(|b| (b.clone(), *what)));
        out.insert(action.to_string(), clean);
    }
    Ok(out)
}

/// The keys the drawn menu's hints name: each thing's first keyboard key, or its first key of any kind.
fn hint_keys(set: &MenuSettings) -> menu::HintKeys {
    let cap = |action: &str| {
        let b = set.binds_of(action);
        b.iter().find(|k| !is_pad(k)).or(b.first()).map(|k| menu::cap_name(k)).unwrap_or_default()
    };
    menu::HintKeys { up: cap("up"), down: cap("down"), show: cap("show"), back: cap("back"), close: set.key.clone() }
}

/// F6 and F12 are the loaders' own keys, F10 reloads.
pub const MENU_KEY: &str = "F7";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveChange {
    pub changed: Vec<String>,
    pub skipped: Vec<ModSkip>,
    pub backups: Vec<ModBackup>,
    /// Mods turned on (they must be loaded to switch) or off (taken out while not showing).
    pub turned_on: Vec<String>,
    pub turned_off: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Picked {
    /// The mod was off and had to be turned on: it shows after the next reload (sent by itself when the game is
    /// in front).
    pub reload: bool,
    /// The game is running: the caller sends the pick with `flush_sends`.
    pub send: bool,
    /// From `flush_sends`: the pick waits for F10 in the game (said once per run).
    pub note: Option<String>,
}

// ── reading and changing the inis ──

/// Bytes to text one char per byte (Latin-1), so writing back gives the same bytes for any encoding.
fn to_text(b: &[u8]) -> String { b.iter().map(|&c| c as char).collect() }
fn to_bytes(s: &str) -> Vec<u8> { s.chars().map(|c| c as u32 as u8).collect() }

fn header(line: &str) -> Option<String> {
    let t = line.trim();
    let rest = t.strip_prefix('[')?;
    let end = rest.find(']')?;
    Some(rest[..end].trim().to_ascii_lowercase())
}

fn line_key(line: &str) -> Option<String> {
    let t = line.trim();
    if t.is_empty() || t.starts_with(';') { return None; }
    t.split_once('=').map(|(k, _)| k.trim().to_ascii_lowercase())
}

/// Sections whose commands draw: these run only while their mod is the group's pick.
fn draws(section: &str) -> bool {
    section.starts_with("textureoverride") || section.starts_with("shaderoverride") || section == "present"
        || (section.starts_with("shaderregex") && !section.contains('.'))
        || ["clearrendertargetview", "cleardepthstencilview", "clearunorderedaccessviewuint", "clearunorderedaccessviewfloat"].iter().any(|p| section.starts_with(p))
}

/// Lines that describe what a section matches rather than run: they stay above the gate.
fn setting(section: &str, key: &str) -> bool {
    if section.starts_with("textureoverride") {
        return key.starts_with("match_") || ["hash", "format", "width", "height", "width_multiply", "height_multiply", "iteration", "filter_index",
            "expand_region_copy", "deny_cpu_read", "stereomode", RAISE, "override_byte_stride"].contains(&key);
    }
    if section.starts_with("shaderoverride") {
        return ["hash", "allow_duplicate_hash", "depth_filter", "partner", "model", "disable_scissor", "filter_index", "iteration"].contains(&key);
    }
    if section.starts_with("shaderregex") { return ["shader_model", "temps", "filter_index"].contains(&key); }
    false
}

fn ending(line: &str) -> &'static str { if line.ends_with("\r\n") { "\r\n" } else if line.ends_with('\n') { "\n" } else { "" } }

/// A mod with more vertices than the game's own model raises the size of the game's buffer with this key. The
/// loader reads it when it first meets the buffer, not when a skin is picked, so it is never gated, and every skin
/// of a character asks for the largest size any of them needs (`raises`).
const RAISE: &str = "override_vertex_count";

fn value(line: &str) -> &str { line.split_once('=').map_or("", |(_, v)| v.trim()) }

/// The largest vertex count each buffer hash is raised to, over these inis as their authors wrote them.
fn raises<'a>(texts: impl Iterator<Item = &'a str>) -> HashMap<String, u32> {
    let mut out: HashMap<String, u32> = HashMap::new();
    for text in texts {
        let text = unwrap(text);
        let (mut on, mut hash, mut count): (bool, Option<String>, Option<u32>) = (false, None, None);
        let mut close = |on: bool, hash: Option<String>, count: Option<u32>| {
            if let (true, Some(h), Some(c)) = (on, hash, count) { let e = out.entry(h).or_insert(0); *e = (*e).max(c); }
        };
        for l in text.lines() {
            if let Some(name) = header(l) {
                close(on, hash.take(), count.take());
                on = name.starts_with("textureoverride");
                continue;
            }
            match line_key(l).as_deref() {
                Some("hash") => hash = Some(value(l).to_ascii_lowercase()),
                Some(RAISE) => count = value(l).parse().ok(),
                _ => {}
            }
        }
        close(on, hash, count);
    }
    out
}

/// Take out everything `wrap` added, exactly.
pub fn unwrap(text: &str) -> String {
    let lines: Vec<&str> = text.split_inclusive('\n').collect();
    let mut drop = vec![false; lines.len()];
    let mut replace: HashMap<usize, String> = HashMap::new();
    for (i, l) in lines.iter().enumerate() {
        let t = l.trim();
        if t == BEGIN {
            drop[i] = true;
            let mut j = i + 1;
            if lines.get(j).is_some_and(|n| n.trim().starts_with(SEEN)) { drop[j] = true; j += 1; }
            if lines.get(j).is_some_and(|n| n.trim().starts_with("if $\\gachamod\\live\\")) { drop[j] = true; }
        } else if t == END {
            drop[i] = true;
            if i > 0 && lines[i - 1].trim().eq_ignore_ascii_case("endif") { drop[i - 1] = true; }
        } else if t == ADDED {
            drop[i] = true;
            if i + 1 < lines.len() { drop[i + 1] = true; }
        } else if let Some(orig) = t.strip_prefix(WAS.trim_end()) {
            let orig = orig.trim_start();
            drop[i] = true;
            if i + 1 < lines.len() {
                if orig == "-" { drop[i + 1] = true; } else { replace.insert(i + 1, format!("{orig}{}", ending(lines[i + 1]))); }
            }
        }
    }
    let mut out = String::with_capacity(text.len());
    for (i, l) in lines.iter().enumerate() {
        if drop[i] && !replace.contains_key(&i) { continue; }
        match replace.get(&i) { Some(r) => out.push_str(r), None => out.push_str(l) }
    }
    out
}

/// Gate one ini's draw sections and keys on `group == slot`. Earlier edits are taken out first, so wrapping again
/// with another slot is safe. None when the ini has nothing to gate.
pub fn wrap(text: &str, group: u32, slot: u32) -> std::result::Result<Option<String>, String> {
    wrap_with(text, group, slot, &HashMap::new())
}

/// `wrap`, with the vertex count each buffer hash has to be raised to for the whole group (`raises`).
fn wrap_with(text: &str, group: u32, slot: u32, raise: &HashMap<String, u32>) -> std::result::Result<Option<String>, String> {
    let text = unwrap(text);
    let nl = if text.contains("\r\n") || !text.contains('\n') { "\r\n" } else { "\n" };
    let g = gate(group, slot);
    let kg = key_gate(group, slot);
    let lines: Vec<&str> = text.split_inclusive('\n').collect();
    // (header index or None for the lines before the first header, body range)
    let mut sections: Vec<(Option<usize>, usize, usize)> = Vec::new();
    let mut start = 0;
    let mut head: Option<usize> = None;
    for (i, l) in lines.iter().enumerate() {
        if header(l).is_some() {
            sections.push((head, start, i));
            head = Some(i);
            start = i + 1;
        }
    }
    sections.push((head, start, lines.len()));

    let with_nl = |l: &str| if ending(l).is_empty() { format!("{l}{nl}") } else { l.to_string() };
    let mut out = String::with_capacity(text.len() + 256);
    let mut gated = 0;
    for (h, a, b) in sections {
        let name = h.and_then(|i| header(lines[i])).unwrap_or_default();
        if let Some(i) = h { out.push_str(&with_nl(lines[i])); }
        let body = &lines[a..b];
        if h.is_some() && draws(&name) {
            let cmds: Vec<usize> = (0..body.len()).filter(|&j| line_key(body[j]).is_some_and(|k| !setting(&name, &k))
                || body[j].trim().to_ascii_lowercase().starts_with("if ") || body[j].trim().eq_ignore_ascii_case("endif")
                || body[j].trim().eq_ignore_ascii_case("else")).collect();
            // an endif that closes no if is an author's slip the loader skips; inside the gate it would close the
            // gate early, so it becomes a comment (taken back out by `unwrap`)
            let mut depth = 0i32;
            let mut stray: HashSet<usize> = HashSet::new();
            for (j, l) in body.iter().enumerate() {
                let t = l.trim().to_ascii_lowercase();
                if t.starts_with("if ") { depth += 1; }
                if t == "endif" { if depth == 0 { stray.insert(j); } else { depth -= 1; } }
            }
            if depth != 0 { return Err(format!("its [{}] section has an if without an endif", lines[h.unwrap_or(0)].trim().trim_matches(['[', ']']))); }
            let line = |j: usize| if stray.contains(&j) {
                format!("{WAS}{}{nl}; this endif closes no if, so the loader skips it{}", body[j].trim(), if ending(body[j]).is_empty() { nl } else { ending(body[j]) })
            } else { body[j].to_string() };
            let keys: HashSet<String> = body.iter().filter_map(|l| line_key(l)).collect();
            // settings stay above the gate
            let most = body.iter().find(|l| line_key(l).as_deref() == Some("hash")).and_then(|l| raise.get(&value(l).to_ascii_lowercase())).copied();
            for l in body.iter().filter(|l| line_key(l).is_some_and(|k| setting(&name, &k))) {
                // another skin of the character needs a bigger buffer than this one asks for
                match most.filter(|m| line_key(l).as_deref() == Some(RAISE) && value(l).parse::<u32>().is_ok_and(|own| own < *m)) {
                    Some(m) => out.push_str(&format!("{WAS}{}{nl}{RAISE} = {m}{nl}", l.trim())),
                    None => out.push_str(&with_nl(l)),
                }
            }
            // several skins match the same hash: these quiet the loader's duplicate warnings
            if name.starts_with("textureoverride") && !keys.iter().any(|k| k.starts_with("match_")) {
                out.push_str(&format!("{ADDED}{nl}match_priority = 0{nl}"));
            }
            if name.starts_with("shaderoverride") && !keys.contains("allow_duplicate_hash") {
                out.push_str(&format!("{ADDED}{nl}allow_duplicate_hash = true{nl}"));
            }
            let last = cmds.last().copied();
            let rest: Vec<usize> = (0..body.len()).filter(|&j| !line_key(body[j]).is_some_and(|k| setting(&name, &k))).collect();
            match last {
                Some(last) => {
                    gated += 1;
                    out.push_str(&format!("{BEGIN}{nl}"));
                    if name.starts_with("textureoverride") { out.push_str(&format!("{SEEN}{group}{nl}")); }
                    out.push_str(&format!("if {g}{nl}"));
                    for &j in rest.iter().filter(|&&j| j <= last) { out.push_str(&with_nl(&line(j))); }
                    out.push_str(&format!("endif{nl}{END}{nl}"));
                    for &j in rest.iter().filter(|&&j| j > last) { out.push_str(&line(j)); }
                }
                None => for &j in &rest { out.push_str(&line(j)); },
            }
            continue;
        }
        if h.is_some() && name.starts_with("key") {
            gated += 1;
            match body.iter().position(|l| line_key(l).as_deref() == Some("condition")) {
                Some(c) => {
                    for (j, l) in body.iter().enumerate() {
                        if j == c {
                            let old = l.trim_end_matches(['\r', '\n']);
                            let value = old.split_once('=').map(|(_, v)| v.trim()).unwrap_or_default();
                            out.push_str(&format!("{WAS}{}{nl}condition = ({value}) && {kg}{}", old.trim(), if ending(l).is_empty() { nl } else { ending(l) }));
                        } else { out.push_str(l); }
                    }
                }
                None => {
                    out.push_str(&format!("{WAS}-{nl}condition = {kg}{nl}"));
                    for l in body { out.push_str(l); }
                }
            }
            continue;
        }
        for l in body { out.push_str(l); }
    }
    Ok((gated > 0).then_some(out))
}

/// Reasons a mod can't be switched live, before touching anything.
fn refuse(m: &ModEntry, inis: &[(PathBuf, String, String)]) -> Option<String> {
    if m.rel_path.to_ascii_lowercase().contains("_managed_") || inis.iter().any(|(_, _, t)| t.contains("modmanageragl")) {
        return Some("No Reload Mod Manager manages it. Move your mods out of it first (Tools, Sharing)".into());
    }
    const LIBS: [&str; 8] = ["orfix", "rabbitfx", "slotfix", "healthbar", "texfx", "global\\", "offsetfix", "skinfix"];
    const CORES: [&str; 6] = ["gimi", "srmi", "wwmi", "zzmi", "efmi", "himi"];
    for (_, _, t) in inis {
        for l in t.lines() {
            if line_key(l).as_deref() != Some("namespace") { continue; }
            let v = l.split_once('=').map(|(_, v)| v.trim().to_ascii_lowercase()).unwrap_or_default();
            if LIBS.iter().any(|x| v.contains(x)) || CORES.iter().any(|c| v == *c || v.starts_with(&format!("{c}\\"))) {
                return Some("It's a library other mods use, so it has to stay on".into());
            }
        }
    }
    None
}

struct Edit { abs: PathBuf, rel: String, bytes: Vec<u8> }

/// The buffer sizes a set of mods (one character's skins) needs between them.
fn group_raises<'a>(mods: impl Iterator<Item = &'a ModEntry>) -> HashMap<String, u32> {
    let texts: Vec<String> = mods.flat_map(|m| crate::ini::mod_inis(Path::new(&m.path))).filter_map(|(abs, _)| std::fs::read(abs).ok()).map(|b| to_text(&b)).collect();
    raises(texts.iter().map(String::as_str))
}

/// The new text of each of a mod's inis, gated on (group, slot).
fn plan(m: &ModEntry, group: u32, slot: u32, raise: &HashMap<String, u32>) -> std::result::Result<Vec<Edit>, String> {
    let dir = Path::new(&m.path);
    let mut inis = Vec::new();
    for (abs, rel) in crate::ini::mod_inis(dir) {
        let bytes = std::fs::read(&abs).map_err(|e| format!("couldn't read {rel}: {e}"))?;
        if bytes.starts_with(&[0xFF, 0xFE]) || bytes.starts_with(&[0xFE, 0xFF]) {
            return Err(format!("{rel} is saved as UTF-16, which gachamod doesn't edit"));
        }
        inis.push((abs, rel, to_text(&bytes)));
    }
    if let Some(r) = refuse(m, &inis) { return Err(r); }
    let mut out = Vec::new();
    let mut any = false;
    for (abs, rel, text) in inis {
        let new = wrap_with(&text, group, slot, raise).map_err(|e| format!("in {rel}, {e}"))?;
        if let Some(new) = new {
            any |= new.contains(BEGIN);
            // already gated this way: nothing to write
            if new != text { out.push(Edit { abs, rel, bytes: to_bytes(&new) }); }
        }
    }
    if !any { return Err("it doesn't replace anything gachamod can switch".into()); }
    Ok(out)
}

/// Write a mod's edits after a backup. False when nothing could be saved (the files are as they were).
fn write_edits(db: &Db, game: &str, m: &ModEntry, edits: &[Edit], why: &str) -> std::result::Result<Option<ModBackup>, String> {
    if edits.is_empty() { return Ok(None); }
    let rels: Vec<String> = edits.iter().map(|e| e.rel.clone()).collect();
    let backup = backups::take(db, game, &m.id, Path::new(&m.path), &rels, why).map_err(|e| e.to_string())?;
    for e in edits {
        if let Err(err) = crate::xxmi::write_atomic(&e.abs, &e.bytes) {
            let _ = backups::restore(db, &backup.id);
            return Err(format!("couldn't save its ini: {err}"));
        }
    }
    Ok(Some(ModBackup { mod_id: m.id.clone(), name: m.name.clone(), backup }))
}

/// Take the gates out of a mod's inis. Returns the files changed.
fn unplan(m: &ModEntry) -> Vec<Edit> {
    let mut out = Vec::new();
    for (abs, rel) in crate::ini::mod_inis(Path::new(&m.path)) {
        let Ok(bytes) = std::fs::read(&abs) else { continue };
        let text = to_text(&bytes);
        if !text.contains("; gachamod:") { continue; }
        let new = unwrap(&text);
        if new != text { out.push(Edit { abs, rel, bytes: to_bytes(&new) }); }
    }
    out
}

// ── live.ini ──

/// Whether gachamod's key presses and hotkeys work with this game. They don't when the game runs as administrator
/// (seen the last time it ran, kept in "<game>.elevated") and gachamod doesn't.
fn reaches(db: &Db, game: &str) -> bool {
    crate::devtools::self_elevated() || db.setting(&format!("{game}.elevated")).ok().flatten().as_deref() != Some("1")
}

/// The game started: remember whether it runs as administrator, and write live.ini again when that changes who holds
/// the menu key (it also depends on whether gachamod runs as administrator, which can differ from the last run).
pub fn note_elevation(db: &Db, game: &str) {
    let pids = crate::launch::game_pids(&crate::launch::processes(), game);
    if pids.is_empty() { return; }
    let now = if pids.iter().any(|p| crate::devtools::elevated(*p)) { "1" } else { "0" };
    let key = format!("{game}.elevated");
    if db.setting(&key).ok().flatten().as_deref() != Some(now) { let _ = db.set_setting(&key, now); }
    menu_sync(db, game);
}

/// gachamod started: switching in game is on in the checked games unless the player turned it off, and live.ini of
/// every game says who holds the menu key for this run (gachamod may run with other rights than last time), before a
/// game loads it.
pub fn on_start(db: &Db) {
    for g in CHECKED {
        if let Err(e) = start_on(db, g) { crate::logs::warn(format!("Couldn't turn on switching skins in game for {g}: {e}")); }
    }
    window_menu_once(db);
    for g in crate::games::GAMES { menu_sync(db, g.id); }
}

/// Once: every game opens the window over the game again. That is the default since 0.1.1-beta.9; the menu the game
/// draws only opens in exclusive fullscreen, or when gachamod can't hear the key. Earlier versions offered "Inside
/// the game" as the everyday choice, and players who picked it while it was new kept a plainer menu.
fn window_menu_once(db: &Db) {
    const DONE: &str = "live.windowMenuSet";
    if db.setting(DONE).ok().flatten().is_some() { return; }
    for g in crate::games::GAMES {
        let key = format!("{}.liveMenu", g.id);
        if db.setting(&key).ok().flatten().as_deref() == Some("game") {
            let _ = db.set_setting(&key, "window");
            crate::logs::info(format!("{}: the skin menu opens over the game again", g.id));
        }
    }
    let _ = db.set_setting(DONE, "1");
}

/// Once per game, the first time this version starts: switching in game goes on, also where it was off. It is on by
/// default, and the one release that took live characters apart (0.1.1-beta.3) turned it off without asking. After
/// this only the player's switch turns it off.
fn start_on(db: &Db, game: &str) -> Result<()> {
    let done = format!("{game}.liveAllSet");
    if db.setting(&done)?.is_some() { return Ok(()); }
    if !all_on(db, game) {
        let c = set_all(db, game, true)?;
        if !c.changed.is_empty() { crate::logs::info(format!("{game}: {} mods switch in game again", c.changed.len())); }
    }
    db.set_setting(&done, "1")?;
    Ok(())
}

/// The groups in the order the menu lists them: by character name.
fn by_name(store: &Store) -> Vec<&GroupRec> {
    let mut v: Vec<&GroupRec> = store.groups.iter().collect();
    v.sort_by(|a, b| a.character.to_lowercase().cmp(&b.character.to_lowercase()).then(a.n.cmp(&b.n)));
    v
}

/// `key_list`: the key list the game draws, when it is on and a live skin has keys to show.
fn live_ini(store: &Store, set: &MenuSettings, lay: &menu::Layout, reach: bool, key_list: Option<&menu::KeyListIni>) -> String {
    let nl = "\r\n";
    let on = set.style != "off";
    let key_list = key_list.filter(|k| on && !k.sheets.is_empty());
    let pages: Vec<menu::IniPage> = by_name(store).into_iter().map(|g| menu::IniPage { n: g.n, slots: g.slots.iter().map(|s| s.slot).collect() }).collect();
    let mut s = String::new();
    s.push_str(&format!("; gachamod writes this file to switch skins in game without a reload. Your changes here are replaced.{nl}"));
    s.push_str(&format!("namespace = gachamod\\live{nl}{nl}[Constants]{nl}"));
    for g in &store.groups { s.push_str(&format!("global persist $g{} = {}{nl}", g.n, g.active)); }
    s.push_str(&format!("global persist $asked = 0{nl}"));
    for i in 0..BITS { s.push_str(&format!("global $c{i} = 0{nl}")); }
    s.push_str(&format!("global $cv = 0{nl}global $cg = 0{nl}"));
    s.push_str(&menu::constants(&pages, on, key_list.is_some()));
    s.push_str(&format!("{nl}; how the app talks to the game: while it holds Clear, the keys F13 to F22 it holds are the bits of a number,{nl}"));
    s.push_str(&format!("; a tap of F23 keeps that number as the group, and a tap of F24 shows that slot of the group{nl}"));
    for i in 0..BITS {
        s.push_str(&format!("[KeyGachamodBit{i}]{nl}key = VK_CLEAR VK_F{}{nl}type = hold{nl}$c{i} = 1{nl}{nl}", 13 + i));
    }
    let sum: Vec<String> = (0..BITS).map(|i| if i == 0 { "$c0".to_string() } else { format!("$c{i} * {}", 1u32 << i) }).collect();
    s.push_str(&format!("[CommandListGachamodNumber]{nl}$cv = {}{nl}{nl}", sum.join(" + ")));
    s.push_str(&format!("[KeyGachamodGroup]{nl}key = VK_CLEAR VK_F23{nl}run = CommandListGachamodGroup{nl}{nl}"));
    s.push_str(&format!("[CommandListGachamodGroup]{nl}run = CommandListGachamodNumber{nl}$cg = $cv{nl}{nl}"));
    s.push_str(&format!("[KeyGachamodPick]{nl}key = VK_CLEAR VK_F24{nl}run = CommandListGachamodPick{nl}{nl}"));
    s.push_str(&format!("[CommandListGachamodPick]{nl}run = CommandListGachamodNumber{nl}"));
    for g in &store.groups {
        s.push_str(&format!("if $cg == {}{nl}  $g{} = $cv{nl}endif{nl}", g.n, g.n));
    }
    if on {
        s.push_str(&format!("; with no group, {} opens or closes the menu{nl}", menu::TOGGLE));
        s.push_str(&format!("if $cg == 0 && $cv == {}{nl}  run = CommandListMenuToggle{nl}endif{nl}", menu::TOGGLE));
    }
    if key_list.is_some() {
        s.push_str(&format!("; with no group, {} shows or hides the key list{nl}", menu::KEYS));
        s.push_str(&format!("if $cg == 0 && $cv == {}{nl}  run = CommandListKeysToggle{nl}endif{nl}", menu::KEYS));
    }
    s.push_str(&format!("$cg = 0{nl}"));
    // the game binds the key itself when it always draws the menu, and when the app's own key can't work with this
    // game: otherwise the app holds the key and decides
    let direct = set.style == "game" || !reach;
    let keys = on.then(|| {
        let mut open = Vec::new();
        if direct {
            open.push(crate::hotkeys::migoto_form(&set.key));
            open.extend(set.binds_of("open"));
        }
        menu::Keys { open, up: set.binds_of("up"), down: set.binds_of("down"), show: set.binds_of("show"), back: set.binds_of("back"), close: set.binds_of("close") }
    });
    let mut menu = menu::sections(&pages, lay, keys.as_ref(), key_list);
    let waiting: Vec<&GroupRec> = store.groups.iter().filter(|g| store.waiting.contains(&g.n)).collect();
    if !waiting.is_empty() {
        // a saved value wins over the defaults above at a load, so picks the app couldn't key in are asked for here:
        // taken once, on the first frame after the load, and never again for the same number
        s.push_str(&format!("{nl}; picks gachamod couldn't key in while the game ran, taken at the next load{nl}"));
        s.push_str(&format!("[CommandListGachamodAsked]{nl}if $asked != {}{nl}", store.ask));
        for g in waiting { s.push_str(&format!("  $g{} = {}{nl}", g.n, g.active)); }
        s.push_str(&format!("  $asked = {}{nl}endif{nl}", store.ask));
        let run = format!("run = CommandListGachamodAsked{nl}");
        match menu.find(&format!("[Present]{nl}")) {
            Some(at) => menu.insert_str(at + "[Present]".len() + nl.len(), &run),
            None => menu.push_str(&format!("{nl}[Present]{nl}{run}")),
        }
    }
    s.push_str(&menu);
    s
}

#[cfg(windows)]
fn screen_height() -> u32 {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CYSCREEN};
    // SAFETY: a plain query.
    (unsafe { GetSystemMetrics(SM_CYSCREEN) }).max(0) as u32
}
#[cfg(not(windows))]
fn screen_height() -> u32 { 1080 }

/// Write live.ini and the menu's pictures. True when a file changed (the game has to reload to see it).
fn write_live_ini(db: &Db, game: &str, store: &Store) -> Result<bool> {
    let dir = crate::games::mods_dir(db, game)?.join(DIR);
    let file = dir.join("live.ini");
    if store.groups.is_empty() {
        menu::clear(&dir);
        let had = std::fs::remove_file(&file).is_ok();
        let _ = std::fs::remove_dir(&dir);
        return Ok(had);
    }
    std::fs::create_dir_all(&dir)?;
    let mut set = menu_settings(db, game);
    // where the drawn menu is a tester option and they are off, only the window over the game opens
    if !allowed(db, game) { set.style = "off".into(); }
    let lay = menu::Layout::for_game(screen_height(), game);
    let reach = reaches(db, game);
    let sheets = if set.style == "off" { Vec::new() } else { key_sheets(db, game, store) };
    let key_list = (!sheets.is_empty()).then(|| {
        let ks = crate::keylist::settings(db, game);
        let kl = menu::KeyLayout::of(&lay);
        menu::KeyListIni {
            sheets: sheets.iter().map(|s| menu::IniSheet { n: s.n, slot: s.slot, h: kl.sheet_h(s.rows.len()) }).collect(),
            // the game binds the key when it always draws the list, or when the app's own key can't reach it
            key: (ks.style == "game" || !reach).then(|| crate::hotkeys::migoto_form(&ks.key)),
            menu: set.binds_of("keys"),
        }
    });
    let text = live_ini(store, &set, &lay, reach, key_list.as_ref());
    let mut changed = false;
    let old = std::fs::read(&file).ok();
    if old.as_deref() != Some(text.as_bytes()) {
        crate::xxmi::write_atomic(&file, text.as_bytes())?;
        // the picks' defaults only count when the game has none saved (a new group asks for its pick), so a change
        // to them alone (a pick read back from the game) needs no reload
        let rest = |t: &str| t.lines().filter(|l| !l.starts_with("global persist $g")).collect::<Vec<_>>().join("\n");
        changed = old.is_none_or(|o| rest(&String::from_utf8_lossy(&o)) != rest(&text));
    }
    if set.style == "off" { return Ok(menu::clear(&dir) || changed); }
    // the pictures are a nicety: a pick must not fail because one couldn't be drawn
    let key = crate::keylist::settings(db, game).key;
    if menu::write_key_assets(&dir, &sheets, &lay, &key).unwrap_or(false) { changed = true; }
    let mods = crate::library::list(db, game).unwrap_or_default();
    let by_id: HashMap<&str, &ModEntry> = mods.iter().map(|m| (m.id.as_str(), m)).collect();
    let pages: Vec<menu::Page> = by_name(store).into_iter().map(|g| menu::Page {
        n: g.n, character: g.character.clone(),
        rows: g.slots.iter().map(|s| {
            let m = by_id.get(s.mod_id.as_str());
            menu::Row { name: m.map_or_else(|| "A mod that's gone".to_string(), |m| m.name.clone()), preview: m.and_then(|m| m.thumb.clone().or(m.preview.clone())) }
        }).collect(),
    }).collect();
    Ok(menu::write_assets(&dir, &pages, &lay, &hint_keys(&set)).unwrap_or(false) || changed)
}

/// The key list's sheets: each live skin the key list shows, with its keys, in the menu's order.
fn key_sheets(db: &Db, game: &str, store: &Store) -> Vec<menu::Sheet> {
    let ids: Vec<&str> = store.groups.iter().flat_map(|g| g.slots.iter().map(|s| s.mod_id.as_str())).collect();
    let mut listed = crate::keylist::listed_rows(db, game, &ids);
    if listed.is_empty() { return Vec::new(); }
    let mut out = Vec::new();
    for g in by_name(store) {
        for s in &g.slots {
            if let Some((name, rows)) = listed.remove(&s.mod_id) { out.push(menu::Sheet { n: g.n, slot: s.slot, name, rows }); }
        }
    }
    out
}

pub fn menu_settings(db: &Db, game: &str) -> MenuSettings {
    let get = |k: &str| db.setting(&format!("{game}.{k}")).ok().flatten();
    // "off" was a third choice once; the panel's one switch turns the menu off now, with everything else. "game" kept
    // after tester options went off reads as the window over the game, so the key still opens a menu
    let drawn = get("liveMenu").as_deref() == Some("game") && allowed(db, game);
    let style = if drawn { "game" } else { "window" };
    let key = get("liveMenuKey").and_then(|k| crate::hotkeys::normalize_menu(&k).ok()).unwrap_or_else(|| MENU_KEY.into());
    // only the things whose keys the player changed are saved; the rest have the keys a menu starts with
    let saved: BTreeMap<String, Vec<String>> = get("liveMenuBinds").and_then(|j| serde_json::from_str(&j).ok()).unwrap_or_default();
    let binds = MENU_BINDS.iter().map(|(a, keys, _)| (a.to_string(), match saved.get(*a) {
        Some(own) => own.iter().filter_map(|b| crate::keys::clean_binding(b).ok()).collect(),
        None => keys.iter().map(|k| k.to_string()).collect(),
    })).collect();
    MenuSettings { style: style.into(), key, pad: get("liveMenuPad").as_deref() != Some("0"), fast_save: get("liveFastSave").as_deref() != Some("0"), binds }
}

/// Change how the menu opens. The game reloads once to pick it up.
pub fn set_menu(db: &Db, game: &str, set: &MenuSettings) -> Result<MenuSettings> {
    if !["window", "game"].contains(&set.style.as_str()) { return Err(Error::Invalid("Pick Over the game or Inside the game".into())); }
    if set.style == "game" && menu_settings(db, game).style != "game" { drawn_menu_allowed(db, game)?; }
    let key = crate::hotkeys::normalize_menu(&set.key)?;
    if crate::hotkeys::combos(db).unwrap_or_default().contains(&key) { return Err(Error::Invalid(format!("{key} already switches a profile. Pick another key"))); }
    let keys = crate::keylist::settings(db, game);
    if keys.on && keys.key == key { return Err(Error::Invalid(format!("{key} already shows the key list. Pick another key"))); }
    let binds = checked_binds(&set.binds, &menu_settings(db, game).binds, &key)?;
    let starts = default_binds();
    let own: BTreeMap<&String, &Vec<String>> = binds.iter().filter(|(a, keys)| starts.get(*a) != Some(*keys)).collect();
    if own.is_empty() { db.clear_setting(&format!("{game}.liveMenuBinds"))?; } else {
        db.set_setting(&format!("{game}.liveMenuBinds"), &serde_json::to_string(&own).unwrap_or_default())?;
    }
    db.set_setting(&format!("{game}.liveMenu"), &set.style)?;
    db.set_setting(&format!("{game}.liveMenuKey"), &key)?;
    db.set_setting(&format!("{game}.liveMenuPad"), if set.pad { "1" } else { "0" })?;
    db.set_setting(&format!("{game}.liveFastSave"), if set.fast_save { "1" } else { "0" })?;
    menu_sync(db, game);
    Ok(menu_settings(db, game))
}

/// Bring live.ini and the menu's pictures up to date (after a scan: a mod was renamed, got another preview, or the
/// app was updated). The game reloads when something changed.
pub(crate) fn menu_sync(db: &Db, game: &str) {
    fast_saves(db, game);
    let store = load_synced(db, game);
    if store.groups.is_empty() { return; }
    if write_live_ini(db, game, &store).unwrap_or(false) { crate::devtools::mark_changed(game); }
}

/// The loaders save the game's values (a pick made in its own menu among them) a minute after one changed, so the
/// app would show that pick a minute late. While a game has live characters and `fast_save` is on, d3dx.ini's
/// `settings_auto_save_interval` is 1 instead: the game saves within a second of a change (and only then). The
/// value it had goes back when that ends. The game reads it at its next load. d3dx.ini gets a backup first.
pub(crate) fn fast_saves(db: &Db, game: &str) {
    const FAST: &str = "1";
    let Ok(imp) = crate::games::importer_dir(db, game) else { return };
    let path = imp.join("d3dx.ini");
    let Ok(text) = std::fs::read_to_string(&path) else { return };
    // an older loader without the setting
    let Some(now) = crate::gamecheck::d3dx_value(&text, "settings_auto_save_interval") else { return };
    let now = now.trim().to_string();
    let was_key = format!("{game}.saveIntervalWas");
    let was = db.setting(&was_key).ok().flatten();
    let want = if !load(db, game).groups.is_empty() && menu_settings(db, game).fast_save {
        if now != FAST && was.as_deref() != Some(now.as_str()) { let _ = db.set_setting(&was_key, &now); }
        FAST.to_string()
    } else {
        match was {
            Some(w) if now == FAST => { let _ = db.clear_setting(&was_key); w }
            _ => return,
        }
    };
    if now == want { return; }
    let out = crate::launch::ini_set(&text, "System", "settings_auto_save_interval", &want);
    let bak = imp.join("d3dx.ini.gachamod.bak");
    if !bak.exists() && std::fs::copy(&path, &bak).is_err() { return; }
    let _ = crate::xxmi::write_atomic(&path, out.as_bytes());
}

/// The games whose menu the app opens (style "window") with the key each one uses, for the app's hotkeys.
pub fn menu_keys(db: &Db) -> Vec<(String, MenuSettings)> {
    crate::games::GAMES.iter().filter(|g| !load(db, g.id).groups.is_empty())
        .map(|g| (g.id.to_string(), menu_settings(db, g.id))).filter(|(g, s)| s.style == "window" && reaches(db, g)).collect()
}

/// Every game with live characters, and whether gachamod's keys reach it (the key list's keys hang on this).
pub fn menu_keys_all(db: &Db) -> Vec<(String, bool)> {
    crate::games::GAMES.iter().filter(|g| !load(db, g.id).groups.is_empty()).map(|g| (g.id.to_string(), reaches(db, g.id))).collect()
}

/// With the game closed, the saved value is what it loads next time (it wins over live.ini's default).
fn save_active(db: &Db, game: &str, g: &GroupRec) {
    if crate::launch::running(game) { return; }
    if let Ok(imp) = crate::games::importer_dir(db, game) { let _ = crate::ini::set_user_value(&imp, &var_name(g.n), &g.active.to_string()); }
}

// ── the API ──

/// The game has characters that switch in game (the watcher then follows what the game saves).
pub fn has_groups(db: &Db, game: &str) -> bool { !load(db, game).groups.is_empty() }

/// The game saved its values (`devtools::watch` saw d3dx_user.ini change while it runs): read back picks made in its
/// own menu, and picks that waited for a reload and got there. True when the app's windows have something to show.
pub fn follow_game(db: &Db, game: &str) -> bool {
    let before = load(db, game);
    if before.groups.is_empty() { return false; }
    let after = load_synced(db, game);
    // a skin picked in the game's menu whose folder is off: it goes on, and shows after the reload
    let opened = open_folders(db, game);
    opened || after.waiting != before.waiting
        || after.groups.iter().any(|g| before.groups.iter().any(|b| b.n == g.n && b.active != g.active))
}

/// Mod id -> live group, for the library (live mods of one group don't conflict and stay on together).
pub fn groups_by_mod(db: &Db, game: &str) -> HashMap<String, u32> {
    load(db, game).groups.iter().flat_map(|g| g.slots.iter().map(move |s| (s.mod_id.clone(), g.n))).collect()
}

/// The groups with each one's pick as the game will load it: while the game is closed, the value it saved when it
/// closed wins (a pick sent while it ran ends up there too).
fn load_synced(db: &Db, game: &str) -> Store {
    let mut store = load(db, game);
    if store.groups.is_empty() { return store; }
    let Ok(imp) = crate::games::importer_dir(db, game) else { return store };
    let running = crate::launch::running(game);
    let mut moved = false;
    if !store.waiting.is_empty() {
        let number = |name: &str| crate::ini::user_value(&imp, name).and_then(|v| v.parse::<f64>().ok());
        if number(ASKED).is_some_and(|v| v as u32 == store.ask) {
            // the game took them at a load, and what it saved since is news (read below)
            store.waiting.clear();
            moved = true;
        } else if !running {
            // the game closed before it took them: they are what it loads next time
            for g in store.groups.iter().filter(|g| store.waiting.contains(&g.n)) {
                let _ = crate::ini::set_user_value(&imp, &var_name(g.n), &g.active.to_string());
            }
            store.waiting.clear();
            moved = true;
        }
        if moved { let _ = write_live_ini(db, game, &store); }
    }
    // The game saves its values 5 to 15 seconds after a key changed one. What it saved after the app's last pick is
    // news (a pick made in its own menu); what it saved before is older than what the app knows. A group still
    // waiting for the game to take the app's pick, or with a pick on its way, keeps the app's.
    let mut keep = store.waiting.clone();
    keep.extend(sends(|q| q.iter().filter(|(g, ..)| g == game).map(|s| s.1).collect::<Vec<_>>()));
    let fresh = saved_since_sent(game, &imp);
    let mut read_back = HashSet::new();
    for g in store.groups.iter_mut().filter(|g| !keep.contains(&g.n)) {
        let saved = crate::ini::user_value(&imp, &var_name(g.n)).and_then(|v| v.parse::<f64>().ok()).map(|v| v.max(0.0) as u32);
        if fresh {
            if let Some(v) = saved.filter(|v| *v != g.active) { g.active = v; moved = true; read_back.insert(g.n); }
        } else if !running && saved != Some(g.active) {
            // the game closed before it saved the app's last pick: the app's is the newer one, and the game loads
            // it next time
            let _ = crate::ini::set_user_value(&imp, &var_name(g.n), &g.active.to_string());
        }
    }
    if moved { let _ = save(db, game, &store); }
    // the library's rows show what the game picked, not what the app picked last
    if !read_back.is_empty() {
        sync_rows(db, game, &store, &read_back);
        game_picks(|l| l.extend(read_back.iter().map(|n| (game.to_string(), *n))));
    }
    store
}

/// A list the app's threads share. Tests run side by side, so there each thread keeps its own.
macro_rules! shared_list {
    ($name:ident, $t:ty) => {
        fn $name<R>(f: impl FnOnce(&mut Vec<$t>) -> R) -> R {
            #[cfg(not(test))]
            {
                static L: std::sync::Mutex<Vec<$t>> = std::sync::Mutex::new(Vec::new());
                f(&mut L.lock().unwrap_or_else(|e| e.into_inner()))
            }
            #[cfg(test)]
            {
                thread_local! { static L: std::cell::RefCell<Vec<$t>> = const { std::cell::RefCell::new(Vec::new()) }; }
                L.with(|l| f(&mut l.borrow_mut()))
            }
        }
    };
}

// When the app last keyed a pick into each game.
shared_list!(sent, (String, std::time::SystemTime));

fn note_sent(game: &str) {
    sent(|s| {
        s.retain(|(g, _)| g != game);
        s.push((game.to_string(), std::time::SystemTime::now()));
    });
}

fn saved_since_sent(game: &str, importer: &Path) -> bool {
    let Some(at) = sent(|s| s.iter().find(|(g, _)| g == game).map(|(_, t)| *t)) else { return true };
    std::fs::metadata(importer.join("d3dx_user.ini")).and_then(|m| m.modified()).is_ok_and(|saved| saved > at)
}

/// Mark live skins as on (the one showing) or on standby (off, but the folder stays on to switch in at once). A mod
/// that left its group goes back to plain on.
pub(crate) fn overlay(db: &Db, game: &str, entries: &mut [ModEntry]) {
    let store = load_synced(db, game);
    let shown: HashMap<&str, bool> = store.groups.iter()
        .flat_map(|g| g.slots.iter().map(move |s| (s.mod_id.as_str(), s.slot == g.active))).collect();
    for e in entries.iter_mut() {
        let loaded = e.loaded();
        let on = shown.get(e.id.as_str()).copied().unwrap_or(true);
        (e.enabled, e.standby) = (loaded && on, loaded && !on);
    }
}

/// Bring the library rows of these groups' mods in line with the picks. Returns the rows that changed.
fn sync_rows(db: &Db, game: &str, store: &Store, groups: &HashSet<u32>) -> Vec<ModEntry> {
    let mut out = Vec::new();
    for g in store.groups.iter().filter(|g| groups.contains(&g.n)) {
        for s in &g.slots {
            let Ok(mut e) = crate::library::get(db, game, &s.mod_id) else { continue };
            let before = (e.enabled, e.standby);
            let (loaded, on) = (e.loaded(), s.slot == g.active);
            (e.enabled, e.standby) = (loaded && on, loaded && !on);
            if (e.enabled, e.standby) != before && crate::library::put_row(db, &e).is_ok() { out.push(e); }
        }
    }
    out
}

fn live_mod(m: Option<&ModEntry>, id: &str, slot: u32) -> LiveMod {
    LiveMod {
        mod_id: id.to_string(), slot,
        name: m.map(|m| m.name.clone()).unwrap_or_else(|| "A mod that's gone".into()),
        enabled: m.is_some_and(|m| m.loaded()), preview: m.and_then(|m| m.preview.clone()),
    }
}

pub fn info(db: &Db, game: &str) -> Result<LiveInfo> {
    let store = load_synced(db, game);
    let mods = crate::library::list(db, game)?;
    let by_id: HashMap<&str, &ModEntry> = mods.iter().map(|m| (m.id.as_str(), m)).collect();
    let running = crate::launch::running(game);
    let live: HashSet<&str> = store.groups.iter().flat_map(|g| g.slots.iter().map(|s| s.mod_id.as_str())).collect();
    let groups = store.groups.iter().map(|g| LiveGroup {
        group: g.n, character: g.character.clone(), active: g.active,
        mods: g.slots.iter().map(|s| live_mod(by_id.get(s.mod_id.as_str()).copied(), &s.mod_id, s.slot)).collect(),
        waiting: running && store.waiting.contains(&g.n),
    }).collect();
    let mut by_char: HashMap<String, (String, Vec<&ModEntry>)> = HashMap::new();
    for m in &mods {
        let Some(c) = m.character.as_deref().filter(|c| !c.trim().is_empty()) else { continue };
        if m.ini_count == 0 { continue; }
        by_char.entry(c.to_lowercase()).or_insert_with(|| (c.to_string(), Vec::new())).1.push(m);
    }
    let mut ready: Vec<LiveReady> = by_char.into_values()
        .filter(|(_, l)| l.len() >= 2 && l.iter().any(|m| !live.contains(m.id.as_str())))
        .map(|(c, l)| LiveReady { character: c, mods: l.into_iter().filter(|m| !live.contains(m.id.as_str())).map(|m| live_mod(Some(m), &m.id, 0)).collect() })
        .collect();
    ready.sort_by(|a, b| a.character.to_lowercase().cmp(&b.character.to_lowercase()));
    // fresh only while the game saves every second (`fast_saves`); its windows ask each time they open
    let on_screen = match crate::games::importer_dir(db, game) {
        Ok(imp) if running => on_screen(&imp, store.groups.iter().map(|g| g.n)),
        _ => Vec::new(),
    };
    Ok(LiveInfo {
        groups, ready, running, menu: menu_settings(db, game), blocked: !reaches(db, game), all: all_on(db, game), allowed: allowed(db, game),
        checked: drawn_menu_open(game), on_screen,
    })
}

/// Make mods live: each joins its character's group (made when missing). Mods that are off get turned on, since
/// every live mod has to be loaded; the one that was on stays the one showing. Takes a reload to start working.
pub fn add(db: &Db, game: &str, ids: &[String]) -> Result<LiveChange> { add_some(db, game, ids, true) }

/// `strict`: nothing could be added and something was refused is an error (the player asked for these mods). Not
/// strict is for "every character", where mods that can't be gated are just left as they are.
fn add_some(db: &Db, game: &str, ids: &[String], strict: bool) -> Result<LiveChange> {
    let mods = crate::library::list(db, game)?;
    let by_id: HashMap<&str, &ModEntry> = mods.iter().map(|m| (m.id.as_str(), m)).collect();
    let mut store = load_synced(db, game);
    let mut out = LiveChange::default();
    let (mut touched, mut made): (HashSet<u32>, Vec<u32>) = (HashSet::new(), Vec::new());
    for id in ids {
        let Some(m) = by_id.get(id.as_str()).copied() else { continue };
        let skip = |reason: String| ModSkip { mod_id: m.id.clone(), name: m.name.clone(), reason };
        if store.groups.iter().any(|g| g.slots.iter().any(|s| s.mod_id == m.id)) { continue; }
        let Some(ch) = m.character.as_deref().filter(|c| !c.trim().is_empty()) else {
            out.skipped.push(skip("it has no character, so there's no group to put it in".into()));
            continue;
        };
        let gi = match store.groups.iter().position(|g| g.character.eq_ignore_ascii_case(ch)) {
            Some(i) => i,
            None => {
                let n = (1..=MAX_GROUPS).find(|n| !store.groups.iter().any(|g| g.n == *n));
                let Some(n) = n else { out.skipped.push(skip("there are too many live characters already".into())); continue };
                store.groups.push(GroupRec { n, character: ch.to_string(), active: 0, next: 1, slots: Vec::new() });
                made.push(n);
                store.groups.len() - 1
            }
        };
        let (n, slot) = (store.groups[gi].n, store.groups[gi].next.max(1));
        if slot > MAX_SLOTS { out.skipped.push(skip(format!("{ch} has too many live mods already"))); continue; }
        let raise = group_raises(store.groups[gi].slots.iter().filter_map(|s| by_id.get(s.mod_id.as_str()).copied()).chain(std::iter::once(m)));
        let written = plan(m, n, slot, &raise).and_then(|edits| write_edits(db, game, m, &edits, &format!("Before switching {} in game", m.name)));
        let backup = match written {
            Ok(b) => b,
            Err(reason) => {
                out.skipped.push(skip(reason));
                if store.groups[gi].slots.is_empty() { store.groups.remove(gi); }
                continue;
            }
        };
        let g = &mut store.groups[gi];
        g.next = slot + 1;
        g.slots.push(SlotRec { slot, mod_id: m.id.clone() });
        if m.loaded() && g.active == 0 { g.active = slot; }
        touched.insert(n);
        if !m.loaded() { out.turned_on.push(m.id.clone()); }
        out.changed.push(m.id.clone());
        out.backups.extend(backup);
        store.out.retain(|o| o != &m.id);
    }
    if out.changed.is_empty() {
        if strict { if let Some(s) = out.skipped.first() { return Err(Error::Invalid(format!("{} can't be switched in game: {}", s.name, s.reason))); } }
        return Ok(out);
    }
    if crate::launch::running(game) {
        // the running game may still have a pick saved under a reused group number, which would win over live.ini's
        // default at the reload: the new group's pick is asked for like one the keys couldn't bring in
        made.retain(|n| store.groups.iter().any(|g| g.n == *n) && !store.waiting.contains(n));
        if !made.is_empty() { store.waiting.extend(made); store.ask += 1; }
    }
    save(db, game, &store)?;
    write_live_ini(db, game, &store)?;
    for g in store.groups.iter().filter(|g| touched.contains(&g.n)) { save_active(db, game, g); }
    if !out.turned_on.is_empty() {
        let on: Vec<(String, bool)> = out.turned_on.iter().map(|i| (i.clone(), true)).collect();
        crate::library::apply_folders(db, game, &on)?;
    }
    sync_rows(db, game, &store, &touched);
    // a skin that joined may need a bigger buffer than the ones already there asked for
    regate(db, game);
    crate::devtools::mark_changed(game);
    Ok(out)
}

/// "<game>.liveAll" is "1": every mod with a character switches in game, and new ones join after a scan.
pub fn all_on(db: &Db, game: &str) -> bool { db.setting(&format!("{game}.liveAll")).ok().flatten().as_deref() == Some("1") }

/// The mods "every character" would add: they have a character and an ini, aren't a sub-mod (that goes with its
/// parent), aren't live yet and weren't taken out by hand.
fn candidates(db: &Db, game: &str, store: &Store) -> Vec<String> {
    let live: HashSet<&str> = store.groups.iter().flat_map(|g| g.slots.iter().map(|s| s.mod_id.as_str())).collect();
    crate::library::list(db, game).unwrap_or_default().into_iter()
        .filter(|m| m.character.as_deref().is_some_and(|c| !c.trim().is_empty()) && m.ini_count > 0 && m.parent.is_none())
        .filter(|m| !live.contains(m.id.as_str()) && !store.out.contains(&m.id))
        .map(|m| m.id).collect()
}

/// Turn switching skins in game on or off for the whole game: the panel's one switch. On makes every mod with a
/// character live now (also the ones taken out by hand before). Off takes every character out, and each keeps the
/// skin it shows.
pub fn set_all(db: &Db, game: &str, on: bool) -> Result<LiveChange> {
    db.set_setting(&format!("{game}.liveAll"), if on { "1" } else { "0" })?;
    if !on {
        let ids: Vec<String> = load_synced(db, game).groups.iter().flat_map(|g| g.slots.iter().map(|s| s.mod_id.clone())).collect();
        return if ids.is_empty() { Ok(LiveChange::default()) } else { remove(db, game, &ids) };
    }
    let mut store = load_synced(db, game);
    if !store.out.is_empty() {
        store.out.clear();
        save(db, game, &store)?;
    }
    add_some(db, game, &candidates(db, game, &store), false)
}

/// After a scan: with "every character" on, new mods that have a character join their group. True when any did.
pub(crate) fn auto_add(db: &Db, game: &str) -> bool {
    if !all_on(db, game) { return false; }
    let ids = candidates(db, game, &load(db, game));
    !ids.is_empty() && add_some(db, game, &ids, false).is_ok_and(|c| !c.changed.is_empty())
}

/// After mods came in (a scan, a download, a pack): with "every character" on the new ones join, skins whose inis lost
/// their gate get it back, and live.ini and the drawn menu list what is there now. True when a mod changed.
pub(crate) fn settle(db: &Db, game: &str) -> bool {
    let joined = auto_add(db, game);
    let regated = regate(db, game);
    // after the gates: a skin that couldn't be gated has left its group by now, and stays off
    let opened = open_folders(db, game);
    menu_sync(db, game);
    joined || regated || opened
}

// Groups whose pick was just read back from the game (made in its own menu), until `open_folders` looks at them.
shared_list!(game_picks, (String, u32));
// Live skins whose folders couldn't be turned on (open in another program, read-only). They aren't tried again until
// the app starts again, so a scan doesn't wait on them each time. A click on the mod still tries, and says why.
shared_list!(stuck, String);

/// Live skins whose folders are off: another manager named them or a folder above them DISABLED_..., or an older
/// gachamod couldn't name them back. The ones on standby go on, since picked in the game's own menu they would show
/// nothing; their gates keep them from drawing until then. The one a group shows goes on only when the game itself
/// just picked it. Found off any other time, someone turned it off outside gachamod: with the game closed the group
/// shows none of its mods from then on, so nothing comes back that the player turned off. True when anything changed.
fn open_folders(db: &Db, game: &str) -> bool {
    let picked: HashSet<u32> = game_picks(|l| {
        let mine = l.iter().filter(|(g, _)| g == game).map(|(_, n)| *n).collect();
        l.retain(|(g, _)| g != game);
        mine
    });
    let mut store = load(db, game);
    let is_off = |id: &str| crate::library::get(db, game, id).is_ok_and(|m| !m.loaded() && Path::new(&m.path).is_dir());
    let running = crate::launch::running(game);
    let (mut on, mut cleared): (Vec<(String, bool)>, Vec<u32>) = (Vec::new(), Vec::new());
    for g in &mut store.groups {
        let mut clear = false;
        for s in g.slots.iter().filter(|s| is_off(&s.mod_id)) {
            if s.slot == g.active && !picked.contains(&g.n) {
                // while the game runs it keeps its own pick, which draws nothing with the folder off
                clear = !running;
            } else if !stuck(|l| l.contains(&s.mod_id)) {
                on.push((s.mod_id.clone(), true));
            }
        }
        if clear { g.active = 0; cleared.push(g.n); }
    }
    if on.is_empty() && cleared.is_empty() { return false; }
    if !cleared.is_empty() {
        if save(db, game, &store).is_err() { return false; }
        let _ = write_live_ini(db, game, &store);
        for g in store.groups.iter().filter(|g| cleared.contains(&g.n)) { save_active(db, game, g); }
    }
    let mut opened = false;
    if !on.is_empty() {
        opened = crate::library::apply_folders(db, game, &on).is_ok_and(|c| !c.changed.is_empty());
        for (id, _) in &on { if is_off(id) { stuck(|l| l.push(id.clone())); } }
    }
    if !opened && cleared.is_empty() { return false; }
    let all: HashSet<u32> = store.groups.iter().map(|g| g.n).collect();
    sync_rows(db, game, &store, &all);
    // the active profile keeps what shows: a skin on standby is off there, whatever its folder says
    let rows: Vec<ModEntry> = on.iter().filter_map(|(id, _)| crate::library::get(db, game, id).ok()).collect();
    let _ = crate::profiles::on_change(db, game, &ModChange { changed: rows, ..Default::default() });
    crate::devtools::mark_changed(game);
    true
}

/// Stop switching mods live: their gates come out. The one showing stays on; the others are turned off, so the
/// character doesn't wear two skins at once.
pub fn remove(db: &Db, game: &str, ids: &[String]) -> Result<LiveChange> { remove_with(db, game, ids, false) }

/// Shift on a live skin that isn't the one showing: it stops switching in game and goes on next to the skin its
/// character shows. The ids it took out, and a note for each.
pub(crate) fn release(db: &Db, game: &str, ids: &[String]) -> Result<(Vec<String>, Vec<String>)> {
    let store = load_synced(db, game);
    let (mut out, mut notes) = (Vec::new(), Vec::new());
    for id in ids {
        let Some(g) = store.groups.iter().find(|g| g.slots.iter().any(|s| &s.mod_id == id)) else { continue };
        let slot = g.slots.iter().find(|s| &s.mod_id == id).map_or(0, |s| s.slot);
        if g.active == 0 || g.active == slot { continue; }
        let name_of = |id: &str| crate::library::get(db, game, id).map(|m| m.name).unwrap_or_else(|_| "the skin showing".into());
        let shown = g.slots.iter().find(|s| s.slot == g.active).map(|s| name_of(&s.mod_id)).unwrap_or_default();
        notes.push(format!("{} is on next to {shown}. It doesn't switch in game any more, so the game shows it after it reloads its mods", name_of(id)));
        out.push(id.clone());
    }
    if !out.is_empty() { remove_with(db, game, &out, true)?; }
    Ok((out, notes))
}

/// `keep_on`: the mods stay on as plain mods (`release`), instead of going off unless they were the one showing.
fn remove_with(db: &Db, game: &str, ids: &[String], keep_on: bool) -> Result<LiveChange> {
    let mods = crate::library::list(db, game)?;
    let by_id: HashMap<&str, &ModEntry> = mods.iter().map(|m| (m.id.as_str(), m)).collect();
    let mut store = load_synced(db, game);
    let mut out = LiveChange::default();
    let wanted: HashSet<&str> = ids.iter().map(String::as_str).collect();
    for g in &mut store.groups {
        let mut keep = Vec::new();
        for s in std::mem::take(&mut g.slots) {
            if !wanted.contains(s.mod_id.as_str()) { keep.push(s); continue; }
            if let Some(m) = by_id.get(s.mod_id.as_str()).copied() {
                let edits = unplan(m);
                if let Some(b) = write_edits(db, game, m, &edits, &format!("Before {} stopped switching in game", m.name)).map_err(Error::Invalid)? {
                    out.backups.push(b);
                }
                if !keep_on && m.loaded() && g.active != s.slot { out.turned_off.push(m.id.clone()); }
            }
            if g.active == s.slot { g.active = 0; }
            out.changed.push(s.mod_id.clone());
        }
        g.slots = keep;
    }
    store.groups.retain(|g| !g.slots.is_empty());
    store.waiting.retain(|n| store.groups.iter().any(|g| g.n == *n));
    for id in &out.changed { if !store.out.contains(id) { store.out.push(id.clone()); } }
    save(db, game, &store)?;
    write_live_ini(db, game, &store)?;
    if !out.turned_off.is_empty() {
        let off: Vec<(String, bool)> = out.turned_off.iter().map(|i| (i.clone(), false)).collect();
        crate::library::apply_folders(db, game, &off)?;
    }
    // the one that showed is a plain mod again
    for id in &out.changed {
        let Ok(mut e) = crate::library::get(db, game, id) else { continue };
        if e.standby { (e.enabled, e.standby) = (true, false); let _ = crate::library::put_row(db, &e); }
    }
    crate::devtools::mark_changed(game);
    Ok(out)
}

/// Turn live skins on or off from the library, a profile or a hotkey: on picks a skin (the last one of a character
/// wins), off picks none when it's the one showing. Folders stay on, so nothing reloads, unless a skin's folder was
/// off. While the game runs the picks wait for `flush_sends`. The rows that changed come back in `changed`.
pub(crate) fn switch(db: &Db, game: &str, targets: &[(String, bool)]) -> Result<ModChange> {
    let mut store = load_synced(db, game);
    let mut want: HashMap<u32, u32> = HashMap::new();
    let mut change = ModChange::default();
    let mut asked = HashSet::new();
    for (id, on) in targets {
        let Some(g) = store.groups.iter().find(|g| g.slots.iter().any(|s| &s.mod_id == id)) else { continue };
        let slot = g.slots.iter().find(|s| &s.mod_id == id).map_or(0, |s| s.slot);
        let now = want.get(&g.n).copied().unwrap_or(g.active);
        asked.insert(g.n);
        if *on { want.insert(g.n, slot); } else if now == slot { want.insert(g.n, 0); } else if targets.len() == 1 {
            // turning off a skin the game doesn't show: it showed another since (picked in its own menu)
            change.notes.push(not_showing(db, game, g, id));
        }
    }
    let mut touched = HashSet::new();
    let mut folders_on = Vec::new();
    let live_now = crate::launch::running(game);
    for g in &mut store.groups {
        let Some(&slot) = want.get(&g.n) else { continue };
        // the pick's folder is off (renamed DISABLED... by another manager, or a folder above it was): it goes on
        // even when the group already shows it
        if let Some(s) = g.slots.iter().find(|s| s.slot == slot) {
            if crate::library::get(db, game, &s.mod_id).is_ok_and(|m| !m.loaded()) { folders_on.push((s.mod_id.clone(), true)); }
        }
        if slot == g.active {
            // the game may show another one (picked in its own menu), so say it again
            if live_now { queue_send(game, g.n, slot); }
            continue;
        }
        g.active = slot;
        touched.insert(g.n);
    }
    if touched.is_empty() && folders_on.is_empty() {
        // the library's rows may be behind what the game picked: bring them in line
        change.changed = sync_rows(db, game, &store, &asked);
        return Ok(change);
    }
    let running = crate::launch::running(game);
    if !touched.is_empty() {
        save(db, game, &store)?;
        write_live_ini(db, game, &store)?;
        for g in store.groups.iter().filter(|g| touched.contains(&g.n)) {
            if running { queue_send(game, g.n, g.active); } else { save_active(db, game, g); }
        }
    }
    let mut folders = Vec::new();
    if !folders_on.is_empty() {
        // a skin whose folder was off has to load first
        let c = crate::library::apply_folders(db, game, &folders_on)?;
        change.notes.extend(c.notes);
        if running && !c.changed.is_empty() { change.notes.push("It shows after the game reloads".into()); }
        folders = c.changed;
    }
    // rows whose folders were renamed (new paths), then the picks over them
    change.changed = folders;
    for e in sync_rows(db, game, &store, &asked) {
        match change.changed.iter_mut().find(|c| c.id == e.id) { Some(c) => *c = e, None => change.changed.push(e) }
    }
    Ok(change)
}

/// "Coca Cola isn't showing. Ellen Joe wears Bunny in the game".
fn not_showing(db: &Db, game: &str, g: &GroupRec, id: &str) -> String {
    let name_of = |id: &str| crate::library::get(db, game, id).map(|m| m.name).unwrap_or_else(|_| "That mod".into());
    match g.slots.iter().find(|s| s.slot == g.active) {
        Some(s) => format!("{} isn't showing. {} wears {} in the game", name_of(id), g.character, name_of(&s.mod_id)),
        None => format!("{} isn't showing. {} is vanilla in the game", name_of(id), g.character),
    }
}

/// A mod of `character` that isn't live was turned on (library one-skin rule): the character's live group shows
/// none of its mods from then on, so the character doesn't wear two skins, unless `with` changes other parts than the
/// skin showing. The live skin rows that went off.
pub(crate) fn hide_group(db: &Db, game: &str, character: &str, with: &ModEntry) -> Vec<ModEntry> {
    let mut store = load_synced(db, game);
    let Some(g) = store.groups.iter_mut().find(|g| g.character.eq_ignore_ascii_case(character) && g.active != 0) else { return Vec::new() };
    // a mod that changes other parts (a hair recolour next to an outfit) leaves the skin showing
    let shown = g.slots.iter().find(|s| s.slot == g.active).and_then(|s| crate::library::get(db, game, &s.mod_id).ok());
    if shown.is_some_and(|s| !crate::library::share_parts(&s, with)) { return Vec::new(); }
    g.active = 0;
    let n = g.n;
    if save(db, game, &store).is_err() { return Vec::new(); }
    let _ = write_live_ini(db, game, &store);
    if let Some(g) = store.groups.iter().find(|g| g.n == n) {
        if crate::launch::running(game) { queue_send(game, n, 0); } else { save_active(db, game, g); }
    }
    sync_rows(db, game, &store, &HashSet::from([n]))
}

/// Pick what a group shows (slot 0: none of its mods), the same as turning that skin on in the library. Saved for
/// the next start; while the game runs it waits for `flush_sends`.
pub fn pick(db: &Db, game: &str, group: u32, slot: u32) -> Result<Picked> {
    let store = load_synced(db, game);
    let Some(g) = store.groups.iter().find(|g| g.n == group) else { return Err(Error::Invalid("That character isn't switched live any more".into())) };
    let target = if slot == 0 {
        match g.slots.iter().find(|s| s.slot == g.active) {
            Some(s) => (s.mod_id.clone(), false),
            None => {
                // none as far as the app knows; the game may show one picked in its own menu
                let running = crate::launch::running(game);
                if running { queue_send(game, group, 0); }
                return Ok(Picked { reload: false, send: running, note: None });
            }
        }
    } else {
        let Some(s) = g.slots.iter().find(|s| s.slot == slot) else { return Err(Error::Invalid("That mod isn't switched live any more".into())) };
        (s.mod_id.clone(), true)
    };
    let reload = target.1 && crate::library::get(db, game, &target.0).is_ok_and(|m| !m.loaded());
    crate::library::apply_states(db, game, &[target])?;
    Ok(Picked { reload, send: crate::launch::running(game), note: None })
}

/// Gate again every live skin whose inis lost it (an update put in new files, or someone edited them). A skin that
/// can't be gated any more leaves its group, and its folder goes off unless it was the one showing, so the
/// character never wears two skins. A mod that's gone (deleted, not in the trash) leaves too. True when anything changed.
pub(crate) fn regate(db: &Db, game: &str) -> bool {
    let mut store = load_synced(db, game);
    if store.groups.is_empty() { return false; }
    let Ok(mods) = crate::library::list(db, game) else { return false };
    let by_id: HashMap<&str, &ModEntry> = mods.iter().map(|m| (m.id.as_str(), m)).collect();
    let (mut wrote, mut offs, mut left, mut touched) = (false, Vec::new(), Vec::new(), HashSet::new());
    for g in &mut store.groups {
        let mut keep = Vec::new();
        let raise = group_raises(g.slots.iter().filter_map(|s| by_id.get(s.mod_id.as_str()).copied()));
        for s in std::mem::take(&mut g.slots) {
            let Some(m) = by_id.get(s.mod_id.as_str()).copied() else {
                // a mod in the trash keeps its place (it comes back live); one that's gone for good leaves the list
                if crate::library::in_trash(db, &s.mod_id) { keep.push(s); } else {
                    if g.active == s.slot { g.active = 0; }
                    touched.insert(g.n);
                }
                continue;
            };
            match plan(m, g.n, s.slot, &raise) {
                Ok(edits) => {
                    // a failed write is tried again at the next scan
                    if let Ok(Some(_)) = write_edits(db, game, m, &edits, &format!("Before switching {} in game again", m.name)) { wrote = true; }
                    keep.push(s);
                }
                Err(_) => {
                    if g.active == s.slot { g.active = 0; } else if m.loaded() { offs.push((m.id.clone(), false)); }
                    left.push(m.id.clone());
                    touched.insert(g.n);
                }
            }
        }
        g.slots = keep;
    }
    if !wrote && touched.is_empty() { return false; }
    if !touched.is_empty() {
        store.groups.retain(|g| !g.slots.is_empty());
        store.waiting.retain(|n| store.groups.iter().any(|g| g.n == *n));
        let _ = save(db, game, &store);
        let _ = write_live_ini(db, game, &store);
        for g in store.groups.iter().filter(|g| touched.contains(&g.n)) { save_active(db, game, g); }
        if !offs.is_empty() { let _ = crate::library::apply_folders(db, game, &offs); }
        sync_rows(db, game, &store, &touched);
        // mods that left their group are plain mods again
        for id in &left {
            let Ok(mut e) = crate::library::get(db, game, id) else { continue };
            if e.standby { (e.enabled, e.standby) = (true, false); let _ = crate::library::put_row(db, &e); }
        }
    }
    crate::devtools::mark_changed(game);
    true
}

/// A mod back from the trash: a live skin is marked showing or on standby again; any other mod loses gates left in
/// its inis from when it was live, so it draws as before.
pub(crate) fn restored(db: &Db, game: &str, e: &mut ModEntry) {
    if groups_by_mod(db, game).contains_key(&e.id) { overlay(db, game, std::slice::from_mut(e)); return; }
    let edits = unplan(e);
    let _ = write_edits(db, game, e, &edits, &format!("Before {} came back from the trash", e.name));
}

// ── sends to the running game ──

// Picks made while the game runs, waiting to be tapped in once the database is free (a tap takes a few hundred
// milliseconds). Only the latest pick of each group is kept. A pick stays here until its tap is done, so what the
// game saves meanwhile isn't read back over it.
shared_list!(sends, (String, u32, u32));

/// One tap at a time: the keys of two at once would mix into other numbers.
static TAPPING: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn queue_send(game: &str, group: u32, slot: u32) {
    sends(|q| {
        q.retain(|(g, n, _)| !(g == game && *n == group));
        q.push((game.to_string(), group, slot));
    });
}

/// Tap in every pick made while the game ran. Call it after the database lock is released (it takes the lock
/// again after the taps). A pick that couldn't be tapped in waits in live.ini for the game's next load, and the
/// watcher presses F10 the next time the game is in front when it can (`defer`). Returns the one line that tells
/// the player to press F10 themselves, the first time that happens after gachamod starts.
pub fn flush_sends(db: &crate::db::Shared) -> Vec<String> {
    let _one = TAPPING.lock().unwrap_or_else(|e| e.into_inner());
    let q = sends(|q| q.clone());
    if q.is_empty() { return Vec::new(); }
    let (mut got, mut missed): (HashMap<String, Vec<u32>>, HashMap<String, Vec<u32>>) = (HashMap::new(), HashMap::new());
    for (game, group, slot) in &q {
        let tapped = crate::launch::running(game) && send(game, *group, *slot).is_ok();
        // a save the game makes from now on has the pick in it
        if tapped { note_sent(game); }
        (if tapped { &mut got } else { &mut missed }).entry(game.clone()).or_default().push(*group);
    }
    // these are done (a newer pick made meanwhile stays for its own flush), once the database says where they went
    let done = || sends(|s| s.retain(|e| !q.contains(e)));
    let Ok(d) = db.lock() else { done(); return Vec::new() };
    for (game, groups) in &got { delivered(&d, game, groups); }
    let mut notes = Vec::new();
    for (game, groups) in &missed {
        defer(&d, game, groups);
        if !crate::launch::running(game) { continue; }
        // the first time in a run the longer line (with why), after that a short one each time
        match crate::devtools::f10_note(&d, game) {
            Some(n) => notes.push(n),
            None => notes.push(waiting_line(&d, game, groups)),
        }
    }
    done();
    notes
}

/// "Ellen Joe's skin changes after the game reloads its mods. Press F10 in the game".
fn waiting_line(db: &Db, game: &str, groups: &[u32]) -> String {
    let store = load(db, game);
    let names: Vec<&str> = store.groups.iter().filter(|g| groups.contains(&g.n)).map(|g| g.character.as_str()).collect();
    let who = match names.as_slice() {
        [] => "The skin".to_string(),
        [one] => format!("{one}'s skin"),
        [first, rest @ ..] => format!("{first}'s skin and {} more", rest.len()),
    };
    let key = crate::devtools::key_name(game);
    let manual = crate::devtools::keys_blocked(game) || db.setting(&format!("{game}.autoReload")).ok().flatten().as_deref() == Some("0");
    if manual { format!("{who} changes after the game reloads its mods. Press {key} in the game") }
    else { format!("{who} changes when you go back to the game. gachamod presses {key} there to reload its mods") }
}

/// Picks the game didn't get: live.ini asks for them at its next load. With the game closed they go into its saved
/// values instead (`load_synced`).
fn defer(db: &Db, game: &str, groups: &[u32]) {
    let mut store = load(db, game);
    for n in groups {
        if store.groups.iter().any(|g| g.n == *n) && !store.waiting.contains(n) { store.waiting.push(*n); }
    }
    if store.waiting.is_empty() { return; }
    store.ask += 1;
    if save(db, game, &store).is_err() { return; }
    let _ = write_live_ini(db, game, &store);
    crate::devtools::mark_changed(game);
    load_synced(db, game);
}

/// Picks the game got from the keys: they no longer wait for a load.
fn delivered(db: &Db, game: &str, groups: &[u32]) {
    let mut store = load(db, game);
    let before = store.waiting.len();
    store.waiting.retain(|n| !groups.contains(n));
    if store.waiting.len() == before || save(db, game, &store).is_err() { return; }
    let _ = write_live_ini(db, game, &store);
}

// Tests press no keys: a tap reaches the game when a test on this thread says so.
thread_local! { pub(crate) static TEST_TAPS: std::cell::Cell<bool> = const { std::cell::Cell::new(false) }; }

/// Open or close the menu the game draws (the app's key was pressed while the game holds the screen).
pub fn send_menu_toggle(game: &str) -> Result<()> {
    if std::env::var_os("GACHAMOD_NO_RELOAD").is_some() { return Ok(()); }
    let _one = TAPPING.lock().unwrap_or_else(|e| e.into_inner());
    crate::devtools::focus_game(game)?;
    win::tap(0, menu::TOGGLE);
    Ok(())
}

/// Show or hide the key list the game draws (the app's key list key was pressed while the game holds the screen).
pub fn send_keys_toggle(game: &str) -> Result<()> {
    if std::env::var_os("GACHAMOD_NO_RELOAD").is_some() { return Ok(()); }
    let _one = TAPPING.lock().unwrap_or_else(|e| e.into_inner());
    crate::devtools::focus_game(game)?;
    win::tap(0, menu::KEYS);
    Ok(())
}

/// Tell the running game: bring it to the front and key in the group and the slot.
pub fn send(game: &str, group: u32, slot: u32) -> Result<()> {
    if cfg!(test) { return if TEST_TAPS.with(|t| t.get()) { Ok(()) } else { Err(Error::Invalid("out of reach".into())) }; }
    if std::env::var_os("GACHAMOD_NO_RELOAD").is_some() { return Ok(()); }
    crate::devtools::focus_game(game)?;
    win::tap(group, slot);
    Ok(())
}

#[cfg(windows)]
mod win {
    use crate::devtools::win::{key, send};
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{VIRTUAL_KEY, VK_CLEAR, VK_F13, VK_F23, VK_F24};

    /// Key in a group (0: none, a command) and a number while Clear is held. The loader looks at the keys once a
    /// frame, so each step waits a few frames. These waits are the ones tried in Zenless Zone Zero (docs/ingame.md):
    /// a pick takes a little under half a second.
    pub fn tap(group: u32, number: u32) {
        let pause = |ms| std::thread::sleep(std::time::Duration::from_millis(ms));
        let enter = |v: u32, done: VIRTUAL_KEY| {
            let bits: Vec<VIRTUAL_KEY> = (0..super::BITS).filter(|i| v >> i & 1 == 1).map(|i| VK_F13 + i as VIRTUAL_KEY).collect();
            for b in &bits { send(&[key(*b, false)]); }
            pause(70);
            send(&[key(done, false)]);
            pause(70);
            send(&[key(done, true)]);
            for b in bits.iter().rev() { send(&[key(*b, true)]); }
            pause(60);
        };
        send(&[key(VK_CLEAR, false)]);
        pause(40);
        if group > 0 { enter(group, VK_F23); }
        enter(number, VK_F24);
        send(&[key(VK_CLEAR, true)]);
    }
}

#[cfg(not(windows))]
mod win { pub fn tap(_group: u32, _number: u32) {} }

#[cfg(test)]
mod tests {
    use super::*;

    const INI: &str = "[Constants]\r\nglobal persist $swap = 0\r\n\r\n[KeySwap]\r\ncondition = $active == 1\r\nkey = VK_DOWN\r\ntype = cycle\r\n$swap = 0,1\r\n\r\n\
[KeyPlain]\r\nkey = VK_UP\r\n$swap = 1\r\n\r\n[TextureOverrideBody]\r\nhash = 1a2b3c4d\r\nmatch_first_index = 0\r\nib = ResourceBodyIB\r\n; colour\r\nps-t0 = ResourceBodyDiffuse\r\n\
if $swap == 1\r\n  drawindexed = auto\r\nendif\r\n\r\n[TextureOverrideHead]\r\nhash = 5e6f7a8b\r\nvb0 = ResourceHead\r\n\r\n[ResourceBodyIB]\r\nfilename = Body.ib\r\n";

    #[test]
    fn wrap_gates_and_unwrap_restores() {
        let w = wrap(INI, 7, 3).unwrap().unwrap();
        assert!(w.contains("[TextureOverrideBody]\r\nhash = 1a2b3c4d\r\nmatch_first_index = 0\r\n; gachamod:begin\r\nrun = CommandList\\gachamod\\live\\Seen7\r\nif $\\gachamod\\live\\g7 == 3\r\nib = ResourceBodyIB\r\n; colour\r\n"));
        assert!(w.contains("  drawindexed = auto\r\nendif\r\nendif\r\n; gachamod:end\r\n\r\n[TextureOverrideHead]"));
        // no match_ key: the duplicate-hash warning is quieted
        assert!(w.contains("[TextureOverrideHead]\r\nhash = 5e6f7a8b\r\n; gachamod:added\r\nmatch_priority = 0\r\n; gachamod:begin\r\n"));
        assert!(w.contains("; gachamod:was condition = $active == 1\r\ncondition = ($active == 1) && $\\gachamod\\live\\g7 == 3 && $\\gachamod\\live\\open == 0\r\n"));
        assert!(w.contains("[KeyPlain]\r\n; gachamod:was -\r\ncondition = $\\gachamod\\live\\g7 == 3 && $\\gachamod\\live\\open == 0\r\nkey = VK_UP"));
        // resources and constants untouched
        assert!(w.contains("[ResourceBodyIB]\r\nfilename = Body.ib\r\n"));
        assert!(w.starts_with("[Constants]\r\nglobal persist $swap = 0\r\n"));
        // the settings moved above the gate, so taking it out restores every line (order aside)
        let back = unwrap(&w);
        let mut a: Vec<&str> = INI.lines().collect();
        let mut b: Vec<&str> = back.lines().collect();
        a.sort_unstable();
        b.sort_unstable();
        assert_eq!(a, b);
        // wrapping again with the same slot changes nothing (a scan checks gates this way)
        assert_eq!(wrap(&w, 7, 3).unwrap().unwrap(), w);
        // wrapping twice (another slot) is the same as once
        let again = wrap(&w, 7, 5).unwrap().unwrap();
        assert_eq!(again, wrap(INI, 7, 5).unwrap().unwrap());
        assert!(!again.contains("g7 == 3"));
    }

    #[test]
    fn buffer_sizes_stay_out_of_the_gate_and_take_the_largest() {
        let small = "[TextureOverrideBodyVertexLimitRaise]\nhash = DE6784E3\noverride_vertex_count = 2910\noverride_byte_stride = 40\n\n[TextureOverrideBody]\nhash = 11\nib = R\n";
        let big = "[TextureOverrideRaise]\nhash = de6784e3\noverride_vertex_count = 9000\noverride_byte_stride = 40\n\n[TextureOverrideOther]\nhash = 22\noverride_vertex_count = 5\n";
        let need = raises([small, big].into_iter());
        assert_eq!((need["de6784e3"], need["22"]), (9000, 5));
        // nothing to gate in a section that only sizes a buffer: its lines stay as settings, the count goes up
        let w = wrap_with(small, 1, 2, &need).unwrap().unwrap();
        assert!(w.contains("[TextureOverrideBodyVertexLimitRaise]\nhash = DE6784E3\n; gachamod:was override_vertex_count = 2910\noverride_vertex_count = 9000\noverride_byte_stride = 40\n; gachamod:added\nmatch_priority = 0\n"), "{w}");
        assert!(!w[..w.find("[TextureOverrideBody]").unwrap()].contains("gachamod:begin"));
        assert_eq!(unwrap(&w), small);
        // the one that already asks for the most is left as written, and the sizes read the same from gated text
        let w = wrap_with(big, 1, 3, &need).unwrap();
        assert!(w.is_none_or(|w| !w.contains("gachamod:was")));
        assert_eq!(raises([wrap_with(small, 1, 2, &need).unwrap().unwrap().as_str()].into_iter())["de6784e3"], 2910);
    }

    #[test]
    fn unbalanced_ifs_are_refused() {
        let bad = "[TextureOverrideX]\nhash = 1\nif $a == 1\nib = R\n";
        assert!(wrap(bad, 1, 1).is_err());
    }

    #[test]
    fn an_endif_that_closes_no_if_is_skipped() {
        // seen in a published mod: the loader skips the stray endif, and so does the gate
        let slip = "[TextureOverrideHairA]\nhash = 5eb66b57\nib = R\nendif\nrun = CommandList\\ZZMI\\SetTextures\ndrawindexed = 28722, 0, 0\n";
        let w = wrap(slip, 8, 6).unwrap().unwrap();
        assert!(w.contains("if $\\gachamod\\live\\g8 == 6\nib = R\n; gachamod:was endif\n; this endif closes no if, so the loader skips it\nrun = CommandList\\ZZMI\\SetTextures\ndrawindexed = 28722, 0, 0\nendif\n; gachamod:end\n"), "{w}");
        assert_eq!(unwrap(&w), slip);
        // a real if inside stays as it is
        let fine = "[TextureOverrideX]\nhash = 1\nif $a == 1\nib = R\nendif\nendif\ndrawindexed = auto\n";
        let w = wrap(fine, 1, 1).unwrap().unwrap();
        assert!(w.contains("if $a == 1\nib = R\nendif\n; gachamod:was endif\n"), "{w}");
        assert_eq!(unwrap(&w), fine);
    }

    #[test]
    fn bytes_round_trip() {
        let b: Vec<u8> = vec![b'a', 0xE4, 0xBD, 0xA0, 0xB0, b'\r', b'\n'];
        assert_eq!(to_bytes(&to_text(&b)), b);
    }

    #[test]
    fn menu_keys_are_the_players_to_pick() {
        let db = Db::memory().unwrap();
        let start = menu_settings(&db, "zzz");
        assert_eq!(start.binds, default_binds());
        assert_eq!(start.binds_of("show"), ["VK_RIGHT", "XB_DPAD_RIGHT", "VK_RETURN", "XB_A"]);
        // W and S move, and nothing else changes: a thing left out keeps its keys
        let mut binds = BTreeMap::new();
        binds.insert("up".to_string(), vec!["w".to_string(), "XB_DPAD_UP".to_string()]);
        binds.insert("down".to_string(), vec!["no_modifiers S".to_string(), "ctrl alt vk_j".to_string()]);
        let set = set_menu(&db, "zzz", &MenuSettings { binds, ..start.clone() }).unwrap();
        assert_eq!(set.binds["up"], ["W", "XB_DPAD_UP"]);
        assert_eq!(set.binds["down"], ["S", "ctrl alt J"]);
        assert_eq!(set.binds["show"], start.binds["show"]);
        assert_eq!(menu_settings(&db, "zzz"), set);
        // the hints name the first keyboard key, and with the controller off its buttons are gone
        assert_eq!(hint_keys(&set), menu::HintKeys { up: "W".into(), down: "S".into(), show: "\u{2192}".into(), back: "\u{2190}".into(), close: "F7".into() });
        let no_pad = MenuSettings { pad: false, ..set.clone() };
        assert_eq!(no_pad.binds_of("up"), ["W"]);
        assert!(no_pad.binds_of("close").is_empty() && no_pad.binds_of("open").is_empty());
        let s = Store { groups: vec![GroupRec { n: 2, character: "Ellen".into(), active: 4, next: 5, slots: vec![] }], ..Default::default() };
        let t = live_ini(&s, &MenuSettings { style: "game".into(), ..set.clone() }, &menu::Layout::new(1080), true, None);
        assert!(t.contains("[KeyMenuUp]\r\ncondition = $open == 1\r\nkey = W\r\nkey = XB_DPAD_UP\r\nrun = CommandListMenuUp\r\n") && !t.contains("VK_UP"));
        // a key can do one thing, the menu key included, and F10 stays the game's
        let two = |action: &str, key: &str| {
            let mut b = BTreeMap::new();
            b.insert(action.to_string(), vec![key.to_string()]);
            set_menu(&db, "zzz", &MenuSettings { binds: b, ..set.clone() }).unwrap_err().to_string()
        };
        assert!(two("show", "W").contains("W already moves up"));
        assert!(two("back", "VK_F7").contains("F7 already opens the menu"));
        assert!(two("back", "VK_F10").contains("F10 reloads"));
        assert!(two("open", "VK_F9").contains("keyboard key"));
        // no key at all is allowed, and the keys a menu starts with take the saved ones away
        let mut none = BTreeMap::new();
        none.insert("close".to_string(), Vec::new());
        assert!(set_menu(&db, "zzz", &MenuSettings { binds: none, ..set.clone() }).unwrap().binds["close"].is_empty());
        assert_eq!(set_menu(&db, "zzz", &MenuSettings::default()).unwrap().binds, default_binds());
        assert!(db.setting("zzz.liveMenuBinds").unwrap().is_none());
    }

    #[test]
    fn live_ini_reads_the_keys() {
        let s = Store { groups: vec![GroupRec { n: 2, character: "Ellen".into(), active: 4, next: 5, slots: vec![] }], ..Default::default() };
        let t = live_ini(&s, &MenuSettings::default(), &menu::Layout::new(1080), true, None);
        // the app's own key can open the game's menu, and the game binds no key of its own for it
        assert!(t.contains("if $cg == 0 && $cv == 1\r\n  run = CommandListMenuToggle\r\nendif\r\n$cg = 0\r\n") && !t.contains("[KeyMenuOpen]"));
        let direct = live_ini(&s, &MenuSettings { style: "game".into(), key: "Ctrl+Alt+M".into(), pad: false, ..Default::default() }, &menu::Layout::new(1080), true, None);
        assert!(direct.contains("[KeyMenuOpen]\r\nkey = ctrl alt no_shift no_windows M\r\nrun = CommandListMenuToggle"));
        let off = live_ini(&s, &MenuSettings { style: "off".into(), ..Default::default() }, &menu::Layout::new(1080), true, None);
        // a game that runs as administrator while the app doesn't: the app's key can't work, so the game binds it
        let alone = live_ini(&s, &MenuSettings::default(), &menu::Layout::new(1080), false, None);
        assert!(alone.contains("[KeyMenuOpen]\r\nkey = no_modifiers VK_F7\r\nkey = XB_LEFT_THUMB XB_RIGHT_THUMB\r\nrun = CommandListMenuToggle"));
        assert!(off.contains("[CommandListSeen2]") && !off.contains("CommandListMenuToggle"));
        assert!(t.contains("namespace = gachamod\\live\r\n"));
        assert!(t.contains("global persist $g2 = 4\r\n"));
        // ten held keys are the bits of a number, F23 keeps it as the group, F24 shows that slot of it
        assert!(t.contains("[KeyGachamodBit0]\r\nkey = VK_CLEAR VK_F13\r\ntype = hold\r\n$c0 = 1\r\n") && t.contains("[KeyGachamodBit9]\r\nkey = VK_CLEAR VK_F22\r\n"));
        assert!(t.contains("[CommandListGachamodNumber]\r\n$cv = $c0 + $c1 * 2 + $c2 * 4 + ") && t.contains(" + $c9 * 512\r\n"));
        assert!(t.contains("[KeyGachamodGroup]\r\nkey = VK_CLEAR VK_F23\r\nrun = CommandListGachamodGroup\r\n"));
        assert!(t.contains("[CommandListGachamodPick]\r\nrun = CommandListGachamodNumber\r\nif $cg == 2\r\n  $g2 = $cv\r\nendif\r\n"));
        assert!(!t.contains("cursor_screen"));
    }

    #[test]
    fn live_ini_has_the_key_list_when_a_sheet_exists() {
        let s = Store { groups: vec![GroupRec { n: 2, character: "Ellen".into(), active: 4, next: 5, slots: vec![SlotRec { slot: 4, mod_id: "m".into() }] }], waiting: vec![2], ask: 3, ..Default::default() };
        let kl = menu::KeyListIni { sheets: vec![menu::IniSheet { n: 2, slot: 4, h: 150 }], key: None, menu: vec!["XB_Y".into()] };
        let t = live_ini(&s, &MenuSettings::default(), &menu::Layout::new(1080), true, Some(&kl));
        // the number 2 with no group shows or hides it
        assert!(t.contains("if $cg == 0 && $cv == 2\r\n  run = CommandListKeysToggle\r\nendif\r\n$cg = 0\r\n"));
        assert!(t.contains("global $keys = 0\r\n") && !t.contains("global persist $keys"));
        // the waiting picks are still asked for first in [Present]
        assert!(t.contains("[Present]\r\nrun = CommandListGachamodAsked\r\nif $keys == 1\r\n  run = CommandListKeysFrame\r\nendif\r\n"));
        // no sheet, or the menu off: none of it
        let none = menu::KeyListIni { sheets: vec![], key: None, menu: vec!["XB_Y".into()] };
        assert!(!live_ini(&s, &MenuSettings::default(), &menu::Layout::new(1080), true, Some(&none)).contains("Keys"));
        assert!(!live_ini(&s, &MenuSettings { style: "off".into(), ..Default::default() }, &menu::Layout::new(1080), true, Some(&kl)).contains("Keys"));
    }
}
