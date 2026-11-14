//! Extensions and themes: installing from repos and files, and what extension pages may call. Owner: EXTENSIONS
//! area (docs/extensions.md). Pages are served by `serve` on the gmext:// scheme (lib.rs registers it).
use crate::commands::common::open_with_shell;
use crate::state::{blocking, AppState};
use gacha_core::extensions::{self as ext, AppStatus, DirEntry, FetchRequest, FetchResponse, IndexEntry, InstallResult, Installed, Packed, Repo, ThemeMeta};
use gacha_core::{Error, Result};
use std::path::PathBuf;
use tauri::{Manager, State};

fn lock(db: &gacha_core::db::Shared) -> Result<std::sync::MutexGuard<'_, gacha_core::db::Db>> {
    db.lock().map_err(|_| Error::Invalid("The app's database stopped responding. Restart gachamod".into()))
}

#[tauri::command]
pub async fn extensions_list(st: State<'_, AppState>) -> Result<Vec<Installed>> {
    let (db, data) = (st.db.clone(), st.data_dir.clone());
    blocking(move || ext::list(&*lock(&db)?, &data)).await
}

#[derive(serde::Serialize, serde::Deserialize)]
struct Cached { at: i64, text: String }

/// Every repo's list. Fetched lists are kept, so a repo that can't be reached shows its last list with `error` set.
/// Without `refresh`, a list fetched in the last 6 hours is used as it is.
#[tauri::command]
pub async fn extensions_repos(st: State<'_, AppState>, refresh: bool) -> Result<Vec<Repo>> {
    let sources = ext::sources(&*lock(&st.db)?);
    let mut out = Vec::new();
    for source in sources {
        let key = ext::cache_key(&source);
        let cached = |ttl: i64| -> Option<Cached> { lock(&st.db).ok()?.cache_get(&key, ttl).ok()?.and_then(|t| serde_json::from_str(&t).ok()) };
        let (text, at, error) = match cached(6 * 3600).filter(|_| !refresh) {
            Some(c) => (Some(c.text), c.at, None),
            None => match ext::fetch_index(&st.http, &source).await {
                Ok(text) => {
                    let at = gacha_core::db::now();
                    if let Ok(d) = lock(&st.db) { let _ = d.cache_put(&key, &serde_json::to_string(&Cached { at, text: text.clone() })?); }
                    (Some(text), at, None)
                }
                Err(e) => match cached(30 * 86400) {
                    Some(c) => (Some(c.text), c.at, Some(e.to_string())),
                    None => (None, 0, Some(e.to_string())),
                },
            },
        };
        let ix = text.as_deref().map(ext::parse_index).transpose().unwrap_or_default().unwrap_or_default();
        let name = if ix.name.trim().is_empty() { url::Url::parse(&source).ok().and_then(|u| u.host_str().map(str::to_string)).unwrap_or_default() } else { ix.name };
        out.push(Repo { source, name, submit: ix.submit, packages: ix.packages, error, fetched_at: at });
    }
    Ok(out)
}

/// Download a package a repo lists, check it and install it.
#[tauri::command]
pub async fn extensions_install(st: State<'_, AppState>, source: String, entry: IndexEntry) -> Result<InstallResult> {
    let zip = ext::download_package(&st.http, &entry, &st.data_dir.join("staging")).await?;
    let (db, data) = (st.db.clone(), st.data_dir.clone());
    blocking(move || {
        let r = ext::install_zip(&*lock(&db)?, &data, &zip, Some((&entry.id, &entry.version)), Some(source));
        let _ = std::fs::remove_file(&zip);
        r
    }).await
}

/// Install a package from a .zip or a copy of a folder.
#[tauri::command]
pub async fn extensions_install_file(st: State<'_, AppState>, path: String) -> Result<InstallResult> {
    let (db, data) = (st.db.clone(), st.data_dir.clone());
    blocking(move || {
        let p = PathBuf::from(&path);
        if p.is_dir() { ext::install_folder(&*lock(&db)?, &data, &p) } else { ext::install_zip(&*lock(&db)?, &data, &p, None, None) }
    }).await
}

/// Use a package folder where it is, for making one.
#[tauri::command]
pub async fn extensions_link_folder(st: State<'_, AppState>, path: String) -> Result<Installed> {
    let (db, data) = (st.db.clone(), st.data_dir.clone());
    blocking(move || ext::link_folder(&*lock(&db)?, &data, &PathBuf::from(path))).await
}

