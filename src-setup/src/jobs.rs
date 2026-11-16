//! Installing, repairing and uninstalling. NSIS does the work, silently (/S): the installer inside this setup or one
//! downloaded from GitHub, and the uninstall.exe NSIS put next to gachamod. These run it, report progress to the
//! window ("setup-step" events) and check the result.
use crate::payload::Payload;
use crate::sys;
use serde::{Deserialize, Serialize};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

include!(concat!(env!("OUT_DIR"), "/consts.rs"));

/// Set by the window's Stop button; the running installer is ended.
pub static STOP: AtomicBool = AtomicBool::new(false);

const HOLD_COPY: &str = "Windows security may be checking the new files, or gachamod is slow to close.";
const HOLD_CLOSE: &str = "gachamod is finishing what it was doing before it closes.";
const HOLD_NET: &str = "The connection to GitHub is slow or blocked.";
const HOLD_REMOVE: &str = "gachamod or a file in its folder may still be open.";
const HOLD_DATA: &str = "There's a lot to move. Windows asks first if something is too big for the Recycle Bin.";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Step {
    /// unpack, download, verify, close, copy, remove, data or done.
    pub step: &'static str,
    pub text: String,
    /// How far along this step is, 0 to 1, when that can be told.
    pub value: Option<f64>,
    /// What could be holding the step, shown when it takes long.
    pub hold: Option<&'static str>,
}

fn report(app: &AppHandle, step: &'static str, text: impl Into<String>, value: Option<f64>, hold: Option<&'static str>) {
    let _ = app.emit("setup-step", Step { step, text: text.into(), value, hold });
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallOpts {
    /// A folder picked under Options; empty means the usual one. An update always goes where gachamod is.
    pub dir: Option<String>,
    pub desktop: bool,
    pub admin: bool,
}

fn mb(n: f64) -> String { format!("{:.0}", n / 1_048_576.0) }

/// Run an NSIS installer and wait, telling the window how far the copy of gachamod.exe has got.
fn run_nsis(app: &AppHandle, exe: &Path, args: &str, dir: &Path, app_size: u64, verb: &str) -> Result<(), String> {
    STOP.store(false, Ordering::SeqCst);
    let target = dir.join(sys::APP_EXE);
    let before = std::fs::metadata(&target).ok().map(|m| (m.len(), m.modified().ok()));
    report(app, "copy", format!("{verb} gachamod"), (app_size > 0).then_some(0.0), Some(HOLD_COPY));
    let mut child = Command::new(exe).raw_arg(args).spawn().map_err(|e| format!("Couldn't start the installer: {e}"))?;
    let mut best = 0.0f64;
    let mut writing = false;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                return match status.code() {
                    Some(0) => Ok(()),
                    Some(c) => Err(nsis_failure(c, dir)),
                    None => Err("The installer stopped.".into()),
                };
            }
            Ok(None) => {}
            Err(e) => return Err(format!("Lost track of the installer: {e}")),
        }
        if STOP.swap(false, Ordering::SeqCst) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Stopped. Run setup again to finish, or pick Repair.".into());
        }
        if let (Ok(m), true) = (std::fs::metadata(&target), app_size > 0) {
            let now = (m.len(), m.modified().ok());
            // a fresh install writes a new file; an update rewrites the old one from the start
            if !writing { writing = before.as_ref().map_or(true, |b| now.1 != b.1 || now.0 < b.0); }
            if writing {
                best = best.max((now.0 as f64 / app_size as f64).min(1.0));
                report(app, "copy", format!("{verb} gachamod ({} of {} MB)", mb(best * app_size as f64), mb(app_size as f64)), Some(best), Some(HOLD_COPY));
            }
        }
        std::thread::sleep(Duration::from_millis(120));
    }
}

fn nsis_failure(code: i32, dir: &Path) -> String {
    if sys::running_in(dir) { return "gachamod is open and didn't close. Close it, then try again.".into(); }
    match code {
        1 => "The installer was cancelled.".into(),
        2 => "The installer stopped partway. A newer gachamod may be installed, or a file in its folder is in use.".into(),
        c => format!("The installer stopped with code {c}."),
    }
}

/// What every install and repair checks at the end.
fn finish(app: &AppHandle, dir: &Path, admin: bool) -> Result<PathBuf, String> {
    let exe = dir.join(sys::APP_EXE);
    if !exe.exists() { return Err(format!("The installer finished, but gachamod.exe isn't in {}.", dir.display())); }
    if !admin { sys::clear_admin_flag(&exe); }
    report(app, "done", "Done", Some(1.0), None);
    Ok(dir.to_path_buf())
}

