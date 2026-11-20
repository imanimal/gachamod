//! Fixers for mods a game update broke, from GameBanana or GitHub. Each file goes to
//! `<data>/fixers/<game>/<tool name>/<file name>/` (archives are extracted there) and is listed in
//! `<data>/fixers/<game>/fixers.json`. When a mod needs more than the hash swap gachamod does itself, gachamod
//! downloads the fixer the fix data names and runs it on that mod, as its readme says to (from inside the mod's
//! folder), with a backup of the mod first. Its code and data are never copied into gachamod. Owner: FIXES area.

use crate::download::{download, safe_file_name};
use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// A downloaded fixer file.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct FixerFile {
    pub tool_id: u64,
    pub file_id: u64,
    /// The tool's name on GameBanana ("7.2 Odette and Vesna Fix").
    pub tool: String,
    /// The file's name on GameBanana ("version_72_fix.exe").
    pub file: String,
    /// The folder it was saved in.
    pub dir: String,
    /// What Explorer shows: the one program in the folder (an .exe, else a .bat or .py), or the folder itself.
    pub main: String,
    pub at: i64,
    /// The link the fix data gives for the tool, for one that comes from GitHub.
    pub source: String,
    /// It opens a window of its own and works through the whole Mods folder there, so it runs once for every mod
    /// that needs it. Worked out when listed, not saved.
    #[serde(skip_deserializing)]
    pub window: bool,
}

/// One file of a GameBanana tool to download.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct FixerRequest {
    pub tool_id: u64,
    pub file_id: u64,
    pub tool: String,
    pub file: String,
    pub url: String,
    /// The MD5 GameBanana lists for the file, checked when given.
    pub md5: Option<String>,
    pub source: String,
}

const LIST: &str = "fixers.json";

fn root(data_dir: &Path, game: &str) -> Result<PathBuf> {
    // a game id is one plain folder name (extension games included)
    if game.is_empty() || game.len() > 40 || !game.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err(Error::Invalid(format!("Unknown game \"{game}\"")));
    }
    Ok(data_dir.join("fixers").join(game))
}

/// A folder name from a name on GameBanana, kept short so the paths inside stay under Windows' limit.
fn folder_name(name: &str, fallback: &str) -> String {
    let s: String = safe_file_name(name).chars().take(60).collect();
    let s = s.trim().trim_end_matches(['.', ' ']).to_string();
    if s.is_empty() || s == "download.bin" { fallback.into() } else { s }
}

/// The fixers downloaded for a game, oldest first. Ones whose files were deleted since are left out.
pub fn list(data_dir: &Path, game: &str) -> Result<Vec<FixerFile>> {
    let path = root(data_dir, game)?.join(LIST);
    let all: Vec<FixerFile> = std::fs::read_to_string(&path).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    Ok(all.into_iter().filter(|f| Path::new(&f.main).exists()).map(|mut f| { f.window = is_window_exe(Path::new(&f.main)); f }).collect())
}

/// The same fixer: the same GameBanana tool, or the same link in the fix data.
fn same_fixer(a: &FixerFile, b: &FixerFile) -> bool {
    (a.tool_id != 0 && a.tool_id == b.tool_id) || (!a.source.is_empty() && a.source == b.source)
}

/// List a downloaded fixer. Older versions of the same fixer are deleted, so there is one copy of each: the newest.
fn remember(data_dir: &Path, game: &str, entry: &FixerFile) -> Result<()> {
    let mut all = list(data_dir, game)?;
    let base = root(data_dir, game)?;
    for old in all.iter().filter(|f| f.file_id != entry.file_id && same_fixer(f, entry) && f.dir != entry.dir) {
        let dir = PathBuf::from(&old.dir);
        // only a folder of its own inside the fixers folder
        if dir.starts_with(&base) && dir != base { let _ = std::fs::remove_dir_all(&dir); }
        if let Some(up) = dir.parent().filter(|p| *p != base && p.starts_with(&base)) { let _ = std::fs::remove_dir(up); }
    }
    all.retain(|f| f.file_id != entry.file_id && !same_fixer(f, entry));
    all.push(entry.clone());
    let path = root(data_dir, game)?.join(LIST);
    std::fs::write(&path, serde_json::to_string_pretty(&all).map_err(|e| Error::Invalid(e.to_string()))?)?;
    Ok(())
}

