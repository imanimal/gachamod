//! The installer inside the downloaded setup. scripts/build-installer.mjs appends the NSIS installer that `tauri
//! build` makes to a copy of this exe, then a short JSON note, then a trailer:
//!   [NSIS installer][meta JSON][meta length: u64 LE][installer length: u64 LE]["GMSETUP1"]
//! The copy installed next to gachamod (setup.exe) has none.
use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

const MAGIC: &[u8; 8] = b"GMSETUP1";

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Meta {
    /// The gachamod version the installer installs.
    pub version: String,
    /// The size of gachamod.exe, for the progress bar.
    #[serde(default)]
    pub app_size: u64,
}

#[derive(Clone, Debug)]
pub struct Payload {
    exe: PathBuf,
    offset: u64,
    len: u64,
    pub meta: Meta,
}

/// The installer appended to this exe, if there is one.
pub fn find() -> Option<Payload> {
    let exe = std::env::current_exe().ok()?;
    let mut f = File::open(&exe).ok()?;
    let size = f.metadata().ok()?.len();
    if size < 24 { return None; }
    f.seek(SeekFrom::End(-24)).ok()?;
    let mut tail = [0u8; 24];
    f.read_exact(&mut tail).ok()?;
    if &tail[16..] != MAGIC { return None; }
    let meta_len = u64::from_le_bytes(tail[0..8].try_into().ok()?);
    let len = u64::from_le_bytes(tail[8..16].try_into().ok()?);
    let meta_at = size.checked_sub(24)?.checked_sub(meta_len)?;
    let offset = meta_at.checked_sub(len)?;
    if meta_len > 64 * 1024 { return None; }
    f.seek(SeekFrom::Start(meta_at)).ok()?;
    let mut m = vec![0; meta_len as usize];
    f.read_exact(&mut m).ok()?;
    let meta = serde_json::from_slice(&m).ok()?;
    Some(Payload { exe, offset, len, meta })
}

impl Payload {
    /// Write the NSIS installer to `to`.
    pub fn extract(&self, to: &Path) -> io::Result<()> {
        let mut f = File::open(&self.exe)?;
        f.seek(SeekFrom::Start(self.offset))?;
        let mut out = File::create(to)?;
        let n = io::copy(&mut f.take(self.len), &mut out)?;
        if n != self.len { return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "the installer inside setup is cut short")); }
        Ok(())
    }
}
