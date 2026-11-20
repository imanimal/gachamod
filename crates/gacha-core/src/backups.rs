//! Copies of a mod's files taken right before the app changes them (a key rebind, a hash fix, an edit the AI helper
//! made), so every change can be undone and nothing the user made is lost. Each backup is a folder
//! `<data>/backups/<id>/` holding the files at their paths inside the mod folder, plus `manifest.json`.
//!
//! Restoring puts the copies back and first backs up what is there now, so the restore itself can be undone (redo).
//! Files the change created are listed in `created` and removed on restore. Owner: skeleton (used by the KEYBINDS,
//! FIXES and AI areas).
//!
//! The same folder also holds the daily copy of the database (db.rs), settings from before an import
//! (settings_file.rs) and the old data a reset moved aside (reset.rs). `entries` lists all of it for Settings ›
//! Storage, and `recycle` moves what the user picks to the Recycle Bin.

use crate::db::{now, Db};
use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Backup {
    pub id: String,
    pub game: String,
    pub mod_id: String,
    /// The mod folder when the backup was taken. Restore uses the mod's current folder when the library knows it
    /// (it may have been renamed or disabled since).
    pub mod_dir: String,
    /// Paths inside the mod folder, forward slashes, that were copied.
    pub files: Vec<String>,
    /// Paths that did not exist yet: the change creates them, so a restore removes them.
    pub created: Vec<String>,
    /// What the change was ("Rebound F6 to F7").
    pub label: String,
    pub at: i64,
    /// Taken before a change whose files weren't known in advance (a fixer run), and not trimmed to what changed
    /// yet. One left like this by a run that never finished (the app was closed) is trimmed when backups are listed.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub open: bool,
}

/// Open backups a change in this run of the app is still working on.
fn active() -> std::sync::MutexGuard<'static, std::collections::HashSet<String>> {
    static ACTIVE: std::sync::OnceLock<std::sync::Mutex<std::collections::HashSet<String>>> = std::sync::OnceLock::new();
    ACTIVE.get_or_init(Default::default).lock().unwrap_or_else(|e| e.into_inner())
}

fn root(db: &Db) -> PathBuf { crate::pack::data_dir_of(db).join("backups") }

/// A path inside the mod folder, refusing anything that climbs out of it.
pub(crate) fn inside(base: &Path, rel: &str) -> Result<PathBuf> {
    let p = Path::new(rel);
    if p.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err(Error::Invalid(format!("Not a path inside the mod: {rel}")));
    }
    Ok(base.join(p))
}

fn new_id() -> String {
    static N: AtomicU32 = AtomicU32::new(0);
    let ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    format!("{ms}-{}", N.fetch_add(1, Ordering::Relaxed))
}

/// Copy `files` (paths inside `mod_dir`) before changing them. Files that don't exist yet are noted as created.
pub fn take(db: &Db, game: &str, mod_id: &str, mod_dir: &Path, files: &[String], label: &str) -> Result<Backup> {
    take_in(&root(db), game, mod_id, mod_dir, files, label)
}

fn take_in(root: &Path, game: &str, mod_id: &str, mod_dir: &Path, files: &[String], label: &str) -> Result<Backup> {
    let id = new_id();
    let dir = root.join(&id);
    std::fs::create_dir_all(&dir)?;
    let mut b = Backup {
        id, game: game.into(), mod_id: mod_id.into(), mod_dir: mod_dir.to_string_lossy().into_owned(),
        files: vec![], created: vec![], label: label.into(), at: now(), open: false,
    };
    for rel in files {
        let rel = rel.replace('\\', "/");
        let src = inside(mod_dir, &rel)?;
        if src.is_file() {
            let dst = inside(&dir, &rel)?;
            if let Some(p) = dst.parent() { std::fs::create_dir_all(p)?; }
            std::fs::copy(&src, &dst)?;
            b.files.push(rel);
        } else if !b.created.contains(&rel) {
            b.created.push(rel);
        }
    }
    std::fs::write(dir.join("manifest.json"), serde_json::to_vec_pretty(&b)?)?;
    Ok(b)
}

