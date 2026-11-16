//! The rendering log, for finding out why a window goes black or stops drawing. Files sit in
//! "<data folder>/logs/rendering". Owner: SYSTEM area.
//!
//! - rendering.log: one line per event (focus, moves between screens, screens changing, WebView2's processes exiting,
//!   the page's frames stopping, the window showing black on screen), newest last. Past about 1 MB it becomes
//!   rendering.old.log.
//! - system.txt: graphics cards and drivers, screens, and the Windows settings that change how windows are drawn,
//!   written at each start. WebView2's version and folders are added once the window is up.
//! - incident-<time>.txt for each problem: what happened, a check of the window at that moment, system.txt, the last
//!   events, recent graphics driver entries from the Windows event log and the end of WebView2's own log
//!   (chrome_debug.log, written when gachamod starts with --browser-log). incident-<time>.png, when there is one, is
//!   what WebView2 says the page looked like then. The newest 20 stay.
//!
//! Setting "render.log" (default on; Settings, Feedback and data) turns it off. Nothing here leaves the computer
//! unless the player attaches logs to feedback, or crash reports are on: then a summary of each incident goes out
//! with them (`report`). telemetry.rs scrubs both.

use std::collections::{HashMap, VecDeque};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

static DIR: Mutex<Option<PathBuf>> = Mutex::new(None);
static ON: AtomicBool = AtomicBool::new(true);
static WRITING: Mutex<()> = Mutex::new(());
static RECENT: Mutex<VecDeque<String>> = Mutex::new(VecDeque::new());
static SYSTEM: Mutex<System> = Mutex::new(System { base: String::new(), sections: Vec::new() });
static WEBVIEW: Mutex<WebviewPaths> = Mutex::new(WebviewPaths { data: None, reports: None });
static LAST: Mutex<Option<HashMap<String, Instant>>> = Mutex::new(None);
static WRITTEN: AtomicUsize = AtomicUsize::new(0);
/// Incident summaries queued for the developer in this run (`report`).
static REPORTED: AtomicUsize = AtomicUsize::new(0);
const REPORTS_PER_RUN: usize = 5;

const LOG: &str = "rendering.log";
const OLD: &str = "rendering.old.log";
const SYSTEM_FILE: &str = "system.txt";
const MAX: u64 = 1_000_000;
/// Events kept in memory for the next incident.
const KEEP: usize = 400;
/// Incident files kept on disk.
const KEEP_INCIDENTS: usize = 20;
/// Incidents written in one run, at most.
const PER_RUN: usize = 30;
/// The same kind of incident is written again only after this long.
const AGAIN_AFTER: Duration = Duration::from_secs(60);

struct System { base: String, sections: Vec<(String, String)> }
struct WebviewPaths { data: Option<PathBuf>, reports: Option<PathBuf> }

/// Where the files go and whether the log is on. Call once at startup, after `logs::init`.
pub fn init(logs_dir: &Path, on: bool) -> PathBuf {
    let dir = logs_dir.join("rendering");
    let _ = std::fs::create_dir_all(&dir);
    *DIR.lock().unwrap_or_else(|e| e.into_inner()) = Some(dir.clone());
    ON.store(on, Ordering::Relaxed);
    dir
}

pub fn dir() -> Option<PathBuf> { DIR.lock().ok()?.clone() }
pub fn on() -> bool { ON.load(Ordering::Relaxed) }

/// The setting changed (settings_set "render.log").
pub fn set_on(on: bool) {
    if on == self::on() { return; }
    if on { ON.store(true, Ordering::Relaxed); event("Rendering log turned on"); } else { event("Rendering log turned off"); ON.store(false, Ordering::Relaxed); }
}

/// Add an event: a line in rendering.log and in the list the next incident shows. Lines after the first are
/// indented, so one event stays one block.
pub fn event(text: impl AsRef<str>) {
    if !on() { return; }
    let Some(dir) = dir() else { return };
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
    let mut block = String::new();
    for (i, line) in text.as_ref().trim_end().lines().enumerate() {
        block.push_str(&format!("{now} {}{line}\r\n", if i > 0 { "    " } else { "" }));
    }
    {
        let mut r = RECENT.lock().unwrap_or_else(|e| e.into_inner());
        r.push_back(block.clone());
        while r.len() > KEEP { r.pop_front(); }
    }
    let _one = WRITING.lock().unwrap_or_else(|e| e.into_inner());
    let file = dir.join(LOG);
    if file.metadata().is_ok_and(|m| m.len() > MAX) { let _ = std::fs::rename(&file, dir.join(OLD)); }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&file) { let _ = f.write_all(block.as_bytes()); }
}

// ── system.txt ──