/// Returns the trash key that `extensions_restore` takes (null for an unlinked folder).
#[tauri::command]
pub async fn extensions_remove(st: State<'_, AppState>, id: String) -> Result<Option<String>> {
    let (db, data) = (st.db.clone(), st.data_dir.clone());
    blocking(move || ext::remove(&*lock(&db)?, &data, &id)).await
}

#[tauri::command]
pub async fn extensions_restore(st: State<'_, AppState>, key: String) -> Result<InstallResult> {
    let (db, data) = (st.db.clone(), st.data_dir.clone());
    blocking(move || ext::restore(&*lock(&db)?, &data, &key)).await
}

#[tauri::command]
pub async fn extensions_set_enabled(st: State<'_, AppState>, id: String, on: bool) -> Result<()> {
    let db = st.db.clone();
    blocking(move || ext::set_enabled(&*lock(&db)?, &id, on)).await
}

/// A package's theme files as JSON.
#[tauri::command]
pub async fn extensions_themes(st: State<'_, AppState>, id: String) -> Result<Vec<serde_json::Value>> {
    let (db, data) = (st.db.clone(), st.data_dir.clone());
    blocking(move || ext::themes(&*lock(&db)?, &data, &id)).await
}

/// The other apps a package works with: installed or not, and running when it says how to tell.
#[tauri::command]
pub async fn extensions_needs(st: State<'_, AppState>, id: String) -> Result<Vec<AppStatus>> {
    let (db, data) = (st.db.clone(), st.data_dir.clone());
    let m = blocking(move || {
        let e = ext::get(&*lock(&db)?, &data, &id)?;
        e.manifest.ok_or_else(|| Error::Invalid(e.problem.unwrap_or_default()))
    }).await?;
    let m2 = m.clone();
    let mut apps = blocking(move || Ok(ext::find_apps(&m2))).await?;
    ext::check_running(&m, &mut apps).await;
    Ok(apps)
}

fn active(st: &AppState, id: &str) -> Result<ext::Manifest> { Ok(ext::active(&*lock(&st.db)?, &st.data_dir, id)?.0) }

#[tauri::command]
pub async fn extensions_open_app(st: State<'_, AppState>, id: String, name: String) -> Result<()> {
    let m = active(&st, &id)?;
    let target = blocking(move || ext::open_target(&m, &name)).await?;
    open_with_shell(&target)
}

#[tauri::command]
pub async fn extensions_fetch(st: State<'_, AppState>, id: String, req: FetchRequest) -> Result<FetchResponse> {
    let m = active(&st, &id)?;
    ext::fetch(&m, req).await
}

#[tauri::command]
pub async fn extensions_read_file(st: State<'_, AppState>, id: String, path: String) -> Result<String> {
    let m = active(&st, &id)?;
    blocking(move || ext::read_file(&m, &path)).await
}

#[tauri::command]
pub async fn extensions_list_dir(st: State<'_, AppState>, id: String, path: String) -> Result<Vec<DirEntry>> {
    let m = active(&st, &id)?;
    blocking(move || ext::list_dir(&m, &path)).await
}

#[tauri::command]
pub async fn extensions_storage_get(st: State<'_, AppState>, id: String) -> Result<serde_json::Map<String, serde_json::Value>> {
    active(&st, &id)?;
    let data = st.data_dir.clone();
    blocking(move || ext::storage_get(&data, &id)).await
}

#[tauri::command]
pub async fn extensions_storage_set(st: State<'_, AppState>, id: String, key: String, value: Option<serde_json::Value>) -> Result<()> {
    active(&st, &id)?;
    let data = st.data_dir.clone();
    blocking(move || ext::storage_set(&data, &id, &key, value.filter(|v| !v.is_null()))).await
}

/// Zip a package folder for sharing.
#[tauri::command]
pub async fn extensions_pack_folder(folder: String, out: String) -> Result<Packed> {
    blocking(move || ext::pack_folder(&PathBuf::from(folder), &PathBuf::from(out))).await
}

/// Package one custom theme for sharing.
#[tauri::command]
pub async fn extensions_pack_theme(theme: serde_json::Value, meta: ThemeMeta, out: String) -> Result<Packed> {
    blocking(move || ext::pack_theme(&theme, meta, &PathBuf::from(out))).await
}

// ── the gmext:// scheme: extension pages and their files ──

/// The page-side API, put first in every extension page (`window.gachamod`).
const BRIDGE: &str = include_str!("../../../src/lib/extension-bridge.js");
const BRIDGE_PATH: &str = "/__gachamod/api.js";

