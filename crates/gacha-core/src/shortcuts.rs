//! Desktop shortcuts: gachamod itself; quickstart, which starts the game gachamod last had open, with mods
//! (`gachamod.exe gachamod://play`, picked up by the UI's screens/home/quickstart.ts); and a quickstart for one game
//! (`gachamod://play/zzz`, "Zenless Zone Zero quickstart"). Quickstart icons are the game's own icon with a quickstart
//! badge in the corner (shortcuts/icon.rs), and the last-game one switches to whichever game that is now (`follow`).
//! gachamod setup asks for the
//! first two and the installer makes them (src-tauri/windows/hooks.nsh); Settings makes them all again. They all open
//! gachamod.exe, so "always as administrator" (devtools::set_always_admin) covers them without a flag of their own.
//! Owner: SYSTEM area.
use crate::db::Db;
use crate::games::{self, GameDef};
use crate::{Error, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

mod icon;

/// What the quickstart shortcut hands gachamod.exe. A game's own quickstart adds the game: gachamod://play/zzz.
pub const PLAY_LINK: &str = "gachamod://play";
/// The quickstart shortcut's icon. The installer puts it next to gachamod.exe; a build or a copy without it gets it
/// written there (or into gachamod's data folder) when the shortcut is made.
const QUICKSTART_ICO: &[u8] = include_bytes!("../../../src-tauri/icons/quickstart.ico");
const QUICKSTART_ICO_NAME: &str = "quickstart.ico";
/// The installer's own key, where it keeps the player's choices ("1" or "0") so a repair puts the desktop back the
/// same way. See hooks.nsh.
const OWN_KEY: &str = "Software\\gachamod";
/// Setting: the game the last-game quickstart starts now, as the UI last said (`follow`).
const LAST_GAME: &str = "quickstart.game";
/// Setting: the icon the last-game quickstart was given and the shortcut's time after, so it's only written again
/// when the game changed or something else (a repair) wrote the shortcut. A game's own quickstart keeps its own under
/// "quickstart.iconStamp.<game>".
const LAST_STAMP: &str = "quickstart.iconStamp";
/// Goes up when icon.rs draws differently, so icons made before are drawn again.
const DRAWING: u32 = 2;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Kind { App, Quickstart }

impl Kind {
    /// The shortcut's file on the desktop. The installer uses the same names.
    fn file_name(self) -> &'static str {
        match self { Kind::App => "gachamod.lnk", Kind::Quickstart => "gachamod quickstart.lnk" }
    }
    fn pref(self) -> &'static str {
        match self { Kind::App => "desktopShortcut", Kind::Quickstart => "quickstartShortcut" }
    }
}

