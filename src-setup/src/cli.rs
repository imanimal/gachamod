//! The command line. People start setup with no arguments; Windows' Uninstall button adds `--uninstall`, and gachamod
//! adds `--apply` when it installs an update it downloaded (src-tauri commands/app.rs), with `--quiet
//! --open-background` when it ran in the background. Scripts and other installers pass NSIS switches (/S, /P,
//! /UPDATE, /D=, _?=), which go straight to the NSIS installer or uninstaller with no window.
use std::path::PathBuf;

/// gachamod looks for these bytes in setup.exe before handing it an update (src-tauri commands/app.rs), since an
/// older setup.exe would ignore `--apply` and open its usual window. Change both together.
pub const APPLY_MARK: &str = "gachamod-setup:apply-v1";
/// The same for `--quiet` and `--open-background`: an older setup.exe would show its window during an update
/// gachamod installs from the background, and leave gachamod closed after. Change both together.
pub const APPLY_QUIET_MARK: &str = "gachamod-setup:apply-quiet-v1";

#[derive(Debug, Default, Clone)]
pub struct Cli {
    pub uninstall: bool,
    pub repair: bool,
    /// A theme or game to show (`--theme zzz`), over anything the download link says.
    pub theme: Option<String>,
    /// The install folder, when this is a copy in %TEMP% started for the setup.exe in that folder.
    pub from: Option<PathBuf>,
    /// An NSIS switch was given: no window, hand the call to NSIS.
    pub nsis: bool,
    /// An update installer gachamod downloaded and checked (`--apply <file>`), with its signature (`--sig <file>`) and
    /// version (`--apply-version`). `--open` opens gachamod after; without it gachamod was closed and stays closed.
    pub apply: Option<PathBuf>,
    pub sig: Option<PathBuf>,
    pub apply_version: Option<String>,
    pub open: bool,
    /// With `--apply`: the window stays hidden unless the update fails (`--quiet`), and gachamod starts after with
    /// only its tray icon (`--open-background`). gachamod passes both when it installs an update while it runs in the
    /// background.
    pub quiet: bool,
    pub open_background: bool,
}

pub fn parse() -> Cli { parse_args(std::env::args_os().skip(1).map(|a| a.to_string_lossy().into_owned())) }

fn parse_args(args: impl IntoIterator<Item = String>) -> Cli {
    let mut c = Cli::default();
    let mut args = args.into_iter();
    while let Some(a) = args.next() {
        let l = a.to_ascii_lowercase();
        match l.as_str() {
            "--uninstall" | "/uninstall" => c.uninstall = true,
            "--repair" | "/repair" => c.repair = true,
            "--theme" => c.theme = args.next(),
            "--from" => c.from = args.next().map(PathBuf::from),
            "--apply" => c.apply = args.next().map(PathBuf::from),
            "--sig" => c.sig = args.next().map(PathBuf::from),
            "--apply-version" => c.apply_version = args.next(),
            "--open" => c.open = true,
            "--quiet" => c.quiet = true,
            "--open-background" => c.open_background = true,
            "/s" | "/p" | "/update" | "/r" | "/ns" => c.nsis = true,
            _ if l.starts_with("--theme=") || l.starts_with("/theme=") => c.theme = a.split_once('=').map(|(_, v)| v.to_string()),
            _ if l.starts_with("/d=") || l.starts_with("_?=") || l == "/args" => c.nsis = true,
            _ => {}
        }
    }
    c
}

/// The command line after the program's own name, as typed: NSIS's `/D=` and `_?=` run to the end of the line,
/// spaces included, so they can't go through normal argument splitting.
pub fn raw_tail() -> String {
    let line = crate::sys::command_line();
    let s = line.trim_start();
    let rest = if let Some(q) = s.strip_prefix('"') { q.find('"').map_or("", |i| &q[i + 1..]) } else { s.find(char::is_whitespace).map_or("", |i| &s[i..]) };
    rest.trim().to_string()
}

/// `raw_tail` without setup's own switches, for handing to NSIS.
pub fn nsis_tail() -> String {
    let tail = raw_tail();
    let mut out: Vec<&str> = Vec::new();
    let mut words = tail.split(' ').peekable();
    while let Some(w) = words.next() {
        let l = w.to_ascii_lowercase();
        // `_?=` and `/D=` take the rest of the line
        if l.starts_with("_?=") || l.starts_with("/d=") { out.push(w); out.extend(words.by_ref()); break; }
        match l.as_str() {
            "--uninstall" | "/uninstall" | "--repair" | "/repair" | "--open" | "--quiet" | "--open-background" | "" => {}
            "--theme" | "--from" | "--apply" | "--sig" | "--apply-version" => { words.next(); }
            _ if l.starts_with("--theme=") || l.starts_with("/theme=") => {}
            _ => out.push(w),
        }
    }
    out.join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn args(line: &str) -> Cli { parse_args(line.split(' ').map(String::from)) }

    #[test]
    fn apply_takes_quiet_and_open_background() {
        let c = args(r"--apply C:\tmp\u.exe --sig C:\tmp\u.sig --apply-version 0.1.2 --quiet --open-background");
        assert_eq!(c.apply.as_deref(), Some(Path::new(r"C:\tmp\u.exe")));
        assert_eq!(c.sig.as_deref(), Some(Path::new(r"C:\tmp\u.sig")));
        assert_eq!(c.apply_version.as_deref(), Some("0.1.2"));
        assert!(c.quiet && c.open_background && !c.open && !c.nsis);
    }

    #[test]
    fn apply_without_the_new_flags_is_as_before() {
        let c = args("--apply u.exe --sig u.sig --apply-version 0.1.2 --open");
        assert!(c.open && !c.quiet && !c.open_background && !c.nsis);
        let c = args("--apply u.exe --sig u.sig");
        assert!(!c.open && !c.quiet && !c.open_background);
    }

    #[test]
    fn the_flags_are_not_nsis_switches() {
        let c = args(r"--quiet --open-background --from C:\gm");
        assert!(!c.nsis && c.quiet && c.open_background);
        assert_eq!(c.from.as_deref(), Some(Path::new(r"C:\gm")));
    }
}
