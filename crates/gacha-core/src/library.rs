//! The mod library: what is in a game's Mods folder, turning mods on and off, their metadata, characters and the
//! trash. Owner: LIBRARY area (docs/spec.md, "Library").
//!
//! Mods live where 3DMigoto loads them, in the importer's Mods folder. A mod is off when its folder name, or the name
//! of any folder above it up to Mods, starts with `DISABLED` (3DMigoto skips `DISABLED*` at every level). Each mod
//! folder holds a `.gachamod.json` sidecar (model::Sidecar) so it keeps its id and details through renames, moves and
//! transfers. The `mods` table is a cache of the last scan, updated in place by every change.
//!
//! Saved options: 3DMigoto rewrites d3dx_user.ini in full and drops the values of mods it didn't load. So turning a
//! mod off first copies its values into `mod_vars`, and turning it on writes them back under its new path (or later,
//! when the game is running then). Rows in `mod_vars` for a mod that is on are writes still waiting for the game to
//! close; rows for a mod that is off are its kept values.

use crate::db::{now, Db, Shared};
use crate::error::{Error, Result};
use crate::ini::{self, QuickFacts, VarValue};
use crate::aliases::Matcher;
use crate::model::{Character, ModChange, ModEntry, Sidecar, DISABLED_PREFIX, SIDECAR_FILE};
use crate::{devtools, games, launch, managers, previews, profiles};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

pub const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS mods (
    id TEXT PRIMARY KEY,
    game TEXT NOT NULL,
    rel_path TEXT NOT NULL,
    data TEXT NOT NULL,
    scanned_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS mods_by_game ON mods (game);
CREATE TABLE IF NOT EXISTS characters (
    game TEXT NOT NULL,
    name TEXT NOT NULL,
    gb_category_id INTEGER,
    icon TEXT,
    sort INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (game, name)
);
CREATE TABLE IF NOT EXISTS trash (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game TEXT NOT NULL,
    mod_id TEXT NOT NULL,
    name TEXT NOT NULL,
    kept_path TEXT NOT NULL,
    original_rel TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    reason TEXT NOT NULL,
    removed_at INTEGER NOT NULL,
    data TEXT
);
CREATE TABLE IF NOT EXISTS mod_vars (
    game TEXT NOT NULL,
    mod_id TEXT NOT NULL,
    ini TEXT NOT NULL,
    var TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (game, mod_id, ini, var)
);
";

pub fn migrate(db: &Db) -> Result<()> {
    if !db.has_column("trash", "data")? {
        db.conn.execute_batch("ALTER TABLE trash ADD COLUMN data TEXT")?;
    }
    // characters the player has (CREATE ... IF NOT EXISTS)
    db.conn.execute_batch(crate::owned::SCHEMA)?;
    // removed mods whose files are gone (CREATE ... IF NOT EXISTS, safe on every database)
    db.conn.execute_batch(removed::ARCHIVE_SCHEMA)?;
    Ok(())
}

mod parts;
pub use parts::{merge, parts, parts_in, set_part, ModPart};
mod removed;
pub use removed::{archive_forget, archive_list, drop_removed, in_trash, purge_expired, removed_by_gb, trash_days, trash_purge, unsourced_to_recycle_bin, ArchiveEntry, Removed};

/// IMM keeps every mod here (3DMigoto skips it because of the DISABLED prefix) ...
pub const IMM_STORE: &str = "DISABLED - ALL MODS ARE STORED HERE (Managed by IMM)";
/// ... and links the enabled ones into here.
pub const IMM_LINKS: &str = "DO NOT MODIFY (Managed by IMM)";

/// Fields the user can change on a mod. `None` leaves a field alone; an empty string clears a text field.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MetaPatch {
    pub name: Option<String>,
    pub character: Option<String>,
    pub tags: Option<Vec<String>>,
    pub notes: Option<String>,
    pub favorite: Option<bool>,
    pub nsfw: Option<bool>,
    pub version: Option<String>,
    /// Make it a sub-mod of this mod (an id), or "" to make it a mod of its own again.
    pub parent: Option<String>,
}

/// A character name with its GameBanana category and icon, as the UI found it in GameBanana's category tree.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CharacterRef {
    pub name: String,
    pub gb_category_id: Option<u64>,
    pub icon: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashEntry {
    pub id: i64,
    pub game: String,
    pub mod_id: String,
    pub name: String,
    pub original_rel: String,
    pub size: u64,
    /// "removed" or "replaced" (an update kept the old copy).
    pub reason: String,
    pub removed_at: i64,
}

// ── sidecar helpers, used by every area that places a mod folder ──

/// A new random mod id (32 hex characters).
pub fn new_id() -> String {
    let mut b = [0u8; 16];
    let _ = getrandom::fill(&mut b);
    hex::encode(b)
}

pub fn read_sidecar(dir: &Path) -> Option<Sidecar> {
    std::fs::read_to_string(dir.join(SIDECAR_FILE)).ok().and_then(|s| serde_json::from_str(s.trim_start_matches('\u{feff}')).ok())
}

pub fn write_sidecar(dir: &Path, s: &Sidecar) -> Result<()> {
    let mut s = s.clone();
    if s.format == 0 { s.format = 1; }
    std::fs::write(dir.join(SIDECAR_FILE), serde_json::to_string_pretty(&s)?)?;
    Ok(())
}

/// The folder name without the DISABLED prefix (any case, with any spaces, underscores or dashes after it).
pub fn display_folder(name: &str) -> &str {
    if is_disabled_name(name) {
        // the first 8 bytes are ASCII letters, so slicing there is safe
        name[8..].trim_start_matches(|c: char| c.is_whitespace() || c == '_' || c == '-')
    } else { name }
}

/// True when 3DMigoto would skip this folder name.
pub fn is_disabled_name(name: &str) -> bool { name.len() >= 8 && name.as_bytes()[..8].eq_ignore_ascii_case(b"DISABLED") }

// ── paths ──

/// True when any part of a path from Mods ("Ellen Joe/DISABLED Coca Cola") starts with DISABLED.
fn rel_disabled(rel: &str) -> bool { rel.split('/').any(is_disabled_name) }

/// The first folder above the mod (not the mod itself) whose name keeps everything in it off.
fn disabled_parent(rel: &str) -> Option<&str> {
    let mut parts: Vec<&str> = rel.split('/').collect();
    parts.pop();
    parts.into_iter().find(|p| is_disabled_name(p))
}

/// The mod sits in one of IMM's own folders.
pub fn is_imm_rel(rel: &str) -> bool {
    let first = rel.split('/').next().unwrap_or("");
    first.eq_ignore_ascii_case(IMM_STORE) || first.eq_ignore_ascii_case(IMM_LINKS)
}

fn imm_error() -> Error {
    Error::Conflict("IMM manages this mod. Move your mods out of IMM first (Tools, Share and import).".into())
}

fn name_of(p: &Path) -> String { p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default() }

/// `dir` relative to `root` with forward slashes, or None when it isn't inside.
fn rel_of(root: &Path, dir: &Path) -> Option<String> {
    let join = |r: &Path| r.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect::<Vec<_>>().join("/");
    if let Ok(r) = dir.strip_prefix(root) { return Some(join(r)).filter(|s| !s.is_empty()); }
    let (cr, cd) = (fs::canonicalize(root).ok()?, fs::canonicalize(dir).ok()?);
    cd.strip_prefix(&cr).ok().map(join).filter(|s| !s.is_empty())
}

/// A relative path from the database or the UI, checked so it can't leave the Mods folder.
fn safe_rel(rel: &str) -> Option<PathBuf> {
    let mut out = PathBuf::new();
    for part in rel.split(['/', '\\']) {
        let p = part.trim();
        if p.is_empty() || p == "." { continue; }
        if p == ".." || p.contains(':') { return None; }
        out.push(p);
    }
    (!out.as_os_str().is_empty()).then_some(out)
}

/// A free name in `parent`: `base`, else "base (2)", "base (3)" ... Windows names are case-insensitive, and so is
/// `exists` on Windows, so "coca cola" and "Coca Cola" clash as they should.
fn unique_child(parent: &Path, base: &str) -> PathBuf {
    let mut cand = parent.join(base);
    let mut n = 2;
    while cand.exists() || fs::symlink_metadata(&cand).is_ok() {
        cand = parent.join(format!("{base} ({n})"));
        n += 1;
    }
    cand
}

/// Rename a mod folder. A file open in another program (os error 5 or 32) gets three more tries 150 ms apart; a move
/// to another drive (os error 17) copies then deletes.
pub(crate) fn rename_dir(from: &Path, to: &Path) -> Result<()> {
    let mut tries = 0;
    loop {
        match fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(e) if e.raw_os_error() == Some(17) => {
                if let Err(err) = copy_dir(from, to) {
                    let _ = fs::remove_dir_all(to);
                    return Err(err.into());
                }
                let _ = fs::remove_dir_all(from);
                return Ok(());
            }
            Err(e) if matches!(e.raw_os_error(), Some(5) | Some(32)) => {
                if tries >= 3 {
                    return Err(Error::Conflict(format!(
                        "Windows wouldn't let gachamod rename {}. Close any window showing that folder and try again.", name_of(from))));
                }
                tries += 1;
                std::thread::sleep(std::time::Duration::from_millis(150));
            }
            Err(e) => return Err(e.into()),
        }
    }
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for e in fs::read_dir(from)? {
        let e = e?;
        let ft = e.file_type()?;
        let target = to.join(e.file_name());
        if ft.is_dir() { copy_dir(&e.path(), &target)?; } else { fs::copy(e.path(), &target)?; }
    }
    Ok(())
}

// ── characters ──

/// The best character among `names` for some hints, by the rules in aliases.rs (no alias table).
pub fn match_character(names: &[String], hints: &[&str]) -> Option<String> { Matcher::plain(names).best(hints) }

/// The same with the game's alias table: "Ei" finds Raiden Shogun, "Anbi" finds Anby.
pub fn match_character_for(game: &str, names: &[String], hints: &[&str]) -> Option<String> { Matcher::new(game, names).best(hints) }

pub(crate) fn character_names(db: &Db, game: &str) -> Result<Vec<String>> {
    let mut st = db.conn.prepare("SELECT name FROM characters WHERE game = ?1 ORDER BY sort")?;
    let v = st.query_map([game], |r| r.get::<_, String>(0))?.collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(v)
}

/// A matcher over the game's roster and alias table.
pub fn matcher(db: &Db, game: &str) -> Result<Matcher> { Ok(Matcher::new(game, &character_names(db, game)?)) }

// ── reading a mod folder ──

fn is_ini(name: &str) -> bool {
    let l = name.to_ascii_lowercase();
    l.ends_with(".ini") && l != "desktop.ini"
}

/// An ini another manager turned off by renaming it: "DISABLED_mod.ini" (3DMigoto skips it) or "mod.ini.disabled".
pub(crate) fn is_off_ini(name: &str) -> bool {
    let l = name.to_ascii_lowercase();
    (is_ini(name) && is_disabled_name(name)) || l.ends_with(".ini.disabled") || l.ends_with(".ini.disable")
}

