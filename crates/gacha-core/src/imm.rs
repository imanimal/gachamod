//! Bringing mods over from Integrated Mod Manager (IMM). Owner: MODTOOLS area (docs/spec.md, "Moving from IMM").
//!
//! IMM keeps its settings in %LOCALAPPDATA%\Integrated Mod Manager (IMM)\config*.json (one per game: configZZ.json,
//! configEF.json ...; config.json holds the XXMI path) and its mods inside the importer's Mods folder, in
//! "DISABLED - ALL MODS ARE STORED HERE (Managed by IMM)" and "DO NOT MODIFY (Managed by IMM)". Each config's
//! `data` maps "<Category>\\<mod>" to `{ source: GameBanana URL, tags, note, installedAt, updatedAt, vars }` and
//! `presets` lists its loadouts. The store also holds IMM's restore points (`RESTORE\RESTORE-<date>`, full copies of
//! the store) and an IGNORE folder; the links folder holds `.USER_PREFS\<Category>\<mod>.ini`, the option values IMM
//! sets at load. None of those are mods.
//!
//! Detection only reads. The move builds its whole plan first and refuses before touching anything when a target
//! folder exists. IMM's enabled mods are links (symlinks or junctions) to the store: only the links themselves are
//! removed, never what they point to.

use crate::aliases::Matcher;
use crate::db::Db;
use crate::error::{Error, Result};
use crate::ini::{self, VarValue};
use crate::library;
use crate::model::{ModSource, Sidecar, DISABLED_PREFIX};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImmGame { pub game: String, pub config: String, pub mods: u32, pub enabled: u32, pub with_source: u32 }

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImmInfo { pub found: bool, pub dir: Option<String>, pub games: Vec<ImmGame> }

/// IMM's folder of every mod (3DMigoto skips it: its name starts with DISABLED).
pub const STORE: &str = "DISABLED - ALL MODS ARE STORED HERE (Managed by IMM)";
/// IMM's folder of links to the enabled mods.
pub const LINKS: &str = "DO NOT MODIFY (Managed by IMM)";
pub const PROCESS: &str = "integrated-mod-manager.exe";
/// IMM's option values, inside the links folder.
const PREFS: &str = ".USER_PREFS";
/// Inside a mod: IMM's copies of the author's inis from before its key edits (`default\<path in the mod>`).
const INI_BACKUP: &str = "DISABLED_IMM_INI_BACKUP";
/// Restore points (new and old folder name) and mods IMM was told to leave alone, in the store.
const RESTORE: &[&str] = &["RESTORE", "DISABLED_RESTORE"];
const IGNORE: &str = "IGNORE";

/// IMM's game codes and ours.
const CODES: &[(&str, &str)] = &[("WW", "ww"), ("ZZ", "zzz"), ("GI", "gi"), ("SR", "hsr"), ("EF", "ef")];

fn imm_dir() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|d| PathBuf::from(d).join("Integrated Mod Manager (IMM)"))
}

/// `config<CODE>.json` in IMM's folder, any case.
fn config_path(dir: &Path, code: &str) -> Option<PathBuf> {
    let want = format!("config{code}.json").to_ascii_lowercase();
    fs::read_dir(dir).ok()?.flatten().find(|e| e.file_name().to_string_lossy().to_ascii_lowercase() == want).map(|e| e.path())
}

/// A link (symlink or junction), not followed.
fn is_link(p: &Path) -> bool { fs::symlink_metadata(p).map(|m| m.file_type().is_symlink()).unwrap_or(false) }

fn is_real_dir(p: &Path) -> bool { fs::symlink_metadata(p).map(|m| m.is_dir() && !m.file_type().is_symlink()).unwrap_or(false) }

/// A folder that directly holds an .ini or a sidecar is a mod.
fn looks_like_mod(dir: &Path) -> bool {
    fs::read_dir(dir).into_iter().flatten().flatten().any(|e| {
        let n = e.file_name().to_string_lossy().to_ascii_lowercase();
        n == crate::model::SIDECAR_FILE || (n.ends_with(".ini") && n != "desktop.ini" && !library::is_disabled_name(&n))
    })
}

fn children(dir: &Path) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = fs::read_dir(dir).into_iter().flatten().flatten().map(|e| e.path()).collect();
    v.sort();
    v
}

fn name_of(p: &Path) -> String { p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default() }

/// A folder of IMM's own at the top of its store or links folder: restore points, IGNORE, dot folders (.USER_PREFS).
fn imm_own(name: &str) -> bool {
    name.starts_with('.') || name.eq_ignore_ascii_case(IGNORE) || RESTORE.iter().any(|r| r.eq_ignore_ascii_case(name))
}

/// Mods in IMM's store: ("Category/mod" or "mod", folder).
fn store_mods(store: &Path) -> Vec<(String, PathBuf)> {
    let mut out = Vec::new();
    for c in children(store).into_iter().filter(|c| is_real_dir(c) && !imm_own(&name_of(c))) {
        if looks_like_mod(&c) { out.push((name_of(&c), c)); continue; }
        for g in children(&c).into_iter().filter(|g| is_real_dir(g) && !name_of(g).starts_with('.')) {
            out.push((format!("{}/{}", name_of(&c), name_of(&g)), g));
        }
    }
    out
}

/// IMM's restore points left in its store.
fn restore_points(store: &Path) -> usize {
    children(store).into_iter()
        .filter(|c| is_real_dir(c) && RESTORE.iter().any(|r| r.eq_ignore_ascii_case(&name_of(c))))
        .map(|c| children(&c).into_iter().filter(|p| is_real_dir(p)).count())
        .sum()
}

/// IMM's links folder: the keys of linked (enabled) mods, the links themselves, and real folders someone put there.
struct Links { enabled: HashSet<String>, links: Vec<PathBuf>, real: Vec<(String, PathBuf)> }

