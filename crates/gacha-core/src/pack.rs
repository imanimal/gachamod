//! `.gachamod` files: one file holding one or many mods (and optionally a profile) to move between computers or
//! share. A zip (deflate) with `gachamod.json` at the root and each mod under `mods/<n>/`. Owner: MODTOOLS area
//! (docs/spec.md, ".gachamod").

use crate::db::{Db, Shared};
use crate::error::{Error, Result};
use crate::ini::{self, VarValue};
use crate::library;
use crate::model::{ModEntry, Sidecar, SIDECAR_FILE};
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{self, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

pub const EXTENSION: &str = "gachamod";
pub const MANIFEST: &str = "gachamod.json";
pub const FORMAT: u32 = 1;

/// `gachamod.json`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Manifest {
    pub format: u32,
    pub app_version: String,
    pub created_at: i64,
    /// "mods" (a selection) or "profile" (a profile with its mods).
    pub kind: String,
    pub title: String,
    /// One game per file.
    pub game: String,
    pub mods: Vec<PackedMod>,
    pub profile: Option<PackedProfile>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PackedMod {
    /// Folder inside the pack: "mods/0".
    pub dir: String,
    /// Where it lived under Mods, without the DISABLED prefix ("Ellen Joe/Coca Cola").
    pub rel_path: String,
    pub enabled: bool,
    pub sidecar: Sidecar,
    pub vars: Vec<crate::ini::VarValue>,
    pub size: u64,
    pub files: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PackedProfile {
    pub name: String,
    pub icon: Option<String>,
    pub color: Option<String>,
    /// A path inside the pack ("media/banner.jpg") or a remote URL.
    pub banner: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ExportRequest {
    pub game: String,
    /// Mods to pack. Empty with `profile_id` set packs that profile's mods.
    pub mod_ids: Vec<String>,
    pub profile_id: Option<i64>,
    pub include_vars: bool,
    pub title: Option<String>,
    /// Full path of the file to write (the UI asks with a save dialog).
    pub dest: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult { pub path: String, pub size: u64, pub mods: u32 }

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackPreviewMod {
    pub index: u32,
    pub name: String,
    pub character: Option<String>,
    pub rel_path: String,
    pub size: u64,
    pub enabled: bool,
    /// The id of the same mod already in the library (same sidecar id, or same GameBanana mod), if any.
    pub existing: Option<String>,
    pub preview: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackPreview {
    pub path: String,
    pub manifest_ok: bool,
    pub game: String,
    pub kind: String,
    pub title: String,
    pub created_at: i64,
    pub mods: Vec<PackPreviewMod>,
    pub profile: Option<PackedProfile>,
    pub total_size: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ImportOptions {
    /// Indexes of `PackPreview.mods` to bring in (empty means all).
    pub only: Vec<u32>,
    /// "skip", "replace" or "keep_both" for mods already in the library.
    pub on_existing: String,
    /// Make a profile from the pack's profile and switch to it.
    pub apply_profile: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub added: Vec<String>,
    pub replaced: Vec<String>,
    pub skipped: u32,
    pub profile_id: Option<i64>,
    pub notes: Vec<String>,
}

// ── helpers ──

fn lock(db: &Shared) -> std::sync::MutexGuard<'_, Db> { db.lock().unwrap_or_else(|e| e.into_inner()) }

/// The app's data folder: where the database file lives (a temp folder for an in-memory database).
pub(crate) fn data_dir_of(db: &Db) -> PathBuf {
    db.conn.path().filter(|p| !p.is_empty()).and_then(|p| Path::new(p).parent().map(Path::to_path_buf))
        .unwrap_or_else(|| std::env::temp_dir().join("gachamod"))
}

/// Calls the progress callback at most every 100 ms (and always at the end).
struct Throttle<'a> { cb: &'a dyn Fn(u64, u64), done: u64, total: u64, last: Option<Instant> }

impl<'a> Throttle<'a> {
    fn new(cb: &'a dyn Fn(u64, u64), total: u64) -> Self { Throttle { cb, done: 0, total, last: None } }
    fn add(&mut self, n: u64) {
        self.done += n;
        if self.last.is_none_or(|t| t.elapsed() >= Duration::from_millis(100)) {
            self.last = Some(Instant::now());
            (self.cb)(self.done.min(self.total), self.total);
        }
    }
    fn finish(&mut self) { (self.cb)(self.total, self.total); }
}

/// Copy a stream, reporting progress as it goes.
fn copy_with(from: &mut dyn Read, to: &mut dyn Write, t: &mut Throttle) -> io::Result<u64> {
    let mut buf = vec![0u8; 256 * 1024];
    let mut n = 0u64;
    loop {
        let r = match from.read(&mut buf) {
            Ok(0) => return Ok(n),
            Ok(r) => r,
            Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(e),
        };
        to.write_all(&buf[..r])?;
        n += r as u64;
        t.add(r as u64);
    }
}

/// Files never worth packing.
fn junk(name: &str, is_dir: bool) -> bool {
    let l = name.to_ascii_lowercase();
    if is_dir { return l == "shadercache" || l == ".git"; }
    l == "desktop.ini" || l == "thumbs.db" || l.ends_with(".bak") || l == SIDECAR_FILE
}

/// Already compressed: stored as is, since deflating them again only costs time.
fn stored(name: &str) -> bool {
    let l = name.to_ascii_lowercase();
    [".png", ".jpg", ".jpeg", ".webp", ".gif", ".zip", ".7z", ".rar", ".mp4"].iter().any(|e| l.ends_with(e))
}

/// Every file of a mod folder to pack: (absolute path, path inside the mod with forward slashes, size).
fn mod_files(dir: &Path) -> Vec<(PathBuf, String, u64)> {
    let mut out: Vec<(PathBuf, String, u64)> = walkdir::WalkDir::new(dir).follow_links(false).into_iter()
        .filter_entry(|e| e.depth() == 0 || !junk(&e.file_name().to_string_lossy(), e.file_type().is_dir()))
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| {
            let rel = e.path().strip_prefix(dir).ok()?.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/");
            let size = e.metadata().map(|m| m.len()).unwrap_or(0);
            Some((e.path().to_path_buf(), rel, size))
        })
        .collect();
    out.sort_by(|a, b| a.1.cmp(&b.1));
    out
}

/// "Ellen Joe/DISABLED Coca Cola" -> "Ellen Joe/Coca Cola".
fn clean_rel(rel: &str) -> String {
    rel.replace('\\', "/").split('/').filter(|s| !s.is_empty()).map(library::display_folder).collect::<Vec<_>>().join("/")
}

/// A name Windows accepts as a folder name.
fn safe_name(s: &str) -> String {
    let cleaned: String = s.chars().map(|c| if "<>:\"/\\|?*".contains(c) || c.is_control() { '_' } else { c }).collect();
    let t = cleaned.trim().trim_end_matches(['.', ' ']).to_string();
    if t.is_empty() || t == "." || t == ".." { "Mod".into() } else { t }
}

/// A local file behind a profile banner (a plain path or an asset URL), when there is one.
fn local_banner(banner: &str) -> Option<PathBuf> {
    let b = banner.trim();
    let path = if let Some(rest) = b.strip_prefix("asset://localhost/").or_else(|| b.strip_prefix("http://asset.localhost/")).or_else(|| b.strip_prefix("https://asset.localhost/")) {
        percent_decode(rest)
    } else if b.starts_with("http://") || b.starts_with("https://") || b.starts_with("data:") {
        return None;
    } else { b.to_string() };
    let p = PathBuf::from(path);
    p.is_file().then_some(p)
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            let hex = |c: u8| (c as char).to_digit(16);
            if let (Some(h), Some(l)) = (hex(b[i + 1]), hex(b[i + 2])) { out.push((h * 16 + l) as u8); i += 3; continue; }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn ext_of(name: &str) -> String {
    Path::new(name).extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default()
}

fn is_image(name: &str) -> bool { matches!(ext_of(name).as_str(), "png" | "jpg" | "jpeg" | "webp" | "gif") }

// ── export ──

/// One mod ready to pack.
struct ExportItem { dir: PathBuf, rel_path: String, enabled: bool, sidecar: Sidecar, vars: Vec<VarValue> }

fn sidecar_of(m: &ModEntry) -> Sidecar {
    let mut s = library::read_sidecar(Path::new(&m.path)).unwrap_or_else(|| Sidecar {
        format: 1, id: m.id.clone(), name: m.name.clone(), character: m.character.clone(), source: m.source.clone(),
        version: m.version.clone(), installed_at: m.installed_at, tags: m.tags.clone(), notes: m.notes.clone(),
        favorite: m.favorite, nsfw: m.nsfw, preview: None, ..Default::default()
    });
    if s.id.is_empty() { s.id = m.id.clone(); }
    if s.name.is_empty() { s.name = m.name.clone(); }
    if s.format == 0 { s.format = 1; }
    // a character guessed from the folder isn't in the sidecar, and the other PC may use other folders
    if s.character.as_deref().is_none_or(|c| c.trim().is_empty()) { s.character = m.character.clone(); }
    s
}

pub fn export(db: &Shared, req: &ExportRequest, progress: &dyn Fn(u64, u64)) -> Result<ExportResult> {
    let dest = PathBuf::from(req.dest.trim());
    if req.dest.trim().is_empty() { return Err(Error::Invalid("Pick where to save the file".into())); }
    let game_short = crate::games::def(&req.game).map(|g| g.short).unwrap_or("Game");
    // read what to pack, holding the database only for that
    let (items, profile, banner, title) = {
        let db = lock(db);
        let mut ids = req.mod_ids.clone();
        let mut profile = None;
        let mut banner = None;
        if let Some(pid) = req.profile_id {
            let p = crate::profiles::get(&db, pid)?;
            if ids.is_empty() { ids = crate::profiles::members(&db, pid)?; }
            let mut packed = PackedProfile { name: p.name.clone(), icon: p.icon.clone(), color: p.color.clone(), banner: p.banner.clone(), description: p.description.clone() };
            if let Some(local) = p.banner.as_deref().and_then(local_banner) {
                let ext = local.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_else(|| "jpg".into());
                packed.banner = Some(format!("media/banner.{ext}"));
                banner = Some((local, format!("media/banner.{ext}")));
            }
            profile = Some(packed);
        }
        if ids.is_empty() { return Err(Error::Invalid("There are no mods to export. Pick at least one".into())); }
        let importer = crate::games::importer_dir(&db, &req.game).ok();
        let mut items = Vec::new();
        for id in &ids {
            let m = library::get(&db, &req.game, id)?;
            let mut vars = Vec::new();
            if req.include_vars {
                vars = library::saved_vars(&db, &req.game, id).unwrap_or_default();
                if vars.is_empty() && m.enabled {
                    if let Some(imp) = &importer { vars = ini::user_vars(imp, &m.rel_path).unwrap_or_default(); }
                }
            }
            items.push(ExportItem { dir: PathBuf::from(&m.path), rel_path: clean_rel(&m.rel_path), enabled: m.enabled, sidecar: sidecar_of(&m), vars });
        }
        let title = req.title.clone().filter(|t| !t.trim().is_empty())
            .or_else(|| profile.as_ref().map(|p| p.name.clone()))
            .or_else(|| (items.len() == 1).then(|| items[0].sidecar.name.clone()))
            .unwrap_or_else(|| format!("{game_short} mods"));
        (items, profile, banner, title)
    };
    let manifest = Manifest {
        format: FORMAT, app_version: crate::APP_VERSION.into(), created_at: crate::db::now(),
        kind: if profile.is_some() { "profile".into() } else { "mods".into() },
        title, game: req.game.clone(), mods: Vec::new(), profile,
    };
    write_pack(&dest, manifest, &items, banner, progress)
}

/// Write the zip: the manifest first, then each mod under `mods/<n>/` with its sidecar, then the banner.
/// Goes to "<dest>.part" and is renamed when complete.
fn write_pack(dest: &Path, mut manifest: Manifest, items: &[ExportItem], banner: Option<(PathBuf, String)>, progress: &dyn Fn(u64, u64)) -> Result<ExportResult> {
    let files: Vec<Vec<(PathBuf, String, u64)>> = items.iter().map(|i| mod_files(&i.dir)).collect();
    for (n, (item, list)) in items.iter().zip(&files).enumerate() {
        if !item.dir.is_dir() { return Err(Error::Invalid(format!("{}'s folder isn't there any more. Rescan, then try again", item.sidecar.name))); }
        manifest.mods.push(PackedMod {
            dir: format!("mods/{n}"), rel_path: item.rel_path.clone(), enabled: item.enabled, sidecar: item.sidecar.clone(),
            vars: item.vars.clone(), size: list.iter().map(|f| f.2).sum(), files: list.len() as u32,
        });
    }
    let total: u64 = manifest.mods.iter().map(|m| m.size).sum::<u64>() + banner.as_ref().and_then(|b| fs::metadata(&b.0).ok()).map(|m| m.len()).unwrap_or(0);
    if let Some(parent) = dest.parent() { if !parent.as_os_str().is_empty() { fs::create_dir_all(parent)?; } }
    let mut part = dest.as_os_str().to_owned();
    part.push(".part");
    let part = PathBuf::from(part);
    let result = (|| -> Result<()> {
        let mut z = zip::ZipWriter::new(BufWriter::with_capacity(1 << 20, File::create(&part)?));
        let deflate = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated).compression_level(Some(6));
        let store = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        let big = |o: zip::write::SimpleFileOptions, size: u64| o.large_file(size >= 0xF000_0000);
        let zerr = |e: zip::result::ZipError| Error::Archive(format!("Couldn't write the file ({e})"));
        z.start_file(MANIFEST, deflate).map_err(zerr)?;
        z.write_all(serde_json::to_string_pretty(&manifest)?.as_bytes())?;
        let mut t = Throttle::new(progress, total);
        for (pm, list) in manifest.mods.iter().zip(&files) {
            z.start_file(format!("{}/{SIDECAR_FILE}", pm.dir), deflate).map_err(zerr)?;
            z.write_all(serde_json::to_string_pretty(&pm.sidecar)?.as_bytes())?;
            for (abs, rel, size) in list {
                let opts = big(if stored(rel) { store } else { deflate }, *size);
                z.start_file(format!("{}/{rel}", pm.dir), opts).map_err(zerr)?;
                let mut f = File::open(abs)?;
                copy_with(&mut f, &mut z, &mut t)?;
            }
        }
        if let Some((abs, name)) = &banner {
            z.start_file(name.as_str(), store).map_err(zerr)?;
            copy_with(&mut File::open(abs)?, &mut z, &mut t)?;
        }
        let mut w = z.finish().map_err(zerr)?;
        w.flush()?;
        drop(w);
        t.finish();
        Ok(())
    })();
    if let Err(e) = result {
        let _ = fs::remove_file(&part);
        return Err(e);
    }
    if let Err(e) = ini::rename_retry(&part, dest) {
        let _ = fs::remove_file(&part);
        return Err(e);
    }
    let size = fs::metadata(dest).map(|m| m.len()).unwrap_or(0);
    Ok(ExportResult { path: dest.to_string_lossy().into_owned(), size, mods: items.len() as u32 })
}

// ── reading packs ──

fn open_zip(path: &Path) -> Result<zip::ZipArchive<File>> {
    let f = File::open(path).map_err(|e| if e.kind() == io::ErrorKind::NotFound { Error::Invalid("That file isn't there any more".into()) } else { e.into() })?;
    zip::ZipArchive::new(f).map_err(|_| Error::Archive("This isn't a .gachamod file, or it is damaged".into()))
}

/// Read and check `gachamod.json`.
fn read_manifest(z: &mut zip::ZipArchive<File>) -> Result<Manifest> {
    let mut text = String::new();
    {
        let mut f = z.by_name(MANIFEST).map_err(|_| Error::Archive("This isn't a .gachamod file: it has no gachamod.json inside".into()))?;
        if f.size() > 16 * 1024 * 1024 { return Err(Error::Archive("This .gachamod file's list of mods is too large to read".into())); }
        f.read_to_string(&mut text).map_err(|_| Error::Archive("This .gachamod file is damaged. Ask for it again".into()))?;
    }
    let m: Manifest = serde_json::from_str(text.trim_start_matches('\u{feff}')).map_err(|_| Error::Archive("This .gachamod file's list of mods is damaged".into()))?;
    if m.format == 0 { return Err(Error::Archive("This .gachamod file's list of mods is damaged".into())); }
    if m.format > FORMAT {
        return Err(Error::Invalid(format!("This file was made by a newer gachamod (pack format {}). Update gachamod, then open it again", m.format)));
    }
    Ok(m)
}

fn game_name(game: &str) -> String { crate::games::def(game).map(|g| g.name.to_string()).unwrap_or_else(|| game.to_string()) }

/// The game must be known and have a Mods folder.
fn check_game(db: &Db, game: &str) -> Result<()> {
    if crate::games::def(game).is_none() { return Err(Error::Invalid(format!("This pack is for a game gachamod doesn't know (\"{game}\")"))); }
    if crate::games::paths(db, game)?.mods_dir.is_none() {
        return Err(Error::NotSetUp(format!("This pack is for {}, which isn't set up yet. Set it up in Settings, then open the pack again", game_name(game))));
    }
    Ok(())
}

fn mods_or_empty(db: &Db, game: &str) -> Vec<ModEntry> { library::list(db, game).unwrap_or_default() }

/// The library mod a packed mod is a copy of: same sidecar id, or same GameBanana mod.
fn find_existing<'a>(pm: &PackedMod, library: &'a [ModEntry]) -> Option<&'a ModEntry> {
    let id = pm.sidecar.id.as_str();
    library.iter().find(|m| !id.is_empty() && m.id == id).or_else(|| {
        let src = pm.sidecar.source.as_ref().filter(|s| s.mod_id != 0)?;
        library.iter().find(|m| m.source.as_ref().is_some_and(|s| s.mod_id == src.mod_id && s.site == src.site))
    })
}

/// The zip's folder prefix for a packed mod ("mods/0/"), checked to stay inside the pack.
fn dir_prefix(pm: &PackedMod) -> Option<String> {
    let p = crate::archive::safe_relative(&pm.dir)?;
    Some(format!("{}/", p.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/")))
}

/// The entry to show as a packed mod's preview, or a remote URL.
enum PreviewSrc { Entry(usize, String), Url(String) }

fn find_preview(pm: &PackedMod, names: &[(usize, String)]) -> Option<PreviewSrc> {
    if let Some(p) = pm.sidecar.preview.as_deref() { if p.starts_with("https://") || p.starts_with("http://") { return Some(PreviewSrc::Url(p.to_string())); } }
    let prefix = dir_prefix(pm)?;
    let root: Vec<&(usize, String)> = names.iter().filter(|(_, n)| n.starts_with(&prefix) && !n[prefix.len()..].contains('/') && n.len() > prefix.len()).collect();
    let file = |(_, n): &&(usize, String)| n[prefix.len()..].to_string();
    let pick = root.iter().find(|e| { let f = file(e).to_ascii_lowercase(); f.starts_with("preview.") && is_image(&f) })
        .or_else(|| pm.sidecar.preview.as_deref().and_then(|p| root.iter().find(|e| file(e).eq_ignore_ascii_case(p))))
        .or_else(|| root.iter().find(|e| is_image(&file(e))));
    pick.map(|(i, n)| PreviewSrc::Entry(*i, n.clone()))
}

fn entry_names(z: &mut zip::ZipArchive<File>) -> Vec<(usize, String)> {
    (0..z.len()).filter_map(|i| z.by_index_raw(i).ok().filter(|f| f.is_file()).map(|f| (i, f.name().replace('\\', "/")))).collect()
}

/// A short id for a pack file (its path, size and time), for its preview cache folder.
fn pack_key(path: &Path) -> String {
    use sha2::{Digest, Sha256};
    let meta = fs::metadata(path).ok();
    let mut h = Sha256::new();
    h.update(path.to_string_lossy().as_bytes());
    h.update(meta.as_ref().map(|m| m.len()).unwrap_or(0).to_le_bytes());
    let t = meta.and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
    h.update(t.to_le_bytes());
    hex::encode(&h.finalize()[..8])
}

fn preview_of(z: &mut zip::ZipArchive<File>, pm: &PackedMod, n: usize, names: &[(usize, String)], cache: &Path) -> Option<String> {
    match find_preview(pm, names)? {
        PreviewSrc::Url(u) => Some(u),
        PreviewSrc::Entry(i, name) => {
            let out = cache.join(format!("{n}.{}", ext_of(&name)));
            if !out.is_file() {
                let mut f = z.by_index(i).ok()?;
                if f.size() > 32 * 1024 * 1024 { return None; }
                fs::create_dir_all(cache).ok()?;
                let mut w = File::create(&out).ok()?;
                if io::copy(&mut f, &mut w).is_err() { drop(w); let _ = fs::remove_file(&out); return None; }
            }
            Some(out.to_string_lossy().into_owned())
        }
    }
}

pub fn inspect(db: &Db, path: &Path) -> Result<PackPreview> {
    let mut z = open_zip(path)?;
    let manifest = read_manifest(&mut z)?;
    check_game(db, &manifest.game)?;
    let library = mods_or_empty(db, &manifest.game);
    let names = entry_names(&mut z);
    let cache = data_dir_of(db).join("cache").join("packs").join(pack_key(path));
    let mut mods = Vec::new();
    for (n, pm) in manifest.mods.iter().enumerate() {
        let preview = preview_of(&mut z, pm, n, &names, &cache);
        mods.push(PackPreviewMod {
            index: n as u32,
            name: if pm.sidecar.name.is_empty() { pm.rel_path.rsplit('/').next().unwrap_or("Mod").to_string() } else { pm.sidecar.name.clone() },
            character: pm.sidecar.character.clone(), rel_path: pm.rel_path.clone(), size: pm.size, enabled: pm.enabled,
            existing: find_existing(pm, &library).map(|m| m.id.clone()), preview,
        });
    }
    Ok(PackPreview {
        path: path.to_string_lossy().into_owned(), manifest_ok: true, game: manifest.game.clone(), kind: manifest.kind.clone(),
        title: manifest.title.clone(), created_at: manifest.created_at, total_size: manifest.mods.iter().map(|m| m.size).sum(),
        mods, profile: manifest.profile.clone(),
    })
}

// ── import ──

/// Move a folder: a rename, or copy then delete when it crosses drives (os error 17).
pub(crate) fn move_dir(from: &Path, to: &Path) -> Result<()> {
    match ini::rename_retry(from, to) {
        Ok(()) => Ok(()),
        Err(Error::Io(e)) if e.raw_os_error() == Some(17) => {
            copy_dir(from, to)?;
            fs::remove_dir_all(from)?;
            Ok(())
        }
        Err(e) => Err(e),
    }
}

fn copy_dir(from: &Path, to: &Path) -> Result<()> {
    fs::create_dir_all(to)?;
    for e in walkdir::WalkDir::new(from).follow_links(false).min_depth(1) {
        let e = e.map_err(|e| Error::Io(e.into()))?;
        let Ok(rel) = e.path().strip_prefix(from) else { continue };
        let target = to.join(rel);
        if e.file_type().is_dir() { fs::create_dir_all(&target)?; } else if e.file_type().is_file() { fs::copy(e.path(), &target)?; }
    }
    Ok(())
}

/// `parent/name`, or `parent/name (2)` and so on when that name (on or off) is taken.
fn free_name(parent: &Path, name: &str) -> String {
    let taken = |n: &str| parent.join(n).exists() || parent.join(format!("{}{n}", crate::model::DISABLED_PREFIX)).exists();
    if !taken(name) { return name.to_string(); }
    (2..1000).map(|i| format!("{name} ({i})")).find(|n| !taken(n)).unwrap_or_else(|| format!("{name} ({})", library::new_id()))
}

struct Ctx<'a> { db: &'a Shared, game: &'a str, mods_dir: PathBuf, importer_dir: Option<PathBuf>, data_dir: PathBuf, staging: PathBuf }

enum Outcome { Added(String), Replaced(String), Skipped }

/// Place one packed mod. Errors are about this mod only.
#[allow(clippy::too_many_arguments)]
fn import_one(ctx: &Ctx, z: &mut zip::ZipArchive<File>, names: &[(usize, String)], n: usize, pm: &PackedMod, existing: Option<&ModEntry>,
    mode: &str, notes: &mut Vec<String>, t: &mut Throttle) -> Result<Outcome> {
    if existing.is_some() && !matches!(mode, "replace" | "keep_both") { return Ok(Outcome::Skipped); }
    let prefix = dir_prefix(pm).ok_or_else(|| Error::Archive("its folder in the pack points outside the pack".into()))?;
    let display = if pm.sidecar.name.trim().is_empty() { pm.rel_path.rsplit('/').next().unwrap_or("Mod").to_string() } else { pm.sidecar.name.clone() };

    // 1. extract to staging
    let stage = ctx.staging.join(n.to_string());
    fs::create_dir_all(&stage)?;
    let mut refused = 0;
    for (i, name) in names.iter().filter(|(_, nm)| nm.starts_with(&prefix)) {
        let rest = &name[prefix.len()..];
        let Some(rel) = crate::archive::safe_relative(rest) else { refused += 1; continue };
        if crate::archive::safe_relative(name).is_none() { refused += 1; continue; }
        let target = stage.join(&rel);
        if let Some(p) = target.parent() { fs::create_dir_all(p)?; }
        let mut f = z.by_index(*i).map_err(|_| Error::Archive("the pack is damaged. Ask for it again".into()))?;
        let mut out = File::create(&target)?;
        copy_with(&mut f, &mut out, t).map_err(|e| if matches!(e.kind(), io::ErrorKind::InvalidData | io::ErrorKind::UnexpectedEof) { Error::Archive("the pack is damaged. Ask for it again".into()) } else { e.into() })?;
    }
    if refused > 0 { notes.push(format!("Left out {refused} files from {display} that pointed outside its folder")); }

    // 2. its sidecar
    let mut sidecar = pm.sidecar.clone();
    if sidecar.id.trim().is_empty() || (existing.is_some() && mode == "keep_both") { sidecar.id = library::new_id(); }
    if sidecar.name.trim().is_empty() { sidecar.name = display.clone(); }
    if sidecar.installed_at == 0 { sidecar.installed_at = crate::db::now(); }
    library::write_sidecar(&stage, &sidecar)?;

    // 3. where it goes
    let rel = crate::archive::safe_relative(&clean_rel(&pm.rel_path)).map(|p| p.components().map(|c| safe_name(&c.as_os_str().to_string_lossy())).collect::<Vec<_>>())
        .filter(|v| !v.is_empty()).unwrap_or_else(|| vec![safe_name(&display)]);
    let (base, groups) = rel.split_last().map(|(b, g)| (b.clone(), g.to_vec())).unwrap_or_else(|| (safe_name(&display), Vec::new()));
    let mut parent = ctx.mods_dir.clone();
    for g in &groups { parent.push(g); }

    // 4. the old copy goes to the trash first when replacing
    let mut replaced = false;
    if let (Some(old), "replace") = (existing, mode) {
        let db = lock(ctx.db);
        library::remove(&db, &ctx.data_dir, ctx.game, std::slice::from_ref(&old.id), "replaced")?;
        replaced = true;
    }

    // 5. move it in
    fs::create_dir_all(&parent)?;
    let free = free_name(&parent, &base);
    let folder = if pm.enabled { free.clone() } else { format!("{}{free}", crate::model::DISABLED_PREFIX) };
    let target = parent.join(&folder);
    move_dir(&stage, &target)?;
    let new_rel = groups.iter().cloned().chain(std::iter::once(folder)).collect::<Vec<_>>().join("/");

    // 6. register it
    let id = {
        let db = lock(ctx.db);
        match library::add_folder(&db, ctx.game, &target, Some(sidecar.clone())) {
            Ok(m) => m.id,
            // the next scan picks it up through its sidecar
            Err(Error::Todo(_)) => sidecar.id.clone(),
            Err(e) => { notes.push(format!("{display} is in the Mods folder but couldn't be added to the list ({e}). Rescan to see it")); sidecar.id.clone() }
        }
    };

    // 7. its saved option values
    if !pm.vars.is_empty() {
        let running = crate::launch::running(ctx.game);
        let written = match (&ctx.importer_dir, pm.enabled && !running) {
            (Some(imp), true) => ini::set_user_vars(imp, &new_rel, &pm.vars).map_err(|e| notes.push(format!("Couldn't save {display}'s options: {e}"))).is_ok(),
            _ => false,
        };
        if !written {
            let db = lock(ctx.db);
            if let Err(e) = library::stash_vars(&db, ctx.game, &id, &pm.vars) { notes.push(format!("Couldn't keep {display}'s options: {e}")); }
        }
    }
    Ok(if replaced { Outcome::Replaced(id) } else { Outcome::Added(id) })
}

pub fn import(db: &Shared, path: &Path, opts: &ImportOptions, progress: &dyn Fn(u64, u64)) -> Result<ImportResult> {
    let mut z = open_zip(path)?;
    let manifest = read_manifest(&mut z)?;
    let (mods_dir, importer_dir, library_mods, data_dir) = {
        let db = lock(db);
        check_game(&db, &manifest.game)?;
        (crate::games::mods_dir(&db, &manifest.game)?, crate::games::importer_dir(&db, &manifest.game).ok(), mods_or_empty(&db, &manifest.game), data_dir_of(&db))
    };
    import_with(db, &mut z, &manifest, opts, Ctx { db, game: &manifest.game, mods_dir, importer_dir, staging: data_dir.join("staging").join(format!("pack-{}", library::new_id())), data_dir }, &library_mods, progress)
}

fn import_with(db: &Shared, z: &mut zip::ZipArchive<File>, manifest: &Manifest, opts: &ImportOptions, ctx: Ctx, library_mods: &[ModEntry], progress: &dyn Fn(u64, u64)) -> Result<ImportResult> {
    let names = entry_names(z);
    let mut chosen: Vec<usize> = if opts.only.is_empty() { (0..manifest.mods.len()).collect() } else {
        opts.only.iter().map(|&i| i as usize).filter(|&i| i < manifest.mods.len()).collect()
    };
    chosen.sort_unstable();
    chosen.dedup();
    let total: u64 = chosen.iter().filter_map(|&i| dir_prefix(&manifest.mods[i])).map(|p| {
        names.iter().filter(|(_, n)| n.starts_with(&p)).filter_map(|(i, _)| z.by_index_raw(*i).ok().map(|f| f.size())).sum::<u64>()
    }).sum();
    let mode = if opts.on_existing.is_empty() { "skip" } else { opts.on_existing.as_str() };
    let mut t = Throttle::new(progress, total);
    let mut res = ImportResult::default();
    for &n in &chosen {
        let pm = &manifest.mods[n];
        let existing = find_existing(pm, library_mods);
        let name = if pm.sidecar.name.is_empty() { pm.rel_path.clone() } else { pm.sidecar.name.clone() };
        match import_one(&ctx, z, &names, n, pm, existing, mode, &mut res.notes, &mut t) {
            Ok(Outcome::Added(id)) => res.added.push(id),
            Ok(Outcome::Replaced(id)) => res.replaced.push(id),
            Ok(Outcome::Skipped) => res.skipped += 1,
            Err(e) => res.notes.push(format!("Couldn't import {name}: {e}")),
        }
        let _ = fs::remove_dir_all(ctx.staging.join(n.to_string()));
    }
    let _ = fs::remove_dir(&ctx.staging);
    t.finish();

    if opts.apply_profile {
        if let Some(pp) = &manifest.profile {
            match make_profile(db, z, &names, ctx.game, pp, &ctx.data_dir) {
                Ok(id) => res.profile_id = Some(id),
                Err(e) => res.notes.push(format!("Couldn't make the profile {}: {e}", pp.name)),
            }
        }
    }
    if !res.added.is_empty() || !res.replaced.is_empty() { crate::devtools::mark_changed(ctx.game); }
    Ok(res)
}

/// Create the pack's profile (from what is on now, which includes the imported mods), dress it and switch to it.
fn make_profile(db: &Shared, z: &mut zip::ZipArchive<File>, names: &[(usize, String)], game: &str, pp: &PackedProfile, data_dir: &Path) -> Result<i64> {
    let banner = match pp.banner.as_deref() {
        Some(b) if b.starts_with("https://") || b.starts_with("http://") => Some(b.to_string()),
        Some(b) => names.iter().find(|(_, n)| n == b && n.starts_with("media/") && crate::archive::safe_relative(n).is_some()).and_then(|(i, n)| {
            let dir = data_dir.join("media").join("banners");
            fs::create_dir_all(&dir).ok()?;
            let out = dir.join(format!("{}.{}", library::new_id(), ext_of(n)));
            let mut f = z.by_index(*i).ok()?;
            let mut w = File::create(&out).ok()?;
            io::copy(&mut f, &mut w).ok()?;
            Some(out.to_string_lossy().into_owned())
        }),
        None => None,
    };
    let db = lock(db);
    let base = if pp.name.trim().is_empty() { "Imported".to_string() } else { pp.name.trim().to_string() };
    let mut created = None;
    for i in 1..20 {
        let name = if i == 1 { base.clone() } else { format!("{base} ({i})") };
        match crate::profiles::create(&db, game, &name, None) {
            Ok(p) => { created = Some(p); break; }
            Err(Error::Db(e)) if e.to_ascii_uppercase().contains("UNIQUE") => continue,
            Err(e) => return Err(e),
        }
    }
    let p = created.ok_or_else(|| Error::Conflict(format!("A profile named {base} already exists")))?;
    let patch = crate::model::ProfilePatch { name: None, icon: pp.icon.clone(), color: pp.color.clone(), banner, description: pp.description.clone(), hotkey: None };
    crate::profiles::update(&db, p.id, &patch)?;
    crate::profiles::activate(&db, p.id)?;
    Ok(p.id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    struct Env { root: PathBuf, db: Shared, mods: PathBuf, importer: PathBuf }
    impl Drop for Env { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.root); } }

    fn env(name: &str) -> Env {
        let root = std::env::temp_dir().join(format!("gachamod-pack-{name}-{}", library::new_id()));
        let importer = root.join("ZZMI");
        let mods = importer.join("Mods");
        fs::create_dir_all(&mods).unwrap();
        let db = Db::open(&root.join("data").join("gachamod.sqlite")).unwrap();
        crate::games::save_paths(&db, "zzz", &crate::games::GamePaths { importer_dir: Some(importer.to_string_lossy().into()), mods_dir: Some(mods.to_string_lossy().into()), ..Default::default() }).unwrap();
        Env { root, db: Arc::new(Mutex::new(db)), mods, importer }
    }

    fn make_mod(dir: &Path, id: &str, name: &str) -> ExportItem {
        fs::create_dir_all(dir.join("Textures")).unwrap();
        fs::write(dir.join("mod.ini"), "[Constants]\nglobal persist $swapvar = 0\n[TextureOverrideA]\nhash = 12345678\n").unwrap();
        fs::write(dir.join("Textures/a.dds"), vec![7u8; 5000]).unwrap();
        fs::write(dir.join("preview.png"), b"\x89PNG fake").unwrap();
        fs::write(dir.join("desktop.ini"), "junk").unwrap();
        fs::write(dir.join("old.bak"), "junk").unwrap();
        fs::create_dir_all(dir.join("ShaderCache")).unwrap();
        fs::write(dir.join("ShaderCache/x.bin"), "junk").unwrap();
        let sidecar = Sidecar { format: 1, id: id.into(), name: name.into(), character: Some("Ellen Joe".into()), ..Default::default() };
        library::write_sidecar(dir, &sidecar).unwrap();
        ExportItem { dir: dir.to_path_buf(), rel_path: clean_rel(&dir.file_name().unwrap().to_string_lossy()), enabled: true, sidecar,
            vars: vec![VarValue { ini: "mod.ini".into(), var: "swapvar".into(), value: "1".into() }] }
    }

    fn manifest(game: &str) -> Manifest {
        Manifest { format: FORMAT, app_version: "test".into(), created_at: 1, kind: "mods".into(), title: "Test".into(), game: game.into(), mods: vec![], profile: None }
    }

    fn entry(e: &Env, id: &str, rel: &str) -> ModEntry {
        ModEntry { id: id.into(), game: "zzz".into(), name: rel.into(), folder: rel.into(), rel_path: rel.into(), path: e.mods.join(rel).to_string_lossy().into(), enabled: true, ..Default::default() }
    }

    fn import_test(e: &Env, pack: &Path, mode: &str, existing: &[ModEntry]) -> ImportResult {
        let mut z = open_zip(pack).unwrap();
        let m = read_manifest(&mut z).unwrap();
        let data = e.root.join("data");
        let ctx = Ctx { db: &e.db, game: "zzz", mods_dir: e.mods.clone(), importer_dir: Some(e.importer.clone()), staging: data.join("staging").join("t"), data_dir: data };
        import_with(&e.db, &mut z, &m, &ImportOptions { only: vec![], on_existing: mode.into(), apply_profile: false }, ctx, existing, &|_, _| {}).unwrap()
    }

    fn build_pack(e: &Env) -> PathBuf {
        let src = e.root.join("src");
        let a = make_mod(&src.join("Coca Cola"), "a".repeat(32).as_str(), "Coca Cola");
        let mut b = make_mod(&src.join("DISABLED Bunny"), "b".repeat(32).as_str(), "Bunny");
        b.enabled = false;
        let dest = e.root.join("out").join("Ellen skins.gachamod");
        let calls = std::cell::Cell::new(0);
        let r = write_pack(&dest, manifest("zzz"), &[a, b], None, &|d, t| { assert!(d <= t); calls.set(calls.get() + 1); }).unwrap();
        assert!(calls.get() >= 1);
        assert_eq!(r.mods, 2);
        assert!(dest.is_file());
        assert!(!e.root.join("out").join("Ellen skins.gachamod.part").exists());
        dest
    }

    #[test]
    fn export_inspect_import_round_trip() {
        let e = env("trip");
        let pack = build_pack(&e);
        // manifest first, junk left out, no DISABLED in stored paths
        let mut z = open_zip(&pack).unwrap();
        assert_eq!(z.by_index(0).unwrap().name(), MANIFEST);
        let names: Vec<String> = entry_names(&mut z).into_iter().map(|(_, n)| n).collect();
        assert!(names.contains(&"mods/0/mod.ini".to_string()));
        assert!(names.contains(&"mods/0/.gachamod.json".to_string()));
        assert!(names.iter().all(|n| !n.contains("desktop.ini") && !n.ends_with(".bak") && !n.contains("ShaderCache") && !n.contains("DISABLED")), "{names:?}");
        assert_eq!(z.by_name("mods/0/preview.png").unwrap().compression(), zip::CompressionMethod::Stored);
        assert_eq!(z.by_name("mods/0/Textures/a.dds").unwrap().compression(), zip::CompressionMethod::Deflated);
        drop(z);

        let preview = inspect(&lock(&e.db), &pack).unwrap();
        assert_eq!(preview.game, "zzz");
        assert_eq!(preview.mods.len(), 2);
        assert_eq!(preview.mods[1].rel_path, "Bunny");
        assert!(!preview.mods[1].enabled);
        let img = preview.mods[0].preview.clone().unwrap();
        assert!(Path::new(&img).is_file(), "{img}");

        let r = import_test(&e, &pack, "skip", &[]);
        assert_eq!(r.added.len(), 2, "{:?}", r.notes);
        assert!(e.mods.join("Coca Cola/mod.ini").is_file());
        assert!(e.mods.join("Coca Cola/Textures/a.dds").is_file());
        assert!(e.mods.join("DISABLED Bunny/mod.ini").is_file());
        assert_eq!(library::read_sidecar(&e.mods.join("Coca Cola")).unwrap().id, "a".repeat(32));
        // the enabled mod's value went to d3dx_user.ini
        assert_eq!(ini::user_vars(&e.importer, "Coca Cola").unwrap()[0].value, "1");
        assert!(!e.root.join("data/staging/t").exists());
    }

    #[test]
    fn skip_and_keep_both_on_clash() {
        let e = env("clash");
        let pack = build_pack(&e);
        assert_eq!(import_test(&e, &pack, "skip", &[]).added.len(), 2);
        let existing = [entry(&e, &"a".repeat(32), "Coca Cola")];
        let r = import_test(&e, &pack, "skip", &existing);
        assert_eq!(r.skipped, 1);
        // Bunny has no library row in this test, so it comes in again beside the first copy
        assert!(e.mods.join("DISABLED Bunny (2)").is_dir());
        let r = import_test(&e, &pack, "keep_both", &existing);
        assert_eq!(r.added.len(), 2);
        assert!(e.mods.join("Coca Cola (2)/mod.ini").is_file());
        let copy = library::read_sidecar(&e.mods.join("Coca Cola (2)")).unwrap();
        assert_ne!(copy.id, "a".repeat(32));
        assert_eq!(copy.name, "Coca Cola");
    }

    #[test]
    fn replace_sends_old_copy_to_trash() {
        let e = env("replace");
        let pack = build_pack(&e);
        assert_eq!(import_test(&e, &pack, "skip", &[]).added.len(), 2);
        fs::write(e.mods.join("Coca Cola/old.txt"), "old").unwrap();
        let existing = [entry(&e, &"a".repeat(32), "Coca Cola")];
        let r = import_test(&e, &pack, "replace", &existing);
        assert_eq!(r.replaced.len(), 1, "{:?}", r.notes);
        assert!(e.mods.join("Coca Cola/mod.ini").is_file());
        assert!(!e.mods.join("Coca Cola/old.txt").exists());
    }

    #[test]
    fn crafted_zip_cannot_escape() {
        let e = env("slip");
        let pack = e.root.join("evil.gachamod");
        {
            let mut z = zip::ZipWriter::new(File::create(&pack).unwrap());
            let o = zip::write::SimpleFileOptions::default();
            let mut m = manifest("zzz");
            m.mods.push(PackedMod { dir: "mods/0".into(), rel_path: "../../Escaped".into(), enabled: true, sidecar: Sidecar { name: "Evil".into(), ..Default::default() }, ..Default::default() });
            m.mods.push(PackedMod { dir: "../outside".into(), rel_path: "X".into(), enabled: true, ..Default::default() });
            z.start_file(MANIFEST, o).unwrap();
            z.write_all(serde_json::to_string(&m).unwrap().as_bytes()).unwrap();
            z.start_file("mods/0/ok.ini", o).unwrap();
            z.write_all(b"[Key]\n").unwrap();
            z.start_file("mods/0/../../../evil.txt", o).unwrap();
            z.write_all(b"no").unwrap();
            z.start_file("mods/0/..\\..\\evil2.txt", o).unwrap();
            z.write_all(b"no").unwrap();
            z.finish().unwrap();
        }
        let r = import_test(&e, &pack, "skip", &[]);
        assert_eq!(r.added.len(), 1, "{:?}", r.notes);
        assert!(r.notes.iter().any(|n| n.contains("outside")), "{:?}", r.notes);
        assert!(e.mods.join("Evil/ok.ini").is_file());
        for p in [e.root.join("evil.txt"), e.importer.join("evil.txt"), e.mods.join("evil.txt"), e.root.join("evil2.txt"), e.root.join("data/evil.txt"), e.root.join("Escaped")] {
            assert!(!p.exists(), "{}", p.display());
        }
    }

    #[test]
    fn refuses_newer_format_and_unknown_games() {
        let e = env("format");
        let write = |m: &Manifest, p: &Path| {
            let mut z = zip::ZipWriter::new(File::create(p).unwrap());
            z.start_file(MANIFEST, zip::write::SimpleFileOptions::default()).unwrap();
            z.write_all(serde_json::to_string(m).unwrap().as_bytes()).unwrap();
            z.finish().unwrap();
        };
        let p = e.root.join("new.gachamod");
        let mut m = manifest("zzz");
        m.format = 9;
        write(&m, &p);
        assert!(matches!(inspect(&lock(&e.db), &p), Err(Error::Invalid(_))));
        let p2 = e.root.join("gi.gachamod");
        write(&manifest("gi"), &p2);
        assert!(matches!(inspect(&lock(&e.db), &p2), Err(Error::NotSetUp(m)) if m.contains("Genshin Impact")));
        let p3 = e.root.join("plain.zip");
        { let mut z = zip::ZipWriter::new(File::create(&p3).unwrap()); z.start_file("a.ini", zip::write::SimpleFileOptions::default()).unwrap(); z.finish().unwrap(); }
        assert!(matches!(inspect(&lock(&e.db), &p3), Err(Error::Archive(_))));
    }

    #[test]
    fn export_through_library() {
        let e = env("lib");
        make_mod(&e.mods.join("Coca Cola"), &"a".repeat(32), "Coca Cola");
        library::scan(&e.db, "zzz").unwrap();
        let dest = e.root.join("x.gachamod");
        let r = export(&e.db, &ExportRequest { game: "zzz".into(), mod_ids: vec!["a".repeat(32)], include_vars: true, dest: dest.to_string_lossy().into(), ..Default::default() }, &|_, _| {}).unwrap();
        assert_eq!(r.mods, 1);
    }

    #[test]
    fn helpers() {
        assert_eq!(clean_rel("Ellen Joe/DISABLED Coca Cola"), "Ellen Joe/Coca Cola");
        assert_eq!(safe_name("a:b?"), "a_b_");
        assert_eq!(safe_name(".."), "Mod");
        assert_eq!(percent_decode("C%3A/x%20y.png"), "C:/x y.png");
        assert!(stored("A.PNG") && !stored("a.dds"));
    }
}
