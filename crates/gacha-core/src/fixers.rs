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
    Ok(all.into_iter().filter(|f| Path::new(&f.main).exists()).collect())
}

fn remember(data_dir: &Path, game: &str, entry: &FixerFile) -> Result<()> {
    let mut all = list(data_dir, game)?;
    all.retain(|f| f.file_id != entry.file_id);
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
    let tmp = base.join(".downloading");
    let got = download(http, &req.url, &tmp, &req.file, None, |_, _| true).await?;
    if let Some(want) = req.md5.as_deref().map(str::trim).filter(|m| !m.is_empty()) {
        if !got.md5.eq_ignore_ascii_case(want) {
            let _ = tokio::fs::remove_file(&got.path).await;
            return Err(Error::Invalid("The download doesn't match the checksum GameBanana lists. Try again".into()));
        }
    }
    let (data, game) = (data_dir.to_path_buf(), game.to_string());
    tokio::task::spawn_blocking(move || place(&data, &game, &req, &got.path))
        .await
        .unwrap_or_else(|e| Err(Error::Invalid(e.to_string())))
}

/// Move a downloaded file into its folder (extracting an archive) and list it.
pub fn place(data_dir: &Path, game: &str, req: &FixerRequest, downloaded: &Path) -> Result<FixerFile> {
    let file = safe_file_name(&req.file);
    let stem = Path::new(&file).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let dir = root(data_dir, game)?.join(folder_name(&req.tool, "Fixer")).join(folder_name(&stem, "Files"));
    if dir.exists() { std::fs::remove_dir_all(&dir)?; }
    std::fs::create_dir_all(&dir)?;
    if crate::archive::detect(downloaded).is_ok() {
        let r = crate::archive::extract(downloaded, &dir);
        let _ = std::fs::remove_file(downloaded);
        r?;
    } else {
        let to = dir.join(&file);
        if std::fs::rename(downloaded, &to).is_err() {
            std::fs::copy(downloaded, &to)?;
            let _ = std::fs::remove_file(downloaded);
        }
    }
    let entry = FixerFile {
        tool_id: req.tool_id, file_id: req.file_id, tool: req.tool.clone(), file: req.file.clone(),
        dir: dir.to_string_lossy().into_owned(), main: main_of(&dir).to_string_lossy().into_owned(), at: crate::db::now(),
        source: req.source.clone(),
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
            .header("Accept", "application/vnd.github+json").send().await?;
        if r.status().as_u16() == 403 || r.status().as_u16() == 429 {
            return Err(Error::Network("GitHub is limiting downloads from this PC for a while. Try again in an hour".into()));
        }
        if !r.status().is_success() { return Err(Error::Http { status: r.status().as_u16(), message: format!("GitHub didn't send {tool}'s newest release") }); }
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
/// A fixer with its own window waits for the player.
const WINDOW_LIMIT: std::time::Duration = std::time::Duration::from_secs(30 * 60);

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

/// Run a downloaded fixer (`file_id`) on one mod the way fixers' readmes say: from inside the mod's folder. Every
/// file is copied first, and the backup keeps the ones that changed (restoring it undoes the run).
/// A fixer that changes nothing from its own folder gets one more try as a copy placed in the mod's folder.
pub fn run_on_mod(shared: &crate::db::Shared, data_dir: &Path, game: &str, file_id: u64, mod_id: &str) -> Result<FixerRun> {
    let lock = || shared.lock().map_err(|_| Error::Db("The local database is stuck. Restart gachamod".into()));
    let fixer = list(data_dir, game)?.into_iter().find(|f| f.file_id == file_id)
        .ok_or_else(|| Error::Invalid("That fixer isn't downloaded any more. Try again".into()))?;
    let m = crate::library::get(&*lock()?, game, mod_id)?;
    let dir = PathBuf::from(&m.path);
    if !dir.is_dir() { return Err(Error::Invalid(format!("{}'s folder isn't there any more", m.name))); }
    let before = snapshot(&dir);
    let files: Vec<String> = before.keys().cloned().collect();
    let backup = crate::backups::take(&*lock()?, game, mod_id, &dir, &files, &format!("Ran {} on {}", fixer.tool, m.name))?;
    let main = PathBuf::from(&fixer.main);
    let first = launch(&main, &dir, &fixer.tool);
    let mut ran = match first {
        Ok(r) => r,
        Err(e) => { let _ = crate::backups::keep_only(&*lock()?, backup, &[], &[]); return Err(e); }
    };
    let mut after = snapshot(&dir);
    let alone = walkdir::WalkDir::new(&fixer.dir).into_iter().flatten().filter(|e| e.file_type().is_file()).count() == 1;
    if after == before && !ran.window && main.is_file() && alone {
        if let Some(name) = main.file_name() {
            let copy = dir.join(name);
            if !copy.exists() && std::fs::copy(&main, &copy).is_ok() {
                let again = launch(&copy, &dir, &fixer.tool);
                let _ = std::fs::remove_file(&copy);
                if let Ok(r) = again { ran = r; }
                after = snapshot(&dir);
            }
        }
    }
    let (changed, created) = diff(&before, &after);
    let n = changed.len() + created.len();
    let backup = crate::backups::keep_only(&*lock()?, backup, &changed, &created)?;
    if backup.is_some() && m.loaded() { crate::devtools::mark_changed(game); }
    crate::logs::info(format!("Ran {} on {}: {n} files changed{}", fixer.tool, m.name, if ran.stopped { ", stopped at the time limit" } else { "" }));
    Ok(FixerRun { mod_id: m.id.clone(), name: m.name.clone(), backup, changed: n, stopped: ran.stopped, output: ran.output })
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
