use serde::Serialize;

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
    #[error("GameBanana answered {status}: {message}")]
    Http { status: u16, message: String },
    #[error("Could not reach the server: {0}")]
    Network(String),
    #[error("Unexpected answer from the server: {0}")]
    Decode(String),
    #[error("{}", io_text(.0))]
    Io(#[from] std::io::Error),
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
            Error::Http { .. } => "http",
            Error::Network(_) => "network",
            Error::Decode(_) => "decode",
            Error::Io(_) => "io",
            Error::Db(_) => "db",
            Error::Archive(_) => "archive",
            Error::Invalid(_) => "invalid",
            Error::Conflict(_) => "conflict",
            Error::Todo(_) => "todo",
        }
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
        _ => e.to_string(),
    }
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
