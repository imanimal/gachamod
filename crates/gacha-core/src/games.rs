//! The game registry and where each game lives on this PC. Owner: SYSTEM area (docs/spec.md).
//!
//! `GAMES` is the static list of supported games. Detection (`detect`) fills the `game_paths` table from XXMI
//! Launcher's config first, then known launcher folders and registry keys. Every other area asks this module for a
//! game's folders through `mods_dir` / `importer_dir` / `game_dir`, never by reading settings itself.

use crate::db::Db;
use crate::error::{Error, Result};
use crate::model::GameState;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS game_paths (
    game TEXT PRIMARY KEY,
    game_dir TEXT,
    importer_dir TEXT,
    mods_dir TEXT,
    via_xxmi INTEGER NOT NULL DEFAULT 0,
    shown INTEGER,
    detected_at INTEGER
);
";

/// `user_set`: the folders were picked by hand, so detection leaves them alone while they exist.
pub fn migrate(db: &Db) -> Result<()> {
    if !db.has_column("game_paths", "user_set")? {
        db.conn.execute_batch("ALTER TABLE game_paths ADD COLUMN user_set INTEGER NOT NULL DEFAULT 0;")?;
    }
    Ok(())
}

/// One supported game. Data from docs/research.md (XXMI's importer packages and the live GameBanana API).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameDef {
    pub id: &'static str,
    pub name: &'static str,
    pub short: &'static str,
    /// XXMI importer code ("GIMI") or "3DMigoto" for community loaders outside XXMI.
    pub importer: &'static str,
    /// XXMI Launcher manages this importer.
    pub xxmi: bool,
    pub gamebanana_id: u32,
    /// GameBanana category whose children are one category per character (icons are portraits).
    pub gb_character_category: Option<u64>,
    pub accent: &'static str,
    pub theme: &'static str,
    /// The game's executable names (the first is the one to start).
    pub exe_names: &'static [&'static str],
    /// Process names that mean the game is running.
    pub process_names: &'static [&'static str],
    /// Folder names the game's install folder usually has.
    pub folder_names: &'static [&'static str],
    /// A child folder or file that proves a folder is the game's install folder.
    pub folder_children: &'static [&'static str],
    pub steam_app: Option<u32>,
}

pub static GAMES: &[GameDef] = &[
    GameDef { id: "gi", name: "Genshin Impact", short: "Genshin", importer: "GIMI", xxmi: true, gamebanana_id: 8552, gb_character_category: Some(18140),
        accent: "#d3bc8e", theme: "gi", exe_names: &["GenshinImpact.exe", "YuanShen.exe"], process_names: &["GenshinImpact.exe", "YuanShen.exe"],
        folder_names: &["Genshin Impact Game"], folder_children: &["GenshinImpact_Data", "YuanShen_Data"], steam_app: None },
    GameDef { id: "hsr", name: "Honkai: Star Rail", short: "Star Rail", importer: "SRMI", xxmi: true, gamebanana_id: 18366, gb_character_category: Some(22832),
        accent: "#a596f5", theme: "hsr", exe_names: &["StarRail.exe"], process_names: &["StarRail.exe"],
        folder_names: &["Star Rail Games"], folder_children: &["StarRail_Data"], steam_app: None },
    GameDef { id: "zzz", name: "Zenless Zone Zero", short: "ZZZ", importer: "ZZMI", xxmi: true, gamebanana_id: 19567, gb_character_category: Some(30305),
        accent: "#ff7a1c", theme: "zzz", exe_names: &["ZenlessZoneZero.exe", "ZenlessZoneZeroBeta.exe"], process_names: &["ZenlessZoneZero.exe", "ZenlessZoneZeroBeta.exe"],
        folder_names: &["ZenlessZoneZero Game"], folder_children: &["ZenlessZoneZero_Data"], steam_app: Some(4162040) },
    GameDef { id: "ww", name: "Wuthering Waves", short: "WuWa", importer: "WWMI", xxmi: true, gamebanana_id: 20357, gb_character_category: Some(29524),
        accent: "#e9d58a", theme: "ww", exe_names: &["Wuthering Waves.exe"], process_names: &["Client-Win64-Shipping.exe"],
        folder_names: &["Wuthering Waves Game"], folder_children: &["Client", "Engine"], steam_app: Some(3513350) },
    GameDef { id: "hi3", name: "Honkai Impact 3rd", short: "HI3", importer: "HIMI", xxmi: true, gamebanana_id: 10349, gb_character_category: Some(23620),
        accent: "#59c3f5", theme: "default", exe_names: &["BH3.exe"], process_names: &["BH3.exe"],
        folder_names: &["Honkai Impact 3rd game"], folder_children: &["BH3_Data"], steam_app: Some(1671200) },
    GameDef { id: "ef", name: "Arknights: Endfield", short: "Endfield", importer: "EFMI", xxmi: true, gamebanana_id: 21842, gb_character_category: Some(42770),
        accent: "#f2e33a", theme: "ef", exe_names: &["Endfield.exe"], process_names: &["Endfield.exe"],
        folder_names: &["EndField Game"], folder_children: &["Endfield_Data"], steam_app: Some(4732690) },
    // community 3DMigoto loaders, not in XXMI: the user points at the loader's folder (it holds d3dx.ini and Mods).
    // Exe names marked TODO in docs/spec.md are best guesses; SYSTEM confirms or leaves them for the user to set.
    GameDef { id: "pgr", name: "Punishing: Gray Raven", short: "PGR", importer: "3DMigoto", xxmi: false, gamebanana_id: 19942, gb_character_category: Some(35542),
        accent: "#e8433d", theme: "default", exe_names: &["PGR.exe"], process_names: &["PGR.exe"], folder_names: &["Punishing Gray Raven"], folder_children: &[], steam_app: Some(4125930) },
    GameDef { id: "p5x", name: "Persona 5: The Phantom X", short: "P5X", importer: "3DMigoto", xxmi: false, gamebanana_id: 20149, gb_character_category: None,
        accent: "#e6001a", theme: "default", exe_names: &["P5X.exe"], process_names: &["P5X.exe"], folder_names: &[], folder_children: &[], steam_app: Some(3061570) },
    GameDef { id: "gf2", name: "Girls' Frontline 2: Exilium", short: "GF2", importer: "3DMigoto", xxmi: false, gamebanana_id: 19494, gb_character_category: None,
        accent: "#f0a33a", theme: "default", exe_names: &["GF2_Exilium.exe"], process_names: &["GF2_Exilium.exe"], folder_names: &["GF2Exilium"], folder_children: &[], steam_app: Some(3347400) },
    GameDef { id: "idv", name: "Identity V", short: "IDV", importer: "3DMigoto", xxmi: false, gamebanana_id: 19670, gb_character_category: None,
        accent: "#b9a77a", theme: "default", exe_names: &["dwrg.exe"], process_names: &["dwrg.exe"], folder_names: &[], folder_children: &[], steam_app: None },
    GameDef { id: "ss", name: "Stella Sora", short: "Stella", importer: "3DMigoto", xxmi: false, gamebanana_id: 23629, gb_character_category: None,
        accent: "#7fb7ff", theme: "default", exe_names: &["StellaSora.exe"], process_names: &["StellaSora.exe"], folder_names: &[], folder_children: &[], steam_app: Some(4813850) },
    GameDef { id: "at", name: "Action Taimanin", short: "Taimanin", importer: "3DMigoto", xxmi: false, gamebanana_id: 26307, gb_character_category: Some(51169),
        accent: "#c05cff", theme: "default", exe_names: &["ActionTaimanin.exe"], process_names: &["ActionTaimanin.exe"], folder_names: &[], folder_children: &[], steam_app: Some(1335200) },
];

