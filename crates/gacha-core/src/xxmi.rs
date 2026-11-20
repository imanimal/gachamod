//! XXMI Launcher: finding it, reading and writing its config, and starting games through it. Owner: SYSTEM area
//! (docs/spec.md, "XXMI").
//!
//! XXMI Launcher is portable under %APPDATA%\XXMI Launcher: `Resources\Bin\XXMI Launcher.exe`, the config
//! `XXMI Launcher Config.json`, one folder per importer (GIMI, SRMI, ZZMI, WWMI, HIMI, EFMI) with d3dx.ini and Mods.
//! Config keys: Launcher.enabled_importers, Launcher.active_importer, Packages.packages.<CODE>.{deployed_version,
//! latest_version}, Importers.<CODE>.Importer.{game_folder, importer_folder, launch_options, process_priority,
//! window_mode, run_pre_launch*, run_post_load*, custom_launch*, unlock_fps ...}, Importers.<CODE>.Migoto.{
//! enable_hunting, dump_shaders, mute_warnings, log_level, enforce_rendering ...}.
//! Writes keep every other key, its order and the file's indentation, back the file up once per app session
//! (`XXMI Launcher Config.json.gachamod.bak`), and refuse while XXMI Launcher runs (it rewrites the file on exit).

use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const CONFIG_FILE: &str = "XXMI Launcher Config.json";
pub const EXE_NAME: &str = "XXMI Launcher.exe";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImporterInfo {
    pub code: String,
    /// The gachamod game id this importer serves.
    pub game: Option<String>,
    pub enabled: bool,
    pub deployed_version: Option<String>,
    pub latest_version: Option<String>,
    pub game_folder: Option<String>,
    pub importer_dir: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct XxmiStatus {
    pub found: bool,
    pub root: Option<String>,
    pub exe: Option<String>,
    pub config: Option<String>,
    pub version: Option<String>,
    pub latest: Option<String>,
    pub running: bool,
    pub importers: Vec<ImporterInfo>,
}

/// The gachamod game id for an XXMI importer code.
pub fn game_for_code(code: &str) -> Option<&'static str> {
    crate::games::GAMES.iter().find(|g| g.xxmi && g.importer.eq_ignore_ascii_case(code)).map(|g| g.id)
}

pub fn default_root() -> Option<PathBuf> { std::env::var_os("APPDATA").map(|a| PathBuf::from(a).join("XXMI Launcher")) }

/// XXMI's folder: a folder the user set (setting "xxmi.root") when it holds XXMI, else %APPDATA%\XXMI Launcher when
/// its config is there.
pub fn find_root(custom: Option<&str>) -> Option<PathBuf> {
    let looks_right = |p: &Path| p.join(CONFIG_FILE).is_file() || p.join("Resources").join("Bin").join(EXE_NAME).is_file();
    if let Some(c) = custom.map(str::trim).filter(|c| !c.is_empty()) {
        let p = PathBuf::from(c);
        if looks_right(&p) { return Some(p); }
        // the user may have picked Resources\Bin or the exe itself
        for up in p.ancestors().skip(1).take(3) {
            if up.join(CONFIG_FILE).is_file() { return Some(up.to_path_buf()); }
        }
    }
    default_root().filter(|p| looks_right(p))
}

fn exe_path(root: &Path) -> PathBuf { root.join("Resources").join("Bin").join(EXE_NAME) }

fn require_root(custom: Option<&str>) -> Result<PathBuf> {
    find_root(custom).ok_or_else(|| Error::NotSetUp(
        "XXMI Launcher isn't installed. Get it from GitHub, or pick the folder in Settings".into()))
}

// The parsed config, cached by file time: `games::list` asks for versions often.
static CACHE: Mutex<Option<(PathBuf, std::time::SystemTime, Value)>> = Mutex::new(None);

fn read_config(path: &Path) -> Result<Value> {
    let mtime = std::fs::metadata(path)?.modified()?;
    if let Ok(c) = CACHE.lock() {
        if let Some((p, t, v)) = c.as_ref() { if p == path && *t == mtime { return Ok(v.clone()); } }
    }
    let text = std::fs::read_to_string(path)?;
    let v: Value = serde_json::from_str(text.trim_start_matches('\u{feff}'))
        .map_err(|e| Error::Invalid(format!("XXMI Launcher's settings file couldn't be read ({e}). Open XXMI Launcher once to repair it")))?;
    if let Ok(mut c) = CACHE.lock() { *c = Some((path.to_path_buf(), mtime, v.clone())); }
    Ok(v)
}

fn text_opt(v: &Value) -> Option<String> { v.as_str().map(str::trim).filter(|s| !s.is_empty()).map(String::from) }

