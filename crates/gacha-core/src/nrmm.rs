//! No Reload Mod Manager (NRMM): reading its layout in a Mods folder and moving mods out of it. Owner: MODTOOLS area
//! (docs/spec.md, "Moving from No Reload Mod Manager"). How NRMM works: docs/ingame.md, section 2.
//!
//! NRMM keeps mods in `Mods\_MANAGED_\group_<N>\<mod>`, with its own inis in `_MANAGED_` and each group folder. Every
//! mod of a group loads; NRMM rewrites their inis so only the one whose `global $managed_slot_id = <k>` matches the
//! group's `$\modmanageragl\group_<N>\active_slot` (saved in d3dx_user.ini, 0 = none) draws. Before its first rewrite
//! each ini is copied to `<name>.ini_managed_backup`. Its settings are in
//! %APPDATA%\com.aglg\No Reload Mod Manager\shared_preferences.json (no presets).
//!
//! Detection only reads. The move plans every mod first, then puts each ini back from NRMM's copy (keeping the keys
//! the user rebound or turned off there, as gachamod's own key changes), moves the mod to `Mods/<Character>/<mod>` and
//! moves its saved values. Everything NRMM made goes to the app's trash (`<data>/trash/nrmm/<game>~<time>`), with the
//! inis as NRMM left them, never deleted.

use crate::aliases::Matcher;
use crate::db::{Db, Shared};
use crate::error::{Error, Result};
use crate::keys::{self, KeyChoice};
use crate::library;
use crate::managers;
use crate::model::{Sidecar, DISABLED_PREFIX};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

/// NRMM's folder in Mods. Older versions used the other names (NRMM renames them to this one).
pub const MANAGED: &str = "_MANAGED_";
const MANAGED_NAMES: &[&str] = &[MANAGED, "V1_3_x_MANAGED-DO_NOT_EDIT_COPY_MOVE_CUT", "MANAGED-DO_NOT_EDIT_COPY_MOVE_CUT"];
pub const PROCESS: &str = "No_Reload_Mod_Manager.exe";
/// "mod.ini" is kept as "mod.ini_managed_backup".
const BACKUP_TAIL: &str = "_managed_backup";
/// NRMM's files in a mod folder that mean nothing to anything else (icon.png stays: it's the mod's picture).
const MOD_FILES: &[&str] = &["modname", "modlink", "fav", "modforced", "modsyntaxerrorremoved", "modunoptimized", "modnamespaced"];
const MAX_INI: u64 = 16 * 1024 * 1024;

pub fn is_managed_name(name: &str) -> bool { MANAGED_NAMES.iter().any(|m| m.eq_ignore_ascii_case(name)) }

/// `group_1` to `group_500` -> the number.
fn group_number(name: &str) -> Option<u32> {
    let n = name.get(..6).filter(|p| p.eq_ignore_ascii_case("group_")).and_then(|_| name.get(6..))?;
    if n.is_empty() || n.len() > 3 || n.starts_with('0') || !n.bytes().all(|b| b.is_ascii_digit()) { return None; }
    n.parse().ok().filter(|k| (1..=500).contains(k))
}

/// NRMM's own folder or one of its group folders ("_MANAGED_", "_MANAGED_/group_3"): they hold NRMM's inis beside the
/// mods, so they are groups, never mods.
pub(crate) fn is_scaffold(rel: &str) -> bool {
    let mut p = rel.split('/');
    match (p.next(), p.next(), p.next()) {
        (Some(a), None, _) => is_managed_name(a),
        (Some(a), Some(b), None) => is_managed_name(a) && group_number(b).is_some(),
        _ => false,
    }
}

/// The group of a mod at `rel` (`_MANAGED_/group_3/<mod>` -> 3).
fn group_of(rel: &str) -> Option<u32> {
    let mut p = rel.split('/');
    let (a, b, c) = (p.next()?, p.next()?, p.next()?);
    if !is_managed_name(a) || c.is_empty() { return None; }
    group_number(b)
}

fn slot_in(text: &str) -> Option<u32> {
    text.lines().find_map(|l| {
        let t: String = l.chars().filter(|c| !c.is_whitespace()).collect::<String>().to_ascii_lowercase();
        t.strip_prefix("global$managed_slot_id=")?.parse().ok()
    })
}

fn read_ini(p: &Path) -> Option<String> {
    if fs::metadata(p).ok()?.len() > MAX_INI { return None; }
    Some(crate::ini::decode(&fs::read(p).ok()?))
}

/// The slot NRMM gave a mod: `global $managed_slot_id = <k>` in one of its inis. None when NRMM never gated it.
fn slot_of(dir: &Path) -> Option<u32> {
    crate::ini::mod_inis(dir).iter().find_map(|(abs, _)| read_ini(abs).and_then(|t| slot_in(&t)))
}

