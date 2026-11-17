//! The download queue's data: items, their states and the snapshot the UI shows. The runner that downloads and
//! installs lives in src-tauri/src/runner.rs. Owner: ONLINE area (docs/spec.md, "Downloads").
//!
//! Items live in memory (`Queue`) and are saved to `queue_items` on every state change (not on progress), so the
//! queue survives a restart: `load` turns a download or install that was cut off back into Waiting, and the runner
//! resumes it from the .part file or the kept archive.

use crate::db::Db;
use crate::error::{Error, Result};
use crate::install::{Candidate, InstallMeta};
use rusqlite::params;
use serde::{Deserialize, Serialize};

pub const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS queue_items (id INTEGER PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS downloads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game TEXT NOT NULL,
    gb_mod_id INTEGER,
    file_id INTEGER,
    path TEXT NOT NULL,
    size INTEGER NOT NULL,
    md5 TEXT NOT NULL,
    downloaded_at INTEGER NOT NULL
);
";
pub fn migrate(_db: &Db) -> Result<()> { Ok(()) }

/// What the UI sends to queue a GameBanana file, or a file or folder from disk (`local_path`, no download step).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct QueueRequest {
    pub game: String,
    pub gb_mod_id: u64,
    pub file_id: u64,
    pub url: String,
    pub file_name: String,
    pub size: u64,
    pub md5: Option<String>,
    pub meta: InstallMeta,
    /// A thumbnail URL for the queue row.
    pub thumb: Option<String>,
    /// An archive or folder on this PC to install instead of downloading. Folders are copied, never moved.
    pub local_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum ItemState {
    Waiting,
    Downloading { received: u64, total: Option<u64> },
    Installing,
    /// The archive held several mods; the UI asks (event variants-needed) and answers with queue_choose.
    NeedsChoice { candidates: Vec<Candidate> },
    // rename_all above renames variants only, so fields inside a variant need their own name.
    Done { #[serde(rename = "modIds", alias = "mod_ids")] mod_ids: Vec<String> },
    Failed { message: String },
    Cancelled,
}

impl ItemState {
    pub fn finished(&self) -> bool { matches!(self, ItemState::Done { .. } | ItemState::Failed { .. } | ItemState::Cancelled) }
    pub fn active(&self) -> bool { matches!(self, ItemState::Downloading { .. } | ItemState::Installing) }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QueueItem {
    pub id: u64,
    pub req: QueueRequest,
    #[serde(flatten)]
    pub state: ItemState,
    pub added_at: i64,
    pub finished_at: Option<i64>,
    /// The downloaded archive, once it is complete (kept until the install succeeds).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub archive: Option<String>,
    /// The unpacked files while the UI picks variants.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub staging: Option<String>,
    /// Candidate keys the user picked (NeedsChoice answered).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub choose: Vec<String>,
    /// The install didn't know where the files go and put them in Mods as they came: why.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unsure: Option<String>,
    /// What the install is doing while it runs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub progress: Option<crate::install::InstallProgress>,
}

impl QueueItem {
    /// Ready to install: the archive is here, or it is a local file or folder.
    pub fn ready_to_install(&self) -> bool {
        self.req.local_path.is_some() || self.archive.as_deref().is_some_and(|a| std::path::Path::new(a).is_file())
    }
    /// The name shown in toasts.
    pub fn name(&self) -> String {
        self.req.meta.name.clone().filter(|n| !n.trim().is_empty()).unwrap_or_else(|| {
            if self.req.file_name.is_empty() { "the mod".into() } else { self.req.file_name.clone() }
        })
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QueueSummary { pub running: u32, pub waiting: u32, pub needs_choice: u32, pub done: u32, pub failed: u32 }

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueSnapshot { pub items: Vec<QueueItem>, pub summary: QueueSummary }

/// How far one running item is, sent many times a second instead of the whole snapshot: bytes for a download, the
/// current step for an install. The UI patches that one row; state changes still come as a full snapshot.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QueueProgress {
    pub id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub received: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<crate::install::InstallProgress>,
}

/// The queue in memory (saved to `queue_items` so it survives a restart).
#[derive(Debug, Default)]
pub struct Queue { pub items: Vec<QueueItem>, pub next_id: u64 }

impl Queue {
    /// Progress of every item that is downloading or installing.
    pub fn progress(&self) -> Vec<QueueProgress> {
        self.items.iter().filter_map(|i| match &i.state {
            ItemState::Downloading { received, total } => Some(QueueProgress { id: i.id, received: Some(*received), total: *total, progress: None }),
            ItemState::Installing => i.progress.clone().map(|p| QueueProgress { id: i.id, received: None, total: None, progress: Some(p) }),
            _ => None,
        }).collect()
    }

    pub fn snapshot(&self) -> QueueSnapshot {
        let mut s = QueueSummary::default();
        for i in &self.items {
            match i.state {
                ItemState::Downloading { .. } | ItemState::Installing => s.running += 1,
                ItemState::Waiting => s.waiting += 1,
                ItemState::NeedsChoice { .. } => s.needs_choice += 1,
                ItemState::Done { .. } => s.done += 1,
                ItemState::Failed { .. } => s.failed += 1,
                ItemState::Cancelled => {}
            }
        }
        QueueSnapshot { items: self.items.clone(), summary: s }
    }

    /// The saved queue. Work that a restart cut off goes back to Waiting: a download resumes from its .part file, an
    /// install runs again from the kept archive (or downloads again when it is gone). A choice whose unpacked
    /// files were cleaned up unpacks again.
    pub fn load(db: &Db) -> Result<Queue> {
        let mut st = db.conn.prepare("SELECT id, data FROM queue_items ORDER BY id")?;
        let rows: Vec<(i64, String)> = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<std::result::Result<_, _>>()?;
        let mut q = Queue::default();
        for (id, data) in rows {
            let Ok(mut item) = serde_json::from_str::<QueueItem>(&data) else {
                let _ = db.conn.execute("DELETE FROM queue_items WHERE id = ?1", [id]);
                continue;
            };
            match &item.state {
                ItemState::Downloading { .. } | ItemState::Installing => item.state = ItemState::Waiting,
                ItemState::NeedsChoice { .. } if !item.staging.as_deref().is_some_and(|s| std::path::Path::new(s).is_dir()) => {
                    item.staging = None;
                    // ask again once it is unpacked again
                    if item.choose.is_empty() { item.state = ItemState::Waiting; }
                }
                _ => {}
            }
            q.next_id = q.next_id.max(item.id + 1);
            q.items.push(item);
        }
        if q.next_id == 0 { q.next_id = 1; }
        Ok(q)
    }

    /// Add a request as a Waiting item. The same GameBanana file already waiting or running is not added twice.
    pub fn add(&mut self, req: QueueRequest) -> QueueItem {
        if req.file_id > 0 && req.local_path.is_none() {
            if let Some(i) = self.items.iter().find(|i| i.req.game == req.game && i.req.file_id == req.file_id && !i.state.finished()) {
                return i.clone();
            }
        }
        if self.next_id == 0 { self.next_id = 1; }
        let item = QueueItem {
            id: self.next_id, req, state: ItemState::Waiting, added_at: crate::db::now(), finished_at: None,
            archive: None, staging: None, choose: Vec::new(), progress: None, unsure: None,
        };
        self.next_id += 1;
        self.items.push(item.clone());
        item
    }

    pub fn get(&self, id: u64) -> Option<&QueueItem> { self.items.iter().find(|i| i.id == id) }
    pub fn get_mut(&mut self, id: u64) -> Option<&mut QueueItem> { self.items.iter_mut().find(|i| i.id == id) }

    pub fn require(&mut self, id: u64) -> Result<&mut QueueItem> {
        self.get_mut(id).ok_or_else(|| Error::Invalid("That download isn't in the list anymore".into()))
    }

    /// Set a state, stamping the finish time for final states. Returns the item for saving.
    pub fn set_state(&mut self, id: u64, state: ItemState) -> Option<QueueItem> {
        let item = self.get_mut(id)?;
        item.finished_at = state.finished().then(crate::db::now);
        item.state = state;
        Some(item.clone())
    }

    pub fn remove(&mut self, id: u64) -> Option<QueueItem> {
        let i = self.items.iter().position(|i| i.id == id)?;
        Some(self.items.remove(i))
    }

    /// Drop finished items (done, failed, cancelled). Returns them.
    pub fn clear_finished(&mut self) -> Vec<QueueItem> {
        let (gone, keep): (Vec<_>, Vec<_>) = std::mem::take(&mut self.items).into_iter().partition(|i| i.state.finished());
        self.items = keep;
        gone
    }
}

/// Save one item (after a state change).
pub fn save_item(db: &Db, item: &QueueItem) -> Result<()> {
    db.conn.execute(
        "INSERT INTO queue_items (id, data) VALUES (?1, ?2) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
        params![item.id as i64, serde_json::to_string(item)?],
    )?;
    Ok(())
}

pub fn delete_item(db: &Db, id: u64) -> Result<()> {
    db.conn.execute("DELETE FROM queue_items WHERE id = ?1", [id as i64])?;
    Ok(())
}

/// Note a finished download (kept for the record and for reusing an archive that is still on disk).
pub fn record_download(db: &Db, item: &QueueItem, path: &str, size: u64, md5: &str) -> Result<()> {
    db.conn.execute(
        "INSERT INTO downloads (game, gb_mod_id, file_id, path, size, md5, downloaded_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![item.req.game, item.req.gb_mod_id as i64, item.req.file_id as i64, path, size as i64, md5, crate::db::now()],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn done_state_uses_the_ui_field_name() {
        let s = serde_json::to_value(ItemState::Done { mod_ids: vec!["a".into()] }).unwrap();
        assert_eq!(s, serde_json::json!({ "state": "done", "modIds": ["a"] }));
        let old: ItemState = serde_json::from_str(r#"{"state":"done","mod_ids":["b"]}"#).unwrap();
        assert_eq!(old, ItemState::Done { mod_ids: vec!["b".into()] });
    }

    fn req(file_id: u64) -> QueueRequest {
        QueueRequest {
            game: "zzz".into(), gb_mod_id: 5, file_id, url: format!("https://gamebanana.com/dl/{file_id}"), file_name: "a.zip".into(), size: 10,
            md5: Some("abc".into()), meta: InstallMeta { name: Some("Coca Cola".into()), ..Default::default() }, ..Default::default()
        }
    }

    #[test]
    fn rows_round_trip_and_resume() {
        let db = Db::memory().unwrap();
        let mut q = Queue::default();
        let a = q.add(req(1));
        let b = q.add(req(2));
        let c = q.add(req(3));
        assert_eq!(q.add(req(1)).id, a.id, "the same file is not queued twice");
        q.set_state(a.id, ItemState::Downloading { received: 3, total: Some(10) });
        q.set_state(b.id, ItemState::NeedsChoice { candidates: vec![Candidate { key: "x".into(), label: "X".into(), ..Default::default() }] });
        q.get_mut(b.id).unwrap().staging = Some("Z:/nowhere/staging".into());
        q.set_state(c.id, ItemState::Failed { message: "no".into() });
        for i in &q.items { save_item(&db, i).unwrap(); }

        let json = serde_json::to_value(&q.items[0]).unwrap();
        assert_eq!(json["state"], "downloading");
        assert_eq!(json["received"], 3);
        assert_eq!(json["req"]["fileId"], 1);

        let back = Queue::load(&db).unwrap();
        assert_eq!(back.items.len(), 3);
        assert_eq!(back.items[0].state, ItemState::Waiting);
        assert_eq!(back.items[1].state, ItemState::Waiting, "a choice whose files are gone unpacks again");
        assert!(back.items[2].finished_at.is_some());
        assert_eq!(back.items[2].req, q.items[2].req);
        assert_eq!(back.next_id, 4);

        let mut back = back;
        assert_eq!(back.clear_finished().len(), 1);
        delete_item(&db, c.id).unwrap();
        assert_eq!(Queue::load(&db).unwrap().items.len(), 2);
        assert_eq!(back.snapshot().summary.waiting, 2);
    }
}
