//! Moving from other mod managers: their mods kept outside the Mods folder, their presets, and what they know about
//! mods that gachamod can't read from the mod folders alone. Owner: MODTOOLS area (docs/spec.md, "Moving from other
//! managers"). Per-mod files inside Mods are managers.rs; IMM's own folders are imm.rs.
//!
//! Each reader below looks at one manager's files for one game and returns a `Source`: mods outside Mods, presets
//! (lists of references to mods), option values and details. Detection only reads (SQLite files open read-only).
//! The import places the outside mods in Mods, rescans, then turns presets into profiles.
//!
//! Links: managers like XX Mod Manager, ZZZ ModManager, Peaky and uyujkk's manager keep every mod in a folder of
//! their own and put a junction in Mods for each mod that is on. gachamod already sees those. With `Mode::Copy`
//! (the default) the links stay as they are and are adopted, so the other manager keeps working, and only the mods
//! it has off (which gachamod can't see) are copied in as turned-off folders. With `Mode::Move` the link itself is
//! removed (never what it points to) and the real folder moves into its place, and the off mods move in too: the
//! other manager's folder is left empty. Undo puts moved folders back (and the links), and sends copies to the
//! app's trash.

use crate::db::{Db, Shared};
use crate::error::{Error, Result};
use crate::ini::VarValue;
use crate::managers::SidecarBack;
use crate::model::{ModEntry, ModSource, DISABLED_PREFIX};
use crate::{games, launch, library, profiles};
use rusqlite::{params, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

// ── what the UI sees ──

/// Another manager found for a game.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OtherManager {
    /// "jasm", "xxmm", "peaky" ... (pass it back to `import`).
    pub id: String,
    pub name: String,
    /// Its settings file or folder.
    pub place: String,
    /// Its own folder of mods outside Mods, when it has one.
    pub library: Option<String>,
    /// Its mods gachamod already sees in Mods.
    pub inside: u32,
    /// Its mods outside Mods that gachamod can't see.
    pub outside: u32,
    /// Disk space a copy of those takes.
    pub outside_bytes: u64,
    pub presets: u32,
    /// It is open right now (import refuses until it closes).
    pub running: bool,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    /// Copy the outside mods in; the other manager keeps working.
    #[default]
    Copy,
    /// Move them in and replace its links with the real folders; its folder is left empty.
    Move,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MigrateOptions {
    pub mode: Mode,
    /// A folder or file the user picked (SkinSelectImpact's program folder, Fairy's Secret Folder's backup file).
    pub picked: Option<String>,
}

/// A folder the import placed in Mods.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Placed {
    /// The library id after the rescan ("" when the scan didn't list it).
    pub id: String,
    /// Where it was placed.
    pub at: String,
    /// Where it came from.
    pub from: String,
    pub moved: bool,
    /// The other manager's link it replaced (move only).
    pub link: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MigrateUndo {
    pub game: String,
    pub manager: String,
    pub placed: Vec<Placed>,
    pub profiles: Vec<i64>,
    pub sidecars: Vec<SidecarBack>,
    /// Mods the import turned off to match the other manager.
    pub turned_off: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrateResult {
    pub manager: String,
    /// Ids of the mods placed in Mods.
    pub added: Vec<String>,
    /// Names of the profiles made from presets.
    pub profiles: Vec<String>,
    pub notes: Vec<String>,
    pub undo: MigrateUndo,
}

// ── what readers find ──

#[derive(Debug, Clone, PartialEq)]
enum Ref {
    /// An absolute folder (in Mods or in the manager's folder).
    Path(PathBuf),
    /// A path from Mods ("Ellen Joe/Coca Cola"); DISABLED prefixes don't matter.
    Rel(String),
    /// A mod folder's name.
    Name(String),
    /// The manager's own id for a mod (`Source::ids`).
    Id(String),
}

#[derive(Debug, Clone, Default)]
struct Entry { refs: Vec<Ref>, values: Vec<VarValue> }

#[derive(Debug, Clone, Default)]
struct Preset { name: String, entries: Vec<Entry> }

#[derive(Debug, Clone, Default)]
struct Meta { name: Option<String>, notes: Option<String>, tags: Vec<String>, author: Option<String>, gb_id: Option<u64>, favorite: bool }

#[derive(Debug, Clone)]
struct Outside {
    dir: PathBuf,
    /// Where it goes in Mods (its path inside the manager's folder).
    rel: String,
    /// On in the other manager.
    on: bool,
    /// Where it already shows in Mods: the manager's link, or its copy.
    shown: Option<PathBuf>,
    link: bool,
}

struct Source {
    id: &'static str,
    name: &'static str,
    exes: &'static [&'static str],
    place: PathBuf,
    library: Option<PathBuf>,
    outside: Vec<Outside>,
    /// Mods of this manager inside Mods (besides shown outside ones).
    inside: u32,
    presets: Vec<Preset>,
    /// The manager's mod ids (lowercased) -> folder.
    ids: HashMap<String, PathBuf>,
    values: Vec<(Vec<Ref>, Vec<VarValue>)>,
    meta: Vec<(Vec<Ref>, Meta)>,
    /// Mods it has off without renaming them (3DMigoto still loads them).
    off: Vec<Vec<Ref>>,
    notes: Vec<String>,
}

impl Source {
    fn new(id: &'static str, name: &'static str, exes: &'static [&'static str], place: &Path) -> Self {
        Source {
            id, name, exes, place: place.to_path_buf(), library: None, outside: Vec::new(), inside: 0, presets: Vec::new(),
            ids: HashMap::new(), values: Vec::new(), meta: Vec::new(), off: Vec::new(), notes: Vec::new(),
        }
    }
    fn found(&self) -> bool {
        self.inside > 0 || !self.outside.is_empty() || !self.presets.is_empty() || !self.meta.is_empty() || !self.off.is_empty() || !self.values.is_empty()
    }
    fn running(&self) -> bool { self.exes.iter().any(|e| launch::process_running(e)) }
}

/// Where readers look. Real runs fill it from the environment; tests point it at temp folders.
struct Env {
    game: String,
    mods: PathBuf,
    roaming: Option<PathBuf>,
    local: Option<PathBuf>,
    home: Option<PathBuf>,
    /// Folders a portable program may sit in (Desktop, Downloads, Documents, next to the game ...).
    search: Vec<PathBuf>,
    picked: Option<PathBuf>,
}

impl Env {
    fn real(db: &Db, game: &str, picked: Option<&str>) -> Result<Env> {
        let mods = games::mods_dir(db, game)?;
        let var = |k: &str| std::env::var_os(k).map(PathBuf::from);
        let home = var("USERPROFILE");
        let local = var("LOCALAPPDATA");
        let mut search: Vec<PathBuf> = Vec::new();
        if let Some(h) = &home { for d in ["Desktop", "Downloads", "Documents"] { search.push(h.join(d)); } }
        if let Some(l) = &local { search.push(l.clone()); }
        if let Ok(g) = games::game_dir(db, game) { if let Some(p) = g.parent() { search.push(p.to_path_buf()); } search.push(g); }
        if let Ok(i) = games::importer_dir(db, game) { if let Some(p) = i.parent() { search.push(p.to_path_buf()); } }
        Ok(Env { game: game.to_string(), mods, roaming: var("APPDATA"), local, home, search, picked: picked.map(str::trim).filter(|p| !p.is_empty()).map(PathBuf::from) })
    }
}

// ── small helpers ──

const MAX_JSON: u64 = 16 * 1024 * 1024;

fn read_json(p: &Path) -> Option<Value> {
    if fs::metadata(p).ok()?.len() > MAX_JSON { return None; }
    let text = crate::ini::decode(&fs::read(p).ok()?);
    serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()
}

/// A string field (any case of the key). A field holding JSON text (electron-store, JASM's settings) stays a string.
fn text(v: &Value, keys: &[&str]) -> Option<String> {
    let o = v.as_object()?;
    keys.iter().find_map(|k| o.iter().find(|(n, _)| n.eq_ignore_ascii_case(k)).and_then(|(_, x)| match x {
        Value::String(s) if !s.trim().is_empty() => Some(s.trim().to_string()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }))
}

fn get<'a>(v: &'a Value, key: &str) -> Option<&'a Value> {
    v.as_object()?.iter().find(|(n, _)| n.eq_ignore_ascii_case(key)).map(|(_, x)| x)
}

/// A value that may be JSON written into a string (localStorage, JASM's LocalSettings.json).
fn unwrap_json(v: &Value) -> Value {
    match v { Value::String(s) => serde_json::from_str(s).unwrap_or(Value::Null), x => x.clone() }
}

fn strings(v: Option<&Value>) -> Vec<String> {
    v.and_then(|x| x.as_array()).map(|a| a.iter().filter_map(|s| match s {
        Value::String(s) if !s.trim().is_empty() => Some(s.trim().to_string()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }).collect()).unwrap_or_default()
}

/// A path as a comparable key: no `\\?\`, backslashes, no trailing slash, lowercase.
fn pkey(p: &Path) -> String {
    let s = p.to_string_lossy().replace('/', "\\");
    let s = s.strip_prefix("\\\\?\\UNC\\").map(|r| format!("\\\\{r}")).unwrap_or_else(|| s.strip_prefix("\\\\?\\").unwrap_or(&s).to_string());
    s.trim_end_matches('\\').to_lowercase()
}

fn canon_key(p: &Path) -> String { pkey(&fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf())) }

fn same_dir(a: &Path, b: &Path) -> bool { canon_key(a) == canon_key(b) }

/// `p` is `root` or inside it.
fn under(p: &str, root: &str) -> bool { p == root || p.strip_prefix(root).is_some_and(|r| r.starts_with('\\')) }

fn is_link(p: &Path) -> bool { fs::symlink_metadata(p).is_ok_and(|m| m.file_type().is_symlink()) }

fn is_real_dir(p: &Path) -> bool { fs::symlink_metadata(p).is_ok_and(|m| m.is_dir() && !m.file_type().is_symlink()) }

fn real_subdirs(dir: &Path) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = fs::read_dir(dir).into_iter().flatten().flatten().map(|e| e.path())
        .filter(|p| is_real_dir(p) && !p.file_name().is_some_and(|n| n.to_string_lossy().starts_with('.'))).collect();
    v.sort();
    v
}

fn files_with_ext(dir: &Path, ext: &str) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = fs::read_dir(dir).into_iter().flatten().flatten().map(|e| e.path())
        .filter(|p| p.is_file() && p.extension().is_some_and(|x| x.eq_ignore_ascii_case(ext))).collect();
    v.sort();
    v
}

fn stem(p: &Path) -> String { p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default() }

fn name_of(p: &Path) -> String { p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default() }

