//! Steam, for a game whose Steam copy only starts from Steam (ZZZ): getting Steam signed in before a start, and the
//! game's launch options in Steam's localconfig.vdf. Owner: SYSTEM area (docs/spec.md, "Launching").
//!
//! A Steam that has only just started isn't signed in yet and drops a `-applaunch` sent to it. When the launch options
//! XXMI Launcher wants differ from Steam's, XXMI closes Steam, writes them, starts Steam and sends its `-applaunch`
//! straight away, so that start failed. gachamod writes the same options first and waits for the sign-in, and XXMI
//! then finds nothing to change.

use crate::launch::{name_matches, process_running, processes, shell_start};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// How long Steam gets to sign in after it starts (it may update itself first).
const SIGN_IN: Duration = Duration::from_secs(90);
/// How long Steam gets to close after `-shutdown`.
const CLOSE: Duration = Duration::from_secs(30);
/// A Steam that just signed in still loads for a moment before a `-applaunch` takes.
const SETTLE: Duration = Duration::from_secs(5);
/// After a restart XXMI Launcher caused, how long the game gets to start from XXMI's own `-applaunch`.
const RETRY_AFTER: Duration = Duration::from_secs(10);
/// How long the watch after handing off to XXMI Launcher lasts.
const WATCH: Duration = Duration::from_secs(180);
const POLL: Duration = Duration::from_millis(500);
const STEAM_EXE: &str = "steam.exe";
/// Where localconfig.vdf keeps each app's settings.
const APPS: [&str; 5] = ["UserLocalConfigStore", "Software", "Valve", "Steam", "apps"];

/// steam.exe and its folder.
fn install() -> Option<(PathBuf, PathBuf)> {
    let exe = crate::games::steam_exe()?;
    let dir = exe.parent()?.to_path_buf();
    Some((exe, dir))
}

#[cfg(windows)]
fn reg_dword(key: &str, name: &str) -> u32 {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};
    RegKey::predef(HKEY_CURRENT_USER).open_subkey(key).and_then(|k| k.get_value::<u32, _>(name)).unwrap_or(0)
}
#[cfg(not(windows))]
fn reg_dword(_: &str, _: &str) -> u32 { 0 }

/// Steam's process id and signed-in account (0 when none), as Steam notes them in the registry.
fn active() -> (u32, u32) {
    let key = r"Software\Valve\Steam\ActiveProcess";
    (reg_dword(key, "pid"), reg_dword(key, "ActiveUser"))
}

/// A steam.exe runs.
pub fn running() -> bool { process_running(STEAM_EXE) }

/// Steam runs and has an account signed in.
pub fn signed_in() -> bool {
    let (pid, user) = active();
    user != 0 && pid != 0 && processes().iter().any(|p| p.pid == pid && name_matches(&p.name, STEAM_EXE))
}

/// Steam has `app` running (or starting).
pub fn app_running(app: u32) -> bool { reg_dword(&format!(r"Software\Valve\Steam\Apps\{app}"), "Running") == 1 }

fn wait_until(limit: Duration, done: impl Fn() -> bool) -> bool {
    let end = Instant::now() + limit;
    loop {
        if done() { return true; }
        if Instant::now() >= end { return false; }
        std::thread::sleep(POLL);
    }
}

/// Start Steam in the tray and wait for the sign-in, then a moment more.
fn start_signed_in(exe: &Path, dir: &Path) {
    if let Err(e) = shell_start(exe, "-silent", dir) { crate::logs::warn(format!("Steam didn't start: {e}")); return; }
    wait_signed_in();
}

fn wait_signed_in() {
    if wait_until(SIGN_IN, signed_in) { std::thread::sleep(SETTLE); }
    else { crate::logs::warn("Steam didn't sign in within 90 seconds. Starting the game anyway"); }
}

/// Ask Steam to close and wait until it has.
fn close(exe: &Path) -> bool {
    let mut cmd = std::process::Command::new(exe);
    cmd.arg("-shutdown");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    if cmd.spawn().is_err() { return false; }
    wait_until(CLOSE, || !running())
}

