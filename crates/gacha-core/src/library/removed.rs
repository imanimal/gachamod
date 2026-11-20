//! Removed mods: the trash and the archive. Owner: BACKEND area (docs/spec.md, "Trash and archive").
//!
//! A removed mod's folder sits in `<data>/trash/<game>/<trash id>/` for "trash.days" days (setting, default 0; 0
//! deletes the files right away). After that the files go, but its details move to the `archive` table: name,
//! character, GameBanana link, tags, favourite, a small copy of its preview under `<data>/archive/<id>/`. Its kept
//! option values (`mod_vars`) and profile places (`profile_mods`, `profile_vars`) stay, keyed by its mod id. When the
//! same GameBanana mod is installed again it takes that id back (install.rs), so all of it applies again.
//!
//! A mod with no GameBanana link can't be downloaded again, so when its files leave the trash they go to the Recycle
//! Bin unless "trash.unsourced" is "delete" (values "ask", the default, "recycle" and "delete").

use super::*;
use crate::model::ModSource;

/// The `archive` table, applied with the library's SCHEMA.
pub(super) const ARCHIVE_SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS archive (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game TEXT NOT NULL,
    mod_id TEXT NOT NULL,
    gb_mod_id INTEGER,
    name TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT 'removed',
    removed_at INTEGER NOT NULL,
    archived_at INTEGER NOT NULL,
    preview TEXT,
    has_options INTEGER NOT NULL DEFAULT 0,
    data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS archive_by_game ON archive (game);
";

/// A removed mod, in the trash (files still there) or in the archive (details only). Mirrors `ArchiveEntry` in
/// src/lib/api/library.ts.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveEntry {
    /// "t<trash id>" or "a<archive id>".
    pub key: String,
    pub trash_id: Option<i64>,
    pub archive_id: Option<i64>,
    pub game: String,
    pub mod_id: String,
    pub name: String,
    pub character: Option<String>,
    pub source: Option<ModSource>,
    /// A local file or a URL.
    pub preview: Option<String>,
    pub nsfw: bool,
    pub tags: Vec<String>,
    pub favorite: bool,
    pub size_bytes: u64,
    pub removed_at: i64,
    /// When the files leave the trash; None in the archive.
    pub files_until: Option<i64>,
    /// The folder the files are in while they are in the trash; None in the archive.
    pub path: Option<String>,
    pub reason: String,
    pub has_options: bool,
}

/// Pictures up to this size are copied into the archive.
const ARCHIVE_PREVIEW_MAX: u64 = 3 * 1024 * 1024;
/// A copy an update replaced stays at least this long, even with "trash.days" at 0, so the update can finish.
const REPLACED_MIN_SECS: i64 = 600;

/// How many days removed mods keep their files ("trash.days", default 0 so the files go at once, 0 to 3650).
pub fn trash_days(db: &Db) -> i64 {
    db.setting("trash.days").ok().flatten().and_then(|v| v.trim().parse::<i64>().ok()).map(|d| d.clamp(0, 3650)).unwrap_or(0)
}

/// Files of removed mods with no GameBanana link go to the Recycle Bin when they leave the trash by themselves
/// ("trash.unsourced" is "recycle", or "ask" while nobody has chosen). Only "delete" deletes them for good.
pub fn unsourced_to_recycle_bin(db: &Db) -> bool {
    db.setting("trash.unsourced").ok().flatten().is_none_or(|v| v.trim() != "delete")
}

struct TrashRow { id: i64, game: String, mod_id: String, name: String, kept: PathBuf, reason: String, removed_at: i64, size: u64, entry: ModEntry }

const TRASH_COLS: &str = "id, game, mod_id, name, kept_path, reason, removed_at, size, data";

