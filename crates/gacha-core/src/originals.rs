//! The author's copy of each mod file gachamod changes, kept from before its first change, so a mod can go back to
//! exactly what it was whatever happened in between: several edits, Undo and Redo, or a change that taking out by its
//! markers didn't fully reverse. `<data>/originals/<game>/<mod id>/` holds the copies at their paths inside the mod
//! folder (under `files/`), plus `manifest.json` with a fingerprint of each version gachamod wrote since.
//!
//! A copy only counts while the file is one of those versions, or the copy itself. When the mod was updated or edited
//! by hand since, the copy is out of date: nothing uses it, and the next write keeps a new one. Copies are never
//! pruned (they are small inis). Writers call `keep` before every write. keys.rs puts the copy back when a file it
//! writes has none of gachamod's markers left, so a writer that changes a file without leaving a marker must not
//! share a file with it. Another program's copy (IMM's, taken over by `adopt`) is used only by "Put back original
//! files" (`author`), since that program's changes carry no markers. Owner: skeleton (used by KEYBINDS).

use crate::db::Db;
use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// How many written versions of one file are remembered (Undo and Redo go back to earlier ones).
const KEEP_WRITTEN: usize = 64;

#[derive(Debug, Default, Serialize, Deserialize)]
struct Manifest { files: BTreeMap<String, Entry> }

#[derive(Debug, Default, Serialize, Deserialize)]
struct Entry {
    written: Vec<String>,
    /// The copy is another program's (`adopt`): only `author` uses it.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    other: bool,
}

/// One file gachamod is about to write.
pub struct Write<'a> {
    /// Path inside the mod folder, forward slashes.
    pub rel: &'a str,
    /// The file now.
    pub before: &'a [u8],
    /// The file now with gachamod's own marked changes taken out: what is kept when there is no usable copy yet.
    pub clean: &'a [u8],
    /// What gachamod writes.
    pub after: &'a [u8],
}

/// FNV-1a over the bytes, and the length. The same in every build, which std's hasher doesn't promise.
fn print(bytes: &[u8]) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes { h ^= u64::from(*b); h = h.wrapping_mul(0x0100_0000_01b3); }
    format!("{h:016x}-{}", bytes.len())
}

