//! Tools for mod makers and troubleshooting: 3DMigoto's log, the shader cache, frame analysis dumps, reloading mods
//! in game. Owner: SYSTEM area (docs/spec.md, "Tools").
//!
//! Reloading: 3DMigoto has no way to be told from outside that files changed. It reloads on F10 (d3dx.ini
//! `reload_config`) and only reads keys while the game window is in front, so gachamod presses F10 for the player:
//! on request (`reload_in_game`), or by itself when the game comes back to the front after a change (`watch`).

use crate::db::{Db, Shared};
use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderUse { pub path: Option<String>, pub files: u32, pub bytes: u64 }

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevStatus {
    pub log: FolderUse,
    pub shader_cache: FolderUse,
    pub shader_fixes: FolderUse,
    /// FrameAnalysis-* folders in the importer folder.
    pub frame_dumps: FolderUse,
    pub d3dx_ini: Option<String>,
    pub d3dx_user_ini: Option<String>,
}

const LOG_FILE: &str = "d3d11_log.txt";

fn usage(paths: &[PathBuf]) -> (u32, u64) {
    let mut files = 0u32;
    let mut bytes = 0u64;
    for p in paths {
        for e in walkdir::WalkDir::new(p).into_iter().flatten() {
            if e.file_type().is_file() {
                files += 1;
                bytes += e.metadata().map(|m| m.len()).unwrap_or(0);
            }
        }
    }
    (files, bytes)
}

fn frame_dump_dirs(importer: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(importer).into_iter().flatten().flatten().map(|e| e.path())
        .filter(|p| p.is_dir() && p.file_name().is_some_and(|n| n.to_string_lossy().to_lowercase().starts_with("frameanalysis")))
        .collect()
}

fn folder_use(dir: PathBuf) -> FolderUse {
    let (files, bytes) = if dir.exists() { usage(std::slice::from_ref(&dir)) } else { (0, 0) };
    FolderUse { path: Some(dir.to_string_lossy().into_owned()), files, bytes }
}

fn existing(p: PathBuf) -> Option<String> { p.is_file().then(|| p.to_string_lossy().into_owned()) }

pub fn status(db: &Db, game: &str) -> Result<DevStatus> { status_in(&crate::games::importer_dir(db, game)?) }

pub fn status_in(importer: &Path) -> Result<DevStatus> {
    let dumps = frame_dump_dirs(importer);
    let (files, bytes) = usage(&dumps);
    Ok(DevStatus {
        log: folder_use(importer.join(LOG_FILE)),
        shader_cache: folder_use(importer.join("ShaderCache")),
        shader_fixes: folder_use(importer.join("ShaderFixes")),
        frame_dumps: FolderUse { path: Some(importer.to_string_lossy().into_owned()), files, bytes },
        d3dx_ini: existing(importer.join("d3dx.ini")),
        d3dx_user_ini: existing(importer.join("d3dx_user.ini")),
    })
}

/// The last `lines` lines of d3d11_log.txt.
pub fn log_tail(db: &Db, game: &str, lines: usize) -> Result<String> { log_tail_in(&crate::games::importer_dir(db, game)?, lines) }

/// The end of the log (at most the last 512 KB are read). Empty when there is no log yet.
pub fn log_tail_in(importer: &Path, lines: usize) -> Result<String> {
    use std::io::{Read, Seek, SeekFrom};
    let path = importer.join(LOG_FILE);
    let Ok(mut f) = std::fs::File::open(&path) else { return Ok(String::new()) };
    let len = f.metadata()?.len();
    let start = len.saturating_sub(512 * 1024);
    f.seek(SeekFrom::Start(start))?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf)?;
    Ok(tail_lines(&String::from_utf8_lossy(&buf), lines.clamp(1, 5000), start > 0))
}

/// The last `n` lines of a text (dropping a cut-off first line when the text was read from the middle of a file).
pub fn tail_lines(text: &str, n: usize, cut: bool) -> String {
    let mut all: Vec<&str> = text.lines().collect();
    if cut && !all.is_empty() { all.remove(0); }
    let from = all.len().saturating_sub(n);
    all[from..].join("\n")
}

fn refuse_while_running(game: &str) -> Result<()> {
    if crate::launch::running(game) {
        let name = crate::games::def(game).map(|g| g.name).unwrap_or(game);
        return Err(Error::GameRunning(name.into()));
    }
    Ok(())
}