/// A game's own quickstart on the desktop: "Zenless Zone Zero quickstart.lnk". Characters Windows doesn't allow in a
/// file name are left out ("Girls' Frontline 2 Exilium quickstart.lnk").
fn game_file_name(g: &GameDef) -> String {
    let name: String = g.name.chars().filter(|c| !matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')).collect();
    format!("{} quickstart.lnk", name.split_whitespace().collect::<Vec<_>>().join(" "))
}

/// Which shortcuts are on the desktop. `games`: the games with a quickstart of their own there.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct State { pub app: bool, pub quickstart: bool, pub games: Vec<String> }

pub fn state() -> State {
    let desk = desktop();
    let on = |name: &str| desk.as_ref().is_some_and(|d| d.join(name).exists());
    State {
        app: on(Kind::App.file_name()),
        quickstart: on(Kind::Quickstart.file_name()),
        games: games::GAMES.iter().filter(|g| on(&game_file_name(g))).map(|g| g.id.to_string()).collect(),
    }
}

fn desk() -> Result<PathBuf> { desktop().ok_or_else(|| Error::Invalid("Windows didn't say where the desktop is".into())) }

fn exe() -> Result<(PathBuf, PathBuf)> {
    let exe = std::env::current_exe()?;
    let dir = exe.parent().map(Path::to_path_buf).unwrap_or_default();
    Ok((exe, dir))
}

fn put(lnk: &Path, args: &str, icon: &Path, about: &str) -> Result<()> {
    let (exe, dir) = exe()?;
    write_link(lnk, &exe, args, &dir, icon, about)
        .map_err(|e| Error::Invalid(format!("Windows couldn't make the shortcut on the desktop ({e})")))?;
    shell_updated(lnk);
    Ok(())
}

/// Make (or make again, over a broken one) a shortcut on the desktop to this gachamod.exe. `data_dir` holds the
/// quickstart icons when gachamod's own folder can't.
pub fn create(kind: Kind, db: &Db, data_dir: &Path) -> Result<State> {
    let lnk = desk()?.join(kind.file_name());
    match kind {
        Kind::App => put(&lnk, "", &exe()?.0, "Mod manager for 3DMigoto model importer games")?,
        Kind::Quickstart => put_last_game(&lnk, db, data_dir)?,
    }
    set_pref(kind, true);
    Ok(state())
}

/// Take a shortcut off the desktop. The installer leaves it off from then on too.
pub fn remove(kind: Kind) -> Result<State> {
    gone(&desk()?.join(kind.file_name()))?;
    set_pref(kind, false);
    Ok(state())
}

/// Make (or make again) the quickstart for one game, with its icon.
pub fn create_game(game: &str, db: &Db, data_dir: &Path) -> Result<State> {
    let g = games::require_def(game)?;
    put_game(g, &desk()?.join(game_file_name(g)), db, data_dir)?;
    Ok(state())
}

fn put_game(g: &GameDef, lnk: &Path, db: &Db, data_dir: &Path) -> Result<()> {
    let icon = match game_icon(db, data_dir, g.id)? { Some(p) => p, None => plain_icon(data_dir)? };
    put(lnk, &format!("{PLAY_LINK}/{}", g.id), &icon, &format!("Starts {} with mods", g.name))?;
    db.set_setting(&format!("{LAST_STAMP}.{}", g.id), &stamp(&icon, lnk))
}

pub fn remove_game(game: &str) -> Result<State> {
    gone(&desk()?.join(game_file_name(games::require_def(game)?)))?;
    Ok(state())
}

/// Keep the quickstart icons on the desktop current. The last-game quickstart now starts `game`, so its icon becomes
/// that game's; each game's own quickstart gets its icon again when the game's icon or the drawing changed. Quick
/// when nothing changed, so the UI calls it on every game switch.
pub fn follow(game: &str, db: &Db, data_dir: &Path) -> Result<()> {
    games::require_def(game)?;
    if db.setting(LAST_GAME)?.as_deref() != Some(game) { db.set_setting(LAST_GAME, game)?; }
    let Some(desk) = desktop() else { return Ok(()) };
    let lnk = desk.join(Kind::Quickstart.file_name());
    if lnk.exists() {
        let icon = last_game_icon(db, data_dir)?;
        if db.setting(LAST_STAMP)?.as_deref() != Some(stamp(&icon, &lnk).as_str()) { put_last_game(&lnk, db, data_dir)?; }
    }
    for g in games::GAMES {
        let lnk = desk.join(game_file_name(g));
        if !lnk.exists() { continue; }
        // one game's trouble (its folder gone) doesn't hold up the others
        let again = || -> Result<()> {
            let icon = match game_icon(db, data_dir, g.id)? { Some(p) => p, None => plain_icon(data_dir)? };
            if db.setting(&format!("{LAST_STAMP}.{}", g.id))?.as_deref() == Some(stamp(&icon, &lnk).as_str()) { return Ok(()); }
            put_game(g, &lnk, db, data_dir)
        };
        if let Err(e) = again() { crate::logs::warn(format!("Couldn't update the {} quickstart's icon: {e}", g.id)); }
    }
    Ok(())
}

fn put_last_game(lnk: &Path, db: &Db, data_dir: &Path) -> Result<()> {
    let icon = last_game_icon(db, data_dir)?;
    put(lnk, PLAY_LINK, &icon, "Starts the game gachamod last had open, with mods")?;
    db.set_setting(LAST_STAMP, &stamp(&icon, lnk))
}

/// The last game's quickstart icon, or the plain one when no game is known yet or its icon isn't.
fn last_game_icon(db: &Db, data_dir: &Path) -> Result<PathBuf> {
    if let Some(game) = db.setting(LAST_GAME)? {
        if games::def(&game).is_some() { if let Some(p) = game_icon(db, data_dir, &game)? { return Ok(p); } }
    }
    plain_icon(data_dir)
}

fn stamp(icon: &Path, lnk: &Path) -> String {
    let at = std::fs::metadata(lnk).and_then(|m| m.modified()).ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis()).unwrap_or(0);
    format!("{}|{at}", icon.display())
}

