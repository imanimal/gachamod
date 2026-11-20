//! Extensions and themes: packages people share through a repo (an `index.json` on the web) or as a file. Owner:
//! EXTENSIONS area. The format, the page API and the repo layout are in docs/extensions.md.
//!
//! A package is a zip (or a folder) with `extension.json` at its root. It can add themes (custom theme JSON files),
//! a tab on each character's page and a page of its own. Pages are HTML that runs in a sandboxed frame; everything
//! it reaches outside that frame goes through gachamod and is checked against the package's `permissions`. A package
//! can also name other apps it works with (`needs`): gachamod finds them on the PC, says where to get them when they
//! are missing and can open them.
//!
//! Installed packages live in `<data>/extensions/<id>/`. A folder linked for development (`link_folder`) is served
//! from where it is. Removing or replacing a package moves its folder to `<data>/trash/extensions/<key>/`, so both
//! can be undone; those copies go after 14 days. Each package's own saved data is `<data>/extension-data/<id>.json`.
//! It stays while the package or its trash copy exists, and goes with the copy (`forget_stale_data`); Settings,
//! Storage can clear it sooner (`clear_data`).

use crate::app_update::{is_newer, parse_version};
use crate::archive::safe_relative;
use crate::db::{self, Db};
use crate::error::{Error, IoAt, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

/// The newest `extension.json` and `index.json` format this build reads.
pub const FORMAT: u32 = 1;
pub const MANIFEST: &str = "extension.json";
/// gachamod's own repo. More can be added in Settings (setting `extensions.sources`, a JSON list of index URLs).
pub const DEFAULT_SOURCE: &str = "https://raw.githubusercontent.com/imanimal/gachamod-extensions/main/index.json";
pub const SOURCES_SETTING: &str = "extensions.sources";
/// `{ "<id>": { on, from, at, path? } }`.
const STATE_SETTING: &str = "extensions.state";
/// A package download or file larger than this is refused.
pub const MAX_PACKAGE: u64 = 20 * 1024 * 1024;
/// Unpacked, all files together.
const MAX_UNPACKED: u64 = 64 * 1024 * 1024;
const MAX_FILES: usize = 2000;
/// A package's saved data, as JSON.
const MAX_STORAGE: usize = 1024 * 1024;
/// What a page can read in one call (a file, a web answer).
pub const MAX_READ: u64 = 8 * 1024 * 1024;
const TRASH_DAYS: i64 = 14;

// ── the manifest ──

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct Permissions {
    /// Read the mods, characters and owned characters of the game on screen.
    pub library: bool,
    /// Read the player card (name, title, UID).
    pub player: bool,
    /// Web origins the package may call through gachamod: "https://api.example.com", "http://127.0.0.1:47900".
    /// Plain http only for this PC (127.0.0.1, localhost, [::1]).
    pub net: Vec<String>,
    /// Folders the package may read, starting with an environment variable: "%LOCALAPPDATA%\\Some App\\exports".
    pub files: Vec<String>,
}

impl Permissions {
    pub fn is_empty(&self) -> bool { !self.library && !self.player && self.net.is_empty() && self.files.is_empty() }
}

/// A place in the app a package's HTML page fills.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct Slot {
    /// The tab or nav label, short: "Build".
    pub title: String,
    /// The HTML file in the package: "build.html".
    pub entry: String,
    /// An icon name from the app's set (pages only); unknown names fall back to a puzzle piece.
    pub icon: Option<String>,
}

/// Another app the package works with. gachamod finds it by `paths`, then by its name in Windows' installed apps.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct NeededApp {
    pub name: String,
    /// Where to get it (https).
    pub url: Option<String>,
    /// Files that show it is installed, starting with an environment variable: "%LOCALAPPDATA%\\Programs\\X\\X.exe".
    pub paths: Vec<String>,
    /// Its name in Windows' installed apps (Settings, Apps), when it has an installer.
    pub uninstall_name: Option<String>,
    /// A URL that answers while it runs ("http://127.0.0.1:47900/ping"). Its origin must be in `permissions.net`.
    pub running: Option<String>,
    /// A link that opens it ("someapp://"), else the first of `paths` that is an .exe.
    pub open: Option<String>,
    /// Optional: when false the package still works without it, with less.
    #[serde(default = "yes")]
    pub required: bool,
}

fn yes() -> bool { true }

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct Manifest {
    pub format: u32,
    /// Lower case letters, digits and dashes, 2 to 40 long: "build-notes".
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub description: String,
    pub homepage: Option<String>,
    /// An image in the package (png, jpg, webp or svg).
    pub icon: Option<String>,
    /// The oldest gachamod version it works with.
    pub app: Option<String>,
    /// Game ids it is for; empty means every game.
    pub games: Vec<String>,
    /// Custom theme files (the same JSON as Settings, Custom themes, Export).
    pub themes: Vec<String>,
    pub character_tab: Option<Slot>,
    pub page: Option<Slot>,
    pub permissions: Permissions,
    pub needs: Vec<NeededApp>,
}

impl Manifest {
    /// "theme" when it only adds themes, else "extension".
    pub fn kind(&self) -> &'static str {
        if self.character_tab.is_none() && self.page.is_none() { "theme" } else { "extension" }
    }
}

fn bad(msg: impl Into<String>) -> Error { Error::Invalid(msg.into()) }

fn now_ms() -> i64 { chrono::Utc::now().timestamp_millis() }

pub fn valid_id(id: &str) -> bool {
    (2..=40).contains(&id.len())
        && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        && !id.starts_with('-') && !id.ends_with('-')
}

fn https(url: &str) -> bool { url::Url::parse(url).is_ok_and(|u| u.scheme() == "https" && u.host_str().is_some()) }

fn is_loopback(host: &str) -> bool { matches!(host, "127.0.0.1" | "localhost" | "[::1]" | "::1") }

/// "https://api.example.com" or "http://127.0.0.1:47900", from a URL or origin. None for anything else.
pub fn origin_of(raw: &str) -> Option<String> {
    let u = url::Url::parse(raw.trim()).ok()?;
    let host = u.host_str()?.to_ascii_lowercase();
    match u.scheme() {
        "https" => {}
        "http" if is_loopback(&host) => {}
        _ => return None,
    }
    if !u.username().is_empty() || u.password().is_some() { return None; }
    let host = if host.contains(':') && !host.starts_with('[') { format!("[{host}]") } else { host };
    Some(match u.port() { Some(p) => format!("{}://{host}:{p}", u.scheme()), None => format!("{}://{host}", u.scheme()) })
}

