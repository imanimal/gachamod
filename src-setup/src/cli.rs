//! The command line. People start setup with no arguments; Windows' Uninstall button adds `--uninstall`. Scripts and
//! other installers pass NSIS switches (/S, /P, /UPDATE, /D=, _?=), which go straight to the NSIS installer or
//! uninstaller with no window.
use std::path::PathBuf;

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
}

pub fn parse() -> Cli {
    let mut c = Cli::default();
    let mut args = std::env::args_os().skip(1).map(|a| a.to_string_lossy().into_owned());
    while let Some(a) = args.next() {
        let l = a.to_ascii_lowercase();
        match l.as_str() {
            "--uninstall" | "/uninstall" => c.uninstall = true,
            "--repair" | "/repair" => c.repair = true,
            "--theme" => c.theme = args.next(),
            "--from" => c.from = args.next().map(PathBuf::from),
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
            "--uninstall" | "/uninstall" | "--repair" | "/repair" | "" => {}
            "--theme" | "--from" => { words.next(); }
            _ if l.starts_with("--theme=") || l.starts_with("/theme=") => {}
            _ => out.push(w),
        }
    }
    out.join(" ")
}
