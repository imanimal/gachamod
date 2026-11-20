//! Reading what is inside a mod: its .ini files' key bindings and variables, the hashes it overrides, files it
//! names that are missing, and the values 3DMigoto saved in d3dx_user.ini. Owner: MODTOOLS area
//! (docs/spec.md, "Mod internals").
//!
//! 3DMigoto's ini syntax is read leniently: anything that can't be understood is skipped, never a panic. Facts the
//! library scan needs (`quick_facts`) are cached per ini file by size and modified time, so a rescan of an unchanged
//! library reads nothing twice.

use crate::db::Db;
use crate::error::{Error, Result};
use crate::library;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::SystemTime;

/// A saved variable value of one mod (d3dx_user.ini line `$\mods\<rel>\<ini>\<var> = <value>`).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VarValue {
    /// The .ini's path inside the mod folder, forward slashes ("b/xixifu.ini").
    pub ini: String,
    /// Without the `$`.
    pub var: String,
    pub value: String,
}

/// One key binding from a `[Key...]` section.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyBinding {
    pub ini: String,
    pub section: String,
    /// As written ("VK_UP", "ctrl alt 1", "no_modifiers x"); `label` is a readable form ("Ctrl+Alt+1").
    pub key: String,
    pub label: String,
    /// The readable form of the `back` binding (cycle keys only), when there is one.
    pub back: Option<String>,
    /// "cycle", "toggle", "hold" or "activate".
    pub kind: String,
    /// Variables it changes, each with the values it steps through.
    pub vars: Vec<KeyVar>,
    pub condition: Option<String>,
    /// Every `key =` line as written (a section may bind a keyboard key and a pad button).
    pub keys: Vec<String>,
    /// Readable forms of `keys`, same order.
    pub labels: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyVar { pub var: String, pub values: Vec<String> }

/// A variable the mod declares in [Constants] (`global persist $swapvar = 0`).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VarInfo {
    pub ini: String,
    pub var: String,
    pub persist: bool,
    pub default: Option<String>,
    /// From d3dx_user.ini, when saved.
    pub current: Option<String>,
    /// Values a key binding steps through, when one does (for a picker).
    pub values: Vec<String>,
    /// A readable name guessed from the var and the key section names ("Jacket", "Hat").
    pub label: String,
    /// "switch" when the only values are 0 and 1, else "list".
    pub kind: String,
    /// Names for some values, when the mod says what they are: a merged mod's swap value -> the variant it shows
    /// ("2" -> "Raiden Kimono").
    #[serde(default)]
    pub names: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Problem {
    /// "missing_file", "bad_ini", "no_ini", "no_key", "missing_section", "overlap", "global_trigger",
    /// "duplicate_library", "missing_library", "missing_orfix" (a Genshin character mod that sets textures by
    /// slot and never calls ORFix or NNFix).
    pub kind: String,
    pub detail: String,
    pub ini: Option<String>,
    /// "bad": part of the mod won't show or shows wrong in game. "warn": something may not work, or only in a
    /// corner case (another skin, a boss). "info": harmless, or gachamod couldn't check it.
    pub severity: String,
    /// A change gachamod can make that fixes it, when one was found.
    pub fix: Option<ProblemFix>,
}

/// A fix `lint` found for a problem. `apply_fix` makes it.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProblemFix {
    /// "point": in `ini`, change the `filename = <from>` lines to `<to>`, a file with the same name that is in the
    /// mod (paths relative to the ini's folder, as 3DMigoto reads them).
    /// "keep": keep `ini` on and turn off the other `inis` by renaming them DISABLED_<name>.
    /// "off": turn off `ini` by renaming it DISABLED_<name> (a copy of a library the loader already has).
    /// "orfix": add the missing call (`run = CommandList\global\ORFix\ORFix`, or `\NNFix` for a part with no normal
    /// map) after the texture bindings of each part in `inis`, the mod's .ini files that need it.
    pub kind: String,
    pub ini: Option<String>,
    pub from: Option<String>,
    pub to: Option<String>,
    pub inis: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictRef {
    pub mod_id: String,
    pub name: String,
    pub shared: u32,
    /// The shared parts by their section names in the mod's ini ("ZhuYuan.Body.IB"), at most 40.
    #[serde(default)]
    pub parts: Vec<String>,
    /// The hashes this mod shares with the one whose details are open (empty in a group: the group has them).
    #[serde(default)]
    pub hashes: Vec<String>,
}

/// Everything the mod detail drawer shows about a mod's insides.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModInspect {
    pub mod_id: String,
    pub inis: Vec<String>,
    pub keys: Vec<KeyBinding>,
    pub vars: Vec<VarInfo>,
    pub hash_count: u32,
    pub conflicts: Vec<ConflictRef>,
    pub problems: Vec<Problem>,
    /// Text files a mod author left (readme.txt, instructions) with their first few KB.
    pub readmes: Vec<(String, String)>,
    /// Set when the mod is several mods merged into one by a merge script (merged.rs).
    #[serde(default)]
    pub merged: Option<crate::merged::MergedInfo>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictGroup {
    /// The mods that override the same hashes (two or more, all enabled).
    pub mods: Vec<ConflictRef>,
    pub hashes: Vec<String>,
    pub character: Option<String>,
    /// The user said to ignore it (every pair of its mods is on the ignore list).
    #[serde(default)]
    pub ignored: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModProblems {
    pub mod_id: String,
    pub name: String,
    pub enabled: bool,
    /// Where the mod came from, so it can be downloaded again.
    pub source: Option<crate::model::ModSource>,
    pub problems: Vec<Problem>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HashHit { pub mod_id: String, pub name: String, pub ini: String, pub section: String, pub enabled: bool }

/// Cheap facts the library scan stores for each mod.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickFacts {
    pub ini_count: u32,
    pub has_keys: bool,
    pub hashes: Vec<String>,
    /// The hashes of sections that change something (not just `hash` and `match_*` lines). Conflicts count these.
    pub active: Vec<String>,
}

// ── reading text ──

/// Text from bytes: UTF-8 with or without a BOM, UTF-16 LE or BE by BOM, anything else as lossy UTF-8.
pub(crate) fn decode(bytes: &[u8]) -> String {
    if let Some(rest) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) { return String::from_utf8_lossy(rest).into_owned(); }
    let utf16 = |rest: &[u8], le: bool| {
        let units: Vec<u16> = rest.chunks_exact(2).map(|c| if le { u16::from_le_bytes([c[0], c[1]]) } else { u16::from_be_bytes([c[0], c[1]]) }).collect();
        String::from_utf16_lossy(&units)
    };
    if let Some(rest) = bytes.strip_prefix(&[0xFF, 0xFE]) { return utf16(rest, true); }
    if let Some(rest) = bytes.strip_prefix(&[0xFE, 0xFF]) { return utf16(rest, false); }
    String::from_utf8_lossy(bytes).into_owned()
}

/// Read a text file no larger than `max` bytes. Err holds a sentence for a Problem.
pub(crate) fn read_text(path: &Path, max: u64) -> std::result::Result<String, String> {
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    match std::fs::metadata(path) {
        Ok(m) if m.len() > max => return Err(format!("{name} is too large to read ({} MB)", m.len() / 1_048_576)),
        Err(e) => return Err(format!("Couldn't read {name}: {}", crate::error::io_text(&e))),
        _ => {}
    }
    std::fs::read(path).map(|b| decode(&b)).map_err(|e| format!("Couldn't read {name}: {}", crate::error::io_text(&e)))
}

// ── the ini parser ──

#[derive(Debug, Default)]
pub(crate) struct Line { pub(crate) lkey: String, pub(crate) value: Option<String> }

#[derive(Debug, Default)]
pub(crate) struct Sec { pub(crate) name: String, pub(crate) lower: String, pub(crate) lines: Vec<Line> }

impl Sec {
    pub(crate) fn get<'a>(&'a self, key: &'a str) -> impl Iterator<Item = &'a str> + 'a {
        self.lines.iter().filter(move |l| l.lkey == key).filter_map(|l| l.value.as_deref())
    }
    pub(crate) fn first<'a>(&'a self, key: &'a str) -> Option<&'a str> { self.get(key).next() }
}

#[derive(Debug, Default)]
pub(crate) struct Ini { pub(crate) sections: Vec<Sec> }

/// Parse 3DMigoto ini text. Section names are compared case-insensitively, `;` starts a comment line (`#` does not),
/// a line splits on its first `=`, lines before any section go to a section named "".
pub(crate) fn parse(text: &str) -> Ini {
    let mut ini = Ini { sections: vec![Sec::default()] };
    for raw in text.split('\n') {
        let line = raw.trim_end_matches('\r').trim();
        if line.is_empty() || line.starts_with(';') { continue; }
        if let Some(rest) = line.strip_prefix('[') {
            let name = rest.find(']').map(|i| &rest[..i]).unwrap_or(rest).trim().to_string();
            ini.sections.push(Sec { lower: name.to_lowercase(), name, lines: Vec::new() });
            continue;
        }
        let (key, value) = match line.split_once('=') {
            Some((k, v)) => (k.trim(), Some(v.trim().to_string())),
            None => (line, None),
        };
        if let Some(sec) = ini.sections.last_mut() {
            sec.lines.push(Line { lkey: key.to_lowercase(), value });
        }
    }
    ini
}

/// A `hash =` value as 8 (or 16, for shaders) lowercase hex digits without 0x; None when it isn't one.
fn norm_hash(v: &str) -> Option<String> {
    let v = v.trim().trim_matches('"');
    let v = v.strip_prefix("0x").or_else(|| v.strip_prefix("0X")).unwrap_or(v).to_ascii_lowercase();
    if v.is_empty() || v.len() > 16 || !v.chars().all(|c| c.is_ascii_hexdigit()) { return None; }
    Some(if v.len() < 8 { format!("{v:0>8}") } else { v })
}

fn is_override(lower: &str) -> bool { lower.starts_with("textureoverride") || lower.starts_with("shaderoverride") }

/// The cheap part of one ini that the scan needs. `hashes` is (section, hash, does something).
#[derive(Debug, Default)]
struct IniFacts { has_keys: bool, hashes: Vec<(String, String, bool)>, namespace: Option<String> }

/// An override that only names a hash (and how it matches) changes nothing in game. Some mods carry a block of them
/// for other characters, which would otherwise look like conflicts with every mod that has the same block.
fn does_something(s: &Sec) -> bool {
    s.lines.iter().any(|l| !(l.lkey == "hash" || l.lkey.starts_with("match_") || l.lkey == "filter_index" || l.lkey == "allow_duplicate_hash"))
}

fn facts_of(ini: &Ini) -> IniFacts {
    let mut f = IniFacts { namespace: namespace_of(ini), ..Default::default() };
    for s in &ini.sections {
        if s.lower.starts_with("key") && s.first("key").is_some_and(|k| !k.is_empty()) { f.has_keys = true; }
        if is_override(&s.lower) {
            let live = does_something(s);
            for h in s.get("hash").filter_map(norm_hash) { f.hashes.push((s.name.clone(), h, live)); }
        }
    }
    f
}

/// The parts of a mod that change each hash: hash -> section names without "TextureOverride" ("ZhuYuan.Body.IB").
fn parts_by_hash(mod_dir: &Path) -> HashMap<String, Vec<String>> {
    let mut out: HashMap<String, Vec<String>> = HashMap::new();
    for (path, _) in mod_inis(mod_dir) {
        let Some(f) = cached_facts(&path) else { continue };
        for (sec, h, live) in &f.hashes {
            if !live { continue; }
            let lower = sec.to_ascii_lowercase();
            let name = if lower.starts_with("textureoverride") { &sec["textureoverride".len()..] }
                else if lower.starts_with("shaderoverride") { &sec["shaderoverride".len()..] } else { sec.as_str() };
            let list = out.entry(h.clone()).or_default();
            let name = name.trim().to_string();
            if !list.contains(&name) { list.push(name); }
        }
    }
    out
}

/// Readable names for shared hashes: the section names `parts` gives them, the hash itself when it has none.
fn part_names(parts: &HashMap<String, Vec<String>>, hashes: &[String]) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    for h in hashes {
        let n = parts.get(h).and_then(|v| v.first()).map(|n| format!("{n} ({h})")).unwrap_or_else(|| h.clone());
        if !names.contains(&n) { names.push(n); }
    }
    names.sort_by_key(|n| n.to_lowercase());
    names.truncate(40);
    names
}

const QUICK_MAX: u64 = 2 * 1024 * 1024;
pub(crate) const FULL_MAX: u64 = 16 * 1024 * 1024;

type FactsCache = HashMap<PathBuf, (SystemTime, u64, Arc<IniFacts>)>;
static FACTS: LazyLock<Mutex<FactsCache>> = LazyLock::new(|| Mutex::new(HashMap::new()));

/// Facts for one ini file, cached by size and modified time. None for files too large or unreadable.
fn cached_facts(path: &Path) -> Option<Arc<IniFacts>> {
    let meta = std::fs::metadata(path).ok()?;
    if meta.len() > QUICK_MAX { return None; }
    let mtime = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
    if let Ok(c) = FACTS.lock() {
        if let Some((t, n, f)) = c.get(path) { if *t == mtime && *n == meta.len() { return Some(f.clone()); } }
    }
    let text = std::fs::read(path).ok().map(|b| decode(&b))?;
    let f = Arc::new(facts_of(&parse(&text)));
    if let Ok(mut c) = FACTS.lock() {
        if c.len() > 50_000 { c.clear(); }
        c.insert(path.to_path_buf(), (mtime, meta.len(), f.clone()));
    }
    Some(f)
}

/// The .ini files 3DMigoto would load from a mod folder: `*.ini` (not desktop.ini), skipping files and folders named
/// DISABLED* below the mod's own folder. (absolute path, path inside the mod with forward slashes), sorted.
pub(crate) fn mod_inis(dir: &Path) -> Vec<(PathBuf, String)> {
    let mut out: Vec<(PathBuf, String)> = walkdir::WalkDir::new(dir).follow_links(false).max_depth(10).into_iter()
        .filter_entry(|e| {
            if e.depth() == 0 { return true; }
            let n = e.file_name().to_string_lossy();
            !(library::is_disabled_name(&n) || (e.file_type().is_dir() && (n.eq_ignore_ascii_case("ShaderCache") || n == ".git")))
        })
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter(|e| {
            let n = e.file_name().to_string_lossy().to_ascii_lowercase();
            n.ends_with(".ini") && n != "desktop.ini"
        })
        .filter_map(|e| {
            let rel = e.path().strip_prefix(dir).ok()?;
            let rel = rel.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/");
            Some((e.path().to_path_buf(), rel))
        })
        .collect();
    out.sort_by_key(|(_, r)| r.to_lowercase());
    out
}

/// Read a mod folder's .ini files (skipping DISABLED*.ini and anything under a DISABLED folder) for the scan.
pub fn quick_facts(mod_dir: &Path) -> QuickFacts {
    let inis = mod_inis(mod_dir);
    let mut hashes = BTreeSet::new();
    let mut active = BTreeSet::new();
    let mut has_keys = false;
    for (path, _) in &inis {
        if let Some(f) = cached_facts(path) {
            has_keys |= f.has_keys;
            hashes.extend(f.hashes.iter().map(|(_, h, _)| h.clone()));
            active.extend(f.hashes.iter().filter(|(_, _, live)| *live).map(|(_, h, _)| h.clone()));
        }
    }
    QuickFacts { ini_count: inis.len() as u32, has_keys, hashes: hashes.into_iter().collect(), active: active.into_iter().collect() }
}

// ── readable key names ──

fn vk_name(code: u32) -> Option<String> {
    Some(match code {
        0x01 => "Left click".into(), 0x02 => "Right click".into(), 0x04 => "Middle click".into(),
        0x05 => "Mouse 4".into(), 0x06 => "Mouse 5".into(),
        0x08 => "Backspace".into(), 0x09 => "Tab".into(), 0x0D => "Enter".into(), 0x10 => "Shift".into(), 0x11 => "Ctrl".into(),
        0x12 => "Alt".into(), 0x14 => "Caps Lock".into(), 0x1B => "Esc".into(), 0x20 => "Space".into(),
        0x21 => "Page Up".into(), 0x22 => "Page Down".into(), 0x23 => "End".into(), 0x24 => "Home".into(),
        0x25 => "Left".into(), 0x26 => "Up".into(), 0x27 => "Right".into(), 0x28 => "Down".into(),
        0x2D => "Ins".into(), 0x2E => "Del".into(),
        0x30..=0x39 | 0x41..=0x5A => char::from_u32(code)?.to_string(),
        0x60..=0x69 => format!("Num {}", code - 0x60),
        0x6A => "Num *".into(), 0x6B => "Num +".into(), 0x6D => "Num -".into(), 0x6E => "Num .".into(), 0x6F => "Num /".into(),
        0x70..=0x87 => format!("F{}", code - 0x6F),
        0xBA => ";".into(), 0xBB => "=".into(), 0xBC => ",".into(), 0xBD => "-".into(), 0xBE => ".".into(), 0xBF => "/".into(),
        0xC0 => "`".into(), 0xDB => "[".into(), 0xDC => "\\".into(), 0xDD => "]".into(), 0xDE => "'".into(),
        0xA0 => "Left Shift".into(), 0xA1 => "Right Shift".into(), 0xA2 => "Left Ctrl".into(), 0xA3 => "Right Ctrl".into(),
        0xA4 => "Left Alt".into(), 0xA5 => "Right Alt".into(),
        // Windows' own gamepad key codes
        0xC3 => "Pad A".into(), 0xC4 => "Pad B".into(), 0xC5 => "Pad X".into(), 0xC6 => "Pad Y".into(),
        0xC7 => "Pad RB".into(), 0xC8 => "Pad LB".into(), 0xC9 => "Pad LT".into(), 0xCA => "Pad RT".into(),
        0xCB => "Pad Up".into(), 0xCC => "Pad Down".into(), 0xCD => "Pad Left".into(), 0xCE => "Pad Right".into(),
        0xCF => "Pad Start".into(), 0xD0 => "Pad Back".into(), 0xD1 => "Pad LS".into(), 0xD2 => "Pad RS".into(),
        _ => return None,
    })
}