fn gone(lnk: &Path) -> Result<()> {
    match std::fs::remove_file(lnk) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(Error::IoAt { path: lnk.to_path_buf(), source: e }),
    }
}

fn set_pref(kind: Kind, on: bool) {
    crate::devtools::win::set_reg_value(OWN_KEY, kind.pref(), Some(if on { "1" } else { "0" }));
}

/// The plain quickstart icon next to gachamod.exe, written there first when it's missing, else into the data folder.
fn plain_icon(data_dir: &Path) -> Result<PathBuf> {
    let beside = exe()?.1.join(QUICKSTART_ICO_NAME);
    if std::fs::metadata(&beside).is_ok_and(|m| m.len() == QUICKSTART_ICO.len() as u64) { return Ok(beside); }
    if std::fs::write(&beside, QUICKSTART_ICO).is_ok() { return Ok(beside); }
    let inside = data_dir.join(QUICKSTART_ICO_NAME);
    std::fs::write(&inside, QUICKSTART_ICO).map_err(|e| Error::IoAt { path: inside.clone(), source: e })?;
    Ok(inside)
}

/// A game's quickstart icon in `<data>/icons`, made from the game's own icon (games::icon). None when that isn't
/// known (the game's folder isn't set). The file is named after the drawing and the game icon's time, so after either
/// changes, Explorer draws the new one instead of what it cached.
fn game_icon(db: &Db, data_dir: &Path, game: &str) -> Result<Option<PathBuf>> {
    let Some(png) = games::icon(db, data_dir, game)? else { return Ok(None) };
    let at = std::fs::metadata(&png).and_then(|m| m.modified()).ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
    let dir = data_dir.join("icons");
    let prefix = format!("quickstart-{game}-");
    let out = dir.join(format!("{prefix}{DRAWING}-{at}.ico"));
    if out.is_file() { return Ok(Some(out)); }
    let ico = drawn(&std::fs::read(&png)?)?;
    std::fs::create_dir_all(&dir)?;
    if let Ok(list) = std::fs::read_dir(&dir) {
        for e in list.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with(&prefix) && name.ends_with(".ico") { let _ = std::fs::remove_file(e.path()); }
        }
    }
    std::fs::write(&out, ico).map_err(|e| Error::IoAt { path: out.clone(), source: e })?;
    Ok(Some(out))
}

/// An .ico of the game icon `png` drawn as a quickstart icon (icon.rs) at the sizes Windows draws desktop icons. The
/// badge is bottom right, since Windows puts its shortcut arrow bottom left.
fn drawn(png: &[u8]) -> Result<Vec<u8>> {
    use image::codecs::ico::{IcoEncoder, IcoFrame};
    let bad = |e: image::ImageError| Error::Invalid(format!("Couldn't draw the shortcut's icon ({e})"));
    let game = image::load_from_memory_with_format(png, image::ImageFormat::Png).map_err(bad)?.to_rgba8();
    let mut frames = Vec::new();
    for size in icon::SIZES {
        let img = icon::draw(&game, size);
        frames.push(IcoFrame::as_png(img.as_raw(), size, size, image::ExtendedColorType::Rgba8).map_err(bad)?);
    }
    let mut out = Vec::new();
    IcoEncoder::new(&mut out).encode_images(&frames).map_err(bad)?;
    Ok(out)
}