/// The slot showing in each group, from d3dx_user.ini (a group missing there shows none).
pub(crate) fn active_slots(importer_dir: &Path) -> HashMap<u32, u32> {
    crate::ini::user_values(importer_dir, "modmanageragl\\").into_iter().filter_map(|(name, v)| {
        let (g, var) = name.split_once('\\')?;
        if var != "active_slot" { return None; }
        let k = v.trim().parse::<f64>().ok().filter(|k| *k >= 0.0)?;
        Some((group_number(g)?, k as u32))
    }).collect()
}

/// Whether NRMM lets the mod at `rel` draw: mods outside its groups and mods it never gated always do.
pub(crate) fn shows(rel: &str, dir: &Path, slots: &HashMap<u32, u32>) -> bool {
    let Some(g) = group_of(rel) else { return true };
    match slot_of(dir) { None => true, Some(k) => k != 0 && slots.get(&g) == Some(&k) }
}

/// NRMM decides whether this mod shows, not its folder name.
pub(crate) fn gated(rel: &str, dir: &Path) -> bool { group_of(rel).is_some() && slot_of(dir).is_some() }

pub(crate) fn managed_error() -> Error {
    Error::Conflict("No Reload Mod Manager picks which mod of this group shows. Move your mods out of it first (Tools, Share and import).".into())
}

// ── reading the layout ──

fn name_of(p: &Path) -> String { p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default() }

fn is_real_dir(p: &Path) -> bool { fs::symlink_metadata(p).map(|m| m.is_dir() && !m.file_type().is_symlink()).unwrap_or(false) }

fn child_dirs(dir: &Path) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = fs::read_dir(dir).into_iter().flatten().flatten().map(|e| e.path()).filter(|p| is_real_dir(p)).collect();
    v.sort();
    v
}

/// NRMM's folders in a Mods folder (`_MANAGED_` first).
fn managed_dirs(mods_dir: &Path) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = child_dirs(mods_dir).into_iter().filter(|p| is_managed_name(&name_of(p))).collect();
    v.sort_by_key(|p| !name_of(p).eq_ignore_ascii_case(MANAGED));
    v
}

/// The group folders in one of NRMM's folders, by number.
fn groups_in(managed: &Path) -> Vec<(u32, PathBuf)> {
    let mut v: Vec<(u32, PathBuf)> = child_dirs(managed).into_iter().filter_map(|p| Some((group_number(&name_of(&p))?, p))).collect();
    v.sort_by_key(|(n, _)| *n);
    v
}