/// "VK_UP" -> "Up", "NUMPAD1" -> "Num 1", "0x41" -> "A", "XB_LEFT_TRIGGER" -> "Pad LT", "x" -> "X".
fn key_label(token: &str) -> String {
    let t = token.trim();
    let up = t.to_ascii_uppercase();
    // controller buttons
    for (prefix, pad) in [("XB2_", "Pad 2 "), ("XB_", "Pad ")] {
        if let Some(b) = up.strip_prefix(prefix) {
            let name = match b {
                "LEFT_TRIGGER" => "LT", "RIGHT_TRIGGER" => "RT", "LEFT_SHOULDER" => "LB", "RIGHT_SHOULDER" => "RB",
                "LEFT_THUMB" => "LS", "RIGHT_THUMB" => "RS", "DPAD_UP" => "Up", "DPAD_DOWN" => "Down",
                "DPAD_LEFT" => "Left", "DPAD_RIGHT" => "Right", "START" => "Start", "BACK" => "Back", "GUIDE" => "Guide",
                other => return format!("{pad}{}", title_words(other)),
            };
            return format!("{pad}{name}");
        }
    }
    if let Some(hex) = up.strip_prefix("0X") {
        if let Ok(code) = u32::from_str_radix(hex, 16) {
            return vk_name(code).unwrap_or_else(|| format!("Key {t}"));
        }
    }
    let name = up.strip_prefix("VK_").unwrap_or(&up);
    if name.chars().count() == 1 { return name.to_string(); }
    if let Some(n) = name.strip_prefix("NUMPAD") { if n.len() == 1 { return format!("Num {n}"); } }
    if let Some(n) = name.strip_prefix('F') { if n.parse::<u32>().is_ok_and(|n| (1..=24).contains(&n)) { return name.to_string(); } }
    let fixed = match name {
        "UP" => "Up", "DOWN" => "Down", "LEFT" => "Left", "RIGHT" => "Right",
        "OEM_1" => ";", "OEM_2" => "/", "OEM_3" => "`", "OEM_4" => "[", "OEM_5" => "\\", "OEM_6" => "]", "OEM_7" => "'",
        "OEM_PLUS" => "=", "OEM_MINUS" => "-", "OEM_COMMA" => ",", "OEM_PERIOD" => ".",
        "MULTIPLY" => "Num *", "ADD" => "Num +", "SUBTRACT" => "Num -", "DIVIDE" => "Num /", "DECIMAL" => "Num .",
        "OEM_102" => "\\", "OEM_8" => "`", "PAUSE" => "Pause", "SCROLL" => "Scroll Lock", "NUMLOCK" => "Num Lock", "APPS" => "Menu key",
        "SNAPSHOT" => "Print Screen", "CLEAR" => "Clear",
        "SPACE" => "Space", "RETURN" | "ENTER" => "Enter", "BACK" | "BACKSPACE" => "Backspace", "TAB" => "Tab",
        "ESCAPE" | "ESC" => "Esc", "PRIOR" | "PAGEUP" => "Page Up", "NEXT" | "PAGEDOWN" => "Page Down",
        "HOME" => "Home", "END" => "End", "INSERT" => "Ins", "DELETE" => "Del", "CAPITAL" => "Caps Lock",
        "LBUTTON" => "Left click", "RBUTTON" => "Right click", "MBUTTON" => "Middle click",
        "XBUTTON1" => "Mouse 4", "XBUTTON2" => "Mouse 5",
        "LCONTROL" => "Left Ctrl", "RCONTROL" => "Right Ctrl", "LSHIFT" => "Left Shift", "RSHIFT" => "Right Shift",
        "LMENU" => "Left Alt", "RMENU" => "Right Alt", "CONTROL" => "Ctrl", "MENU" => "Alt", "SHIFT" => "Shift",
        "LCTRL" => "Left Ctrl", "RCTRL" => "Right Ctrl", "LALT" => "Left Alt", "RALT" => "Right Alt", "CTRL" => "Ctrl",
        "ALT" => "Alt", "LWIN" => "Left Win", "RWIN" => "Right Win",
        _ => return title_words(name),
    };
    fixed.to_string()
}

/// "SOME_NAME" -> "Some name".
fn title_words(s: &str) -> String {
    let words = s.split('_').filter(|w| !w.is_empty()).map(|w| w.to_lowercase()).collect::<Vec<_>>().join(" ");
    let mut c = words.chars();
    match c.next() { Some(f) => f.to_uppercase().collect::<String>() + c.as_str(), None => String::new() }
}

/// A binding as people read it: "ctrl alt VK_UP" -> "Ctrl+Alt+Up", "no_modifiers x" -> "X".
pub(crate) fn binding_label(binding: &str) -> String {
    let (mut ctrl, mut alt, mut shift, mut win) = (false, false, false, false);
    let mut keys = Vec::new();
    for tok in binding.split_whitespace() {
        match tok.to_ascii_lowercase().as_str() {
            "ctrl" => ctrl = true,
            "alt" => alt = true,
            "shift" => shift = true,
            "windows" => win = true,
            t if t.starts_with("no_") => {}
            _ => keys.push(key_label(tok)),
        }
    }
    let mut parts: Vec<String> = Vec::new();
    if ctrl { parts.push("Ctrl".into()); }
    if alt { parts.push("Alt".into()); }
    if shift { parts.push("Shift".into()); }
    if win { parts.push("Win".into()); }
    parts.extend(keys);
    parts.join("+")
}

// ── numbers like 3DMigoto prints them (%.9g) ──

/// Format a value like C's `%.9g`: "1", "0.5", "-2", "1e+10".
pub(crate) fn format_g9(v: f64) -> String {
    if !v.is_finite() { return v.to_string(); }
    if v == 0.0 { return "0".into(); }
    let sci = format!("{v:.8e}");
    let (mant, exp) = sci.split_once('e').unwrap_or((&sci, "0"));
    let exp: i32 = exp.parse().unwrap_or(0);
    let trim = |s: &str| -> String {
        if s.contains('.') { s.trim_end_matches('0').trim_end_matches('.').to_string() } else { s.to_string() }
    };
    if !(-4..9).contains(&exp) {
        format!("{}e{}{:02}", trim(mant), if exp < 0 { '-' } else { '+' }, exp.abs())
    } else {
        trim(&format!("{:.*}", (8 - exp).max(0) as usize, v))
    }
}

/// A value normalised for comparing and saving: numbers as %.9g, anything else trimmed as is.
pub(crate) fn norm_value(v: &str) -> String {
    let t = v.trim();
    t.parse::<f64>().map(format_g9).unwrap_or_else(|_| t.to_string())
}

// ── labels for variables ──

fn sentence(words: &[String]) -> String {
    let s = words.iter().filter(|w| !w.is_empty()).map(|w| w.to_lowercase()).collect::<Vec<_>>().join(" ");
    let mut c = s.chars();
    match c.next() { Some(f) => f.to_uppercase().collect::<String>() + c.as_str(), None => String::new() }
}

/// "swapvar" -> "Swap", "jacket_off" -> "Jacket off".
pub(crate) fn var_label(var: &str) -> String {
    let mut v = var.trim_start_matches('$').to_lowercase();
    if v.len() > 3 && v.ends_with("var") { v.truncate(v.len() - 3); }
    let words: Vec<String> = v.split(['_', '-', ' ']).map(String::from).collect();
    let s = sentence(&words);
    if s.is_empty() { var.to_string() } else { s }
}

/// "KeyJacket" -> "Jacket", "KeyToggleCoat" -> "Toggle coat", "Key_hat_2" -> "Hat 2".
pub(crate) fn section_label(section: &str) -> String {
    let rest = if section.len() >= 3 && section[..3].eq_ignore_ascii_case("key") { &section[3..] } else { section };
    let mut words: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut prev: Option<char> = None;
    for ch in rest.chars() {
        if matches!(ch, '_' | '-' | ' ' | '.') {
            if !cur.is_empty() { words.push(std::mem::take(&mut cur)); }
        } else {
            let boundary = prev.is_some_and(|p| (p.is_lowercase() && ch.is_uppercase()) || (p.is_alphabetic() != ch.is_alphabetic()));
            if boundary && !cur.is_empty() { words.push(std::mem::take(&mut cur)); }
            cur.push(ch);
        }
        prev = Some(ch);
    }
    if !cur.is_empty() { words.push(cur); }
    sentence(&words)
}

/// A name that says nothing about what the option does ("Swap", "1", "Swap 2").
pub(crate) fn generic_label(label: &str) -> bool {
    let l = label.to_lowercase();
    let base = l.trim_end_matches(|c: char| c.is_ascii_digit() || c == ' ');
    base.is_empty() || matches!(base, "swap" | "var" | "toggle" | "cycle" | "key" | "switch" | "change" | "option")
}

// ── d3dx_user.ini ──

static USER_INI_LOCK: Mutex<()> = Mutex::new(());
static BACKED_UP: LazyLock<Mutex<HashSet<PathBuf>>> = LazyLock::new(|| Mutex::new(HashSet::new()));

fn user_ini_path(importer_dir: &Path) -> PathBuf { importer_dir.join("d3dx_user.ini") }

/// Each importer folder's Mods folder as 3DMigoto names it in d3dx_user.ini: its path from the importer folder,
/// lowercased ("mods" in the usual layout). `games::importer_dir` notes it; "mods" until then.
static MODS_NAMES: LazyLock<Mutex<HashMap<String, String>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

fn norm_dir(p: &Path) -> String { p.to_string_lossy().replace('/', "\\").trim_end_matches('\\').to_lowercase() }

/// Note where a game's Mods folder is, so saved values use the name 3DMigoto gives it. A Mods folder outside the
/// importer folder keeps "mods" (3DMigoto loads the folders d3dx.ini includes, which sit beside it).
pub(crate) fn note_mods_dir(importer_dir: &Path, mods_dir: &Path) {
    let (imp, mods) = (norm_dir(importer_dir), norm_dir(mods_dir));
    let name = mods.strip_prefix(&format!("{imp}\\")).filter(|r| !r.is_empty()).unwrap_or("mods").to_string();
    if let Ok(mut m) = MODS_NAMES.lock() { m.insert(imp, name); }
}

/// The Mods folder's name under an importer folder, as noted (`note_mods_dir`).
fn mods_name(importer_dir: &Path) -> Option<String> {
    MODS_NAMES.lock().ok().and_then(|m| m.get(&norm_dir(importer_dir)).cloned())
}

/// The namespace 3DMigoto gives a mod folder: `<Mods folder>\<rel>`, lowercased with backslashes (`mods\<rel>` in
/// the usual layout).
fn mod_namespace(importer_dir: &Path, mod_rel: &str) -> String {
    let mods = mods_name(importer_dir).unwrap_or_else(|| "mods".into());
    let rel = mod_rel.replace('/', "\\");
    format!("{mods}\\{}", rel.trim_matches('\\').to_lowercase())
}

struct UserIni { bom: bool, lines: Vec<String>, nl: &'static str }

impl UserIni {
    fn read(path: &Path) -> Result<Option<UserIni>> {
        let bytes = match std::fs::read(path) {
            Ok(b) => b,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(e.into()),
        };
        let bom = bytes.starts_with(&[0xEF, 0xBB, 0xBF]);
        let text = decode(&bytes);
        let nl = if text.contains("\r\n") || !text.contains('\n') { "\r\n" } else { "\n" };
        Ok(Some(UserIni { bom, lines: text.split_inclusive('\n').map(String::from).collect(), nl }))
    }

    fn empty() -> UserIni { UserIni { bom: false, lines: vec!["[Constants]\r\n".into()], nl: "\r\n" } }

    fn text(&self) -> String {
        let mut s = String::new();
        if self.bom { s.push('\u{feff}'); }
        for l in &self.lines { s.push_str(l); }
        s
    }

    /// Insert lines at the end of the [Constants] section (made when missing).
    fn insert(&mut self, new: Vec<String>) {
        if new.is_empty() { return; }
        if let Some(last) = self.lines.last_mut() { if !last.ends_with('\n') { last.push_str(self.nl); } }
        let start = self.lines.iter().position(|l| l.trim().eq_ignore_ascii_case("[constants]"));
        let at = match start {
            Some(s) => {
                let end = self.lines[s + 1..].iter().position(|l| l.trim_start().starts_with('[')).map(|i| s + 1 + i).unwrap_or(self.lines.len());
                // after the section's last line that isn't blank
                let mut at = end;
                while at > s + 1 && self.lines[at - 1].trim().is_empty() { at -= 1; }
                at
            }
            None => { self.lines.push(format!("[Constants]{}", self.nl)); self.lines.len() }
        };
        let nl = self.nl;
        self.lines.splice(at..at, new.into_iter().map(|l| format!("{l}{nl}")));
    }
}

/// `$\<name> = <value>` -> (name lowercased, value), for the saved-variable lines.
fn var_line(line: &str) -> Option<(String, String)> {
    let t = line.trim();
    let rest = t.strip_prefix("$\\")?;
    let (name, value) = rest.split_once('=')?;
    Some((name.trim().to_lowercase(), value.trim().to_string()))
}


/// Rename with three retries 150 ms apart for files that are briefly in use (os error 5 or 32).
pub(crate) fn rename_retry(from: &Path, to: &Path) -> Result<()> {
    let mut tries = 0;
    loop {
        match std::fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(e) if matches!(e.raw_os_error(), Some(5 | 32)) && tries < 3 => {
                tries += 1;
                std::thread::sleep(std::time::Duration::from_millis(150));
            }
            Err(e) => {
                if matches!(e.raw_os_error(), Some(5 | 32)) {
                    let name = to.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                    return Err(Error::Conflict(format!("Windows wouldn't let gachamod change \"{name}\". Close the game or any program using it, then try again")));
                }
                return Err(e.into());
            }
        }
    }
}

/// Save d3dx_user.ini: a backup once per app session, then a temp file renamed over the old one.
fn write_user_ini(path: &Path, ini: &UserIni) -> Result<()> {
    let first = BACKED_UP.lock().map(|mut s| s.insert(path.to_path_buf())).unwrap_or(false);
    if first && path.exists() {
        let mut bak = path.as_os_str().to_owned();
        bak.push(".gachamod.bak");
        std::fs::copy(path, PathBuf::from(bak))?;
    }
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".gachamod.tmp");
    let tmp = PathBuf::from(tmp);
    std::fs::write(&tmp, ini.text())?;
    if let Err(e) = rename_retry(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    Ok(())
}

/// Does `rel` (backslashes) exist under `base`? Windows is case-insensitive already; elsewhere compare names.
fn exists_ci(base: &Path, rel: &str) -> bool { find_ci(base, rel).is_some() }

/// The path `rel` names from `base`, matching each part in any case (3DMigoto runs on Windows). None when missing.
pub(crate) fn find_ci(base: &Path, rel: &str) -> Option<PathBuf> {
    let direct = base.join(rel.replace('\\', "/"));
    if direct.exists() { return Some(direct); }
    let mut cur = base.to_path_buf();
    for part in rel.split(['\\', '/']).filter(|p| !p.is_empty() && *p != ".") {
        if part == ".." { cur.pop(); continue; }
        let next = std::fs::read_dir(&cur).ok().and_then(|rd| rd.flatten().find(|e| e.file_name().to_string_lossy().eq_ignore_ascii_case(part)))?;
        cur = next.path();
    }
    cur.exists().then_some(cur)
}

/// The saved values in d3dx_user.ini for the mod folder at `mod_rel` (path from Mods, forward slashes, as it is now).
pub fn user_vars(importer_dir: &Path, mod_rel: &str) -> Result<Vec<VarValue>> {
    let Some(ini) = UserIni::read(&user_ini_path(importer_dir))? else { return Ok(Vec::new()) };
    let prefix = format!("{}\\", mod_namespace(importer_dir, mod_rel));
    let mod_dir = importer_dir.join(mods_name(importer_dir).as_deref().unwrap_or("Mods")).join(mod_rel);
    let mod_exists = mod_dir.is_dir();
    let mut out = Vec::new();
    for line in &ini.lines {
        let Some((name, value)) = var_line(line) else { continue };
        let Some(rest) = name.strip_prefix(&prefix) else { continue };
        let Some((ini_path, var)) = rest.rsplit_once('\\') else { continue };
        if !ini_path.ends_with(".ini") || var.is_empty() { continue; }
        // "a" vs "a/b": a line for a nested mod also starts with the outer mod's prefix. Keep it only when the ini
        // is really in this mod (when the folder is there to check).
        if mod_exists && ini_path.contains('\\') && !exists_ci(&mod_dir, ini_path) { continue; }
        out.push(VarValue { ini: ini_path.replace('\\', "/"), var: var.to_string(), value });
    }
    Ok(out)
}

/// Write values for the mod folder at `mod_rel` into d3dx_user.ini (replacing that mod's lines for those vars).
/// Callers check the game is closed first.
pub fn set_user_vars(importer_dir: &Path, mod_rel: &str, values: &[VarValue]) -> Result<()> {
    if values.is_empty() { return Ok(()); }
    let _guard = USER_INI_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let path = user_ini_path(importer_dir);
    let mut ini = UserIni::read(&path)?.unwrap_or_else(UserIni::empty);
    let ns = mod_namespace(importer_dir, mod_rel);
    let mut wanted: BTreeMap<String, String> = BTreeMap::new();
    for v in values {
        let ini_rel = v.ini.replace('/', "\\").trim_matches('\\').to_lowercase();
        let var = v.var.trim().trim_start_matches('$').to_lowercase();
        if ini_rel.is_empty() || var.is_empty() { continue; }
        wanted.insert(format!("{ns}\\{ini_rel}\\{var}"), norm_value(&v.value));
    }
    let mut done = HashSet::new();
    for line in ini.lines.iter_mut() {
        let Some((name, _)) = var_line(line) else { continue };
        if let Some(value) = wanted.get(&name) {
            let end = if line.ends_with("\r\n") { "\r\n" } else if line.ends_with('\n') { "\n" } else { "" };
            *line = format!("$\\{name} = {value}{end}");
            done.insert(name);
        }
    }
    let new: Vec<String> = wanted.iter().filter(|(n, _)| !done.contains(*n)).map(|(n, v)| format!("$\\{n} = {v}")).collect();
    ini.insert(new);
    if !path.exists() { if let Some(dir) = path.parent() { std::fs::create_dir_all(dir)?; } }
    write_user_ini(&path, &ini)
}

/// One saved value by its full name (`gachamod\live\g3`), from d3dx_user.ini.
pub(crate) fn user_value(importer_dir: &Path, name: &str) -> Option<String> {
    let ini = UserIni::read(&user_ini_path(importer_dir)).ok().flatten()?;
    let name = name.to_lowercase();
    ini.lines.iter().filter_map(|l| var_line(l)).find(|(n, _)| *n == name).map(|(_, v)| v)
}

/// Write one saved value by its full name into d3dx_user.ini. Callers check the game is closed first.
pub(crate) fn set_user_value(importer_dir: &Path, name: &str, value: &str) -> Result<()> {
    let _guard = USER_INI_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let path = user_ini_path(importer_dir);
    let mut ini = UserIni::read(&path)?.unwrap_or_else(UserIni::empty);
    let name = name.to_lowercase();
    let mut done = false;
    for line in ini.lines.iter_mut() {
        if var_line(line).is_some_and(|(n, _)| n == name) {
            let end = if line.ends_with("\r\n") { "\r\n" } else if line.ends_with('\n') { "\n" } else { "" };
            *line = format!("$\\{name} = {value}{end}");
            done = true;
        }
    }
    if !done { ini.insert(vec![format!("$\\{name} = {value}")]); }
    if !path.exists() { if let Some(dir) = path.parent() { std::fs::create_dir_all(dir)?; } }
    write_user_ini(&path, &ini)
}

/// Saved values whose names start with `prefix` (lowercase, like `modmanageragl\`): (the rest of the name, value).
pub(crate) fn user_values(importer_dir: &Path, prefix: &str) -> Vec<(String, String)> {
    let Some(ini) = UserIni::read(&user_ini_path(importer_dir)).ok().flatten() else { return Vec::new() };
    let prefix = prefix.to_lowercase();
    ini.lines.iter().filter_map(|l| var_line(l)).filter_map(|(n, v)| Some((n.strip_prefix(&prefix)?.to_string(), v))).collect()
}

/// Move saved values from one mod path to another (a mod folder was renamed or moved), so they survive.
pub fn move_user_vars(importer_dir: &Path, from_rel: &str, to_rel: &str) -> Result<()> {
    if from_rel.trim_matches(['/', '\\']).is_empty() { return Ok(()); }
    move_user_prefix(importer_dir, &mod_namespace(importer_dir, from_rel), &mod_namespace(importer_dir, to_rel))
}

