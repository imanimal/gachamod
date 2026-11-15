//! Starting a game and knowing when it runs. Owner: SYSTEM area (docs/spec.md, "Launching").
//!
//! With XXMI managing the importer, a launch goes through XXMI (xxmi::launch) and the launch settings are XXMI's own
//! config fields, so the two apps never disagree. Without XXMI, gachamod starts the game's exe itself with the saved
//! arguments (mods then need another injector; the UI says so).
//!
//! gachamod keeps its own copy of the form in the setting "<game>.launch" (JSON). Fields XXMI owns are read from and
//! written to XXMI's config whenever the game goes through XXMI.

use crate::db::Db;
use crate::error::{Error, Result};
use crate::games::{self, GameDef};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// Launch settings for one game, as the Tools screen edits them.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct LaunchConfig {
    /// "xxmi" or "direct".
    pub via: String,
    /// Command-line arguments for the game ("-popupwindow -screen-width 1920").
    pub args: String,
    /// "LOW", "BELOW_NORMAL", "NORMAL", "ABOVE_NORMAL", "HIGH", "REALTIME".
    pub process_priority: String,
    /// "WINDOWED", "BORDERLESS", "FULLSCREEN" where XXMI supports it, else empty.
    pub window_mode: String,
    pub pre_launch: Hook,
    pub post_load: Hook,
    /// A different exe to start (direct launches only).
    pub custom_exe: Option<String>,
    /// Game-specific XXMI switches it offers (unlock_fps, disable_wounded_fx, force_max_lod_bias ...), by key.
    pub extras: BTreeMap<String, Value>,
    pub migoto: MigotoConfig,
    /// Close gachamod's window after the game starts.
    pub close_on_launch: bool,
    /// Fields that can't be changed from gachamod right now, with the reason to show beside them
    /// ("preLaunch", "migoto.callsLogging" ...). Read only: set_config ignores it.
    pub locked: BTreeMap<String, String>,
    /// XXMI Launcher can start this game (it manages the importer and was found).
    pub xxmi_available: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Hook { pub enabled: bool, pub command: String, pub wait: bool }

/// 3DMigoto switches for mod makers.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct MigotoConfig {
    /// Hunting mode (numpad keys cycle shaders and buffers).
    pub hunting: bool,
    pub dump_shaders: bool,
    pub mute_warnings: bool,
    /// "DISABLED", "WARNING", "INFO", "DEBUG" (XXMI's log_level), or empty outside XXMI.
    pub log_level: String,
    pub calls_logging: bool,
    pub debug_logging: bool,
    /// XXMI only: it rewrites the importer's [Rendering] keys in d3dx.ini on each start. The right values differ per
    /// game (texture_hash is 1 for WWMI, 0 for the rest), so outside XXMI this is never read or written.
    pub enforce_rendering: bool,
}

/// XXMI importer keys shown as game extras when the importer's config has them. GIMI and HIMI still carry
/// `disable_dcr` but XXMI no longer reads it: `configure_game` is what turns dynamic character resolution off.
pub const EXTRA_KEYS: &[&str] = &[
    "configure_game", "unlock_fps", "unlock_fps_value", "enable_hdr", "disable_wounded_fx", "force_max_lod_bias", "resource_tier",
    "mesh_lod_distance_lod_base_fov",
];

/// Importers where XXMI acts on `configure_game` (the others have the key but ignore it).
const CONFIGURES_GAME: &[&str] = &["GIMI", "WWMI", "ZZMI"];

const XXMI_SIGNED: &str = "XXMI Launcher signs this command. Set it in XXMI Launcher";
const XXMI_MISSING: &str = "Your XXMI Launcher version doesn't have this option";

fn own_key(game: &str) -> String { format!("{game}.launch") }

