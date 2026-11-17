//! A mod's keys as an editable list, and edits to them in the mod's own .ini files: rebind a key (keyboard or pad),
//! turn one off, put the author's keys back, and make the keys work only while the mod's character is on screen.
//! Also key clashes between enabled mods. Owner: KEYBINDS area (docs/spec.md, "Mod internals").
//!
//! Edits are made in place, line by line: comments, order, blank lines, text encoding and line endings stay as they
//! were. Every line gachamod changes keeps what it replaced in a comment line right above it, so the file alone says
//! how to undo it (also after the app's own backups are gone):
//!
//! ```ini
//! [KeySwap]
//! ; gachamod added the next line (keys only while on screen)
//! condition = $gachamod_onscreen == 1
//! ; gachamod changed this key. It was: key = VK_DOWN
//! key = VK_F6
//! ; gachamod turned this key off: back = VK_UP
//! ```
//!
//! "Only while on screen" is the pattern most mods already use: a flag set to 1 in the section that draws the
//! character, set back to 0 in [Present] after each frame, and `condition = $flag == 1` on the keys. 3DMigoto runs
//! the draws, then the keys, then the `post` lines, so a key only fires in a frame where the character was drawn.
//! Before each write the files go through `crate::backups`, which is what the app's Undo restores, and
//! `crate::originals` keeps the author's copy from before the first change. When a write leaves a file with none of
//! gachamod's markers, that copy is what gets written, byte for byte, so taking a change out never depends on the
//! markers alone.

use crate::backups::{self, Backup};
use crate::db::Db;
use crate::error::{Error, Result};
use crate::ini::{self, KeyVar};
use crate::model::ModEntry;
use crate::originals;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};

// ── what the UI gets ──

/// One `key =` or `back =` line of a key section.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KeyLine {
    /// "key" or "back" (the key that steps a cycle backwards).
    pub field: String,
    /// Its place among the section's lines of the same field, counting lines that are off.
    pub index: u32,
    /// As written now ("ctrl VK_F6", "XB_LEFT_SHOULDER XB_A").
    pub value: String,
    /// Readable ("Ctrl+F6", "Pad LB+Pad A").
    pub label: String,
    /// The author's line when gachamod changed it, and its readable form.
    pub original: Option<String>,
    pub original_label: Option<String>,
    pub off: bool,
    /// A controller binding (XB_ buttons only).
    pub pad: bool,
}

/// One key section (`[KeySwap]`).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyEntry {
    /// The .ini's path inside the mod folder, forward slashes.
    pub ini: String,
    pub section: String,
    /// "cycle", "toggle", "hold" or "activate".
    pub kind: String,
    /// What it changes, readable ("Jacket", "Hair, Hat"), from the variable and section names.
    pub name: String,
    pub vars: Vec<KeyVar>,
    /// The author's condition (gachamod's own part left out).
    pub condition: Option<String>,
    pub lines: Vec<KeyLine>,
    /// Every key line of the section is off.
    pub off: bool,
    /// It only works while the character is on screen (the author's condition or gachamod's).
    pub on_screen: bool,
}

/// A mod's keys and where it stands on "only while on screen".
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModKeys {
    pub mod_id: String,
    pub inis: Vec<String>,
    pub keys: Vec<KeyEntry>,
    /// "own": the mod already limits its keys itself; "on": gachamod did it; "partial": gachamod did it for some
    /// files; "off": keys work any time and the fix can be made; "cant": no section that draws the character was
    /// found; "global": the mod draws no character (a UI or effects mod); "none": no keys.
    pub on_screen: String,
    /// One sentence about `on_screen` when it needs saying.
    pub on_screen_note: Option<String>,
    /// gachamod changed or turned off some of the author's keys.
    pub changed: bool,
}

/// Which line to rebind.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyTarget { pub ini: String, pub section: String, pub field: String, pub index: u32 }

/// A section that draws the character, picked by hand or by the AI helper.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DrawRef { pub ini: String, pub section: String }

/// The result of a key edit: the keys now, the backup that undoes it (None when nothing changed) and a sentence for
/// the user when something needs saying.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyEdit { pub keys: ModKeys, pub backup: Option<Backup>, pub note: Option<String> }

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModBackup { pub mod_id: String, pub name: String, pub backup: Backup }

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModSkip { pub mod_id: String, pub name: String, pub reason: String }

/// "Only while on screen" for every mod of a game.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnScreenAll {
    pub changed: Vec<ModBackup>,
    /// Mods the fix couldn't be made for, with why (the AI helper can look at them).
    pub skipped: Vec<ModSkip>,
    /// Mods that already did it, or have no keys to change.
    pub already: u32,
}

/// A mod that has gachamod's on-screen check, so it can be taken out of just that one.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnScreenMod {
    pub mod_id: String,
    pub name: String,
    pub character: Option<String>,
    pub enabled: bool,
    /// Only some of its files have it ("partial").
    pub partial: bool,
}

/// One side of a key clash.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClashKey {
    pub mod_id: String,
    pub name: String,
    pub character: Option<String>,
    pub ini: String,
    pub section: String,
    pub field: String,
    pub index: u32,
    pub value: String,
    pub label: String,
    /// What the key does in that mod ("Jacket").
    pub what: String,
    pub on_screen: bool,
    /// The automatic "only while on screen" fix can be made for this mod.
    pub fixable: bool,
}

/// Keys that two or more enabled mods bind and that can fire together.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyClash { pub label: String, pub keys: Vec<ClashKey> }

/// The sections of one ini that may draw the character, for the AI helper (no other file contents).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IniOutline {
    pub ini: String,
    pub namespace: Option<String>,
    /// Key section names in this ini.
    pub keys: Vec<String>,
    pub sections: Vec<SectionOutline>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionOutline { pub section: String, pub lines: Vec<String> }

// ── markers ──

const KEY_WAS: &str = "; gachamod changed this key. It was: ";
const KEY_OFF: &str = "; gachamod turned this key off: ";
const OS_ADDED: &str = "; gachamod added the next line (keys only while on screen)";
const OS_WAS: &str = "; gachamod changed the next line (keys only while on screen). It was: ";
const OS_SECTION: &str = "; gachamod added this section (keys only while on screen)";
const FLAG: &str = "gachamod_onscreen";

fn marker<'a>(line: &'a str, prefix: &str) -> Option<&'a str> { line.trim_start().strip_prefix(prefix) }
fn is_marker(line: &str, exact: &str) -> bool { line.trim() == exact }

// ── a file, line by line ──

#[derive(Debug, Clone, Copy, PartialEq)]
enum Enc { Utf8, Utf8Bom, Bytes, Utf16Le, Utf16Be }

/// An ini's text as lines with their own endings, written back exactly as read apart from the lines changed.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Doc { enc: Enc, pub(crate) lines: Vec<String>, ends: Vec<&'static str>, nl: &'static str }

impl Doc {
    pub(crate) fn from_bytes(b: &[u8]) -> Doc {
        let utf16 = |rest: &[u8], le: bool| {
            let units: Vec<u16> = rest.chunks_exact(2).map(|c| if le { u16::from_le_bytes([c[0], c[1]]) } else { u16::from_be_bytes([c[0], c[1]]) }).collect();
            String::from_utf16_lossy(&units)
        };
        let (enc, text) = if let Some(r) = b.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
            (Enc::Utf8Bom, String::from_utf8_lossy(r).into_owned())
        } else if let Some(r) = b.strip_prefix(&[0xFF, 0xFE]) {
            (Enc::Utf16Le, utf16(r, true))
        } else if let Some(r) = b.strip_prefix(&[0xFE, 0xFF]) {
            (Enc::Utf16Be, utf16(r, false))
        } else {
            match std::str::from_utf8(b) {
                Ok(s) => (Enc::Utf8, s.to_string()),
                // GBK or Latin-1 comments: keep every byte as it is (each byte is one char here)
                Err(_) => (Enc::Bytes, b.iter().map(|&c| c as char).collect()),
            }
        };
        Doc::from_text(enc, &text)
    }

    fn from_text(enc: Enc, text: &str) -> Doc {
        let (mut lines, mut ends) = (Vec::new(), Vec::new());
        let mut rest = text;
        while !rest.is_empty() {
            match rest.find('\n') {
                Some(i) => {
                    let crlf = i > 0 && rest.as_bytes()[i - 1] == b'\r';
                    lines.push(rest[..if crlf { i - 1 } else { i }].to_string());
                    ends.push(if crlf { "\r\n" } else { "\n" });
                    rest = &rest[i + 1..];
                }
                None => { lines.push(rest.to_string()); ends.push(""); rest = ""; }
            }
        }
        let crlf = ends.iter().filter(|e| **e == "\r\n").count();
        let lf = ends.iter().filter(|e| **e == "\n").count();
        Doc { enc, lines, ends, nl: if lf > crlf { "\n" } else { "\r\n" } }
    }

    fn text(&self) -> String {
        let mut s = String::new();
        for (l, e) in self.lines.iter().zip(&self.ends) { s.push_str(l); s.push_str(e); }
        s
    }

    pub(crate) fn to_bytes(&self) -> Vec<u8> {
        let text = self.text();
        match self.enc {
            Enc::Utf8 => text.into_bytes(),
            Enc::Utf8Bom => [&[0xEF, 0xBB, 0xBF][..], text.as_bytes()].concat(),
            Enc::Bytes => text.chars().map(|c| if (c as u32) < 256 { c as u32 as u8 } else { b'?' }).collect(),
            Enc::Utf16Le => [0xFF, 0xFE].into_iter().chain(text.encode_utf16().flat_map(|u| u.to_le_bytes())).collect(),
            Enc::Utf16Be => [0xFE, 0xFF].into_iter().chain(text.encode_utf16().flat_map(|u| u.to_be_bytes())).collect(),
        }
    }

    pub(crate) fn insert(&mut self, at: usize, line: String) {
        // a line added after a last line without a newline needs one first
        if at > 0 && at == self.lines.len() && self.ends[at - 1].is_empty() { self.ends[at - 1] = self.nl; }
        self.lines.insert(at, line);
        self.ends.insert(at, self.nl);
    }

    fn remove(&mut self, at: usize) { self.lines.remove(at); self.ends.remove(at); }
}