/// Move saved values from one namespace to another (`name_1` -> `name`), so they survive a rename.
pub(crate) fn move_user_prefix(importer_dir: &Path, from_ns: &str, to_ns: &str) -> Result<()> {
    let from = format!("{}\\", from_ns.trim_matches('\\').to_lowercase());
    let to = format!("{}\\", to_ns.trim_matches('\\').to_lowercase());
    if from == to || from == "\\" || to == "\\" { return Ok(()); }
    let _guard = USER_INI_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let path = user_ini_path(importer_dir);
    let Some(mut ini) = UserIni::read(&path)? else { return Ok(()) };
    let mut moved: Vec<(usize, String)> = Vec::new();
    for (i, line) in ini.lines.iter().enumerate() {
        if let Some((name, _)) = var_line(line) {
            if let Some(rest) = name.strip_prefix(&from) { moved.push((i, format!("{to}{rest}"))); }
        }
    }
    if moved.is_empty() { return Ok(()); }
    let new_names: HashSet<&str> = moved.iter().map(|(_, n)| n.as_str()).collect();
    let moving: HashSet<usize> = moved.iter().map(|(i, _)| *i).collect();
    // lines already at the new path for the same variables would be duplicates: the moved ones win
    let stale: HashSet<usize> = ini.lines.iter().enumerate()
        .filter(|(i, l)| !moving.contains(i) && var_line(l).is_some_and(|(n, _)| new_names.contains(n.as_str())))
        .map(|(i, _)| i).collect();
    for (i, name) in &moved {
        let line = &ini.lines[*i];
        let value = var_line(line).map(|(_, v)| v).unwrap_or_default();
        let end = if line.ends_with("\r\n") { "\r\n" } else if line.ends_with('\n') { "\n" } else { "" };
        ini.lines[*i] = format!("$\\{name} = {value}{end}");
    }
    let mut i = 0;
    ini.lines.retain(|_| { let keep = !stale.contains(&i); i += 1; keep });
    write_user_ini(&path, &ini)
}

// ── a whole mod ──

/// One parsed ini of a mod, with the text (empty when it couldn't be read).
struct ModIni { rel: String, abs: PathBuf, parsed: std::result::Result<Ini, String>, text: String }

fn read_mod(dir: &Path) -> Vec<ModIni> {
    mod_inis(dir).into_iter().map(|(abs, rel)| {
        let (parsed, text) = match read_text(&abs, FULL_MAX) {
            Ok(t) => (Ok(parse(&t)), t),
            Err(e) => (Err(e), String::new()),
        };
        ModIni { rel, abs, parsed, text }
    }).collect()
}

fn problem(kind: &str, severity: &str, ini: Option<&str>, detail: String) -> Problem {
    Problem { kind: kind.into(), detail, ini: ini.map(String::from), severity: severity.into(), fix: None }
}

fn severity_rank(s: &str) -> u8 { match s { "bad" => 0, "warn" => 1, _ => 2 } }

/// Any ini in the folder at all, on or turned off (DISABLED*.ini, *.ini.disabled, or under a DISABLED folder).
fn any_ini_file(dir: &Path) -> bool {
    walkdir::WalkDir::new(dir).follow_links(false).max_depth(10).into_iter().flatten().any(|e| {
        let n = e.file_name().to_string_lossy().to_ascii_lowercase();
        e.file_type().is_file() && n != "desktop.ini" && (n.ends_with(".ini") || library::is_off_ini(&n))
    })
}

/// Resource sections that something in the mod names (lowercased, "resourcefoo"). 3DMigoto loads a resource's file
/// the first time a command uses it, so a `[Resource]` section nothing names never loads and its file isn't needed.
fn used_resources(inis: &[ModIni]) -> HashSet<String> {
    let mut out = HashSet::new();
    for ini in inis.iter().filter_map(|m| m.parsed.as_ref().ok()) {
        for l in ini.sections.iter().flat_map(|s| &s.lines) {
            let text = match &l.value { Some(v) => format!("{} {v}", l.lkey), None => l.lkey.clone() };
            for tok in text.split(|c: char| c.is_whitespace() || "=,()!&|<>+*/;\"".contains(c)) {
                let t = tok.to_lowercase();
                if !t.starts_with("resource") { continue; }
                // Resource\namespace\Name names [ResourceName] in another file
                out.insert(match t.rsplit_once('\\') { Some((_, last)) => format!("resource{last}"), None => t });
            }
        }
    }
    out
}

/// Every file in the mod folder (DISABLED folders too) by lowercased name, read once per mod when a file is missing.
fn files_by_name(dir: &Path) -> HashMap<String, Vec<PathBuf>> {
    let mut out: HashMap<String, Vec<PathBuf>> = HashMap::new();
    for e in walkdir::WalkDir::new(dir).follow_links(false).max_depth(10).into_iter().flatten().filter(|e| e.file_type().is_file()) {
        out.entry(e.file_name().to_string_lossy().to_lowercase()).or_default().push(e.into_path());
    }
    out
}

fn same_bytes(a: &Path, b: &Path) -> bool {
    const MAX: u64 = 256 * 1024 * 1024;
    let (Ok(ma), Ok(mb)) = (std::fs::metadata(a), std::fs::metadata(b)) else { return false };
    if ma.len() != mb.len() { return false; }
    ma.len() <= MAX && matches!((std::fs::read(a), std::fs::read(b)), (Ok(x), Ok(y)) if x == y)
}

/// The copy of a missing file to use instead: the only one, the one whose folder name is closest to the folder the
/// ini asks for ("./Regular/x.buf" finds "RegularRaiden/x.buf"), or the first when every copy is the same file.
/// None when it can't tell which one is meant.
fn pick_copy(wanted: &str, found: &[PathBuf]) -> Option<PathBuf> {
    if found.len() <= 1 { return found.first().cloned(); }
    let w = wanted.replace('\\', "/");
    let want_dir = w.rsplit_once('/').map(|(d, _)| d.rsplit('/').next().unwrap_or(d)).unwrap_or("").to_lowercase();
    if !want_dir.is_empty() && want_dir != "." && want_dir != ".." {
        let score = |p: &PathBuf| {
            let dir = p.parent().and_then(|d| d.file_name()).map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
            dir.chars().zip(want_dir.chars()).take_while(|(a, b)| a == b).count()
        };
        let best = found.iter().map(score).max().unwrap_or(0);
        let top: Vec<&PathBuf> = found.iter().filter(|p| score(p) == best).collect();
        if best >= 3 && top.len() == 1 { return Some(top[0].clone()); }
    }
    found[1..].iter().all(|p| same_bytes(&found[0], p)).then(|| found[0].clone())
}

/// `target` as 3DMigoto reads it from an ini in `base`: "..\RegularRaiden\x.buf". `like` is the line it replaces,
/// whose slashes and leading ".\" are kept.
fn path_from(base: &Path, target: &Path, like: &str) -> Option<String> {
    let b: Vec<_> = base.components().collect();
    let t: Vec<_> = target.components().collect();
    let common = b.iter().zip(&t).take_while(|(x, y)| x == y).count();
    if common == 0 || common == t.len() { return None; }
    let mut parts: Vec<String> = vec!["..".to_string(); b.len() - common];
    parts.extend(t[common..].iter().map(|c| c.as_os_str().to_string_lossy().into_owned()));
    let sep = if like.contains('/') && !like.contains('\\') { "/" } else { "\\" };
    let path = parts.join(sep);
    let dotted = like.starts_with(".\\") || like.starts_with("./");
    Some(if dotted && parts[0] != ".." { format!(".{sep}{path}") } else { path })
}

/// Lexically resolve `.` and `..` (the file may not exist).
pub(crate) fn lexical(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => { out.pop(); }
            other => out.push(other),
        }
    }
    out
}

/// Inis that change the same parts (a TextureOverride's hash and match_first_index) with no match_priority to say
/// which wins. 3DMigoto runs both, so the variants draw over each other. Returns groups of ini indexes, each with
/// whether at least one of them draws without an `if` (inis that all check a condition are built to take turns).
fn overlaps(inis: &[ModIni]) -> Vec<(Vec<usize>, bool)> {
    let mut parts: Vec<HashSet<(String, String)>> = Vec::new();
    let mut plain: Vec<bool> = Vec::new();
    for m in inis {
        let mut set = HashSet::new();
        let mut uncond = false;
        if let Ok(ini) = &m.parsed {
            let has_if = |s: &Sec| s.lines.iter().any(|l| l.lkey == "if" || l.lkey.starts_with("if "));
            let by_name: HashMap<&str, &Sec> = ini.sections.iter().map(|s| (s.lower.as_str(), s)).collect();
            for s in ini.sections.iter().filter(|s| s.lower.starts_with("textureoverride")) {
                if s.first("match_priority").is_some() { continue; }
                let Some(hash) = s.get("hash").find_map(norm_hash) else { continue };
                let first = s.first("match_first_index").map(|v| v.trim().to_string()).unwrap_or_default();
                set.insert((hash, first));
                let runs_if = s.get("run").any(|r| by_name.get(r.trim().to_lowercase().as_str()).is_some_and(|c| has_if(c)));
                if !has_if(s) && !runs_if { uncond = true; }
            }
        }
        parts.push(set);
        plain.push(uncond);
    }
    let n = inis.len();
    let mut group: Vec<usize> = (0..n).collect();
    fn root(g: &mut [usize], i: usize) -> usize { let mut r = i; while g[r] != r { r = g[r]; } g[i] = r; r }
    for i in 0..n {
        for j in i + 1..n {
            let shared = parts[i].intersection(&parts[j]).count();
            if shared >= 2 && shared * 2 >= parts[i].len().min(parts[j].len()) {
                let (a, b) = (root(&mut group, i), root(&mut group, j));
                group[b] = a;
            }
        }
    }
    let mut by_root: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for i in 0..n { let r = root(&mut group, i); by_root.entry(r).or_default().push(i); }
    by_root.into_values().filter(|g| g.len() > 1).map(|g| { let u = g.iter().any(|&i| plain[i]); (g, u) }).collect()
}

/// "a.ini, b.ini, and 2 more": names joined with an Oxford comma, the first `max` of them.
pub(crate) fn oxford<S: AsRef<str>>(names: &[S], max: usize) -> String {
    let max = max.max(1);
    let shown: Vec<&str> = names.iter().take(if names.len() > max { max - 1 } else { max }).map(|s| s.as_ref()).collect();
    let rest = names.len() - shown.len();
    let mut parts: Vec<String> = shown.iter().map(|s| s.to_string()).collect();
    if rest > 0 { parts.push(format!("{rest} more")); }
    match parts.as_slice() {
        [] => String::new(),
        [a] => a.clone(),
        [a, b] => format!("{a} and {b}"),
        [init @ .., last] => format!("{}, and {last}", init.join(", ")),
    }
}

fn name_list(names: &[&str]) -> String { oxford(names, 3) }

/// Missing files of one kind from one ini, as one problem: "x.ini lists 3 files from ./Covered that aren't in the
/// mod folder: a.dds, b.dds, and c.dds". The folder is said once when they all share it.
fn missing_group(ini: &str, files: &[String], verb: &str, tail_one: &str, tail_many: &str) -> String {
    if let [f] = files { return format!("{ini} {verb} {f}, which isn't in the mod folder{tail_one}"); }
    let dir_of = |f: &str| f.rsplit_once('/').map(|(d, _)| d.to_string()).unwrap_or_default();
    let first = dir_of(&files[0]);
    let same_dir = !first.is_empty() && files.iter().all(|f| dir_of(f) == first);
    let names: Vec<String> = files.iter().map(|f| if same_dir { f.rsplit('/').next().unwrap_or(f).to_string() } else { f.clone() }).collect();
    let from = if same_dir { format!(" from {first}") } else { String::new() };
    format!("{ini} {verb} {} files{from} that aren't in the mod folder: {}{tail_many}", files.len(), oxford(&names, 12))
}

/// Sections the importer defines for every mod (ZZMI's `Core/ZZMI/main.ini` has `[CommandListSkinTexture]`),
/// lowercased. Found from the mod folder up: the first folder with a d3dx.ini is the importer's. Read once per
/// importer.
fn importer_sections(dir: &Path) -> std::sync::Arc<HashSet<String>> {
    use std::sync::{Arc, Mutex, OnceLock};
    static CACHE: OnceLock<Mutex<HashMap<PathBuf, Arc<HashSet<String>>>>> = OnceLock::new();
    let Some(root) = dir.ancestors().skip(1).find(|a| a.join("d3dx.ini").is_file()) else { return Arc::default() };
    let cache = CACHE.get_or_init(Default::default);
    if let Some(s) = cache.lock().ok().and_then(|c| c.get(root).cloned()) { return s; }
    let mut set = HashSet::new();
    let files = std::iter::once(root.join("d3dx.ini")).chain(
        walkdir::WalkDir::new(root.join("Core")).max_depth(3).into_iter().flatten()
            .filter(|e| e.file_type().is_file() && e.path().extension().is_some_and(|x| x.eq_ignore_ascii_case("ini")))
            .map(|e| e.into_path()));
    for f in files {
        let Ok(bytes) = std::fs::read(&f) else { continue };
        for l in String::from_utf8_lossy(&bytes).lines() {
            let l = l.trim();
            if let Some(name) = l.strip_prefix('[').and_then(|r| r.strip_suffix(']')) { set.insert(name.trim().to_lowercase()); }
        }
    }
    let set = Arc::new(set);
    if let Ok(mut c) = cache.lock() { c.insert(root.to_path_buf(), set.clone()); }
    set
}

// ── shared libraries and global triggers (the checks XXMI Launcher runs on every start) ──

/// The `namespace =` line above the first section, as written.
pub(crate) fn namespace_of(ini: &Ini) -> Option<String> {
    ini.sections.first().filter(|s| s.name.is_empty())?.lines.iter().find(|l| l.lkey == "namespace")
        .and_then(|l| l.value.as_deref()).map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

/// A namespace for comparing: lowercase, backslashes, no slash at either end ("Global/ORFix" -> "global\orfix").
fn norm_ns(ns: &str) -> String { ns.trim().replace('/', "\\").trim_matches('\\').to_lowercase() }

/// A library ini the loader ships (`Core\GIMI\Libraries\ORFix\ORFix.ini`).
#[derive(Debug, Clone)]
struct LibIni { ns: String, name: String, folder: String }

/// What lint needs from outside the mod: the loader's folder (its shared libraries) and the Mods folder (namespaces
/// other mods define). Each is read once per check, and only when a mod needs it.
pub(crate) struct LintCtx {
    importer: Option<PathBuf>,
    mods: Option<PathBuf>,
    /// The game is Genshin, the only one with the ORFix call to check for.
    genshin: bool,
    libs: std::cell::OnceCell<Vec<LibIni>>,
    known: std::cell::OnceCell<HashSet<String>>,
}

impl LintCtx {
    pub(crate) fn new(importer: Option<PathBuf>, mods: Option<PathBuf>, genshin: bool) -> Self {
        LintCtx { importer, mods, genshin, libs: Default::default(), known: Default::default() }
    }

    /// From the mod folder up: the first folder with a d3dx.ini is the loader's, with Mods next to it. Genshin.
    #[cfg(test)]
    fn near(dir: &Path) -> Self {
        let root = dir.ancestors().skip(1).find(|a| a.join("d3dx.ini").is_file()).map(Path::to_path_buf);
        let mods = root.as_ref().map(|r| r.join("Mods"));
        Self::new(root, mods, true)
    }

    /// The game's loader and Mods folder from the library's settings.
    fn of_game(db: &Db, game: &str) -> Self {
        Self::new(crate::games::importer_dir(db, game).ok(), crate::games::mods_dir(db, game).ok(), game == "gi")
    }

    /// Libraries in `Core\<importer>\Libraries` (XXMI ships RabbitFX, ORFix, SlotFix and others there).
    fn libs(&self) -> &[LibIni] {
        self.libs.get_or_init(|| {
            let Some(root) = &self.importer else { return Vec::new() };
            let mut out = Vec::new();
            for core in std::fs::read_dir(root.join("Core")).into_iter().flatten().flatten().filter(|e| e.path().is_dir()) {
                let libs = core.path().join("Libraries");
                if !libs.is_dir() { continue; }
                let folder = format!("Core\\{}\\Libraries", core.file_name().to_string_lossy());
                for (abs, _) in mod_inis(&libs) {
                    let Some(ns) = cached_facts(&abs).and_then(|f| f.namespace.clone()) else { continue };
                    let name = abs.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
                    out.push(LibIni { ns: norm_ns(&ns), name, folder: folder.clone() });
                }
            }
            out
        })
    }

    /// Every namespace that loads: the loader's own inis and every mod that is on.
    fn known(&self) -> &HashSet<String> {
        self.known.get_or_init(|| {
            let mut set: HashSet<String> = HashSet::new();
            let dirs = self.importer.iter().map(|r| r.join("Core")).chain(self.mods.iter().cloned());
            for d in dirs {
                for (abs, _) in mod_inis(&d) {
                    if let Some(ns) = cached_facts(&abs).and_then(|f| f.namespace.clone()) { set.insert(norm_ns(&ns)); }
                }
            }
            set
        })
    }
}

/// Namespaces an ini reaches into (`run = CommandList\global\ORFix\ORFix`, `Resource\RabbitFX\Mask`,
/// `$\SlotFix\active`): (namespace as written, the reference). Path namespaces (`$\mods\x\a.ini\var`) are left out.
fn namespace_refs(ini: &Ini) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    for l in ini.sections.iter().flat_map(|s| &s.lines) {
        let texts = [Some(l.lkey.as_str()), l.value.as_deref()];
        for tok in texts.into_iter().flatten().flat_map(|t| t.split(|c: char| c.is_whitespace() || "=,()!&|<>+*/;\"".contains(c))) {
            let lower = tok.to_ascii_lowercase();
            let rest = if let Some(r) = tok.strip_prefix("$\\") { r } else if ["commandlist\\", "resource\\", "customshader\\"].iter().any(|p| lower.starts_with(p)) {
                tok.split_once('\\').map(|(_, r)| r).unwrap_or("")
            } else { continue };
            let Some((ns, name)) = rest.rsplit_once('\\') else { continue };
            if ns.is_empty() || name.is_empty() || ns.to_ascii_lowercase().contains(".ini") { continue; }
            if !out.iter().any(|(n, _)| norm_ns(n) == norm_ns(ns)) { out.push((ns.to_string(), tok.to_string())); }
        }
    }
    out
}

/// `[ShaderRegex*]` sections with no `.pattern` that run CheckTextureOverride, themselves or in a command list they
/// run (XXMI Launcher's "global trigger"): (section as written, slots).
fn global_triggers(ini: &Ini) -> Vec<(String, Vec<String>)> {
    let by_name: HashMap<&str, &Sec> = ini.sections.iter().map(|s| (s.lower.as_str(), s)).collect();
    let mut out = Vec::new();
    for s in ini.sections.iter().filter(|s| s.lower.starts_with("shaderregex")) {
        if by_name.contains_key(format!("{}.pattern", s.lower).as_str()) { continue; }
        let mut slots: Vec<String> = Vec::new();
        let runs = s.get("run").filter_map(|r| by_name.get(r.trim().to_lowercase().as_str()).copied());
        for sec in std::iter::once(s).chain(runs) {
            for v in sec.get("checktextureoverride").map(|v| v.trim().to_lowercase()).filter(|v| !v.is_empty()) {
                if !slots.contains(&v) { slots.push(v); }
            }
        }
        if !slots.is_empty() { out.push((s.name.clone(), slots)); }
    }
    out
}