/// The environment variables a path in a package may start with.
const ENV_ROOTS: &[&str] = &["LOCALAPPDATA", "APPDATA", "USERPROFILE", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "PUBLIC"];

/// Expand a leading %VAR% from ENV_ROOTS. The rest must stay inside it (no `..`).
pub fn expand_env(raw: &str) -> Option<PathBuf> {
    let s = raw.trim().replace('/', "\\");
    let rest = s.strip_prefix('%')?;
    let (var, tail) = rest.split_once('%')?;
    let var = var.to_ascii_uppercase();
    if !ENV_ROOTS.contains(&var.as_str()) { return None; }
    let base = std::env::var_os(&var)?;
    let tail = tail.trim_start_matches('\\');
    let rel = if tail.is_empty() { PathBuf::new() } else { safe_relative(tail)? };
    Some(PathBuf::from(base).join(rel))
}

fn env_path_ok(raw: &str) -> bool {
    let s = raw.trim().replace('/', "\\");
    let Some(rest) = s.strip_prefix('%') else { return false };
    let Some((var, tail)) = rest.split_once('%') else { return false };
    ENV_ROOTS.contains(&var.to_ascii_uppercase().as_str()) && (tail.trim_start_matches('\\').is_empty() || safe_relative(tail.trim_start_matches('\\')).is_some())
}

/// A file in the package: a safe relative path with one of `exts`, present under `root` when a root is given.
fn package_file(root: Option<&Path>, rel: &str, exts: &[&str], what: &str) -> Result<()> {
    let p = safe_relative(rel).ok_or_else(|| bad(format!("{what} \"{rel}\" isn't a path inside the package")))?;
    let ext = p.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).unwrap_or_default();
    if !exts.contains(&ext.as_str()) { return Err(bad(format!("{what} \"{rel}\" must be a .{} file", exts.join(", .")))); }
    if let Some(r) = root { if !r.join(&p).is_file() { return Err(bad(format!("{what} \"{rel}\" is missing from the package"))); } }
    Ok(())
}

/// Check a manifest (and its files when `root` is given). Origins in `permissions.net` come back normalised.
pub fn check(mut m: Manifest, root: Option<&Path>) -> Result<Manifest> {
    if m.format > FORMAT { return Err(bad(format!("\"{}\" needs a newer gachamod", m.name))); }
    m.format = FORMAT;
    if !valid_id(&m.id) { return Err(bad("The package id must be 2 to 40 lower case letters, digits and dashes, like \"build-notes\"")); }
    m.name = m.name.trim().to_string();
    if m.name.is_empty() || m.name.chars().count() > 60 { return Err(bad("The package needs a name of up to 60 characters")); }
    if parse_version(&m.version).is_none() { return Err(bad(format!("\"{}\" isn't a version like 1.0.0", m.version))); }
    m.author = m.author.trim().to_string();
    if m.author.is_empty() || m.author.chars().count() > 60 { return Err(bad("The package needs an author of up to 60 characters")); }
    m.description = m.description.trim().to_string();
    if m.description.chars().count() > 300 { return Err(bad("Keep the description under 300 characters")); }
    if let Some(h) = &m.homepage { if !https(h) { return Err(bad("The homepage must be an https link")); } }
    if let Some(a) = &m.app {
        if parse_version(a).is_none() { return Err(bad(format!("\"app\": \"{a}\" isn't a version"))); }
        if is_newer(a, crate::APP_VERSION) { return Err(bad(format!("{} needs gachamod {a} or newer", m.name))); }
    }
    if m.games.iter().any(|g| g.is_empty() || g.len() > 8 || !g.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())) {
        return Err(bad("\"games\" holds game ids like \"gi\" or \"zzz\""));
    }
    if let Some(i) = &m.icon { package_file(root, i, &["png", "jpg", "jpeg", "webp", "svg"], "The icon")?; }
    for t in &m.themes { package_file(root, t, &["json"], "The theme")?; }
    for (slot, what) in [(&mut m.character_tab, "characterTab"), (&mut m.page, "page")] {
        if let Some(s) = slot {
            s.title = s.title.trim().to_string();
            if s.title.is_empty() || s.title.chars().count() > 30 { return Err(bad(format!("{what} needs a title of up to 30 characters"))); }
            package_file(root, &s.entry, &["html", "htm"], &format!("{what}'s entry"))?;
        }
    }
    if m.themes.is_empty() && m.character_tab.is_none() && m.page.is_none() {
        return Err(bad("The package adds nothing. List themes, a characterTab or a page"));
    }
    let mut net = Vec::new();
    for o in &m.permissions.net {
        let n = origin_of(o).ok_or_else(|| bad(format!("\"{o}\" in permissions.net must be an https origin, or http on this PC (127.0.0.1)")))?;
        if !net.contains(&n) { net.push(n); }
    }
    m.permissions.net = net;
    for f in &m.permissions.files {
        if !env_path_ok(f) { return Err(bad(format!("\"{f}\" in permissions.files must start with %LOCALAPPDATA%, %APPDATA%, %USERPROFILE% or another known folder"))); }
    }
    for a in &mut m.needs {
        a.name = a.name.trim().to_string();
        if a.name.is_empty() { return Err(bad("Each app in \"needs\" needs a name")); }
        if let Some(u) = &a.url { if !https(u) { return Err(bad(format!("The link to {} must be https", a.name))); } }
        if let Some(p) = a.paths.iter().find(|p| !env_path_ok(p)) { return Err(bad(format!("\"{p}\" must start with %LOCALAPPDATA%, %PROGRAMFILES% or another known folder"))); }
        if let Some(r) = &a.running {
            let o = origin_of(r).ok_or_else(|| bad(format!("\"running\" for {} must be an http link on this PC or an https link", a.name)))?;
            if !m.permissions.net.contains(&o) { return Err(bad(format!("Add {o} to permissions.net to check whether {} runs", a.name))); }
        }
        if let Some(o) = &a.open {
            let scheme = o.split_once(':').map(|(s, _)| s.to_ascii_lowercase()).unwrap_or_default();
            let ok = !scheme.is_empty() && scheme.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'.' || b == b'+')
                && !matches!(scheme.as_str(), "http" | "https" | "file" | "javascript" | "data" | "ms-settings" | "shell" | "gachamod");
            if !ok { return Err(bad(format!("\"open\" for {} must be a link that opens the app, like someapp://", a.name))); }
        }
    }
    Ok(m)
}

