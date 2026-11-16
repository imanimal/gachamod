//! gachamod's own log and crash files, in "<data folder>/logs". Owner: SYSTEM area.
//!
//! gachamod.log is plain text, one line per thing that happened, newest last. Past about 1 MB it becomes
//! gachamod.old.log and a new one starts. A panic writes crash-<time>.json next to it, and a run that ended without
//! quitting (the process was killed, or crashed past what a panic hook sees) is noted at the next start. Telemetry
//! sends crash files when crash reports are on (telemetry.rs). Text that leaves the computer goes through `scrub`.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

static DIR: Mutex<Option<PathBuf>> = Mutex::new(None);
static WRITING: Mutex<()> = Mutex::new(());
const LOG: &str = "gachamod.log";
const OLD: &str = "gachamod.old.log";
const MAX: u64 = 1_000_000;
/// Present while gachamod runs; still there at a start means the last run didn't quit.
const RUNNING: &str = "running";

/// Where the log goes. Call once at startup, before anything is written.
pub fn init(data_dir: &Path) -> PathBuf {
    let dir = data_dir.join("logs");
    let _ = std::fs::create_dir_all(&dir);
    *DIR.lock().unwrap_or_else(|e| e.into_inner()) = Some(dir.clone());
    dir
}

pub fn dir() -> Option<PathBuf> { DIR.lock().ok()?.clone() }

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Level { Info, Warn, Error }

impl Level {
    fn tag(self) -> &'static str { match self { Level::Info => "info ", Level::Warn => "warn ", Level::Error => "error" } }
    pub fn parse(s: &str) -> Level { match s { "error" => Level::Error, "warn" => Level::Warn, _ => Level::Info } }
}

/// Add to the log. Lines after the first are indented, so one entry stays one block.
pub fn write(level: Level, text: &str) {
    let Some(dir) = dir() else { return };
    let _one = WRITING.lock().unwrap_or_else(|e| e.into_inner());
    let file = dir.join(LOG);
    if file.metadata().is_ok_and(|m| m.len() > MAX) { let _ = std::fs::rename(&file, dir.join(OLD)); }
    let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&file) else { return };
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
    let mut out = String::new();
    for (i, line) in text.trim_end().lines().enumerate() {
        out.push_str(&format!("{now} {} {}{line}\r\n", level.tag(), if i > 0 { "    " } else { "" }));
    }
    let _ = f.write_all(out.as_bytes());
}

pub fn info(text: impl AsRef<str>) { write(Level::Info, text.as_ref()) }
pub fn warn(text: impl AsRef<str>) { write(Level::Warn, text.as_ref()) }
pub fn error(text: impl AsRef<str>) { write(Level::Error, text.as_ref()) }

/// The end of the log, at most `max` bytes (from the older file too when the new one is short), cut at a line.
pub fn tail(max: usize) -> String {
    let Some(dir) = dir() else { return String::new() };
    let _one = WRITING.lock().unwrap_or_else(|e| e.into_inner());
    let read = |n: &str| std::fs::read(dir.join(n)).map(|b| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default();
    let mut text = read(LOG);
    if text.len() < max { text = read(OLD) + &text; }
    if text.len() <= max { return text; }
    let mut start = text.len() - max;
    while !text.is_char_boundary(start) { start += 1; }
    let cut = &text[start..];
    cut.find('\n').map_or(cut, |i| &cut[i + 1..]).to_string()
}

/// Take the user's own folder and account name out of text that leaves the computer.
pub fn scrub(text: &str) -> String {
    let home = std::env::var("USERPROFILE").unwrap_or_default();
    let user = std::env::var("USERNAME").unwrap_or_default();
    scrub_with(text, &home, &user)
}

fn scrub_with(text: &str, home: &str, user: &str) -> String {
    let mut out = text.to_string();
    if home.len() > 3 {
        for h in [home.to_string(), home.replace('\\', "/"), home.replace('\\', "\\\\")] { out = replace_ci(&out, &h, "%USERPROFILE%"); }
    }
    if user.chars().count() >= 3 { out = replace_ci(&out, user, "<user>"); }
    out
}

/// Replace every match of `from`, ignoring ASCII case.
fn replace_ci(text: &str, from: &str, to: &str) -> String {
    if from.is_empty() { return text.to_string(); }
    let (low, find) = (text.to_ascii_lowercase(), from.to_ascii_lowercase());
    let mut out = String::with_capacity(text.len());
    let mut at = 0;
    while let Some(i) = low[at..].find(&find) {
        out.push_str(&text[at..at + i]);
        out.push_str(to);
        at += i + find.len();
    }
    out.push_str(&text[at..]);
    out
}

// ── crashes ──

/// What a crash file holds.
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, Default)]
pub struct Crash {
    /// "panic" (Rust), "ui" (the window's code), "exit" (the run ended without quitting) or "render" (a rendering
    /// problem, render_log::report).
    pub kind: String,
    pub message: String,
    /// The source line, for a panic.
    #[serde(default)]
    pub at: String,
    #[serde(default)]
    pub stack: String,
    pub version: String,
    /// RFC 3339.
    pub time: String,
}

