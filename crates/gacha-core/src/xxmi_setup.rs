//! One click from nothing to mods: gets XXMI Launcher and each game's model importer the way XXMI's own Install button
//! does, without opening XXMI. XXMI has no command for an unattended install (its `--update` skips importers that aren't
//! installed yet), so this follows its package code (docs/research.md, "XXMI Launcher"):
//! - the launcher: the portable zip from SpectrumQT/XXMI-Launcher's latest release, unpacked into the root
//!   (%APPDATA%\XXMI Launcher). The zip has `Resources\Bin\XXMI Launcher.exe` at its top.
//! - the 3DMigoto libraries: SpectrumQT/XXMI-Libs-Package's zip and its Manifest.json, into `Resources\Packages\XXMI`.
//! - each importer: its package zip (ZZMI from leotorrez/ZZMI-Package, and so on) unpacked into `<root>\<CODE>` (d3dx.ini,
//!   Core, ShaderFixes), a Mods folder, and d3d11.dll and d3dcompiler_47.dll copied in from the libraries.
//! - the config: each importer added to `Launcher.enabled_importers`, with its `game_folder` when the game was found.
//! XXMI counts an importer as installed once `Core\<CODE>\main.ini` exists, and checks and updates all of it on its next
//! start. Nothing already there is replaced: a d3dx.ini, Mods folder or game folder the user has stays. Owner: SYSTEM.
use crate::error::{Error, IoAt, Result};
use crate::xxmi::{self, CONFIG_FILE, EXE_NAME};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

const LAUNCHER_REPO: &str = "SpectrumQT/XXMI-Launcher";
const LIBS_REPO: &str = "SpectrumQT/XXMI-Libs-Package";
const LIBS: [&str; 2] = ["d3d11.dll", "d3dcompiler_47.dll"];

/// The GitHub repository each importer's package comes from (XXMI's `<code>_package.py`).
pub fn package_repo(code: &str) -> Option<&'static str> {
    Some(match code.to_ascii_uppercase().as_str() {
        "GIMI" => "SilentNightSound/GIMI-Package",
        "SRMI" => "SpectrumQT/SRMI-Package",
        "ZZMI" => "leotorrez/ZZMI-Package",
        "WWMI" => "SpectrumQT/WWMI-Package",
        "HIMI" => "leotorrez/HIMI-Package",
        "EFMI" => "SpectrumQT/EFMI-Package",
        _ => return None,
    })
}

/// A game to set up: its importer code and, when known, the folder with its exe.
#[derive(Debug, Clone)]
pub struct Target { pub code: String, pub game_dir: Option<PathBuf> }

/// What the install is doing, for the UI ("xxmi-setup" event). `total` is the download size when known.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupProgress { pub step: String, pub done: u64, pub total: Option<u64> }

#[derive(Deserialize)]
struct Release { assets: Vec<Asset> }
#[derive(Deserialize)]
struct Asset { name: String, browser_download_url: String }

async fn latest(http: &reqwest::Client, repo: &str) -> Result<Release> {
    let r = http.get(format!("https://api.github.com/repos/{repo}/releases/latest"))
        .header("Accept", "application/vnd.github+json")
        .send().await.map_err(|e| Error::unreachable("GitHub", e.without_url()))?;
    let status = r.status().as_u16();
    if status == 403 || status == 429 {
        return Err(Error::RateLimited { site: "GitHub".into(), wait: "an hour" });
    }
    if !r.status().is_success() {
        return Err(Error::Site { site: "GitHub".into(), status, message: format!("{repo}'s latest release didn't come") });
    }
    r.json::<Release>().await.map_err(|e| Error::Decode(e.to_string()))
}

fn pick<'a>(rel: &'a Release, ok: impl Fn(&str) -> bool) -> Option<&'a Asset> {
    rel.assets.iter().find(|a| ok(&a.name.to_ascii_lowercase()))
}

