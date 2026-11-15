//! gachamod setup: the window that installs, repairs and uninstalls gachamod, dressed in a game's theme.
//!
//! The downloaded `gachamod-setup.exe` is this program with the NSIS installer from `tauri build` appended
//! (payload.rs, scripts/build-installer.mjs). It shows its own window and runs that installer silently, so NSIS still
//! does the work: auto-updates, the uninstall entry and src-tauri/windows/hooks.nsh behave as before. The same
//! program without an installer inside is put next to gachamod as `setup.exe`, and Windows' Uninstall and Modify
//! buttons open it for repair and uninstall (hooks.nsh points them there).
//!
//! Which theme it shows is look.rs. With no WebView2 on the PC it falls back to NSIS's own windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod cli;
mod jobs;
mod look;
mod payload;
mod sys;

use serde::Serialize;
use serde_json::{json, Value};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Manager, RunEvent, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};

struct Setup {
    cli: cli::Cli,
    payload: Option<payload::Payload>,
    mode: &'static str,
    look: Value,
    /// This run's scratch folder in %TEMP%: the unpacked installer, a download, the web view's files.
    temp: PathBuf,
    /// The install folder that repair and uninstall work on.
    dir: Option<PathBuf>,
    busy: AtomicBool,
}

const TEMP_PREFIX: &str = "gachamod-setup-";

fn main() {
    let cli = cli::parse();
    let payload = payload::find();
    sweep_old_temp();

    // scripts, other installers and NSIS's own reinstall page: NSIS switches go to NSIS, no window
    if cli.nsis {
        std::process::exit(match &payload { Some(p) => pass_to_installer(p), None => pass_to_uninstaller(&cli) });
    }

    // the copy in the install folder can't replace or delete itself, so the window runs from a copy in %TEMP%
    if payload.is_none() && cli.from.is_none() {
        if let Some(here) = install_folder_of_self() {
            if relaunch_from_temp(&here).is_ok() { return; }
        }
    }

    let temp = std::env::temp_dir().join(format!("{TEMP_PREFIX}{}", std::process::id()));
    let _ = std::fs::create_dir_all(&temp);
    let dir = cli.from.clone().or_else(|| sys::installed().map(|i| i.dir));
    let mode = if cli.uninstall { "uninstall" } else if cli.repair { "repair" } else if payload.is_some() { "install" } else { "maintain" };

    // no WebView2 (some older Windows 10 PCs): NSIS's plain windows, which also install WebView2
    if tauri::webview_version().is_err() {
        std::process::exit(plain_windows(payload.as_ref(), dir.as_deref(), &temp));
    }

    let look = if mode == "install" { look::for_install(cli.theme.as_deref()) } else { look::for_maintenance(cli.theme.as_deref()) };
    run(Setup { cli, payload, mode, look, temp, dir, busy: AtomicBool::new(false) });
}

/// The folder this exe sits in, when it's an install folder (the setup.exe next to gachamod and its uninstaller).
fn install_folder_of_self() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    dir.join("uninstall.exe").exists().then(|| dir.to_path_buf())
}

fn relaunch_from_temp(here: &Path) -> std::io::Result<()> {
    let exe = std::env::current_exe()?;
    let copy_dir = std::env::temp_dir().join(format!("{TEMP_PREFIX}{}-run", std::process::id()));
    std::fs::create_dir_all(&copy_dir)?;
    let copy = copy_dir.join("gachamod-setup.exe");
    std::fs::copy(&exe, &copy)?;
    Command::new(&copy).args(std::env::args_os().skip(1)).arg("--from").arg(here).spawn()?;
    Ok(())
}

/// A folder this program made in %TEMP%.
fn ours(dir: &Path) -> bool {
    dir.parent().is_some_and(|p| p == std::env::temp_dir().as_path() || p == std::env::temp_dir().canonicalize().unwrap_or_default())
        && dir.file_name().is_some_and(|n| n.to_string_lossy().starts_with(TEMP_PREFIX))
}

/// Remove scratch folders older than a day that an earlier run couldn't (a crash, a PC turned off).
fn sweep_old_temp() {
    let Ok(rd) = std::fs::read_dir(std::env::temp_dir()) else { return };
    let day = Duration::from_secs(24 * 3600);
    for e in rd.flatten() {
        if !e.file_name().to_string_lossy().starts_with(TEMP_PREFIX) { continue; }
        let old = e.metadata().ok().and_then(|m| m.modified().ok()).and_then(|t| t.elapsed().ok()).is_some_and(|age| age > day);
        if old { let _ = std::fs::remove_dir_all(e.path()); }
    }
}