/// Copy every one of `files` before a change that may touch any of them (a fixer). `keep_only` trims it afterwards
/// to the files that did change.
pub fn take_open(db: &Db, game: &str, mod_id: &str, mod_dir: &Path, files: &[String], label: &str) -> Result<Backup> {
    let mut b = take(db, game, mod_id, mod_dir, files, label)?;
    b.open = true;
    active().insert(b.id.clone());
    std::fs::write(root(db).join(&b.id).join("manifest.json"), serde_json::to_vec_pretty(&b)?)?;
    Ok(b)
}

/// Trim an open backup whose change never reported back: keep the copies that differ from the mod's files now.
fn settle_open(db: &Db, b: Backup) -> Option<Backup> {
    let dir = root(db).join(&b.id);
    let mod_dir = crate::library::mod_path(db, &b.game, &b.mod_id).ok().filter(|p| p.is_dir()).unwrap_or_else(|| PathBuf::from(&b.mod_dir));
    if !mod_dir.is_dir() { return Some(b); }
    let changed = differing(&dir, &mod_dir, &b.files);
    keep_only(db, b, &changed, &[]).ok().flatten()
}

/// The folder holding backup `id`'s copies.
pub fn folder(db: &Db, id: &str) -> PathBuf { root(db).join(id) }

/// Of `files` (paths inside the mod), the ones whose copy in `copies` (a backup's folder) differs from the file in
/// `mod_dir` now, or that are gone from it. A fixer that saves every file again changes their times but not their
/// bytes, and those copies aren't worth keeping.
pub fn differing(copies: &Path, mod_dir: &Path, files: &[String]) -> Vec<String> {
    files.iter().filter(|rel| {
        let (Ok(a), Ok(b)) = (inside(copies, rel), inside(mod_dir, rel)) else { return true };
        !same_bytes(&a, &b)
    }).cloned().collect()
}

/// Two files with the same bytes, read a piece at a time so big textures aren't read whole.
fn same_bytes(a: &Path, b: &Path) -> bool {
    use std::io::Read;
    let (Ok(x), Ok(y)) = (std::fs::metadata(a), std::fs::metadata(b)) else { return false };
    if !x.is_file() || !y.is_file() || x.len() != y.len() { return false; }
    let (Ok(mut f), Ok(mut g)) = (std::fs::File::open(a), std::fs::File::open(b)) else { return false };
    let (mut p, mut q) = (vec![0u8; 1 << 16], vec![0u8; 1 << 16]);
    loop {
        let n = match f.read(&mut p) { Ok(n) => n, Err(_) => return false };
        if n == 0 { return true; }
        if g.read_exact(&mut q[..n]).is_err() || p[..n] != q[..n] { return false; }
    }
}

fn read_manifest(root: &Path, id: &str) -> Result<Backup> {
    if id.contains(['/', '\\', '.']) { return Err(Error::Invalid("Bad backup id".into())); }
    let text = std::fs::read(root.join(id).join("manifest.json")).map_err(|_| Error::Invalid("That backup is gone".into()))?;
    Ok(serde_json::from_slice(&text)?)
}

/// Put a backup's files back. Returns the backup of what was there before, so the restore can be undone.
pub fn restore(db: &Db, id: &str) -> Result<Backup> {
    let b = read_manifest(&root(db), id)?;
    let current = crate::library::mod_path(db, &b.game, &b.mod_id).ok().filter(|p| p.is_dir());
    let before = restore_in(&root(db), id, current)?;
    // put-back parts can make a conflict again (or a removed one go away)
    crate::library::recount_conflicts(db, &b.game);
    Ok(before)
}

