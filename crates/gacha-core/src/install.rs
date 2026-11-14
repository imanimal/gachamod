//! Turning an archive or a folder into mods in the library: extract to staging, find the mod folders inside, place
//! them under Mods, write sidecars. Owner: ONLINE area (docs/spec.md, "Installing").

use crate::error::{Error, Result};
use crate::model::{ModEntry, ModSource, Sidecar, DISABLED_PREFIX};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// What the app knows about a download before it is installed (from GameBanana, or nothing for a local file).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct InstallMeta {
    pub name: Option<String>,
    pub character: Option<String>,
    /// GameBanana category name, used to guess the character when `character` is empty.
    pub category: Option<String>,
    pub source: Option<ModSource>,
    pub version: Option<String>,
    pub nsfw: bool,
    /// Remote preview image, saved as preview.<ext> in the mod folder when the mod has no image of its own.
    pub preview_url: Option<String>,
    /// Update in place: the library id of the mod this replaces (its folder, sidecar id, enabled state and saved
    /// variables are kept; the old files go to the trash as "replaced").
    pub replaces: Option<String>,
    /// Settings from a shared .gachamod link list, one per mod to make from this file. They pick the archive's
    /// folders (no question), and set each mod's id, name, folder, on/off state, options and key edits.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub setups: Vec<ModSetup>,
}

/// How a shared mod was set up on the PC it came from (see `InstallMeta::setups`).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ModSetup {
    /// Its id, name, character, tags, notes, favourite and nsfw flag. Source and version come from the download.
    pub sidecar: Sidecar,
    /// Where it lived under Mods, without DISABLED prefixes ("Ellen Joe/Coca Cola").
    pub rel_path: String,
    pub enabled: bool,
    /// The archive folder it was (`Sidecar::variant`), when known.
    pub variant: Option<String>,
    /// Its .ini files (paths inside the mod folder), to find the archive folder when `variant` is unknown.
    pub inis: Vec<String>,
    pub vars: Vec<crate::ini::VarValue>,
    pub keys: Vec<crate::keys::KeyChange>,
    /// Its keys work only while the character is on screen (gachamod's fix).
    pub on_screen: bool,
}

/// A mod folder found inside an extracted archive.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    /// Stable key for the UI's choice (the path inside staging, forward slashes; empty for the staging folder itself).
    pub key: String,
    pub label: String,
    pub ini_count: u32,
    pub size: u64,
    /// An image found in the folder, as an absolute path.
    pub preview: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallOutcome {
    pub installed: Vec<ModEntry>,
    /// Several candidates and no choice yet: the UI asks, then calls again with `choose`.
    pub needs_choice: Option<Vec<Candidate>>,
    pub notes: Vec<String>,
}

/// The file the runner saves a remote preview to, inside the staging folder (any image extension).
pub const PREVIEW_STEM: &str = ".gachamod-preview";

const IMAGE_EXT: &[&str] = &["png", "jpg", "jpeg", "webp", "gif"];
const ARCHIVE_EXT: &[&str] = &["zip", "7z", "rar"];
/// Folder names that say nothing about the mod, so a wrapper folder's own name is kept instead.
const GENERIC: &[&str] = &["mod", "mods", "files", "file", "main", "content", "data", "folder", "new folder", "extracted", "download"];

fn ext_of(p: &Path) -> String { p.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default() }
fn name_of(p: &Path) -> String { p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default() }

fn skipped(name: &str) -> bool {
    matches!(name.to_ascii_lowercase().as_str(), "desktop.ini" | ".git" | "shaderfixes" | "shadercache" | "__macosx")
}

fn is_mod_ini(p: &Path) -> bool {
    ext_of(p) == "ini" && !name_of(p).eq_ignore_ascii_case("desktop.ini") && p.is_file()
}

fn is_image(p: &Path) -> bool { IMAGE_EXT.contains(&ext_of(p).as_str()) && p.is_file() }

fn entries(dir: &Path) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = fs::read_dir(dir).into_iter().flatten().flatten().map(|e| e.path()).collect();
    v.sort_by_key(|p| name_of(p).to_lowercase());
    v
}

fn child_dirs(dir: &Path) -> Vec<PathBuf> {
    entries(dir).into_iter().filter(|p| p.is_dir() && !skipped(&name_of(p))).collect()
}

fn holds_ini(dir: &Path) -> bool { entries(dir).iter().any(|p| is_mod_ini(p)) }

fn is_mod_dir(dir: &Path) -> bool { dir.join(crate::model::SIDECAR_FILE).is_file() || holds_ini(dir) }

/// True when an ini file is somewhere below `dir` (skipped folders left out).
fn leads_to_ini(dir: &Path) -> bool { is_mod_dir(dir) || child_dirs(dir).iter().any(|c| leads_to_ini(c)) }

/// A picture in the folder itself: preview.* first, then the first root-level image that no ini loads and that isn't
/// named like a texture (previews.rs). The runner's own preview file is left out.
fn own_image(dir: &Path) -> Option<PathBuf> {
    let names: Vec<String> = entries(dir).into_iter().filter(|p| is_image(p)).map(|p| name_of(&p)).filter(|n| !n.starts_with(PREVIEW_STEM)).collect();
    if let Some(p) = names.iter().find(|n| crate::previews::is_preview_name(n)) { return Some(dir.join(p)); }
    crate::previews::root_picture(dir, &names, |_| false).map(|n| dir.join(n))
}

/// The folder has a preview.* picture of its own.
fn has_preview_file(dir: &Path) -> bool {
    entries(dir).iter().any(|p| p.is_file() && crate::previews::is_preview_name(&name_of(p)))
}

fn tree_facts(dir: &Path) -> (u32, u64) {
    let (mut inis, mut size) = (0u32, 0u64);
    for e in walkdir::WalkDir::new(dir).into_iter().flatten() {
        if !e.file_type().is_file() { continue; }
        size += e.metadata().map(|m| m.len()).unwrap_or(0);
        if is_mod_ini(e.path()) { inis += 1; }
    }
    (inis, size)
}