pub fn def(id: &str) -> Option<&'static GameDef> { GAMES.iter().find(|g| g.id == id) }

/// The game's own icon as a PNG at `<data>/icons/<game>.png`, taken from its exe at 256 px and taken again when the
/// exe changes (an update). None when the game folder or exe isn't known, or off Windows.
pub fn icon(db: &Db, data_dir: &Path, id: &str) -> Result<Option<PathBuf>> {
    let g = require_def(id)?;
    let Some(dir) = paths(db, id)?.game_dir.map(PathBuf::from) else { return Ok(None) };
    let Some(exe) = crate::launch::game_exe(g, &dir) else { return Ok(None) };
    let modified = std::fs::metadata(&exe).and_then(|m| m.modified()).ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
    let stamp = format!("{}|{modified}", exe.display());
    let key = format!("{id}.iconStamp");
    let out = data_dir.join("icons").join(format!("{id}.png"));
    if out.is_file() && db.setting(&key)?.as_deref() == Some(stamp.as_str()) { return Ok(Some(out)); }
    let Some(png) = crate::platform::exe_icon_png(&exe, 256) else { return Ok(None) };
    std::fs::create_dir_all(out.parent().unwrap_or(data_dir))?;
    std::fs::write(&out, png)?;
    db.set_setting(&key, &stamp)?;
    Ok(Some(out))
}

pub fn require_def(id: &str) -> Result<&'static GameDef> {
    def(id).ok_or_else(|| Error::Invalid(format!("Unknown game \"{id}\"")))
}

/// Folders the user set or detection found. `None` fields are unknown.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GamePaths {
    pub game_dir: Option<String>,
    pub importer_dir: Option<String>,
    pub mods_dir: Option<String>,
    pub via_xxmi: bool,
}

/// The saved folders for a game.
pub fn paths(db: &Db, id: &str) -> Result<GamePaths> {
    Ok(db.conn.query_row("SELECT game_dir, importer_dir, mods_dir, via_xxmi FROM game_paths WHERE game = ?1", [id], |r| {
        Ok(GamePaths { game_dir: r.get(0)?, importer_dir: r.get(1)?, mods_dir: r.get(2)?, via_xxmi: r.get::<_, i64>(3)? != 0 })
    }).optional()?.unwrap_or_default())
}

fn user_set(db: &Db, id: &str) -> Result<bool> {
    Ok(db.conn.query_row("SELECT user_set FROM game_paths WHERE game = ?1", [id], |r| r.get::<_, i64>(0)).optional()?.unwrap_or(0) != 0)
}