/// The signed-in user's desktop, wherever it is (OneDrive moves it).
#[cfg(windows)]
fn desktop() -> Option<PathBuf> {
    use windows_sys::Win32::System::Com::CoTaskMemFree;
    use windows_sys::Win32::UI::Shell::{SHGetKnownFolderPath, FOLDERID_Desktop};
    let mut p: windows_sys::core::PWSTR = std::ptr::null_mut();
    // SAFETY: Windows hands back a zero-terminated string it allocated, which is read and then freed here.
    unsafe {
        let r = SHGetKnownFolderPath(&FOLDERID_Desktop, 0, std::ptr::null_mut(), &mut p);
        if r < 0 || p.is_null() { if !p.is_null() { CoTaskMemFree(p.cast()); } return None; }
        let mut n = 0;
        while *p.add(n) != 0 { n += 1; }
        let s = String::from_utf16_lossy(std::slice::from_raw_parts(p, n));
        CoTaskMemFree(p.cast());
        (!s.is_empty()).then(|| PathBuf::from(s))
    }
}

#[cfg(not(windows))]
fn desktop() -> Option<PathBuf> { None }

/// Tell Explorer a shortcut changed, so the desktop draws its new icon now.
#[cfg(windows)]
fn shell_updated(lnk: &Path) {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::Shell::{SHChangeNotify, SHCNE_UPDATEITEM, SHCNF_PATHW};
    let wide: Vec<u16> = lnk.as_os_str().encode_wide().chain(Some(0)).collect();
    // SAFETY: `wide` is a NUL-terminated path that outlives the call; the second item is unused.
    unsafe { SHChangeNotify(SHCNE_UPDATEITEM as i32, SHCNF_PATHW, wide.as_ptr().cast(), std::ptr::null()) };
}

#[cfg(not(windows))]
fn shell_updated(_lnk: &Path) {}

#[cfg(windows)]
fn write_link(lnk: &Path, exe: &Path, args: &str, dir: &Path, icon: &Path, about: &str) -> std::result::Result<(), String> {
    use windows::core::{Interface, HSTRING};
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};
    let h = |p: &Path| HSTRING::from(p.to_string_lossy().as_ref());
    let (lnk, exe, dir, icon) = (h(lnk), h(exe), h(dir), h(icon));
    let (args, about) = (HSTRING::from(args), HSTRING::from(about));
    // a thread of its own, so its COM apartment never meets the thread pool's
    let job = std::thread::spawn(move || {
        // SAFETY: COM calls on this thread only; every interface is dropped inside `run`, before CoUninitialize.
        unsafe {
            let init = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            let run = || -> windows::core::Result<()> {
                let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
                link.SetPath(&exe)?;
                link.SetArguments(&args)?;
                link.SetWorkingDirectory(&dir)?;
                link.SetIconLocation(&icon, 0)?;
                link.SetDescription(&about)?;
                link.cast::<IPersistFile>()?.Save(&lnk, true)
            };
            let r = run();
            if init.is_ok() { CoUninitialize(); }
            r.map_err(|e| e.message().to_string())
        }
    });
    job.join().unwrap_or_else(|_| Err("it stopped partway".into()))
}

#[cfg(not(windows))]
fn write_link(_lnk: &Path, _exe: &Path, _args: &str, _dir: &Path, _icon: &Path, _about: &str) -> std::result::Result<(), String> {
    Err("shortcuts are made on Windows only".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn game_file_names_are_allowed_by_windows() {
        let gf2 = games::def("gf2").unwrap();
        assert_eq!(game_file_name(gf2), "Girls' Frontline 2 Exilium quickstart.lnk");
        assert_eq!(game_file_name(games::def("zzz").unwrap()), "Zenless Zone Zero quickstart.lnk");
    }

    #[test]
    fn the_ico_holds_the_drawn_icon() {
        let mut png = Vec::new();
        image::RgbaImage::from_pixel(256, 256, image::Rgba([10, 200, 30, 255]))
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png).unwrap();
        let ico = drawn(&png).unwrap();
        let big = image::load_from_memory_with_format(&ico, image::ImageFormat::Ico).unwrap().to_rgba8();
        assert_eq!(big.dimensions(), (256, 256));
        assert_eq!(big.get_pixel(40, 128).0, [10, 200, 30, 255]);
        assert_eq!(big.get_pixel(2, 2)[3], 0);
    }
}