/// The root XXMI uses or will use: a folder the user set, the one it's in now, else %APPDATA%\XXMI Launcher.
pub fn root_for(custom: Option<&str>) -> Result<PathBuf> {
    xxmi::find_root(custom).or_else(xxmi::default_root)
        .ok_or_else(|| Error::Invalid("Windows didn't say where the AppData folder is".into()))
}

/// The importer folder XXMI's config names for `code`, else `<root>\<CODE>`.
fn importer_dir(root: &Path, code: &str) -> PathBuf {
    let cfg = std::fs::read_to_string(root.join(CONFIG_FILE)).ok()
        .and_then(|t| serde_json::from_str::<Value>(t.trim_start_matches('\u{feff}')).ok());
    let folder = cfg.as_ref().and_then(|c| c["Importers"][code]["Importer"]["importer_folder"].as_str().map(str::to_string))
        .map(|s| s.trim_end_matches(['/', '\\']).to_string()).filter(|s| !s.is_empty()).unwrap_or_else(|| code.to_string());
    let p = PathBuf::from(folder);
    if p.is_absolute() { p } else { root.join(p) }
}

/// An importer counts as installed once its core ini is there (XXMI's own check).
pub fn importer_installed(root: &Path, code: &str) -> bool {
    importer_dir(root, code).join("Core").join(code).join("main.ini").is_file()
}

/// True when everything for `targets` is in place already.
pub fn ready(custom: Option<&str>, codes: &[&str]) -> bool {
    let Ok(root) = root_for(custom) else { return false };
    root.join("Resources").join("Bin").join(EXE_NAME).is_file() && codes.iter().all(|c| importer_installed(&root, c))
}

/// Install what's missing for `targets`: the launcher, the libraries and each importer, then XXMI's config. Returns
/// XXMI's root. `progress` hears each step and the bytes of each download.
pub async fn install(http: &reqwest::Client, data_dir: &Path, custom: Option<&str>, targets: &[Target],
    progress: &mut (dyn FnMut(SetupProgress) + Send)) -> Result<PathBuf> {
    let root = root_for(custom)?;
    if crate::launch::process_running(EXE_NAME) {
        return Err(Error::Conflict("Close XXMI Launcher first. It rewrites its settings when it closes".into()));
    }
    let work = data_dir.join("xxmi-setup");
    let _ = std::fs::remove_dir_all(&work);
    std::fs::create_dir_all(&work)?;
    let r = run(http, &work, &root, targets, progress).await;
    let _ = std::fs::remove_dir_all(&work);
    r.map(|_| root)
}