/// Save folders the user picked. Empty strings clear a folder. A missing mods_dir falls back to `<importer_dir>\Mods`.
/// Detection never overwrites these while they exist.
/// Picking XXMI's own loader folder for a game keeps launching it through XXMI.
pub fn save_paths(db: &Db, id: &str, p: &GamePaths) -> Result<()> {
    let mut p = p.clone();
    if let (false, Some(dir), true) = (p.via_xxmi, p.importer_dir.clone(), def(id).is_some_and(|g| g.xxmi)) {
        let root = db.setting("xxmi.root")?.filter(|s| !s.is_empty());
        let norm = |s: &str| s.trim().trim_end_matches(['/', '\\']).replace('/', "\\").to_lowercase();
        p.via_xxmi = crate::xxmi::status_cached(root.as_deref()).is_some_and(|x| x.importers.iter().any(|i| {
            i.game.as_deref() == Some(id) && i.importer_dir.as_deref().is_some_and(|d| norm(d) == norm(&dir))
        }));
    }
    write_paths(db, id, &p, true)
}

/// Forget a game's mod loader after it was uninstalled (its game folder stays), so detection can find a new one.
pub fn forget_loader(db: &Db, id: &str) -> Result<()> {
    let p = paths(db, id)?;
    write_paths(db, id, &GamePaths { game_dir: p.game_dir, importer_dir: None, mods_dir: None, via_xxmi: false }, false)
}

fn write_paths(db: &Db, id: &str, p: &GamePaths, by_user: bool) -> Result<()> {
    require_def(id)?;
    let clean = |s: &Option<String>| s.as_ref().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let mods = clean(&p.mods_dir).or_else(|| clean(&p.importer_dir).map(|i| PathBuf::from(i).join("Mods").to_string_lossy().into_owned()));
    db.conn.execute(
        "INSERT INTO game_paths (game, game_dir, importer_dir, mods_dir, via_xxmi, detected_at, user_set) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(game) DO UPDATE SET game_dir = excluded.game_dir, importer_dir = excluded.importer_dir, mods_dir = excluded.mods_dir,
           via_xxmi = excluded.via_xxmi, detected_at = excluded.detected_at, user_set = excluded.user_set",
        params![id, clean(&p.game_dir), clean(&p.importer_dir), mods, p.via_xxmi as i64, crate::db::now(), by_user as i64],
    )?;
    crate::watch::resync();
    Ok(())
}

fn not_set_up(id: &str, what: &str) -> Error {
    let name = def(id).map(|g| g.name).unwrap_or(id);
    Error::NotSetUp(format!("{name} has no {what} yet. Settings, Games installs its mod loader or finds the folder"))
}

/// The game's Mods folder. Every area uses this. A missing one is made again only when its importer folder is still
/// there with its d3dx.ini (a fresh loader install). Otherwise the folder was moved, deleted or sits on a drive that
/// isn't plugged in, so this says so and keeps the saved path, instead of making an empty folder that reads as
/// "no mods".
pub fn mods_dir(db: &Db, id: &str) -> Result<PathBuf> {
    let p = paths(db, id)?;
    let dir = p.mods_dir.as_deref().map(PathBuf::from).ok_or_else(|| not_set_up(id, "Mods folder"))?;
    if dir.is_dir() { return Ok(dir); }
    if loader_there(&dir) && std::fs::create_dir(&dir).is_ok() { return Ok(dir); }
    Err(mods_gone(id, &dir))
}

/// The missing Mods folder sat right inside a loader folder that still has its d3dx.ini, so it can be made again. A Mods
/// folder picked somewhere else (D:\ZZZ Mods) is never remade: it was moved or deleted, and an empty one would wipe the
/// library on the next scan.
fn loader_there(mods: &Path) -> bool {
    mods.parent().is_some_and(|p| p.join("d3dx.ini").is_file())
}

/// The Mods folder is saved but isn't on disk. Worded so the message gets its "Mods folders" button (lib/places.ts).
pub(crate) fn mods_gone(id: &str, dir: &Path) -> Error {
    let name = def(id).map(|g| g.name).unwrap_or(id);
    Error::NotSetUp(format!("{name} has no Mods folder at {} anymore. Pick it again, or install the mod loader again if it was removed", dir.display()))
}

/// The saved Mods folder isn't on disk and `mods_dir` won't make it again.
pub fn mods_missing(p: &GamePaths) -> bool {
    p.mods_dir.as_deref().map(Path::new).is_some_and(|m| !m.is_dir() && !loader_there(m))
}

/// The importer folder (d3dx.ini, d3dx_user.ini, Mods, ShaderFixes). Falls back to the Mods folder's parent.
pub fn importer_dir(db: &Db, id: &str) -> Result<PathBuf> {
    let p = paths(db, id)?;
    let imp = match (&p.importer_dir, &p.mods_dir) {
        (Some(i), _) => PathBuf::from(i),
        (None, m) => m.as_ref().and_then(|m| PathBuf::from(m).parent().map(|x| x.to_path_buf())).ok_or_else(|| not_set_up(id, "model importer folder"))?,
    };
    // saved mod options in d3dx_user.ini are named after the Mods folder's path from here
    if let Some(m) = &p.mods_dir { crate::ini::note_mods_dir(&imp, std::path::Path::new(m)); }
    Ok(imp)
}

