//! gachamod's own updates, from the GitHub releases of the app's repo. Owner: SYSTEM area.
//!
//! The user always chooses: a check only reports, and installing downloads the release's installer to a temp
//! folder and starts it when the user asks. Any failure to reach GitHub (no network, a private repo answering 404,
//! rate limits) means "no update info", never an error.

use crate::download;
use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::path::{Path, PathBuf};

pub const RELEASES_API: &str = "https://api.github.com/repos/imanimal/gachamod/releases/latest";
/// Installers are only downloaded from this repo's releases.
const ASSET_PREFIX: &str = "https://github.com/imanimal/gachamod/releases/download/";
/// The setting that turns the daily check off ("0").
pub const SETTING: &str = "app.updateCheck";
/// When the last automatic check ran (unix seconds). Machine-only, never exported.
pub const CHECKED_AT: &str = "app.updateCheckedAt";

// ── versions ──

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Version { pub major: u64, pub minor: u64, pub patch: u64, pub pre: Vec<String> }

/// "1.2.3", "v1.2", "1.2.3-beta.2+build" (build metadata is ignored). None for anything else.
pub fn parse_version(s: &str) -> Option<Version> {
    let s = s.trim().trim_start_matches(['v', 'V']);
    let s = s.split('+').next()?;
    let (core, pre) = match s.split_once('-') { Some((c, p)) => (c, Some(p)), None => (s, None) };
    let mut nums = core.split('.').map(|n| n.parse::<u64>().ok());
    let major = nums.next()??;
    let minor = nums.next().unwrap_or(Some(0))?;
    let patch = nums.next().unwrap_or(Some(0))?;
    if nums.next().is_some() { return None; }
    let pre = match pre {
        Some(p) if p.is_empty() => return None,
        Some(p) => p.split('.').map(str::to_string).collect(),
        None => Vec::new(),
    };
    Some(Version { major, minor, patch, pre })
}

impl Ord for Version {
    fn cmp(&self, o: &Self) -> Ordering {
        (self.major, self.minor, self.patch).cmp(&(o.major, o.minor, o.patch)).then_with(|| {
            // a release is newer than its pre-releases; pre-release parts compare numbers as numbers
            match (self.pre.is_empty(), o.pre.is_empty()) {
                (true, true) => Ordering::Equal,
                (true, false) => Ordering::Greater,
                (false, true) => Ordering::Less,
                _ => {
                    for (a, b) in self.pre.iter().zip(&o.pre) {
                        let c = match (a.parse::<u64>(), b.parse::<u64>()) {
                            (Ok(x), Ok(y)) => x.cmp(&y),
                            (Ok(_), Err(_)) => Ordering::Less,
                            (Err(_), Ok(_)) => Ordering::Greater,
                            _ => a.cmp(b),
                        };
                        if c != Ordering::Equal { return c; }
                    }
                    self.pre.len().cmp(&o.pre.len())
                }
            }
        })
    }
}
impl PartialOrd for Version { fn partial_cmp(&self, o: &Self) -> Option<Ordering> { Some(self.cmp(o)) } }

/// True when `latest` is a newer version than `current`. False when either can't be read.
pub fn is_newer(latest: &str, current: &str) -> bool {
    matches!((parse_version(latest), parse_version(current)), (Some(l), Some(c)) if l > c)
}

// ── releases ──

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Asset { pub name: String, pub url: String, pub size: u64 }

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Release {
    /// "0.2.0", without a leading v.
    pub version: String,
    pub name: String,
    /// The release page.
    pub url: String,
    /// Release notes (Markdown as written on GitHub).
    pub notes: String,
    pub published_at: Option<String>,
    /// The installer to run, when the release has one.
    pub asset: Option<Asset>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    pub current: String,
    /// GitHub answered with a release that could be read.
    pub reachable: bool,
    /// The release is newer than this copy.
    pub available: bool,
    pub release: Option<Release>,
}