async fn run(http: &reqwest::Client, work: &Path, root: &Path, targets: &[Target], progress: &mut (dyn FnMut(SetupProgress) + Send)) -> Result<()> {
    // the launcher
    if !root.join("Resources").join("Bin").join(EXE_NAME).is_file() {
        progress(SetupProgress { step: "Asking GitHub for XXMI Launcher".into(), done: 0, total: None });
        let rel = latest(http, LAUNCHER_REPO).await?;
        let a = pick(&rel, |n| n.contains("portable") && n.ends_with(".zip"))
            .ok_or_else(|| Error::Invalid("XXMI Launcher's latest release has no portable zip. Try again later".into()))?;
        let zip = fetch(http, work, a, "Downloading XXMI Launcher", progress).await?;
        progress(SetupProgress { step: "Unpacking XXMI Launcher".into(), done: 0, total: None });
        unpack(zip, work.join("launcher"), root.to_path_buf(), false).await?;
    }
    if targets.is_empty() { return write_config(root, targets); }

    // the 3DMigoto libraries every importer uses
    let libs = root.join("Resources").join("Packages").join("XXMI");
    if !LIBS.iter().all(|f| libs.join(f).is_file()) {
        progress(SetupProgress { step: "Asking GitHub for the 3DMigoto libraries".into(), done: 0, total: None });
        let rel = latest(http, LIBS_REPO).await?;
        let a = pick(&rel, |n| n.ends_with(".zip"))
            .ok_or_else(|| Error::Invalid("The 3DMigoto libraries' latest release has no zip. Try again later".into()))?;
        let zip = fetch(http, work, a, "Downloading the 3DMigoto libraries", progress).await?;
        unpack(zip, work.join("libs"), libs.clone(), false).await?;
        if let Some(m) = pick(&rel, |n| n == "manifest.json") {
            let path = fetch(http, work, m, "Downloading the 3DMigoto libraries", progress).await?;
            std::fs::copy(&path, libs.join("Manifest.json"))?;
        }
    }

    // each game's importer
    for t in targets {
        let code = t.code.to_ascii_uppercase();
        let name = crate::xxmi::game_for_code(&code).and_then(crate::games::def).map(|g| g.name).unwrap_or(code.as_str()).to_string();
        let dir = importer_dir(root, &code);
        if !importer_installed(root, &code) {
            let repo = package_repo(&code).ok_or_else(|| Error::Invalid(format!("gachamod doesn't know where {code} comes from")))?;
            progress(SetupProgress { step: format!("Asking GitHub for {code}, {name}'s mod loader"), done: 0, total: None });
            let rel = latest(http, repo).await?;
            let lc = code.to_ascii_lowercase();
            let a = pick(&rel, |n| n.starts_with(&lc) && n.ends_with(".zip")).or_else(|| pick(&rel, |n| n.ends_with(".zip")))
                .ok_or_else(|| Error::Invalid(format!("{code}'s latest release has no zip. Try again later")))?;
            let zip = fetch(http, work, a, &format!("Downloading {code} for {name}"), progress).await?;
            progress(SetupProgress { step: format!("Setting up {code} for {name}"), done: 0, total: None });
            unpack(zip, work.join(&lc), dir.clone(), true).await?;
        }
        std::fs::create_dir_all(dir.join("Mods"))?;
        for f in LIBS {
            let to = dir.join(f);
            if !to.is_file() && libs.join(f).is_file() { std::fs::copy(libs.join(f), &to)?; }
        }
    }
    progress(SetupProgress { step: "Writing XXMI Launcher's settings".into(), done: 0, total: None });
    write_config(root, targets)
}

async fn fetch(http: &reqwest::Client, work: &Path, a: &Asset, step: &str, progress: &mut (dyn FnMut(SetupProgress) + Send)) -> Result<PathBuf> {
    let step = step.to_string();
    let got = crate::download::download(http, &a.browser_download_url, &work.join("dl"), &a.name, None, |done, total| {
        progress(SetupProgress { step: step.clone(), done, total });
        true
    }).await?;
    Ok(got.path)
}

/// Unpack `zip` into `dest`, through `tmp`. A zip with one folder at its top unpacks that folder's contents. With
/// `keep`, files `dest` has already stay as they are.
async fn unpack(zip: PathBuf, tmp: PathBuf, dest: PathBuf, keep: bool) -> Result<()> {
    tokio::task::spawn_blocking(move || -> Result<()> {
        let _ = std::fs::remove_dir_all(&tmp);
        crate::archive::extract(&zip, &tmp)?;
        let mut top = tmp.clone();
        loop {
            let items: Vec<PathBuf> = std::fs::read_dir(&top)?.flatten().map(|e| e.path()).collect();
            match items.as_slice() { [one] if one.is_dir() => top = one.clone(), _ => break }
        }
        merge(&top, &dest, keep)?;
        let _ = std::fs::remove_dir_all(&tmp);
        Ok(())
    }).await.map_err(|e| Error::Invalid(e.to_string()))?
}