/// What XXMI's config says, as `status` reports it (pure, for tests).
pub fn status_from(root: &Path, cfg: &Value) -> XxmiStatus {
    let pk = &cfg["Packages"]["packages"];
    let enabled: Vec<String> = cfg["Launcher"]["enabled_importers"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
    let mut importers = Vec::new();
    if let Some(map) = cfg["Importers"].as_object() {
        for (code, block) in map {
            let imp = &block["Importer"];
            let folder = imp["importer_folder"].as_str().map(|s| s.trim_end_matches(['/', '\\'])).filter(|s| !s.is_empty()).unwrap_or(code);
            let dir = { let p = PathBuf::from(folder); if p.is_absolute() { p } else { root.join(p) } };
            importers.push(ImporterInfo {
                code: code.clone(),
                game: game_for_code(code).map(String::from),
                enabled: enabled.iter().any(|e| e.eq_ignore_ascii_case(code)),
                deployed_version: text_opt(&pk[code]["deployed_version"]),
                latest_version: text_opt(&pk[code]["latest_version"]),
                game_folder: text_opt(&imp["game_folder"]),
                importer_dir: Some(dir.to_string_lossy().into_owned()),
            });
        }
    }
    XxmiStatus {
        found: true,
        root: Some(root.to_string_lossy().into_owned()),
        exe: Some(exe_path(root)).filter(|p| p.is_file()).map(|p| p.to_string_lossy().into_owned()),
        config: Some(root.join(CONFIG_FILE).to_string_lossy().into_owned()),
        version: text_opt(&pk["Launcher"]["deployed_version"]),
        latest: text_opt(&pk["Launcher"]["latest_version"]),
        running: false,
        importers,
    }
}

pub fn status(custom_root: Option<&str>) -> Result<XxmiStatus> {
    let Some(root) = find_root(custom_root) else { return Ok(XxmiStatus::default()) };
    let cfg_path = root.join(CONFIG_FILE);
    let mut st = match read_config(&cfg_path) {
        Ok(cfg) => status_from(&root, &cfg),
        Err(_) => XxmiStatus {
            found: true, root: Some(root.to_string_lossy().into_owned()),
            exe: Some(exe_path(&root)).filter(|p| p.is_file()).map(|p| p.to_string_lossy().into_owned()),
            ..Default::default()
        },
    };
    st.running = crate::launch::process_running(EXE_NAME);
    Ok(st)
}

/// Versions and folders from XXMI's config (cached by file time), without checking whether XXMI runs.
pub fn status_cached(custom_root: Option<&str>) -> Option<XxmiStatus> {
    let root = find_root(custom_root)?;
    read_config(&root.join(CONFIG_FILE)).ok().map(|cfg| status_from(&root, &cfg))
}

/// One value of an importer's own settings (`Importers.<CODE>.Importer.<key>`, e.g. "window_mode"), as text.
pub fn importer_setting(custom_root: Option<&str>, code: &str, key: &str) -> Option<String> {
    let root = find_root(custom_root)?;
    let cfg = read_config(&root.join(CONFIG_FILE)).ok()?;
    let block = cfg["Importers"].as_object()?.iter().find(|(c, _)| c.eq_ignore_ascii_case(code)).map(|(_, b)| b)?;
    match &block["Importer"][key] {
        Value::String(s) => Some(s.trim().to_string()).filter(|s| !s.is_empty()),
        Value::Null => None,
        v => Some(v.to_string()),
    }
}

/// Start a game with mods through XXMI Launcher (no GUI). `importer` is the code, e.g. "ZZMI".
pub fn launch(custom_root: Option<&str>, importer: &str) -> Result<()> {
    let root = require_root(custom_root)?;
    let exe = exe_path(&root);
    if !exe.is_file() { return Err(Error::NotSetUp("XXMI Launcher's exe is missing. Reinstall XXMI Launcher, or pick the folder in Settings".into())); }
    let bin = root.join("Resources").join("Bin");
    crate::launch::shell_start(&exe, &format!("--nogui --xxmi {importer}"), &bin)
}

/// XXMI starts `code`'s game by running its exe (its Game Launch setting is "Direct", the default).
pub fn starts_exe(custom_root: Option<&str>, code: &str) -> bool {
    importer_config(custom_root, code).is_ok_and(|c| matches!(c["Importer"]["game_launch"].as_str(), None | Some("DIRECT")))
}

/// XXMI waits at least this long (seconds) for a game it starts through Steam. Its wait starts when it asks Steam, and
/// a Steam that is restarting or running a game's first-time setup takes longer than XXMI's default 30.
const STEAM_PROCESS_TIMEOUT: u64 = 90;

/// Set XXMI's Game Launch for `code` to Steam, for a game whose Steam copy only starts from Steam, and raise its wait
/// for the game to STEAM_PROCESS_TIMEOUT (only at this switch, so a value set later in XXMI stays). An XXMI from
/// before it could start games through Steam has no Steam launch options in its config.
pub fn launch_through_steam(custom_root: Option<&str>, code: &str) -> Result<()> {
    let cur = importer_config(custom_root, code)?;
    if cur["Importer"].get("configure_platform_launch_options").is_none() {
        return Err(Error::NotSetUp("This XXMI Launcher can't start Steam games. Open XXMI Launcher once so it updates, then try again".into()));
    }
    let mut patch = serde_json::json!({ "Importer": { "game_launch": "STEAM" } });
    if cur["Importer"]["process_timeout"].as_u64().is_some_and(|t| t < STEAM_PROCESS_TIMEOUT) {
        patch["Importer"]["process_timeout"] = STEAM_PROCESS_TIMEOUT.into();
    }
    set_importer_config(custom_root, code, &patch)
}

/// The Steam launch options XXMI Launcher writes for `code`'s game (Steam app `app`) before it starts it through
/// Steam, or None when it leaves them alone. XXMI restarts Steam whenever Steam has other ones, so this must match
/// what it builds exactly.
pub fn steam_launch_options(custom_root: Option<&str>, code: &str, app: u32) -> Option<String> {
    let root = find_root(custom_root)?;
    let cfg = read_config(&root.join(CONFIG_FILE)).ok()?;
    let imp = &cfg["Importers"][code]["Importer"];
    let version = cfg["Packages"]["packages"]["Launcher"]["deployed_version"].as_str().unwrap_or_default();
    let fallback = game_for_code(code).and_then(crate::games::def).map(|g| g.exe_names).unwrap_or_default();
    let exe = crate::steam::app_dir(app).and_then(|d| steam_game_exe(&d, imp, fallback)).map(|e| python_resolve(&e));
    steam_options(code, imp, version, exe.as_deref())
}

/// XXMI's `build_cmd_args` for a Steam start (core/game_launcher.py): `"<game exe>" && %command%` when it skips the
/// game's own launcher, then `d3d11_mode_cmd_args` when set, then `launch_options` when `use_launch_options` is on (an
/// empty one still adds its space). Before 2.4.4 XXMI turned `\` into `/` in launch_options; WWMI gets the exe part
/// from 2.5.0 and EFMI from 2.4.8. Missing keys take XXMI's defaults.
pub fn steam_options(code: &str, imp: &Value, version: &str, exe: Option<&str>) -> Option<String> {
    let flag = |k: &str| imp[k].as_bool().unwrap_or(true);
    if !flag("configure_platform_launch_options") { return None; }
    let at_least = |want: [u32; 3]| version_parts(version).is_none_or(|v| v >= want);
    let skip = flag("skip_platform_game_launcher");
    let exe_part = match code {
        "ZZMI" => skip,
        "WWMI" => skip && at_least([2, 5, 0]),
        "EFMI" => at_least([2, 4, 8]),
        _ => false,
    };
    let mut parts = Vec::new();
    if let Some(e) = exe.filter(|_| exe_part) { parts.push(format!("\"{e}\" && %command%")); }
    if let Some(d) = imp["d3d11_mode_cmd_args"].as_str().filter(|d| !d.is_empty()) { parts.push(d.to_string()); }
    if flag("use_launch_options") {
        let o = imp["launch_options"].as_str().unwrap_or_default();
        parts.push(if at_least([2, 4, 4]) { o.to_string() } else { o.replace('\\', "/") });
    }
    Some(parts.join(" "))
}

/// "2.4.1" as [2, 4, 1].
fn version_parts(v: &str) -> Option<[u32; 3]> {
    let mut it = v.trim().trim_start_matches('v').split('.').map(|p| p.parse::<u32>().ok());
    Some([it.next()??, it.next().flatten().unwrap_or(0), it.next().flatten().unwrap_or(0)])
}

/// The game exe XXMI finds in a Steam install folder (validate_game_exe_path): for each name in process_exe_names (or
/// game_exe_names), the file right in the folder, then under process_exe_rel_paths, then the only copy anywhere below.
/// Two copies below and it gives up.
fn steam_game_exe(dir: &Path, imp: &Value, fallback: &[&str]) -> Option<PathBuf> {
    let list = |k: &str| imp[k].as_array().map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect::<Vec<_>>()).unwrap_or_default();
    let mut names = list("process_exe_names");
    if names.is_empty() { names = list("game_exe_names"); }
    if names.is_empty() { names = fallback.iter().map(|n| n.to_string()).collect(); }
    for name in &names {
        let here = dir.join(name);
        if here.is_file() { return Some(here); }
        if let Some(p) = list("process_exe_rel_paths").iter().map(|r| dir.join(r).join(name)).find(|p| p.is_file()) { return Some(p); }
        let found: Vec<PathBuf> = walkdir::WalkDir::new(dir).min_depth(1).into_iter().flatten()
            .filter(|e| e.file_name().to_string_lossy().eq_ignore_ascii_case(name)).map(|e| e.into_path()).take(2).collect();
        match found.as_slice() {
            [one] if one.is_file() => return Some(one.clone()),
            [_, _] => return None,
            _ => {}
        }
    }
    None
}

