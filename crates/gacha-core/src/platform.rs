//! Windows hooks, all per user under HKCU\Software\Classes (no admin): the `gachamod:` link handler and opening
//! `.gachamod` files with the app. Owner: SYSTEM area (docs/spec.md, "Links and files").
//!
//! GameBanana's 1-click buttons call a manager's own scheme, so `gachamod:` is the one to hold.

use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Integration {
    /// "scheme:gachamod", "file:.gachamod"
    pub id: String,
    pub label: String,
    pub supported: bool,
    /// Points at this app.
    pub ours: bool,
    /// Another program's name when it holds it.
    pub owner: Option<String>,
}

pub const SCHEME_ID: &str = "scheme:gachamod";
pub const FILE_ID: &str = "file:.gachamod";
const PROG_ID: &str = "gachamod.pack";
const CLASSES: &str = r"Software\Classes";

/// The exe path in a shell open command like `"C:\Apps\gachamod.exe" "%1"`.
pub fn command_exe(cmd: &str) -> Option<String> {
    let c = cmd.trim();
    if let Some(rest) = c.strip_prefix('"') { return rest.split('"').next().map(String::from).filter(|s| !s.is_empty()); }
    let lower = c.to_lowercase();
    lower.find(".exe").map(|i| c[..i + 4].to_string())
}

/// The setting that remembers a user turned one off ("0"), so a start never turns it back on.
pub fn setting_key(id: &str) -> String { format!("integration.{id}") }

/// The ids the user turned off in Settings.
pub fn turned_off(db: &crate::db::Db) -> Vec<&'static str> {
    [SCHEME_ID, FILE_ID].into_iter().filter(|id| db.setting(&setting_key(id)).ok().flatten().as_deref() == Some("0")).collect()
}

/// An exe path or name that is a copy of gachamod (installed, portable, moved or a dev build).
fn is_gachamod(target: &str) -> bool {
    Path::new(target).file_name().is_some_and(|n| n.to_string_lossy().to_lowercase().contains("gachamod"))
}

/// Who holds a command: None when it points at `exe` or at nothing, else the holder's file name. Another copy of
/// gachamod counts as free, so the copy opened last handles links and files.
pub fn holder(cmd: Option<&str>, exe: &Path) -> (bool, Option<String>) {
    let Some(target) = cmd.and_then(command_exe) else { return (false, None) };
    let ours = Path::new(&target).to_string_lossy().eq_ignore_ascii_case(&exe.to_string_lossy());
    if ours { return (true, None); }
    if is_gachamod(&target) { return (false, None); }
    let name = Path::new(&target).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or(target.clone());
    (false, Some(name))
}