#[derive(Debug, Clone)]
struct Sec { name: String, lower: String, head: usize, end: usize }

pub(crate) fn header_name(line: &str) -> Option<&str> {
    let t = line.trim();
    let r = t.strip_prefix('[')?;
    Some(r.find(']').map(|i| &r[..i]).unwrap_or(r).trim())
}

fn sections(doc: &Doc) -> Vec<Sec> {
    let mut out: Vec<Sec> = Vec::new();
    for (i, l) in doc.lines.iter().enumerate() {
        if let Some(name) = header_name(l) {
            if let Some(last) = out.last_mut() { last.end = i; }
            out.push(Sec { lower: name.to_lowercase(), name: name.to_string(), head: i, end: doc.lines.len() });
        }
    }
    out
}

/// `key = value` of a live line (not a comment): the lowercased key and the trimmed value.
pub(crate) fn kv(line: &str) -> Option<(String, &str)> {
    let t = line.trim();
    if t.is_empty() || t.starts_with(';') || t.starts_with('[') { return None; }
    let (k, v) = t.split_once('=')?;
    Some((k.trim().to_lowercase(), v.trim()))
}

fn is_key_section(lower: &str) -> bool { lower.starts_with("key") }
fn is_override(lower: &str) -> bool { lower.starts_with("textureoverride") || lower.starts_with("shaderoverride") }

/// One ini of a mod, read for editing.
struct IniDoc { rel: String, abs: PathBuf, raw: Vec<u8>, doc: Doc }

impl IniDoc {
    /// Writing it back unchanged gives the same bytes (false for broken text that can't be kept exactly).
    fn exact(&self) -> bool { Doc::from_bytes(&self.raw).to_bytes() == self.raw }
    fn changed(&self) -> bool { self.doc.to_bytes() != self.raw }
    /// The file as it is now with every marked change of gachamod's taken out.
    fn clean(&self) -> Vec<u8> {
        if !self.exact() { return self.raw.clone(); }
        let mut d = Doc::from_bytes(&self.raw);
        reset_doc(&mut d);
        strip_on_screen(&mut d);
        d.to_bytes()
    }
    /// Make the doc the author's kept copy when that copy reads and writes back byte for byte.
    fn take(&mut self, original: Vec<u8>) -> bool {
        let d = Doc::from_bytes(&original);
        if d.to_bytes() != original { return false; }
        self.doc = d;
        true
    }
}

/// Any line gachamod added or changed is marked by a comment starting like this.
fn has_marks(doc: &Doc) -> bool { doc.lines.iter().any(|l| l.trim_start().starts_with("; gachamod ")) }

const MAX_INI: u64 = 16 * 1024 * 1024;

fn load(dir: &Path) -> Vec<IniDoc> {
    ini::mod_inis(dir).into_iter().filter_map(|(abs, rel)| {
        if std::fs::metadata(&abs).ok()?.len() > MAX_INI { return None; }
        let raw = std::fs::read(&abs).ok()?;
        let doc = Doc::from_bytes(&raw);
        Some(IniDoc { rel, abs, raw, doc })
    }).collect()
}

// ── key lines ──

#[derive(Debug, Clone)]
struct LineAt {
    at: usize,
    field: &'static str,
    index: u32,
    off: bool,
    /// The line as it would be live (for an off line, the stored line).
    raw: String,
    /// The author's line, when gachamod changed it (from the marker above).
    was: Option<String>,
}

fn key_lines(doc: &Doc, sec: &Sec) -> Vec<LineAt> {
    let mut out = Vec::new();
    let (mut nk, mut nb) = (0u32, 0u32);
    for i in sec.head + 1..sec.end {
        let line = &doc.lines[i];
        let (raw, off) = match marker(line, KEY_OFF) { Some(r) => (r.to_string(), true), None => (line.clone(), false) };
        let Some((k, v)) = kv(&raw) else { continue };
        let field = match k.as_str() { "key" => "key", "back" => "back", _ => continue };
        if v.is_empty() { continue; }
        let n = if field == "key" { &mut nk } else { &mut nb };
        let index = *n;
        *n += 1;
        let was = (i > sec.head + 1).then(|| marker(&doc.lines[i - 1], KEY_WAS).map(String::from)).flatten();
        out.push(LineAt { at: i, field, index, off, raw, was });
    }
    out
}

fn line_value(raw: &str) -> String { kv(raw).map(|(_, v)| v.to_string()).unwrap_or_default() }

fn is_pad_binding(value: &str) -> bool {
    let keys: Vec<&str> = value.split_whitespace().filter(|t| !is_modifier_token(t)).collect();
    !keys.is_empty() && keys.iter().all(|t| t.to_ascii_uppercase().starts_with("XB"))
}

fn is_modifier_token(t: &str) -> bool {
    let l = t.to_ascii_lowercase();
    matches!(l.as_str(), "ctrl" | "alt" | "shift" | "windows") || l.starts_with("no_")
}

// ── variables that say "the character is on screen" ──

/// `$name` and `$\namespace\name` references in an expression: (namespace lowercased if any, name lowercased).
fn var_refs(expr: &str) -> Vec<(Option<String>, String)> {
    let mut out = Vec::new();
    let b = expr.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'$' {
            let start = i + 1;
            let mut j = start;
            while j < b.len() && (b[j].is_ascii_alphanumeric() || b[j] == b'_' || b[j] == b'\\' || b[j] == b'.') { j += 1; }
            let r = expr[start..j].to_lowercase();
            if let Some(path) = r.strip_prefix('\\') {
                if let Some((ns, name)) = path.rsplit_once('\\') { out.push((Some(ns.to_string()), name.to_string())); }
            } else if !r.is_empty() {
                out.push((None, r));
            }
            i = j;
        } else {
            i += 1;
        }
    }
    out
}

/// `$name = v`, `post $name = v` or `$\namespace\name = v` (any indentation): (namespace and name lowercased, value).
fn assign(line: &str) -> Option<(Option<String>, String, String)> {
    let (k, v) = kv(line)?;
    let k = k.strip_prefix("post").map(str::trim_start).unwrap_or(&k);
    let path = k.strip_prefix('$')?;
    let (ns, name) = match path.strip_prefix('\\') {
        Some(p) => { let (ns, n) = p.rsplit_once('\\')?; (Some(ns.to_string()), n) }
        None => (None, path),
    };
    if name.is_empty() || !name.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_') { return None; }
    Some((ns, name.to_string(), v.to_string()))
}

fn is_one(v: &str) -> bool { v.parse::<f64>().is_ok_and(|n| n == 1.0) }
fn is_zero(v: &str) -> bool { v.parse::<f64>().is_ok_and(|n| n == 0.0) }

/// The sections `start` picks and the command lists they run, directly or through other command lists.
fn reached(doc: &Doc, secs: &[Sec], start: impl Fn(&Sec) -> bool) -> HashSet<usize> {
    let by_name: HashMap<&str, usize> = secs.iter().enumerate().map(|(i, s)| (s.lower.as_str(), i)).collect();
    let mut seen = HashSet::new();
    let mut todo: Vec<usize> = secs.iter().enumerate().filter(|(_, s)| start(s)).map(|(i, _)| i).collect();
    while let Some(i) = todo.pop() {
        if !seen.insert(i) { continue; }
        for l in &doc.lines[secs[i].head + 1..secs[i].end] {
            if let Some((k, v)) = kv(l) {
                if k == "run" { if let Some(&j) = by_name.get(v.to_lowercase().as_str()) { todo.push(j); } }
            }
        }
    }
    seen
}

/// Where an ini sets variables to 1 while drawing, and back to 0 each frame. `set` gets, per owning ini and variable,
/// the sections of this ini that set it (none when this ini sets another's flag through `ns`, its namespaces).
fn flag_sets(doc: &Doc, secs: &[Sec], di: usize, ns: &HashMap<String, usize>, set: &mut [HashMap<String, Vec<usize>>], reset: &mut [HashSet<String>]) {
    // [Present] and what it runs happen once a frame; overrides and what they run happen when something is drawn
    let present = reached(doc, secs, |s| s.lower == "present");
    let drawn = reached(doc, secs, |s| is_override(&s.lower));
    for (si, s) in secs.iter().enumerate() {
        let in_present = present.contains(&si);
        let draws = !in_present && drawn.contains(&si);
        if !in_present && !draws { continue; }
        for l in &doc.lines[s.head + 1..s.end] {
            let Some((n, name, v)) = assign(l) else { continue };
            let Some(owner) = (match &n { None => Some(di), Some(n) => ns.get(n).copied() }) else { continue };
            if in_present && is_zero(&v) {
                reset[owner].insert(name);
            } else if draws && is_one(&v) {
                let at = set[owner].entry(name).or_default();
                if owner == di { at.push(si); }
            }
        }
    }
}

/// Variables an ini sets to 1 where something is drawn and back to 0 in [Present] (or a command list [Present] runs):
/// (var, sections of this ini setting it).
fn onscreen_vars(doc: &Doc, secs: &[Sec]) -> HashMap<String, Vec<usize>> {
    let mut set = vec![HashMap::new()];
    let mut reset = vec![HashSet::new()];
    flag_sets(doc, secs, 0, &HashMap::new(), &mut set, &mut reset);
    let mut set = set.pop().unwrap_or_default();
    set.retain(|k, v| !v.is_empty() && reset[0].contains(k));
    set
}

/// The on-screen variables of every ini of a mod, including flags one ini sets in another through its namespace
/// (`$\LootBeacons\Master\chest_detected = 1`).
fn onscreen_flags(docs: &[IniDoc], secs: &[Vec<Sec>], ns: &HashMap<String, usize>) -> Vec<HashSet<String>> {
    let mut set = vec![HashMap::new(); docs.len()];
    let mut reset = vec![HashSet::new(); docs.len()];
    for (di, d) in docs.iter().enumerate() { flag_sets(&d.doc, &secs[di], di, ns, &mut set, &mut reset); }
    set.into_iter().zip(reset).map(|(s, r)| s.into_keys().filter(|k| r.contains(k)).collect()).collect()
}

