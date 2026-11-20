//! Tools for mod makers and troubleshooting: 3DMigoto's log, the shader cache, frame analysis dumps, reloading mods
//! in game. Owner: SYSTEM area (docs/spec.md, "Tools").
//!
//! Reloading: 3DMigoto has no way to be told from outside that files changed. It reloads on its reload key (d3dx.ini
//! `reload_config`, F10 as the loaders ship it) and only reads keys while the game window is in front, so gachamod
//! presses that key for the player: on request (`reload_in_game`), or by itself when the game comes back to the front
//! after a change (`watch`).

use crate::db::{Db, Shared};
use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
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
    /// The copy of d3dx_user.ini the last wipe kept, when it is still there.
    pub wiped_bak: Option<String>,
}

const LOG_FILE: &str = "d3d11_log.txt";
const WIPED_BAK: &str = "d3dx_user.ini.wiped.bak";

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
        wiped_bak: existing(importer.join(WIPED_BAK)),
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

/// Send the FrameAnalysis-* folders to the Recycle Bin (they can be gigabytes, and someone may want one back).
/// Returns bytes freed.
pub fn clear_frame_dumps(db: &Db, game: &str) -> Result<u64> { clear_frame_dumps_in(&crate::games::importer_dir(db, game)?) }

pub fn clear_frame_dumps_in(importer: &Path) -> Result<u64> {
    let dumps = frame_dump_dirs(importer);
    let (_, bytes) = usage(&dumps);
    // tests delete for good, so they don't fill the Recycle Bin
    if cfg!(test) { for d in &dumps { std::fs::remove_dir_all(d)?; } } else { crate::recycle::to_recycle_bin(&dumps)?; }
    Ok(bytes)
}

/// Clear the d3dx_user.ini saved values for every mod (3DMigoto's wipe_user_config), after a backup.
/// Returns false when there was nothing to clear (no backup is written then).
pub fn wipe_user_config(db: &Db, game: &str) -> Result<bool> { wipe_user_config_in(&crate::games::importer_dir(db, game)?, game) }

pub fn wipe_user_config_in(importer: &Path, game: &str) -> Result<bool> {
    refuse_while_running(game)?;
    let path = importer.join("d3dx_user.ini");
    let Ok(text) = std::fs::read_to_string(&path) else { return Ok(false) };
    let out = without_mod_values(&text);
    if out == text { return Ok(false); }
    std::fs::copy(&path, importer.join(WIPED_BAK))?;
    crate::xxmi::write_atomic(&path, out.as_bytes())?;
    Ok(true)
}