/// Read the launch form: gachamod's saved copy, with XXMI's own values on top when the game goes through XXMI.
pub fn config(db: &Db, game: &str) -> Result<LaunchConfig> {
    let g = games::require_def(game)?;
    let own: LaunchConfig = db.setting_json(&own_key(game))?.unwrap_or_default();
    let paths = games::paths(db, game)?;
    let root = db.setting("xxmi.root")?.filter(|s| !s.is_empty());
    let xxmi_cfg = if g.xxmi && paths.via_xxmi { crate::xxmi::importer_config(root.as_deref(), g.importer).ok() } else { None };
    let mut c = merge_config(own, xxmi_cfg.as_ref(), close_on_launch(db, game));
    if !CONFIGURES_GAME.contains(&g.importer) { c.extras.remove("configure_game"); }
    if !c.xxmi_available {
        let text = games::importer_dir(db, game).ok().and_then(|d| std::fs::read_to_string(d.join("d3dx.ini")).ok());
        match text {
            Some(t) => c.migoto = migoto_from_d3dx(&t),
            None => { c.locked.insert("migoto".into(), "No d3dx.ini found for this game yet. Set its loader folder in Settings".into()); }
        }
    }
    Ok(c)
}

/// The mod maker switches as a plain d3dx.ini has them.
pub fn migoto_from_d3dx(text: &str) -> MigotoConfig {
    let on = |sec: &str, key: &str| ini_get(text, sec, key).is_some_and(|v| v.trim() != "0" && !v.trim().is_empty());
    MigotoConfig {
        hunting: on("Hunting", "hunting"),
        dump_shaders: ini_get(text, "Hunting", "marking_actions").is_some_and(|v| v.contains("hlsl")),
        mute_warnings: ini_get(text, "Logging", "show_warnings").is_some_and(|v| v.trim() == "0"),
        log_level: String::new(),
        calls_logging: on("Logging", "calls"),
        debug_logging: on("Logging", "debug"),
        enforce_rendering: false,
    }
}

/// The value of `key` in `[section]` (case-insensitive), ignoring commented lines.
pub fn ini_get(text: &str, section: &str, key: &str) -> Option<String> {
    let mut in_sec = false;
    for line in text.lines() {
        let t = line.trim();
        if t.starts_with('[') { in_sec = t.trim_start_matches('[').trim_end_matches(']').trim().eq_ignore_ascii_case(section); continue; }
        if !in_sec || t.starts_with(';') { continue; }
        if let Some((k, v)) = t.split_once('=') { if k.trim().eq_ignore_ascii_case(key) { return Some(v.trim().to_string()); } }
    }
    None
}

fn close_on_launch(db: &Db, game: &str) -> bool { db.setting(&format!("{game}.closeOnLaunch")).ok().flatten().as_deref() == Some("1") }

/// Build the form from gachamod's copy and, when there is one, XXMI's `Importers.<code>` block.
pub fn merge_config(own: LaunchConfig, xxmi: Option<&Value>, close: bool) -> LaunchConfig {
    let mut c = own;
    c.close_on_launch = close;
    c.locked.clear();
    c.xxmi_available = xxmi.is_some();
    let Some(x) = xxmi else {
        c.via = "direct".into();
        c.locked.insert("via".into(), "XXMI Launcher doesn't manage this game here".into());
        c.locked.insert("processPriority".into(), "Only XXMI Launcher can set this".into());
        c.locked.insert("windowMode".into(), "Only XXMI Launcher can set this".into());
        c.locked.insert("postLoad".into(), "Only XXMI Launcher can run this".into());
        c.locked.insert("migoto.logLevel".into(), "Use calls and debug logging instead".into());
        c.extras.clear();
        return c;
    };
    if c.via != "direct" { c.via = "xxmi".into(); }
    let imp = &x["Importer"];
    let mig = &x["Migoto"];
    let s = |v: &Value| v.as_str().unwrap_or_default().to_string();
    let b = |v: &Value| v.as_bool().unwrap_or(false);
    c.args = s(&imp["launch_options"]);
    c.process_priority = s(&imp["process_priority"]);
    c.window_mode = s(&imp["window_mode"]);
    c.pre_launch = Hook { enabled: b(&imp["run_pre_launch_enabled"]), command: s(&imp["run_pre_launch"]), wait: b(&imp["run_pre_launch_wait"]) };
    c.post_load = Hook { enabled: b(&imp["run_post_load_enabled"]), command: s(&imp["run_post_load"]), wait: b(&imp["run_post_load_wait"]) };
    c.custom_exe = None;
    c.locked.insert("preLaunch".into(), XXMI_SIGNED.into());
    c.locked.insert("postLoad".into(), XXMI_SIGNED.into());
    c.locked.insert("customExe".into(), "Set a custom launch in XXMI Launcher".into());
    c.extras = EXTRA_KEYS.iter().filter_map(|k| imp.get(*k).map(|v| (k.to_string(), v.clone()))).collect();
    c.migoto = MigotoConfig {
        hunting: b(&mig["enable_hunting"]),
        dump_shaders: b(&mig["dump_shaders"]),
        mute_warnings: b(&mig["mute_warnings"]),
        log_level: s(&mig["log_level"]),
        calls_logging: b(&mig["calls_logging"]),
        debug_logging: b(&mig["debug_logging"]),
        enforce_rendering: b(&mig["enforce_rendering"]),
    };
    for (field, key) in MIGOTO_KEYS {
        if mig.get(key).is_none() { c.locked.insert(format!("migoto.{field}"), XXMI_MISSING.into()); }
    }
    c
}

