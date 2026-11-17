//! Signing in to GameBanana (docs/gb-account.md). The user signs in on GameBanana's own page in a separate window
//! (src-tauri commands/account.rs); this keeps the session cookie that window ends up with, encrypted for the Windows
//! user (DPAPI), and makes the few calls a click asks for: follow or unfollow a creator, like, subscribe to or thank a
//! mod, and list who the member follows. The cookie never leaves this module except in requests to gamebanana.com, and the UI only ever gets
//! `{ id, name, avatar }`. Owner: ACCOUNT area.

use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

const API11: &str = "https://gamebanana.com/apiv11";
const API13: &str = "https://gamebanana.com/apiv13";
pub const LOGIN_URL: &str = "https://gamebanana.com/members/account/login";
/// What a request says when GameBanana no longer accepts the session.
pub const SIGNED_OUT: &str = "You're signed out of GameBanana. Sign in again in Settings, GameBanana account";

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GbUser { pub id: u64, pub name: String, pub avatar: Option<String> }

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AccountState {
    /// False while sign-in is turned off (it starts off).
    pub available: bool,
    pub user: Option<GbUser>,
}

pub fn is_signed_out(e: &Error) -> bool { matches!(e, Error::Invalid(m) if m == SIGNED_OUT) }

// ── the stored cookie ──

/// The sign-in window's browser name. Requests with the session send it too, since GameBanana and Cloudflare may
/// tie the session to the browser that signed in.
static BROWSER: RwLock<String> = RwLock::new(String::new());

pub fn set_user_agent(ua: &str) {
    if let Ok(mut b) = BROWSER.write() { *b = ua.trim().to_string(); }
}

fn session_file(data_dir: &Path) -> PathBuf { data_dir.join("gb-session.bin") }
/// The login window's own browser data (its cookies stay out of the app's window).
pub fn login_data_dir(data_dir: &Path) -> PathBuf { data_dir.join("gb-login") }

pub fn save_cookie(data_dir: &Path, header: &str) -> Result<()> {
    let sealed = dpapi::protect(header.as_bytes())?;
    std::fs::write(session_file(data_dir), sealed)?;
    Ok(())
}

pub fn load_cookie(data_dir: &Path) -> Option<String> {
    let sealed = std::fs::read(session_file(data_dir)).ok()?;
    String::from_utf8(dpapi::unprotect(&sealed).ok()?).ok().filter(|s| !s.is_empty())
}

/// Forget the session: the stored cookie and the login window's data. The server session ends on its own.
pub fn forget(data_dir: &Path) {
    let _ = std::fs::remove_file(session_file(data_dir));
    let _ = std::fs::remove_dir_all(login_data_dir(data_dir));
}

/// A Cookie header from the login window's cookies for gamebanana.com: every one of them, since which ones matter
/// isn't known (Cloudflare's may).
pub fn cookie_header<'a>(cookies: impl IntoIterator<Item = (&'a str, &'a str)>) -> String {
    cookies.into_iter()
        .filter(|(n, v)| !n.is_empty() && !n.contains([';', '=', '\r', '\n']) && !v.contains([';', '\r', '\n']))
        .map(|(n, v)| format!("{n}={v}"))
        .collect::<Vec<_>>()
        .join("; ")
}

// ── requests ──

async fn send(http: &reqwest::Client, cookie: &str, method: reqwest::Method, url: &str) -> Result<Value> {
    send_with(http, cookie, method, url, None).await
}

/// `send` with a JSON body (writes without one send `{}`).
async fn send_with(http: &reqwest::Client, cookie: &str, method: reqwest::Method, url: &str, body: Option<&Value>) -> Result<Value> {
    if !url.starts_with("https://gamebanana.com/") { return Err(Error::Invalid("Not a GameBanana address".into())); }
    let mut req = http.request(method.clone(), url).header("Cookie", cookie).header("Accept", "application/json")
        .timeout(std::time::Duration::from_secs(20));
    let browser = BROWSER.read().map(|b| b.clone()).unwrap_or_default();
    if !browser.is_empty() { req = req.header(reqwest::header::USER_AGENT, browser); }
    if method != reqwest::Method::GET {
        req = req.header("Content-Type", "application/json").body(body.map_or_else(|| "{}".to_string(), Value::to_string));
    }
    let r = req.send().await?;
    let status = r.status().as_u16();
    let text = r.text().await.unwrap_or_default();
    let body: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    let code = body.get("_sErrorCode").and_then(Value::as_str).unwrap_or_default();
    if status == 401 || code == "LOGIN_REQUIRED" { return Err(Error::Invalid(SIGNED_OUT.into())); }
    if !(200..300).contains(&status) || !code.is_empty() {
        let msg = body.get("_sErrorMessage").and_then(Value::as_str).filter(|m| !m.is_empty()).unwrap_or("Try again in a minute");
        return Err(Error::Http { status, message: msg.to_string() });
    }
    Ok(body)
}