/// Get Steam ready to start `app`, so the `-applaunch` that comes next isn't lost on a Steam that is still starting.
/// `options` are the launch options XXMI Launcher will want for `app`: Steam only takes new ones while it is closed,
/// so a running Steam closes and starts again. Every wait gives up after its timeout and the start carries on.
/// True when Steam restarted for the options.
pub fn get_ready(app: u32, options: Option<&str>) -> bool {
    let Some((exe, dir)) = install() else { return false };
    if !running() {
        if let Some(o) = options { let _ = write_options(&dir, app, o); }
        start_signed_in(&exe, &dir);
    } else if !signed_in() {
        wait_signed_in();
    }
    // Steam ran all along, or another account signed in than the one written for
    let Some(o) = options.filter(|o| signed_in() && needs_options(&dir, app, o)) else { return false };
    crate::logs::info("Restarting Steam to set the game's launch options for XXMI Launcher");
    if !close(&exe) {
        crate::logs::warn("Steam didn't close within 30 seconds. Leaving the launch options to XXMI Launcher");
        return false;
    }
    if let Err(e) = write_options(&dir, app, o) { crate::logs::warn(format!("Couldn't write Steam's launch options: {e}")); }
    start_signed_in(&exe, &dir);
    true
}

/// After the hand-off to XXMI Launcher: if XXMI restarts Steam anyway, it sends its `-applaunch` to a Steam that
/// isn't signed in yet, which drops it. Once that Steam has signed in, while XXMI still waits and the game hasn't
/// started, ask Steam again, once.
pub fn watch_restart(app: u32, game: &'static str) {
    let before = active().0;
    std::thread::spawn(move || {
        let start = Instant::now();
        let mut restarted = false;
        let mut seen_xxmi = false;
        let mut ready: Option<Instant> = None;
        while start.elapsed() < WATCH {
            std::thread::sleep(Duration::from_secs(1));
            if app_running(app) || crate::launch::running(game) { return; }
            let xxmi = process_running(crate::xxmi::EXE_NAME);
            seen_xxmi |= xxmi;
            if !xxmi && (seen_xxmi || start.elapsed() > Duration::from_secs(15)) { return; }
            restarted |= active().0 != before;
            if !restarted || !signed_in() { ready = None; continue; }
            if ready.get_or_insert_with(Instant::now).elapsed() < RETRY_AFTER { continue; }
            let Some((exe, dir)) = install() else { return };
            crate::logs::info("Steam restarted for XXMI Launcher and the game didn't start, so gachamod asked Steam again");
            let _ = shell_start(&exe, &format!("-silent -applaunch {app}"), &dir);
            return;
        }
    });
}

// ── localconfig.vdf ──

/// The localconfig.vdf XXMI Launcher edits: `userdata\<account>\config\localconfig.vdf`, for the account
/// `config\loginusers.vdf` names.
fn localconfig(dir: &Path) -> Option<PathBuf> {
    let users = std::fs::read_to_string(dir.join("config").join("loginusers.vdf")).ok()?;
    let p = dir.join("userdata").join(recent_account(&users)?.to_string()).join("config").join("localconfig.vdf");
    p.is_file().then_some(p)
}

/// The account XXMI Launcher picks from loginusers.vdf (the only one, else the latest Timestamp), as the 32-bit id
/// its userdata folder is named after.
pub fn recent_account(loginusers: &str) -> Option<u32> {
    let doc = vdf::parse(loginusers);
    let mut best: Option<(u64, i64)> = None;
    for u in vdf::get(&doc, "users")?.items() {
        let Ok(id) = u.key.parse::<u64>() else { continue };
        if vdf::get(u.items(), "AccountName").and_then(vdf::Kv::text).is_none() { continue; }
        let ts = vdf::get(u.items(), "Timestamp").and_then(vdf::Kv::text).and_then(|t| t.trim().parse().ok()).unwrap_or(0);
        if best.is_none_or(|(_, b)| ts > b) { best = Some((id, ts)); }
    }
    best.map(|(id, _)| (id & 0xFFFF_FFFF) as u32)
}

/// localconfig.vdf has other launch options for `app` than `options`, and they can be written there.
fn needs_options(dir: &Path, app: u32, options: &str) -> bool {
    let Some(text) = localconfig(dir).and_then(|p| std::fs::read_to_string(p).ok()) else { return false };
    launch_options_in(&text, app).as_deref() != Some(options) && with_launch_options(&text, app, options).is_some()
}

