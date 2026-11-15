//! Windows: where gachamod is installed, its registry values, processes, opening things and the Recycle Bin.
use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use winreg::enums::{HKEY_CURRENT_USER, KEY_READ};
use winreg::RegKey;

/// The uninstall entry the NSIS installer writes (Windows Settings, Installed apps).
pub const UNINSTALL_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\gachamod";
/// Choices the installer and the app share: `admin`, `adminAsked`, `desktopShortcut` (src-tauri/windows/hooks.nsh).
pub const PREFS_KEY: &str = r"Software\gachamod";
/// Where NSIS keeps the install folder.
pub const DIR_KEY: &str = r"Software\imanimal\gachamod";
pub const APP_EXE: &str = "gachamod.exe";
/// The app's identifier: its data lives in %APPDATA%\<this> and its web view's in %LOCALAPPDATA%\<this>.
pub const IDENTIFIER: &str = "app.gachamod.desktop";
const NO_WINDOW: u32 = 0x0800_0000;

#[derive(Clone, Debug)]
pub struct Installed {
    pub dir: PathBuf,
    pub version: Option<String>,
}

fn hkcu() -> RegKey { RegKey::predef(HKEY_CURRENT_USER) }

/// The installed copy from the registry. Its files may be gone (that's what repair is for).
pub fn installed() -> Option<Installed> {
    let un = hkcu().open_subkey_with_flags(UNINSTALL_KEY, KEY_READ).ok();
    let from_entry = un.as_ref().and_then(|k| k.get_value::<String, _>("InstallLocation").ok()).map(|s| s.trim_matches('"').to_string());
    let dir = from_entry.filter(|s| !s.is_empty())
        .or_else(|| hkcu().open_subkey_with_flags(DIR_KEY, KEY_READ).ok()?.get_value::<String, _>("").ok().filter(|s| !s.is_empty()))?;
    let version = un.and_then(|k| k.get_value::<String, _>("DisplayVersion").ok()).filter(|v| !v.is_empty());
    Some(Installed { dir: PathBuf::from(dir), version })
}

pub fn local_appdata() -> PathBuf { std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir) }
pub fn roaming_appdata() -> PathBuf { std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir) }
/// Where NSIS installs for one Windows account.
pub fn default_dir() -> PathBuf { local_appdata().join("gachamod") }
/// gachamod's own data (database, downloads, trash, backups, logs) and its web view's (saved looks, cache).
pub fn data_dirs() -> [PathBuf; 2] { [roaming_appdata().join(IDENTIFIER), local_appdata().join(IDENTIFIER)] }

pub fn pref(name: &str) -> Option<String> { hkcu().open_subkey_with_flags(PREFS_KEY, KEY_READ).ok()?.get_value(name).ok() }
pub fn set_pref(name: &str, value: &str) -> std::io::Result<()> {
    let (k, _) = hkcu().create_subkey(PREFS_KEY)?;
    k.set_value(name, &value.to_string())
}

/// Windows' "Run this program as an administrator" for gachamod.exe, off: only when it's the flag the installer set.
pub fn clear_admin_flag(exe: &Path) {
    const LAYERS: &str = r"Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers";
    let Ok(k) = hkcu().open_subkey_with_flags(LAYERS, winreg::enums::KEY_READ | winreg::enums::KEY_SET_VALUE) else { return };
    let name = exe.to_string_lossy().into_owned();
    if k.get_value::<String, _>(&name).is_ok_and(|v| v.trim() == "~ RUNASADMIN") { let _ = k.delete_value(&name); }
}

/// Remove what gachamod keeps in the registry besides its uninstall entry (the "delete gachamod's data" choice).
pub fn forget_prefs() {
    let _ = hkcu().delete_subkey_all(PREFS_KEY);
    let _ = hkcu().delete_subkey_all(DIR_KEY);
    let _ = hkcu().delete_subkey(r"Software\imanimal"); // only when empty
}

/// Undo what NSIS writes, for an install whose uninstaller is missing: the uninstall entry, the shortcuts, and the
/// link and file handlers when they open this copy.
pub fn forget_install(dir: &Path) {
    let _ = hkcu().delete_subkey_all(UNINSTALL_KEY);
    let exe = dir.join(APP_EXE);
    let opens_here = |key: &str| hkcu().open_subkey_with_flags(format!(r"Software\Classes\{key}\shell\open\command"), KEY_READ).ok()
        .and_then(|k| k.get_value::<String, _>("").ok())
        .is_some_and(|v| v.to_ascii_lowercase().contains(&exe.to_string_lossy().to_ascii_lowercase()));
    for key in ["gachamod", "gachamod.pack"] { if opens_here(key) { let _ = hkcu().delete_subkey_all(format!(r"Software\Classes\{key}")); } }
    for lnk in [roaming_appdata().join(r"Microsoft\Windows\Start Menu\Programs\gachamod.lnk"), desktop().join("gachamod.lnk")] {
        let _ = std::fs::remove_file(lnk);
    }
}

fn desktop() -> PathBuf { std::env::var_os("USERPROFILE").map(|p| PathBuf::from(p).join("Desktop")).unwrap_or_default() }

/// True when the gachamod.exe in `dir` is running. Another copy (a portable one, a build) doesn't count; a gachamod.exe
/// whose path Windows won't say does.
pub fn running_in(dir: &Path) -> bool {
    let want = dir.join(APP_EXE).display().to_string();
    let name = APP_EXE;
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE { return false; }
        let mut e: PROCESSENTRY32W = std::mem::zeroed();
        e.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut found = false;
        if Process32FirstW(snap, &mut e) != 0 {
            loop {
                let len = e.szExeFile.iter().position(|&c| c == 0).unwrap_or(e.szExeFile.len());
                if String::from_utf16_lossy(&e.szExeFile[..len]).eq_ignore_ascii_case(name)
                    && image_path(e.th32ProcessID).map_or(true, |p| p.eq_ignore_ascii_case(&want)) { found = true; break; }
                if Process32NextW(snap, &mut e) == 0 { break; }
            }
        }
        CloseHandle(snap);
        found
    }
}

