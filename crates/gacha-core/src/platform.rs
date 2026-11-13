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

/// Who holds a command: None when it points at `exe` or at nothing, else the holder's file name. A command that
/// points at a gachamod exe that no longer exists counts as free.
pub fn holder(cmd: Option<&str>, exe: &Path) -> (bool, Option<String>) {
    let Some(target) = cmd.and_then(command_exe) else { return (false, None) };
    let ours = Path::new(&target).to_string_lossy().eq_ignore_ascii_case(&exe.to_string_lossy());
    if ours { return (true, None); }
    let name = Path::new(&target).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or(target.clone());
    let stale_gachamod = name.to_lowercase().contains("gachamod") && !Path::new(&target).exists();
    (false, if stale_gachamod { None } else { Some(name) })
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
                if !choice.eq_ignore_ascii_case(&prog) { f_ours = false; f_owner = Some(choice); }
            }
        }
        vec![
            Integration { id: SCHEME_ID.into(), label: "gachamod links (1-click installs from GameBanana)".into(), supported: true, ours: s_ours, owner: s_owner },
            Integration { id: FILE_ID.into(), label: ".gachamod files open in gachamod".into(), supported: true, ours: f_ours, owner: f_owner },
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

/// Point one integration (by id) at this exe.
pub fn register(exe: &Path, id: &str) -> Result<Vec<Integration>> {
    #[cfg(windows)]
    {
        reg::register(&reg::hkcu(), CLASSES, exe, id)?;
        reg::notify_shell();
        integrations(exe)
    }
    #[cfg(not(windows))]
    { let _ = (exe, id); Err(Error::Invalid("Links and file types are Windows only".into())) }
}

/// Register everything that nobody else holds. Called on start (release builds); never takes one from another program.
pub fn register_free(exe: &Path) -> Result<()> {
    #[cfg(windows)]
    {
        let root = reg::hkcu();
        let mut any = false;
        for i in reg::status(&root, CLASSES, exe) {
            if !i.ours && i.owner.is_none() { reg::register(&root, CLASSES, exe, &i.id)?; any = true; }
        }
        if any { reg::notify_shell(); }
    }
    #[cfg(not(windows))]
    let _ = exe;
    Ok(())
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
        // a gachamod that was moved or removed doesn't block a new one
        assert_eq!(holder(Some(r#""Z:\gone\gachamod.exe" "%1""#), me), (false, None));
        assert_eq!(holder(None, me), (false, None));
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
        let _ = root.delete_subkey_all(&base);
        assert!(root.open_subkey(&base).is_err());
    }
}