fn rel_key(staging: &Path, dir: &Path) -> String {
    dir.strip_prefix(staging).map(|r| r.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/")).unwrap_or_default()
}

fn walk(staging: &Path, dir: &Path, label: Option<String>, inherited_preview: Option<PathBuf>, out: &mut Vec<Candidate>) {
    let own_name = if dir == staging { None } else { Some(crate::library::display_folder(&name_of(dir)).to_string()) };
    if is_mod_dir(dir) {
        let (ini_count, size) = tree_facts(dir);
        let label = label.or(own_name).unwrap_or_else(|| "Mod".into());
        let preview = own_image(dir).or(inherited_preview).map(|p| p.to_string_lossy().into_owned());
        out.push(Candidate { key: rel_key(staging, dir), label, ini_count, size, preview });
        return;
    }
    let kids: Vec<PathBuf> = child_dirs(dir).into_iter().filter(|c| leads_to_ini(c)).collect();
    if kids.len() == 1 {
        // a wrapper folder: the mod is the one folder inside; keep the outer name when the inner one says nothing
        let inner = &kids[0];
        let inner_name = crate::library::display_folder(&name_of(inner)).to_string();
        let outer = label.or(own_name);
        let generic = GENERIC.contains(&inner_name.to_ascii_lowercase().as_str()) || outer.as_deref().is_some_and(|o| o.eq_ignore_ascii_case(&inner_name));
        let next = if generic { outer } else { None };
        walk(staging, inner, next, own_image(dir).or(inherited_preview), out);
    } else {
        // a group: a character folder, or variants side by side
        for k in kids { walk(staging, &k, None, None, out); }
    }
}

/// Mod folders inside a staging folder (rules in docs/spec.md, "Finding mods").
pub fn find_roots(staging: &Path) -> Result<Vec<Candidate>> {
    if !staging.is_dir() { return Err(Error::Invalid("The unpacked files are gone. Try the install again".into())); }
    let mut out = Vec::new();
    walk(staging, staging, None, None, &mut out);
    Ok(out)
}

// ── staging ──

fn staging_root(data_dir: &Path) -> PathBuf { data_dir.join("staging") }

fn new_staging(data_dir: &Path) -> Result<PathBuf> {
    let root = staging_root(data_dir);
    fs::create_dir_all(&root)?;
    for _ in 0..8 {
        let id = &crate::library::new_id()[..12];
        let p = root.join(format!("{}-{id}", crate::db::now()));
        if !p.exists() { fs::create_dir_all(&p)?; return Ok(p); }
    }
    Err(Error::Conflict("Couldn't make a folder to unpack into. Try again".into()))
}

/// Extract an archive (zip, 7z, rar) into a fresh staging folder under `<data>/staging/` and return it. When the
/// result holds no ini at all and exactly one archive file, that one is unpacked too (archives inside archives are
/// common on GameBanana).
pub fn stage(data_dir: &Path, archive: &Path) -> Result<PathBuf> {
    let dir = new_staging(data_dir)?;
    match stage_into(archive, &dir) {
        Ok(()) => Ok(dir),
        Err(e) => { let _ = fs::remove_dir_all(&dir); Err(e) }
    }
}

fn stage_into(archive: &Path, dir: &Path) -> Result<()> {
    crate::archive::extract(archive, dir)?;
    for _ in 0..2 {
        if leads_to_ini(dir) { break; }
        let inner: Vec<PathBuf> = walkdir::WalkDir::new(dir).into_iter().flatten()
            .filter(|e| e.file_type().is_file() && ARCHIVE_EXT.contains(&ext_of(e.path()).as_str()))
            .map(|e| e.into_path()).collect();
        if inner.len() != 1 { break; }
        let a = &inner[0];
        let parent = a.parent().unwrap_or(dir);
        let stem = a.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "inner".into());
        let target = unique_child(parent, &sanitize_name(&stem));
        crate::archive::extract(a, &target)?;
        let _ = fs::remove_file(a);
    }
    Ok(())
}

/// Stage an archive, or copy a folder (never move the user's own folder) into a fresh staging folder.
pub fn stage_any(data_dir: &Path, path: &Path) -> Result<PathBuf> {
    if !path.exists() { return Err(Error::Invalid(format!("\"{}\" isn't there anymore", name_of(path)))); }
    if !path.is_dir() { return stage(data_dir, path); }
    let dir = new_staging(data_dir)?;
    let target = dir.join(sanitize_name(&name_of(path)));
    match copy_dir(path, &target) {
        Ok(()) => Ok(dir),
        Err(e) => { let _ = fs::remove_dir_all(&dir); Err(e) }
    }
}

/// Remove staging folders older than a day (left by a crash or an unanswered choice).
pub fn clean_staging(data_dir: &Path) {
    let day = std::time::Duration::from_secs(86_400);
    for e in fs::read_dir(staging_root(data_dir)).into_iter().flatten().flatten() {
        let old = e.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).is_some_and(|age| age > day);
        if old { let _ = fs::remove_dir_all(e.path()); }
    }
}

// ── names and moves ──

/// A folder name Windows accepts: no <>:"/\|?* or control characters, no trailing dots or spaces, not a reserved
/// device name (CON, PRN, AUX, NUL, COM1-9, LPT1-9), at most 80 characters. Never empty.
pub fn sanitize_name(name: &str) -> String {
    let s: String = name.chars().filter(|c| !"<>:\"/\\|?*".contains(*c) && !c.is_control()).collect();
    let mut s: String = s.trim().chars().take(80).collect();
    s = s.trim_end_matches(['.', ' ']).trim_start().to_string();
    let stem = s.split('.').next().unwrap_or("").trim().to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ((stem.starts_with("COM") || stem.starts_with("LPT")) && stem.len() == 4 && stem.as_bytes()[3].is_ascii_digit() && stem.as_bytes()[3] != b'0');
    if reserved { s.push('_'); }
    if s.is_empty() { "Mod".into() } else { s }
}

