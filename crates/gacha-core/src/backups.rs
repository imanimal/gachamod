//! Copies of a mod's files taken right before the app changes them (a key rebind, a hash fix, an edit the AI helper
//! made), so every change can be undone and nothing the user made is lost. Each backup is a folder
//! `<data>/backups/<id>/` holding the files at their paths inside the mod folder, plus `manifest.json`.
//!
//! Restoring puts the copies back and first backs up what is there now, so the restore itself can be undone (redo).
//! Files the change created are listed in `created` and removed on restore. Owner: skeleton (used by the KEYBINDS,
//! FIXES and AI areas).

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
    let same = |rel: &String| -> bool {
        let (Ok(a), Ok(c)) = (inside(&dir, rel), inside(&mod_dir, rel)) else { return false };
        match (std::fs::metadata(&a), std::fs::metadata(&c)) {
            (Ok(x), Ok(y)) if x.len() == y.len() => std::fs::read(&a).ok() == std::fs::read(&c).ok(),
            _ => false,
        }
    };
    let changed: Vec<String> = b.files.iter().filter(|r| !same(r)).cloned().collect();
    keep_only(db, b, &changed, &[]).ok().flatten()
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
    fn refuses_paths_outside_the_mod() {
        let base = temp("esc");
        assert!(take_in(&base.join("b"), "zzz", "1", &base, &["../x.ini".into()], "x").is_err());
        assert!(read_manifest(&base, "../x").is_err());
        let _ = std::fs::remove_dir_all(base);
    }
}