/// (form field, XXMI Migoto key)
const MIGOTO_KEYS: &[(&str, &str)] = &[
    ("hunting", "enable_hunting"), ("dumpShaders", "dump_shaders"), ("muteWarnings", "mute_warnings"), ("logLevel", "log_level"),
    ("callsLogging", "calls_logging"), ("debugLogging", "debug_logging"), ("enforceRendering", "enforce_rendering"),
];

/// The XXMI changes `cfg` asks for compared with XXMI's current block. Empty when nothing XXMI owns changed.
pub fn xxmi_patch(cfg: &LaunchConfig, current: &Value) -> Value {
    let mut imp = serde_json::Map::new();
    let mut mig = serde_json::Map::new();
    let cur_i = &current["Importer"];
    let cur_m = &current["Migoto"];
    fn set(m: &mut serde_json::Map<String, Value>, cur: &Value, key: &str, v: Value) {
        if cur.get(key) != Some(&v) { m.insert(key.into(), v); }
    }
    set(&mut imp, cur_i, "launch_options", json!(cfg.args));
    if !cfg.process_priority.is_empty() { set(&mut imp, cur_i, "process_priority", json!(cfg.process_priority)); }
    if !cfg.window_mode.is_empty() { set(&mut imp, cur_i, "window_mode", json!(cfg.window_mode)); }
    for (k, v) in &cfg.extras {
        // only keys this importer has, with the same kind of value
        if let Some(old) = cur_i.get(k) {
            let same_kind = std::mem::discriminant(old) == std::mem::discriminant(v);
            if same_kind { set(&mut imp, cur_i, k, v.clone()); }
        }
    }
    let m = &cfg.migoto;
    let wanted: [(&str, Value); 7] = [
        ("enable_hunting", json!(m.hunting)), ("dump_shaders", json!(m.dump_shaders)), ("mute_warnings", json!(m.mute_warnings)),
        ("log_level", json!(m.log_level)), ("calls_logging", json!(m.calls_logging)), ("debug_logging", json!(m.debug_logging)),
        ("enforce_rendering", json!(m.enforce_rendering)),
    ];
    for (k, v) in wanted {
        if cur_m.get(k).is_none() || (k == "log_level" && m.log_level.is_empty()) { continue; }
        set(&mut mig, cur_m, k, v);
    }
    let mut out = serde_json::Map::new();
    if !imp.is_empty() { out.insert("Importer".into(), Value::Object(imp)); }
    if !mig.is_empty() { out.insert("Migoto".into(), Value::Object(mig)); }
    Value::Object(out)
}

/// Save the form. XXMI's fields go to XXMI's config (only what changed; XXMI must be closed for that), everything
/// else to gachamod's own setting. Returns the form as it now reads.
pub fn set_config(db: &Db, game: &str, cfg: &LaunchConfig) -> Result<LaunchConfig> {
    let g = games::require_def(game)?;
    let paths = games::paths(db, game)?;
    let root = db.setting("xxmi.root")?.filter(|s| !s.is_empty());
    if g.xxmi && paths.via_xxmi {
        if let Ok(current) = crate::xxmi::importer_config(root.as_deref(), g.importer) {
            let patch = xxmi_patch(cfg, &current);
            if patch.as_object().is_some_and(|o| !o.is_empty()) {
                crate::xxmi::set_importer_config(root.as_deref(), g.importer, &patch)?;
            }
        }
    } else if let Ok(importer) = games::importer_dir(db, game) {
        apply_migoto_to_d3dx(&importer, &cfg.migoto)?;
    }
    let mut own = cfg.clone();
    own.locked.clear();
    db.set_setting_json(&own_key(game), &own)?;
    db.set_setting(&format!("{game}.closeOnLaunch"), if cfg.close_on_launch { "1" } else { "0" })?;
    config(db, game)
}

