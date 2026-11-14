//! Switching a character's skins in game without a reload (docs/ingame.md 7.1 and 7.2).
//!
//! A live group is one character's mods. All of them stay loaded, and each mod's draw sections only run while the
//! group's number in `Mods\gachamod live\live.ini` equals that mod's slot, so changing the number swaps the skin at
//! once. While the game runs the app sets the number with one key tap (Clear+F13) while the cursor is held at
//! (slot, group): 3DMigoto reads the cursor as `cursor_screen_x/y`. With the game closed it writes the saved value.
//!
//! The ini edits are fenced (`; gachamod:begin` ... `; gachamod:end`, `; gachamod:was` before a changed key condition,
//! `; gachamod:added` before an added line) so taking a mod out again removes exactly what was added. Files are read
//! byte for byte (each byte one char), so text in any encoding comes back unchanged. Owner: INGAME area.

use crate::backups;
use crate::db::Db;
use crate::error::{Error, Result};
use crate::keys::{ModBackup, ModSkip};
use crate::model::ModEntry;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

/// The folder under Mods that holds live.ini. The library scan skips it.
pub const DIR: &str = "gachamod live";
const BEGIN: &str = "; gachamod:begin";
const END: &str = "; gachamod:end";
const WAS: &str = "; gachamod:was ";
const ADDED: &str = "; gachamod:added";
/// Cursor coordinates carry the numbers, so they stay under the smallest screen size.
const MAX_GROUPS: u32 = 600;
const MAX_SLOTS: u32 = 600;

fn gate(group: u32, slot: u32) -> String { format!("$\\gachamod\\live\\g{group} == {slot}") }
fn var_name(group: u32) -> String { format!("gachamod\\live\\g{group}") }

// ── what the app remembers (setting "live.<game>") ──

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct Store { groups: Vec<GroupRec> }

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
pub struct LiveGroup { pub group: u32, pub character: String, pub active: u32, pub mods: Vec<LiveMod> }

/// A character with two or more mods that aren't all live yet.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LiveReady { pub character: String, pub mods: Vec<LiveMod> }

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LiveInfo { pub groups: Vec<LiveGroup>, pub ready: Vec<LiveReady>, pub running: bool }

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
    /// The game is running: the caller sends the pick with `send`.
    pub send: bool,
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
            "expand_region_copy", "deny_cpu_read", "stereomode"].contains(&key);
    }
    if section.starts_with("shaderoverride") {
        return ["hash", "allow_duplicate_hash", "depth_filter", "partner", "model", "disable_scissor", "filter_index", "iteration"].contains(&key);
    }
    if section.starts_with("shaderregex") { return ["shader_model", "temps", "filter_index"].contains(&key); }
    false
}

fn ending(line: &str) -> &'static str { if line.ends_with("\r\n") { "\r\n" } else if line.ends_with('\n') { "\n" } else { "" } }