/// Only GameBanana's own https links are downloaded.
fn from_gamebanana(url: &str) -> bool {
    url::Url::parse(url).is_ok_and(|u| {
        u.scheme() == "https" && u.host_str().is_some_and(|h| h == "gamebanana.com" || h.ends_with(".gamebanana.com"))
    })
}

/// Download one file of a GameBanana tool and keep it in the fixers folder. Downloading a file again replaces it.
pub async fn fetch(http: &reqwest::Client, data_dir: &Path, game: &str, req: FixerRequest) -> Result<FixerFile> {
    if !from_gamebanana(&req.url) { return Err(Error::Invalid("Fixers are only downloaded from GameBanana".into())); }
    fetch_from(http, data_dir, game, req).await
}

async fn fetch_from(http: &reqwest::Client, data_dir: &Path, game: &str, req: FixerRequest) -> Result<FixerFile> {
    let base = root(data_dir, game)?;
    // one folder per link: a part left by another file of the same name (an older release) is never carried on from
    let tmp = base.join(format!(".downloading-{:x}", link_id(&req.url)));
    let got = download(http, &req.url, &tmp, &req.file, None, |_, _| true).await?;
    if let Some(want) = req.md5.as_deref().map(str::trim).filter(|m| !m.is_empty()) {
        if !got.md5.eq_ignore_ascii_case(want) {
            let _ = tokio::fs::remove_dir_all(&tmp).await;
            return Err(Error::Invalid("The download doesn't match the checksum GameBanana lists. Try again".into()));
        }
    }
    let (data, game) = (data_dir.to_path_buf(), game.to_string());
    let placed = tokio::task::spawn_blocking(move || place(&data, &game, &req, &got.path))
        .await
        .unwrap_or_else(|e| Err(Error::Invalid(e.to_string())));
    let _ = tokio::fs::remove_dir_all(&tmp).await;
    placed
}

/// Move a downloaded file into its folder (extracting an archive) and list it.
pub fn place(data_dir: &Path, game: &str, req: &FixerRequest, downloaded: &Path) -> Result<FixerFile> {
    let file = safe_file_name(&req.file);
    let stem = Path::new(&file).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let dir = root(data_dir, game)?.join(folder_name(&req.tool, "Fixer")).join(folder_name(&stem, "Files"));
    // unpacked beside the folder first: a copy that worked stays until the new one is whole
    let new = dir.with_file_name(format!("{}.new", folder_name(&stem, "Files")));
    if new.exists() { std::fs::remove_dir_all(&new)?; }
    std::fs::create_dir_all(&new)?;
    let filled = if crate::archive::detect(downloaded).is_ok() {
        let r = crate::archive::extract(downloaded, &new).map(|_| ());
        let _ = std::fs::remove_file(downloaded);
        r
    } else {
        let to = new.join(&file);
        std::fs::rename(downloaded, &to).or_else(|_| std::fs::copy(downloaded, &to).map(|_| { let _ = std::fs::remove_file(downloaded); })).map_err(Error::from)
    };
    if let Err(e) = filled { let _ = std::fs::remove_dir_all(&new); return Err(e); }
    if dir.exists() { std::fs::remove_dir_all(&dir)?; }
    std::fs::rename(&new, &dir)?;
    let entry = FixerFile {
        tool_id: req.tool_id, file_id: req.file_id, tool: req.tool.clone(), file: req.file.clone(),
        dir: dir.to_string_lossy().into_owned(), main: main_of(&dir).to_string_lossy().into_owned(), at: crate::db::now(),
        source: req.source.clone(), window: false,
    };
    remember(data_dir, game, &entry)?;
    Ok(entry)
}

/// The program to point at: the only .exe, else the only .bat or .cmd, else the only .py. Two of a kind (or none)
/// means the folder.
fn main_of(dir: &Path) -> PathBuf {
    let files: Vec<PathBuf> = walkdir::WalkDir::new(dir).max_depth(4).into_iter().flatten()
        .filter(|e| e.file_type().is_file()).map(|e| e.into_path()).collect();
    let ext = |p: &Path| p.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
    for kinds in [&["exe"][..], &["bat", "cmd"][..], &["py", "pyw"][..]] {
        let found: Vec<&PathBuf> = files.iter().filter(|p| kinds.contains(&ext(p).as_str())).collect();
        match found.len() {
            0 => continue,
            1 => return found[0].clone(),
            _ => break,
        }
    }
    dir.to_path_buf()
}