/// For loaders outside XXMI: write the mod maker switches straight into d3dx.ini (backup first).
fn apply_migoto_to_d3dx(importer: &Path, m: &MigotoConfig) -> Result<()> {
    let ini = importer.join("d3dx.ini");
    let Ok(text) = std::fs::read_to_string(&ini) else { return Ok(()) };
    let prev = migoto_from_d3dx(&text);
    let mut out = text.clone();
    // only the switches the user changed, so a value written by hand stays as it was
    for (changed, sec, key, val) in [
        (m.hunting != prev.hunting, "Hunting", "hunting", if m.hunting { "2" } else { "0" }),
        (m.dump_shaders != prev.dump_shaders, "Hunting", "marking_actions", if m.dump_shaders { "clipboard hlsl asm regex" } else { "clipboard" }),
        (m.mute_warnings != prev.mute_warnings, "Logging", "show_warnings", if m.mute_warnings { "0" } else { "1" }),
        (m.calls_logging != prev.calls_logging, "Logging", "calls", if m.calls_logging { "1" } else { "0" }),
        (m.debug_logging != prev.debug_logging, "Logging", "debug", if m.debug_logging { "1" } else { "0" }),
    ] {
        if changed { out = ini_set(&out, sec, key, val); }
    }
    if out != text {
        let bak = importer.join("d3dx.ini.gachamod.bak");
        if !bak.exists() { std::fs::copy(&ini, &bak)?; }
        crate::xxmi::write_atomic(&ini, out.as_bytes())?;
    }
    Ok(())
}

/// Set `key = value` in `[section]` of an ini text, keeping every other line. Only changes an existing key, or adds it
/// at the end of an existing section; a missing section is left alone (3DMigoto's d3dx.ini always has them).
pub fn ini_set(text: &str, section: &str, key: &str, value: &str) -> String {
    let nl = if text.contains("\r\n") { "\r\n" } else { "\n" };
    let lines: Vec<&str> = text.split(nl).collect();
    let mut out: Vec<String> = Vec::with_capacity(lines.len() + 1);
    let mut in_sec = false;
    let mut done = false;
    let mut last_in_sec: Option<usize> = None;
    for line in &lines {
        let t = line.trim();
        if t.starts_with('[') {
            in_sec = t.trim_start_matches('[').trim_end_matches(']').trim().eq_ignore_ascii_case(section);
        } else if in_sec && !done && !t.starts_with(';') {
            if let Some((k, _)) = t.split_once('=') {
                if k.trim().eq_ignore_ascii_case(key) {
                    out.push(format!("{} = {value}", k.trim()));
                    done = true;
                    continue;
                }
            }
        }
        out.push(line.to_string());
        if in_sec && !t.is_empty() { last_in_sec = Some(out.len() - 1); }
    }
    if !done {
        if let Some(i) = last_in_sec { out.insert(i + 1, format!("{key} = {value}")); }
    }
    out.join(nl)
}