/// A path as Python's `Path.resolve()` prints it on Windows: links followed, each name as the disk spells it, no
/// `\\?\` prefix.
fn python_resolve(p: &Path) -> String {
    let Ok(full) = std::fs::canonicalize(p) else { return p.display().to_string() };
    let s = full.to_string_lossy();
    match s.strip_prefix(r"\\?\UNC\") {
        Some(rest) => format!(r"\\{rest}"),
        None => s.strip_prefix(r"\\?\").unwrap_or(&s).to_string(),
    }
}

/// Read `Importers.<code>` as JSON (both Importer and Migoto blocks).
pub fn importer_config(custom_root: Option<&str>, code: &str) -> Result<Value> {
    let root = require_root(custom_root)?;
    let cfg = read_config(&root.join(CONFIG_FILE))?;
    match &cfg["Importers"][code] {
        Value::Null => Err(Error::NotSetUp(format!("XXMI Launcher has no {code} settings yet. Open XXMI Launcher and install {code} first"))),
        v => Ok(v.clone()),
    }
}

/// Merge `patch` into `Importers.<code>` (keys under "Importer" and "Migoto"), after a backup.
pub fn set_importer_config(custom_root: Option<&str>, code: &str, patch: &Value) -> Result<()> {
    let root = require_root(custom_root)?;
    if crate::launch::process_running(EXE_NAME) {
        return Err(Error::Conflict("Close XXMI Launcher first, it saves the settings when it closes".into()));
    }
    write_patch(&root.join(CONFIG_FILE), code, patch)
}

/// Apply a patch to the config file at `path`: back up once per session, keep everything else, write atomically.
pub fn write_patch(path: &Path, code: &str, patch: &Value) -> Result<()> {
    let text = std::fs::read_to_string(path)?;
    let out = patch_text(&text, code, patch)?;
    if out == text { return Ok(()); }
    backup_once(path)?;
    write_atomic(path, out.as_bytes())?;
    if let Ok(mut c) = CACHE.lock() { *c = None; }
    Ok(())
}

/// Set values anywhere in the config (each a key path and a value), keeping everything else as XXMI wrote it.
pub fn set_paths_text(text: &str, sets: &[(Vec<&str>, Value)]) -> Result<String> {
    let bom = text.starts_with('\u{feff}');
    let body = text.trim_start_matches('\u{feff}');
    let mut doc = ojson::parse(body).map_err(|e| Error::Invalid(format!("XXMI Launcher's settings file couldn't be read ({e})")))?;
    let style = ojson::Style::detect(body);
    for (path, v) in sets { doc.set(path, v, style.ascii); }
    let mut out = String::with_capacity(text.len() + 64);
    if bom { out.push('\u{feff}'); }
    out.push_str(&doc.write(&style));
    Ok(out)
}

/// `set_paths_text` on the file at `path`: backed up once per session, written atomically.
pub fn write_paths(path: &Path, sets: &[(Vec<&str>, Value)]) -> Result<()> {
    let text = std::fs::read_to_string(path)?;
    let out = set_paths_text(&text, sets)?;
    if out == text { return Ok(()); }
    backup_once(path)?;
    write_atomic(path, out.as_bytes())?;
    if let Ok(mut c) = CACHE.lock() { *c = None; }
    Ok(())
}

/// The config text with `patch` merged into `Importers.<code>`, formatted like the original.
pub fn patch_text(text: &str, code: &str, patch: &Value) -> Result<String> {
    let bom = text.starts_with('\u{feff}');
    let body = text.trim_start_matches('\u{feff}');
    let mut doc = ojson::parse(body).map_err(|e| Error::Invalid(format!("XXMI Launcher's settings file couldn't be read ({e})")))?;
    let style = ojson::Style::detect(body);
    let Some(obj) = patch.as_object() else { return Err(Error::Invalid("Nothing to change".into())) };
    for (block, fields) in obj {
        let Some(fields) = fields.as_object() else { continue };
        for (k, v) in fields {
            doc.set(&["Importers", code, block, k], v, style.ascii);
        }
    }
    let mut out = String::with_capacity(text.len() + 64);
    if bom { out.push('\u{feff}'); }
    out.push_str(&doc.write(&style));
    Ok(out)
}

static BACKED_UP: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());