fn safe_id(s: &str) -> bool { !s.is_empty() && s.len() <= 64 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') }

fn root(db: &Db) -> PathBuf { crate::pack::data_dir_of(db).join("originals") }

fn mod_dir(root: &Path, game: &str, mod_id: &str) -> Result<PathBuf> {
    if !safe_id(game) || !safe_id(mod_id) { return Err(Error::Invalid("Bad mod id".into())); }
    Ok(root.join(game).join(mod_id))
}

fn read(dir: &Path) -> Manifest {
    std::fs::read(dir.join("manifest.json")).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

/// The copy of `rel` when `current` is the copy or a version gachamod wrote since, and whether it is another
/// program's.
fn usable(m: &Manifest, dir: &Path, rel: &str, current: &[u8]) -> Option<(Vec<u8>, bool)> {
    let e = m.files.get(rel)?;
    let copy = std::fs::read(crate::backups::inside(&dir.join("files"), rel).ok()?).ok()?;
    (copy == current || e.written.contains(&print(current))).then_some((copy, e.other))
}

/// Before writing: keep the author's copy of each file that has no usable one, and note what will be written.
pub fn keep(db: &Db, game: &str, mod_id: &str, writes: &[Write]) -> Result<()> { keep_in(&root(db), game, mod_id, writes) }

fn keep_in(root: &Path, game: &str, mod_id: &str, writes: &[Write]) -> Result<()> {
    if writes.is_empty() { return Ok(()); }
    let dir = mod_dir(root, game, mod_id)?;
    std::fs::create_dir_all(&dir)?;
    let mut m = read(&dir);
    for w in writes {
        let rel = w.rel.replace('\\', "/");
        if usable(&m, &dir, &rel, w.before).is_none() {
            let copy = crate::backups::inside(&dir.join("files"), &rel)?;
            if let Some(p) = copy.parent() { std::fs::create_dir_all(p)?; }
            std::fs::write(&copy, w.clean)?;
            m.files.insert(rel.clone(), Entry::default());
        }
        let e = m.files.entry(rel).or_default();
        let p = print(w.after);
        e.written.retain(|x| *x != p);
        e.written.push(p);
        if e.written.len() > KEEP_WRITTEN { e.written.drain(..e.written.len() - KEEP_WRITTEN); }
    }
    std::fs::write(dir.join("manifest.json"), serde_json::to_vec_pretty(&m)?)?;
    Ok(())
}

/// The author's copy of `rel`, when the file is still as gachamod left it (`current` is what is there now).
pub fn original(db: &Db, game: &str, mod_id: &str, rel: &str, current: &[u8]) -> Option<Vec<u8>> {
    original_in(&root(db), game, mod_id, rel, current)
}

fn original_in(root: &Path, game: &str, mod_id: &str, rel: &str, current: &[u8]) -> Option<Vec<u8>> {
    copy_in(root, game, mod_id, rel, current).filter(|(_, other)| !other).map(|(c, _)| c)
}

fn copy_in(root: &Path, game: &str, mod_id: &str, rel: &str, current: &[u8]) -> Option<(Vec<u8>, bool)> {
    let dir = mod_dir(root, game, mod_id).ok()?;
    usable(&read(&dir), &dir, &rel.replace('\\', "/"), current)
}

/// Like `original`, but also a copy another program kept (`adopt`). For "Put back original files", which undoes that
/// program's edits too.
pub fn author(db: &Db, game: &str, mod_id: &str, rel: &str, current: &[u8]) -> Option<Vec<u8>> {
    copy_in(&root(db), game, mod_id, rel, current).map(|(c, _)| c)
}

/// Take another program's copy of a file it changed without markers (IMM keeps the author's inis in
/// DISABLED_IMM_INI_BACKUP before it edits keys), when the file has no usable copy yet. Only `author` uses such a
/// copy: an edit of gachamod's that leaves no marker keeps the other program's changes. True when it was taken.
pub fn adopt(db: &Db, game: &str, mod_id: &str, rel: &str, copy: &[u8], current: &[u8]) -> Result<bool> {
    adopt_in(&root(db), game, mod_id, rel, copy, current)
}

fn adopt_in(root: &Path, game: &str, mod_id: &str, rel: &str, copy: &[u8], current: &[u8]) -> Result<bool> {
    let dir = mod_dir(root, game, mod_id)?;
    let rel = rel.replace('\\', "/");
    let mut m = read(&dir);
    if usable(&m, &dir, &rel, current).is_some() { return Ok(false); }
    let path = crate::backups::inside(&dir.join("files"), &rel)?;
    if let Some(p) = path.parent() { std::fs::create_dir_all(p)?; }
    std::fs::write(&path, copy)?;
    m.files.insert(rel, Entry { written: vec![print(current)], other: true });
    std::fs::write(dir.join("manifest.json"), serde_json::to_vec_pretty(&m)?)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("gm-originals-{name}-{}", crate::library::new_id()));
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    fn w<'a>(before: &'a [u8], after: &'a [u8]) -> Write<'a> { Write { rel: "sub\\a.ini", before, clean: before, after } }

    #[test]
    fn kept_once_and_follows_every_write() {
        let root = temp("follow");
        assert!(original_in(&root, "gi", "m1", "sub/a.ini", b"author").is_none(), "nothing kept yet");
        keep_in(&root, "gi", "m1", &[w(b"author", b"edit 1")]).unwrap();
        keep_in(&root, "gi", "m1", &[w(b"edit 1", b"edit 2")]).unwrap();
        // the copy is still the author's, from any version gachamod wrote (Undo goes back to edit 1)
        for now in [&b"edit 2"[..], b"edit 1", b"author"] {
            assert_eq!(original_in(&root, "gi", "m1", "sub/a.ini", now).as_deref(), Some(&b"author"[..]));
        }
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn out_of_date_after_an_update_or_a_hand_edit() {
        let root = temp("stale");
        keep_in(&root, "gi", "m1", &[w(b"v1", b"v1 edited")]).unwrap();
        // the mod was updated: its new file isn't something gachamod wrote, so the old copy isn't used
        assert!(original_in(&root, "gi", "m1", "sub/a.ini", b"v2").is_none());
        // the next write keeps the new version as the original
        keep_in(&root, "gi", "m1", &[Write { rel: "sub/a.ini", before: b"v2", clean: b"v2", after: b"v2 edited" }]).unwrap();
        assert_eq!(original_in(&root, "gi", "m1", "sub/a.ini", b"v2 edited").as_deref(), Some(&b"v2"[..]));
        assert!(original_in(&root, "gi", "m1", "sub/a.ini", b"v1 edited").is_none(), "the old versions are forgotten");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn another_programs_copy_is_only_for_put_back() {
        let root = temp("adopt");
        assert!(adopt_in(&root, "gi", "m1", "a.ini", b"author", b"imm edit").unwrap());
        assert!(original_in(&root, "gi", "m1", "a.ini", b"imm edit").is_none());
        assert_eq!(copy_in(&root, "gi", "m1", "a.ini", b"imm edit").map(|(c, _)| c).as_deref(), Some(&b"author"[..]));
        // a gachamod edit on top keeps the copy, still only for put back
        keep_in(&root, "gi", "m1", &[Write { rel: "a.ini", before: b"imm edit", clean: b"imm edit", after: b"imm edit; gachamod" }]).unwrap();
        assert!(original_in(&root, "gi", "m1", "a.ini", b"imm edit; gachamod").is_none());
        assert_eq!(copy_in(&root, "gi", "m1", "a.ini", b"imm edit; gachamod").map(|(c, _)| c).as_deref(), Some(&b"author"[..]));
        // a file that already has a copy keeps it
        assert!(!adopt_in(&root, "gi", "m1", "a.ini", b"other", b"imm edit").unwrap());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn refuses_odd_ids_and_paths() {
        let root = temp("odd");
        assert!(keep_in(&root, "gi", "../x", &[w(b"a", b"b")]).is_err());
        assert!(keep_in(&root, "gi", "m1", &[Write { rel: "../a.ini", before: b"a", clean: b"a", after: b"b" }]).is_err());
        let _ = std::fs::remove_dir_all(root);
    }
}