fn read_trash(r: &rusqlite::Row<'_>) -> rusqlite::Result<TrashRow> {
    let (id, game, mod_id, name): (i64, String, String, String) = (r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?);
    let data: Option<String> = r.get(8)?;
    let entry = data.and_then(|d| serde_json::from_str::<ModEntry>(&d).ok())
        .unwrap_or_else(|| ModEntry { id: mod_id.clone(), game: game.clone(), name: name.clone(), ..Default::default() });
    Ok(TrashRow {
        id, game, mod_id, name, kept: PathBuf::from(r.get::<_, String>(4)?), reason: r.get(5)?, removed_at: r.get(6)?,
        size: r.get::<_, i64>(7)?.max(0) as u64, entry,
    })
}

fn trash_rows(db: &Db, where_sql: &str, args: impl rusqlite::Params) -> Result<Vec<TrashRow>> {
    let mut st = db.conn.prepare(&format!("SELECT {TRASH_COLS} FROM trash WHERE {where_sql} ORDER BY removed_at DESC, id DESC"))?;
    let v = st.query_map(args, read_trash)?.collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(v)
}

fn exists(db: &Db, sql: &str, args: impl rusqlite::Params) -> Result<bool> {
    Ok(db.conn.query_row(sql, args, |_| Ok(())).optional()?.is_some())
}

/// A removed mod's files wait in the trash, so it can come back.
pub fn in_trash(db: &Db, mod_id: &str) -> bool { exists(db, "SELECT 1 FROM trash WHERE mod_id = ?1", [mod_id]).unwrap_or(false) }

fn alive(db: &Db, mod_id: &str) -> Result<bool> { exists(db, "SELECT 1 FROM mods WHERE id = ?1", [mod_id]) }

fn has_options(db: &Db, game: &str, mod_id: &str) -> bool {
    exists(db, "SELECT 1 FROM mod_vars WHERE game = ?1 AND mod_id = ?2 LIMIT 1", params![game, mod_id]).unwrap_or(false)
}

/// Forget a mod's kept values and profile places once nothing refers to its id anymore.
fn forget_if_unused(db: &Db, mod_id: &str) -> Result<()> {
    let used = alive(db, mod_id)?
        || exists(db, "SELECT 1 FROM trash WHERE mod_id = ?1", [mod_id])?
        || exists(db, "SELECT 1 FROM archive WHERE mod_id = ?1", [mod_id])?;
    if !used {
        db.conn.execute("DELETE FROM mod_vars WHERE mod_id = ?1", [mod_id])?;
        db.conn.execute("DELETE FROM profile_mods WHERE mod_id = ?1", [mod_id])?;
        db.conn.execute("DELETE FROM profile_vars WHERE mod_id = ?1", [mod_id])?;
        crate::originals::forget(db, mod_id);
    }
    Ok(())
}

/// Delete a trashed mod's files: the numbered folder that holds it, only ever inside a "trash" folder. With `recycle`
/// the mod's folder goes to the Recycle Bin under its own name first.
fn delete_files(kept: &Path, recycle: bool) -> Result<()> {
    let Some(holder) = kept.parent() else { return Ok(()) };
    let in_trash = holder.ancestors().any(|a| a.file_name().is_some_and(|n| n.eq_ignore_ascii_case("trash")));
    if !in_trash || !holder.exists() { return Ok(()); }
    if recycle && kept.exists() {
        if cfg!(test) { fs::remove_dir_all(kept)?; } else { crate::recycle::to_recycle_bin(&[kept.to_path_buf()])?; }
    }
    fs::remove_dir_all(holder)?;
    Ok(())
}

/// A trash row's files go to the Recycle Bin: asked for, and the mod has no GameBanana link to download it again.
fn recycles(row: &TrashRow, recycle: bool) -> bool { recycle && row.entry.source.is_none() }

/// The app's data folder from a trash path (`<data>/trash/<game>/<id>/<folder>`).
fn data_dir_of(kept: &Path) -> Option<PathBuf> {
    kept.ancestors().find(|a| a.file_name().is_some_and(|n| n.eq_ignore_ascii_case("trash"))).and_then(Path::parent).map(Path::to_path_buf)
}