/// The game's own install folder.
pub fn game_dir(db: &Db, id: &str) -> Result<PathBuf> {
    paths(db, id)?.game_dir.map(PathBuf::from).ok_or_else(|| not_set_up(id, "game folder"))
}

/// (mods, enabled) from LIBRARY's `mods` table; zeros when the table isn't there yet.
fn mod_counts(db: &Db, id: &str) -> (u32, u32) {
    db.conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(CASE WHEN json_extract(data, '$.enabled') THEN 1 ELSE 0 END), 0) FROM mods WHERE game = ?1",
        [id], |r| Ok((r.get::<_, i64>(0)? as u32, r.get::<_, i64>(1)? as u32)),
    ).unwrap_or((0, 0))
}

/// Every game in the registry with what this PC has. Cheap: one process snapshot, XXMI's config from a cache, no
/// disk scanning beyond `exists` checks, no network.
pub fn list(db: &Db) -> Result<Vec<GameState>> {
    let running = crate::launch::running_games();
    let root = db.setting("xxmi.root")?.filter(|s| !s.is_empty());
    let xxmi = crate::xxmi::status_cached(root.as_deref());
    let mut out = Vec::new();
    for g in GAMES {
        let p = paths(db, g.id)?;
        let shown: Option<i64> = db.conn.query_row("SELECT shown FROM game_paths WHERE game = ?1", [g.id], |r| r.get(0)).optional()?.flatten();
        let imp = if p.via_xxmi { xxmi.as_ref().and_then(|x| x.importers.iter().find(|i| i.code.eq_ignore_ascii_case(g.importer))) } else { None };
        let (mod_count, enabled_count) = mod_counts(db, g.id);
        out.push(GameState {
            id: g.id.into(), name: g.name.into(), short: g.short.into(), importer: g.importer.into(), xxmi: g.xxmi, gamebanana_id: g.gamebanana_id,
            gb_character_category: g.gb_character_category,
            accent: g.accent.into(), theme: g.theme.into(),
            installed: p.game_dir.as_ref().is_some_and(|d| PathBuf::from(d).exists()),
            shown: shown.map(|s| s != 0).unwrap_or(p.mods_dir.is_some()),
            importer_version: imp.and_then(|i| i.deployed_version.clone()),
            importer_latest: imp.and_then(|i| i.latest_version.clone()),
            running: running.contains(&g.id),
            mod_count, enabled_count,
            reload_key: crate::devtools::reload_key(db, g.id).name,
            mods_missing: mods_missing(&p),
            game_dir: p.game_dir, importer_dir: p.importer_dir, mods_dir: p.mods_dir, via_xxmi: p.via_xxmi,
            ..Default::default()
        });
    }
    Ok(out)
}

/// What one detection pass found for a game.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Found {
    pub game: &'static str,
    pub game_dir: Option<PathBuf>,
    pub importer_dir: Option<PathBuf>,
    pub via_xxmi: bool,
}

/// Look for every game: XXMI Launcher's config first (importer folders, game folders), then launcher folders and
/// registry keys. Saves what it finds, never overwriting a folder the user picked by hand unless that folder no
/// longer exists. Returns the new `list`.
pub fn detect(db: &Db) -> Result<Vec<GameState>> {
    let root = db.setting("xxmi.root")?.filter(|s| !s.is_empty());
    let found = discover(root.as_deref());
    apply(db, &found)?;
    list(db)
}

/// The disk and registry part of `detect`, without the database (so callers can hold the lock only for `apply`).
pub fn discover(xxmi_root: Option<&str>) -> Vec<Found> {
    let mut out: Vec<Found> = Vec::new();
    if let Ok(st) = crate::xxmi::status(xxmi_root) {
        for imp in &st.importers {
            let Some(game) = imp.game.as_deref().and_then(def) else { continue };
            // a loader folder has its d3dx.ini: one left with only Mods in it was uninstalled
            let dir = imp.importer_dir.as_ref().map(PathBuf::from).filter(|d| d.join("d3dx.ini").is_file());
            let gdir = imp.game_folder.as_ref().map(PathBuf::from).filter(|d| d.is_dir());
            if dir.is_none() && gdir.is_none() { continue; }
            out.push(Found { game: game.id, game_dir: gdir, importer_dir: dir, via_xxmi: true });
        }
    }
    let mui = registry_exe_folders();
    for g in GAMES {
        let have = out.iter().any(|f| f.game == g.id && f.game_dir.is_some());
        if have { continue; }
        let mut cands: Vec<PathBuf> = Vec::new();
        if matches!(g.id, "gi" | "hsr" | "zzz" | "hi3") { cands.extend(hoyoplay_paths()); cands.extend(default_dirs(g, &[r"C:\Program Files\HoYoPlay\games"])); }
        if g.id == "ww" { cands.extend(kuro_paths()); cands.extend(default_dirs(g, &[r"C:\Program Files\Wuthering Waves", r"C:\Wuthering Waves", r"D:\Wuthering Waves"])); }
        if g.id == "ef" { cands.extend(gryphlink_paths(g)); cands.extend(default_dirs(g, &[r"C:\Program Files\GRYPHLINK\games", r"D:\GRYPHLINK\games"])); }
        for exe in g.exe_names { cands.extend(folders_from_value_names(&mui, exe)); }
        // a Steam copy may keep the game a folder further down, beside the launcher Steam starts
        let steam = g.steam_app.map(steam_app_dirs).unwrap_or_default();
        let found = cands.into_iter().find_map(|c| find_game_dir(g, &c)).or_else(|| steam.iter().find_map(|c| find_game_dir_deep(g, c)));
        let Some(dir) = found else { continue };
        match out.iter_mut().find(|f| f.game == g.id) {
            Some(f) => f.game_dir = Some(dir),
            None => out.push(Found { game: g.id, game_dir: Some(dir), importer_dir: None, via_xxmi: false }),
        }
    }
    out
}