// ── fixers that live on GitHub ──

#[derive(Deserialize)]
struct Release { assets: Vec<Asset> }
#[derive(Deserialize)]
struct Asset { id: u64, name: String, browser_download_url: String }

/// A number that stays the same for the same link (for a script file, which has no id of its own).
fn link_id(s: &str) -> u64 {
    use sha2::{Digest, Sha256};
    let h = Sha256::digest(s.as_bytes());
    u64::from_le_bytes(h[..8].try_into().unwrap_or_default())
}

/// The Windows program of a release: an .exe, else a zip that names Windows, else any zip.
fn windows_asset(assets: &[Asset]) -> Option<&Asset> {
    let n = |a: &Asset| a.name.to_ascii_lowercase();
    let not_other = |a: &&Asset| !["linux", "mac", "darwin", "arm64"].iter().any(|o| n(a).contains(o));
    assets.iter().filter(not_other).find(|a| n(a).ends_with(".exe"))
        .or_else(|| assets.iter().filter(not_other).find(|a| n(a).ends_with(".zip") && n(a).contains("win")))
        .or_else(|| assets.iter().filter(not_other).find(|a| n(a).ends_with(".zip")))
}

/// Download a fixer from GitHub: the newest release's Windows program for a repository link, or the file itself
/// for a link to one file (`github.com/<owner>/<repo>/blob/<branch>/<path>`). A copy already downloaded is used
/// when it's the newest.
pub async fn fetch_github(http: &reqwest::Client, data_dir: &Path, game: &str, source: &str, tool: &str) -> Result<FixerFile> {
    let u = url::Url::parse(source).map_err(|_| Error::Invalid(format!("\"{source}\" isn't a link")))?;
    if u.scheme() != "https" || u.host_str() != Some("github.com") { return Err(Error::Invalid("Only GitHub links are read here".into())); }
    let parts: Vec<&str> = u.path_segments().map(|s| s.filter(|x| !x.is_empty()).collect()).unwrap_or_default();
    let [owner, repo, rest @ ..] = parts.as_slice() else { return Err(Error::Invalid(format!("\"{source}\" isn't a GitHub project"))) };
    let (url, file, id) = if rest.first() == Some(&"blob") && rest.len() >= 3 {
        let raw = format!("https://raw.githubusercontent.com/{owner}/{repo}/{}", rest[1..].join("/"));
        (raw, rest.last().copied().unwrap_or("fix.py").to_string(), link_id(source))
    } else {
        let r = http.get(format!("https://api.github.com/repos/{owner}/{repo}/releases/latest"))
            .header("Accept", "application/vnd.github+json").send().await.map_err(|e| Error::unreachable("GitHub", e.without_url()))?;
        if r.status().as_u16() == 403 || r.status().as_u16() == 429 {
            return Err(Error::RateLimited { site: "GitHub".into(), wait: "an hour" });
        }
        if !r.status().is_success() { return Err(Error::Site { site: "GitHub".into(), status: r.status().as_u16(), message: format!("{tool}'s newest release didn't come") }); }
        let rel: Release = r.json().await.map_err(|e| Error::Decode(e.to_string()))?;
        let a = windows_asset(&rel.assets).ok_or_else(|| Error::Invalid(format!("{tool}'s newest release has no Windows program")))?;
        (a.browser_download_url.clone(), a.name.clone(), a.id)
    };
    if let Some(f) = list(data_dir, game)?.into_iter().find(|f| f.file_id == id && f.source == source) { return Ok(f); }
    fetch_from(http, data_dir, game, FixerRequest { tool_id: 0, file_id: id, tool: tool.into(), file, url, md5: None, source: source.into() }).await
}

// ── running a fixer on a mod ──

/// What running a fixer on one mod did.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FixerRun {
    pub mod_id: String,
    pub name: String,
    /// Copies of what it changed: restoring it undoes the run. None when it changed nothing.
    pub backup: Option<crate::backups::Backup>,
    /// Files it changed, added or removed.
    pub changed: usize,
    /// It was still running at the time limit and was stopped.
    pub stopped: bool,
    /// The end of what it printed.
    pub output: String,
}