/// Where a trashed mod's preview is now (its row still has the path it had under Mods), or its URL.
fn trashed_preview(e: &ModEntry, kept: &Path) -> Option<String> {
    let p = e.preview.as_deref()?;
    if p.starts_with("https://") || p.starts_with("http://") { return Some(p.to_string()); }
    let full = kept.join(Path::new(p).strip_prefix(&e.path).ok()?);
    full.is_file().then(|| full.to_string_lossy().into_owned())
}

/// Remove an archive row and its preview folder.
fn drop_archive(db: &Db, id: i64) -> Result<()> {
    let preview: Option<String> = db.conn.query_row("SELECT preview FROM archive WHERE id = ?1", [id], |r| r.get(0)).optional()?.flatten();
    db.conn.execute("DELETE FROM archive WHERE id = ?1", [id])?;
    if let Some(dir) = preview.as_deref().filter(|p| !p.contains("://")).and_then(|p| Path::new(p).parent()) {
        let ours = dir.file_name().is_some_and(|n| n.to_string_lossy() == id.to_string())
            && dir.parent().and_then(Path::file_name).is_some_and(|n| n.eq_ignore_ascii_case("archive"));
        if ours { let _ = fs::remove_dir_all(dir); }
    }
    Ok(())
}

/// Move a trash row's details into the archive (its files are about to go). Returns the archive id.
fn archive_row(db: &Db, row: &TrashRow) -> Result<i64> {
    // an older record of the same mod is replaced by this one
    let older: Vec<i64> = {
        let mut st = db.conn.prepare("SELECT id FROM archive WHERE game = ?1 AND mod_id = ?2")?;
        let v = st.query_map(params![row.game, row.mod_id], |r| r.get(0))?.collect::<std::result::Result<Vec<_>, _>>()?;
        v
    };
    for id in older { drop_archive(db, id)?; }
    let e = &row.entry;
    let gb = e.source.as_ref().map(|s| s.mod_id as i64);
    db.conn.execute(
        "INSERT INTO archive (game, mod_id, gb_mod_id, name, reason, removed_at, archived_at, preview, has_options, data)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8, ?9)",
        params![row.game, row.mod_id, gb, row.name, row.reason, row.removed_at, now(), has_options(db, &row.game, &row.mod_id) as i64, serde_json::to_string(e)?],
    )?;
    let aid = db.conn.last_insert_rowid();
    let preview = match trashed_preview(e, &row.kept) {
        Some(u) if u.contains("://") => Some(u),
        Some(file) => {
            let src = PathBuf::from(&file);
            let small = fs::metadata(&src).is_ok_and(|m| m.len() <= ARCHIVE_PREVIEW_MAX);
            let ext = preview_ext(&file).unwrap_or_else(|| "png".into());
            data_dir_of(&row.kept).filter(|_| small).and_then(|data| {
                let dir = data.join("archive").join(aid.to_string());
                let to = dir.join(format!("preview.{ext}"));
                (fs::create_dir_all(&dir).is_ok() && fs::copy(&src, &to).is_ok()).then(|| to.to_string_lossy().into_owned())
            })
        }
        None => None,
    };
    if preview.is_some() { db.conn.execute("UPDATE archive SET preview = ?1 WHERE id = ?2", params![preview, aid])?; }
    Ok(aid)
}