/// Save a detection pass. A folder the user picked stays while it exists; detected folders are refreshed.
pub fn apply(db: &Db, found: &[Found]) -> Result<()> {
    let exists = |s: &Option<String>| s.as_ref().is_some_and(|p| PathBuf::from(p).exists());
    let text = |p: &Option<PathBuf>| p.as_ref().map(|p| p.to_string_lossy().into_owned());
    for f in found {
        let old = paths(db, f.game)?;
        let by_user = user_set(db, f.game)?;
        let keep_game = exists(&old.game_dir) && (by_user || f.game_dir.is_none());
        let keep_importer = exists(&old.importer_dir) && (by_user || f.importer_dir.is_none());
        let new = GamePaths {
            game_dir: if keep_game { old.game_dir.clone() } else { text(&f.game_dir).or(old.game_dir.clone().filter(|_| exists(&old.game_dir))) },
            importer_dir: if keep_importer { old.importer_dir.clone() } else { text(&f.importer_dir) },
            mods_dir: if keep_importer { old.mods_dir.clone() } else { None },
            via_xxmi: if keep_importer { old.via_xxmi } else { f.via_xxmi && f.importer_dir.is_some() },
        };
        let changed = new.game_dir != old.game_dir || new.importer_dir != old.importer_dir || (new.mods_dir.is_some() && new.mods_dir != old.mods_dir)
            || (new.importer_dir.is_some() && new.via_xxmi != old.via_xxmi);
        if !changed { continue; }
        let still_user = by_user && (keep_game || keep_importer);
        write_paths(db, f.game, &new, still_user)?;
    }
    Ok(())
}

/// The folder that holds the game's exe: `dir` itself, or a child or grandchild named like the game's folder.
pub fn find_game_dir(g: &GameDef, dir: &Path) -> Option<PathBuf> {
    let ok = |d: &Path| g.exe_names.iter().any(|e| d.join(e).is_file());
    if ok(dir) { return Some(dir.to_path_buf()); }
    for name in g.folder_names {
        let d = dir.join(name);
        if ok(&d) { return Some(d); }
    }
    let kids = std::fs::read_dir(dir).ok()?;
    for k in kids.flatten().take(40) {
        let p = k.path();
        if p.is_dir() && ok(&p) { return Some(p); }
    }
    None
}

/// Like find_game_dir, and also one folder further down.
pub fn find_game_dir_deep(g: &GameDef, dir: &Path) -> Option<PathBuf> {
    find_game_dir(g, dir).or_else(|| {
        std::fs::read_dir(dir).ok()?.flatten().take(40).map(|k| k.path()).filter(|p| p.is_dir()).find_map(|p| find_game_dir(g, &p))
    })
}

fn default_dirs(g: &GameDef, bases: &[&str]) -> Vec<PathBuf> {
    bases.iter().flat_map(|b| g.folder_names.iter().map(move |n| PathBuf::from(b).join(n))).collect()
}

/// `"installPath":"..."` and `"persistentInstallPath":"..."` values in HoYoPlay's gamedata.dat (a binary store with
/// JSON inside).
pub fn parse_hoyoplay(data: &[u8]) -> Vec<PathBuf> {
    let text = String::from_utf8_lossy(data);
    let mut out: Vec<PathBuf> = Vec::new();
    for key in ["\"installPath\":\"", "\"persistentInstallPath\":\""] {
        let mut rest = text.as_ref();
        while let Some(i) = rest.find(key) {
            rest = &rest[i + key.len()..];
            let mut end = 0;
            let b = rest.as_bytes();
            while end < b.len() && b[end] != b'"' { end += if b[end] == b'\\' { 2 } else { 1 }; }
            let raw = &rest[..end.min(rest.len())];
            if let Ok(s) = serde_json::from_str::<String>(&format!("\"{raw}\"")) {
                let p = PathBuf::from(s);
                if !p.as_os_str().is_empty() && !out.contains(&p) { out.push(p); }
            }
        }
    }
    out
}