/// `parent/name`, or `parent/name (2)` and so on when a folder of that name is there in any case, on or off.
pub fn unique_child(parent: &Path, name: &str) -> PathBuf {
    let taken: Vec<String> = fs::read_dir(parent).into_iter().flatten().flatten()
        .map(|e| e.file_name().to_string_lossy().to_lowercase()).collect();
    let clash = |n: &str| {
        let l = n.to_lowercase();
        taken.iter().any(|t| *t == l || crate::library::display_folder(t) == l)
    };
    if !clash(name) { return parent.join(name); }
    (2..1000).map(|i| format!("{name} ({i})")).find(|n| !clash(n)).map(|n| parent.join(n)).unwrap_or_else(|| parent.join(format!("{name} ({})", crate::db::now())))
}

fn copy_dir(from: &Path, to: &Path) -> Result<()> {
    fs::create_dir_all(to)?;
    for e in walkdir::WalkDir::new(from).min_depth(1) {
        let e = e.map_err(|e| Error::Io(e.into()))?;
        let Ok(rel) = e.path().strip_prefix(from) else { continue };
        let t = to.join(rel);
        if e.file_type().is_dir() { fs::create_dir_all(&t)?; }
        else if e.file_type().is_file() {
            if let Some(p) = t.parent() { fs::create_dir_all(p)?; }
            fs::copy(e.path(), &t)?;
        }
    }
    Ok(())
}

/// Move a folder: a rename, retried when Windows says the folder is busy, or a copy and delete across drives.
pub fn move_dir(from: &Path, to: &Path) -> Result<()> {
    if let Some(p) = to.parent() { fs::create_dir_all(p)?; }
    let mut tries = 0;
    loop {
        match fs::rename(from, to) {
            Ok(()) => return Ok(()),
            // ERROR_NOT_SAME_DEVICE: another drive
            Err(e) if e.raw_os_error() == Some(17) => {
                if let Err(err) = copy_dir(from, to) { let _ = fs::remove_dir_all(to); return Err(err); }
                let _ = fs::remove_dir_all(from);
                return Ok(());
            }
            // access denied or in use: often an antivirus scan or Explorer holding the folder for a moment
            Err(e) if matches!(e.raw_os_error(), Some(5 | 32)) => {
                tries += 1;
                if tries > 3 {
                    return Err(Error::Conflict(format!("Windows didn't let gachamod move \"{}\". Close any window or program using it, then try again", name_of(from))));
                }
                std::thread::sleep(std::time::Duration::from_millis(150));
            }
            Err(e) => return Err(e.into()),
        }
    }
}

// ── placing ──

fn preview_in(dir: &Path) -> Option<PathBuf> {
    entries(dir).into_iter().find(|p| p.is_file() && name_of(p).starts_with(PREVIEW_STEM))
}

/// Put the downloaded preview (GameBanana's first picture) into a mod folder as preview.<ext> unless the mod has a
/// preview.* of its own. Other images in the mod don't count: they are often textures.
fn give_preview(target: &Path, src: Option<&Path>) -> Option<String> {
    let src = src?;
    if !src.is_file() { return None; }
    let inside = src.parent() == Some(target);
    let result = if !has_preview_file(target) {
        let name = format!("preview.{}", { let e = ext_of(src); if e.is_empty() { "jpg".into() } else { e } });
        let ok = if inside { fs::rename(src, target.join(&name)).is_ok() } else { fs::copy(src, target.join(&name)).is_ok() };
        ok.then_some(name)
    } else { None };
    if inside && src.exists() { let _ = fs::remove_file(src); }
    result
}

/// A ModEntry built from what was placed, for when the library can't register it yet.
fn entry_for(game: &str, mods_dir: &Path, dir: &Path, sc: &Sidecar) -> ModEntry {
    let folder = name_of(dir);
    let rel = dir.strip_prefix(mods_dir).map(|r| r.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/")).unwrap_or_else(|_| folder.clone());
    let group = rel.rsplit_once('/').map(|(g, _)| g.to_string());
    let (ini_count, size) = tree_facts(dir);
    ModEntry {
        id: sc.id.clone(), game: game.into(), name: sc.name.clone(), enabled: !crate::library::is_disabled_name(&folder), folder,
        rel_path: rel, path: dir.to_string_lossy().into_owned(), character: sc.character.clone(), group, source: sc.source.clone(),
        version: sc.version.clone(), installed_at: sc.installed_at, size_bytes: size, ini_count,
        preview: sc.preview.as_ref().map(|p| if p.contains("://") { p.clone() } else { dir.join(p).to_string_lossy().into_owned() }),
        tags: sc.tags.clone(), notes: sc.notes.clone(), favorite: sc.favorite, nsfw: sc.nsfw, ..Default::default()
    }
}

/// Place chosen candidates from `staging` into the game's Mods folder and register them. `choose` holds candidate
/// keys; empty means "all when there is one, else ask" (returns `needs_choice`). The staging folder is removed in
/// every outcome except `needs_choice`.
pub fn place(db: &crate::db::Shared, data_dir: &Path, game: &str, staging: &Path, meta: &InstallMeta, choose: &[String]) -> Result<InstallOutcome> {
    let r = place_inner(db, data_dir, game, staging, meta, choose);
    if !matches!(&r, Ok(o) if o.needs_choice.is_some()) { let _ = fs::remove_dir_all(staging); }
    r
}

fn lock(db: &crate::db::Shared) -> Result<std::sync::MutexGuard<'_, crate::db::Db>> {
    db.lock().map_err(|_| Error::Db("The local database is stuck. Restart gachamod".into()))
}

/// The live .ini files of a mod folder, as lowercase paths inside it, sorted (to tell an archive's folders apart).
pub fn ini_set(dir: &Path) -> Vec<String> {
    let mut v: Vec<String> = crate::ini::mod_inis(dir).into_iter().map(|(_, rel)| rel.replace('\\', "/").to_ascii_lowercase()).collect();
    v.sort();
    v.dedup();
    v
}