pub fn read_manifest(dir: &Path) -> Result<Manifest> {
    let path = dir.join(MANIFEST);
    let text = fs::read_to_string(&path).map_err(|_| bad(format!("There's no {MANIFEST} in that package")))?;
    let m: Manifest = serde_json::from_str(text.trim_start_matches('\u{feff}')).map_err(|e| bad(format!("{MANIFEST} can't be read: {e}")))?;
    check(m, Some(dir))
}

// ── installed packages ──

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct State {
    #[serde(default = "yes")]
    on: bool,
    /// The index URL it came from; None for a file or folder.
    from: Option<String>,
    at: i64,
    /// A folder linked for development, served from where it is.
    path: Option<String>,
}

fn states(db: &Db) -> BTreeMap<String, State> { db.setting_json(STATE_SETTING).ok().flatten().unwrap_or_default() }
fn save_states(db: &Db, s: &BTreeMap<String, State>) -> Result<()> { db.set_setting_json(STATE_SETTING, s) }

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    /// The folder name; the same as `manifest.id` unless the manifest can't be read.
    pub id: String,
    /// None when `problem` says why it can't be used.
    pub manifest: Option<Manifest>,
    pub kind: &'static str,
    pub enabled: bool,
    pub dir: String,
    /// The index URL it came from; None for a file.
    pub source: Option<String>,
    pub installed_at: i64,
    /// A folder linked for development.
    pub linked: bool,
    /// The icon's full path.
    pub icon: Option<String>,
    pub problem: Option<String>,
}

pub fn root(data_dir: &Path) -> PathBuf { data_dir.join("extensions") }
fn trash_root(data_dir: &Path) -> PathBuf { data_dir.join("trash").join("extensions") }
fn staging(data_dir: &Path) -> PathBuf { data_dir.join("staging") }

/// Where a package's files are: its folder under `extensions`, or the linked folder.
fn dir_of(data_dir: &Path, id: &str, st: Option<&State>) -> PathBuf {
    match st.and_then(|s| s.path.as_ref()) { Some(p) => PathBuf::from(p), None => root(data_dir).join(id) }
}

fn entry(data_dir: &Path, id: &str, st: Option<&State>) -> Installed {
    let dir = dir_of(data_dir, id, st);
    let (manifest, problem) = match read_manifest(&dir) {
        Ok(m) if m.id == id => (Some(m), None),
        Ok(m) => (None, Some(format!("The folder is \"{id}\" but the package says \"{}\"", m.id))),
        Err(e) => (None, Some(e.to_string())),
    };
    let icon = manifest.as_ref().and_then(|m| m.icon.as_ref()).and_then(|i| safe_relative(i)).map(|r| dir.join(r).to_string_lossy().into_owned());
    Installed {
        id: id.to_string(),
        kind: manifest.as_ref().map_or("extension", |m| m.kind()),
        manifest,
        enabled: st.is_none_or(|s| s.on),
        dir: dir.to_string_lossy().into_owned(),
        source: st.and_then(|s| s.from.clone()),
        installed_at: st.map_or(0, |s| s.at),
        linked: st.is_some_and(|s| s.path.is_some()),
        icon,
        problem,
    }
}

/// Every installed package, by name. Packages that can't be read are listed with `problem` so they can be removed.
pub fn list(db: &Db, data_dir: &Path) -> Result<Vec<Installed>> {
    purge_trash(data_dir);
    forget_stale_data(db, data_dir);
    let st = states(db);
    let mut ids: Vec<String> = Vec::new();
    if let Ok(rd) = fs::read_dir(root(data_dir)) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if e.path().is_dir() && valid_id(&name) { ids.push(name); }
        }
    }
    for (id, s) in &st { if s.path.is_some() && !ids.contains(id) { ids.push(id.clone()); } }
    let mut out: Vec<Installed> = ids.iter().map(|id| entry(data_dir, id, st.get(id))).collect();
    out.sort_by_key(|e| e.manifest.as_ref().map_or_else(|| e.id.to_lowercase(), |m| m.name.to_lowercase()));
    Ok(out)
}

pub fn get(db: &Db, data_dir: &Path, id: &str) -> Result<Installed> {
    if !valid_id(id) { return Err(bad("No such extension")); }
    let st = states(db);
    let e = entry(data_dir, id, st.get(id));
    if e.manifest.is_none() && !Path::new(&e.dir).is_dir() { return Err(bad("That extension isn't installed")); }
    Ok(e)
}

/// The manifest of an installed package that is turned on. Pages and their calls only work through this.
pub fn active(db: &Db, data_dir: &Path, id: &str) -> Result<(Manifest, PathBuf)> {
    let e = get(db, data_dir, id)?;
    if !e.enabled { return Err(bad("That extension is turned off")); }
    match e.manifest {
        Some(m) => Ok((m, PathBuf::from(e.dir))),
        None => Err(bad(e.problem.unwrap_or_else(|| "That extension can't be read".into()))),
    }
}

pub fn set_enabled(db: &Db, id: &str, on: bool) -> Result<()> {
    if !valid_id(id) { return Err(bad("No such extension")); }
    let mut st = states(db);
    st.entry(id.to_string()).or_insert_with(|| State { on: true, at: db::now(), ..Default::default() }).on = on;
    save_states(db, &st)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    pub extension: Installed,
    /// The version it replaced, in the trash: `restore` puts it back.
    pub replaced: Option<String>,
}

/// Move a package folder to the trash. Returns the key `restore` takes.
fn to_trash(data_dir: &Path, id: &str) -> Result<Option<String>> {
    let dir = root(data_dir).join(id);
    if !dir.is_dir() { return Ok(None); }
    let key = format!("{id}~{}", now_ms());
    let t = trash_root(data_dir);
    fs::create_dir_all(&t)?;
    fs::rename(&dir, t.join(&key))?;
    Ok(Some(key))
}

