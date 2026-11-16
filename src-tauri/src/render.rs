//! Rendering diagnostics for the app's windows; gacha_core::render_log keeps the files. This part hooks WebView2
//! (its processes exiting, its version and folders), logs window events, checks every two seconds that the main
//! window isn't black on screen, and takes what the page reports about its own frames (src/lib/renderWatch.ts). When
//! something goes wrong it looks at the window from every side at once (`probe`) and writes an incident file.
//! Owner: SYSTEM area.
use gacha_core::render_log as rl;
use std::sync::{mpsc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, Runtime, WebviewWindow, WindowEvent};

/// Setting "render.log": on unless "0".
pub fn setting(db: &gacha_core::db::Shared) -> bool {
    db.lock().ok().and_then(|d| d.setting("render.log").ok().flatten()).as_deref() != Some("0")
}

/// Log what happens to a window: focus, moves between screens, size, scale and theme changes.
pub fn watch_window<R: Runtime>(w: &WebviewWindow<R>) {
    struct Seen { moved: Instant, sized: Instant, screen: String }
    let label = w.label().to_string();
    let win = w.clone();
    let seen = Mutex::new(Seen { moved: Instant::now(), sized: Instant::now(), screen: screen_of(w) });
    rl::event(format!("{label}: window opened on {}", screen_of(w)));
    w.on_window_event(move |e| {
        let Ok(mut s) = seen.lock() else { return };
        match e {
            WindowEvent::Focused(f) => rl::event(format!("{label}: {}", if *f { "focused" } else { "lost focus" })),
            WindowEvent::Moved(p) => {
                let screen = screen_of(&win);
                if screen != s.screen { rl::event(format!("{label}: moved to {screen}, at {},{}", p.x, p.y)); s.screen = screen; }
                else if s.moved.elapsed() > Duration::from_secs(2) { rl::event(format!("{label}: moved to {},{}", p.x, p.y)); }
                s.moved = Instant::now();
            }
            WindowEvent::Resized(z) => {
                let state = if win.is_minimized().unwrap_or(false) { " (minimized)" } else if win.is_maximized().unwrap_or(false) { " (maximized)" } else { "" };
                if !state.is_empty() || s.sized.elapsed() > Duration::from_secs(2) { rl::event(format!("{label}: size {}x{}{state}", z.width, z.height)); }
                s.sized = Instant::now();
            }
            WindowEvent::ScaleFactorChanged { scale_factor, .. } => rl::event(format!("{label}: scale changed to {scale_factor}")),
            WindowEvent::ThemeChanged(t) => rl::event(format!("{label}: Windows theme changed to {t:?}")),
            WindowEvent::Destroyed => rl::event(format!("{label}: window closed")),
            _ => {}
        }
    });
}