/// Delete one trash entry's files. Its details go to the archive unless the mod is still in the library (an update
/// replaced this copy, or it came back under a new id) or another trash entry holds the same mod.
fn purge_row(db: &Db, row: &TrashRow, strict: bool) -> Result<bool> {
    let replaced = row.reason == "replaced";
    let keep = !replaced && !alive(db, &row.mod_id)?
        && !exists(db, "SELECT 1 FROM trash WHERE mod_id = ?1 AND id <> ?2", params![row.mod_id, row.id])?;
    let aid = if keep { Some(archive_row(db, row)?) } else { None };
    if let Err(e) = delete_files(&row.kept, recycles(row, unsourced_to_recycle_bin(db))) {
        if let Some(a) = aid { drop_archive(db, a)?; }
        if strict { return Err(e); }
        return Ok(false);
    }
    db.conn.execute("DELETE FROM trash WHERE id = ?1", [row.id])?;
    // an update's old copy never forgets anything: the new copy has the same id
    if !keep && !replaced { forget_if_unused(db, &row.mod_id)?; }
    Ok(true)
}

/// Delete the files of trash entries older than "trash.days" (all of them at 0) and keep their details in the
/// archive. Files of mods with no GameBanana link go to the Recycle Bin unless "trash.unsourced" is "delete". Runs at startup, when the setting changes and whenever the trash or archive is listed.
pub fn purge_expired(db: &Db) -> Result<u64> {
    let t = now();
    let cutoff = t - trash_days(db) * 86400;
    let rows = trash_rows(db, "(reason <> 'replaced' AND removed_at <= ?1) OR (reason = 'replaced' AND removed_at <= ?2)",
        params![cutoff, cutoff.min(t - REPLACED_MIN_SECS)])?;
    let mut n = 0;
    for r in &rows { if purge_row(db, r, false)? { n += 1; } }
    Ok(n)
}

/// Delete trash files now: one entry (its details stay in the archive), or every expired one with `None`.
pub fn trash_purge(db: &Db, trash_id: Option<i64>) -> Result<u64> {
    let Some(id) = trash_id else { return purge_expired(db) };
    let rows = trash_rows(db, "id = ?1", [id])?;
    let Some(row) = rows.first() else { return Ok(0) };
    purge_row(db, row, true)?;
    Ok(1)
}

/// Removed mods of one game (or all games), newest first: trash entries with their files, then archived details.
pub fn archive_list(db: &Db, game: Option<&str>) -> Result<Vec<ArchiveEntry>> {
    let _ = purge_expired(db);
    let days = trash_days(db);
    let mut out: Vec<ArchiveEntry> = Vec::new();
    for r in trash_rows(db, "kept_path <> '' AND (?1 IS NULL OR game = ?1)", [game])? {
        let e = &r.entry;
        out.push(ArchiveEntry {
            key: format!("t{}", r.id), trash_id: Some(r.id), archive_id: None, game: r.game.clone(), mod_id: r.mod_id.clone(), name: r.name.clone(),
            character: e.character.clone(), source: e.source.clone(), preview: trashed_preview(e, &r.kept), nsfw: e.nsfw, tags: e.tags.clone(),
            favorite: e.favorite, size_bytes: r.size, removed_at: r.removed_at, files_until: Some(r.removed_at + days * 86400), reason: r.reason.clone(),
            has_options: has_options(db, &r.game, &r.mod_id),
            path: Some(r.kept.to_string_lossy().into_owned()),
        });
    }
    let rows: Vec<(i64, String, String, String, String, i64, Option<String>, String)> = {
        let mut st = db.conn.prepare(
            "SELECT id, game, mod_id, name, reason, removed_at, preview, data FROM archive WHERE (?1 IS NULL OR game = ?1) ORDER BY removed_at DESC, id DESC")?;
        let v = st.query_map([game], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?)))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        v
    };
    for (id, g, mod_id, name, reason, removed_at, preview, data) in rows {
        let e: ModEntry = serde_json::from_str(&data).unwrap_or_default();
        let preview = preview.filter(|p| p.contains("://") || Path::new(p).is_file());
        out.push(ArchiveEntry {
            key: format!("a{id}"), trash_id: None, archive_id: Some(id), has_options: has_options(db, &g, &mod_id), game: g, mod_id, name,
            character: e.character, source: e.source, preview, nsfw: e.nsfw, tags: e.tags, favorite: e.favorite, size_bytes: e.size_bytes,
            removed_at, files_until: None, reason, path: None,
        });
    }
    out.sort_by(|a, b| b.removed_at.cmp(&a.removed_at).then_with(|| a.key.cmp(&b.key)));
    Ok(out)
}

