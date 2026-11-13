//! Shared app state. Areas add what they need as their own types in gacha-core and a field here (docs/spec.md).
use gacha_core::db::{Db, Shared};
use gacha_core::queue::Queue;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokio::sync::Notify;

pub struct AppState {
    pub data_dir: PathBuf,
    pub db: Shared,
    pub http: reqwest::Client,
    /// The download queue (ONLINE area, runner.rs).
    pub queue: Arc<Mutex<Queue>>,
    /// Wakes the queue runner.
    pub pump: Arc<Notify>,
    /// Queue items whose running download the user cancelled.
    pub cancel: Arc<Mutex<std::collections::HashSet<u64>>>,
}

impl AppState {
    pub fn new(data_dir: PathBuf) -> gacha_core::Result<Self> {
        let db = Db::open(&data_dir.join("gachamod.sqlite"))?;
        let _ = db.cache_prune(gacha_core::db::now() - 7 * 86400);
        Ok(AppState {
            data_dir,
            db: Arc::new(Mutex::new(db)),
            http: gacha_core::http_client()?,
            queue: Default::default(),
            pump: Arc::new(Notify::new()),
            cancel: Default::default(),
        })
    }
}

/// Run blocking work (disk, database) off the async runtime's threads.
pub async fn blocking<T: Send + 'static>(f: impl FnOnce() -> gacha_core::Result<T> + Send + 'static) -> gacha_core::Result<T> {
    tauri::async_runtime::spawn_blocking(f).await.unwrap_or_else(|e| Err(gacha_core::Error::Invalid(e.to_string())))
}
