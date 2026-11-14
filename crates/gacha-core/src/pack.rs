//! `.gachamod` files: mods, how they are set up and profiles, in one file to share or to move to another PC. A zip
//! with `gachamod.json` (Manifest) at the root. Owner: MODTOOLS area (docs/spec.md, ".gachamod").
//!
//! Format 2 is mostly a link list. A mod from GameBanana is stored as its link plus how it was set up (its folder,
//! on or off, picked options, key edits, name, tags and notes), so a file with a whole library is a few KB and the
//! other PC downloads the mods itself (`resolve` picks the files, the queue installs them, and install.rs puts the
//! settings back through `InstallMeta::setups`). A mod with no link can carry its files under `mods/<n>/`, and an
//! export can put every mod's files in for a full copy. One file can hold several games, each with its profiles.
//! Format 1 files (one game, always with files) still open.

mod resolve;
#[cfg(test)]
mod tests;

pub use resolve::resolve;

use crate::db::{Db, Shared};
use crate::error::{Error, Result};
use crate::ini::{self, VarValue};
use crate::install::{InstallMeta, ModSetup};
use crate::keys::KeyChange;
use crate::library;
use crate::model::{ModEntry, ModSource, Profile, Sidecar, SIDECAR_FILE};
use crate::profiles::{self, ProfileSnapshot, SnapshotMod, SnapshotVar};
use crate::queue::QueueRequest;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{self, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

pub const EXTENSION: &str = "gachamod";
pub const MANIFEST: &str = "gachamod.json";
pub const FORMAT: u32 = 2;
/// Mods with no link whose files add up to this much or less go in by default (a file that still fits in a chat
/// message on most apps).
pub const SMALL_FILES: u64 = 20 * 1024 * 1024;
/// A local profile banner bigger than this stays out of the file (the profile keeps its colour and icon).
const BANNER_MAX: u64 = 2 * 1024 * 1024;

fn is_false(b: &bool) -> bool { !*b }

/// `gachamod.json`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Manifest {
    pub format: u32,
    pub app_version: String,
    pub created_at: i64,
    /// "mods" (a selection), "profile" (one profile and its mods), "game" (a game's mods and profiles) or "all"
    /// (every game's).
    pub kind: String,
    pub title: String,
    /// Format 2: each game with its mods and profiles.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub games: Vec<GamePart>,
    /// Format 1 (one game). Read into `games`.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub game: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub mods: Vec<PackedMod>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile: Option<PackedProfile>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GamePart {
    pub game: String,
    pub mods: Vec<PackedMod>,
    pub profiles: Vec<PackedProfile>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PackedMod {
    /// The folder inside the pack with the mod's files ("mods/0"), or empty when only its link is stored.
    pub dir: String,
    /// Where it lived under Mods, without the DISABLED prefix ("Ellen Joe/Coca Cola").
    pub rel_path: String,
    pub enabled: bool,
    /// Its id (profiles in the file point to it), name, character, link, tags, notes and which archive folder it was.
    pub sidecar: Sidecar,
    pub vars: Vec<VarValue>,
    /// Key edits to make again on a downloaded copy. Empty when the files are inside: they carry their edits.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub keys: Vec<KeyChange>,
    /// gachamod made its keys work only while the character is on screen.
    #[serde(skip_serializing_if = "is_false")]
    pub on_screen: bool,
    /// Its .ini files, to find it in an archive that holds several mods.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub inis: Vec<String>,
    /// The mod folder's size on the PC it came from.
    pub size: u64,
    pub files: u32,
}

impl PackedMod {
    fn name(&self) -> String {
        if self.sidecar.name.trim().is_empty() { self.rel_path.rsplit('/').next().filter(|s| !s.is_empty()).unwrap_or("Mod").to_string() } else { self.sidecar.name.clone() }
    }
    fn inside(&self) -> bool { !self.dir.trim().is_empty() }
    /// Its GameBanana link, when it has one.
    fn link(&self) -> Option<&ModSource> { self.sidecar.source.as_ref().filter(|s| s.mod_id > 0) }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PackedProfile {
    pub name: String,
    pub icon: Option<String>,
    pub color: Option<String>,
    /// A path inside the pack ("media/banner-0.jpg") or a remote URL.
    pub banner: Option<String>,
    pub description: Option<String>,
    /// It was the game's profile in use when the file was made.
    pub active: bool,
    /// Its mods by their id in the file, on or off. Empty in format 1 files: every mod of the file, as packed.
    pub mods: Vec<SnapshotMod>,
    pub vars: Vec<SnapshotVar>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ExportRequest {
    pub game: String,
    /// Mods to pack (scope "mods").
    pub mod_ids: Vec<String>,
    /// The profile to pack (scope "profile").
    pub profile_id: Option<i64>,
    /// "mods", "profile", "game" (every mod and profile of `game`) or "all" (every game). Empty: "profile" when
    /// `profile_id` is set, else "mods".
    pub scope: String,
    /// What goes in: "links" (links and settings only), "unlinked" (links, plus the files of mods that have no link)
    /// or "files" (every mod's files). Empty means "files", as format 1 did.
    pub files: String,
    /// Picked options and key edits.
    pub include_vars: bool,
    pub title: Option<String>,
    /// Full path of the file to write (the UI asks with a save dialog).
    pub dest: String,
}

impl ExportRequest {
    fn scope(&self) -> &str {
        match self.scope.as_str() {
            "" if self.profile_id.is_some() => "profile",
            "" => "mods",
            s => s,
        }
    }
    fn files(&self) -> &str { if self.files.is_empty() { "files" } else { self.files.as_str() } }
}

/// What an export would hold, for the export window.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPlan {
    /// A title to start with: the profile's name, the one mod's name, "<game> mods" ...
    pub title: String,
    pub games: Vec<String>,
    pub mods: u32,
    /// Mods with a GameBanana link, and those without one.
    pub linked: u32,
    pub unlinked: u32,
    pub unlinked_size: u64,
    pub total_size: u64,
    pub profiles: u32,
    /// The "files" choice the window starts on.
    pub suggested: String,
    /// Names of mods without a link (up to 30), so the window can say which.
    pub unlinked_names: Vec<String>,
    /// One "Name: https://gamebanana.com/mods/1" line per linked mod, for "Copy links".
    pub links: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub path: String,
    pub size: u64,
    pub mods: u32,
    /// Mods stored as links, and with their files.
    pub links: u32,
    pub inside: u32,
    pub profiles: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackPreviewMod {
    /// Its place in the file across all games (ImportOptions::only).
    pub index: u32,
    pub game: String,
    pub name: String,
    pub character: Option<String>,
    pub rel_path: String,
    pub size: u64,
    pub enabled: bool,
    /// The id of the same mod already in the library (same id, or same GameBanana mod), if any.
    pub existing: Option<String>,
    pub preview: Option<String>,
    /// "inside" (its files are in the file), "download" (from GameBanana) or "missing" (only its name is).
    pub how: String,
    pub gb_mod_id: Option<u64>,
    /// Its GameBanana page.
    pub url: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewProfile {
    pub game: String,
    pub name: String,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub description: Option<String>,
    pub active: bool,
    /// How many mods it turns on.
    pub mods: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewGame {
    pub game: String,
    pub name: String,
    /// Set up here, so its mods can come in.
    pub ready: bool,
    /// Why not, when it isn't.
    pub note: Option<String>,
    pub mods: u32,
    pub profiles: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackPreview {
    pub path: String,
    pub manifest_ok: bool,
    pub format: u32,
    /// The first game that is set up (or the first game).
    pub game: String,
    pub kind: String,
    pub title: String,
    pub created_at: i64,
    pub mods: Vec<PackPreviewMod>,
    /// The first profile (the one a "profile" file is about).
    pub profile: Option<PreviewProfile>,
    pub profiles: Vec<PreviewProfile>,
    pub games: Vec<PreviewGame>,
    /// Bytes of mod files inside the file.
    pub total_size: u64,
    /// About how much the linked mods take on the PC they came from.
    pub download_size: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ImportOptions {
    /// Indexes of `PackPreview.mods` to bring in (empty means all).
    pub only: Vec<u32>,
    /// "skip", "replace" or "keep_both" for mods already in the library.
    pub on_existing: String,
    /// Make the file's profiles, and switch to the one it was made with.
    pub apply_profile: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub added: Vec<String>,
    pub replaced: Vec<String>,
    pub skipped: u32,
    /// The profile switched to.
    pub profile_id: Option<i64>,
    /// Every profile made.
    #[serde(default)]
    pub profiles: Vec<i64>,
    /// Mods put in the download queue.
    #[serde(default)]
    pub queued: u32,
    /// Mods the file only names (no link, no files).
    #[serde(default)]
    pub missing: Vec<String>,
    pub notes: Vec<String>,
    /// Downloads for the queue. The app resolves and queues them; they never reach the UI.
    #[serde(skip)]
    pub downloads: Vec<QueueRequest>,
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

fn is_web(url: &str) -> bool { url.starts_with("https://") || url.starts_with("http://") }

fn game_name(game: &str) -> String { crate::games::def(game).map(|g| g.name.to_string()).unwrap_or_else(|| game.to_string()) }

fn linked(m: &ModEntry) -> bool { m.source.as_ref().is_some_and(|s| s.mod_id > 0) }

// ── what to export ──

/// One game's share of an export, read from the database.
struct Picked { game: String, mods: Vec<ModEntry>, vars: HashMap<String, Vec<VarValue>>, profiles: Vec<(Profile, ProfileSnapshot)> }

/// The mods and profiles an export takes, per game. Values and profile rows are read here (with the database);
/// files are read later without it.
fn pick(db: &Db, req: &ExportRequest, with_vars: bool) -> Result<(String, Vec<Picked>)> {
    let scope = req.scope();
    let vars_of = |game: &str, mods: &[ModEntry]| -> HashMap<String, Vec<VarValue>> {
        if !with_vars { return HashMap::new(); }
        let importer = crate::games::importer_dir(db, game).ok();
        mods.iter().map(|m| {
            let mut v = library::saved_vars(db, game, &m.id).unwrap_or_default();
            if v.is_empty() && m.enabled {
                if let Some(imp) = &importer { v = ini::user_vars(imp, &m.rel_path).unwrap_or_default(); }
            }
            (m.id.clone(), v)
        }).filter(|(_, v)| !v.is_empty()).collect()
    };
    // a profile's rows for the exported mods; the one in use holds what is on and the values right now
    let profile_rows = |p: &Profile, mods: &[ModEntry], vars: &HashMap<String, Vec<VarValue>>| -> Result<ProfileSnapshot> {
        let ids: HashSet<&str> = mods.iter().map(|m| m.id.as_str()).collect();
        let mut snap = profiles::snapshot(db, p.id)?;
        if p.active {
            snap.mods = mods.iter().map(|m| SnapshotMod { mod_id: m.id.clone(), enabled: m.enabled }).collect();
            snap.vars = vars.iter().flat_map(|(id, vs)| vs.iter().map(move |v| SnapshotVar { mod_id: id.clone(), ini: v.ini.clone(), var: v.var.clone(), value: v.value.clone() })).collect();
        } else {
            snap.mods.retain(|m| ids.contains(m.mod_id.as_str()));
            if with_vars { snap.vars.retain(|v| ids.contains(v.mod_id.as_str())); } else { snap.vars.clear(); }
        }
        snap.vars.sort_by(|a, b| (&a.mod_id, &a.ini, &a.var).cmp(&(&b.mod_id, &b.ini, &b.var)));
        Ok(snap)
    };
    let whole_game = |game: &str| -> Result<Picked> {
        let mods = library::list(db, game)?;
        let vars = vars_of(game, &mods);
        let mut out = Vec::new();
        for p in profiles::list(db, game)? {
            let snap = profile_rows(&p, &mods, &vars)?;
            out.push((p, snap));
        }
        Ok(Picked { game: game.to_string(), mods, vars, profiles: out })
    };
    let parts = match scope {
        "mods" => {
            let mods = req.mod_ids.iter().map(|id| library::get(db, &req.game, id)).collect::<Result<Vec<_>>>()?;
            let vars = vars_of(&req.game, &mods);
            vec![Picked { game: req.game.clone(), mods, vars, profiles: Vec::new() }]
        }
        "profile" => {
            let pid = req.profile_id.ok_or_else(|| Error::Invalid("Pick a profile to export".into()))?;
            let p = profiles::get(db, pid)?;
            let ids = if req.mod_ids.is_empty() { profiles::members(db, pid)? } else { req.mod_ids.clone() };
            let mods = ids.iter().filter_map(|id| library::get(db, &p.game, id).ok()).collect::<Vec<_>>();
            let vars = vars_of(&p.game, &mods);
            let mut snap = profile_rows(&p, &mods, &vars)?;
            // a profile file turns on exactly its mods
            snap.mods = mods.iter().map(|m| SnapshotMod { mod_id: m.id.clone(), enabled: true }).collect();
            vec![Picked { game: p.game.clone(), mods, vars, profiles: vec![(p, snap)] }]
        }
        "game" => vec![whole_game(&req.game)?],
        "all" => {
            let mut v = Vec::new();
            for g in crate::games::GAMES {
                if crate::games::paths(db, g.id).ok().and_then(|p| p.mods_dir).is_none() { continue; }
                let part = whole_game(g.id)?;
                if !part.mods.is_empty() { v.push(part); }
            }
            v
        }
        other => return Err(Error::Invalid(format!("\"{other}\" isn't something gachamod can export"))),
    };
    Ok((scope.to_string(), parts))
}

fn default_title(scope: &str, parts: &[Picked]) -> String {
    let first = parts.first();
    let short = first.and_then(|p| crate::games::def(&p.game)).map(|g| g.short).unwrap_or("Game");
    match scope {
        "profile" => first.and_then(|p| p.profiles.first()).map(|(p, _)| p.name.clone()).unwrap_or_else(|| "Profile".into()),
        "all" => "All my mods".into(),
        "game" => format!("{short} mods and profiles"),
        _ => match first.map(|p| p.mods.as_slice()) {
            Some([one]) => one.name.clone(),
            _ => format!("{short} mods"),
        },
    }
}

/// What an export would hold and how big the choices make it.
pub fn plan(db: &Db, req: &ExportRequest) -> Result<ExportPlan> {
    let (scope, parts) = pick(db, req, false)?;
    let mut p = ExportPlan { title: default_title(&scope, &parts), ..Default::default() };
    let mut links = Vec::new();
    for part in &parts {
        p.games.push(part.game.clone());
        p.profiles += part.profiles.len() as u32;
        for m in &part.mods {
            p.mods += 1;
            p.total_size += m.size_bytes;
            if linked(m) {
                p.linked += 1;
                let url = m.source.as_ref().map(|s| if s.url.is_empty() { format!("https://gamebanana.com/mods/{}", s.mod_id) } else { s.url.clone() }).unwrap_or_default();
                links.push(format!("{}: {url}", m.name));
            } else {
                p.unlinked += 1;
                p.unlinked_size += m.size_bytes;
                if p.unlinked_names.len() < 30 { p.unlinked_names.push(m.name.clone()); }
            }
        }
    }
    p.links = links.join("\n");
    p.suggested = if p.linked == 0 || p.unlinked_size <= SMALL_FILES { "unlinked".into() } else { "links".into() };
    Ok(p)
}

// ── export ──

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

/// A mod's files to put in the pack.
struct Embed { dir: String, files: Vec<(PathBuf, String, u64)> }

pub fn export(db: &Shared, req: &ExportRequest, progress: &dyn Fn(u64, u64)) -> Result<ExportResult> {
    let dest = PathBuf::from(req.dest.trim());
    if req.dest.trim().is_empty() { return Err(Error::Invalid("Pick where to save the file".into())); }
    let mode = req.files();
    if !matches!(mode, "links" | "unlinked" | "files") { return Err(Error::Invalid(format!("\"{mode}\" isn't a way gachamod can save mods"))); }
    // the rows, holding the database only for that
    let (scope, parts) = pick(&lock(db), req, req.include_vars)?;
    if parts.iter().all(|p| p.mods.is_empty() && p.profiles.is_empty()) {
        return Err(Error::Invalid("There are no mods to export. Pick at least one".into()));
    }
    let title = req.title.clone().filter(|t| !t.trim().is_empty()).unwrap_or_else(|| default_title(&scope, &parts));
    let mut manifest = Manifest { format: FORMAT, app_version: crate::APP_VERSION.into(), created_at: crate::db::now(), kind: scope.clone(), title, ..Default::default() };
    let mut embeds: Vec<Embed> = Vec::new();
    let mut media: Vec<(PathBuf, String)> = Vec::new();
    let mut n = 0usize;
    let mut res = ExportResult::default();
    for part in parts {
        let mut gp = GamePart { game: part.game.clone(), ..Default::default() };
        for m in &part.mods {
            let dir = PathBuf::from(&m.path);
            if !dir.is_dir() { return Err(Error::Invalid(format!("{}'s folder isn't there any more. Rescan, then try again", m.name))); }
            let mut sidecar = sidecar_of(m);
            let inside = match mode { "files" => true, "unlinked" => !linked(m), _ => false };
            let mut pm = PackedMod {
                // a profile file's mods come in on, whatever they are here right now
                rel_path: clean_rel(&m.rel_path), enabled: m.enabled || scope == "profile", vars: part.vars.get(&m.id).cloned().unwrap_or_default(),
                size: m.size_bytes, files: m.file_count, ..Default::default()
            };
            if inside {
                let files = mod_files(&dir);
                pm.dir = format!("mods/{n}");
                pm.size = files.iter().map(|f| f.2).sum();
                pm.files = files.len() as u32;
                embeds.push(Embed { dir: pm.dir.clone(), files });
                n += 1;
                res.inside += 1;
            } else {
                // only the link: what the other PC needs to set up a fresh download like this one
                if req.include_vars { (pm.keys, pm.on_screen) = crate::keys::shared_changes(&dir); }
                pm.inis = crate::install::ini_set(&dir);
                if sidecar.preview.as_deref().is_some_and(|p| !is_web(p)) { sidecar.preview = None; }
                sidecar.custom_preview = None;
                sidecar.preview_backups.clear();
                if linked(m) { res.links += 1; }
            }
            pm.sidecar = sidecar;
            gp.mods.push(pm);
        }
        for (p, snap) in part.profiles {
            let mut pp = PackedProfile {
                name: p.name.clone(), icon: p.icon.clone(), color: p.color.clone(), banner: p.banner.clone(), description: p.description.clone(),
                active: p.active, mods: snap.mods, vars: snap.vars,
            };
            if let Some(local) = p.banner.as_deref().and_then(local_banner) {
                let small = fs::metadata(&local).map(|m| m.len() <= BANNER_MAX).unwrap_or(false);
                if small {
                    let name = format!("media/banner-{}.{}", media.len(), ext_of(&local.to_string_lossy()).chars().take(5).collect::<String>());
                    pp.banner = Some(name.clone());
                    media.push((local, name));
                } else {
                    pp.banner = None;
                }
            }
            res.profiles += 1;
            gp.profiles.push(pp);
        }
        res.mods += gp.mods.len() as u32;
        manifest.games.push(gp);
    }
    let (path, size) = write_pack(&dest, &manifest, &embeds, &media, progress)?;
    Ok(ExportResult { path, size, ..res })
}

/// Write the zip: the manifest first, then each packed mod's files under its folder with its sidecar, then the
/// media. Goes to "<dest>.part" and is renamed when complete. Returns the path and size.
fn write_pack(dest: &Path, manifest: &Manifest, embeds: &[Embed], media: &[(PathBuf, String)], progress: &dyn Fn(u64, u64)) -> Result<(String, u64)> {
    let sidecars: HashMap<&str, &Sidecar> = manifest.games.iter().flat_map(|g| &g.mods).filter(|m| m.inside()).map(|m| (m.dir.as_str(), &m.sidecar)).collect();
    let total: u64 = embeds.iter().flat_map(|e| &e.files).map(|f| f.2).sum::<u64>() + media.iter().filter_map(|m| fs::metadata(&m.0).ok()).map(|m| m.len()).sum::<u64>();
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
        z.write_all(serde_json::to_string_pretty(manifest)?.as_bytes())?;
        let mut t = Throttle::new(progress, total);
        for e in embeds {
            if let Some(sc) = sidecars.get(e.dir.as_str()) {
                z.start_file(format!("{}/{SIDECAR_FILE}", e.dir), deflate).map_err(zerr)?;
                z.write_all(serde_json::to_string_pretty(sc)?.as_bytes())?;
            }
            for (abs, rel, size) in &e.files {
                let opts = big(if stored(rel) { store } else { deflate }, *size);
                z.start_file(format!("{}/{rel}", e.dir), opts).map_err(zerr)?;
                let mut f = File::open(abs)?;
                copy_with(&mut f, &mut z, &mut t)?;
            }
        }
        for (abs, name) in media {
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
    Ok((dest.to_string_lossy().into_owned(), size))
}

// ── reading packs ──

fn open_zip(path: &Path) -> Result<zip::ZipArchive<File>> {
    let f = File::open(path).map_err(|e| if e.kind() == io::ErrorKind::NotFound { Error::Invalid("That file isn't there any more".into()) } else { e.into() })?;
    zip::ZipArchive::new(f).map_err(|_| Error::Archive("This isn't a .gachamod file, or it is damaged".into()))
}

/// Read and check `gachamod.json`. Format 1's one game comes back as `games[0]`.
fn read_manifest(z: &mut zip::ZipArchive<File>) -> Result<Manifest> {
    let mut text = String::new();
    {
        let mut f = z.by_name(MANIFEST).map_err(|_| Error::Archive("This isn't a .gachamod file: it has no gachamod.json inside".into()))?;
        if f.size() > 16 * 1024 * 1024 { return Err(Error::Archive("This .gachamod file's list of mods is too large to read".into())); }
        f.read_to_string(&mut text).map_err(|_| Error::Archive("This .gachamod file is damaged. Ask for it again".into()))?;
    }
    let mut m: Manifest = serde_json::from_str(text.trim_start_matches('\u{feff}')).map_err(|_| Error::Archive("This .gachamod file's list of mods is damaged".into()))?;
    if m.format == 0 { return Err(Error::Archive("This .gachamod file's list of mods is damaged".into())); }
    if m.format > FORMAT {
        return Err(Error::Invalid(format!("This file was made by a newer gachamod (pack format {}). Update gachamod, then open it again", m.format)));
    }
    if m.games.is_empty() && !m.game.is_empty() {
        let profiles = m.profile.take().map(|p| vec![PackedProfile { active: true, ..p }]).unwrap_or_default();
        m.games.push(GamePart { game: std::mem::take(&mut m.game), mods: std::mem::take(&mut m.mods), profiles });
    }
    if m.games.is_empty() { return Err(Error::Archive("This .gachamod file has nothing in it".into())); }
    Ok(m)
}

/// The game must be known and have a Mods folder.
fn check_game(db: &Db, game: &str) -> Result<()> {
    if crate::games::def(game).is_none() { return Err(Error::Invalid(format!("This pack is for a game gachamod doesn't know (\"{game}\")"))); }
    if crate::games::paths(db, game)?.mods_dir.is_none() {
        return Err(Error::NotSetUp(format!("This pack is for {}, which isn't set up yet. Set it up in Settings, then open the pack again", game_name(game))));
    }
    Ok(())
}

fn mods_or_empty(db: &Db, game: &str) -> Vec<ModEntry> { library::list(db, game).unwrap_or_default() }

/// The library mod a packed mod is a copy of: the same id, else the same GameBanana mod (unless both sides know
/// which archive folder they are and those differ). Each library mod matches one packed mod at most.
fn find_existing<'a>(pm: &PackedMod, library: &'a [ModEntry], used: &mut HashSet<String>) -> Option<&'a ModEntry> {
    let id = pm.sidecar.id.as_str();
    let hit = library.iter().find(|m| !id.is_empty() && m.id == id && !used.contains(&m.id)).or_else(|| {
        let src = pm.sidecar.source.as_ref().filter(|s| s.mod_id != 0)?;
        library.iter().filter(|m| !used.contains(&m.id) && m.source.as_ref().is_some_and(|s| s.mod_id == src.mod_id && s.site == src.site)).find(|m| {
            match (pm.sidecar.variant.as_deref(), library::read_sidecar(Path::new(&m.path)).and_then(|s| s.variant)) {
                (Some(a), Some(b)) => a == b,
                _ => true,
            }
        })
    })?;
    used.insert(hit.id.clone());
    Some(hit)
}

/// The zip's folder prefix for a packed mod ("mods/0/"), checked to stay inside the pack.
fn dir_prefix(pm: &PackedMod) -> Option<String> {
    if !pm.inside() { return None; }
    let p = crate::archive::safe_relative(&pm.dir)?;
    let s = p.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/");
    (!s.is_empty()).then(|| format!("{s}/"))
}

/// The entry to show as a packed mod's preview, or a remote URL.
enum PreviewSrc { Entry(usize, String), Url(String) }

fn find_preview(pm: &PackedMod, names: &[(usize, String)]) -> Option<PreviewSrc> {
    if let Some(p) = pm.sidecar.preview.as_deref() { if is_web(p) { return Some(PreviewSrc::Url(p.to_string())); } }
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

/// How many mods a profile in the file turns on.
fn profile_count(pp: &PackedProfile, part: &GamePart) -> u32 {
    if pp.mods.is_empty() { part.mods.iter().filter(|m| m.enabled).count() as u32 } else { pp.mods.iter().filter(|m| m.enabled).count() as u32 }
}

pub fn inspect(db: &Db, path: &Path) -> Result<PackPreview> {
    let mut z = open_zip(path)?;
    let manifest = read_manifest(&mut z)?;
    let names = entry_names(&mut z);
    let cache = data_dir_of(db).join("cache").join("packs").join(pack_key(path));
    let mut out = PackPreview {
        path: path.to_string_lossy().into_owned(), manifest_ok: true, format: manifest.format, kind: manifest.kind.clone(),
        title: manifest.title.clone(), created_at: manifest.created_at, ..Default::default()
    };
    let mut first_error = None;
    let mut n = 0usize;
    for part in &manifest.games {
        let ready = check_game(db, &part.game);
        let library = if ready.is_ok() { mods_or_empty(db, &part.game) } else { Vec::new() };
        let mut used = HashSet::new();
        out.games.push(PreviewGame {
            game: part.game.clone(), name: game_name(&part.game), ready: ready.is_ok(), note: ready.as_ref().err().map(|e| e.to_string()),
            mods: part.mods.len() as u32, profiles: part.profiles.len() as u32,
        });
        if let Err(e) = ready { if first_error.is_none() { first_error = Some(e); } }
        for pm in &part.mods {
            let how = if pm.inside() { "inside" } else if pm.link().is_some() { "download" } else { "missing" };
            if pm.inside() { out.total_size += pm.size; } else if pm.link().is_some() { out.download_size += pm.size; }
            out.mods.push(PackPreviewMod {
                index: n as u32, game: part.game.clone(), name: pm.name(), character: pm.sidecar.character.clone(), rel_path: pm.rel_path.clone(),
                size: pm.size, enabled: pm.enabled, existing: find_existing(pm, &library, &mut used).map(|m| m.id.clone()),
                preview: preview_of(&mut z, pm, n, &names, &cache), how: how.into(),
                gb_mod_id: pm.link().map(|s| s.mod_id), url: pm.link().map(|s| if s.url.is_empty() { format!("https://gamebanana.com/mods/{}", s.mod_id) } else { s.url.clone() }),
            });
            n += 1;
        }
        for pp in &part.profiles {
            out.profiles.push(PreviewProfile {
                game: part.game.clone(), name: pp.name.clone(), icon: pp.icon.clone(), color: pp.color.clone(), description: pp.description.clone(),
                active: pp.active, mods: profile_count(pp, part),
            });
        }
    }
    // nothing in the file can come in here: say why, as for a one-game file
    if !out.games.iter().any(|g| g.ready) {
        if let Some(e) = first_error { return Err(e); }
    }
    out.game = out.games.iter().find(|g| g.ready).or(out.games.first()).map(|g| g.game.clone()).unwrap_or_default();
    out.profile = out.profiles.first().cloned();
    Ok(out)
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

/// Place one packed mod whose files are in the pack. Errors are about this mod only.
#[allow(clippy::too_many_arguments)]
fn import_one(ctx: &Ctx, z: &mut zip::ZipArchive<File>, names: &[(usize, String)], n: usize, pm: &PackedMod, existing: Option<&ModEntry>,
    mode: &str, notes: &mut Vec<String>, t: &mut Throttle) -> Result<Outcome> {
    if existing.is_some() && !matches!(mode, "replace" | "keep_both") { return Ok(Outcome::Skipped); }
    let prefix = dir_prefix(pm).ok_or_else(|| Error::Archive("its folder in the pack points outside the pack".into()))?;
    let display = pm.name();

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

/// The download for a linked mod, carrying how to set it up.
fn link_request(game: &str, pm: &PackedMod, setup: ModSetup, replaces: Option<String>) -> Option<QueueRequest> {
    let src = pm.link()?.clone();
    let file_id = src.file_id.unwrap_or(0);
    let sc = &pm.sidecar;
    Some(QueueRequest {
        game: game.to_string(), gb_mod_id: src.mod_id, file_id,
        url: if file_id > 0 { format!("https://gamebanana.com/dl/{file_id}") } else { String::new() },
        file_name: src.file_name.clone().unwrap_or_default(), size: 0, md5: None,
        meta: InstallMeta {
            name: Some(pm.name()), character: sc.character.clone(), category: None, source: Some(src), version: sc.version.clone(), nsfw: sc.nsfw,
            preview_url: sc.preview.clone().filter(|p| p.starts_with("https://")), replaces, setups: vec![setup],
        },
        thumb: None, local_path: None,
    })
}

/// Downloads of the same file become one request with a setup per mod (an archive with several mods).
fn add_request(list: &mut Vec<QueueRequest>, req: QueueRequest) {
    let same = list.iter_mut().find(|r| r.game == req.game && r.gb_mod_id == req.gb_mod_id && r.file_id == req.file_id);
    match same {
        Some(r) => {
            r.meta.setups.extend(req.meta.setups);
            if r.meta.replaces.is_none() { r.meta.replaces = req.meta.replaces; }
        }
        None => list.push(req),
    }
}

pub fn import(db: &Shared, path: &Path, opts: &ImportOptions, progress: &dyn Fn(u64, u64)) -> Result<ImportResult> {
    let mut z = open_zip(path)?;
    let manifest = read_manifest(&mut z)?;
    let data_dir = data_dir_of(&lock(db));
    let staging = data_dir.join("staging").join(format!("pack-{}", library::new_id()));
    let r = import_all(db, &mut z, &manifest, opts, &data_dir, &staging, progress);
    let _ = fs::remove_dir_all(&staging);
    r
}

fn import_all(db: &Shared, z: &mut zip::ZipArchive<File>, manifest: &Manifest, opts: &ImportOptions, data_dir: &Path, staging: &Path, progress: &dyn Fn(u64, u64)) -> Result<ImportResult> {
    let names = entry_names(z);
    let count: usize = manifest.games.iter().map(|g| g.mods.len()).sum();
    let chosen: HashSet<usize> = if opts.only.is_empty() { (0..count).collect() } else { opts.only.iter().map(|&i| i as usize).filter(|&i| i < count).collect() };
    let all_mods: Vec<&PackedMod> = manifest.games.iter().flat_map(|g| &g.mods).collect();
    let total: u64 = chosen.iter().filter_map(|&i| dir_prefix(all_mods[i])).map(|p| {
        names.iter().filter(|(_, n)| n.starts_with(&p)).filter_map(|(i, _)| z.by_index_raw(*i).ok().map(|f| f.size())).sum::<u64>()
    }).sum();
    let mode = if opts.on_existing.is_empty() { "skip" } else { opts.on_existing.as_str() };
    let mut t = Throttle::new(progress, total);
    let mut res = ImportResult::default();
    let mut base = 0usize;
    for part in &manifest.games {
        let here: Vec<usize> = (0..part.mods.len()).filter(|k| chosen.contains(&(base + k))).collect();
        let ready = check_game(&lock(db), &part.game);
        if let Err(e) = ready {
            if !here.is_empty() || (opts.apply_profile && !part.profiles.is_empty()) { res.notes.push(format!("Left out {}: {e}", game_name(&part.game))); }
            base += part.mods.len();
            continue;
        }
        let (mods_dir, importer_dir, library_mods) = {
            let d = lock(db);
            (crate::games::mods_dir(&d, &part.game)?, crate::games::importer_dir(&d, &part.game).ok(), mods_or_empty(&d, &part.game))
        };
        let ctx = Ctx { db, game: &part.game, mods_dir, importer_dir, data_dir: data_dir.to_path_buf(), staging: staging.join(&part.game) };
        let known: HashSet<&str> = library_mods.iter().map(|m| m.id.as_str()).collect();
        let mut used = HashSet::new();
        // a packed mod's id on this PC, by its place in the game's list
        let mut local: HashMap<usize, String> = HashMap::new();
        let mut taken: HashSet<String> = HashSet::new();
        let mut downloads: Vec<QueueRequest> = Vec::new();
        let mut changed = false;
        for &k in &here {
            let pm = &part.mods[k];
            let n = base + k;
            let name = pm.name();
            let existing = find_existing(pm, &library_mods, &mut used);
            if pm.inside() {
                match import_one(&ctx, z, &names, n, pm, existing, mode, &mut res.notes, &mut t) {
                    Ok(Outcome::Added(id)) => { local.insert(k, id.clone()); res.added.push(id); changed = true; }
                    Ok(Outcome::Replaced(id)) => { local.insert(k, id.clone()); res.replaced.push(id); changed = true; }
                    Ok(Outcome::Skipped) => { if let Some(e) = existing { local.insert(k, e.id.clone()); } res.skipped += 1; }
                    Err(e) => res.notes.push(format!("Couldn't import {name}: {e}")),
                }
                let _ = fs::remove_dir_all(ctx.staging.join(n.to_string()));
                continue;
            }
            if pm.link().is_none() {
                match existing {
                    Some(e) => { local.insert(k, e.id.clone()); res.skipped += 1; }
                    None => res.missing.push(name),
                }
                continue;
            }
            // a link: download it, set up the way it was
            let (id, replaces) = match (existing, mode) {
                (Some(e), "replace") => (e.id.clone(), Some(e.id.clone())),
                (Some(_), "keep_both") => (library::new_id(), None),
                (Some(e), _) => { local.insert(k, e.id.clone()); res.skipped += 1; continue; }
                (None, _) => {
                    let mine = pm.sidecar.id.trim();
                    let free = !mine.is_empty() && !known.contains(mine) && !taken.contains(mine) && mine.len() <= 64 && mine.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
                    (if free { mine.to_string() } else { library::new_id() }, None)
                }
            };
            taken.insert(id.clone());
            local.insert(k, id.clone());
            let setup = ModSetup {
                sidecar: Sidecar { id, ..pm.sidecar.clone() }, rel_path: pm.rel_path.clone(), enabled: pm.enabled,
                variant: pm.sidecar.variant.clone(), inis: pm.inis.clone(), vars: pm.vars.clone(), keys: pm.keys.clone(), on_screen: pm.on_screen,
            };
            if let Some(req) = link_request(&part.game, pm, setup, replaces) { add_request(&mut downloads, req); }
        }
        let _ = fs::remove_dir(&ctx.staging);

        if opts.apply_profile && !part.profiles.is_empty() {
            let one = manifest.kind == "profile" || part.profiles.len() == 1;
            for pp in &part.profiles {
                match make_profile(db, z, &names, part, pp, &local, data_dir) {
                    Ok(id) => {
                        res.profiles.push(id);
                        if (one || pp.active) && res.profile_id.is_none() {
                            match profiles::activate(&lock(db), id) {
                                Ok(_) => res.profile_id = Some(id),
                                Err(e) => res.notes.push(format!("Couldn't switch to {}: {e}", pp.name)),
                            }
                        }
                    }
                    Err(e) => res.notes.push(format!("Couldn't make the profile {}: {e}", pp.name)),
                }
            }
        }
        if changed { crate::devtools::mark_changed(&part.game); }
        res.downloads.extend(downloads);
        base += part.mods.len();
    }
    t.finish();
    Ok(res)
}

/// Make one of the file's profiles from its rows, pointed at the ids its mods have here. Its banner comes out of the
/// file when it is inside.
fn make_profile(db: &Shared, z: &mut zip::ZipArchive<File>, names: &[(usize, String)], part: &GamePart, pp: &PackedProfile, local: &HashMap<usize, String>, data_dir: &Path) -> Result<i64> {
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
    let (mods, vars): (Vec<SnapshotMod>, Vec<SnapshotVar>) = if pp.mods.is_empty() {
        // format 1: every mod of the file, as packed
        let mods = part.mods.iter().enumerate().filter_map(|(k, pm)| local.get(&k).map(|id| SnapshotMod { mod_id: id.clone(), enabled: pm.enabled })).collect();
        let vars = part.mods.iter().enumerate().filter_map(|(k, pm)| local.get(&k).map(|id| (id, pm)))
            .flat_map(|(id, pm)| pm.vars.iter().map(move |v| SnapshotVar { mod_id: id.clone(), ini: v.ini.clone(), var: v.var.clone(), value: v.value.clone() })).collect();
        (mods, vars)
    } else {
        let by_id: HashMap<&str, usize> = part.mods.iter().enumerate().map(|(k, pm)| (pm.sidecar.id.as_str(), k)).collect();
        let here = |id: &str| by_id.get(id).and_then(|k| local.get(k)).cloned();
        let mods = pp.mods.iter().filter_map(|m| here(&m.mod_id).map(|id| SnapshotMod { mod_id: id, enabled: m.enabled })).collect();
        let vars = pp.vars.iter().filter_map(|v| here(&v.mod_id).map(|id| SnapshotVar { mod_id: id, ..v.clone() })).collect();
        (mods, vars)
    };
    let now = crate::db::now();
    let base = if pp.name.trim().is_empty() { "Imported".to_string() } else { pp.name.trim().to_string() };
    let snap = ProfileSnapshot {
        profile: Profile {
            id: 0, game: part.game.clone(), name: base, icon: pp.icon.clone(), color: pp.color.clone(), banner, description: pp.description.clone(),
            active: false, mod_count: 0, created_at: now, updated_at: now, hotkey: None,
        },
        mods, vars,
    };
    Ok(profiles::restore(&lock(db), &snap)?.id)
}