/// Problems from the loader's point of view: a copy of a library it already loads, a library the mod needs that
/// isn't there, and global triggers.
fn lint_libraries(dir: &Path, inis: &[ModIni], ctx: &LintCtx, out: &mut Vec<Problem>) {
    let own: HashSet<String> = inis.iter().filter_map(|m| m.parsed.as_ref().ok()).filter_map(namespace_of).map(|n| norm_ns(&n)).collect();
    for m in inis {
        let Ok(ini) = &m.parsed else { continue };
        if let Some(ns) = namespace_of(ini) {
            let key = norm_ns(&ns);
            let shipped = ctx.libs().iter().find(|l| l.ns == key);
            // a library mod that lives in the loader's own folder is the library itself
            if let Some(lib) = shipped.filter(|_| ctx.importer.as_ref().is_none_or(|r| !dir.starts_with(r.join("Core")))) {
                let mut p = problem("duplicate_library", "bad", Some(&m.rel), format!(
                    "{} is a copy of {}, which the loader already loads from {}. Two copies of a library break the mods that use it. Turn this copy off",
                    m.rel, lib.name, lib.folder));
                p.fix = Some(ProblemFix { kind: "off".into(), ini: Some(m.rel.clone()), from: None, to: None, inis: vec![m.rel.clone()] });
                out.push(p);
            }
        }
        if ctx.importer.is_some() {
            for (ns, reference) in namespace_refs(ini) {
                let key = norm_ns(&ns);
                if own.contains(&key) || ctx.known().contains(&key) { continue; }
                let name = ns.rsplit('\\').next().unwrap_or(&ns);
                out.push(problem("missing_library", "warn", Some(&m.rel), format!(
                    "{} uses {name} ({reference}), which isn't installed, so that step is skipped. {name} is a shared library or another mod",
                    m.rel)));
            }
        }
        let triggers = global_triggers(ini);
        if !triggers.is_empty() {
            let sections: Vec<String> = triggers.iter().map(|(s, _)| format!("[{s}]")).collect();
            let mut slots: Vec<String> = Vec::new();
            for s in triggers.iter().flat_map(|(_, s)| s) { if !slots.contains(s) { slots.push(s.clone()); } }
            out.push(problem("global_trigger", "warn", Some(&m.rel), format!(
                "{} in {} runs CheckTextureOverride on {} for every matching shader in the game, which costs FPS everywhere, not only while this mod's model is on screen",
                oxford(&sections, 4), m.rel, oxford(&slots, 4))));
        }
    }
}

// ── a character mod that never calls ORFix ──

/// `s` starts with `prefix`, ignoring ASCII case. No allocation.
fn starts_with_ci(s: &str, prefix: &str) -> bool {
    s.len() >= prefix.len() && s.as_bytes()[..prefix.len()].eq_ignore_ascii_case(prefix.as_bytes())
}

/// `s` holds `part`, ignoring ASCII case. No allocation.
fn contains_ci(s: &str, part: &str) -> bool {
    s.len() >= part.len() && s.as_bytes().windows(part.len()).any(|w| w.eq_ignore_ascii_case(part.as_bytes()))
}

/// A part of a character that sets textures by slot and needs an ORFix call.
#[derive(Debug, Clone, PartialEq)]
struct OrfixPart {
    /// The section as written ("TextureOverrideYelanBody").
    name: String,
    /// Diffuse and light map only: the call is NNFix. Otherwise the part has a normal map too and the call is ORFix.
    two_slot: bool,
    /// Lines (0-based) the call goes after: the last texture binding of each group of bindings. A part with
    /// bindings in several `if` branches has one group per branch.
    after: Vec<usize>,
}

/// The call line a part needs.
fn orfix_call(two_slot: bool) -> &'static str {
    if two_slot { "run = CommandList\\global\\ORFix\\NNFix" } else { "run = CommandList\\global\\ORFix\\ORFix" }
}

/// Which of `ps-t0`, `ps-t1` and `ps-t2` a line binds (0, 1 or 2), and whether it binds a resource of the mod
/// (`ResourceBodyDiffuse`, with or without `ref`) and not a shadow or a copy of another slot.
fn slot_binding(key: &str, value: &str) -> Option<(u8, bool)> {
    let k = key.as_bytes();
    if k.len() != 5 || !k[..4].eq_ignore_ascii_case(b"ps-t") || !matches!(k[4], b'0'..=b'2') { return None; }
    let mut v = value.trim();
    if v.len() > 3 && v.as_bytes()[..3].eq_ignore_ascii_case(b"ref") && v.as_bytes()[3].is_ascii_whitespace() {
        v = v[4..].trim_start();
    }
    Some((k[4] - b'0', starts_with_ci(v, "resource") && !contains_ci(v, "shadow")))
}

/// `if`, `elif`, `else` and `endif` lines end a group of bindings.
fn is_flow_line(t: &str) -> bool {
    let word = t.split(|c: char| !c.is_ascii_alphabetic()).next().unwrap_or("");
    ["if", "elif", "else", "endif"].iter().any(|w| word.eq_ignore_ascii_case(w))
}

/// The section being read by `orfix_parts`.
struct OpenPart { name: String, slots: u8, other: bool, after: Vec<usize>, last: Option<usize> }

impl OpenPart {
    fn finish(mut self, character: bool) -> Option<OrfixPart> {
        if let Some(l) = self.last.take() { self.after.push(l); }
        // a slot bound to something that isn't a resource is the author doing their own thing
        if self.other { return None; }
        let two_slot = match self.slots { 0b111 => false, 0b011 if character => true, _ => return None };
        Some(OrfixPart { name: self.name, two_slot, after: self.after })
    }
}

/// The parts in one ini's lines that need an ORFix call: a `[TextureOverride*]` or `[CommandList*]` section that isn't
/// a face and binds `ps-t0`, `ps-t1` and `ps-t2` to resources (three slots: ORFix), or only `ps-t0` and `ps-t1`
/// (two slots: NNFix, and only for a character mod, since a weapon or an item with two slots is normal). Lint and the
/// fix both read the lines with this, so they always agree.
fn orfix_parts<'a>(lines: impl Iterator<Item = &'a str>, character: bool) -> Vec<OrfixPart> {
    let mut out = Vec::new();
    let mut cur: Option<OpenPart> = None;
    for (i, line) in lines.enumerate() {
        if let Some(name) = crate::keys::header_name(line) {
            out.extend(cur.take().and_then(|o| o.finish(character)));
            if (starts_with_ci(name, "textureoverride") || starts_with_ci(name, "commandlist")) && !contains_ci(name, "face") {
                cur = Some(OpenPart { name: name.to_string(), slots: 0, other: false, after: Vec::new(), last: None });
            }
            continue;
        }
        let Some(o) = cur.as_mut() else { continue };
        let t = line.trim();
        if t.is_empty() || t.starts_with(';') { continue; }
        if is_flow_line(t) {
            if let Some(l) = o.last.take() { o.after.push(l); }
            continue;
        }
        let Some((k, v)) = t.split_once('=') else { continue };
        match slot_binding(k.trim(), v) {
            Some((slot, true)) => { o.slots |= 1 << slot; o.last = Some(i); }
            Some((_, false)) => o.other = true,
            None => {}
        }
    }
    out.extend(cur.take().and_then(|o| o.finish(character)));
    out
}

/// Whether a `run` value names a command list under the ORFix library (`CommandList\global\ORFix\NNFix`), cut at a `;`.
fn runs_orfix(value: &str) -> bool {
    let v = value.split(';').next().unwrap_or("");
    if !contains_ci(v, "orfix") { return false; }
    let v = v.trim().replace('/', "\\").to_ascii_lowercase();
    let v = v.strip_prefix("commandlist\\").unwrap_or(&v);
    v.starts_with("global\\orfix\\")
}

/// Whether anything in the mod calls ORFix: a `run` line to the ORFix library, or any use of the GIMI API
/// (`run = CommandList\GIMI\SetTextures`), which runs ORFix itself.
fn calls_orfix(inis: &[ModIni]) -> bool {
    inis.iter().filter_map(|m| m.parsed.as_ref().ok().map(|ini| (m, ini))).any(|(m, ini)| {
        ini.sections.iter().flat_map(|s| &s.lines).any(|l| l.lkey == "run" && l.value.as_deref().is_some_and(runs_orfix))
            || (contains_ci(&m.text, "gimi") && namespace_refs(ini).iter().any(|(ns, _)| {
                let n = norm_ns(ns);
                n == "gimi" || n.starts_with("gimi\\")
            }))
    })
}

/// Where a Genshin character mod lacks the ORFix call: each ini (the index in `inis`) with the parts that need one.
/// Empty when the game isn't Genshin, the loader has no ORFix library (the call would point nowhere), the mod is the
/// loader's own or ships a library, an ini couldn't be read (it may hold the call), or anything in the mod already
/// calls ORFix. Mod-wide on purpose: a face or a dress with no normal map leaves the call out, so one call anywhere
/// means the author handled it. Cheapest checks first: this runs for every mod on every check.
fn orfix_work(dir: &Path, inis: &[ModIni], ctx: &LintCtx, character: bool) -> Vec<(usize, Vec<OrfixPart>)> {
    if !ctx.genshin { return Vec::new(); }
    let Some(root) = &ctx.importer else { return Vec::new() };
    if !ctx.libs().iter().any(|l| l.ns == "global\\orfix") || dir.starts_with(root.join("Core")) { return Vec::new(); }
    if inis.iter().any(|m| m.parsed.is_err()) { return Vec::new(); }
    let library = inis.iter().filter_map(|m| m.parsed.as_ref().ok()).filter_map(namespace_of).any(|n| norm_ns(&n).starts_with("global\\"));
    if library || calls_orfix(inis) { return Vec::new(); }
    inis.iter().enumerate().filter_map(|(i, m)| {
        let parts = orfix_parts(m.text.split('\n'), character);
        (!parts.is_empty()).then_some((i, parts))
    }).collect()
}

/// A Genshin character mod whose parts set their textures by slot while nothing in the mod calls ORFix: outlines and
/// reflections come out in the wrong colors in game. The fix adds the call.
fn lint_orfix(dir: &Path, inis: &[ModIni], ctx: &LintCtx, character: bool, out: &mut Vec<Problem>) {
    let work = orfix_work(dir, inis, ctx, character);
    if work.is_empty() { return; }
    let rels: Vec<String> = work.iter().map(|(i, _)| inis[*i].rel.clone()).collect();
    let mut parts: Vec<&str> = Vec::new();
    for name in work.iter().flat_map(|(_, p)| p.iter().map(|x| x.name.as_str())) {
        if !parts.contains(&name) { parts.push(name); }
    }
    let (verb, shown) = if rels.len() == 1 { ("sets", rels[0].clone()) } else { ("set", oxford(&rels, 3)) };
    let detail = format!(
        "{shown} {verb} the textures of {} by slot, and nothing in the mod calls ORFix. Outlines and reflections can show the wrong colors in game. Adding the call fixes it",
        oxford(&parts, 3));
    let first = rels[0].clone();
    let mut p = problem("missing_orfix", "warn", Some(&first), detail);
    p.fix = Some(ProblemFix { kind: "orfix".into(), ini: Some(first), from: None, to: None, inis: rels });
    out.push(p);
}

/// One ini with the ORFix calls added.
#[derive(Debug)]
struct OrfixEdit { rel: String, abs: PathBuf, old: Vec<u8>, new: Vec<u8> }

/// The inis of `wanted` (paths inside the mod) with the missing calls added: a line right after the last texture
/// binding of each group, indented like it. Line endings, encoding and every other line stay as they were. Empty
/// when the mod needs nothing (the call is there now, or the files changed). Reads only, so a failure leaves every
/// file untouched.
fn orfix_edits(dir: &Path, inis: &[ModIni], ctx: &LintCtx, character: bool, wanted: &[String]) -> Result<Vec<OrfixEdit>> {
    let mut out = Vec::new();
    for (i, _) in orfix_work(dir, inis, ctx, character) {
        let m = &inis[i];
        if !wanted.iter().any(|w| w.replace('\\', "/").eq_ignore_ascii_case(&m.rel)) { continue; }
        let old = std::fs::read(&m.abs).map_err(|e| Error::Invalid(format!("Couldn't read {}: {}", m.rel, crate::error::io_text(&e))))?;
        let mut doc = crate::keys::Doc::from_bytes(&old);
        if doc.to_bytes() != old {
            return Err(Error::Invalid(format!("{} has text gachamod can't keep exactly, so it left the file alone", m.rel)));
        }
        let mut calls: Vec<(usize, bool)> = orfix_parts(doc.lines.iter().map(String::as_str), character)
            .into_iter().flat_map(|p| p.after.into_iter().map(move |a| (a, p.two_slot))).collect();
        if calls.is_empty() { continue; }
        // from the bottom up, so the lines above keep their numbers
        calls.sort_by(|a, b| b.0.cmp(&a.0));
        for (at, two_slot) in calls {
            let indent: String = doc.lines[at].chars().take_while(|c| c.is_whitespace()).collect();
            doc.insert(at + 1, format!("{indent}{}", orfix_call(two_slot)));
        }
        out.push(OrfixEdit { rel: m.rel.clone(), abs: m.abs.clone(), old, new: doc.to_bytes() });
    }
    Ok(out)
}

/// Write the edits, each through a temporary file. When one fails the ones already written go back as they were.
fn write_orfix_edits(edits: &[OrfixEdit]) -> Result<()> {
    for (n, e) in edits.iter().enumerate() {
        if let Err(err) = crate::xxmi::write_atomic(&e.abs, &e.new) {
            for done in &edits[..n] { let _ = crate::xxmi::write_atomic(&done.abs, &done.old); }
            return Err(Error::Invalid(format!("Couldn't write {}: {}", e.rel, err)));
        }
    }
    Ok(())
}

/// Everything that looks wrong in one mod's files, worst first, each with a fix when gachamod found one. `dir` is
/// the mod folder; the loader and Mods folder are found from it.
#[cfg(test)]
fn lint_mod(dir: &Path, inis: &[ModIni]) -> Vec<Problem> { lint_mod_ctx(dir, inis, &LintCtx::near(dir), false) }

/// `character`: the mod is for a character (not a weapon or an item), so a part with two texture slots is judged too.
fn lint_mod_ctx(dir: &Path, inis: &[ModIni], ctx: &LintCtx, character: bool) -> Vec<Problem> {
    let mut out = Vec::new();
    if inis.is_empty() {
        // inis that are only turned off mean the mod (or each of its variants) is off, which is the user's choice
        if !any_ini_file(dir) {
            out.push(problem("no_ini", "bad", None, "This mod has no .ini file, so the game loads nothing from it".into()));
        }
        return out;
    }
    let used = used_resources(inis);
    let all_sections: HashSet<&str> = inis.iter().filter_map(|m| m.parsed.as_ref().ok()).flat_map(|i| i.sections.iter().map(|s| s.lower.as_str())).collect();
    let mut core: Option<std::sync::Arc<HashSet<String>>> = None;
    let mut files: Option<HashMap<String, Vec<PathBuf>>> = None;
    let mut empty: Vec<&str> = Vec::new();
    let mut loads = false;
    for m in inis {
        let ini = match &m.parsed {
            Ok(i) => i,
            Err(e) => {
                // 3DMigoto reads big files fine; gachamod just didn't
                let big = std::fs::metadata(&m.abs).is_ok_and(|md| md.len() > FULL_MAX);
                if big { loads = true; }
                out.push(problem("bad_ini", if big { "info" } else { "bad" }, Some(&m.rel), if big { format!("gachamod didn't check {}: {e}", m.rel) } else { e.clone() }));
                continue;
            }
        };
        if ini.sections.iter().all(|s| s.lines.is_empty()) { empty.push(&m.rel); continue; }
        loads = true;
        let base = m.abs.parent().unwrap_or(dir);
        let mut missing: Vec<(String, &str)> = Vec::new();
        let mut no_key: Vec<String> = Vec::new();
        let mut no_run: Vec<String> = Vec::new();
        for s in &ini.sections {
            if s.lower.starts_with("resource") {
                for f in s.get("filename") {
                    let f = f.trim().trim_matches('"');
                    if f.is_empty() { continue; }
                    let ok = if Path::new(f).is_absolute() { Path::new(f).exists() } else { exists_ci(base, f) };
                    if !ok && !missing.iter().any(|(x, _)| x.eq_ignore_ascii_case(f)) { missing.push((f.to_string(), s.lower.as_str())); }
                }
            }
            if s.lower.starts_with("key") && !s.get("key").any(|k| !k.trim().is_empty()) {
                no_key.push(format!("[{}]", s.name));
            }
            for run in s.get("run") {
                let r = run.trim();
                let lower = r.to_lowercase();
                if lower.starts_with("commandlist") && !r.contains('\\') && !all_sections.contains(lower.as_str())
                    && !core.get_or_insert_with(|| importer_sections(dir)).contains(&lower) {
                    let name = format!("[{r}]");
                    if !no_run.contains(&name) { no_run.push(name); }
                }
            }
        }
        // one problem per kind of missing file, except ones with a fix of their own. A missing file is at most a
        // warning: authors often leave lines for textures they didn't ship and the mod still shows fine
        let mut groups: BTreeMap<u8, Vec<String>> = BTreeMap::new();
        for (f, section) in &missing {
            let shown_f = f.replace('\\', "/");
            let name = Path::new(&shown_f).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            let kind: u8 = if !used.contains(*section) { 2 } else if name.to_lowercase().contains("remap") { 1 } else { 0 };
            if kind < 2 {
                let index = files.get_or_insert_with(|| files_by_name(dir));
                let found = index.get(&name.to_lowercase()).map(Vec::as_slice).unwrap_or(&[]);
                if let Some(to) = pick_copy(f, found).and_then(|c| path_from(base, &c, f)) {
                    let (severity, detail) = if kind == 1 {
                        ("warn", format!("{} needs {shown_f}, which isn't in the mod folder. Only the remap for another model of the character (a skin, or the Raiden boss) uses it", m.rel))
                    } else {
                        ("warn", format!("{} needs {shown_f}, which isn't in the mod folder", m.rel))
                    };
                    let mut p = problem("missing_file", severity, Some(&m.rel), detail);
                    p.fix = Some(ProblemFix { kind: "point".into(), ini: Some(m.rel.clone()), from: Some(f.clone()), to: Some(to), inis: vec![] });
                    out.push(p);
                    continue;
                }
            }
            groups.entry(kind).or_default().push(shown_f);
        }
        for (kind, list) in groups {
            let (severity, detail) = match kind {
                2 => ("info", missing_group(&m.rel, &list, "lists",
                    ". Nothing uses it, so the game never loads it", ". Nothing uses them, so the game never loads them")),
                1 => ("warn", missing_group(&m.rel, &list, "needs",
                    ". Only the remap for another model of the character (a skin, or the Raiden boss) uses it",
                    ". Only the remap for another model of the character (a skin, or the Raiden boss) uses them")),
                _ => ("warn", missing_group(&m.rel, &list, "needs", "", "")),
            };
            out.push(problem("missing_file", severity, Some(&m.rel), detail));
        }
        if !no_key.is_empty() {
            out.push(problem("no_key", "info", Some(&m.rel), if no_key.len() == 1 {
                format!("{} in {} has no key line, so it does nothing", no_key[0], m.rel)
            } else {
                format!("{} in {} have no key line, so they do nothing", oxford(&no_key, 10), m.rel)
            }));
        }
        if !no_run.is_empty() {
            out.push(problem("missing_section", "warn", Some(&m.rel), if no_run.len() == 1 {
                format!("{} runs {}, which isn't in the mod. That step is skipped", m.rel, no_run[0])
            } else {
                format!("{} runs {}, which aren't in the mod. Those steps are skipped", m.rel, oxford(&no_run, 10))
            }));
        }
    }
    if !empty.is_empty() {
        let verb = if empty.len() == 1 { "is" } else { "are" };
        let list = oxford(&empty, 8);
        let (severity, detail) = if loads {
            ("info", format!("{list} {verb} empty. The mod's other inis still load"))
        } else {
            ("bad", format!("{list} {verb} empty, so the game loads nothing from this mod"))
        };
        out.push(problem("bad_ini", severity, Some(empty[0]), detail));
    }
    lint_libraries(dir, inis, ctx, &mut out);
    lint_orfix(dir, inis, ctx, character, &mut out);
    for (group, plain) in overlaps(inis) {
        if !plain { continue; }
        let names: Vec<&str> = group.iter().map(|&i| inis[i].rel.as_str()).collect();
        let mut p = problem("overlap", "bad", Some(names[0]),
            format!("{} change the same parts of the model, so they draw over each other in game. Keep one of them on", name_list(&names)));
        p.fix = Some(ProblemFix { kind: "keep".into(), ini: Some(names[0].to_string()), from: None, to: None, inis: names.iter().map(|s| s.to_string()).collect() });
        out.push(p);
    }
    out.sort_by_key(|p| severity_rank(&p.severity));
    out
}