fn hoyoplay_paths() -> Vec<PathBuf> {
    let Some(appdata) = std::env::var_os("APPDATA") else { return vec![] };
    let base = PathBuf::from(appdata).join("Cognosphere").join("HYP");
    walkdir::WalkDir::new(base).max_depth(4).into_iter().flatten()
        .filter(|e| e.file_name().eq_ignore_ascii_case("gamedata.dat"))
        .filter_map(|e| std::fs::read(e.path()).ok())
        .flat_map(|d| parse_hoyoplay(&d)).collect()
}

/// The `path` in Kuro's kr_starter_game.json.
pub fn parse_kuro(text: &str) -> Option<PathBuf> {
    let v: serde_json::Value = serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()?;
    v.get("path").and_then(|p| p.as_str()).filter(|s| !s.trim().is_empty()).map(PathBuf::from)
}

fn kuro_paths() -> Vec<PathBuf> {
    let Some(appdata) = std::env::var_os("APPDATA") else { return vec![] };
    walkdir::WalkDir::new(PathBuf::from(appdata).join("KRLauncher")).max_depth(5).into_iter().flatten()
        .filter(|e| e.file_name().eq_ignore_ascii_case("kr_starter_game.json"))
        .filter_map(|e| std::fs::read_to_string(e.path()).ok())
        .filter_map(|t| parse_kuro(&t)).collect()
}

/// Library folders in Steam's libraryfolders.vdf (`"path"  "D:\\SteamLibrary"`).
pub fn parse_vdf_paths(text: &str) -> Vec<PathBuf> { vdf_values(text, "path").into_iter().map(PathBuf::from).collect() }

/// Every value of `key` in a Valve KeyValues text, unescaped.
pub fn vdf_values(text: &str, key: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in text.lines() {
        let toks = vdf_tokens(line);
        if toks.len() >= 2 && toks[0].eq_ignore_ascii_case(key) { out.push(toks[1].clone()); }
    }
    out
}

fn vdf_tokens(line: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '"' { continue; }
        let mut s = String::new();
        while let Some(c) = chars.next() {
            match c {
                '\\' => { if let Some(n) = chars.next() { s.push(match n { 'n' => '\n', 't' => '\t', o => o }); } }
                '"' => break,
                o => s.push(o),
            }
        }
        out.push(s);
    }
    out
}

fn steam_root() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        use winreg::{enums::HKEY_CURRENT_USER, RegKey};
        if let Ok(k) = RegKey::predef(HKEY_CURRENT_USER).open_subkey(r"Software\Valve\Steam") {
            if let Ok(p) = k.get_value::<String, _>("SteamPath") { return Some(PathBuf::from(p.replace('/', "\\"))); }
        }
    }
    let p = PathBuf::from(r"C:\Program Files (x86)\Steam");
    p.exists().then_some(p)
}

/// The folder is in a Steam library (`...\steamapps\common\...`).
pub fn in_steam_library(dir: &Path) -> bool { dir.to_string_lossy().to_lowercase().contains("steamapps") }

/// steam.exe, when Steam is installed.
pub fn steam_exe() -> Option<PathBuf> { steam_root().map(|r| r.join("steam.exe")).filter(|p| p.is_file()) }

fn steam_app_dirs(app: u32) -> Vec<PathBuf> {
    let Some(root) = steam_root() else { return vec![] };
    let mut libs = vec![root.clone()];
    if let Ok(t) = std::fs::read_to_string(root.join("steamapps").join("libraryfolders.vdf")) {
        for p in parse_vdf_paths(&t) { if !libs.contains(&p) { libs.push(p); } }
    }
    libs.into_iter().filter_map(|lib| {
        let manifest = std::fs::read_to_string(lib.join("steamapps").join(format!("appmanifest_{app}.acf"))).ok()?;
        let dir = vdf_values(&manifest, "installdir").into_iter().next()?;
        Some(lib.join("steamapps").join("common").join(dir))
    }).collect()
}

fn gryphlink_paths(g: &GameDef) -> Vec<PathBuf> {
    let mut out = Vec::new();
    #[cfg(windows)]
    {
        use winreg::{enums::HKEY_CURRENT_USER, RegKey};
        if let Ok(k) = RegKey::predef(HKEY_CURRENT_USER).open_subkey(r"Software\GRYPHLINK\Launcher") {
            for sub in k.enum_keys().flatten() {
                if let Ok(s) = k.open_subkey(&sub) {
                    if let Ok(p) = s.get_value::<String, _>("install_path") {
                        out.extend(g.folder_names.iter().map(|n| PathBuf::from(&p).join("games").join(n)));
                    }
                }
            }
        }
    }
    let _ = g;
    out
}