/// Copy `path` to `<name>.gachamod.bak` before its first write in this app session.
pub(crate) fn backup_once(path: &Path) -> Result<()> {
    let mut done = BACKED_UP.lock().map_err(|_| Error::Invalid("Backup state is unavailable. Restart gachamod".into()))?;
    if done.iter().any(|p| p == path) { return Ok(()); }
    let mut name = path.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    name.push(".gachamod.bak");
    std::fs::copy(path, path.with_file_name(name))?;
    done.push(path.to_path_buf());
    Ok(())
}

/// Write a file through a temporary file in the same folder and a rename, so a crash never leaves half a file.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut tmp_name = path.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    tmp_name.push(".gachamod-tmp");
    let tmp = path.with_file_name(tmp_name);
    std::fs::write(&tmp, bytes)?;
    if let Err(e) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e.into());
    }
    Ok(())
}

/// Open the XXMI Launcher window.
pub fn open(custom_root: Option<&str>) -> Result<()> {
    let root = require_root(custom_root)?;
    let exe = exe_path(&root);
    crate::launch::shell_start(&exe, "", &root.join("Resources").join("Bin"))
}

/// JSON that keeps the original text of every value it doesn't change: key order, number formats and string escapes
/// stay exactly as XXMI (Python's json module) wrote them.
mod ojson {
    use serde_json::Value;