/// A one-line text file NRMM wrote (`groupname`, `modname`).
fn read_small(p: &Path) -> Option<String> {
    if fs::metadata(p).ok()?.len() > 4096 { return None; }
    let t = crate::ini::decode(&fs::read(p).ok()?);
    let t = t.trim_start_matches('\u{feff}').trim().to_string();
    (!t.is_empty() && !t.contains('\n')).then_some(t)
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NrmmGame {
    pub game: String,
    pub groups: u32,
    pub mods: u32,
    /// Mods that show in the game now (one per group at most).
    pub showing: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NrmmInfo {
    /// NRMM's layout is in some game's Mods folder, or its settings file is there.
    pub found: bool,
    pub settings: Option<String>,
    pub games: Vec<NrmmGame>,
}

fn settings_file() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(|d| PathBuf::from(d).join("com.aglg").join("No Reload Mod Manager").join("shared_preferences.json"))
}

/// NRMM's groups and mods in one Mods folder. None when it has none there.
fn count_in(mods_dir: &Path, slots: &HashMap<u32, u32>) -> Option<(u32, u32, u32)> {
    let (mut groups, mut mods, mut showing) = (0, 0, 0);
    for managed in managed_dirs(mods_dir) {
        for (n, g) in groups_in(&managed) {
            groups += 1;
            for d in child_dirs(&g) {
                mods += 1;
                let rel = format!("{}/{}/{}", name_of(&managed), name_of(&g), name_of(&d));
                if !library::is_disabled_name(&name_of(&d)) && shows(&rel, &d, slots) && slots.get(&n).is_some_and(|k| *k != 0) { showing += 1; }
            }
        }
    }
    (mods > 0).then_some((groups, mods, showing))
}

/// Each game whose Mods folder has NRMM's layout, with its counts. Reads only.
pub fn detect(db: &Db) -> Result<NrmmInfo> { Ok(detect_in(db, settings_file().as_deref())) }

fn detect_in(db: &Db, settings: Option<&Path>) -> NrmmInfo {
    let settings = settings.filter(|p| p.is_file());
    let mut info = NrmmInfo { found: settings.is_some(), settings: settings.map(|p| p.to_string_lossy().into_owned()), games: Vec::new() };
    for g in crate::games::GAMES {
        let Some(mods_dir) = crate::games::paths(db, g.id).ok().and_then(|p| p.mods_dir).map(PathBuf::from) else { continue };
        if managed_dirs(&mods_dir).is_empty() { continue; }
        let slots = crate::games::importer_dir(db, g.id).map(|i| active_slots(&i)).unwrap_or_default();
        let Some((groups, mods, showing)) = count_in(&mods_dir, &slots) else { continue };
        info.found = true;
        info.games.push(NrmmGame { game: g.id.to_string(), groups, mods, showing });
    }
    info
}

// ── putting an ini back ──

/// `namespace = x` above the first section.
fn namespace_of(text: &str) -> Option<String> {
    for l in text.lines() {
        let t = l.trim().trim_start_matches('\u{feff}');
        if t.starts_with('[') { break; }
        if t.starts_with(';') { continue; }
        let Some((k, v)) = t.split_once('=') else { continue };
        if k.trim().eq_ignore_ascii_case("namespace") && !v.trim().is_empty() { return Some(v.trim().to_string()); }
    }
    None
}

/// `s` with every `pat` replaced, ignoring ASCII case. None when there is none.
fn replace_ci(s: &str, pat: &str, with: &str) -> Option<String> {
    let (ls, lp) = (s.to_ascii_lowercase(), pat.to_ascii_lowercase());
    if lp.is_empty() || !ls.contains(&lp) { return None; }
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while let Some(j) = ls[i..].find(&lp) {
        out.push_str(&s[i..i + j]);
        out.push_str(with);
        i += j + lp.len();
    }
    out.push_str(&s[i..]);
    Some(out)
}

/// Rename a namespace the way NRMM does: the `namespace =` line and every `\name\` reference.
fn rename_namespace(doc: &mut keys::Doc, from: &str, to: &str) {
    for line in doc.lines.iter_mut() {
        let t = line.trim();
        if t.starts_with(';') { continue; }
        if let Some((k, v)) = t.split_once('=') {
            if k.trim().eq_ignore_ascii_case("namespace") {
                if v.trim().eq_ignore_ascii_case(from) { *line = format!("namespace = {to}"); }
                continue;
            }
        }
        if let Some(n) = replace_ci(line, &format!("\\{from}\\"), &format!("\\{to}\\")) { *line = n; }
    }
}

/// The key lines of an ini as NRMM left it: what the user bound, and whether they turned it off there (`;+;`).
fn key_choices(text: &str) -> Vec<KeyChoice> {
    let mut out = Vec::new();
    let mut sec: Option<(String, bool)> = None;
    let (mut nk, mut nb) = (0u32, 0u32);
    for raw in text.lines() {
        let mut t = raw.trim();
        let mut off = false;
        loop {
            if let Some(r) = t.strip_prefix(";+;") { off = true; t = r.trim_start(); }
            else if let Some(r) = t.strip_prefix(";;-;;").or_else(|| t.strip_prefix(";-;")) { t = r.trim_start(); }
            else if let Some(r) = keys::off_line(t) { t = r.trim_start(); }
            else { break; }
        }
        if let Some(h) = keys::header_name(t) {
            sec = h.to_lowercase().starts_with("key").then(|| (h.to_string(), off));
            (nk, nb) = (0, 0);
            continue;
        }
        let Some((section, sec_off)) = &sec else { continue };
        let Some((k, v)) = keys::kv(t) else { continue };
        let field = match k.as_str() { "key" => "key", "back" => "back", _ => continue };
        if v.is_empty() { continue; }
        let n = if field == "key" { &mut nk } else { &mut nb };
        out.push(KeyChoice { section: section.clone(), field, index: *n, value: v.to_string(), off: off || *sec_off });
        *n += 1;
    }
    out
}

/// One ini to put back.
struct IniFix {
    ini: PathBuf,
    backup: PathBuf,
    /// Paths inside the mod folder, forward slashes.
    rel: String,
    backup_rel: String,
    /// The namespace NRMM's version has, the author's, and the one the ini ends with.
    now_ns: Option<String>,
    orig_ns: Option<String>,
    keep_ns: Option<String>,
}

/// NRMM's copies in a mod folder. Err names an ini NRMM changed that has no copy to go back to.
fn ini_fixes(dir: &Path) -> std::result::Result<Vec<IniFix>, String> {
    let rel_of = |p: &Path| p.strip_prefix(dir).map(|r| r.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect::<Vec<_>>().join("/")).unwrap_or_default();
    let mut fixes = Vec::new();
    for e in walkdir::WalkDir::new(dir).follow_links(false).max_depth(10).into_iter().flatten() {
        if !e.file_type().is_file() { continue; }
        let name = e.file_name().to_string_lossy().into_owned();
        if !name.to_ascii_lowercase().ends_with(&format!(".ini{BACKUP_TAIL}")) { continue; }
        let ini = e.path().with_file_name(&name[..name.len() - BACKUP_TAIL.len()]);
        if !ini.is_file() { continue; }
        let (now, orig) = (read_ini(&ini).unwrap_or_default(), read_ini(e.path()).unwrap_or_default());
        fixes.push(IniFix {
            rel: rel_of(&ini), backup_rel: rel_of(e.path()), backup: e.path().to_path_buf(), ini,
            now_ns: namespace_of(&now), orig_ns: namespace_of(&orig), keep_ns: None,
        });
    }
    let have: HashSet<String> = fixes.iter().map(|f| f.rel.to_lowercase()).collect();
    for (abs, rel) in crate::ini::mod_inis(dir) {
        if have.contains(&rel.to_lowercase()) { continue; }
        if read_ini(&abs).is_some_and(|t| t.to_ascii_lowercase().contains("managed_slot_id")) { return Err(rel); }
    }
    for f in fixes.iter_mut() { f.keep_ns = f.orig_ns.clone().or_else(|| f.now_ns.clone()); }
    Ok(fixes)
}

/// The ini bytes to write: NRMM's copy with the kept namespace, then the user's key choices. (author's, final)
fn restored(f: &IniFix) -> Result<(Vec<u8>, Vec<u8>)> {
    let now = fs::read(&f.ini)?;
    let mut doc = keys::Doc::from_bytes(&fs::read(&f.backup)?);
    if let (Some(o), Some(k)) = (&f.orig_ns, &f.keep_ns) {
        if !o.eq_ignore_ascii_case(k) { rename_namespace(&mut doc, o, k); }
    }
    let clean = doc.to_bytes();
    keys::carry_key_choices(&mut doc, &key_choices(&crate::ini::decode(&now)));
    Ok((clean, doc.to_bytes()))
}

// ── the move ──

/// A name Windows takes for a folder.
fn clean_name(s: &str) -> String {
    let c: String = s.chars().filter(|c| !matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') && !c.is_control()).take(120).collect();
    c.trim().trim_end_matches(['.', ' ']).to_string()
}

struct Plan {
    from: PathBuf,
    from_rel: String,
    to_rel: String,
    name: String,
    character: Option<String>,
    foreign: Option<managers::Foreign>,
    inis: Vec<IniFix>,
}

/// A file from the author's version and what was written, for originals.rs.
pub(crate) struct Kept { pub rel: String, pub clean: Vec<u8>, pub after: Vec<u8> }

#[derive(Default)]
struct Moved { ids: Vec<String>, notes: Vec<String>, kept: Vec<(String, Vec<Kept>)> }

/// A free path for a mod: `parent/base`, else "base (2)" ..., counting both its on and off names as taken.
fn free_rel(mods_dir: &Path, parent: Option<&str>, base: &str, on: bool, taken: &mut HashSet<String>) -> String {
    let join = |n: &str| match parent { Some(p) => format!("{p}/{n}"), None => n.to_string() };
    let used = |n: &str, taken: &HashSet<String>| {
        [n.to_string(), format!("{DISABLED_PREFIX}{n}")].iter().any(|v| { let r = join(v); taken.contains(&r.to_lowercase()) || mods_dir.join(&r).exists() })
    };
    let name = std::iter::once(base.to_string()).chain((2..1000).map(|i| format!("{base} ({i})")))
        .find(|n| !used(n, taken)).unwrap_or_else(|| format!("{base} ({})", library::new_id()));
    taken.insert(join(&name).to_lowercase());
    join(&if on { name } else { format!("{DISABLED_PREFIX}{name}") })
}

fn plan(mods_dir: &Path, slots: &HashMap<u32, u32>, m: &Matcher) -> (Vec<Plan>, Vec<String>) {
    let (mut plans, mut notes) = (Vec::new(), Vec::new());
    let mut taken = HashSet::new();
    for managed in managed_dirs(mods_dir) {
        for (n, gdir) in groups_in(&managed) {
            let label = read_small(&gdir.join("groupname")).filter(|g| !g.eq_ignore_ascii_case(&name_of(&gdir)));
            let character = label.as_deref().and_then(|g| m.exact(g).or_else(|| m.best(&[g])));
            let parent = character.clone().or_else(|| label.as_deref().map(clean_name)).filter(|s| !s.is_empty());
            let active = slots.get(&n).copied().unwrap_or(0);
            for dir in child_dirs(&gdir) {
                let folder = name_of(&dir);
                let foreign = managers::read(&dir);
                let name = foreign.as_ref().and_then(|f| f.name.clone()).unwrap_or_else(|| library::display_folder(&folder).to_string());
                let inis = match ini_fixes(&dir) {
                    Ok(v) => v,
                    Err(ini) => {
                        notes.push(format!("{name} stays in No Reload Mod Manager's folder: {ini} has no copy from before No Reload Mod Manager changed it"));
                        continue;
                    }
                };
                let on = !library::is_disabled_name(&folder) && slot_of(&dir).is_none_or(|k| k != 0 && k == active);
                let base = [clean_name(&name), clean_name(library::display_folder(&folder))].into_iter().find(|s| !s.is_empty()).unwrap_or_else(|| "Mod".into());
                let to_rel = free_rel(mods_dir, parent.as_deref(), &base, on, &mut taken);
                let from_rel = format!("{}/{}/{folder}", name_of(&managed), name_of(&gdir));
                plans.push(Plan { from: dir, from_rel, to_rel, name, character: character.clone(), foreign, inis });
            }
        }
    }
    keep_namespaces(&mut plans);
    (plans, notes)
}

/// NRMM renamed a namespace two mods shared (`name` -> `name_1`). Each mod gets its own name back unless another mod
/// keeps it, so no two mods end up with one namespace.
fn keep_namespaces(plans: &mut [Plan]) {
    let mut claimed: HashSet<String> = plans.iter().flat_map(|p| p.inis.iter())
        .filter(|f| f.orig_ns.as_deref().map(str::to_lowercase) == f.now_ns.as_deref().map(str::to_lowercase))
        .filter_map(|f| f.now_ns.as_deref().map(str::to_lowercase)).collect();
    for p in plans.iter_mut() {
        let mut decided: HashMap<String, String> = HashMap::new();
        for f in p.inis.iter_mut() {
            let (Some(now), Some(orig)) = (f.now_ns.clone(), f.orig_ns.clone()) else { continue };
            if now.eq_ignore_ascii_case(&orig) { continue; }
            let keep = decided.entry(now.to_lowercase()).or_insert_with(|| {
                let pick = if claimed.contains(&orig.to_lowercase()) { now.clone() } else { orig.clone() };
                claimed.insert(pick.to_lowercase());
                pick
            });
            f.keep_ns = Some(keep.clone());
        }
    }
}

/// Move a file into the trash folder, at `dest`.
fn trash_file(src: &Path, dest: &Path) -> std::io::Result<()> {
    if let Some(p) = dest.parent() { fs::create_dir_all(p)?; }
    fs::rename(src, dest).or_else(|_| { fs::copy(src, dest)?; fs::remove_file(src) })
}

/// Move a folder into `dest`, joining folders already there (the mods' own NRMM files went there first).
fn merge_into(src: &Path, dest: &Path) -> Result<()> {
    if !dest.exists() {
        if let Some(p) = dest.parent() { fs::create_dir_all(p)?; }
        return crate::pack::move_dir(src, dest);
    }
    for e in fs::read_dir(src)?.flatten() {
        let (from, to) = (e.path(), dest.join(e.file_name()));
        if is_real_dir(&from) { merge_into(&from, &to)?; } else { trash_file(&from, &to)?; }
    }
    fs::remove_dir(src)?;
    Ok(())
}

fn write_file(p: &Path, bytes: &[u8]) -> Result<()> {
    let mut tmp = p.as_os_str().to_owned();
    tmp.push(".gachamod.tmp");
    let tmp = PathBuf::from(tmp);
    fs::write(&tmp, bytes)?;
    if let Err(e) = crate::ini::rename_retry(&tmp, p) { let _ = fs::remove_file(&tmp); return Err(e); }
    Ok(())
}

/// Put one mod's inis back. Each ini as NRMM left it and NRMM's copy go to the trash.
fn restore_mod(p: &Plan, trash: &Path) -> Result<Vec<Kept>> {
    let mut kept = Vec::new();
    for f in &p.inis {
        let (clean, after) = restored(f)?;
        let at = trash.join(&p.from_rel);
        let old = at.join(&f.rel);
        if let Some(d) = old.parent() { fs::create_dir_all(d)?; }
        fs::copy(&f.ini, &old)?;
        write_file(&f.ini, &after)?;
        trash_file(&f.backup, &at.join(&f.backup_rel))?;
        if clean != after { kept.push(Kept { rel: f.rel.clone(), clean, after }); }
    }
    Ok(kept)
}

fn move_out(mods_dir: &Path, importer_dir: Option<&Path>, slots: &HashMap<u32, u32>, m: &Matcher, trash: &Path) -> Moved {
    let (plans, notes) = plan(mods_dir, slots, m);
    let mut out = Moved { notes, ..Default::default() };
    let left_behind = !out.notes.is_empty();
    let mut failed = false;
    for p in &plans {
        let kept = match restore_mod(p, trash) {
            Ok(k) => k,
            Err(e) => { out.notes.push(format!("Couldn't put back {}'s files: {e}", p.name)); failed = true; continue; }
        };
        for f in MOD_FILES {
            let Some(e) = fs::read_dir(&p.from).into_iter().flatten().flatten().find(|e| e.file_name().to_string_lossy().eq_ignore_ascii_case(f)) else { continue };
            let _ = trash_file(&e.path(), &trash.join(&p.from_rel).join(e.file_name()));
        }
        let to = mods_dir.join(&p.to_rel);
        if let Some(parent) = to.parent() { let _ = fs::create_dir_all(parent); }
        if let Err(e) = crate::pack::move_dir(&p.from, &to) { out.notes.push(format!("Couldn't move {}: {e}", p.name)); failed = true; continue; }
        if let Some(imp) = importer_dir {
            let mut moves = vec![];
            if let Err(e) = crate::ini::move_user_vars(imp, &p.from_rel, &p.to_rel) { moves.push(e); }
            let mut done = HashSet::new();
            for f in &p.inis {
                let (Some(now), Some(keep)) = (&f.now_ns, &f.keep_ns) else { continue };
                if now.eq_ignore_ascii_case(keep) || !done.insert(now.to_lowercase()) { continue; }
                if let Err(e) = crate::ini::move_user_prefix(imp, now, keep) { moves.push(e); }
            }
            if let Some(e) = moves.first() { out.notes.push(format!("Couldn't keep {}'s options: {e}", p.name)); }
        }
        let had = library::read_sidecar(&to);
        let mut sc = had.clone().unwrap_or_else(|| Sidecar { format: 1, id: library::new_id(), installed_at: crate::db::now(), ..Default::default() });
        if sc.id.is_empty() { sc.id = library::new_id(); }
        if let Some(f) = &p.foreign { managers::merge(&mut sc, f, m, &p.name, had.is_none()); }
        if sc.name.trim().is_empty() { sc.name = p.name.clone(); }
        if sc.character.as_deref().is_none_or(|c| c.trim().is_empty()) { sc.character = p.character.clone(); }
        match library::write_sidecar(&to, &sc) {
            Ok(()) => {
                if !kept.is_empty() { out.kept.push((sc.id.clone(), kept)); }
                out.ids.push(sc.id);
            }
            Err(e) => out.notes.push(format!("Moved {}, but couldn't write its details: {e}", p.name)),
        }
    }
    // what is left is NRMM's own: its inis, group names, icons and picks
    if !left_behind && !failed {
        for managed in managed_dirs(mods_dir) {
            if let Err(e) = merge_into(&managed, &trash.join(name_of(&managed))) {
                out.notes.push(format!("Couldn't clear No Reload Mod Manager's folder {}: {e}", name_of(&managed)));
            }
        }
    }
    out
}

/// Move one game's mods out of NRMM into gachamod's layout (`Mods/<Character>/<mod>`, DISABLED prefix on all but the
/// mod showing in each group), put back their inis with the user's key choices, keep their saved values, write
/// sidecars with what NRMM knew (name, link, picture, favourite) and rescan. NRMM must be closed.
pub fn takeover(db: &Shared, game: &str) -> Result<crate::pack::ImportResult> {
    if crate::launch::process_running(PROCESS) {
        return Err(Error::Conflict("Close No Reload Mod Manager first. It would set its folders up again while the mods move".into()));
    }
    if crate::launch::running(game) {
        return Err(Error::Conflict("Close the game first. Mods can't move while it has them open".into()));
    }
    let (mods_dir, importer_dir, m, trash) = {
        let d = db.lock().unwrap_or_else(|e| e.into_inner());
        let trash = crate::pack::data_dir_of(&d).join("trash").join("nrmm").join(format!("{game}~{}", crate::db::now()));
        (crate::games::mods_dir(&d, game)?, crate::games::importer_dir(&d, game).ok(), library::matcher(&d, game)?, trash)
    };
    if managed_dirs(&mods_dir).is_empty() {
        return Ok(crate::pack::ImportResult { notes: vec!["No Reload Mod Manager has no mods for this game".into()], ..Default::default() });
    }
    let slots = importer_dir.as_deref().map(active_slots).unwrap_or_default();
    let out = move_out(&mods_dir, importer_dir.as_deref(), &slots, &m, &trash);
    let mut notes = out.notes;
    {
        // the author's copy of each file whose keys came over as gachamod's changes, for "put the author's keys back"
        let d = db.lock().unwrap_or_else(|e| e.into_inner());
        for (id, kept) in &out.kept {
            let writes: Vec<crate::originals::Write> = kept.iter().map(|k| crate::originals::Write { rel: &k.rel, before: &k.after, clean: &k.clean, after: &k.after }).collect();
            let _ = crate::originals::keep(&d, game, id, &writes);
        }
    }
    match library::scan(db, game) {
        Ok(_) | Err(Error::Todo(_)) => {}
        Err(e) => notes.push(format!("The mods moved, but the rescan failed: {e}")),
    }
    if !out.ids.is_empty() {
        let n = out.ids.len();
        notes.insert(0, format!("Moved {n} {} from No Reload Mod Manager", if n == 1 { "mod" } else { "mods" }));
        crate::devtools::mark_changed(game);
    }
    Ok(crate::pack::ImportResult { added: out.ids, notes, ..Default::default() })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("gachamod-nrmm-{name}-{}", library::new_id()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    const AUTHOR: &str = "namespace = bunny\r\n[Constants]\r\nglobal persist $swap = 0\r\n\r\n[KeySwap]\r\nkey = VK_F5\r\nback = VK_F6\r\ntype = cycle\r\n$swap = 0,1\r\n\r\n[KeyHat]\r\nkey = h\r\n$hat = 0,1\r\n\r\n[TextureOverrideBody]\r\nhash = 0011aabb\r\nib = Body\r\n";

    /// A mod as NRMM leaves it: gated, the namespace renamed to `ns`, F5 rebound to F7 and the hat key turned off.
    fn managed_mod(dir: &Path, group: u32, slot: u32, ns: &str, name: &str) {
        fs::create_dir_all(dir).unwrap();
        fs::write(dir.join("mod.ini_managed_backup"), AUTHOR).unwrap();
        let gate = format!("$managed_slot_id == $\\modmanageragl\\group_{group}\\active_slot");
        fs::write(dir.join("mod.ini"), format!(
            "namespace = {ns}\n[Constants]\nglobal $managed_slot_id = {slot}\nglobal persist $swap = 0\n\n[KeySwap]\ncondition = {gate}\nkey = VK_F7\nback = VK_F6\ntype = cycle\n$swap = 0,1\n\n;+;[KeyHat]\n;+;condition = {gate}\n;+;key = h\n;+;$hat = 0,1\n\n[TextureOverrideBody]\nhash = 0011aabb\nmatch_priority = 0\nif {gate}\n    ib = Body\nendif\n")).unwrap();
        fs::write(dir.join("modname"), name).unwrap();
        fs::write(dir.join("modlink"), "https://gamebanana.com/mods/777").unwrap();
    }

    fn layout(root: &Path) -> PathBuf {
        let mods = root.join("Mods");
        let g = mods.join(MANAGED).join("group_1");
        fs::create_dir_all(&g).unwrap();
        fs::write(mods.join(MANAGED).join("manager_group.ini"), "namespace = modmanageragl\\group_manager\n").unwrap();
        fs::write(mods.join(MANAGED).join("nrmm_include.ini"), "[IncludeKeypress]\ninclude = nrmm_keypress.txt").unwrap();
        fs::write(g.join("group_1.ini"), "namespace = modmanageragl\\group_1\n[Constants]\npersist global $active_slot = 0\n").unwrap();
        fs::write(g.join("groupname"), "Ellen").unwrap();
        // two mods that both had the namespace "bunny": NRMM renamed the second one's
        managed_mod(&g.join("Bunny A"), 1, 1, "bunny", "Bunny Ellen");
        managed_mod(&g.join("Bunny B"), 1, 2, "bunny_1", "Bunny Ellen");
        fs::write(root.join("d3dx_user.ini"), "[Constants]\r\n$\\modmanageragl\\group_1\\active_slot = 2\r\n$\\bunny_1\\swap = 1\r\n$\\mods\\_managed_\\group_1\\bunny b\\mod.ini\\x = 3\r\n").unwrap();
        mods
    }

    #[test]
    fn reads_the_layout() {
        assert!(is_scaffold("_MANAGED_") && is_scaffold("_managed_/group_12") && !is_scaffold("_MANAGED_/group_0") && !is_scaffold("_MANAGED_/group_1/x"));
        assert_eq!((group_of("_MANAGED_/group_3/Maid"), group_of("_MANAGED_/group_3"), group_of("Ellen/Maid")), (Some(3), None, None));
        assert_eq!((group_number("group_500"), group_number("group_501"), group_number("group_01")), (Some(500), None, None));
        let root = temp("read");
        let mods = layout(&root);
        assert_eq!(active_slots(&root).get(&1), Some(&2));
        assert_eq!(count_in(&mods, &active_slots(&root)), Some((1, 2, 1)));
        let choices = key_choices(&fs::read_to_string(mods.join("_MANAGED_/group_1/Bunny A/mod.ini")).unwrap());
        assert_eq!(choices.len(), 3);
        assert!(choices.iter().any(|c| c.section == "KeyHat" && c.off) && choices.iter().any(|c| c.value == "VK_F7" && !c.off));
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn moves_mods_out_of_nrmm() {
        let root = temp("move");
        let mods = layout(&root);
        let m = Matcher::new("zzz", &["Ellen Joe".to_string()]);
        let trash = root.join("trash");
        let out = move_out(&mods, Some(&root), &active_slots(&root), &m, &trash);
        assert_eq!(out.ids.len(), 2, "{:?}", out.notes);
        assert!(out.notes.is_empty(), "{:?}", out.notes);

        // slot 2 showed: it comes on, the other off, both under the character with their names
        let b = mods.join("Ellen Joe/Bunny Ellen (2)");
        let a = mods.join("Ellen Joe/DISABLED Bunny Ellen");
        assert!(a.join("mod.ini").is_file() && b.join("mod.ini").is_file());
        let text = fs::read_to_string(b.join("mod.ini")).unwrap();
        assert!(!text.contains("managed_slot_id") && !text.contains("match_priority") && !text.contains("if "), "{text}");
        // the first keeps "bunny", so the second keeps NRMM's "bunny_1" and its saved value
        assert!(text.starts_with("namespace = bunny_1\r\n"), "{text}");
        assert!(fs::read_to_string(a.join("mod.ini")).unwrap().starts_with("namespace = bunny\r\n"));
        // the user's key choices are gachamod's own changes now
        assert!(text.contains("; gachamod changed this key. It was: key = VK_F5\r\nkey = VK_F7\r\n"), "{text}");
        assert!(text.contains("; gachamod turned this key off: key = h\r\n"), "{text}");
        assert_eq!(out.kept.len(), 2);
        // NRMM's files are in the trash, with each ini as NRMM left it
        assert!(!b.join("modname").exists() && !b.join("mod.ini_managed_backup").exists());
        assert!(trash.join("_MANAGED_/group_1/Bunny B/mod.ini_managed_backup").is_file());
        assert!(fs::read_to_string(trash.join("_MANAGED_/group_1/Bunny B/mod.ini")).unwrap().contains("managed_slot_id"));
        assert!(trash.join("_MANAGED_/group_1/group_1.ini").is_file() && !mods.join(MANAGED).exists());
        // the sidecar has NRMM's name and link
        let sc = library::read_sidecar(&b).unwrap();
        assert_eq!((sc.name.as_str(), sc.character.as_deref(), sc.source.map(|s| s.mod_id)), ("Bunny Ellen", Some("Ellen Joe"), Some(777)));
        // saved values follow the new path
        let user = fs::read_to_string(root.join("d3dx_user.ini")).unwrap();
        assert!(user.contains("$\\bunny_1\\swap = 1") && user.contains("$\\mods\\ellen joe\\bunny ellen (2)\\mod.ini\\x = 3"), "{user}");
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_mod_without_its_copy_stays() {
        let root = temp("stay");
        let mods = layout(&root);
        fs::remove_file(mods.join("_MANAGED_/group_1/Bunny A/mod.ini_managed_backup")).unwrap();
        let m = Matcher::new("zzz", &["Ellen Joe".to_string()]);
        let out = move_out(&mods, Some(&root), &active_slots(&root), &m, &root.join("trash"));
        assert_eq!(out.ids.len(), 1);
        assert!(out.notes[0].starts_with("Bunny Ellen stays in No Reload Mod Manager's folder"), "{:?}", out.notes);
        // its group still has what it needs
        assert!(mods.join("_MANAGED_/group_1/Bunny A/mod.ini").is_file() && mods.join("_MANAGED_/group_1/group_1.ini").is_file());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn detects_counts() {
        let root = temp("detect");
        let mods = layout(&root);
        let db = Db::memory().unwrap();
        crate::games::save_paths(&db, "zzz", &crate::games::GamePaths { mods_dir: Some(mods.to_string_lossy().into()), importer_dir: Some(root.to_string_lossy().into()), ..Default::default() }).unwrap();
        let info = detect_in(&db, None);
        assert!(info.found);
        assert_eq!((info.games[0].game.as_str(), info.games[0].mods, info.games[0].showing), ("zzz", 2, 1));
        assert!(!detect_in(&Db::memory().unwrap(), Some(&root.join("missing"))).found);
        fs::remove_dir_all(&root).unwrap();
    }
}
