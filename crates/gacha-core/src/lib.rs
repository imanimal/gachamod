//! gachamod core: everything that is not UI. The Tauri app in `src-tauri` is a thin layer of commands over it.
//! Areas and who owns them are listed in docs/spec.md.

pub mod archive;
pub mod db;
pub mod devtools;
pub mod download;
pub mod error;
pub mod games;
pub mod imm;
pub mod ini;
pub mod install;
pub mod launch;
pub mod library;
pub mod model;
pub mod pack;
pub mod platform;
pub mod profiles;
pub mod queue;
pub mod xxmi;

pub use error::{Error, Result};

pub const APP_NAME: &str = "gachamod";
pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
/// Sent as the User-Agent to GameBanana and anything else the app calls.
pub fn user_agent() -> String { format!("gachamod/{APP_VERSION}") }

/// The HTTP client every area shares (downloads, image fetches).
pub fn http_client() -> Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .user_agent(user_agent())
        .connect_timeout(std::time::Duration::from_secs(15))
        .build()?)
}
