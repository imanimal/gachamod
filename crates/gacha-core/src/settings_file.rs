//! Settings export and import: one JSON file with the app's settings, each game's setup and, if wanted, its
//! profiles, to set up gachamod on another PC or keep a copy. Owner: SYSTEM area.
//!
//! Paths are written as they are. On import a path that doesn't exist on this PC is skipped and listed, and the
//! game keeps the folder it has. Mods in profiles are matched by their id, then their folder, then their name; mods
//! this PC doesn't have are left out. Nothing secret or machine-only goes in the file (see `skip_key`).
//!
//! Before an import changes anything, the tables it touches are saved to `backups/` in the data folder as they
//! are, and `restore` puts them back exactly (the toast's "Undo import").

use crate::db::{now, Db};
use crate::error::{Error, Result};
use crate::ini::VarValue;
use crate::{games, library};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};

pub const FORMAT: &str = "gachamod-settings";
pub const VERSION: u32 = 1;
const BACKUP_FORMAT: &str = "gachamod-settings-backup";
/// The UI's own key for a game's theme pick, kept in the game's setup in the file.
const THEME_KEY: &str = "gm.theme.";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SettingsFile {
    pub format: String,
    pub version: u32,
    pub app_version: String,
    pub exported_at: i64,
    /// App settings not tied to one game ("ui.nsfw", "player", "xxmi.root").
    pub settings: BTreeMap<String, String>,
    /// Choices the window keeps itself (colours, text size, accents).
    pub ui: BTreeMap<String, String>,
    pub games: Vec<GameSetup>,
    /// Missing when exported without profiles.
    pub profiles: Option<Vec<ProfileOut>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct GameSetup {
    pub id: String,
    /// Shown in the game rail. Missing when never set (then it follows whether the game has a Mods folder).
    pub shown: Option<bool>,
    pub game_dir: Option<String>,
    pub importer_dir: Option<String>,
    pub mods_dir: Option<String>,
    pub via_xxmi: bool,
    /// The theme picked for this game, missing for the game's own.
    pub theme: Option<String>,
    /// The game's own settings without the "<game>." prefix: "launch" (launch options as JSON), "oneSkin" ...
    pub settings: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ProfileOut {
    pub game: String,
    pub name: String,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub banner: Option<String>,
    pub description: Option<String>,
    pub active: bool,
    pub mods: Vec<ProfileMod>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ProfileMod {
    pub id: String,
    pub name: String,
    /// Path from the Mods folder without DISABLED prefixes ("Ellen Joe/Coca Cola").
    pub folder: String,
    pub enabled: bool,
    /// Saved option values.
    pub vars: Vec<VarValue>,
}

/// What the import would change or did change.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub app_version: String,
    pub exported_at: i64,
    /// Settings whose value changes.
    pub settings: u32,
    /// Names of games whose folders, rail visibility, theme or settings change.
    pub games: Vec<String>,
    /// Profiles made new.
    pub new_profiles: Vec<String>,
    /// Profiles that exist here and get the file's mods and values.
    pub replaced_profiles: Vec<String>,
    /// Paths in the file that don't exist on this PC, as "Genshin Impact game folder: D:\Games\...".
    pub skipped_paths: Vec<String>,
    /// Mods named in profiles that this PC doesn't have.
    pub missing_mods: u32,
    /// The window's choices to apply (theme picks, colours, text size).
    pub ui: BTreeMap<String, String>,
    /// The backup taken before applying (empty in a preview).
    pub backup: String,
}

/// Keys that are machine-only, internal or secret, so they never go in the file nor come in from one.
pub fn skip_key(key: &str) -> bool {
    let k = key.to_ascii_lowercase();
    ["token", "secret", "password", "apikey", "api_key", "cookie", "session"].iter().any(|w| k.contains(w))
        || k.ends_with(".profilevarspending")
        || k.starts_with("app.updatecheckedat")
        || k == "onboarded"
}

/// The game id a key belongs to ("zzz.oneSkin" -> ("zzz", "oneSkin")).
fn split_game_key(key: &str) -> Option<(&'static str, &str)> {
    let (g, rest) = key.split_once('.')?;
    games::def(g).map(|d| (d.id, rest)).filter(|_| !rest.is_empty())
}

fn looks_like_path(v: &str) -> bool {
    let b = v.as_bytes();
    (b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/')) || v.starts_with("\\\\")
}

/// Mod folder path without DISABLED prefixes, lower case, for matching.
fn folder_key(rel: &str) -> String {
    rel.split('/').map(library::display_folder).collect::<Vec<_>>().join("/").to_lowercase()
}

// ── export ──

/// Build the file. `ui` is the window's own choices (its stored keys and values).
pub fn export(db: &Db, with_profiles: bool, ui: &BTreeMap<String, String>) -> Result<SettingsFile> {
    let mut settings = BTreeMap::new();
    let mut per_game: HashMap<&str, BTreeMap<String, String>> = HashMap::new();
    {
        let mut st = db.conn.prepare("SELECT key, value FROM settings ORDER BY key")?;
        let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        for r in rows {
            let (k, v) = r?;
            if skip_key(&k) { continue; }
            match split_game_key(&k) {
                Some((g, rest)) => { per_game.entry(g).or_default().insert(rest.to_string(), v); }
                None => { settings.insert(k, v); }
            }
        }
    }
    let mut ui_rest = BTreeMap::new();
    let mut themes = HashMap::new();
    for (k, v) in ui {
        if skip_key(k) { continue; }
        match k.strip_prefix(THEME_KEY) { Some(g) => { themes.insert(g.to_string(), v.clone()); } None => { ui_rest.insert(k.clone(), v.clone()); } }
    }
    let mut out_games = Vec::new();
    for g in games::GAMES {
        let row: Option<(Option<String>, Option<String>, Option<String>, i64, Option<i64>)> = db.conn.query_row(
            "SELECT game_dir, importer_dir, mods_dir, via_xxmi, shown FROM game_paths WHERE game = ?1", [g.id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))).optional()?;
        let settings = per_game.remove(g.id).unwrap_or_default();
        let theme = themes.remove(g.id);
        if row.is_none() && settings.is_empty() && theme.is_none() { continue; }
        let (game_dir, importer_dir, mods_dir, via, shown) = row.unwrap_or((None, None, None, 0, None));
        out_games.push(GameSetup { id: g.id.into(), shown: shown.map(|s| s != 0), game_dir, importer_dir, mods_dir, via_xxmi: via != 0, theme, settings });
    }
    let profiles = if with_profiles { Some(export_profiles(db)?) } else { None };
    Ok(SettingsFile {
        format: FORMAT.into(), version: VERSION, app_version: crate::APP_VERSION.into(), exported_at: now(),
        settings, ui: ui_rest, games: out_games, profiles,
    })
}

fn export_profiles(db: &Db) -> Result<Vec<ProfileOut>> {
    let rows: Vec<(i64, String, String, Option<String>, Option<String>, Option<String>, Option<String>, bool)> = {
        let mut st = db.conn.prepare("SELECT id, game, name, icon, color, banner, description, active FROM profiles ORDER BY game, created_at, id")?;
        let v = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get::<_, i64>(7)? != 0)))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        v
    };
    // mod id -> (name, folder path) per game
    let mut libs: HashMap<String, HashMap<String, (String, String)>> = HashMap::new();
    let mut out = Vec::new();
    for (id, game, name, icon, color, banner, description, active) in rows {
        if games::def(&game).is_none() { continue; }
        if !libs.contains_key(&game) {
            let m = library::list(db, &game)?.into_iter().map(|e| (e.id.clone(), (e.name, e.rel_path))).collect();
            libs.insert(game.clone(), m);
        }
        let lib = &libs[&game];
        let mut vars: HashMap<String, Vec<VarValue>> = HashMap::new();
        {
            let mut st = db.conn.prepare("SELECT mod_id, ini, var, value FROM profile_vars WHERE profile_id = ?1 ORDER BY mod_id, ini, var")?;
            let rows = st.query_map([id], |r| Ok((r.get::<_, String>(0)?, VarValue { ini: r.get(1)?, var: r.get(2)?, value: r.get(3)? })))?;
            for r in rows { let (m, v) = r?; vars.entry(m).or_default().push(v); }
        }
        let mut mods = Vec::new();
        {
            let mut st = db.conn.prepare("SELECT mod_id, enabled FROM profile_mods WHERE profile_id = ?1")?;
            let rows = st.query_map([id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? != 0)))?;
            for r in rows {
                let (mod_id, enabled) = r?;
                // a mod in the trash or gone from disk has no folder to name
                let Some((mod_name, rel)) = lib.get(&mod_id) else { continue };
                let folder = rel.split('/').map(library::display_folder).collect::<Vec<_>>().join("/");
                mods.push(ProfileMod { vars: vars.remove(&mod_id).unwrap_or_default(), id: mod_id, name: mod_name.clone(), folder, enabled });
            }
        }
        mods.sort_by(|a, b| a.folder.to_lowercase().cmp(&b.folder.to_lowercase()));
        out.push(ProfileOut { game, name, icon, color, banner, description, active, mods });
    }
    Ok(out)
}