fn restore_in(root: &Path, id: &str, current_dir: Option<PathBuf>) -> Result<Backup> {
    let b = read_manifest(root, id)?;
    let mod_dir = current_dir.unwrap_or_else(|| PathBuf::from(&b.mod_dir));
    if !mod_dir.is_dir() { return Err(Error::Invalid("The mod's folder is gone".into())); }
    let touched: Vec<String> = b.files.iter().chain(&b.created).cloned().collect();
    let before = take_in(root, &b.game, &b.mod_id, &mod_dir, &touched, &format!("Before undoing: {}", b.label))?;
    for rel in &b.files {
        let dst = inside(&mod_dir, rel)?;
        if let Some(p) = dst.parent() { std::fs::create_dir_all(p)?; }
        std::fs::copy(inside(&root.join(id), rel)?, &dst)?;
    }
    for rel in &b.created {
        let p = inside(&mod_dir, rel)?;
        if p.is_file() { std::fs::remove_file(p)?; }
    }
    Ok(before)
}

/// Trim a backup taken before a change whose files weren't known in advance: keep the copies of `changed`, note
/// `created` (removed on restore) and drop the rest. None, with the backup gone, when nothing changed.
pub fn keep_only(db: &Db, mut b: Backup, changed: &[String], created: &[String]) -> Result<Option<Backup>> {
    let dir = root(db).join(&b.id);
    for rel in b.files.iter().filter(|r| !changed.contains(r)) {
        let _ = std::fs::remove_file(inside(&dir, rel)?);
    }
    b.files.retain(|r| changed.contains(r));
    b.open = false;
    active().remove(&b.id);
    for c in created { if !b.created.contains(c) { b.created.push(c.clone()); } }
    if b.files.is_empty() && b.created.is_empty() {
        let _ = std::fs::remove_dir_all(&dir);
        return Ok(None);
    }
    std::fs::write(dir.join("manifest.json"), serde_json::to_vec_pretty(&b)?)?;
    Ok(Some(b))
}

/// Backups, newest first, optionally for one game or one mod.
pub fn list(db: &Db, game: Option<&str>, mod_id: Option<&str>) -> Result<Vec<Backup>> {
    let root = root(db);
    let mut out = vec![];
    let Ok(rd) = std::fs::read_dir(&root) else { return Ok(out) };
    for e in rd.flatten() {
        let Some(id) = e.file_name().to_str().map(String::from) else { continue };
        let Ok(b) = read_manifest(&root, &id) else { continue };
        if game.is_some_and(|g| g != b.game) || mod_id.is_some_and(|m| m != b.mod_id) { continue; }
        // left open by a run that never finished: trim it now (one a run is still working on is left out)
        if b.open {
            if active().contains(&b.id) { continue; }
            if let Some(b) = settle_open(db, b) { out.push(b); }
            continue;
        }
        out.push(b);
    }
    out.sort_by(|a, b| b.at.cmp(&a.at).then_with(|| b.id.cmp(&a.id)));
    Ok(out)
}

/// Remove backups older than `days`. Returns how many went.
pub fn prune(db: &Db, days: i64) -> Result<usize> {
    let cut = now() - days * 86_400;
    let mut n = 0;
    for b in list(db, None, None)? {
        if b.at < cut && std::fs::remove_dir_all(root(db).join(&b.id)).is_ok() { n += 1; }
    }
    Ok(n)
}

/// Something in the backups folder, for the list in Settings › Storage. Mirrors `BackupEntry` in
/// src/lib/api/common.ts.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    /// Its file or folder name in the backups folder.
    pub id: String,
    /// "mod" (a mod's files from before a change), "database" (the daily copy of the database), "settings" (settings
    /// from before an import), "reset" (the old data a reset moved aside) or "other".
    pub kind: String,
    /// For "mod": the game, the mod and what the change was ("Rebound F6 to F7").
    pub game: Option<String>,
    pub mod_id: Option<String>,
    pub label: Option<String>,
    /// When it was taken, in seconds.
    pub at: i64,
    pub bytes: u64,
    /// Files copied ("mod"), or files inside it.
    pub files: u32,
    pub path: String,
}

/// Everything in the backups folder, newest first. Backups an unfinished run left open are trimmed first, and one a
/// change is still working on is left out.
pub fn entries(db: &Db) -> Vec<Entry> {
    let _ = list(db, None, None);
    entries_in(&root(db))
}

fn secs(t: std::io::Result<std::time::SystemTime>) -> Option<i64> {
    t.ok()?.duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_secs() as i64)
}

