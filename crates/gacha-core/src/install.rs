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
    /// The file was a bundle of separate mods, each installed on its own (not variants of one mod).
    #[serde(default)]
    pub bundle: bool,
    /// A folder outside the mod's own that got files (ShaderFixes, Mods/BufferValues), for a button that shows it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shader_fixes: Option<String>,
    /// gachamod didn't know where the files go and put them in Mods as they came: why, for the Downloads row.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unsure: Option<String>,
}

/// What an install is doing, for the Downloads list: the step ("Unpacking Lucia-Velvet v1.0.zip (3 of 18)"), how far
/// along (`done` of `total`, 0 total when unknown), and for a bundle the mods found in it and how many are in place.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InstallProgress {
    pub step: String,
    pub done: u32,
    pub total: u32,
    pub mods: Vec<String>,
    pub placed: u32,
}

type Reporter = (InstallProgress, Box<dyn Fn(&InstallProgress)>, std::time::Instant);
thread_local! {
    static PROGRESS: std::cell::RefCell<Option<Reporter>> = const { std::cell::RefCell::new(None) };
}

/// Run `work` with `report` told about each step that staging and placing take on this thread, starting from
/// `start`. A step that starts something (a new archive, a new mod) is told right away, byte counts at most every
/// 200 ms.
pub fn with_progress<T>(start: InstallProgress, report: impl Fn(&InstallProgress) + 'static, work: impl FnOnce() -> T) -> T {
    let back = std::time::Instant::now().checked_sub(std::time::Duration::from_secs(1)).unwrap_or_else(std::time::Instant::now);
    PROGRESS.with(|p| *p.borrow_mut() = Some((start, Box::new(report), back)));
    let r = work();
    PROGRESS.with(|p| *p.borrow_mut() = None);
    r
}

fn progress(now: bool, change: impl FnOnce(&mut InstallProgress)) {
    PROGRESS.with(|p| {
        let mut b = p.borrow_mut();
        let Some((state, report, last)) = b.as_mut() else { return };
        change(state);
        if now || last.elapsed() >= std::time::Duration::from_millis(200) { *last = std::time::Instant::now(); report(state); }
    });
}

fn size_text(b: u64) -> String {
    let mb = b as f64 / 1_048_576.0;
    if mb >= 1024.0 { format!("{:.1} GB", mb / 1024.0) } else { format!("{} MB", mb.round() as u64) }
}