fn read_links(dir: &Path) -> Links {
    let mut l = Links { enabled: HashSet::new(), links: Vec::new(), real: Vec::new() };
    for c in children(dir) {
        if imm_own(&name_of(&c)) { continue; }
        if is_link(&c) { l.enabled.insert(name_of(&c).to_lowercase()); l.links.push(c); continue; }
        if !is_real_dir(&c) { continue; }
        if looks_like_mod(&c) { l.real.push((name_of(&c), c)); continue; }
        for g in children(&c) {
            if name_of(&g).starts_with('.') { continue; }
            let key = format!("{}/{}", name_of(&c), name_of(&g));
            if is_link(&g) { l.enabled.insert(key.to_lowercase()); l.links.push(g); } else if is_real_dir(&g) { l.real.push((key, g)); }
        }
    }
    l
}

// ── IMM's config ──

/// One option value IMM set for a mod. `key` is the ini's path inside the mod ("sub/mod.ini") or, for an ini that
/// declares a namespace, that namespace (lowercased, forward slashes).
#[derive(Debug, Clone, PartialEq)]
struct Pref { key: String, var: String, value: String }

impl Pref {
    fn new(key: &str, var: &str, value: &str) -> Pref {
        Pref {
            key: key.trim().replace('\\', "/").trim_matches('/').to_lowercase(),
            var: var.trim().trim_start_matches('$').to_lowercase(),
            value: ini::norm_value(value),
        }
    }
    fn is_ini(&self) -> bool { self.key.ends_with(".ini") }
}

/// What IMM knew about one mod.
#[derive(Debug, Clone, Default)]
struct ImmMod {
    source: Option<String>,
    tags: Vec<String>,
    note: Option<String>,
    /// Unix seconds.
    installed: Option<i64>,
    /// The mod's update time on GameBanana when this copy was installed, unix seconds.
    updated: Option<i64>,
    prefs: Vec<Pref>,
}

/// One of IMM's presets: lowercased mod keys ("category/mod") it turns on, and its hotkey as IMM wrote it.
#[derive(Debug, Clone, Default)]
struct Preset { name: String, mods: Vec<String>, hotkey: Option<String> }

#[derive(Debug, Clone, Default)]
struct Config { mods: HashMap<String, ImmMod>, presets: Vec<Preset> }

/// "Category\\Mod" -> "category/mod".
fn norm_key(k: &str) -> String { k.split(['/', '\\']).filter(|p| !p.is_empty()).collect::<Vec<_>>().join("/").to_lowercase() }