/// Install or update from the installer inside this setup.
pub fn install(app: &AppHandle, payload: &Payload, temp: &Path, o: &InstallOpts) -> Result<PathBuf, String> {
    let installed = sys::installed();
    let dir = match (&installed, o.dir.as_deref().map(str::trim).filter(|d| !d.is_empty())) {
        (Some(i), _) => i.dir.clone(),
        (None, Some(d)) => PathBuf::from(d),
        (None, None) => sys::default_dir(),
    };
    report(app, "unpack", "Unpacking the installer", None, None);
    let exe = temp.join(format!("gachamod_{}_setup.exe", payload.meta.version));
    payload.extract(&exe).map_err(|e| format!("Couldn't unpack the installer into {}: {e}", temp.display()))?;
    // src-tauri/windows/hooks.nsh reads these, so the installer doesn't ask again
    let _ = sys::set_pref("adminAsked", "1");
    let _ = sys::set_pref("admin", if o.admin { "1" } else { "0" });
    let _ = sys::set_pref("desktopShortcut", if o.desktop { "1" } else { "0" });
    if sys::running_in(&dir) { report(app, "close", "Closing gachamod", None, Some(HOLD_CLOSE)); }
    let verb = if installed.is_some() { "Updating" } else { "Copying" };
    let r = run_nsis(app, &exe, &format!("/S /D={}", dir.display()), &dir, payload.meta.app_size, verb);
    let _ = std::fs::remove_file(&exe);
    r?;
    finish(app, &dir, o.admin)
}

/// Put gachamod's files, shortcuts and registry entries back: the installer inside this setup when it's at least
/// the installed version, else the newest one from GitHub, checked against the update key.
pub async fn repair(app: AppHandle, payload: Option<Payload>, temp: PathBuf, dir: PathBuf) -> Result<PathBuf, String> {
    let installed = sys::installed().and_then(|i| i.version);
    let own = payload.filter(|p| installed.as_deref().map_or(true, |v| sys::version_cmp(&p.meta.version, v).is_ge()));
    let size_now = std::fs::metadata(dir.join(sys::APP_EXE)).map(|m| m.len()).unwrap_or(0);
    let (exe, size) = match own {
        Some(p) => {
            report(&app, "unpack", "Unpacking the installer", None, None);
            let exe = temp.join(format!("gachamod_{}_setup.exe", p.meta.version));
            p.extract(&exe).map_err(|e| format!("Couldn't unpack the installer into {}: {e}", temp.display()))?;
            (exe, p.meta.app_size)
        }
        None => (download_newest(&app, &temp).await?, size_now),
    };
    run_installer(app, exe, size, dir, "Putting back").await
}

/// Update to the newest release on GitHub, for when this setup has no newer installer inside it (the setup.exe next
/// to gachamod, or an old download). It works without opening gachamod, so a copy that won't start can still update.
pub async fn update(app: AppHandle, temp: PathBuf, dir: PathBuf) -> Result<PathBuf, String> {
    let size = std::fs::metadata(dir.join(sys::APP_EXE)).map(|m| m.len()).unwrap_or(0);
    let exe = download_newest(&app, &temp).await?;
    run_installer(app, exe, size, dir, "Updating").await
}

/// Run an installer over the copy in `dir`, quietly, then check the result.
async fn run_installer(app: AppHandle, exe: PathBuf, size: u64, dir: PathBuf, verb: &'static str) -> Result<PathBuf, String> {
    let admin = sys::pref("admin").as_deref() == Some("1");
    tauri::async_runtime::spawn_blocking(move || {
        if sys::running_in(&dir) { report(&app, "close", "Closing gachamod", None, Some(HOLD_CLOSE)); }
        let r = run_nsis(&app, &exe, &format!("/S /D={}", dir.display()), &dir, size, verb);
        let _ = std::fs::remove_file(&exe);
        r?;
        finish(&app, &dir, admin)
    }).await.map_err(|e| e.to_string())?
}

fn net_err(e: reqwest::Error) -> String {
    if e.is_connect() || e.is_timeout() { "Couldn't reach GitHub. Check your internet connection.".into() }
    else if let Some(s) = e.status() { format!("GitHub answered {s}.") }
    else { format!("The download failed: {e}") }
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder().user_agent("gachamod-setup").connect_timeout(Duration::from_secs(15)).build().map_err(|e| e.to_string())
}

struct Release { version: String, url: String, sig: String }

/// The newest release's version and Windows installer, from the note the app's updater reads.
async fn newest(client: &reqwest::Client, wait: Duration) -> Result<Release, String> {
    let text = tokio::time::timeout(wait, async { client.get(LATEST_JSON).send().await?.error_for_status()?.text().await }).await
        .map_err(|_| format!("GitHub didn't answer for {} seconds.", wait.as_secs()))?.map_err(net_err)?;
    let v: serde_json::Value = serde_json::from_str(&text).map_err(|_| "GitHub's note about the newest version didn't make sense.".to_string())?;
    let p = &v["platforms"]["windows-x86_64"];
    let (Some(url), Some(sig)) = (p["url"].as_str(), p["signature"].as_str()) else { return Err("The newest release has no Windows installer.".into()) };
    Ok(Release { version: v["version"].as_str().unwrap_or("").trim_start_matches('v').to_string(), url: url.into(), sig: sig.into() })
}