/// Pairs (candidate, setup) for shared settings: the same archive folder, else the same .ini files (or mostly the
/// same), else the only candidate with the only setup.
fn match_setups(staging: &Path, cands: &[Candidate], setups: &[ModSetup]) -> Vec<(usize, usize)> {
    let mut pairs: Vec<(usize, usize)> = Vec::new();
    let free_c = |pairs: &[(usize, usize)], c: usize| !pairs.iter().any(|p| p.0 == c);
    for (si, s) in setups.iter().enumerate() {
        let Some(v) = s.variant.as_deref() else { continue };
        if let Some(ci) = cands.iter().position(|c| c.key == v).filter(|&ci| free_c(&pairs, ci)) { pairs.push((ci, si)); }
    }
    let sets: Vec<Vec<String>> = cands.iter().map(|c| ini_set(&if c.key.is_empty() { staging.to_path_buf() } else { staging.join(&c.key) })).collect();
    for (si, s) in setups.iter().enumerate() {
        if pairs.iter().any(|p| p.1 == si) || s.inis.is_empty() { continue; }
        let want: Vec<String> = { let mut w: Vec<String> = s.inis.iter().map(|i| i.replace('\\', "/").to_ascii_lowercase()).collect(); w.sort(); w.dedup(); w };
        let score = |have: &[String]| {
            let common = want.iter().filter(|w| have.contains(w)).count() as f64;
            common / (want.len() + have.len()) as f64 * 2.0
        };
        let best = (0..cands.len()).filter(|&ci| free_c(&pairs, ci))
            .map(|ci| (ci, score(&sets[ci])))
            .filter(|&(_, sc)| sc >= 0.5)
            .max_by(|a, b| a.1.total_cmp(&b.1));
        if let Some((ci, _)) = best { pairs.push((ci, si)); }
    }
    if pairs.is_empty() && cands.len() == 1 && setups.len() == 1 { pairs.push((0, 0)); }
    pairs.sort_unstable();
    pairs
}

/// Where a shared mod goes: the sender's folder under Mods (made safe for this PC), with the DISABLED prefix when
/// it was off. A name that is taken gets " (2)".
fn shared_target(mods_dir: &Path, group: &str, name: &str, s: &ModSetup) -> PathBuf {
    let parts: Vec<String> = crate::archive::safe_relative(&s.rel_path)
        .map(|p| p.components().map(|c| sanitize_name(crate::library::display_folder(&c.as_os_str().to_string_lossy()))).collect())
        .unwrap_or_default();
    let (folder, parent) = match parts.split_last() {
        Some((last, groups)) => (last.clone(), groups.iter().fold(mods_dir.to_path_buf(), |p, g| p.join(g))),
        None => (sanitize_name(name), mods_dir.join(group)),
    };
    let free = unique_child(&parent, &folder);
    if s.enabled { free } else { parent.join(format!("{DISABLED_PREFIX}{}", name_of(&free))) }
}

/// A shared mod's options and key edits, once it is in place. Never fails the install.
fn apply_setup(db: &crate::db::Shared, game: &str, entry: &ModEntry, s: &ModSetup, notes: &mut Vec<String>) {
    let Ok(d) = lock(db) else { return };
    if !s.keys.is_empty() || s.on_screen {
        match crate::keys::apply_shared(&d, game, &entry.id, &s.keys, s.on_screen) {
            Ok(Some(n)) => notes.push(n),
            Ok(None) => {}
            Err(e) => notes.push(format!("Couldn't make {}'s key changes: {e}", entry.name)),
        }
    }
    if !s.vars.is_empty() {
        if let Err(e) = crate::library::stash_vars(&d, game, &entry.id, &s.vars) { notes.push(format!("Couldn't keep {}'s options: {e}", entry.name)); }
    }
}