/// The GRYPHLINK launcher that installed Endfield in `game_dir` (`<launcher>\games\EndField Game`), or the one the
/// registry or the usual folders name.
pub fn gryphlink_launcher(game_dir: &Path) -> Option<PathBuf> {
    let mut cands: Vec<PathBuf> = game_dir.parent().and_then(Path::parent).map(|p| p.join("Launcher.exe")).into_iter().collect();
    #[cfg(windows)]
    {
        use winreg::{enums::HKEY_CURRENT_USER, RegKey};
        if let Ok(k) = RegKey::predef(HKEY_CURRENT_USER).open_subkey(r"Software\GRYPHLINK\Launcher") {
            for sub in k.enum_keys().flatten() {
                if let Ok(p) = k.open_subkey(&sub).and_then(|s| s.get_value::<String, _>("install_path")) { cands.push(PathBuf::from(p).join("Launcher.exe")); }
            }
        }
    }
    for base in [r"C:\Program Files", r"C:\Program Files (x86)"] {
        cands.push(Path::new(base).join("GRYPHLINK").join("Launcher.exe"));
        cands.push(Path::new(base).join("Hypergryph Launcher").join("Launcher.exe"));
    }
    cands.into_iter().find(|p| p.is_file())
}

/// Value names from Windows' MuiCache and FeatureUsage keys: full exe paths of programs this user ran.
fn registry_exe_folders() -> Vec<String> {
    let mut out = Vec::new();
    #[cfg(windows)]
    {
        use winreg::{enums::HKEY_CURRENT_USER, RegKey};
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        for path in [
            r"SOFTWARE\Classes\Local Settings\Software\Microsoft\Windows\Shell\MuiCache",
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\FeatureUsage\AppSwitched",
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\FeatureUsage\ShowJumpView",
        ] {
            if let Ok(k) = hkcu.open_subkey(path) {
                out.extend(k.enum_values().flatten().map(|(name, _)| name));
            }
        }
    }
    out
}

/// Folders holding `exe` from registry value names like `D:\Games\Genshin Impact Game\GenshinImpact.exe.FriendlyAppName`.
pub fn folders_from_value_names(names: &[String], exe: &str) -> Vec<PathBuf> {
    let needle = format!("\\{}", exe.to_lowercase());
    let mut out: Vec<PathBuf> = Vec::new();
    for n in names {
        let lower = n.to_lowercase();
        let Some(i) = lower.find(&needle) else { continue };
        // the exe name must end there (not "GenshinImpact.exe2")
        let after = &lower[i + needle.len()..];
        if !(after.is_empty() || after.starts_with('.')) { continue; }
        let p = PathBuf::from(&n[..i]);
        if !out.contains(&p) { out.push(p); }
    }
    out
}