/// A console fixer that's still running after this waits for a key press nobody can give it.
const CONSOLE_LIMIT: std::time::Duration = std::time::Duration::from_secs(120);
/// How long a fixer with its own window is watched for.
const WINDOW_LIMIT: std::time::Duration = std::time::Duration::from_secs(10 * 60);
/// A window fixer is done once the Mods folder has stayed the same this long after it changed something.
const QUIET: std::time::Duration = std::time::Duration::from_secs(6);

static STOP_WAITING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
/// Stop watching a fixer's window now and go by what it has changed so far.
pub fn stop_waiting() { STOP_WAITING.store(true, std::sync::atomic::Ordering::Relaxed); }

type Snapshot = std::collections::BTreeMap<String, (u64, Option<std::time::SystemTime>)>;

fn snapshot(dir: &Path) -> Snapshot {
    walkdir::WalkDir::new(dir).into_iter().flatten().filter(|e| e.file_type().is_file()).filter_map(|e| {
        let rel = e.path().strip_prefix(dir).ok()?.to_string_lossy().replace('\\', "/");
        let m = e.metadata().ok()?;
        Some((rel, (m.len(), m.modified().ok())))
    }).collect()
}

/// (changed or removed files, created files)
fn diff(before: &Snapshot, after: &Snapshot) -> (Vec<String>, Vec<String>) {
    let changed = before.iter().filter(|(rel, meta)| after.get(*rel) != Some(*meta)).map(|(rel, _)| rel.clone()).collect();
    let created = after.keys().filter(|r| !before.contains_key(*r)).cloned().collect();
    (changed, created)
}

/// An .exe built for its own window (not a console).
fn is_window_exe(p: &Path) -> bool {
    let Ok(b) = std::fs::read(p).map(|b| b.into_iter().take(8192).collect::<Vec<u8>>()) else { return false };
    let at = |i: usize| b.get(i..i + 4).map(|s| u32::from_le_bytes([s[0], s[1], s[2], s[3]]) as usize);
    let Some(pe) = at(0x3c) else { return false };
    if b.get(pe..pe + 4) != Some(b"PE\0\0") { return false; }
    b.get(pe + 24 + 68..pe + 24 + 70).is_some_and(|s| u16::from_le_bytes([s[0], s[1]]) == 2)
}

/// Python to run a .py fixer with: the py launcher, else a python.exe that isn't the Store's placeholder.
fn find_python() -> Option<(PathBuf, Vec<&'static str>)> {
    let path = std::env::var_os("PATH")?;
    let dirs: Vec<PathBuf> = std::env::split_paths(&path).collect();
    if let Some(p) = dirs.iter().map(|d| d.join("py.exe")).find(|p| p.is_file()) { return Some((p, vec!["-3"])); }
    dirs.iter().filter(|d| !d.to_string_lossy().to_ascii_lowercase().contains("windowsapps"))
        .map(|d| d.join("python.exe")).find(|p| p.is_file()).map(|p| (p, vec![]))
}

struct Ran { window: bool, stopped: bool, output: String }