/// What a launch will do, worked out from the database (so the caller can drop its lock before starting anything:
/// an admin prompt can keep the start waiting).
#[derive(Debug, Clone)]
pub enum Plan {
    Xxmi { root: Option<String>, importer: &'static str },
    Direct { exe: PathBuf, args: String, dir: PathBuf, pre_launch: Option<(Hook, PathBuf)>, loader: Option<(PathBuf, PathBuf)> },
}

/// Start the game. `vanilla`: start without mods (direct exe, no injection).
pub fn launch(db: &Db, game: &str, vanilla: bool) -> Result<()> { start(plan(db, game, vanilla)?) }

pub fn plan(db: &Db, game: &str, vanilla: bool) -> Result<Plan> {
    let g = games::require_def(game)?;
    if running(game) { return Err(Error::Conflict(format!("{} is already running", g.name))); }
    let cfg = config(db, game)?;
    let paths = games::paths(db, game)?;
    if !vanilla && cfg.xxmi_available && cfg.via == "xxmi" {
        return Ok(Plan::Xxmi { root: db.setting("xxmi.root")?.filter(|s| !s.is_empty()), importer: g.importer });
    }
    let game_dir = paths.game_dir.map(PathBuf::from)
        .ok_or_else(|| Error::NotSetUp(format!("{}'s game folder isn't set. Pick it in Settings", g.name)))?;
    if !game_dir.exists() {
        return Err(Error::NotSetUp(format!("{}'s game folder is gone ({}). Pick it again in Settings", g.name, game_dir.display())));
    }
    let exe = match cfg.custom_exe.as_deref().filter(|s| !s.trim().is_empty()) {
        Some(c) => {
            let p = PathBuf::from(c.trim());
            let p = if p.is_absolute() { p } else { game_dir.join(p) };
            if !p.is_file() { return Err(Error::Invalid(format!("The custom exe isn't there: {}", p.display()))); }
            p
        }
        None => game_exe(g, &game_dir).ok_or_else(|| Error::NotSetUp(format!(
            "Couldn't find {} in {}. Pick the game folder again in Settings", g.exe_names.first().copied().unwrap_or("the game's exe"), game_dir.display())))?,
    };
    let pre_launch = (cfg.pre_launch.enabled && !cfg.pre_launch.command.trim().is_empty() && !cfg.locked.contains_key("preLaunch"))
        .then(|| (cfg.pre_launch.clone(), game_dir.clone()));
    // a community 3DMigoto loader waits for the game, so it starts first
    let loader = if !vanilla && !g.xxmi {
        games::importer_dir(db, game).ok().and_then(|i| find_loader(&i).map(|l| (l, i)))
    } else { None };
    let dir = exe.parent().map(Path::to_path_buf).unwrap_or(game_dir);
    Ok(Plan::Direct { exe, args: cfg.args.trim().to_string(), dir, pre_launch, loader })
}

pub fn start(plan: Plan) -> Result<()> {
    match plan {
        Plan::Xxmi { root, importer } => crate::xxmi::launch(root.as_deref(), importer),
        Plan::Direct { exe, args, dir, pre_launch, loader } => {
            if let Some((hook, at)) = pre_launch { run_hook(&hook, &at)?; }
            if let Some((l, at)) = loader { shell_start(&l, "", &at)?; }
            shell_start(&exe, &args, &dir)
        }
    }
}

/// The first of the game's exe names that exists in its folder.
pub fn game_exe(g: &GameDef, dir: &Path) -> Option<PathBuf> {
    g.exe_names.iter().map(|n| dir.join(n)).find(|p| p.is_file())
}

/// "3DMigoto Loader.exe" or another "*loader*.exe" in a community loader's folder.
fn find_loader(importer: &Path) -> Option<PathBuf> {
    let exact = importer.join("3DMigoto Loader.exe");
    if exact.is_file() { return Some(exact); }
    std::fs::read_dir(importer).ok()?.flatten().map(|e| e.path()).find(|p| {
        p.is_file() && p.file_name().is_some_and(|n| { let n = n.to_string_lossy().to_lowercase(); n.ends_with(".exe") && n.contains("loader") })
    })
}

fn run_hook(h: &Hook, dir: &Path) -> Result<()> {
    let mut cmd = std::process::Command::new("cmd");
    cmd.arg("/C").arg(h.command.trim()).current_dir(dir);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.spawn().map_err(|e| Error::Invalid(format!("The pre-launch command didn't start: {e}")))?;
    if h.wait { let _ = child.wait(); }
    Ok(())
}

/// Start an exe the way Explorer does, so one that needs admin shows the usual prompt instead of failing.
pub fn shell_start(file: &Path, params: &str, dir: &Path) -> Result<()> {
    if !file.is_file() { return Err(Error::NotSetUp(format!("{} isn't there anymore", file.display()))); }
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::Shell::ShellExecuteW;
        use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        let w = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
        let (op, f, p, d) = (w("open"), w(&file.to_string_lossy()), w(params), w(&dir.to_string_lossy()));
        // SAFETY: every pointer is a NUL-terminated UTF-16 buffer that lives until the call returns.
        let r = unsafe { ShellExecuteW(std::ptr::null_mut(), op.as_ptr(), f.as_ptr(), p.as_ptr(), d.as_ptr(), SW_SHOWNORMAL) } as isize;
        if r > 32 { return Ok(()); }
        let name = file.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        return Err(match r {
            2 | 3 => Error::NotSetUp(format!("Windows couldn't find {name}")),
            5 => Error::Invalid(format!("Windows didn't start {name}. If an admin prompt came up, allow it and try again")),
            8 => Error::Invalid("Windows is out of memory. Close some programs, then try again".into()),
            _ => Error::Invalid(format!("Windows couldn't start {name} (code {r})")),
        });
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new(file).args(params.split_whitespace()).current_dir(dir).spawn()?;
        Ok(())
    }
}