fn remove_contents(dir: &Path) -> Result<u64> {
    let (_, bytes) = usage(&[dir.to_path_buf()]);
    let Ok(rd) = std::fs::read_dir(dir) else { return Ok(0) };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() { std::fs::remove_dir_all(&p)?; } else { std::fs::remove_file(&p)?; }
    }
    Ok(bytes)
}

/// Empty ShaderCache. Returns bytes freed.
pub fn clear_shader_cache(db: &Db, game: &str) -> Result<u64> { clear_shader_cache_in(&crate::games::importer_dir(db, game)?, game) }

pub fn clear_shader_cache_in(importer: &Path, game: &str) -> Result<u64> {
    refuse_while_running(game)?;
    remove_contents(&importer.join("ShaderCache"))
}

/// Delete FrameAnalysis-* folders. Returns bytes freed.
pub fn clear_frame_dumps(db: &Db, game: &str) -> Result<u64> { clear_frame_dumps_in(&crate::games::importer_dir(db, game)?) }

pub fn clear_frame_dumps_in(importer: &Path) -> Result<u64> {
    let dumps = frame_dump_dirs(importer);
    let (_, bytes) = usage(&dumps);
    for d in dumps { std::fs::remove_dir_all(d)?; }
    Ok(bytes)
}

/// Clear the d3dx_user.ini saved values for every mod (3DMigoto's wipe_user_config), after a backup.
pub fn wipe_user_config(db: &Db, game: &str) -> Result<()> { wipe_user_config_in(&crate::games::importer_dir(db, game)?, game) }

pub fn wipe_user_config_in(importer: &Path, game: &str) -> Result<()> {
    refuse_while_running(game)?;
    let path = importer.join("d3dx_user.ini");
    let Ok(text) = std::fs::read_to_string(&path) else { return Ok(()) };
    let out = without_mod_values(&text);
    if out == text { return Ok(()); }
    std::fs::copy(&path, importer.join("d3dx_user.ini.wiped.bak"))?;
    crate::xxmi::write_atomic(&path, out.as_bytes())
}

/// d3dx_user.ini without the `$\mods\...` lines; comments and the importer's own values stay.
pub fn without_mod_values(text: &str) -> String {
    let nl = if text.contains("\r\n") { "\r\n" } else { "\n" };
    text.split(nl).filter(|l| !l.trim_start().to_lowercase().starts_with("$\\mods\\")).collect::<Vec<_>>().join(nl)
}

// ── reloading mods in game ──

static PENDING: Mutex<Option<HashSet<String>>> = Mutex::new(None);

fn with_pending<T>(f: impl FnOnce(&mut HashSet<String>) -> T) -> Option<T> {
    PENDING.lock().ok().map(|mut g| f(g.get_or_insert_with(HashSet::new)))
}

/// Note that a game's mod files changed (a toggle, an install, an option). While the game runs and the setting
/// "<game>.autoReload" is on (default), the watcher started by `watch` sends F10 the next time the game window comes
/// to the front, so the change shows without the player pressing anything. Cheap; call it after every change.
pub fn mark_changed(game: &str) {
    with_pending(|p| { p.insert(game.to_string()); });
}

/// Start the background watcher (called once from the app's setup): automatic reloads, and `on_state(game, running)`
/// whenever a game starts or stops.
pub fn watch(db: Shared, on_state: impl Fn(&str, bool) + Send + 'static) {
    let spawned = std::thread::Builder::new().name("gachamod-watch".into()).spawn(move || {
        let mut last_state = Instant::now() - Duration::from_secs(10);
        let mut was_running: Vec<&'static str> = Vec::new();
        loop {
            std::thread::sleep(Duration::from_millis(700));
            let pending: Vec<String> = with_pending(|p| p.iter().cloned().collect()).unwrap_or_default();
            let state_due = last_state.elapsed() >= Duration::from_secs(3);
            if pending.is_empty() && !state_due { continue; }
            let procs = crate::launch::processes();
            if state_due {
                last_state = Instant::now();
                let now = crate::launch::running_in(&procs);
                for g in now.iter().filter(|g| !was_running.contains(g)) { on_state(g, true); }
                for g in was_running.iter().filter(|g| !now.contains(g)) { on_state(g, false); }
                was_running = now;
            }
            for game in pending {
                let pids = crate::launch::game_pids(&procs, &game);
                if pids.is_empty() {
                    with_pending(|p| { p.remove(&game); });
                    continue;
                }
                let auto = db.lock().ok().and_then(|d| d.setting(&format!("{game}.autoReload")).ok().flatten());
                // GACHAMOD_NO_RELOAD=1: never press keys (test runs beside a real game)
                if auto.as_deref() == Some("0") || std::env::var_os("GACHAMOD_NO_RELOAD").is_some() { with_pending(|p| { p.remove(&game); }); continue; }
                if !win::foreground_in(&pids) { continue; }
                // let the window settle after coming to the front, then press F10
                std::thread::sleep(Duration::from_millis(300));
                if win::foreground_in(&pids) {
                    win::press_f10();
                    with_pending(|p| { p.remove(&game); });
                }
            }
        }
    });
    if spawned.is_err() { /* no watcher: reloads stay manual, nothing else depends on it */ }
}