/// Write `options` for `app` into localconfig.vdf (Steam must be closed: it rewrites the file as it closes). A backup
/// comes first; every other byte stays.
fn write_options(dir: &Path, app: u32, options: &str) -> crate::Result<()> {
    let Some(path) = localconfig(dir) else { return Ok(()) };
    let text = std::fs::read_to_string(&path)?;
    let Some(out) = with_launch_options(&text, app, options) else { return Ok(()) };
    if out == text { return Ok(()); }
    crate::xxmi::backup_once(&path)?;
    crate::xxmi::write_atomic(&path, out.as_bytes())
}

/// `app`'s launch options in a localconfig.vdf text, as XXMI Launcher reads them (None when there are none).
pub fn launch_options_in(text: &str, app: u32) -> Option<String> {
    let doc = vdf::parse(text);
    let a = vdf::get(vdf::path(&doc, &APPS)?.items(), &app.to_string())?;
    vdf::get(a.items(), "LaunchOptions")?.text().map(String::from)
}

/// The localconfig.vdf text with `app`'s launch options set to `options` and every other byte as it was. An app
/// without an entry gets one. None when the text has nowhere to put it.
pub fn with_launch_options(text: &str, app: u32, options: &str) -> Option<String> {
    let doc = vdf::parse(text);
    let apps = vdf::path(&doc, &APPS)?;
    let id = app.to_string();
    let q = vdf::quote(options);
    let (close, lines) = match vdf::get(apps.items(), &id) {
        Some(a) => match vdf::get(a.items(), "LaunchOptions").map(|o| &o.val) {
            Some(vdf::Val::Text(_, at)) => return Some(format!("{}{q}{}", &text[..at.start], &text[at.end..])),
            Some(vdf::Val::Block(..)) => return None,
            None => (a.close()?, vec![format!("\t\"LaunchOptions\"\t\t{q}")]),
        },
        None => (apps.close()?, vec![format!("\t\"{id}\""), "\t{".into(), format!("\t\t\"LaunchOptions\"\t\t{q}"), "\t}".into()]),
    };
    // new lines go above the closing brace, indented one step more than it
    let nl = if text.contains("\r\n") { "\r\n" } else { "\n" };
    let line = text[..close].rfind('\n').map_or(0, |i| i + 1);
    let indent = &text[line..close];
    let (at, indent, lead) = if indent.chars().all(|c| c == ' ' || c == '\t') { (line, indent, "") } else { (close, "", nl) };
    let add: String = lines.iter().map(|l| format!("{indent}{l}{nl}")).collect();
    Some(format!("{}{lead}{add}{}", &text[..at], &text[at..]))
}

/// Where Steam installed `app`: `<library>\steamapps\common\<installdir>`, from the app's manifest in Steam's own folder
/// or a library in libraryfolders.vdf.
pub fn app_dir(app: u32) -> Option<PathBuf> {
    let (_, dir) = install()?;
    let mut libs = vec![dir.clone()];
    if let Ok(t) = std::fs::read_to_string(dir.join("steamapps").join("libraryfolders.vdf")) { libs.extend(crate::games::parse_vdf_paths(&t)); }
    libs.into_iter().find_map(|lib| {
        let manifest = std::fs::read_to_string(lib.join("steamapps").join(format!("appmanifest_{app}.acf"))).ok()?;
        let name = crate::games::vdf_values(&manifest, "installdir").into_iter().next()?;
        Some(lib.join("steamapps").join("common").join(name))
    })
}

/// Just enough of Valve's KeyValues text to find values and where they sit, so an edit changes only those bytes.
mod vdf {
    use std::ops::Range;

    pub struct Kv { pub key: String, pub val: Val }

    pub enum Val {
        /// The unescaped text and where its quoted form sits.
        Text(String, Range<usize>),
        /// The entries and where the closing brace sits (None when the text ends first).
        Block(Vec<Kv>, Option<usize>),
    }

    impl Kv {
        pub fn items(&self) -> &[Kv] { match &self.val { Val::Block(items, _) => items, Val::Text(..) => &[] } }
        pub fn text(&self) -> Option<&str> { match &self.val { Val::Text(t, _) => Some(t), Val::Block(..) => None } }
        pub fn close(&self) -> Option<usize> { match &self.val { Val::Block(_, c) => *c, Val::Text(..) => None } }
    }

    enum Tok { Open, Close(usize), Str(String, Range<usize>) }