/// The ini's explicit `namespace =` (above the first section), when it has one.
fn namespace_of(doc: &Doc, secs: &[Sec]) -> Option<String> {
    let first = secs.first().map(|s| s.head).unwrap_or(doc.lines.len());
    doc.lines[..first].iter().find_map(|l| kv(l).filter(|(k, _)| k == "namespace").map(|(_, v)| v.to_string())).filter(|v| !v.is_empty())
}

/// The first live `condition =` line of a section.
fn condition_at(doc: &Doc, sec: &Sec) -> Option<usize> {
    (sec.head + 1..sec.end).find(|&i| kv(&doc.lines[i]).is_some_and(|(k, _)| k == "condition"))
}

// ── sections that draw the character ──

/// How sure we are that an override section means "the character is drawn now". Lower is better; None: not a draw.
fn draw_tier(doc: &Doc, sec: &Sec, own: &HashMap<String, Vec<usize>>, si: usize) -> Option<u8> {
    if !sec.lower.starts_with("textureoverride") { return None; }
    let lines: Vec<(String, String)> = doc.lines[sec.head + 1..sec.end].iter().filter_map(|l| kv(l).map(|(k, v)| (k, v.to_string()))).collect();
    if !lines.iter().any(|(k, _)| k == "hash") { return None; }
    // vertex count raises run once when the buffer is made, not per frame
    if lines.iter().any(|(k, _)| k.starts_with("override_")) { return None; }
    if own.values().any(|v| v.contains(&si)) { return Some(0); }
    let base = sec.lower.trim_end_matches(|c: char| c.is_ascii_digit() || c == '_' || c == '.');
    let vb = lines.iter().any(|(k, _)| k.len() == 3 && k.starts_with("vb") && k.as_bytes()[2].is_ascii_digit());
    let draw = lines.iter().any(|(k, _)| k == "draw");
    if (base.ends_with("position") || base.ends_with("blend")) && (vb || draw) { return Some(1); }
    if vb || draw { return Some(2); }
    if lines.iter().any(|(k, _)| k == "ib" || k == "match_first_index" || k == "drawindexed" || k == "handling") { return Some(3); }
    Some(4)
}

/// The sections that draw the character's mesh, best kind first. Texture-only overrides (tier 4) are left out: a
/// texture can also show in menus or on other things, so those mods go to the AI helper or the user instead.
fn draw_sections(doc: &Doc, secs: &[Sec]) -> Vec<usize> {
    let own = onscreen_vars(doc, secs);
    let tiers: Vec<(usize, u8)> = secs.iter().enumerate().filter_map(|(i, s)| draw_tier(doc, s, &own, i).map(|t| (i, t))).collect();
    let Some(best) = tiers.iter().map(|(_, t)| *t).filter(|t| *t <= 3).min() else { return Vec::new() };
    tiers.into_iter().filter(|(_, t)| *t == best).map(|(i, _)| i).collect()
}

/// Any TextureOverride with a hash: the mod draws or retextures something. Mods with none (UI shaders, effects)
/// have no character, so their keys are meant to work everywhere.
fn has_texture_override(doc: &Doc, secs: &[Sec]) -> bool {
    secs.iter().any(|s| s.lower.starts_with("textureoverride") && doc.lines[s.head + 1..s.end].iter().any(|l| kv(l).is_some_and(|(k, _)| k == "hash")))
}

// ── reading a mod ──

struct Analysis {
    keys: Vec<KeyEntry>,
    /// The author's own on-screen gating is used by some key.
    own: bool,
    /// Some key section is gated by gachamod's flag.
    ours: bool,
    /// Key sections without any on-screen gating, per ini index.
    ungated: BTreeMap<usize, Vec<usize>>,
    /// Any ini has a TextureOverride with a hash.
    draws: bool,
}

/// A key section while reading a mod.
struct Found { di: usize, si: usize, now: Option<String>, author: Option<String>, own: bool, ours: bool, sets: Vec<String> }

fn analyse(docs: &[IniDoc]) -> Analysis {
    let mut a = Analysis { keys: Vec::new(), own: false, ours: false, ungated: BTreeMap::new(), draws: false };
    let secs: Vec<Vec<Sec>> = docs.iter().map(|d| sections(&d.doc)).collect();
    let by_ns: HashMap<String, usize> = docs.iter().zip(&secs).enumerate()
        .filter_map(|(i, (d, s))| namespace_of(&d.doc, s).map(|n| (n.to_lowercase(), i))).collect();
    let flags = onscreen_flags(docs, &secs, &by_ns);
    // variables something other than a key sets to a value other than 0
    let mut free: Vec<HashSet<String>> = vec![HashSet::new(); docs.len()];
    let mut found: Vec<Found> = Vec::new();
    for (di, d) in docs.iter().enumerate() {
        let doc = &d.doc;
        a.draws |= has_texture_override(doc, &secs[di]);
        for (si, s) in secs[di].iter().enumerate() {
            if !is_key_section(&s.lower) {
                if s.lower == "constants" { continue; }
                for l in &doc.lines[s.head + 1..s.end] {
                    if let Some((None, name, v)) = assign(l) { if !is_zero(&v) { free[di].insert(name); } }
                }
                continue;
            }
            if key_lines(doc, s).is_empty() { continue; }
            // the condition as it is now, and the author's
            let cond_at = condition_at(doc, s);
            let now = cond_at.map(|i| line_value(&doc.lines[i])).filter(|c| !c.is_empty());
            let author = match cond_at {
                Some(i) if i > 0 && is_marker(&doc.lines[i - 1], OS_ADDED) => None,
                Some(i) if i > 0 && marker(&doc.lines[i - 1], OS_WAS).is_some() => marker(&doc.lines[i - 1], OS_WAS).map(line_value).filter(|c| !c.is_empty()),
                _ => now.clone(),
            };
            let (mut own, mut ours) = (false, false);
            for (ns, name) in now.as_deref().map(var_refs).unwrap_or_default() {
                let owner = match &ns { None => Some(di), Some(n) => by_ns.get(n).copied() };
                let Some(o) = owner else {
                    // another mod's flag by name (a shared "active" helper): trust names that say so
                    if name.contains("active") || name.contains("onscreen") || name.contains("detected") { own = true; }
                    continue;
                };
                if !flags[o].contains(&name) { continue; }
                if name == FLAG { ours = true; } else { own = true; }
            }
            let sets = section_vars(doc, s).into_iter().map(|v| v.var.to_lowercase()).collect();
            found.push(Found { di, si, now, author, own, ours, sets });
        }
    }
    // A variable that only gated keys change is gated too: [KeyMenu] with `condition = $active == 1` opens `$menu`,
    // so keys that need `$menu == 1` only work while the character is on screen.
    loop {
        let mut via: HashMap<(usize, String), (bool, bool)> = HashMap::new();
        let mut open: HashSet<(usize, String)> = HashSet::new();
        for f in &found {
            for v in &f.sets {
                if f.own || f.ours {
                    let e = via.entry((f.di, v.clone())).or_default();
                    e.0 |= f.own;
                    e.1 |= f.ours;
                } else {
                    open.insert((f.di, v.clone()));
                }
            }
        }
        let mut changed = false;
        for f in found.iter_mut().filter(|f| !f.own && !f.ours) {
            for (ns, name) in f.now.as_deref().map(var_refs).unwrap_or_default() {
                if ns.is_some() || free[f.di].contains(&name) { continue; }
                let k = (f.di, name);
                if open.contains(&k) { continue; }
                if let Some(&(o, u)) = via.get(&k) { f.own |= o; f.ours |= u; changed = true; }
            }
        }
        if !changed { break; }
    }
    for f in found {
        let doc = &docs[f.di].doc;
        let s = &secs[f.di][f.si];
        a.own |= f.own;
        a.ours |= f.ours;
        if !f.own && !f.ours { a.ungated.entry(f.di).or_default().push(s.head); }
        let vars = section_vars(doc, s);
        let kind = (s.head + 1..s.end).find_map(|i| kv(&doc.lines[i]).filter(|(k, _)| k == "type").map(|(_, v)| v.to_lowercase()))
            .filter(|t| matches!(t.as_str(), "cycle" | "toggle" | "hold" | "activate")).unwrap_or_else(|| "activate".into());
        let out: Vec<KeyLine> = key_lines(doc, s).iter().map(|l| {
            let value = line_value(&l.raw);
            let original = l.was.as_deref().map(line_value);
            KeyLine {
                field: l.field.into(), index: l.index, label: ini::binding_label(&value), pad: is_pad_binding(&value),
                original_label: original.as_deref().map(ini::binding_label), original, off: l.off, value,
            }
        }).collect();
        a.keys.push(KeyEntry {
            ini: docs[f.di].rel.clone(), section: s.name.clone(), name: entry_name(&s.name, &vars), kind, vars, condition: f.author,
            off: out.iter().all(|l| l.off), lines: out, on_screen: f.own || f.ours,
        });
    }
    a
}

fn section_vars(doc: &Doc, s: &Sec) -> Vec<KeyVar> {
    doc.lines[s.head + 1..s.end].iter().filter_map(|l| {
        let (k, v) = kv(l)?;
        let name = k.strip_prefix('$')?;
        if name.is_empty() || name.contains('\\') || name.contains(' ') { return None; }
        let values = v.split(',').map(str::trim).filter(|x| !x.is_empty()).map(ini::norm_value).collect();
        Some(KeyVar { var: name.to_string(), values })
    }).collect()
}

/// A variable that says nothing about what a key does: the credits picture many mods clear on any key
/// (`$creditinfo = 0` in every key section).
pub(crate) fn noise_var(var: &str) -> bool { var.to_lowercase().contains("credit") }

