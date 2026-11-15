//! Deleting through the Recycle Bin, for files the user might want back (an uninstalled mod loader's files, a
//! config they edited). Owner: SYSTEM.
use crate::error::{Error, Result};
use std::path::{Path, PathBuf};

/// Send `paths` (files or folders) to the Recycle Bin, without asking or showing progress. Paths that don't exist
/// are skipped.
pub fn to_recycle_bin(paths: &[PathBuf]) -> Result<()> {
    let paths: Vec<&PathBuf> = paths.iter().filter(|p| p.exists()).collect();
    if paths.is_empty() { return Ok(()); }
    imp(&paths)
}

#[cfg(windows)]
fn imp(paths: &[&PathBuf]) -> Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::Shell::{SHFileOperationW, FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_NOERRORUI, FOF_SILENT, FO_DELETE, SHFILEOPSTRUCTW};
    // one string of null-separated paths with two nulls at the end
    let mut from: Vec<u16> = Vec::new();
    for p in paths {
        let abs = std::path::absolute(p).unwrap_or_else(|_| p.to_path_buf());
        from.extend(abs.as_os_str().encode_wide());
        from.push(0);
    }
    from.push(0);
    let mut op = SHFILEOPSTRUCTW {
        hwnd: std::ptr::null_mut(),
        wFunc: FO_DELETE,
        pFrom: from.as_ptr(),
        pTo: std::ptr::null(),
        fFlags: (FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_NOERRORUI | FOF_SILENT) as u16,
        fAnyOperationsAborted: 0,
        hNameMappings: std::ptr::null_mut(),
        lpszProgressTitle: std::ptr::null(),
    };
    let r = unsafe { SHFileOperationW(&mut op) };
    if r != 0 || op.fAnyOperationsAborted != 0 {
        let still: Vec<String> = paths.iter().filter(|p| p.exists()).map(|p| name(p)).collect();
        return Err(Error::Invalid(if still.is_empty() {
            format!("Windows couldn't move the files to the Recycle Bin (error {r})")
        } else {
            format!("Windows couldn't move {} to the Recycle Bin. A program may have it open", still.join(", "))
        }));
    }
    Ok(())
}

#[cfg(not(windows))]
fn imp(paths: &[&PathBuf]) -> Result<()> {
    for p in paths {
        if p.is_dir() { std::fs::remove_dir_all(p)?; } else { std::fs::remove_file(p)?; }
    }
    Ok(())
}

fn name(p: &Path) -> String { p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| p.display().to_string()) }
