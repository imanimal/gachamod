//! GameBanana sign-in (docs/gb-account.md): GameBanana's own login page in a separate window with its own browser data,
//! then the session cookie is read from that window, checked, stored encrypted and the window closes. The page gets no
//! Tauri commands (the capability is bound to the main window only). Owner: ACCOUNT area.
use crate::state::AppState;
use gacha_core::gb_account::{self as acc, AccountState, GbUser};
use gacha_core::{Error, Result};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

const LABEL: &str = "gb-login";
const USER_KEY: &str = "account.gbUser";
/// Sign-in is on unless Settings, GameBanana account turned it off ("0"). Clicking Sign in turns it back on.
const ON_KEY: &str = "account.gbSignIn";

fn state_of(st: &AppState) -> AccountState {
    let db = st.db.lock().ok();
    let available = db.as_ref().and_then(|d| d.setting(ON_KEY).ok().flatten()).as_deref() != Some("0");
    let has_cookie = st.data_dir.join("gb-session.bin").is_file();
    let user = if has_cookie { db.as_ref().and_then(|d| d.setting_json::<GbUser>(USER_KEY).ok().flatten()) } else { None };
    AccountState { available, user }
}

fn cookie(st: &AppState) -> Result<String> {
    acc::load_cookie(&st.data_dir).ok_or_else(|| Error::Invalid(acc::SIGNED_OUT.into()))
}

/// After a request: a dead session is forgotten and the UI told, once.
fn check<T>(app: &AppHandle, st: &AppState, r: Result<T>) -> Result<T> {
    if let Err(e) = &r {
        if acc::is_signed_out(e) {
            acc::forget(&st.data_dir);
            if let Ok(d) = st.db.lock() { let _ = d.clear_setting(USER_KEY); }
            let _ = app.emit("gb-account", state_of(st));
        }
    }
    r
}