fn dir_size(dir: &Path) -> u64 {
    walkdir::WalkDir::new(dir).follow_links(false).into_iter().flatten()
        .filter(|e| e.file_type().is_file()).filter_map(|e| e.metadata().ok()).map(|m| m.len()).sum()
}

/// A path from Mods with DISABLED prefixes taken off and lowercased, for matching.
fn norm_rel(rel: &str) -> String {
    rel.split(['/', '\\']).map(str::trim).filter(|p| !p.is_empty() && *p != ".")
        .map(|p| library::display_folder(p).to_lowercase()).collect::<Vec<_>>().join("/")
}

fn open_ro(p: &Path) -> Option<Connection> {
    if !p.is_file() { return None; }
    Connection::open_with_flags(p, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX).ok()
}

/// "key = value" lines from d3dx_user.ini, as JASM keeps them ("mod.ini\swapvar" -> "1"), as option values.
fn values_from_pairs(v: Option<&Value>) -> Vec<VarValue> {
    let Some(o) = v.and_then(|x| x.as_object()) else { return Vec::new() };
    o.iter().filter_map(|(k, val)| {
        let value = match val { Value::String(s) => s.trim().to_string(), Value::Number(n) => n.to_string(), _ => return None };
        let k = k.trim().trim_start_matches(['\\', '/']).replace('/', "\\");
        let (ini, var) = k.rsplit_once('\\')?;
        let var = var.trim().trim_start_matches('$');
        (!ini.is_empty() && !var.is_empty() && !value.is_empty()).then(|| VarValue { ini: ini.replace('\\', "/"), var: var.to_string(), value })
    }).collect()
}

fn gb_id_in(url: Option<&str>) -> Option<u64> { url.and_then(crate::managers::gb_mod_id) }

/// Mod folders in a manager's own folder: (folder, path inside it), by the rules of "Finding mods".
fn library_mods(lib: &Path) -> Vec<(PathBuf, String)> {
    library::mod_dirs(lib).into_iter().filter(|(d, rel)| !rel.is_empty() && !is_link(d)).collect()
}

fn outside_from(lib: &Path, on: bool) -> Vec<Outside> {
    library_mods(lib).into_iter().map(|(dir, rel)| Outside { dir, rel, on, shown: None, link: false }).collect()
}

/// Links in Mods (a few levels down, never followed) that point outside it: (link, where it points).
fn links_in(mods: &Path) -> Vec<(PathBuf, PathBuf)> {
    let root = canon_key(mods);
    let mut out = Vec::new();
    let mut stack = vec![(mods.to_path_buf(), 0u32)];
    while let Some((dir, depth)) = stack.pop() {
        for e in fs::read_dir(&dir).into_iter().flatten().flatten() {
            let p = e.path();
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_symlink() {
                let Ok(t) = fs::canonicalize(&p) else { continue };
                if t.is_dir() && !under(&pkey(&t), &root) { out.push((p, t)); }
            } else if ft.is_dir() && depth < 3 {
                stack.push((p, depth + 1));
            }
        }
    }
    out.sort();
    out
}

/// Mark the outside mods that a link in Mods already shows.
fn mark_links(src: &mut Source, links: &[(PathBuf, PathBuf)]) {
    let keys: Vec<(String, &PathBuf)> = links.iter().map(|(l, t)| (pkey(t), l)).collect();
    for o in src.outside.iter_mut().filter(|o| o.shown.is_none()) {
        let k = canon_key(&o.dir);
        if let Some((_, l)) = keys.iter().find(|(t, _)| under(&k, t)) {
            o.shown = Some((*l).clone());
            o.link = true;
            o.on = true;
        }
    }
}

// ── readers ──

/// JASM and JASM+: `%LOCALAPPDATA%\JASM\ApplicationData_<Game>` (old Genshin: `ApplicationData`), presets in
/// `Presets\<name>.json`, option values in each mod's `.JASM_ModConfig.json` `Preferences`.
fn jasm(env: &Env) -> Vec<Source> {
    let suffix = match env.game.as_str() { "gi" => "Genshin", "hsr" => "Honkai", "ww" => "WuWa", "zzz" => "ZZZ", "ef" => "Endfield", _ => return Vec::new() };
    let Some(root) = env.local.as_ref().map(|l| l.join("JASM")) else { return Vec::new() };
    let mut dir = root.join(format!("ApplicationData_{suffix}"));
    if !dir.is_dir() && env.game == "gi" { dir = root.join("ApplicationData"); }
    if !dir.is_dir() { return Vec::new(); }
    let mut s = Source::new("jasm", "JASM", &["JASM - Just Another Skin Manager.exe", "JASM - Auto Updater.exe"], &dir);
    if let Some(opts) = read_json(&dir.join("LocalSettings.json")).and_then(|v| get(&v, "ModManagerOptions").map(unwrap_json)) {
        if let Some(m) = text(&opts, &["ModsFolderPath"]) {
            if !same_dir(Path::new(&m), &env.mods) { s.notes.push(format!("JASM uses another Mods folder: {m}")); }
        }
    }
    for (d, _) in library::mod_dirs(&env.mods) {
        let Some(cfg) = read_json(&d.join(".JASM_ModConfig.json")) else { continue };
        s.inside += 1;
        if let Some(id) = text(&cfg, &["Id"]) { s.ids.insert(id.to_lowercase(), d.clone()); }
        let vals = values_from_pairs(get(&cfg, "Preferences"));
        if !vals.is_empty() { s.values.push((vec![Ref::Path(d.clone())], vals)); }
    }
    for f in files_with_ext(&dir.join("Presets"), "json") {
        let Some(v) = read_json(&f) else { continue };
        let entries = get(&v, "Mods").and_then(|m| m.as_array()).map(|a| a.iter().map(|m| {
            let mut refs = Vec::new();
            if let Some(id) = text(m, &["ModId"]) { refs.push(Ref::Id(id)); }
            if let Some(p) = text(m, &["FullPath"]) { refs.push(Ref::Path(PathBuf::from(&p))); refs.push(Ref::Name(name_of(Path::new(&p)))); }
            Entry { refs, values: values_from_pairs(get(m, "Preferences")) }
        }).filter(|e| !e.refs.is_empty()).collect()).unwrap_or_default();
        s.presets.push(Preset { name: stem(&f), entries });
    }
    vec![s]
}

/// XX Mod Manager: Electron `config.json` with `modSourcePath` (its folder), `modTargetPath` (Mods) and `presetPath`
/// (`<name>.json` with `modIds`, the `id` in each mod's mod.json, or folder names).
fn xxmm(env: &Env) -> Vec<Source> {
    let Some(roaming) = &env.roaming else { return Vec::new() };
    let mut out = Vec::new();
    for app in ["xx-mod-manager", "XX Mod Manager"] {
        let cfg = roaming.join(app).join("config.json");
        let Some(v) = read_json(&cfg) else { continue };
        let Some(target) = text(&v, &["modTargetPath"]) else { continue };
        if !same_dir(Path::new(&target), &env.mods) { continue; }
        let mut s = Source::new("xxmm", "XX Mod Manager", &["XX Mod Manager.exe"], &cfg);
        if let Some(src) = text(&v, &["modSourcePath"]).map(PathBuf::from).filter(|p| p.is_dir()) {
            for d in real_subdirs(&src) {
                if let Some(id) = read_json(&d.join("mod.json")).and_then(|m| text(&m, &["id"])) { s.ids.insert(id.to_lowercase(), d.clone()); }
            }
            s.outside = outside_from(&src, false);
            s.library = Some(src);
        }
        if let Some(pdir) = text(&v, &["presetPath"]).map(PathBuf::from) {
            for f in files_with_ext(&pdir, "json") {
                let Some(p) = read_json(&f) else { continue };
                let (name, ids) = match &p {
                    Value::Array(_) => (stem(&f), strings(Some(&p))),
                    _ => (text(&p, &["name"]).unwrap_or_else(|| stem(&f)), strings(get(&p, "modIds"))),
                };
                s.presets.push(Preset { name, entries: ids.into_iter().map(|i| Entry { refs: vec![Ref::Id(i.clone()), Ref::Name(i)], ..Default::default() }).collect() });
            }
        }
        out.push(s);
        break;
    }
    out
}

/// ZZZ ModManager keeps its paths in localStorage; its presets are `<Mods>\..\presets\<name>.json`, arrays of folder
/// names. Its folder of mods is found from its links in Mods (see `linked`).
fn zzmm(env: &Env) -> Vec<Source> {
    if env.game != "zzz" { return Vec::new(); }
    let Some(dir) = env.mods.parent().map(|p| p.join("presets")) else { return Vec::new() };
    let mut s = Source::new("zzmm", "ZZZ ModManager", &["ZZZModManager.exe"], &dir);
    for f in files_with_ext(&dir, "json") {
        let Some(v @ Value::Array(_)) = read_json(&f) else { continue };
        s.presets.push(Preset { name: stem(&f), entries: strings(Some(&v)).into_iter().map(|n| Entry { refs: vec![Ref::Name(n)], ..Default::default() }).collect() });
    }
    if s.presets.is_empty() { return Vec::new(); }
    vec![s]
}

/// PeakyModManager v3: `%APPDATA%\peakymodmanager-v3\config.json` (`libraryPath`, `targetPath`). Presets live in
/// localStorage; its "Back up presets" file `<library>\Presets_Backup_<date>.json` ({name: [folder names]}) is read.
fn peaky(env: &Env) -> Vec<Source> {
    let Some(cfg) = env.roaming.as_ref().map(|r| r.join("peakymodmanager-v3").join("config.json")) else { return Vec::new() };
    let Some(v) = read_json(&cfg) else { return Vec::new() };
    match text(&v, &["targetPath"]) {
        Some(t) if !same_dir(Path::new(&t), &env.mods) => return Vec::new(),
        None if env.game != "zzz" => return Vec::new(),
        _ => {}
    }
    let mut s = Source::new("peaky", "Peaky Mod Manager", &["peakymodmanager-v3.exe"], &cfg);
    if let Some(lib) = text(&v, &["libraryPath"]).map(PathBuf::from).filter(|p| p.is_dir()) {
        let backup = fs::read_dir(&lib).into_iter().flatten().flatten().map(|e| e.path())
            .filter(|p| p.is_file() && name_of(p).to_ascii_lowercase().starts_with("presets_backup_")).max();
        if let Some(obj) = backup.and_then(|b| read_json(&b)).and_then(|b| b.as_object().cloned()) {
            for (name, mods) in obj {
                s.presets.push(Preset { name, entries: strings(Some(&mods)).into_iter().map(|n| Entry { refs: vec![Ref::Name(n)], ..Default::default() }).collect() });
            }
        }
        s.outside = outside_from(&lib, false);
        s.library = Some(lib);
    }
    vec![s]
}