/// Make a fix that `lint` offered. Returns the backup that undoes it.
pub fn apply_fix(db: &Db, game: &str, id: &str, fix: &ProblemFix) -> Result<crate::backups::Backup> {
    let m = library::get(db, game, id)?;
    let dir = PathBuf::from(&m.path);
    if !dir.is_dir() { return Err(Error::Invalid(format!("{}'s folder isn't there any more. Rescan to update the list", m.name))); }
    let changed = || Error::Invalid(format!("{} changed since the last check. Check again", m.name));
    let ini = fix.ini.as_deref().ok_or_else(changed)?.replace('\\', "/");
    let ini_abs = crate::backups::inside(&dir, &ini)?;
    if !ini_abs.is_file() { return Err(changed()); }
    let backup = match fix.kind.as_str() {
        "point" => {
            let (Some(from), Some(to)) = (fix.from.as_deref(), fix.to.as_deref()) else { return Err(changed()) };
            let base = ini_abs.parent().unwrap_or(&dir);
            if !lexical(&base.join(to.replace('\\', "/"))).starts_with(&dir) {
                return Err(Error::Invalid(format!("Not a path inside the mod: {to}")));
            }
            if !exists_ci(base, to) { return Err(changed()); }
            let raw = std::fs::read(&ini_abs)?;
            let mut doc = crate::keys::Doc::from_bytes(&raw);
            let mut in_resource = false;
            let mut hits = 0;
            for line in doc.lines.iter_mut() {
                if let Some(h) = crate::keys::header_name(line) { in_resource = h.to_lowercase().starts_with("resource"); continue; }
                if !in_resource { continue; }
                let Some((k, v)) = crate::keys::kv(line) else { continue };
                if k != "filename" || !v.trim_matches('"').eq_ignore_ascii_case(from) { continue; }
                let value = if v.starts_with('"') { format!("\"{to}\"") } else { to.to_string() };
                *line = crate::keys::with_value(line, &value);
                hits += 1;
            }
            if hits == 0 { return Err(changed()); }
            let label = format!("{ini} now uses {}", to.replace('\\', "/").trim_start_matches("./"));
            let b = crate::backups::take(db, game, &m.id, &dir, std::slice::from_ref(&ini), &label)?;
            std::fs::write(&ini_abs, doc.to_bytes())?;
            b
        }
        "keep" | "off" => {
            if !fix.inis.iter().any(|i| i.replace('\\', "/").eq_ignore_ascii_case(&ini)) { return Err(changed()); }
            // "keep" turns off every other ini, "off" only `ini`
            let off_one = fix.kind == "off";
            let mut moves: Vec<(PathBuf, PathBuf, String, String)> = Vec::new();
            for other in fix.inis.iter().map(|i| i.replace('\\', "/")).filter(|i| i.eq_ignore_ascii_case(&ini) == off_one) {
                let abs = crate::backups::inside(&dir, &other)?;
                let (Some(parent), Some(name)) = (abs.parent(), abs.file_name().map(|n| n.to_string_lossy().into_owned())) else { continue };
                if !abs.is_file() { continue; }
                let mut new_name = format!("DISABLED_{name}");
                let mut n = 2;
                while parent.join(&new_name).exists() { new_name = format!("DISABLED{n}_{name}"); n += 1; }
                let new_rel = match other.rsplit_once('/') { Some((d, _)) => format!("{d}/{new_name}"), None => new_name.clone() };
                moves.push((abs.clone(), parent.join(&new_name), other, new_rel));
            }
            if moves.is_empty() { return Err(changed()); }
            let files: Vec<String> = moves.iter().flat_map(|(_, _, a, b)| [a.clone(), b.clone()]).collect();
            let off = if moves.len() == 1 { moves[0].2.clone() } else { format!("{} others", moves.len()) };
            let label = if off_one { format!("Turned off {ini}") } else { format!("Kept {ini} on and turned off {off}") };
            let b = crate::backups::take(db, game, &m.id, &dir, &files, &label)?;
            for (from, to, ..) in &moves { rename_retry(from, to)?; }
            b
        }
        "orfix" => {
            let edits = orfix_edits(&dir, &read_mod(&dir), &LintCtx::of_game(db, game), m.character.is_some(), &fix.inis)?;
            // nothing to add: the call is there already (a second click, or added by hand since the check)
            if edits.is_empty() { return Err(changed()); }
            let files: Vec<String> = edits.iter().map(|e| e.rel.clone()).collect();
            let label = if let [one] = files.as_slice() { format!("Added the ORFix call to {one}") } else { format!("Added the ORFix call to {} inis", files.len()) };
            let b = crate::backups::take(db, game, &m.id, &dir, &files, &label)?;
            write_orfix_edits(&edits)?;
            b
        }
        _ => return Err(Error::Invalid("gachamod doesn't know that fix. Check again".into())),
    };
    if m.loaded() { crate::devtools::mark_changed(game); }
    Ok(backup)
}

/// Declared global variables of one ini: (name, persist, default).
fn declared_vars(ini: &Ini) -> Vec<(String, bool, Option<String>)> {
    let mut out = Vec::new();
    for s in ini.sections.iter().filter(|s| s.lower == "constants") {
        for l in &s.lines {
            let toks: Vec<&str> = l.lkey.split_whitespace().collect();
            let Some((last, flags)) = toks.split_last() else { continue };
            let Some(name) = last.strip_prefix('$') else { continue };
            if name.is_empty() || name.contains('\\') || flags.is_empty() || !flags.iter().all(|f| matches!(*f, "global" | "persist" | "local")) { continue; }
            if !flags.contains(&"global") && !flags.contains(&"persist") { continue; }
            let default = Some(l.value.as_deref().map(norm_value).unwrap_or_else(|| "0".into()));
            out.push((name.to_string(), flags.contains(&"persist"), default));
        }
    }
    out
}

fn key_bindings(rel: &str, ini: &Ini) -> Vec<KeyBinding> {
    let mut out = Vec::new();
    for s in ini.sections.iter().filter(|s| s.lower.starts_with("key")) {
        let keys: Vec<String> = s.get("key").map(|k| k.trim().to_string()).filter(|k| !k.is_empty()).collect();
        if keys.is_empty() { continue; }
        let labels: Vec<String> = keys.iter().map(|k| binding_label(k)).collect();
        let vars = s.lines.iter().filter_map(|l| {
            let name = l.lkey.strip_prefix('$')?;
            if name.is_empty() || name.contains('\\') || name.contains(' ') { return None; }
            let values = l.value.as_deref()?.split(',').map(str::trim).filter(|v| !v.is_empty()).map(norm_value).collect();
            Some(KeyVar { var: name.to_string(), values })
        }).collect();
        let kind = s.first("type").map(|t| t.trim().to_lowercase()).filter(|t| matches!(t.as_str(), "cycle" | "toggle" | "hold" | "activate")).unwrap_or_else(|| "activate".into());
        out.push(KeyBinding {
            ini: rel.to_string(), section: s.name.clone(), key: keys[0].clone(), label: labels[0].clone(),
            back: s.first("back").map(str::trim).filter(|b| !b.is_empty()).map(binding_label),
            kind, vars, condition: s.first("condition").map(|c| c.trim().to_string()).filter(|c| !c.is_empty()),
            keys, labels,
        });
    }
    out
}

/// Keys, options with their current values, and problems for one mod folder. `saved` are its saved values.
fn inspect_dir(dir: &Path, saved: &[VarValue], ctx: &LintCtx, character: bool) -> ModInspect {
    let inis = read_mod(dir);
    let mut out = ModInspect { inis: inis.iter().map(|m| m.rel.clone()).collect(), ..Default::default() };
    let mut hashes = BTreeSet::new();
    for m in &inis {
        let Ok(ini) = &m.parsed else { continue };
        let keys = key_bindings(&m.rel, ini);
        for (name, persist, default) in declared_vars(ini) {
            if !persist { continue; }
            let mut values: Vec<String> = Vec::new();
            let mut sections: Vec<&str> = Vec::new();
            for k in &keys {
                for kv in k.vars.iter().filter(|kv| kv.var == name) {
                    sections.push(&k.section);
                    for v in &kv.values { if !values.contains(v) { values.push(v.clone()); } }
                }
            }
            if let Some(d) = &default { if !values.contains(d) { values.insert(0, d.clone()); } }
            let current = saved.iter().find(|s| s.ini.eq_ignore_ascii_case(&m.rel) && s.var.eq_ignore_ascii_case(&name)).map(|s| norm_value(&s.value));
            if let Some(c) = &current { if !values.contains(c) { values.push(c.clone()); } }
            let switch = values.len() == 2 && values.iter().all(|v| v == "0" || v == "1");
            if values.iter().all(|v| v.parse::<f64>().is_ok()) {
                values.sort_by(|a, b| a.parse::<f64>().unwrap_or(0.0).total_cmp(&b.parse::<f64>().unwrap_or(0.0)));
            }
            let mut label = var_label(&name);
            if generic_label(&label) {
                if let Some(better) = sections.iter().map(|s| section_label(s)).find(|l| !generic_label(l)) { label = better; }
            }
            out.vars.push(VarInfo {
                ini: m.rel.clone(), var: name, persist, default, current, values, label,
                kind: if switch { "switch".into() } else { "list".into() }, names: BTreeMap::new(),
            });
        }
        out.keys.extend(keys);
        for s in ini.sections.iter().filter(|s| is_override(&s.lower)) { hashes.extend(s.get("hash").filter_map(norm_hash)); }
    }
    out.hash_count = hashes.len() as u32;
    // a merged mod's swap values show the variant names ("Swap: Raiden Kimono", not "Swap: 2")
    out.merged = crate::merged::info(dir);
    if let Some(mg) = &out.merged {
        for v in out.vars.iter_mut().filter(|v| v.ini.eq_ignore_ascii_case(&mg.ini) && v.var.eq_ignore_ascii_case(&mg.var)) {
            v.names = mg.variants.iter().map(|x| (x.value.clone(), x.name.clone())).collect();
        }
    }
    out.problems = lint_mod_ctx(dir, &inis, ctx, character);
    out.readmes = readmes(dir);
    out
}

/// Text files in the mod's root under 64 KB, with their first 8 KB.
fn readmes(dir: &Path) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = std::fs::read_dir(dir).into_iter().flatten().flatten().filter_map(|e| {
        let name = e.file_name().to_string_lossy().into_owned();
        let lower = name.to_lowercase();
        if !(lower.ends_with(".txt") || lower.ends_with(".md")) || library::is_disabled_name(&name) { return None; }
        let meta = e.metadata().ok()?;
        if !meta.is_file() || meta.len() > 64 * 1024 || meta.len() == 0 { return None; }
        let mut text = decode(&std::fs::read(e.path()).ok()?);
        if text.len() > 8 * 1024 {
            let mut cut = 8 * 1024;
            while !text.is_char_boundary(cut) { cut -= 1; }
            text.truncate(cut);
        }
        let text = text.replace("\r\n", "\n");
        (!text.trim().is_empty()).then_some((name, text))
    }).collect();
    out.sort_by_key(|(n, _)| n.to_lowercase());
    out
}

/// The mod list, or empty while the library isn't built (Todo).
fn mods_or_empty(db: &Db, game: &str) -> Result<Vec<crate::model::ModEntry>> {
    match library::list(db, game) {
        Ok(l) => Ok(l),
        Err(Error::Todo(_)) => Ok(Vec::new()),
        Err(e) => Err(e),
    }
}

/// Hash -> enabled mod indexes, for enabled mods only.
fn enabled_hashes(mods: &[crate::model::ModEntry]) -> (Vec<usize>, HashMap<String, Vec<usize>>) {
    let mut by_hash: HashMap<String, Vec<usize>> = HashMap::new();
    let mut on = Vec::new();
    for (i, m) in mods.iter().enumerate().filter(|(_, m)| m.enabled) {
        on.push(i);
        for h in quick_facts(Path::new(&m.path)).active { by_hash.entry(h).or_default().push(i); }
    }
    (on, by_hash)
}

/// Hashes this many enabled mods share are common buffers (UI, effects), not conflicts.
const COMMON_HASH: usize = 5;

pub fn inspect(db: &Db, game: &str, id: &str) -> Result<ModInspect> {
    let m = library::get(db, game, id)?;
    let dir = PathBuf::from(&m.path);
    if !dir.is_dir() { return Err(Error::Invalid(format!("{}'s folder isn't there any more. Rescan to update the list", m.name))); }
    let mut saved = library::saved_vars(db, game, id).unwrap_or_default();
    if saved.is_empty() && m.loaded() {
        if let Ok(imp) = crate::games::importer_dir(db, game) { saved = user_vars(&imp, &m.rel_path).unwrap_or_default(); }
    }
    let mut out = inspect_dir(&dir, &saved, &LintCtx::of_game(db, game), m.character.is_some());
    out.mod_id = m.id.clone();
    if m.enabled {
        let mods = mods_or_empty(db, game).unwrap_or_default();
        let mine: HashSet<String> = quick_facts(&dir).active.into_iter().collect();
        let (_, by_hash) = enabled_hashes(&mods);
        let ignored = ignored_pairs(db, game);
        // the same rules as the Conflict tag on the card (library::compute_conflicts)
        let live = crate::live::groups_by_mod(db, game);
        let my_group = live.get(&m.id);
        let mut shared: HashMap<usize, Vec<String>> = HashMap::new();
        for h in &mine {
            let Some(list) = by_hash.get(h) else { continue };
            if list.len() < 2 || list.len() >= COMMON_HASH { continue; }
            for &i in list {
                let same_group = my_group.is_some() && live.get(&mods[i].id) == my_group;
                if mods[i].id != m.id && !same_group && !ignored.contains(&pair_key(&m.id, &mods[i].id)) { shared.entry(i).or_default().push(h.clone()); }
            }
        }
        let parts = if shared.is_empty() { HashMap::new() } else { parts_by_hash(&dir) };
        let mut c: Vec<ConflictRef> = shared.into_iter().map(|(i, hs)| ConflictRef {
            mod_id: mods[i].id.clone(), name: mods[i].name.clone(), shared: hs.len() as u32, parts: part_names(&parts, &hs),
            hashes: { let mut v = hs.clone(); v.sort(); v },
        }).collect();
        c.sort_by(|a, b| b.shared.cmp(&a.shared).then_with(|| a.name.cmp(&b.name)));
        out.conflicts = c;
    }
    Ok(out)
}

/// Save one variable value for a mod in d3dx_user.ini. Refused while the game runs (it writes its own values when
/// it closes). A mod that is off keeps the value in gachamod's store until it is turned on.
pub fn set_var(db: &Db, game: &str, id: &str, value: &VarValue) -> Result<()> {
    let m = library::get(db, game, id)?;
    if crate::launch::running(game) {
        return Err(Error::Conflict("Close the game first. It overwrites saved options when it closes".into()));
    }
    let value = VarValue { ini: value.ini.replace('\\', "/"), var: value.var.trim_start_matches('$').to_lowercase(), value: norm_value(&value.value) };
    if m.loaded() {
        set_user_vars(&crate::games::importer_dir(db, game)?, &m.rel_path, std::slice::from_ref(&value))?;
    } else {
        let mut all = library::saved_vars(db, game, id).unwrap_or_default();
        all.retain(|v| !(v.ini.eq_ignore_ascii_case(&value.ini) && v.var.eq_ignore_ascii_case(&value.var)));
        all.push(value);
        library::stash_vars(db, game, id, &all)?;
    }
    crate::devtools::mark_changed(game);
    Ok(())
}

/// Group enabled mods by the hashes they share (each group is an exact set of mods with the hashes they all
/// override). Hashes five or more enabled mods share are left out.
// ── ignored conflicts ──

fn ignored_key(game: &str) -> String { format!("{game}.conflicts.ignored") }

/// Two mods as one ignore-list entry, the same whichever comes first.
pub(crate) fn pair_key(a: &str, b: &str) -> String { if a <= b { format!("{a}+{b}") } else { format!("{b}+{a}") } }

/// Pairs of mods whose conflict the user said to ignore.
pub(crate) fn ignored_pairs(db: &Db, game: &str) -> HashSet<String> {
    db.setting_json::<Vec<String>>(&ignored_key(game)).ok().flatten().unwrap_or_default().into_iter().collect()
}

/// Ignore the conflict between these mods (every pair of them), or stop ignoring it. The mods stay as they are.
pub fn ignore_conflict(db: &Db, game: &str, ids: &[String], on: bool) -> Result<()> {
    let mut set = ignored_pairs(db, game);
    for a in ids {
        for b in ids {
            if a == b { continue; }
            if on { set.insert(pair_key(a, b)); } else { set.remove(&pair_key(a, b)); }
        }
    }
    let mut list: Vec<String> = set.into_iter().collect();
    list.sort();
    db.set_setting_json(&ignored_key(game), &list)?;
    library::recount_conflicts(db, game);
    Ok(())
}

/// Take a conflict's shared parts out of one mod: each override section in its inis that changes one of `hashes`
/// is commented out with ";", so the other mod shows those parts and this one keeps the rest. A backup undoes it.
pub fn drop_overrides(db: &Db, game: &str, id: &str, hashes: &[String]) -> Result<crate::backups::Backup> {
    let m = library::get(db, game, id)?;
    let dir = PathBuf::from(&m.path);
    if !dir.is_dir() { return Err(Error::Invalid(format!("{}'s folder isn't there any more. Rescan to update the list", m.name))); }
    let want: HashSet<String> = hashes.iter().filter_map(|h| norm_hash(h)).collect();
    let mut edits: Vec<(PathBuf, String, Vec<u8>)> = Vec::new();
    let mut sections = 0;
    for (path, rel) in mod_inis(&dir) {
        let Ok(raw) = std::fs::read(&path) else { continue };
        let mut doc = crate::keys::Doc::from_bytes(&raw);
        let heads: Vec<(usize, String)> = doc.lines.iter().enumerate()
            .filter_map(|(i, l)| crate::keys::header_name(l).map(|n| (i, n.to_ascii_lowercase()))).collect();
        let mut hit = false;
        for (k, (start, name)) in heads.iter().enumerate() {
            if !is_override(name) { continue; }
            let end = heads.get(k + 1).map(|(i, _)| *i).unwrap_or(doc.lines.len());
            let shared = doc.lines[start + 1..end].iter()
                .any(|l| crate::keys::kv(l).is_some_and(|(key, v)| key == "hash" && norm_hash(v).is_some_and(|h| want.contains(&h))));
            if !shared { continue; }
            for line in &mut doc.lines[*start..end] {
                let t = line.trim_start();
                if !t.is_empty() && !t.starts_with(';') { *line = format!(";{line}"); }
            }
            hit = true;
            sections += 1;
        }
        if hit { edits.push((path, rel.replace('\\', "/"), doc.to_bytes())); }
    }
    if edits.is_empty() { return Err(Error::Invalid(format!("{} no longer changes those parts. Check again", m.name))); }
    let files: Vec<String> = edits.iter().map(|(_, rel, _)| rel.clone()).collect();
    let label = format!("Took {} out of {}", if sections == 1 { "1 shared part".to_string() } else { format!("{sections} shared parts") }, m.name);
    let backup = crate::backups::take(db, game, &m.id, &dir, &files, &label)?;
    for (path, _, bytes) in &edits { std::fs::write(path, bytes)?; }
    if m.loaded() { crate::devtools::mark_changed(game); }
    library::recount_conflicts(db, game);
    Ok(backup)
}