fn merge(from: &Path, to: &Path, keep: bool) -> Result<()> {
    std::fs::create_dir_all(to).at(to)?;
    for e in std::fs::read_dir(from).at(from)?.flatten() {
        let (src, dst) = (e.path(), to.join(e.file_name()));
        if src.is_dir() { merge(&src, &dst, keep)?; continue; }
        if dst.exists() {
            if keep { continue; }
            std::fs::remove_file(&dst)?;
        }
        if std::fs::rename(&src, &dst).is_err() { std::fs::copy(&src, &dst)?; }
    }
    Ok(())
}

/// The config XXMI starts from: the importers turned on, the first one active, and each game's folder when known and
/// not set yet. A config that's there already keeps everything else (xxmi::write_paths).
pub fn write_config(root: &Path, targets: &[Target]) -> Result<()> {
    let path = root.join(CONFIG_FILE);
    if !path.is_file() {
        std::fs::write(&path, serde_json::to_string_pretty(&json!({ "Launcher": {}, "Importers": {} }))?)?;
    }
    if targets.is_empty() { return Ok(()); }
    let text = std::fs::read_to_string(&path).at(&path)?;
    let cfg: Value = serde_json::from_str(text.trim_start_matches('\u{feff}')).unwrap_or(Value::Null);
    let mut enabled: Vec<String> = cfg["Launcher"]["enabled_importers"].as_array()
        .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
    let codes: Vec<String> = targets.iter().map(|t| t.code.to_ascii_uppercase()).collect();
    for c in &codes { if !enabled.iter().any(|e| e.eq_ignore_ascii_case(c)) { enabled.push(c.clone()); } }
    let active = cfg["Launcher"]["active_importer"].as_str().unwrap_or("");
    let mut sets: Vec<(Vec<&str>, Value)> = vec![(vec!["Launcher", "enabled_importers"], json!(enabled))];
    if active.is_empty() || active.eq_ignore_ascii_case("XXMI") { sets.push((vec!["Launcher", "active_importer"], json!(codes[0]))); }
    for (t, code) in targets.iter().zip(&codes) {
        let Some(dir) = &t.game_dir else { continue };
        let set = cfg["Importers"][code.as_str()]["Importer"]["game_folder"].as_str().is_some_and(|s| !s.trim().is_empty() && Path::new(s).is_dir());
        if !set { sets.push((vec!["Importers", code.as_str(), "Importer", "game_folder"], json!(dir.to_string_lossy()))); }
    }
    xxmi::write_paths(&path, &sets)
}

/// What a loader folder keeps when it's uninstalled: the mods and the values they saved (toggles, colours).
const KEEP: [&str; 2] = ["mods", "d3dx_user.ini"];

/// The folders, files and shortcuts an uninstall sends to the Recycle Bin, and the Mods folders it leaves.
#[derive(Debug, Default, PartialEq)]
pub struct Removal { pub recycle: Vec<PathBuf>, pub kept: Vec<PathBuf> }

/// The importer codes XXMI knows of at `root`, each with its folder.
fn importers(root: &Path) -> Vec<(String, PathBuf)> {
    let mut codes: Vec<String> = std::fs::read_to_string(root.join(CONFIG_FILE)).ok()
        .and_then(|t| serde_json::from_str::<Value>(t.trim_start_matches('\u{feff}')).ok())
        .and_then(|c| c["Importers"].as_object().map(|m| m.keys().cloned().collect()))
        .unwrap_or_default();
    for g in crate::games::GAMES.iter().filter(|g| g.xxmi) {
        if !codes.iter().any(|c| c.eq_ignore_ascii_case(g.importer)) { codes.push(g.importer.to_string()); }
    }
    codes.into_iter().filter(|c| package_repo(c).is_some()).map(|c| { let d = importer_dir(root, &c); (c, d) }).collect()
}