#[cfg(windows)]
mod reg {
    use super::*;
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};

    fn read(root: &RegKey, path: &str) -> Option<String> {
        root.open_subkey(path).ok()?.get_value::<String, _>("").ok().filter(|s| !s.is_empty())
    }

    pub fn status(root: &RegKey, base: &str, exe: &Path) -> Vec<Integration> {
        let scheme_cmd = read(root, &format!(r"{base}\gachamod\shell\open\command"));
        let (s_ours, s_owner) = holder(scheme_cmd.as_deref(), exe);
        let prog = read(root, &format!(r"{base}\.gachamod")).unwrap_or_else(|| PROG_ID.into());
        let file_cmd = read(root, &format!(r"{base}\{prog}\shell\open\command"));
        let (mut f_ours, mut f_owner) = holder(file_cmd.as_deref(), exe);
        // Explorer's own choice wins over the class when the user picked another app with "Open with"
        if let Ok(k) = RegKey::predef(HKEY_CURRENT_USER).open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.gachamod\UserChoice") {
            if let Ok(choice) = k.get_value::<String, _>("ProgId") {
                let gachamod = choice.to_lowercase().contains("gachamod");
                if !choice.eq_ignore_ascii_case(&prog) && !gachamod { f_ours = false; f_owner = Some(choice); }
            }
        }
        vec![
            Integration { id: SCHEME_ID.into(), label: "1-click installs from GameBanana".into(), supported: true, ours: s_ours, owner: s_owner },
            Integration { id: FILE_ID.into(), label: "Open .gachamod files".into(), supported: true, ours: f_ours, owner: f_owner },
        ]
    }

    fn set(root: &RegKey, path: &str, name: &str, value: &str) -> Result<()> {
        let (k, _) = root.create_subkey(path)?;
        k.set_value(name, &value.to_string())?;
        Ok(())
    }

    pub fn register(root: &RegKey, base: &str, exe: &Path, id: &str) -> Result<()> {
        let exe = exe.to_string_lossy();
        let open = format!("\"{exe}\" \"%1\"");
        let icon = format!("\"{exe}\",0");
        match id {
            SCHEME_ID => {
                set(root, &format!(r"{base}\gachamod"), "", "URL:gachamod")?;
                set(root, &format!(r"{base}\gachamod"), "URL Protocol", "")?;
                set(root, &format!(r"{base}\gachamod\DefaultIcon"), "", &icon)?;
                set(root, &format!(r"{base}\gachamod\shell\open\command"), "", &open)?;
            }
            FILE_ID => {
                set(root, &format!(r"{base}\.gachamod"), "", PROG_ID)?;
                set(root, &format!(r"{base}\{PROG_ID}"), "", "gachamod mod pack")?;
                set(root, &format!(r"{base}\{PROG_ID}\DefaultIcon"), "", &icon)?;
                set(root, &format!(r"{base}\{PROG_ID}\shell\open\command"), "", &open)?;
            }
            other => return Err(Error::Invalid(format!("Unknown integration \"{other}\""))),
        }
        Ok(())
    }

    fn points_at_gachamod(root: &RegKey, class: &str) -> bool {
        read(root, &format!(r"{class}\shell\open\command")).as_deref().and_then(command_exe).is_some_and(|e| is_gachamod(&e))
    }

    fn delete_tree(root: &RegKey, path: &str) -> Result<()> {
        match root.delete_subkey_all(path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
            _ => Ok(()),
        }
    }

    /// Remove gachamod's entry. One that another program holds is left alone.
    pub fn unregister(root: &RegKey, base: &str, id: &str) -> Result<()> {
        match id {
            SCHEME_ID => {
                let class = format!(r"{base}\gachamod");
                if points_at_gachamod(root, &class) { delete_tree(root, &class)?; }
            }
            FILE_ID => {
                let ext = format!(r"{base}\.gachamod");
                // the class may be ours or the installer's ("gachamod pack")
                if let Some(prog) = read(root, &ext) {
                    let class = format!(r"{base}\{prog}");
                    if points_at_gachamod(root, &class) {
                        delete_tree(root, &class)?;
                        root.open_subkey_with_flags(&ext, winreg::enums::KEY_SET_VALUE)?.delete_value("")?;
                    }
                }
            }
            other => return Err(Error::Invalid(format!("Unknown integration \"{other}\""))),
        }
        Ok(())
    }

    pub fn hkcu() -> RegKey { RegKey::predef(HKEY_CURRENT_USER) }

    pub fn notify_shell() {
        use windows_sys::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST};
        // SAFETY: the documented call to refresh file associations; no pointers are passed.
        unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED as i32, SHCNF_IDLIST, std::ptr::null(), std::ptr::null()) };
    }
}

pub fn integrations(exe: &Path) -> Result<Vec<Integration>> {
    #[cfg(windows)]
    { Ok(reg::status(&reg::hkcu(), CLASSES, exe)) }
    #[cfg(not(windows))]
    { let _ = exe; Ok(vec![]) }
}

/// Turn one integration (by id) on or off. On points it at this exe, taking it from another program; off removes
/// gachamod's entry. The caller saves the choice under `setting_key(id)`.
pub fn set(exe: &Path, id: &str, on: bool) -> Result<Vec<Integration>> {
    #[cfg(windows)]
    {
        let root = reg::hkcu();
        if on { reg::register(&root, CLASSES, exe, id)? } else { reg::unregister(&root, CLASSES, id)? }
        reg::notify_shell();
        integrations(exe)
    }
    #[cfg(not(windows))]
    { let _ = (exe, id, on); Err(Error::Invalid("Links and file types are Windows only".into())) }
}

