//! GameBanana sign-in (docs/gb-account.md): GameBanana's own login page in a separate window with its own browser data.
//! Each page that window loads asks GameBanana, from inside the page, whether someone is signed in. Once someone is,
//! the window's cookies are read, stored encrypted and the window closes. The page gets no Tauri commands (the
//! capability is bound to the main window only). Owner: ACCOUNT area.
use crate::state::AppState;
use gacha_core::gb_account::{self as acc, AccountState, GbUser};
use gacha_core::{Error, Result};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

const LABEL: &str = "gb-login";
const USER_KEY: &str = "account.gbUser";
/// Sign-in is on unless Settings, GameBanana account turned it off ("0"). Clicking Sign in turns it back on.
const ON_KEY: &str = "account.gbSignIn";
/// The sign-in window's browser name, sent with the session's requests (gb_account::set_user_agent).
const UA_KEY: &str = "account.gbBrowser";

fn state_of(st: &AppState) -> AccountState {
    let db = st.db.lock().ok();
    let available = db.as_ref().and_then(|d| d.setting(ON_KEY).ok().flatten()).as_deref() != Some("0");
    let has_cookie = st.data_dir.join("gb-session.bin").is_file();
    let user = if has_cookie { db.as_ref().and_then(|d| d.setting_json::<GbUser>(USER_KEY).ok().flatten()) } else { None };
    AccountState { available, user }
}

fn cookie(st: &AppState) -> Result<String> {
    if let Some(ua) = st.db.lock().ok().and_then(|d| d.setting(UA_KEY).ok().flatten()) { acc::set_user_agent(&ua); }
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

/// Asked inside the sign-in page, so it goes with that window's own cookies and browser: is someone signed in, and
/// who. Synchronous, since a script's promise doesn't come back through eval on Windows.
const CHECK_JS: &str = r#"(function () {
  try {
    var x = new XMLHttpRequest();
    x.open("GET", "/apiv13/Member/UiConfig", false);
    x.setRequestHeader("Accept", "application/json");
    x.send();
    var j = JSON.parse(x.responseText);
    var m = j._aMember || {};
    return JSON.stringify({ signedIn: !!j._bIsLoggedIn, id: Number(j._idMemberRow || j._idRow || m._idRow || 0) || 0,
      name: j._sName || j._sUsername || m._sName || "", avatar: j._sAvatarUrl || m._sAvatarUrl || "", ua: navigator.userAgent });
  } catch (e) { return JSON.stringify({ error: String(e) }); }
})()"#;

#[derive(serde::Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct PageCheck { signed_in: bool, id: u64, name: String, avatar: String, ua: String, error: Option<String> }

/// What the page said. eval hands back the script's value as JSON: here a JSON string that holds JSON.
fn page_check(raw: &str) -> PageCheck {
    let inner: String = serde_json::from_str(raw).unwrap_or_else(|_| raw.to_string());
    serde_json::from_str(&inner).unwrap_or_default()
}

/// Run the check in the window and wait for its answer. None when the page didn't answer in time.
fn ask_page(w: &tauri::WebviewWindow) -> Option<PageCheck> {
    let (tx, rx) = std::sync::mpsc::channel();
    if w.eval_with_callback(CHECK_JS, move |raw| { let _ = tx.send(page_check(&raw)); }).is_err() { return None; }
    rx.recv_timeout(Duration::from_secs(25)).ok()
}

/// The window's gamebanana.com cookies as one Cookie header. Tauri reads them on the main thread, so this waits from
/// another thread and gives up after a while instead of hanging the sign-in.
fn read_cookies(w: &tauri::WebviewWindow) -> std::result::Result<String, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    let w = w.clone();
    std::thread::spawn(move || {
        let r = w.cookies().map(|jar| {
            let ours: Vec<(String, String)> = jar.iter()
                .filter(|c| c.domain().map(|d| d.trim_start_matches('.').ends_with("gamebanana.com")).unwrap_or(true))
                .map(|c| (c.name().to_string(), c.value().to_string()))
                .collect();
            acc::cookie_header(ours.iter().map(|(n, v)| (n.as_str(), v.as_str())))
        });
        let _ = tx.send(r);
    });
    match rx.recv_timeout(Duration::from_secs(10)) {
        Ok(Ok(h)) if !h.is_empty() => Ok(h),
        Ok(Ok(_)) => Err("the window had no GameBanana cookies".into()),
        Ok(Err(e)) => Err(format!("couldn't read the window's cookies: {e}")),
        Err(_) => Err("reading the window's cookies took too long".into()),
    }
}

/// Everything the sign-in window needs to finish.
#[derive(Clone)]
struct Login { data_dir: PathBuf, db: gacha_core::db::Shared, http: reqwest::Client, done: Arc<AtomicBool>, app: AppHandle }