/// What uninstalling takes (pure, for tests). With `codes` empty: XXMI Launcher and every loader, so everything in
/// its folder except each loader's Mods folder and d3dx_user.ini. Otherwise only those loaders' files, the same way.
pub fn plan_removal(root: &Path, codes: &[String]) -> Removal {
    let all = codes.is_empty();
    let mut r = Removal::default();
    let mut loader_dirs: Vec<PathBuf> = Vec::new();
    for (code, dir) in importers(root) {
        if !all && !codes.iter().any(|c| c.eq_ignore_ascii_case(&code)) { continue; }
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_ascii_lowercase();
            if KEEP.contains(&name.as_str()) {
                if name == "mods" { r.kept.push(e.path()); }
            } else {
                r.recycle.push(e.path());
            }
        }
        loader_dirs.push(dir);
    }
    if all {
        for e in std::fs::read_dir(root).into_iter().flatten().flatten() {
            let p = e.path();
            if !loader_dirs.iter().any(|d| d == &p) { r.recycle.push(p); }
        }
    }
    r.recycle.sort();
    r.kept.sort();
    r
}

/// Shortcuts on the desktop and in the Start menu that start something in `root` (XXMI makes one per game).
fn shortcuts_into(root: &Path) -> Vec<PathBuf> {
    let Some(home) = std::env::var_os("USERPROFILE").map(PathBuf::from) else { return Vec::new() };
    let mut dirs = vec![home.join("Desktop"), home.join("OneDrive").join("Desktop")];
    if let Some(a) = std::env::var_os("APPDATA") { dirs.push(PathBuf::from(a).join(r"Microsoft\Windows\Start Menu\Programs")); }
    let want: Vec<u16> = root.to_string_lossy().to_lowercase().encode_utf16().collect();
    let ansi = root.to_string_lossy().to_lowercase().into_bytes();
    let mut out = Vec::new();
    for d in dirs {
        for e in walkdir::WalkDir::new(&d).max_depth(2).into_iter().flatten() {
            let p = e.path();
            if !p.extension().is_some_and(|x| x.eq_ignore_ascii_case("lnk")) { continue; }
            let Ok(bytes) = std::fs::read(p) else { continue };
            if bytes.len() > 64 * 1024 { continue; }
            let lower: Vec<u8> = bytes.iter().map(|b| b.to_ascii_lowercase()).collect();
            let wide: Vec<u16> = bytes.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).map(|u| if u < 128 { (u as u8).to_ascii_lowercase() as u16 } else { u }).collect();
            let has = |hay: &[u8], n: &[u8]| !n.is_empty() && hay.windows(n.len()).any(|w| w == n);
            let has16 = |hay: &[u16], n: &[u16]| !n.is_empty() && hay.windows(n.len()).any(|w| w == n);
            // the path is stored as UTF-16 at either byte offset, or as ANSI
            let odd: Vec<u16> = bytes.get(1..).unwrap_or_default().chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).map(|u| if u < 128 { (u as u8).to_ascii_lowercase() as u16 } else { u }).collect();
            if has(&lower, &ansi) || has16(&wide, &want) || has16(&odd, &want) { out.push(p.to_path_buf()); }
        }
    }
    out
}

/// Uninstall mod loaders through XXMI's folder: `codes` empty removes XXMI Launcher and every loader. Files go to the
/// Recycle Bin; each loader's Mods folder and d3dx_user.ini stay where they are, so installing again picks them up.
/// Returns the Mods folders left. Refuses while XXMI Launcher or one of the games runs.
pub fn uninstall(custom: Option<&str>, codes: &[String]) -> Result<Vec<PathBuf>> {
    let root = xxmi::find_root(custom).ok_or_else(|| Error::NotSetUp("XXMI Launcher isn't installed".into()))?;
    if crate::launch::process_running(EXE_NAME) {
        return Err(Error::Conflict("Close XXMI Launcher first. It rewrites its settings when it closes".into()));
    }
    for g in crate::games::GAMES.iter().filter(|g| g.xxmi) {
        let hit = codes.is_empty() || codes.iter().any(|c| c.eq_ignore_ascii_case(g.importer));
        if hit && g.exe_names.iter().any(|e| crate::launch::process_running(e)) {
            return Err(Error::Conflict(format!("Close {} first. It has the mod loader's files open", g.name)));
        }
    }
    let mut r = plan_removal(&root, codes);
    if codes.is_empty() { r.recycle.extend(shortcuts_into(&root)); }
    crate::recycle::to_recycle_bin(&r.recycle)?;
    if !codes.is_empty() { forget_in_config(&root, codes)?; }
    crate::logs::info(format!("Uninstalled {}: {} items to the Recycle Bin", if codes.is_empty() { "XXMI Launcher".to_string() } else { codes.join(", ") }, r.recycle.len()));
    Ok(r.kept)
}