fn image_path(pid: u32) -> Option<String> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION};
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if h.is_null() { return None; }
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(h, 0, buf.as_mut_ptr(), &mut len);
        CloseHandle(h);
        (ok != 0).then(|| String::from_utf16_lossy(&buf[..len as usize]))
    }
}

/// Start gachamod the way Explorer would: as the signed-in user even if setup was started as administrator, and
/// through Windows' administrator prompt when gachamod is set to run as administrator.
pub fn launch(exe: &Path) -> Result<(), String> {
    if !exe.exists() { return Err(format!("{} isn't there", exe.display())); }
    Command::new("explorer.exe").arg(exe).spawn().map(|_| ()).map_err(|e| format!("Couldn't start gachamod: {e}"))
}

/// Open a web page in the default browser.
pub fn open_url(url: &str) -> bool {
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    let op = wide(OsStr::new("open"));
    let file = wide(OsStr::new(url));
    let r = unsafe { ShellExecuteW(std::ptr::null_mut(), op.as_ptr(), file.as_ptr(), std::ptr::null(), std::ptr::null(), SW_SHOWNORMAL) };
    r as isize > 32
}

/// Move files and folders to the Recycle Bin. Windows asks first when one is too big for the bin.
pub fn recycle(paths: &[PathBuf]) -> Result<(), String> {
    use windows_sys::Win32::UI::Shell::{SHFileOperationW, FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_NOERRORUI, FOF_SILENT, FOF_WANTNUKEWARNING, FO_DELETE, SHFILEOPSTRUCTW};
    let mut from: Vec<u16> = Vec::new();
    for p in paths.iter().filter(|p| p.exists()) { from.extend(p.as_os_str().encode_wide()); from.push(0); }
    if from.is_empty() { return Ok(()); }
    from.push(0);
    let mut op: SHFILEOPSTRUCTW = unsafe { std::mem::zeroed() };
    op.wFunc = FO_DELETE;
    op.pFrom = from.as_ptr();
    op.fFlags = (FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI | FOF_WANTNUKEWARNING) as _;
    let r = unsafe { SHFileOperationW(&mut op) };
    if r != 0 { Err(format!("Windows couldn't move it to the Recycle Bin (error {r}). Something may have a file in it open.")) }
    else if op.fAnyOperationsAborted != 0 { Err("Moving it to the Recycle Bin was stopped.".into()) }
    else { Ok(()) }
}

/// The whole command line, as Windows passed it.
pub fn command_line() -> String {
    use windows_sys::Win32::System::Environment::GetCommandLineW;
    unsafe {
        let p = GetCommandLineW();
        if p.is_null() { return String::new(); }
        let mut n = 0;
        while *p.add(n) != 0 { n += 1; }
        String::from_utf16_lossy(std::slice::from_raw_parts(p, n))
    }
}

/// Clean up after this process ends (a running exe and the web view's files can't be deleted from inside):
/// `trees` go with everything in them, `files` alone, and `dirs` only when they're empty by then.
pub fn clean_after_exit(trees: &[PathBuf], files: &[PathBuf], dirs: &[PathBuf]) {
    if trees.is_empty() && files.is_empty() && dirs.is_empty() { return; }
    let q = |p: &PathBuf| format!("\"{}\"", p.display());
    let mut line = String::from("/d /c ping -n 6 127.0.0.1 >nul");
    for f in files { line += &format!(" & del /f /q {}", q(f)); }
    for t in trees { line += &format!(" & rmdir /s /q {}", q(t)); }
    for d in dirs { line += &format!(" & rmdir {}", q(d)); }
    let _ = Command::new("cmd.exe").raw_arg(line).current_dir(std::env::temp_dir()).creation_flags(NO_WINDOW).spawn();
}

/// Total size of the files under `dir` (links aren't followed).
pub fn dir_size(dir: &Path) -> u64 {
    let Ok(rd) = std::fs::read_dir(dir) else { return 0 };
    rd.flatten().map(|e| match e.metadata() {
        Ok(m) if m.is_dir() => dir_size(&e.path()),
        Ok(m) => m.len(),
        Err(_) => 0,
    }).sum()
}

fn wide(s: &OsStr) -> Vec<u16> { s.encode_wide().chain(Some(0)).collect() }

/// Compare "1.2.3" style versions (a pre-release tag sorts before its release).
pub fn version_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let parse = |v: &str| {
        let v = v.trim().trim_start_matches('v');
        let (core, pre) = v.split_once('-').map_or((v, None), |(c, p)| (c, Some(p.to_string())));
        let nums: Vec<u64> = core.split('.').map(|n| n.parse().unwrap_or(0)).collect();
        (nums, pre)
    };
    let (an, ap) = parse(a);
    let (bn, bp) = parse(b);
    for i in 0..an.len().max(bn.len()) {
        let o = an.get(i).copied().unwrap_or(0).cmp(&bn.get(i).copied().unwrap_or(0));
        if o.is_ne() { return o; }
    }
    match (ap, bp) {
        (None, None) => std::cmp::Ordering::Equal,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (Some(_), None) => std::cmp::Ordering::Less,
        (Some(x), Some(y)) => x.cmp(&y),
    }
}