    #[derive(Debug, Clone)]
    pub enum Node {
        /// (raw key text with quotes, decoded key, value)
        Obj(Vec<(String, String, Node)>),
        Arr(Vec<Node>),
        /// A scalar's exact source text.
        Raw(String),
    }

    pub struct Style { pub indent: String, pub newline: &'static str, pub trailing_newline: bool, pub ascii: bool }

    impl Style {
        pub fn detect(text: &str) -> Style {
            let newline = if text.contains("\r\n") { "\r\n" } else { "\n" };
            let indent = text.lines().nth(1).map(|l| l.chars().take_while(|c| *c == ' ' || *c == '\t').collect::<String>())
                .filter(|s| !s.is_empty()).unwrap_or_else(|| "    ".into());
            Style { indent, newline, trailing_newline: text.ends_with('\n'), ascii: text.is_ascii() }
        }
    }

    pub fn parse(text: &str) -> Result<Node, String> {
        let b = text.as_bytes();
        let mut i = 0;
        let n = value(b, &mut i)?;
        ws(b, &mut i);
        if i != b.len() { return Err(format!("extra text at byte {i}")); }
        Ok(n)
    }

    fn ws(b: &[u8], i: &mut usize) { while *i < b.len() && b[*i].is_ascii_whitespace() { *i += 1; } }

    fn string(b: &[u8], i: &mut usize) -> Result<String, String> {
        let start = *i;
        *i += 1;
        while *i < b.len() {
            match b[*i] { b'\\' => *i += 2, b'"' => { *i += 1; return Ok(String::from_utf8_lossy(&b[start..*i]).into_owned()); } _ => *i += 1 }
        }
        Err("unclosed string".into())
    }

    fn value(b: &[u8], i: &mut usize) -> Result<Node, String> {
        ws(b, i);
        match b.get(*i) {
            Some(b'{') => {
                *i += 1;
                let mut items = Vec::new();
                ws(b, i);
                if b.get(*i) == Some(&b'}') { *i += 1; return Ok(Node::Obj(items)); }
                loop {
                    ws(b, i);
                    if b.get(*i) != Some(&b'"') { return Err(format!("expected a key at byte {i}")); }
                    let raw = string(b, i)?;
                    let key: String = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
                    ws(b, i);
                    if b.get(*i) != Some(&b':') { return Err(format!("expected ':' at byte {i}")); }
                    *i += 1;
                    let v = value(b, i)?;
                    items.push((raw, key, v));
                    ws(b, i);
                    match b.get(*i) { Some(b',') => *i += 1, Some(b'}') => { *i += 1; return Ok(Node::Obj(items)); } _ => return Err(format!("expected ',' or '}}' at byte {i}")) }
                }
            }
            Some(b'[') => {
                *i += 1;
                let mut items = Vec::new();
                ws(b, i);
                if b.get(*i) == Some(&b']') { *i += 1; return Ok(Node::Arr(items)); }
                loop {
                    items.push(value(b, i)?);
                    ws(b, i);
                    match b.get(*i) { Some(b',') => *i += 1, Some(b']') => { *i += 1; return Ok(Node::Arr(items)); } _ => return Err(format!("expected ',' or ']' at byte {i}")) }
                }
            }
            Some(b'"') => Ok(Node::Raw(string(b, i)?)),
            Some(_) => {
                let start = *i;
                while *i < b.len() && !matches!(b[*i], b',' | b'}' | b']') && !b[*i].is_ascii_whitespace() { *i += 1; }
                if start == *i { return Err(format!("expected a value at byte {start}")); }
                Ok(Node::Raw(String::from_utf8_lossy(&b[start..*i]).into_owned()))
            }
            None => Err("unexpected end".into()),
        }
    }