/// `$swapvar`, `$swapvarg`, `$swaptex2`: names from a template, so the section name is used when it says more.
fn stock_var(var: &str) -> bool {
    let v = var.to_lowercase();
    let Some(rest) = v.strip_prefix("swap") else { return false };
    let rest = rest.strip_prefix("var").or_else(|| rest.strip_prefix("tex")).unwrap_or(rest);
    rest.len() <= 2 && rest.bytes().all(|c| c.is_ascii_alphanumeric())
}

/// "Jacket" from `$jacket`, or from the section name when the variable says nothing (`$swapvar` in [KeyHat]). A key
/// that sets more than three things is named by its section ("Reset"), or by the first two and how many more.
fn entry_name(section: &str, vars: &[KeyVar]) -> String {
    let from_section = ini::section_label(section);
    let section_says = !ini::generic_label(&from_section);
    let mut names: Vec<String> = Vec::new();
    for v in vars.iter().filter(|v| !noise_var(&v.var)) {
        let mut l = ini::var_label(&v.var);
        if section_says && (ini::generic_label(&l) || stock_var(&v.var)) { l = from_section.clone(); }
        if !names.contains(&l) { names.push(l); }
    }
    match names.len() {
        0 => from_section,
        1..=3 => names.join(", "),
        _ if section_says => from_section,
        n => format!("{}, {} and {} more", names[0], names[1], n - 2),
    }
}

fn state_of(a: &Analysis, docs: &[IniDoc]) -> (String, Option<String>) {
    if a.keys.is_empty() { return ("none".into(), None); }
    if a.ours && a.ungated.is_empty() { return ("on".into(), None); }
    if a.ours {
        return ("partial".into(), Some("Some toggles still work any time: gachamod couldn't find what draws the character in every file".into()));
    }
    if a.own { return ("own".into(), Some("This mod already turns its toggles off while its character isn't on screen".into())); }
    if !a.draws { return ("global".into(), Some("This mod doesn't draw a character, so its toggles work everywhere".into())); }
    let plan = plan(docs, a, None);
    if plan.is_empty() {
        return ("cant".into(), Some("gachamod couldn't tell which part of the mod draws the character".into()));
    }
    ("off".into(), None)
}

fn read_keys(mod_id: &str, docs: &[IniDoc]) -> ModKeys {
    let a = analyse(docs);
    let (state, note) = state_of(&a, docs);
    ModKeys {
        mod_id: mod_id.to_string(), inis: docs.iter().map(|d| d.rel.clone()).collect(),
        changed: a.keys.iter().any(|k| k.lines.iter().any(|l| l.off || l.original.is_some())),
        keys: a.keys, on_screen: state, on_screen_note: note,
    }
}

/// A mod folder's keys (no database needed).
pub fn keys_in(mod_id: &str, dir: &Path) -> ModKeys { read_keys(mod_id, &load(dir)) }

// ── key names ──

fn vk_named(name: &str) -> Option<u32> {
    Some(match name {
        "LBUTTON" => 0x01, "RBUTTON" => 0x02, "CANCEL" => 0x03, "MBUTTON" => 0x04, "XBUTTON1" => 0x05, "XBUTTON2" => 0x06,
        "BACK" | "BACKSPACE" => 0x08, "TAB" => 0x09, "CLEAR" => 0x0C, "RETURN" | "ENTER" => 0x0D, "SHIFT" => 0x10,
        "CONTROL" => 0x11, "MENU" => 0x12, "PAUSE" => 0x13, "CAPITAL" => 0x14, "ESCAPE" | "ESC" => 0x1B, "SPACE" => 0x20,
        "PRIOR" | "PAGEUP" => 0x21, "NEXT" | "PAGEDOWN" => 0x22, "END" => 0x23, "HOME" => 0x24, "LEFT" => 0x25, "UP" => 0x26,
        "RIGHT" => 0x27, "DOWN" => 0x28, "SELECT" => 0x29, "PRINT" => 0x2A, "EXECUTE" => 0x2B, "SNAPSHOT" => 0x2C,
        "INSERT" | "INS" => 0x2D, "DELETE" | "DEL" => 0x2E, "HELP" => 0x2F, "LWIN" => 0x5B, "RWIN" => 0x5C, "APPS" => 0x5D,
        "SLEEP" => 0x5F, "MULTIPLY" => 0x6A, "ADD" => 0x6B, "SEPARATOR" => 0x6C, "SUBTRACT" => 0x6D, "DECIMAL" => 0x6E,
        "DIVIDE" => 0x6F, "NUMLOCK" => 0x90, "SCROLL" => 0x91, "LSHIFT" => 0xA0, "RSHIFT" => 0xA1, "LCONTROL" => 0xA2,
        "RCONTROL" => 0xA3, "LMENU" => 0xA4, "RMENU" => 0xA5, "OEM_1" => 0xBA, "OEM_PLUS" => 0xBB, "OEM_COMMA" => 0xBC,
        "OEM_MINUS" => 0xBD, "OEM_PERIOD" => 0xBE, "OEM_2" => 0xBF, "OEM_3" => 0xC0, "OEM_4" => 0xDB, "OEM_5" => 0xDC,
        "OEM_6" => 0xDD, "OEM_7" => 0xDE, "OEM_8" => 0xDF, "OEM_102" => 0xE2,
        // other spellings mods use for the same keys
        "CTRL" => 0x11, "ALT" => 0x12, "LCTRL" => 0xA2, "RCTRL" => 0xA3, "LALT" => 0xA4, "RALT" => 0xA5,
        _ => {
            if let Some(n) = name.strip_prefix("NUMPAD") { if let Ok(d) = n.parse::<u32>() { if d <= 9 { return Some(0x60 + d); } } }
            if let Some(n) = name.strip_prefix('F') { if let Ok(d) = n.parse::<u32>() { if (1..=24).contains(&d) { return Some(0x6F + d); } } }
            return None;
        }
    })
}

/// A d3dx.ini key binding ("no_modifiers VK_F10", "ctrl VK_F5") as the keyboard key to press, the modifiers to hold
/// with it and the name people know it by ("F10", "Ctrl+F5"). None when it names no keyboard key.
pub fn press_of(binding: &str) -> Option<(u32, Vec<u32>, String)> {
    let (mut held, mut names, mut found) = (Vec::new(), String::new(), None);
    for t in binding.split_whitespace() {
        let (code, name) = match t.to_ascii_lowercase().as_str() {
            "ctrl" => (0x11, "Ctrl"),
            "alt" => (0x12, "Alt"),
            "shift" => (0x10, "Shift"),
            "windows" => (0x5B, "Win"),
            _ => {
                if found.is_none() && !t.to_ascii_lowercase().starts_with("no_") {
                    found = vk_code(t).filter(|c| *c >= 0x08).map(|c| (c, t));
                }
                continue;
            }
        };
        if !held.contains(&code) { held.push(code); names.push_str(name); names.push('+'); }
    }
    let (code, token) = found?;
    let name = match code {
        0x70..=0x87 => format!("F{}", code - 0x6F),
        0x30..=0x39 | 0x41..=0x5A => (code as u8 as char).to_string(),
        _ => { let up = token.to_ascii_uppercase(); up.strip_prefix("VK_").unwrap_or(&up).to_string() }
    };
    Some((code, held, names + &name))
}

/// The Windows key code of a keyboard or mouse key name ("VK_UP", "up", "A", "0x41").
fn vk_code(token: &str) -> Option<u32> {
    let up = token.trim().to_ascii_uppercase();
    if let Some(hex) = up.strip_prefix("0X") { return u32::from_str_radix(hex, 16).ok().filter(|c| *c > 0 && *c < 256); }
    if up.len() == 1 {
        let c = up.as_bytes()[0];
        if c.is_ascii_alphanumeric() { return Some(c as u32); }
        // punctuation written as itself ("no_modifiers /")
        return match c {
            b';' => Some(0xBA), b'=' => Some(0xBB), b',' => Some(0xBC), b'-' => Some(0xBD), b'.' => Some(0xBE), b'/' => Some(0xBF),
            b'`' => Some(0xC0), b'[' => Some(0xDB), b'\\' => Some(0xDC), b']' => Some(0xDD), b'\'' => Some(0xDE), _ => None,
        };
    }
    match up.strip_prefix("VK_") {
        // "VK_J" isn't a Windows name, but people write it for J
        Some(r) if r.len() == 1 && r.as_bytes()[0].is_ascii_alphanumeric() => Some(r.as_bytes()[0] as u32),
        Some(r) => vk_named(r),
        None => vk_named(&up),
    }
}

const PAD_BUTTONS: [&str; 17] = [
    "LEFT_TRIGGER", "RIGHT_TRIGGER", "LEFT_SHOULDER", "RIGHT_SHOULDER", "LEFT_THUMB", "RIGHT_THUMB", "DPAD_UP", "DPAD_DOWN",
    "DPAD_LEFT", "DPAD_RIGHT", "A", "B", "X", "Y", "START", "BACK", "GUIDE",
];

/// A pad button token ("XB_A", "xb2_dpad_up") as 3DMigoto spells it, and the button without the pad number.
fn pad_token(token: &str) -> Option<(String, String)> {
    let up = token.trim().to_ascii_uppercase();
    let rest = up.strip_prefix("XB_").map(|r| ("XB_", r))
        .or_else(|| ["XB1_", "XB2_", "XB3_", "XB4_"].iter().find_map(|p| up.strip_prefix(p).map(|r| (*p, r))))?;
    PAD_BUTTONS.contains(&rest.1).then(|| (format!("{}{}", rest.0, rest.1), rest.1.to_string()))
}