/// Write system.txt for this run: `header` (version, the browser flags) and what Windows says about the graphics
/// cards, screens and drawing settings. Reads the registry and the event log, so call it off the main thread.
pub fn write_system(header: &str) {
    let text = format!("{}\r\n\r\n{}", header.trim_end(), details());
    SYSTEM.lock().unwrap_or_else(|e| e.into_inner()).base = text;
    save_system();
}

/// Add or replace a part of system.txt (WebView2's version and folders).
pub fn system_section(title: &str, text: &str) {
    {
        let mut s = SYSTEM.lock().unwrap_or_else(|e| e.into_inner());
        s.sections.retain(|(t, _)| t != title);
        s.sections.push((title.to_string(), text.trim_end().to_string()));
    }
    save_system();
}

fn system_text() -> String {
    let s = SYSTEM.lock().unwrap_or_else(|e| e.into_inner());
    let mut out = s.base.clone();
    for (t, body) in &s.sections { out.push_str(&format!("\r\n\r\n== {t} ==\r\n{body}")); }
    out
}

fn save_system() {
    if !on() { return; }
    let Some(dir) = dir() else { return };
    let _ = std::fs::write(dir.join(SYSTEM_FILE), crlf(&system_text()));
}

/// WebView2's data folder (its log is chrome_debug.log in there) and the folder it keeps crash dumps in.
pub fn webview_paths(data: Option<PathBuf>, reports: Option<PathBuf>) {
    let mut w = WEBVIEW.lock().unwrap_or_else(|e| e.into_inner());
    if data.is_some() { w.data = data; }
    if reports.is_some() { w.reports = reports; }
}

fn chromium_log() -> Option<PathBuf> {
    let data = WEBVIEW.lock().ok()?.data.clone()?;
    [data.join("EBWebView").join("chrome_debug.log"), data.join("chrome_debug.log")].into_iter().find(|p| p.is_file())
}

/// The end of WebView2's own log, at most `max` bytes, cut at a line. It says when the file was last written, since
/// one from an earlier start stays in the folder.
fn chromium_tail(max: usize) -> String {
    let Some(p) = chromium_log() else { return "No chrome_debug.log in WebView2's folder (WebView2 writes it when gachamod starts with --browser-log)".into() };
    let Ok(bytes) = std::fs::read(&p) else { return format!("{} couldn't be read", p.display()) };
    let written = std::fs::metadata(&p).and_then(|m| m.modified()).ok()
        .map(|t| chrono::DateTime::<chrono::Local>::from(t).format("%Y-%m-%d %H:%M:%S").to_string()).unwrap_or_else(|| "at an unknown time".into());
    let text = String::from_utf8_lossy(&bytes);
    format!("Last written {written}\n{}", tail_of(&text, max))
}

/// WebView2 crash dumps, newest first.
fn crash_dumps() -> String {
    let Some(dir) = WEBVIEW.lock().ok().and_then(|w| w.reports.clone()) else { return "WebView2 didn't say where it keeps crash dumps".into() };
    let mut v: Vec<(std::time::SystemTime, String, u64)> = walk(&dir, 3).into_iter()
        .filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("dmp")))
        .filter_map(|p| { let m = p.metadata().ok()?; Some((m.modified().ok()?, p.strip_prefix(&dir).unwrap_or(&p).display().to_string(), m.len())) })
        .collect();
    if v.is_empty() { return format!("None in {}", dir.display()); }
    v.sort_by(|a, b| b.0.cmp(&a.0));
    let mut out = format!("{} in {}\r\n", v.len(), dir.display());
    for (t, name, len) in v.iter().take(10) {
        out.push_str(&format!("{}  {name}  {} KB\r\n", chrono::DateTime::<chrono::Local>::from(*t).format("%Y-%m-%d %H:%M:%S"), len / 1024));
    }
    out
}

fn walk(dir: &Path, depth: u32) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for e in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let p = e.path();
        if p.is_dir() { if depth > 0 { out.extend(walk(&p, depth - 1)); } } else { out.push(p); }
    }
    out
}

// ── incidents ──