// ── processes ──

/// One running process.
#[derive(Debug, Clone)]
pub struct Proc { pub pid: u32, pub name: String }

/// Every running process (one Toolhelp snapshot, a few milliseconds).
pub fn processes() -> Vec<Proc> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
        use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
        let mut out = Vec::with_capacity(256);
        // SAFETY: plain Win32 calls; the entry is zeroed with its size set as the API requires, and the handle is closed.
        unsafe {
            let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snap == INVALID_HANDLE_VALUE || snap.is_null() { return out; }
            let mut e: PROCESSENTRY32W = std::mem::zeroed();
            e.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
            let mut ok = Process32FirstW(snap, &mut e);
            while ok != 0 {
                let len = e.szExeFile.iter().position(|&c| c == 0).unwrap_or(e.szExeFile.len());
                out.push(Proc { pid: e.th32ProcessID, name: String::from_utf16_lossy(&e.szExeFile[..len]) });
                ok = Process32NextW(snap, &mut e);
            }
            CloseHandle(snap);
        }
        out
    }
    #[cfg(not(windows))]
    { Vec::new() }
}

/// Exe names match without regard to case ("genshinimpact.EXE" is "GenshinImpact.exe").
pub fn name_matches(process: &str, wanted: &str) -> bool { process.eq_ignore_ascii_case(wanted) }

/// The ids of the game's processes in a snapshot.
pub fn game_pids(procs: &[Proc], game: &str) -> Vec<u32> {
    let Some(g) = games::def(game) else { return vec![] };
    procs.iter().filter(|p| g.process_names.iter().any(|n| name_matches(&p.name, n))).map(|p| p.pid).collect()
}

/// The games running in a snapshot.
pub fn running_in(procs: &[Proc]) -> Vec<&'static str> {
    games::GAMES.iter().filter(|g| procs.iter().any(|p| g.process_names.iter().any(|n| name_matches(&p.name, n)))).map(|g| g.id).collect()
}

/// Every game running now, from one snapshot.
pub fn running_games() -> Vec<&'static str> { running_in(&processes()) }

/// True while one of the game's processes runs.
/// In unit tests this is always false, so a game open on the PC running the tests can't change their results.
pub fn running(game: &str) -> bool {
    if cfg!(test) { return TEST_RUNNING.with(|r| r.get()); }
    !game_pids(&processes(), game).is_empty()
}

// Tests never look at the real processes: a game counts as running when a test on this thread says so.
thread_local! { pub(crate) static TEST_RUNNING: std::cell::Cell<bool> = const { std::cell::Cell::new(false) }; }

/// True while a process with this exe name runs (case-insensitive, e.g. "XXMI Launcher.exe"). One cheap process
/// snapshot; other areas use it to check for XXMI Launcher and IMM.
pub fn process_running(exe: &str) -> bool { !cfg!(test) && processes().iter().any(|p| name_matches(&p.name, exe)) }

#[cfg(test)]
mod tests {
    use super::*;

    fn p(pid: u32, name: &str) -> Proc { Proc { pid, name: name.into() } }