fn place_inner(db: &crate::db::Shared, data_dir: &Path, game: &str, staging: &Path, meta: &InstallMeta, choose: &[String]) -> Result<InstallOutcome> {
    let all = find_roots(staging)?;
    if all.is_empty() {
        return Err(Error::Invalid("No mod found inside. A mod is a folder with at least one .ini file in it".into()));
    }
    let in_archive = all.len();
    // shared settings pick the archive's folders themselves; when some can't be found the user picks
    let pairs = if meta.setups.is_empty() { Vec::new() } else { match_setups(staging, &all, &meta.setups) };
    let (chosen, setup_of): (Vec<Candidate>, Vec<Option<&ModSetup>>) = if choose.is_empty() {
        if !pairs.is_empty() && (pairs.len() == meta.setups.len() || pairs.len() == all.len()) {
            pairs.iter().map(|&(c, s)| (all[c].clone(), Some(&meta.setups[s]))).unzip()
        } else {
            if all.len() > 1 { return Ok(InstallOutcome { needs_choice: Some(all), ..Default::default() }); }
            let s = meta.setups.first();
            (all, vec![s])
        }
    } else {
        let picked: Vec<usize> = (0..all.len()).filter(|&i| choose.contains(&all[i].key)).collect();
        if picked.is_empty() { return Err(Error::Invalid("The picked folders aren't in this archive anymore. Try the install again".into())); }
        // matched pairs first, then the setups left over go to the other picked folders in order
        let mut left: Vec<&ModSetup> = (0..meta.setups.len()).filter(|s| !pairs.iter().any(|p| p.1 == *s && picked.contains(&p.0))).map(|s| &meta.setups[s]).collect();
        left.reverse();
        picked.iter().map(|&c| {
            let s = pairs.iter().find(|p| p.0 == c).map(|p| &meta.setups[p.1]).or_else(|| left.pop());
            (all[c].clone(), s)
        }).unzip()
    };

    let base_name = meta.name.clone().filter(|n| !n.trim().is_empty()).unwrap_or_else(|| chosen[0].label.clone());
    let (mods_dir, character, one_skin, old, mut removed) = {
        let d = lock(db)?;
        let mods_dir = crate::games::mods_dir(&d, game)?;
        let character = meta.character.clone().filter(|c| !c.trim().is_empty()).or_else(|| {
            let hints: Vec<&str> = [meta.category.as_deref(), Some(base_name.as_str())].into_iter().flatten().collect();
            crate::library::infer_character(&d, game, &hints)
        });
        let one_skin = d.setting(&format!("{game}.oneSkin")).ok().flatten().map(|v| v != "0").unwrap_or(true);
        let old = meta.replaces.as_deref().and_then(|id| crate::library::get(&d, game, id).ok());
        // the same GameBanana mod was removed before: the new copy takes its place (id, details, options, profiles)
        let removed = match (&old, meta.source.as_ref()) {
            (None, Some(src)) if src.mod_id > 0 => crate::library::removed_by_gb(&d, game, src.mod_id).unwrap_or_default(),
            _ => Vec::new(),
        };
        (mods_dir, character, one_skin, old, removed)
    };
    let group = sanitize_name(character.as_deref().or(meta.category.as_deref()).filter(|g| !g.trim().is_empty()).unwrap_or("Other"));
    let preview_src = preview_in(staging);
    let mut notes = Vec::new();
    let mut installed = Vec::new();
    let several = chosen.len() > 1;
    let mut turned_off = 0;

    for (i, cand) in chosen.iter().enumerate() {
        let setup = setup_of.get(i).copied().flatten();
        let src = if cand.key.is_empty() { staging.to_path_buf() } else { staging.join(&cand.key) };
        let name = match setup.map(|s| s.sidecar.name.trim()).filter(|n| !n.is_empty()) {
            Some(n) => n.to_string(),
            None if several => format!("{base_name} - {}", cand.label),
            None => base_name.clone(),
        };
        let mut sidecar = Sidecar {
            format: 1, id: String::new(), name: name.clone(), character: character.clone(), source: meta.source.clone(),
            version: meta.version.clone().filter(|v| !v.is_empty()), installed_at: crate::db::now(), nsfw: meta.nsfw,
            variant: (in_archive > 1).then(|| cand.key.clone()), ..Default::default()
        };
        // shared settings: the sender's id (so their profiles find it), details and folder
        if let Some(s) = setup {
            let sc = &s.sidecar;
            sidecar.id = sc.id.clone();
            if sc.character.as_deref().is_some_and(|c| !c.trim().is_empty()) { sidecar.character = sc.character.clone(); }
            sidecar.tags = sc.tags.clone();
            sidecar.notes = sc.notes.clone();
            sidecar.favorite = sc.favorite;
            sidecar.nsfw = meta.nsfw || sc.nsfw;
        }

        // an update replaces the first candidate in place: same folder, id, name, tags and on/off state
        let mut target = None;
        if let (0, Some(o)) = (i, old.as_ref()) {
            let removed = { let d = lock(db)?; crate::library::remove(&d, data_dir, game, std::slice::from_ref(&o.id), "replaced") };
            match removed {
                Ok(_) if !Path::new(&o.path).exists() => {
                    target = Some(PathBuf::from(&o.path));
                    sidecar.id = o.id.clone();
                    sidecar.name = o.name.clone();
                    sidecar.tags = o.tags.clone();
                    sidecar.notes = o.notes.clone();
                    sidecar.favorite = o.favorite;
                    sidecar.nsfw = meta.nsfw || o.nsfw;
                    if o.character.is_some() { sidecar.character = o.character.clone(); }
                    // replacing with a shared copy takes the sender's details, but keeps this PC's id
                    if let Some(s) = setup {
                        sidecar.name = name.clone();
                        sidecar.tags = s.sidecar.tags.clone();
                        sidecar.notes = s.sidecar.notes.clone();
                        sidecar.favorite = s.sidecar.favorite;
                        if s.sidecar.character.as_deref().is_some_and(|c| !c.trim().is_empty()) { sidecar.character = s.sidecar.character.clone(); }
                    }
                }
                _ => notes.push(format!("Couldn't move the old copy of {} to the trash, so both copies are there now", o.name)),
            }
        }
        // a removed copy of this GameBanana mod comes back: its id (so its kept options and profile places fit
        // again), name, character, tags, notes and favourite
        let back = if target.is_some() || removed.is_empty() || setup.is_some() { None } else {
            let at = removed.iter().position(|r| r.entry.name.eq_ignore_ascii_case(&name)).unwrap_or(0);
            Some(removed.remove(at))
        };
        if let Some(r) = &back {
            let p = &r.entry;
            sidecar.id = r.mod_id.clone();
            if !p.name.trim().is_empty() { sidecar.name = p.name.clone(); }
            if p.character.as_deref().is_some_and(|c| !c.trim().is_empty()) { sidecar.character = p.character.clone(); }
            sidecar.tags = p.tags.clone();
            sidecar.notes = p.notes.clone();
            sidecar.favorite = p.favorite;
            sidecar.nsfw = sidecar.nsfw || p.nsfw;
        }
        let target = match (target, setup) {
            (Some(t), _) => t,
            (None, Some(s)) => shared_target(&mods_dir, &group, &name, s),
            (None, None) => {
                let mut folder = sanitize_name(&name);
                // variants of one character: only the first stays on
                if several && i > 0 && character.is_some() && one_skin {
                    folder = format!("{DISABLED_PREFIX}{folder}");
                    turned_off += 1;
                }
                unique_child(&mods_dir.join(&group), &folder)
            }
        };

        move_dir(&src, &target)?;
        let own = if cand.key.is_empty() { preview_in(&target) } else { preview_src.clone() };
        if let Some(p) = give_preview(&target, own.as_deref()) { sidecar.preview = Some(p); }
        // the picture didn't download: show GameBanana's link until the mod has a preview.* of its own
        if sidecar.preview.is_none() && !has_preview_file(&target) {
            sidecar.preview = meta.preview_url.clone().filter(|u| u.starts_with("https://"));
        }

        let entry = {
            let d = lock(db)?;
            match crate::library::add_folder(&d, game, &target, Some(sidecar.clone())) {
                Ok(e) => e,
                Err(_) => {
                    if sidecar.id.is_empty() { sidecar.id = crate::library::new_id(); }
                    crate::library::write_sidecar(&target, &sidecar)?;
                    entry_for(game, &mods_dir, &target, &sidecar)
                }
            }
        };
        if let Some(r) = &back {
            let d = lock(db)?;
            let _ = crate::library::drop_removed(&d, r);
            notes.push(format!("{} came back with its settings", entry.name));
        }
        if let Some(s) = setup { apply_setup(db, game, &entry, s, &mut notes); }
        installed.push(entry);
    }
    if turned_off > 0 {
        let who = character.as_deref().unwrap_or("this character");
        notes.push(format!("Turned off {turned_off} of the variants so only one {who} skin is on"));
    }
    crate::keys::after_install(db, game, &installed, &mut notes);
    crate::devtools::mark_changed(game);
    Ok(InstallOutcome { installed, needs_choice: None, notes })
}