    /// The first entry named `key`, any case.
    pub fn get<'a>(items: &'a [Kv], key: &str) -> Option<&'a Kv> { items.iter().find(|k| k.key.eq_ignore_ascii_case(key)) }

    /// The block at a path of keys.
    pub fn path<'a>(items: &'a [Kv], keys: &[&str]) -> Option<&'a Kv> {
        let (first, rest) = keys.split_first()?;
        let kv = get(items, first).filter(|k| matches!(k.val, Val::Block(..)))?;
        if rest.is_empty() { Some(kv) } else { path(kv.items(), rest) }
    }

    pub fn quote(s: &str) -> String { format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\"")) }

    fn unescape(raw: &str) -> String {
        let mut out = String::with_capacity(raw.len());
        let mut chars = raw.chars();
        while let Some(c) = chars.next() {
            if c != '\\' { out.push(c); continue; }
            match chars.next() {
                Some('n') => out.push('\n'),
                Some('t') => out.push('\t'),
                Some('r') => out.push('\r'),
                Some(c @ ('\\' | '"' | '\'' | '?')) => out.push(c),
                Some(c) => { out.push('\\'); out.push(c); }
                None => out.push('\\'),
            }
        }
        out
    }

    fn tokens(t: &str) -> Vec<Tok> {
        let b = t.as_bytes();
        let (mut i, mut out) = (0, Vec::new());
        while i < b.len() {
            match b[i] {
                c if c.is_ascii_whitespace() => i += 1,
                b'/' if b.get(i + 1) == Some(&b'/') => { while i < b.len() && b[i] != b'\n' { i += 1; } }
                b'{' => { out.push(Tok::Open); i += 1; }
                b'}' => { out.push(Tok::Close(i)); i += 1; }
                b'"' => {
                    let start = i;
                    i += 1;
                    while i < b.len() && b[i] != b'"' { i += if b[i] == b'\\' { 2 } else { 1 }; }
                    let end = i.min(b.len());
                    out.push(Tok::Str(unescape(&t[start + 1..end]), start..(end + 1).min(b.len())));
                    i = end + 1;
                }
                _ => {
                    let start = i;
                    while i < b.len() && !b[i].is_ascii_whitespace() && !matches!(b[i], b'{' | b'}' | b'"') { i += 1; }
                    // a platform condition such as [$WIN32] belongs to the entry before it
                    if b[start] != b'[' { out.push(Tok::Str(t[start..i].to_string(), start..i)); }
                }
            }
        }
        out
    }

    fn block(toks: &[Tok], i: &mut usize) -> (Vec<Kv>, Option<usize>) {
        let mut items = Vec::new();
        while let Some(tok) = toks.get(*i) {
            *i += 1;
            let key = match tok {
                Tok::Close(at) => return (items, Some(*at)),
                Tok::Open => continue,
                Tok::Str(k, _) => k.clone(),
            };
            match toks.get(*i) {
                Some(Tok::Open) => {
                    *i += 1;
                    let (inner, close) = block(toks, i);
                    items.push(Kv { key, val: Val::Block(inner, close) });
                }
                Some(Tok::Str(v, at)) => {
                    *i += 1;
                    items.push(Kv { key, val: Val::Text(v.clone(), at.clone()) });
                }
                _ => {}
            }
        }
        (items, None)
    }

    pub fn parse(text: &str) -> Vec<Kv> { block(&tokens(text), &mut 0).0 }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Shaped like Steam's own file: tabs, LF, escaped paths, and a second "apps" block outside Software\Valve\Steam.
    const LOCALCONFIG: &str = "\"UserLocalConfigStore\"\n{\n\t\"Broadcast\"\n\t{\n\t\t\"Permissions\"\t\t\"1\"\n\t}\n\t\"Software\"\n\t{\n\t\t\"Valve\"\n\t\t{\n\t\t\t\"Steam\"\n\t\t\t{\n\t\t\t\t\"SurveyDate\"\t\t\"2026-01-01\"\n\t\t\t\t\"apps\"\n\t\t\t\t{\n\t\t\t\t\t\"4162040\"\n\t\t\t\t\t{\n\t\t\t\t\t\t\"LastPlayed\"\t\t\"1790000000\"\n\t\t\t\t\t\t\"LaunchOptions\"\t\t\"\\\"D:\\\\Old\\\\ZenlessZoneZero.exe\\\" && %command%\"\n\t\t\t\t\t}\n\t\t\t\t\t\"3513350\"\n\t\t\t\t\t{\n\t\t\t\t\t\t\"Playtime\"\t\t\"12\"\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n\t\"apps\"\n\t{\n\t\t\"4162040\"\n\t\t{\n\t\t\t\"LaunchOptions\"\t\t\"elsewhere\"\n\t\t}\n\t}\n}\n";

    const WANT: &str = r#""D:\SteamLibrary\steamapps\common\ZenlessZoneZero\ZenlessZoneZero.exe" && %command% "#;

    #[test]
    fn reads_launch_options_from_the_steam_block() {
        assert_eq!(launch_options_in(LOCALCONFIG, 4162040).as_deref(), Some(r#""D:\Old\ZenlessZoneZero.exe" && %command%"#));
        assert_eq!(launch_options_in(LOCALCONFIG, 3513350), None);
        assert_eq!(launch_options_in(LOCALCONFIG, 1), None);
        assert_eq!(launch_options_in("garbage { \"", 4162040), None);
    }

    #[test]
    fn writes_only_the_launch_options() {
        let out = with_launch_options(LOCALCONFIG, 4162040, WANT).unwrap();
        assert_eq!(launch_options_in(&out, 4162040).as_deref(), Some(WANT));
        let old = "\"\\\"D:\\\\Old\\\\ZenlessZoneZero.exe\\\" && %command%\"";
        let new = "\"\\\"D:\\\\SteamLibrary\\\\steamapps\\\\common\\\\ZenlessZoneZero\\\\ZenlessZoneZero.exe\\\" && %command% \"";
        assert_eq!(out, LOCALCONFIG.replace(old, new), "every other byte stays");
        assert!(out.contains("\"LaunchOptions\"\t\t\"elsewhere\""));
        assert_eq!(with_launch_options(&out, 4162040, WANT).unwrap(), out);
    }

    #[test]
    fn adds_launch_options_and_app_entries() {
        let out = with_launch_options(LOCALCONFIG, 3513350, "-dx11").unwrap();
        assert!(out.contains("\t\t\t\t\t\t\"Playtime\"\t\t\"12\"\n\t\t\t\t\t\t\"LaunchOptions\"\t\t\"-dx11\"\n\t\t\t\t\t}\n"));
        assert_eq!(launch_options_in(&out, 3513350).as_deref(), Some("-dx11"));
        assert_eq!(launch_options_in(&out, 4162040), launch_options_in(LOCALCONFIG, 4162040));

        let out = with_launch_options(LOCALCONFIG, 1671200, "a \"b\" c\\d").unwrap();
        assert!(out.contains("\t\t\t\t\t\"1671200\"\n\t\t\t\t\t{\n\t\t\t\t\t\t\"LaunchOptions\"\t\t\"a \\\"b\\\" c\\\\d\"\n\t\t\t\t\t}\n\t\t\t\t}\n"));
        assert_eq!(launch_options_in(&out, 1671200).as_deref(), Some("a \"b\" c\\d"));

        let crlf = LOCALCONFIG.replace('\n', "\r\n");
        let out = with_launch_options(&crlf, 3513350, "-x").unwrap();
        assert!(out.contains("\"Playtime\"\t\t\"12\"\r\n\t\t\t\t\t\t\"LaunchOptions\"\t\t\"-x\"\r\n"));

        assert_eq!(with_launch_options("\"UserLocalConfigStore\"\n{\n}\n", 4162040, "-x"), None, "no apps block, no write");
    }

    #[test]
    fn picks_the_account_xxmi_picks() {
        let users = "\"users\"\n{\n\t\"76561198000000001\"\n\t{\n\t\t\"AccountName\"\t\t\"one\"\n\t\t\"Timestamp\"\t\t\"1700000000\"\n\t}\n\t\"76561198000000002\"\n\t{\n\t\t\"AccountName\"\t\t\"two\"\n\t\t\"MostRecent\"\t\t\"0\"\n\t\t\"Timestamp\"\t\t\"1800000000\"\n\t}\n\t\"76561198000000003\"\n\t{\n\t\t\"PersonaName\"\t\t\"no account name\"\n\t\t\"Timestamp\"\t\t\"1900000000\"\n\t}\n}\n";
        assert_eq!(recent_account(users), Some((76561198000000002u64 & 0xFFFF_FFFF) as u32));
        assert_eq!(recent_account("\"users\"\n{\n}\n"), None);
    }
}