    #[test]
    fn matches_process_names_any_case() {
        let procs = vec![p(1, "explorer.exe"), p(20, "zenlesszonezero.EXE"), p(30, "Client-Win64-Shipping.exe"), p(31, "Wuthering Waves.exe")];
        assert_eq!(running_in(&procs), vec!["zzz", "ww"]);
        assert_eq!(game_pids(&procs, "zzz"), vec![20]);
        assert_eq!(game_pids(&procs, "ww"), vec![30]);
        assert!(game_pids(&procs, "gi").is_empty());
        assert!(name_matches("XXMI LAUNCHER.exe", "XXMI Launcher.exe"));
        assert!(!name_matches("XXMI Launcher2.exe", "XXMI Launcher.exe"));
    }

    #[test]
    fn snapshot_is_quick_and_sees_itself() {
        let t = std::time::Instant::now();
        let procs = processes();
        if cfg!(windows) {
            // generous: other test threads and a busy PC share this time (a snapshot alone takes a few ms)
            assert!(t.elapsed().as_millis() < 1500, "took {:?}", t.elapsed());
            let me = std::process::id();
            assert!(procs.iter().any(|p| p.pid == me));
        }
    }

    #[test]
    fn reads_xxmi_fields_and_locks_what_it_cannot_change() {
        let x = json!({
            "Importer": { "launch_options": "-SkipSplash", "process_priority": "NORMAL", "window_mode": "BORDERLESS",
                "run_pre_launch_enabled": false, "run_pre_launch": "", "run_pre_launch_wait": true,
                "unlock_fps": false, "disable_wounded_fx": true, "resource_tier": "HD", "launch_count": 6 },
            "Migoto": { "enforce_rendering": true, "enable_hunting": false, "dump_shaders": false, "mute_warnings": true, "log_level": "DISABLED" }
        });
        let c = merge_config(LaunchConfig::default(), Some(&x), true);
        assert_eq!(c.via, "xxmi");
        assert_eq!(c.args, "-SkipSplash");
        assert!(c.close_on_launch && c.xxmi_available);
        assert_eq!(c.extras.len(), 3);
        assert_eq!(c.extras["resource_tier"], json!("HD"));
        assert!(c.locked.contains_key("migoto.callsLogging"));
        assert!(c.locked.contains_key("preLaunch"));
        assert!(!c.locked.contains_key("migoto.hunting"));

        // only what changed goes back, and only keys XXMI has
        let mut want = c.clone();
        want.extras.insert("unlock_fps".into(), json!(true));
        want.extras.insert("made_up".into(), json!(1));
        want.migoto.hunting = true;
        want.migoto.calls_logging = true;
        let patch = xxmi_patch(&want, &x);
        assert_eq!(patch, json!({ "Importer": { "unlock_fps": true }, "Migoto": { "enable_hunting": true } }));
        assert_eq!(xxmi_patch(&c, &x), json!({}));

        let direct = merge_config(LaunchConfig { via: "xxmi".into(), ..Default::default() }, None, false);
        assert_eq!(direct.via, "direct");
        assert!(direct.extras.is_empty());
    }

    #[test]
    fn sets_ini_keys_in_place() {
        let text = "; top\r\n[Logging]\r\ncalls = 0\r\n; note\r\ndebug=0\r\n\r\n[Hunting]\r\nhunting = 0\r\n";
        let a = ini_set(text, "logging", "Calls", "1");
        assert_eq!(a, "; top\r\n[Logging]\r\ncalls = 1\r\n; note\r\ndebug=0\r\n\r\n[Hunting]\r\nhunting = 0\r\n");
        let b = ini_set(&a, "Hunting", "marking_actions", "clipboard");
        assert!(b.contains("hunting = 0\r\nmarking_actions = clipboard\r\n"));
        assert_eq!(ini_set(&b, "Nope", "x", "1"), b);
        assert_eq!(ini_get(&b, "LOGGING", "debug").as_deref(), Some("0"));
        let m = migoto_from_d3dx(&b);
        assert!(m.calls_logging && !m.debug_logging && !m.hunting);
        // texture_hash differs per game, so a plain d3dx.ini never reports enforce_rendering
        assert!(!migoto_from_d3dx("[Rendering]\ntexture_hash = 1\n").enforce_rendering);
    }
}