/// Install archives or folders right away, without the queue (the app itself queues local installs so they get
/// progress and the variant picker; this is the same work in one call). Each path is staged and placed.
pub fn install_local(db: &crate::db::Shared, data_dir: &Path, game: &str, paths: &[PathBuf], choose: &[String]) -> Result<InstallOutcome> {
    let mut out = InstallOutcome::default();
    for p in paths {
        let staging = stage_any(data_dir, p)?;
        let stem = if p.is_dir() { name_of(p) } else { p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default() };
        let meta = InstallMeta { name: Some(stem), ..Default::default() };
        let o = place(db, data_dir, game, &staging, &meta, choose)?;
        if o.needs_choice.is_some() {
            let _ = fs::remove_dir_all(&staging);
            return Ok(InstallOutcome { needs_choice: o.needs_choice, installed: out.installed, notes: out.notes });
        }
        out.installed.extend(o.installed);
        out.notes.extend(o.notes);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    struct Tmp(PathBuf);
    impl Tmp {
        fn new(tag: &str) -> Tmp {
            let p = std::env::temp_dir().join(format!("gachamod-test-install-{tag}-{}-{}", std::process::id(), crate::library::new_id()));
            fs::create_dir_all(&p).unwrap();
            Tmp(p)
        }
        fn file(&self, rel: &str, body: &str) {
            let p = self.0.join(rel);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, body).unwrap();
        }
    }
    impl Drop for Tmp { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }

    fn keys(t: &Tmp) -> Vec<(String, String)> {
        find_roots(&t.0).unwrap().into_iter().map(|c| (c.key, c.label)).collect()
    }

    #[test]
    fn plain_mod() {
        let t = Tmp::new("plain");
        t.file("Coca Cola/mod.ini", "[x]");
        t.file("Coca Cola/tex.dds", "d");
        let c = find_roots(&t.0).unwrap();
        assert_eq!(c.len(), 1);
        assert_eq!((c[0].key.as_str(), c[0].label.as_str(), c[0].ini_count, c[0].size), ("Coca Cola", "Coca Cola", 1, 4));
    }

    #[test]
    fn ini_at_the_root() {
        let t = Tmp::new("root");
        t.file("mod.ini", "[x]");
        assert_eq!(keys(&t), [("".to_string(), "Mod".to_string())]);
    }

    #[test]
    fn wrapper_keeps_outer_name_for_generic_inner() {
        let t = Tmp::new("wrap");
        t.file("Ellen Bunny/mod/merged.ini", "[x]");
        t.file("Ellen Bunny/readme.txt", "hi");
        t.file("Ellen Bunny/preview.png", "img");
        let c = find_roots(&t.0).unwrap();
        assert_eq!((c[0].key.as_str(), c[0].label.as_str()), ("Ellen Bunny/mod", "Ellen Bunny"));
        assert!(c[0].preview.as_deref().unwrap().ends_with("preview.png"));
        // a meaningful inner name wins
        let t = Tmp::new("wrap2");
        t.file("Pack/Ellen Maid/merged.ini", "[x]");
        assert_eq!(keys(&t), [("Pack/Ellen Maid".to_string(), "Ellen Maid".to_string())]);
        // the same name twice keeps the outer
        let t = Tmp::new("wrap3");
        t.file("Maid/maid/a.ini", "[x]");
        assert_eq!(keys(&t)[0].1, "Maid");
    }

    #[test]
    fn variants_are_separate_candidates() {
        let t = Tmp::new("var");
        t.file("Ellen/Red/a.ini", "[x]");
        t.file("Ellen/Blue/a.ini", "[x]");
        t.file("Ellen/DISABLED Green/a.ini", "[x]");
        let k = keys(&t);
        assert_eq!(k.len(), 3);
        assert_eq!(k[0], ("Ellen/Blue".to_string(), "Blue".to_string()));
        assert_eq!(k[1].1, "Green");
    }

    #[test]
    fn sub_mods_belong_to_their_mod() {
        let t = Tmp::new("sub");
        t.file("Big/main.ini", "[x]");
        t.file("Big/Hair/hair.ini", "[x]");
        t.file("Big/Body/body.ini", "[x]");
        let c = find_roots(&t.0).unwrap();
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].ini_count, 3);
    }

    #[test]
    fn junk_is_not_a_mod() {
        let t = Tmp::new("junk");
        t.file("desktop.ini", "x");
        t.file("readme.txt", "x");
        t.file("ShaderFixes/x.ini", "x");
        t.file("Images/a.png", "x");
        assert!(keys(&t).is_empty());
        t.file("Real/real.ini", "[x]");
        assert_eq!(keys(&t), [("Real".to_string(), "Real".to_string())]);
    }

    #[test]
    fn nested_archive_is_unpacked() {
        let t = Tmp::new("nest");
        let inner = t.0.join("inner.zip");
        {
            let mut z = zip::ZipWriter::new(fs::File::create(&inner).unwrap());
            let o = zip::write::SimpleFileOptions::default();
            z.start_file("Jane/jane.ini", o).unwrap();
            z.write_all(b"[x]").unwrap();
            z.finish().unwrap();
        }
        let outer = t.0.join("outer.zip");
        {
            let mut z = zip::ZipWriter::new(fs::File::create(&outer).unwrap());
            let o = zip::write::SimpleFileOptions::default();
            z.start_file("readme.txt", o).unwrap();
            z.write_all(b"read me").unwrap();
            z.start_file("Jane Doe.zip", o).unwrap();
            z.write_all(&fs::read(&inner).unwrap()).unwrap();
            z.finish().unwrap();
        }
        let data = t.0.join("data");
        let staging = stage(&data, &outer).unwrap();
        let c = find_roots(&staging).unwrap();
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].key, "Jane Doe/Jane");
        assert!(!staging.join("Jane Doe.zip").exists());
    }

    #[test]
    fn names_are_safe_on_windows() {
        assert_eq!(sanitize_name("Ellen: Bunny?"), "Ellen Bunny");
        assert_eq!(sanitize_name("  dots... "), "dots");
        assert_eq!(sanitize_name("CON"), "CON_");
        assert_eq!(sanitize_name("com1.txt"), "com1.txt_");
        assert_eq!(sanitize_name("COM0"), "COM0");
        assert_eq!(sanitize_name("LPT9"), "LPT9_");
        assert_eq!(sanitize_name("a\u{7}b/c"), "abc");
        assert_eq!(sanitize_name("???"), "Mod");
        assert_eq!(sanitize_name(&"x".repeat(200)).len(), 80);
        assert_eq!(sanitize_name("Console"), "Console");
    }

    #[test]
    fn clashes_get_a_number() {
        let t = Tmp::new("clash");
        fs::create_dir_all(t.0.join("Coca Cola")).unwrap();
        fs::create_dir_all(t.0.join("DISABLED Pink")).unwrap();
        assert_eq!(name_of(&unique_child(&t.0, "coca cola")), "coca cola (2)");
        assert_eq!(name_of(&unique_child(&t.0, "Pink")), "Pink (2)");
        assert_eq!(name_of(&unique_child(&t.0, "Other")), "Other");
    }

    fn test_db(mods: &Path) -> crate::db::Shared {
        let db = crate::db::Db::memory().unwrap();
        crate::games::save_paths(&db, "zzz", &crate::games::GamePaths { mods_dir: Some(mods.to_string_lossy().into_owned()), ..Default::default() }).unwrap();
        std::sync::Arc::new(std::sync::Mutex::new(db))
    }

    #[test]
    fn place_one_and_variants() {
        let t = Tmp::new("place");
        let mods = t.0.join("Mods");
        let data = t.0.join("data");
        let db = test_db(&mods);
        let meta = InstallMeta { name: Some("Coca Cola".into()), character: Some("Ellen Joe".into()), ..Default::default() };

        let staging = new_staging(&data).unwrap();
        fs::create_dir_all(staging.join("wrap/mod")).unwrap();
        fs::write(staging.join("wrap/mod/a.ini"), "[x]").unwrap();
        fs::write(staging.join(format!("{PREVIEW_STEM}.jpg")), "img").unwrap();
        let o = place(&db, &data, "zzz", &staging, &meta, &[]).unwrap();
        assert_eq!(o.installed.len(), 1);
        let dir = mods.join("Ellen Joe/Coca Cola");
        assert!(dir.join("a.ini").is_file());
        assert!(dir.join("preview.jpg").is_file());
        assert!(dir.join(crate::model::SIDECAR_FILE).is_file());
        assert!(!staging.exists());

        // two variants: asks first, keeps staging, then installs both with only the first on
        let staging = new_staging(&data).unwrap();
        for v in ["Red", "Blue"] {
            fs::create_dir_all(staging.join(v)).unwrap();
            fs::write(staging.join(v).join("a.ini"), "[x]").unwrap();
        }
        let o = place(&db, &data, "zzz", &staging, &meta, &[]).unwrap();
        let c = o.needs_choice.unwrap();
        assert_eq!(c.len(), 2);
        assert!(staging.exists());
        let keys: Vec<String> = c.iter().map(|c| c.key.clone()).collect();
        let o = place(&db, &data, "zzz", &staging, &meta, &keys).unwrap();
        assert_eq!(o.installed.len(), 2);
        assert!(mods.join("Ellen Joe/Coca Cola - Blue").is_dir());
        assert!(mods.join("Ellen Joe/DISABLED Coca Cola - Red").is_dir());
        assert_eq!(o.notes.len(), 1);
        assert!(!staging.exists());
    }

    // ── previews and reinstalls (the "Velina" case: a texture jpg was taken as the preview) ──

    fn gb_meta(gb: u64) -> InstallMeta {
        InstallMeta {
            name: Some("Velina Maid".into()), character: Some("Velina Airgid".into()),
            source: Some(crate::model::ModSource { site: "gamebanana".into(), mod_id: gb, url: format!("https://gamebanana.com/mods/{gb}"), ..Default::default() }),
            preview_url: Some("https://images.gamebanana.com/img/ss/mods/velina.jpg".into()),
            ..Default::default()
        }
    }

    /// A mod whose only images are textures: one the ini loads, one named like a texture, one in a Textures folder.
    fn velina_staging(data: &Path, downloaded: bool) -> PathBuf {
        let s = new_staging(data).unwrap();
        let m = s.join("Velina Maid");
        fs::create_dir_all(m.join("Textures")).unwrap();
        fs::write(m.join("Velina.ini"), "[TextureOverrideBody]\nhash = 0011aabb\n[ResourceBody]\nfilename = VelinaBody.jpg\n[ResourceHair]\nfilename = Textures\\Hair.png\n").unwrap();
        fs::write(m.join("VelinaBody.jpg"), "texture").unwrap();
        fs::write(m.join("Velina_Diffuse.png"), "texture").unwrap();
        fs::write(m.join("Textures/Hair.png"), "texture").unwrap();
        if downloaded { fs::write(s.join(format!("{PREVIEW_STEM}.jpg")), "gb picture").unwrap(); }
        s
    }

    #[test]
    fn gamebanana_picture_beats_textures() {
        let t = Tmp::new("velina");
        let mods = t.0.join("Mods");
        let data = t.0.join("data");
        let db = test_db(&mods);

        let staging = velina_staging(&data, true);
        assert_eq!(find_roots(&staging).unwrap()[0].preview, None, "a texture is never a candidate's preview");
        let o = place(&db, &data, "zzz", &staging, &gb_meta(900001), &[]).unwrap();
        let dir = mods.join("Velina Airgid/Velina Maid");
        assert_eq!(fs::read_to_string(dir.join("preview.jpg")).unwrap(), "gb picture");
        assert!(o.installed[0].preview.as_deref().unwrap().ends_with("preview.jpg"));

        // the picture didn't download: GameBanana's link shows instead of a texture
        let staging = velina_staging(&data, false);
        let mut meta = gb_meta(900002);
        meta.name = Some("Velina Two".into());
        let o = place(&db, &data, "zzz", &staging, &meta, &[]).unwrap();
        assert_eq!(o.installed[0].preview.as_deref(), Some("https://images.gamebanana.com/img/ss/mods/velina.jpg"));

        // a local mod with only textures has no preview at all
        let staging = velina_staging(&data, false);
        let o = place(&db, &data, "zzz", &staging, &InstallMeta { name: Some("Velina Local".into()), ..Default::default() }, &[]).unwrap();
        assert_eq!(o.installed[0].preview, None);
        assert_eq!(crate::library::scan(&db, "zzz").unwrap().iter().find(|m| m.name == "Velina Local").unwrap().preview, None);
    }

    #[test]
    fn reinstall_brings_back_settings() {
        use crate::{ini, library, profiles};
        let t = Tmp::new("reinstall");
        let mods = t.0.join("Mods");
        let data = t.0.join("data");
        let db = test_db(&mods);
        let first = place(&db, &data, "zzz", &velina_staging(&data, true), &gb_meta(900001), &[]).unwrap().installed.remove(0);
        let id = first.id.clone();
        let beach = {
            let d = db.lock().unwrap();
            library::update_meta(&d, "zzz", &id, &library::MetaPatch {
                name: Some("My Velina".into()), tags: Some(vec!["maid".into()]), favorite: Some(true), ..Default::default()
            }).unwrap();
            ini::set_user_vars(&t.0, &first.rel_path, &[ini::VarValue { ini: "Velina.ini".into(), var: "swapvar".into(), value: "2".into() }]).unwrap();
            profiles::list(&d, "zzz").unwrap();
            let beach = profiles::create(&d, "zzz", "Beach", None).unwrap();
            library::remove(&d, &data, "zzz", std::slice::from_ref(&id), "removed").unwrap();
            // files go right away at 0 days; the details move to the archive
            d.set_setting("trash.days", "0").unwrap();
            let a = library::archive_list(&d, Some("zzz")).unwrap();
            assert_eq!(a.len(), 1);
            assert!(a[0].key.starts_with('a') && a[0].files_until.is_none() && a[0].has_options && a[0].favorite);
            assert_eq!(a[0].tags, vec!["maid".to_string()]);
            assert!(a[0].preview.as_deref().is_some_and(|p| Path::new(p).is_file() && p.contains("archive")), "{:?}", a[0].preview);
            assert!(library::trash_list(&d, "zzz").unwrap().is_empty());
            beach
        };

        // the same GameBanana mod again: same id, its details, options and profile places
        let back = place(&db, &data, "zzz", &velina_staging(&data, true), &gb_meta(900001), &[]).unwrap().installed.remove(0);
        assert_eq!((back.id.as_str(), back.name.as_str(), back.favorite), (id.as_str(), "My Velina", true));
        assert_eq!(back.tags, vec!["maid".to_string()]);
        {
            let d = db.lock().unwrap();
            assert!(library::archive_list(&d, None).unwrap().is_empty());
            assert_eq!(ini::user_vars(&t.0, &back.rel_path).unwrap()[0].value, "2");
            assert!(profiles::members(&d, beach.id).unwrap().contains(&id));

            // from the trash (files still there) by GameBanana id too
            d.set_setting("trash.days", "14").unwrap();
            library::remove(&d, &data, "zzz", std::slice::from_ref(&id), "removed").unwrap();
            let a = library::archive_list(&d, Some("zzz")).unwrap();
            assert!(a[0].key.starts_with('t') && a[0].files_until.is_some());
        }
        let again = place(&db, &data, "zzz", &velina_staging(&data, true), &gb_meta(900001), &[]).unwrap().installed.remove(0);
        assert_eq!(again.id, id);
        let d = db.lock().unwrap();
        assert!(library::archive_list(&d, Some("zzz")).unwrap().is_empty());
        assert!(!data.join("trash/zzz").read_dir().is_ok_and(|mut r| r.next().is_some()), "the old copy's files went");

        // forgetting drops the kept values and profile places
        library::remove(&d, &data, "zzz", std::slice::from_ref(&id), "removed").unwrap();
        let key = library::archive_list(&d, None).unwrap()[0].key.clone();
        assert_eq!(library::archive_forget(&d, &[key]).unwrap(), 1);
        assert!(library::archive_list(&d, None).unwrap().is_empty());
        assert!(!profiles::snapshot(&d, beach.id).unwrap().mods.iter().any(|m| m.mod_id == id));
    }

    #[test]
    fn local_folder_is_copied_not_moved() {
        let t = Tmp::new("local");
        let mods = t.0.join("Mods");
        let data = t.0.join("data");
        let db = test_db(&mods);
        t.file("mine/Burnice Swim/b.ini", "[x]");
        let o = install_local(&db, &data, "zzz", &[t.0.join("mine/Burnice Swim")], &[]).unwrap();
        assert_eq!(o.installed.len(), 1);
        assert!(t.0.join("mine/Burnice Swim/b.ini").is_file());
        assert!(mods.join("Other/Burnice Swim/b.ini").is_file());
    }
}