/// Show or hide a game in the rail.
pub fn set_shown(db: &Db, id: &str, shown: bool) -> Result<()> {
    require_def(id)?;
    db.conn.execute("INSERT INTO game_paths (game, shown) VALUES (?1, ?2) ON CONFLICT(game) DO UPDATE SET shown = excluded.shown", params![id, shown as i64])?;
    crate::watch::resync();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("gachamod-games-{name}-{}-{}", std::process::id(), crate::db::now()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn reads_hoyoplay_paths_from_binary_data() {
        let mut data = vec![0x67u8, 0x29, 0, 0, 0xff, 0xff];
        data.extend_from_slice(br#"bh3_global{"gameBiz":"bh3_global","installPath":"C:\\Program Files\\HoYoPlay\\games\\Honkai Impact 3rd game","isCreateShortcut":false}"#);
        data.extend_from_slice(&[0xd3, 0x08]);
        data.extend_from_slice(br#"{"gameBiz":"nap_global","installPath":"","persistentInstallPath":"D:\\Games\\ZenlessZoneZero Game"}"#);
        let p = parse_hoyoplay(&data);
        assert_eq!(p, vec![PathBuf::from(r"C:\Program Files\HoYoPlay\games\Honkai Impact 3rd game"), PathBuf::from(r"D:\Games\ZenlessZoneZero Game")]);
    }

    #[test]
    fn a_missing_mods_folder_is_made_again_only_next_to_its_loader() {
        let db = Db::memory().unwrap();
        let imp = temp("mods-gone").join("ZZMI");
        std::fs::create_dir_all(&imp).unwrap();
        let mods = imp.join("Mods");
        save_paths(&db, "zzz", &GamePaths { importer_dir: Some(imp.to_string_lossy().into()), mods_dir: Some(mods.to_string_lossy().into()), ..Default::default() }).unwrap();
        // no d3dx.ini: the loader is gone, so nothing is made and the saved path stays
        assert!(matches!(mods_dir(&db, "zzz"), Err(Error::NotSetUp(m)) if m.contains("no Mods folder at")));
        assert!(!mods.exists());
        assert!(list(&db).unwrap().iter().find(|g| g.id == "zzz").is_some_and(|g| g.mods_missing && g.mods_dir.is_some()));
        std::fs::write(imp.join("d3dx.ini"), "").unwrap();
        assert!(!list(&db).unwrap().iter().find(|g| g.id == "zzz").unwrap().mods_missing);
        assert_eq!(mods_dir(&db, "zzz").unwrap(), mods);
        assert!(mods.is_dir());
        // a Mods folder picked outside the loader folder is reported missing, never remade, even with the loader fine
        let elsewhere = imp.parent().unwrap().join("ZZZ Mods");
        save_paths(&db, "zzz", &GamePaths { importer_dir: Some(imp.to_string_lossy().into()), mods_dir: Some(elsewhere.to_string_lossy().into()), ..Default::default() }).unwrap();
        assert!(mods_dir(&db, "zzz").is_err());
        assert!(!elsewhere.exists());
        assert!(list(&db).unwrap().iter().find(|g| g.id == "zzz").unwrap().mods_missing);
        let _ = std::fs::remove_dir_all(imp.parent().unwrap());
    }

    #[test]
    fn reads_kuro_and_steam_files() {
        assert_eq!(parse_kuro(r#"{"path":"D:\\Wuthering Waves\\Wuthering Waves Game","version":"2.1"}"#), Some(PathBuf::from(r"D:\Wuthering Waves\Wuthering Waves Game")));
        assert_eq!(parse_kuro("{}"), None);
        let vdf = "\"libraryfolders\"\n{\n\t\"0\"\n\t{\n\t\t\"path\"\t\t\"C:\\\\Program Files (x86)\\\\Steam\"\n\t\t\"apps\"\n\t\t{\n\t\t\t\"440\"\t\t\"33292355826\"\n\t\t}\n\t}\n\t\"1\"\n\t{\n\t\t\"path\"\t\t\"D:\\\\SteamLibrary\"\n\t}\n}\n";
        assert_eq!(parse_vdf_paths(vdf), vec![PathBuf::from(r"C:\Program Files (x86)\Steam"), PathBuf::from(r"D:\SteamLibrary")]);
        let acf = "\"AppState\"\n{\n\t\"appid\"\t\t\"3513350\"\n\t\"installdir\"\t\t\"Wuthering Waves\"\n}\n";
        assert_eq!(vdf_values(acf, "installdir"), vec!["Wuthering Waves".to_string()]);
    }

    #[test]
    fn reads_folders_from_registry_names() {
        let names = vec![
            r"C:\Program Files\HoYoPlay\games\Genshin Impact game\GenshinImpact.exe.FriendlyAppName".to_string(),
            r"D:\Games\Genshin\GENSHINIMPACT.EXE".to_string(),
            r"C:\Tools\GenshinImpact.exe2.ApplicationCompany".to_string(),
            r"C:\Windows\explorer.exe".to_string(),
        ];
        assert_eq!(folders_from_value_names(&names, "GenshinImpact.exe"),
            vec![PathBuf::from(r"C:\Program Files\HoYoPlay\games\Genshin Impact game"), PathBuf::from(r"D:\Games\Genshin")]);
    }

    #[test]
    fn finds_the_exe_folder_and_keeps_user_folders() {
        let base = temp("detect");
        let zzz = def("zzz").unwrap();
        let game = base.join("ZenlessZoneZero Game");
        std::fs::create_dir_all(&game).unwrap();
        std::fs::write(game.join("ZenlessZoneZero.exe"), b"").unwrap();
        assert_eq!(find_game_dir(zzz, &base), Some(game.clone()));
        assert_eq!(find_game_dir(zzz, &game), Some(game.clone()));
        let steam = base.join("steamapps").join("common").join("ZenlessZoneZero");
        let nested = steam.join("Games").join("ZenlessZoneZero Game");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("ZenlessZoneZero.exe"), b"").unwrap();
        assert_eq!(find_game_dir(zzz, &steam), None);
        assert_eq!(find_game_dir_deep(zzz, &steam), Some(nested.clone()));
        assert!(in_steam_library(&nested));
        assert!(!in_steam_library(&game));

        let db = Db::memory().unwrap();
        let importer = base.join("ZZMI");
        std::fs::create_dir_all(&importer).unwrap();
        apply(&db, &[Found { game: "zzz", game_dir: Some(game.clone()), importer_dir: Some(importer.clone()), via_xxmi: true }]).unwrap();
        let p = paths(&db, "zzz").unwrap();
        assert!(p.via_xxmi);
        assert_eq!(p.mods_dir.as_deref(), Some(importer.join("Mods").to_string_lossy().as_ref()));

        // the user picks another loader folder; detection leaves it while it exists
        let mine = base.join("My loader");
        std::fs::create_dir_all(&mine).unwrap();
        save_paths(&db, "zzz", &GamePaths { game_dir: p.game_dir.clone(), importer_dir: Some(mine.to_string_lossy().into()), mods_dir: None, via_xxmi: false }).unwrap();
        apply(&db, &[Found { game: "zzz", game_dir: Some(game.clone()), importer_dir: Some(importer.clone()), via_xxmi: true }]).unwrap();
        assert_eq!(paths(&db, "zzz").unwrap().importer_dir.as_deref(), Some(mine.to_string_lossy().as_ref()));

        // once it's gone, detection takes over again
        std::fs::remove_dir_all(&mine).unwrap();
        apply(&db, &[Found { game: "zzz", game_dir: Some(game.clone()), importer_dir: Some(importer.clone()), via_xxmi: true }]).unwrap();
        let p = paths(&db, "zzz").unwrap();
        assert_eq!(p.importer_dir.as_deref(), Some(importer.to_string_lossy().as_ref()));
        assert!(p.via_xxmi);

        let list = list(&db).unwrap();
        let z = list.iter().find(|g| g.id == "zzz").unwrap();
        assert!(z.installed && z.shown && z.mod_count == 0);
        let _ = std::fs::remove_dir_all(&base);
    }
}
