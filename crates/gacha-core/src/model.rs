//! Types shared by more than one area. Everything here crosses to the UI as camelCase JSON and is mirrored in
//! `src/lib/api/types.ts`. Change a shape only together with its TypeScript twin, and never rename a field another
//! area reads (see docs/spec.md, "Shared contract").

use serde::{Deserialize, Serialize};

/// A game id from the registry in `games.rs`: "gi", "hsr", "zzz", "ww", "hi3", "ef", ...
pub type GameId = String;

/// One game as this PC has it: the registry entry plus what detection and the user set.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameState {
    pub id: GameId,
    pub name: String,
    /// A short label for tight spots: "Genshin", "HSR", "ZZZ".
    pub short: String,
    /// The model importer code: "GIMI", "SRMI", "ZZMI", "WWMI", "HIMI", "EFMI", or "3DMigoto" for community loaders.
    pub importer: String,
    /// XXMI Launcher supports this game's importer.
    pub xxmi: bool,
    pub gamebanana_id: u32,
    /// GameBanana category whose children are the game's characters (None: no character tree).
    pub gb_character_category: Option<u64>,
    /// Brand colour as #rrggbb, used for the game's ring and as the default theme's accent.
    pub accent: String,
    /// The theme this game uses by default: "default" or "zzz".
    pub theme: String,
    /// The game's own folder was found (or set).
    pub installed: bool,
    pub game_dir: Option<String>,
    /// The importer folder, which holds d3dx.ini, d3dx_user.ini and Mods (e.g. %APPDATA%\XXMI Launcher\ZZMI).
    pub importer_dir: Option<String>,
    /// Usually `<importer_dir>\Mods`.
    pub mods_dir: Option<String>,
    /// `mods_dir` is saved but isn't on disk: moved, deleted, or on a drive that isn't plugged in.
    #[serde(default)]
    pub mods_missing: bool,
    /// XXMI Launcher manages this importer, so launches go through it.
    pub via_xxmi: bool,
    pub importer_version: Option<String>,
    pub importer_latest: Option<String>,
    /// Shown in the game rail. Games with a Mods folder start shown; the rest can be added from Settings.
    pub shown: bool,
    pub running: bool,
    pub mod_count: u32,
    pub enabled_count: u32,
    /// The key that reloads mods in the game (d3dx.ini `reload_config`), like "F10".
    pub reload_key: String,
}

/// Where a mod came from online.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModSource {
    /// "gamebanana" for now.
    pub site: String,
    pub mod_id: u64,
    pub file_id: Option<u64>,
    /// The mod's page, e.g. https://gamebanana.com/mods/676139
    pub url: String,
    pub submitter: Option<String>,
    /// The archive's file name on the site.
    pub file_name: Option<String>,
    /// The mod's last update on the site when this copy was installed (unix seconds). Update checks compare to it.
    pub remote_updated: Option<i64>,
}

/// `.gachamod.json`, kept in each mod's own folder so a mod keeps who it is when it is moved, renamed, turned off
/// (folder renamed with the DISABLED prefix) or sent to another computer.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Sidecar {
    pub format: u32,
    /// Random, stable id (32 hex characters).
    pub id: String,
    /// The name shown in the app (the folder name when the user never set one).
    pub name: String,
    pub character: Option<String>,
    pub source: Option<ModSource>,
    pub version: Option<String>,
    pub installed_at: i64,
    pub tags: Vec<String>,
    pub notes: Option<String>,
    pub favorite: bool,
    pub nsfw: bool,
    /// A preview image's file name inside the mod folder (preview.jpg) or a remote URL.
    pub preview: Option<String>,
    /// The preview the user picked, copied into the mod folder (preview.png). It wins over every other image.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_preview: Option<String>,
    /// Preview files that were there before the user's own, renamed so it wins (preview-original.jpg). Removing the
    /// custom preview puts them back.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub preview_backups: Vec<String>,
    /// Which folder of the downloaded archive this mod is, when the archive held several (the install's candidate
    /// key, "" for the archive's root). A shared link list uses it to pick the same one again.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub variant: Option<String>,
    /// The mod this one is a sub-mod of (its id): an add-on that goes with it, like a hair recolour for one skin.
    /// It never counts as a clash with its parent, and it turns off and back on with it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    /// A sub-mod that was on when its parent was turned off, so turning the parent on brings it back.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub off_with_parent: bool,
}

pub const SIDECAR_FILE: &str = ".gachamod.json";
/// 3DMigoto skips folders whose names start with this (d3dx.ini: `exclude_recursive = DISABLED*`).
pub const DISABLED_PREFIX: &str = "DISABLED ";