/// Take out everything `wrap` added, exactly.
pub fn unwrap(text: &str) -> String {
    let lines: Vec<&str> = text.split_inclusive('\n').collect();
    let mut drop = vec![false; lines.len()];
    let mut replace: HashMap<usize, String> = HashMap::new();
    for (i, l) in lines.iter().enumerate() {
        let t = l.trim();
        if t == BEGIN {
            drop[i] = true;
            if lines.get(i + 1).is_some_and(|n| n.trim().starts_with("if $\\gachamod\\live\\")) { drop[i + 1] = true; }
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
    let text = unwrap(text);
    let nl = if text.contains("\r\n") || !text.contains('\n') { "\r\n" } else { "\n" };
    let g = gate(group, slot);
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
            let mut depth = 0i32;
            for l in body {
                let t = l.trim().to_ascii_lowercase();
                if t.starts_with("if ") { depth += 1; }
                if t == "endif" { depth -= 1; }
                if depth < 0 { break; }
            }
            if depth != 0 { return Err(format!("its [{}] section has an if without an endif (or the other way round)", lines[h.unwrap_or(0)].trim().trim_matches(['[', ']']))); }
            let keys: HashSet<String> = body.iter().filter_map(|l| line_key(l)).collect();
            // settings stay above the gate
            for l in body.iter().filter(|l| line_key(l).is_some_and(|k| setting(&name, &k))) { out.push_str(&with_nl(l)); }
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
                    out.push_str(&format!("{BEGIN}{nl}if {g}{nl}"));
                    for &j in rest.iter().filter(|&&j| j <= last) { out.push_str(&with_nl(body[j])); }
                    out.push_str(&format!("endif{nl}{END}{nl}"));
                    for &j in rest.iter().filter(|&&j| j > last) { out.push_str(body[j]); }
                }
                None => for &j in &rest { out.push_str(body[j]); },
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
                            out.push_str(&format!("{WAS}{}{nl}condition = ({value}) && {g}{}", old.trim(), if ending(l).is_empty() { nl } else { ending(l) }));
                        } else { out.push_str(l); }
                    }
                }
                None => {
                    out.push_str(&format!("{WAS}-{nl}condition = {g}{nl}"));
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
        return Some("No Reload Mod Manager manages it. Restore it there first".into());
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

/// The new text of each of a mod's inis, gated on (group, slot).
fn plan(m: &ModEntry, group: u32, slot: u32) -> std::result::Result<Vec<Edit>, String> {
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
    for (abs, rel, text) in inis {
        let new = wrap(&text, group, slot).map_err(|e| format!("in {rel}, {e}"))?;
        if let Some(new) = new { if new != text { out.push(Edit { abs, rel, bytes: to_bytes(&new) }); } }
    }
    if !out.iter().any(|e| to_text(&e.bytes).contains(BEGIN)) { return Err("it doesn't replace anything gachamod can switch".into()); }
    Ok(out)
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

fn live_ini(store: &Store) -> String {
    let nl = "\r\n";
    let mut s = String::new();
    s.push_str(&format!("; gachamod writes this file to switch skins in game without a reload. Your changes here are replaced.{nl}"));
    s.push_str(&format!("namespace = gachamod\\live{nl}{nl}[Constants]{nl}"));
    for g in &store.groups { s.push_str(&format!("global persist $g{} = {}{nl}", g.n, g.active)); }
    s.push_str(&format!("{nl}; the app holds the cursor at (slot, group) and taps Clear+F13{nl}"));
    s.push_str(&format!("[KeyGachamodPick]{nl}key = VK_CLEAR VK_F13{nl}run = CommandListGachamodPick{nl}{nl}[CommandListGachamodPick]{nl}"));
    for g in &store.groups {
        s.push_str(&format!("if cursor_screen_y == {}{nl}  $g{} = cursor_screen_x{nl}endif{nl}", g.n, g.n));
    }
    s
}

fn write_live_ini(db: &Db, game: &str, store: &Store) -> Result<()> {
    let dir = crate::games::mods_dir(db, game)?.join(DIR);
    let file = dir.join("live.ini");
    if store.groups.is_empty() {
        let _ = std::fs::remove_file(&file);
        let _ = std::fs::remove_dir(&dir);
        return Ok(());
    }
    std::fs::create_dir_all(&dir)?;
    crate::xxmi::write_atomic(&file, live_ini(store).as_bytes())
}

/// With the game closed, the saved value is what it loads next time (it wins over live.ini's default).
fn save_active(db: &Db, game: &str, g: &GroupRec) {
    if crate::launch::running(game) { return; }
    if let Ok(imp) = crate::games::importer_dir(db, game) { let _ = crate::ini::set_user_value(&imp, &var_name(g.n), &g.active.to_string()); }
}

// ── the API ──

/// Mod id -> live group, for the library (live mods of one group don't conflict and stay on together).
pub fn groups_by_mod(db: &Db, game: &str) -> HashMap<String, u32> {
    load(db, game).groups.iter().flat_map(|g| g.slots.iter().map(move |s| (s.mod_id.clone(), g.n))).collect()
}

fn live_mod(m: Option<&ModEntry>, id: &str, slot: u32) -> LiveMod {
    LiveMod {
        mod_id: id.to_string(), slot,
        name: m.map(|m| m.name.clone()).unwrap_or_else(|| "A mod that's gone".into()),
        enabled: m.is_some_and(|m| m.enabled), preview: m.and_then(|m| m.preview.clone()),
    }
}

pub fn info(db: &Db, game: &str) -> Result<LiveInfo> {
    let mods = crate::library::list(db, game)?;
    let by_id: HashMap<&str, &ModEntry> = mods.iter().map(|m| (m.id.as_str(), m)).collect();
    let mut store = load(db, game);
    let running = crate::launch::running(game);
    // with the game closed, its saved values are what it will load: show those
    if !running {
        if let Ok(imp) = crate::games::importer_dir(db, game) {
            for g in &mut store.groups {
                if let Some(v) = crate::ini::user_value(&imp, &var_name(g.n)).and_then(|v| v.parse::<f64>().ok()) { g.active = v.max(0.0) as u32; }
            }
        }
    }
    let live: HashSet<&str> = store.groups.iter().flat_map(|g| g.slots.iter().map(|s| s.mod_id.as_str())).collect();
    let groups = store.groups.iter().map(|g| LiveGroup {
        group: g.n, character: g.character.clone(), active: g.active,
        mods: g.slots.iter().map(|s| live_mod(by_id.get(s.mod_id.as_str()).copied(), &s.mod_id, s.slot)).collect(),
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
    Ok(LiveInfo { groups, ready, running })
}

/// Make mods live: each joins its character's group (made when missing). Mods that are off get turned on, since
/// every live mod has to be loaded; the one that was on stays the one showing. Takes a reload to start working.
pub fn add(db: &Db, game: &str, ids: &[String]) -> Result<LiveChange> {
    let mods = crate::library::list(db, game)?;
    let by_id: HashMap<&str, &ModEntry> = mods.iter().map(|m| (m.id.as_str(), m)).collect();
    let mut store = load(db, game);
    let mut out = LiveChange::default();
    let mut touched: HashSet<u32> = HashSet::new();
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
                store.groups.len() - 1
            }
        };
        let (n, slot) = (store.groups[gi].n, store.groups[gi].next.max(1));
        if slot > MAX_SLOTS { out.skipped.push(skip(format!("{ch} has too many live mods already"))); continue; }
        let edits = match plan(m, n, slot) {
            Ok(e) => e,
            Err(reason) => {
                out.skipped.push(skip(reason));
                if store.groups[gi].slots.is_empty() { store.groups.remove(gi); }
                continue;
            }
        };
        let rels: Vec<String> = edits.iter().map(|e| e.rel.clone()).collect();
        let backup = backups::take(db, game, &m.id, Path::new(&m.path), &rels, &format!("Before switching {} in game", m.name))?;
        let mut failed = None;
        for e in &edits { if let Err(err) = crate::xxmi::write_atomic(&e.abs, &e.bytes) { failed = Some(err); break; } }
        if let Some(err) = failed {
            let _ = backups::restore(db, &backup.id);
            out.skipped.push(skip(format!("couldn't save its ini: {err}")));
            if store.groups[gi].slots.is_empty() { store.groups.remove(gi); }
            continue;
        }
        let g = &mut store.groups[gi];
        g.next = slot + 1;
        g.slots.push(SlotRec { slot, mod_id: m.id.clone() });
        if m.enabled && g.active == 0 { g.active = slot; }
        touched.insert(n);
        if !m.enabled { out.turned_on.push(m.id.clone()); }
        out.changed.push(m.id.clone());
        out.backups.push(ModBackup { mod_id: m.id.clone(), name: m.name.clone(), backup });
    }
    if out.changed.is_empty() {
        if let Some(s) = out.skipped.first() { return Err(Error::Invalid(format!("{} can't be switched in game: {}", s.name, s.reason))); }
        return Ok(out);
    }
    save(db, game, &store)?;
    write_live_ini(db, game, &store)?;
    for g in store.groups.iter().filter(|g| touched.contains(&g.n)) { save_active(db, game, g); }
    if !out.turned_on.is_empty() {
        let on: Vec<(String, bool)> = out.turned_on.iter().map(|i| (i.clone(), true)).collect();
        crate::library::apply_states(db, game, &on)?;
    }
    crate::devtools::mark_changed(game);
    Ok(out)
}

/// Stop switching mods live: their gates come out. The one showing stays on; the others are turned off, so the
/// character doesn't wear two skins at once.
pub fn remove(db: &Db, game: &str, ids: &[String]) -> Result<LiveChange> {
    let mods = crate::library::list(db, game)?;
    let by_id: HashMap<&str, &ModEntry> = mods.iter().map(|m| (m.id.as_str(), m)).collect();
    let mut store = load(db, game);
    let mut out = LiveChange::default();
    let wanted: HashSet<&str> = ids.iter().map(String::as_str).collect();
    for g in &mut store.groups {
        let mut keep = Vec::new();
        for s in std::mem::take(&mut g.slots) {
            if !wanted.contains(s.mod_id.as_str()) { keep.push(s); continue; }
            if let Some(m) = by_id.get(s.mod_id.as_str()).copied() {
                let edits = unplan(m);
                if !edits.is_empty() {
                    let rels: Vec<String> = edits.iter().map(|e| e.rel.clone()).collect();
                    let backup = backups::take(db, game, &m.id, Path::new(&m.path), &rels, &format!("Before {} stopped switching in game", m.name))?;
                    for e in &edits { crate::xxmi::write_atomic(&e.abs, &e.bytes)?; }
                    out.backups.push(ModBackup { mod_id: m.id.clone(), name: m.name.clone(), backup });
                }
                if m.enabled && g.active != s.slot { out.turned_off.push(m.id.clone()); }
            }
            if g.active == s.slot { g.active = 0; }
            out.changed.push(s.mod_id.clone());
        }
        g.slots = keep;
    }
    store.groups.retain(|g| !g.slots.is_empty());
    save(db, game, &store)?;
    write_live_ini(db, game, &store)?;
    if !out.turned_off.is_empty() {
        let off: Vec<(String, bool)> = out.turned_off.iter().map(|i| (i.clone(), false)).collect();
        crate::library::apply_states(db, game, &off)?;
    }
    crate::devtools::mark_changed(game);
    Ok(out)
}

/// A mod of `character` that isn't live was turned on (library one-skin rule): the character's live group shows
/// none of its mods from then on, so the character doesn't wear two skins. A note for the toast when it changed.
pub(crate) fn hide_group(db: &Db, game: &str, character: &str) -> Option<String> {
    let mut store = load(db, game);
    let g = store.groups.iter_mut().find(|g| g.character.eq_ignore_ascii_case(character) && g.active != 0)?;
    // the running game keeps its pick until it's sent one, so say what to do instead of changing it here
    if crate::launch::running(game) {
        return Some(format!("{character} has live skins too. Pick None for {character} in Tools, In game so only this one shows"));
    }
    g.active = 0;
    let g = g.clone();
    save(db, game, &store).ok()?;
    let _ = write_live_ini(db, game, &store);
    save_active(db, game, &g);
    Some(format!("Set {character}'s live skins to none, so only this one shows"))
}

/// Pick what a group shows (slot 0: none of its mods). Saved for the next start; while the game runs the caller
/// sends it with `send`.
pub fn pick(db: &Db, game: &str, group: u32, slot: u32) -> Result<Picked> {
    let mut store = load(db, game);
    let Some(g) = store.groups.iter_mut().find(|g| g.n == group) else { return Err(Error::Invalid("That character isn't switched live any more".into())) };
    let mut out = Picked::default();
    if slot != 0 {
        let Some(s) = g.slots.iter().find(|s| s.slot == slot) else { return Err(Error::Invalid("That mod isn't switched live any more".into())) };
        let m = crate::library::get(db, game, &s.mod_id)?;
        if !m.enabled {
            crate::library::apply_states(db, game, &[(m.id.clone(), true)])?;
            out.reload = true;
        }
    }
    g.active = slot;
    let g = g.clone();
    save(db, game, &store)?;
    write_live_ini(db, game, &store)?;
    save_active(db, game, &g);
    out.send = crate::launch::running(game);
    Ok(out)
}

/// Tell the running game: bring it to the front, hold the cursor at (slot, group) and tap Clear+F13.
pub fn send(game: &str, group: u32, slot: u32) -> Result<()> {
    if std::env::var_os("GACHAMOD_NO_RELOAD").is_some() { return Ok(()); }
    crate::devtools::focus_game(game)?;
    win::tap(slot as i32, group as i32);
    Ok(())
}

#[cfg(windows)]
mod win {
    use crate::devtools::win::{key, send};
    use windows_sys::Win32::Foundation::{POINT, RECT};
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{VK_CLEAR, VK_F13};
    use windows_sys::Win32::UI::WindowsAndMessaging::{ClipCursor, GetClipCursor, GetCursorPos, SetCursorPos};

    pub fn tap(x: i32, y: i32) {
        let pause = |ms| std::thread::sleep(std::time::Duration::from_millis(ms));
        let mut was = POINT { x: 0, y: 0 };
        let mut clip = RECT { left: 0, top: 0, right: 0, bottom: 0 };
        // SAFETY: plain cursor calls with live locals; the clip and position are put back before returning.
        unsafe {
            GetCursorPos(&mut was);
            let had_clip = GetClipCursor(&mut clip) != 0;
            SetCursorPos(x, y);
            // the game may pull the cursor back to its centre every frame: the clip holds it at (x, y)
            let one = RECT { left: x, top: y, right: x + 1, bottom: y + 1 };
            ClipCursor(&one);
            pause(40);
            send(&[key(VK_CLEAR, false)]);
            pause(30);
            send(&[key(VK_F13, false)]);
            pause(110);
            send(&[key(VK_F13, true)]);
            pause(30);
            send(&[key(VK_CLEAR, true)]);
            pause(30);
            ClipCursor(if had_clip { &clip } else { std::ptr::null() });
            SetCursorPos(was.x, was.y);
        }
    }
}

#[cfg(not(windows))]
mod win { pub fn tap(_x: i32, _y: i32) {} }

#[cfg(test)]
mod tests {
    use super::*;

    const INI: &str = "[Constants]\r\nglobal persist $swap = 0\r\n\r\n[KeySwap]\r\ncondition = $active == 1\r\nkey = VK_DOWN\r\ntype = cycle\r\n$swap = 0,1\r\n\r\n\
[KeyPlain]\r\nkey = VK_UP\r\n$swap = 1\r\n\r\n[TextureOverrideBody]\r\nhash = 1a2b3c4d\r\nmatch_first_index = 0\r\nib = ResourceBodyIB\r\n; colour\r\nps-t0 = ResourceBodyDiffuse\r\n\
if $swap == 1\r\n  drawindexed = auto\r\nendif\r\n\r\n[TextureOverrideHead]\r\nhash = 5e6f7a8b\r\nvb0 = ResourceHead\r\n\r\n[ResourceBodyIB]\r\nfilename = Body.ib\r\n";

    #[test]
    fn wrap_gates_and_unwrap_restores() {
        let w = wrap(INI, 7, 3).unwrap().unwrap();
        assert!(w.contains("[TextureOverrideBody]\r\nhash = 1a2b3c4d\r\nmatch_first_index = 0\r\n; gachamod:begin\r\nif $\\gachamod\\live\\g7 == 3\r\nib = ResourceBodyIB\r\n; colour\r\n"));
        assert!(w.contains("  drawindexed = auto\r\nendif\r\nendif\r\n; gachamod:end\r\n\r\n[TextureOverrideHead]"));
        // no match_ key: the duplicate-hash warning is quieted
        assert!(w.contains("[TextureOverrideHead]\r\nhash = 5e6f7a8b\r\n; gachamod:added\r\nmatch_priority = 0\r\n; gachamod:begin\r\n"));
        assert!(w.contains("; gachamod:was condition = $active == 1\r\ncondition = ($active == 1) && $\\gachamod\\live\\g7 == 3\r\n"));
        assert!(w.contains("[KeyPlain]\r\n; gachamod:was -\r\ncondition = $\\gachamod\\live\\g7 == 3\r\nkey = VK_UP"));
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
        // wrapping twice (another slot) is the same as once
        let again = wrap(&w, 7, 5).unwrap().unwrap();
        assert_eq!(again, wrap(INI, 7, 5).unwrap().unwrap());
        assert!(!again.contains("g7 == 3"));
    }

    #[test]
    fn unbalanced_ifs_are_refused() {
        let bad = "[TextureOverrideX]\nhash = 1\nif $a == 1\nib = R\n";
        assert!(wrap(bad, 1, 1).is_err());
    }

    #[test]
    fn bytes_round_trip() {
        let b: Vec<u8> = vec![b'a', 0xE4, 0xBD, 0xA0, 0xB0, b'\r', b'\n'];
        assert_eq!(to_bytes(&to_text(&b)), b);
    }

    #[test]
    fn live_ini_reads_the_cursor() {
        let s = Store { groups: vec![GroupRec { n: 2, character: "Ellen".into(), active: 4, next: 5, slots: vec![] }] };
        let t = live_ini(&s);
        assert!(t.contains("namespace = gachamod\\live\r\n"));
        assert!(t.contains("global persist $g2 = 4\r\n"));
        assert!(t.contains("key = VK_CLEAR VK_F13\r\nrun = CommandListGachamodPick"));
        assert!(t.contains("if cursor_screen_y == 2\r\n  $g2 = cursor_screen_x\r\nendif"));
    }
}
