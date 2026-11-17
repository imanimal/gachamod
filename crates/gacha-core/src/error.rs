use serde::Serialize;
use std::path::{Path, PathBuf};

pub type Result<T, E = Error> = std::result::Result<T, E>;

/// Errors the UI shows in plain language. `kind` lets the UI pick a tone or offer a fix.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Cancelled")]
    Cancelled,
    /// The game is running and the change would be lost or blocked (d3dx_user.ini is rewritten by 3DMigoto on exit).
    #[error("{0} is running. Close it first, or press F10 in game after the change")]
    GameRunning(String),
    /// Nothing is set up for this game yet (no Mods folder found).
    #[error("{0}")]
    NotSetUp(String),
    /// GameBanana answered with an error.
    #[error("GameBanana answered {status}: {message}")]
    Http { status: u16, message: String },
    /// Another site (GitHub, Enka.Network, an extension list) answered with an error. `message` says what didn't come.
    #[error("{site} answered {status}. {message}")]
    Site { site: String, status: u16, message: String },
    /// A site didn't answer at all. Made by `Error::unreachable`, which logs `detail` (the raw text).
    #[error("gachamod couldn't reach {site}. Check your connection, then try again")]
    Unreachable { site: String, detail: String },
    /// A site is turning this PC away for now. `wait` is how long, like "an hour".
    #[error("{site} is limiting requests from this PC for a while. Try again in {wait}")]
    RateLimited { site: String, wait: &'static str },
    #[error("Could not reach the server: {0}")]
    Network(String),
    #[error("Unexpected answer from the server: {0}")]
    Decode(String),
    #[error("{}", io_text(.0))]
    Io(#[from] std::io::Error),
    /// A file error with the file or folder it happened on. Made with `.at(path)`.
    #[error("{}", io_text_at(.path, .source))]
    IoAt { path: PathBuf, source: std::io::Error },
    #[error("Local database: {0}")]
    Db(String),
    #[error("{0}")]
    Archive(String),
    #[error("{0}")]
    Invalid(String),
    #[error("{0}")]
    Conflict(String),
    /// A stub the skeleton left for an area that is not built yet.
    #[error("Not built yet: {0}")]
    Todo(&'static str),
}

impl Error {
    pub fn kind(&self) -> &'static str {
        match self {
            Error::Cancelled => "cancelled",
            Error::GameRunning(_) => "game_running",
            Error::NotSetUp(_) => "not_set_up",
            Error::Http { .. } | Error::Site { .. } => "http",
            Error::Unreachable { .. } | Error::Network(_) => "network",
            Error::RateLimited { .. } => "rate_limited",
            Error::Decode(_) => "decode",
            Error::Io(_) | Error::IoAt { .. } => "io",
            Error::Db(_) => "db",
            Error::Archive(_) => "archive",
            Error::Invalid(_) => "invalid",
            Error::Conflict(_) => "conflict",
            Error::Todo(_) => "todo",
        }
    }

    /// `site` didn't answer. The player sees one plain sentence; the raw text goes to gachamod.log.
    pub fn unreachable(site: impl Into<String>, detail: impl std::fmt::Display) -> Error {
        let (site, detail) = (site.into(), detail.to_string());
        crate::logs::warn(format!("couldn't reach {site}: {detail}"));
        Error::Unreachable { site, detail }
    }
}

/// `.at(path)` on a file call names the file or folder in the error, so a missing one is named.
pub trait IoAt<T> {
    fn at(self, path: impl AsRef<Path>) -> Result<T>;
}

impl<T> IoAt<T> for std::result::Result<T, std::io::Error> {
    fn at(self, path: impl AsRef<Path>) -> Result<T> {
        self.map_err(|source| Error::IoAt { path: path.as_ref().to_path_buf(), source })
    }
}

/// A file error in words a player can act on. Windows' own text is kept where it already says what happened.
pub(crate) fn io_text(e: &std::io::Error) -> String {
    use std::io::ErrorKind as K;
    match (e.raw_os_error(), e.kind()) {
        // ERROR_SHARING_VIOLATION, ERROR_LOCK_VIOLATION
        (Some(32 | 33), _) => "A file is in use by another program. Close the game or the tool using it, then try again".into(),
        (_, K::StorageFull | K::QuotaExceeded) => "The drive is full. Free some space, then try again".into(),
        (_, K::PermissionDenied) => "Windows didn't allow access to a file. Close the game or the tool using it, then try again".into(),
        (_, K::InvalidFilename) => format!("A file name isn't allowed on Windows ({e})"),
        // ERROR_FILE_NOT_FOUND, ERROR_PATH_NOT_FOUND: Windows' text doesn't say which one
        (Some(2 | 3), _) | (_, K::NotFound) => "A file or folder isn't there anymore. It may have been moved or deleted".into(),
        _ => e.to_string(),
    }
}

/// `io_text` with the file or folder named.
fn io_text_at(path: &Path, e: &std::io::Error) -> String {
    use std::io::ErrorKind as K;
    if e.kind() == K::NotFound || matches!(e.raw_os_error(), Some(2 | 3)) {
        return format!("{} isn't there anymore. It may have been moved or deleted", path.display());
    }
    format!("{} ({})", io_text(e), path.display())
}

impl From<reqwest::Error> for Error {
    fn from(e: reqwest::Error) -> Self {
        if e.is_decode() { Error::Decode(e.to_string()) } else { Error::Network(e.without_url().to_string()) }
    }
}

impl From<serde_json::Error> for Error {
    fn from(e: serde_json::Error) -> Self { Error::Decode(e.to_string()) }
}

/// Sent to the UI as `{ kind, message }`.
impl Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut st = s.serialize_struct("Error", 2)?;
        st.serialize_field("kind", self.kind())?;
        st.serialize_field("message", &self.to_string())?;
        st.end()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_is_named() {
        let e = std::fs::read("no-such-folder/none.txt").at("no-such-folder/none.txt").unwrap_err();
        assert_eq!(e.kind(), "io");
        assert!(e.to_string().starts_with("no-such-folder/none.txt isn't there"), "{e}");
    }

    #[test]
    fn site_errors_read_plainly() {
        let e = Error::Unreachable { site: "GitHub".into(), detail: "error sending request".into() };
        assert_eq!(e.to_string(), "gachamod couldn't reach GitHub. Check your connection, then try again");
        let e = Error::RateLimited { site: "GitHub".into(), wait: "an hour" };
        assert_eq!(e.kind(), "rate_limited");
    }
}