/// A mod as the library lists it.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModEntry {
    pub id: String,
    pub game: GameId,
    pub name: String,
    /// The folder's own name right now (with the DISABLED prefix when off).
    pub folder: String,
    /// Path from the Mods folder with forward slashes, e.g. "Ellen Joe/DISABLED Coca Cola".
    pub rel_path: String,
    /// Absolute path of the mod folder.
    pub path: String,
    /// On as the player sees it. A live skin that isn't the one showing counts as off (see `standby`).
    pub enabled: bool,
    /// A live skin (live.rs) that isn't the one showing: its folder stays on so it can switch in without a reload,
    /// but it draws nothing, so `enabled` is false. Use `loaded()` for "the folder is on".
    #[serde(default)]
    pub standby: bool,
    pub character: Option<String>,
    /// The folder it sits in, relative to Mods ("Ellen Joe"), or None at the top level.
    pub group: Option<String>,
    pub source: Option<ModSource>,
    pub version: Option<String>,
    pub installed_at: i64,
    pub size_bytes: u64,
    pub file_count: u32,
    pub ini_count: u32,
    /// An image URL the webview can show: a local file through the asset protocol, or a remote URL.
    pub preview: Option<String>,
    pub tags: Vec<String>,
    pub notes: Option<String>,
    pub favorite: bool,
    pub nsfw: bool,
    /// The mod has key bindings or saved variables to show (filled by ini.rs during a scan).
    pub has_keys: bool,
    /// Other enabled mods that override the same hashes (filled by ini.rs).
    pub conflicts: u32,
    /// A newer version is on GameBanana (set by the UI's update check through `mods_mark_updates`).
    pub update_available: bool,
    /// A small copy of a local `preview` (about 400 px, in the app's cache) for cards and lists. None for a remote,
    /// animated or already small picture, or before it is made; the full `preview` is for the drawer and lightbox.
    #[serde(default)]
    pub thumb: Option<String>,
    /// The preview is one the user picked (library::set_preview).
    #[serde(default)]
    pub custom_preview: bool,
    /// Folders inside it with their own inis, each switched on or off by itself (library::parts). 0 for most mods.
    #[serde(default)]
    pub parts: u32,
    /// The mod this one is a sub-mod of (Sidecar::parent).
    #[serde(default)]
    pub parent: Option<String>,
}

impl ModEntry {
    /// The folder is on, so the game loads it: on, or a live skin on standby.
    pub fn loaded(&self) -> bool { self.enabled || self.standby }
    /// The mod it belongs with: its parent, or itself. Mods with the same root never count as clashing.
    pub fn root(&self) -> &str { self.parent.as_deref().unwrap_or(&self.id) }
}

/// What changed after a library action, so the UI can update in place and offer undo.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModChange {
    pub changed: Vec<ModEntry>,
    pub removed: Vec<String>,
    /// Plain-language notes for a toast ("Turned off 2 other Ellen skins").
    pub notes: Vec<String>,
}

/// A character of a game, from GameBanana's category tree (synced by the UI) plus what the library holds.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Character {
    pub name: String,
    pub gb_category_id: Option<u64>,
    pub icon: Option<String>,
    /// Mods for this character in the library, and how many are on.
    pub mod_count: u32,
    pub enabled_count: u32,
}

/// One saved loadout for a game: which mods are on, and each mod's saved variable values.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: i64,
    pub game: GameId,
    pub name: String,
    /// An emoji, or "char:<Character name>" to use that character's icon.
    pub icon: Option<String>,
    /// #rrggbb
    pub color: Option<String>,
    /// An image URL (remote or asset) shown behind the profile card.
    pub banner: Option<String>,
    pub description: Option<String>,
    pub active: bool,
    pub mod_count: u32,
    pub created_at: i64,
    pub updated_at: i64,
    /// In-game hotkey that switches to this profile, like "Ctrl+Alt+1" (hotkeys.rs).
    pub hotkey: Option<String>,
}

/// Fields of a profile the user can change. Missing fields stay as they are; `Some(None)` is not used, an empty
/// string clears a text field.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ProfilePatch {
    pub name: Option<String>,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub banner: Option<String>,
    pub description: Option<String>,
    /// An in-game hotkey like "Ctrl+Alt+1"; an empty string clears it.
    pub hotkey: Option<String>,
}

/// Events the backend emits. Names are the Tauri event names.
pub mod events {
    /// `{ game }`: mods were added, removed, renamed or toggled outside the call that is waiting for its answer.
    pub const LIBRARY_CHANGED: &str = "library-changed";
    /// The download queue snapshot.
    pub const QUEUE: &str = "queue";
    /// Between queue snapshots: a list of `QueueProgress` with the bytes or install step of each running item.
    pub const QUEUE_PROGRESS: &str = "queue-progress";
    /// An archive held several mods or variants and the user must pick.
    pub const VARIANTS_NEEDED: &str = "variants-needed";
    /// `{ game, running }`
    pub const GAME_STATE: &str = "game-state";
    /// `{ url }`: a gachamod:// or GameBanana 1-click link reached the app.
    pub const DEEP_LINK: &str = "deep-link";
    /// `{ path }`: a .gachamod file was opened with the app.
    pub const OPEN_FILE: &str = "open-file";
    /// `{ level, text }`: a line just written to gachamod.log ("info", "warn" or "error").
    pub const APP_LOG: &str = "app-log";
    /// `{ text, bad }`: a quiet note for a toast from background work.
    pub const TOAST: &str = "toast";
}