/// Start `main` in `cwd` and wait for it. A console program runs hidden: its questions get the folder and then Enter.
fn launch(main: &Path, cwd: &Path, tool: &str) -> Result<Ran> {
    use std::io::{Read, Write};
    use std::process::{Command, Stdio};
    let ext = main.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
    let window = ext == "exe" && is_window_exe(main);
    let mut cmd = match ext.as_str() {
        "exe" => Command::new(main),
        "bat" | "cmd" => { let mut c = Command::new("cmd"); c.arg("/C").arg(main); c }
        "py" | "pyw" => {
            let (py, args) = find_python().ok_or_else(|| Error::Invalid(format!("{tool} is a Python script, and Python isn't installed on this PC")))?;
            let mut c = Command::new(py);
            c.args(args).arg(main);
            c
        }
        _ => return Err(Error::Invalid(format!("{tool} has more than one program in it, so gachamod can't tell which to run"))),
    };
    cmd.current_dir(cwd);
    static N: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    let log = std::env::temp_dir().join(format!("gachamod-fixer-{}-{}.log", std::process::id(), N.fetch_add(1, std::sync::atomic::Ordering::Relaxed)));
    if !window {
        let f = std::fs::File::create(&log)?;
        cmd.stdin(Stdio::piped()).stdout(Stdio::from(f.try_clone()?)).stderr(Stdio::from(f));
        #[cfg(windows)]
        { use std::os::windows::process::CommandExt; cmd.creation_flags(0x0800_0000); }
    }
    let mut child = cmd.spawn().map_err(|e| Error::Invalid(format!("{tool} didn't start: {e}")))?;
    if let Some(mut input) = child.stdin.take() {
        let answers = format!("{}\n{}", cwd.display(), "\n".repeat(30));
        // dropping it at the end closes the input, so a question after these gets "end of input"
        std::thread::spawn(move || { let _ = input.write_all(answers.as_bytes()); });
    }
    let limit = if window { WINDOW_LIMIT } else { CONSOLE_LIMIT };
    let start = std::time::Instant::now();
    let stopped = loop {
        if child.try_wait()?.is_some() { break false; }
        if start.elapsed() > limit {
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                let _ = Command::new("taskkill").args(["/PID", &child.id().to_string(), "/T", "/F"]).creation_flags(0x0800_0000).output();
            }
            let _ = child.kill();
            let _ = child.wait();
            break true;
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    };
    let mut output = String::new();
    if let Ok(mut f) = std::fs::File::open(&log) {
        let mut b = Vec::new();
        let _ = f.read_to_end(&mut b);
        output = String::from_utf8_lossy(&b).into_owned();
    }
    let _ = std::fs::remove_file(&log);
    let tail: String = output.chars().rev().take(2000).collect::<Vec<_>>().into_iter().rev().collect();
    Ok(Ran { window, stopped, output: tail.trim().to_string() })
}

fn lock(shared: &crate::db::Shared) -> Result<std::sync::MutexGuard<'_, crate::db::Db>> {
    shared.lock().map_err(|_| Error::Db("The local database is stuck. Restart gachamod".into()))
}

fn fixer_of(data_dir: &Path, game: &str, file_id: u64) -> Result<FixerFile> {
    list(data_dir, game)?.into_iter().find(|f| f.file_id == file_id)
        .ok_or_else(|| Error::Invalid("That fixer isn't downloaded any more. Try again".into()))
}

/// A mod with every file copied, ready for a fixer.
struct Readied { m: crate::model::ModEntry, dir: PathBuf, before: Snapshot, backup: crate::backups::Backup }

fn ready(shared: &crate::db::Shared, game: &str, mod_id: &str, tool: &str) -> Result<Readied> {
    let m = crate::library::get(&*lock(shared)?, game, mod_id)?;
    let dir = PathBuf::from(&m.path);
    if !dir.is_dir() { return Err(Error::Invalid(format!("{}'s folder isn't there any more", m.name))); }
    let before = snapshot(&dir);
    let files: Vec<String> = before.keys().cloned().collect();
    let db = lock(shared)?;
    // listing trims a backup that an earlier run of this mod never finished (the app was closed while it ran)
    let _ = crate::backups::list(&db, Some(game), Some(mod_id));
    let backup = crate::backups::take_open(&db, game, mod_id, &dir, &files, &format!("Ran {tool} on {}", m.name))?;
    drop(db);
    Ok(Readied { m, dir, before, backup })
}

/// Measure what the fixer did to a mod: the backup keeps only what changed, and the run is remembered.
fn settle(shared: &crate::db::Shared, game: &str, r: Readied, after: &Snapshot, tool: &str, stopped: bool, output: &str) -> Result<FixerRun> {
    let (touched, created) = diff(&r.before, after);
    // a fixer that saves every file again changes their times, not their bytes: keep copies of the ones it changed
    let copies = crate::backups::folder(&*lock(shared)?, &r.backup.id);
    let changed = crate::backups::differing(&copies, &r.dir, &touched);
    let n = changed.len() + created.len();
    let backup = crate::backups::keep_only(&*lock(shared)?, r.backup, &changed, &created)?;
    if backup.is_some() && r.m.loaded() { crate::devtools::mark_changed(game); }
    let _ = crate::fixes::note_attempt(&*lock(shared)?, game, &r.m.id, tool, n);
    crate::logs::info(format!("Ran {tool} on {}: {n} files changed{}", r.m.name, if stopped { ", stopped at the time limit" } else { "" }));
    Ok(FixerRun { mod_id: r.m.id.clone(), name: r.m.name.clone(), backup, changed: n, stopped, output: output.into() })
}