/// Bring the game window forward and press F10 (3DMigoto's reload_config) so changed mods load without a restart.
pub fn reload_in_game(game: &str) -> Result<()> {
    let g = crate::games::require_def(game)?;
    let pids = crate::launch::game_pids(&crate::launch::processes(), game);
    if pids.is_empty() { return Err(Error::Invalid(format!("{} isn't running", g.name))); }
    let Some(w) = win::main_window(&pids) else {
        return Err(Error::Invalid(format!("Couldn't find {}'s window. Click the game and press F10", g.name)));
    };
    win::bring_forward(w);
    std::thread::sleep(Duration::from_millis(300));
    if !win::foreground_in(&pids) {
        return Err(Error::Invalid(format!("Windows didn't let gachamod bring {} to the front. Click the game and press F10", g.name)));
    }
    win::press_f10();
    with_pending(|p| { p.remove(game); });
    Ok(())
}

#[cfg(windows)]
mod win {
    use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM};
    use windows_sys::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        MapVirtualKeyW, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, MAPVK_VK_TO_VSC, VIRTUAL_KEY, VK_F10, VK_MENU,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        BringWindowToTop, EnumWindows, GetForegroundWindow, GetWindowTextLengthW, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
        SetForegroundWindow, ShowWindow, SW_RESTORE,
    };

    pub type Win = HWND;

    fn pid_of(w: HWND) -> u32 {
        let mut pid = 0u32;
        // SAFETY: `w` came from Windows; the out pointer is a live local.
        unsafe { GetWindowThreadProcessId(w, &mut pid) };
        pid
    }

    /// The foreground window belongs to one of these processes.
    pub fn foreground_in(pids: &[u32]) -> bool {
        // SAFETY: no arguments.
        let w = unsafe { GetForegroundWindow() };
        !w.is_null() && pids.contains(&pid_of(w))
    }

    struct Search { pids: Vec<u32>, found: HWND }

    unsafe extern "system" fn each(w: HWND, l: LPARAM) -> BOOL {
        // SAFETY: `l` is the address of the Search that main_window keeps alive during EnumWindows.
        let s = unsafe { &mut *(l as *mut Search) };
        // SAFETY: plain queries on a window handle Windows passed in.
        let visible = unsafe { IsWindowVisible(w) } != 0 && unsafe { GetWindowTextLengthW(w) } > 0;
        if visible && s.pids.contains(&pid_of(w)) { s.found = w; return 0; }
        1
    }

    /// The game's visible, titled top-level window.
    pub fn main_window(pids: &[u32]) -> Option<Win> {
        let mut s = Search { pids: pids.to_vec(), found: std::ptr::null_mut() };
        // SAFETY: the callback only runs during this call, while `s` lives.
        unsafe { EnumWindows(Some(each), &mut s as *mut Search as LPARAM) };
        (!s.found.is_null()).then_some(s.found)
    }

    fn key(vk: VIRTUAL_KEY, up: bool) -> INPUT {
        // SAFETY: MapVirtualKeyW is a pure lookup.
        let scan = unsafe { MapVirtualKeyW(vk as u32, MAPVK_VK_TO_VSC) } as u16;
        INPUT { r#type: INPUT_KEYBOARD, Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: vk, wScan: scan, dwFlags: if up { KEYEVENTF_KEYUP } else { 0 }, time: 0, dwExtraInfo: 0 } } }
    }

    fn send(inputs: &[INPUT]) {
        // SAFETY: a valid slice of INPUT structs and its size.
        unsafe { SendInput(inputs.len() as u32, inputs.as_ptr(), std::mem::size_of::<INPUT>() as i32) };
    }

    /// Press and release F10, held for a few frames so 3DMigoto's per-frame key check sees it.
    pub fn press_f10() {
        send(&[key(VK_F10, false)]);
        std::thread::sleep(std::time::Duration::from_millis(90));
        send(&[key(VK_F10, true)]);
    }

    /// Restore and focus a window. Windows only lets the foreground app hand focus away, so when the plain call is
    /// refused this taps Alt (which lifts the lock) and joins the foreground thread's input for a moment.
    pub fn bring_forward(w: Win) {
        // SAFETY: Win32 window calls on a handle from EnumWindows; the thread attach is undone before returning.
        unsafe {
            if IsIconic(w) != 0 { ShowWindow(w, SW_RESTORE); }
            if SetForegroundWindow(w) != 0 && GetForegroundWindow() == w { return; }
            send(&[key(VK_MENU, false), key(VK_MENU, true)]);
            if SetForegroundWindow(w) != 0 && GetForegroundWindow() == w { return; }
            let fg = GetForegroundWindow();
            let fg_thread = if fg.is_null() { 0 } else { GetWindowThreadProcessId(fg, std::ptr::null_mut()) };
            let me = GetCurrentThreadId();
            if fg_thread != 0 && fg_thread != me {
                AttachThreadInput(me, fg_thread, 1);
                BringWindowToTop(w);
                SetForegroundWindow(w);
                AttachThreadInput(me, fg_thread, 0);
            }
        }
    }
}