/// `gachamod-setup.exe /S` and friends: run the installer inside with the same switches and pass on its exit code.
fn pass_to_installer(p: &payload::Payload) -> i32 {
    let temp = std::env::temp_dir().join(format!("{TEMP_PREFIX}{}", std::process::id()));
    let exe = temp.join(format!("gachamod_{}_setup.exe", p.meta.version));
    let code = std::fs::create_dir_all(&temp).and_then(|_| p.extract(&exe))
        .and_then(|_| Command::new(&exe).raw_arg(cli::nsis_tail()).status())
        .map(|s| s.code().unwrap_or(2)).unwrap_or(2);
    let _ = std::fs::remove_dir_all(&temp);
    code
}

/// The installed setup.exe given NSIS switches: Windows' uninstall entry points here, so scripts that add /S and
/// NSIS's reinstall page (which adds `_?=`) reach the real uninstaller. Without `_?=` it runs in place so this can
/// wait for it, and the folder is tidied afterwards.
fn pass_to_uninstaller(cli: &cli::Cli) -> i32 {
    let Some(dir) = cli.from.clone().or_else(install_folder_of_self) else { return 2 };
    let un = dir.join("uninstall.exe");
    if !un.exists() { return 2; }
    let mut tail = cli::nsis_tail();
    let in_place = tail.contains("_?=");
    if !in_place { tail = format!("{tail} _?={}", dir.display()).trim().to_string(); }
    let code = Command::new(&un).raw_arg(&tail).status().map(|s| s.code().unwrap_or(2)).unwrap_or(2);
    if !in_place && code == 0 && !dir.join(sys::APP_EXE).exists() {
        let _ = std::fs::remove_file(&un);
        sys::clean_after_exit(&[], &[dir.join("setup.exe")], &[dir]);
    }
    code
}

/// Without WebView2: NSIS's own installer or uninstaller windows, or the download page for a repair.
fn plain_windows(payload: Option<&payload::Payload>, dir: Option<&Path>, temp: &Path) -> i32 {
    if let Some(p) = payload {
        let exe = temp.join(format!("gachamod_{}_setup.exe", p.meta.version));
        let code = p.extract(&exe).and_then(|_| Command::new(&exe).status()).map(|s| s.code().unwrap_or(2)).unwrap_or(2);
        let _ = std::fs::remove_dir_all(temp);
        return code;
    }
    let _ = std::fs::remove_dir_all(temp);
    if let Some(un) = dir.map(|d| d.join("uninstall.exe")).filter(|u| u.exists()) {
        return Command::new(un).status().map(|s| s.code().unwrap_or(2)).unwrap_or(2);
    }
    sys::open_url(&format!("{}/releases/latest", jobs::HOMEPAGE));
    0
}

// ── the window ──

fn run(s: Setup) {
    let look = s.look.clone();
    let webview_dir = s.temp.join("webview");
    let title = match s.mode { "uninstall" => "Uninstall gachamod", "repair" => "Repair gachamod", _ => "gachamod setup" };
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(s)
        .invoke_handler(tauri::generate_handler![info, data_size, install, repair, uninstall, stop, open_app, open_page, plain_installer])
        .setup(move |app| {
            let init = format!("window.__GM_SETUP__ = {};", json!({ "look": look }));
            let w = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("setup.html".into()))
                .title(title)
                .inner_size(800.0, 520.0)
                .resizable(false)
                .maximizable(false)
                .decorations(false)
                .shadow(true)
                .center()
                .visible(false)
                .data_directory(webview_dir)
                .initialization_script(&init)
                .build()?;
            // the page shows the window once it has drawn; this is in case it can't
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(2500));
                if !w.is_visible().unwrap_or(true) { let _ = w.show(); let _ = w.set_focus(); }
            });
            Ok(())
        })
        .on_window_event(|w, e| {
            if let WindowEvent::CloseRequested { api, .. } = e {
                if w.state::<Setup>().busy.load(Ordering::SeqCst) { api.prevent_close(); }
            }
        })
        .build(tauri::generate_context!())
        .expect("start the setup window")
        .run(|app, e| {
            if let RunEvent::Exit = e { clean_up(&app.state::<Setup>()); }
        });
}