/// The newest version on GitHub, for the window to offer an update.
pub async fn latest_version() -> Result<String, String> {
    let r = newest(&client()?, Duration::from_secs(10)).await?;
    if r.version.is_empty() { Err("GitHub's note about the newest version has no version in it.".into()) } else { Ok(r.version) }
}

/// Download the newest release's installer (the one the app's updater uses) and check its signature.
async fn download_newest(app: &AppHandle, temp: &Path) -> Result<PathBuf, String> {
    report(app, "download", "Asking GitHub for the newest gachamod", None, Some(HOLD_NET));
    let client = client()?;
    let wait = Duration::from_secs(30);
    let Release { version, url, sig } = newest(&client, wait).await?;
    let mut resp = tokio::time::timeout(wait, client.get(&url).send()).await.map_err(|_| "GitHub didn't answer for 30 seconds.".to_string())?
        .map_err(net_err)?.error_for_status().map_err(net_err)?;
    let total = resp.content_length().unwrap_or(0);
    let mut bytes: Vec<u8> = Vec::with_capacity(total as usize);
    let mut last = std::time::Instant::now() - Duration::from_secs(1);
    loop {
        let chunk = tokio::time::timeout(wait, resp.chunk()).await.map_err(|_| "The download stalled for 30 seconds.".to_string())?.map_err(net_err)?;
        let Some(c) = chunk else { break };
        bytes.extend_from_slice(&c);
        if last.elapsed() >= Duration::from_millis(100) {
            last = std::time::Instant::now();
            let size = if total > 0 { format!(" ({} of {} MB)", mb(bytes.len() as f64), mb(total as f64)) } else { format!(" ({} MB)", mb(bytes.len() as f64)) };
            report(app, "download", format!("Downloading gachamod {version}{size}"), (total > 0).then(|| bytes.len() as f64 / total as f64), Some(HOLD_NET));
        }
    }
    report(app, "verify", "Checking the download", None, None);
    verify(&bytes, &sig)?;
    let exe = temp.join(format!("gachamod_{version}_setup.exe"));
    std::fs::write(&exe, &bytes).map_err(|e| format!("Couldn't save the download into {}: {e}", temp.display()))?;
    Ok(exe)
}

/// The same check the app's updater makes: signed with the key in src-tauri/tauri.conf.json.
fn verify(data: &[u8], sig: &str) -> Result<(), String> {
    use base64::Engine;
    let text = |s: &str| base64::engine::general_purpose::STANDARD.decode(s.trim()).ok().and_then(|b| String::from_utf8(b).ok());
    let bad = || "The download isn't signed with gachamod's key, so it wasn't used.".to_string();
    let key = minisign_verify::PublicKey::decode(&text(UPDATE_PUBKEY).ok_or_else(bad)?).map_err(|_| bad())?;
    let sig = minisign_verify::Signature::decode(&text(sig).ok_or_else(bad)?).map_err(|_| bad())?;
    key.verify(data, &sig, true).map_err(|_| bad())
}

/// Uninstall with NSIS's uninstaller, run in place so this can wait for it, then tidy what it can't (itself and the
/// folder). With `delete_data`, gachamod's data folders go to the Recycle Bin and its registry choices are removed.
pub fn uninstall(app: &AppHandle, dir: &Path, delete_data: bool) -> Result<(), String> {
    let un = dir.join("uninstall.exe");
    if sys::running_in(&dir) { report(app, "close", "Closing gachamod", None, Some(HOLD_CLOSE)); }
    report(app, "remove", "Removing gachamod", None, Some(HOLD_REMOVE));
    if un.exists() {
        let status = Command::new(&un).raw_arg(format!("/S _?={}", dir.display())).status().map_err(|e| format!("Couldn't start the uninstaller: {e}"))?;
        match status.code() {
            Some(0) => {}
            Some(c) => return Err(if sys::running_in(dir) { "gachamod is open and didn't close. Close it, then try again.".into() } else { format!("The uninstaller stopped with code {c}.") }),
            None => return Err("The uninstaller stopped.".into()),
        }
        let _ = std::fs::remove_file(&un);
    } else {
        // the uninstaller is gone: take out what the installer put in
        if sys::running_in(dir) { return Err("gachamod is open. Close it, then try again.".into()); }
        let _ = std::fs::remove_file(dir.join(sys::APP_EXE));
        sys::forget_install(dir);
    }
    let _ = std::fs::remove_file(dir.join("setup.exe"));
    let _ = std::fs::remove_dir(dir); // only when nothing else is in it
    if delete_data {
        report(app, "data", "Moving gachamod's data to the Recycle Bin", None, Some(HOLD_DATA));
        sys::recycle(&sys::data_dirs())?;
        sys::forget_prefs();
    }
    report(app, "done", "Done", Some(1.0), None);
    Ok(())
}
