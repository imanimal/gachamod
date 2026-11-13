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

/// An image in the folder itself: preview.* first, then the first image by name. The runner's own preview file is
/// left out.
fn own_image(dir: &Path) -> Option<PathBuf> {
    let imgs: Vec<PathBuf> = entries(dir).into_iter().filter(|p| is_image(p) && !name_of(p).starts_with(PREVIEW_STEM)).collect();
    imgs.iter().find(|p| p.file_stem().is_some_and(|s| s.eq_ignore_ascii_case("preview"))).or(imgs.first()).cloned()
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

/// Put the downloaded preview into a mod folder as preview.<ext> unless the mod has an image of its own.
fn give_preview(target: &Path, src: Option<&Path>) -> Option<String> {
    let src = src?;
    if !src.is_file() { return None; }
    let inside = src.parent() == Some(target);
    let result = if own_image(target).is_none() {
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

fn place_inner(db: &crate::db::Shared, data_dir: &Path, game: &str, staging: &Path, meta: &InstallMeta, choose: &[String]) -> Result<InstallOutcome> {
    let all = find_roots(staging)?;
    if all.is_empty() {
        return Err(Error::Invalid("No mod found inside. A mod is a folder with at least one .ini file in it".into()));
    }
    let chosen: Vec<Candidate> = if choose.is_empty() {
        if all.len() > 1 { return Ok(InstallOutcome { needs_choice: Some(all), ..Default::default() }); }
        all
    } else {
        let c: Vec<Candidate> = all.into_iter().filter(|c| choose.contains(&c.key)).collect();
        if c.is_empty() { return Err(Error::Invalid("The picked folders aren't in this archive anymore. Try the install again".into())); }
        c
    };

    let base_name = meta.name.clone().filter(|n| !n.trim().is_empty()).unwrap_or_else(|| chosen[0].label.clone());
    let (mods_dir, character, one_skin, old) = {
        let d = lock(db)?;
        let mods_dir = crate::games::mods_dir(&d, game)?;
        let character = meta.character.clone().filter(|c| !c.trim().is_empty()).or_else(|| {
            let hints: Vec<&str> = [meta.category.as_deref(), Some(base_name.as_str())].into_iter().flatten().collect();
            crate::library::infer_character(&d, game, &hints)
        });
        let one_skin = d.setting(&format!("{game}.oneSkin")).ok().flatten().map(|v| v != "0").unwrap_or(true);
        let old = meta.replaces.as_deref().and_then(|id| crate::library::get(&d, game, id).ok());
        (mods_dir, character, one_skin, old)
    };
    let group = sanitize_name(character.as_deref().or(meta.category.as_deref()).filter(|g| !g.trim().is_empty()).unwrap_or("Other"));
    let preview_src = preview_in(staging);
    let mut notes = Vec::new();
    let mut installed = Vec::new();
    let several = chosen.len() > 1;
    let mut turned_off = 0;

    for (i, cand) in chosen.iter().enumerate() {
        let src = if cand.key.is_empty() { staging.to_path_buf() } else { staging.join(&cand.key) };
        let name = if several { format!("{base_name} - {}", cand.label) } else { base_name.clone() };
        let mut sidecar = Sidecar {
            format: 1, id: String::new(), name: name.clone(), character: character.clone(), source: meta.source.clone(),
            version: meta.version.clone().filter(|v| !v.is_empty()), installed_at: crate::db::now(), nsfw: meta.nsfw, ..Default::default()
        };

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
                }
                _ => notes.push(format!("Couldn't move the old copy of {} to the trash, so both copies are there now", o.name)),
            }
        }
        let target = match target {
            Some(t) => t,
            None => {
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
        installed.push(entry);
    }
    if turned_off > 0 {
        let who = character.as_deref().unwrap_or("this character");
        notes.push(format!("Turned off {turned_off} of the variants so only one {who} skin is on"));
    }
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