/// Take `codes` out of XXMI's enabled loaders, so it doesn't count them as installed.
fn forget_in_config(root: &Path, codes: &[String]) -> Result<()> {
    let path = root.join(CONFIG_FILE);
    let Ok(text) = std::fs::read_to_string(&path) else { return Ok(()) };
    let cfg: Value = serde_json::from_str(text.trim_start_matches('\u{feff}')).unwrap_or(Value::Null);
    let gone = |c: &str| codes.iter().any(|x| x.eq_ignore_ascii_case(c));
    let enabled: Vec<String> = cfg["Launcher"]["enabled_importers"].as_array()
        .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).filter(|c| !gone(c)).collect()).unwrap_or_default();
    let mut sets: Vec<(Vec<&str>, Value)> = vec![(vec!["Launcher", "enabled_importers"], json!(enabled.clone()))];
    if cfg["Launcher"]["active_importer"].as_str().is_some_and(gone) {
        sets.push((vec!["Launcher", "active_importer"], json!(enabled.first().cloned().unwrap_or_else(|| "XXMI".into()))));
    }
    let up: Vec<String> = codes.iter().map(|c| c.to_ascii_uppercase()).collect();
    for c in &up {
        if cfg["Packages"]["packages"][c.as_str()]["deployed_version"].is_string() {
            sets.push((vec!["Packages", "packages", c.as_str(), "deployed_version"], json!("")));
        }
    }
    xxmi::write_paths(&path, &sets)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uninstalling_keeps_mods_and_saved_values() {
        let root = tmp("remove");
        for code in ["ZZMI", "GIMI"] {
            let d = root.join(code);
            std::fs::create_dir_all(d.join("Mods").join("Ellen")).unwrap();
            std::fs::create_dir_all(d.join("Core").join(code)).unwrap();
            std::fs::write(d.join("d3dx.ini"), "x").unwrap();
            std::fs::write(d.join("d3dx_user.ini"), "saved").unwrap();
            std::fs::write(d.join("d3d11.dll"), "MZ").unwrap();
        }
        std::fs::create_dir_all(root.join("Resources").join("Bin")).unwrap();
        std::fs::write(root.join(CONFIG_FILE), "{}").unwrap();
        // one loader: only its files, nothing of XXMI's own
        let one = plan_removal(&root, &["zzmi".into()]);
        assert_eq!(one.kept, vec![root.join("ZZMI").join("Mods")]);
        assert_eq!(one.recycle, vec![root.join("ZZMI").join("Core"), root.join("ZZMI").join("d3d11.dll"), root.join("ZZMI").join("d3dx.ini")]);
        // everything: XXMI's own files too, but every Mods folder and d3dx_user.ini stays
        let all = plan_removal(&root, &[]);
        assert_eq!(all.kept, vec![root.join("GIMI").join("Mods"), root.join("ZZMI").join("Mods")]);
        assert!(all.recycle.contains(&root.join("Resources")) && all.recycle.contains(&root.join(CONFIG_FILE)));
        assert!(!all.recycle.iter().any(|p| p.ends_with("Mods") || p.ends_with("d3dx_user.ini") || p == &root.join("ZZMI")));
    }

    #[test]
    fn a_removed_loader_leaves_the_config() {
        let root = tmp("forget");
        std::fs::write(root.join(CONFIG_FILE), "{\n    \"Launcher\": {\n        \"active_importer\": \"ZZMI\",\n        \"enabled_importers\": [\n            \"ZZMI\",\n            \"GIMI\"\n        ]\n    },\n    \"Packages\": {\n        \"packages\": {\n            \"ZZMI\": {\n                \"deployed_version\": \"2.1.0\"\n            }\n        }\n    }\n}\n").unwrap();
        forget_in_config(&root, &["ZZMI".into()]).unwrap();
        let v: Value = serde_json::from_str(&std::fs::read_to_string(root.join(CONFIG_FILE)).unwrap()).unwrap();
        assert_eq!(v["Launcher"]["enabled_importers"], json!(["GIMI"]));
        assert_eq!(v["Launcher"]["active_importer"], json!("GIMI"));
        assert_eq!(v["Packages"]["packages"]["ZZMI"]["deployed_version"], json!(""));
    }

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("gm-xxmi-setup-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn config_from_nothing_turns_importers_on() {
        let root = tmp("fresh");
        let game = root.join("ZZZ Game");
        std::fs::create_dir_all(&game).unwrap();
        write_config(&root, &[Target { code: "ZZMI".into(), game_dir: Some(game.clone()) }]).unwrap();
        let v: Value = serde_json::from_str(&std::fs::read_to_string(root.join(CONFIG_FILE)).unwrap()).unwrap();
        assert_eq!(v["Launcher"]["enabled_importers"], json!(["ZZMI"]));
        assert_eq!(v["Launcher"]["active_importer"], json!("ZZMI"));
        assert_eq!(v["Importers"]["ZZMI"]["Importer"]["game_folder"], json!(game.to_string_lossy()));
    }

    #[test]
    fn config_keeps_what_xxmi_had() {
        let root = tmp("keep");
        let mine = root.join("Genshin");
        std::fs::create_dir_all(&mine).unwrap();
        let text = format!("{{\n    \"Launcher\": {{\n        \"active_importer\": \"GIMI\",\n        \"enabled_importers\": [\n            \"GIMI\"\n        ],\n        \"auto_update\": true\n    }},\n    \"Importers\": {{\n        \"GIMI\": {{\n            \"Importer\": {{\n                \"game_folder\": {}\n            }}\n        }}\n    }}\n}}\n", json!(mine.to_string_lossy()));
        std::fs::write(root.join(CONFIG_FILE), &text).unwrap();
        write_config(&root, &[
            Target { code: "GIMI".into(), game_dir: Some(root.join("elsewhere")) },
            Target { code: "ZZMI".into(), game_dir: None },
        ]).unwrap();
        let v: Value = serde_json::from_str(&std::fs::read_to_string(root.join(CONFIG_FILE)).unwrap()).unwrap();
        assert_eq!(v["Launcher"]["enabled_importers"], json!(["GIMI", "ZZMI"]));
        assert_eq!(v["Launcher"]["active_importer"], json!("GIMI"));
        assert_eq!(v["Launcher"]["auto_update"], json!(true));
        assert_eq!(v["Importers"]["GIMI"]["Importer"]["game_folder"], json!(mine.to_string_lossy()));
    }

    #[test]
    fn merge_keeps_files_when_asked() {
        let root = tmp("merge");
        let (from, to) = (root.join("from"), root.join("to"));
        std::fs::create_dir_all(from.join("Core")).unwrap();
        std::fs::create_dir_all(&to).unwrap();
        std::fs::write(from.join("d3dx.ini"), "new").unwrap();
        std::fs::write(from.join("Core").join("main.ini"), "core").unwrap();
        std::fs::write(to.join("d3dx.ini"), "mine").unwrap();
        merge(&from, &to, true).unwrap();
        assert_eq!(std::fs::read_to_string(to.join("d3dx.ini")).unwrap(), "mine");
        assert_eq!(std::fs::read_to_string(to.join("Core").join("main.ini")).unwrap(), "core");
    }
}