#[derive(Deserialize)]
struct GhAsset { name: String, browser_download_url: String, #[serde(default)] size: u64 }
#[derive(Deserialize)]
struct GhRelease {
    tag_name: String,
    #[serde(default)] name: Option<String>,
    #[serde(default)] html_url: String,
    #[serde(default)] body: Option<String>,
    #[serde(default)] draft: bool,
    #[serde(default)] prerelease: bool,
    #[serde(default)] published_at: Option<String>,
    #[serde(default)] assets: Vec<GhAsset>,
}

/// The installer among a release's files: an NSIS setup .exe first, then an .msi, then any other .exe.
pub fn pick_asset(assets: &[Asset]) -> Option<&Asset> {
    let ok = |a: &&Asset| a.url.starts_with(ASSET_PREFIX);
    let lower = |a: &Asset| a.name.to_ascii_lowercase();
    assets.iter().filter(ok).find(|a| { let n = lower(a); n.ends_with(".exe") && n.contains("setup") })
        .or_else(|| assets.iter().filter(ok).find(|a| lower(a).ends_with(".msi")))
        .or_else(|| assets.iter().filter(ok).find(|a| lower(a).ends_with(".exe")))
}

/// Read GitHub's "latest release" answer. Drafts, pre-releases and tags that aren't versions give None.
pub fn parse_release(json: &str) -> Option<Release> {
    let r: GhRelease = serde_json::from_str(json).ok()?;
    if r.draft || r.prerelease { return None; }
    let v = parse_version(&r.tag_name)?;
    let version = format!("{}.{}.{}{}", v.major, v.minor, v.patch, if v.pre.is_empty() { String::new() } else { format!("-{}", v.pre.join(".")) });
    let assets: Vec<Asset> = r.assets.into_iter().map(|a| Asset { name: a.name, url: a.browser_download_url, size: a.size }).collect();
    let asset = pick_asset(&assets).cloned();
    Some(Release {
        name: r.name.filter(|n| !n.trim().is_empty()).unwrap_or_else(|| format!("gachamod {version}")),
        version, url: r.html_url, notes: r.body.unwrap_or_default(), published_at: r.published_at, asset,
    })
}

/// Compare a release (None: no update info) with the running version.
pub fn compare(release: Option<Release>, current: &str) -> UpdateCheck {
    let available = release.as_ref().is_some_and(|r| is_newer(&r.version, current));
    UpdateCheck { current: current.to_string(), reachable: release.is_some(), available, release }
}

/// The latest release, or None when GitHub can't be reached or doesn't answer with one (a 404 while the repo is
/// private, a rate limit, no network).
pub async fn fetch_latest(http: &reqwest::Client, api_url: &str) -> Option<Release> {
    let resp = http.get(api_url)
        .header("Accept", "application/vnd.github+json")
        .timeout(std::time::Duration::from_secs(15))
        .send().await.ok()?;
    if !resp.status().is_success() { return None; }
    parse_release(&resp.text().await.ok()?)
}

pub async fn check(http: &reqwest::Client, current: &str) -> UpdateCheck {
    compare(fetch_latest(http, RELEASES_API).await, current)
}

/// True when an automatic check is due: never checked, or the last one was 20 hours or more ago.
pub fn due(last: Option<i64>, now: i64) -> bool { last.is_none_or(|t| now - t >= 20 * 3600 || t > now) }

/// Download an installer from this app's releases into `dir`. `progress(done, total)` as bytes arrive.
pub async fn download_installer(http: &reqwest::Client, asset: &Asset, dir: &Path, mut progress: impl FnMut(u64, Option<u64>)) -> Result<PathBuf> {
    if !asset.url.starts_with(ASSET_PREFIX) {
        return Err(Error::Invalid("That download isn't from gachamod's releases".into()));
    }
    let name = download::safe_file_name(&asset.name);
    let lower = name.to_ascii_lowercase();
    if !(lower.ends_with(".exe") || lower.ends_with(".msi")) {
        return Err(Error::Invalid("This release has no installer to run".into()));
    }
    let d = download::download(http, &asset.url, dir, &name, |a, b| { progress(a, b); true }).await?;
    if asset.size > 0 && d.size != asset.size {
        let _ = std::fs::remove_file(&d.path);
        return Err(Error::Network("The download came out the wrong size. Try again".into()));
    }
    Ok(d.path)
}

/// Start a downloaded installer on its own (it outlives the app, which should quit right after).
pub fn run_installer(path: &Path) -> Result<()> {
    if !path.is_file() { return Err(Error::Invalid("The downloaded installer is gone. Try again".into())); }
    let msi = path.extension().is_some_and(|e| e.eq_ignore_ascii_case("msi"));
    let mut cmd = if msi { let mut c = std::process::Command::new("msiexec"); c.arg("/i").arg(path); c } else { std::process::Command::new(path) };
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // DETACHED_PROCESS: not tied to the app's console or lifetime
        cmd.creation_flags(0x0000_0008);
    }
    cmd.spawn()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"{
      "url": "https://api.github.com/repos/imanimal/gachamod/releases/1",
      "html_url": "https://github.com/imanimal/gachamod/releases/tag/v0.2.0",
      "tag_name": "v0.2.0", "name": "", "draft": false, "prerelease": false,
      "published_at": "2026-11-01T10:00:00Z", "body": "Fixes and a new theme.",
      "assets": [
        { "name": "gachamod_0.2.0_x64_en-US.msi", "size": 9000, "browser_download_url": "https://github.com/imanimal/gachamod/releases/download/v0.2.0/gachamod_0.2.0_x64_en-US.msi" },
        { "name": "gachamod_0.2.0_x64-setup.exe.sig", "size": 400, "browser_download_url": "https://github.com/imanimal/gachamod/releases/download/v0.2.0/gachamod_0.2.0_x64-setup.exe.sig" },
        { "name": "gachamod_0.2.0_x64-setup.exe", "size": 8000, "browser_download_url": "https://github.com/imanimal/gachamod/releases/download/v0.2.0/gachamod_0.2.0_x64-setup.exe" },
        { "name": "latest.json", "size": 10, "browser_download_url": "https://github.com/imanimal/gachamod/releases/download/v0.2.0/latest.json" }
      ]
    }"#;

    #[test]
    fn compares_versions() {
        assert!(is_newer("0.2.0", "0.1.0"));
        assert!(is_newer("v1.0.0", "0.9.9"));
        assert!(is_newer("0.10.0", "0.9.0"), "numbers, not text");
        assert!(is_newer("1.0.0", "1.0.0-beta.2"));
        assert!(is_newer("1.0.0-beta.10", "1.0.0-beta.2"));
        assert!(is_newer("1.0.0-rc.1", "1.0.0-beta.9"));
        assert!(is_newer("1.0.0-beta.1", "1.0.0-beta"));
        assert!(is_newer("1.1", "1.0.9"));
        assert!(!is_newer("0.1.0", "0.1.0"));
        assert!(!is_newer("0.1.0+build.5", "0.1.0"));
        assert!(!is_newer("0.1.0", "0.2.0"));
        assert!(!is_newer("1.0.0-beta", "1.0.0"));
        assert!(!is_newer("nightly", "0.1.0"));
        assert!(!is_newer("1.2.3.4", "0.1.0"));
    }

    #[test]
    fn reads_a_release_and_picks_the_setup_exe() {
        let r = parse_release(SAMPLE).unwrap();
        assert_eq!(r.version, "0.2.0");
        assert_eq!(r.name, "gachamod 0.2.0");
        assert_eq!(r.url, "https://github.com/imanimal/gachamod/releases/tag/v0.2.0");
        let a = r.asset.as_ref().unwrap();
        assert_eq!(a.name, "gachamod_0.2.0_x64-setup.exe");
        assert_eq!(a.size, 8000);
        let c = compare(Some(r.clone()), "0.1.0");
        assert!(c.reachable && c.available);
        assert!(!compare(Some(r), "0.2.0").available);
        let none = compare(None, "0.1.0");
        assert!(!none.reachable && !none.available);
    }

    #[test]
    fn asset_fallbacks_and_foreign_links() {
        let a = |n: &str, host: &str| Asset { name: n.into(), url: format!("{host}{n}"), size: 1 };
        let gh = "https://github.com/imanimal/gachamod/releases/download/v1/";
        assert_eq!(pick_asset(&[a("x.zip", gh), a("gachamod.msi", gh), a("tool.exe", gh)]).unwrap().name, "gachamod.msi");
        assert_eq!(pick_asset(&[a("x.zip", gh), a("gachamod.exe", gh)]).unwrap().name, "gachamod.exe");
        assert!(pick_asset(&[a("x.zip", gh)]).is_none());
        assert!(pick_asset(&[a("gachamod-setup.exe", "https://example.com/")]).is_none());
    }

    #[test]
    fn skips_drafts_prereleases_and_junk() {
        assert!(parse_release(&SAMPLE.replace("\"prerelease\": false", "\"prerelease\": true")).is_none());
        assert!(parse_release(&SAMPLE.replace("\"draft\": false", "\"draft\": true")).is_none());
        assert!(parse_release(&SAMPLE.replace("v0.2.0\", \"name\"", "nightly\", \"name\"")).is_none());
        assert!(parse_release("{\"message\":\"Not Found\"}").is_none());
        assert!(parse_release("<html>").is_none());
    }

    #[test]
    fn daily() {
        assert!(due(None, 100_000));
        assert!(!due(Some(100_000), 100_000 + 3600));
        assert!(due(Some(100_000), 100_000 + 20 * 3600));
        assert!(due(Some(200_000), 100_000), "a clock that went back still checks");
    }

    /// A server that answers every request with `status` and `body`.
    fn serve(status: &'static str, body: &'static str) -> String {
        use std::io::{BufRead, BufReader, Write};
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = l.local_addr().unwrap();
        std::thread::spawn(move || {
            for s in l.incoming().flatten() {
                let mut r = BufReader::new(s.try_clone().unwrap());
                loop { let mut line = String::new(); if r.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" { break; } }
                let mut s = s;
                let _ = write!(s, "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
            }
        });
        format!("http://{addr}/releases/latest")
    }

    #[tokio::test]
    async fn a_private_repo_or_no_network_is_no_info() {
        let http = reqwest::Client::builder().no_proxy().user_agent("test").build().unwrap();
        assert!(fetch_latest(&http, &serve("404 Not Found", "{\"message\":\"Not Found\"}")).await.is_none());
        assert!(fetch_latest(&http, "http://127.0.0.1:9/nothing").await.is_none());
        let r = fetch_latest(&http, &serve("200 OK", SAMPLE)).await.unwrap();
        assert_eq!(r.version, "0.2.0");
    }

    #[tokio::test]
    async fn refuses_installers_from_elsewhere() {
        let http = reqwest::Client::new();
        let dir = std::env::temp_dir().join(format!("gachamod-test-update-{}", std::process::id()));
        let bad = Asset { name: "setup.exe".into(), url: "https://example.com/setup.exe".into(), size: 1 };
        assert!(download_installer(&http, &bad, &dir, |_, _| {}).await.is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