/// Bytes and files under a path (a file counts as one).
fn size_of(p: &Path) -> (u64, u32) {
    let mut out = (0u64, 0u32);
    for e in walkdir::WalkDir::new(p).into_iter().flatten().filter(|e| e.file_type().is_file()) {
        out.0 += e.metadata().map(|m| m.len()).unwrap_or(0);
        out.1 += 1;
    }
    out
}

fn entries_in(root: &Path) -> Vec<Entry> {
    let mut out = vec![];
    for e in std::fs::read_dir(root).into_iter().flatten().flatten() {
        let id = e.file_name().to_string_lossy().into_owned();
        if active().contains(&id) { continue; }
        let path = e.path();
        let (bytes, files) = size_of(&path);
        // when it was made: copies keep the time of the file they copy, so creation comes first
        let at = e.metadata().ok().and_then(|m| secs(m.created()).or_else(|| secs(m.modified()))).unwrap_or(0);
        let mut it = Entry { id: id.clone(), kind: "other".into(), at, bytes, files, path: path.to_string_lossy().into_owned(), ..Default::default() };
        let low = id.to_lowercase();
        if path.is_dir() {
            if let Ok(b) = read_manifest(root, &id) {
                it.kind = "mod".into();
                it.files = b.files.len() as u32;
                (it.game, it.mod_id, it.label, it.at) = (Some(b.game), Some(b.mod_id), Some(b.label), b.at);
            } else if low.starts_with("before-reset-") {
                it.kind = "reset".into();
            }
        } else if low.starts_with("gachamod-") && low.ends_with(".sqlite") {
            it.kind = "database".into();
        } else if low.starts_with("settings-") && low.ends_with(".json") {
            it.kind = "settings".into();
        }
        out.push(it);
    }
    out.sort_by(|a, b| b.at.cmp(&a.at).then_with(|| b.id.cmp(&a.id)));
    out
}

/// Move backups (ids from `entries`) to the Recycle Bin. Returns the bytes moved. One a change is still working on
/// stays.
pub fn recycle(db: &Db, ids: &[String]) -> Result<u64> {
    recycle_in(&root(db), ids)
}