fn user_from(id: u64, page: &Value) -> GbUser {
    let s = |k: &str| page.get(k).and_then(Value::as_str).filter(|v| !v.is_empty()).map(String::from);
    GbUser { id, name: s("_sName").unwrap_or_else(|| format!("Member {id}")), avatar: s("_sHdAvatarUrl").or_else(|| s("_sAvatarUrl")) }
}

/// Who the cookie signs in as, or None when it doesn't. GameBanana's own pages read the member from
/// `apiv13/Member/UiConfig` (`_bIsLoggedIn`, `_idMemberRow`, `_sAvatarUrl`); `apiv11/Member/Session` only says
/// whether someone is signed in, so it is the fallback.
pub async fn whoami(http: &reqwest::Client, cookie: &str) -> Result<Option<GbUser>> {
    let ui = match send(http, cookie, reqwest::Method::GET, &format!("{API13}/Member/UiConfig")).await {
        Ok(v) => v,
        Err(e) if is_signed_out(&e) => return Ok(None),
        Err(_) => send(http, cookie, reqwest::Method::GET, &format!("{API11}/Member/Session")).await.unwrap_or(Value::Null),
    };
    if ui.get("_bIsLoggedIn").and_then(Value::as_bool) == Some(false) { return Ok(None); }
    let id = ["_idMemberRow", "_idRow"].iter().find_map(|k| ui.get(*k).and_then(id_of))
        .or_else(|| ui.get("_aMember").and_then(|m| m.get("_idRow")).and_then(id_of));
    let Some(id) = id else {
        // signed in, but the answer doesn't say who: ask the session the other way before giving up
        let s = send(http, cookie, reqwest::Method::GET, &format!("{API11}/Member/Session")).await.unwrap_or(Value::Null);
        let Some(id) = s.get("_idMemberRow").and_then(id_of) else { return Ok(None) };
        let page = send(http, cookie, reqwest::Method::GET, &format!("{API11}/Member/{id}/ProfilePage")).await.unwrap_or(Value::Null);
        return Ok(Some(user_from(id, &page)));
    };
    let page = send(http, cookie, reqwest::Method::GET, &format!("{API11}/Member/{id}/ProfilePage")).await.unwrap_or(Value::Null);
    let mut user = user_from(id, &page);
    if user.avatar.is_none() { user.avatar = ui.get("_sAvatarUrl").and_then(Value::as_str).filter(|v| !v.is_empty()).map(String::from); }
    if user.name.starts_with("Member ") {
        if let Some(n) = ["_sName", "_sUsername"].iter().find_map(|k| ui.get(*k).and_then(Value::as_str).filter(|v| !v.is_empty())) { user.name = n.to_string(); }
    }
    Ok(Some(user))
}

/// A member id as GameBanana writes it: a number, or a number in a string.
fn id_of(v: &Value) -> Option<u64> { v.as_u64().or_else(|| v.as_str().and_then(|s| s.parse().ok())).filter(|&n| n > 0) }

// ── content settings ──

/// The content ratings that make a mod one for adults, with what GameBanana does with each for guests. Members pick
/// show, warn or hide for every rating; the others (alcohol, blood, violence...) don't decide the app's setting.
const ADULT_RATINGS: [(&str, &str); 7] = [
    ("sa", "warn"), // Skimpy Attire
    ("st", "warn"), // Sexual Themes
    ("sc", "warn"), // Sexual Content
    ("lp", "warn"), // Lewd Angles & Poses
    ("pn", "hide"), // Partial Nudity
    ("nu", "hide"), // Full Nudity
    ("ft", "hide"), // Fetishistic
];