/// Register everything that is free or held by another copy of gachamod, except what the user turned off.
/// Called on every start; never takes one from another program.
pub fn register_free(exe: &Path, off: &[&str]) -> Result<()> {
    #[cfg(windows)]
    {
        let root = reg::hkcu();
        let mut any = false;
        for i in reg::status(&root, CLASSES, exe) {
            if !i.ours && i.owner.is_none() && !off.contains(&i.id.as_str()) { reg::register(&root, CLASSES, exe, &i.id)?; any = true; }
        }
        if any { reg::notify_shell(); }
    }
    #[cfg(not(windows))]
    let _ = (exe, off);
    Ok(())
}

// ── exe icons ──

/// An exe's icon at `size` px as PNG bytes (Windows only; None elsewhere or when the exe has no icon).
pub fn exe_icon_png(exe: &Path, size: u32) -> Option<Vec<u8>> {
    #[cfg(windows)]
    {
        let (w, h, px) = icon::rgba(exe, size as i32)?;
        let mut out = Vec::new();
        {
            let mut enc = png::Encoder::new(&mut out, w, h);
            enc.set_color(png::ColorType::Rgba);
            enc.set_depth(png::BitDepth::Eight);
            let mut wr = enc.write_header().ok()?;
            wr.write_image_data(&px).ok()?;
            wr.finish().ok()?;
        }
        Some(out)
    }
    #[cfg(not(windows))]
    {
        let _ = (exe, size);
        None
    }
}

#[cfg(windows)]
mod icon {
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;
    use windows_sys::Win32::Graphics::Gdi::{
        DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP, HDC,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, PrivateExtractIconsW, HICON, ICONINFO};

    /// The first icon of an exe at `size` px: (width, height, RGBA pixels, top row first).
    pub fn rgba(exe: &Path, size: i32) -> Option<(u32, u32, Vec<u8>)> {
        let wide: Vec<u16> = exe.as_os_str().encode_wide().chain(Some(0)).collect();
        let mut h: HICON = std::ptr::null_mut();
        let mut id = 0u32;
        // SAFETY: `wide` is a NUL-terminated path; one icon handle is written to `h`
        let n = unsafe { PrivateExtractIconsW(wide.as_ptr(), 0, size, size, &mut h, &mut id, 1, 0) };
        if n == 0 || n == u32::MAX || h.is_null() { return None; }
        // SAFETY: `h` is a valid icon handle until DestroyIcon
        let out = unsafe { pixels(h) };
        unsafe { DestroyIcon(h) };
        out
    }

    /// A bitmap's pixels as a 32-bit top-down BI_RGB DIB (BGRA).
    unsafe fn bits(dc: HDC, bmp: HBITMAP) -> Option<(i32, i32, Vec<u8>)> {
        let mut bm: BITMAP = std::mem::zeroed();
        if GetObjectW(bmp, std::mem::size_of::<BITMAP>() as i32, &mut bm as *mut BITMAP as *mut _) == 0 { return None; }
        let (w, h) = (bm.bmWidth, bm.bmHeight);
        if w <= 0 || h <= 0 || w > 1024 || h > 2048 { return None; }
        let mut info: BITMAPINFO = std::mem::zeroed();
        info.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        info.bmiHeader.biWidth = w;
        info.bmiHeader.biHeight = -h;
        info.bmiHeader.biPlanes = 1;
        info.bmiHeader.biBitCount = 32;
        info.bmiHeader.biCompression = BI_RGB;
        let mut buf = vec![0u8; (w as usize) * (h as usize) * 4];
        let lines = GetDIBits(dc, bmp, 0, h as u32, buf.as_mut_ptr() as *mut _, &mut info, DIB_RGB_COLORS);
        (lines > 0).then_some((w, h, buf))
    }