fn recycle_in(root: &Path, ids: &[String]) -> Result<u64> {
    let mut paths = vec![];
    let mut bytes = 0;
    for id in ids {
        let mut parts = Path::new(id).components();
        if !matches!((parts.next(), parts.next()), (Some(Component::Normal(_)), None)) {
            return Err(Error::Invalid("Bad backup id".into()));
        }
        if active().contains(id) { continue; }
        let p = root.join(id);
        if !p.exists() { continue; }
        bytes += size_of(&p).0;
        paths.push(p);
    }
    // tests delete for good, so they don't fill the Recycle Bin
    if cfg!(test) {
        for p in &paths { if p.is_dir() { std::fs::remove_dir_all(p)?; } else { std::fs::remove_file(p)?; } }
    } else {
        crate::recycle::to_recycle_bin(&paths)?;
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("gm-backups-{name}-{}", new_id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn take_and_restore_round_trip() {
        let base = temp("rt");
        let (root, m) = (base.join("backups"), base.join("mod"));
        std::fs::create_dir_all(m.join("sub")).unwrap();
        std::fs::write(m.join("a.ini"), "old a").unwrap();
        std::fs::write(m.join("sub/b.ini"), "old b").unwrap();
        let b = take_in(&root, "zzz", "7", &m, &["a.ini".into(), "sub\\b.ini".into(), "new.ini".into()], "Fix").unwrap();
        assert_eq!(b.files, vec!["a.ini", "sub/b.ini"]);
        assert_eq!(b.created, vec!["new.ini"]);
        std::fs::write(m.join("a.ini"), "new a").unwrap();
        std::fs::write(m.join("sub/b.ini"), "new b").unwrap();
        std::fs::write(m.join("new.ini"), "made").unwrap();
        let before = restore_in(&root, &b.id, None).unwrap();
        assert_eq!(std::fs::read_to_string(m.join("a.ini")).unwrap(), "old a");
        assert_eq!(std::fs::read_to_string(m.join("sub/b.ini")).unwrap(), "old b");
        assert!(!m.join("new.ini").exists());
        // redo: restoring the "before" backup brings the change back
        restore_in(&root, &before.id, None).unwrap();
        assert_eq!(std::fs::read_to_string(m.join("a.ini")).unwrap(), "new a");
        assert_eq!(std::fs::read_to_string(m.join("new.ini")).unwrap(), "made");
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn a_file_saved_again_with_the_same_bytes_is_not_a_change() {
        let base = temp("same");
        let (root, m) = (base.join("backups"), base.join("mod"));
        std::fs::create_dir_all(&m).unwrap();
        std::fs::write(m.join("a.ini"), "old a").unwrap();
        std::fs::write(m.join("big.dds"), vec![7u8; 200_000]).unwrap();
        std::fs::write(m.join("gone.ini"), "x").unwrap();
        let b = take_in(&root, "zzz", "7", &m, &["a.ini".into(), "big.dds".into(), "gone.ini".into()], "Fix").unwrap();
        // a fixer that rewrites everything: only a.ini really changes, and gone.ini is removed
        std::fs::write(m.join("a.ini"), "new a").unwrap();
        std::fs::write(m.join("big.dds"), vec![7u8; 200_000]).unwrap();
        std::fs::remove_file(m.join("gone.ini")).unwrap();
        assert_eq!(differing(&root.join(&b.id), &m, &b.files), vec!["a.ini", "gone.ini"]);
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn entries_say_what_each_backup_is_and_recycle_moves_them() {
        let base = temp("entries");
        let (root, m) = (base.join("backups"), base.join("mod"));
        std::fs::create_dir_all(&m).unwrap();
        std::fs::write(m.join("a.ini"), "old a").unwrap();
        let b = take_in(&root, "zzz", "7", &m, &["a.ini".into()], "Rebound F6 to F7").unwrap();
        std::fs::write(root.join("gachamod-2026-11-17.sqlite"), "db").unwrap();
        std::fs::write(root.join("settings-2026-11-17-101010.000.json"), "{}").unwrap();
        std::fs::create_dir_all(root.join("before-reset-2026-11-18 165959")).unwrap();
        std::fs::write(root.join("before-reset-2026-11-18 165959").join("gachamod.sqlite"), "old").unwrap();
        let list = entries_in(&root);
        let kind = |id: &str| list.iter().find(|e| e.id == id).map(|e| e.kind.as_str());
        assert_eq!(kind(&b.id), Some("mod"));
        assert_eq!(kind("gachamod-2026-11-17.sqlite"), Some("database"));
        assert_eq!(kind("settings-2026-11-17-101010.000.json"), Some("settings"));
        assert_eq!(kind("before-reset-2026-11-18 165959"), Some("reset"));
        let one = list.iter().find(|e| e.id == b.id).unwrap();
        assert_eq!((one.game.as_deref(), one.label.as_deref(), one.files), (Some("zzz"), Some("Rebound F6 to F7"), 1));
        assert!(one.bytes >= 5);
        // a name that climbs out of the folder is refused, and nothing moves
        assert!(recycle_in(&root, &["..".into()]).is_err());
        assert!(recycle_in(&root, &["../mod".into()]).is_err());
        let reset = list.iter().find(|e| e.kind == "reset").unwrap().bytes;
        let moved = recycle_in(&root, &[b.id.clone(), "before-reset-2026-11-18 165959".into(), "missing".into()]).unwrap();
        assert_eq!(moved, one.bytes + reset);
        assert!(!root.join(&b.id).exists() && !root.join("before-reset-2026-11-18 165959").exists());
        assert!(m.join("a.ini").is_file(), "the mod's own files stay");
        assert_eq!(entries_in(&root).len(), 2);
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn refuses_paths_outside_the_mod() {
        let base = temp("esc");
        assert!(take_in(&base.join("b"), "zzz", "1", &base, &["../x.ini".into()], "x").is_err());
        assert!(read_manifest(&base, "../x").is_err());
        let _ = std::fs::remove_dir_all(base);
    }
}