/// What the member's GameBanana content settings say about mods for adults, in the app's words.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AdultPref {
    /// "show" when every adult rating is shown there, "hide" when every one is hidden, "blur" for anything else.
    pub mode: String,
    /// The member never changed GameBanana's defaults for these ratings, so they say nothing about what they want.
    pub untouched: bool,
}

/// The app's setting from `_aContentRatingBehaviors` (`{ "sa": "warn", "nu": "hide", ... }`). None when it names none
/// of the adult ratings.
pub fn adult_pref(behaviors: &Value) -> Option<AdultPref> {
    let got: Vec<&str> = ADULT_RATINGS.iter().filter_map(|(code, _)| behaviors.get(code).and_then(Value::as_str)).collect();
    if got.is_empty() { return None; }
    let mode = if got.iter().all(|b| *b == "show") { "show" } else if got.iter().all(|b| *b == "hide") { "hide" } else { "blur" };
    let untouched = ADULT_RATINGS.iter().all(|(code, d)| behaviors.get(code).and_then(Value::as_str) == Some(*d));
    Some(AdultPref { mode: mode.into(), untouched })
}

/// Read the member's content settings (read only). None when GameBanana answers as if nobody is signed in, or the
/// answer has no content settings.
pub async fn content_settings(http: &reqwest::Client, cookie: &str) -> Result<Option<AdultPref>> {
    let ui = send(http, cookie, reqwest::Method::GET, &format!("{API13}/Member/UiConfig")).await?;
    if ui.get("_bIsLoggedIn").and_then(Value::as_bool) != Some(true) { return Ok(None); }
    Ok(ui.get("_aContentRatingBehaviors").and_then(adult_pref))
}

/// Follow (subscribe to) a creator, or stop.
pub async fn follow(http: &reqwest::Client, cookie: &str, member: u64, on: bool) -> Result<()> {
    subscribe(http, cookie, "Member", member, on, "GameBanana didn't say which follow to remove. Unfollow on the creator's page").await
}

/// Subscribe to a mod, or stop. GameBanana then tells the member, on GameBanana, when it updates.
pub async fn subscribe_mod(http: &reqwest::Client, cookie: &str, mod_id: u64, on: bool) -> Result<()> {
    subscribe(http, cookie, "Mod", mod_id, on, "GameBanana didn't say which subscription to remove. Unsubscribe on the mod's page").await
}

/// Subscribe to a member or a mod, or stop. The page says whether the member already is, and the row to delete.
/// Mod pages are read from apiv13, as GameBanana's own page does; member pages from apiv11, as follow always has.
async fn subscribe(http: &reqwest::Client, cookie: &str, model: &str, id: u64, on: bool, no_row: &str) -> Result<()> {
    let api = if model == "Member" { API11 } else { API13 };
    let page = send(http, cookie, reqwest::Method::GET, &format!("{api}/{model}/{id}/ProfilePage")).await?;
    let subscribed = page.get("_bAccessorIsSubscribed").and_then(Value::as_bool).unwrap_or(false);
    if subscribed == on { return Ok(()); }
    if on {
        send(http, cookie, reqwest::Method::POST, &format!("{API13}/{model}/{id}/Subscription/Add")).await?;
    } else {
        let Some(row) = page.get("_idAccessorSubscriptionRow").and_then(id_of) else { return Err(Error::Invalid(no_row.into())) };
        send(http, cookie, reqwest::Method::DELETE, &format!("{API13}/Subscription/{row}")).await?;
    }
    Ok(())
}

/// Like a mod, or take the like back. Nobody is notified.
pub async fn like(http: &reqwest::Client, cookie: &str, mod_id: u64, on: bool) -> Result<()> {
    let method = if on { reqwest::Method::POST } else { reqwest::Method::DELETE };
    send(http, cookie, method, &format!("{API13}/Mod/{mod_id}/Like")).await.map(|_| ())
}