/// A key name the way gachamod writes it: letters and digits as themselves, everything else as a VK_ name.
fn canon_key(token: &str) -> Option<String> {
    if let Some((t, _)) = pad_token(token) { return Some(t); }
    let code = vk_code(token)?;
    if (0x30..=0x39).contains(&code) || (0x41..=0x5A).contains(&code) { return Some((code as u8 as char).to_string()); }
    let up = token.trim().to_ascii_uppercase();
    if up.starts_with("0X") { return Some(format!("0x{code:02X}")); }
    if up.len() == 1 {
        let name = match code { 0xBA => "OEM_1", 0xBB => "OEM_PLUS", 0xBC => "OEM_COMMA", 0xBD => "OEM_MINUS", 0xBE => "OEM_PERIOD",
            0xBF => "OEM_2", 0xC0 => "OEM_3", 0xDB => "OEM_4", 0xDC => "OEM_5", 0xDD => "OEM_6", _ => "OEM_7" };
        return Some(format!("VK_{name}"));
    }
    let name = up.strip_prefix("VK_").unwrap_or(&up);
    let name = match name {
        "ENTER" => "RETURN", "ESC" => "ESCAPE", "PAGEUP" => "PRIOR", "PAGEDOWN" => "NEXT", "DEL" => "DELETE",
        "INS" => "INSERT", "BACKSPACE" => "BACK", other => other,
    };
    Some(format!("VK_{name}"))
}

/// Keys the player pressed for one of gachamod's own menus ("ctrl VK_F6", "XB_LEFT_SHOULDER XB_A"), checked and
/// written one way: the held modifiers in order, then the keys by the names 3DMigoto knows. Guards (`no_...`) are
/// dropped.
pub(crate) fn clean_binding(binding: &str) -> Result<String> {
    const MODS: [&str; 4] = ["ctrl", "alt", "shift", "windows"];
    let mut held = [false; 4];
    let mut keys: Vec<String> = Vec::new();
    for t in binding.split_whitespace() {
        let l = t.to_ascii_lowercase();
        if let Some(i) = MODS.iter().position(|m| *m == l) { held[i] = true; continue; }
        if l.starts_with("no_") { continue; }
        let k = canon_key(t).ok_or_else(|| Error::Invalid(format!("\"{t}\" isn't a key name 3DMigoto knows")))?;
        if !keys.contains(&k) { keys.push(k); }
    }
    if keys.is_empty() { return Err(Error::Invalid("Pick a key. Ctrl, Alt or Shift alone can't be a key".into())); }
    if keys.len() == 1 && keys[0] == "VK_F10" { return Err(Error::Invalid("F10 reloads mods in game. Pick another key".into())); }
    let mut out: Vec<String> = MODS.iter().zip(held).filter(|(_, h)| *h).map(|(m, _)| m.to_string()).collect();
    out.extend(keys);
    Ok(out.join(" "))
}

/// The new value for a key line: the keys the user pressed (`binding`, held modifiers then keys, like "ctrl VK_F6" or
/// "XB_LEFT_SHOULDER XB_A") written in the style of the line it replaces: the same `no_` guards (minus the modifiers
/// now held) and the same spelling of modifiers. A pad binding gets no keyboard guards.
fn compose(old: &str, binding: &str) -> Result<String> {
    let mut held: Vec<String> = Vec::new();
    let mut guards_in: Vec<String> = Vec::new();
    let mut keys: Vec<String> = Vec::new();
    for t in binding.split_whitespace() {
        let l = t.to_ascii_lowercase();
        match l.as_str() {
            "ctrl" | "alt" | "shift" | "windows" => { if !held.contains(&l) { held.push(l); } }
            g if g.starts_with("no_") => guards_in.push(g.to_string()),
            _ => {
                let k = canon_key(t).ok_or_else(|| Error::Invalid(format!("\"{t}\" isn't a key name 3DMigoto knows")))?;
                if !keys.contains(&k) { keys.push(k); }
            }
        }
    }
    if keys.is_empty() { return Err(Error::Invalid("Pick a key. Ctrl, Alt or Shift alone can't be a key".into())); }
    let f10 = keys.len() == 1 && keys[0] == "VK_F10";
    if f10 && (held.is_empty() || (held.contains(&"ctrl".to_string()) && held.contains(&"alt".to_string()))) {
        return Err(Error::Invalid("F10 reloads mods in game, so a mod can't use it. Pick another key".into()));
    }
    let order = |v: &mut Vec<String>| v.sort_by_key(|m| ["ctrl", "alt", "shift", "windows"].iter().position(|x| x == m).unwrap_or(9));
    order(&mut held);
    let pad = keys.iter().all(|k| k.starts_with("XB"));
    let old_toks: Vec<&str> = old.split_whitespace().collect();
    let spelled: HashMap<String, &str> = old_toks.iter().filter(|t| is_modifier_token(t)).map(|t| (t.to_ascii_lowercase(), *t)).collect();
    let spell = |s: &str| spelled.get(s).map(|x| x.to_string()).unwrap_or_else(|| s.to_string());
    let mut out: Vec<String> = Vec::new();
    if !guards_in.is_empty() {
        out.extend(guards_in);
    } else if !pad {
        let old_guards: Vec<String> = old_toks.iter().map(|t| t.to_ascii_lowercase()).filter(|t| t.starts_with("no_")).collect();
        if old_guards.iter().any(|g| g == "no_modifiers") {
            if held.is_empty() { out.push(spell("no_modifiers")); } else {
                for m in ["ctrl", "alt", "shift"] { if !held.iter().any(|h| h == m) { out.push(spell(&format!("no_{m}"))); } }
            }
        } else {
            for g in old_guards {
                let m = &g[3..];
                if held.iter().any(|h| h == m) { continue; }
                out.push(spell(&g));
            }
        }
    }
    out.extend(held.iter().map(|h| spell(h)));
    out.extend(keys);
    Ok(out.join(" "))
}

/// The line with a new value, keeping its indentation and the spacing around `=`.
pub(crate) fn with_value(raw: &str, value: &str) -> String {
    match raw.find('=') {
        Some(i) => {
            let after = &raw[i + 1..];
            let pad = &after[..after.len() - after.trim_start().len()];
            format!("{}={pad}{value}", &raw[..i])
        }
        None => raw.to_string(),
    }
}

// ── edits on one document ──

fn find_section<'a>(secs: &'a [Sec], name: &str) -> Option<&'a Sec> { secs.iter().find(|s| s.name.eq_ignore_ascii_case(name)) }

fn not_found(section: &str, ini: &str) -> Error {
    Error::Invalid(format!("[{section}] isn't in {ini} any more. The mod may have changed; open it again"))
}

/// Rebind one line. Returns the old and new readable keys.
fn rebind_doc(doc: &mut Doc, rel: &str, t: &KeyTarget, binding: &str) -> Result<(String, String)> {
    let secs = sections(doc);
    let sec = find_section(&secs, &t.section).filter(|s| is_key_section(&s.lower)).ok_or_else(|| not_found(&t.section, rel))?;
    let line = key_lines(doc, sec).into_iter().find(|l| l.field == t.field && l.index == t.index).ok_or_else(|| not_found(&t.section, rel))?;
    if line.off { return Err(Error::Invalid("Turn this toggle on first".into())); }
    let old_value = line_value(&line.raw);
    let new_value = compose(&old_value, binding)?;
    let labels = (ini::binding_label(&old_value), ini::binding_label(&new_value));
    if new_value == old_value { return Ok(labels); }
    let new_line = with_value(&line.raw, &new_value);
    match &line.was {
        // back to what the author had: drop the marker
        Some(orig) if line_value(orig) == new_value => { doc.lines[line.at] = orig.clone(); doc.remove(line.at - 1); }
        Some(_) => doc.lines[line.at] = new_line,
        None => { doc.lines[line.at] = new_line; doc.insert(line.at, format!("{KEY_WAS}{}", line.raw)); }
    }
    Ok(labels)
}

/// Turn every key line of a section off or on.
fn set_off_doc(doc: &mut Doc, rel: &str, section: &str, off: bool) -> Result<()> {
    let secs = sections(doc);
    let sec = find_section(&secs, section).filter(|s| is_key_section(&s.lower)).ok_or_else(|| not_found(section, rel))?;
    for l in key_lines(doc, sec) {
        if l.off == off { continue; }
        doc.lines[l.at] = if off { format!("{KEY_OFF}{}", l.raw) } else { l.raw };
    }
    Ok(())
}

/// Put every key line back as the author wrote it, and on.
fn reset_doc(doc: &mut Doc) {
    let mut i = 0;
    while i < doc.lines.len() {
        if let Some(orig) = marker(&doc.lines[i], KEY_WAS).map(String::from) {
            if i + 1 < doc.lines.len() && (kv(&doc.lines[i + 1]).is_some() || marker(&doc.lines[i + 1], KEY_OFF).is_some()) {
                doc.lines[i + 1] = orig;
            }
            doc.remove(i);
            continue;
        }
        if let Some(raw) = marker(&doc.lines[i], KEY_OFF).map(String::from) { doc.lines[i] = raw; }
        i += 1;
    }
}

/// Take out everything "only while on screen" added, and put back what it changed.
fn strip_on_screen(doc: &mut Doc) {
    let mut i = 0;
    while i < doc.lines.len() {
        let line = doc.lines[i].clone();
        if is_marker(&line, OS_SECTION) {
            doc.remove(i);
            // our section header, then its lines up to the next section
            if i < doc.lines.len() && header_name(&doc.lines[i]).is_some() { doc.remove(i); }
            while i < doc.lines.len() && header_name(&doc.lines[i]).is_none() { doc.remove(i); }
            continue;
        }
        if is_marker(&line, OS_ADDED) {
            doc.remove(i);
            if i < doc.lines.len() { doc.remove(i); }
            continue;
        }
        if let Some(orig) = marker(&line, OS_WAS) {
            let orig = orig.to_string();
            doc.remove(i);
            if i < doc.lines.len() { doc.lines[i] = orig; }
            continue;
        }
        i += 1;
    }
}

/// What the on-screen fix will do in one mod: per ini that has ungated keys, the ini that owns the flag and the
/// name the keys use for it.
#[derive(Debug, Clone, PartialEq)]
struct Gate { keys_in: usize, owner: usize, flag_ref: String, sections: Vec<usize> }

