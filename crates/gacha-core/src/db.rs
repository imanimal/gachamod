//! Local SQLite store, one file (`gachamod.sqlite`) in the app's data folder.
//!
//! The base tables (settings, cache) live here. Each area owns its own tables as an idempotent `SCHEMA` constant
//! (`CREATE TABLE IF NOT EXISTS ...`) in its module, applied by `Db::open`. That keeps areas from editing one shared
//! migration list. To change a released table, add an `ALTER TABLE` guarded by `Db::has_column` in that module's
//! `migrate` function instead of editing its `SCHEMA`.

use crate::error::{Error, Result};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;

impl From<rusqlite::Error> for Error {
    fn from(e: rusqlite::Error) -> Self {
        match e {
            rusqlite::Error::QueryReturnedNoRows => Error::Invalid("That's no longer there. It may have just been removed".into()),
            e => Error::Db(e.to_string()),
        }
    }
}

const BASE: &str = "
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, body TEXT NOT NULL, fetched_at INTEGER NOT NULL);
";

pub struct Db { pub conn: Connection }

/// The database as the app shares it. Long file work (scans, installs, packs) takes this and locks only for the
/// moments it reads or writes rows, so the UI never waits on a big copy.
pub type Shared = std::sync::Arc<std::sync::Mutex<Db>>;

/// One copy of the database a day, the last five kept, in `backups/` beside it.
fn backup_daily(path: &Path) {
    if !path.exists() { return; }
    let Some(dir) = path.parent().map(|d| d.join("backups")) else { return };
    let day = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let target = dir.join(format!("gachamod-{day}.sqlite"));
    if target.exists() || std::fs::create_dir_all(&dir).is_err() { return; }
    if let Ok(c) = Connection::open(path) { let _ = c.pragma_update(None, "wal_checkpoint", "TRUNCATE"); }
    if std::fs::copy(path, &target).is_err() { return; }
    let mut old: Vec<_> = std::fs::read_dir(&dir).into_iter().flatten().flatten().map(|e| e.path())
        .filter(|p| p.file_name().is_some_and(|n| n.to_string_lossy().starts_with("gachamod-"))).collect();
    old.sort();
    while old.len() > 5 { let _ = std::fs::remove_file(old.remove(0)); }
}

impl Db {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(dir) = path.parent() { std::fs::create_dir_all(dir)?; }
        backup_daily(path);
        Self::init(Connection::open(path)?)
    }

    pub fn memory() -> Result<Self> { Self::init(Connection::open_in_memory()?) }

    fn init(conn: Connection) -> Result<Self> {
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.execute_batch(BASE)?;
        let db = Db { conn };
        // every area's own tables (see the module docs above)
        for schema in [crate::library::SCHEMA, crate::profiles::SCHEMA, crate::queue::SCHEMA, crate::games::SCHEMA] {
            db.conn.execute_batch(schema)?;
        }
        crate::library::migrate(&db)?;
        crate::profiles::migrate(&db)?;
        crate::queue::migrate(&db)?;
        crate::games::migrate(&db)?;
        Ok(db)
    }

    /// True when `table` has `column` (for guarded `ALTER TABLE` steps in a module's `migrate`).
    pub fn has_column(&self, table: &str, column: &str) -> Result<bool> {
        let mut st = self.conn.prepare(&format!("PRAGMA table_info({table})"))?;
        let names: Vec<String> = st.query_map([], |r| r.get::<_, String>(1))?.collect::<std::result::Result<_, _>>()?;
        Ok(names.iter().any(|n| n == column))
    }

    // ── settings: small string values, keyed like "zzz.launch.args" or "ui.nsfw" ──

    pub fn setting(&self, key: &str) -> Result<Option<String>> {
        Ok(self.conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0)).optional()?)
    }
    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        self.conn.execute("INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params![key, value])?;
        Ok(())
    }
    pub fn clear_setting(&self, key: &str) -> Result<()> {
        self.conn.execute("DELETE FROM settings WHERE key = ?1", [key])?;
        Ok(())
    }
    /// A JSON setting, or `None` when missing or unreadable.
    pub fn setting_json<T: serde::de::DeserializeOwned>(&self, key: &str) -> Result<Option<T>> {
        Ok(self.setting(key)?.and_then(|s| serde_json::from_str(&s).ok()))
    }
    pub fn set_setting_json<T: serde::Serialize>(&self, key: &str, value: &T) -> Result<()> {
        self.set_setting(key, &serde_json::to_string(value)?)
    }

    // ── response cache ──

    pub fn cache_get(&self, key: &str, ttl_secs: i64) -> Result<Option<String>> {
        let now = now();
        Ok(self.conn.query_row("SELECT body FROM cache WHERE key = ?1 AND fetched_at > ?2", params![key, now - ttl_secs], |r| r.get(0)).optional()?)
    }
    pub fn cache_put(&self, key: &str, body: &str) -> Result<()> {
        self.conn.execute("INSERT INTO cache (key, body, fetched_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET body = excluded.body, fetched_at = excluded.fetched_at", params![key, body, now()])?;
        Ok(())
    }
    pub fn cache_prune(&self, older_than: i64) -> Result<usize> {
        Ok(self.conn.execute("DELETE FROM cache WHERE fetched_at < ?1", [older_than])?)
    }
}

/// Unix seconds.
pub fn now() -> i64 { chrono::Utc::now().timestamp() }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn opens_and_keeps_settings() {
        let db = Db::memory().unwrap();
        db.set_setting("a", "1").unwrap();
        assert_eq!(db.setting("a").unwrap().as_deref(), Some("1"));
        db.set_setting_json("j", &vec![1, 2]).unwrap();
        assert_eq!(db.setting_json::<Vec<i32>>("j").unwrap(), Some(vec![1, 2]));
    }
}