pub fn conflicts(db: &Db, game: &str) -> Result<Vec<ConflictGroup>> {
    let mods = mods_or_empty(db, game)?;
    let ignored = ignored_pairs(db, game);
    let (_, by_hash) = enabled_hashes(&mods);
    let mut groups: BTreeMap<Vec<usize>, Vec<String>> = BTreeMap::new();
    for (h, mut list) in by_hash {
        list.sort_unstable();
        list.dedup();
        if list.len() < 2 || list.len() >= COMMON_HASH { continue; }
        groups.entry(list).or_default().push(h);
    }
    // a mod is the first of many groups: its folder is walked once, not once per group
    let mut parts_of: HashMap<usize, HashMap<String, Vec<String>>> = HashMap::new();
    let mut out: Vec<ConflictGroup> = groups.into_iter().map(|(idx, mut hashes)| {
        hashes.sort();
        let n = hashes.len() as u32;
        let first = mods[idx[0]].character.clone();
        let character = first.filter(|c| idx.iter().all(|&i| mods[i].character.as_deref().is_some_and(|x| x.eq_ignore_ascii_case(c))));
        let parts = part_names(parts_of.entry(idx[0]).or_insert_with(|| parts_by_hash(Path::new(&mods[idx[0]].path))), &hashes);
        let all_ignored = idx.iter().all(|&a| idx.iter().all(|&b| a == b || ignored.contains(&pair_key(&mods[a].id, &mods[b].id))));
        ConflictGroup {
            mods: idx.iter().map(|&i| ConflictRef { mod_id: mods[i].id.clone(), name: mods[i].name.clone(), shared: n, parts: parts.clone(), hashes: Vec::new() }).collect(),
            hashes, character, ignored: all_ignored,
        }
    }).collect();
    out.sort_by(|a, b| b.hashes.len().cmp(&a.hashes.len()));
    Ok(out)
}

/// Problems for every mod, on or off. Mods without problems are left out.
pub fn lint(db: &Db, game: &str) -> Result<Vec<ModProblems>> {
    let mods = mods_or_empty(db, game)?;
    let ctx = LintCtx::of_game(db, game);
    let mut out = Vec::new();
    for m in &mods {
        let dir = Path::new(&m.path);
        if !dir.is_dir() { continue; }
        let problems = lint_mod_ctx(dir, &read_mod(dir), &ctx, m.character.is_some());
        if !problems.is_empty() {
            out.push(ModProblems { mod_id: m.id.clone(), name: m.name.clone(), enabled: m.enabled, source: m.source.clone(), problems });
        }
    }
    Ok(out)
}