/// This run's scratch folder, and the copy of setup itself when it ran from %TEMP%, once the process has ended.
fn clean_up(s: &Setup) {
    let mut trees = vec![s.temp.clone()];
    if s.cli.from.is_some() {
        if let Some(d) = std::env::current_exe().ok().and_then(|e| e.parent().map(Path::to_path_buf)) {
            if ours(&d) { trees.push(d); }
        }
    }
    sys::clean_after_exit(&trees, &[], &[]);
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InstalledInfo { dir: String, version: Option<String>, ok: bool }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Info {
    mode: &'static str,
    /// The version this setup installs (its own when it has no installer inside).
    version: String,
    payload: bool,
    installed: Option<InstalledInfo>,
    running: bool,
    default_dir: String,
    data_dirs: Vec<String>,
    admin: bool,
    desktop: bool,
    look: Value,
    homepage: &'static str,
}

#[tauri::command]
fn info(s: State<'_, Setup>) -> Info {
    let reg = sys::installed();
    let installed = s.dir.clone().map(|dir| InstalledInfo {
        ok: dir.join(sys::APP_EXE).exists(),
        version: reg.as_ref().filter(|r| r.dir == dir).and_then(|r| r.version.clone()),
        dir: dir.display().to_string(),
    });
    Info {
        mode: s.mode,
        version: s.payload.as_ref().map_or_else(|| env!("CARGO_PKG_VERSION").to_string(), |p| p.meta.version.clone()),
        payload: s.payload.is_some(),
        installed,
        running: s.dir.as_deref().is_some_and(sys::running_in),
        default_dir: sys::default_dir().display().to_string(),
        data_dirs: sys::data_dirs().iter().map(|d| d.display().to_string()).collect(),
        admin: sys::pref("admin").as_deref() == Some("1"),
        desktop: sys::pref("desktopShortcut").as_deref() != Some("0"),
        look: s.look.clone(),
        homepage: jobs::HOMEPAGE,
    }
}

/// How much "delete gachamod's data" would move to the Recycle Bin, in bytes.
#[tauri::command]
async fn data_size() -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(|| sys::data_dirs().iter().map(|d| sys::dir_size(d)).sum()).await.map_err(|e| e.to_string())
}

struct Busy<'a>(&'a AtomicBool);
impl<'a> Busy<'a> {
    fn start(flag: &'a AtomicBool) -> Result<Self, String> {
        if flag.swap(true, Ordering::SeqCst) { return Err("Setup is already working on something.".into()); }
        Ok(Self(flag))
    }
}
impl Drop for Busy<'_> { fn drop(&mut self) { self.0.store(false, Ordering::SeqCst); } }

#[tauri::command]
async fn install(app: AppHandle, s: State<'_, Setup>, opts: jobs::InstallOpts) -> Result<String, String> {
    let _busy = Busy::start(&s.busy)?;
    let p = s.payload.clone().ok_or("This setup has no installer inside it.")?;
    let temp = s.temp.clone();
    // a game's own setup (gachamod-setup-zzz.exe) starts a fresh install in one-game mode for that game
    let game = if sys::installed().is_none() { look::named_game(&s.look) } else { None };
    let dir = tauri::async_runtime::spawn_blocking(move || jobs::install(&app, &p, &temp, &opts)).await.map_err(|e| e.to_string())??;
    if let Some(g) = game { look::leave_game_note(&g); }
    Ok(dir.display().to_string())
}

#[tauri::command]
async fn repair(app: AppHandle, s: State<'_, Setup>) -> Result<String, String> {
    let _busy = Busy::start(&s.busy)?;
    let dir = s.dir.clone().unwrap_or_else(sys::default_dir);
    let dir = jobs::repair(app, s.payload.clone(), s.temp.clone(), dir).await?;
    Ok(dir.display().to_string())
}

#[tauri::command]
async fn uninstall(app: AppHandle, s: State<'_, Setup>, delete_data: bool) -> Result<(), String> {
    let _busy = Busy::start(&s.busy)?;
    let dir = s.dir.clone().ok_or("gachamod isn't installed.")?;
    tauri::async_runtime::spawn_blocking(move || jobs::uninstall(&app, &dir, delete_data)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn stop() { jobs::STOP.store(true, Ordering::SeqCst); }

#[tauri::command]
fn open_app(s: State<'_, Setup>, dir: Option<String>) -> Result<(), String> {
    let dir = dir.map(PathBuf::from).or_else(|| s.dir.clone()).unwrap_or_else(sys::default_dir);
    sys::launch(&dir.join(sys::APP_EXE))
}

#[tauri::command]
fn open_page(url: String) -> Result<(), String> {
    if !url.starts_with("https://") { return Err("Only web pages open from here.".into()); }
    if sys::open_url(&url) { Ok(()) } else { Err("Windows couldn't open the page.".into()) }
}

/// NSIS's own installer window, for someone who'd rather use it (or when this one fails). Setup closes once it ends.
#[tauri::command]
fn plain_installer(app: AppHandle, s: State<'_, Setup>) -> Result<(), String> {
    let p = s.payload.clone().ok_or("This setup has no installer inside it.")?;
    let exe = s.temp.join(format!("gachamod_{}_setup.exe", p.meta.version));
    p.extract(&exe).map_err(|e| format!("Couldn't unpack the installer: {e}"))?;
    let mut child = Command::new(&exe).creation_flags(0).spawn().map_err(|e| format!("Couldn't start the installer: {e}"))?;
    if let Some(w) = app.get_webview_window("main") { let _ = w.hide(); }
    std::thread::spawn(move || { let _ = child.wait(); app.exit(0); });
    Ok(())
}