fn decode(path: &str) -> String {
    let b = path.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            let hex = |c: u8| (c as char).to_digit(16);
            if let (Some(h), Some(l)) = (hex(b[i + 1]), hex(b[i + 2])) { out.push((h * 16 + l) as u8); i += 3; continue; }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn mime(path: &std::path::Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref() {
        Some("html" | "htm") => "text/html; charset=utf-8",
        Some("js" | "mjs") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("txt" | "md") => "text/plain; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("avif") => "image/avif",
        Some("woff2") => "font/woff2",
        Some("woff") => "font/woff",
        Some("ttf") => "font/ttf",
        Some("otf") => "font/otf",
        Some("mp3") => "audio/mpeg",
        Some("ogg") => "audio/ogg",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        _ => "application/octet-stream",
    }
}

/// What a page may load: its own files, pictures from GameBanana and the origins it asks for. Nothing it can
/// connect to by itself: web calls go through gachamod (`gachamod.fetch`), which checks them.
fn csp(m: &ext::Manifest) -> String {
    let me = "'self' http://gmext.localhost gmext:";
    let net = m.permissions.net.join(" ");
    format!("default-src 'none'; script-src {me}; style-src {me} 'unsafe-inline'; img-src {me} data: blob: https://images.gamebanana.com {net}; \
             font-src {me} data:; media-src {me} data: blob: {net}; connect-src 'none'; frame-src 'none'; worker-src 'none'; \
             object-src 'none'; form-action 'none'; base-uri 'none'")
}

/// The API script goes first in the page, before any of its own scripts.
fn inject(html: &[u8]) -> Vec<u8> {
    let tag = format!("<script src=\"{BRIDGE_PATH}\"></script>");
    let text = String::from_utf8_lossy(html);
    let lower = text.to_ascii_lowercase();
    let at = ["<head", "<html"].iter().find_map(|t| lower.find(t).and_then(|i| lower[i..].find('>').map(|j| i + j + 1)));
    match at {
        Some(i) => format!("{}{tag}{}", &text[..i], &text[i..]).into_bytes(),
        None => format!("{tag}{text}").into_bytes(),
    }
}

pub fn serve(app: &tauri::AppHandle, req: &tauri::http::Request<Vec<u8>>) -> tauri::http::Response<Vec<u8>> {
    use tauri::http::{header, Response};
    let reply = |status: u16, kind: &str, body: Vec<u8>| Response::builder().status(status).header(header::CONTENT_TYPE, kind)
        .header("X-Content-Type-Options", "nosniff").header(header::CACHE_CONTROL, "no-store").body(body).unwrap_or_default();
    if req.method() != tauri::http::Method::GET { return reply(405, "text/plain", b"Only GET".to_vec()); }
    let path = decode(req.uri().path());
    if path == BRIDGE_PATH { return reply(200, "text/javascript; charset=utf-8", BRIDGE.as_bytes().to_vec()); }
    let Some((id, rel)) = path.trim_start_matches('/').split_once('/') else { return reply(404, "text/plain", b"Not found".to_vec()) };
    let st = app.state::<AppState>();
    let found = match lock(&st.db) { Ok(db) => ext::page_file(&db, &st.data_dir, id, rel), Err(e) => Err(e) };
    let (m, file) = match found {
        Ok(Some(f)) => f,
        Ok(None) => return reply(404, "text/plain", b"Not found".to_vec()),
        Err(e) => return reply(403, "text/plain; charset=utf-8", e.to_string().into_bytes()),
    };
    let Ok(body) = std::fs::read(&file) else { return reply(404, "text/plain", b"Not found".to_vec()) };
    let kind = mime(&file);
    let body = if kind.starts_with("text/html") { inject(&body) } else { body };
    Response::builder().status(200).header(header::CONTENT_TYPE, kind).header("Content-Security-Policy", csp(&m))
        .header("X-Content-Type-Options", "nosniff").header(header::CACHE_CONTROL, "no-store")
        .header("Referrer-Policy", "no-referrer").body(body).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    #[test]
    fn decodes_and_injects() {
        assert_eq!(super::decode("/a%20b/c%2Fd.html"), "/a b/c/d.html");
        assert_eq!(super::decode("/bad%2"), "/bad%2");
        let out = String::from_utf8(super::inject(b"<!doctype html><HTML><Head lang=x><title>t</title>")).unwrap();
        assert!(out.starts_with("<!doctype html><HTML><Head lang=x><script src=\"/__gachamod/api.js\"></script><title>"));
        assert!(String::from_utf8(super::inject(b"<p>x")).unwrap().starts_with("<script"));
    }
}