    fn quote(s: &str, ascii: bool) -> String {
        let json = serde_json::to_string(s).unwrap_or_else(|_| "\"\"".into());
        if !ascii { return json; }
        let mut out = String::with_capacity(json.len());
        for c in json.chars() {
            if c.is_ascii() { out.push(c); } else {
                let mut buf = [0u16; 2];
                for u in c.encode_utf16(&mut buf) { out.push_str(&format!("\\u{u:04x}")); }
            }
        }
        out
    }

    pub fn from_value(v: &Value, ascii: bool) -> Node {
        match v {
            Value::Object(m) => Node::Obj(m.iter().map(|(k, v)| (quote(k, ascii), k.clone(), from_value(v, ascii))).collect()),
            Value::Array(a) => Node::Arr(a.iter().map(|v| from_value(v, ascii)).collect()),
            Value::String(s) => Node::Raw(quote(s, ascii)),
            other => Node::Raw(other.to_string()),
        }
    }

    impl Node {
        /// Set the value at a path of keys, creating objects on the way.
        pub fn set(&mut self, path: &[&str], v: &Value, ascii: bool) {
            let Some((first, rest)) = path.split_first() else { *self = from_value(v, ascii); return };
            if !matches!(self, Node::Obj(_)) { *self = Node::Obj(Vec::new()); }
            let Node::Obj(items) = self else { return };
            match items.iter_mut().find(|(_, k, _)| k == first) {
                Some((_, _, child)) => child.set(rest, v, ascii),
                None => {
                    let mut child = Node::Obj(Vec::new());
                    child.set(rest, v, ascii);
                    items.push((quote(first, ascii), first.to_string(), child));
                }
            }
        }

        pub fn write(&self, st: &Style) -> String {
            let mut out = String::new();
            self.put(&mut out, st, 0);
            if st.trailing_newline { out.push_str(st.newline); }
            out
        }