fn plan(docs: &[IniDoc], a: &Analysis, draw: Option<&[DrawRef]>) -> Vec<Gate> {
    let secs: Vec<Vec<Sec>> = docs.iter().map(|d| sections(&d.doc)).collect();
    // draw sections per ini, picked by hand or found
    let draws: Vec<Vec<usize>> = docs.iter().enumerate().map(|(i, d)| match draw {
        Some(list) => list.iter().filter(|r| r.ini.eq_ignore_ascii_case(&d.rel))
            .filter_map(|r| secs[i].iter().position(|s| s.name.eq_ignore_ascii_case(&r.section) && is_override(&s.lower))).collect(),
        None => draw_sections(&d.doc, &secs[i]),
    }).collect();
    let mut out = Vec::new();
    for &k in a.ungated.keys() {
        if !draws[k].is_empty() {
            out.push(Gate { keys_in: k, owner: k, flag_ref: format!("${FLAG}"), sections: draws[k].clone() });
            continue;
        }
        // another ini of the mod draws it and has a name the keys can reach it by
        let other = (0..docs.len()).find(|&j| j != k && !draws[j].is_empty()
            && namespace_of(&docs[j].doc, &secs[j]).is_some_and(|n| !n.contains(char::is_whitespace)));
        if let Some(j) = other {
            let ns = namespace_of(&docs[j].doc, &secs[j]).unwrap_or_default();
            out.push(Gate { keys_in: k, owner: j, flag_ref: format!("$\\{ns}\\{FLAG}"), sections: draws[j].clone() });
        }
    }
    out
}

/// Add the flag to an ini that owns it: declared in [Constants], set in the draw sections, cleared in [Present].
fn add_flag(doc: &mut Doc, draw_heads: &[usize]) {
    // draw sections first (bottom up, so line numbers above stay right)
    let mut heads = draw_heads.to_vec();
    heads.sort_unstable();
    for &h in heads.iter().rev() {
        let at = if h + 1 < doc.lines.len() && kv(&doc.lines[h + 1]).is_some_and(|(k, _)| k == "hash") { h + 2 } else { h + 1 };
        doc.insert(at, format!("${FLAG} = 1"));
        doc.insert(at, OS_ADDED.into());
    }
    let secs = sections(doc);
    match secs.iter().find(|s| s.lower == "present") {
        Some(p) => {
            doc.insert(p.head + 1, format!("post ${FLAG} = 0"));
            doc.insert(p.head + 1, OS_ADDED.into());
        }
        None => {
            let end = doc.lines.len();
            for (n, l) in [OS_SECTION.to_string(), "[Present]".into(), format!("post ${FLAG} = 0")].into_iter().enumerate() { doc.insert(end + n, l); }
        }
    }
    let secs = sections(doc);
    match secs.iter().find(|s| s.lower == "constants") {
        Some(c) => {
            doc.insert(c.head + 1, format!("global ${FLAG} = 0"));
            doc.insert(c.head + 1, OS_ADDED.into());
        }
        None => {
            let at = secs.first().map(|s| s.head).unwrap_or(doc.lines.len());
            let block = [OS_SECTION.to_string(), "[Constants]".into(), format!("global ${FLAG} = 0"), String::new()];
            for (n, l) in block.into_iter().enumerate() { doc.insert(at + n, l); }
        }
    }
}

/// Add `<flag> == 1` to the condition of key sections (by header line), keeping the author's condition.
fn gate_keys(doc: &mut Doc, heads: &[usize], flag_ref: &str) {
    let mut heads = heads.to_vec();
    heads.sort_unstable();
    for &h in heads.iter().rev() {
        let secs = sections(doc);
        let Some(sec) = secs.iter().find(|s| s.head == h) else { continue };
        match condition_at(doc, sec) {
            Some(i) => {
                let raw = doc.lines[i].clone();
                let old = line_value(&raw);
                doc.lines[i] = with_value(&raw, &format!("({old}) && {flag_ref} == 1"));
                doc.insert(i, format!("{OS_WAS}{raw}"));
            }
            None => {
                doc.insert(h + 1, format!("condition = {flag_ref} == 1"));
                doc.insert(h + 1, OS_ADDED.into());
            }
        }
    }
}

/// Make the keys of a mod's inis work only while the character is drawn. Returns what couldn't be done.
fn on_screen_docs(docs: &mut [IniDoc], draw: Option<&[DrawRef]>) -> Vec<String> {
    let a = analyse(docs);
    if a.own { return Vec::new(); }
    let gates = plan(docs, &a, draw);
    let missing: Vec<String> = a.ungated.keys().filter(|k| !gates.iter().any(|g| g.keys_in == **k)).map(|&k| docs[k].rel.clone()).collect();
    // keys first: that only adds lines inside key sections, so the draw sections keep their place in the list
    let mut owners: Vec<(usize, Vec<usize>)> = Vec::new();
    for g in &gates {
        let heads = a.ungated.get(&g.keys_in).cloned().unwrap_or_default();
        gate_keys(&mut docs[g.keys_in].doc, &heads, &g.flag_ref);
        if !owners.iter().any(|(o, _)| *o == g.owner) { owners.push((g.owner, g.sections.clone())); }
    }
    for (o, secs_idx) in owners {
        let now = sections(&docs[o].doc);
        let heads: Vec<usize> = secs_idx.iter().filter_map(|&i| now.get(i).map(|s| s.head)).collect();
        add_flag(&mut docs[o].doc, &heads);
    }
    missing
}

// ── writing ──

fn write_file(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".gachamod.tmp");
    let tmp = PathBuf::from(tmp);
    std::fs::write(&tmp, bytes)?;
    if let Err(e) = ini::rename_retry(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    Ok(())
}

fn check_exact(docs: &[IniDoc]) -> Result<()> {
    if let Some(d) = docs.iter().find(|d| d.changed() && !d.exact()) {
        return Err(Error::Invalid(format!("{} has text gachamod can't write back exactly, so it left the file alone", d.rel)));
    }
    Ok(())
}

/// Keep the author's copy of each changed ini (once), back them up, then write them. None when nothing changed.
fn commit(db: &Db, game: &str, m: &ModEntry, docs: &[IniDoc], label: &str) -> Result<Option<Backup>> {
    check_exact(docs)?;
    let changed: Vec<&IniDoc> = docs.iter().filter(|d| d.changed()).collect();
    if changed.is_empty() { return Ok(None); }
    let made: Vec<(Vec<u8>, Vec<u8>)> = changed.iter().map(|d| (d.clean(), d.doc.to_bytes())).collect();
    let writes: Vec<originals::Write> = changed.iter().zip(&made)
        .map(|(d, (clean, after))| originals::Write { rel: &d.rel, before: &d.raw, clean, after }).collect();
    originals::keep(db, game, &m.id, &writes)?;
    let files: Vec<String> = changed.iter().map(|d| d.rel.clone()).collect();
    let b = backups::take(db, game, &m.id, Path::new(&m.path), &files, label)?;
    for d in changed { write_file(&d.abs, &d.doc.to_bytes())?; }
    crate::devtools::mark_changed(game);
    Ok(Some(b))
}

fn mod_of(db: &Db, game: &str, id: &str) -> Result<ModEntry> {
    let m = crate::library::get(db, game, id)?;
    if !Path::new(&m.path).is_dir() {
        return Err(Error::Invalid(format!("{}'s folder isn't there any more. Rescan to update the list", m.name)));
    }
    Ok(m)
}

fn running_note(game: &str) -> Option<String> {
    crate::launch::running(game).then(|| format!("Press {} in game to load the change", crate::devtools::key_name(game)))
}

/// An ini this edit leaves with none of gachamod's markers gets the author's kept copy, byte for byte, instead of
/// what taking the markers out made (they should be the same; the copy is the one to trust).
fn to_original(db: &Db, game: &str, mod_id: &str, docs: &mut [IniDoc]) {
    for d in docs.iter_mut().filter(|d| d.changed() && !has_marks(&d.doc)) {
        if let Some(o) = originals::original(db, game, mod_id, &d.rel, &d.raw) { d.take(o); }
    }
}

fn finish(db: &Db, game: &str, m: &ModEntry, docs: &mut [IniDoc], label: &str, note: Option<String>) -> Result<KeyEdit> {
    to_original(db, game, &m.id, docs);
    let backup = commit(db, game, m, docs, label)?;
    // the key list the game draws shows these keys
    if backup.is_some() { crate::keylist::keys_changed(db, game); }
    let note = note.or_else(|| backup.as_ref().and_then(|_| running_note(game)));
    Ok(KeyEdit { keys: keys_in(&m.id, Path::new(&m.path)), backup, note })
}

fn doc_for<'a>(docs: &'a mut [IniDoc], ini: &str) -> Result<&'a mut IniDoc> {
    let want = ini.replace('\\', "/");
    docs.iter_mut().find(|d| d.rel.eq_ignore_ascii_case(&want)).ok_or_else(|| Error::Invalid(format!("{ini} isn't in the mod any more. Open it again")))
}

// ── the commands ──

pub fn list(db: &Db, game: &str, id: &str) -> Result<ModKeys> {
    let m = mod_of(db, game, id)?;
    Ok(keys_in(&m.id, Path::new(&m.path)))
}

pub fn rebind(db: &Db, game: &str, id: &str, target: &KeyTarget, binding: &str) -> Result<KeyEdit> {
    let m = mod_of(db, game, id)?;
    let before = keys_in(&m.id, Path::new(&m.path));
    let mut docs = load(Path::new(&m.path));
    let d = doc_for(&mut docs, &target.ini)?;
    let (old, new) = rebind_doc(&mut d.doc, &d.rel, target, binding)?;
    let note = if old == new { None } else { clash_note(db, game, &before, target, binding, &new) }
        .map(|c| match running_note(game) { Some(r) => format!("{c}. {r}"), None => c });
    finish(db, game, &m, &mut docs, &format!("Changed {old} to {new} in {}", m.name), note)
}