/// The ini name a turned-off ini had: "DISABLED_mod.ini" -> "mod.ini", "mod.ini.disabled" -> "mod.ini".
fn live_ini_name(name: &str) -> Option<String> {
    let l = name.to_ascii_lowercase();
    let n = if l.ends_with(".ini.disabled") { &name[..name.len() - 9] } else if l.ends_with(".ini.disable") { &name[..name.len() - 8] } else { name };
    let n = display_folder(n);
    (is_ini(n) && n.len() > 4).then(|| n.to_string())
}

/// A mod folder that 3DMigoto skips although its name doesn't say so: every ini in it, at any depth, was turned off
/// by renaming (another manager's way of turning a mod off).
fn only_off_inis(dir: &Path) -> bool {
    fn walk(dir: &Path, off: &mut bool, depth: u32) -> bool {
        if depth > 8 { return true; }
        let Ok(rd) = fs::read_dir(dir) else { return true };
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_dir() {
                // Hestia's box of a mod's files
                if depth == 0 && name.eq_ignore_ascii_case(HESTIA_OFF) { *off = true; continue; }
                if !is_disabled_name(&name) && !skip_dir(&name) && !walk(&e.path(), off, depth + 1) { return false; }
            } else if is_off_ini(&name) { *off = true; }
            else if is_ini(&name) { return false; }
        }
        true
    }
    let mut off = false;
    walk(dir, &mut off, 0) && off
}

fn is_image(name: &str) -> bool {
    let l = name.to_ascii_lowercase();
    [".png", ".jpg", ".jpeg", ".webp", ".gif"].iter().any(|x| l.ends_with(x))
}

/// Hestia turns a mod off by moving its files into this folder inside the mod's own folder.
pub(crate) const HESTIA_OFF: &str = "DISABLED_BY_HESTIA";

/// Folders other tools write into Mods for themselves, on or off: SkinSelectImpact's KeyViewer, Fairy's Secret
/// Folder's in-game menu (old and new names), and Hestia's details folder in each mod and in Mods (its hestia.ini
/// only keeps saved values).
const TOOL_DIRS: &[&str] = &["additionalfiles_ssi", "zzzzzz_zzzmodmanagerui", "000_zzzmanager_ui", "\u{2b22}hestia"];

/// Folders that are never mods or groups.
pub(crate) fn skip_dir(name: &str) -> bool {
    let l = name.to_ascii_lowercase();
    l.starts_with('.') || l == "shaderfixes" || l == "shadercache" || l == "__macosx" || l == crate::live::DIR
        || TOOL_DIRS.contains(&display_folder(&l))
}

const GENERIC: &[&str] = &["mod", "mods", "files", "file", "data", "content", "mod files", "modfiles"];

#[derive(Default)]
struct Facts { size: u64, files: u32, inis: u32, root_files: Vec<String> }

/// Size, file count and ini count of a mod folder, from metadata only. Links are not followed.
fn dir_facts(dir: &Path) -> Facts {
    // size and file count include turned-off variants inside the mod; the ini count doesn't (3DMigoto skips them)
    fn walk(dir: &Path, f: &mut Facts, root: bool, off: bool, depth: u32) {
        if depth > 16 { return; }
        let Ok(rd) = fs::read_dir(dir) else { return };
        for e in rd.flatten() {
            let Ok(ft) = e.file_type() else { continue };
            let name = e.file_name().to_string_lossy().into_owned();
            if ft.is_dir() {
                walk(&e.path(), f, false, off || is_disabled_name(&name), depth + 1);
            } else if ft.is_file() {
                if name == SIDECAR_FILE { continue; }
                f.files += 1;
                f.size += e.metadata().map(|m| m.len()).unwrap_or(0);
                if !off && is_ini(&name) && !is_disabled_name(&name) { f.inis += 1; }
                if root { f.root_files.push(name); }
            }
        }
    }
    let mut f = Facts::default();
    walk(dir, &mut f, true, false, 0);
    f
}

/// The picture that shows a mod (docs/spec.md, "Previews"): the user's own (set_preview) when its file is there, else
/// preview.(png|jpg|jpeg|webp|gif) in the mod root, else the sidecar's preview (the GameBanana picture saved at install,
/// a file there or a URL), else the first root-level image that no ini loads and that isn't named like a texture, else
/// such a picture up to three folders down (previews::nested_picture).
fn pick_preview(dir: &Path, files: &[String], sc: &Sidecar) -> Option<String> {
    if let Some(full) = custom_preview_path(dir, sc) { return Some(full.to_string_lossy().into_owned()); }
    let mut images: Vec<&String> = files.iter().filter(|f| is_image(f)).collect();
    images.sort_by_key(|f| f.to_ascii_lowercase());
    if let Some(p) = images.iter().find(|f| previews::is_preview_name(f)) {
        return Some(dir.join(p).to_string_lossy().into_owned());
    }
    if let Some(p) = sc.preview.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
        if p.starts_with("http://") || p.starts_with("https://") { return Some(p.to_string()); }
        if let Some(rel) = safe_rel(p) {
            let full = dir.join(rel);
            if full.is_file() && !previews::looks_like_texture(p) { return Some(full.to_string_lossy().into_owned()); }
        }
    }
    // pictures other managers save: JASM's .JASM_Cover.png, EMMM's preview_custom.png, FlairX's preview001.jpg ...
    if let Some(p) = images.iter().find(|f| managers::is_cover_name(f)) {
        return Some(dir.join(p).to_string_lossy().into_owned());
    }
    previews::root_picture(dir, files, |_| false)
        .or_else(|| previews::nested_picture(dir))
        .map(|p| dir.join(p).to_string_lossy().into_owned())
}

fn folder_time(dir: &Path) -> i64 {
    fs::metadata(dir).ok()
        .and_then(|m| m.created().or_else(|_| m.modified()).ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or_else(now)
}

fn group_of(rel: &str) -> Option<String> { rel.rsplit_once('/').map(|(g, _)| g.to_string()) }

/// Hints for guessing a character: the group folders from Mods down, then the folder name, then the mod's name.
fn hints_for<'a>(rel: &'a str, name: &'a str) -> Vec<&'a str> {
    let mut v: Vec<&str> = rel.split('/').map(display_folder).collect();
    v.push(name);
    v
}

fn build_entry(game: &str, root: &Path, rel: &str, enabled: bool, sc: &Sidecar, qf: &QuickFacts, m: &Matcher) -> ModEntry {
    let dir = root.join(rel);
    let facts = dir_facts(&dir);
    let folder = rel.rsplit('/').next().unwrap_or(rel).to_string();
    let group = group_of(rel);
    // a character saved under another name ("Ei", "RaidenShogun") shows under the roster's name
    let character = sc.character.as_deref().map(str::trim).filter(|c| !c.is_empty()).map(|c| m.exact(c).unwrap_or_else(|| c.to_string())).or_else(|| {
        // group folders first, then the mod's own folder ("Jane Doe Maid" in a folder that isn't a character's)
        let parts: Vec<&str> = group.as_deref().map(|g| g.split('/').map(display_folder).collect()).unwrap_or_default();
        m.best(&parts).or_else(|| m.best(&[display_folder(&folder)]))
    });
    let name = if sc.name.trim().is_empty() { display_folder(&folder).to_string() } else { sc.name.clone() };
    ModEntry {
        id: sc.id.clone(),
        game: game.into(),
        name,
        folder,
        rel_path: rel.into(),
        path: dir.to_string_lossy().into_owned(),
        enabled,
        standby: false,
        character,
        group,
        source: sc.source.clone(),
        version: sc.version.clone(),
        installed_at: sc.installed_at,
        size_bytes: facts.size,
        file_count: facts.files,
        ini_count: if qf.ini_count > 0 { qf.ini_count } else { facts.inis },
        preview: pick_preview(&dir, &facts.root_files, sc),
        thumb: None,
        custom_preview: custom_preview_path(&dir, sc).is_some(),
        tags: sc.tags.clone(),
        notes: sc.notes.clone(),
        favorite: sc.favorite,
        nsfw: sc.nsfw,
        has_keys: qf.has_keys,
        conflicts: 0,
        update_available: false,
        parts: parts_in(&dir).len() as u32,
        parent: sc.parent.clone().filter(|p| !p.is_empty() && *p != sc.id),
    }
}

/// Where mod card thumbnails are kept (previews::find_thumb).
fn thumbs_dir(db: &Db) -> PathBuf { crate::pack::data_dir_of(db).join("cache").join("thumbs") }

/// Fill each entry's `thumb` from the cache. Ones not made yet are made right away (`now`, for one mod) or on a
/// background thread, ready for the next scan.
fn attach_thumbs(cache: &Path, entries: &mut [ModEntry], now: bool) {
    use previews::Thumb;
    let mut later = Vec::new();
    for e in entries.iter_mut() {
        let Some(p) = e.preview.clone() else { e.thumb = None; continue };
        let t = match previews::find_thumb(cache, &p) {
            Thumb::Ready(t) => Some(t),
            Thumb::NotNeeded => None,
            Thumb::ToMake if now => previews::thumb_now(cache, &p),
            Thumb::ToMake => { later.push(p); None }
        };
        e.thumb = t.map(|t| t.to_string_lossy().into_owned());
    }
    previews::make_thumbs_later(cache, later);
}

/// The user's own preview file inside `dir`, when the sidecar names one and it is still there.
fn custom_preview_path(dir: &Path, sc: &Sidecar) -> Option<PathBuf> {
    let rel = sc.custom_preview.as_deref().and_then(safe_rel)?;
    let full = dir.join(rel);
    full.is_file().then_some(full)
}

// ── finding mods ──

struct Found { dir: PathBuf, rel: String, name_hint: String, ini_off: bool }

struct Walk { canon_root: Option<PathBuf>, found: Vec<Found>, links: HashSet<PathBuf> }

/// One pass over the tree (docs/spec.md, "Finding mods"). `outer`: the parent's display name when the parent holds
/// only this folder, so a generic inner name ("mod", "files") takes the outer one.
fn walk_dir(w: &mut Walk, dir: &Path, rel: &str, outer: Option<&str>, depth: u32) {
    if depth > 12 { return; }
    let Ok(rd) = fs::read_dir(dir) else { return };
    let mut has_side = false;
    let mut has_ini = false;
    let mut off_ini = false;
    let mut kids: Vec<(PathBuf, String)> = Vec::new();
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let Ok(ft) = e.file_type() else { continue };
        let mut is_dir = ft.is_dir();
        if ft.is_symlink() {
            // a link back into Mods (IMM's enabled mods) would list a mod twice: note where it points and stop
            let Ok(target) = fs::canonicalize(e.path()) else { continue };
            if w.canon_root.as_ref().is_some_and(|r| target.starts_with(r)) {
                w.links.insert(target);
                continue;
            }
            is_dir = target.is_dir();
        }
        if is_dir {
            if !skip_dir(&name) { kids.push((e.path(), name)); }
        } else if name == SIDECAR_FILE {
            has_side = true;
        } else if is_off_ini(&name) {
            off_ini = true;
        } else if is_ini(&name) {
            has_ini = true;
        }
    }
    // No Reload Mod Manager's own folder and its group folders hold its inis next to the mods: groups, never mods
    let scaffold = crate::nrmm::is_scaffold(rel);
    let hestia_off = kids.iter().any(|(_, n)| n.eq_ignore_ascii_case(HESTIA_OFF));
    if !rel.is_empty() && !scaffold && (has_side || has_ini || off_ini || hestia_off) {
        let folder = name_of(dir);
        let own = display_folder(&folder);
        let name_hint = match outer {
            Some(o) if GENERIC.contains(&own.to_ascii_lowercase().as_str()) || own.eq_ignore_ascii_case(o) => o.to_string(),
            _ => own.to_string(),
        };
        // only turned-off inis here: off, unless a sub-folder still has a live one
        let ini_off = (off_ini || hestia_off) && !has_ini && only_off_inis(dir);
        w.found.push(Found { dir: dir.to_path_buf(), rel: rel.to_string(), name_hint, ini_off });
        return;
    }
    // one folder holds the ini and loads files from the folders beside it ("resources/Roxy.ini" loading
    // "../toggles/Menu.dds"): this folder is the mod
    if !rel.is_empty() && !scaffold && kids.len() >= 2 {
        let with_ini: Vec<&PathBuf> = kids.iter().map(|(p, _)| p).filter(|p| fs::read_dir(p).into_iter().flatten().flatten().any(|e| is_ini(&e.file_name().to_string_lossy()))).collect();
        if with_ini.len() == 1 && crate::install::reaches_out(with_ini[0], dir) {
            w.found.push(Found { dir: dir.to_path_buf(), rel: rel.to_string(), name_hint: display_folder(&name_of(dir)).to_string(), ini_off: false });
            return;
        }
    }
    kids.sort_by_key(|(_, n)| n.to_ascii_lowercase());
    let own_name = name_of(dir);
    let only = if kids.len() == 1 && !rel.is_empty() { Some(display_folder(&own_name).to_string()) } else { None };
    for (path, name) in kids {
        let child_rel = if rel.is_empty() { name } else { format!("{rel}/{name}") };
        walk_dir(w, &path, &child_rel, only.as_deref(), depth + 1);
    }
}

