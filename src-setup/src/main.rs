//! gachamod setup: the window that installs, repairs and uninstalls gachamod, dressed in a game's theme.
//!
//! The downloaded `gachamod-setup.exe` is this program with the NSIS installer from `tauri build` appended
//! (payload.rs, scripts/build-installer.mjs). It shows its own window and runs that installer silently, so NSIS still
//! does the work: auto-updates, the uninstall entry and src-tauri/windows/hooks.nsh behave as before. The same
//! program without an installer inside is put next to gachamod as `setup.exe`, and Windows' Uninstall and Modify
//! buttons open it for repair and uninstall (hooks.nsh points them there). gachamod opens it with `--apply` to install
//! an update it downloaded, so updates show this window too instead of NSIS's progress bar. From the background it adds
//! `--quiet --open-background`: the window stays hidden unless the update fails, and gachamod starts again with only
//! its tray icon.
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
    /// The page has started the update gachamod handed over (`apply`).
    started: AtomicBool,
}

const TEMP_PREFIX: &str = "gachamod-setup-";
/// A quiet update (`--quiet`) the page hasn't started this long after setup opened shows the window, so an update that
/// can't get going doesn't sit there unseen.
const QUIET_START: Duration = Duration::from_secs(20);

fn main() {
    // keeps the marks whole in the exe, where gachamod looks for them
    std::hint::black_box(cli::APPLY_MARK);
    std::hint::black_box(cli::APPLY_QUIET_MARK);
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
    let mode = if cli.apply.is_some() { "apply" } else if cli.uninstall { "uninstall" } else if cli.repair { "repair" } else if payload.is_some() { "install" } else { "maintain" };

    // no WebView2 (some older Windows 10 PCs): NSIS's plain windows, which also install WebView2
    if tauri::webview_version().is_err() {
        if let Some(exe) = &cli.apply {
            let _ = std::fs::remove_dir_all(&temp);
            std::process::exit(plain_update(&cli, exe, dir.as_deref()));
        }
        std::process::exit(plain_windows(payload.as_ref(), dir.as_deref(), &temp, cli.uninstall));
    }

    let look = if mode == "install" { look::for_install(cli.theme.as_deref()) } else { look::for_maintenance(cli.theme.as_deref()) };
    run(Setup { cli, payload, mode, look, temp, dir, busy: AtomicBool::new(false), started: AtomicBool::new(false) });
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

/// Without WebView2, an update from gachamod: the installer with NSIS's progress bar, as gachamod's updater runs it,
/// or with no window at all (`--quiet`). `--open-background` starts gachamod after with only its tray icon; when the
/// update fails, gachamod opens the usual way instead (the version that's there), so the failure isn't unseen.
fn plain_update(c: &cli::Cli, exe: &Path, dir: Option<&Path>) -> i32 {
    let mut args = String::from(if c.quiet { "/S /UPDATE" } else { "/P /UPDATE" });
    if c.open && !c.open_background { args.push_str(" /R"); }
    let code = if jobs::verify_file(exe, c.sig.as_deref()).is_err() { 2 }
        else { Command::new(exe).raw_arg(&args).status().map(|s| s.code().unwrap_or(2)).unwrap_or(2) };
    if let Some(app) = dir.map(|d| d.join(sys::APP_EXE)).filter(|_| c.open_background) {
        let _ = if code == 0 { sys::launch_background(&app) } else { sys::launch(&app) };
    }
    code
}

/// Without WebView2: NSIS's own installer or uninstaller windows. Anything else (Windows' Modify button, a repair)
/// opens the latest release, whose setup has the newest installer inside, which also installs WebView2.
fn plain_windows(payload: Option<&payload::Payload>, dir: Option<&Path>, temp: &Path, uninstall: bool) -> i32 {
    if let Some(p) = payload {
        let exe = temp.join(format!("gachamod_{}_setup.exe", p.meta.version));
        let code = p.extract(&exe).and_then(|_| Command::new(&exe).status()).map(|s| s.code().unwrap_or(2)).unwrap_or(2);
        let _ = std::fs::remove_dir_all(temp);
        return code;
    }
    let _ = std::fs::remove_dir_all(temp);
    if let Some(un) = dir.map(|d| d.join("uninstall.exe")).filter(|u| uninstall && u.exists()) {
        return Command::new(un).status().map(|s| s.code().unwrap_or(2)).unwrap_or(2);
    }
    sys::open_url(&format!("{}/releases/latest", jobs::HOMEPAGE));
    0
}

// ── the window ──

fn run(s: Setup) {
    let look = s.look.clone();
    let webview_dir = s.temp.join("webview");
    let title = match s.mode { "uninstall" => "Uninstall gachamod", "repair" => "Repair gachamod", "apply" => "Update gachamod", _ => "gachamod setup" };
    let quiet = s.cli.quiet && s.cli.apply.is_some();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(s)
        .invoke_handler(tauri::generate_handler![info, data_size, install, repair, update, apply, latest, uninstall, stop, open_app, open_page, open_folder, open_recycle_bin, plain_installer])
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
            // the page shows the window once it has drawn; this is in case it can't. A quiet update stays hidden (the page
            // shows it if the update fails) unless the page hasn't started it by QUIET_START.
            std::thread::spawn(move || {
                std::thread::sleep(if quiet { QUIET_START } else { Duration::from_millis(2500) });
                if quiet && w.state::<Setup>().started.load(Ordering::SeqCst) { return; }
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

/// An update gachamod handed over: its version, whether to open gachamod after (`--open`), keep the window hidden
/// unless it fails (`--quiet`) and start gachamod after with only its tray icon (`--open-background`).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ApplyInfo { version: Option<String>, open: bool, quiet: bool, background: bool }

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
    quickstart: bool,
    look: Value,
    homepage: &'static str,
    /// An update gachamod downloaded, to install now (`--apply`).
    apply: Option<ApplyInfo>,
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
        // on unless the player turned it off: gachamod reaches more games as administrator
        admin: sys::pref("admin").as_deref() == Some("1") || sys::pref("adminAsked").as_deref() != Some("1"),
        desktop: sys::pref("desktopShortcut").as_deref() != Some("0"),
        // on for a fresh install; an update adds it only when asked to
        quickstart: match sys::pref("quickstartShortcut").as_deref() { Some("1") => true, Some(_) => false, None => reg.is_none() },
        look: s.look.clone(),
        homepage: jobs::HOMEPAGE,
        apply: s.cli.apply.as_ref().map(|_| ApplyInfo {
            version: s.cli.apply_version.clone(),
            open: s.cli.open,
            quiet: s.cli.quiet,
            background: s.cli.open_background,
        }),
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

/// Download the newest gachamod from GitHub and install it over the copy there.
#[tauri::command]
async fn update(app: AppHandle, s: State<'_, Setup>) -> Result<String, String> {
    let _busy = Busy::start(&s.busy)?;
    let dir = s.dir.clone().ok_or("gachamod isn't installed.")?;
    let dir = jobs::update(app, s.temp.clone(), dir).await?;
    Ok(dir.display().to_string())
}

/// Install the update gachamod downloaded and handed over with `--apply`. Then `--open-background` starts gachamod
/// with only its tray icon. A quiet update (`--quiet`) does what's left here and ends setup at once while the window is
/// still hidden, since nobody is looking and the hidden page's timers may lag. Once the window shows (the update failed
/// first, then Try again), the page finishes as usual.
#[tauri::command]
async fn apply(app: AppHandle, s: State<'_, Setup>) -> Result<String, String> {
    let _busy = Busy::start(&s.busy)?;
    s.started.store(true, Ordering::SeqCst);
    let exe = s.cli.apply.clone().ok_or("gachamod didn't hand over an update.")?;
    let dir = s.dir.clone().ok_or("gachamod isn't installed.")?;
    let dir = jobs::apply(app.clone(), exe, s.cli.sig.clone(), dir).await?;
    let program = dir.join(sys::APP_EXE);
    if s.cli.open_background { let _ = sys::launch_background(&program); }
    if s.cli.quiet {
        // in a quiet update the page leaves opening gachamod to this (Setup.tsx run)
        if s.cli.open && !s.cli.open_background { let _ = sys::launch(&program); }
        if app.get_webview_window("main").is_some_and(|w| !w.is_visible().unwrap_or(false)) { app.exit(0); }
    }
    Ok(dir.display().to_string())
}

/// The newest version on GitHub.
#[tauri::command]
async fn latest() -> Result<String, String> { jobs::latest_version().await }

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

/// Show one of gachamod's data folders in Explorer (the uninstall page lists them before offering to delete them).
#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    if !sys::data_dirs().iter().any(|d| *d == path) { return Err("Only gachamod's data folders open from here.".into()); }
    if !path.is_dir() { return Err("That folder isn't there.".into()); }
    if sys::open_url(&path.to_string_lossy()) { Ok(()) } else { Err("Windows couldn't open the folder.".into()) }
}

/// The Recycle Bin, where "delete gachamod's data" put the folders.
#[tauri::command]
fn open_recycle_bin() -> Result<(), String> {
    if sys::open_url("shell:RecycleBinFolder") { Ok(()) } else { Err("Windows couldn't open the Recycle Bin.".into()) }
}

/// NSIS's own installer window, for someone who'd rather use it (or when this one fails). Setup closes once it ends.
#[tauri::command]
fn plain_installer(app: AppHandle, s: State<'_, Setup>) -> Result<(), String> {
    let exe = if let Some(update) = s.cli.apply.clone() {
        jobs::verify_file(&update, s.cli.sig.as_deref())?;
        update
    } else {
        let p = s.payload.clone().ok_or("This setup has no installer inside it.")?;
        let exe = s.temp.join(format!("gachamod_{}_setup.exe", p.meta.version));
        p.extract(&exe).map_err(|e| format!("Couldn't unpack the installer: {e}"))?;
        exe
    };
    let mut child = Command::new(&exe).creation_flags(0).spawn().map_err(|e| format!("Couldn't start the installer: {e}"))?;
    if let Some(w) = app.get_webview_window("main") { let _ = w.hide(); }
    std::thread::spawn(move || { let _ = child.wait(); app.exit(0); });
    Ok(())
}