/// Trash copies older than TRASH_DAYS (the key holds the time).
fn purge_trash(data_dir: &Path) {
    let Ok(rd) = fs::read_dir(trash_root(data_dir)) else { return };
    let cutoff = now_ms() - TRASH_DAYS * 86_400_000;
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if let Some(ms) = name.rsplit_once('~').and_then(|(_, t)| t.parse::<i64>().ok()) {
            if ms < cutoff { let _ = fs::remove_dir_all(e.path()); }
        }
    }
}

/// Put a staged package (a checked folder in staging) in place, replacing an installed one.
fn place(db: &Db, data_dir: &Path, staged: &Path, m: &Manifest, from: Option<String>) -> Result<InstallResult> {
    let mut st = states(db);
    if st.get(&m.id).is_some_and(|s| s.path.is_some()) {
        return Err(Error::Conflict(format!("{} is linked to a folder for development. Unlink it first", m.name)));
    }
    let replaced = to_trash(data_dir, &m.id)?;
    fs::create_dir_all(root(data_dir))?;
    let dest = root(data_dir).join(&m.id);
    if let Err(e) = fs::rename(staged, &dest) {
        copy_dir(staged, &dest)?;
        let _ = fs::remove_dir_all(staged);
        if !dest.join(MANIFEST).is_file() { return Err(e.into()); }
    }
    let on = st.get(&m.id).is_none_or(|s| s.on);
    st.insert(m.id.clone(), State { on, from, at: db::now(), path: None });
    save_states(db, &st)?;
    Ok(InstallResult { extension: entry(data_dir, &m.id, st.get(&m.id)), replaced })
}

fn copy_dir(from: &Path, to: &Path) -> Result<()> {
    for e in walkdir::WalkDir::new(from).follow_links(false) {
        let e = e.map_err(|e| bad(e.to_string()))?;
        let rel = e.path().strip_prefix(from).map_err(|e| bad(e.to_string()))?;
        let t = to.join(rel);
        if e.file_type().is_dir() { fs::create_dir_all(&t)?; } else if e.file_type().is_file() { fs::copy(e.path(), &t)?; }
    }
    Ok(())
}

fn new_staging(data_dir: &Path, id_hint: &str) -> Result<PathBuf> {
    let d = staging(data_dir).join(format!("ext-{id_hint}-{}", now_ms()));
    fs::create_dir_all(&d)?;
    Ok(d)
}

/// Unpack a package zip into `dest` with limits on size and file count. The manifest may sit in one top folder
/// (a zip of a folder, GitHub's "Download ZIP"); returns the folder that holds it.
pub fn unpack(zip_path: &Path, dest: &Path) -> Result<PathBuf> {
    let size = fs::metadata(zip_path).at(zip_path)?.len();
    if size > MAX_PACKAGE { return Err(bad(format!("That package is over {} MB", MAX_PACKAGE / 1024 / 1024))); }
    let mut z = zip::ZipArchive::new(fs::File::open(zip_path)?).map_err(|_| bad("That isn't a package (a .zip with extension.json in it)"))?;
    if z.len() > MAX_FILES { return Err(bad(format!("That package has over {MAX_FILES} files"))); }
    let mut total = 0u64;
    for i in 0..z.len() {
        let mut f = z.by_index(i).map_err(|e| bad(format!("The package is damaged ({e})")))?;
        if !f.is_file() { continue; }
        let Some(rel) = safe_relative(f.name()) else { continue };
        let t = dest.join(&rel);
        if let Some(p) = t.parent() { fs::create_dir_all(p)?; }
        let mut out = fs::File::create(&t)?;
        let room = MAX_UNPACKED.saturating_sub(total);
        let n = std::io::copy(&mut (&mut f).take(room + 1), &mut out)?;
        total += n;
        if total > MAX_UNPACKED { return Err(bad("That package unpacks to more than 64 MB")); }
    }
    if dest.join(MANIFEST).is_file() { return Ok(dest.to_path_buf()); }
    let dirs: Vec<PathBuf> = fs::read_dir(dest)?.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
    match dirs.as_slice() {
        [one] if one.join(MANIFEST).is_file() => Ok(one.clone()),
        _ => Err(bad(format!("There's no {MANIFEST} in that package"))),
    }
}

/// Install a package zip. `expect` is the (id, version) a repo listed; a package that says otherwise is refused.
pub fn install_zip(db: &Db, data_dir: &Path, zip_path: &Path, expect: Option<(&str, &str)>, from: Option<String>) -> Result<InstallResult> {
    let stage = new_staging(data_dir, "zip")?;
    let result = (|| {
        let dir = unpack(zip_path, &stage)?;
        let m = read_manifest(&dir)?;
        if let Some((id, ver)) = expect {
            if m.id != id || m.version != ver { return Err(bad(format!("The download is {} {} but the repo listed {id} {ver}", m.id, m.version))); }
        }
        place(db, data_dir, &dir, &m, from)
    })();
    let _ = fs::remove_dir_all(&stage);
    result
}

/// Names never copied from a folder into a package.
fn skipped(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    n.starts_with(".git") || n == "node_modules" || n == ".ds_store" || n == "thumbs.db" || n == "desktop.ini"
}

/// Install a copy of a package folder.
pub fn install_folder(db: &Db, data_dir: &Path, folder: &Path) -> Result<InstallResult> {
    let m = read_manifest(folder)?;
    let stage = new_staging(data_dir, &m.id)?;
    let result = (|| {
        let dest = stage.join(&m.id);
        let mut count = 0usize;
        let mut total = 0u64;
        for e in walkdir::WalkDir::new(folder).follow_links(false).into_iter().filter_entry(|e| e.depth() == 0 || !skipped(&e.file_name().to_string_lossy())) {
            let e = e.map_err(|e| bad(e.to_string()))?;
            let rel = e.path().strip_prefix(folder).map_err(|e| bad(e.to_string()))?;
            let t = dest.join(rel);
            if e.file_type().is_dir() { fs::create_dir_all(&t)?; continue; }
            if !e.file_type().is_file() { continue; }
            count += 1;
            total += e.metadata().map(|m| m.len()).unwrap_or(0);
            if count > MAX_FILES || total > MAX_UNPACKED { return Err(bad("That folder is too big for a package (2000 files, 64 MB)")); }
            fs::copy(e.path(), &t)?;
        }
        place(db, data_dir, &dest, &m, None)
    })();
    let _ = fs::remove_dir_all(&stage);
    result
}