/// WZMM (ZZZ): `%APPDATA%\wzmm\settings.json` `xxmiPath` (the ZZMI folder). Off mods are moved to
/// `<ZZMI>\dismods\`; groups `%APPDATA%\wzmm\groups\<id>.json` {name, mods: [folder names]}.
fn wzmm(env: &Env) -> Vec<Source> {
    if env.game != "zzz" { return Vec::new(); }
    let Some(dir) = env.roaming.as_ref().map(|r| r.join("wzmm")) else { return Vec::new() };
    if !dir.is_dir() { return Vec::new(); }
    let zzmi = read_json(&dir.join("settings.json")).and_then(|v| text(&v, &["xxmiPath"])).map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("C:\\XXMI\\ZZMI"));
    let mut s = Source::new("wzmm", "WZMM", &["WZMM.exe"], &dir);
    if same_dir(&zzmi.join("Mods"), &env.mods) {
        let dis = zzmi.join("dismods");
        if dis.is_dir() { s.outside = outside_from(&dis, false); s.library = Some(dis); }
        if zzmi.join("modvars").is_dir() { s.notes.push("WZMM's other variants in modvars stay where they are".into()); }
    }
    for f in files_with_ext(&dir.join("groups"), "json") {
        let Some(v) = read_json(&f) else { continue };
        s.presets.push(Preset { name: text(&v, &["name"]).unwrap_or_else(|| stem(&f)), entries: strings(get(&v, "mods")).into_iter().map(|n| Entry { refs: vec![Ref::Name(n)], ..Default::default() }).collect() });
    }
    vec![s]
}

/// GMM (GenshinModManager): SQLite `%APPDATA%\GenshinModManager\app_data.sqlite` and `app_data_<game>.sqlite`;
/// `settings.mods_folder_path` says which Mods folder a file is for.
fn gmm(env: &Env) -> Vec<Source> {
    let Some(dir) = env.roaming.as_ref().map(|r| r.join("GenshinModManager")) else { return Vec::new() };
    let mut out = Vec::new();
    for f in files_with_ext(&dir, "sqlite") {
        if !name_of(&f).to_ascii_lowercase().starts_with("app_data") { continue; }
        let Some(c) = open_ro(&f) else { continue };
        let mods: Option<String> = c.query_row("SELECT value FROM settings WHERE key = 'mods_folder_path'", [], |r| r.get(0)).ok();
        if !mods.is_some_and(|m| same_dir(Path::new(&m), &env.mods)) { continue; }
        let mut s = Source::new("gmm", "GMM", &["GMM.exe"], &f);
        if let Ok(mut st) = c.prepare("SELECT folder_name, name, description, author, category_tag FROM assets") {
            let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?, r.get::<_, Option<String>>(2)?, r.get::<_, Option<String>>(3)?, r.get::<_, Option<String>>(4)?)));
            for (folder, name, desc, author, tag) in rows.into_iter().flatten().flatten() {
                s.inside += 1;
                let clean = |x: Option<String>| x.map(|t| t.trim().to_string()).filter(|t| !t.is_empty());
                s.meta.push((vec![Ref::Rel(folder)], Meta { name: clean(name), notes: clean(desc), author: clean(author), tags: clean(tag).into_iter().collect(), ..Default::default() }));
            }
        }
        if let Ok(mut st) = c.prepare("SELECT p.name, a.folder_name FROM presets p JOIN preset_assets pa ON pa.preset_id = p.id JOIN assets a ON a.id = pa.asset_id WHERE pa.is_enabled = 1 ORDER BY p.id") {
            let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)));
            add_rows(&mut s.presets, rows.into_iter().flatten().flatten().map(|(p, f)| (p, vec![Ref::Rel(f)])));
            // presets with nothing on still count
            if let Ok(mut all) = c.prepare("SELECT name FROM presets ORDER BY id") {
                for n in all.query_map([], |r| r.get::<_, String>(0)).into_iter().flatten().flatten() {
                    if !s.presets.iter().any(|p| p.name == n) { s.presets.push(Preset { name: n, entries: Vec::new() }); }
                }
            }
        }
        out.push(s);
    }
    out
}

/// Rows of (preset name, refs) grouped into presets in their order.
fn add_rows(presets: &mut Vec<Preset>, rows: impl Iterator<Item = (String, Vec<Ref>)>) {
    for (name, refs) in rows {
        match presets.iter_mut().find(|p| p.name == name) {
            Some(p) => p.entries.push(Entry { refs, ..Default::default() }),
            None => presets.push(Preset { name, entries: vec![Entry { refs, ..Default::default() }] }),
        }
    }
}

/// GIMM (Genshin): electron-store `%APPDATA%\gimm\config.json`, `modFolder` (its collection) and `gimiFolder`
/// (Mods). A mod is on when a copy with the same folder name is in Mods.
fn gimm(env: &Env) -> Vec<Source> {
    let Some(cfg) = env.roaming.as_ref().map(|r| r.join("gimm").join("config.json")) else { return Vec::new() };
    let Some(v) = read_json(&cfg) else { return Vec::new() };
    if !text(&v, &["gimiFolder"]).is_some_and(|g| same_dir(Path::new(&g), &env.mods)) { return Vec::new(); }
    let mut s = Source::new("gimm", "GIMM", &["GIMM.exe"], &cfg);
    if let Some(lib) = text(&v, &["modFolder"]).map(PathBuf::from).filter(|p| p.is_dir()) {
        for d in real_subdirs(&lib) {
            let name = name_of(&d);
            let copy = env.mods.join(&name);
            let shown = copy.is_dir().then_some(copy);
            s.outside.push(Outside { rel: name, on: shown.is_some(), shown, link: false, dir: d });
        }
        s.library = Some(lib);
    }
    vec![s]
}

/// HoyoModManagerGo: SQLite `%LOCALAPPDATA%\HoyoModManagerGo\cache\hmm.db` (mod, playlist,
/// playlist_mod_cross_ref). Its store `<root>\<Genshin|StarRail|ZZZ|WuWa>\<character>\<folder>`; the root is in its
/// rosedb settings under `root_mod_dir`. Mods that are on are copied to `<Mods>\<id>_<folder>`.
fn hoyomm(env: &Env) -> Vec<Source> {
    let folder = match env.game.as_str() { "gi" => "Genshin", "hsr" => "StarRail", "zzz" => "ZZZ", "ww" => "WuWa", _ => return Vec::new() };
    let Some(cache) = env.local.as_ref().map(|l| l.join("HoyoModManagerGo").join("cache")) else { return Vec::new() };
    let db = cache.join("hmm.db");
    let Some(c) = open_ro(&db) else { return Vec::new() };
    let Some(store) = rosedb_path(&cache.join("rosedb_basic"), "root_mod_dir").map(|r| r.join(folder)).filter(|p| p.is_dir()) else { return Vec::new() };
    let mut s = Source::new("hoyomm", "HoyoModManagerGo", &["skin-mod-manager.exe"], &db);
    if let Ok(mut st) = c.prepare("SELECT id, fname, char_name, gb_id FROM mod") {
        let rows = st.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, Option<String>>(2)?, r.get::<_, Option<i64>>(3)?)));
        for (id, fname, ch, gb) in rows.into_iter().flatten().flatten() {
            let ch = ch.unwrap_or_default();
            let dir = store.join(&ch).join(&fname);
            if !dir.is_dir() { continue; }
            let copy = env.mods.join(format!("{id}_{fname}"));
            let shown = copy.is_dir().then_some(copy);
            s.ids.insert(id.to_string(), dir.clone());
            if let Some(g) = gb.filter(|&g| g > 0) { s.meta.push((vec![Ref::Id(id.to_string())], Meta { gb_id: Some(g as u64), ..Default::default() })); }
            let rel = if ch.is_empty() { fname } else { format!("{ch}/{fname}") };
            s.outside.push(Outside { rel, on: shown.is_some(), shown, link: false, dir });
        }
    }
    if let Ok(mut st) = c.prepare("SELECT p.playlist_name, x.mod_id FROM playlist p JOIN playlist_mod_cross_ref x ON x.playlist_id = p.id ORDER BY p.id") {
        let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)));
        let rows: Vec<(String, i64)> = rows.into_iter().flatten().flatten().filter(|(_, m)| s.ids.contains_key(&m.to_string())).collect();
        add_rows(&mut s.presets, rows.into_iter().map(|(p, m)| (p, vec![Ref::Id(m.to_string())])));
    }
    s.library = Some(store);
    vec![s]
}

/// A path saved after `key` in a rosedb data folder (the last one written wins).
fn rosedb_path(dir: &Path, key: &str) -> Option<PathBuf> {
    let mut found = None;
    for f in fs::read_dir(dir).into_iter().flatten().flatten().map(|e| e.path()).filter(|p| p.is_file()) {
        if fs::metadata(&f).map(|m| m.len()).unwrap_or(0) > 64 * 1024 * 1024 { continue; }
        let Ok(bytes) = fs::read(&f) else { continue };
        let k = key.as_bytes();
        let mut i = 0;
        while let Some(at) = bytes[i..].windows(k.len()).position(|w| w == k).map(|p| p + i) {
            i = at + k.len();
            // the value follows within a few bytes: a drive letter, a colon and a slash
            let tail = &bytes[i..bytes.len().min(i + 4096)];
            let Some(start) = tail.windows(3).position(|w| w[0].is_ascii_alphabetic() && w[1] == b':' && (w[2] == b'\\' || w[2] == b'/')).filter(|&s| s < 24) else { continue };
            let end = tail[start..].iter().position(|&b| b < 0x20 || b == b'"').map_or(tail.len(), |e| start + e);
            if let Ok(s) = std::str::from_utf8(&tail[start..end]) { found = Some(PathBuf::from(s.trim_end_matches(['\\', '/']))); }
        }
    }
    found
}

