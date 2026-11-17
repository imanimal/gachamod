//! gachamod's own updates: version numbers and what the About section shows. Owner: SYSTEM area.
//!
//! Finding, downloading and installing an update is Tauri's updater (src-tauri commands/app.rs): it reads the
//! signed `latest.json` of the newest GitHub release and only installs an installer signed with the release key.

use serde::{Deserialize, Serialize};
use std::cmp::Ordering;

/// The repo whose releases carry gachamod's installers.
pub const REPO: &str = "imanimal/gachamod";
/// The setting for automatic updates: "1" (or unset) downloads and installs them, "tell" only says a new version is
/// out, "0" never looks by itself.
pub const SETTING: &str = "app.updateCheck";

/// What gachamod does about its own updates by itself, from the `SETTING` value.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AutoMode { Install, Tell, Off }

impl AutoMode {
    pub fn from_setting(v: Option<&str>) -> Self {
        match v { Some("0") => Self::Off, Some("tell") => Self::Tell, _ => Self::Install }
    }
}

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

// ── what the About section shows ──

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
}

impl Release {
    pub fn new(version: &str, notes: Option<&str>, published_at: Option<String>) -> Self {
        let version = version.trim().trim_start_matches(['v', 'V']).to_string();
        Release {
            name: format!("gachamod {version}"),
            url: release_page(&version),
            notes: notes.unwrap_or_default().trim().to_string(),
            published_at,
            version,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    pub current: String,
    /// The update feed answered.
    pub reachable: bool,
    /// The release is newer than this copy.
    pub available: bool,
    /// The newer version is downloaded and checked: it installs when gachamod closes, or right away on Restart.
    pub ready: bool,
    pub release: Option<Release>,
}

/// The GitHub page of a release ("0.2.0" -> .../releases/tag/v0.2.0).
pub fn release_page(version: &str) -> String {
    format!("https://github.com/{REPO}/releases/tag/v{}", version.trim_start_matches(['v', 'V']))
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn release_names_and_pages() {
        let r = Release::new("v0.2.0", Some("  Fixes and a new theme.\n"), None);
        assert_eq!(r.version, "0.2.0");
        assert_eq!(r.name, "gachamod 0.2.0");
        assert_eq!(r.url, "https://github.com/imanimal/gachamod/releases/tag/v0.2.0");
        assert_eq!(r.notes, "Fixes and a new theme.");
        assert_eq!(Release::new("0.3.1", None, None).notes, "");
    }
}