/// Write an incident file. `kind` groups incidents for the once-a-minute limit ("black", "gpu-exit"); `what` and
/// `check` are what happened and what the window looked like then; `picture` is a PNG of the page. Reads the event
/// log, so call it off the main thread. Returns the file, or None when the log is off or the limit was hit.
pub fn incident(kind: &str, title: &str, what: &str, check: &str, picture: Option<&[u8]>) -> Option<PathBuf> {
    if !on() { return None; }
    let dir = dir()?;
    {
        let mut last = LAST.lock().unwrap_or_else(|e| e.into_inner());
        let map = last.get_or_insert_with(HashMap::new);
        if map.get(kind).is_some_and(|t| t.elapsed() < AGAIN_AFTER) || WRITTEN.load(Ordering::Relaxed) >= PER_RUN {
            event(format!("(no incident file: {title}, one was written moments ago)"));
            return None;
        }
        map.insert(kind.to_string(), Instant::now());
    }
    WRITTEN.fetch_add(1, Ordering::Relaxed);
    let now = chrono::Local::now();
    let name = format!("incident-{}", now.format("%Y%m%d-%H%M%S-%3f"));
    let recent: String = RECENT.lock().map(|r| r.iter().cloned().collect()).unwrap_or_default();
    let mut text = format!("gachamod rendering incident\r\n{title}\r\nTime: {}\r\n", now.format("%Y-%m-%d %H:%M:%S%.3f %:z"));
    let mut part = |head: &str, body: &str| text.push_str(&format!("\r\n== {head} ==\r\n{}\r\n", body.trim_end()));
    part("What happened", what);
    part("The window at that moment", check);
    if picture.is_some() { part("Picture", &format!("{name}.png is what WebView2 says the page looked like")); }
    part("Last events, oldest first", &recent);
    part("System", &system_text());
    part("Graphics driver entries in the Windows event log, last 7 days", &driver_events());
    part("Programs that stopped or hung, from the Windows event log, last 7 days", &app_events());
    part("WebView2 crash dumps", &crash_dumps());
    part("End of WebView2's log (chrome_debug.log)", &chromium_tail(60_000));
    let file = dir.join(format!("{name}.txt"));
    std::fs::write(&file, crlf(&text)).ok()?;
    if let Some(png) = picture { let _ = std::fs::write(dir.join(format!("{name}.png")), png); }
    prune(&dir);
    event(format!("Incident: {title}. Written to {name}.txt"));
    crate::logs::warn(format!("Rendering problem: {title}. Details in {}", file.display()));
    Some(file)
}

/// Queue a summary of an incident as a crash report of kind "render" (logs::save_crash). telemetry.rs sends it with
/// the others while crash reports are on, scrubbed: what happened, the window then, `note` (what brought the picture
/// back), system.txt and the last events. Five a run at most.
pub fn report(title: &str, what: &str, check: &str, note: &str) {
    if REPORTED.fetch_add(1, Ordering::Relaxed) >= REPORTS_PER_RUN { return; }
    let recent: String = RECENT.lock().map(|r| r.iter().cloned().collect()).unwrap_or_default();
    let stack = format!("{}\n\n{}\n{}\n\n{}\n\nLast events:\n{}", what.trim_end(), check.trim_end(), note.trim(), cut_at(&system_text(), 6000), tail_of(&recent, 5000));
    crate::logs::save_crash(&crate::logs::Crash {
        kind: "render".into(), message: title.to_string(), at: String::new(), stack: stack.replace("\r\n", "\n"),
        version: env!("CARGO_PKG_VERSION").into(), time: chrono::Utc::now().to_rfc3339(),
    });
}

/// Add a line to an incident file written earlier ("drew again after 12 s").
pub fn add_to(file: &Path, line: &str) {
    if let Ok(mut f) = std::fs::OpenOptions::new().append(true).open(file) {
        let _ = f.write_all(format!("\r\n{} {line}\r\n", chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f")).as_bytes());
    }
}

fn incident_files(dir: &Path) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = std::fs::read_dir(dir).into_iter().flatten().flatten().map(|e| e.path())
        .filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with("incident-") && n.ends_with(".txt")))
        .collect();
    v.sort();
    v
}

fn prune(dir: &Path) {
    let v = incident_files(dir);
    if v.len() <= KEEP_INCIDENTS { return; }
    for p in &v[..v.len() - KEEP_INCIDENTS] {
        let _ = std::fs::remove_file(p);
        let _ = std::fs::remove_file(p.with_extension("png"));
    }
}

/// How many incident files there are.
pub fn incidents() -> usize { dir().map_or(0, |d| incident_files(&d).len()) }