/// SkinSelectImpact: a portable program. `Data\App_Settings.json` (`GS_Mods_Path`, `SR_`, `WW_`, `ZZ_`, `AE_`) says
/// which Mods folder; `Data\<prefix>_Presets.json` holds presets whose items name `FolderName` (the character
/// folder) and `SubFolderName` (the mod) under `Mods\SkinSelectImpact`.
fn ssi(env: &Env) -> Vec<Source> {
    let prefix = match env.game.as_str() { "gi" => "GS", "hsr" => "SR", "ww" => "WW", "zzz" => "ZZ", "ef" => "AE", _ => return Vec::new() };
    let mut homes: Vec<PathBuf> = Vec::new();
    if let Some(p) = &env.picked {
        let p = if p.is_file() { p.parent().map(Path::to_path_buf).unwrap_or_default() } else { p.clone() };
        let p = if name_of(&p).eq_ignore_ascii_case("Data") { p.parent().map(Path::to_path_buf).unwrap_or_default() } else { p };
        homes.push(p);
    }
    // the usual spots, two folders down at most
    for base in &env.search {
        for a in real_subdirs(base) {
            if a.join("Data").join("App_Settings.json").is_file() { homes.push(a.clone()); continue; }
            if !name_of(&a).to_ascii_lowercase().contains("skin") { continue; }
            for b in real_subdirs(&a) { if b.join("Data").join("App_Settings.json").is_file() { homes.push(b); } }
        }
        if base.join("Data").join("App_Settings.json").is_file() { homes.push(base.clone()); }
    }
    let mut seen = HashSet::new();
    for home in homes {
        if !seen.insert(canon_key(&home)) { continue; }
        let data = home.join("Data");
        let Some(cfg) = read_json(&data.join("App_Settings.json")) else { continue };
        let key = format!("{prefix}_Mods_Path");
        if !text(&cfg, &[key.as_str()]).is_some_and(|m| same_dir(Path::new(&m), &env.mods)) { continue; }
        let mut s = Source::new("ssi", "SkinSelectImpact", &["SkinSelectImpact.exe"], &home);
        s.inside = library::mod_dirs(&env.mods.join("SkinSelectImpact")).len() as u32;
        if let Some(v) = read_json(&data.join(format!("{prefix}_Presets.json"))) { s.presets = ssi_presets(&v); }
        return vec![s];
    }
    Vec::new()
}

/// Preset items anywhere in SkinSelectImpact's file: objects with `SubFolderName`, named by their own preset field
/// or by the object holding them.
fn ssi_presets(v: &Value) -> Vec<Preset> {
    const NAME: &[&str] = &["Preset", "PresetName", "Name", "Nombre", "Title"];
    fn item(o: &Value) -> Option<Ref> {
        let sub = text(o, &["SubFolderName"])?;
        let off = ["State", "IsActive", "Enabled"].iter().any(|k| get(o, k).is_some_and(|x| x == &Value::Bool(false) || x.as_str().is_some_and(|s| s.eq_ignore_ascii_case("false"))));
        if off { return None; }
        Some(match text(o, &["FolderName"]) { Some(f) => Ref::Rel(format!("SkinSelectImpact/{f}/{sub}")), None => Ref::Name(sub) })
    }
    fn walk(v: &Value, name: Option<&str>, out: &mut Vec<(String, Vec<Ref>)>) {
        match v {
            Value::Array(a) => for x in a { walk(x, name, out); },
            Value::Object(o) => {
                if get(v, "SubFolderName").is_some() {
                    let own = text(v, &["Preset", "PresetName"]).or_else(|| name.map(str::to_string)).or_else(|| text(v, &["Name", "Nombre"]));
                    if let (Some(n), Some(r)) = (own, item(v)) { out.push((n, vec![r])); }
                    return;
                }
                let here = text(v, NAME);
                let n = here.as_deref().or(name);
                for (k, x) in o {
                    // {"Preset A": [...]}: the key names the preset
                    let key_name = (n.is_none() && x.is_array()).then_some(k.as_str());
                    walk(x, n.or(key_name), out);
                }
            }
            _ => {}
        }
    }
    let mut rows = Vec::new();
    walk(v, None, &mut rows);
    let mut out = Vec::new();
    add_rows(&mut out, rows.into_iter());
    out
}

/// EMMM v2: SQLite `%APPDATA%\com.reynalivan.emmm\app.db`; `games.mods_path`, `collections` and `collection_mods`
/// (`mod_path` from Mods).
fn emmm(env: &Env) -> Vec<Source> {
    let Some(db) = env.roaming.as_ref().map(|r| r.join("com.reynalivan.emmm").join("app.db")) else { return Vec::new() };
    let Some(c) = open_ro(&db) else { return Vec::new() };
    let Ok(mut st) = c.prepare("SELECT id, mods_path FROM games") else { return Vec::new() };
    let games: Vec<(rusqlite::types::Value, String)> = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).into_iter().flatten().flatten().collect();
    let Some((gid, _)) = games.into_iter().find(|(_, p)| same_dir(Path::new(p), &env.mods)) else { return Vec::new() };
    let mut s = Source::new("emmm", "EMMM", &["EMMM.exe"], &db);
    if let Ok(mut st) = c.prepare("SELECT c.name, m.mod_path FROM collections c JOIN collection_mods m ON m.collection_id = c.id WHERE c.game_id = ?1 ORDER BY c.name") {
        let rows = st.query_map([&gid], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)));
        add_rows(&mut s.presets, rows.into_iter().flatten().flatten().map(|(n, p)| (n, vec![Ref::Rel(p)])));
    }
    vec![s]
}

/// Fairy's Secret Folder keeps profiles in WebView2 storage; its Settings > Backup file is read when the user picks
/// it: `keys.mod_profiles` (JSON text: [{name, tab, enabledModRelativePaths}], paths from `Mods\<tab's folder>`) and
/// `keys.favoriteMods`.
fn fairy(env: &Env) -> Vec<Source> {
    if env.game != "zzz" { return Vec::new(); }
    let Some(file) = env.picked.as_ref().filter(|p| p.is_file()) else { return Vec::new() };
    let Some(v) = read_json(file) else { return Vec::new() };
    let Some(keys) = get(&v, "keys") else { return Vec::new() };
    let tab_dir = |t: &str| match t { "npcs" => "NPCs", "bangboos" => "Bangboos", "weapons" => "Weapons", "ui" => "UI", "enemies" => "Enemies", _ => "Playable Characters" };
    let mut s = Source::new("fairy", "Fairy's Secret Folder", &["zzzmodmanager-tauri.exe", "ZZZ Mod Hub.exe"], file);
    if let Some(Value::Array(list)) = get(keys, "mod_profiles").map(unwrap_json) {
        for p in &list {
            let Some(name) = text(p, &["name"]) else { continue };
            let base = tab_dir(&text(p, &["tab"]).unwrap_or_default());
            let entries = strings(get(p, "enabledModRelativePaths")).into_iter().map(|r| {
                let leaf = r.rsplit(['/', '\\']).next().unwrap_or(&r).to_string();
                Entry { refs: vec![Ref::Rel(format!("{base}/{r}")), Ref::Rel(r), Ref::Name(leaf)], ..Default::default() }
            }).collect();
            s.presets.push(Preset { name, entries });
        }
    }
    for n in strings(get(keys, "favoriteMods").map(unwrap_json).as_ref()) {
        s.meta.push((vec![Ref::Name(n)], Meta { favorite: true, ..Default::default() }));
    }
    vec![s]
}

/// WuWa Mod Manager: `<Mods>\presets.json` {presets: {id: {name, enabled_mods: [mod.json ids]}}}.
fn wuwamoma(env: &Env) -> Vec<Source> {
    let file = env.mods.join("presets.json");
    let Some(v) = read_json(&file) else { return Vec::new() };
    let Some(presets) = get(&v, "presets").and_then(|p| p.as_object()) else { return Vec::new() };
    let mut s = Source::new("wuwamoma", "WuWa Mod Manager", &["WuwaMoMa.exe", "wuwa_mod_manager.exe"], &file);
    for d in real_subdirs(&env.mods) {
        if let Some(id) = read_json(&d.join("mod.json")).and_then(|m| text(&m, &["id"])) { s.inside += 1; s.ids.insert(id.to_lowercase(), d); }
    }
    for p in presets.values() {
        let Some(name) = text(p, &["name"]) else { continue };
        s.presets.push(Preset { name, entries: strings(get(p, "enabled_mods")).into_iter().map(|i| Entry { refs: vec![Ref::Id(i)], ..Default::default() }).collect() });
    }
    vec![s]
}

/// GB Mod Manager: `%USERPROFILE%\.gb-mod-manager\store.json` mods {name, gbId, fileId, installPath, enabled}. Its
/// off switch only flips `enabled`, so those mods still load; gachamod turns them off for real.
fn gbmm(env: &Env) -> Vec<Source> {
    let Some(file) = env.home.as_ref().map(|h| h.join(".gb-mod-manager").join("store.json")) else { return Vec::new() };
    let Some(v) = read_json(&file) else { return Vec::new() };
    let Some(mods) = get(&v, "mods").and_then(|m| m.as_object()) else { return Vec::new() };
    let root = canon_key(&env.mods);
    let mut s = Source::new("gbmm", "GB Mod Manager", &["gb-mod-manager.exe"], &file);
    for m in mods.values() {
        let Some(p) = text(m, &["installPath"]).map(PathBuf::from) else { continue };
        if !p.is_dir() || !under(&canon_key(&p), &root) { continue; }
        s.inside += 1;
        let gb = text(m, &["gbId"]).and_then(|g| g.parse().ok()).or_else(|| gb_id_in(text(m, &["profileUrl"]).as_deref()));
        s.meta.push((vec![Ref::Path(p.clone())], Meta { name: text(m, &["name"]), gb_id: gb, ..Default::default() }));
        if get(m, "enabled") == Some(&Value::Bool(false)) { s.off.push(vec![Ref::Path(p)]); }
    }
    vec![s]
}

/// Integrated Mod Manager's presets (`config<CODE>.json` `presets`: [{name, data: ["Character\\Mod"]}]). Its mods
/// move with imm.rs; these refs find them before and after that move.
fn imm_presets(env: &Env) -> Vec<Source> {
    let code = match env.game.as_str() { "ww" => "WW", "zzz" => "ZZ", "gi" => "GI", "hsr" => "SR", "ef" => "EF", _ => return Vec::new() };
    let Some(dir) = env.local.as_ref().map(|l| l.join("Integrated Mod Manager (IMM)")) else { return Vec::new() };
    let want = format!("config{code}.json").to_ascii_lowercase();
    let Some(file) = fs::read_dir(&dir).into_iter().flatten().flatten().map(|e| e.path()).find(|p| name_of(p).to_ascii_lowercase() == want) else { return Vec::new() };
    let Some(v) = read_json(&file) else { return Vec::new() };
    let mut s = Source::new("imm", "Integrated Mod Manager", &[crate::imm::PROCESS], &file);
    for p in get(&v, "presets").and_then(|p| p.as_array()).into_iter().flatten() {
        let Some(name) = text(p, &["name"]) else { continue };
        let entries = strings(get(p, "data")).into_iter().map(|k| {
            let k = k.replace('\\', "/");
            Entry { refs: vec![Ref::Rel(k.clone()), Ref::Rel(format!("{}/{k}", crate::imm::STORE))], ..Default::default() }
        }).collect();
        s.presets.push(Preset { name, entries });
    }
    vec![s]
}