/// Every mod folder under `root` by the rules of "Finding mods": (folder, path from root). Read-only.
pub(crate) fn mod_dirs(root: &Path) -> Vec<(PathBuf, String)> {
    let mut w = Walk { canon_root: fs::canonicalize(root).ok(), found: Vec::new(), links: HashSet::new() };
    walk_dir(&mut w, root, "", None, 0);
    w.found.into_iter().map(|f| (f.dir, f.rel)).collect()
}

fn valid_id(id: &str) -> bool { !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') }

/// Counts, for each enabled mod, the other enabled mods that override any of the same hashes. Hashes that 5 or more
/// enabled mods share are left out (shared buffers, UI, effects).
fn compute_conflicts(entries: &mut [ModEntry], hashes: &[Vec<String>], live: &HashMap<String, u32>, ignored: &HashSet<String>) {
    let mut by_hash: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, e) in entries.iter().enumerate() {
        if !e.enabled { continue; }
        let own: HashSet<String> = hashes[i].iter().map(|h| h.trim().trim_start_matches("0x").to_ascii_lowercase()).filter(|h| !h.is_empty()).collect();
        for h in own { by_hash.entry(h).or_default().push(i); }
    }
    let mut others: Vec<HashSet<usize>> = vec![HashSet::new(); entries.len()];
    for v in by_hash.values() {
        if v.len() < 2 || v.len() >= 5 { continue; }
        for &a in v {
            for &b in v {
                // two live mods of one character never show together
                let same_group = live.get(&entries[a].id).is_some_and(|g| live.get(&entries[b].id) == Some(g));
                if a != b && !same_group && !ignored.contains(&ini::pair_key(&entries[a].id, &entries[b].id)) { others[a].insert(b); }
            }
        }
    }
    for (i, e) in entries.iter_mut().enumerate() { e.conflicts = others[i].len() as u32; }
}

/// Count conflicts again for every mod in the list, without a full scan, after something that changes them: a mod
/// turned on or off, a conflict ignored, shared parts taken out or put back. Saves the rows whose count moved.
pub(crate) fn recount_conflicts(db: &Db, game: &str) {
    let Ok(mut entries) = list(db, game) else { return };
    let before: Vec<u32> = entries.iter().map(|e| e.conflicts).collect();
    let hashes: Vec<Vec<String>> = entries.iter()
        .map(|e| if e.enabled { ini::quick_facts(Path::new(&e.path)).active } else { Vec::new() }).collect();
    let live = crate::live::groups_by_mod(db, game);
    compute_conflicts(&mut entries, &hashes, &live, &ini::ignored_pairs(db, game));
    for (e, was) in entries.iter().zip(before) {
        if e.conflicts != was { let _ = save_row(db, e); }
    }
}

/// `recount_conflicts`, then the new counts on the entries a change hands back.
fn recount_into(db: &Db, game: &str, change: &mut ModChange) {
    if change.changed.is_empty() && change.removed.is_empty() { return; }
    recount_conflicts(db, game);
    for e in &mut change.changed { if let Ok(now) = get(db, game, &e.id) { e.conflicts = now.conflicts; } }
}

fn lock(db: &Shared) -> Result<std::sync::MutexGuard<'_, Db>> {
    db.lock().map_err(|_| Error::Db("The local database is stuck after an earlier error. Restart gachamod".into()))
}

// ── the library ──

/// Walk the game's Mods folder, adopt new mod folders (write a sidecar), drop rows for folders that are gone, refresh
/// the `mods` table, and return every mod. Rules for what counts as a mod are in docs/spec.md ("Finding mods").
pub fn scan(db: &Shared, game: &str) -> Result<Vec<ModEntry>> {
    let _hold = crate::watch::hold(game);
    let (root, prev, chars, thumbs, slots) = {
        let d = lock(db)?;
        parts::merge_split_installs(&d, game);
        let root = games::mods_dir(&d, game)?;
        let prev: HashMap<String, ModEntry> = list(&d, game)?.into_iter().map(|m| (m.id.clone(), m)).collect();
        // which mod of each No Reload Mod Manager group shows
        let slots = games::importer_dir(&d, game).map(|i| crate::nrmm::active_slots(&i)).unwrap_or_default();
        (root, prev, matcher(&d, game)?, thumbs_dir(&d), slots)
    };

    // a Mods folder that can't be read lists nothing, and saving that would forget every mod's row
    fs::read_dir(&root)?;
    let mut w = Walk { canon_root: fs::canonicalize(&root).ok(), found: Vec::new(), links: HashSet::new() };
    walk_dir(&mut w, &root, "", None, 0);

    // sidecars first, so a copied folder (same id twice) gives the new id to the copy, not to the original
    let sidecars: Vec<Option<Sidecar>> = w.found.iter().map(|f| read_sidecar(&f.dir)).collect();
    let mut keeper: HashMap<String, usize> = HashMap::new();
    for (i, s) in sidecars.iter().enumerate() {
        let Some(s) = s else { continue };
        if !valid_id(&s.id) { continue; }
        let at_home = prev.get(&s.id).is_some_and(|p| p.rel_path == w.found[i].rel);
        match keeper.get(&s.id) {
            None => { keeper.insert(s.id.clone(), i); }
            Some(_) if at_home => { keeper.insert(s.id.clone(), i); }
            Some(_) => {}
        }
    }

    let mut entries = Vec::with_capacity(w.found.len());
    let mut hashes = Vec::with_capacity(w.found.len());
    for (i, (f, sc)) in w.found.iter().zip(sidecars).enumerate() {
        let (sc, write) = match sc {
            Some(mut s) => {
                let mut write = false;
                if !valid_id(&s.id) || keeper.get(&s.id) != Some(&i) { s.id = new_id(); write = true; }
                if s.name.trim().is_empty() { s.name = f.name_hint.clone(); write = true; }
                (s, write)
            }
            None => {
                let hints = hints_for(&f.rel, &f.name_hint);
                let mut sc = Sidecar {
                    format: 1, id: new_id(), name: f.name_hint.clone(), character: chars.best(&hints),
                    installed_at: folder_time(&f.dir), ..Default::default()
                };
                // what another mod manager knew about it: name, character, GameBanana link, picture ...
                if let Some(fm) = managers::read(&f.dir) { managers::merge(&mut sc, &fm, &chars, &f.name_hint, true); }
                (sc, true)
            }
        };
        if write { let _ = write_sidecar(&f.dir, &sc); }
        let enabled = if f.rel.split('/').next().is_some_and(|p| p.eq_ignore_ascii_case(IMM_STORE)) {
            fs::canonicalize(&f.dir).is_ok_and(|c| w.links.contains(&c))
        } else { !rel_disabled(&f.rel) && !f.ini_off && crate::nrmm::shows(&f.rel, &f.dir, &slots) };
        let qf = ini::quick_facts(&f.dir);
        let mut e = build_entry(game, &root, &f.rel, enabled, &sc, &qf, &chars);
        if let Some(p) = prev.get(&e.id) { e.update_available = p.update_available; }
        hashes.push(qf.active);
        entries.push(e);
    }
    // live skins that aren't showing count as off (live.rs)
    let (live, ignored) = lock(db).map(|d| {
        crate::live::overlay(&d, game, &mut entries);
        (crate::live::groups_by_mod(&d, game), ini::ignored_pairs(&d, game))
    }).unwrap_or_default();
    compute_conflicts(&mut entries, &hashes, &live, &ignored);
    attach_thumbs(&thumbs, &mut entries, false);

    let d = lock(db)?;
    // the folder went away during the walk (a drive pulled out): keep the rows for when it comes back
    if !root.is_dir() { return Err(games::mods_gone(game, &root)); }
    let stamp = now();
    let tx = d.conn.unchecked_transaction()?;
    {
        let mut up = tx.prepare(
            "INSERT INTO mods (id, game, rel_path, data, scanned_at) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET game = excluded.game, rel_path = excluded.rel_path, data = excluded.data, scanned_at = excluded.scanned_at")?;
        for e in &entries { up.execute(params![e.id, game, e.rel_path, serde_json::to_string(e)?, stamp])?; }
    }
    tx.execute("DELETE FROM mods WHERE game = ?1 AND scanned_at <> ?2", params![game, stamp])?;
    tx.commit()?;

    let added: Vec<ModEntry> = entries.iter().filter(|e| !prev.contains_key(&e.id)).cloned().collect();
    if !added.is_empty() { let _ = profiles::on_change(&d, game, &ModChange { changed: added, ..Default::default() }); }
    if !launch::running(game) {
        if let Ok(cx) = ctx(&d, game) { flush_mod_vars(&d, &cx, None); }
        let _ = profiles::flush_pending(&d, game);
    }
    if crate::live::settle(&d, game) { return list(&d, game); }
    Ok(entries)
}