/// Open a fixer that has its own window and watch what it does. Nobody has to close it: it is done when it has
/// changed files under `watch` (the Mods folder) and they have then stayed the same for a few seconds, when its
/// window is closed, when the player says to stop waiting, or after ten minutes. The window is left open.
fn launch_window(main: &Path, cwd: &Path, tool: &str, watch: &Path) -> Result<()> {
    use std::sync::atomic::Ordering;
    let mut child = std::process::Command::new(main).current_dir(cwd).spawn()
        .map_err(|e| Error::Invalid(format!("{tool} didn't start: {e}")))?;
    STOP_WAITING.store(false, Ordering::Relaxed);
    let start = std::time::Instant::now();
    let mut last = snapshot(watch);
    let mut changed_at: Option<std::time::Instant> = None;
    loop {
        std::thread::sleep(std::time::Duration::from_millis(1500));
        if child.try_wait().ok().flatten().is_some() || STOP_WAITING.swap(false, Ordering::Relaxed) { break; }
        let now = snapshot(watch);
        if now != last { changed_at = Some(std::time::Instant::now()); last = now; }
        else if changed_at.is_some_and(|t| t.elapsed() >= QUIET) { break; }
        if start.elapsed() > WINDOW_LIMIT { break; }
    }
    Ok(())
}

/// Run a downloaded fixer (`file_id`) on one mod the way fixers' readmes say: from inside the mod's folder. Every
/// file is copied first, and the backup keeps the ones that changed (restoring it undoes the run).
/// A fixer that changes nothing from its own folder gets one more try as a copy placed in the mod's folder.
pub fn run_on_mod(shared: &crate::db::Shared, data_dir: &Path, game: &str, file_id: u64, mod_id: &str) -> Result<FixerRun> {
    let fixer = fixer_of(data_dir, game, file_id)?;
    if fixer.window {
        let mut runs = run_on_mods(shared, data_dir, game, file_id, &[mod_id.to_string()])?;
        return runs.pop().ok_or_else(|| Error::Invalid("That mod isn't there any more".into()));
    }
    let r = ready(shared, game, mod_id, &fixer.tool)?;
    let main = PathBuf::from(&fixer.main);
    let mut ran = match launch(&main, &r.dir, &fixer.tool) {
        Ok(ran) => ran,
        Err(e) => { let _ = crate::backups::keep_only(&*lock(shared)?, r.backup, &[], &[]); return Err(e); }
    };
    let mut after = snapshot(&r.dir);
    let alone = walkdir::WalkDir::new(&fixer.dir).into_iter().flatten().filter(|e| e.file_type().is_file()).count() == 1;
    if after == r.before && !ran.window && main.is_file() && alone {
        if let Some(name) = main.file_name() {
            let copy = r.dir.join(name);
            if !copy.exists() && std::fs::copy(&main, &copy).is_ok() {
                let again = launch(&copy, &r.dir, &fixer.tool);
                let _ = std::fs::remove_file(&copy);
                if let Ok(x) = again { ran = x; }
                after = snapshot(&r.dir);
            }
        }
    }
    settle(shared, game, r, &after, &fixer.tool, ran.stopped, &ran.output)
}