/// What else the new key does: the mod's other toggles on it and gachamod's own keys ("Ctrl+Alt+J also changes
/// Jacket"). The change still goes through; this is said with it.
fn clash_note(db: &Db, game: &str, before: &ModKeys, t: &KeyTarget, binding: &str, label: &str) -> Option<String> {
    let ini = t.ini.replace('\\', "/");
    let is_target = |e: &KeyEntry| e.ini.eq_ignore_ascii_case(&ini) && e.section.eq_ignore_ascii_case(&t.section);
    let line = before.keys.iter().find(|e| is_target(e))?.lines.iter().find(|l| l.field == t.field && l.index == t.index)?;
    let want = combo(&compose(&line.value, binding).ok()?)?;
    let hits = |value: &str| combo(value).is_some_and(|c| overlap(&c, &want));
    let mut what: Vec<String> = Vec::new();
    for e in before.keys.iter().filter(|e| !e.off) {
        if is_target(e) || !e.lines.iter().any(|l| !l.off && hits(&l.value)) { continue; }
        let s = format!("changes {}", e.name);
        if !what.contains(&s) { what.push(s); }
    }
    let own = |key: &str| hits(&crate::hotkeys::migoto_form(key));
    if crate::live::has_groups(db, game) && own(&crate::live::menu_settings(db, game).key) { what.push("opens gachamod's menu".into()); }
    let list = crate::keylist::settings(db, game);
    if list.on && own(&list.key) { what.push("shows the key list".into()); }
    if own(&crate::devtools::key_name(game)) { what.push("reloads mods in game".into()); }
    if what.is_empty() { return None; }
    Some(format!("{label} also {}", what.join(" and ")))
}

pub fn set_off(db: &Db, game: &str, id: &str, ini: &str, section: &str, off: bool) -> Result<KeyEdit> {
    let m = mod_of(db, game, id)?;
    let mut docs = load(Path::new(&m.path));
    let d = doc_for(&mut docs, ini)?;
    set_off_doc(&mut d.doc, &d.rel, section, off)?;
    let what = ini::section_label(section);
    let label = if off { format!("Turned off the {what} toggle of {}", m.name) } else { format!("Turned on the {what} toggle of {}", m.name) };
    finish(db, game, &m, &mut docs, &label, None)
}

/// Take every change gachamod made out of a mod: keys, keys turned off and the on-screen check. Each ini gets the
/// author's kept copy when it is still as gachamod left it; otherwise (the mod was updated or edited by hand since)
/// gachamod's marked changes are taken out and the rest stays.
pub fn put_back(db: &Db, game: &str, id: &str) -> Result<KeyEdit> {
    let m = mod_of(db, game, id)?;
    let mut docs = load(Path::new(&m.path));
    for d in docs.iter_mut() {
        if originals::original(db, game, &m.id, &d.rel, &d.raw).is_some_and(|o| d.take(o)) { continue; }
        reset_doc(&mut d.doc);
        strip_on_screen(&mut d.doc);
    }
    finish(db, game, &m, &mut docs, &format!("Put back the original files of {}", m.name), None)
}

/// Turn "only while on screen" on or off for one mod. `draw` names the sections that draw the character when the
/// automatic search can't tell (from the AI helper).
pub fn on_screen(db: &Db, game: &str, id: &str, on: bool, draw: Option<&[DrawRef]>) -> Result<KeyEdit> {
    let m = mod_of(db, game, id)?;
    let mut docs = load(Path::new(&m.path));
    let mut note = None;
    if on {
        let a = analyse(&docs);
        if a.keys.is_empty() { return Err(Error::Invalid(format!("{} has no toggles", m.name))); }
        if a.own {
            return Ok(KeyEdit { keys: read_keys(&m.id, &docs), backup: None, note: Some("This mod already does this itself".into()) });
        }
        if let Some(list) = draw {
            for r in list {
                let d = doc_for(&mut docs, &r.ini)?;
                let secs = sections(&d.doc);
                if !secs.iter().any(|s| s.name.eq_ignore_ascii_case(&r.section) && is_override(&s.lower)) {
                    return Err(Error::Invalid(format!("[{}] isn't a TextureOverride section in {}", r.section, r.ini)));
                }
            }
        }
        let missing = on_screen_docs(&mut docs, draw);
        if !missing.is_empty() && !docs.iter().any(|d| d.changed()) {
            return Err(Error::Invalid(format!("gachamod couldn't tell which part of {} draws the character", m.name)));
        }
        if !missing.is_empty() { note = Some(format!("Toggles in {} still work any time: nothing in it draws the character", missing.join(", "))); }
    } else {
        for d in docs.iter_mut() { strip_on_screen(&mut d.doc); }
    }
    let label = if on { format!("Toggles of {} work only while on screen", m.name) } else { format!("Toggles of {} work any time again", m.name) };
    finish(db, game, &m, &mut docs, &label, note)
}

/// "Only while on screen" for every mod of a game (on or off). Each mod gets its own backup.
pub fn on_screen_all(shared: &crate::db::Shared, game: &str, on: bool) -> Result<OnScreenAll> {
    let lock = || shared.lock().map_err(|_| Error::Db("The local database is stuck. Restart gachamod".into()));
    let mods = { crate::library::list(&*lock()?, game)? };
    let mut out = OnScreenAll::default();
    for m in mods {
        let dir = PathBuf::from(&m.path);
        if !dir.is_dir() { continue; }
        let mut docs = load(&dir);
        if on {
            let a = analyse(&docs);
            if a.keys.is_empty() || a.own || !a.draws || (a.ungated.is_empty()) { out.already += 1; continue; }
            let missing = on_screen_docs(&mut docs, None);
            if !missing.is_empty() && !docs.iter().any(|d| d.changed()) {
                out.skipped.push(ModSkip { mod_id: m.id.clone(), name: m.name.clone(), reason: "gachamod couldn't tell which part draws the character".into() });
                continue;
            }
        } else {
            for d in docs.iter_mut() { strip_on_screen(&mut d.doc); }
            if !docs.iter().any(|d| d.changed()) { out.already += 1; continue; }
        }
        let label = if on { format!("Toggles of {} work only while on screen", m.name) } else { format!("Toggles of {} work any time again", m.name) };
        let r = {
            let d = lock()?;
            if !on { to_original(&d, game, &m.id, &mut docs); }
            commit(&d, game, &m, &docs, &label)
        };
        match r {
            Ok(Some(backup)) => out.changed.push(ModBackup { mod_id: m.id.clone(), name: m.name.clone(), backup }),
            Ok(None) => out.already += 1,
            Err(e) => out.skipped.push(ModSkip { mod_id: m.id.clone(), name: m.name.clone(), reason: e.to_string() }),
        }
    }
    Ok(out)
}

/// Mods of a game (on and off) that have gachamod's on-screen check, by name.
pub fn on_screen_mods(db: &Db, game: &str) -> Result<Vec<OnScreenMod>> {
    let mods = match crate::library::list(db, game) { Ok(l) => l, Err(Error::Todo(_)) => Vec::new(), Err(e) => return Err(e) };
    let mut out = Vec::new();
    for m in mods.iter().filter(|m| m.has_keys) {
        let dir = Path::new(&m.path);
        if !dir.is_dir() { continue; }
        let docs = load(dir);
        if !docs.iter().any(|d| d.doc.lines.iter().any(|l| l.contains(FLAG))) { continue; }
        let k = read_keys(&m.id, &docs);
        if k.on_screen != "on" && k.on_screen != "partial" { continue; }
        out.push(OnScreenMod { mod_id: m.id.clone(), name: m.name.clone(), character: m.character.clone(), enabled: m.enabled, partial: k.on_screen == "partial" });
    }
    out.sort_by_key(|o| o.name.to_lowercase());
    Ok(out)
}

/// New installs get "only while on screen" when the user turned that on (setting "keys.onScreenOnInstall" = "1").
/// Called by install.rs after mods are placed; never fails the install.
pub fn after_install(shared: &crate::db::Shared, game: &str, installed: &[ModEntry], notes: &mut Vec<String>) {
    let Ok(d) = shared.lock() else { return };
    if d.setting("keys.onScreenOnInstall").ok().flatten().as_deref() != Some("1") { return; }
    let mut done: Vec<String> = Vec::new();
    for m in installed {
        let dir = Path::new(&m.path);
        if !dir.is_dir() { continue; }
        let mut docs = load(dir);
        let a = analyse(&docs);
        if a.keys.is_empty() || a.own || a.ungated.is_empty() { continue; }
        on_screen_docs(&mut docs, None);
        if let Ok(Some(_)) = commit(&d, game, m, &docs, &format!("Toggles of {} work only while on screen", m.name)) { done.push(m.name.clone()); }
    }
    match done.as_slice() {
        [] => {}
        [_] if installed.len() == 1 => notes.push("Its toggles work only while its character is on screen".into()),
        [one] => notes.push(format!("Toggles of {one} work only while its character is on screen")),
        _ => notes.push(format!("Toggles of {} work only while their characters are on screen", crate::ini::oxford(&done, 8))),
    }
}

// ── shared key settings (.gachamod link lists) ──

/// One key edit to make again on a fresh copy of a mod, for a shared link list that carries no mod files.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum KeyChange {
    /// A line gachamod changed: its value now and the author's value.
    Set { ini: String, section: String, field: String, index: u32, value: String, original: String },
    /// A key section turned off.
    Off { ini: String, section: String },
}

/// The key edits in a mod folder, and whether gachamod made its keys work only while on screen.
pub fn shared_changes(dir: &Path) -> (Vec<KeyChange>, bool) {
    let docs = load(dir);
    let a = analyse(&docs);
    let mut out = Vec::new();
    for k in &a.keys {
        if k.off {
            out.push(KeyChange::Off { ini: k.ini.clone(), section: k.section.clone() });
            continue;
        }
        for l in k.lines.iter().filter(|l| !l.off) {
            if let Some(orig) = &l.original {
                out.push(KeyChange::Set { ini: k.ini.clone(), section: k.section.clone(), field: l.field.clone(), index: l.index, value: l.value.clone(), original: orig.clone() });
            }
        }
    }
    (out, a.ours)
}

