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
/// Sign-in starts off (Settings > Account turns it on).
const ON_KEY: &str = "account.gbSignIn";

fn state_of(st: &AppState) -> AccountState {
    let db = st.db.lock().ok();
    let available = db.as_ref().and_then(|d| d.setting(ON_KEY).ok().flatten()).as_deref() == Some("1");
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

/// Open GameBanana's login page. Resolves when the window is open; the result arrives as the "gb-account" event.
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
    WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::External(url))
        .title("Sign in to GameBanana")
        .inner_size(520.0, 760.0)
        .data_directory(acc::login_data_dir(&data_dir))
        .on_page_load(move |w, p| {
            if p.event() != PageLoadEvent::Finished || p.url().host_str() != Some("gamebanana.com") { return; }
            // still on the login or code pages: nothing to read yet
            if p.url().path().starts_with("/members/account") || done.load(Ordering::SeqCst) { return; }
            let (w, data_dir, db, http, done, app) = (w.clone(), data_dir.clone(), db.clone(), http.clone(), done.clone(), handle.clone());
            // cookies are read off this callback's thread: WebView2's cookie calls deadlock inside it
            std::thread::spawn(move || {
                let Ok(url) = "https://gamebanana.com/".parse() else { return };
                let Ok(jar) = w.cookies_for_url(url) else { return };
                let header = acc::cookie_header(jar.iter().map(|c| (c.name(), c.value())));
                if header.is_empty() { return; }
                let Ok(Some(user)) = tauri::async_runtime::block_on(acc::whoami(&http, &header)) else { return };
                if done.swap(true, Ordering::SeqCst) { return; }
                if acc::save_cookie(&data_dir, &header).is_err() { done.store(false, Ordering::SeqCst); return; }
                let available = if let Ok(d) = db.lock() {
                    let _ = d.set_setting_json(USER_KEY, &user);
                    d.setting(ON_KEY).ok().flatten().as_deref() == Some("1")
                } else { true };
                let _ = app.emit("gb-account", AccountState { available, user: Some(user) });
                let _ = w.close();
            });
        })
        .build()
        .map_err(|e| Error::Invalid(format!("Couldn't open the sign-in window: {e}")))?;
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