/// Extract `a`, with the step saying `what` and how much is out so far.
fn extract_shown(a: &Path, dest: &Path, what: &str) -> Result<Vec<String>> {
    progress(true, |p| p.step = what.to_string());
    let mut bytes = 0u64;
    crate::archive::extract_with(a, dest, &mut |n| {
        bytes += n;
        progress(false, |p| p.step = format!("{what}, {} out so far", size_text(bytes)));
    })
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
    let n = name_of(p);
    // the loader's own inis make a copy of the loader, not a mod
    ext_of(p) == "ini" && !["desktop.ini", "d3dx.ini", "d3dx_user.ini"].iter().any(|x| n.eq_ignore_ascii_case(x)) && p.is_file()
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

/// True when an ini in `inner` (or a folder or two below it) loads a file through `..` that is in `outer` but not in
/// `inner`. Archives like `RoxyOveralls/{resources/Roxy.ini, toggles/, textures/}` keep the ini one folder down and
/// load `../toggles/Menu.dds`: the mod is the outer folder, not the one with the ini.
pub(crate) fn reaches_out(inner: &Path, outer: &Path) -> bool {
    let norm = |p: PathBuf| -> PathBuf {
        let mut out = PathBuf::new();
        for c in p.components() {
            match c { std::path::Component::ParentDir => { out.pop(); } std::path::Component::CurDir => {} c => out.push(c) }
        }
        out
    };
    walkdir::WalkDir::new(inner).max_depth(3).into_iter().flatten()
        .filter(|e| e.file_type().is_file() && is_mod_ini(e.path()))
        .any(|e| {
            let Ok(bytes) = fs::read(e.path()) else { return false };
            let base = e.path().parent().unwrap_or(inner).to_path_buf();
            String::from_utf8_lossy(&bytes).lines().any(|line| {
                let l = line.trim();
                if l.starts_with(';') || l.starts_with('[') { return false; }
                let Some((_, v)) = l.split_once('=') else { return false };
                let v = v.trim().trim_matches('"');
                if !v.contains("..") || Path::new(v).is_absolute() { return false; }
                let p = norm(base.join(v.replace('\\', "/")));
                p.starts_with(outer) && !p.starts_with(inner) && p.exists()
            })
        })
}

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
    if kids.len() == 1 && reaches_out(&kids[0], dir) {
        // the ini loads files from folders beside its own: this whole folder is the mod
        let (ini_count, size) = tree_facts(dir);
        let label = label.or(own_name).unwrap_or_else(|| "Mod".into());
        let preview = own_image(dir).or(inherited_preview).map(|p| p.to_string_lossy().into_owned());
        out.push(Candidate { key: rel_key(staging, dir), label, ini_count, size, preview });
    } else if kids.len() == 1 {
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

/// Extract an archive (zip, 7z, rar) into a fresh staging folder under `<data>/staging/` and return it. Archives
/// inside it are unpacked too, a few levels deep (see `unpack_nested`).
pub fn stage(data_dir: &Path, archive: &Path) -> Result<PathBuf> {
    let dir = new_staging(data_dir)?;
    match stage_into(archive, &dir) {
        Ok(()) => Ok(dir),
        Err(e) => { let _ = fs::remove_dir_all(&dir); Err(e) }
    }
}

fn stage_into(archive: &Path, dir: &Path) -> Result<()> {
    extract_shown(archive, dir, &format!("Unpacking {}", name_of(archive)))?;
    unpack_nested(dir);
    Ok(())
}

/// How many levels of archives inside archives are unpacked (the dropped archive is the first).
pub const NESTED_DEPTH: usize = 5;
/// At most this many inner archives are unpacked from one drop.
const NESTED_MAX: usize = 400;
/// What staging learned while unpacking inner archives: the folders that were archives (so each can become its own
/// mod) and the archives that couldn't be opened. Read and removed by `place`.
const NESTED_FILE: &str = ".gachamod-nested.json";

#[derive(Debug, Default, Serialize, Deserialize)]
struct Nested {
    /// Folders inside staging (forward slashes) that each came from an inner archive.
    origins: Vec<String>,
    /// Inner archives that couldn't be opened, by name.
    broken: Vec<String>,
}

fn read_nested(staging: &Path) -> Nested {
    fs::read(staging.join(NESTED_FILE)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

/// The second and later volumes of a split rar (`x.part2.rar`): UnRAR reads them through the first one.
fn later_volume(p: &Path) -> bool {
    let stem = p.file_stem().map(|s| s.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
    stem.rsplit_once(".part").is_some_and(|(_, n)| n.parse::<u32>().is_ok_and(|n| n > 1))
}

/// Unpack every archive found in `dir` that isn't inside a mod folder (a mod may carry a spare zip of its own), each
/// into a folder named after it beside it, and again for archives those held, up to `NESTED_DEPTH` levels in all.
/// A bundle of mods (a zip of zips, or a folder of rars) becomes one staging tree. An inner archive that won't open
/// is left as it is and noted.
pub fn unpack_nested(dir: &Path) {
    let mut nested = read_nested(dir);
    let mut done = 0;
    for _ in 1..NESTED_DEPTH {
        if is_mod_dir(dir) { break; }
        let found: Vec<PathBuf> = walkdir::WalkDir::new(dir).into_iter()
            .filter_entry(|e| e.depth() == 0 || !e.file_type().is_dir() || (!skipped(&name_of(e.path())) && !is_mod_dir(e.path())))
            .flatten()
            .filter(|e| e.file_type().is_file() && ARCHIVE_EXT.contains(&ext_of(e.path()).as_str()) && !later_volume(e.path()))
            .filter(|e| !nested.broken.contains(&rel_key(dir, e.path())))
            .map(|e| e.into_path()).collect();
        if found.is_empty() { break; }
        let n = found.len();
        for (k, a) in found.into_iter().enumerate() {
            if done >= NESTED_MAX { break; }
            done += 1;
            progress(true, |p| { p.done = k as u32; p.total = n as u32; });
            let parent = a.parent().unwrap_or(dir);
            let stem = a.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "inner".into());
            let stem = stem.rsplit_once(".part1").map(|(s, _)| s.to_string()).unwrap_or(stem);
            let target = unique_child(parent, &sanitize_name(&stem));
            match extract_shown(&a, &target, &format!("Unpacking {} ({} of {n})", name_of(&a), k + 1)) {
                Ok(_) => {
                    nested.origins.push(rel_key(dir, &target));
                    let _ = fs::remove_file(&a);
                    // the other volumes of a split rar were read through the first one
                    let lower = name_of(&a).to_ascii_lowercase();
                    if let Some((base, _)) = lower.rsplit_once(".part1") {
                        for v in entries(parent) {
                            let n = name_of(&v).to_ascii_lowercase();
                            if v.is_file() && n.starts_with(&format!("{base}.part")) && n.ends_with(".rar") { let _ = fs::remove_file(v); }
                        }
                    }
                }
                Err(_) => {
                    let _ = fs::remove_dir_all(&target);
                    nested.broken.push(rel_key(dir, &a));
                }
            }
        }
        if done >= NESTED_MAX { break; }
    }
    if !nested.origins.is_empty() || !nested.broken.is_empty() {
        if let Ok(b) = serde_json::to_vec(&nested) { let _ = fs::write(dir.join(NESTED_FILE), b); }
    }
}

/// Stage an archive, or copy a folder (never move the user's own folder) into a fresh staging folder. Archives in a
/// copied folder are unpacked as for an archive.
pub fn stage_any(data_dir: &Path, path: &Path) -> Result<PathBuf> {
    if !path.exists() { return Err(Error::Invalid(format!("\"{}\" isn't there anymore", name_of(path)))); }
    if !path.is_dir() { return stage(data_dir, path); }
    let dir = new_staging(data_dir)?;
    let target = dir.join(sanitize_name(&name_of(path)));
    progress(true, |p| p.step = format!("Copying {}", name_of(path)));
    match copy_dir(path, &target) {
        Ok(()) => { unpack_nested(&dir); Ok(dir) }
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
        let shown = crate::library::display_folder(&l);
        taken.iter().any(|t| *t == l || crate::library::display_folder(t) == shown)
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
    // files with a fixed place go in on the first call only: a second one answers a choice from the same files
    let r = if choose.is_empty() { place_first(db, data_dir, game, staging, meta) } else { place_inner(db, data_dir, game, staging, meta, choose) };
    if !matches!(&r, Ok(o) if o.needs_choice.is_some()) { let _ = fs::remove_dir_all(staging); }
    r
}

/// A folder whose files have one fixed place outside a mod's own folder: the loader's ShaderFixes, or
/// Mods/BufferValues, where shared fixes like LeoTools' FixDash.ini go.
struct FixedPlace { folder: &'static str, in_mods: bool, one: &'static str, many: &'static str }
const FIXED_PLACES: &[FixedPlace] = &[
    FixedPlace { folder: "ShaderFixes", in_mods: false, one: "shader fix", many: "shader fixes" },
    FixedPlace { folder: "BufferValues", in_mods: true, one: "BufferValues file", many: "BufferValues files" },
];

/// Loader files a mod can't replace from inside Mods. gachamod never swaps them itself.
const LOADER_FILES: &[&str] = &["d3d11.dll", "d3dx.ini", "d3dx_user.ini", "d3dcompiler_47.dll", "nvapi64.dll"];

/// The first `place` call: files with a fixed place go there, then the mods. Files nothing says where to put go in
/// Mods as they came, marked so the library lists them, and the outcome says so (`unsure`).
fn place_first(db: &crate::db::Shared, data_dir: &Path, game: &str, staging: &Path, meta: &InstallMeta) -> Result<InstallOutcome> {
    let name = meta.name.clone().filter(|n| !n.trim().is_empty()).unwrap_or_else(|| "the mod".into());
    let mut notes = Vec::new();
    let mut shown = None;
    for p in FIXED_PLACES {
        let (files, folders) = fixed_files(staging, p.folder);
        if files.is_empty() { continue; }
        let (note, dir) = add_fixed(db, game, &name, p, &files)?;
        notes.push(note);
        shown.get_or_insert(dir);
        for f in folders { let _ = fs::remove_dir_all(f); }
    }
    let no_mod = find_roots(staging)?.is_empty();
    if no_mod {
        let loose: Vec<(PathBuf, String)> = all_files(staging).into_iter().filter(|f| is_shader_name(&name_of(f))).map(|f| { let n = name_of(&f); (f, n) }).collect();
        if !loose.is_empty() {
            let (note, dir) = add_fixed(db, game, &name, &FIXED_PLACES[0], &loose)?;
            notes.push(note);
            shown.get_or_insert(dir);
            for (f, _) in &loose { let _ = fs::remove_file(f); }
        }
    }
    let mut unsure = None;
    if no_mod {
        let left: Vec<PathBuf> = all_files(staging).into_iter().filter(|f| !is_side_file(staging, f)).collect();
        if left.is_empty() && shown.is_some() {
            return Ok(InstallOutcome { notes, shader_fixes: shown, ..Default::default() });
        }
        if !left.is_empty() {
            let kids = child_dirs(staging);
            let root_files = entries(staging).into_iter().any(|e| e.is_file() && !is_side_file(staging, &e));
            let home = if kids.len() == 1 && !root_files { kids[0].clone() } else { staging.to_path_buf() };
            fs::write(home.join(crate::model::SIDECAR_FILE), serde_json::to_string(&Sidecar::default())?)?;
            let loader: Vec<String> = left.iter().map(|f| name_of(f)).filter(|n| LOADER_FILES.iter().any(|l| n.eq_ignore_ascii_case(l))).collect();
            unsure = Some(if loader.is_empty() {
                "gachamod didn't know where these files go, so it put them in Mods as they came. The mod may not work until they're moved. Its GameBanana page says where".to_string()
            } else {
                format!("It has {}, which replaces part of the mod loader. gachamod doesn't swap loader files, so it put everything in Mods as it came. Its GameBanana page says what to do", loader.join(", "))
            });
        }
    }
    let mut o = place_inner(db, data_dir, game, staging, meta, &[])?;
    if o.needs_choice.is_none() {
        if let Some(u) = &unsure { notes.push(u.clone()); }
        o.notes.extend(notes);
        o.unsure = unsure;
    }
    o.shader_fixes = shown;
    Ok(o)
}

fn all_files(dir: &Path) -> Vec<PathBuf> {
    walkdir::WalkDir::new(dir).into_iter().flatten().filter(|e| e.file_type().is_file()).map(|e| e.into_path()).collect()
}

/// A file that comes with a mod but isn't part of it: a readme, a picture, gachamod's own staging notes.
fn is_side_file(staging: &Path, f: &Path) -> bool {
    let n = name_of(f).to_ascii_lowercase();
    let in_skipped = rel_key(staging, f).split('/').any(skipped);
    let doc = ["txt", "md", "pdf", "url", "html", "htm", "rtf", "docx"].contains(&ext_of(f).as_str()) && !is_shader_name(&n);
    in_skipped || n.starts_with(".gachamod") || IMAGE_EXT.contains(&ext_of(f).as_str()) || doc
}

/// A shader replacement file the loader reads from ShaderFixes: `001acf466fe5dd61-ps_replace.txt` and the like.
fn is_shader_name(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    let Some((hash, rest)) = n.split_once('-') else { return false };
    hash.len() == 16 && hash.chars().all(|c| c.is_ascii_hexdigit())
        && ["vs", "ps", "cs", "gs", "hs", "ds"].iter().any(|k| rest.starts_with(k))
        && [".txt", ".bin", ".hlsl"].iter().any(|e| rest.ends_with(e))
}

/// Files inside folders named `folder` anywhere in the archive, as (file, path inside that folder), and the folders.
fn fixed_files(staging: &Path, folder: &str) -> (Vec<(PathBuf, String)>, Vec<PathBuf>) {
    let mut folders: Vec<PathBuf> = Vec::new();
    let files = all_files(staging).into_iter().filter_map(|f| {
        let rel = rel_key(staging, &f);
        let parts: Vec<&str> = rel.split('/').collect();
        let i = parts.iter().position(|p| p.eq_ignore_ascii_case(folder))?;
        if i + 1 >= parts.len() { return None; }
        let top = staging.join(parts[..=i].join("/"));
        if !folders.contains(&top) { folders.push(top); }
        Some((f, parts[i + 1..].join("/")))
    }).collect();
    (files, folders)
}

/// Copy files into a fixed place. Files there that would change are backed up first, and the backup lists the new
/// ones as created, so restoring it takes the whole install back out. Returns the note for the toast and the folder.
fn add_fixed(db: &crate::db::Shared, game: &str, name: &str, place: &FixedPlace, files: &[(PathBuf, String)]) -> Result<(String, String)> {
    let d = lock(db)?;
    let dir = if place.in_mods { crate::games::mods_dir(&d, game)? } else { crate::games::importer_dir(&d, game)? }.join(place.folder);
    fs::create_dir_all(&dir)?;
    let same = |src: &Path, dst: &Path| fs::read(dst).ok().is_some_and(|b| fs::read(src).ok().is_some_and(|a| a == b));
    let todo: Vec<&(PathBuf, String)> = files.iter().filter(|(src, rel)| !same(src, &dir.join(rel))).collect();
    if !todo.is_empty() {
        let rels: Vec<String> = todo.iter().map(|(_, r)| r.clone()).collect();
        crate::backups::take(&d, game, &place.folder.to_ascii_lowercase(), &dir, &rels, &format!("Added {name}'s {}", place.many))?;
    }
    drop(d);
    for (src, rel) in &todo {
        let dst = crate::backups::inside(&dir, rel)?;
        if let Some(p) = dst.parent() { fs::create_dir_all(p)?; }
        fs::copy(src, &dst)?;
    }
    // a shader comes as a .txt and a .bin of the same hash: count it once
    let count: std::collections::HashSet<String> = files.iter().map(|(_, rel)| {
        let f = rel.rsplit('/').next().unwrap_or(rel).to_ascii_lowercase();
        if is_shader_name(&f) { f[..16].to_string() } else { f }
    }).collect();
    let what = if count.len() == 1 { format!("1 {}", place.one) } else { format!("{} {}", count.len(), place.many) };
    let note = if todo.is_empty() { format!("Its {what} were already in the {} folder", place.folder) }
        else { format!("Added {what} to the {} folder. Restart the game to load them", place.folder) };
    Ok((note, dir.to_string_lossy().into_owned()))
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

/// Where `combine` gathers the parts inside a staging folder.
const PARTS_DIR: &str = ".gachamod-parts";

fn plural_parts(n: usize) -> String { if n == 1 { "1 part".into() } else { format!("{n} parts") } }

/// Move each picked folder into `<staging>/.gachamod-parts/<label>` so they install as one mod with parts
/// (library::parts). A part that overrides a hash an earlier part already does starts off (DISABLED), so two parts
/// never draw over each other. Returns the candidate for the whole and how many parts start off.
fn combine(staging: &Path, chosen: &[Candidate]) -> Result<(Candidate, usize)> {
    let root = staging.join(PARTS_DIR);
    if root.exists() { fs::remove_dir_all(&root)?; }
    fs::create_dir_all(&root)?;
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut off = 0;
    for c in chosen {
        let src = staging.join(&c.key);
        let hashes = crate::ini::quick_facts(&src).hashes;
        let clash = hashes.iter().any(|h| seen.contains(h));
        let name = sanitize_name(&c.label);
        let folder = if clash { off += 1; format!("{DISABLED_PREFIX}{name}") } else { seen.extend(hashes); name };
        move_dir(&src, &unique_child(&root, &folder))?;
    }
    let (ini_count, size) = tree_facts(&root);
    let preview = chosen.iter().find_map(|c| c.preview.clone());
    Ok((Candidate { key: PARTS_DIR.into(), label: chosen[0].label.clone(), ini_count, size, preview }, off))
}

/// A group of candidates that make one mod in a bundle, with the name and character it gets.
struct BundleGroup { keys: Vec<String>, name: String, character: Option<String> }

/// The character a candidate is for, from its own name and then the folders above it (nearest first).
fn guess_character(m: &crate::aliases::Matcher, c: &Candidate) -> Option<String> {
    let parts: Vec<&str> = c.key.split('/').filter(|s| !s.is_empty()).rev().collect();
    let hints: Vec<&str> = std::iter::once(c.label.as_str()).chain(parts).collect();
    m.best(&hints)
}

/// When the candidates are separate mods rather than variants of one, how they split into mods. They are separate
/// when they came from different archives inside the file (a zip of zips), or when they are for different
/// characters. Candidates from one archive and for one character stay together as the parts of one mod.
fn bundle_groups(d: &crate::db::Db, game: &str, all: &[Candidate], nested: &Nested) -> Option<Vec<BundleGroup>> {
    let origin_of = |key: &str| -> String {
        nested.origins.iter().filter(|o| key == o.as_str() || key.starts_with(&format!("{o}/")))
            .max_by_key(|o| o.len()).cloned().unwrap_or_default()
    };
    let m = crate::library::matcher(d, game).ok()?;
    let chars: Vec<Option<String>> = all.iter().map(|c| guess_character(&m, c)).collect();
    // (origin, character) -> candidate indexes, in archive order
    let mut groups: Vec<((String, Option<String>), Vec<usize>)> = Vec::new();
    for (i, c) in all.iter().enumerate() {
        let k = (origin_of(&c.key), chars[i].clone());
        match groups.iter_mut().find(|g| g.0 == k) { Some(g) => g.1.push(i), None => groups.push((k, vec![i])) }
    }
    let origins: std::collections::HashSet<&str> = groups.iter().map(|g| g.0 .0.as_str()).collect();
    let known: std::collections::HashSet<&String> = chars.iter().flatten().collect();
    if origins.len() < 2 && known.len() < 2 { return None; }
    let mut out = Vec::new();
    for ((origin, character), idx) in groups {
        // candidates with no character and no archive of their own are told apart only by their folders
        let split = character.is_none() && origin.is_empty() && idx.len() > 1;
        let sets: Vec<Vec<usize>> = if split { idx.iter().map(|&i| vec![i]).collect() } else { vec![idx] };
        for set in sets {
            let first = &all[set[0]];
            let origin_name = origin.rsplit('/').next().filter(|s| !s.is_empty()).map(|s| crate::library::display_folder(s).to_string());
            let generic = |l: &str| l == "Mod" || GENERIC.contains(&l.to_ascii_lowercase().as_str());
            let name = if set.len() == 1 && !generic(&first.label) { first.label.clone() }
                else { origin_name.or_else(|| character.clone()).unwrap_or_else(|| first.label.clone()) };
            out.push(BundleGroup { keys: set.iter().map(|&i| all[i].key.clone()).collect(), name, character: character.clone() });
        }
    }
    Some(out)
}

/// Install each group of a bundle as its own mod. One that fails is noted and the rest still go in.
fn place_bundle(db: &crate::db::Shared, data_dir: &Path, game: &str, staging: &Path, meta: &InstallMeta, groups: Vec<BundleGroup>) -> Result<InstallOutcome> {
    let mut out = InstallOutcome { bundle: true, ..Default::default() };
    let mut first_err = None;
    let n = groups.len() as u32;
    progress(true, |p| { p.mods = groups.iter().map(|g| g.name.clone()).collect(); p.placed = 0; p.done = 0; p.total = n; });
    for (k, g) in groups.into_iter().enumerate() {
        let k = k as u32;
        progress(true, |p| { p.step = format!("Installing {} ({} of {n})", g.name, k + 1); p.placed = k; p.done = k; });
        let m = InstallMeta { name: Some(g.name.clone()), character: g.character, nsfw: meta.nsfw, source: meta.source.clone(), ..Default::default() };
        match place_inner(db, data_dir, game, staging, &m, &g.keys) {
            Ok(o) => { out.installed.extend(o.installed); out.notes.extend(o.notes); progress(true, |p| { p.placed = k + 1; p.done = k + 1; }); }
            Err(e) => {
                out.notes.push(format!("Couldn't install {}: {e}", g.name));
                first_err.get_or_insert(e);
            }
        }
    }
    match first_err {
        Some(e) if out.installed.is_empty() => Err(e),
        _ => Ok(out),
    }
}

/// The archive folders an update installs without asking: the one the installed copy came from, or the folders its
/// parts are named after. None when the archive no longer has all of them, so the user picks.
fn same_parts(d: &crate::db::Db, game: &str, id: &str, all: &[Candidate]) -> Option<Vec<String>> {
    let old = crate::library::get(d, game, id).ok()?;
    if let Some(v) = crate::library::read_sidecar(Path::new(&old.path)).and_then(|s| s.variant) {
        return all.iter().any(|c| c.key == v).then(|| vec![v]);
    }
    let parts = crate::library::parts_in(Path::new(&old.path));
    if parts.is_empty() { return None; }
    let keys: Vec<String> = all.iter()
        .filter(|c| parts.iter().any(|p| sanitize_name(&c.label).eq_ignore_ascii_case(&p.name)))
        .map(|c| c.key.clone()).collect();
    let every = parts.iter().all(|p| all.iter().any(|c| sanitize_name(&c.label).eq_ignore_ascii_case(&p.name)));
    (every && keys.len() == parts.len()).then_some(keys)
}

fn place_inner(db: &crate::db::Shared, data_dir: &Path, game: &str, staging: &Path, meta: &InstallMeta, choose: &[String]) -> Result<InstallOutcome> {
    let all = find_roots(staging)?;
    let nested = read_nested(staging);
    if all.is_empty() {
        let mut msg = "Nothing inside goes in the Mods folder (it has no .ini file). Its GameBanana page says where the files go".to_string();
        if !nested.broken.is_empty() { msg = format!("No mod found inside. Couldn't open {}", nested.broken.join(", ")); }
        return Err(Error::Invalid(msg));
    }
    // an update keeps the parts already installed, without asking, while the archive still has them
    let kept = match meta.replaces.as_deref() {
        Some(id) if choose.is_empty() && meta.setups.is_empty() && all.len() > 1 => { let d = lock(db)?; same_parts(&d, game, id, &all) }
        _ => None,
    };
    let choose = kept.as_deref().unwrap_or(choose);
    // a bundle of separate mods installs each on its own, without asking
    if choose.is_empty() && meta.setups.is_empty() && meta.replaces.is_none() && all.len() > 1 {
        let groups = { let d = lock(db)?; bundle_groups(&d, game, &all, &nested) };
        if let Some(groups) = groups {
            let mut o = place_bundle(db, data_dir, game, staging, meta, groups)?;
            for b in &nested.broken { o.notes.push(format!("Couldn't open {b}, so it was left out")); }
            return Ok(o);
        }
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
    // a bundle's own steps name each mod; a single mod says it is moving in
    progress(true, |p| if p.mods.is_empty() { p.step = format!("Moving {base_name} into the Mods folder"); p.total = 0; });
    let (mods_dir, character, old, mut removed) = {
        let d = lock(db)?;
        let mods_dir = crate::games::mods_dir(&d, game)?;
        let character = meta.character.clone().filter(|c| !c.trim().is_empty()).or_else(|| {
            let hints: Vec<&str> = [meta.category.as_deref(), Some(base_name.as_str())].into_iter().flatten().collect();
            crate::library::infer_character(&d, game, &hints)
        });
        let old = meta.replaces.as_deref().and_then(|id| crate::library::get(&d, game, id).ok());
        // the same GameBanana mod was removed before: the new copy takes its place (id, details, options, profiles)
        let removed = match (&old, meta.source.as_ref()) {
            (None, Some(src)) if src.mod_id > 0 => crate::library::removed_by_gb(&d, game, src.mod_id).unwrap_or_default(),
            _ => Vec::new(),
        };
        (mods_dir, character, old, removed)
    };
    let group = sanitize_name(character.as_deref().or(meta.category.as_deref()).filter(|g| !g.trim().is_empty()).unwrap_or("Other"));
    let mut notes = Vec::new();
    // several picked folders without shared settings become the parts of one mod
    let combined = chosen.len() > 1 && setup_of.iter().all(|s| s.is_none());
    let (chosen, setup_of) = if combined {
        let (c, off) = combine(staging, &chosen)?;
        if off > 0 { notes.push(format!("Turned off {} of {base_name} that change the same things as another part. Switch parts in its details", plural_parts(off))); }
        (vec![c], vec![None])
    } else { (chosen, setup_of) };
    let preview_src = preview_in(staging);
    let mut installed = Vec::new();
    let several = chosen.len() > 1;

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
            variant: (in_archive > 1 && !combined).then(|| cand.key.clone()), ..Default::default()
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
        let mut src = src;
        let mut beside = false;
        if let (0, Some(o)) = (i, old.as_ref()) {
            // the new files go next to the old mod first (off, so the game doesn't load them): the old copy only
            // leaves once the new one is on its drive
            let parent = Path::new(&o.path).parent().map(Path::to_path_buf).unwrap_or_else(|| mods_dir.clone());
            let next = unique_child(&parent, &format!("{DISABLED_PREFIX}gachamod update {}", &crate::library::new_id()[..8]));
            move_dir(&src, &next)?;
            src = next;
            beside = true;
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
            // a new mod comes in off. With "Turn on new mods" (the default) the UI turns it on right after, with the
            // one-skin rule and an Undo (src/screens/library/afterInstall.ts)
            (None, None) => unique_child(&mods_dir.join(&group), &format!("{DISABLED_PREFIX}{}", sanitize_name(&name))),
        };

        let target = match move_dir(&src, &target) {
            Ok(()) => target,
            // the update is already in the Mods folder: it stays where it is rather than being lost
            Err(_) if beside => {
                notes.push(format!("Windows didn't let gachamod rename the new copy of {}, so it is in the folder \"{}\"", sidecar.name, name_of(&src)));
                src.clone()
            }
            Err(e) => return Err(e),
        };
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
    crate::keys::after_install(db, game, &installed, &mut notes);
    // an update of a live skin brings an ini without the gate, and with "every character" on a new mod joins its
    // character in the menus
    let joined = { let d = lock(db)?; crate::live::settle(&d, game) };
    if joined {
        let d = lock(db)?;
        for e in &mut installed { if let Ok(now) = crate::library::get(&d, game, &e.id) { *e = now; } }
    }
    crate::devtools::mark_changed(game);
    for b in &nested.broken { notes.push(format!("Couldn't open {b}, so it was left out")); }
    Ok(InstallOutcome { installed, needs_choice: None, notes, ..Default::default() })
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
            return Ok(InstallOutcome { needs_choice: o.needs_choice, installed: out.installed, notes: out.notes, ..Default::default() });
        }
        out.installed.extend(o.installed);
        out.notes.extend(o.notes);
        out.bundle |= o.bundle;
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
    fn shader_fixes_are_found() {
        let t = Tmp::new("shaders");
        t.file("README.txt", "x");
        t.file("ShaderFixes/001acf466fe5dd61-ps_replace.txt", "x");
        t.file("ShaderFixes/001acf466fe5dd61-ps_replace.bin", "x");
        let (files, folders) = fixed_files(&t.0, "ShaderFixes");
        let mut f: Vec<String> = files.into_iter().map(|(_, r)| r).collect();
        f.sort();
        assert_eq!(f, ["001acf466fe5dd61-ps_replace.bin", "001acf466fe5dd61-ps_replace.txt"]);
        assert_eq!(folders, [t.0.join("ShaderFixes")]);
        assert!(is_shader_name("075ae3614d1f9c46-vs_replace.txt"));
        assert!(!is_shader_name("readme.txt"));
        assert!(is_side_file(&t.0, &t.0.join("README.txt")));
        assert!(!is_side_file(&t.0, &t.0.join("tool.dll")));
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

    fn zip_of(path: &Path, files: &[(&str, Vec<u8>)]) {
        let mut z = zip::ZipWriter::new(fs::File::create(path).unwrap());
        let o = zip::write::SimpleFileOptions::default();
        for (n, b) in files { z.start_file(*n, o).unwrap(); z.write_all(b).unwrap(); }
        z.finish().unwrap();
    }

    #[test]
    fn archives_nest_a_few_levels_but_not_inside_mods() {
        let t = Tmp::new("deep");
        let l3 = t.0.join("l3.zip");
        zip_of(&l3, &[("Deep/deep.ini", b"[x]".to_vec()), ("Deep/spare.zip", b"PK not really".to_vec())]);
        let l2 = t.0.join("l2.zip");
        zip_of(&l2, &[("inner/Level3.zip", fs::read(&l3).unwrap()), ("Side/side.ini", b"[x]".to_vec())]);
        let l1 = t.0.join("l1.zip");
        zip_of(&l1, &[("Level2.zip", fs::read(&l2).unwrap()), ("broken.rar", b"nope".to_vec())]);
        let staging = stage(&t.0.join("data"), &l1).unwrap();
        let k: Vec<String> = find_roots(&staging).unwrap().into_iter().map(|c| c.key).collect();
        assert_eq!(k, ["Level2/inner/Level3/Deep", "Level2/Side"]);
        // a mod's own zip is its business
        assert!(staging.join("Level2/inner/Level3/Deep/spare.zip").is_file());
        let n = read_nested(&staging);
        assert_eq!(n.origins, ["Level2", "Level2/inner/Level3"]);
        assert_eq!(n.broken, ["broken.rar"]);
    }

    #[test]
    fn a_zip_of_mods_installs_each_on_its_own() {
        let t = Tmp::new("bundle");
        let mods = t.0.join("Mods");
        let data = t.0.join("data");
        let db = test_db(&mods);
        let ellen = t.0.join("e.zip");
        zip_of(&ellen, &[("Red/a.ini", b"[x]".to_vec()), ("Blue/a.ini", b"[x]".to_vec())]);
        let jane = t.0.join("j.zip");
        zip_of(&jane, &[("JaneDoe Maid/j.ini", b"[x]".to_vec())]);
        let outer = t.0.join("pack.zip");
        zip_of(&outer, &[("pack/Ellen Bunny.zip", fs::read(&ellen).unwrap()), ("pack/Jane Maid.zip", fs::read(&jane).unwrap()), ("pack/readme.txt", b"hi".to_vec())]);
        let o = install_local(&db, &data, "zzz", std::slice::from_ref(&outer), &[]).unwrap();
        assert!(o.bundle && o.needs_choice.is_none());
        let names: Vec<(String, Option<String>)> = o.installed.iter().map(|m| (m.name.clone(), m.character.clone())).collect();
        // Ellen's two folders are the parts of one mod, named after its archive
        assert_eq!(names, [("Ellen Bunny".to_string(), Some("Ellen Joe".to_string())), ("JaneDoe Maid".to_string(), Some("Jane Doe".to_string()))]);
        assert!(mods.join("Ellen Joe/DISABLED Ellen Bunny").is_dir());
        assert!(mods.join("Jane Doe/DISABLED JaneDoe Maid/j.ini").is_file());

        // the steps name each inner archive and each mod as it goes in
        let seen = std::rc::Rc::new(std::cell::RefCell::new(Vec::<InstallProgress>::new()));
        let s2 = seen.clone();
        with_progress(InstallProgress::default(), move |p| s2.borrow_mut().push(p.clone()), || install_local(&db, &data, "zzz", std::slice::from_ref(&outer), &[]).unwrap());
        let seen = seen.borrow();
        assert!(seen.iter().any(|p| p.step == "Unpacking Ellen Bunny.zip (1 of 2)"));
        let last = seen.last().unwrap();
        assert_eq!((last.mods.len(), last.placed), (2, 2));
    }

    #[test]
    fn variants_of_one_mod_still_ask() {
        let t = Tmp::new("notbundle");
        let mods = t.0.join("Mods");
        let data = t.0.join("data");
        let db = test_db(&mods);
        let z = t.0.join("v.zip");
        zip_of(&z, &[("Ellen/Red/a.ini", b"[x]".to_vec()), ("Ellen/Blue/a.ini", b"[x]".to_vec())]);
        let o = install_local(&db, &data, "zzz", std::slice::from_ref(&z), &[]).unwrap();
        assert!(!o.bundle);
        assert_eq!(o.needs_choice.unwrap().len(), 2);
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
        // a saved Mods folder that isn't on disk is an error now, so the test makes it like setup would
        fs::create_dir_all(mods).unwrap();
        let db = crate::db::Db::memory().unwrap();
        crate::games::save_paths(&db, "zzz", &crate::games::GamePaths { mods_dir: Some(mods.to_string_lossy().into_owned()), ..Default::default() }).unwrap();
        std::sync::Arc::new(std::sync::Mutex::new(db))
    }

    #[test]
    fn files_without_an_ini_still_install() {
        let t = Tmp::new("noini");
        let mods = t.0.join("Mods");
        let data = t.0.join("data");
        let db = test_db(&mods);
        let meta = InstallMeta { name: Some("Remover".into()), ..Default::default() };

        // shader fixes only: they go to the loader's ShaderFixes, nothing lands in Mods
        let staging = new_staging(&data).unwrap();
        fs::create_dir_all(staging.join("ShaderFixes")).unwrap();
        fs::write(staging.join("README.txt"), "x").unwrap();
        fs::write(staging.join("ShaderFixes/001acf466fe5dd61-ps_replace.txt"), "a").unwrap();
        fs::write(staging.join("ShaderFixes/001acf466fe5dd61-ps_replace.bin"), "b").unwrap();
        let o = place(&db, &data, "zzz", &staging, &meta, &[]).unwrap();
        assert!(o.installed.is_empty() && o.unsure.is_none());
        assert!(t.0.join("ShaderFixes/001acf466fe5dd61-ps_replace.bin").is_file());
        assert!(o.notes[0].starts_with("Added 1 shader fix"));

        // BufferValues files go to Mods/BufferValues
        let staging = new_staging(&data).unwrap();
        fs::create_dir_all(staging.join("Fix/BufferValues")).unwrap();
        fs::write(staging.join("Fix/BufferValues/FixDash.ini"), "[x]").unwrap();
        let o = place(&db, &data, "zzz", &staging, &meta, &[]).unwrap();
        assert!(mods.join("BufferValues/FixDash.ini").is_file());
        assert!(o.installed.is_empty());

        // nothing says where these go: Mods, as they came, listed, and flagged
        let staging = new_staging(&data).unwrap();
        fs::create_dir_all(staging.join("Tool")).unwrap();
        fs::write(staging.join("Tool/d3d11.dll"), "x").unwrap();
        fs::write(staging.join("Tool/readme.txt"), "x").unwrap();
        let o = place(&db, &data, "zzz", &staging, &meta, &[]).unwrap();
        assert_eq!(o.installed.len(), 1);
        assert!(o.unsure.as_deref().is_some_and(|u| u.contains("d3d11.dll")));
        assert!(Path::new(&o.installed[0].path).join("d3d11.dll").is_file());
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
        // a new mod comes in off
        let dir = mods.join("Ellen Joe/DISABLED Coca Cola");
        assert!(dir.join("a.ini").is_file());
        assert!(!o.installed[0].enabled);
        assert!(dir.join("preview.jpg").is_file());
        assert!(dir.join(crate::model::SIDECAR_FILE).is_file());
        assert!(!staging.exists());

        // two variants and an icon: asks first, keeps staging, then installs them as one mod with parts. Red draws
        // the same thing as Blue, so it starts off; the icon stays on
        let staging = new_staging(&data).unwrap();
        for (v, hash) in [("Red", "aaaa1111"), ("Blue", "aaaa1111"), ("Icon", "bbbb2222")] {
            fs::create_dir_all(staging.join(v)).unwrap();
            fs::write(staging.join(v).join("a.ini"), format!("[TextureOverride{v}]
hash = {hash}
")).unwrap();
        }
        let o = place(&db, &data, "zzz", &staging, &meta, &[]).unwrap();
        let c = o.needs_choice.unwrap();
        assert_eq!(c.len(), 3);
        assert!(staging.exists());
        let keys: Vec<String> = c.iter().map(|c| c.key.clone()).collect();
        let o = place(&db, &data, "zzz", &staging, &meta, &keys).unwrap();
        assert_eq!(o.installed.len(), 1);
        let dir = mods.join("Ellen Joe/DISABLED Coca Cola (2)");
        assert!(dir.join("Blue/a.ini").is_file());
        assert!(dir.join("DISABLED Red/a.ini").is_file());
        assert!(dir.join("Icon/a.ini").is_file());
        assert_eq!(o.installed[0].ini_count, 2);
        assert_eq!(o.notes.len(), 1, "{:?}", o.notes);
        assert!(!staging.exists());

        // each part switches on and off from the library
        let d = db.lock().unwrap();
        let id = o.installed[0].id.clone();
        let parts = crate::library::parts(&d, "zzz", &id).unwrap();
        let names: Vec<(&str, bool)> = parts.iter().map(|p| (p.name.as_str(), p.enabled)).collect();
        assert_eq!(names, [("Blue", true), ("Icon", true), ("Red", false)]);
        let e = crate::library::set_part(&d, "zzz", &id, "DISABLED Red", true).unwrap();
        assert!(dir.join("Red/a.ini").is_file());
        assert_eq!(e.ini_count, 3);
        let e = crate::library::set_part(&d, "zzz", &id, "Icon", false).unwrap();
        assert!(dir.join("DISABLED Icon/a.ini").is_file());
        assert_eq!(e.ini_count, 2);
        assert!(!e.enabled);
    }

    #[test]
    fn update_keeps_the_installed_parts() {
        let t = Tmp::new("updparts");
        let mods = t.0.join("Mods");
        let data = t.0.join("data");
        let db = test_db(&mods);
        let meta = InstallMeta { name: Some("Coca Cola".into()), character: Some("Ellen Joe".into()), ..Default::default() };
        let stage = |names: &[&str]| {
            let s = new_staging(&data).unwrap();
            for (i, v) in names.iter().enumerate() {
                fs::create_dir_all(s.join(v)).unwrap();
                fs::write(s.join(v).join("a.ini"), format!("[TextureOverride{v}]\nhash = {i:08}\n")).unwrap();
            }
            s
        };
        let pick = |s: &Path, m: &InstallMeta, want: &[&str]| {
            let c = place(&db, &data, "zzz", s, m, &[]).unwrap().needs_choice.unwrap();
            let keys: Vec<String> = c.iter().filter(|c| want.contains(&c.label.as_str())).map(|c| c.key.clone()).collect();
            place(&db, &data, "zzz", s, m, &keys).unwrap().installed.remove(0)
        };

        // two of three parts as one mod: the update brings the same two, no question
        let one = pick(&stage(&["Red", "Blue", "Icon"]), &meta, &["Red", "Icon"]);
        let upd = InstallMeta { replaces: Some(one.id.clone()), ..meta.clone() };
        let o = place(&db, &data, "zzz", &stage(&["Red", "Blue", "Icon"]), &upd, &[]).unwrap();
        assert!(o.needs_choice.is_none());
        let names: Vec<String> = { let d = db.lock().unwrap(); crate::library::parts(&d, "zzz", &one.id).unwrap().into_iter().map(|p| p.name).collect() };
        assert_eq!(names, ["Icon", "Red"]);
        // a part gone from the archive: asks again
        let upd = InstallMeta { replaces: Some(one.id.clone()), ..meta.clone() };
        assert!(place(&db, &data, "zzz", &stage(&["Blue", "Icon", "Green"]), &upd, &[]).unwrap().needs_choice.is_some());

        // one picked folder: the update takes the same folder
        let single = pick(&stage(&["Red", "Blue"]), &meta, &["Blue"]);
        let upd = InstallMeta { replaces: Some(single.id.clone()), ..meta.clone() };
        let o = place(&db, &data, "zzz", &stage(&["Red", "Blue"]), &upd, &[]).unwrap();
        assert!(o.needs_choice.is_none());
        let sc = crate::library::read_sidecar(Path::new(&o.installed[0].path)).unwrap();
        assert_eq!(sc.variant.as_deref(), Some("Blue"));
    }

    #[test]
    fn a_download_joins_every_character() {
        let t = Tmp::new("liveall");
        let mods = t.0.join("Mods");
        let data = t.0.join("data");
        let db = test_db(&mods);
        let ini = "[TextureOverrideBody]\nhash = 0011aabb\nib = ResourceIB\ndrawindexed = auto\n";
        fs::create_dir_all(mods.join("Ellen Joe/Maid")).unwrap();
        fs::write(mods.join("Ellen Joe/Maid/mod.ini"), ini).unwrap();
        crate::library::scan(&db, "zzz").unwrap();
        crate::live::set_all(&db.lock().unwrap(), "zzz", true).unwrap();
        // a character with no mods yet, and one more skin for Ellen
        for (name, character) in [("Office", "Velina Airgid"), ("Bunny", "Ellen Joe")] {
            let staging = new_staging(&data).unwrap();
            fs::write(staging.join("mod.ini"), ini.replace("0011aabb", if name == "Office" { "22334455" } else { "0011aabb" })).unwrap();
            let meta = InstallMeta { name: Some(name.into()), character: Some(character.into()), ..Default::default() };
            place(&db, &data, "zzz", &staging, &meta, &[]).unwrap();
        }
        let d = db.lock().unwrap();
        let info = crate::live::info(&d, "zzz").unwrap();
        let mut sizes: Vec<usize> = info.groups.iter().map(|g| g.mods.len()).collect();
        sizes.sort();
        assert_eq!(sizes, [1, 2]);
    }

    #[test]
    fn old_split_installs_are_combined() {
        let t = Tmp::new("merge");
        let mods = t.0.join("Mods");
        let db = test_db(&mods);
        let src = crate::model::ModSource { site: "gamebanana".into(), mod_id: 7, file_id: Some(9), ..Default::default() };
        // what an older version made: one mod per folder, the icon turned off by the one-skin rule
        for (folder, label, hash) in [("Yum - Main", "Main", "aaaa1111"), ("DISABLED Yum - Icon", "Icon", "bbbb2222")] {
            let dir = mods.join("Anby").join(folder);
            fs::create_dir_all(&dir).unwrap();
            fs::write(dir.join("a.ini"), format!("[TextureOverride{label}]
hash = {hash}
")).unwrap();
            fs::write(dir.join("preview.jpg"), "img").unwrap();
            let sc = Sidecar { format: 1, name: format!("Yum - {label}"), source: Some(src.clone()), variant: Some(label.into()), preview: Some("preview.jpg".into()), ..Default::default() };
            let d = db.lock().unwrap();
            crate::library::add_folder(&d, "zzz", &dir, Some(sc)).unwrap();
        }
        let list = crate::library::scan(&db, "zzz").unwrap();
        assert_eq!(list.len(), 1, "{list:?}");
        let m = &list[0];
        assert_eq!(m.name, "Yum");
        assert!(m.enabled);
        assert_eq!(m.ini_count, 2);
        let top = mods.join("Anby/Yum");
        assert!(top.join("Main/a.ini").is_file());
        assert!(top.join("Icon/a.ini").is_file());
        assert!(top.join("preview.jpg").is_file());
        assert!(!top.join("Main").join(crate::model::SIDECAR_FILE).exists());
        // only once
        assert_eq!(crate::library::scan(&db, "zzz").unwrap().len(), 1);
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
        let dir = mods.join("Velina Airgid/DISABLED Velina Maid");
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
            // it comes in off; the user turns it on and sets an option
            let first = library::set_enabled(&d, "zzz", std::slice::from_ref(&id), true).unwrap().changed.remove(0);
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
            // it comes back off, and its options return when it is turned on
            assert!(!back.enabled);
            let on = library::set_enabled(&d, "zzz", std::slice::from_ref(&id), true).unwrap().changed.remove(0);
            assert_eq!(ini::user_vars(&t.0, &on.rel_path).unwrap()[0].value, "2");
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
    fn ini_one_folder_down_keeps_its_neighbours() {
        // RoxyOveralls/{resources/Roxy.ini, toggles/, textures/}: the ini loads ../toggles, so the mod is RoxyOveralls
        let t = Tmp::new("roxy");
        let mods = t.0.join("Mods");
        let data = t.0.join("data");
        let db = test_db(&mods);
        let staging = new_staging(&data).unwrap();
        let top = staging.join("RoxyOveralls");
        fs::create_dir_all(top.join("resources")).unwrap();
        fs::create_dir_all(top.join("toggles")).unwrap();
        fs::write(top.join("resources/Roxy.ini"), "[ResourceMenu]\nfilename = ../toggles/Menu.dds\n[CustomShaderMenu]\nvs = ..\\toggles\\draw_2d.hlsl\n").unwrap();
        fs::write(top.join("toggles/Menu.dds"), "dds").unwrap();
        fs::write(top.join("toggles/draw_2d.hlsl"), "hlsl").unwrap();
        let c = find_roots(&staging).unwrap();
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].key, "RoxyOveralls");
        let meta = InstallMeta { name: Some("Roxy - Overalls".into()), ..Default::default() };
        place(&db, &data, "zzz", &staging, &meta, &[]).unwrap();
        let dir = mods.join("Other/DISABLED Roxy - Overalls");
        assert!(dir.join("resources/Roxy.ini").is_file());
        assert!(dir.join("toggles/Menu.dds").is_file());

        // a plain wrapper still unwraps
        let staging = new_staging(&data).unwrap();
        fs::create_dir_all(staging.join("Outer/Inner")).unwrap();
        fs::create_dir_all(staging.join("Outer/extra")).unwrap();
        fs::write(staging.join("Outer/Inner/a.ini"), "[ResourceA]\nfilename = a.dds\n").unwrap();
        assert_eq!(find_roots(&staging).unwrap()[0].key, "Outer/Inner");
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
        assert!(mods.join("Other/DISABLED Burnice Swim/b.ini").is_file());
    }
}