/// What the signed-in member has done on a mod, and what thanking it would cost. Anything GameBanana leaves out is
/// None, and the app keeps what it remembers.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModMe {
    pub liked: Option<bool>,
    pub subscribed: Option<bool>,
    pub thanked: Option<bool>,
    /// The member made it. GameBanana's page offers no like, subscribe or thanks then.
    pub own: Option<bool>,
    /// The member's GameBanana points.
    pub points: Option<u64>,
    /// The member's first thanks of the day costs no points.
    pub free_thank: Option<bool>,
}

/// Read only: the mod's page and the member's UiConfig, as the member sees them.
pub async fn mod_me(http: &reqwest::Client, cookie: &str, mod_id: u64) -> Result<ModMe> {
    let (page_url, ui_url) = (format!("{API13}/Mod/{mod_id}/ProfilePage"), format!("{API13}/Member/UiConfig"));
    let (page, ui) = tokio::join!(
        send(http, cookie, reqwest::Method::GET, &page_url),
        send(http, cookie, reqwest::Method::GET, &ui_url),
    );
    let page = page?;
    let ui = ui.unwrap_or(Value::Null);
    Ok(mod_me_from(&page, if ui.get("_bIsLoggedIn").and_then(Value::as_bool) == Some(true) { &ui } else { &Value::Null }))
}

fn mod_me_from(page: &Value, ui: &Value) -> ModMe {
    let flag = |v: &Value, k: &str| v.get(k).and_then(Value::as_bool);
    let points = ui.get("_aPointDetails").and_then(|p| p.get("_nPoints"))
        .and_then(|v| v.as_u64().or_else(|| v.as_str().and_then(|s| s.parse().ok())));
    ModMe {
        liked: flag(page, "_bAccessorHasLiked"),
        subscribed: flag(page, "_bAccessorIsSubscribed"),
        thanked: flag(page, "_bAccessorHasThanked"),
        own: flag(page, "_bAccessorIsSubmitter"),
        points,
        free_thank: flag(ui, "_bHasFreeThank"),
    }
}

/// The most points one thanks can give.
pub const THANK_MAX: u32 = 1000;

/// Thank a mod's creator with `points` of the member's points (GameBanana's page sends 10 unless the member picks
/// more; the free thanks of the day sends 10 too and GameBanana pays them). Thanking again gives more. It can't be
/// taken back.
pub async fn thank(http: &reqwest::Client, cookie: &str, mod_id: u64, points: u32) -> Result<()> {
    if points > THANK_MAX { return Err(Error::Invalid(format!("A thanks gives at most {THANK_MAX} points"))); }
    let body = serde_json::json!({ "_nPointsToDonate": points });
    send_with(http, cookie, reqwest::Method::POST, &format!("{API13}/Mod/{mod_id}/Thank/Add"), Some(&body)).await.map(|_| ())
}

/// The creators the member follows (read only, for "Import who I follow").
pub async fn following(http: &reqwest::Client, cookie: &str, member: u64) -> Result<Vec<GbUser>> {
    let mut out: Vec<GbUser> = Vec::new();
    for page in 1..=20 {
        let url = format!("{API11}/Member/{member}/Subscriptions?_nPage={page}&_sModelName=Member");
        let body = send(http, cookie, reqwest::Method::GET, &url).await?;
        let recs = body.get("_aRecords").and_then(Value::as_array).cloned().unwrap_or_default();
        for r in &recs {
            let Some(s) = r.get("_aSubscription") else { continue };
            let Some(id) = s.get("_idRow").and_then(Value::as_u64) else { continue };
            if !out.iter().any(|u| u.id == id) { out.push(user_from(id, s)); }
        }
        let done = body.get("_aMetadata").and_then(|m| m.get("_bIsComplete")).and_then(Value::as_bool).unwrap_or(recs.len() < 15);
        if done || recs.is_empty() { break; }
    }
    Ok(out)
}

// ── DPAPI: data only this Windows user can read back ──