fn text(v: Option<&Value>) -> Option<String> {
    match v? {
        Value::String(s) => Some(s.trim().to_string()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }.filter(|s| !s.is_empty())
}

/// A time from IMM's config as unix seconds. Newer versions write milliseconds, older ones seconds.
fn imm_time(v: Option<&Value>) -> Option<i64> {
    let n = v.and_then(|v| v.as_f64().or_else(|| v.as_str().and_then(|s| s.trim().parse().ok())))?;
    let secs = (if n > 1e11 { n / 1000.0 } else { n }) as i64;
    (secs > 946_684_800 && secs < crate::db::now() + 366 * 86_400).then_some(secs)
}

/// `vars[<ini or namespace>][<var>].pref` from one `data` entry.
fn config_prefs(vars: Option<&Value>) -> Vec<Pref> {
    let mut out = Vec::new();
    for (key, vs) in vars.and_then(Value::as_object).into_iter().flatten() {
        for (var, x) in vs.as_object().into_iter().flatten() {
            if let Some(value) = text(x.get("pref")) { out.push(Pref::new(key, var, &value)); }
        }
    }
    out
}

fn read_config(path: Option<&Path>) -> Config {
    let Some(raw) = path.and_then(|p| fs::read(p).ok()).map(|b| ini::decode(&b)) else { return Config::default() };
    let Ok(v) = serde_json::from_str::<Value>(raw.trim_start_matches('\u{feff}')) else { return Config::default() };
    let mut cfg = Config::default();
    for (k, d) in v.get("data").and_then(Value::as_object).into_iter().flatten() {
        let tags = d.get("tags").and_then(Value::as_array).into_iter().flatten()
            .filter_map(|t| text(Some(t))).collect();
        cfg.mods.insert(norm_key(k), ImmMod {
            source: text(d.get("source")),
            tags,
            note: text(d.get("note")).map(|n| n.chars().take(2000).collect()),
            installed: imm_time(d.get("installedAt")).or_else(|| imm_time(d.get("addedAt"))),
            updated: imm_time(d.get("updatedAt")),
            prefs: config_prefs(d.get("vars")),
        });
    }
    for p in v.get("presets").and_then(Value::as_array).into_iter().flatten() {
        let mods = p.get("data").and_then(Value::as_array).into_iter().flatten()
            .filter_map(Value::as_str).map(norm_key).filter(|k| !k.is_empty()).collect();
        let name = text(p.get("name")).unwrap_or_else(|| "Preset".into());
        cfg.presets.push(Preset { name, mods, hotkey: text(p.get("hotkey")) });
    }
    cfg
}

/// IMM's `.USER_PREFS` folder (`<Category>\<mod>.ini`, each a `[constants]` list of
/// `$\mods\do not modify (managed by imm)\<category>\<mod>\<ini>\<var>=<value>` or `$\<namespace>\<var>=<value>`):
/// lowercased mod key -> values.
fn read_prefs_dir(dir: &Path) -> HashMap<String, Vec<Pref>> {
    let is_ini = |p: &Path| p.is_file() && name_of(p).to_ascii_lowercase().ends_with(".ini");
    let stem = |p: &Path| p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let mut files = Vec::new();
    for c in children(dir) {
        if is_real_dir(&c) {
            for f in children(&c).into_iter().filter(|f| is_ini(f)) { files.push((format!("{}/{}", name_of(&c), stem(&f)), f)); }
        } else if is_ini(&c) {
            files.push((stem(&c), c));
        }
    }
    let mut out = HashMap::new();
    for (key, f) in files {
        let key = norm_key(&key);
        let Ok(bytes) = fs::read(&f) else { continue };
        let inside = format!("{}\\{}\\", LINKS.to_lowercase(), key.replace('/', "\\"));
        let mut prefs = Vec::new();
        for line in ini::decode(&bytes).lines() {
            let Some((name, value)) = line.trim().strip_prefix('$').and_then(|r| r.split_once('=')) else { continue };
            let name = name.trim().trim_start_matches('\\').to_lowercase();
            if value.trim().is_empty() { continue; }
            let split = match name.find(&inside) {
                Some(at) => name[at + inside.len()..].rsplit_once('\\').filter(|(ini, _)| ini.ends_with(".ini")),
                None => name.rsplit_once('\\'),
            };
            if let Some((k, var)) = split.filter(|(k, v)| !k.is_empty() && !v.is_empty()) { prefs.push(Pref::new(k, var, value)); }
        }
        if !prefs.is_empty() { out.insert(key, prefs); }
    }
    out
}

/// "https://gamebanana.com/mods/676139" -> the mod id.
fn gb_mod_id(url: &str) -> Option<u64> {
    let lower = url.to_ascii_lowercase();
    let at = lower.find("gamebanana.com/mods/")? + "gamebanana.com/mods/".len();
    let digits: String = lower[at..].chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse().ok().filter(|&n| n > 0)
}

/// IMM's preset hotkey ("alt+control+digit1", "Ctrl+Alt+1") in gachamod's profile form ("Ctrl+Alt+1"), when
/// gachamod accepts it.
fn imm_hotkey(raw: &str) -> Option<String> {
    let parts: Vec<String> = raw.split('+').map(|p| {
        let p = p.trim().to_ascii_lowercase();
        let p = p.strip_prefix("arrow").map(str::to_string).unwrap_or(p);
        match p.strip_prefix("digit").or_else(|| p.strip_prefix("key")) { Some(r) if r.len() == 1 => r.to_string(), _ => p }
    }).collect();
    crate::hotkeys::normalize(&parts.join("+")).ok()
}

fn count(mods_dir: &Path, cfg: &Config) -> (u32, u32, u32) {
    let store = store_mods(&mods_dir.join(STORE));
    let links = read_links(&mods_dir.join(LINKS));
    let with_source = store.iter().filter(|(k, _)| cfg.mods.get(&norm_key(k)).is_some_and(|m| m.source.is_some())).count();
    ((store.len() + links.real.len()) as u32, (links.enabled.len() + links.real.len()) as u32, with_source as u32)
}

pub fn detect(db: &Db) -> Result<ImmInfo> { Ok(detect_in(db, imm_dir().as_deref())) }

fn detect_in(db: &Db, dir: Option<&Path>) -> ImmInfo {
    let dir = dir.filter(|d| d.is_dir());
    let mut info = ImmInfo { found: dir.is_some(), dir: dir.map(|d| d.to_string_lossy().into_owned()), games: Vec::new() };
    for (code, game) in CODES {
        let config = dir.and_then(|d| config_path(d, code));
        let Some(mods_dir) = crate::games::paths(db, game).ok().and_then(|p| p.mods_dir).map(PathBuf::from) else { continue };
        if !mods_dir.join(STORE).is_dir() && !mods_dir.join(LINKS).is_dir() { continue; }
        let (mods, enabled, with_source) = count(&mods_dir, &read_config(config.as_deref()));
        if mods == 0 && enabled == 0 { continue; }
        info.found = true;
        info.games.push(ImmGame { game: game.to_string(), config: config.map(|c| c.to_string_lossy().into_owned()).unwrap_or_default(), mods, enabled, with_source });
    }
    info
}

// ── the move ──

/// One folder to move.
struct Step {
    from: PathBuf, to: PathBuf, to_rel: String, link_rel: Option<String>,
    /// IMM's key, lowercased ("category/mod").
    key: String,
    enabled: bool,
    /// The roster character IMM's category names, if it names one ("Uncategorized" and "UI" don't).
    character: Option<String>,
    name: String,
    info: ImmMod,
}

/// A mod that moved.
struct Moved {
    id: String,
    key: String,
    name: String,
    dir: PathBuf,
    /// Option values for a mod that is off, for the library to keep until it is turned on.
    stash: Vec<VarValue>,
}

#[derive(Default)]
struct Outcome {
    moved: Vec<Moved>,
    notes: Vec<String>,
    /// Option values written to d3dx_user.ini.
    values: usize,
    restore_points: usize,
    /// IMM's .USER_PREFS folder, read and ready to go.
    prefs_dir: Option<PathBuf>,
}

/// Remove a link itself, never what it points to.
fn remove_link(p: &Path) -> std::io::Result<()> {
    // a junction or directory symlink goes with remove_dir; a file symlink with remove_file
    fs::remove_dir(p).or_else(|_| fs::remove_file(p))
}

/// Remove empty folders from the bottom up (never following links).
fn prune_empty(dir: &Path) {
    if !is_real_dir(dir) { return; }
    for c in children(dir) { if is_real_dir(&c) { prune_empty(&c); } }
    let _ = fs::remove_dir(dir);
}

fn plan(mods_dir: &Path, cfg: &Config, prefs: &HashMap<String, Vec<Pref>>, m: &Matcher) -> Result<(Vec<Step>, Links)> {
    let links = read_links(&mods_dir.join(LINKS));
    let mut steps = Vec::new();
    let mut add = |key: &str, from: PathBuf, enabled: bool, linked: bool| {
        let parts: Vec<&str> = key.split('/').collect();
        let (group, raw) = if parts.len() == 2 { (Some(parts[0].to_string()), parts[1]) } else { (None, parts[0]) };
        let name = library::display_folder(raw).to_string();
        let name = if name.is_empty() { raw.to_string() } else { name };
        let folder = if enabled { name.clone() } else { format!("{DISABLED_PREFIX}{name}") };
        let to_rel = match &group { Some(c) => format!("{c}/{folder}"), None => folder.clone() };
        let norm = norm_key(key);
        let mut info = cfg.mods.get(&norm).cloned().unwrap_or_default();
        // the values IMM loads (its .USER_PREFS file) first, then what its config holds besides
        let mut all = prefs.get(&norm).cloned().unwrap_or_default();
        for p in info.prefs.drain(..) {
            if !all.iter().any(|a| a.key == p.key && a.var == p.var) { all.push(p); }
        }
        info.prefs = all;
        steps.push(Step {
            to: mods_dir.join(&to_rel), from, to_rel,
            link_rel: (enabled && linked).then(|| format!("{LINKS}/{key}")),
            key: norm, enabled,
            character: group.as_deref().and_then(|g| m.exact(g).or_else(|| m.best(&[g]))),
            name, info,
        });
    };
    for (key, from) in store_mods(&mods_dir.join(STORE)) {
        let on = links.enabled.contains(&key.to_lowercase());
        add(&key, from, on, on);
    }
    for (key, from) in &links.real { add(key, from.clone(), true, true); }
    // refuse before touching anything when a target is taken
    let mut seen = HashSet::new();
    let mut taken: Vec<String> = Vec::new();
    for s in &steps {
        if s.to.exists() || !seen.insert(s.to_rel.to_lowercase()) { taken.push(s.to_rel.clone()); }
    }
    if !taken.is_empty() {
        let shown = taken.iter().take(5).cloned().collect::<Vec<_>>().join(", ");
        let more = if taken.len() > 5 { format!(" and {} more", taken.len() - 5) } else { String::new() };
        return Err(Error::Conflict(format!("These folders are already in Mods: {shown}{more}. Rename or move them, then try again")));
    }
    Ok((steps, links))
}

/// Write the values IMM set for a mod that is on into d3dx_user.ini at its new path, where the file has none yet
/// (3DMigoto reads d3dx_user.ini after every mod ini, so a line already there is what the game shows). Returns how
/// many were written.
fn write_prefs(imp: &Path, s: &Step) -> Result<usize> {
    let have: HashSet<(String, String)> = ini::user_vars(imp, &s.to_rel)?.into_iter()
        .map(|v| (v.ini.to_lowercase(), v.var.to_lowercase())).collect();
    let missing: Vec<VarValue> = s.info.prefs.iter()
        .filter(|p| p.is_ini() && !have.contains(&(p.key.clone(), p.var.clone())))
        .map(|p| VarValue { ini: p.key.clone(), var: p.var.clone(), value: p.value.clone() }).collect();
    ini::set_user_vars(imp, &s.to_rel, &missing)?;
    let mut n = missing.len();
    // a namespaced ini's values don't depend on the folder
    for p in s.info.prefs.iter().filter(|p| !p.is_ini()) {
        let name = format!("{}\\{}", p.key.replace('/', "\\"), p.var);
        if ini::user_value(imp, &name).is_none() { ini::set_user_value(imp, &name, &p.value)?; n += 1; }
    }
    Ok(n)
}

/// Move everything out of IMM's folders, leaving its restore points, IGNORE folder and .USER_PREFS (read, not moved).
fn move_out(mods_dir: &Path, importer_dir: Option<&Path>, cfg: &Config, m: &Matcher) -> Result<Outcome> {
    let prefs_dir = mods_dir.join(LINKS).join(PREFS);
    let prefs = if is_real_dir(&prefs_dir) { read_prefs_dir(&prefs_dir) } else { HashMap::new() };
    let (steps, links) = plan(mods_dir, cfg, &prefs, m)?;
    let mut out = Outcome { restore_points: restore_points(&mods_dir.join(STORE)), ..Default::default() };
    if steps.is_empty() { out.notes.push("IMM has no mods for this game".into()); return Ok(out); }
    // the links first, so nothing points at folders that are about to move
    for l in &links.links {
        if let Err(e) = remove_link(l) { out.notes.push(format!("Couldn't remove IMM's link {}: {}", name_of(l), crate::error::io_text(&e))); }
    }
    for s in &steps {
        if let Some(parent) = s.to.parent() { fs::create_dir_all(parent)?; }
        if let Err(e) = crate::pack::move_dir(&s.from, &s.to) { out.notes.push(format!("Couldn't move {}: {e}", s.name)); continue; }
        if let (Some(imp), Some(from_rel)) = (importer_dir, &s.link_rel) {
            if let Err(e) = ini::move_user_vars(imp, from_rel, &s.to_rel) { out.notes.push(format!("Couldn't keep {}'s options: {e}", s.name)); }
        }
        let mut stash = Vec::new();
        if s.enabled {
            if let Some(imp) = importer_dir.filter(|_| !s.info.prefs.is_empty()) {
                match write_prefs(imp, s) {
                    Ok(n) => out.values += n,
                    Err(e) => out.notes.push(format!("Couldn't keep {}'s options: {e}", s.name)),
                }
            }
        } else {
            stash = s.info.prefs.iter().filter(|p| p.is_ini())
                .map(|p| VarValue { ini: p.key.clone(), var: p.var.clone(), value: p.value.clone() }).collect();
        }
        let existing = library::read_sidecar(&s.to);
        let fresh = existing.is_none();
        let mut sc = existing.unwrap_or_else(|| Sidecar { format: 1, id: library::new_id(), installed_at: crate::db::now(), ..Default::default() });
        if sc.id.is_empty() { sc.id = library::new_id(); }
        if sc.name.is_empty() { sc.name = s.name.clone(); }
        if sc.character.is_none() { sc.character = s.character.clone(); }
        if sc.source.is_none() {
            if let Some(id) = s.info.source.as_deref().and_then(gb_mod_id) {
                sc.source = Some(ModSource {
                    site: "gamebanana".into(), mod_id: id, url: format!("https://gamebanana.com/mods/{id}"),
                    remote_updated: s.info.updated, ..Default::default()
                });
            }
        }
        if sc.tags.is_empty() { sc.tags = s.info.tags.clone(); }
        if sc.notes.is_none() { sc.notes = s.info.note.clone(); }
        if fresh { if let Some(t) = s.info.installed { sc.installed_at = t; } }
        match library::write_sidecar(&s.to, &sc) {
            Ok(()) => out.moved.push(Moved { id: sc.id, key: s.key.clone(), name: s.name.clone(), dir: s.to.clone(), stash }),
            Err(e) => out.notes.push(format!("Moved {}, but couldn't write the details: {e}", s.name)),
        }
    }
    if is_real_dir(&prefs_dir) { out.prefs_dir = Some(prefs_dir); }
    prune_empty(&mods_dir.join(STORE));
    prune_empty(&mods_dir.join(LINKS));
    Ok(out)
}

/// Hand IMM's copies of the author's inis to originals, so "Put back original files" undoes IMM's key edits too.
/// Returns how many files.
fn keep_originals(db: &Db, game: &str, m: &Moved) -> Result<usize> {
    let base = m.dir.join(INI_BACKUP).join("default");
    if !is_real_dir(&base) { return Ok(0); }
    let mut n = 0;
    for e in walkdir::WalkDir::new(&base).follow_links(false).max_depth(10).into_iter().flatten() {
        if !e.file_type().is_file() || !name_of(e.path()).to_ascii_lowercase().ends_with(".ini") { continue; }
        let Ok(rel) = e.path().strip_prefix(&base) else { continue };
        let rel = rel.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/");
        let Ok(current) = fs::read(m.dir.join(&rel)) else { continue };
        let original = fs::read(e.path())?;
        if original != current && crate::originals::adopt(db, game, &m.id, &rel, &original, &current)? { n += 1; }
    }
    Ok(n)
}

/// A profile for each of IMM's presets, with its mods on and the other moved mods off. Returns their ids.
fn make_profiles(db: &Db, game: &str, presets: &[Preset], moved: &[Moved], notes: &mut Vec<String>) -> Vec<i64> {
    let by_key: HashMap<&str, &str> = moved.iter().map(|m| (m.key.as_str(), m.id.as_str())).collect();
    let mut made = Vec::new();
    for p in presets {
        let on: HashSet<&str> = p.mods.iter().filter_map(|k| by_key.get(k.as_str()).copied()).collect();
        let states: HashMap<String, bool> = moved.iter().map(|m| (m.id.clone(), on.contains(m.id.as_str()))).collect();
        let existing = match crate::profiles::list(db, game) {
            Ok(l) => l,
            Err(e) => { notes.push(format!("Couldn't make profiles from IMM's presets: {e}")); break; }
        };
        let name = if existing.iter().any(|x| x.name.trim().eq_ignore_ascii_case(p.name.trim())) { format!("{} (IMM)", p.name) } else { p.name.clone() };
        let prof = match crate::profiles::create_with(db, game, &name, &states) {
            Ok(x) => x,
            Err(e) => { notes.push(format!("Couldn't make the profile {name}: {e}")); continue; }
        };
        made.push(prof.id);
        let Some(raw) = &p.hotkey else { continue };
        match imm_hotkey(raw) {
            None => notes.push(format!("{} has no hotkey: gachamod can't use IMM's {raw}", prof.name)),
            Some(c) => match existing.iter().find(|x| x.hotkey.as_deref() == Some(c.as_str())) {
                Some(o) => notes.push(format!("{} has no hotkey: {c} already switches to {}", prof.name, o.name)),
                None => if let Err(e) = crate::hotkeys::set_for_profile(db, prof.id, Some(&c)) {
                    notes.push(format!("Couldn't give {} the hotkey {c}: {e}", prof.name));
                },
            },
        }
    }
    made
}

fn plural(n: usize, one: &str, many: &str) -> String { if n == 1 { format!("1 {one}") } else { format!("{n} {many}") } }

/// Move one game's IMM mods into gachamod's layout (`Mods/<Category>/<mod>`, DISABLED prefix when off), keep their
/// saved variable values (rewriting d3dx_user.ini keys to the new paths, plus the values IMM set itself), write
/// sidecars with what IMM knew (GameBanana source, tags, note, install and update times), make a profile per IMM
/// preset, and rescan. IMM must be closed.
pub fn takeover(db: &crate::db::Shared, game: &str) -> Result<crate::pack::ImportResult> {
    let _hold = crate::watch::hold(game);
    if crate::launch::process_running(PROCESS) {
        return Err(Error::Conflict("Close Integrated Mod Manager first. It would put the folders back while the mods move".into()));
    }
    if crate::launch::running(game) {
        return Err(Error::Conflict("Close the game first. Mods can't move while it has them open".into()));
    }
    let code = CODES.iter().find(|(_, g)| *g == game).map(|(c, _)| *c)
        .ok_or_else(|| Error::Invalid("Integrated Mod Manager doesn't manage this game".into()))?;
    let config = imm_dir().and_then(|d| config_path(&d, code));
    takeover_in(db, game, &read_config(config.as_deref()), &|p| crate::recycle::to_recycle_bin(&[p.to_path_buf()]))
}

/// The takeover after its checks. `discard` puts IMM's read .USER_PREFS folder somewhere it can come back from.
fn takeover_in(db: &crate::db::Shared, game: &str, cfg: &Config, discard: &dyn Fn(&Path) -> Result<()>) -> Result<crate::pack::ImportResult> {
    let (mods_dir, importer_dir, matcher) = {
        let db = db.lock().unwrap_or_else(|e| e.into_inner());
        (crate::games::mods_dir(&db, game)?, crate::games::importer_dir(&db, game).ok(), library::matcher(&db, game)?)
    };
    let mut out = move_out(&mods_dir, importer_dir.as_deref(), cfg, &matcher)?;
    let mut notes = std::mem::take(&mut out.notes);
    if let Some(p) = &out.prefs_dir {
        // 3DMigoto would still load it, setting values of folders that are gone
        match discard(p) {
            Ok(()) => prune_empty(&mods_dir.join(LINKS)),
            Err(e) => notes.push(format!("Couldn't send IMM's {PREFS} folder to the Recycle Bin: {e}")),
        }
    }
    match library::scan(db, game) {
        Ok(_) | Err(Error::Todo(_)) => {}
        Err(e) => notes.push(format!("The mods moved, but the rescan failed: {e}")),
    }
    let mut values = out.values;
    let mut profiles = Vec::new();
    if !out.moved.is_empty() {
        let db = db.lock().unwrap_or_else(|e| e.into_inner());
        for m in &out.moved {
            if !m.stash.is_empty() {
                match library::stash_vars(&db, game, &m.id, &m.stash) {
                    Ok(()) => values += m.stash.len(),
                    Err(e) => notes.push(format!("Couldn't keep {}'s options: {e}", m.name)),
                }
            }
            if let Err(e) = keep_originals(&db, game, m) { notes.push(format!("Couldn't keep IMM's copy of {}'s original files: {e}", m.name)); }
        }
        profiles = make_profiles(&db, game, &cfg.presets, &out.moved, &mut notes);
    }
    let ids: Vec<String> = out.moved.iter().map(|m| m.id.clone()).collect();
    let mut head = Vec::new();
    if !ids.is_empty() {
        head.push(format!("Moved {} from Integrated Mod Manager", plural(ids.len(), "mod", "mods")));
        crate::devtools::mark_changed(game);
    }
    if values > 0 { head.push(format!("Kept {} IMM had set", plural(values, "option value", "option values"))); }
    if !profiles.is_empty() { head.push(format!("Made {} from IMM's presets", plural(profiles.len(), "profile", "profiles"))); }
    if out.restore_points > 0 {
        head.push(format!("Left {} in IMM's RESTORE folder", plural(out.restore_points, "IMM restore point", "IMM restore points")));
    }
    head.extend(notes);
    Ok(crate::pack::ImportResult { added: ids, profiles, notes: head, ..Default::default() })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("gachamod-imm-{name}-{}", library::new_id()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn mod_at(dir: &Path) {
        fs::create_dir_all(dir).unwrap();
        fs::write(dir.join("mod.ini"), "[TextureOverrideA]\nhash = 12345678\n").unwrap();
    }

    /// A directory link: a symlink when Windows allows it, else a junction.
    fn link_dir(target: &Path, link: &Path) -> bool {
        #[cfg(windows)]
        {
            if std::os::windows::fs::symlink_dir(target, link).is_ok() { return true; }
            std::process::Command::new("cmd").args(["/C", "mklink", "/J"]).arg(link).arg(target)
                .stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status().is_ok_and(|s| s.success())
        }
        #[cfg(not(windows))]
        { std::os::unix::fs::symlink(target, link).is_ok() }
    }

    fn no_roster() -> Matcher { Matcher::plain(&[]) }

    fn config(dir: &Path, json: &str) -> Config {
        let p = dir.join("configZZ.json");
        fs::write(&p, json).unwrap();
        read_config(Some(&p))
    }

    /// A game set up with its Mods folder inside `imp`, for the whole takeover.
    fn shared_with(imp: &Path) -> crate::db::Shared {
        let db = Db::memory().unwrap();
        crate::games::save_paths(&db, "zzz", &crate::games::GamePaths {
            mods_dir: Some(imp.join("Mods").to_string_lossy().into()), importer_dir: Some(imp.to_string_lossy().into()), ..Default::default()
        }).unwrap();
        std::sync::Arc::new(std::sync::Mutex::new(db))
    }

    #[test]
    fn moves_mods_out_of_imm() {
        let imp = temp("move");
        let mods = imp.join("Mods");
        let store = mods.join(STORE);
        mod_at(&store.join("Ellen Joe/Coca Cola"));
        mod_at(&store.join("Ellen Joe/Bunny"));
        mod_at(&store.join("Loose"));
        fs::create_dir_all(mods.join(LINKS).join("Ellen Joe")).unwrap();
        let linked = link_dir(&store.join("Ellen Joe/Coca Cola"), &mods.join(LINKS).join("Ellen Joe/Coca Cola"));
        fs::write(imp.join("d3dx_user.ini"), format!("[Constants]\r\n$\\mods\\{}\\ellen joe\\coca cola\\mod.ini\\swapvar = 2\r\n", LINKS.to_lowercase())).unwrap();
        let cfg = config(&imp, r#"{"data":{"Ellen Joe\\Coca Cola":{"source":"https://gamebanana.com/mods/676139"}}}"#);

        let out = move_out(&mods, Some(&imp), &cfg, &no_roster()).unwrap();
        assert_eq!(out.moved.len(), 3, "{:?}", out.notes);
        if linked {
            assert!(mods.join("Ellen Joe/Coca Cola/mod.ini").is_file(), "{:?}", out.notes);
            let sc = library::read_sidecar(&mods.join("Ellen Joe/Coca Cola")).unwrap();
            assert_eq!(sc.source.unwrap().mod_id, 676139);
            assert_eq!(crate::ini::user_vars(&imp, "Ellen Joe/Coca Cola").unwrap()[0].value, "2");
            assert!(!mods.join(LINKS).exists());
        }
        assert!(mods.join("Ellen Joe/DISABLED Bunny/mod.ini").is_file());
        assert!(mods.join("DISABLED Loose/mod.ini").is_file());
        assert!(!store.exists());
        fs::remove_dir_all(&imp).unwrap();
    }

    #[test]
    fn user_prefs_folder_is_not_a_mod() {
        let imp = temp("prefs");
        let mods = imp.join("Mods");
        let store = mods.join(STORE);
        mod_at(&store.join("Ellen Joe/Coca Cola"));
        mod_at(&store.join("Ellen Joe/Coca Cola/sub"));
        mod_at(&store.join("Ellen Joe/Bunny"));
        fs::create_dir_all(mods.join(LINKS).join("Ellen Joe")).unwrap();
        let linked = link_dir(&store.join("Ellen Joe/Coca Cola"), &mods.join(LINKS).join("Ellen Joe/Coca Cola"));
        let prefs = mods.join(LINKS).join(".USER_PREFS/Ellen Joe");
        fs::create_dir_all(&prefs).unwrap();
        let links = LINKS.to_lowercase();
        fs::write(prefs.join("Coca Cola.ini"), format!(
            ";-- set by imm --\n[constants]\n$\\mods\\{links}\\ellen joe\\coca cola\\sub\\mod.ini\\swapvar=1\n$\\mods\\{links}\\ellen joe\\coca cola\\mod.ini\\kept=4\n$\\cocacola_ns\\hat=0\n;-- end imm --"
        )).unwrap();
        // the value already in d3dx_user.ini is what the game shows: it stays
        fs::write(imp.join("d3dx_user.ini"), format!("[Constants]\r\n$\\mods\\{links}\\ellen joe\\coca cola\\mod.ini\\kept = 2\r\n")).unwrap();
        let cfg = config(&imp, r#"{"data":{"Ellen Joe\\Bunny":{"vars":{"mod.ini":{"swapvar":{"pref":"3","state":"1"}}}}}}"#);

        let out = move_out(&mods, Some(&imp), &cfg, &no_roster()).unwrap();
        assert!(!mods.join(".USER_PREFS").exists(), "IMM's preferences folder moved into Mods as a mod");
        assert_eq!(out.moved.len(), 2, "{:?}", out.notes);
        let bunny = out.moved.iter().find(|m| m.key == "ellen joe/bunny").unwrap();
        assert_eq!(bunny.stash, vec![VarValue { ini: "mod.ini".into(), var: "swapvar".into(), value: "3".into() }]);
        assert_eq!(out.prefs_dir.as_deref(), Some(mods.join(LINKS).join(PREFS).as_path()));
        if linked {
            let mut vals = crate::ini::user_vars(&imp, "Ellen Joe/Coca Cola").unwrap();
            vals.sort_by(|a, b| a.var.cmp(&b.var));
            let got: Vec<(&str, &str, &str)> = vals.iter().map(|v| (v.ini.as_str(), v.var.as_str(), v.value.as_str())).collect();
            assert_eq!(got, vec![("mod.ini", "kept", "2"), ("sub/mod.ini", "swapvar", "1")]);
            assert_eq!(crate::ini::user_value(&imp, "cocacola_ns\\hat").as_deref(), Some("0"));
            assert_eq!(out.values, 2);
        }
        fs::remove_dir_all(&imp).unwrap();
    }

    #[test]
    fn restore_points_stay() {
        let imp = temp("restore");
        let mods = imp.join("Mods");
        mod_at(&mods.join(STORE).join("Ellen Joe/Bunny"));
        mod_at(&mods.join(STORE).join("RESTORE/RESTORE-2026-01-02/Ellen Joe"));
        mod_at(&mods.join(STORE).join("RESTORE/RESTORE-2026-02-03/Ellen Joe"));
        mod_at(&mods.join(STORE).join("IGNORE/Kept"));
        let out = move_out(&mods, None, &Config::default(), &no_roster()).unwrap();
        assert_eq!(out.moved.len(), 1);
        assert_eq!(out.restore_points, 2);
        assert!(!mods.join("RESTORE").exists(), "a restore point moved into Mods as a mod");
        assert!(!mods.join("IGNORE").exists());
        assert!(mods.join(STORE).join("RESTORE/RESTORE-2026-01-02/Ellen Joe/mod.ini").is_file());
        fs::remove_dir_all(&imp).unwrap();
    }

    #[test]
    fn carries_what_imm_knew() {
        let imp = temp("known");
        let mods = imp.join("Mods");
        mod_at(&mods.join(STORE).join("Ellen Joe/Bunny"));
        mod_at(&mods.join(STORE).join("Uncategorized/Hud"));
        let cfg = config(&imp, r#"{"data":{"Ellen Joe/Bunny":{"source":"https://gamebanana.com/mods/5","tags":["cute"," "],"note":"from a friend",
            "installedAt":1760000000000,"updatedAt":1750000000},"Uncategorized\\Hud":{"addedAt":1755000000000}}}"#);
        let roster = Matcher::plain(&["Ellen Joe".to_string()]);
        move_out(&mods, None, &cfg, &roster).unwrap();
        let sc = library::read_sidecar(&mods.join("Ellen Joe/DISABLED Bunny")).unwrap();
        assert_eq!(sc.tags, vec!["cute".to_string()]);
        assert_eq!(sc.notes.as_deref(), Some("from a friend"));
        assert_eq!(sc.installed_at, 1_760_000_000);
        assert_eq!(sc.source.unwrap().remote_updated, Some(1_750_000_000));
        assert_eq!(sc.character.as_deref(), Some("Ellen Joe"));
        let hud = library::read_sidecar(&mods.join("Uncategorized/DISABLED Hud")).unwrap();
        assert_eq!(hud.character, None, "a category that isn't a character");
        assert_eq!(hud.installed_at, 1_755_000_000);
        fs::remove_dir_all(&imp).unwrap();
    }

    #[test]
    fn presets_become_profiles_and_backups_become_originals() {
        let imp = temp("presets");
        let mods = imp.join("Mods");
        let store = mods.join(STORE);
        mod_at(&store.join("Ellen Joe/Bunny"));
        mod_at(&store.join("Ellen Joe/Maid"));
        // IMM changed a key and kept the author's ini
        fs::write(store.join("Ellen Joe/Maid/mod.ini"), "[KeySwap]\nkey = ctrl 1\n").unwrap();
        fs::create_dir_all(store.join("Ellen Joe/Maid").join(INI_BACKUP).join("default")).unwrap();
        fs::write(store.join("Ellen Joe/Maid").join(INI_BACKUP).join("default/mod.ini"), "[KeySwap]\nkey = 1\n").unwrap();
        let db = shared_with(&imp);
        crate::profiles::create(&db.lock().unwrap(), "zzz", "Combat", None).unwrap();
        let cfg = config(&imp, r#"{"data":{},"presets":[
            {"name":"Combat","data":["Ellen Joe\\Maid"],"hotkey":"alt+control+digit1"},
            {"name":"Cute","data":["Ellen Joe/Bunny","Gone/Mod"],"hotkey":"plus"}]}"#);
        let r = takeover_in(&db, "zzz", &cfg, &|p| Ok(fs::remove_dir_all(p)?)).unwrap();
        assert_eq!(r.added.len(), 2, "{:?}", r.notes);
        assert_eq!(r.profiles.len(), 2, "{:?}", r.notes);
        let d = db.lock().unwrap();
        let ps = crate::profiles::list(&d, "zzz").unwrap();
        let combat = ps.iter().find(|p| p.name == "Combat (IMM)").expect("a clash gets (IMM)");
        assert_eq!(combat.hotkey.as_deref(), Some("Ctrl+Alt+1"));
        let id_of = |name: &str| library::list(&d, "zzz").unwrap().into_iter().find(|m| m.name == name).unwrap().id;
        assert_eq!(crate::profiles::members(&d, combat.id).unwrap(), vec![id_of("Maid")]);
        let cute = ps.iter().find(|p| p.name == "Cute").unwrap();
        assert_eq!(cute.hotkey, None);
        assert_eq!(crate::profiles::members(&d, cute.id).unwrap(), vec![id_of("Bunny")]);
        assert!(r.notes.iter().any(|n| n.contains("Cute has no hotkey")), "{:?}", r.notes);
        let maid = id_of("Maid");
        let now = fs::read(mods.join("Ellen Joe/DISABLED Maid/mod.ini")).unwrap();
        assert_eq!(crate::originals::author(&d, "zzz", &maid, "mod.ini", &now).as_deref(), Some(&b"[KeySwap]\nkey = 1\n"[..]));
        assert!(crate::originals::original(&d, "zzz", &maid, "mod.ini", &now).is_none(), "an edit that leaves no marker keeps IMM's change");
        drop(d);
        fs::remove_dir_all(&imp).unwrap();
    }

    #[test]
    fn reads_imm_hotkeys_and_times() {
        assert_eq!(imm_hotkey("alt+control+digit1").as_deref(), Some("Ctrl+Alt+1"));
        assert_eq!(imm_hotkey("Ctrl+Alt+1").as_deref(), Some("Ctrl+Alt+1"));
        assert_eq!(imm_hotkey("alt+shift+keya").as_deref(), Some("Alt+Shift+A"));
        assert_eq!(imm_hotkey("control+arrowup").as_deref(), Some("Ctrl+Up"));
        assert_eq!(imm_hotkey("alt+numpad3").as_deref(), Some("Alt+Num3"));
        assert_eq!(imm_hotkey("shift+digit1"), None);
        assert_eq!(imm_hotkey("alt+comma"), None);
        assert_eq!(imm_time(Some(&serde_json::json!(1760000000123u64))), Some(1_760_000_000));
        assert_eq!(imm_time(Some(&serde_json::json!(1760000000))), Some(1_760_000_000));
        assert_eq!(imm_time(Some(&serde_json::json!(-1))), None);
        assert_eq!(imm_time(Some(&serde_json::json!(0))), None);
    }

    #[test]
    fn refuses_when_a_target_exists() {
        let imp = temp("clash");
        let mods = imp.join("Mods");
        mod_at(&mods.join(STORE).join("Ellen Joe/Bunny"));
        mod_at(&mods.join("Ellen Joe/DISABLED Bunny"));
        let err = move_out(&mods, None, &Config::default(), &no_roster()).err().unwrap();
        assert!(matches!(&err, Error::Conflict(m) if m.contains("Ellen Joe/DISABLED Bunny")), "{err}");
        // nothing moved
        assert!(mods.join(STORE).join("Ellen Joe/Bunny/mod.ini").is_file());
        fs::remove_dir_all(&imp).unwrap();
    }

    #[test]
    fn detects_counts() {
        let imp = temp("detect");
        let mods = imp.join("Mods");
        mod_at(&mods.join(STORE).join("Miyabi/Snow"));
        mod_at(&mods.join(STORE).join("RESTORE/RESTORE-2026-01-02/Miyabi"));
        let cfg = imp.join("imm");
        fs::create_dir_all(&cfg).unwrap();
        fs::write(cfg.join("configZZ.json"), r#"{"data":{"Miyabi\\Snow":{"source":"https://gamebanana.com/mods/5"}}}"#).unwrap();
        let db = Db::memory().unwrap();
        crate::games::save_paths(&db, "zzz", &crate::games::GamePaths { mods_dir: Some(mods.to_string_lossy().into()), ..Default::default() }).unwrap();
        let info = detect_in(&db, Some(&cfg));
        assert!(info.found);
        assert_eq!(info.games.len(), 1);
        assert_eq!((info.games[0].mods, info.games[0].enabled, info.games[0].with_source), (1, 0, 1));
        assert!(!detect_in(&Db::memory().unwrap(), Some(&imp.join("missing"))).found);
        fs::remove_dir_all(&imp).unwrap();
    }

    #[test]
    fn reads_gamebanana_ids() {
        assert_eq!(gb_mod_id("https://gamebanana.com/mods/676139"), Some(676139));
        assert_eq!(gb_mod_id("https://GameBanana.com/mods/12?x=1"), Some(12));
        assert_eq!(gb_mod_id("https://example.com"), None);
    }
}