/// Run a fixer once for several mods. This is for a fixer with a window of its own: it works through the whole Mods
/// folder there, so opening it again for each mod would only show the same window again. Every mod is copied first,
/// the fixer opens once, and each mod gets its own result and its own backup of what changed in it. The window
/// doesn't have to be closed (`launch_window`).
pub fn run_on_mods(shared: &crate::db::Shared, data_dir: &Path, game: &str, file_id: u64, mod_ids: &[String]) -> Result<Vec<FixerRun>> {
    let fixer = fixer_of(data_dir, game, file_id)?;
    let mut readied: Vec<Readied> = Vec::new();
    for id in mod_ids {
        // a mod that is gone doesn't stop the others
        if let Ok(r) = ready(shared, game, id, &fixer.tool) { readied.push(r); }
    }
    let Some(first) = readied.first() else { return Err(Error::Invalid("None of those mods are there any more".into())) };
    let main = PathBuf::from(&fixer.main);
    let started = if fixer.window {
        let watch = crate::games::mods_dir(&*lock(shared)?, game).unwrap_or_else(|_| first.dir.clone());
        launch_window(&main, &first.dir, &fixer.tool, &watch).map(|()| (false, String::new()))
    } else {
        launch(&main, &first.dir, &fixer.tool).map(|ran| (ran.stopped, ran.output))
    };
    let (stopped, output) = match started {
        Ok(x) => x,
        Err(e) => {
            for r in readied { let _ = crate::backups::keep_only(&*lock(shared)?, r.backup, &[], &[]); }
            return Err(e);
        }
    };
    let mut out = Vec::new();
    for r in readied {
        let after = snapshot(&r.dir);
        let (mod_id, name) = (r.m.id.clone(), r.m.name.clone());
        match settle(shared, game, r, &after, &fixer.tool, stopped, &output) {
            Ok(run) => out.push(run),
            // one mod whose backup couldn't be finished doesn't hide what the fixer did to the others
            Err(e) if mod_ids.len() > 1 => out.push(FixerRun { mod_id, name, stopped, output: e.to_string(), ..Default::default() }),
            Err(e) => return Err(e),
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn a_run_is_measured_by_what_changed() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path();
        std::fs::write(p.join("a.ini"), "hash = 1").unwrap();
        std::fs::write(p.join("t.dds"), "DDS").unwrap();
        let before = snapshot(p);
        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(p.join("a.ini"), "hash = 22").unwrap();
        std::fs::write(p.join("t.dds"), "DDS2").unwrap();
        std::fs::write(p.join("DISABLED_a.ini"), "hash = 1").unwrap();
        let (changed, created) = diff(&before, &snapshot(p));
        assert_eq!(changed, vec!["a.ini".to_string(), "t.dds".to_string()]);
        assert_eq!(created, vec!["DISABLED_a.ini".to_string()]);
        assert_eq!(diff(&before, &before), (vec![], vec![]));
    }

    #[cfg(windows)]
    #[test]
    fn a_console_fixer_runs_hidden_in_the_mod_folder() {
        let d = tempfile::tempdir().unwrap();
        let fixer = d.path().join("fix.bat");
        // asks for the folder, writes in the folder it runs in, then waits for a key
        std::fs::write(&fixer, "@echo off\r\nset /p where=Mod folder: \r\necho fixed> fixed.txt\r\necho %where%> where.txt\r\npause\r\n").unwrap();
        let m = d.path().join("Ellen");
        std::fs::create_dir_all(&m).unwrap();
        let r = launch(&fixer, &m, "Fix").unwrap();
        assert!(!r.stopped && !r.window);
        assert_eq!(std::fs::read_to_string(m.join("fixed.txt")).unwrap().trim(), "fixed");
        assert_eq!(std::fs::read_to_string(m.join("where.txt")).unwrap().trim(), m.display().to_string());
    }

    #[test]
    fn release_programs_for_windows() {
        let a = |id, name: &str| Asset { id, name: name.into(), browser_download_url: String::new() };
        assert_eq!(windows_asset(&[a(1, "fixer-linux.zip"), a(2, "fixer.exe")]).unwrap().id, 2);
        assert_eq!(windows_asset(&[a(1, "src.zip"), a(2, "fixer-windows.zip")]).unwrap().id, 2);
        assert!(windows_asset(&[a(1, "fixer-macos.zip")]).is_none());
        assert_eq!(link_id("https://github.com/a/b"), link_id("https://github.com/a/b"));
    }

    #[test]
    fn console_and_window_programs() {
        let d = tempfile::tempdir().unwrap();
        let mk = |sub: u16| {
            let mut b = vec![0u8; 512];
            b[0] = b'M'; b[1] = b'Z';
            b[0x3c..0x40].copy_from_slice(&128u32.to_le_bytes());
            b[128..132].copy_from_slice(b"PE\0\0");
            b[128 + 24 + 68..128 + 24 + 70].copy_from_slice(&sub.to_le_bytes());
            b
        };
        std::fs::write(d.path().join("gui.exe"), mk(2)).unwrap();
        std::fs::write(d.path().join("cli.exe"), mk(3)).unwrap();
        assert!(is_window_exe(&d.path().join("gui.exe")));
        assert!(!is_window_exe(&d.path().join("cli.exe")));
    }

    fn req(file: &str, id: u64) -> FixerRequest {
        FixerRequest { tool_id: 24821, file_id: id, tool: "7.2 Odette and Vesna Fix".into(), file: file.into(), url: String::new(), md5: None, source: String::new() }
    }

    #[test]
    fn only_gamebanana_links() {
        assert!(from_gamebanana("https://gamebanana.com/dl/1879008"));
        assert!(from_gamebanana("https://files.gamebanana.com/tools/x.zip"));
        assert!(!from_gamebanana("http://gamebanana.com/dl/1"));
        assert!(!from_gamebanana("https://gamebanana.com.evil.test/dl/1"));
        assert!(!from_gamebanana("https://example.com/gamebanana.com/dl/1"));
    }

    #[test]
    fn a_program_is_kept_as_it_is_and_listed() {
        let d = tempfile::tempdir().unwrap();
        let dl = d.path().join("version_72_fix.exe");
        std::fs::write(&dl, b"MZ not really").unwrap();
        let f = place(d.path(), "gi", &req("version_72_fix.exe", 1), &dl).unwrap();
        assert!(f.main.ends_with("version_72_fix.exe"));
        assert!(Path::new(&f.main).is_file());
        assert!(f.dir.contains("7.2 Odette and Vesna Fix"));
        assert_eq!(list(d.path(), "gi").unwrap(), vec![f.clone()]);
        // downloading it again replaces it
        std::fs::write(&dl, b"MZ again").unwrap();
        place(d.path(), "gi", &req("version_72_fix.exe", 1), &dl).unwrap();
        assert_eq!(list(d.path(), "gi").unwrap().len(), 1);
        // deleted by hand: no longer listed
        std::fs::remove_dir_all(&f.dir).unwrap();
        assert!(list(d.path(), "gi").unwrap().is_empty());
    }

    #[test]
    fn a_newer_version_replaces_the_old_install() {
        let d = tempfile::tempdir().unwrap();
        let dl = d.path().join("fixer-v3.2.exe");
        std::fs::write(&dl, b"MZ old").unwrap();
        let old = place(d.path(), "zzz", &req("fixer-v3.2.exe", 1), &dl).unwrap();
        let dl = d.path().join("fixer-v3.3.exe");
        std::fs::write(&dl, b"MZ new").unwrap();
        let new = place(d.path(), "zzz", &req("fixer-v3.3.exe", 2), &dl).unwrap();
        assert!(!Path::new(&old.dir).exists(), "the old version's folder is deleted");
        assert!(Path::new(&new.main).is_file());
        let all = list(d.path(), "zzz").unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].file_id, 2);
    }

    #[test]
    fn an_archive_is_extracted_and_its_program_found() {
        let d = tempfile::tempdir().unwrap();
        let dl = d.path().join("fix.zip");
        let mut z = zip::ZipWriter::new(std::fs::File::create(&dl).unwrap());
        let opt = zip::write::SimpleFileOptions::default();
        z.start_file("Fixer/readme.txt", opt).unwrap();
        z.write_all(b"put it in Mods").unwrap();
        z.start_file("Fixer/fix.exe", opt).unwrap();
        z.write_all(b"MZ").unwrap();
        z.start_file("Fixer/src/fix.py", opt).unwrap();
        z.write_all(b"print()").unwrap();
        z.finish().unwrap();
        let f = place(d.path(), "zzz", &req("fix.zip", 2), &dl).unwrap();
        assert!(f.main.replace('\\', "/").ends_with("Fixer/fix.exe"));
        assert!(!dl.exists());
    }

    #[test]
    fn two_programs_point_at_the_folder() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("a.exe"), b"").unwrap();
        std::fs::write(d.path().join("b.exe"), b"").unwrap();
        assert_eq!(main_of(d.path()), d.path());
    }

    #[test]
    fn a_game_id_is_one_folder() {
        let d = tempfile::tempdir().unwrap();
        assert!(list(d.path(), "../x").is_err());
        assert!(list(d.path(), "").is_err());
        assert!(list(d.path(), "zzz").unwrap().is_empty());
    }
}