#[cfg(windows)]
mod dpapi {
    use crate::error::{Error, Result};
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN};

    fn run(data: &[u8], seal: bool) -> Result<Vec<u8>> {
        let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
        let mut out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
        // SAFETY: the input blob points at `data`, which outlives the call; the output is allocated by the system
        // and freed below with LocalFree after copying it out
        let ok = unsafe {
            if seal {
                CryptProtectData(&input, std::ptr::null(), std::ptr::null(), std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut out)
            } else {
                CryptUnprotectData(&input, std::ptr::null_mut(), std::ptr::null(), std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut out)
            }
        };
        if ok == 0 || out.pbData.is_null() { return Err(Error::Invalid("Windows couldn't protect the GameBanana session".into())); }
        // SAFETY: on success the system set pbData to cbData readable bytes
        let bytes = unsafe { std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec() };
        unsafe { LocalFree(out.pbData as _) };
        Ok(bytes)
    }
    pub fn protect(data: &[u8]) -> Result<Vec<u8>> { run(data, true) }
    pub fn unprotect(data: &[u8]) -> Result<Vec<u8>> { run(data, false) }
}

#[cfg(not(windows))]
mod dpapi {
    use crate::error::{Error, Result};
    pub fn protect(_: &[u8]) -> Result<Vec<u8>> { Err(Error::Invalid("Signing in to GameBanana works on Windows only".into())) }
    pub fn unprotect(_: &[u8]) -> Result<Vec<u8>> { Err(Error::Invalid("Signing in to GameBanana works on Windows only".into())) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_header_keeps_every_cookie_and_drops_broken_ones() {
        let h = cookie_header([("sess", "abc"), ("cf_clearance", "x.y-z"), ("bad;name", "1"), ("", "2"), ("ok", "a\r\nb")]);
        assert_eq!(h, "sess=abc; cf_clearance=x.y-z");
    }

    #[test]
    fn mod_me_reads_the_accessor_flags_and_points() {
        let page = serde_json::json!({ "_bAccessorHasLiked": true, "_bAccessorIsSubscribed": false, "_nLikeCount": 6 });
        let ui = serde_json::json!({ "_bIsLoggedIn": true, "_bHasFreeThank": true, "_aPointDetails": { "_nPoints": "1520" } });
        assert_eq!(mod_me_from(&page, &ui), ModMe { liked: Some(true), subscribed: Some(false), thanked: None, own: None, points: Some(1520), free_thank: Some(true) });
        assert_eq!(mod_me_from(&Value::Null, &Value::Null), ModMe::default());
    }

    #[test]
    fn content_settings_map_to_hide_blur_or_show() {
        let pref = |v: Value| adult_pref(&v).map(|p| (p.mode, p.untouched));
        // GameBanana's guest defaults, as UiConfig sends them (Nov 2026)
        let defaults = serde_json::json!({ "cp": "show", "st": "warn", "sc": "warn", "bg": "show", "au": "show", "tu": "show",
            "du": "show", "ps": "show", "sa": "warn", "lp": "warn", "pn": "hide", "nu": "hide", "iv": "hide", "ft": "hide", "rp": "hide" });
        assert_eq!(pref(defaults.clone()), Some(("blur".into(), true)));
        let mut all_shown = defaults.clone();
        for (c, _) in ADULT_RATINGS { all_shown[c] = "show".into(); }
        // violence stays hidden and that doesn't matter here
        assert_eq!(pref(all_shown), Some(("show".into(), false)));
        let mut all_hidden = defaults.clone();
        for (c, _) in ADULT_RATINGS { all_hidden[c] = "hide".into(); }
        assert_eq!(pref(all_hidden), Some(("hide".into(), false)));
        let mut mixed = defaults;
        mixed["sa"] = "show".into();
        assert_eq!(pref(mixed), Some(("blur".into(), false)));
        assert_eq!(pref(serde_json::json!({ "bg": "hide" })), None);
        assert_eq!(pref(Value::Null), None);
    }

    #[cfg(windows)]
    #[test]
    fn the_session_file_round_trips_and_is_not_plain_text() {
        let dir = std::env::temp_dir().join(format!("gachamod-gb-{}", crate::library::new_id()));
        std::fs::create_dir_all(&dir).unwrap();
        save_cookie(&dir, "sess=secret123").unwrap();
        let raw = std::fs::read(session_file(&dir)).unwrap();
        assert!(!raw.windows(9).any(|w| w == b"secret123"));
        assert_eq!(load_cookie(&dir).as_deref(), Some("sess=secret123"));
        forget(&dir);
        assert_eq!(load_cookie(&dir), None);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