/// Forget removed mods for good: their trash files, archived details, kept values and profile places. Keys are
/// ArchiveEntry keys ("t12", "a3"). With `recycle`, the files of mods with no GameBanana link go to the Recycle Bin
/// instead of being deleted; the rest are deleted either way. Returns how many went.
pub fn archive_forget(db: &Db, keys: &[String], recycle: bool) -> Result<u64> {
    let mut n = 0;
    for k in keys {
        let id: Option<i64> = k.get(1..).and_then(|s| s.parse().ok());
        let Some(id) = id else { continue };
        if k.starts_with('t') {
            let rows = trash_rows(db, "id = ?1", [id])?;
            let Some(r) = rows.first() else { continue };
            delete_files(&r.kept, recycles(r, recycle))?;
            db.conn.execute("DELETE FROM trash WHERE id = ?1", [id])?;
            forget_if_unused(db, &r.mod_id)?;
            n += 1;
        } else if k.starts_with('a') {
            let mod_id: Option<String> = db.conn.query_row("SELECT mod_id FROM archive WHERE id = ?1", [id], |r| r.get(0)).optional()?;
            let Some(mod_id) = mod_id else { continue };
            drop_archive(db, id)?;
            forget_if_unused(db, &mod_id)?;
            n += 1;
        }
    }
    Ok(n)
}

/// A removed mod that a new install of the same GameBanana mod takes the place of.
#[derive(Debug, Clone)]
pub struct Removed {
    /// Its library id, which the new install takes back.
    pub mod_id: String,
    /// What it was when it was removed (name, character, tags, favourite, notes).
    pub entry: ModEntry,
    trash: Option<(i64, PathBuf)>,
    archive: Option<i64>,
}

/// Removed mods of a game that came from this GameBanana mod, newest first, one per mod id, leaving out ids that are
/// in the library again.
pub fn removed_by_gb(db: &Db, game: &str, gb_mod_id: u64) -> Result<Vec<Removed>> {
    let mut out: Vec<Removed> = Vec::new();
    let mut seen = HashSet::new();
    for r in trash_rows(db, "game = ?1 AND kept_path <> '' AND reason <> 'replaced'", [game])? {
        if r.entry.source.as_ref().is_none_or(|s| s.mod_id != gb_mod_id) || alive(db, &r.mod_id)? || !seen.insert(r.mod_id.clone()) { continue; }
        out.push(Removed { mod_id: r.mod_id, entry: r.entry, trash: Some((r.id, r.kept)), archive: None });
    }
    let rows: Vec<(i64, String, String)> = {
        let mut st = db.conn.prepare("SELECT id, mod_id, data FROM archive WHERE game = ?1 AND gb_mod_id = ?2 ORDER BY removed_at DESC, id DESC")?;
        let v = st.query_map(params![game, gb_mod_id as i64], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<std::result::Result<Vec<_>, _>>()?;
        v
    };
    for (id, mod_id, data) in rows {
        if alive(db, &mod_id)? || !seen.insert(mod_id.clone()) { continue; }
        out.push(Removed { mod_id, entry: serde_json::from_str(&data).unwrap_or_default(), trash: None, archive: Some(id) });
    }
    Ok(out)
}

/// Drop a removed mod's entry once a new install took its place (its old trash files go too).
pub fn drop_removed(db: &Db, r: &Removed) -> Result<()> {
    if let Some((id, kept)) = &r.trash {
        let _ = delete_files(kept, false);
        db.conn.execute("DELETE FROM trash WHERE id = ?1", [id])?;
    }
    if let Some(id) = r.archive { drop_archive(db, id)?; }
    Ok(())
}