/// Swap d3dx_user.ini with the copy kept as d3dx_user.ini.wiped.bak. The file in place now becomes the copy, so
/// nothing saved since the wipe is lost, and doing it again swaps back.
pub fn unwipe_user_config_in(importer: &Path, game: &str) -> Result<()> {
    refuse_while_running(game)?;
    let path = importer.join("d3dx_user.ini");
    let bak = importer.join(WIPED_BAK);
    let saved = std::fs::read(&bak)?;
    if let Ok(current) = std::fs::read(&path) {
        if current == saved { return Ok(()); }
        crate::xxmi::write_atomic(&bak, &current)?;
    }
    crate::xxmi::write_atomic(&path, &saved)
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

/// Automatic reloads stay rare: at most one every 10 seconds and three a minute for each game. A change made meanwhile
/// waits and goes in with the next one, so a burst of changes is one reload, and nothing can make the app press the
/// key over and over. `times`: when it last pressed it for the game.
fn may_press(times: &mut Vec<Instant>, now: Instant) -> bool {
    times.retain(|t| now.saturating_duration_since(*t) < Duration::from_secs(60));
    times.len() < 3 && !times.last().is_some_and(|t| now.saturating_duration_since(*t) < Duration::from_secs(10))
}

/// Start the background watcher (called once from the app's setup): automatic reloads, `on_state(game, running)`
/// whenever a game starts or stops, and `on_saved(game)` when a running game with live characters saves its values
/// (picks made in its own menu are in them).
pub fn watch(
    db: Shared, on_state: impl Fn(&str, bool) + Send + 'static, on_note: impl Fn(&str, String) + Send + 'static,
    on_saved: impl Fn(&str) + Send + 'static,
) {
    let spawned = std::thread::Builder::new().name("gachamod-watch".into()).spawn(move || {
        let mut last_state = Instant::now() - Duration::from_secs(10);
        let mut was_running: Vec<&'static str> = Vec::new();
        let mut saved_at: HashMap<&'static str, Option<std::time::SystemTime>> = HashMap::new();
        let mut pressed: HashMap<String, Vec<Instant>> = HashMap::new();
        // running games with live characters, and where each saves its values
        let mut watched: Vec<(&'static str, PathBuf)> = Vec::new();
        loop {
            std::thread::sleep(Duration::from_millis(700));
            // a save is news (a pick made in the game's own menu): the app shows it within a second
            for (g, user) in &watched {
                let at = std::fs::metadata(user).and_then(|m| m.modified()).ok();
                if saved_at.insert(g, at).is_some_and(|before| before != at) { on_saved(g); }
            }
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
                watched = was_running.iter().filter_map(|g| {
                    let imp = db.lock().ok().and_then(|d| crate::live::has_groups(&d, g).then(|| crate::games::importer_dir(&d, g).ok()).flatten());
                    imp.map(|i| (*g, i.join("d3dx_user.ini")))
                }).collect();
                saved_at.retain(|g, _| watched.iter().any(|(w, _)| w == g));
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
                // a game that runs as administrator never sees keys from an app that doesn't: say so once
                if !self_elevated() && pids.iter().any(|p| win::elevated(Some(*p))) {
                    if let Some(n) = db.lock().ok().and_then(|d| f10_note(&d, &game)) { on_note(&game, n); }
                    with_pending(|p| { p.remove(&game); });
                    continue;
                }
                if !win::foreground_in(&pids) { continue; }
                let times = pressed.entry(game.clone()).or_default();
                if !may_press(times, Instant::now()) { continue; }
                let key = db.lock().ok().map(|d| reload_key(&d, &game)).unwrap_or_default();
                // let the window settle after coming to the front, then press the reload key
                std::thread::sleep(Duration::from_millis(300));
                if win::foreground_in(&pids) {
                    win::press(key.code, &key.held);
                    times.push(Instant::now());
                    with_pending(|p| { p.remove(&game); });
                }
            }
        }
    });
    if spawned.is_err() { /* no watcher: reloads stay manual, nothing else depends on it */ }
}

/// Bring the running game's window to the front (keys sent after this reach it). `then` finishes the error text
/// ("press F10").
fn focus(game: &str, then: &str) -> Result<()> {
    let g = crate::games::require_def(game)?;
    let pids = crate::launch::game_pids(&crate::launch::processes(), game);
    if pids.is_empty() { return Err(Error::Invalid(format!("{} isn't running", g.name))); }
    let Some(w) = win::main_window(&pids) else {
        return Err(Error::Invalid(format!("Couldn't find {}'s window. Click the game and {then}", g.name)));
    };
    if win::foreground_in(&pids) { return Ok(()); }
    // Windows now and then refuses the first try (another window just took the keyboard), so try twice
    for _ in 0..2 {
        win::bring_forward(w);
        std::thread::sleep(Duration::from_millis(300));
        if win::foreground_in(&pids) { break; }
    }
    if !win::foreground_in(&pids) {
        return Err(Error::Invalid(format!("Windows didn't let gachamod bring {} to the front. Click the game and {then}", g.name)));
    }
    Ok(())
}

/// Bring the game to the front for a key tap (live switching).
pub(crate) fn focus_game(game: &str) -> Result<()> {
    if keys_blocked(game) { return Err(Error::Invalid(blocked_text(game))); }
    focus(game, "try again")
}

/// A process runs as administrator.
pub fn elevated(pid: u32) -> bool { win::elevated(Some(pid)) }

/// gachamod itself runs as administrator.
pub fn self_elevated() -> bool { win::elevated(None) }

/// The running game runs as administrator while gachamod doesn't. Windows then drops every key gachamod presses for
/// the game and never passes gachamod a hotkey pressed in it.
pub fn keys_blocked(game: &str) -> bool {
    if self_elevated() { return false; }
    crate::launch::game_pids(&crate::launch::processes(), game).iter().any(|p| win::elevated(Some(*p)))
}

fn blocked_text(game: &str) -> String {
    let name = crate::games::def(game).map_or("The game", |g| g.name);
    let key = key_name(game);
    format!("{name} runs as administrator, so gachamod can't press keys in it. Press {key} in the game, or restart gachamod as administrator")
}

/// The key that makes 3DMigoto load mods again in a game, as `press` takes it, and its name ("F10", "Ctrl+F5").
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReloadKey { pub code: u32, pub held: Vec<u32>, pub name: String }

impl Default for ReloadKey {
    fn default() -> Self { ReloadKey { code: 0x79, held: Vec::new(), name: "F10".into() } }
}

/// Each game's reload key name, from the last time it was read (messages that have no database at hand use it).
static KEY_NAMES: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

/// The reload key in an importer folder's d3dx.ini: `reload_config`, or the older `reload_fixes`. F10, the key every
/// loader ships with, when neither names a keyboard key.
pub fn reload_key_in(importer: Option<&Path>) -> ReloadKey {
    let text = importer.and_then(|i| std::fs::read(i.join("d3dx.ini")).ok()).map(|b| crate::ini::decode(&b));
    text.and_then(|t| {
        ["reload_config", "reload_fixes"].iter().find_map(|k| crate::gamecheck::d3dx_value(&t, k).and_then(|v| crate::keys::press_of(&v)))
    })
    .map(|(code, held, name)| ReloadKey { code, held, name })
    .unwrap_or_default()
}

/// A game's reload key (`reload_key_in` for its importer folder).
pub fn reload_key(db: &Db, game: &str) -> ReloadKey {
    let key = reload_key_in(crate::games::importer_dir(db, game).ok().as_deref());
    if let Ok(mut m) = KEY_NAMES.lock() { m.get_or_insert_with(HashMap::new).insert(game.to_string(), key.name.clone()); }
    key
}

/// The name of a game's reload key as last read, F10 before that.
pub fn key_name(game: &str) -> String {
    KEY_NAMES.lock().ok().and_then(|m| m.as_ref().and_then(|m| m.get(game).cloned())).unwrap_or_else(|| "F10".into())
}

/// Games told this run that a change waits for the reload key.
static TOLD: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// The line that says a change waits for the reload key in the game: once per game each time gachamod starts, and only
/// when the app can't press it itself (the game runs as administrator, or automatic reloads are off).
pub fn f10_note(db: &crate::db::Db, game: &str) -> Option<String> {
    let blocked = keys_blocked(game);
    if !blocked && db.setting(&format!("{game}.autoReload")).ok().flatten().as_deref() != Some("0") { return None; }
    let mut told = TOLD.lock().ok()?;
    if told.iter().any(|g| g == game) { return None; }
    told.push(game.to_string());
    drop(told);
    crate::telemetry::note(db, vec![crate::telemetry::UiEvent::new("f10 note", serde_json::json!({ "game": game, "blocked": blocked }))]);
    let key = reload_key(db, game).name;
    if !blocked { return Some(format!("Press {key} in the game to load changes")); }
    let name = crate::games::def(game).map_or("The game", |g| g.name);
    // the window's toast adds "Restart as administrator" to this line (src/lib/elevation.ts looks for its start)
    Some(format!("Press {key} in the game to load changes. {name} runs as administrator, so gachamod can only send it keys as administrator too"))
}

/// Start gachamod again as administrator. Windows asks the player first, in front of `owner` (gachamod's window, 0
/// for none). True: the new copy is starting, so the caller quits and the new copy waits for it (`after_restart`).
/// False: the player said no and this copy carries on.
pub fn restart_elevated(owner: isize) -> Result<bool> {
    let exe = std::env::current_exe()?;
    crate::logs::info("asking Windows to restart gachamod as administrator");
    match win::run_as_admin(&exe, &format!("--after-restart={}", std::process::id()), owner) {
        Ok(()) => Ok(true),
        Err(ERROR_CANCELLED) => { crate::logs::info("the administrator prompt got a no"); Ok(false) }
        Err(code) => Err(Error::Invalid(format!("Windows couldn't restart gachamod as administrator (error {code})"))),
    }
}

/// Windows' error when the player answers No to its administrator prompt.
const ERROR_CANCELLED: u32 = 1223;

/// Where Windows keeps "Run this program as an administrator" for each program (the Compatibility tab).
const LAYERS: &str = "Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers";

/// gachamod starts as administrator every time: Windows' own setting for its exe, which the installer sets when the
/// player says yes.
pub fn always_admin() -> bool {
    std::env::current_exe().ok().and_then(|e| win::reg_value(LAYERS, &e.to_string_lossy())).is_some_and(|v| runas_in(&v))
}

/// The installer's own key. `admin` ("1" or "0") is the player's choice, which the installer puts back after an
/// upgrade that uninstalled the old version (that takes the Layers value with it). See src-tauri/windows/hooks.nsh.
const OWN_KEY: &str = "Software\\gachamod";

/// Turn "always as administrator" on or off. It counts from the next start (Windows asks each time, unless its
/// administrator prompts are off).
pub fn set_always_admin(on: bool) -> Result<()> {
    let exe = std::env::current_exe()?.to_string_lossy().into_owned();
    let flags = with_runas(&win::reg_value(LAYERS, &exe).unwrap_or_default(), on);
    if !win::set_reg_value(LAYERS, &exe, flags.as_deref()) {
        return Err(Error::Invalid("Windows didn't let gachamod change how it starts. Right-click gachamod.exe, open Properties, Compatibility and tick Run this program as an administrator".into()));
    }
    win::set_reg_value(OWN_KEY, "admin", Some(if on { "1" } else { "0" }));
    Ok(())
}

fn runas_in(flags: &str) -> bool { flags.split_whitespace().any(|f| f.eq_ignore_ascii_case("RUNASADMIN")) }

/// The program's compatibility flags with RUNASADMIN added or taken out, the others kept. None: no flags left.
fn with_runas(flags: &str, on: bool) -> Option<String> {
    let mut v: Vec<&str> = flags.split_whitespace().filter(|f| *f != "~" && !f.eq_ignore_ascii_case("RUNASADMIN")).collect();
    if on { v.push("RUNASADMIN"); }
    (!v.is_empty()).then(|| format!("~ {}", v.join(" ")))
}

/// Windows hides a copy of gachamod that runs as administrator from one that doesn't, so a gachamod:// link or a
/// double-clicked .gachamod file would start a second copy. Called first thing at a start: when an administrator's
/// copy runs and this one isn't one, hand it this start's arguments the way the single-instance plugin does and
/// return true (this copy quits). `id` is the app's identifier.
pub fn hand_to_elevated_copy(id: &str) -> bool {
    if self_elevated() || !win::mutex_hidden(&format!("{id}-sim")) { return false; }
    let mut data = std::env::current_dir().unwrap_or_default().to_string_lossy().into_owned();
    for a in std::env::args_os() { data.push('\0'); data.push_str(&a.to_string_lossy()); }
    if !win::copy_data(&format!("{id}-sic"), &format!("{id}-siw"), &data) { crate::logs::warn("a second start couldn't reach the administrator's copy"); }
    true
}

/// Running as administrator: let copies that aren't hand over their arguments (`hand_to_elevated_copy`).
pub fn accept_hand_offs(id: &str) {
    if self_elevated() { win::allow_copy_data(&format!("{id}-sic"), &format!("{id}-siw")); }
}

/// A copy started by `restart_elevated` waits here until the old one is gone, so it isn't taken for a second start.
pub fn after_restart(args: &[String]) {
    let Some(pid) = args.iter().find_map(|a| a.strip_prefix("--after-restart=")).and_then(|p| p.parse::<u32>().ok()) else { return };
    win::wait_for_exit(pid, 15_000);
}

/// Give a window of the app the keyboard (the skin menu over a game). Windows refuses the plain request when the
/// app didn't get the last key press, as when a controller opened the menu.
pub fn raise(window: isize) { win::bring_forward(window as win::Win); }

/// Bring the game to the front (after the skin menu over it closes).
pub fn show_game(game: &str) -> Result<()> { focus(game, "carry on") }

/// True while `game` holds the screen in exclusive fullscreen, where no other window can show over it: its window
/// is in front and fills its monitor, and Windows says a Direct3D program holds the screen
/// (`SHQueryUserNotificationState`). Windowed and borderless games, and another program in exclusive fullscreen,
/// give false, so the menu over the game opens there.
pub fn exclusive_fullscreen(game: &str) -> bool {
    let pids = crate::launch::game_pids(&crate::launch::processes(), game);
    !pids.is_empty() && win::foreground_of(&pids).is_some_and(win::covers_monitor) && win::exclusive_fullscreen()
}

/// The running game's window: left, top, width and height in screen pixels.
pub fn game_rect(game: &str) -> Option<(i32, i32, i32, i32)> {
    let pids = crate::launch::game_pids(&crate::launch::processes(), game);
    if pids.is_empty() { return None; }
    win::rect(win::main_window(&pids)?)
}

/// Where the mouse cursor is, in screen pixels.
pub fn cursor() -> Option<(i32, i32)> { win::cursor() }

/// Put the mouse cursor back at a spot and free it. A game in front keeps the cursor in the middle of its window and
/// fenced in; the skin menu brings the game forward for a pick and then puts the cursor back where it was.
pub fn put_cursor(at: (i32, i32)) { win::put_cursor(at.0, at.1) }

/// Every one of these controller buttons ("XB_LEFT_THUMB", "XB_A", "XB_LEFT_TRIGGER") is held on one controller: the
/// buttons that open the skin menu. False for no buttons, and for one XInput doesn't report (the guide button).
pub fn pad_down(buttons: &[String]) -> bool { win::pad_down(buttons) }

/// Bring the game window forward and press its reload key (`reload_key`) so changed mods load without a restart.
pub fn reload_in_game(game: &str, key: &ReloadKey) -> Result<()> {
    if keys_blocked(game) { return Err(Error::Invalid(blocked_text(game))); }
    focus(game, &format!("press {}", key.name))?;
    win::press(key.code, &key.held);
    with_pending(|p| { p.remove(game); });
    Ok(())
}

#[cfg(windows)]
pub(crate) mod win {
    use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM};
    use windows_sys::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        MapVirtualKeyW, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, MAPVK_VK_TO_VSC, VIRTUAL_KEY, VK_MENU,
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

    /// The window in front, when it belongs to one of these processes.
    pub fn foreground_of(pids: &[u32]) -> Option<Win> {
        // SAFETY: no arguments.
        let w = unsafe { GetForegroundWindow() };
        (!w.is_null() && pids.contains(&pid_of(w))).then_some(w)
    }

    /// The window covers the whole of its monitor (fullscreen, exclusive or borderless).
    pub fn covers_monitor(w: Win) -> bool {
        use windows_sys::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
        let Some((x, y, cw, ch)) = rect(w) else { return false };
        // SAFETY: a window handle Windows gave us; the struct is zeroed with its size set as the API requires.
        unsafe {
            let mon = MonitorFromWindow(w, MONITOR_DEFAULTTONEAREST);
            let mut mi: MONITORINFO = std::mem::zeroed();
            mi.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
            if mon.is_null() || GetMonitorInfoW(mon, &mut mi) == 0 { return false; }
            let m = mi.rcMonitor;
            x <= m.left && y <= m.top && x + cw >= m.right && y + ch >= m.bottom
        }
    }

    pub fn key(vk: VIRTUAL_KEY, up: bool) -> INPUT {
        // SAFETY: MapVirtualKeyW is a pure lookup.
        let scan = unsafe { MapVirtualKeyW(vk as u32, MAPVK_VK_TO_VSC) } as u16;
        INPUT { r#type: INPUT_KEYBOARD, Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: vk, wScan: scan, dwFlags: if up { KEYEVENTF_KEYUP } else { 0 }, time: 0, dwExtraInfo: 0 } } }
    }

    pub fn send(inputs: &[INPUT]) {
        // SAFETY: a valid slice of INPUT structs and its size.
        unsafe { SendInput(inputs.len() as u32, inputs.as_ptr(), std::mem::size_of::<INPUT>() as i32) };
    }

    /// Press and release a key with these modifiers held, for a few frames so 3DMigoto's per-frame key check sees it.
    pub fn press(code: u32, held: &[u32]) {
        let down: Vec<INPUT> = held.iter().chain([&code]).map(|c| key(*c as VIRTUAL_KEY, false)).collect();
        send(&down);
        std::thread::sleep(std::time::Duration::from_millis(90));
        let up: Vec<INPUT> = [&code].into_iter().chain(held.iter().rev()).map(|c| key(*c as VIRTUAL_KEY, true)).collect();
        send(&up);
    }

    /// Whether a process (None: this one) runs as administrator. One we aren't allowed to look at does.
    pub fn elevated(pid: Option<u32>) -> bool {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
        use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcess, OpenProcessToken, PROCESS_QUERY_LIMITED_INFORMATION};
        // SAFETY: handles are checked before use and closed (the current-process handle is a constant that needs no
        // close); the out pointers are live locals of the size passed.
        unsafe {
            let proc = match pid { Some(p) => OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, p), None => GetCurrentProcess() };
            if proc.is_null() { return pid.is_some(); }
            let mut token = std::ptr::null_mut();
            let opened = OpenProcessToken(proc, TOKEN_QUERY, &mut token) != 0;
            if pid.is_some() { CloseHandle(proc); }
            if !opened { return pid.is_some(); }
            let mut e = TOKEN_ELEVATION { TokenIsElevated: 0 };
            let mut n = 0u32;
            let got = GetTokenInformation(token, TokenElevation, &mut e as *mut TOKEN_ELEVATION as *mut _, std::mem::size_of::<TOKEN_ELEVATION>() as u32, &mut n) != 0;
            CloseHandle(token);
            got && e.TokenIsElevated != 0
        }
    }

    /// Start `exe` as administrator through Windows' prompt, owned by the window `owner` (0: none), and wait for the
    /// answer. Err holds Windows' error code: 1223 when the player said no.
    pub fn run_as_admin(exe: &std::path::Path, args: &str, owner: isize) -> Result<(), u32> {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Foundation::GetLastError;
        use windows_sys::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE};
        use windows_sys::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_FLAG_NO_UI, SEE_MASK_NOASYNC, SHELLEXECUTEINFOW};
        use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        let wide = |s: &std::ffi::OsStr| -> Vec<u16> { s.encode_wide().chain(std::iter::once(0)).collect() };
        let (verb, file, params) = (wide("runas".as_ref()), wide(exe.as_os_str()), wide(args.as_ref()));
        // The shell wants COM in a single-threaded apartment, which a pooled worker thread may not have (or may have
        // the other kind), so the prompt gets a thread of its own. No UI: a refusal comes back as an error code
        // instead of a Windows message box, and the call returns only once the player has answered.
        let asked = std::thread::spawn(move || {
            // SAFETY: COM is set up and torn down on this thread only. Every string is zero-terminated and outlives
            // the call; the struct is plain data, zeroed, with its size set as the API requires.
            unsafe {
                let com = CoInitializeEx(std::ptr::null(), (COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) as _);
                let mut sei: SHELLEXECUTEINFOW = std::mem::zeroed();
                sei.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
                sei.fMask = SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI;
                sei.hwnd = owner as HWND;
                sei.lpVerb = verb.as_ptr();
                sei.lpFile = file.as_ptr();
                sei.lpParameters = params.as_ptr();
                sei.nShow = SW_SHOWNORMAL as i32;
                let r = if ShellExecuteExW(&mut sei) != 0 { Ok(()) } else { Err(GetLastError()) };
                if com >= 0 { CoUninitialize(); }
                r
            }
        });
        asked.join().unwrap_or(Err(0))
    }

    pub fn wait_for_exit(pid: u32, ms: u32) {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::Threading::{OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE};
        // SAFETY: the handle is checked and closed. A process that is already gone gives no handle.
        unsafe {
            let h = OpenProcess(PROCESS_SYNCHRONIZE, 0, pid);
            if h.is_null() { return; }
            WaitForSingleObject(h, ms);
            CloseHandle(h);
        }
    }

    pub fn exclusive_fullscreen() -> bool {
        use windows_sys::Win32::UI::Shell::{SHQueryUserNotificationState, QUNS_RUNNING_D3D_FULL_SCREEN};
        let mut state = 0;
        // SAFETY: the out pointer is a live local.
        unsafe { SHQueryUserNotificationState(&mut state) == 0 && state == QUNS_RUNNING_D3D_FULL_SCREEN }
    }

    pub fn rect(w: Win) -> Option<(i32, i32, i32, i32)> {
        use windows_sys::Win32::Foundation::RECT;
        let mut r = RECT { left: 0, top: 0, right: 0, bottom: 0 };
        // SAFETY: a window handle from EnumWindows and a live local.
        if unsafe { windows_sys::Win32::UI::WindowsAndMessaging::GetWindowRect(w, &mut r) } == 0 { return None; }
        Some((r.left, r.top, r.right - r.left, r.bottom - r.top))
    }

    pub fn cursor() -> Option<(i32, i32)> {
        let mut p = windows_sys::Win32::Foundation::POINT { x: 0, y: 0 };
        // SAFETY: the out pointer is a live local.
        (unsafe { windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos(&mut p) } != 0).then_some((p.x, p.y))
    }

    pub fn put_cursor(x: i32, y: i32) {
        use windows_sys::Win32::UI::WindowsAndMessaging::{ClipCursor, SetCursorPos};
        // SAFETY: a null rectangle lets the cursor go anywhere again; plain screen coordinates.
        unsafe { ClipCursor(std::ptr::null()); SetCursorPos(x, y); }
    }

    pub fn pad_down(buttons: &[String]) -> bool {
        use windows_sys::Win32::UI::Input::XboxController::{XInputGetState, XINPUT_STATE};
        if buttons.is_empty() { return false; }
        // XInput's bits for wButtons; the triggers are two bytes of their own
        let (mut mask, mut lt, mut rt) = (0u32, false, false);
        for b in buttons {
            let up = b.to_ascii_uppercase();
            mask |= match up.split_once('_').map_or("", |(_, name)| name) {
                "DPAD_UP" => 0x0001, "DPAD_DOWN" => 0x0002, "DPAD_LEFT" => 0x0004, "DPAD_RIGHT" => 0x0008,
                "START" => 0x0010, "BACK" => 0x0020, "LEFT_THUMB" => 0x0040, "RIGHT_THUMB" => 0x0080,
                "LEFT_SHOULDER" => 0x0100, "RIGHT_SHOULDER" => 0x0200, "A" => 0x1000, "B" => 0x2000, "X" => 0x4000, "Y" => 0x8000,
                "LEFT_TRIGGER" => { lt = true; 0 }
                "RIGHT_TRIGGER" => { rt = true; 0 }
                _ => return false,
            };
        }
        (0..4).any(|i| {
            // SAFETY: XINPUT_STATE is plain data and the pointer is a live local.
            let mut st: XINPUT_STATE = unsafe { std::mem::zeroed() };
            if unsafe { XInputGetState(i, &mut st) } != 0 { return false; }
            let pad = st.Gamepad;
            pad.wButtons as u32 & mask == mask && (!lt || pad.bLeftTrigger > 30) && (!rt || pad.bRightTrigger > 30)
        })
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

    fn wide(s: &str) -> Vec<u16> { s.encode_utf16().chain(std::iter::once(0)).collect() }

    /// A text value under HKEY_CURRENT_USER\`key`.
    pub fn reg_value(key: &str, name: &str) -> Option<String> {
        use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_SZ};
        let (k, n) = (wide(key), wide(name));
        let mut buf = vec![0u16; 1024];
        let mut bytes = (buf.len() * 2) as u32;
        // SAFETY: zero-terminated strings and a buffer whose size in bytes is passed along.
        let r = unsafe { RegGetValueW(HKEY_CURRENT_USER, k.as_ptr(), n.as_ptr(), RRF_RT_REG_SZ, std::ptr::null_mut(), buf.as_mut_ptr().cast(), &mut bytes) };
        if r != 0 { return None; }
        let len = (bytes as usize / 2).min(buf.len());
        Some(String::from_utf16_lossy(&buf[..len]).trim_end_matches('\0').to_string())
    }

    /// Set (or with None, delete) a text value under HKEY_CURRENT_USER\`key`. True when it worked.
    pub fn set_reg_value(key: &str, name: &str, value: Option<&str>) -> bool {
        use windows_sys::Win32::System::Registry::{
            RegCloseKey, RegCreateKeyExW, RegDeleteKeyValueW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_SET_VALUE, REG_OPTION_NON_VOLATILE, REG_SZ,
        };
        let (k, n) = (wide(key), wide(name));
        // SAFETY: zero-terminated strings; the key handle is closed before returning.
        unsafe {
            let Some(value) = value else {
                let r = RegDeleteKeyValueW(HKEY_CURRENT_USER, k.as_ptr(), n.as_ptr());
                return r == 0 || r == 2; // gone already counts
            };
            let mut h: HKEY = std::ptr::null_mut();
            if RegCreateKeyExW(HKEY_CURRENT_USER, k.as_ptr(), 0, std::ptr::null(), REG_OPTION_NON_VOLATILE, KEY_SET_VALUE, std::ptr::null(), &mut h, std::ptr::null_mut()) != 0 { return false; }
            let v = wide(value);
            let r = RegSetValueExW(h, n.as_ptr(), 0, REG_SZ, v.as_ptr().cast(), (v.len() * 2) as u32);
            RegCloseKey(h);
            r == 0
        }
    }

    /// A named mutex exists that this process may not open: one an administrator's process made.
    pub fn mutex_hidden(name: &str) -> bool {
        use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, ERROR_ACCESS_DENIED};
        use windows_sys::Win32::System::Threading::OpenMutexW;
        const SYNCHRONIZE: u32 = 0x0010_0000;
        let n = wide(name);
        // SAFETY: a zero-terminated name; a handle that opens is closed at once.
        unsafe {
            let h = OpenMutexW(SYNCHRONIZE, 0, n.as_ptr());
            if !h.is_null() { CloseHandle(h); return false; }
            GetLastError() == ERROR_ACCESS_DENIED
        }
    }

    /// Send `data` to the window with this class and title as the single-instance plugin does (WM_COPYDATA, the
    /// parts split by NUL). True when it took it.
    pub fn copy_data(class: &str, title: &str, data: &str) -> bool {
        use windows_sys::Win32::System::DataExchange::COPYDATASTRUCT;
        use windows_sys::Win32::UI::WindowsAndMessaging::{AllowSetForegroundWindow, FindWindowW, SendMessageTimeoutW, SMTO_NORMAL, WM_COPYDATA};
        // the plugin's marker for NUL-separated arguments
        const NUL_SEPARATED: usize = 1543;
        let (c, t) = (wide(class), wide(title));
        // SAFETY: zero-terminated strings; the data outlives the synchronous send.
        unsafe {
            let w = FindWindowW(c.as_ptr(), t.as_ptr());
            if w.is_null() { return false; }
            AllowSetForegroundWindow(pid_of(w));
            let cds = COPYDATASTRUCT { dwData: NUL_SEPARATED, cbData: data.len() as u32, lpData: data.as_ptr() as *mut _ };
            SendMessageTimeoutW(w, WM_COPYDATA, 0, &cds as *const _ as isize, SMTO_NORMAL, 5000, std::ptr::null_mut()) != 0
        }
    }

    /// Let processes that aren't administrators send WM_COPYDATA to this process's window with this class and title.
    pub fn allow_copy_data(class: &str, title: &str) {
        use windows_sys::Win32::System::Threading::GetCurrentProcessId;
        use windows_sys::Win32::UI::WindowsAndMessaging::{ChangeWindowMessageFilterEx, FindWindowW, MSGFLT_ALLOW, WM_COPYDATA};
        let (c, t) = (wide(class), wide(title));
        // SAFETY: zero-terminated strings; the window is checked to be this process's.
        unsafe {
            let w = FindWindowW(c.as_ptr(), t.as_ptr());
            if w.is_null() || pid_of(w) != GetCurrentProcessId() { return; }
            ChangeWindowMessageFilterEx(w, WM_COPYDATA, MSGFLT_ALLOW, std::ptr::null_mut());
        }
    }
}

