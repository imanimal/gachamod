//! Profiles: named loadouts per game (which mods are on, plus each mod's saved variable values), with a name,
//! icon, colour, banner and description. Owner: LIBRARY area (docs/spec.md, "Profiles").
//!
//! The active profile follows the library live: toggling a mod updates the active profile's row (`on_change`).
//! Switching profile captures the outgoing profile's variable values from d3dx_user.ini (ini::user_vars), renames
//! folders to match the incoming one (library::set_enabled without the one-skin rule) and writes its values back
//! (ini::set_user_vars). Variable writes need the game closed; switching while it runs still renames folders and
//! reports `vars_pending`, and the values are written by the next scan after the game closes.
//!
//! A mod with no row in a profile keeps its current state on a switch when it was installed after the profile was
//! last updated (it is new to that profile); otherwise it is turned off. Removed mods keep their rows, so a restore
//! from the trash comes back in the same profiles.

use crate::db::{now, Db};
use crate::error::{Error, Result};
use crate::ini::{self, VarValue};
use crate::model::{ModChange, Profile, ProfilePatch};
use crate::{games, launch, library};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game TEXT NOT NULL,
    name TEXT NOT NULL,
    icon TEXT,
    color TEXT,
    banner TEXT,
    description TEXT,
    active INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (game, name)
);
CREATE TABLE IF NOT EXISTS profile_mods (
    profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    mod_id TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (profile_id, mod_id)
);
CREATE TABLE IF NOT EXISTS profile_vars (
    profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    mod_id TEXT NOT NULL,
    ini TEXT NOT NULL,
    var TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (profile_id, mod_id, ini, var)
);
";
pub fn migrate(db: &Db) -> Result<()> {
    // in-game hotkey per profile, like "Ctrl+Alt+1" (hotkeys.rs)
    if !db.has_column("profiles", "hotkey")? { db.conn.execute("ALTER TABLE profiles ADD COLUMN hotkey TEXT", [])?; }
    Ok(())
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchReport {
    pub profile: Profile,
    pub change: ModChange,
    /// Variable values were not written because the game is running; they are written when it closes.
    pub vars_pending: bool,
}

/// The setting that remembers a profile whose values still need writing (the game was running at the switch).
fn pending_key(game: &str) -> String { format!("{game}.profileVarsPending") }

const COLS: &str = "id, game, name, icon, color, banner, description, active, created_at, updated_at, hotkey";

fn read_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Profile> {
    Ok(Profile {
        id: r.get(0)?, game: r.get(1)?, name: r.get(2)?, icon: r.get(3)?, color: r.get(4)?, banner: r.get(5)?, description: r.get(6)?,
        active: r.get::<_, i64>(7)? != 0, mod_count: 0, created_at: r.get(8)?, updated_at: r.get(9)?, hotkey: r.get(10)?,
    })
}

fn with_count(db: &Db, mut p: Profile) -> Result<Profile> {
    p.mod_count = db.conn.query_row(
        "SELECT COUNT(*) FROM profile_mods pm JOIN mods m ON m.id = pm.mod_id WHERE pm.profile_id = ?1 AND pm.enabled = 1 AND m.game = ?2",
        params![p.id, p.game], |r| r.get::<_, i64>(0))?.max(0) as u32;
    Ok(p)
}

pub fn get(db: &Db, id: i64) -> Result<Profile> {
    let p = db.conn.query_row(&format!("SELECT {COLS} FROM profiles WHERE id = ?1"), [id], read_row).optional()?
        .ok_or_else(|| Error::Invalid("That profile isn't there anymore".into()))?;
    with_count(db, p)
}

fn active_id(db: &Db, game: &str) -> Result<Option<i64>> {
    Ok(db.conn.query_row("SELECT id FROM profiles WHERE game = ?1 AND active = 1 ORDER BY id LIMIT 1", [game], |r| r.get(0)).optional()?)
}

/// `name`, or "name (2)", "name (3)" ... when another profile of the game has it (any case).
fn free_name(db: &Db, game: &str, name: &str, except: Option<i64>) -> Result<String> {
    let base = name.trim();
    let base = if base.is_empty() { "Profile" } else { base };
    let taken = |n: &str| -> Result<bool> {
        Ok(db.conn.query_row("SELECT id FROM profiles WHERE game = ?1 AND lower(name) = lower(?2)", params![game, n], |r| r.get::<_, i64>(0))
            .optional()?.is_some_and(|id| Some(id) != except))
    };
    let mut cand = base.to_string();
    let mut n = 2;
    while taken(&cand)? { cand = format!("{base} ({n})"); n += 1; }
    Ok(cand)
}

fn insert(db: &Db, game: &str, name: &str, active: bool) -> Result<i64> {
    let t = now();
    db.conn.execute("INSERT INTO profiles (game, name, active, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)", params![game, name, active as i64, t])?;
    Ok(db.conn.last_insert_rowid())
}

/// Save every mod's state and the values of the mods that are on (and those kept for mods that are off) into a
/// profile. A mod whose values can't be read right now keeps the ones the profile had.
fn store_state(db: &Db, id: i64, game: &str) -> Result<()> {
    let mods = library::list(db, game)?;
    let tx = db.conn.unchecked_transaction()?;
    for m in &mods {
        tx.execute("INSERT INTO profile_mods (profile_id, mod_id, enabled) VALUES (?1, ?2, ?3)
                    ON CONFLICT(profile_id, mod_id) DO UPDATE SET enabled = excluded.enabled", params![id, m.id, m.enabled as i64])?;
        let vals = library::saved_vars(db, game, &m.id).unwrap_or_default();
        if vals.is_empty() { continue; }
        tx.execute("DELETE FROM profile_vars WHERE profile_id = ?1 AND mod_id = ?2", params![id, m.id])?;
        for v in vals {
            tx.execute("INSERT OR REPLACE INTO profile_vars (profile_id, mod_id, ini, var, value) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![id, m.id, v.ini, v.var, v.value])?;
        }
    }
    tx.execute("UPDATE profiles SET updated_at = ?1 WHERE id = ?2", params![now(), id])?;
    tx.commit()?;
    Ok(())
}

/// The game's profiles. Creates "Default" (active, holding what is on now) when the game has none.
pub fn list(db: &Db, game: &str) -> Result<Vec<Profile>> {
    let none = db.conn.query_row("SELECT COUNT(*) FROM profiles WHERE game = ?1", [game], |r| r.get::<_, i64>(0))? == 0;
    if none {
        let id = insert(db, game, "Default", true)?;
        store_state(db, id, game)?;
    } else if active_id(db, game)?.is_none() {
        // never leave a game without an active profile
        db.conn.execute("UPDATE profiles SET active = 1 WHERE id = (SELECT MIN(id) FROM profiles WHERE game = ?1)", [game])?;
    }
    let ps = {
        let mut st = db.conn.prepare(&format!("SELECT {COLS} FROM profiles WHERE game = ?1 ORDER BY created_at, id"))?;
        let v = st.query_map([game], read_row)?.collect::<std::result::Result<Vec<_>, _>>()?;
        v
    };
    ps.into_iter().map(|p| with_count(db, p)).collect()
}

/// A new profile. `copy_from`: another profile's id to copy, or None to start from what is on now.
pub fn create(db: &Db, game: &str, name: &str, copy_from: Option<i64>) -> Result<Profile> {
    games::require_def(game)?;
    // make sure the game has its Default first, so the new one is never the only one
    list(db, game)?;
    let name = free_name(db, game, name, None)?;
    let id = insert(db, game, &name, false)?;
    match copy_from {
        Some(src) => {
            let s = get(db, src)?;
            let tx = db.conn.unchecked_transaction()?;
            tx.execute("UPDATE profiles SET icon = ?1, color = ?2, banner = ?3, description = ?4, updated_at = ?5 WHERE id = ?6",
                params![s.icon, s.color, s.banner, s.description, s.updated_at, id])?;
            tx.execute("INSERT INTO profile_mods (profile_id, mod_id, enabled) SELECT ?1, mod_id, enabled FROM profile_mods WHERE profile_id = ?2", params![id, src])?;
            tx.execute("INSERT INTO profile_vars (profile_id, mod_id, ini, var, value) SELECT ?1, mod_id, ini, var, value FROM profile_vars WHERE profile_id = ?2", params![id, src])?;
            tx.commit()?;
        }
        None => store_state(db, id, game)?,
    }
    get(db, id)
}

pub fn update(db: &Db, id: i64, patch: &ProfilePatch) -> Result<Profile> {
    let p = get(db, id)?;
    // a bad combo fails before anything is saved
    if let Some(h) = patch.hotkey.as_deref().map(str::trim).filter(|h| !h.is_empty()) { crate::hotkeys::normalize(h)?; }
    let text =|s: &Option<String>, old: &Option<String>| match s {
        Some(v) => { let t = v.trim(); (!t.is_empty()).then(|| t.to_string()) }
        None => old.clone(),
    };
    let name = match &patch.name {
        Some(n) if !n.trim().is_empty() => free_name(db, &p.game, n, Some(id))?,
        _ => p.name.clone(),
    };
    db.conn.execute("UPDATE profiles SET name = ?1, icon = ?2, color = ?3, banner = ?4, description = ?5 WHERE id = ?6", params![
        name, text(&patch.icon, &p.icon), text(&patch.color, &p.color), text(&patch.banner, &p.banner), text(&patch.description, &p.description), id,
    ])?;
    if let Some(h) = &patch.hotkey { crate::hotkeys::set_for_profile(db, id, Some(h))?; }
    get(db, id)
}

/// Delete a profile. Deleting the active one makes the next one active without changing any mods; the last
/// profile of a game can't be deleted.
pub fn delete(db: &Db, id: i64) -> Result<()> {
    let p = get(db, id)?;
    let ids: Vec<i64> = {
        let mut st = db.conn.prepare("SELECT id FROM profiles WHERE game = ?1 ORDER BY created_at, id")?;
        let v = st.query_map([&p.game], |r| r.get(0))?.collect::<std::result::Result<Vec<_>, _>>()?;
        v
    };
    if ids.len() <= 1 { return Err(Error::Conflict("This is the only profile. Make another one first, then delete this one".into())); }
    let tx = db.conn.unchecked_transaction()?;
    if p.active {
        let at = ids.iter().position(|&x| x == id).unwrap_or(0);
        let next = ids.get(at + 1).or_else(|| at.checked_sub(1).and_then(|i| ids.get(i))).copied();
        if let Some(n) = next { tx.execute("UPDATE profiles SET active = 1 WHERE id = ?1", [n])?; }
    }
    tx.execute("DELETE FROM profile_vars WHERE profile_id = ?1", [id])?;
    tx.execute("DELETE FROM profile_mods WHERE profile_id = ?1", [id])?;
    tx.execute("DELETE FROM profiles WHERE id = ?1", [id])?;
    tx.commit()?;
    if db.setting(&pending_key(&p.game))?.as_deref() == Some(id.to_string().as_str()) { db.clear_setting(&pending_key(&p.game))?; }
    Ok(())
}

fn profile_vars(db: &Db, id: i64) -> Result<HashMap<String, Vec<VarValue>>> {
    let mut st = db.conn.prepare("SELECT mod_id, ini, var, value FROM profile_vars WHERE profile_id = ?1 ORDER BY mod_id, ini, var")?;
    let rows = st.query_map([id], |r| Ok((r.get::<_, String>(0)?, VarValue { ini: r.get(1)?, var: r.get(2)?, value: r.get(3)? })))?;
    let mut out: HashMap<String, Vec<VarValue>> = HashMap::new();
    for r in rows { let (m, v) = r?; out.entry(m).or_default().push(v); }
    Ok(out)
}

/// Write a profile's values: into d3dx_user.ini for mods that are on, into the library's kept values for mods that
/// are off (they come back when the mod is turned on). Call only while the game is closed.
fn write_vars(db: &Db, id: i64, game: &str) -> Result<()> {
    let vars = profile_vars(db, id)?;
    if vars.is_empty() { return Ok(()); }
    let importer = games::importer_dir(db, game).ok();
    for (mod_id, vals) in vars {
        let Ok(m) = library::get(db, game, &mod_id) else { continue };
        if m.enabled {
            if let Some(imp) = &importer { let _ = ini::set_user_vars(imp, &m.rel_path, &vals); }
        } else {
            let _ = library::stash_vars(db, game, &mod_id, &vals);
        }
    }
    Ok(())
}

pub fn activate(db: &Db, id: i64) -> Result<SwitchReport> {
    let p = get(db, id)?;
    let game = p.game.clone();
    let running = launch::running(&game);

    // the outgoing profile keeps what is on now and the values as they are now
    if let Some(out) = active_id(db, &game)?.filter(|&o| o != id) { store_state(db, out, &game)?; }
    db.conn.execute("UPDATE profiles SET active = (id = ?1) WHERE game = ?2", params![id, game])?;

    let rows: HashMap<String, bool> = {
        let mut st = db.conn.prepare("SELECT mod_id, enabled FROM profile_mods WHERE profile_id = ?1")?;
        let v = st.query_map([id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? != 0)))?.collect::<std::result::Result<HashMap<_, _>, _>>()?;
        v
    };
    let mut offs = Vec::new();
    let mut ons = Vec::new();
    for m in library::list(db, &game)? {
        if library::is_imm_rel(&m.rel_path) { continue; }
        let want = rows.get(&m.id).copied().unwrap_or(m.installed_at > p.updated_at && m.enabled);
        if want != m.enabled { if want { ons.push((m.id, true)); } else { offs.push((m.id, false)); } }
    }
    offs.extend(ons);
    let change = if offs.is_empty() { ModChange::default() } else { library::apply_states(db, &game, &offs)? };

    let has_vars = db.conn.query_row("SELECT 1 FROM profile_vars WHERE profile_id = ?1 LIMIT 1", [id], |_| Ok(())).optional()?.is_some();
    let vars_pending = has_vars && running;
    if vars_pending {
        db.set_setting(&pending_key(&game), &id.to_string())?;
    } else {
        db.clear_setting(&pending_key(&game))?;
        write_vars(db, id, &game)?;
    }
    Ok(SwitchReport { profile: get(db, id)?, change, vars_pending })
}

/// Save what is on now and the current variable values into a profile.
pub fn capture(db: &Db, id: i64) -> Result<Profile> {
    let p = get(db, id)?;
    store_state(db, id, &p.game)?;
    get(db, id)
}

/// Keep the active profile in step with a library change. Called by library after every change.
pub fn on_change(db: &Db, game: &str, change: &ModChange) -> Result<()> {
    let Some(id) = active_id(db, game)? else { return Ok(()) };
    if change.changed.is_empty() { return Ok(()); }
    let tx = db.conn.unchecked_transaction()?;
    for m in &change.changed {
        tx.execute("INSERT INTO profile_mods (profile_id, mod_id, enabled) VALUES (?1, ?2, ?3)
                    ON CONFLICT(profile_id, mod_id) DO UPDATE SET enabled = excluded.enabled", params![id, m.id, m.enabled as i64])?;
    }
    tx.execute("UPDATE profiles SET updated_at = ?1 WHERE id = ?2", params![now(), id])?;
    tx.commit()?;
    Ok(())
}

/// Write the values a switch left waiting while the game ran. The scan calls it when the game is closed.
pub fn flush_pending(db: &Db, game: &str) -> Result<()> {
    let Some(v) = db.setting(&pending_key(game))? else { return Ok(()) };
    if launch::running(game) { return Ok(()); }
    db.clear_setting(&pending_key(game))?;
    let Ok(id) = v.parse::<i64>() else { return Ok(()) };
    if get(db, id).is_ok_and(|p| p.active) { write_vars(db, id, game)?; }
    Ok(())
}

/// Mod ids a profile turns on (for exports).
pub fn members(db: &Db, id: i64) -> Result<Vec<String>> {
    let p = get(db, id)?;
    let mut st = db.conn.prepare(
        "SELECT pm.mod_id FROM profile_mods pm JOIN mods m ON m.id = pm.mod_id WHERE pm.profile_id = ?1 AND pm.enabled = 1 AND m.game = ?2 ORDER BY m.rel_path")?;
    let v = st.query_map(params![id, p.game], |r| r.get::<_, String>(0))?.collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(v)
}