/// Keep a crash for telemetry to send (`pending`).
pub fn save_crash(c: &Crash) {
    let Some(dir) = dir() else { return };
    let name = format!("crash-{}.json", chrono::Utc::now().timestamp_millis());
    if let Ok(text) = serde_json::to_string_pretty(c) { let _ = std::fs::write(dir.join(name), text); }
    prune(&dir);
}

/// Crash files not sent yet, oldest first.
pub fn pending() -> Vec<(PathBuf, Crash)> {
    let Some(dir) = dir() else { return Vec::new() };
    let mut v: Vec<(PathBuf, Crash)> = std::fs::read_dir(&dir).into_iter().flatten().flatten()
        .map(|e| e.path())
        .filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with("crash-") && n.ends_with(".json") && !n.ends_with(".sent.json")))
        .filter_map(|p| { let c = serde_json::from_slice::<Crash>(&std::fs::read(&p).ok()?).ok()?; Some((p, c)) })
        .collect();
    v.sort_by(|a, b| a.0.cmp(&b.0));
    v
}

/// A crash went out: keep the file as sent (the newest 20 stay for the player to look at).
pub fn mark_sent(path: &Path) {
    let sent = path.with_extension("sent.json");
    let _ = std::fs::rename(path, sent);
}

fn prune(dir: &Path) {
    let mut v: Vec<PathBuf> = std::fs::read_dir(dir).into_iter().flatten().flatten().map(|e| e.path())
        .filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with("crash-"))).collect();
    if v.len() <= 20 { return; }
    v.sort();
    for p in &v[..v.len() - 20] { let _ = std::fs::remove_file(p); }
}

/// Write a crash file and a log line for every panic, then let the usual handling go on.
pub fn catch_panics(version: &'static str) {
    let before = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let message = info.payload().downcast_ref::<&str>().map(|s| s.to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned()).unwrap_or_else(|| "a panic".into());
        let at = info.location().map(|l| format!("{}:{}", l.file(), l.line())).unwrap_or_default();
        let thread = std::thread::current().name().unwrap_or("a thread").to_string();
        let stack = std::backtrace::Backtrace::force_capture().to_string();
        error(format!("crash in {thread} at {at}: {message}"));
        save_crash(&Crash { kind: "panic".into(), message: format!("{message} (in {thread})"), at, stack, version: version.into(), time: chrono::Utc::now().to_rfc3339() });
        before(info);
    }));
}

/// gachamod started: when the last run ended without quitting and left no crash file, note it as a crash with the
/// end of its log. Debug builds skip this, since `tauri dev` stops the app on every rebuild.
pub fn started(version: &str) {
    let Some(dir) = dir() else { return };
    let marker = dir.join(RUNNING);
    if marker.exists() && !cfg!(debug_assertions) {
        let since = marker.metadata().and_then(|m| m.modified()).ok();
        let crashed = std::fs::read_dir(&dir).into_iter().flatten().flatten().any(|e| {
            e.file_name().to_string_lossy().starts_with("crash-") && e.metadata().and_then(|m| m.modified()).ok().zip(since).is_some_and(|(t, s)| t >= s)
        });
        if !crashed {
            save_crash(&Crash { kind: "exit".into(), message: "gachamod closed without quitting".into(), at: String::new(), stack: tail(6000), version: version.into(), time: chrono::Utc::now().to_rfc3339() });
        }
    }
    let _ = std::fs::write(&marker, b"");
    info(format!("gachamod {version} started{}", if crate::devtools::self_elevated() { " as administrator" } else { "" }));
}

/// gachamod is quitting normally.
pub fn quitting() {
    info("gachamod quit");
    if let Some(dir) = dir() { let _ = std::fs::remove_file(dir.join(RUNNING)); }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scrub_takes_out_the_home_folder_and_name() {
        let t = "C:\\Users\\Alex\\AppData\\x.ini and c:\\users\\alex\\y, C:/Users/Alex/z, C:\\\\Users\\\\Alex\\\\w, by alex";
        let s = scrub_with(t, "C:\\Users\\Alex", "Alex");
        assert!(!s.to_ascii_lowercase().contains("alex"), "{s}");
        assert!(s.starts_with("%USERPROFILE%\\AppData\\x.ini"));
        // a short name isn't taken out of every word
        assert_eq!(scrub_with("an ok text", "", "ok"), "an ok text");
    }

    #[test]
    fn replace_ignores_case_and_keeps_the_rest() {
        assert_eq!(replace_ci("aXbxc", "x", "-"), "a-b-c");
        assert_eq!(replace_ci("héllo HELLO", "hello", "hi"), "héllo hi");
    }
}