fn screen_of<R: Runtime>(w: &WebviewWindow<R>) -> String {
    match w.current_monitor() {
        Ok(Some(m)) => format!("screen {} ({}x{}, scale {})", m.name().map(|n| n.trim_start_matches(r"\\.\")).unwrap_or("?"), m.size().width, m.size().height, m.scale_factor()),
        _ => "no screen".into(),
    }
}

/// What this run's windows started with, and the screens as gachamod sees them, for system.txt. Off the main thread.
pub fn write_system<R: Runtime>(app: &AppHandle<R>, gpu: bool, log: bool) {
    let flags = crate::browser_args(gpu, log);
    rl::write_system(&format!(
        "gachamod {} rendering details, {}\r\nHardware acceleration: {}\r\nWebView2 flags: {flags}",
        env!("CARGO_PKG_VERSION"), chrono::Local::now().format("%Y-%m-%d %H:%M:%S"), if gpu { "on" } else { "off" },
    ));
    let screens: String = app.available_monitors().unwrap_or_default().iter().map(|m| format!(
        "{}: {}x{} at {},{}, scale {}\r\n", m.name().map(|n| n.trim_start_matches(r"\\.\")).unwrap_or("?"), m.size().width, m.size().height, m.position().x, m.position().y, m.scale_factor(),
    )).collect();
    rl::system_section("Screens as gachamod sees them", &screens);
}

/// Hook a window's WebView2: its version and folders (main window), and its processes exiting.
pub fn hook_webview<R: Runtime>(w: &WebviewWindow<R>) {
    #[cfg(windows)]
    {
        let label = w.label().to_string();
        let app = w.app_handle().clone();
        let _ = w.with_webview(move |pv| {
            // SAFETY: on the main thread, with the window's own WebView2 objects.
            if let Err(e) = unsafe { wv::hook(&label, &pv, app) } { rl::event(format!("{label}: couldn't hook WebView2 ({e})")); }
        });
    }
    #[cfg(not(windows))]
    let _ = w;
}

/// Look at a window from every side: Windows' view (in front, not answering), the screen, WebView2's view (visible,
/// its processes, a picture of the page) and the page's own (frames). Waits up to five seconds, off
/// the main thread. Returns the text and the picture.
pub fn probe<R: Runtime>(w: &WebviewWindow<R>) -> (String, Option<Vec<u8>>) {
    let mut out = String::new();
    let label = w.label().to_string();
    out.push_str(&format!("Window {label}: {}{}{}\r\n",
        if w.is_visible().unwrap_or(false) { "shown" } else { "hidden" },
        if w.is_minimized().unwrap_or(false) { ", minimized" } else { "" },
        if w.is_focused().unwrap_or(false) { ", focused" } else { ", not focused" }));
    if let Ok(size) = w.inner_size() { out.push_str(&format!("Size {}x{} on {}\r\n", size.width, size.height, screen_of(w))); }
    #[cfg(windows)]
    if let Ok(h) = w.hwnd() {
        let h = h.0 as isize;
        if rl::ui_hung(h) { out.push_str("Windows says the window isn't answering\r\n"); }
        match rl::screen_check(h) {
            Some(c) => out.push_str(&format!("{}\r\n", c.describe())),
            None => out.push_str("On screen: not read (the window isn't in front, or nobody has used the PC for a minute)\r\n"),
        }
    }
    out.push_str(&format!("Last key press or mouse move: {:.1} s ago\r\n", rl::idle().as_secs_f32()));
    let mut picture = None;
    #[cfg(windows)]
    {
        let (tx, rx) = mpsc::channel::<wv::Part>();
        let asked = Instant::now();
        if let Err(e) = w.with_webview(move |pv| { unsafe { wv::probe(&pv, tx) } }) { out.push_str(&format!("WebView2 couldn't be asked: {e}\r\n")); }
        let deadline = asked + Duration::from_secs(5);
        let mut got_ui = false;
        let mut left = 4;
        while left > 0 {
            let Some(wait) = deadline.checked_duration_since(Instant::now()) else { break };
            match rx.recv_timeout(wait) {
                Ok(wv::Part::Ui) => { got_ui = true; left -= 1; out.push_str(&format!("The app's main thread answered after {} ms\r\n", asked.elapsed().as_millis())); }
                Ok(wv::Part::Text(t)) => { left -= 1; out.push_str(&t); out.push_str("\r\n"); }
                Ok(wv::Part::Picture(Ok(png))) => {
                    left -= 1;
                    let d = rl::png_darkness(&png).map(|d| d.describe()).unwrap_or_else(|| "couldn't be read".into());
                    out.push_str(&format!("WebView2's picture of the page: {d}\r\n"));
                    picture = Some(png);
                }
                Ok(wv::Part::Picture(Err(e))) => { left -= 1; out.push_str(&format!("WebView2's picture of the page: failed ({e})\r\n")); }
                Err(_) => break,
            }
        }
        if !got_ui { out.push_str("The app's main thread didn't answer within 5 s\r\n"); }
        else if left > 0 { out.push_str(&format!("{left} answer(s) from WebView2 didn't come within 5 s\r\n")); }
    }
    (out, picture)
}

/// Every two seconds: the main window not black on screen and answering, the screens unchanged, and no long gap
/// (the PC asleep).
pub fn start<R: Runtime>(app: AppHandle<R>) {
    let _ = std::thread::Builder::new().name("render-watch".into()).spawn(move || {
        // the first frames and the theme's own first paint
        std::thread::sleep(Duration::from_secs(10));
        let mut screens = rl::displays();
        let mut black_ticks = 0u32;
        let mut black: Option<(Instant, Option<std::path::PathBuf>)> = None;
        let mut hung: Option<(Instant, bool)> = None;
        let mut tick = Instant::now();
        loop {
            std::thread::sleep(Duration::from_secs(2));
            let gap = tick.elapsed();
            tick = Instant::now();
            if !rl::on() { continue; }
            if gap > Duration::from_secs(20) { rl::event(format!("No check ran for {} s: the PC slept or gachamod was paused", gap.as_secs())); }
            let now_screens = rl::displays();
            if now_screens != screens { rl::event(format!("Screens changed:\n{now_screens}")); screens = now_screens; }
            let Some(w) = app.get_webview_window("main") else { continue };
            #[cfg(windows)]
            {
                let Ok(h) = w.hwnd() else { continue };
                let h = h.0 as isize;
                // the main thread stopped reading messages
                if rl::ui_hung(h) {
                    let (since, told) = hung.get_or_insert((Instant::now(), false));
                    if !*told && since.elapsed() > Duration::from_secs(4) {
                        *told = true;
                        rl::event("main: Windows says the window isn't answering");
                        let (check, png) = probe(&w);
                        rl::incident("hung", "The main window stopped answering Windows", "Windows marked gachamod's window as not answering (its main thread hasn't read messages for 5 s or more)", &check, png.as_deref());
                    }
                } else if let Some((since, _)) = hung.take() {
                    rl::event(format!("main: answering again after about {} s", since.elapsed().as_secs() + 5));
                }
                match rl::screen_check(h) {
                    Some(c) if c.darkness.black() => {
                        black_ticks += 1;
                        if black_ticks == 2 && black.is_none() {
                            let what = format!("The main window was black on screen for two checks in a row, 2 s apart, while it was in front. {}", c.describe());
                            rl::event(format!("main: black on screen. {}", c.describe()));
                            let (check, png) = probe(&w);
                            let file = rl::incident("black", "The main window was black on screen", &what, &check, png.as_deref());
                            black = Some((Instant::now() - Duration::from_secs(2), file));
                        }
                    }
                    Some(c) => {
                        black_ticks = 0;
                        if let Some((since, file)) = black.take() {
                            let line = format!("main: drew again after {:.0} s ({})", since.elapsed().as_secs_f32(), c.darkness.describe());
                            rl::event(&line);
                            if let Some(f) = file { rl::add_to(&f, &line); }
                        }
                    }
                    None => {}
                }
            }
            #[cfg(not(windows))]
            let _ = (&w, &mut black_ticks, &mut black, &mut hung);
        }
    });
}

/// One thing the page noticed (src/lib/renderWatch.ts). `incident` is the kind when it's a problem worth a file.
#[derive(serde::Deserialize)]
pub struct PageEvent {
    text: String,
    #[serde(default)]
    incident: Option<String>,
    #[serde(default)]
    title: Option<String>,
}

/// What the page noticed about its frames, stalls and WebGL contexts.
#[tauri::command]
pub fn render_events(window: WebviewWindow, events: Vec<PageEvent>) {
    if !rl::on() { return; }
    let label = window.label().to_string();
    for e in events.into_iter().take(50) {
        rl::event(format!("{label} page: {}", e.text));
        let Some(kind) = e.incident else { continue };
        // a minimized window stops drawing on purpose
        if window.is_minimized().unwrap_or(false) { continue; }
        let w = window.clone();
        let title = e.title.unwrap_or_else(|| "The page reported a drawing problem".into());
        std::thread::spawn(move || {
            let (check, png) = probe(&w);
            rl::incident(&format!("page-{kind}"), &title, &e.text, &check, png.as_deref());
        });
    }
}

#[derive(serde::Serialize)]
pub struct RenderState { on: bool, dir: Option<String>, incidents: usize }

/// The rendering log's folder and how many incident files it holds.
#[tauri::command]
pub fn render_state() -> RenderState {
    RenderState { on: rl::on(), dir: rl::dir().map(|d| d.to_string_lossy().into_owned()), incidents: rl::incidents() }
}

#[cfg(windows)]
mod wv {
    use gacha_core::render_log as rl;
    use std::sync::mpsc::Sender;
    use tauri::{AppHandle, Runtime};
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use webview2_com::{take_pwstr, CapturePreviewCompletedHandler, ExecuteScriptCompletedHandler, ProcessFailedEventHandler};
    use windows::core::{w, Interface, BOOL, PWSTR};
    use windows::Win32::Foundation::HGLOBAL;
    use windows::Win32::System::Com::{IStream, StructuredStorage::CreateStreamOnHGlobal, STREAM_SEEK_SET};

    pub enum Part { Ui, Text(String), Picture(Result<Vec<u8>, String>) }

    fn kind_name(k: COREWEBVIEW2_PROCESS_FAILED_KIND) -> &'static str {
        match k {
            COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED => "WebView2's browser process exited",
            COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED => "the page's process exited",
            COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE => "the page's process stopped answering",
            COREWEBVIEW2_PROCESS_FAILED_KIND_FRAME_RENDER_PROCESS_EXITED => "a frame's process exited",
            COREWEBVIEW2_PROCESS_FAILED_KIND_UTILITY_PROCESS_EXITED => "a utility process exited",
            COREWEBVIEW2_PROCESS_FAILED_KIND_SANDBOX_HELPER_PROCESS_EXITED => "the sandbox helper exited",
            COREWEBVIEW2_PROCESS_FAILED_KIND_GPU_PROCESS_EXITED => "the GPU process exited",
            _ => "a WebView2 process failed",
        }
    }

    fn reason_name(r: COREWEBVIEW2_PROCESS_FAILED_REASON) -> &'static str {
        match r {
            COREWEBVIEW2_PROCESS_FAILED_REASON_UNEXPECTED => "unexpected",
            COREWEBVIEW2_PROCESS_FAILED_REASON_UNRESPONSIVE => "unresponsive",
            COREWEBVIEW2_PROCESS_FAILED_REASON_TERMINATED => "terminated",
            COREWEBVIEW2_PROCESS_FAILED_REASON_CRASHED => "crashed",
            COREWEBVIEW2_PROCESS_FAILED_REASON_LAUNCH_FAILED => "launch failed",
            COREWEBVIEW2_PROCESS_FAILED_REASON_OUT_OF_MEMORY => "out of memory",
            _ => "other",
        }
    }

    fn process_kind(k: COREWEBVIEW2_PROCESS_KIND) -> &'static str {
        match k {
            COREWEBVIEW2_PROCESS_KIND_BROWSER => "browser",
            COREWEBVIEW2_PROCESS_KIND_RENDERER => "page",
            COREWEBVIEW2_PROCESS_KIND_UTILITY => "utility",
            COREWEBVIEW2_PROCESS_KIND_SANDBOX_HELPER => "sandbox helper",
            COREWEBVIEW2_PROCESS_KIND_GPU => "GPU",
            _ => "other",
        }
    }

    /// WebView2's processes right now ("browser 1234, GPU 5678, page 9012").
    unsafe fn processes(env: &ICoreWebView2Environment) -> String {
        let Ok(e8) = env.cast::<ICoreWebView2Environment8>() else { return "unknown (WebView2 too old to say)".into() };
        let Ok(list) = e8.GetProcessInfos() else { return "unknown".into() };
        let mut n = 0u32;
        let _ = list.Count(&mut n);
        let mut v = Vec::new();
        for i in 0..n {
            let Ok(p) = list.GetValueAtIndex(i) else { continue };
            let (mut id, mut k) = (0i32, COREWEBVIEW2_PROCESS_KIND::default());
            let _ = p.ProcessId(&mut id);
            let _ = p.Kind(&mut k);
            v.push(format!("{} {id}", process_kind(k)));
        }
        let gpu = if v.iter().any(|p| p.starts_with("GPU ")) { "" } else { " (no GPU process)" };
        format!("{}{gpu}", v.join(", "))
    }

    pub unsafe fn hook<R: Runtime>(label: &str, pv: &tauri::webview::PlatformWebview, app: AppHandle<R>) -> windows::core::Result<()> {
        let _ = app;
        let controller = pv.controller();
        let env = pv.environment();
        let core = controller.CoreWebView2()?;
        let mut v = PWSTR::null();
        let version = if env.BrowserVersionString(&mut v).is_ok() { take_pwstr(v) } else { "unknown".into() };
        let data = env.cast::<ICoreWebView2Environment7>().ok().and_then(|e| { let mut p = PWSTR::null(); e.UserDataFolder(&mut p).ok()?; Some(take_pwstr(p)) });
        let reports = env.cast::<ICoreWebView2Environment11>().ok().and_then(|e| { let mut p = PWSTR::null(); e.FailureReportFolderPath(&mut p).ok()?; Some(take_pwstr(p)) });
        rl::webview_paths(data.clone().map(Into::into), reports.clone().map(Into::into));
        rl::event(format!("{label}: WebView2 {version} ready. Processes: {}", processes(&env)));
        if label == "main" {
            rl::system_section("WebView2", &format!("Version: {version}\r\nData folder: {}\r\nCrash dumps: {}",
                data.as_deref().unwrap_or("unknown"), reports.as_deref().unwrap_or("unknown")));
        }
        // a process exiting: the GPU process is shared, so every window hears about it; one incident a minute per kind
        let who = label.to_string();
        let env2 = env.clone();
        let mut token = 0i64;
        core.add_ProcessFailed(&ProcessFailedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else { return Ok(()) };
            let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
            args.ProcessFailedKind(&mut kind)?;
            let mut text = format!("{who}: {}", kind_name(kind));
            if let Ok(a) = args.cast::<ICoreWebView2ProcessFailedEventArgs2>() {
                let (mut reason, mut code) = (COREWEBVIEW2_PROCESS_FAILED_REASON::default(), 0i32);
                let _ = a.Reason(&mut reason);
                let _ = a.ExitCode(&mut code);
                let mut d = PWSTR::null();
                let desc = if a.ProcessDescription(&mut d).is_ok() { take_pwstr(d) } else { String::new() };
                text.push_str(&format!(" ({}, exit code {code} / 0x{:08X}{})", reason_name(reason), code as u32, if desc.is_empty() { String::new() } else { format!(", {desc}") }));
            }
            text.push_str(&format!(". Processes now: {}", processes(&env2)));
            gacha_core::logs::warn(&text);
            rl::event(&text);
            let short = match kind {
                COREWEBVIEW2_PROCESS_FAILED_KIND_GPU_PROCESS_EXITED => ("gpu-exit", "WebView2's GPU process exited"),
                COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED => ("page-exit", "The page's process exited"),
                COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE => ("page-hung", "The page's process stopped answering"),
                COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED => ("browser-exit", "WebView2's browser process exited"),
                _ => ("other-exit", "A WebView2 process exited"),
            };
            std::thread::spawn(move || { rl::incident(short.0, short.1, &text, "(the window was not probed: WebView2 may be restarting the process)", None); });
            Ok(())
        })), &mut token)?;
        Ok(())
    }

    unsafe fn read_stream(s: &IStream) -> Result<Vec<u8>, String> {
        s.Seek(0, STREAM_SEEK_SET, None).map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            let mut read = 0u32;
            let hr = s.Read(buf.as_mut_ptr().cast(), buf.len() as u32, Some(&mut read));
            if hr.is_err() { return Err(hr.message()); }
            if read == 0 { break; }
            out.extend_from_slice(&buf[..read as usize]);
        }
        Ok(out)
    }

    /// The WebView2 side of `super::probe`: answers on `tx` as they come (four in all).
    pub unsafe fn probe(pv: &tauri::webview::PlatformWebview, tx: Sender<Part>) {
        let _ = tx.send(Part::Ui);
        let controller = pv.controller();
        let env = pv.environment();
        let mut visible = BOOL::default();
        let vis = if controller.IsVisible(&mut visible).is_ok() { if visible.as_bool() { "yes" } else { "no" } } else { "unknown" };
        let _ = tx.send(Part::Text(format!("WebView2 visible: {vis}. Processes: {}", processes(&env))));
        let Ok(core) = controller.CoreWebView2() else {
            for _ in 0..2 { let _ = tx.send(Part::Text("WebView2's page wasn't there".into())); }
            return;
        };
        // the page's own view: frames, focus, what it shows (renderWatch.ts)
        let t = tx.clone();
        let js = w!("typeof window.__gmRenderProbe === 'function' ? window.__gmRenderProbe() : 'the page has no probe'");
        if core.ExecuteScript(js, &ExecuteScriptCompletedHandler::create(Box::new(move |hr, json| {
            let text = match hr {
                Ok(()) => serde_json::from_str::<serde_json::Value>(&json).ok().and_then(|v| v.as_str().map(str::to_string)).unwrap_or(json),
                Err(e) => format!("failed ({e})"),
            };
            let _ = t.send(Part::Text(format!("The page says: {text}")));
            Ok(())
        }))).is_err() { let _ = tx.send(Part::Text("The page couldn't be asked".into())); }
        // what WebView2 thinks it drew
        let t = tx.clone();
        match CreateStreamOnHGlobal(HGLOBAL::default(), true) {
            Ok(stream) => {
                let s2 = stream.clone();
                if let Err(e) = core.CapturePreview(COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG, &stream, &CapturePreviewCompletedHandler::create(Box::new(move |hr| {
                    let _ = t.send(Part::Picture(hr.map_err(|e| e.to_string()).and_then(|_| read_stream(&s2))));
                    Ok(())
                }))) { let _ = tx.send(Part::Picture(Err(e.to_string()))); }
            }
            Err(e) => { let _ = tx.send(Part::Picture(Err(e.to_string()))); }
        }
    }
}