#[cfg(not(windows))]
pub(crate) mod win {
    pub type Win = usize;
    pub fn reg_value(_key: &str, _name: &str) -> Option<String> { None }
    pub fn set_reg_value(_key: &str, _name: &str, _value: Option<&str>) -> bool { false }
    pub fn mutex_hidden(_name: &str) -> bool { false }
    pub fn copy_data(_class: &str, _title: &str, _data: &str) -> bool { false }
    pub fn allow_copy_data(_class: &str, _title: &str) {}
    pub fn foreground_in(_pids: &[u32]) -> bool { false }
    pub fn main_window(_pids: &[u32]) -> Option<Win> { None }
    pub fn foreground_of(_pids: &[u32]) -> Option<Win> { None }
    pub fn covers_monitor(_w: Win) -> bool { false }
    pub fn elevated(_pid: Option<u32>) -> bool { false }
    pub fn run_as_admin(_exe: &std::path::Path, _args: &str, _owner: isize) -> Result<(), u32> { Err(0) }
    pub fn wait_for_exit(_pid: u32, _ms: u32) {}
    pub fn exclusive_fullscreen() -> bool { false }
    pub fn rect(_w: Win) -> Option<(i32, i32, i32, i32)> { None }
    pub fn cursor() -> Option<(i32, i32)> { None }
    pub fn put_cursor(_x: i32, _y: i32) {}
    pub fn pad_down(_buttons: &[String]) -> bool { false }
    pub fn press(_code: u32, _held: &[u32]) {}
    pub fn bring_forward(_w: Win) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runas_joins_and_leaves_the_other_flags() {
        assert_eq!(with_runas("", true).as_deref(), Some("~ RUNASADMIN"));
        assert_eq!(with_runas("~ HIGHDPIAWARE", true).as_deref(), Some("~ HIGHDPIAWARE RUNASADMIN"));
        assert_eq!(with_runas("~ RUNASADMIN HIGHDPIAWARE", false).as_deref(), Some("~ HIGHDPIAWARE"));
        assert_eq!(with_runas("~ RUNASADMIN", false), None);
        assert_eq!(with_runas("~ runasadmin", true).as_deref(), Some("~ RUNASADMIN"));
        assert!(runas_in("~ HIGHDPIAWARE RUNASADMIN") && !runas_in("~ HIGHDPIAWARE"));
    }

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
    fn putting_back_options_swaps_and_loses_nothing() {
        let dir = std::env::temp_dir().join(format!("gachamod-unwipe-test-{}-{}", std::process::id(), crate::db::now()));
        std::fs::create_dir_all(&dir).unwrap();
        let ini = dir.join("d3dx_user.ini");
        let bak = dir.join(WIPED_BAK);
        std::fs::write(&ini, "[Constants]\n$\\mods\\a\\a.ini\\v = 1\n").unwrap();
        assert!(wipe_user_config_in(&dir, "gi").unwrap());
        // options saved after the wipe
        std::fs::write(&ini, "[Constants]\n$\\mods\\a\\a.ini\\v = 9\n").unwrap();
        unwipe_user_config_in(&dir, "gi").unwrap();
        assert!(std::fs::read_to_string(&ini).unwrap().contains("v = 1"));
        assert!(std::fs::read_to_string(&bak).unwrap().contains("v = 9"), "the file that was replaced is kept");
        // again: back to what was there
        unwipe_user_config_in(&dir, "gi").unwrap();
        assert!(std::fs::read_to_string(&ini).unwrap().contains("v = 9"));
        assert!(std::fs::read_to_string(&bak).unwrap().contains("v = 1"));
        // no file in place: the copy is just put back
        std::fs::remove_file(&ini).unwrap();
        unwipe_user_config_in(&dir, "gi").unwrap();
        assert!(std::fs::read_to_string(&ini).unwrap().contains("v = 1"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn pending_marks_collect() {
        mark_changed("zzz-test");
        assert!(with_pending(|p| p.contains("zzz-test")).unwrap());
        with_pending(|p| { p.remove("zzz-test"); });
    }
}

#[cfg(test)]
mod press_tests {
    use super::may_press;
    use std::time::{Duration, Instant};

    #[test]
    fn automatic_reloads_are_spaced_and_capped() {
        let start = Instant::now();
        let at = |s: u64| start + Duration::from_secs(s);
        let mut times = Vec::new();
        assert!(may_press(&mut times, at(0)));
        times.push(at(0));
        // a second change right after waits for the next allowed press
        assert!(!may_press(&mut times, at(3)));
        assert!(may_press(&mut times, at(10)));
        times.push(at(10));
        assert!(may_press(&mut times, at(20)));
        times.push(at(20));
        // three in a minute: no more until the first is a minute old
        assert!(!may_press(&mut times, at(40)));
        assert!(!may_press(&mut times, at(59)));
        assert!(may_press(&mut times, at(61)));
    }
}