/// Links in Mods to folders no reader claimed: another manager's folder (ZZZ ModManager, uyujkk's Integrated Mod
/// Manager, or one gachamod doesn't know). Targets are grouped by the folder above them; groups that share the
/// folder above that are one folder (`<library>\<character>\<mod>`).
fn linked(sources: &mut Vec<Source>, links: &[(PathBuf, PathBuf)]) {
    let claimed: Vec<String> = sources.iter().filter_map(|s| s.library.as_deref()).map(canon_key).collect();
    let mut parents: Vec<PathBuf> = Vec::new();
    for (_, t) in links {
        if claimed.iter().any(|c| under(&pkey(t), c)) { continue; }
        let Some(p) = t.parent().map(Path::to_path_buf) else { continue };
        if !parents.iter().any(|x| pkey(x) == pkey(&p)) { parents.push(p); }
    }
    // folders whose parents are the same: their parent is the library
    let mut libs: Vec<PathBuf> = Vec::new();
    for p in &parents {
        let gp = p.parent().map(Path::to_path_buf);
        let siblings = gp.as_ref().map_or(0, |g| parents.iter().filter(|x| x.parent().is_some_and(|xp| pkey(xp) == pkey(g))).count());
        let lib = if siblings >= 2 { gp.unwrap_or_else(|| p.clone()) } else { p.clone() };
        if !libs.iter().any(|l| pkey(l) == pkey(&lib)) { libs.push(lib); }
    }
    for lib in libs {
        // ZZZ ModManager's presets came without its folder
        if let Some(z) = sources.iter_mut().find(|s| s.id == "zzmm" && s.library.is_none()) {
            z.outside = outside_from(&lib, false);
            z.library = Some(lib);
            continue;
        }
        let mut s = Source::new("linked", "Another mod manager", &[], &lib);
        s.outside = outside_from(&lib, false);
        s.library = Some(lib);
        sources.push(s);
    }
}

/// Every manager found for the game, read only. Extra readers go in this list (JASM's own format reader is `jasm`).
fn read_all(env: &Env) -> Vec<Source> {
    const READERS: &[fn(&Env) -> Vec<Source>] = &[jasm, xxmm, zzmm, peaky, wzmm, gmm, gimm, hoyomm, ssi, emmm, fairy, wuwamoma, gbmm, imm_presets];
    let mut sources: Vec<Source> = READERS.iter().flat_map(|r| r(env)).collect();
    let links = links_in(&env.mods);
    linked(&mut sources, &links);
    for s in &mut sources { mark_links(s, &links); }
    sources.retain(Source::found);
    sources
}

fn summary(s: &Source) -> OtherManager {
    let hidden: Vec<&Outside> = s.outside.iter().filter(|o| o.shown.is_none()).collect();
    OtherManager {
        id: s.id.into(), name: s.name.into(), place: s.place.to_string_lossy().into_owned(),
        library: s.library.as_ref().map(|l| l.to_string_lossy().into_owned()),
        inside: s.inside + (s.outside.len() - hidden.len()) as u32,
        outside: hidden.len() as u32,
        outside_bytes: hidden.iter().map(|o| dir_size(&o.dir)).sum(),
        presets: s.presets.len() as u32,
        running: s.running(),
        notes: s.notes.clone(),
    }
}

fn lock(db: &Shared) -> Result<std::sync::MutexGuard<'_, Db>> {
    db.lock().map_err(|_| Error::Db("The local database is stuck after an earlier error. Restart gachamod".into()))
}

/// The other managers that left mods, presets or details for this game. Reads only.
pub fn detect(db: &Shared, game: &str, picked: Option<&str>) -> Result<Vec<OtherManager>> {
    let env = { let d = lock(db)?; Env::real(&d, game, picked)? };
    Ok(read_all(&env).iter().map(summary).collect())
}

/// Bring one manager's mods and presets into gachamod (see the module comment for what happens to its links).
pub fn import(db: &Shared, game: &str, manager: &str, opts: &MigrateOptions) -> Result<MigrateResult> {
    let env = { let d = lock(db)?; Env::real(&d, game, opts.picked.as_deref())? };
    let src = read_all(&env).into_iter().find(|s| s.id == manager)
        .ok_or_else(|| Error::Invalid("That manager has nothing for this game anymore. Look again".into()))?;
    if src.running() {
        return Err(Error::Conflict(format!("Close {} first. It could change its folders while gachamod reads them", src.name)));
    }
    if launch::running(game) {
        return Err(Error::Conflict("Close the game first. Mods can't move while it has them open".into()));
    }
    run(db, &env, src, opts.mode)
}

// ── the import ──

/// A free folder name in `parent` for `leaf`, on or off.
fn free_leaf(parent: &Path, leaf: &str) -> String {
    let taken = |n: &str| { let a = parent.join(n); let b = parent.join(format!("{DISABLED_PREFIX}{n}")); a.exists() || b.exists() || is_link(&a) || is_link(&b) };
    if !taken(leaf) { return leaf.to_string(); }
    (2..1000).map(|i| format!("{leaf} ({i})")).find(|n| !taken(n)).unwrap_or_else(|| format!("{leaf} ({})", library::new_id()))
}

fn copy_tree(from: &Path, to: &Path) -> Result<()> {
    fs::create_dir_all(to)?;
    for e in walkdir::WalkDir::new(from).follow_links(false).min_depth(1) {
        let e = e.map_err(|e| Error::Io(e.into()))?;
        let Ok(rel) = e.path().strip_prefix(from) else { continue };
        let target = to.join(rel);
        if e.file_type().is_dir() { fs::create_dir_all(&target)?; } else if e.file_type().is_file() { fs::copy(e.path(), &target)?; }
    }
    Ok(())
}

/// Remove a link itself, never what it points to.
fn remove_link(p: &Path) -> std::io::Result<()> { fs::remove_dir(p).or_else(|_| fs::remove_file(p)) }

/// A directory link: a symlink when Windows allows it, else a junction (what the other managers make).
fn make_link(target: &Path, link: &Path) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        if std::os::windows::fs::symlink_dir(target, link).is_ok() { return true; }
        std::process::Command::new("cmd").args(["/C", "mklink", "/J"]).arg(link).arg(target).creation_flags(0x0800_0000)
            .stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status().is_ok_and(|s| s.success())
    }
    #[cfg(not(windows))]
    { std::os::unix::fs::symlink(target, link).is_ok() }
}

/// The library's mods, matched by the references presets and readers use.
struct Resolver<'a> {
    root: String,
    by_rel: HashMap<String, String>,
    by_leaf: HashMap<String, String>,
    /// (path key, id): every mod's folder, where its link points, and where a placed folder came from.
    by_path: Vec<(String, String)>,
    ids: &'a HashMap<String, PathBuf>,
}

impl<'a> Resolver<'a> {
    fn new(mods: &Path, list: &[ModEntry], placed: &[Placed], ids: &'a HashMap<String, PathBuf>) -> Self {
        let mut r = Resolver { root: canon_key(mods), by_rel: HashMap::new(), by_leaf: HashMap::new(), by_path: Vec::new(), ids };
        for e in list {
            r.by_rel.entry(norm_rel(&e.rel_path)).or_insert_with(|| e.id.clone());
            r.by_leaf.entry(norm_rel(&e.folder)).or_insert_with(|| e.id.clone());
            let p = Path::new(&e.path);
            r.by_path.push((pkey(p), e.id.clone()));
            if is_link(p) { r.by_path.push((canon_key(p), e.id.clone())); }
        }
        for pl in placed.iter().filter(|p| !p.id.is_empty()) { r.by_path.push((pkey(Path::new(&pl.from)), pl.id.clone())); }
        r
    }

    fn path(&self, p: &Path) -> Option<String> {
        for k in [pkey(p), canon_key(p)] {
            if let Some((_, id)) = self.by_path.iter().find(|(x, _)| *x == k) { return Some(id.clone()); }
            if let Some(rel) = k.strip_prefix(&self.root).and_then(|r| r.strip_prefix('\\')) {
                if let Some(id) = self.by_rel.get(&norm_rel(rel)) { return Some(id.clone()); }
            }
            // a wrapper folder whose mod is the folder inside it
            if let Some((_, id)) = self.by_path.iter().find(|(x, _)| under(x, &k)) { return Some(id.clone()); }
        }
        None
    }

    fn find(&self, refs: &[Ref]) -> Option<String> {
        refs.iter().find_map(|r| match r {
            Ref::Path(p) => self.path(p),
            Ref::Rel(rel) => self.by_rel.get(&norm_rel(rel)).cloned(),
            Ref::Name(n) => self.by_leaf.get(&norm_rel(n)).cloned(),
            Ref::Id(i) => self.ids.get(&i.to_lowercase()).and_then(|p| self.path(p)),
        })
    }
}