impl Login {
    /// Ask the page who is signed in, and if someone is, keep the session. Ok(true) once signed in (the cookie is
    /// stored, the UI told and the window closed), Ok(false) when nobody is signed in there yet. Never logs the cookie.
    fn finish(&self, w: &tauri::WebviewWindow) -> std::result::Result<bool, String> {
        if self.done.load(Ordering::SeqCst) { return Ok(true); }
        let Some(check) = ask_page(w) else { return Err("the GameBanana page didn't answer".into()) };
        if !check.signed_in {
            // a page that isn't GameBanana's own yet (a Cloudflare check) can't answer; the next page will
            if let Some(e) = check.error { gacha_core::logs::info(format!("GameBanana sign-in: the page couldn't check yet ({e})")); }
            return Ok(false);
        }
        if self.done.swap(true, Ordering::SeqCst) { return Ok(true); }
        let r = self.keep(w, check);
        if r.is_err() { self.done.store(false, Ordering::SeqCst); }
        r
    }

    fn keep(&self, w: &tauri::WebviewWindow, check: PageCheck) -> std::result::Result<bool, String> {
        let header = read_cookies(w)?;
        acc::set_user_agent(&check.ua);
        let asked = tauri::async_runtime::block_on(acc::whoami(&self.http, &header));
        let user = if check.id > 0 {
            // the page knows who; GameBanana's API adds the name and picture when it can
            let mut u = asked.ok().flatten().filter(|u| u.id == check.id)
                .unwrap_or(GbUser { id: check.id, name: format!("Member {}", check.id), avatar: None });
            if u.name.starts_with("Member ") && !check.name.is_empty() { u.name = check.name.clone(); }
            if u.avatar.is_none() && !check.avatar.is_empty() { u.avatar = Some(check.avatar.clone()); }
            u
        } else {
            match asked {
                Ok(Some(u)) => u,
                Ok(None) => return Err("GameBanana says you're signed in, but not as whom".into()),
                Err(e) => return Err(format!("GameBanana didn't answer: {e}")),
            }
        };
        acc::save_cookie(&self.data_dir, &header).map_err(|e| e.to_string())?;
        let available = if let Ok(d) = self.db.lock() {
            let _ = d.set_setting_json(USER_KEY, &user);
            let _ = d.set_setting(UA_KEY, &check.ua);
            d.setting(ON_KEY).ok().flatten().as_deref() != Some("0")
        } else { true };
        gacha_core::logs::info(format!("Signed in to GameBanana as member {}", user.id));
        let _ = self.app.emit("gb-account", AccountState { available, user: Some(user) });
        let _ = w.destroy();
        Ok(true)
    }
}

/// Open GameBanana's login page. Resolves when the window is open; the result arrives as the "gb-account" event.
/// Every GameBanana page the window finishes loading asks, inside the page, whether someone is signed in, and
/// closing the window asks once more, so a sign-in that landed on any page counts.
#[tauri::command]
pub async fn gb_sign_in(app: AppHandle, st: State<'_, AppState>) -> Result<()> {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.unminimize();
        let _ = w.set_focus();
        return Ok(());
    }
    let url = acc::LOGIN_URL.parse().map_err(|_| Error::Invalid("Bad sign-in address".into()))?;
    let login = Login { data_dir: st.data_dir.clone(), db: st.db.clone(), http: st.http.clone(), done: Arc::new(AtomicBool::new(false)), app: app.clone() };
    let mut builder = crate::browser_flags(WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::External(url)), crate::Flags::of(&app))
        .title("Sign in to GameBanana")
        .inner_size(520.0, 760.0)
        .data_directory(acc::login_data_dir(&login.data_dir));
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
    let on_load = login.clone();
    let window = builder
        .on_page_load(move |w, p| {
            let host = p.url().host_str().unwrap_or_default().to_ascii_lowercase();
            if p.event() != PageLoadEvent::Finished || !(host == "gamebanana.com" || host.ends_with(".gamebanana.com")) { return; }
            // the login page is checked too: a member already signed in there is done at once
            if on_load.done.load(Ordering::SeqCst) { return; }
            let (w, login) = (w.clone(), on_load.clone());
            // off this callback's thread: the page's answer and the cookies both come back through the main thread
            std::thread::spawn(move || {
                if let Err(e) = login.finish(&w) { gacha_core::logs::warn(format!("GameBanana sign-in: {e}")); }
            });
        })
        .build()
        .map_err(|e| Error::Invalid(format!("Couldn't open the sign-in window: {e}")))?;
    // closing the window checks once more (the user may have signed in and closed it from GameBanana's home page),
    // then always closes
    let closing = Arc::new(AtomicBool::new(false));
    let w2 = window.clone();
    window.on_window_event(move |e| match e {
        tauri::WindowEvent::CloseRequested { api, .. } if !login.done.load(Ordering::SeqCst) && !closing.swap(true, Ordering::SeqCst) => {
            api.prevent_close();
            let (w, login) = (w2.clone(), login.clone());
            std::thread::spawn(move || {
                let r = login.finish(&w);
                if !matches!(r, Ok(true)) {
                    let why = match r {
                        Err(e) => { gacha_core::logs::warn(format!("GameBanana sign-in: {e}")); Some(e) }
                        _ => None,
                    };
                    let _ = login.app.emit("gb-login-closed", why);
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
    if let Some(w) = app.get_webview_window(LABEL) { let _ = w.destroy(); }
    acc::forget(&st.data_dir);
    if let Ok(d) = st.db.lock() { let _ = d.clear_setting(USER_KEY); let _ = d.clear_setting(UA_KEY); }
    acc::set_user_agent("");
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