    unsafe fn pixels(icon: HICON) -> Option<(u32, u32, Vec<u8>)> {
        let mut ii: ICONINFO = std::mem::zeroed();
        if GetIconInfo(icon, &mut ii) == 0 { return None; }
        let dc = GetDC(std::ptr::null_mut());
        let color = if ii.hbmColor.is_null() { None } else { bits(dc, ii.hbmColor) };
        let mask = if ii.hbmMask.is_null() { None } else { bits(dc, ii.hbmMask) };
        ReleaseDC(std::ptr::null_mut(), dc);
        if !ii.hbmColor.is_null() { DeleteObject(ii.hbmColor); }
        if !ii.hbmMask.is_null() { DeleteObject(ii.hbmMask); }
        let (w, h, mut px) = color?;
        if !px.chunks_exact(4).any(|p| p[3] != 0) {
            // an old-style icon without alpha: the mask's white pixels are the see-through ones
            match mask {
                Some((mw, mh, m)) if mw == w && mh >= h => {
                    for (i, p) in px.chunks_exact_mut(4).enumerate() { p[3] = if m[i * 4] == 0 { 255 } else { 0 }; }
                }
                _ => { for p in px.chunks_exact_mut(4) { p[3] = 255; } }
            }
        }
        for p in px.chunks_exact_mut(4) { p.swap(0, 2); }
        Some((w as u32, h as u32, px))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_commands_and_holders() {
        assert_eq!(command_exe(r#""C:\Apps\gachamod\gachamod.exe" "%1""#).as_deref(), Some(r"C:\Apps\gachamod\gachamod.exe"));
        assert_eq!(command_exe(r"C:\Tools\Other.exe %1").as_deref(), Some(r"C:\Tools\Other.exe"));
        let me = Path::new(r"C:\Apps\gachamod\gachamod.exe");
        assert_eq!(holder(Some(r#""C:\APPS\gachamod\gachamod.exe" "%1""#), me), (true, None));
        assert_eq!(holder(Some(r#""C:\Tools\Other.exe" "%1""#), me), (false, Some("Other.exe".into())));
        // another copy of gachamod (moved, removed, a dev build) doesn't block this one
        assert_eq!(holder(Some(r#""Z:\gone\gachamod.exe" "%1""#), me), (false, None));
        assert_eq!(holder(Some(r#""D:\src\gachamod\target\debug\gachamod.exe" "%1""#), me), (false, None));
        assert_eq!(holder(None, me), (false, None));
    }

    #[cfg(windows)]
    #[test]
    fn takes_an_exe_icon() {
        let root = std::env::var_os("SystemRoot").map(std::path::PathBuf::from).unwrap_or_else(|| r"C:\Windows".into());
        let png = exe_icon_png(&root.join("explorer.exe"), 256).expect("explorer.exe has an icon");
        assert_eq!(&png[1..4], b"PNG");
        // width and height from the IHDR chunk
        assert_eq!(u32::from_be_bytes(png[16..20].try_into().unwrap()), 256);
        assert!(exe_icon_png(&root.join("no-such-file.exe"), 256).is_none());
    }

    #[cfg(windows)]
    #[test]
    fn registers_into_a_throwaway_key() {
        let base = format!(r"Software\gachamod-test-{}-{}", std::process::id(), crate::db::now());
        let root = reg::hkcu();
        let exe = Path::new(r"C:\Apps\gachamod\gachamod.exe");
        let before = reg::status(&root, &base, exe);
        assert!(before.iter().all(|i| !i.ours && i.owner.is_none()));
        reg::register(&root, &base, exe, SCHEME_ID).unwrap();
        reg::register(&root, &base, exe, FILE_ID).unwrap();
        let after = reg::status(&root, &base, exe);
        assert!(after.iter().find(|i| i.id == SCHEME_ID).unwrap().ours);
        let other = reg::status(&root, &base, Path::new(r"C:\Else\gachamod.exe"));
        assert!(!other.iter().find(|i| i.id == SCHEME_ID).unwrap().ours);
        assert!(reg::register(&root, &base, exe, "nope").is_err());
        // off removes both, and leaves another program's entry alone
        reg::unregister(&root, &base, SCHEME_ID).unwrap();
        reg::unregister(&root, &base, FILE_ID).unwrap();
        assert!(reg::status(&root, &base, exe).iter().all(|i| !i.ours && i.owner.is_none()));
        let other = Path::new(r"C:\Tools\Other.exe");
        reg::register(&root, &base, other, SCHEME_ID).unwrap();
        reg::unregister(&root, &base, SCHEME_ID).unwrap();
        assert_eq!(reg::status(&root, &base, exe)[0].owner.as_deref(), Some("Other.exe"));
        let _ = root.delete_subkey_all(&base);
        assert!(root.open_subkey(&base).is_err());
    }
}