        fn put(&self, out: &mut String, st: &Style, depth: usize) {
            let pad = |out: &mut String, d: usize| { out.push_str(st.newline); for _ in 0..d { out.push_str(&st.indent); } };
            match self {
                Node::Raw(s) => out.push_str(s),
                Node::Obj(items) if items.is_empty() => out.push_str("{}"),
                Node::Arr(items) if items.is_empty() => out.push_str("[]"),
                Node::Obj(items) => {
                    out.push('{');
                    for (n, (raw, _, v)) in items.iter().enumerate() {
                        if n > 0 { out.push(','); }
                        pad(out, depth + 1);
                        out.push_str(raw);
                        out.push_str(": ");
                        v.put(out, st, depth + 1);
                    }
                    pad(out, depth);
                    out.push('}');
                }
                Node::Arr(items) => {
                    out.push('[');
                    for (n, v) in items.iter().enumerate() {
                        if n > 0 { out.push(','); }
                        pad(out, depth + 1);
                        v.put(out, st, depth + 1);
                    }
                    pad(out, depth);
                    out.push(']');
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // A trimmed copy of a real config (paths use "Player"), written the way XXMI writes it: 4 spaces, Python escapes.
    const FIXTURE: &str = r###"{
    "Launcher": {
        "auto_update": true,
        "active_importer": "ZZMI",
        "enabled_importers": [
            "ZZMI",
            "WWMI"
        ],
        "start_timeout": 30,
        "proxy": {
            "enable": false,
            "port": ""
        },
        "locale": "EN"
    },
    "Packages": {
        "packages": {
            "Launcher": {
                "latest_version": "2.4.1",
                "deployed_version": "2.4.1",
                "latest_release_notes": "## Additions\r\n* **[Launcher]:** \u00e9 \"quoted\""
            },
            "ZZMI": {
                "latest_version": "1.5.0",
                "deployed_version": "1.4.1",
                "update_check_time": 1791272545
            },
            "SRMI": {
                "latest_version": "",
                "deployed_version": ""
            }
        }
    },
    "Importers": {
        "ZZMI": {
            "Importer": {
                "game_exe_names": [
                    "ZenlessZoneZero.exe",
                    "ZenlessZoneZeroBeta.exe"
                ],
                "process_exe_names": [],
                "importer_folder": "ZZMI/",
                "game_folder": "C:\\Program Files\\HoYoPlay\\games\\ZenlessZoneZero Game",
                "xxmi_dll_init_delay": 0,
                "d3dx_ini": {
                    "core": {
                        "Loader": {
                            "loader": "XXMI Launcher.exe"
                        }
                    }
                },
                "launch_options": "",
                "zz_unknown_float": 1.50
            },
            "Migoto": {
                "enable_hunting": false,
                "log_level": "DISABLED"
            }
        },
        "SRMI": {
            "Importer": {
                "importer_folder": "SRMI/",
                "game_folder": ""
            },
            "Migoto": {}
        }
    },
    "Security": {
        "user_signature": "MGUCMQ=="
    }
}"###;

    #[test]
    fn untouched_config_round_trips_byte_for_byte() {
        let doc = ojson::parse(FIXTURE).unwrap();
        assert_eq!(doc.write(&ojson::Style::detect(FIXTURE)), FIXTURE);
        let crlf = FIXTURE.replace('\n', "\r\n") + "\r\n";
        let doc = ojson::parse(&crlf).unwrap();
        assert_eq!(doc.write(&ojson::Style::detect(&crlf)), crlf);
    }

    #[test]
    fn patch_changes_values_and_keeps_the_rest() {
        let out = patch_text(FIXTURE, "ZZMI", &json!({
            "Importer": { "launch_options": "-popupwindow", "brand_new": "Ü" },
            "Migoto": { "enable_hunting": true }
        })).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["Importers"]["ZZMI"]["Importer"]["launch_options"], "-popupwindow");
        assert_eq!(v["Importers"]["ZZMI"]["Importer"]["brand_new"], "Ü");
        assert_eq!(v["Importers"]["ZZMI"]["Migoto"]["enable_hunting"], true);
        // unknown fields, their text and order stay
        assert!(out.contains("\"zz_unknown_float\": 1.50"));
        assert!(out.contains("\\u00e9 \\\"quoted\\\""));
        assert!(out.contains("\"brand_new\": \"\\u00dc\""), "ASCII-only files stay ASCII");
        assert!(out.find("\"Launcher\"").unwrap() < out.find("\"Packages\"").unwrap());
        assert!(out.contains("\n        \"ZZMI\": {\n            \"Importer\": {\n                \"game_exe_names\": [\n                    \"ZenlessZoneZero.exe\","));
        assert!(out.contains("\"process_exe_names\": [],"));
        assert_eq!(out.lines().count(), FIXTURE.lines().count() + 1);
        assert_eq!(v["Security"]["user_signature"], "MGUCMQ==");
    }

    #[test]
    fn two_space_files_stay_two_space() {
        let two = "{\n  \"Importers\": {\n    \"GIMI\": {\n      \"Importer\": {\n        \"unlock_fps\": false\n      }\n    }\n  }\n}\n";
        let out = patch_text(two, "GIMI", &json!({ "Importer": { "unlock_fps": true } })).unwrap();
        assert_eq!(out, two.replace("false", "true"));
    }

    #[test]
    fn status_reads_versions_and_folders() {
        let root = PathBuf::from(r"C:\Users\Player\AppData\Roaming\XXMI Launcher");
        let cfg: Value = serde_json::from_str(FIXTURE).unwrap();
        let st = status_from(&root, &cfg);
        assert_eq!(st.version.as_deref(), Some("2.4.1"));
        let zz = st.importers.iter().find(|i| i.code == "ZZMI").unwrap();
        assert_eq!(zz.game.as_deref(), Some("zzz"));
        assert!(zz.enabled);
        assert_eq!(zz.deployed_version.as_deref(), Some("1.4.1"));
        assert_eq!(zz.latest_version.as_deref(), Some("1.5.0"));
        assert_eq!(zz.importer_dir.as_deref(), Some(root.join("ZZMI").to_string_lossy().as_ref()));
        let sr = st.importers.iter().find(|i| i.code == "SRMI").unwrap();
        assert!(!sr.enabled && sr.game_folder.is_none() && sr.deployed_version.is_none());
    }

    #[test]
    fn writes_with_one_backup_and_atomically() {
        let dir = std::env::temp_dir().join(format!("gachamod-xxmi-test-{}-{}", std::process::id(), crate::db::now()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(CONFIG_FILE);
        std::fs::write(&path, FIXTURE).unwrap();
        write_patch(&path, "ZZMI", &json!({ "Importer": { "launch_options": "-a" } })).unwrap();
        write_patch(&path, "ZZMI", &json!({ "Importer": { "launch_options": "-b" } })).unwrap();
        let bak = dir.join(format!("{CONFIG_FILE}.gachamod.bak"));
        assert_eq!(std::fs::read_to_string(&bak).unwrap(), FIXTURE, "the backup is the original, taken once");
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(v["Importers"]["ZZMI"]["Importer"]["launch_options"], "-b");
        assert!(!dir.join(format!("{CONFIG_FILE}.gachamod-tmp")).exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn builds_steam_launch_options_like_xxmi() {
        let exe = Some(r"D:\SteamLibrary\steamapps\common\ZenlessZoneZero\ZenlessZoneZero.exe");
        let defaults = json!({ "launch_options": "" });
        // an empty launch_options still adds its space
        assert_eq!(steam_options("ZZMI", &defaults, "2.4.1", exe).as_deref(),
            Some(r#""D:\SteamLibrary\steamapps\common\ZenlessZoneZero\ZenlessZoneZero.exe" && %command% "#));
        assert_eq!(steam_options("ZZMI", &json!({}), "2.5.0", exe), steam_options("ZZMI", &defaults, "2.5.0", exe));
        let set = json!({ "launch_options": r"-path C:\x", "d3d11_mode_cmd_args": "-dx11", "use_launch_options": true });
        assert_eq!(steam_options("ZZMI", &set, "2.5.0", exe).as_deref(),
            Some(r#""D:\SteamLibrary\steamapps\common\ZenlessZoneZero\ZenlessZoneZero.exe" && %command% -dx11 -path C:\x"#));
        assert_eq!(steam_options("ZZMI", &set, "2.4.3", None).as_deref(), Some("-dx11 -path C:/x"), "before 2.4.4 \\ became /");
        let off = json!({ "launch_options": "-a", "use_launch_options": false, "skip_platform_game_launcher": false });
        assert_eq!(steam_options("ZZMI", &off, "2.5.0", exe).as_deref(), Some(""));
        assert_eq!(steam_options("ZZMI", &json!({ "configure_platform_launch_options": false }), "2.5.0", exe), None);
        assert_eq!(steam_options("WWMI", &defaults, "2.4.9", exe).as_deref(), Some(""), "WWMI gets the exe from 2.5.0");
        assert!(steam_options("WWMI", &defaults, "2.5.0", exe).unwrap().contains("&& %command%"));
        assert_eq!(version_parts("2.4.10"), Some([2, 4, 10]));
        assert_eq!(version_parts(""), None);
    }

    #[test]
    fn finds_the_steam_exe_where_xxmi_does() {
        let dir = std::env::temp_dir().join(format!("gachamod-steam-exe-{}-{}", std::process::id(), crate::db::now()));
        let nested = dir.join("Games").join("ZenlessZoneZero Game");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("ZenlessZoneZero.exe"), b"").unwrap();
        let imp = json!({ "game_exe_names": ["ZenlessZoneZero.exe", "ZenlessZoneZeroBeta.exe"], "process_exe_names": [] });
        assert_eq!(steam_game_exe(&dir, &imp, &[]), Some(nested.join("ZenlessZoneZero.exe")));
        std::fs::write(dir.join("ZenlessZoneZero.exe"), b"").unwrap();
        assert_eq!(steam_game_exe(&dir, &imp, &[]), Some(dir.join("ZenlessZoneZero.exe")), "right in the folder wins");
        std::fs::remove_file(dir.join("ZenlessZoneZero.exe")).unwrap();
        std::fs::create_dir_all(dir.join("Backup")).unwrap();
        std::fs::write(dir.join("Backup").join("ZenlessZoneZero.exe"), b"").unwrap();
        assert_eq!(steam_game_exe(&dir, &imp, &[]), None, "two copies below and XXMI gives up");
        assert_eq!(steam_game_exe(&dir, &json!({}), &["Nope.exe"]), None);
        let resolved = python_resolve(&nested.join("ZenlessZoneZero.exe"));
        assert!(!resolved.starts_with(r"\\?\") && resolved.ends_with("ZenlessZoneZero.exe"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Read only: the real config on this PC (if any) parses and writes back unchanged.
    #[test]
    #[ignore]
    fn real_config_round_trips() {
        let Some(root) = find_root(None) else { return };
        let text = std::fs::read_to_string(root.join(CONFIG_FILE)).unwrap();
        let body = text.trim_start_matches('\u{feff}');
        assert_eq!(ojson::parse(body).unwrap().write(&ojson::Style::detect(body)), body);
        let st = status(None).unwrap();
        assert!(st.found);
        let found = crate::games::discover(None);
        assert!(!found.is_empty());
        for f in &found { eprintln!("{} game={:?} importer={:?} xxmi={}", f.game, f.game_dir.is_some(), f.importer_dir.is_some(), f.via_xxmi); }
    }
}