/// What goes with feedback when the player attaches logs: the newest incident, system.txt and the end of
/// rendering.log, at most `max` bytes in all. Empty when there's nothing. Not scrubbed: the caller does that.
pub fn for_feedback(max: usize) -> String {
    let Some(dir) = dir() else { return String::new() };
    let read = |p: &Path| std::fs::read(p).map(|b| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default();
    let mut out = String::new();
    if let Some(last) = incident_files(&dir).pop() {
        let name = last.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        out.push_str(&format!("=== {name} ===\n{}\n\n", cut_at(&read(&last), max / 2)));
    }
    let sys = read(&dir.join(SYSTEM_FILE));
    if !sys.is_empty() { out.push_str(&format!("=== system.txt ===\n{}\n\n", cut_at(&sys, max / 4))); }
    let log = read(&dir.join(LOG));
    if !log.is_empty() { out.push_str(&format!("=== end of rendering.log ===\n{}", tail_of(&log, max.saturating_sub(out.len()).max(2000)))); }
    cut_at(&out, max)
}

fn cut_at(s: &str, max: usize) -> String {
    if s.len() <= max { return s.to_string(); }
    let mut end = max;
    while !s.is_char_boundary(end) { end -= 1; }
    format!("{}\n(cut)", &s[..end])
}

fn tail_of(text: &str, max: usize) -> String {
    if text.len() <= max { return text.to_string(); }
    let mut start = text.len() - max;
    while !text.is_char_boundary(start) { start += 1; }
    let cut = &text[start..];
    cut.find('\n').map_or(cut, |i| &cut[i + 1..]).to_string()
}

fn crlf(s: &str) -> String { s.replace("\r\n", "\n").replace('\n', "\r\n") }

// ── pictures ──

/// How dark a picture is: the share of pixels that are black (every channel 3 or less) and the average brightness
/// (0 to 255).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Darkness { pub black_share: f32, pub mean: f32 }

impl Darkness {
    /// Nearly all of it is black.
    pub fn black(&self) -> bool { self.black_share >= 0.995 }
    pub fn describe(&self) -> String { format!("{:.1}% black pixels, average brightness {:.0} of 255", self.black_share * 100.0, self.mean) }
}

/// Darkness of RGB(A) pixels, `step` bytes apart.
fn darkness(px: &[u8], step: usize) -> Option<Darkness> {
    let (mut n, mut black, mut sum) = (0u64, 0u64, 0u64);
    for p in px.chunks_exact(step) {
        let m = p[0].max(p[1]).max(p[2]);
        if m <= 3 { black += 1; }
        sum += (p[0] as u64 + p[1] as u64 + p[2] as u64) / 3;
        n += 1;
    }
    (n > 0).then(|| Darkness { black_share: black as f32 / n as f32, mean: sum as f32 / n as f32 })
}

/// Darkness of a PNG (WebView2's picture of the page).
pub fn png_darkness(png: &[u8]) -> Option<Darkness> {
    let img = image::load_from_memory_with_format(png, image::ImageFormat::Png).ok()?.to_rgb8();
    darkness(img.as_raw(), 3)
}

/// What the screen shows where a window is.
#[derive(Clone, Debug)]
pub struct ScreenCheck {
    pub darkness: Darkness,
    /// The part of the screen read: x, y, width, height.
    pub area: (i32, i32, i32, i32),
}

impl ScreenCheck {
    pub fn describe(&self) -> String {
        let (x, y, w, h) = self.area;
        format!("On screen: {} (read {w}x{h} at {x},{y})", self.darkness.describe())
    }
}

#[cfg(windows)]
pub use win::{displays, idle, screen_check, ui_hung};

#[cfg(not(windows))]
pub fn displays() -> String { String::new() }
#[cfg(not(windows))]
pub fn idle() -> Duration { Duration::ZERO }
#[cfg(not(windows))]
pub fn screen_check(_hwnd: isize) -> Option<ScreenCheck> { None }
#[cfg(not(windows))]
pub fn ui_hung(_hwnd: isize) -> bool { false }

#[cfg(not(windows))]
fn details() -> String { String::new() }
#[cfg(not(windows))]
fn driver_events() -> String { String::new() }
#[cfg(not(windows))]
fn app_events() -> String { String::new() }
#[cfg(windows)]
use win::{app_events, details, driver_events};

#[cfg(windows)]
mod win {
    use super::{darkness, ScreenCheck};
    use std::fmt::Write as _;
    use std::time::Duration;
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ};
    use winreg::RegKey;

    fn hklm(path: &str) -> Option<RegKey> { RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey_with_flags(path, KEY_READ).ok() }
    fn hkcu(path: &str) -> Option<RegKey> { RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(path, KEY_READ).ok() }
    fn text(k: &RegKey, name: &str) -> Option<String> { k.get_value::<String, _>(name).ok().filter(|s| !s.trim().is_empty()) }
    fn number(k: &RegKey, name: &str) -> Option<u64> {
        k.get_value::<u32, _>(name).map(u64::from).or_else(|_| k.get_value::<u64, _>(name)).ok()
    }

    /// Everything system.txt says about this PC.
    pub fn details() -> String {
        let mut out = String::new();
        let _ = writeln!(out, "== Windows ==\r\n{}", os());
        let _ = writeln!(out, "\r\n== Graphics cards (driver details from the registry) ==\r\n{}", gpus());
        let _ = writeln!(out, "\r\n== Screens (from Windows) ==\r\n{}", displays());
        let _ = writeln!(out, "\r\n== Windows settings that change how windows are drawn ==\r\n{}", draw_settings());
        let _ = writeln!(out, "\r\n== Graphics driver entries in the Windows event log, last 7 days ==\r\n{}", driver_events());
        out
    }

    fn os() -> String {
        let Some(k) = hklm(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion") else { return "unknown".into() };
        let build: u32 = text(&k, "CurrentBuild").and_then(|b| b.parse().ok()).unwrap_or(0);
        let name = text(&k, "ProductName").unwrap_or_default();
        // Windows 11 still calls itself Windows 10 here
        let name = if build >= 22000 { name.replace("Windows 10", "Windows 11") } else { name };
        let mut s = format!("{name} {} (build {build}.{})", text(&k, "DisplayVersion").unwrap_or_default(), number(&k, "UBR").unwrap_or(0));
        // SAFETY: plain metric queries.
        let (remote, monitors) = unsafe {
            use windows_sys::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CMONITORS, SM_REMOTESESSION};
            (GetSystemMetrics(SM_REMOTESESSION) != 0, GetSystemMetrics(SM_CMONITORS))
        };
        let _ = write!(s, "\r\nScreens: {monitors}{}", if remote { "\r\nRunning in a remote desktop session" } else { "" });
        s
    }

    /// NVIDIA's own driver number from Windows' one: 32.0.15.6094 is 560.94.
    fn nvidia_version(v: &str) -> Option<String> {
        let digits: String = v.split('.').rev().take(2).collect::<Vec<_>>().into_iter().rev().collect::<String>();
        if digits.len() < 5 || !digits.chars().all(|c| c.is_ascii_digit()) { return None; }
        let last = &digits[digits.len() - 5..];
        Some(format!("{}.{}", &last[..3], &last[3..]))
    }

    fn gpus() -> String {
        let class = r"SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}";
        let Some(root) = hklm(class) else { return "couldn't read the display adapters".into() };
        let mut lines: Vec<(String, usize)> = Vec::new();
        for sub in root.enum_keys().flatten().filter(|s| s.chars().all(|c| c.is_ascii_digit())) {
            let Ok(k) = root.open_subkey_with_flags(&sub, KEY_READ) else { continue };
            let Some(desc) = text(&k, "DriverDesc") else { continue };
            let version = text(&k, "DriverVersion").unwrap_or_default();
            let provider = text(&k, "ProviderName").unwrap_or_default();
            let mut line = format!("{desc}: driver {version}");
            if provider.to_ascii_lowercase().contains("nvidia") || desc.to_ascii_lowercase().contains("nvidia") {
                if let Some(nv) = nvidia_version(&version) { let _ = write!(line, " (NVIDIA {nv})"); }
            }
            if let Some(d) = text(&k, "DriverDate") { let _ = write!(line, ", dated {d}"); }
            if !provider.is_empty() { let _ = write!(line, ", from {provider}"); }
            let mem = number(&k, "HardwareInformation.qwMemorySize")
                .or_else(|| k.get_raw_value("HardwareInformation.MemorySize").ok().and_then(|v| v.bytes.get(..4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as u64)));
            if let Some(m) = mem.filter(|m| *m > 0) { let _ = write!(line, ", {} MB video memory", m / (1024 * 1024)); }
            if let Some(id) = text(&k, "MatchingDeviceId") { let _ = write!(line, ", {id}"); }
            // remote desktop sessions leave one identical adapter each
            match lines.iter_mut().find(|(l, _)| *l == line) { Some(hit) => hit.1 += 1, None => lines.push((line, 1)) }
        }
        if lines.is_empty() { return "none found".into(); }
        lines.iter().map(|(l, n)| if *n > 1 { format!("{l} ({n} of these)
") } else { format!("{l}
") }).collect()
    }

    fn wide_str(buf: &[u16]) -> String { String::from_utf16_lossy(&buf[..buf.iter().position(|&c| c == 0).unwrap_or(buf.len())]) }

    /// Each screen: its mode, where it sits, and which graphics card drives it. Compared every few seconds to notice a
    /// screen being added, removed or changed.
    pub fn displays() -> String {
        use windows_sys::Win32::Graphics::Gdi::{
            EnumDisplayDevicesW, EnumDisplaySettingsW, DEVMODEW, DISPLAY_DEVICEW, DISPLAY_DEVICE_ATTACHED_TO_DESKTOP, DISPLAY_DEVICE_PRIMARY_DEVICE, ENUM_CURRENT_SETTINGS,
        };
        let mut out = String::new();
        for i in 0..32u32 {
            // SAFETY: structs sized as the API asks; strings read up to their zero.
            unsafe {
                let mut dd: DISPLAY_DEVICEW = std::mem::zeroed();
                dd.cb = std::mem::size_of::<DISPLAY_DEVICEW>() as u32;
                if EnumDisplayDevicesW(std::ptr::null(), i, &mut dd, 0) == 0 { break; }
                if dd.StateFlags & DISPLAY_DEVICE_ATTACHED_TO_DESKTOP == 0 { continue; }
                let name = wide_str(&dd.DeviceName);
                let card = wide_str(&dd.DeviceString);
                let mut dm: DEVMODEW = std::mem::zeroed();
                dm.dmSize = std::mem::size_of::<DEVMODEW>() as u16;
                let mode = if EnumDisplaySettingsW(dd.DeviceName.as_ptr(), ENUM_CURRENT_SETTINGS, &mut dm) != 0 {
                    let p = dm.Anonymous1.Anonymous2.dmPosition;
                    format!("{}x{} at {} Hz, {} bit, at {},{}", dm.dmPelsWidth, dm.dmPelsHeight, dm.dmDisplayFrequency, dm.dmBitsPerPel, p.x, p.y)
                } else { "mode unknown".into() };
                let mut mon: DISPLAY_DEVICEW = std::mem::zeroed();
                mon.cb = std::mem::size_of::<DISPLAY_DEVICEW>() as u32;
                let monitor = if EnumDisplayDevicesW(dd.DeviceName.as_ptr(), 0, &mut mon, 0) != 0 { wide_str(&mon.DeviceString) } else { String::new() };
                let primary = if dd.StateFlags & DISPLAY_DEVICE_PRIMARY_DEVICE != 0 { " (main)" } else { "" };
                let _ = writeln!(out, "{}{primary}: {mode}, on {card}{}", name.trim_start_matches(r"\\.\"), if monitor.is_empty() { String::new() } else { format!(", {monitor}") });
            }
        }
        if out.is_empty() { "none found".into() } else { out }
    }

    fn draw_settings() -> String {
        let mut out = String::new();
        let gd = hklm(r"SYSTEM\CurrentControlSet\Control\GraphicsDrivers");
        let hags = gd.as_ref().and_then(|k| number(k, "HwSchMode"));
        let _ = writeln!(out, "Hardware-accelerated GPU scheduling: {}", match hags { Some(2) => "on".to_string(), Some(1) => "off".to_string(), Some(v) => format!("HwSchMode {v}"), None => "not set (Windows' default)".to_string() });
        for name in ["TdrLevel", "TdrDelay", "TdrDdiDelay"] {
            if let Some(v) = gd.as_ref().and_then(|k| number(k, name)) { let _ = writeln!(out, "{name}: {v}"); }
        }
        let mpo = hklm(r"SOFTWARE\Microsoft\Windows\Dwm").and_then(|k| number(&k, "OverlayTestMode"));
        let _ = writeln!(out, "Multiplane overlay: {}", match mpo { Some(5) => "turned off (OverlayTestMode 5)".to_string(), Some(v) => format!("OverlayTestMode {v}"), None => "Windows' default".to_string() });
        if let Some(k) = hkcu(r"Software\Microsoft\DirectX\UserGpuPreferences") {
            if let Some(g) = text(&k, "DirectXUserGlobalSettings") { let _ = writeln!(out, "Graphics settings (windowed game optimizations, auto HDR, VRR): {g}"); }
            for (name, v) in k.enum_values().flatten() {
                let low = name.to_ascii_lowercase();
                if low.contains("gachamod") || low.contains("msedgewebview2") || low.contains("xxmi") {
                    let _ = writeln!(out, "Graphics preference for {name}: {v}");
                }
            }
        }
        if let Some(k) = hkcu(r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize") {
            if let Some(v) = number(&k, "EnableTransparency") { let _ = writeln!(out, "Transparency effects: {}", if v == 0 { "off" } else { "on" }); }
        }
        if let Some(k) = hklm(r"SOFTWARE\NVIDIA Corporation\Global\NVTweak") {
            if let Some(v) = number(&k, "OptimusEnable") { let _ = writeln!(out, "NVIDIA Optimus: {v}"); }
        }
        out
    }

    /// Run a Windows tool without a console window, for at most `secs`, and keep what it printed.
    fn run(exe: &str, args: &[&str], secs: u64) -> Option<String> {
        use std::os::windows::process::CommandExt;
        use std::process::{Command, Stdio};
        let mut child = Command::new(exe).args(args).creation_flags(0x0800_0000).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().ok()?;
        let mut out = child.stdout.take()?;
        let reader = std::thread::spawn(move || { let mut b = Vec::new(); let _ = std::io::Read::read_to_end(&mut out, &mut b); b });
        let start = std::time::Instant::now();
        loop {
            if child.try_wait().ok().flatten().is_some() { break; }
            if start.elapsed() > Duration::from_secs(secs) { let _ = child.kill(); return Some(format!("({exe} took longer than {secs} s)")); }
            std::thread::sleep(Duration::from_millis(50));
        }
        Some(String::from_utf8_lossy(&reader.join().ok()?).into_owned())
    }

    const WEEK_MS: u64 = 7 * 24 * 3600 * 1000;

    /// Entries from the graphics drivers (NVIDIA's nvlddmkm, AMD's, Intel's) and the display driver resets Windows
    /// logs as "Display" 4101, newest first.
    pub fn driver_events() -> String {
        let providers = ["Display", "nvlddmkm", "amdkmdag", "amdwddmg", "igfx", "igfxn", "igfxnd", "iaStorA"].iter()
            .map(|p| format!("Provider[@Name='{p}']")).collect::<Vec<_>>().join(" or ");
        let q = format!("/q:*[System[({providers}) and TimeCreated[timediff(@SystemTime) <= {WEEK_MS}]]]");
        match run("wevtutil", &["qe", "System", &q, "/c:15", "/rd:true", "/f:text"], 10) {
            Some(t) if t.trim().is_empty() => "none".into(),
            Some(t) => t,
            None => "couldn't read the event log".into(),
        }
    }

    /// Crashes and hangs of gachamod and WebView2, and the graphics resets Windows reports as LiveKernelEvent
    /// (141 and 117 are a graphics card that stopped answering).
    pub fn app_events() -> String {
        let q = format!("/q:*[System[(Provider[@Name='Application Error'] or Provider[@Name='Application Hang'] or Provider[@Name='Windows Error Reporting']) and TimeCreated[timediff(@SystemTime) <= {WEEK_MS}]]]");
        let Some(all) = run("wevtutil", &["qe", "Application", &q, "/c:300", "/rd:true", "/f:text"], 10) else { return "couldn't read the event log".into() };
        let keep: Vec<&str> = all.split("Event[").filter(|e| {
            let l = e.to_ascii_lowercase();
            l.contains("msedgewebview2") || l.contains("gachamod") || l.contains("livekernelevent")
        }).take(10).collect();
        if keep.is_empty() { "none".into() } else { keep.iter().map(|e| format!("Event[{}", e.trim_end())).collect::<Vec<_>>().join("\r\n") }
    }

    /// How long since the last key press or mouse move.
    pub fn idle() -> Duration {
        use windows_sys::Win32::System::SystemInformation::GetTickCount;
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
        // SAFETY: a struct sized as the API asks.
        unsafe {
            let mut li = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
            if GetLastInputInfo(&mut li) == 0 { return Duration::ZERO; }
            Duration::from_millis(GetTickCount().wrapping_sub(li.dwTime) as u64)
        }
    }

    /// Windows marks the window as not answering (its thread hasn't read messages for five seconds).
    pub fn ui_hung(hwnd: isize) -> bool {
        use windows_sys::Win32::UI::WindowsAndMessaging::IsHungAppWindow;
        // SAFETY: a window handle; a stale one just answers false.
        unsafe { IsHungAppWindow(hwnd as _) != 0 }
    }

    /// Read the screen where the window's inside is, in a grid of 48 by 30 points. Only while the window is shown,
    /// not minimized, with no other window over it, and the screen is awake (input in the last 50 seconds): a window
    /// covering it or a screen turned off would read as black. It need not have focus.
    pub fn screen_check(hwnd: isize) -> Option<ScreenCheck> {
        use windows_sys::Win32::Foundation::{POINT, RECT};
        use windows_sys::Win32::Graphics::Gdi::{
            ClientToScreen, CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, GetMonitorInfoW, MonitorFromWindow, ReleaseDC,
            SelectObject, SetStretchBltMode, StretchBlt, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, COLORONCOLOR, DIB_RGB_COLORS, MONITORINFO,
            MONITOR_DEFAULTTONEAREST, SRCCOPY,
        };
        use windows_sys::Win32::UI::WindowsAndMessaging::{GetClientRect, GetForegroundWindow, IsChild, IsIconic, IsWindowVisible, WindowFromPoint};
        const W: i32 = 48;
        const H: i32 = 30;
        if idle() > Duration::from_secs(50) { return None; }
        let h = hwnd as windows_sys::Win32::Foundation::HWND;
        // SAFETY: GDI objects made here are selected out and deleted before returning; the bitmap's bits are read
        // only while it exists, and it holds W*H 32-bit pixels.
        unsafe {
            // no window in front at all: the lock screen or another desktop is showing
            if GetForegroundWindow().is_null() || IsWindowVisible(h) == 0 || IsIconic(h) != 0 { return None; }
            let mut rc: RECT = std::mem::zeroed();
            if GetClientRect(h, &mut rc) == 0 { return None; }
            let mut tl = POINT { x: 0, y: 0 };
            ClientToScreen(h, &mut tl);
            let mut mi: MONITORINFO = std::mem::zeroed();
            mi.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
            if GetMonitorInfoW(MonitorFromWindow(h, MONITOR_DEFAULTTONEAREST), &mut mi) == 0 { return None; }
            let m = mi.rcMonitor;
            // the inside of the window that is on its screen, less a few pixels at the edges
            let x0 = (tl.x + 4).max(m.left);
            let y0 = (tl.y + 4).max(m.top);
            let x1 = (tl.x + rc.right - 4).min(m.right);
            let y1 = (tl.y + rc.bottom - 4).min(m.bottom);
            let (w, hgt) = (x1 - x0, y1 - y0);
            if w < 100 || hgt < 100 { return None; }
            // another window over any of it would be read instead: each point of a 5 by 4 grid must be the window's own
            for i in 0..20 {
                let at = WindowFromPoint(POINT { x: x0 + w * (2 * (i % 5) + 1) / 10, y: y0 + hgt * (2 * (i / 5) + 1) / 8 });
                if at != h && IsChild(h, at) == 0 { return None; }
            }
            let screen = GetDC(std::ptr::null_mut());
            if screen.is_null() { return None; }
            let mem = CreateCompatibleDC(screen);
            let mut bmi: BITMAPINFO = std::mem::zeroed();
            bmi.bmiHeader = BITMAPINFOHEADER { biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32, biWidth: W, biHeight: -H, biPlanes: 1, biBitCount: 32, biCompression: BI_RGB, ..std::mem::zeroed() };
            let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
            let bmp = CreateDIBSection(mem, &bmi, DIB_RGB_COLORS, &mut bits, std::ptr::null_mut(), 0);
            let mut result = None;
            if !mem.is_null() && !bmp.is_null() && !bits.is_null() {
                let old = SelectObject(mem, bmp);
                SetStretchBltMode(mem, COLORONCOLOR);
                if StretchBlt(mem, 0, 0, W, H, screen, x0, y0, w, hgt, SRCCOPY) != 0 {
                    // BGRA: the first three bytes are the colour either way round
                    let px = std::slice::from_raw_parts(bits as *const u8, (W * H * 4) as usize);
                    result = darkness(px, 4).map(|d| ScreenCheck { darkness: d, area: (x0, y0, w, hgt) });
                }
                SelectObject(mem, old);
            }
            if !bmp.is_null() { DeleteObject(bmp); }
            if !mem.is_null() { DeleteDC(mem); }
            ReleaseDC(std::ptr::null_mut(), screen);
            result
        }
    }

    #[cfg(test)]
    mod tests {
        #[test]
        fn nvidia_driver_numbers() {
            assert_eq!(super::nvidia_version("32.0.15.6094").as_deref(), Some("560.94"));
            assert_eq!(super::nvidia_version("31.0.15.5222").as_deref(), Some("552.22"));
            assert_eq!(super::nvidia_version("1.2"), None);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn darkness_counts_black_pixels() {
        let black = [0u8, 0, 0, 255].repeat(100);
        let d = darkness(&black, 4).unwrap();
        assert!(d.black());
        // the ZZZ theme's near-black background isn't black
        let mut mixed = [7u8, 7, 7, 255].repeat(99);
        mixed.extend([0, 0, 0, 255]);
        let d = darkness(&mixed, 4).unwrap();
        assert!(!d.black(), "{d:?}");
        assert!((d.black_share - 0.01).abs() < 1e-6);
    }

    #[test]
    fn png_darkness_reads_a_picture() {
        let mut png = Vec::new();
        image::RgbImage::from_pixel(8, 8, image::Rgb([0, 0, 0])).write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png).unwrap();
        assert!(png_darkness(&png).unwrap().black());
        let mut light = Vec::new();
        image::RgbImage::from_pixel(8, 8, image::Rgb([200, 200, 200])).write_to(&mut std::io::Cursor::new(&mut light), image::ImageFormat::Png).unwrap();
        let d = png_darkness(&light).unwrap();
        assert!(!d.black() && d.mean > 190.0);
    }

    #[test]
    fn tails_and_cuts_stay_on_lines_and_chars() {
        assert_eq!(tail_of("one\ntwo\nthree\n", 8), "three\n");
        assert_eq!(tail_of("short", 100), "short");
        assert!(cut_at("héllo", 2).starts_with('h'));
        assert_eq!(crlf("a\nb\r\nc"), "a\r\nb\r\nc");
    }
}