/// Use a folder as it is, for making a package: edits show after a reload, nothing is copied.
pub fn link_folder(db: &Db, data_dir: &Path, folder: &Path) -> Result<Installed> {
    let m = read_manifest(folder)?;
    if root(data_dir).join(&m.id).is_dir() {
        return Err(Error::Conflict(format!("{} is installed already. Remove it first, then link the folder", m.name)));
    }
    let mut st = states(db);
    let full = fs::canonicalize(folder).unwrap_or_else(|_| folder.to_path_buf());
    let full = full.to_string_lossy().trim_start_matches(r"\\?\").to_string();
    st.insert(m.id.clone(), State { on: true, from: None, at: db::now(), path: Some(full) });
    save_states(db, &st)?;
    Ok(entry(data_dir, &m.id, st.get(&m.id)))
}

/// Remove a package. Returns the trash key for `restore` (None for a linked folder, which is only unlinked).
pub fn remove(db: &Db, data_dir: &Path, id: &str) -> Result<Option<String>> {
    if !valid_id(id) { return Err(bad("No such extension")); }
    let mut st = states(db);
    if st.get(id).is_some_and(|s| s.path.is_some()) {
        st.remove(id);
        save_states(db, &st)?;
        return Ok(None);
    }
    to_trash(data_dir, id)
}

/// Put a removed or replaced version back. A version installed since goes to the trash (its key is returned).
pub fn restore(db: &Db, data_dir: &Path, key: &str) -> Result<InstallResult> {
    let (id, _) = key.rsplit_once('~').ok_or_else(|| bad("Nothing to put back"))?;
    if !valid_id(id) || key.contains(['/', '\\']) { return Err(bad("Nothing to put back")); }
    let from = trash_root(data_dir).join(key);
    if !from.is_dir() { return Err(bad("That copy is gone from the trash")); }
    let m = read_manifest(&from)?;
    let prev = states(db).get(id).and_then(|s| s.from.clone());
    place(db, data_dir, &from, &m, prev)
}

/// A linked folder's link (for its Unlink undo).
pub fn relink(db: &Db, data_dir: &Path, path: &str) -> Result<Installed> { link_folder(db, data_dir, Path::new(path)) }

/// The theme files of an installed package, as JSON values (the UI checks them like any custom theme).
pub fn themes(db: &Db, data_dir: &Path, id: &str) -> Result<Vec<serde_json::Value>> {
    let e = get(db, data_dir, id)?;
    let m = e.manifest.ok_or_else(|| bad(e.problem.unwrap_or_default()))?;
    let dir = PathBuf::from(&e.dir);
    m.themes.iter().map(|t| {
        let p = dir.join(safe_relative(t).ok_or_else(|| bad("Bad theme path"))?);
        let text = fs::read_to_string(&p)?;
        serde_json::from_str(text.trim_start_matches('\u{feff}')).map_err(|err| bad(format!("{t} can't be read: {err}")))
    }).collect()
}

/// A file of an active package, for its pages. None when it isn't there.
pub fn page_file(db: &Db, data_dir: &Path, id: &str, rel: &str) -> Result<Option<(Manifest, PathBuf)>> {
    let (m, dir) = active(db, data_dir, id)?;
    let Some(r) = safe_relative(rel) else { return Ok(None) };
    let p = dir.join(r);
    Ok(p.is_file().then_some((m, p)))
}

// ── a package's own saved data ──

fn storage_path(data_dir: &Path, id: &str) -> PathBuf { data_dir.join("extension-data").join(format!("{id}.json")) }

pub fn storage_get(data_dir: &Path, id: &str) -> Result<serde_json::Map<String, serde_json::Value>> {
    if !valid_id(id) { return Err(bad("No such extension")); }
    match fs::read_to_string(storage_path(data_dir, id)) {
        Ok(t) => Ok(serde_json::from_str(&t).unwrap_or_default()),
        Err(_) => Ok(Default::default()),
    }
}

/// Saved data files as (id, path, bytes).
fn data_files(data_dir: &Path) -> Vec<(String, PathBuf, u64)> {
    let Ok(rd) = fs::read_dir(data_dir.join("extension-data")) else { return Vec::new() };
    rd.flatten().filter_map(|e| {
        let name = e.file_name().to_string_lossy().into_owned();
        let md = e.metadata().ok().filter(|m| m.is_file())?;
        Some((name.split('.').next().unwrap_or("").to_string(), e.path(), md.len()))
    }).collect()
}

/// Whether a package is installed or linked now.
fn present(db: &Db, data_dir: &Path, id: &str) -> bool { root(data_dir).join(id).is_dir() || states(db).get(id).is_some_and(|s| s.path.is_some()) }

/// Delete saved data. With `only_removed`, only the data of packages that aren't installed or linked now; otherwise
/// every package's. Returns the bytes freed.
pub fn clear_data(db: &Db, data_dir: &Path, only_removed: bool) -> Result<u64> {
    let mut freed = 0;
    for (id, path, bytes) in data_files(data_dir) {
        if only_removed && present(db, data_dir, &id) { continue; }
        fs::remove_file(&path)?;
        freed += bytes;
    }
    Ok(freed)
}

/// Delete the saved data of packages that were removed, whose copy in the trash is gone too and whose data hasn't
/// been written to for as long as the trash keeps a copy (a removed package can still be put back with its data, and
/// an unlinked folder has no trash copy, so Undo needs the data for that long). Nothing is deleted when the saved
/// state can't be read, since every linked package would look removed.
fn forget_stale_data(db: &Db, data_dir: &Path) {
    let files = data_files(data_dir);
    if files.is_empty() { return; }
    // a state that can't be read (a failed read or text that isn't JSON) must never make everything look removed
    let Ok(raw) = db.setting(STATE_SETTING) else { return };
    let known: BTreeMap<String, State> = match raw {
        None => BTreeMap::new(),
        Some(text) => match serde_json::from_str(&text) { Ok(m) => m, Err(_) => return },
    };
    let trashed: Vec<String> = fs::read_dir(trash_root(data_dir)).into_iter().flatten().flatten()
        .filter_map(|e| e.file_name().to_string_lossy().rsplit_once('~').map(|(id, _)| id.to_string())).collect();
    let cut = std::time::SystemTime::now() - std::time::Duration::from_secs(TRASH_DAYS as u64 * 86_400);
    for (id, path, _) in files {
        let linked = known.get(&id).is_some_and(|s| s.path.is_some());
        if linked || root(data_dir).join(&id).is_dir() || trashed.contains(&id) { continue; }
        if fs::metadata(&path).and_then(|m| m.modified()).is_ok_and(|t| t < cut) { let _ = fs::remove_file(path); }
    }
}

/// Set one key (None removes it). The whole store stays under 1 MB.
pub fn storage_set(data_dir: &Path, id: &str, key: &str, value: Option<serde_json::Value>) -> Result<()> {
    if key.is_empty() || key.len() > 200 { return Err(bad("Storage keys are 1 to 200 characters")); }
    let mut map = storage_get(data_dir, id)?;
    match value { Some(v) => { map.insert(key.to_string(), v); } None => { map.remove(key); } }
    let text = serde_json::to_string(&map)?;
    if text.len() > MAX_STORAGE { return Err(bad("An extension can keep up to 1 MB")); }
    let p = storage_path(data_dir, id);
    if let Some(d) = p.parent() { fs::create_dir_all(d)?; }
    let tmp = p.with_extension("json.tmp");
    fs::write(&tmp, text)?;
    fs::rename(&tmp, &p)?;
    Ok(())
}

// ── what a page may reach ──

/// A URL a package may call: its origin is in `permissions.net`.
pub fn allowed_url(m: &Manifest, raw: &str) -> Result<url::Url> {
    let u = url::Url::parse(raw).map_err(|_| bad(format!("\"{raw}\" isn't a web address")))?;
    let o = origin_of(raw).ok_or_else(|| bad(format!("{} can't call {raw}", m.name)))?;
    if !m.permissions.net.contains(&o) { return Err(bad(format!("{} doesn't ask for {o}", m.name))); }
    Ok(u)
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FetchRequest {
    pub url: String,
    pub method: Option<String>,
    pub headers: BTreeMap<String, String>,
    pub body: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchResponse {
    pub status: u16,
    pub content_type: Option<String>,
    pub body: String,
}

/// Call a web address for a package. Redirects aren't followed (they could leave the allowed origins); cookies
/// aren't kept.
pub async fn fetch(m: &Manifest, req: FetchRequest) -> Result<FetchResponse> {
    let u = allowed_url(m, &req.url)?;
    let local = u.host_str().is_some_and(is_loopback);
    let mut b = reqwest::Client::builder()
        .user_agent(crate::user_agent())
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(std::time::Duration::from_secs(if local { 2 } else { 10 }))
        .timeout(std::time::Duration::from_secs(30));
    if local { b = b.no_proxy(); }
    let http = b.build()?;
    let method = req.method.as_deref().unwrap_or("GET").to_ascii_uppercase();
    let method = match method.as_str() {
        "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" => reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| bad(e.to_string()))?,
        _ => return Err(bad(format!("{method} isn't allowed"))),
    };
    let mut r = http.request(method, u);
    for (k, v) in &req.headers {
        let lk = k.to_ascii_lowercase();
        if matches!(lk.as_str(), "host" | "cookie" | "origin" | "referer" | "connection" | "content-length" | "transfer-encoding") || lk.starts_with("proxy-") { continue; }
        r = r.header(k, v);
    }
    if let Some(b) = req.body { r = r.body(b); }
    let mut resp = r.send().await?;
    let status = resp.status().as_u16();
    let content_type = resp.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).map(str::to_string);
    let mut body = Vec::new();
    while let Some(chunk) = resp.chunk().await? {
        body.extend_from_slice(&chunk);
        if body.len() as u64 > MAX_READ { return Err(bad("The answer is over 8 MB")); }
    }
    Ok(FetchResponse { status, content_type, body: String::from_utf8_lossy(&body).into_owned() })
}

/// A path a package may read: inside one of its `permissions.files` folders, after resolving links.
pub fn allowed_path(m: &Manifest, raw: &str) -> Result<PathBuf> {
    let want = if raw.trim_start().starts_with('%') { expand_env(raw) } else { Some(PathBuf::from(raw)) }
        .ok_or_else(|| bad(format!("\"{raw}\" isn't a path {} may read", m.name)))?;
    let real = fs::canonicalize(&want).map_err(|_| bad(format!("{} isn't there", want.display())))?;
    for f in &m.permissions.files {
        if let Some(base) = expand_env(f).and_then(|b| fs::canonicalize(b).ok()) {
            if real.starts_with(&base) { return Ok(real); }
        }
    }
    Err(bad(format!("{} doesn't ask to read {}", m.name, want.display())))
}

pub fn read_file(m: &Manifest, raw: &str) -> Result<String> {
    let p = allowed_path(m, raw)?;
    let meta = fs::metadata(&p).at(&p)?;
    if !meta.is_file() { return Err(bad("That's a folder, not a file")); }
    if meta.len() > MAX_READ { return Err(bad("That file is over 8 MB")); }
    Ok(String::from_utf8_lossy(&fs::read(&p)?).into_owned())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry { pub name: String, pub dir: bool, pub size: u64, pub modified: i64 }

pub fn list_dir(m: &Manifest, raw: &str) -> Result<Vec<DirEntry>> {
    let p = allowed_path(m, raw)?;
    let mut out = Vec::new();
    for e in fs::read_dir(&p).at(&p)?.flatten().take(5000) {
        let Ok(meta) = e.metadata() else { continue };
        let modified = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0, |d| d.as_secs() as i64);
        out.push(DirEntry { name: e.file_name().to_string_lossy().into_owned(), dir: meta.is_dir(), size: meta.len(), modified });
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

// ── other apps a package works with ──

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    pub name: String,
    pub url: Option<String>,
    pub required: bool,
    pub installed: bool,
    /// Where it was found.
    pub path: Option<String>,
    /// None when the package gives no way to tell.
    pub running: Option<bool>,
    pub can_open: bool,
}

/// Find each app a package needs (files, then Windows' installed apps). `running` is filled by `check_running`.
pub fn find_apps(m: &Manifest) -> Vec<AppStatus> {
    m.needs.iter().map(|a| {
        let mut path = a.paths.iter().filter_map(|p| expand_env(p)).find(|p| p.exists()).map(|p| p.to_string_lossy().into_owned());
        let mut installed = path.is_some();
        if !installed {
            if let Some(n) = &a.uninstall_name {
                if let Some(loc) = uninstall_lookup(n) { installed = true; if !loc.is_empty() { path = Some(loc); } }
            }
        }
        let exe = path.as_deref().is_some_and(|p| p.to_ascii_lowercase().ends_with(".exe"));
        AppStatus { name: a.name.clone(), url: a.url.clone(), required: a.required, installed, path, running: None, can_open: installed && (a.open.is_some() || exe) }
    }).collect()
}

/// Ask each app's `running` URL (half a second each).
pub async fn check_running(m: &Manifest, apps: &mut [AppStatus]) {
    for (a, s) in m.needs.iter().zip(apps.iter_mut()) {
        let Some(url) = &a.running else { continue };
        let ok = match reqwest::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_millis(600)).build() {
            Ok(c) => c.get(url).send().await.is_ok(),
            Err(_) => false,
        };
        s.running = Some(ok);
    }
}

/// What to start to open an app a package needs: its own link, or the exe that was found.
pub fn open_target(m: &Manifest, name: &str) -> Result<String> {
    let a = m.needs.iter().find(|a| a.name == name).ok_or_else(|| bad(format!("{} doesn't list {name}", m.name)))?;
    if let Some(o) = &a.open { return Ok(o.clone()); }
    let s = find_apps(&Manifest { needs: vec![a.clone()], ..m.clone() }).remove(0);
    match s.path { Some(p) if p.to_ascii_lowercase().ends_with(".exe") => Ok(p), _ => Err(bad(format!("{name} isn't installed"))) }
}

#[cfg(windows)]
fn uninstall_lookup(name: &str) -> Option<String> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;
    let want = name.trim().to_lowercase();
    if want.is_empty() { return None; }
    let keys = [
        (HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Uninstall"),
        (HKEY_LOCAL_MACHINE, r"Software\Microsoft\Windows\CurrentVersion\Uninstall"),
        (HKEY_LOCAL_MACHINE, r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
    ];
    for (hive, path) in keys {
        let Ok(list) = RegKey::predef(hive).open_subkey(path) else { continue };
        for sub in list.enum_keys().flatten() {
            let Ok(k) = list.open_subkey(&sub) else { continue };
            let Ok(dn) = k.get_value::<String, _>("DisplayName") else { continue };
            let dn = dn.to_lowercase();
            if dn != want && !dn.starts_with(&format!("{want} ")) { continue; }
            let loc = k.get_value::<String, _>("InstallLocation").ok().filter(|s| !s.trim().is_empty())
                .or_else(|| k.get_value::<String, _>("DisplayIcon").ok().map(|s| s.split(',').next().unwrap_or("").trim().trim_matches('"').to_string()));
            return Some(loc.unwrap_or_default());
        }
    }
    None
}
#[cfg(not(windows))]
fn uninstall_lookup(_name: &str) -> Option<String> { None }

// ── repos ──

/// What a repo lists for a package. Built by the repo's index script from each package's manifest.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct IndexEntry {
    pub id: String,
    pub name: String,
    pub version: String,
    /// "theme" or "extension".
    pub kind: String,
    pub author: String,
    pub description: String,
    pub games: Vec<String>,
    pub homepage: Option<String>,
    pub icon: Option<String>,
    /// A picture of it in use.
    pub preview: Option<String>,
    pub download: String,
    pub sha256: String,
    pub size: u64,
    pub updated: i64,
    pub app: Option<String>,
    pub permissions: Permissions,
    /// Names and links of the apps it works with.
    pub needs: Vec<NeededLink>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct NeededLink { pub name: String, pub url: Option<String>, #[serde(default = "yes")] pub required: bool }

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Index {
    pub format: u32,
    pub name: String,
    /// Where people send a package to be listed.
    pub submit: Option<String>,
    pub packages: Vec<IndexEntry>,
}

/// A repo as the UI shows it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Repo {
    pub source: String,
    pub name: String,
    pub submit: Option<String>,
    pub packages: Vec<IndexEntry>,
    /// Why the list couldn't be fetched (an older copy may still be shown).
    pub error: Option<String>,
    /// When the list shown was fetched.
    pub fetched_at: i64,
}

/// Read an index. Entries that don't check out are left out; an index this build can't read is an error.
pub fn parse_index(text: &str) -> Result<Index> {
    let mut ix: Index = serde_json::from_str(text.trim_start_matches('\u{feff}')).map_err(|e| bad(format!("The extension list can't be read ({e})")))?;
    if ix.format > FORMAT { return Err(bad("This extension list needs a newer gachamod")); }
    if ix.submit.as_deref().is_some_and(|s| !https(s)) { ix.submit = None; }
    ix.packages.retain_mut(|p| {
        p.permissions.net = p.permissions.net.iter().filter_map(|o| origin_of(o)).collect();
        if p.icon.as_deref().is_some_and(|i| !https(i)) { p.icon = None; }
        if p.preview.as_deref().is_some_and(|i| !https(i)) { p.preview = None; }
        if p.homepage.as_deref().is_some_and(|i| !https(i)) { p.homepage = None; }
        if p.kind != "theme" { p.kind = "extension".into(); }
        valid_id(&p.id) && !p.name.trim().is_empty() && parse_version(&p.version).is_some() && https(&p.download)
            && p.sha256.len() == 64 && p.sha256.bytes().all(|b| b.is_ascii_hexdigit()) && p.size <= MAX_PACKAGE
    });
    for p in &mut ix.packages { p.sha256 = p.sha256.to_ascii_lowercase(); }
    Ok(ix)
}

/// The repos to show: gachamod's own, then the ones the user added.
pub fn sources(db: &Db) -> Vec<String> {
    let mut out = vec![DEFAULT_SOURCE.to_string()];
    let extra: Vec<String> = db.setting_json(SOURCES_SETTING).ok().flatten().unwrap_or_default();
    for s in extra { let s = s.trim().to_string(); if https(&s) && !out.contains(&s) { out.push(s); } }
    out
}

pub fn cache_key(source: &str) -> String { format!("ext-index:{source}") }

/// The site in a link ("raw.githubusercontent.com"), for error text.
fn host(link: &str) -> String {
    url::Url::parse(link).ok().and_then(|u| u.host_str().map(str::to_string)).unwrap_or_else(|| "the server".into())
}

/// Download an index (up to 4 MB).
pub async fn fetch_index(http: &reqwest::Client, source: &str) -> Result<String> {
    if !https(source) { return Err(bad("Extension lists load over https only")); }
    let site = host(source);
    let resp = http.get(source).timeout(std::time::Duration::from_secs(15)).send().await.map_err(|e| Error::unreachable(&site, e.without_url()))?;
    let status = resp.status().as_u16();
    if status == 404 { return Err(Error::Site { site, status, message: "The extension list isn't at that address".into() }); }
    if !resp.status().is_success() { return Err(Error::Site { site, status, message: "The extension list didn't come".into() }); }
    let bytes = resp.bytes().await.map_err(|e| Error::unreachable(&site, e.without_url()))?;
    if bytes.len() > 4 * 1024 * 1024 { return Err(bad("The extension list is over 4 MB")); }
    let text = String::from_utf8_lossy(&bytes).into_owned();
    parse_index(&text)?;
    Ok(text)
}

/// Download a listed package to `dir` and check its size and SHA-256. Returns the file.
pub async fn download_package(http: &reqwest::Client, e: &IndexEntry, dir: &Path) -> Result<PathBuf> {
    if !https(&e.download) { return Err(bad("Packages download over https only")); }
    let site = host(&e.download);
    let mut resp = http.get(&e.download).timeout(std::time::Duration::from_secs(120)).send().await.map_err(|err| Error::unreachable(&site, err.without_url()))?;
    if !resp.status().is_success() { return Err(Error::Site { site, status: resp.status().as_u16(), message: format!("{} didn't download", e.name) }); }
    let mut h = Sha256::new();
    let mut data = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(|err| Error::unreachable(&site, err.without_url()))? {
        h.update(&chunk);
        data.extend_from_slice(&chunk);
        if data.len() as u64 > MAX_PACKAGE { return Err(bad(format!("{} is over {} MB", e.name, MAX_PACKAGE / 1024 / 1024))); }
    }
    let got = hex::encode(h.finalize());
    if got != e.sha256 { return Err(bad(format!("{} didn't match the repo's checksum, so it wasn't installed. Try again later", e.name))); }
    fs::create_dir_all(dir)?;
    let path = dir.join(format!("ext-{}-{}.zip", e.id, now_ms()));
    fs::write(&path, &data)?;
    Ok(path)
}

// ── making packages ──

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Packed { pub path: String, pub id: String, pub name: String, pub version: String, pub size: u64, pub sha256: String }

fn zip_files(out: &Path, files: &[(String, Vec<u8>)]) -> Result<u64> {
    let tmp = out.with_extension("zip.part");
    {
        let mut w = zip::ZipWriter::new(fs::File::create(&tmp)?);
        let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated)
            .last_modified_time(zip::DateTime::default());
        for (name, data) in files {
            w.start_file(name.as_str(), opts).map_err(|e| bad(e.to_string()))?;
            w.write_all(data)?;
        }
        w.finish().map_err(|e| bad(e.to_string()))?;
    }
    fs::rename(&tmp, out)?;
    Ok(fs::metadata(out)?.len())
}

fn sha_of(path: &Path) -> Result<String> { Ok(hex::encode(Sha256::digest(fs::read(path)?))) }

/// Zip a package folder for sharing, after checking it like an install would.
pub fn pack_folder(folder: &Path, out: &Path) -> Result<Packed> {
    let m = read_manifest(folder)?;
    let mut files = Vec::new();
    let mut total = 0u64;
    for e in walkdir::WalkDir::new(folder).follow_links(false).sort_by_file_name().into_iter().filter_entry(|e| e.depth() == 0 || !skipped(&e.file_name().to_string_lossy())) {
        let e = e.map_err(|e| bad(e.to_string()))?;
        if !e.file_type().is_file() { continue; }
        let rel = e.path().strip_prefix(folder).map_err(|e| bad(e.to_string()))?;
        let name = rel.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/");
        if name.to_ascii_lowercase().ends_with(".zip") { continue; }
        let data = fs::read(e.path())?;
        total += data.len() as u64;
        files.push((name, data));
        if files.len() > MAX_FILES || total > MAX_UNPACKED { return Err(bad("That folder is too big for a package (2000 files, 64 MB)")); }
    }
    let size = zip_files(out, &files)?;
    if size > MAX_PACKAGE { let _ = fs::remove_file(out); return Err(bad(format!("The package is over {} MB", MAX_PACKAGE / 1024 / 1024))); }
    Ok(Packed { path: out.to_string_lossy().into_owned(), id: m.id, name: m.name, version: m.version, size, sha256: sha_of(out)? })
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ThemeMeta { pub id: String, pub name: String, pub version: String, pub author: String, pub description: String, pub games: Vec<String> }

/// Package one custom theme (its JSON from the UI) for sharing.
pub fn pack_theme(theme: &serde_json::Value, meta: ThemeMeta, out: &Path) -> Result<Packed> {
    if !theme.is_object() || theme.get("name").and_then(|n| n.as_str()).is_none_or(|n| n.trim().is_empty()) {
        return Err(bad("That isn't a theme"));
    }
    let m = check(Manifest {
        format: FORMAT, id: meta.id, name: meta.name, version: if meta.version.is_empty() { "1.0.0".into() } else { meta.version },
        author: meta.author, description: meta.description, games: meta.games, themes: vec!["theme.json".into()], ..Default::default()
    }, None)?;
    let manifest = serde_json::to_vec_pretty(&manifest_json(&m))?;
    let size = zip_files(out, &[(MANIFEST.into(), manifest), ("theme.json".into(), serde_json::to_vec_pretty(theme)?)])?;
    Ok(Packed { path: out.to_string_lossy().into_owned(), id: m.id, name: m.name, version: m.version, size, sha256: sha_of(out)? })
}

/// A manifest as people write it: empty fields left out.
fn manifest_json(m: &Manifest) -> serde_json::Value {
    let mut v = serde_json::to_value(m).unwrap_or_default();
    if let Some(o) = v.as_object_mut() {
        o.retain(|_, x| !(x.is_null() || x.as_array().is_some_and(|a| a.is_empty()) || x.as_str() == Some("")));
        if m.permissions.is_empty() { o.remove("permissions"); }
    }
    v
}

#[cfg(test)]
mod tests;