fn run(db: &Shared, env: &Env, src: Source, mode: Mode) -> Result<MigrateResult> {
    let game = env.game.as_str();
    let mut out = MigrateResult { manager: src.name.into(), ..Default::default() };
    out.undo.game = game.into();
    out.undo.manager = src.id.into();
    let mut placed: Vec<Placed> = Vec::new();
    let (mut linked_left, mut copies_left) = (0u32, 0u32);

    for o in &src.outside {
        match (&o.shown, mode) {
            (Some(_), Mode::Copy) => { if o.link { linked_left += 1; } }
            (Some(_), Mode::Move) if !o.link => copies_left += 1,
            (Some(link), Mode::Move) => {
                if let Err(e) = remove_link(link) {
                    out.notes.push(format!("Couldn't remove {}'s link {}: {}", src.name, name_of(link), crate::error::io_text(&e)));
                    continue;
                }
                match crate::pack::move_dir(&o.dir, link) {
                    Ok(()) => placed.push(Placed { at: link.to_string_lossy().into(), from: o.dir.to_string_lossy().into(), moved: true, link: Some(link.to_string_lossy().into()), ..Default::default() }),
                    Err(e) => {
                        let _ = make_link(&o.dir, link);
                        out.notes.push(format!("Couldn't move {}: {e}", name_of(&o.dir)));
                    }
                }
            }
            (None, _) => {
                let parts: Vec<&str> = o.rel.split(['/', '\\']).filter(|p| !p.is_empty()).collect();
                let Some((leaf, groups)) = parts.split_last() else { continue };
                let mut parent = env.mods.clone();
                for g in groups { parent.push(library::display_folder(g)); }
                let leaf = library::display_folder(leaf);
                let leaf = if leaf.is_empty() { name_of(&o.dir) } else { leaf.to_string() };
                if let Err(e) = fs::create_dir_all(&parent) { out.notes.push(format!("Couldn't make {}: {}", parent.display(), crate::error::io_text(&e))); continue; }
                let free = free_leaf(&parent, &leaf);
                let to = parent.join(if o.on { free.clone() } else { format!("{DISABLED_PREFIX}{free}") });
                let done = match mode {
                    Mode::Copy => copy_tree(&o.dir, &to).inspect_err(|_| { let _ = fs::remove_dir_all(&to); }),
                    Mode::Move => crate::pack::move_dir(&o.dir, &to),
                };
                match done {
                    Ok(()) => placed.push(Placed { at: to.to_string_lossy().into(), from: o.dir.to_string_lossy().into(), moved: mode == Mode::Move, ..Default::default() }),
                    Err(e) => out.notes.push(format!("Couldn't {} {}: {e}", if mode == Mode::Move { "move" } else { "copy" }, leaf)),
                }
            }
        }
    }

    // the rescan adopts the new folders with what other managers left in them (managers.rs)
    match library::scan(db, game) {
        Ok(_) | Err(Error::Todo(_)) => {}
        Err(e) => out.notes.push(format!("The mods are in place, but the rescan failed: {e}")),
    }
    let d = lock(db)?;
    let list = library::list(&d, game)?;
    for p in &mut placed {
        let at = pkey(Path::new(&p.at));
        if let Some(e) = list.iter().find(|e| under(&pkey(Path::new(&e.path)), &at)) { p.id = e.id.clone(); out.added.push(e.id.clone()); }
    }
    let mut r = Resolver::new(&env.mods, &list, &placed, &src.ids);
    // outside mods already showing in Mods (a link or the manager's copy) answer to their own folder too
    for o in &src.outside {
        let Some(shown) = &o.shown else { continue };
        let k = pkey(shown);
        if let Some(e) = list.iter().find(|e| under(&pkey(Path::new(&e.path)), &k)) { r.by_path.push((pkey(&o.dir), e.id.clone())); }
    }

    // details the manager kept in its own files
    for (refs, meta) in &src.meta {
        let Some(e) = r.find(refs).and_then(|id| list.iter().find(|e| e.id == id)) else { continue };
        let dir = Path::new(&e.path);
        let Some(before) = library::read_sidecar(dir) else { continue };
        let mut sc = before.clone();
        if let Some(n) = &meta.name { if sc.name.trim().is_empty() || sc.name == library::display_folder(&e.folder) { sc.name = n.chars().take(200).collect(); } }
        if sc.notes.is_none() { sc.notes = meta.notes.clone(); }
        if sc.tags.is_empty() { sc.tags = meta.tags.clone(); }
        if meta.favorite { sc.favorite = true; }
        match (&mut sc.source, meta.gb_id) {
            (None, Some(id)) => sc.source = Some(ModSource { site: "gamebanana".into(), mod_id: id, url: format!("https://gamebanana.com/mods/{id}"), submitter: meta.author.clone(), ..Default::default() }),
            (Some(s), _) if s.submitter.is_none() && meta.author.is_some() => s.submitter = meta.author.clone(),
            _ => {}
        }
        if sc == before { continue; }
        match library::write_sidecar(dir, &sc) {
            Ok(()) => out.undo.sidecars.push(SidecarBack { rel: e.rel_path.clone(), sidecar: before }),
            Err(err) => out.notes.push(format!("Couldn't update {}: {err}", e.name)),
        }
    }

    // option values the manager kept for mods that are off (JASM)
    for (refs, vals) in &src.values {
        let Some(e) = r.find(refs).and_then(|id| list.iter().find(|e| e.id == id)) else { continue };
        if e.loaded() || !library::saved_vars(&d, game, &e.id).unwrap_or_default().is_empty() { continue; }
        if let Err(err) = library::stash_vars(&d, game, &e.id, vals) { out.notes.push(format!("Couldn't keep {}'s options: {err}", e.name)); }
    }

    // mods the manager had off without renaming them
    let off: Vec<String> = src.off.iter().filter_map(|refs| r.find(refs)).filter(|id| list.iter().any(|e| &e.id == id && e.enabled)).collect();
    if !off.is_empty() {
        match library::set_enabled(&d, game, &off, false) {
            Ok(_) => out.undo.turned_off = off,
            Err(e) => out.notes.push(format!("Couldn't turn off the mods {} had off: {e}", src.name)),
        }
    }

    // presets become profiles
    let taken: HashSet<String> = profiles::list(&d, game)?.into_iter().map(|p| p.name.to_lowercase()).collect();
    for p in &src.presets {
        let mut on: Vec<String> = Vec::new();
        let mut vals: Vec<(String, Vec<VarValue>)> = Vec::new();
        let mut missing = 0;
        for en in &p.entries {
            match r.find(&en.refs) {
                Some(id) => {
                    if !en.values.is_empty() { vals.push((id.clone(), en.values.clone())); }
                    if !on.contains(&id) { on.push(id); }
                }
                None => missing += 1,
            }
        }
        if on.is_empty() && !p.entries.is_empty() { out.notes.push(format!("Skipped the preset {}: none of its mods are here", p.name)); continue; }
        let name = if taken.contains(&p.name.trim().to_lowercase()) { format!("{} ({})", p.name.trim(), src.name) } else { p.name.trim().to_string() };
        match make_profile(&d, game, &name, &on, &vals) {
            Ok(id) => { out.undo.profiles.push(id); out.profiles.push(name.clone()); }
            Err(e) => { out.notes.push(format!("Couldn't make the profile {name}: {e}")); continue; }
        }
        if missing > 0 { out.notes.push(format!("{name}: {missing} {} not found", if missing == 1 { "mod was" } else { "mods were" })); }
    }
    drop(d);
    if !out.undo.sidecars.is_empty() { let _ = library::scan(db, game); }

    if linked_left > 0 { out.notes.push(format!("{linked_left} {} still {} from {}'s folder, so it keeps working", plural(linked_left), if linked_left == 1 { "loads" } else { "load" }, src.name)); }
    if copies_left > 0 { out.notes.push(format!("{copies_left} {} {} a copy in {}'s folder too", plural(copies_left), if copies_left == 1 { "has" } else { "have" }, src.name)); }
    let n = out.added.len() as u32;
    let head = match (n, out.profiles.len()) {
        (0, 0) => format!("Nothing new to bring in from {}", src.name),
        (n, 0) => format!("Brought in {n} {} from {}", plural(n), src.name),
        (0, p) => format!("Made {p} {} from {}'s presets", if p == 1 { "profile" } else { "profiles" }, src.name),
        (n, p) => format!("Brought in {n} {} and {p} {} from {}", plural(n), if p == 1 { "profile" } else { "profiles" }, src.name),
    };
    out.notes.insert(0, head);
    out.undo.placed = placed;
    if n > 0 { crate::devtools::mark_changed(game); }
    Ok(out)
}

fn plural(n: u32) -> &'static str { if n == 1 { "mod" } else { "mods" } }

/// A profile with exactly these mods on (and these option values), not active.
fn make_profile(db: &Db, game: &str, name: &str, on: &[String], vals: &[(String, Vec<VarValue>)]) -> Result<i64> {
    let p = profiles::create(db, game, name, None)?;
    let tx = db.conn.unchecked_transaction()?;
    tx.execute("UPDATE profile_mods SET enabled = 0 WHERE profile_id = ?1", [p.id])?;
    for id in on {
        tx.execute("INSERT INTO profile_mods (profile_id, mod_id, enabled) VALUES (?1, ?2, 1) ON CONFLICT(profile_id, mod_id) DO UPDATE SET enabled = 1", params![p.id, id])?;
    }
    for (id, vs) in vals {
        tx.execute("DELETE FROM profile_vars WHERE profile_id = ?1 AND mod_id = ?2", params![p.id, id])?;
        for v in vs {
            tx.execute("INSERT OR REPLACE INTO profile_vars (profile_id, mod_id, ini, var, value) VALUES (?1, ?2, ?3, ?4, ?5)", params![p.id, id, v.ini, v.var, v.value])?;
        }
    }
    tx.commit()?;
    Ok(p.id)
}