/// Set one key line to an exact value, leaving the usual marker. False when the line isn't there or is off.
fn set_doc(doc: &mut Doc, section: &str, field: &str, index: u32, value: &str) -> bool {
    let secs = sections(doc);
    let Some(sec) = find_section(&secs, section).filter(|s| is_key_section(&s.lower)) else { return false };
    let Some(line) = key_lines(doc, sec).into_iter().find(|l| l.field == field && l.index == index && !l.off) else { return false };
    let value = value.trim();
    if value.is_empty() || line_value(&line.raw) == value { return true; }
    let new_line = with_value(&line.raw, value);
    match &line.was {
        Some(orig) if line_value(orig) == value => { doc.lines[line.at] = orig.clone(); doc.remove(line.at - 1); }
        Some(_) => doc.lines[line.at] = new_line,
        None => { doc.lines[line.at] = new_line; doc.insert(line.at, format!("{KEY_WAS}{}", line.raw)); }
    }
    true
}

/// Make shared key edits on a mod: rebinds, keys turned off and "only while on screen". Edits that don't fit this
/// copy of the mod (a section that isn't there any more) are left out. Returns a note when some were.
pub fn apply_shared(db: &Db, game: &str, id: &str, changes: &[KeyChange], on_screen: bool) -> Result<Option<String>> {
    if changes.is_empty() && !on_screen { return Ok(None); }
    let m = mod_of(db, game, id)?;
    let mut docs = load(Path::new(&m.path));
    let missed = apply_shared_docs(&mut docs, changes, on_screen);
    commit(db, game, &m, &docs, &format!("Shared key settings on {}", m.name))?;
    Ok((missed > 0).then(|| format!("{missed} of {}'s key changes didn't fit this version of it", m.name)))
}

/// The edits of `apply_shared` on loaded files. Returns how many didn't fit.
fn apply_shared_docs(docs: &mut [IniDoc], changes: &[KeyChange], on_screen: bool) -> u32 {
    let mut missed = 0;
    for c in changes {
        let (KeyChange::Set { ini, .. } | KeyChange::Off { ini, .. }) = c;
        let Ok(d) = doc_for(docs, ini) else { missed += 1; continue };
        let ok = match c {
            KeyChange::Set { section, field, index, value, .. } => set_doc(&mut d.doc, section, field, *index, value),
            KeyChange::Off { section, .. } => { let rel = d.rel.clone(); set_off_doc(&mut d.doc, &rel, section, true).is_ok() }
        };
        if !ok { missed += 1; }
    }
    if on_screen {
        let a = analyse(docs);
        if !a.keys.is_empty() && !a.own && !a.ungated.is_empty() { on_screen_docs(docs, None); }
    }
    missed
}

// ── clashes ──

#[derive(Debug, Clone, PartialEq)]
struct Combo { held: u8, guards: u8, keys: Vec<String> }

const MODS: [&str; 4] = ["ctrl", "alt", "shift", "windows"];

/// What has to be held and not held for a binding to fire, and its keys (normalised so "VK_UP" == "up" == "0x26").
fn combo(value: &str) -> Option<Combo> {
    let (mut held, mut guards, mut keys) = (0u8, 0u8, Vec::new());
    for t in value.split_whitespace() {
        let l = t.to_ascii_lowercase();
        if let Some(i) = MODS.iter().position(|m| *m == l) { held |= 1 << i; continue; }
        if l == "no_modifiers" { guards |= 0b1111; continue; }
        if let Some(m) = l.strip_prefix("no_") {
            if let Some(i) = MODS.iter().position(|x| *x == m) { guards |= 1 << i; }
            continue;
        }
        let k = match pad_token(t) { Some((_, b)) => format!("pad:{b}"), None => vk_code(t).map(|c| format!("vk:{c:02x}")).unwrap_or_else(|| l.clone()) };
        if !keys.contains(&k) { keys.push(k); }
    }
    keys.sort();
    (!keys.is_empty()).then_some(Combo { held, guards, keys })
}

/// Can one press fire both? Same keys, and neither needs held what the other forbids.
fn overlap(a: &Combo, b: &Combo) -> bool { a.keys == b.keys && a.held & b.guards == 0 && b.held & a.guards == 0 }

struct ClashLine { key: ClashKey, combo: Combo }

/// Keys bound by two or more enabled mods that can fire together: at least one of them works off screen, or both
/// are for the same character (so both can be on screen at once).
pub fn clashes(db: &Db, game: &str) -> Result<Vec<KeyClash>> {
    let mods = match crate::library::list(db, game) { Ok(l) => l, Err(Error::Todo(_)) => Vec::new(), Err(e) => return Err(e) };
    Ok(find_clashes(&mods))
}

/// Mods that are on and react to `key` (written like a hotkey, "F7" or "Ctrl+Alt+M"), by name: they fire too when the
/// key opens gachamod's menu while playing.
pub fn mods_on_key(db: &Db, game: &str, key: &str) -> Vec<String> {
    let Some(want) = combo(&crate::hotkeys::migoto_form(key)) else { return Vec::new() };
    let mods = crate::library::list(db, game).unwrap_or_default();
    on_key(&mods, &want)
}

fn on_key(mods: &[ModEntry], want: &Combo) -> Vec<String> {
    let mut out = Vec::new();
    for m in mods.iter().filter(|m| m.enabled && m.has_keys) {
        let dir = Path::new(&m.path);
        if !dir.is_dir() { continue; }
        let k = keys_in(&m.id, dir);
        let hit = k.keys.iter().filter(|e| !e.off)
            .any(|e| e.lines.iter().filter(|l| !l.off).any(|l| combo(&l.value).is_some_and(|c| overlap(&c, want))));
        if hit { out.push(m.name.clone()); }
    }
    out
}

fn find_clashes(mods: &[ModEntry]) -> Vec<KeyClash> {
    let mut lines: Vec<ClashLine> = Vec::new();
    for m in mods.iter().filter(|m| m.enabled && m.has_keys) {
        let dir = Path::new(&m.path);
        if !dir.is_dir() { continue; }
        let k = keys_in(&m.id, dir);
        let fixable = k.on_screen == "off";
        for e in k.keys.iter().filter(|e| !e.off) {
            for l in e.lines.iter().filter(|l| !l.off) {
                let Some(c) = combo(&l.value) else { continue };
                lines.push(ClashLine { combo: c, key: ClashKey {
                    mod_id: m.id.clone(), name: m.name.clone(), character: m.character.clone(), ini: e.ini.clone(),
                    section: e.section.clone(), field: l.field.clone(), index: l.index, value: l.value.clone(), label: l.label.clone(),
                    what: e.name.clone(), on_screen: e.on_screen, fixable,
                }});
            }
        }
    }
    let same_char = |a: &ClashKey, b: &ClashKey| match (&a.character, &b.character) { (Some(x), Some(y)) => x.eq_ignore_ascii_case(y), _ => false };
    // union-find over lines that clash for real
    let mut parent: Vec<usize> = (0..lines.len()).collect();
    fn root(p: &mut [usize], mut i: usize) -> usize { while p[i] != i { p[i] = p[p[i]]; i = p[i]; } i }
    let mut by_keys: HashMap<&[String], Vec<usize>> = HashMap::new();
    for (i, l) in lines.iter().enumerate() { by_keys.entry(&l.combo.keys).or_default().push(i); }
    let mut real: HashSet<usize> = HashSet::new();
    for group in by_keys.values() {
        for (n, &i) in group.iter().enumerate() {
            for &j in &group[n + 1..] {
                let (a, b) = (&lines[i], &lines[j]);
                if a.key.mod_id == b.key.mod_id || !overlap(&a.combo, &b.combo) { continue; }
                if a.key.on_screen && b.key.on_screen && !same_char(&a.key, &b.key) { continue; }
                real.insert(i);
                real.insert(j);
                let (ri, rj) = (root(&mut parent, i), root(&mut parent, j));
                if ri != rj { parent[ri] = rj; }
            }
        }
    }
    let mut groups: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    let mut ids: Vec<usize> = real.into_iter().collect();
    ids.sort_unstable();
    for i in ids { let r = root(&mut parent, i); groups.entry(r).or_default().push(i); }
    let mut out: Vec<KeyClash> = groups.into_values().map(|idx| {
        let keys: Vec<ClashKey> = idx.iter().map(|&i| lines[i].key.clone()).collect();
        KeyClash { label: keys[0].label.clone(), keys }
    }).collect();
    out.sort_by(|a, b| b.keys.len().cmp(&a.keys.len()).then_with(|| a.label.cmp(&b.label)));
    out
}

// ── for the AI helper ──

/// Override sections of each ini (name and up to 6 telling lines each), so a chatbot can say which draws the
/// character. Nothing else from the files.
pub fn outline(db: &Db, game: &str, id: &str) -> Result<Vec<IniOutline>> {
    let m = mod_of(db, game, id)?;
    Ok(outline_docs(&load(Path::new(&m.path))))
}

fn outline_docs(docs: &[IniDoc]) -> Vec<IniOutline> {
    docs.iter().map(|d| {
        let secs = sections(&d.doc);
        let keys = secs.iter().filter(|s| is_key_section(&s.lower)).map(|s| s.name.clone()).collect();
        let sections = secs.iter().filter(|s| is_override(&s.lower)).take(150).map(|s| {
            let lines = d.doc.lines[s.head + 1..s.end].iter().filter_map(|l| {
                let (k, v) = kv(l)?;
                let telling = k == "hash" || k == "ib" || k == "handling" || k == "draw" || k == "drawindexed" || k.starts_with("match_")
                    || (k.len() == 3 && k.starts_with("vb")) || k.starts_with("override_") || k.starts_with('$') || k == "run";
                telling.then(|| { let t = format!("{k} = {v}"); if t.chars().count() > 100 { t.chars().take(100).collect() } else { t } })
            }).take(6).collect();
            SectionOutline { section: s.name.clone(), lines }
        }).collect();
        IniOutline { ini: d.rel.clone(), namespace: namespace_of(&d.doc, &secs), keys, sections }
    }).filter(|o| !o.sections.is_empty() || !o.keys.is_empty()).collect()
}

#[cfg(test)]
mod tests;