/// Which mods (on or off) override a hash, any case, with or without 0x.
pub fn hash_lookup(db: &Db, game: &str, hash: &str) -> Result<Vec<HashHit>> {
    let Some(want) = norm_hash(hash) else {
        return Err(Error::Invalid("That isn't a hash. Hashes look like 7a8b9c0d (8 letters and digits, 0-9 and a-f)".into()));
    };
    let mods = mods_or_empty(db, game)?;
    let mut out = Vec::new();
    for m in &mods {
        for (abs, rel) in mod_inis(Path::new(&m.path)) {
            let Some(f) = cached_facts(&abs) else { continue };
            for (section, h, _) in &f.hashes {
                if *h == want { out.push(HashHit { mod_id: m.id.clone(), name: m.name.clone(), ini: rel.clone(), section: section.clone(), enabled: m.enabled }); }
            }
        }
    }
    out.sort_by(|a, b| b.enabled.cmp(&a.enabled).then_with(|| a.name.cmp(&b.name)));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("gachamod-ini-{name}-{}", library::new_id()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn decodes_boms() {
        assert_eq!(decode(b"\xEF\xBB\xBFabc"), "abc");
        let le: Vec<u8> = [0xFF, 0xFE].into_iter().chain("[Key]".encode_utf16().flat_map(|u| u.to_le_bytes())).collect();
        assert_eq!(decode(&le), "[Key]");
        let be: Vec<u8> = [0xFE, 0xFF].into_iter().chain("x=1".encode_utf16().flat_map(|u| u.to_be_bytes())).collect();
        assert_eq!(decode(&be), "x=1");
        assert_eq!(decode(b"a\xFFb"), "a\u{fffd}b");
    }

    #[test]
    fn labels_keys() {
        assert_eq!(binding_label("ctrl alt VK_UP"), "Ctrl+Alt+Up");
        assert_eq!(binding_label("alt ctrl up"), "Ctrl+Alt+Up");
        assert_eq!(binding_label("no_modifiers x"), "X");
        assert_eq!(binding_label("VK_NUMPAD1"), "Num 1");
        assert_eq!(binding_label("no_ctrl no_alt VK_F5"), "F5");
        assert_eq!(binding_label("VK_OEM_4"), "[");
        assert_eq!(binding_label("0x41"), "A");
        assert_eq!(binding_label("XB_A"), "Pad A");
        assert_eq!(binding_label("XB_LEFT_TRIGGER"), "Pad LT");
        assert_eq!(binding_label("XB2_RIGHT_SHOULDER"), "Pad 2 RB");
        assert_eq!(binding_label("shift 5"), "Shift+5");
        assert_eq!(binding_label("VK_PRIOR"), "Page Up");
    }

    #[test]
    fn formats_like_3dmigoto() {
        assert_eq!(format_g9(1.0), "1");
        assert_eq!(format_g9(0.5), "0.5");
        assert_eq!(format_g9(-2.0), "-2");
        assert_eq!(format_g9(0.0), "0");
        assert_eq!(format_g9(123456789.0), "123456789");
        assert_eq!(format_g9(1e10), "1e+10");
        assert_eq!(format_g9(0.0001), "0.0001");
        assert_eq!(format_g9(0.00001), "1e-05");
        assert_eq!(norm_value(" 1.000 "), "1");
        assert_eq!(norm_value("abc"), "abc");
    }

    #[test]
    fn labels_vars() {
        assert_eq!(var_label("swapvar"), "Swap");
        assert_eq!(var_label("jacket_off"), "Jacket off");
        assert_eq!(section_label("KeyJacket"), "Jacket");
        assert_eq!(section_label("KeyToggleCoat"), "Toggle coat");
        assert_eq!(section_label("Key_hat_2"), "Hat 2");
        assert!(generic_label("Swap"));
        assert!(generic_label("Swap 2"));
        assert!(!generic_label("Jacket"));
    }

    const MOD_INI: &str = "; a comment\r\nnamespace = ignored\r\n[Constants]\r\nglobal persist $swapvar = 0\r\npersist global $jacket = 1\r\nglobal $active\r\nglobal persist $hat\r\n\
        [Present]\r\npost $active = 0\r\n# not a comment = 1\r\n[KeySwap]\r\ncondition = $active == 1\r\nkey = VK_DOWN\r\nkey = XB_A\r\nback = VK_UP\r\ntype = cycle\r\n$swapvar = 0,1,2,\r\n\
        [keyjacket]\r\nkey = ctrl alt j\r\ntype = toggle\r\n$jacket = 0\r\n[KeyBroken]\r\ntype = cycle\r\n[TextureOverrideBody]\r\nhash = 0xABCDEF12\r\nrun = CommandListBody\r\n\
        [ShaderOverrideX]\r\nhash = 1234\r\n[CommandListBody]\r\n[TextureOverrideFace]\r\nhash = 11112222\r\nrun = CommandListGone\r\n[ResourceBody]\r\nfilename = Textures\\Body.dds\r\n[ResourceFace]\r\nfilename = face.dds\r\n";

    fn write_mod(dir: &Path) {
        fs::create_dir_all(dir.join("textures")).unwrap();
        fs::write(dir.join("mod.ini"), MOD_INI).unwrap();
        fs::write(dir.join("textures/body.dds"), b"x").unwrap();
        fs::write(dir.join("DISABLED old.ini"), "[TextureOverrideOld]\nhash = deadbeef\n").unwrap();
        fs::create_dir_all(dir.join("DISABLED_backup")).unwrap();
        fs::write(dir.join("DISABLED_backup/x.ini"), "[TextureOverrideOld]\nhash = cafebabe\n").unwrap();
        fs::write(dir.join("desktop.ini"), "[.ShellClassInfo]\n").unwrap();
        fs::write(dir.join("readme.txt"), "Press down to swap.").unwrap();
    }

    #[test]
    fn quick_facts_skip_disabled() {
        let d = temp("quick");
        write_mod(&d);
        let f = quick_facts(&d);
        assert_eq!(f.ini_count, 1);
        assert!(f.has_keys);
        assert_eq!(f.hashes, vec!["00001234", "11112222", "abcdef12"]);
        // [ShaderOverrideX] only names its hash, so it changes nothing and conflicts leave it out
        assert_eq!(f.active, vec!["11112222", "abcdef12"]);
        // a mod folder that is itself DISABLED still counts its own files
        let off = d.join("DISABLED Coca Cola");
        fs::create_dir_all(&off).unwrap();
        fs::write(off.join("a.ini"), "[Key1]\nkey = x\n").unwrap();
        assert_eq!(quick_facts(&off).ini_count, 1);
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn inspects_keys_vars_and_problems() {
        let d = temp("inspect");
        write_mod(&d);
        let saved = vec![VarValue { ini: "mod.ini".into(), var: "swapvar".into(), value: "2.0".into() }];
        let r = inspect_dir(&d, &saved, &LintCtx::near(&d), false);
        assert_eq!(r.inis, vec!["mod.ini"]);
        assert_eq!(r.keys.len(), 2);
        let swap = &r.keys[0];
        assert_eq!(swap.labels, vec!["Down", "Pad A"]);
        assert_eq!(swap.back.as_deref(), Some("Up"));
        assert_eq!(swap.kind, "cycle");
        assert_eq!(swap.vars[0].values, vec!["0", "1", "2"]);
        assert_eq!(swap.condition.as_deref(), Some("$active == 1"));
        assert_eq!(r.keys[1].label, "Ctrl+Alt+J");
        assert_eq!(r.vars.len(), 3);
        let v = |n: &str| r.vars.iter().find(|v| v.var == n).unwrap();
        assert_eq!(v("swapvar").current.as_deref(), Some("2"));
        assert_eq!(v("swapvar").kind, "list");
        assert_eq!(v("swapvar").label, "Swap");
        assert_eq!(v("jacket").kind, "switch");
        assert_eq!(v("jacket").label, "Jacket");
        assert_eq!(v("jacket").default.as_deref(), Some("1"));
        assert_eq!(v("hat").default.as_deref(), Some("0"));
        assert_eq!(r.hash_count, 3);
        let kinds: Vec<&str> = r.problems.iter().map(|p| p.kind.as_str()).collect();
        assert!(kinds.contains(&"no_key"), "{kinds:?}");
        assert!(kinds.contains(&"missing_section"), "{kinds:?}");
        assert!(r.problems.iter().any(|p| p.kind == "missing_file" && p.detail.contains("face.dds")), "{:?}", r.problems);
        assert!(!r.problems.iter().any(|p| p.detail.contains("Body.dds")));
        assert_eq!(r.readmes.len(), 1);
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn lints_empty_and_missing_inis() {
        let d = temp("lint");
        assert_eq!(lint_mod(&d, &read_mod(&d))[0].kind, "no_ini");
        fs::write(d.join("a.ini"), "; only a comment\n").unwrap();
        assert_eq!(lint_mod(&d, &read_mod(&d))[0].kind, "bad_ini");
        fs::remove_dir_all(&d).unwrap();
    }

    fn lint_dir(d: &Path) -> Vec<Problem> { lint_mod(d, &read_mod(d)) }

    #[test]
    fn importer_command_lists_count() {
        // ZZMI defines [CommandListSkinTexture] in Core/ZZMI/main.ini; a mod that runs it isn't missing anything
        let root = temp("importer");
        fs::write(root.join("d3dx.ini"), "[Constants]\n").unwrap();
        fs::create_dir_all(root.join("Core/ZZMI")).unwrap();
        fs::write(root.join("Core/ZZMI/main.ini"), "[CommandListSkinTexture]\nrun = x\n").unwrap();
        let d = root.join("Mods/Roxy");
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join("a.ini"), "[TextureOverrideBody]\nhash = 0011aabb\nrun = CommandListSkinTexture\nrun = CommandListNope\n").unwrap();
        let ps = lint_dir(&d);
        let missing: Vec<&str> = ps.iter().filter(|p| p.kind == "missing_section").map(|p| p.detail.as_str()).collect();
        assert_eq!(missing.len(), 1, "{missing:?}");
        assert!(missing[0].contains("CommandListNope"));
        fs::remove_dir_all(&root).unwrap();
    }

    const REMAP_INI: &str = "[TextureOverrideRemap]\nhash = fe5c0180\nrun = CommandListRemap\n[CommandListRemap]\nvb1 = ResourceRemap.0\nib = ResourceBodyIB\n\
        [ResourceRemap.0]\nfilename = .\\Regular\\RaidenShogunRemapBlend.buf\n[ResourceBodyIB]\nfilename = Body.ib\n[ResourceDressIB]\nfilename = Dress.ib\n";

    fn write_remap_mod(d: &Path) {
        fs::create_dir_all(d.join("RegularRaiden")).unwrap();
        fs::create_dir_all(d.join("NarukamiRaiden")).unwrap();
        fs::write(d.join("RegularRaiden/RaidenShogunRemapBlend.buf"), b"a").unwrap();
        fs::write(d.join("NarukamiRaiden/RaidenShogunRemapBlend.buf"), b"b").unwrap();
        fs::write(d.join("merged.ini"), REMAP_INI).unwrap();
    }

    #[test]
    fn missing_files_rated_by_what_uses_them() {
        let d = temp("severity");
        write_remap_mod(&d);
        let ps = lint_dir(&d);
        let of = |f: &str| ps.iter().find(|p| p.detail.contains(f)).unwrap_or_else(|| panic!("{f}: {ps:?}"));
        // a part that draws with it is a warning (mods often still show fine), with nothing to point it to
        assert_eq!(of("Body.ib").severity, "warn");
        assert!(of("Body.ib").fix.is_none());
        // nothing names [ResourceDressIB], so 3DMigoto never loads it
        assert_eq!(of("Dress.ib").severity, "info");
        // a boss or skin remap: a warning, pointed to the folder whose name is closest ("Regular" -> "RegularRaiden")
        let remap = of("RemapBlend");
        assert_eq!(remap.severity, "warn");
        assert_eq!(remap.fix.as_ref().and_then(|f| f.to.as_deref()), Some(r".\RegularRaiden\RaidenShogunRemapBlend.buf"));
        assert_eq!(ps.last().map(|p| p.severity.as_str()), Some("info"), "worst first");

        // a file one folder up is found from a variant folder
        let v = temp("up");
        fs::create_dir_all(v.join("1")).unwrap();
        fs::write(v.join("Body.ib"), b"x").unwrap();
        fs::write(v.join("1/a.ini"), "[TextureOverrideBody]\nhash = 1234abcd\nib = ResourceBodyIB\n[ResourceBodyIB]\nfilename = Body.ib\n").unwrap();
        let p = &lint_dir(&v)[0];
        assert_eq!(p.fix.as_ref().and_then(|f| f.to.as_deref()), Some(r"..\Body.ib"));
        fs::remove_dir_all(&d).unwrap();
        fs::remove_dir_all(&v).unwrap();
    }

    #[test]
    fn missing_files_of_one_kind_are_one_problem() {
        let d = temp("grouped");
        let mut ini = String::new();
        for n in ["Diffuse", "NormalMap", "LightMap", "MaterialMap"] {
            ini.push_str(&format!("[ResourceHair{n}]\nfilename = ./Covered/Hair{n}.dds\n"));
        }
        ini.push_str("[KeyA]\ntype = cycle\n[KeyB]\ntype = cycle\n");
        fs::write(d.join("mod.ini"), ini).unwrap();
        let ps = lint_dir(&d);
        let missing: Vec<&Problem> = ps.iter().filter(|p| p.kind == "missing_file").collect();
        assert_eq!(missing.len(), 1, "{ps:?}");
        assert_eq!(missing[0].detail, "mod.ini lists 4 files from ./Covered that aren't in the mod folder: HairDiffuse.dds, \
            HairNormalMap.dds, HairLightMap.dds, and HairMaterialMap.dds. Nothing uses them, so the game never loads them");
        let keys: Vec<&Problem> = ps.iter().filter(|p| p.kind == "no_key").collect();
        assert_eq!(keys.len(), 1);
        assert_eq!(keys[0].detail, "[KeyA] and [KeyB] in mod.ini have no key line, so they do nothing");
        assert_eq!(oxford(&["a", "b", "c", "d", "e"], 3), "a, b, and 3 more");
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn variants_that_draw_over_each_other() {
        let d = temp("overlap");
        let variant = |extra: &str| format!("[TextureOverrideVB]\nhash = 11111111\n{extra}handling = skip\n[TextureOverrideIB]\nhash = 22222222\nmatch_first_index = 0\n{extra}handling = skip\n");
        let write = |extra: &dyn Fn(&str) -> String| for n in ["1", "2", "3"] {
            fs::create_dir_all(d.join(n)).unwrap();
            fs::write(d.join(n).join("a.ini"), variant(&extra(n))).unwrap();
        };
        write(&|_| String::new());
        let ps = lint_dir(&d);
        let o = ps.iter().find(|p| p.kind == "overlap").expect("overlap");
        assert_eq!(o.severity, "bad");
        assert_eq!(o.fix.as_ref().unwrap().inis, vec!["1/a.ini", "2/a.ini", "3/a.ini"]);
        assert!(o.detail.starts_with("1/a.ini, 2/a.ini, and 3/a.ini change"), "{}", o.detail);
        // match_priority says which wins, and variants that each check a condition take turns
        write(&|n| format!("match_priority = {n}\n"));
        assert!(!lint_dir(&d).iter().any(|p| p.kind == "overlap"));
        write(&|n| format!("if $\\master\\swapvar == {n}\n"));
        assert!(!lint_dir(&d).iter().any(|p| p.kind == "overlap"));
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn turned_off_inis_are_not_a_problem() {
        let d = temp("offinis");
        fs::create_dir_all(d.join("DISABLED 2")).unwrap();
        fs::write(d.join("DISABLED 2/a.ini"), "[TextureOverrideX]\nhash = 1\n").unwrap();
        fs::write(d.join("DISABLED_b.ini"), "[TextureOverrideX]\nhash = 1\n").unwrap();
        assert!(lint_dir(&d).is_empty());
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn fixes_apply_and_undo() {
        let root = temp("fix");
        let mods = root.join("Mods");
        let m = mods.join("Raiden/Xentinel");
        write_remap_mod(&m);
        fs::write(m.join("RegularRaiden/Body.ib"), b"x").unwrap();
        for n in ["1", "2"] {
            fs::create_dir_all(m.join(n)).unwrap();
            fs::write(m.join(n).join("v.ini"), "[TextureOverrideVB]\nhash = 11111111\nhandling = skip\n[TextureOverrideIB]\nhash = 22222222\nhandling = skip\n").unwrap();
        }
        let db = crate::db::Db::open(&root.join("gachamod.db")).unwrap();
        crate::games::save_paths(&db, "zzz", &crate::games::GamePaths { mods_dir: Some(mods.to_string_lossy().into_owned()), ..Default::default() }).unwrap();
        let shared = Arc::new(Mutex::new(db));
        let id = library::scan(&shared, "zzz").unwrap()[0].id.clone();
        let db = shared.lock().unwrap();
        let fixes = |kind: &str| lint(&db, "zzz").unwrap().into_iter().flat_map(|m| m.problems).filter_map(|p| p.fix).filter(|f| f.kind == kind).collect::<Vec<_>>();

        // "point": every line naming the file changes, the rest of the file stays byte for byte
        let point = fixes("point").into_iter().find(|f| f.from.as_deref().is_some_and(|x| x.contains("Remap"))).unwrap();
        let b = apply_fix(&db, "zzz", &id, &point).unwrap();
        let after = fs::read_to_string(m.join("merged.ini")).unwrap();
        assert_eq!(after, REMAP_INI.replace(r".\Regular\", r".\RegularRaiden\"));
        assert!(apply_fix(&db, "zzz", &id, &point).is_err(), "a second try finds nothing to change");
        crate::backups::restore(&db, &b.id).unwrap();
        assert_eq!(fs::read_to_string(m.join("merged.ini")).unwrap(), REMAP_INI);

        // "keep": the other variant is renamed off, and undo names it back
        let mut keep = fixes("keep").pop().unwrap();
        keep.ini = Some("2/v.ini".into());
        let b = apply_fix(&db, "zzz", &id, &keep).unwrap();
        assert!(m.join("1/DISABLED_v.ini").is_file() && !m.join("1/v.ini").exists() && m.join("2/v.ini").is_file());
        assert!(fixes("keep").is_empty());
        crate::backups::restore(&db, &b.id).unwrap();
        assert!(m.join("1/v.ini").is_file() && !m.join("1/DISABLED_v.ini").exists());

        // a path that climbs out of the mod is refused
        let bad = ProblemFix { to: Some(r"..\..\..\x.buf".into()), ..point };
        assert!(apply_fix(&db, "zzz", &id, &bad).is_err());
        drop(db);
        drop(shared);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn conflicts_can_be_ignored_or_taken_out_of_one_mod() {
        let root = temp("conflict");
        let mods = root.join("Mods");
        let ini = "[TextureOverrideBody]
hash = 11111111
ib = Body.ib

[TextureOverrideHair]
hash = 33333333
ib = Hair.ib
";
        for n in ["A", "B"] {
            fs::create_dir_all(mods.join(n)).unwrap();
            fs::write(mods.join(n).join("mod.ini"), ini).unwrap();
        }
        // B changes the hair only
        fs::write(mods.join("B/mod.ini"), "[TextureOverrideHair]
hash = 33333333
ib = Hair.ib
").unwrap();
        let db = crate::db::Db::open(&root.join("gachamod.db")).unwrap();
        crate::games::save_paths(&db, "zzz", &crate::games::GamePaths { mods_dir: Some(mods.to_string_lossy().into_owned()), ..Default::default() }).unwrap();
        let shared = Arc::new(Mutex::new(db));
        let list = library::scan(&shared, "zzz").unwrap();
        assert!(list.iter().all(|m| m.conflicts == 1));
        let a = list.iter().find(|m| m.name == "A").unwrap().id.clone();
        let b = list.iter().find(|m| m.name == "B").unwrap().id.clone();
        {
            let db = shared.lock().unwrap();
            let g = conflicts(&db, "zzz").unwrap();
            assert_eq!(g.len(), 1);
            assert_eq!(g[0].hashes, vec!["33333333".to_string()]);
            assert!(!g[0].ignored);

            // taking the shared part out of A comments out its hair section only, and undo puts it back
            let backup = drop_overrides(&db, "zzz", &a, &g[0].hashes).unwrap();
            let after = fs::read_to_string(mods.join("A/mod.ini")).unwrap();
            assert!(after.contains("[TextureOverrideBody]
hash = 11111111"));
            assert!(after.contains(";[TextureOverrideHair]
;hash = 33333333
;ib = Hair.ib"));
            assert!(conflicts(&db, "zzz").unwrap().is_empty());
            let cards = |db: &crate::db::Db| library::list(db, "zzz").unwrap().iter().map(|m| m.conflicts).collect::<Vec<_>>();
            assert_eq!(cards(&db), vec![0, 0], "cards drop the tag without a rescan");
            crate::backups::restore(&db, &backup.id).unwrap();
            assert_eq!(fs::read_to_string(mods.join("A/mod.ini")).unwrap(), ini);
            assert_eq!(cards(&db), vec![1, 1], "undo brings it back");

            library::set_enabled(&db, "zzz", &[b.clone()], false).unwrap();
            assert_eq!(cards(&db), vec![0, 0], "turning one off clears both");
            library::set_enabled(&db, "zzz", &[b.clone()], true).unwrap();
            assert_eq!(cards(&db), vec![1, 1]);

            ignore_conflict(&db, "zzz", &[a.clone(), b.clone()], true).unwrap();
            assert!(conflicts(&db, "zzz").unwrap()[0].ignored);
            assert!(inspect(&db, "zzz", &a).unwrap().conflicts.is_empty());
            assert_eq!(cards(&db), vec![0, 0]);
        }
        assert!(library::scan(&shared, "zzz").unwrap().iter().all(|m| m.conflicts == 0), "mod cards stop counting it");
        {
            let db = shared.lock().unwrap();
            ignore_conflict(&db, "zzz", &[a.clone(), b.clone()], false).unwrap();
            assert!(!conflicts(&db, "zzz").unwrap()[0].ignored);
        }
        drop(shared);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn parser_never_panics_on_junk() {
        for junk in ["", "[", "]", "=", "[]\n=\n$=\nkey=", "[Key\nkey = ctrl\n$x = ,,,\n", "\u{0}\u{1}[Constants]\nglobal persist $ = 1\n"] {
            let ini = parse(junk);
            let _ = facts_of(&ini);
            let _ = key_bindings("a.ini", &ini);
            let _ = declared_vars(&ini);
        }
    }

    #[test]
    fn user_ini_round_trip() {
        let imp = temp("user");
        fs::create_dir_all(imp.join("Mods/Ellen Joe/Coca Cola/b")).unwrap();
        fs::write(imp.join("Mods/Ellen Joe/Coca Cola/b/coca.ini"), "").unwrap();
        fs::create_dir_all(imp.join("Mods/Ellen Joe/Coca Cola/Nested")).unwrap();
        let original = "; AUTOMATICALLY GENERATED FILE - DO NOT EDIT\r\n[Constants]\r\n$\\debugger\\show_debug_output = 0\r\n$\\mods\\other\\o.ini\\swapvar = 3\r\n\
            $\\mods\\ellen joe\\coca cola\\nested\\n.ini\\x = 1\r\n";
        fs::write(imp.join("d3dx_user.ini"), original).unwrap();

        set_user_vars(&imp, "Ellen Joe/Coca Cola", &[VarValue { ini: "b/coca.ini".into(), var: "swapvar".into(), value: "1.0".into() }]).unwrap();
        let text = fs::read_to_string(imp.join("d3dx_user.ini")).unwrap();
        assert!(text.starts_with(original), "{text}");
        assert!(text.ends_with("$\\mods\\ellen joe\\coca cola\\b\\coca.ini\\swapvar = 1\r\n"), "{text}");
        assert_eq!(fs::read_to_string(imp.join("d3dx_user.ini.gachamod.bak")).unwrap(), original);

        // the nested mod's line is not this mod's
        let vars = user_vars(&imp, "Ellen Joe/Coca Cola").unwrap();
        assert_eq!(vars, vec![VarValue { ini: "b/coca.ini".into(), var: "swapvar".into(), value: "1".into() }]);

        set_user_vars(&imp, "Ellen Joe/Coca Cola", &[VarValue { ini: "b/coca.ini".into(), var: "swapvar".into(), value: "0.5".into() }]).unwrap();
        assert_eq!(user_vars(&imp, "Ellen Joe/Coca Cola").unwrap()[0].value, "0.5");

        move_user_vars(&imp, "Ellen Joe/Coca Cola", "Ellen Joe/DISABLED Coca Cola").unwrap();
        let text = fs::read_to_string(imp.join("d3dx_user.ini")).unwrap();
        assert!(text.contains("$\\mods\\ellen joe\\disabled coca cola\\b\\coca.ini\\swapvar = 0.5\r\n"), "{text}");
        assert!(text.contains("$\\mods\\ellen joe\\disabled coca cola\\nested\\n.ini\\x = 1\r\n"), "{text}");
        assert!(text.contains("$\\mods\\other\\o.ini\\swapvar = 3\r\n"));
        assert!(text.contains("$\\debugger\\show_debug_output = 0\r\n"));
        // "ellen joe\coca" must not match "ellen joe\coca cola" (whole segments only)
        move_user_vars(&imp, "Ellen Joe/Coca", "X").unwrap();
        assert!(fs::read_to_string(imp.join("d3dx_user.ini")).unwrap().contains("disabled coca cola"));
        fs::remove_dir_all(&imp).unwrap();
    }

    #[test]
    fn user_ini_created_when_missing() {
        let imp = temp("create");
        set_user_vars(&imp, "A", &[VarValue { ini: "a.ini".into(), var: "$Hat".into(), value: "2".into() }]).unwrap();
        assert_eq!(fs::read_to_string(imp.join("d3dx_user.ini")).unwrap(), "[Constants]\r\n$\\mods\\a\\a.ini\\hat = 2\r\n");
        assert!(user_vars(&imp, "B").unwrap().is_empty());
        fs::remove_dir_all(&imp).unwrap();
    }

    #[test]
    fn saved_values_follow_a_mods_folder_with_another_name() {
        let imp = temp("modsname");
        note_mods_dir(&imp, &imp.join("Mods_Custom"));
        set_user_vars(&imp, "A", &[VarValue { ini: "a.ini".into(), var: "hat".into(), value: "2".into() }]).unwrap();
        assert_eq!(fs::read_to_string(imp.join("d3dx_user.ini")).unwrap(), "[Constants]\r\n$\\mods_custom\\a\\a.ini\\hat = 2\r\n");
        assert_eq!(user_vars(&imp, "A").unwrap()[0].value, "2");
        // a Mods folder somewhere else keeps the usual name
        note_mods_dir(&imp, Path::new("D:\\Elsewhere\\Mods"));
        assert_eq!(mod_namespace(&imp, "A"), "mods\\a");
        fs::remove_dir_all(&imp).unwrap();
    }

    /// A loader folder with ORFix in its libraries, and a Mods folder next to it.
    fn loader_with_libs(name: &str) -> PathBuf {
        let root = temp(name);
        fs::write(root.join("d3dx.ini"), "[Loader]\n").unwrap();
        let lib = root.join("Core/GIMI/Libraries/ORFix");
        fs::create_dir_all(&lib).unwrap();
        fs::write(lib.join("ORFix.ini"), "; ORFix\nnamespace = global\\ORFix\n[CommandListORFix]\nps-t1 = ps-t0\n").unwrap();
        fs::create_dir_all(root.join("Mods")).unwrap();
        root
    }

    fn lint_kinds(dir: &Path) -> Vec<Problem> {
        lint_mod(dir, &read_mod(dir)).into_iter().filter(|p| matches!(p.kind.as_str(), "duplicate_library" | "missing_library" | "global_trigger")).collect()
    }

    #[test]
    fn flags_a_copy_of_a_shipped_library() {
        let root = loader_with_libs("duplib");
        let m = root.join("Mods/Raiden");
        fs::create_dir_all(m.join("ORFix")).unwrap();
        fs::write(m.join("ORFix/ORFix.ini"), "namespace = Global/ORFix\n[CommandListORFix]\n").unwrap();
        fs::write(m.join("raiden.ini"), "[TextureOverrideBody]\nhash = 11112222\nrun = CommandList\\global\\ORFix\\ORFix\n").unwrap();
        let p = lint_kinds(&m);
        assert_eq!(p.len(), 1, "{p:?}");
        assert_eq!(p[0].kind, "duplicate_library");
        assert_eq!(p[0].severity, "bad");
        assert_eq!(p[0].detail, "ORFix/ORFix.ini is a copy of ORFix, which the loader already loads from Core\\GIMI\\Libraries. Two copies of a library break the mods that use it. Turn this copy off");
        assert_eq!(p[0].fix, Some(ProblemFix { kind: "off".into(), ini: Some("ORFix/ORFix.ini".into()), from: None, to: None, inis: vec!["ORFix/ORFix.ini".into()] }));
        // a mod folder outside any loader can't be checked against its libraries
        let alone = temp("duplib-alone");
        fs::write(alone.join("ORFix.ini"), "namespace = global\\ORFix\n[CommandListORFix]\n").unwrap();
        assert!(lint_kinds(&alone).is_empty());
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&alone);
    }

    #[test]
    fn flags_a_library_that_isnt_installed() {
        let root = loader_with_libs("misslib");
        // another mod defines SlotFix, so that one counts as installed
        fs::create_dir_all(root.join("Mods/SlotFix")).unwrap();
        fs::write(root.join("Mods/SlotFix/SlotFix.ini"), "namespace = SlotFix\n[CommandListRun]\n").unwrap();
        let m = root.join("Mods/Jane");
        fs::create_dir_all(&m).unwrap();
        fs::write(m.join("jane.ini"), "namespace = JaneMod\n[TextureOverrideBody]\nhash = 11112222\nrun = CommandList\\global\\ORFix\\ORFix\nrun = CommandList\\RabbitFX\\Run\n\
            run = CommandList\\SlotFix\\Run\nif $\\JaneMod\\on == 1\nps-t5 = Resource\\RabbitFX\\Mask\nendif\nx = $\\mods\\other\\a.ini\\var\n").unwrap();
        let p = lint_kinds(&m);
        assert_eq!(p.len(), 1, "{p:?}");
        assert_eq!(p[0].kind, "missing_library");
        assert_eq!(p[0].severity, "warn");
        assert_eq!(p[0].detail, "jane.ini uses RabbitFX (CommandList\\RabbitFX\\Run), which isn't installed, so that step is skipped. RabbitFX is a shared library or another mod");
        assert!(p[0].fix.is_none());
        // the library turned off is as good as not there
        fs::rename(root.join("Mods/SlotFix"), root.join("Mods/DISABLED SlotFix")).unwrap();
        assert_eq!(lint_kinds(&m).len(), 2);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn flags_global_triggers_like_xxmi() {
        let d = temp("trigger");
        fs::write(d.join("glow.ini"), "[ShaderRegexGlow]\nshader_model = ps_5_0\nrun = CommandListGlow\ncheckTextureOverride = ps-t0\n\
            [CommandListGlow]\ncheckTextureOverride = ps-t1\ncheckTextureOverride = ps-t0\n\
            [ShaderRegexOutline]\nshader_model = ps_5_0\ncheckTextureOverride = ps-t3\n[ShaderRegexOutline.pattern]\nmov o0\\.w, l\\(0\\)\n\
            [TextureOverrideX]\nhash = 11112222\ncheckTextureOverride = ps-t0\n").unwrap();
        let p = lint_kinds(&d);
        assert_eq!(p.len(), 1, "{p:?}");
        assert_eq!(p[0].kind, "global_trigger");
        assert_eq!(p[0].severity, "warn");
        assert_eq!(p[0].detail, "[ShaderRegexGlow] in glow.ini runs CheckTextureOverride on ps-t0 and ps-t1 for every matching shader in the game, which costs FPS everywhere, not only while this mod's model is on screen");
        assert!(p[0].fix.is_none());
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn off_fix_turns_one_ini_off_and_undoes() {
        let root = loader_with_libs("offfix");
        let mods = root.join("Mods");
        let m = mods.join("Raiden");
        fs::create_dir_all(m.join("ORFix")).unwrap();
        fs::write(m.join("ORFix/ORFix.ini"), "namespace = global\\ORFix\n[CommandListORFix]\n").unwrap();
        fs::write(m.join("raiden.ini"), "[TextureOverrideBody]\nhash = 11112222\nhandling = skip\n").unwrap();
        let db = crate::db::Db::open(&root.join("gachamod.db")).unwrap();
        crate::games::save_paths(&db, "gi", &crate::games::GamePaths { mods_dir: Some(mods.to_string_lossy().into_owned()), ..Default::default() }).unwrap();
        let shared = Arc::new(Mutex::new(db));
        let id = library::scan(&shared, "gi").unwrap()[0].id.clone();
        let db = shared.lock().unwrap();
        let fix = lint(&db, "gi").unwrap().into_iter().flat_map(|m| m.problems).find_map(|p| p.fix.filter(|f| f.kind == "off")).unwrap();
        let b = apply_fix(&db, "gi", &id, &fix).unwrap();
        assert_eq!(b.label, "Turned off ORFix/ORFix.ini");
        assert!(m.join("ORFix/DISABLED_ORFix.ini").is_file() && !m.join("ORFix/ORFix.ini").exists() && m.join("raiden.ini").is_file());
        crate::backups::restore(&db, &b.id).unwrap();
        assert!(m.join("ORFix/ORFix.ini").is_file() && !m.join("ORFix/DISABLED_ORFix.ini").exists());
        drop(db);
        drop(shared);
        let _ = fs::remove_dir_all(&root);
    }

    /// A character part that sets textures by slot, the way a mod does before ORFix is called.
    const THREE_SLOTS: &str = "[TextureOverrideVaresaBody]\nhash = 11112222\nib = ResourceBodyIB\nps-t0 = ResourceBodyNormal\nps-t1 = ResourceBodyDiffuse\nps-t2 = ResourceBodyLightMap\n";

    /// The call a three-slot part needs, and the one a part with no normal map needs.
    const ORFIX_LINE: &str = "run = CommandList\\global\\ORFix\\ORFix";
    const NNFIX_LINE: &str = "run = CommandList\\global\\ORFix\\NNFix";

    /// The flagged problems for a mod that isn't known to be a character's: only three-slot parts count.
    fn orfix_problems(dir: &Path) -> Vec<Problem> { orfix_lint(dir, false) }

    fn orfix_lint(dir: &Path, character: bool) -> Vec<Problem> {
        lint_mod_ctx(dir, &read_mod(dir), &LintCtx::near(dir), character).into_iter().filter(|p| p.kind == "missing_orfix").collect()
    }

    /// A mod shaped like the Yelan Qipao one: parts that bind only diffuse and light map, one inside gachamod's live
    /// wrapper, a face part that gets no call, and no ORFix or NNFix anywhere.
    fn yelan() -> String {
        [
            "[TextureOverrideYelanHead]", "hash = 11111111", "ib = ResourceYelanHeadIB", "ps-t0 = ResourceYelanHeadDiffuse",
            "ps-t1 = ResourceYelanHeadLightMap", "drawindexed = auto", "",
            "[TextureOverrideYelanBody]", "hash = 22222222", "ib = ResourceYelanBodyIB", "ps-t0 = ResourceYelanBodyDiffuse",
            "ps-t1 = ResourceYelanBodyLightMap", "drawindexed = auto", "",
            "[TextureOverrideYelanDress]", "hash = 33333333", "; gachamod:begin", r"run = CommandList\gachamod\live\Seen1",
            r"if $\gachamod\live\g1 == 5", "\tib = ResourceYelanDressIB", "\tps-t0 = ResourceYelanDressDiffuse",
            "\tps-t1 = ResourceYelanDressLightMap", "\tps-t69 = Resource1", "\trun = CommandList\\TexFx\\Transparency.0", "endif",
            "; gachamod:end", "",
            "[TextureOverrideYelanExtra]", "hash = 44444444", "ps-t0 = ResourceYelanExtraDiffuse", "ps-t1 = ResourceYelanExtraLightMap", "",
            "[TextureOverrideYelanFaceHeadDiffuse]", "hash = 55555555", "ps-t0 = ResourceYelanFaceDiffuse", "ps-t1 = ResourceYelanFaceLightMap",
        ].join("\n") + "\n"
    }

    /// `yelan()` with the NNFix call right after the light map binding of the four parts, and nothing else changed.
    fn yelan_fixed() -> String {
        let mut s = yelan();
        for (binding, indent) in [("YelanHead", ""), ("YelanBody", ""), ("YelanDress", "\t"), ("YelanExtra", "")] {
            let line = format!("{indent}ps-t1 = Resource{binding}LightMap\n");
            assert_eq!(s.matches(&line).count(), 1, "{line}");
            s = s.replace(&line, &format!("{line}{indent}{NNFIX_LINE}\n"));
        }
        s
    }

    fn yelan_mod(root: &Path, text: &[u8]) -> PathBuf {
        let m = root.join("Mods/Yelan Qipao Mod");
        fs::create_dir_all(&m).unwrap();
        fs::write(m.join("yelan.ini"), text).unwrap();
        m
    }

    /// What `orfix_edits` makes of a mod's inis, as text.
    fn orfix_texts(dir: &Path, character: bool) -> Vec<(String, String)> {
        let wanted: Vec<String> = read_mod(dir).iter().map(|m| m.rel.clone()).collect();
        orfix_edits(dir, &read_mod(dir), &LintCtx::near(dir), character, &wanted).unwrap()
            .into_iter().map(|e| (e.rel, String::from_utf8(e.new).unwrap())).collect()
    }

    #[test]
    fn flags_the_yelan_mod_and_adds_nnfix() {
        let root = loader_with_libs("yelan");
        let m = yelan_mod(&root, yelan().as_bytes());

        // a character mod: one warning naming the ini and the parts, with the fix
        let p = orfix_lint(&m, true);
        assert_eq!(p.len(), 1, "{p:?}");
        assert_eq!(p[0].severity, "warn");
        assert_eq!(p[0].ini.as_deref(), Some("yelan.ini"));
        assert_eq!(p[0].detail, "yelan.ini sets the textures of TextureOverrideYelanHead, TextureOverrideYelanBody, and 2 more by slot, and nothing in the mod calls ORFix. Outlines and reflections can show the wrong colors in game. Adding the call fixes it");
        assert_eq!(p[0].fix, Some(ProblemFix { kind: "orfix".into(), ini: Some("yelan.ini".into()), from: None, to: None, inis: vec!["yelan.ini".into()] }));

        // two slots are normal for a weapon or an item, so a mod with no character isn't judged
        assert!(orfix_lint(&m, false).is_empty());
        // another game has no ORFix to call
        let other = LintCtx::new(Some(root.clone()), Some(root.join("Mods")), false);
        assert!(lint_mod_ctx(&m, &read_mod(&m), &other, true).iter().all(|p| p.kind != "missing_orfix"));

        // the fix: the call goes right after the light map binding with the same indent, and the lines after stay
        let texts = orfix_texts(&m, true);
        assert_eq!(texts.len(), 1);
        assert_eq!(texts[0].0, "yelan.ini");
        assert_eq!(texts[0].1, yelan_fixed());
        let dress = texts[0].1.split("[TextureOverrideYelanDress]").nth(1).unwrap();
        let at = |needle: &str| dress.find(needle).unwrap_or_else(|| panic!("{needle}"));
        assert!(at("\tps-t1 =") < at(&format!("\t{NNFIX_LINE}")) && at(&format!("\t{NNFIX_LINE}")) < at("\tps-t69 =") && at("\tps-t69 =") < at(r"TexFx\Transparency.0"));

        // once the call is there it is a clean mod, and a second run adds nothing
        fs::write(m.join("yelan.ini"), &texts[0].1).unwrap();
        assert!(orfix_lint(&m, true).is_empty());
        assert!(orfix_texts(&m, true).is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn the_call_keeps_line_endings() {
        let root = loader_with_libs("orfixeol");
        let crlf = yelan().replace('\n', "\r\n");
        let m = yelan_mod(&root, crlf.as_bytes());
        let texts = orfix_texts(&m, true);
        assert_eq!(texts[0].1, yelan_fixed().replace('\n', "\r\n"));
        assert_eq!(texts[0].1.matches('\n').count(), texts[0].1.matches("\r\n").count());
        fs::write(m.join("yelan.ini"), yelan().as_bytes()).unwrap();
        let texts = orfix_texts(&m, true);
        assert_eq!(texts[0].1, yelan_fixed());
        assert!(!texts[0].1.contains('\r'));
        // a byte order mark stays, and a file that doesn't end in a line break still gets the call
        let mut bom = vec![0xEF, 0xBB, 0xBF];
        bom.extend_from_slice(THREE_SLOTS.trim_end().as_bytes());
        fs::write(m.join("yelan.ini"), &bom).unwrap();
        let wanted = vec!["yelan.ini".to_string()];
        let edits = orfix_edits(&m, &read_mod(&m), &LintCtx::near(&m), false, &wanted).unwrap();
        assert_eq!(edits[0].new, [&[0xEF, 0xBB, 0xBF][..], format!("{}\n{ORFIX_LINE}\n", THREE_SLOTS.trim_end()).as_bytes()].concat());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn three_slot_parts_get_orfix_and_two_slot_parts_nnfix_after_each_branch() {
        let root = loader_with_libs("orfixmix");
        let m = root.join("Mods/Varesa");
        fs::create_dir_all(&m).unwrap();
        let ini = "[TextureOverrideVaresaBody]\nhash = 11112222\nif $swap == 0\n    ps-t0 = ResourceBodyNormal\n    ps-t1 = ResourceBodyDiffuse\n    ps-t2 = ResourceBodyLightMap\n\
            else\n    ps-t0 = ResourceBodyNormal2\n    ps-t1 = ResourceBodyDiffuse2\n    ps-t2 = ref ResourceBodyLightMap2\n    drawindexed = auto\nendif\n\
            [TextureOverrideVaresaHead]\nhash = 33334444\nps-t0 = ResourceHeadDiffuse\nps-t1 = ResourceHeadLightMap\nps-t3 = ResourceHeadShadow\n\
            [TextureOverrideVaresaSword]\nhash = 55556666\nps-t0 = ResourceSwordDiffuse\nps-t1 = ps-t0\n";
        fs::write(m.join("varesa.ini"), ini).unwrap();
        let expected = "[TextureOverrideVaresaBody]\nhash = 11112222\nif $swap == 0\n    ps-t0 = ResourceBodyNormal\n    ps-t1 = ResourceBodyDiffuse\n    ps-t2 = ResourceBodyLightMap\n    run = CommandList\\global\\ORFix\\ORFix\n\
            else\n    ps-t0 = ResourceBodyNormal2\n    ps-t1 = ResourceBodyDiffuse2\n    ps-t2 = ref ResourceBodyLightMap2\n    run = CommandList\\global\\ORFix\\ORFix\n    drawindexed = auto\nendif\n\
            [TextureOverrideVaresaHead]\nhash = 33334444\nps-t0 = ResourceHeadDiffuse\nps-t1 = ResourceHeadLightMap\nrun = CommandList\\global\\ORFix\\NNFix\nps-t3 = ResourceHeadShadow\n\
            [TextureOverrideVaresaSword]\nhash = 55556666\nps-t0 = ResourceSwordDiffuse\nps-t1 = ps-t0\n";
        assert_eq!(orfix_texts(&m, true)[0].1, expected);
        // not a character: the three-slot body still gets the call, the two-slot head does not
        let body_only = expected.replace("ps-t1 = ResourceHeadLightMap\nrun = CommandList\\global\\ORFix\\NNFix\n", "ps-t1 = ResourceHeadLightMap\n");
        assert_eq!(orfix_texts(&m, false)[0].1, body_only);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_character_mod_that_never_calls_orfix_is_flagged() {
        let root = loader_with_libs("orfix");
        let case = |name: &str, files: &[(&str, &str)]| {
            let m = root.join("Mods").join(name);
            fs::create_dir_all(&m).unwrap();
            for (f, text) in files { fs::write(m.join(f), text).unwrap(); }
            m
        };

        // three slots, no call anywhere: one warning with the fix attached, character or not
        let m = case("plain", &[("varesa.ini", THREE_SLOTS)]);
        let p = orfix_problems(&m);
        assert_eq!(p.len(), 1, "{p:?}");
        assert_eq!(p[0].severity, "warn");
        assert_eq!(p[0].ini.as_deref(), Some("varesa.ini"));
        assert_eq!(p[0].detail, "varesa.ini sets the textures of TextureOverrideVaresaBody by slot, and nothing in the mod calls ORFix. Outlines and reflections can show the wrong colors in game. Adding the call fixes it");
        assert_eq!(p[0].fix, Some(ProblemFix { kind: "orfix".into(), ini: Some("varesa.ini".into()), from: None, to: None, inis: vec!["varesa.ini".into()] }));
        assert!(!p[0].detail.split_whitespace().any(|w| w.eq_ignore_ascii_case("its")) && !p[0].detail.contains('\u{2014}'));
        assert_eq!(orfix_lint(&m, true).len(), 1);

        // several inis name each one
        let m = case("two", &[("a.ini", THREE_SLOTS), ("b.ini", THREE_SLOTS)]);
        let p = orfix_problems(&m);
        assert_eq!(p.len(), 1, "{p:?}");
        assert!(p[0].detail.starts_with("a.ini and b.ini set the textures of TextureOverrideVaresaBody by slot"), "{}", p[0].detail);
        assert_eq!(p[0].fix.as_ref().map(|f| f.inis.clone()), Some(vec!["a.ini".to_string(), "b.ini".to_string()]));

        // bindings inside gachamod's live wrapping, and `ref` in any case followed by a space, still count
        let wrapped = "[TextureOverrideBody]\nhash = 11112222\nif $\\gachamod\\live\\g1 == 5\nps-t0 = Ref ResourceN\nps-t1 = REF\tResourceD\nps-t2 = ref ResourceL\nendif\n";
        assert_eq!(orfix_problems(&case("wrapped", &[("w.ini", wrapped)])).len(), 1);
        // "ref" glued to the name is a different word, so that slot isn't a resource
        let glued = "[TextureOverrideBody]\nhash = 11112222\nps-t0 = RefResourceN\nps-t1 = ResourceD\nps-t2 = ResourceL\n";
        assert!(orfix_problems(&case("glued", &[("g.ini", glued)])).is_empty());

        // a call to ORFix or NNFix anywhere in the mod, even in another ini, means the author handled it
        let call = "[TextureOverrideHead]\nhash = 33334444\nps-t1 = ResourceHeadD\nrun = CommandList\\global\\ORFix\\ORFix\n";
        assert!(orfix_problems(&case("called", &[("varesa.ini", THREE_SLOTS), ("head.ini", call)])).is_empty());
        let nn = "[TextureOverrideHead]\nhash = 33334444\nrun = CommandList\\global\\ORFix\\NNFix\n";
        assert!(orfix_problems(&case("nnfix", &[("varesa.ini", THREE_SLOTS), ("head.ini", nn)])).is_empty());
        // slashes and capitals don't matter
        let slashes = "[TextureOverrideHead]\nhash = 33334444\nrun = commandlist/Global/orfix/nnfix\n";
        assert!(orfix_problems(&case("slashes", &[("varesa.ini", THREE_SLOTS), ("head.ini", slashes)])).is_empty());
        // one part that calls and others that don't: the author handled it, nothing is flagged
        let partial = format!("{THREE_SLOTS}{ORFIX_LINE}\n[TextureOverrideVaresaDress]\nhash = 99990000\nps-t0 = ResourceN\nps-t1 = ResourceD\nps-t2 = ResourceL\n");
        assert!(orfix_problems(&case("partial", &[("varesa.ini", partial.as_str())])).is_empty());
        // the GIMI API runs ORFix itself
        let api = "[ResourceGIMIDiffuse]\nfilename = d.dds\n[TextureOverrideBody]\nhash = 55556666\nResource\\GIMI\\Diffuse = ref ResourceGIMIDiffuse\nrun = CommandList\\GIMI\\SetTextures\n";
        assert!(orfix_problems(&case("api", &[("varesa.ini", THREE_SLOTS), ("api.ini", api)])).is_empty());

        // a call that is only in a comment, after a `;`, in a file name or in a variable name is no call
        let commented = format!("{THREE_SLOTS};{ORFIX_LINE}\n");
        assert_eq!(orfix_problems(&case("commented", &[("varesa.ini", commented.as_str())])).len(), 1);
        let after = format!("{THREE_SLOTS}run = CommandListOther ; {ORFIX_LINE}\n");
        assert_eq!(orfix_problems(&case("after", &[("varesa.ini", after.as_str())])).len(), 1);
        let named = format!("{THREE_SLOTS}[ResourceORFixLookalike]\nfilename = ORFix.dds\n$orfix_done = 1\n");
        assert_eq!(orfix_problems(&case("named", &[("varesa.ini", named.as_str())])).len(), 1);

        // two slots: a character needs NNFix, a weapon or an item (no character) is never judged by them
        let two = "[TextureOverrideSword]\nhash = 11112222\nps-t0 = ResourceD\nps-t1 = ResourceL\nps-t70 = ResourceOutline\n";
        let sword = case("two-slots", &[("sword.ini", two)]);
        assert!(orfix_problems(&sword).is_empty());
        assert_eq!(orfix_lint(&sword, true).len(), 1);
        // a slot that isn't set to a resource doesn't count
        let copy = "[TextureOverrideBody]\nhash = 11112222\nps-t0 = ResourceN\nps-t1 = ResourceD\nps-t2 = ps-t0\n";
        assert!(orfix_lint(&case("copy", &[("c.ini", copy)]), true).is_empty());
        // a shadow isn't a texture
        let shadow = "[TextureOverrideBody]\nhash = 11112222\nps-t0 = ResourceN\nps-t1 = ResourceBodyShadow\nps-t2 = ResourceL\n";
        assert!(orfix_lint(&case("shadow", &[("s.ini", shadow)]), true).is_empty());
        // a face never gets the call
        let face = "[TextureOverrideVaresaFace]\nhash = 11112222\nps-t0 = ResourceN\nps-t1 = ResourceD\nps-t2 = ResourceL\n";
        assert!(orfix_lint(&case("face", &[("face.ini", face)]), true).is_empty());

        // a copy of the library inside a mod: the mod is left to the duplicate library warning
        let lib = "namespace = global\\ORFix\n[CommandListORFix]\nps-t0 = ResourceN\nps-t1 = ResourceD\nps-t2 = ResourceL\n";
        assert!(orfix_problems(&case("libcopy", &[("ORFix.ini", lib), ("varesa.ini", THREE_SLOTS)])).is_empty());

        // the loader's own folder is the library, not a mod
        let core = root.join("Core/GIMI/Libraries/Other");
        fs::create_dir_all(&core).unwrap();
        fs::write(core.join("other.ini"), THREE_SLOTS).unwrap();
        assert!(orfix_problems(&core).is_empty());

        // a loader without the ORFix library (an old install, or another game) can't say what is missing
        let bare = temp("orfix-bare");
        fs::write(bare.join("d3dx.ini"), "[Loader]\n").unwrap();
        fs::create_dir_all(bare.join("Mods/Varesa")).unwrap();
        fs::write(bare.join("Mods/Varesa/varesa.ini"), THREE_SLOTS).unwrap();
        assert!(orfix_problems(&bare.join("Mods/Varesa")).is_empty());
        // and a mod outside any loader has no libraries to check
        let alone = temp("orfix-alone");
        fs::write(alone.join("varesa.ini"), THREE_SLOTS).unwrap();
        assert!(orfix_problems(&alone).is_empty());
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&bare);
        let _ = fs::remove_dir_all(&alone);
    }

    #[test]
    fn the_orfix_fix_backs_up_and_undoes() {
        let root = loader_with_libs("orfixfix");
        let mods = root.join("Mods");
        fs::create_dir_all(mods.join("Varesa")).unwrap();
        let path = mods.join("Varesa/varesa.ini");
        let original = THREE_SLOTS.replace('\n', "\r\n");
        fs::write(&path, &original).unwrap();
        let db = crate::db::Db::open(&root.join("gachamod.db")).unwrap();
        crate::games::save_paths(&db, "gi", &crate::games::GamePaths { mods_dir: Some(mods.to_string_lossy().into_owned()), ..Default::default() }).unwrap();
        let shared = Arc::new(Mutex::new(db));
        let id = library::scan(&shared, "gi").unwrap()[0].id.clone();
        let db = shared.lock().unwrap();
        let flagged = lint(&db, "gi").unwrap().into_iter().flat_map(|m| m.problems).filter(|p| p.kind == "missing_orfix").collect::<Vec<_>>();
        assert_eq!(flagged.len(), 1, "{flagged:?}");
        let fix = flagged[0].fix.clone().expect("the problem has a fix");

        let b = apply_fix(&db, "gi", &id, &fix).unwrap();
        assert_eq!(b.label, "Added the ORFix call to varesa.ini");
        assert_eq!(b.files, vec!["varesa.ini".to_string()]);
        let fixed = format!("{original}{ORFIX_LINE}\r\n");
        assert_eq!(fs::read_to_string(&path).unwrap(), fixed);
        assert!(lint(&db, "gi").unwrap().into_iter().flat_map(|m| m.problems).all(|p| p.kind != "missing_orfix"));

        // a second click finds the call there and changes nothing
        let err = apply_fix(&db, "gi", &id, &fix).unwrap_err();
        assert!(matches!(err, Error::Invalid(_)), "{err:?}");
        assert_eq!(fs::read_to_string(&path).unwrap(), fixed);

        // Undo puts the file back byte for byte
        crate::backups::restore(&db, &b.id).unwrap();
        assert_eq!(fs::read(&path).unwrap(), original.as_bytes());
        assert_eq!(lint(&db, "gi").unwrap().into_iter().flat_map(|m| m.problems).filter(|p| p.kind == "missing_orfix").count(), 1);
        drop(db);
        drop(shared);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn the_orfix_fix_refuses_files_it_cannot_keep_exactly() {
        let root = loader_with_libs("orfixexact");
        let m = root.join("Mods/Varesa");
        fs::create_dir_all(&m).unwrap();
        // UTF-16 text with a stray byte can't be written back as it was
        let mut odd = vec![0xFF, 0xFE];
        odd.extend(THREE_SLOTS.encode_utf16().flat_map(|u| u.to_le_bytes()));
        odd.push(0x41);
        fs::write(m.join("varesa.ini"), &odd).unwrap();
        let wanted = vec!["varesa.ini".to_string()];
        let err = orfix_edits(&m, &read_mod(&m), &LintCtx::near(&m), true, &wanted).unwrap_err();
        assert!(err.to_string().contains("can't keep exactly"), "{err}");
        assert_eq!(fs::read(m.join("varesa.ini")).unwrap(), odd);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn merged_swap_values_get_names() {
        let d = temp("mergednames");
        for (f, ini) in [("Raiden", "Raiden.ini"), ("Raiden Kimono", "RaidenKimono.ini")] {
            fs::create_dir_all(d.join(f)).unwrap();
            fs::write(d.join(f).join(format!("DISABLED{ini}")), "[TextureOverrideBody]\nhash = 11112222\n").unwrap();
        }
        fs::write(d.join("merged.ini"), "; Merged Mod: .\\Raiden\\Raiden.ini, .\\Raiden Kimono\\RaidenKimono.ini\n\n[Constants]\nglobal persist $swapvar = 0\n\
            [KeySwap]\nkey = 5\ntype = cycle\n$swapvar = 0,1\n").unwrap();
        let r = inspect_dir(&d, &[], &LintCtx::near(&d), false);
        let v = r.vars.iter().find(|v| v.var == "swapvar").unwrap();
        assert_eq!(v.label, "Swap");
        assert_eq!(v.names.get("1").map(String::as_str), Some("Raiden Kimono"));
        assert_eq!(v.names.get("0").map(String::as_str), Some("Raiden"));
        assert!(r.merged.is_some_and(|m| m.blocked.is_none()));
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn hashes_normalise() {
        assert_eq!(norm_hash("0xABCDEF12").as_deref(), Some("abcdef12"));
        assert_eq!(norm_hash(" 1234 ").as_deref(), Some("00001234"));
        assert_eq!(norm_hash("0123456789abcdef").as_deref(), Some("0123456789abcdef"));
        assert!(norm_hash("xyz").is_none());
        assert!(norm_hash("").is_none());
    }
}