/// The mods from the last scan. Empty when the game was never scanned (the UI calls scan on first open).
pub fn list(db: &Db, game: &str) -> Result<Vec<ModEntry>> {
    let mut st = db.conn.prepare("SELECT data FROM mods WHERE game = ?1 ORDER BY rel_path")?;
    let rows = st.query_map([game], |r| r.get::<_, String>(0))?;
    let mut out = Vec::new();
    for r in rows { if let Ok(e) = serde_json::from_str::<ModEntry>(&r?) { out.push(e); } }
    Ok(out)
}

pub fn get(db: &Db, game: &str, id: &str) -> Result<ModEntry> {
    let data: Option<String> = db.conn.query_row("SELECT data FROM mods WHERE game = ?1 AND id = ?2", params![game, id], |r| r.get(0)).optional()?;
    let data = data.ok_or_else(|| Error::Invalid("That mod isn't in the library anymore. Rescan to refresh the list".into()))?;
    Ok(serde_json::from_str(&data)?)
}

fn save_row(db: &Db, e: &ModEntry) -> Result<()> {
    db.conn.execute(
        "INSERT INTO mods (id, game, rel_path, data, scanned_at) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET game = excluded.game, rel_path = excluded.rel_path, data = excluded.data, scanned_at = excluded.scanned_at",
        params![e.id, e.game, e.rel_path, serde_json::to_string(e)?, now()],
    )?;
    Ok(())
}

/// What every change needs to know about the game.
struct Ctx { game: String, root: PathBuf, importer: Option<PathBuf>, running: bool }

fn ctx(db: &Db, game: &str) -> Result<Ctx> {
    Ok(Ctx { game: game.into(), root: games::mods_dir(db, game)?, importer: games::importer_dir(db, game).ok(), running: launch::running(game) })
}

// ── saved options ──

fn kept_vars(db: &Db, game: &str, id: &str) -> Result<Vec<VarValue>> {
    let mut st = db.conn.prepare("SELECT ini, var, value FROM mod_vars WHERE game = ?1 AND mod_id = ?2 ORDER BY ini, var")?;
    let v = st.query_map(params![game, id], |r| Ok(VarValue { ini: r.get(0)?, var: r.get(1)?, value: r.get(2)? }))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(v)
}

