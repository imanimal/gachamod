//! gachamod core: everything that is not UI. The Tauri app in `src-tauri` is a thin layer of commands over it.
//! Areas and who owns them are listed in docs/spec.md.

pub mod aliases;
pub mod app_update;
pub mod archive;
pub mod backups;
pub mod db;
pub mod devtools;
pub mod download;
pub mod extensions;
pub mod error;
pub mod fixers;
pub mod fixes;
pub mod games;
pub mod gb_account;
pub mod hotkeys;
pub mod imm;
pub mod ini;
pub mod install;
pub mod keys;
pub mod launch;
pub mod library;
pub mod live;
pub mod gamecheck;
pub mod logs;
pub mod managers;
pub mod mesh;
pub mod model;
pub mod originals;
pub mod owned;
pub mod pack;
pub mod platform;
pub mod previews;
pub mod profiles;
pub mod queue;
pub mod recycle;
pub mod reset;
pub mod settings_file;
pub mod telemetry;
pub mod xxmi;
pub mod xxmi_setup;

pub use error::{Error, Result};

pub const APP_NAME: &str = "gachamod";
pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
/// Sent as the User-Agent to GameBanana and anything else the app calls.
pub fn user_agent() -> String { format!("gachamod/{APP_VERSION}") }

/// The HTTP client every area shares (downloads, image fetches). A connection that goes quiet for 30 seconds fails
/// with an error instead of waiting forever; a download that does keeps its part and resumes on retry.
pub fn http_client() -> Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .user_agent(user_agent())
        .connect_timeout(std::time::Duration::from_secs(15))
        .read_timeout(std::time::Duration::from_secs(30))
        .build()?)
}
