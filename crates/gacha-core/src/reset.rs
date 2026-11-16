//! Starting over (Settings > About and updates > Reset gachamod). gachamod can't move its database while it has it open, so the
//! button leaves a note and restarts, and the next start does the work before anything opens. Nothing the user made
//! is deleted: the database, the trash and anything unknown move to `backups/before-reset-<time>/`. Only what
//! gachamod can get again goes: downloads, unpacked files, caches, downloaded fixers and the GameBanana sign-in.
//! Mods folders, games and XXMI Launcher are outside the data folder and aren't touched. Owner: SYSTEM.
use crate::error::Result;
use std::path::{Path, PathBuf};

const NOTE: &str = "reset-pending";
/// Stays where it is: the log (to report a problem) and the backups.
const STAY: [&str; 3] = ["logs", "backups", NOTE];
/// Deleted: downloads, unpacked files, caches and sign-ins, which gachamod makes or gets again.
const GO: [&str; 10] = ["downloads", "staging", "cache", "icons", "xxmi-setup", "fixers", "gb-login", "gb-session.bin", "look.json", "devhook-out.txt"];

/// Ask for a reset at the next start.
pub fn request(data_dir: &Path) -> Result<()> {
    std::fs::create_dir_all(data_dir)?;
    std::fs::write(data_dir.join(NOTE), crate::db::now().to_string())?;
    Ok(())
}

/// At start, before the database opens: when a reset was asked for, do it. Returns the folder the old data went to.
pub fn finish(data_dir: &Path) -> Result<Option<PathBuf>> {
    if !data_dir.join(NOTE).is_file() { return Ok(None); }
    let stamp = chrono::Local::now().format("%Y-%m-%d %H%M%S").to_string();
    let keep = data_dir.join("backups").join(format!("before-reset-{stamp}"));
    std::fs::create_dir_all(&keep)?;
    for e in std::fs::read_dir(data_dir)?.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let p = e.path();
        if STAY.iter().any(|s| s.eq_ignore_ascii_case(&name)) { continue; }
        if GO.iter().any(|s| s.eq_ignore_ascii_case(&name)) {
            let _ = if p.is_dir() { std::fs::remove_dir_all(&p) } else { std::fs::remove_file(&p) };
            continue;
        }
        // the database, the trash, saved originals and anything newer than this list
        std::fs::rename(&p, keep.join(&name))?;
    }
    std::fs::remove_file(data_dir.join(NOTE))?;
    Ok(Some(keep))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_reset_keeps_what_the_user_made_and_drops_the_rest() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path();
        std::fs::write(p.join("gachamod.sqlite"), "db").unwrap();
        std::fs::create_dir_all(p.join("trash").join("Ellen")).unwrap();
        std::fs::create_dir_all(p.join("downloads").join("zzz")).unwrap();
        std::fs::create_dir_all(p.join("logs")).unwrap();
        std::fs::create_dir_all(p.join("backups").join("123-0")).unwrap();
        // nothing happens without the note
        assert_eq!(finish(p).unwrap(), None);
        assert!(p.join("gachamod.sqlite").is_file());
        request(p).unwrap();
        let keep = finish(p).unwrap().unwrap();
        assert_eq!(std::fs::read_to_string(keep.join("gachamod.sqlite")).unwrap(), "db");
        assert!(keep.join("trash").join("Ellen").is_dir());
        assert!(!p.join("gachamod.sqlite").exists() && !p.join("trash").exists() && !p.join("downloads").exists());
        assert!(p.join("logs").is_dir() && p.join("backups").join("123-0").is_dir());
        assert!(!p.join(NOTE).exists());
    }
}