fn keep_vars(db: &Db, game: &str, id: &str, values: &[VarValue], replace: bool) -> Result<()> {
    let tx = db.conn.unchecked_transaction()?;
    if replace { tx.execute("DELETE FROM mod_vars WHERE game = ?1 AND mod_id = ?2", params![game, id])?; }
    for v in values {
        tx.execute("INSERT OR REPLACE INTO mod_vars (game, mod_id, ini, var, value) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![game, id, v.ini, v.var, v.value])?;
    }
    tx.commit()?;
    Ok(())
}

/// Copy a mod's values out of d3dx_user.ini before it is turned off or removed. Values already kept stay unless
/// the file has newer ones.
fn stash_from_ini(db: &Db, cx: &Ctx, e: &ModEntry) {
    let Some(imp) = &cx.importer else { return };
    if let Ok(v) = ini::user_vars(imp, &e.rel_path) {
        if !v.is_empty() { let _ = keep_vars(db, &cx.game, &e.id, &v, false); }
    }
}

/// Write a turned-on mod's kept values into d3dx_user.ini. True when there was nothing to write or it worked.
fn write_kept(db: &Db, cx: &Ctx, e: &ModEntry) -> bool {
    let Ok(vals) = kept_vars(db, &cx.game, &e.id) else { return false };
    if vals.is_empty() { return true; }
    let Some(imp) = &cx.importer else { return false };
    match ini::set_user_vars(imp, &e.rel_path, &vals) {
        Ok(()) => { let _ = db.conn.execute("DELETE FROM mod_vars WHERE game = ?1 AND mod_id = ?2", params![cx.game, e.id]); true }
        Err(_) => false,
    }
}

/// Write waiting values for every mod that is on (or just `only`). Call only while the game is closed.
fn flush_mod_vars(db: &Db, cx: &Ctx, only: Option<&str>) {
    let ids: Vec<String> = match db.conn.prepare("SELECT DISTINCT mod_id FROM mod_vars WHERE game = ?1")
        .and_then(|mut st| st.query_map([&cx.game], |r| r.get::<_, String>(0))?.collect::<std::result::Result<Vec<_>, _>>()) {
        Ok(v) => v,
        Err(_) => return,
    };
    for id in ids {
        if only.is_some_and(|o| o != id) { continue; }
        if let Ok(e) = get(db, &cx.game, &id) { if e.loaded() { write_kept(db, cx, &e); } }
    }
}

/// A mod's saved option values wherever they are right now: from d3dx_user.ini when it is on, or from gachamod's own
/// store when it is off (3DMigoto drops a turned-off mod's values the next time it saves, so LIBRARY keeps them).
pub fn saved_vars(db: &Db, game: &str, id: &str) -> Result<Vec<VarValue>> {
    let e = get(db, game, id)?;
    let kept = kept_vars(db, game, id)?;
    if !e.loaded() { return Ok(kept); }
    let mut out = games::importer_dir(db, game).ok().and_then(|imp| ini::user_vars(&imp, &e.rel_path).ok()).unwrap_or_default();
    // values still waiting to be written win over what the file has
    for k in kept {
        match out.iter_mut().find(|v| v.ini.eq_ignore_ascii_case(&k.ini) && v.var.eq_ignore_ascii_case(&k.var)) {
            Some(v) => v.value = k.value,
            None => out.push(k),
        }
    }
    Ok(out)
}

/// Keep option values for a mod (an import of a turned-off mod). They are written to d3dx_user.ini when it is turned on.
pub fn stash_vars(db: &Db, game: &str, id: &str, values: &[VarValue]) -> Result<()> {
    let e = get(db, game, id)?;
    keep_vars(db, game, id, values, true)?;
    if e.loaded() && !launch::running(game) {
        if let Ok(cx) = ctx(db, game) { write_kept(db, &cx, &e); }
    }
    Ok(())
}

// ── turning mods on and off ──

/// Rows under the folder `from_rel` (the folder's own row too, when it is a mod) after that folder was renamed to
/// `to_rel`. Saved, and added to `out`.
fn move_rows(db: &Db, cx: &Ctx, from_rel: &str, to_rel: &str, out: &mut Vec<ModEntry>) -> Result<()> {
    let from_dir = cx.root.join(safe_rel(from_rel).unwrap_or_default());
    let to_dir = cx.root.join(safe_rel(to_rel).unwrap_or_default());
    let inside = format!("{from_rel}/");
    for mut r in list(db, &cx.game)? {
        let rest = if r.rel_path == from_rel { String::new() } else if let Some(x) = r.rel_path.strip_prefix(&inside) { x.to_string() } else { continue };
        r.rel_path = if rest.is_empty() { to_rel.to_string() } else { format!("{to_rel}/{rest}") };
        let dir = match safe_rel(&rest) { Some(x) => to_dir.join(x), None => to_dir.clone() };
        r.path = dir.to_string_lossy().into_owned();
        if let Some(p) = &r.preview {
            if let Ok(x) = Path::new(p).strip_prefix(&from_dir) { r.preview = Some(to_dir.join(x).to_string_lossy().into_owned()); }
        }
        r.folder = r.rel_path.rsplit('/').next().unwrap_or(&r.rel_path).to_string();
        r.group = group_of(&r.rel_path);
        save_row(db, &r)?;
        out.push(r);
    }
    Ok(())
}

/// Turning on a mod inside a folder named DISABLED... (the user or another manager turned off the whole folder): name
/// that folder back, each one above the mod. The other mods in it that were only off because of it get DISABLED on
/// their own folder first, so they stay off. Their rows follow the new paths and go to `out`; `e` is updated in place.
fn open_disabled_parents(db: &Db, cx: &Ctx, e: &mut ModEntry, out: &mut Vec<ModEntry>) -> Result<()> {
    loop {
        let parts: Vec<String> = e.rel_path.split('/').map(String::from).collect();
        let Some(i) = parts[..parts.len().saturating_sub(1)].iter().position(|p| is_disabled_name(p)) else { return Ok(()) };
        let folder_rel = parts[..=i].join("/");
        let inside = format!("{folder_rel}/");
        let own = format!("{}/", e.rel_path);

        // the outermost mod of each branch, so a sub-mod inside another mod isn't renamed twice
        let mut others: Vec<ModEntry> = list(db, &cx.game)?.into_iter()
            .filter(|r| r.id != e.id && r.rel_path.starts_with(&inside) && !r.rel_path.starts_with(&own)).collect();
        others.sort_by_key(|r| r.rel_path.len());
        let mut kept_off: Vec<String> = Vec::new();
        for r in others {
            if rel_disabled(&r.rel_path[inside.len()..]) || kept_off.iter().any(|k| r.rel_path.starts_with(&format!("{k}/"))) { continue; }
            let Some(rel) = safe_rel(&r.rel_path) else { continue };
            let dir = cx.root.join(rel);
            if !dir.is_dir() || only_off_inis(&dir) { continue; }
            let parent = dir.parent().map(Path::to_path_buf).unwrap_or_else(|| cx.root.clone());
            let base = match display_folder(&r.folder).trim() { "" => "Mod", b => b };
            let new = unique_child(&parent, &format!("{DISABLED_PREFIX}{base}"));
            rename_dir(&dir, &new)?;
            let new_rel = match group_of(&r.rel_path) { Some(g) => format!("{g}/{}", name_of(&new)), None => name_of(&new) };
            move_rows(db, cx, &r.rel_path, &new_rel, out)?;
            kept_off.push(r.rel_path);
        }

        let Some(rel) = safe_rel(&folder_rel) else { return Ok(()) };
        let old = cx.root.join(rel);
        let parent = old.parent().map(Path::to_path_buf).unwrap_or_else(|| cx.root.clone());
        let base = match display_folder(&parts[i]).trim() { "" => "Mods", b => b }.to_string();
        let new = unique_child(&parent, &base);
        rename_dir(&old, &new)?;
        let new_rel = if i == 0 { name_of(&new) } else { format!("{}/{}", parts[..i].join("/"), name_of(&new)) };
        let mut moved = Vec::new();
        move_rows(db, cx, &folder_rel, &new_rel, &mut moved)?;
        for m in moved {
            if m.id == e.id { *e = m; } else { out.push(m); }
        }
    }
}

/// Rename one mod's folder to turn it on or off and update its row. False when it already was. Other rows whose
/// folders moved on the way (a DISABLED folder above the mod named back) go to `moved`.
fn toggle_one(db: &Db, cx: &Ctx, e: &mut ModEntry, on: bool, notes: &mut Vec<String>, moved: &mut Vec<ModEntry>) -> Result<bool> {
    if e.loaded() == on { return Ok(false); }
    if is_imm_rel(&e.rel_path) { return Err(imm_error()); }
    let rel = safe_rel(&e.rel_path).ok_or_else(|| Error::Invalid(format!("{}'s folder path looks wrong. Rescan to refresh the list", e.name)))?;
    let old = cx.root.join(rel);
    if !old.is_dir() { return Err(Error::Invalid(format!("{}'s folder is gone. Rescan to refresh the list", e.name))); }
    if crate::nrmm::gated(&e.rel_path, &old) { return Err(crate::nrmm::managed_error()); }
    // a DISABLED folder above it named back: with its own folder and inis live, that alone turns it on
    let opened = on && disabled_parent(&e.rel_path).is_some();
    if opened { open_disabled_parents(db, cx, e, moved)?; }
    let old = cx.root.join(safe_rel(&e.rel_path).unwrap_or_default());
    if on {
        if !rel_disabled(&e.rel_path) {
            // another manager turned it off by renaming its inis ("DISABLED_mod.ini", "mod.ini.disabled"): name them back
            let mut renamed = 0;
            for f in root_files(&old).into_iter().filter(|f| is_off_ini(f)) {
                let Some(live) = live_ini_name(&f) else { continue };
                if old.join(&live).exists() { continue; }
                fs::rename(old.join(&f), old.join(&live))?;
                renamed += 1;
            }
            // Hestia's box: its files go back up into the mod's folder
            renamed += open_hestia_box(&old)?;
            if renamed == 0 && !opened { return Err(Error::Invalid(format!("{} has no ini that gachamod can turn on. Open its folder to check it", e.name))); }
            e.enabled = true;
            e.standby = false;
            save_row(db, e)?;
            if kept_vars(db, &cx.game, &e.id).is_ok_and(|v| !v.is_empty()) && !cx.running { write_kept(db, cx, e); }
            return Ok(true);
        }
    }
    let parent = old.parent().map(Path::to_path_buf).unwrap_or_else(|| cx.root.clone());
    let base = match display_folder(&e.folder).trim() { "" => "Mod", b => b }.to_string();
    let want = if on { base } else { format!("{DISABLED_PREFIX}{base}") };
    if !on { stash_from_ini(db, cx, e); }
    let new = unique_child(&parent, &want);
    rename_dir(&old, &new)?;

    let folder = name_of(&new);
    e.rel_path = match group_of(&e.rel_path) { Some(g) => format!("{g}/{folder}"), None => folder.clone() };
    e.path = new.to_string_lossy().into_owned();
    if let Some(p) = &e.preview {
        // a local preview moved with the folder
        if let Ok(r) = Path::new(p).strip_prefix(&old) { e.preview = Some(new.join(r).to_string_lossy().into_owned()); }
    }
    e.folder = folder;
    e.enabled = on;
    e.standby = false;
    if !on { e.conflicts = 0; }
    save_row(db, e)?;

    if on && kept_vars(db, &cx.game, &e.id).is_ok_and(|v| !v.is_empty()) {
        if cx.running { notes.push(format!("Options for {} come back after you close the game", e.name)); }
        else { write_kept(db, cx, e); }
    }
    Ok(true)
}

/// Move the files Hestia put in DISABLED_BY_HESTIA back up into the mod folder. How many moved.
fn open_hestia_box(dir: &Path) -> Result<u32> {
    let Some(b) = fs::read_dir(dir)?.flatten().find(|e| e.file_name().to_string_lossy().eq_ignore_ascii_case(HESTIA_OFF) && e.path().is_dir()) else { return Ok(0) };
    let b = b.path();
    let items: Vec<PathBuf> = fs::read_dir(&b)?.flatten().map(|e| e.path()).collect();
    // check every name first, so a clash moves nothing
    if let Some(taken) = items.iter().map(|p| dir.join(name_of(p))).find(|t| t.exists()) {
        return Err(Error::Conflict(format!("\"{}\" is in the mod's folder twice: once in {HESTIA_OFF} and once beside it. Remove one, then try again", name_of(&taken))));
    }
    for p in &items { rename_dir(p, &dir.join(name_of(p)))?; }
    let _ = fs::remove_dir(&b);
    Ok(items.len() as u32)
}

fn finish(db: &Db, game: &str, change: &ModChange) {
    if change.changed.is_empty() && change.removed.is_empty() { return; }
    devtools::mark_changed(game);
    let _ = profiles::on_change(db, game, change);
}

/// Turn mods on or off by renaming their folders. With the "one skin per character" setting on (default), turning a
/// mod on turns off the other enabled mods of the same character, and says so in `notes`. Live skins (live.rs) switch
/// in game instead: their folders stay on and the character's pick changes, with no reload.
pub fn set_enabled(db: &Db, game: &str, ids: &[String], on: bool) -> Result<ModChange> { set_enabled_with(db, game, ids, on, None) }

/// `set_enabled` where the user already answered whether the character's other mods stay on: `Some(false)` keeps
/// them on ("Keep both on"), `Some(true)` turns them off, `None` follows the "<game>.oneSkin" setting ("0" keeps
/// them; anything else turns them off, since the UI asks before it gets here when the setting says to).
///
/// Sub-mods go with their parent: turning a sub-mod on turns its parent on, turning a parent off turns its sub-mods
/// off, and turning it on again brings back the ones that were on.
pub fn set_enabled_with(db: &Db, game: &str, ids: &[String], on: bool, turn_off_others: Option<bool>) -> Result<ModChange> {
    let _hold = crate::watch::hold(game);
    let one_skin = on && match turn_off_others {
        Some(v) => v,
        None => db.setting(&format!("{game}.oneSkin"))?.map(|v| v != "0").unwrap_or(true),
    };
    // "keep the others on" for a live skin while its character shows another: it leaves in-game switching, since a
    // live character shows one skin at a time
    let (released, mut notes) = if on && turn_off_others == Some(false) { crate::live::release(db, game, ids)? } else { (Vec::new(), Vec::new()) };
    let rows = list(db, game)?;
    let (targets, flags, family) = with_family(&rows, ids, on);
    notes.extend(family);
    let mut change = route(db, game, &targets, one_skin)?;
    for id in &released {
        if !change.changed.iter().any(|e| &e.id == id) { if let Ok(e) = get(db, game, id) { change.changed.push(e); } }
    }
    for (id, flag) in flags { let _ = set_off_with_parent(db, game, &id, flag); }
    change.notes.splice(0..0, notes);
    // the mods it shared parts with gain or lose their Conflict tag too
    recount_into(db, game, &mut change);
    Ok(change)
}

/// The parts a mod changes: the hashes of its inis' sections that do something (`ini::quick_facts`).
fn parts_of(m: &ModEntry) -> HashSet<String> {
    ini::quick_facts(Path::new(&m.path)).active.iter()
        .map(|h| h.trim().trim_start_matches("0x").to_ascii_lowercase()).filter(|h| !h.is_empty()).collect()
}

/// Two mods change the same parts of the game (a hash both override), so having both on is a real overlap. A mod
/// whose parts can't be read counts as overlapping, as it did when only the character was compared.
pub(crate) fn share_parts(a: &ModEntry, b: &ModEntry) -> bool {
    let (pa, pb) = (parts_of(a), parts_of(b));
    pa.is_empty() || pb.is_empty() || !pa.is_disjoint(&pb)
}

/// Of `others`, the mods that change the same parts as any of `ids` (the UI asks before turning a mod on only about
/// these).
pub fn overlapping(db: &Db, game: &str, ids: &[String], others: &[String]) -> Result<Vec<String>> {
    let going: Vec<ModEntry> = ids.iter().filter_map(|i| get(db, game, i).ok()).collect();
    Ok(others.iter().filter(|o| get(db, game, o).is_ok_and(|o| going.iter().any(|g| share_parts(g, &o)))).cloned().collect())
}

/// The mods a switch reaches through sub-mod links, the `off_with_parent` marks to write afterwards, and notes.
fn with_family(rows: &[ModEntry], ids: &[String], on: bool) -> (Vec<(String, bool)>, Vec<(String, bool)>, Vec<String>) {
    let by_id: HashMap<&str, &ModEntry> = rows.iter().map(|m| (m.id.as_str(), m)).collect();
    let mut targets: Vec<(String, bool)> = ids.iter().map(|i| (i.clone(), on)).collect();
    let mut flags: Vec<(String, bool)> = Vec::new();
    let mut notes = Vec::new();
    let has = |t: &[(String, bool)], id: &str| t.iter().any(|(i, _)| i == id);
    // a switched sub-mod is the user's own choice now
    for id in ids {
        if by_id.get(id.as_str()).is_some_and(|m| m.parent.is_some()) { flags.push((id.clone(), false)); }
    }
    if on {
        let mut parents: Vec<String> = Vec::new();
        for id in ids {
            let Some(m) = by_id.get(id.as_str()) else { continue };
            let Some(p) = m.parent.as_deref().and_then(|p| by_id.get(p)) else { continue };
            if p.loaded() || has(&targets, &p.id) || parents.contains(&p.id) { continue; }
            notes.push(format!("Turned on {} too, since {} is its sub-mod", p.name, m.name));
            parents.push(p.id.clone());
        }
        targets.extend(parents.into_iter().map(|p| (p, true)));
        let turning: Vec<String> = targets.iter().map(|(i, _)| i.clone()).collect();
        for m in rows {
            let Some(p) = m.parent.as_deref() else { continue };
            if !turning.iter().any(|t| t == p) || has(&targets, &m.id) || m.loaded() || !off_with_parent(m) { continue; }
            notes.push(format!("Turned its sub-mod {} back on", m.name));
            targets.push((m.id.clone(), true));
            flags.push((m.id.clone(), false));
        }
    } else {
        for m in rows {
            let Some(p) = m.parent.as_deref() else { continue };
            if !ids.iter().any(|i| i == p) || has(&targets, &m.id) || !m.loaded() { continue; }
            notes.push(format!("Turned off its sub-mod {} too", m.name));
            targets.push((m.id.clone(), false));
            flags.push((m.id.clone(), true));
        }
    }
    (targets, flags, notes)
}

fn off_with_parent(m: &ModEntry) -> bool { read_sidecar(Path::new(&m.path)).is_some_and(|s| s.off_with_parent) }

fn set_off_with_parent(db: &Db, game: &str, id: &str, flag: bool) -> Result<()> {
    let dir = PathBuf::from(get(db, game, id)?.path);
    let Some(mut sc) = read_sidecar(&dir) else { return Ok(()) };
    if sc.off_with_parent == flag { return Ok(()); }
    sc.off_with_parent = flag;
    write_sidecar(&dir, &sc)
}

/// Set each mod to a state, without the one-skin rule (profile switches). Live skins switch in game.
pub(crate) fn apply_states(db: &Db, game: &str, targets: &[(String, bool)]) -> Result<ModChange> { route(db, game, targets, false) }

/// Rename folders only, live skins included (live.rs turns a live skin's folder on or off with this).
pub(crate) fn apply_folders(db: &Db, game: &str, targets: &[(String, bool)]) -> Result<ModChange> { apply(db, game, targets, false) }

/// Save a row as it is (live.rs marks skins as showing or on standby).
pub(crate) fn put_row(db: &Db, e: &ModEntry) -> Result<()> { save_row(db, e) }

/// Live skins go to live.rs, the rest are renamed.
fn route(db: &Db, game: &str, targets: &[(String, bool)], one_skin: bool) -> Result<ModChange> {
    let live = crate::live::groups_by_mod(db, game);
    let (picks, rest): (Vec<(String, bool)>, Vec<(String, bool)>) = targets.iter().cloned().partition(|(i, _)| live.contains_key(i));
    if picks.is_empty() { return apply(db, game, &rest, one_skin); }
    let mut change = if rest.is_empty() { ModChange::default() } else { apply(db, game, &rest, one_skin)? };
    let sw = crate::live::switch(db, game, &picks)?;
    if one_skin {
        // a live skin that shows now turns off the character's other skins that aren't live
        let shown: Vec<String> = sw.changed.iter().filter(|e| e.enabled).filter_map(|e| e.character.clone()).collect();
        let listed: HashSet<&str> = targets.iter().map(|(i, _)| i.as_str()).collect();
        let shown_rows: Vec<&ModEntry> = sw.changed.iter().filter(|e| e.enabled).collect();
        let offs: Vec<(String, bool)> = list(db, game)?.into_iter()
            .filter(|o| o.loaded() && !live.contains_key(&o.id) && !listed.contains(o.id.as_str())
                && o.character.as_deref().is_some_and(|oc| shown.iter().any(|c| c.eq_ignore_ascii_case(oc)))
                && shown_rows.iter().any(|s| s.character.as_deref().is_some_and(|c| o.character.as_deref().is_some_and(|oc| oc.eq_ignore_ascii_case(c))) && share_parts(s, o)))
            .map(|o| (o.id, false)).collect();
        if !offs.is_empty() {
            // the swap the player asked for: no note, the cards show it
            let off = apply(db, game, &offs, false)?;
            change.notes.extend(off.notes);
            change.changed.extend(off.changed);
        }
    }
    let _ = profiles::on_change(db, game, &sw);
    change.changed.extend(sw.changed);
    change.notes.extend(sw.notes);
    Ok(change)
}

fn apply(db: &Db, game: &str, targets: &[(String, bool)], one_skin: bool) -> Result<ModChange> {
    let cx = ctx(db, game)?;
    let mut rows: HashMap<String, ModEntry> = list(db, game)?.into_iter().map(|m| (m.id.clone(), m)).collect();
    let mut change = ModChange::default();
    let mut errors: Vec<(String, Error)> = Vec::new();
    let listed: HashSet<&str> = targets.iter().map(|(i, _)| i.as_str()).collect();
    if targets.iter().all(|(i, _)| !rows.contains_key(i)) && !targets.is_empty() {
        return Err(Error::Invalid("Those mods aren't in the library anymore. Rescan to refresh the list".into()));
    }

    // every mod asked for goes on, several of one character included: the rule only turns off the ones not asked for
    let mut seen: HashSet<&str> = HashSet::new();
    let mut turned_on: Vec<String> = Vec::new();
    let mut moved: Vec<ModEntry> = Vec::new();
    for (id, on) in targets {
        if !seen.insert(id.as_str()) { continue; }
        let Some(e) = rows.get_mut(id) else { continue };
        if *on { turned_on.push(id.clone()); }
        match toggle_one(db, &cx, e, *on, &mut change.notes, &mut moved) {
            Ok(true) => change.changed.push(e.clone()),
            Ok(false) => {}
            Err(err) => errors.push((e.name.clone(), err)),
        }
        // rows another mod's change moved (a DISABLED folder named back): later targets read their new paths
        for m in moved.drain(..) {
            rows.insert(m.id.clone(), m.clone());
            match change.changed.iter_mut().find(|c| c.id == m.id) { Some(c) => *c = m, None => change.changed.push(m) }
        }
    }

    if one_skin {
        // live skins aren't renamed here (route sends them to live.rs)
        let live = crate::live::groups_by_mod(db, game);
        for id in &turned_on {
            if live.contains_key(id) { continue; }
            let Some(c) = rows.get(id).filter(|e| e.enabled).and_then(|e| e.character.clone()) else { continue };
            let root = rows.get(id).map(|e| e.root().to_string()).unwrap_or_default();
            let Some(turned) = rows.get(id).cloned() else { continue };
            change.changed.extend(crate::live::hide_group(db, game, &c, &turned));
            // only mods that change the same parts go off: a hair recolour stays on next to an outfit
            let others: Vec<String> = rows.values()
                .filter(|o| o.enabled && o.id != *id && o.root() != root && !listed.contains(o.id.as_str()) && !live.contains_key(&o.id) && o.character.as_deref().is_some_and(|oc| oc.eq_ignore_ascii_case(&c)))
                .filter(|o| share_parts(&turned, o))
                .map(|o| o.id.clone()).collect();
            for oid in others {
                let Some(o) = rows.get_mut(&oid) else { continue };
                match toggle_one(db, &cx, o, false, &mut change.notes, &mut moved) {
                    Ok(true) => change.changed.push(o.clone()),
                    Ok(false) => {}
                    Err(err) => errors.push((o.name.clone(), err)),
                }
            }
        }
    }

    if change.changed.is_empty() {
        if let Some((_, err)) = errors.into_iter().next() { return Err(err); }
    } else {
        for (name, err) in errors { change.notes.push(format!("Couldn't change {name}: {err}")); }
    }
    recount_into(db, game, &mut change);
    finish(db, game, &change);
    if !cx.running { flush_mod_vars(db, &cx, None); }
    Ok(change)
}

// ── details ──

pub fn update_meta(db: &Db, game: &str, id: &str, patch: &MetaPatch) -> Result<ModEntry> {
    let mut e = get(db, game, id)?;
    let dir = PathBuf::from(&e.path);
    let mut sc = read_sidecar(&dir).unwrap_or_else(|| Sidecar {
        format: 1, id: e.id.clone(), name: e.name.clone(), character: e.character.clone(), source: e.source.clone(), version: e.version.clone(),
        installed_at: e.installed_at, tags: e.tags.clone(), notes: e.notes.clone(), favorite: e.favorite, nsfw: e.nsfw, ..Default::default()
    });
    sc.id = e.id.clone();
    let text = |s: &str| { let t = s.trim(); (!t.is_empty()).then(|| t.to_string()) };
    if let Some(n) = &patch.name { sc.name = text(n).unwrap_or_else(|| display_folder(&e.folder).to_string()); }
    if let Some(c) = &patch.character { sc.character = text(c); }
    if let Some(t) = &patch.tags {
        let mut tags: Vec<String> = Vec::new();
        for t in t.iter().filter_map(|t| text(t)) { if !tags.iter().any(|x| x.eq_ignore_ascii_case(&t)) { tags.push(t); } }
        sc.tags = tags;
    }
    if let Some(n) = &patch.notes { sc.notes = text(n); }
    if let Some(f) = patch.favorite { sc.favorite = f; }
    if let Some(n) = patch.nsfw { sc.nsfw = n; }
    if let Some(v) = &patch.version { sc.version = text(v); }
    if let Some(p) = &patch.parent {
        sc.parent = match text(p) {
            None => None,
            Some(p) => Some(parent_for(db, game, &e, &p)?),
        };
        sc.off_with_parent = false;
    }
    if dir.is_dir() { write_sidecar(&dir, &sc)?; }
    e.name = sc.name.clone();
    e.character = sc.character.clone();
    e.tags = sc.tags.clone();
    e.notes = sc.notes.clone();
    e.favorite = sc.favorite;
    e.nsfw = sc.nsfw;
    e.version = sc.version.clone();
    e.parent = sc.parent.clone();
    save_row(db, &e)?;
    Ok(e)
}

/// The id a mod can be a sub-mod of when the user picks `pick`: a sub-mod's own parent stands in for it, so sub-mods
/// are never more than one level deep.
fn parent_for(db: &Db, game: &str, e: &ModEntry, pick: &str) -> Result<String> {
    let p = get(db, game, pick).map_err(|_| Error::Invalid("That mod isn't in the library anymore".into()))?;
    let root = p.root().to_string();
    if root == e.id { return Err(Error::Invalid(format!("{} is already a sub-mod of {}", p.name, e.name))); }
    if list(db, game)?.iter().any(|o| o.parent.as_deref() == Some(e.id.as_str())) {
        return Err(Error::Invalid(format!("{} already has sub-mods, so it can't be a sub-mod", e.name)));
    }
    Ok(root)
}

// ── the user's own preview ──

const PREVIEW_EXTS: &[&str] = &["png", "jpg", "jpeg", "webp", "gif"];
/// Previews bigger than this are refused (a pasted screenshot is a few MB).
const PREVIEW_MAX: usize = 25 * 1024 * 1024;

/// The image type of a file name or a bare extension ("PNG", "photo.jpeg"), lowercased, when gachamod shows it.
pub fn preview_ext(name_or_ext: &str) -> Option<String> {
    let l = name_or_ext.trim().to_ascii_lowercase();
    let ext = l.rsplit_once('.').map(|(_, e)| e).unwrap_or(&l);
    PREVIEW_EXTS.contains(&ext).then(|| ext.to_string())
}

/// The mod's sidecar, or one built from its row when the folder has none yet.
fn sidecar_of_entry(dir: &Path, e: &ModEntry) -> Sidecar {
    let mut sc = read_sidecar(dir).unwrap_or_else(|| Sidecar {
        format: 1, id: e.id.clone(), name: e.name.clone(), character: e.character.clone(), source: e.source.clone(), version: e.version.clone(),
        installed_at: e.installed_at, tags: e.tags.clone(), notes: e.notes.clone(), favorite: e.favorite, nsfw: e.nsfw, ..Default::default()
    });
    sc.id = e.id.clone();
    sc
}

fn root_files(dir: &Path) -> Vec<String> {
    fs::read_dir(dir).map(|rd| rd.flatten().filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .map(|e| e.file_name().to_string_lossy().into_owned()).collect()).unwrap_or_default()
}

/// Write the sidecar and refresh the row's preview after a preview change.
fn save_preview(db: &Db, game: &str, mut e: ModEntry, dir: &Path, sc: &Sidecar) -> Result<ModEntry> {
    write_sidecar(dir, sc)?;
    e.preview = pick_preview(dir, &root_files(dir), sc);
    e.custom_preview = custom_preview_path(dir, sc).is_some();
    attach_thumbs(&thumbs_dir(db), std::slice::from_mut(&mut e), true);
    save_row(db, &e)?;
    finish(db, game, &ModChange { changed: vec![e.clone()], ..Default::default() });
    Ok(e)
}

/// Make `bytes` (an image of type `ext`) the mod's preview: copied in as `preview.<ext>`, which wins over every
/// other image. Preview files already there are kept, renamed to `preview-original.<ext>` (clear_preview puts them
/// back). Setting another custom preview replaces the last one gachamod copied in.
pub fn set_preview(db: &Db, game: &str, id: &str, bytes: &[u8], ext: &str) -> Result<ModEntry> {
    let ext = preview_ext(ext).ok_or_else(|| Error::Invalid("Use a PNG, JPG, WebP or GIF image".into()))?;
    if bytes.is_empty() { return Err(Error::Invalid("That image is empty".into())); }
    if bytes.len() > PREVIEW_MAX { return Err(Error::Invalid("That image is over 25 MB. Pick a smaller one".into())); }
    let e = get(db, game, id)?;
    let dir = PathBuf::from(&e.path);
    if !dir.is_dir() { return Err(Error::Invalid("That mod's folder isn't there anymore. Rescan to refresh the list".into())); }
    let mut sc = sidecar_of_entry(&dir, &e);
    // the last custom preview is gachamod's own copy: replace it
    if let Some(old) = custom_preview_path(&dir, &sc) { fs::remove_file(old)?; }
    sc.custom_preview = None;
    // keep every other preview.* file under a new name so the new one wins
    let mut found: Vec<String> = root_files(&dir).into_iter().filter(|f| is_image(f) && f.to_ascii_lowercase().starts_with("preview.")).collect();
    found.sort();
    for f in found {
        let fext = preview_ext(&f).unwrap_or_else(|| "png".into());
        let mut to = dir.join(format!("preview-original.{fext}"));
        let mut n = 2;
        while to.exists() { to = dir.join(format!("preview-original ({n}).{fext}")); n += 1; }
        fs::rename(dir.join(&f), &to)?;
        sc.preview_backups.push(name_of(&to));
    }
    let name = format!("preview.{ext}");
    fs::write(dir.join(&name), bytes)?;
    sc.custom_preview = Some(name);
    save_preview(db, game, e, &dir, &sc)
}

/// set_preview from an image file anywhere on disk (the file is copied, never moved).
pub fn set_preview_file(db: &Db, game: &str, id: &str, src: &Path) -> Result<ModEntry> {
    let ext = preview_ext(&name_of(src)).ok_or_else(|| Error::Invalid("Use a PNG, JPG, WebP or GIF image".into()))?;
    let len = fs::metadata(src)?.len();
    if len as usize > PREVIEW_MAX { return Err(Error::Invalid("That image is over 25 MB. Pick a smaller one".into())); }
    let bytes = fs::read(src)?;
    set_preview(db, game, id, &bytes, &ext)
}

/// Save a downloaded picture (GameBanana's first image, previews::download) as the mod's `preview.<ext>`. It is not a
/// custom preview: preview files already there are kept as `preview-original.<ext>`, and when the user picked their
/// own preview it stays in front and this one waits as `preview-gamebanana.<ext>`.
pub fn save_fetched_preview(db: &Db, game: &str, id: &str, bytes: &[u8], ext: &str) -> Result<ModEntry> {
    let ext = preview_ext(ext).ok_or_else(|| Error::Invalid("That isn't a PNG, JPG, WebP or GIF picture".into()))?;
    if bytes.is_empty() { return Err(Error::Invalid("That picture is empty".into())); }
    if bytes.len() > PREVIEW_MAX { return Err(Error::Invalid("That picture is over 25 MB".into())); }
    let e = get(db, game, id)?;
    let dir = PathBuf::from(&e.path);
    if !dir.is_dir() { return Err(Error::Invalid("That mod's folder isn't there anymore. Rescan to refresh the list".into())); }
    let mut sc = sidecar_of_entry(&dir, &e);
    // gachamod's own earlier download goes
    if let Some(old) = sc.preview.as_deref().filter(|p| p.to_ascii_lowercase().starts_with("preview-gamebanana.")).and_then(safe_rel) {
        let _ = fs::remove_file(dir.join(old));
    }
    let name = if custom_preview_path(&dir, &sc).is_some() {
        format!("preview-gamebanana.{ext}")
    } else {
        let mut found: Vec<String> = root_files(&dir).into_iter().filter(|f| previews::is_preview_name(f)).collect();
        found.sort();
        for f in found {
            let fext = preview_ext(&f).unwrap_or_else(|| "png".into());
            let mut to = dir.join(format!("preview-original.{fext}"));
            let mut n = 2;
            while to.exists() { to = dir.join(format!("preview-original ({n}).{fext}")); n += 1; }
            fs::rename(dir.join(&f), &to)?;
        }
        format!("preview.{ext}")
    };
    fs::write(dir.join(&name), bytes)?;
    sc.preview = Some(name);
    save_preview(db, game, e, &dir, &sc)
}

/// The user's own preview picture, read before it's replaced or reset so Undo can put it back. None when the mod
/// has none.
pub fn custom_preview_bytes(db: &Db, game: &str, id: &str) -> Result<Option<Vec<u8>>> {
    let e = get(db, game, id)?;
    let dir = PathBuf::from(&e.path);
    let sc = sidecar_of_entry(&dir, &e);
    Ok(match custom_preview_path(&dir, &sc) { Some(p) => Some(fs::read(p)?), None => None })
}

/// Remove the user's own preview and put back the preview files set_preview renamed.
pub fn clear_preview(db: &Db, game: &str, id: &str) -> Result<ModEntry> {
    let e = get(db, game, id)?;
    let dir = PathBuf::from(&e.path);
    let mut sc = sidecar_of_entry(&dir, &e);
    if let Some(p) = custom_preview_path(&dir, &sc) { fs::remove_file(p)?; }
    sc.custom_preview = None;
    for b in std::mem::take(&mut sc.preview_backups) {
        let Some(rel) = safe_rel(&b) else { continue };
        let from = dir.join(rel);
        if !from.is_file() { continue; }
        let to = dir.join(format!("preview.{}", preview_ext(&b).unwrap_or_else(|| "png".into())));
        // another preview arrived meanwhile (an update): leave the old one under its kept name
        if to.exists() { continue; }
        fs::rename(&from, &to)?;
    }
    save_preview(db, game, e, &dir, &sc)
}

/// A group path from the UI cleaned for Windows: parts trimmed, characters Windows forbids dropped, no "..".
fn clean_group(g: &str) -> Option<String> {
    let parts: Vec<String> = g.split(['/', '\\']).map(|p| {
        let s: String = p.chars().filter(|c| !matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*') && !c.is_control()).collect();
        s.trim().trim_end_matches(['.', ' ']).to_string()
    }).filter(|p| !p.is_empty() && p != "." && p != "..").collect();
    (!parts.is_empty()).then(|| parts.join("/"))
}

/// Move a mod into a group folder under Mods (a character's folder), or to the top level with `None`.
pub fn move_to_group(db: &Db, game: &str, id: &str, group: Option<&str>) -> Result<ModEntry> {
    let _hold = crate::watch::hold(game);
    let cx = ctx(db, game)?;
    let mut e = get(db, game, id)?;
    if is_imm_rel(&e.rel_path) { return Err(imm_error()); }
    let group = group.and_then(clean_group);
    if group.as_deref().is_some_and(is_imm_rel) { return Err(imm_error()); }
    if group.as_deref().map(str::to_lowercase) == e.group.as_deref().map(str::to_lowercase) { return Ok(e); }
    let old = cx.root.join(safe_rel(&e.rel_path).ok_or_else(|| Error::Invalid("That mod's folder path looks wrong. Rescan to refresh the list".into()))?);
    if !old.is_dir() { return Err(Error::Invalid(format!("{}'s folder is gone. Rescan to refresh the list", e.name))); }
    let parent = match &group { Some(g) => cx.root.join(safe_rel(g).unwrap_or_default()), None => cx.root.clone() };
    fs::create_dir_all(&parent)?;
    let new = unique_child(&parent, &e.folder);
    let was_on = e.loaded();
    if was_on && cx.running { stash_from_ini(db, &cx, &e); }
    rename_dir(&old, &new)?;

    let old_rel = e.rel_path.clone();
    let folder = name_of(&new);
    e.rel_path = match &group { Some(g) => format!("{g}/{folder}"), None => folder.clone() };
    if was_on && !cx.running {
        if let Some(imp) = &cx.importer { let _ = ini::move_user_vars(imp, &old_rel, &e.rel_path); }
    }
    // an empty group folder left behind goes too
    if let Some(op) = old.parent() {
        if op != cx.root && fs::read_dir(op).is_ok_and(|mut r| r.next().is_none()) { let _ = fs::remove_dir(op); }
    }
    if let Some(p) = &e.preview {
        if let Ok(r) = Path::new(p).strip_prefix(&old) { e.preview = Some(new.join(r).to_string_lossy().into_owned()); }
    }
    e.path = new.to_string_lossy().into_owned();
    e.folder = folder;
    e.group = group;
    let on = !rel_disabled(&e.rel_path) && !only_off_inis(&new);
    (e.enabled, e.standby) = (on && !e.standby, on && e.standby);
    if !was_on && e.loaded() && !cx.running { write_kept(db, &cx, &e); }
    if was_on && !e.loaded() { stash_from_ini(db, &cx, &e); }
    save_row(db, &e)?;
    finish(db, game, &ModChange { changed: vec![e.clone()], ..Default::default() });
    Ok(e)
}

/// Register a folder that another area just placed under the Mods folder (an install, an import). Writes or keeps
/// its sidecar (`sidecar` wins over one already in the folder, except for the id when `sidecar.id` is empty), adds
/// it to the `mods` table and returns it.
pub fn add_folder(db: &Db, game: &str, dir: &Path, sidecar: Option<Sidecar>) -> Result<ModEntry> {
    let cx = ctx(db, game)?;
    if !dir.is_dir() { return Err(Error::Invalid("That mod folder isn't there".into())); }
    let rel = rel_of(&cx.root, dir).ok_or_else(|| Error::Invalid("That folder isn't inside the game's Mods folder".into()))?;
    let chars = matcher(db, game)?;
    let existing = read_sidecar(dir);
    let folder = name_of(dir);
    let mut sc = match (sidecar, existing.clone()) {
        (Some(mut s), ex) => {
            if !valid_id(&s.id) { s.id = ex.map(|e| e.id).filter(|i| valid_id(i)).unwrap_or_else(new_id); }
            s
        }
        (None, Some(ex)) => ex,
        (None, None) => Sidecar { format: 1, name: display_folder(&folder).to_string(), installed_at: folder_time(dir), ..Default::default() },
    };
    if !valid_id(&sc.id) { sc.id = new_id(); }
    if sc.name.trim().is_empty() { sc.name = display_folder(&folder).to_string(); }
    if sc.installed_at == 0 { sc.installed_at = now(); }
    if sc.character.as_deref().is_none_or(|c| c.trim().is_empty()) {
        let name = sc.name.clone();
        sc.character = chars.best(&hints_for(&rel, &name));
    }
    // the id belongs to another folder that is still there (a copy): this one gets a new id
    if let Ok(other) = get(db, game, &sc.id) {
        if other.rel_path != rel && safe_rel(&other.rel_path).is_some_and(|r| cx.root.join(r).is_dir()) { sc.id = new_id(); }
    } else if db.conn.query_row("SELECT 1 FROM mods WHERE id = ?1 AND game <> ?2", params![sc.id, game], |_| Ok(())).optional()?.is_some() {
        sc.id = new_id();
    }
    if existing.as_ref() != Some(&sc) { write_sidecar(dir, &sc)?; }
    let qf = ini::quick_facts(dir);
    let mut e = build_entry(game, &cx.root, &rel, !rel_disabled(&rel) && !only_off_inis(dir), &sc, &qf, &chars);
    crate::live::overlay(db, game, std::slice::from_mut(&mut e));
    attach_thumbs(&thumbs_dir(db), std::slice::from_mut(&mut e), true);
    save_row(db, &e)?;
    if e.loaded() && !cx.running { flush_mod_vars(db, &cx, Some(&e.id)); }
    let mut change = ModChange { changed: vec![e], ..Default::default() };
    recount_into(db, game, &mut change);
    finish(db, game, &change);
    Ok(change.changed.remove(0))
}

// ── trash ──

/// Move mods to the app's trash folder (`<data>/trash/<game>/<trash id>`), kept "trash.days" days (removed.rs).
pub fn remove(db: &Db, data_dir: &Path, game: &str, ids: &[String], reason: &str) -> Result<ModChange> {
    let _hold = crate::watch::hold(game);
    let cx = ctx(db, game)?;
    let mut change = ModChange::default();
    let mut errors: Vec<Error> = Vec::new();
    for id in ids {
        let e = match get(db, game, id) { Ok(e) => e, Err(err) => { errors.push(err); continue; } };
        if is_imm_rel(&e.rel_path) { errors.push(imm_error()); continue; }
        let Some(rel) = safe_rel(&e.rel_path) else { continue };
        let old = cx.root.join(rel);
        if !old.is_dir() {
            // already gone from disk: just forget it
            db.conn.execute("DELETE FROM mods WHERE id = ?1", [id])?;
            change.removed.push(id.clone());
            continue;
        }
        if e.loaded() { stash_from_ini(db, &cx, &e); }
        db.conn.execute(
            "INSERT INTO trash (game, mod_id, name, kept_path, original_rel, size, reason, removed_at, data) VALUES (?1, ?2, ?3, '', ?4, ?5, ?6, ?7, ?8)",
            params![game, e.id, e.name, e.rel_path, e.size_bytes as i64, reason, now(), serde_json::to_string(&e)?],
        )?;
        let tid = db.conn.last_insert_rowid();
        let kept = data_dir.join("trash").join(game).join(tid.to_string()).join(&e.folder);
        let moved = kept.parent().map_or(Ok(()), fs::create_dir_all).map_err(Error::from).and_then(|_| rename_dir(&old, &kept));
        if let Err(err) = moved {
            db.conn.execute("DELETE FROM trash WHERE id = ?1", [tid])?;
            if let Some(p) = kept.parent() { let _ = fs::remove_dir(p); }
            errors.push(err);
            continue;
        }
        db.conn.execute("UPDATE trash SET kept_path = ?1 WHERE id = ?2", params![kept.to_string_lossy(), tid])?;
        db.conn.execute("DELETE FROM mods WHERE id = ?1", [id])?;
        change.removed.push(id.clone());
    }
    if change.removed.is_empty() {
        if let Some(err) = errors.into_iter().next() { return Err(err); }
    } else {
        for err in errors { change.notes.push(format!("Couldn't remove one: {err}")); }
    }
    recount_into(db, game, &mut change);
    finish(db, game, &change);
    // "trash.days" at 0: the files go now and only the details stay
    if trash_days(db) == 0 { let _ = purge_expired(db); }
    Ok(change)
}

pub fn trash_list(db: &Db, game: &str) -> Result<Vec<TrashEntry>> {
    let mut st = db.conn.prepare(
        "SELECT id, game, mod_id, name, original_rel, size, reason, removed_at FROM trash WHERE game = ?1 AND kept_path <> '' ORDER BY removed_at DESC, id DESC")?;
    let v = st.query_map([game], |r| Ok(TrashEntry {
        id: r.get(0)?, game: r.get(1)?, mod_id: r.get(2)?, name: r.get(3)?, original_rel: r.get(4)?,
        size: r.get::<_, i64>(5)?.max(0) as u64, reason: r.get(6)?, removed_at: r.get(7)?,
    }))?.collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(v)
}

pub fn trash_restore(db: &Db, trash_id: i64) -> Result<ModChange> {
    let (game, mod_id, kept, original_rel, data): (String, String, String, String, Option<String>) = db.conn.query_row(
        "SELECT game, mod_id, kept_path, original_rel, data FROM trash WHERE id = ?1", [trash_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))?;
    let kept = PathBuf::from(kept);
    if !kept.is_dir() {
        db.conn.execute("DELETE FROM trash WHERE id = ?1", [trash_id])?;
        return Err(Error::Invalid("That mod's files aren't in the trash anymore".into()));
    }
    let cx = ctx(db, &game)?;
    let rel = safe_rel(&original_rel).unwrap_or_else(|| PathBuf::from(name_of(&kept)));
    let want = cx.root.join(&rel);
    let parent = want.parent().map(Path::to_path_buf).unwrap_or_else(|| cx.root.clone());
    fs::create_dir_all(&parent)?;
    let target = unique_child(&parent, &name_of(&want));
    rename_dir(&kept, &target)?;
    if let Some(p) = kept.parent() { let _ = fs::remove_dir(p); }

    let prev: Option<ModEntry> = data.and_then(|d| serde_json::from_str(&d).ok());
    let rel = rel_of(&cx.root, &target).unwrap_or_else(|| name_of(&target));
    let mut sc = read_sidecar(&target).unwrap_or_else(|| {
        let p = prev.clone().unwrap_or_default();
        Sidecar { format: 1, id: mod_id.clone(), name: p.name, character: p.character, source: p.source, version: p.version, installed_at: p.installed_at,
            tags: p.tags, notes: p.notes, favorite: p.favorite, nsfw: p.nsfw, ..Default::default() }
    });
    let mut write = false;
    if !valid_id(&sc.id) { sc.id = mod_id.clone(); write = true; }
    // a newer copy took the id meanwhile (an update replaced it): this one comes back as its own mod
    if db.conn.query_row("SELECT 1 FROM mods WHERE id = ?1", [&sc.id], |_| Ok(())).optional()?.is_some() { sc.id = new_id(); write = true; }
    if write { write_sidecar(&target, &sc)?; }
    let chars = matcher(db, &game)?;
    let qf = ini::quick_facts(&target);
    let mut e = build_entry(&game, &cx.root, &rel, !rel_disabled(&rel) && !only_off_inis(&target), &sc, &qf, &chars);
    e.update_available = prev.is_some_and(|p| p.update_available);
    crate::live::restored(db, &game, &mut e);
    attach_thumbs(&thumbs_dir(db), std::slice::from_mut(&mut e), true);
    save_row(db, &e)?;
    db.conn.execute("DELETE FROM trash WHERE id = ?1", [trash_id])?;
    if e.loaded() && !cx.running { flush_mod_vars(db, &cx, Some(&e.id)); }
    let mut change = ModChange { changed: vec![e], ..Default::default() };
    recount_into(db, &game, &mut change);
    finish(db, &game, &change);
    Ok(change)
}

// ── characters ──

/// The game's characters with mod counts.
pub fn characters(db: &Db, game: &str) -> Result<Vec<Character>> {
    let mut out: Vec<Character> = {
        let mut st = db.conn.prepare("SELECT name, gb_category_id, icon FROM characters WHERE game = ?1 ORDER BY sort, name")?;
        let v = st.query_map([game], |r| Ok(Character {
            name: r.get(0)?, gb_category_id: r.get::<_, Option<i64>>(1)?.map(|v| v.max(0) as u64), icon: r.get(2)?, mod_count: 0, enabled_count: 0,
        }))?.collect::<std::result::Result<Vec<_>, _>>()?;
        v
    };
    let mut index: HashMap<String, usize> = out.iter().enumerate().map(|(i, c)| (c.name.to_lowercase(), i)).collect();
    for m in list(db, game)? {
        let Some(c) = m.character.as_deref().map(str::trim).filter(|c| !c.is_empty()) else { continue };
        let i = *index.entry(c.to_lowercase()).or_insert_with(|| {
            out.push(Character { name: c.to_string(), ..Default::default() });
            out.len() - 1
        });
        out[i].mod_count += 1;
        if m.enabled { out[i].enabled_count += 1; }
    }
    out.sort_by(|a, b| b.enabled_count.cmp(&a.enabled_count).then(b.mod_count.cmp(&a.mod_count)).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(out)
}

/// Replace the game's character list (from GameBanana's categories, sent by the UI).
pub fn characters_sync(db: &Db, game: &str, list: &[CharacterRef]) -> Result<()> {
    let tx = db.conn.unchecked_transaction()?;
    tx.execute("DELETE FROM characters WHERE game = ?1", [game])?;
    let mut seen = HashSet::new();
    for (i, c) in list.iter().enumerate() {
        let name = c.name.trim();
        if name.is_empty() || !seen.insert(name.to_lowercase()) { continue; }
        tx.execute("INSERT INTO characters (game, name, gb_category_id, icon, sort) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![game, name, c.gb_category_id.map(|v| v as i64), c.icon, i as i64])?;
    }
    tx.commit()?;
    Ok(())
}

/// The best character match for some text (a folder name, a GameBanana category name, a mod name), or None. Only
/// characters on the game's roster: an install names a folder after the answer, so before GameBanana's list has
/// loaded it goes to "Other" rather than to a name only the alias table knows.
pub fn infer_character(db: &Db, game: &str, hints: &[&str]) -> Option<String> {
    let names = character_names(db, game).ok()?;
    let found = Matcher::new(game, &names).best(hints)?;
    names.iter().any(|n| n.trim() == found).then_some(found)
}

/// Set which mods have a newer version online (the UI's update check). Others are cleared.
pub fn mark_updates(db: &Db, game: &str, ids: &[String]) -> Result<()> {
    let want: HashSet<&str> = ids.iter().map(String::as_str).collect();
    let tx = db.conn.unchecked_transaction()?;
    for mut e in list(db, game)? {
        let flag = want.contains(e.id.as_str());
        if e.update_available != flag {
            e.update_available = flag;
            tx.execute("UPDATE mods SET data = ?1 WHERE id = ?2", params![serde_json::to_string(&e)?, e.id])?;
        }
    }
    tx.commit()?;
    Ok(())
}

/// The absolute folder of a mod.
pub fn mod_path(db: &Db, game: &str, id: &str) -> Result<PathBuf> { Ok(PathBuf::from(get(db, game, id)?.path)) }

#[cfg(test)]
mod tests;