#[cfg(not(windows))]
mod win {
    pub type Win = usize;
    pub fn foreground_in(_pids: &[u32]) -> bool { false }
    pub fn main_window(_pids: &[u32]) -> Option<Win> { None }
    pub fn press_f10() {}
    pub fn bring_forward(_w: Win) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tails_logs_and_wipes_only_mod_values() {
        assert_eq!(tail_lines("a\nb\nc\nd", 2, false), "c\nd");
        assert_eq!(tail_lines("art of a line\nb", 5, true), "b");
        let ini = "; AUTOMATICALLY GENERATED FILE - DO NOT EDIT\r\n[Constants]\r\n$\\mods\\furina\\furina.ini\\swapvar = 1\r\n$\\debugger\\show_debug_output = 0\r\n$\\Mods\\x\\y.ini\\v = 2\r\n";
        assert_eq!(without_mod_values(ini), "; AUTOMATICALLY GENERATED FILE - DO NOT EDIT\r\n[Constants]\r\n$\\debugger\\show_debug_output = 0\r\n");
    }

    #[test]
    fn measures_and_clears_dev_folders() {
        let dir = std::env::temp_dir().join(format!("gachamod-dev-test-{}-{}", std::process::id(), crate::db::now()));
        std::fs::create_dir_all(dir.join("ShaderCache")).unwrap();
        std::fs::create_dir_all(dir.join("FrameAnalysis-2026-11-13-101010")).unwrap();
        std::fs::write(dir.join("ShaderCache").join("a.bin"), [0u8; 100]).unwrap();
        std::fs::write(dir.join("FrameAnalysis-2026-11-13-101010").join("log.txt"), [0u8; 50]).unwrap();
        std::fs::write(dir.join(LOG_FILE), "one\ntwo\nthree\n").unwrap();
        let st = status_in(&dir).unwrap();
        assert_eq!((st.shader_cache.files, st.shader_cache.bytes), (1, 100));
        assert_eq!(st.frame_dumps.bytes, 50);
        assert_eq!(log_tail_in(&dir, 2).unwrap(), "two\nthree");
        // "gi" is not running in a test, so clearing is allowed
        assert_eq!(clear_shader_cache_in(&dir, "gi").unwrap(), 100);
        assert_eq!(clear_frame_dumps_in(&dir).unwrap(), 50);
        assert!(dir.join("ShaderCache").exists() && !dir.join("FrameAnalysis-2026-11-13-101010").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn pending_marks_collect() {
        mark_changed("zzz-test");
        assert!(with_pending(|p| p.contains("zzz-test")).unwrap());
        with_pending(|p| { p.remove("zzz-test"); });
    }
}