/// Take an import back: profiles deleted, details and on/off states put back, copies to the app's trash, moved
/// folders back where they came from (with the other manager's links).
pub fn undo(db: &Shared, data_dir: &Path, u: &MigrateUndo) -> Result<Vec<String>> {
    let game = u.game.as_str();
    games::require_def(game)?;
    if launch::running(game) { return Err(Error::Conflict("Close the game first. Mods can't move while it has them open".into())); }
    let mut notes = Vec::new();
    {
        let d = lock(db)?;
        for id in &u.profiles { let _ = profiles::delete(&d, *id); }
        for b in &u.sidecars {
            if let Ok(e) = library::get(&d, game, &b.sidecar.id) { let _ = library::write_sidecar(Path::new(&e.path), &b.sidecar); }
        }
        if !u.turned_off.is_empty() { let _ = library::set_enabled(&d, game, &u.turned_off, true); }
        let copies: Vec<String> = u.placed.iter().filter(|p| !p.moved && !p.id.is_empty()).map(|p| p.id.clone()).collect();
        if !copies.is_empty() {
            if let Err(e) = library::remove(&d, data_dir, game, &copies, "removed") { notes.push(format!("Couldn't remove some copies: {e}")); }
        }
        for p in u.placed.iter().filter(|p| p.moved) {
            let now = library::get(&d, game, &p.id).map(|e| PathBuf::from(e.path)).unwrap_or_else(|_| PathBuf::from(&p.at));
            let from = PathBuf::from(&p.from);
            if !now.is_dir() || from.exists() { notes.push(format!("Left {} where it is", name_of(&now))); continue; }
            if let Some(parent) = from.parent() { let _ = fs::create_dir_all(parent); }
            match crate::pack::move_dir(&now, &from) {
                Ok(()) => { if p.link.is_some() && !make_link(&from, &now) { notes.push(format!("Moved {} back, but couldn't link it into Mods again", name_of(&from))); } }
                Err(e) => notes.push(format!("Couldn't move {} back: {e}", name_of(&now))),
            }
        }
    }
    library::scan(db, game)?;
    Ok(notes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    fn temp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("gachamod-migrate-{tag}-{}", library::new_id()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn mod_at(dir: &Path) {
        fs::create_dir_all(dir).unwrap();
        fs::write(dir.join("mod.ini"), "[TextureOverrideA]\nhash = 12345678\n").unwrap();
    }

    fn setup(game: &str, root: &Path) -> (Shared, Env) {
        let mods = root.join("XXMI").join("Mods");
        fs::create_dir_all(&mods).unwrap();
        fs::write(root.join("XXMI").join("d3dx.ini"), "[Loader]\n").unwrap();
        let db = Db::memory().unwrap();
        games::save_paths(&db, game, &games::GamePaths { mods_dir: Some(mods.to_string_lossy().into()), ..Default::default() }).unwrap();
        let env = Env {
            game: game.into(), mods, roaming: Some(root.join("Roaming")), local: Some(root.join("Local")), home: Some(root.join("Home")),
            search: vec![root.join("Home").join("Desktop")], picked: None,
        };
        (Arc::new(Mutex::new(db)), env)
    }

    fn json(p: &Path, v: Value) {
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, serde_json::to_string_pretty(&v).unwrap()).unwrap();
    }

    fn find<'a>(all: &'a [Source], id: &str) -> &'a Source { all.iter().find(|s| s.id == id).unwrap_or_else(|| panic!("{id} not found")) }

    fn profile_mods(db: &Shared, game: &str, name: &str) -> Vec<String> {
        let d = db.lock().unwrap();
        let p = profiles::list(&d, game).unwrap().into_iter().find(|p| p.name == name).unwrap_or_else(|| panic!("no profile {name}"));
        let mut st = d.conn.prepare("SELECT m.rel_path FROM profile_mods pm JOIN mods m ON m.id = pm.mod_id WHERE pm.profile_id = ?1 AND pm.enabled = 1 ORDER BY m.rel_path").unwrap();
        st.query_map([p.id], |r| r.get::<_, String>(0)).unwrap().flatten().collect()
    }

    #[test]
    fn jasm_presets_and_values() {
        let root = temp("jasm");
        let (db, env) = setup("gi", &root);
        let a = env.mods.join("Character/Raiden/Kimono");
        let b = env.mods.join("Character/Hu Tao/DISABLED_Ghost");
        mod_at(&a);
        mod_at(&b);
        json(&a.join(".JASM_ModConfig.json"), serde_json::json!({"Id": "11111111-aaaa", "CustomName": "Kimono"}));
        json(&b.join(".JASM_ModConfig.json"), serde_json::json!({"Id": "22222222-bbbb", "Preferences": {"mod.ini\\swapvar": "2"}}));
        let app = root.join("Local/JASM/ApplicationData_Genshin");
        json(&app.join("LocalSettings.json"), serde_json::json!({"ModManagerOptions": serde_json::json!({"ModsFolderPath": env.mods}).to_string()}));
        json(&app.join("Presets/Battle.json"), serde_json::json!({"IsReadOnly": false, "Created": "2025-01-01T00:00:00", "Index": 0, "Mods": [
            {"ModId": "22222222-BBBB", "FullPath": b.join("gone"), "IsMissing": false, "Preferences": {"mod.ini\\swapvar": "1"}},
            {"ModId": "nope", "FullPath": a, "IsMissing": false}
        ]}));
        let all = read_all(&env);
        let s = find(&all, "jasm");
        assert_eq!((s.inside, s.presets.len(), s.values.len()), (2, 1, 1));
        assert!(s.notes.is_empty(), "{:?}", s.notes);

        let src = read_all(&env).into_iter().find(|s| s.id == "jasm").unwrap();
        let res = run(&db, &env, src, Mode::Copy).unwrap();
        assert_eq!(res.profiles, vec!["Battle"], "{:?}", res.notes);
        assert_eq!(profile_mods(&db, "gi", "Battle"), vec!["Character/Hu Tao/DISABLED_Ghost", "Character/Raiden/Kimono"]);
        let d = db.lock().unwrap();
        let ghost = library::list(&d, "gi").unwrap().into_iter().find(|e| e.rel_path.ends_with("Ghost")).unwrap();
        assert_eq!(library::saved_vars(&d, "gi", &ghost.id).unwrap()[0].value, "2");
        let pid = profiles::list(&d, "gi").unwrap().into_iter().find(|p| p.name == "Battle").unwrap().id;
        let v: String = d.conn.query_row("SELECT value FROM profile_vars WHERE profile_id = ?1 AND mod_id = ?2 AND var = 'swapvar'", params![pid, ghost.id], |r| r.get(0)).unwrap();
        assert_eq!(v, "1");
        drop(d);
        fs::remove_dir_all(&root).unwrap();
    }

    /// XX Mod Manager: one mod linked in, one only in its folder; a preset naming both; a clash with "Default".
    #[test]
    fn xxmm_copy_then_undo() {
        let root = temp("xxmm");
        let (db, env) = setup("zzz", &root);
        let lib = root.join("XXSource");
        mod_at(&lib.join("Ellen Maid"));
        mod_at(&lib.join("Jane Gym"));
        json(&lib.join("Ellen Maid/mod.json"), serde_json::json!({"id": "e1", "modName": "Ellen Maid", "character": "Ellen", "url": "https://gamebanana.com/mods/42"}));
        json(&lib.join("Jane Gym/mod.json"), serde_json::json!({"id": "j1", "modName": "Jane Gym"}));
        let linked = make_link(&lib.join("Ellen Maid"), &env.mods.join("Ellen Maid"));
        json(&root.join("Roaming/xx-mod-manager/config.json"), serde_json::json!({"modSourcePath": lib, "modTargetPath": env.mods, "presetPath": root.join("XXPresets")}));
        json(&root.join("XXPresets/Default.json"), serde_json::json!({"id": "p", "name": "Default", "modIds": ["e1", "j1"]}));
        {
            let d = db.lock().unwrap();
            profiles::list(&d, "zzz").unwrap();
        }
        let all = read_all(&env);
        let s = summary(find(&all, "xxmm"));
        assert_eq!(s.outside, if linked { 1 } else { 2 });
        assert_eq!(s.presets, 1);
        assert!(s.outside_bytes > 0);

        let src = read_all(&env).into_iter().find(|s| s.id == "xxmm").unwrap();
        let res = run(&db, &env, src, Mode::Copy).unwrap();
        assert!(env.mods.join("DISABLED Jane Gym/mod.ini").is_file(), "{:?}", res.notes);
        assert!(lib.join("Jane Gym/mod.ini").is_file());
        assert_eq!(res.profiles, vec!["Default (XX Mod Manager)"]);
        let on = profile_mods(&db, "zzz", "Default (XX Mod Manager)");
        assert!(on.contains(&"DISABLED Jane Gym".to_string()), "{on:?}");
        if linked { assert!(on.contains(&"Ellen Maid".to_string()), "{on:?}"); }

        let data = root.join("data");
        undo(&db, &data, &res.undo).unwrap();
        assert!(!env.mods.join("DISABLED Jane Gym").exists());
        assert!(lib.join("Jane Gym/mod.ini").is_file());
        assert!(profiles::list(&db.lock().unwrap(), "zzz").unwrap().iter().all(|p| p.name != "Default (XX Mod Manager)"));
        fs::remove_dir_all(&root).unwrap();
    }

    /// Move: the link is replaced by the real folder, the off mod moves in off, Undo puts both back.
    #[test]
    fn move_replaces_links() {
        let root = temp("move");
        let (db, env) = setup("zzz", &root);
        let lib = root.join("PeakyLib");
        mod_at(&lib.join("Miyabi Snow"));
        mod_at(&lib.join("Burnice Swim"));
        if !make_link(&lib.join("Miyabi Snow"), &env.mods.join("Miyabi Snow")) { fs::remove_dir_all(&root).unwrap(); return; }
        json(&root.join("Roaming/peakymodmanager-v3/config.json"), serde_json::json!({"libraryPath": lib, "targetPath": env.mods}));
        json(&lib.join("Presets_Backup_2025-01-01-10-00-00.json"), serde_json::json!({"Old": ["Miyabi Snow"]}));
        json(&lib.join("Presets_Backup_2025-02-01-10-00-00.json"), serde_json::json!({"Swim": ["Burnice Swim", "Miyabi Snow"]}));
        let src = read_all(&env).into_iter().find(|s| s.id == "peaky").unwrap();
        assert_eq!(src.presets.len(), 1);
        let res = run(&db, &env, src, Mode::Move).unwrap();
        assert!(!is_link(&env.mods.join("Miyabi Snow")) && env.mods.join("Miyabi Snow/mod.ini").is_file(), "{:?}", res.notes);
        assert!(env.mods.join("DISABLED Burnice Swim/mod.ini").is_file());
        assert!(!lib.join("Burnice Swim").exists() && !lib.join("Miyabi Snow").exists());
        assert_eq!(profile_mods(&db, "zzz", "Swim"), vec!["DISABLED Burnice Swim", "Miyabi Snow"]);

        undo(&db, &root.join("data"), &res.undo).unwrap();
        assert!(lib.join("Burnice Swim/mod.ini").is_file() && lib.join("Miyabi Snow/mod.ini").is_file());
        assert!(is_link(&env.mods.join("Miyabi Snow")));
        assert!(!env.mods.join("DISABLED Burnice Swim").exists());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn wzmm_dismods_and_groups() {
        let root = temp("wzmm");
        let (db, env) = setup("zzz", &root);
        let zzmi = env.mods.parent().unwrap().to_path_buf();
        mod_at(&env.mods.join("Ellen"));
        mod_at(&zzmi.join("dismods/Jane"));
        json(&root.join("Roaming/wzmm/settings.json"), serde_json::json!({"xxmiPath": zzmi}));
        json(&root.join("Roaming/wzmm/groups/group_1.json"), serde_json::json!({"id": "group_1", "name": "Both", "mods": ["Ellen", "Jane"], "createdAt": 1, "updatedAt": 2}));
        let src = read_all(&env).into_iter().find(|s| s.id == "wzmm").unwrap();
        assert_eq!(src.outside.len(), 1);
        let res = run(&db, &env, src, Mode::Copy).unwrap();
        assert_eq!(res.added.len(), 1, "{:?}", res.notes);
        assert_eq!(profile_mods(&db, "zzz", "Both"), vec!["DISABLED Jane", "Ellen"]);
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn gmm_presets_and_details() {
        let root = temp("gmm");
        let (db, env) = setup("gi", &root);
        mod_at(&env.mods.join("raiden/DISABLED_kimono"));
        mod_at(&env.mods.join("hu-tao/ghost"));
        let file = root.join("Roaming/GenshinModManager/app_data.sqlite");
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        {
            let c = Connection::open(&file).unwrap();
            c.execute_batch(&format!("
                CREATE TABLE settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
                CREATE TABLE assets (id INTEGER PRIMARY KEY AUTOINCREMENT, entity_id INTEGER NOT NULL, name TEXT NOT NULL, description TEXT, folder_name TEXT NOT NULL UNIQUE, image_filename TEXT, author TEXT, category_tag TEXT);
                CREATE TABLE presets (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, is_favorite INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE preset_assets (preset_id INTEGER NOT NULL, asset_id INTEGER NOT NULL, is_enabled INTEGER NOT NULL, PRIMARY KEY (preset_id, asset_id));
                INSERT INTO settings VALUES ('mods_folder_path', '{}');
                INSERT INTO assets (entity_id, name, description, folder_name, author, category_tag) VALUES (1, 'Summer Kimono', 'Blue', 'raiden/kimono', 'Someone', 'Outfit');
                INSERT INTO assets (entity_id, name, folder_name) VALUES (2, 'Ghost', 'hu-tao/ghost');
                INSERT INTO presets (name) VALUES ('Summer');
                INSERT INTO preset_assets VALUES (1, 1, 1), (1, 2, 0);
            ", env.mods.to_string_lossy().replace('\'', "''"))).unwrap();
        }
        let src = read_all(&env).into_iter().find(|s| s.id == "gmm").unwrap();
        assert_eq!((src.inside, src.presets.len()), (2, 1));
        let res = run(&db, &env, src, Mode::Copy).unwrap();
        assert_eq!(profile_mods(&db, "gi", "Summer"), vec!["raiden/DISABLED_kimono"], "{:?}", res.notes);
        let sc = library::read_sidecar(&env.mods.join("raiden/DISABLED_kimono")).unwrap();
        assert_eq!((sc.name.as_str(), sc.notes.as_deref(), sc.tags.clone()), ("Summer Kimono", Some("Blue"), vec!["Outfit".to_string()]));
        assert_eq!(res.undo.sidecars.len(), 2);
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn gimm_copies_off_mods() {
        let root = temp("gimm");
        let (db, env) = setup("gi", &root);
        let lib = root.join("Mod_Collection");
        mod_at(&lib.join("Kimono"));
        mod_at(&lib.join("Ghost"));
        mod_at(&env.mods.join("Kimono"));
        json(&root.join("Roaming/gimm/config.json"), serde_json::json!({"modFolder": lib, "gimiFolder": env.mods}));
        let s = summary(find(&read_all(&env), "gimm"));
        assert_eq!((s.inside, s.outside), (1, 1));
        let src = read_all(&env).into_iter().find(|s| s.id == "gimm").unwrap();
        let res = run(&db, &env, src, Mode::Copy).unwrap();
        assert!(env.mods.join("DISABLED Ghost/mod.ini").is_file(), "{:?}", res.notes);
        assert!(!env.mods.join("DISABLED Kimono").exists());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn other_preset_files() {
        let root = temp("presets");
        let (db, env) = setup("ww", &root);
        // WuWa Mod Manager
        mod_at(&env.mods.join("Changli"));
        json(&env.mods.join("Changli/mod.json"), serde_json::json!({"id": "c-1", "author": "A", "category": "Resonator"}));
        mod_at(&env.mods.join("disabled Jinhsi"));
        json(&env.mods.join("disabled Jinhsi/mod.json"), serde_json::json!({"id": "j-1"}));
        json(&env.mods.join("presets.json"), serde_json::json!({"presets": {"u1": {"name": "Pair", "enabled_mods": ["c-1", "j-1"]}}}));
        // IMM
        json(&root.join("Local/Integrated Mod Manager (IMM)/configWW.json"), serde_json::json!({"data": {}, "presets": [{"name": "Solo", "data": ["Changli"], "hotkey": ""}]}));
        // SkinSelectImpact next to the Desktop
        let ssi_home = root.join("Home/Desktop/SkinSelectImpact v8");
        mod_at(&env.mods.join("SkinSelectImpact/Jinhsi/Dress"));
        json(&ssi_home.join("Data/App_Settings.json"), serde_json::json!({"WW_Mods_Path": env.mods, "GS_Mods_Path": ""}));
        json(&ssi_home.join("Data/WW_Presets.json"), serde_json::json!([{"Name": "Party", "Mods": [{"FolderName": "Jinhsi", "SubFolderName": "Dress", "State": true}]}]));
        // GB Mod Manager: Changli is off there
        json(&root.join("Home/.gb-mod-manager/store.json"), serde_json::json!({"mods": {"777": {"id": 777, "name": "Changli Coat", "gbId": 777, "installPath": env.mods.join("Changli"), "enabled": false}}, "gamePaths": {}}));

        let all = read_all(&env);
        assert_eq!(find(&all, "wuwamoma").presets.len(), 1);
        assert_eq!(find(&all, "imm").presets.len(), 1);
        assert_eq!(find(&all, "ssi").presets[0].entries[0].refs, vec![Ref::Rel("SkinSelectImpact/Jinhsi/Dress".into())]);
        assert_eq!(find(&all, "gbmm").off.len(), 1);

        for id in ["wuwamoma", "imm", "ssi", "gbmm"] {
            let src = read_all(&env).into_iter().find(|s| s.id == id).unwrap();
            run(&db, &env, src, Mode::Copy).unwrap();
        }
        assert_eq!(profile_mods(&db, "ww", "Pair").len(), 2);
        assert_eq!(profile_mods(&db, "ww", "Solo").len(), 1);
        assert_eq!(profile_mods(&db, "ww", "Party"), vec!["SkinSelectImpact/Jinhsi/Dress"]);
        assert!(env.mods.join("DISABLED Changli/mod.ini").is_file());
        let sc = library::read_sidecar(&env.mods.join("DISABLED Changli")).unwrap();
        assert_eq!(sc.source.map(|s| s.mod_id), Some(777));
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn fairy_backup_and_emmm() {
        let root = temp("fairy");
        let (db, env) = setup("zzz", &root);
        mod_at(&env.mods.join("Playable Characters/Ellen/Maid"));
        let backup = root.join("backup.json");
        let profiles_text = serde_json::json!([{"id": "profile_1", "name": "Maids", "tab": "playable_characters", "enabledModRelativePaths": ["Ellen/Maid"]}]).to_string();
        json(&backup, serde_json::json!({"schemaVersion": 1, "keys": {"mod_profiles": profiles_text, "favoriteMods": "[\"Maid\"]"}}));
        let mut env = env;
        env.picked = Some(backup);
        let src = read_all(&env).into_iter().find(|s| s.id == "fairy").unwrap();
        run(&db, &env, src, Mode::Copy).unwrap();
        assert_eq!(profile_mods(&db, "zzz", "Maids"), vec!["Playable Characters/Ellen/Maid"]);
        assert!(library::read_sidecar(&env.mods.join("Playable Characters/Ellen/Maid")).unwrap().favorite);

        let file = root.join("Roaming/com.reynalivan.emmm/app.db");
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        let c = Connection::open(&file).unwrap();
        c.execute_batch(&format!("
            CREATE TABLE games (id TEXT PRIMARY KEY, mods_path TEXT);
            CREATE TABLE collections (id TEXT PRIMARY KEY, game_id TEXT, name TEXT);
            CREATE TABLE collection_mods (collection_id TEXT, mod_path TEXT);
            INSERT INTO games VALUES ('g1', '{}');
            INSERT INTO collections VALUES ('c1', 'g1', 'Maids');
            INSERT INTO collection_mods VALUES ('c1', 'Playable Characters/Ellen/Maid');
        ", env.mods.to_string_lossy().replace('\'', "''"))).unwrap();
        drop(c);
        let src = read_all(&env).into_iter().find(|s| s.id == "emmm").unwrap();
        let res = run(&db, &env, src, Mode::Copy).unwrap();
        assert_eq!(res.profiles, vec!["Maids (EMMM)"]);
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn hoyomm_store_and_playlists() {
        let root = temp("hoyo");
        let (db, env) = setup("zzz", &root);
        let store = root.join("HMMStore");
        mod_at(&store.join("ZZZ/Ellen/Maid"));
        mod_at(&env.mods.join("3_Maid"));
        let cache = root.join("Local/HoyoModManagerGo/cache");
        fs::create_dir_all(cache.join("rosedb_basic")).unwrap();
        let mut seg = b"\x00\x01root_mod_dir\x10".to_vec();
        seg.extend_from_slice(store.to_string_lossy().as_bytes());
        seg.extend_from_slice(b"\x00\x00");
        fs::write(cache.join("rosedb_basic/000000001.SEG"), seg).unwrap();
        let c = Connection::open(cache.join("hmm.db")).unwrap();
        c.execute_batch("
            CREATE TABLE mod (id INTEGER PRIMARY KEY, fname TEXT, game INTEGER, char_name TEXT, char_id INTEGER, selected BOOLEAN, preview_images TEXT, gb_id INTEGER, mod_link TEXT, gb_file_name TEXT, gb_download_link TEXT);
            CREATE TABLE playlist (id INTEGER PRIMARY KEY, playlist_name TEXT, game INTEGER);
            CREATE TABLE playlist_mod_cross_ref (playlist_id INTEGER, mod_id INTEGER, PRIMARY KEY (playlist_id, mod_id));
            INSERT INTO mod (id, fname, game, char_name, gb_id) VALUES (3, 'Maid', 3, 'Ellen', 99);
            INSERT INTO playlist VALUES (1, 'Night', 3);
            INSERT INTO playlist_mod_cross_ref VALUES (1, 3);
        ").unwrap();
        drop(c);
        let s = summary(find(&read_all(&env), "hoyomm"));
        assert_eq!((s.inside, s.outside, s.presets), (1, 0, 1));
        let src = read_all(&env).into_iter().find(|s| s.id == "hoyomm").unwrap();
        run(&db, &env, src, Mode::Copy).unwrap();
        assert_eq!(profile_mods(&db, "zzz", "Night"), vec!["3_Maid"]);
        fs::remove_dir_all(&root).unwrap();
    }

    /// A link to a folder no reader knows: that folder is offered as another manager's, with the presets ZZZ
    /// ModManager left beside Mods.
    #[test]
    fn unknown_links_and_zzmm() {
        let root = temp("linked");
        let (_db, env) = setup("zzz", &root);
        let lib = root.join("ModSource");
        mod_at(&lib.join("A"));
        mod_at(&lib.join("B"));
        if !make_link(&lib.join("A"), &env.mods.join("A")) { fs::remove_dir_all(&root).unwrap(); return; }
        let all = read_all(&env);
        assert!(all.iter().all(|s| s.id != "zzmm"));
        let s = summary(find(&all, "linked"));
        assert_eq!((s.inside, s.outside), (1, 1));
        json(&env.mods.parent().unwrap().join("presets/Duo.json"), serde_json::json!(["A", "B"]));
        let all = read_all(&env);
        assert!(all.iter().all(|s| s.id != "linked"));
        let z = find(&all, "zzmm");
        assert_eq!((z.presets.len(), z.outside.len()), (1, 2));
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn reads_values_and_paths() {
        let v = values_from_pairs(Some(&serde_json::json!({"b\\xixifu.ini\\$swapvar": "2", "bad": "1"})));
        assert_eq!(v, vec![VarValue { ini: "b/xixifu.ini".into(), var: "swapvar".into(), value: "2".into() }]);
        assert_eq!(norm_rel("Ellen/DISABLED_Maid"), "ellen/maid");
        assert_eq!(pkey(Path::new("\\\\?\\C:\\Mods\\")), "c:\\mods");
        assert!(under("c:\\mods\\a", "c:\\mods") && !under("c:\\modsx", "c:\\mods"));
    }
}