pub fn write_file(path: &Path, file: &SettingsFile) -> Result<()> {
    if let Some(dir) = path.parent().filter(|d| !d.as_os_str().is_empty()) { std::fs::create_dir_all(dir)?; }
    let tmp = path.with_extension("json.part");
    std::fs::write(&tmp, serde_json::to_vec_pretty(file)?)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

/// Read and check a settings file.
pub fn read_file(path: &Path) -> Result<SettingsFile> {
    let text = std::fs::read_to_string(path)?;
    parse(&text)
}

pub fn parse(text: &str) -> Result<SettingsFile> {
    let not_ours = || Error::Invalid("That file isn't a gachamod settings file".into());
    let v: Value = serde_json::from_str(text.trim_start_matches('\u{feff}')).map_err(|_| not_ours())?;
    if v.get("format").and_then(Value::as_str) != Some(FORMAT) { return Err(not_ours()); }
    let version = v.get("version").and_then(Value::as_u64).unwrap_or(0);
    if version == 0 || version > VERSION as u64 {
        return Err(Error::Invalid("This settings file is from a newer gachamod. Update gachamod, then import it again".into()));
    }
    serde_json::from_value(v).map_err(|_| Error::Invalid("This settings file is damaged and can't be read".into()))
}

// ── import ──

/// Everything an import would do, worked out without writing.
struct Plan {
    summary: ImportSummary,
    settings: Vec<(String, String)>,
    paths: Vec<(&'static str, games::GamePaths)>,
    shown: Vec<(&'static str, bool)>,
    profiles: Vec<(ProfileOut, Option<i64>, Vec<(String, bool, Vec<VarValue>)>)>,
}

fn plan(db: &Db, file: &SettingsFile) -> Result<Plan> {
    let mut s = ImportSummary { app_version: file.app_version.clone(), exported_at: file.exported_at, ..Default::default() };
    let mut settings = Vec::new();
    let mut changed_games: Vec<&'static str> = Vec::new();
    let mark = |g: &'static str, list: &mut Vec<&'static str>| if !list.contains(&g) { list.push(g); };

    // a setting holding a path that isn't here is left as it is
    let mut want = |key: String, mut value: String, s: &mut ImportSummary, label: &str| -> Result<bool> {
        if skip_key(&key) { return Ok(false); }
        if looks_like_path(&value) && !Path::new(&value).exists() {
            s.skipped_paths.push(format!("{label}: {value}"));
            return Ok(false);
        }
        if key.ends_with(".launch") { value = clean_launch(&value, label, s); }
        if db.setting(&key)?.as_deref() == Some(value.as_str()) { return Ok(false); }
        settings.push((key, value));
        Ok(true)
    };
    for (k, v) in &file.settings {
        if split_game_key(k).is_some() { continue; }
        if want(k.clone(), v.clone(), &mut s, k)? { s.settings += 1; }
    }

    let mut paths = Vec::new();
    let mut shown = Vec::new();
    for g in &file.games {
        let Some(def) = games::def(&g.id) else { continue };
        for (k, v) in &g.settings {
            if want(format!("{}.{k}", def.id), v.clone(), &mut s, &format!("{} {k}", def.name))? { s.settings += 1; mark(def.id, &mut changed_games); }
        }
        if let Some(t) = &g.theme { s.ui.insert(format!("{THEME_KEY}{}", def.id), t.clone()); }

        let cur = games::paths(db, def.id)?;
        let mut next = cur.clone();
        let take = |v: &Option<String>, slot: &mut Option<String>, what: &str, s: &mut ImportSummary| -> bool {
            let Some(p) = v.as_ref().map(|p| p.trim()).filter(|p| !p.is_empty()) else { return false };
            if !Path::new(p).exists() { s.skipped_paths.push(format!("{} {what}: {p}", def.name)); return false; }
            if slot.as_deref().is_some_and(|c| c.eq_ignore_ascii_case(p)) { return false; }
            *slot = Some(p.to_string());
            true
        };
        let a = take(&g.game_dir, &mut next.game_dir, "game folder", &mut s);
        let b = take(&g.importer_dir, &mut next.importer_dir, "mod loader folder", &mut s);
        let c = take(&g.mods_dir, &mut next.mods_dir, "Mods folder", &mut s);
        if b {
            next.via_xxmi = g.via_xxmi;
            // the old Mods folder belongs to the old loader folder; fall back to the new one's Mods
            if !c { next.mods_dir = None; }
        }
        if a || b || c { paths.push((def.id, next)); mark(def.id, &mut changed_games); }

        if let Some(v) = g.shown {
            let now: Option<i64> = db.conn.query_row("SELECT shown FROM game_paths WHERE game = ?1", [def.id], |r| r.get(0)).optional()?.flatten();
            if now.map(|x| x != 0) != Some(v) { shown.push((def.id, v)); mark(def.id, &mut changed_games); }
        }
    }
    for (k, v) in &file.ui { if !skip_key(k) && !k.starts_with(THEME_KEY) { s.ui.insert(k.clone(), v.clone()); } }

    let mut profiles = Vec::new();
    for p in file.profiles.iter().flatten() {
        let Some(def) = games::def(&p.game) else { continue };
        let name = p.name.trim();
        if name.is_empty() { continue; }
        let lib = library::list(db, def.id)?;
        let by_id: HashMap<&str, &str> = lib.iter().map(|e| (e.id.as_str(), e.id.as_str())).collect();
        let by_folder: HashMap<String, &str> = lib.iter().map(|e| (folder_key(&e.rel_path), e.id.as_str())).collect();
        let mut names: HashMap<String, Vec<&str>> = HashMap::new();
        for e in &lib { names.entry(e.name.to_lowercase()).or_default().push(e.id.as_str()); }
        let mut rows = Vec::new();
        for m in &p.mods {
            let found = by_id.get(m.id.as_str()).copied()
                .or_else(|| by_folder.get(&folder_key(&m.folder)).copied())
                .or_else(|| names.get(&m.name.to_lowercase()).filter(|v| v.len() == 1).map(|v| v[0]));
            match found {
                Some(id) if !rows.iter().any(|(x, _, _): &(String, bool, Vec<VarValue>)| x == id) => rows.push((id.to_string(), m.enabled, m.vars.clone())),
                Some(_) => {}
                None => s.missing_mods += 1,
            }
        }
        let existing: Option<i64> = db.conn.query_row("SELECT id FROM profiles WHERE game = ?1 AND lower(name) = lower(?2)", params![def.id, name], |r| r.get(0)).optional()?;
        let label = format!("{name} ({})", def.short);
        if existing.is_some() { s.replaced_profiles.push(label) } else { s.new_profiles.push(label) }
        let mut p = p.clone();
        p.name = name.to_string();
        p.game = def.id.to_string();
        if let Some(b) = p.banner.clone().filter(|b| looks_like_path(b) && !Path::new(b).exists()) {
            s.skipped_paths.push(format!("{} banner: {b}", p.name));
            p.banner = None;
        }
        profiles.push((p, existing, rows));
    }
    s.games = changed_games.iter().filter_map(|g| games::def(g)).map(|d| d.name.to_string()).collect();
    Ok(Plan { summary: s, settings, paths, shown, profiles })
}

/// Launch options keep everything but a custom exe that isn't on this PC.
fn clean_launch(value: &str, label: &str, s: &mut ImportSummary) -> String {
    let Ok(mut v) = serde_json::from_str::<Value>(value) else { return value.to_string() };
    if let Some(exe) = v.get("customExe").and_then(Value::as_str).map(str::to_string) {
        if looks_like_path(&exe) && !Path::new(&exe).exists() {
            s.skipped_paths.push(format!("{label} custom exe: {exe}"));
            v["customExe"] = Value::Null;
            return v.to_string();
        }
    }
    value.to_string()
}

/// What importing `file` would change, without changing anything.
pub fn preview(db: &Db, file: &SettingsFile) -> Result<ImportSummary> { Ok(plan(db, file)?.summary) }

/// Apply `file`. Take a backup with `snapshot` + `save_backup` first.
pub fn apply(db: &Db, file: &SettingsFile) -> Result<ImportSummary> {
    let p = plan(db, file)?;
    let tx = db.conn.unchecked_transaction()?;
    for (k, v) in &p.settings { db.set_setting(k, v)?; }
    for (g, paths) in &p.paths { games::save_paths(db, g, paths)?; }
    for (g, v) in &p.shown { games::set_shown(db, g, *v)?; }
    let t = now();
    for (prof, existing, rows) in &p.profiles {
        let id = match existing {
            Some(id) => {
                db.conn.execute("UPDATE profiles SET icon = ?1, color = ?2, banner = ?3, description = ?4, updated_at = ?5 WHERE id = ?6",
                    params![prof.icon, prof.color, prof.banner, prof.description, t, id])?;
                db.conn.execute("DELETE FROM profile_vars WHERE profile_id = ?1", [id])?;
                db.conn.execute("DELETE FROM profile_mods WHERE profile_id = ?1", [id])?;
                *id
            }
            None => {
                db.conn.execute("INSERT INTO profiles (game, name, icon, color, banner, description, active, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?7)",
                    params![prof.game, prof.name, prof.icon, prof.color, prof.banner, prof.description, t])?;
                db.conn.last_insert_rowid()
            }
        };
        for (mod_id, enabled, vars) in rows {
            db.conn.execute("INSERT OR REPLACE INTO profile_mods (profile_id, mod_id, enabled) VALUES (?1, ?2, ?3)", params![id, mod_id, *enabled as i64])?;
            for v in vars {
                db.conn.execute("INSERT OR REPLACE INTO profile_vars (profile_id, mod_id, ini, var, value) VALUES (?1, ?2, ?3, ?4, ?5)", params![id, mod_id, v.ini, v.var, v.value])?;
            }
        }
    }
    tx.commit()?;
    Ok(p.summary)
}

// ── backup and undo ──

/// The tables an import touches, in insert order.
const TABLES: &[&str] = &["settings", "game_paths", "profiles", "profile_mods", "profile_vars"];

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Snapshot {
    pub format: String,
    pub version: u32,
    pub taken_at: i64,
    pub tables: BTreeMap<String, Vec<Map<String, Value>>>,
    /// The window's own choices at the time.
    pub ui: BTreeMap<String, String>,
}

fn to_json(v: rusqlite::types::ValueRef<'_>) -> Value {
    use rusqlite::types::ValueRef::*;
    match v {
        Null => Value::Null,
        Integer(i) => Value::from(i),
        Real(f) => Value::from(f),
        Text(t) => Value::from(String::from_utf8_lossy(t).into_owned()),
        Blob(b) => Value::from(hex::encode(b)),
    }
}

fn to_sql(v: &Value) -> rusqlite::types::Value {
    use rusqlite::types::Value as S;
    match v {
        Value::Null => S::Null,
        Value::Bool(b) => S::Integer(*b as i64),
        Value::Number(n) => n.as_i64().map(S::Integer).unwrap_or_else(|| S::Real(n.as_f64().unwrap_or(0.0))),
        Value::String(s) => S::Text(s.clone()),
        other => S::Text(other.to_string()),
    }
}

/// Every row of the tables an import touches, as they are now.
pub fn snapshot(db: &Db, ui: &BTreeMap<String, String>) -> Result<Snapshot> {
    let mut tables = BTreeMap::new();
    for t in TABLES {
        let mut st = db.conn.prepare(&format!("SELECT * FROM {t}"))?;
        let cols: Vec<String> = st.column_names().iter().map(|c| c.to_string()).collect();
        let rows = st.query_map([], |r| {
            let mut m = Map::new();
            for (i, c) in cols.iter().enumerate() { m.insert(c.clone(), to_json(r.get_ref(i)?)); }
            Ok(m)
        })?.collect::<std::result::Result<Vec<_>, _>>()?;
        tables.insert(t.to_string(), rows);
    }
    Ok(Snapshot { format: BACKUP_FORMAT.into(), version: VERSION, taken_at: now(), tables, ui: ui.clone() })
}

/// Put the tables back exactly as the snapshot has them.
pub fn restore(db: &Db, snap: &Snapshot) -> Result<()> {
    if snap.format != BACKUP_FORMAT { return Err(Error::Invalid("That backup can't be read".into())); }
    let tx = db.conn.unchecked_transaction()?;
    for t in TABLES.iter().rev() { tx.execute(&format!("DELETE FROM {t}"), [])?; }
    for t in TABLES {
        for row in snap.tables.get(*t).into_iter().flatten() {
            if row.is_empty() { continue; }
            let cols: Vec<&String> = row.keys().collect();
            if cols.iter().any(|c| !c.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '_')) { continue; }
            let marks = (1..=cols.len()).map(|i| format!("?{i}")).collect::<Vec<_>>().join(", ");
            let names = cols.iter().map(|c| c.as_str()).collect::<Vec<_>>().join(", ");
            let vals: Vec<rusqlite::types::Value> = row.values().map(to_sql).collect();
            tx.execute(&format!("INSERT INTO {t} ({names}) VALUES ({marks})"), rusqlite::params_from_iter(vals))?;
        }
    }
    tx.commit()?;
    Ok(())
}

fn backup_dir(data_dir: &Path) -> PathBuf { data_dir.join("backups") }

/// Save a snapshot as `backups/settings-<time>.json` in the data folder; the last ten are kept.
pub fn save_backup(data_dir: &Path, snap: &Snapshot) -> Result<PathBuf> {
    let dir = backup_dir(data_dir);
    std::fs::create_dir_all(&dir)?;
    let stamp = chrono::Utc::now().format("%Y-%m-%d-%H%M%S%.3f").to_string();
    let path = dir.join(format!("settings-{stamp}.json"));
    std::fs::write(&path, serde_json::to_vec(snap)?)?;
    let mut old: Vec<PathBuf> = std::fs::read_dir(&dir).into_iter().flatten().flatten().map(|e| e.path())
        .filter(|p| p.file_name().is_some_and(|n| { let n = n.to_string_lossy(); n.starts_with("settings-") && n.ends_with(".json") })).collect();
    old.sort();
    while old.len() > 10 { let _ = std::fs::remove_file(old.remove(0)); }
    Ok(path)
}

/// Read a backup taken by `save_backup`. Only files in the data folder's backups are accepted.
pub fn load_backup(data_dir: &Path, path: &Path) -> Result<Snapshot> {
    let gone = || Error::Invalid("The backup from before the import is gone, so it can't be undone".into());
    let dir = backup_dir(data_dir).canonicalize().map_err(|_| gone())?;
    let p = path.canonicalize().map_err(|_| gone())?;
    if p.parent() != Some(dir.as_path()) { return Err(gone()); }
    Ok(serde_json::from_slice(&std::fs::read(&p)?)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::games::GamePaths;

    struct Tmp(PathBuf);
    impl Tmp {
        fn new(tag: &str) -> Self {
            let p = std::env::temp_dir().join(format!("gachamod-test-settings-{tag}-{}-{}", std::process::id(), library::new_id()));
            std::fs::create_dir_all(&p).unwrap();
            Tmp(p)
        }
    }
    impl Drop for Tmp { fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); } }

    fn s(p: &Path) -> String { p.to_string_lossy().into_owned() }

    /// A database with ZZZ set up in `root`, two mods and a second profile.
    fn setup(root: &Path) -> Db {
        let db = Db::memory().unwrap();
        let mods = root.join("ZZMI").join("Mods");
        for rel in ["Ellen Joe/Coca Cola", "Miyabi/DISABLED Kimono"] {
            let d = mods.join(rel);
            std::fs::create_dir_all(&d).unwrap();
            std::fs::write(d.join("mod.ini"), "[TextureOverrideBody]\nhash = 0011aabb\n").unwrap();
        }
        games::save_paths(&db, "zzz", &GamePaths { importer_dir: Some(s(&root.join("ZZMI"))), mods_dir: Some(s(&mods)), ..Default::default() }).unwrap();
        let shared = std::sync::Arc::new(std::sync::Mutex::new(db));
        library::scan(&shared, "zzz").unwrap();
        let db = std::sync::Arc::try_unwrap(shared).ok().unwrap().into_inner().unwrap();
        db.set_setting("ui.nsfw", "show").unwrap();
        db.set_setting("zzz.oneSkin", "0").unwrap();
        db.set_setting("zzz.profileVarsPending", "3").unwrap();
        db.set_setting("gb.apiToken", "hidden").unwrap();
        let p = crate::profiles::create(&db, "zzz", "Summer", None).unwrap();
        crate::profiles::update(&db, p.id, &crate::model::ProfilePatch { color: Some("#ff8800".into()), icon: Some("🌞".into()), ..Default::default() }).unwrap();
        db
    }

    #[test]
    fn export_has_settings_games_and_profiles_but_nothing_secret() {
        let t = Tmp::new("export");
        let db = setup(&t.0);
        let ui = BTreeMap::from([("gm.theme.zzz".to_string(), "default".to_string()), ("gm.scheme".to_string(), "light".to_string())]);
        let f = export(&db, true, &ui).unwrap();
        assert_eq!((f.format.as_str(), f.version), (FORMAT, VERSION));
        assert_eq!(f.settings.get("ui.nsfw").map(String::as_str), Some("show"));
        assert!(!f.settings.contains_key("gb.apiToken"));
        let z = f.games.iter().find(|g| g.id == "zzz").unwrap();
        assert_eq!(z.settings.get("oneSkin").map(String::as_str), Some("0"));
        assert!(!z.settings.contains_key("profileVarsPending"));
        assert_eq!(z.theme.as_deref(), Some("default"));
        assert_eq!(f.ui.get("gm.scheme").map(String::as_str), Some("light"));
        let profiles = f.profiles.as_ref().unwrap();
        let summer = profiles.iter().find(|p| p.name == "Summer").unwrap();
        assert_eq!(summer.color.as_deref(), Some("#ff8800"));
        assert!(summer.mods.iter().any(|m| m.folder == "Miyabi/Kimono" && !m.enabled));
        assert!(export(&db, false, &ui).unwrap().profiles.is_none());
        // the file reads back
        let path = t.0.join("out").join("settings.json");
        write_file(&path, &f).unwrap();
        assert_eq!(read_file(&path).unwrap().games, f.games);
    }

    #[test]
    fn rejects_other_files_and_newer_versions() {
        assert!(parse("{\"hello\":1}").is_err());
        assert!(parse("not json").is_err());
        let newer = serde_json::json!({ "format": FORMAT, "version": VERSION + 1 }).to_string();
        assert!(parse(&newer).unwrap_err().to_string().contains("newer"));
        assert!(parse(&serde_json::json!({ "format": FORMAT, "version": 1 }).to_string()).is_ok());
    }

    #[test]
    fn import_skips_missing_paths_matches_mods_and_undoes() {
        let t = Tmp::new("import");
        let src = setup(&t.0);
        let mut f = export(&src, true, &BTreeMap::new()).unwrap();
        // the file came from another PC: one folder that isn't here, one that is
        let other_game = t.0.join("ZZZ Game");
        std::fs::create_dir_all(&other_game).unwrap();
        let z = f.games.iter_mut().find(|g| g.id == "zzz").unwrap();
        z.game_dir = Some(s(&other_game));
        z.shown = Some(true);
        f.games.push(GameSetup { id: "gi".into(), importer_dir: Some("Q:\\Nowhere\\GIMI".into()), ..Default::default() });
        f.settings.insert("xxmi.root".into(), "Q:\\Nowhere\\XXMI".into());
        f.settings.insert("ui.nsfw".into(), "hide".into());
        // a mod renamed by id on this PC is still found by folder; an unknown one is counted
        let summer = f.profiles.as_mut().unwrap().iter_mut().find(|p| p.name == "Summer").unwrap();
        for m in &mut summer.mods { m.id = "0".repeat(32); }
        summer.mods.push(ProfileMod { id: "f".repeat(32), name: "Not here".into(), folder: "Nobody/Not here".into(), enabled: true, vars: vec![] });
        summer.mods[0].vars = vec![VarValue { ini: "mod.ini".into(), var: "swapvar".into(), value: "2".into() }];
        f.profiles.as_mut().unwrap().push(ProfileOut { game: "zzz".into(), name: "Winter".into(), ..Default::default() });

        let db = src; // same PC state, different file
        let before = snapshot(&db, &BTreeMap::from([("gm.scheme".into(), "dark".into())])).unwrap();
        let pv = preview(&db, &f).unwrap();
        assert_eq!(db.setting("ui.nsfw").unwrap().as_deref(), Some("show"), "a preview changes nothing");
        assert_eq!(pv.missing_mods, 1);
        assert!(pv.skipped_paths.iter().any(|p| p.contains("Q:\\Nowhere\\GIMI")));
        assert!(pv.skipped_paths.iter().any(|p| p.contains("Q:\\Nowhere\\XXMI")));
        assert_eq!(pv.new_profiles, vec!["Winter (ZZZ)".to_string()]);
        assert!(pv.replaced_profiles.iter().any(|p| p.starts_with("Summer")));

        let done = apply(&db, &f).unwrap();
        assert_eq!(done.skipped_paths, pv.skipped_paths);
        assert_eq!(db.setting("ui.nsfw").unwrap().as_deref(), Some("hide"));
        assert_eq!(db.setting("xxmi.root").unwrap(), None);
        assert_eq!(games::paths(&db, "zzz").unwrap().game_dir, Some(s(&other_game)));
        assert_eq!(games::paths(&db, "gi").unwrap().importer_dir, None);
        let ps = crate::profiles::list(&db, "zzz").unwrap();
        let summer = ps.iter().find(|p| p.name == "Summer").unwrap();
        let n: i64 = db.conn.query_row("SELECT COUNT(*) FROM profile_mods WHERE profile_id = ?1", [summer.id], |r| r.get(0)).unwrap();
        assert_eq!(n, 2);
        let v: i64 = db.conn.query_row("SELECT COUNT(*) FROM profile_vars WHERE profile_id = ?1", [summer.id], |r| r.get(0)).unwrap();
        assert_eq!(v, 1);
        assert!(ps.iter().any(|p| p.name == "Winter" && !p.active));

        // undo through a backup file puts every table back
        let data = t.0.join("data");
        let path = save_backup(&data, &before).unwrap();
        let back = load_backup(&data, &path).unwrap();
        assert_eq!(back.ui.get("gm.scheme").map(String::as_str), Some("dark"));
        restore(&db, &back).unwrap();
        assert_eq!(db.setting("ui.nsfw").unwrap().as_deref(), Some("show"));
        assert_eq!(games::paths(&db, "zzz").unwrap().game_dir, None);
        assert!(!crate::profiles::list(&db, "zzz").unwrap().iter().any(|p| p.name == "Winter"));
        assert_eq!(snapshot(&db, &before.ui).unwrap().tables, before.tables);
        // a file outside the backups folder is refused
        let stray = t.0.join("stray.json");
        std::fs::write(&stray, serde_json::to_vec(&before).unwrap()).unwrap();
        assert!(load_backup(&data, &stray).is_err());
    }
}