#[tauri::command]
pub async fn gb_account(st: State<'_, AppState>) -> Result<AccountState> { Ok(state_of(&st)) }

/// Read the login window's cookies and ask GameBanana who they belong to. Ok(true) once signed in (the cookie is
/// stored and the UI told), Ok(false) when nobody is signed in there yet. Never logs the cookie.
fn finish_sign_in(w: &tauri::WebviewWindow, data_dir: &std::path::Path, db: &gacha_core::db::Shared, http: &reqwest::Client, done: &AtomicBool, app: &AppHandle) -> std::result::Result<bool, String> {
    if done.load(Ordering::SeqCst) { return Ok(true); }
    let url = "https://gamebanana.com/".parse().map_err(|_| "bad address".to_string())?;
    let jar = w.cookies_for_url(url).map_err(|e| format!("couldn't read the window's cookies: {e}"))?;
    let header = acc::cookie_header(jar.iter().map(|c| (c.name(), c.value())));
    if header.is_empty() { return Ok(false); }
    let user = match tauri::async_runtime::block_on(acc::whoami(http, &header)) {
        Ok(Some(u)) => u,
        Ok(None) => return Ok(false),
        Err(e) => return Err(format!("GameBanana didn't answer: {e}")),
    };
    if done.swap(true, Ordering::SeqCst) { return Ok(true); }
    if let Err(e) = acc::save_cookie(data_dir, &header) { done.store(false, Ordering::SeqCst); return Err(e.to_string()); }
    let available = if let Ok(d) = db.lock() {
        let _ = d.set_setting_json(USER_KEY, &user);
        d.setting(ON_KEY).ok().flatten().as_deref() != Some("0")
    } else { true };
    gacha_core::logs::info(format!("Signed in to GameBanana as member {}", user.id));
    let _ = app.emit("gb-account", AccountState { available, user: Some(user) });
    let _ = w.close();
    Ok(true)
}

/// Open GameBanana's login page. Resolves when the window is open; the result arrives as the "gb-account" event.
/// Every page the window finishes loading (after the login page) is checked, and closing the window checks once
/// more, so a sign-in that landed on any page still counts.
#[tauri::command]
pub async fn gb_sign_in(app: AppHandle, st: State<'_, AppState>) -> Result<()> {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.unminimize();
        let _ = w.set_focus();
        return Ok(());
    }
    let url = acc::LOGIN_URL.parse().map_err(|_| Error::Invalid("Bad sign-in address".into()))?;
    let data_dir: PathBuf = st.data_dir.clone();
    let db = st.db.clone();
    let http = st.http.clone();
    let done = Arc::new(AtomicBool::new(false));
    let handle = app.clone();
    let mut builder = WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::External(url))
        .title("Sign in to GameBanana")
        .inner_size(520.0, 760.0)
        .data_directory(acc::login_data_dir(&data_dir));
    // a small window that belongs to gachamod's: it stays in front of it and over its middle
    if let Some(main) = app.get_webview_window("main") {
        builder = builder.parent(&main).map_err(|e| Error::Invalid(format!("Couldn't open the sign-in window: {e}")))?;
        if let (Ok(pos), Ok(size), Ok(scale)) = (main.outer_position(), main.outer_size(), main.scale_factor()) {
            let (w, h) = (520.0 * scale, 760.0 * scale);
            let x = pos.x as f64 + (size.width as f64 - w) / 2.0;
            let y = pos.y as f64 + ((size.height as f64 - h) / 2.0).max(0.0);
            builder = builder.position(x / scale, y / scale);
        }
    } else {
        builder = builder.center();
    }
    let (data2, db2, http2, done2, app2) = (data_dir.clone(), db.clone(), http.clone(), done.clone(), app.clone());
    let window = builder
        .on_page_load(move |w, p| {
            let host = p.url().host_str().unwrap_or_default().to_ascii_lowercase();
            if p.event() != PageLoadEvent::Finished || !(host == "gamebanana.com" || host.ends_with(".gamebanana.com")) { return; }
            // the login page is checked too: a member already signed in there is done at once
            if done.load(Ordering::SeqCst) { return; }
            let (w, data_dir, db, http, done, app) = (w.clone(), data_dir.clone(), db.clone(), http.clone(), done.clone(), handle.clone());
            // cookies are read off this callback's thread: WebView2's cookie calls deadlock inside it
            std::thread::spawn(move || {
                if let Err(e) = finish_sign_in(&w, &data_dir, &db, &http, &done, &app) { gacha_core::logs::warn(format!("GameBanana sign-in: {e}")); }
            });
        })
        .build()
        .map_err(|e| Error::Invalid(format!("Couldn't open the sign-in window: {e}")))?;
    // closing the window checks once more (the user may have signed in and closed it from GameBanana's home page)
    let closing = Arc::new(AtomicBool::new(false));
    let w2 = window.clone();
    window.on_window_event(move |e| match e {
        tauri::WindowEvent::CloseRequested { api, .. } if !done2.load(Ordering::SeqCst) && !closing.swap(true, Ordering::SeqCst) => {
            api.prevent_close();
            let (w, data_dir, db, http, done, app) = (w2.clone(), data2.clone(), db2.clone(), http2.clone(), done2.clone(), app2.clone());
            std::thread::spawn(move || {
                let r = finish_sign_in(&w, &data_dir, &db, &http, &done, &app);
                if !matches!(r, Ok(true)) {
                    let why = match r {
                        Err(e) => { gacha_core::logs::warn(format!("GameBanana sign-in: {e}")); Some(e) }
                        _ => None,
                    };
                    let _ = app.emit("gb-login-closed", why);
                    let _ = w.destroy();
                }
            });
        }
        _ => {}
    });
    Ok(())
}

#[tauri::command]
pub async fn gb_sign_out(app: AppHandle, st: State<'_, AppState>) -> Result<AccountState> {
    if let Some(w) = app.get_webview_window(LABEL) { let _ = w.close(); }
    acc::forget(&st.data_dir);
    if let Ok(d) = st.db.lock() { let _ = d.clear_setting(USER_KEY); }
    let s = state_of(&st);
    let _ = app.emit("gb-account", s.clone());
    Ok(s)
}

/// Follow a creator on GameBanana, or stop. One request per click.
#[tauri::command]
pub async fn gb_follow(app: AppHandle, st: State<'_, AppState>, member: u64, on: bool) -> Result<()> {
    let c = cookie(&st)?;
    let r = acc::follow(&st.http, &c, member, on).await;
    check(&app, &st, r)
}

#[tauri::command]
pub async fn gb_like(app: AppHandle, st: State<'_, AppState>, mod_id: u64, on: bool) -> Result<()> {
    let c = cookie(&st)?;
    let r = acc::like(&st.http, &c, mod_id, on).await;
    check(&app, &st, r)
}

/// The creators the signed-in member follows on GameBanana.
#[tauri::command]
pub async fn gb_following(app: AppHandle, st: State<'_, AppState>) -> Result<Vec<GbUser>> {
    let c = cookie(&st)?;
    let Some(me) = state_of(&st).user else { return Err(Error::Invalid(acc::SIGNED_OUT.into())) };
    let r = acc::following(&st.http, &c, me.id).await;
    check(&app, &st, r)
}
