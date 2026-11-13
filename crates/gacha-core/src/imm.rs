//! Bringing mods over from Integrated Mod Manager (IMM). Owner: MODTOOLS area (docs/spec.md, "Moving from IMM").
//!
//! IMM keeps its settings in %LOCALAPPDATA%\Integrated Mod Manager (IMM)\config*.json (one per game: configZZ.json,
//! configEF.json ...; config.json holds the XXMI path) and its mods inside the importer's Mods folder, in
//! "DISABLED - ALL MODS ARE STORED HERE (Managed by IMM)" and "DO NOT MODIFY (Managed by IMM)". Each config's
//! `data` maps "<Character>\\<mod>" to `{ source: GameBanana URL, vars }`.
//!
//! Detection only reads. The move builds its whole plan first and refuses before touching anything when a target
//! folder exists. IMM's enabled mods are links (symlinks or junctions) to the store: only the links themselves are
//! removed, never what they point to.

use crate::db::Db;
use crate::error::{Error, Result};
use crate::library;
use crate::model::{ModSource, Sidecar, DISABLED_PREFIX};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImmGame { pub game: String, pub config: String, pub mods: u32, pub enabled: u32, pub with_source: u32 }

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImmInfo { pub found: bool, pub dir: Option<String>, pub games: Vec<ImmGame> }

/// IMM's folder of every mod (3DMigoto skips it: its name starts with DISABLED).
pub const STORE: &str = "DISABLED - ALL MODS ARE STORED HERE (Managed by IMM)";
/// IMM's folder of links to the enabled mods.
pub const LINKS: &str = "DO NOT MODIFY (Managed by IMM)";
pub const PROCESS: &str = "integrated-mod-manager.exe";

/// IMM's game codes and ours.
const CODES: &[(&str, &str)] = &[("WW", "ww"), ("ZZ", "zzz"), ("GI", "gi"), ("SR", "hsr"), ("EF", "ef")];

fn imm_dir() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|d| PathBuf::from(d).join("Integrated Mod Manager (IMM)"))
}

/// `config<CODE>.json` in IMM's folder, any case.
fn config_path(dir: &Path, code: &str) -> Option<PathBuf> {
    let want = format!("config{code}.json").to_ascii_lowercase();
    fs::read_dir(dir).ok()?.flatten().find(|e| e.file_name().to_string_lossy().to_ascii_lowercase() == want).map(|e| e.path())
}

/// A link (symlink or junction), not followed.
fn is_link(p: &Path) -> bool { fs::symlink_metadata(p).map(|m| m.file_type().is_symlink()).unwrap_or(false) }

fn is_real_dir(p: &Path) -> bool { fs::symlink_metadata(p).map(|m| m.is_dir() && !m.file_type().is_symlink()).unwrap_or(false) }

/// A folder that directly holds an .ini or a sidecar is a mod.
fn looks_like_mod(dir: &Path) -> bool {
    fs::read_dir(dir).into_iter().flatten().flatten().any(|e| {
        let n = e.file_name().to_string_lossy().to_ascii_lowercase();
        n == crate::model::SIDECAR_FILE || (n.ends_with(".ini") && n != "desktop.ini" && !library::is_disabled_name(&n))
    })
}

fn children(dir: &Path) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = fs::read_dir(dir).into_iter().flatten().flatten().map(|e| e.path()).collect();
    v.sort();
    v
}

fn name_of(p: &Path) -> String { p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default() }

/// Mods in IMM's store: ("Character/mod" or "mod", folder).
fn store_mods(store: &Path) -> Vec<(String, PathBuf)> {
    let mut out = Vec::new();
    for c in children(store).into_iter().filter(|c| is_real_dir(c)) {
        if looks_like_mod(&c) { out.push((name_of(&c), c)); continue; }
        for g in children(&c).into_iter().filter(|g| is_real_dir(g)) {
            out.push((format!("{}/{}", name_of(&c), name_of(&g)), g));
        }
    }
    out
}

/// IMM's links folder: the keys of linked (enabled) mods, the links themselves, and real folders someone put there.
struct Links { enabled: HashSet<String>, links: Vec<PathBuf>, real: Vec<(String, PathBuf)> }

fn read_links(dir: &Path) -> Links {
    let mut l = Links { enabled: HashSet::new(), links: Vec::new(), real: Vec::new() };
    for c in children(dir) {
        if is_link(&c) { l.enabled.insert(name_of(&c).to_lowercase()); l.links.push(c); continue; }
        if !is_real_dir(&c) { continue; }
        if looks_like_mod(&c) { l.real.push((name_of(&c), c)); continue; }
        for g in children(&c) {
            let key = format!("{}/{}", name_of(&c), name_of(&g));
            if is_link(&g) { l.enabled.insert(key.to_lowercase()); l.links.push(g); } else if is_real_dir(&g) { l.real.push((key, g)); }
        }
    }
    l
}

/// IMM's `data` map: lowercased "character/mod" -> GameBanana URL.
fn read_sources(config: Option<&Path>) -> HashMap<String, String> {
    let Some(text) = config.and_then(|p| fs::read(p).ok()).map(|b| crate::ini::decode(&b)) else { return HashMap::new() };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(text.trim_start_matches('\u{feff}')) else { return HashMap::new() };
    let Some(data) = v.get("data").and_then(|d| d.as_object()) else { return HashMap::new() };
    data.iter().filter_map(|(k, val)| {
        let src = val.get("source").and_then(|s| s.as_str()).filter(|s| !s.trim().is_empty())?;
        Some((k.replace('\\', "/").trim_matches('/').to_lowercase(), src.trim().to_string()))
    }).collect()
}

/// "https://gamebanana.com/mods/676139" -> the mod id.
fn gb_mod_id(url: &str) -> Option<u64> {
    let lower = url.to_ascii_lowercase();
    let at = lower.find("gamebanana.com/mods/")? + "gamebanana.com/mods/".len();
    let digits: String = lower[at..].chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse().ok().filter(|&n| n > 0)
}

fn count(mods_dir: &Path, sources: &HashMap<String, String>) -> (u32, u32, u32) {
    let store = store_mods(&mods_dir.join(STORE));
    let links = read_links(&mods_dir.join(LINKS));
    let with_source = store.iter().filter(|(k, _)| sources.contains_key(&k.to_lowercase())).count();
    ((store.len() + links.real.len()) as u32, (links.enabled.len() + links.real.len()) as u32, with_source as u32)
}

pub fn detect(db: &Db) -> Result<ImmInfo> { Ok(detect_in(db, imm_dir().as_deref())) }

fn detect_in(db: &Db, dir: Option<&Path>) -> ImmInfo {
    let dir = dir.filter(|d| d.is_dir());
    let mut info = ImmInfo { found: dir.is_some(), dir: dir.map(|d| d.to_string_lossy().into_owned()), games: Vec::new() };
    for (code, game) in CODES {
        let config = dir.and_then(|d| config_path(d, code));
        let Some(mods_dir) = crate::games::paths(db, game).ok().and_then(|p| p.mods_dir).map(PathBuf::from) else { continue };
        if !mods_dir.join(STORE).is_dir() && !mods_dir.join(LINKS).is_dir() { continue; }
        let (mods, enabled, with_source) = count(&mods_dir, &read_sources(config.as_deref()));
        if mods == 0 && enabled == 0 { continue; }
        info.found = true;
        info.games.push(ImmGame { game: game.to_string(), config: config.map(|c| c.to_string_lossy().into_owned()).unwrap_or_default(), mods, enabled, with_source });
    }
    info
}

/// One folder to move.
struct Step { from: PathBuf, to: PathBuf, to_rel: String, link_rel: Option<String>, character: Option<String>, name: String, source: Option<String> }

/// Remove a link itself, never what it points to.
fn remove_link(p: &Path) -> std::io::Result<()> {
    // a junction or directory symlink goes with remove_dir; a file symlink with remove_file
    fs::remove_dir(p).or_else(|_| fs::remove_file(p))
}

/// Remove empty folders from the bottom up (never following links).
fn prune_empty(dir: &Path) {
    if !is_real_dir(dir) { return; }
    for c in children(dir) { if is_real_dir(&c) { prune_empty(&c); } }
    let _ = fs::remove_dir(dir);
}

fn plan(mods_dir: &Path, sources: &HashMap<String, String>) -> Result<(Vec<Step>, Links)> {
    let links = read_links(&mods_dir.join(LINKS));
    let mut steps = Vec::new();
    let mut add = |key: &str, from: PathBuf, enabled: bool, linked: bool| {
        let parts: Vec<&str> = key.split('/').collect();
        let (character, raw) = if parts.len() == 2 { (Some(parts[0].to_string()), parts[1]) } else { (None, parts[0]) };
        let name = library::display_folder(raw).to_string();
        let name = if name.is_empty() { raw.to_string() } else { name };
        let folder = if enabled { name.clone() } else { format!("{DISABLED_PREFIX}{name}") };
        let to_rel = match &character { Some(c) => format!("{c}/{folder}"), None => folder.clone() };
        steps.push(Step {
            to: mods_dir.join(&to_rel), from, to_rel,
            link_rel: (enabled && linked).then(|| format!("{LINKS}/{key}")),
            character, name, source: sources.get(&key.to_lowercase()).cloned(),
        });
    };
    for (key, from) in store_mods(&mods_dir.join(STORE)) {
        let on = links.enabled.contains(&key.to_lowercase());
        add(&key, from, on, on);
    }
    for (key, from) in &links.real { add(key, from.clone(), true, true); }
    // refuse before touching anything when a target is taken
    let mut seen = HashSet::new();
    let mut taken: Vec<String> = Vec::new();
    for s in &steps {
        if s.to.exists() || !seen.insert(s.to_rel.to_lowercase()) { taken.push(s.to_rel.clone()); }
    }
    if !taken.is_empty() {
        let shown = taken.iter().take(5).cloned().collect::<Vec<_>>().join(", ");
        let more = if taken.len() > 5 { format!(" and {} more", taken.len() - 5) } else { String::new() };
        return Err(Error::Conflict(format!("These folders are already in Mods: {shown}{more}. Rename or move them, then try again")));
    }
    Ok((steps, links))
}

/// Move everything out of IMM's folders. Returns the moved mods' ids and notes.
fn move_out(mods_dir: &Path, importer_dir: Option<&Path>, sources: &HashMap<String, String>) -> Result<(Vec<String>, Vec<String>)> {
    let (steps, links) = plan(mods_dir, sources)?;
    let mut notes = Vec::new();
    let mut ids = Vec::new();
    if steps.is_empty() { return Ok((ids, vec!["IMM has no mods for this game".into()])); }
    // the links first, so nothing points at folders that are about to move
    for l in &links.links {
        if let Err(e) = remove_link(l) { notes.push(format!("Couldn't remove IMM's link {}: {}", name_of(l), crate::error::io_text(&e))); }
    }
    for s in &steps {
        if let Some(parent) = s.to.parent() { fs::create_dir_all(parent)?; }
        if let Err(e) = crate::pack::move_dir(&s.from, &s.to) { notes.push(format!("Couldn't move {}: {e}", s.name)); continue; }
        if let (Some(imp), Some(from_rel)) = (importer_dir, &s.link_rel) {
            if let Err(e) = crate::ini::move_user_vars(imp, from_rel, &s.to_rel) { notes.push(format!("Couldn't keep {}'s options: {e}", s.name)); }
        }
        let mut sc = library::read_sidecar(&s.to).unwrap_or_else(|| Sidecar { format: 1, id: library::new_id(), installed_at: crate::db::now(), ..Default::default() });
        if sc.id.is_empty() { sc.id = library::new_id(); }
        if sc.name.is_empty() { sc.name = s.name.clone(); }
        if sc.character.is_none() { sc.character = s.character.clone(); }
        if sc.source.is_none() {
            if let Some(id) = s.source.as_deref().and_then(gb_mod_id) {
                sc.source = Some(ModSource { site: "gamebanana".into(), mod_id: id, url: format!("https://gamebanana.com/mods/{id}"), ..Default::default() });
            }
        }
        match library::write_sidecar(&s.to, &sc) {
            Ok(()) => ids.push(sc.id),
            Err(e) => notes.push(format!("Moved {}, but couldn't write its details: {e}", s.name)),
        }
    }
    prune_empty(&mods_dir.join(STORE));
    prune_empty(&mods_dir.join(LINKS));
    Ok((ids, notes))
}

/// Move one game's IMM mods into gachamod's layout (`Mods/<Character>/<mod>`, DISABLED prefix when off), keep their
/// saved variable values (rewriting d3dx_user.ini keys to the new paths), write sidecars with the GameBanana source
/// IMM recorded, and rescan. IMM must be closed.
pub fn takeover(db: &crate::db::Shared, game: &str) -> Result<crate::pack::ImportResult> {
    if crate::launch::process_running(PROCESS) {
        return Err(Error::Conflict("Close Integrated Mod Manager first. It would put its folders back while the mods move".into()));
    }
    if crate::launch::running(game) {
        return Err(Error::Conflict("Close the game first. Mods can't move while it has them open".into()));
    }
    let code = CODES.iter().find(|(_, g)| *g == game).map(|(c, _)| *c)
        .ok_or_else(|| Error::Invalid("Integrated Mod Manager doesn't manage this game".into()))?;
    let (mods_dir, importer_dir) = {
        let db = db.lock().unwrap_or_else(|e| e.into_inner());
        (crate::games::mods_dir(&db, game)?, crate::games::importer_dir(&db, game).ok())
    };
    let config = imm_dir().and_then(|d| config_path(&d, code));
    let sources = read_sources(config.as_deref());
    let (ids, mut notes) = move_out(&mods_dir, importer_dir.as_deref(), &sources)?;
    match library::scan(db, game) {
        Ok(_) | Err(Error::Todo(_)) => {}
        Err(e) => notes.push(format!("The mods moved, but the rescan failed: {e}")),
    }
    if !ids.is_empty() {
        notes.insert(0, format!("Moved {} {} from Integrated Mod Manager", ids.len(), if ids.len() == 1 { "mod" } else { "mods" }));
        crate::devtools::mark_changed(game);
    }
    Ok(crate::pack::ImportResult { added: ids, notes, ..Default::default() })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("gachamod-imm-{name}-{}", library::new_id()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn mod_at(dir: &Path) {
        fs::create_dir_all(dir).unwrap();
        fs::write(dir.join("mod.ini"), "[TextureOverrideA]\nhash = 12345678\n").unwrap();
    }

    /// A directory link: a symlink when Windows allows it, else a junction.
    fn link_dir(target: &Path, link: &Path) -> bool {
        #[cfg(windows)]
        {
            if std::os::windows::fs::symlink_dir(target, link).is_ok() { return true; }
            std::process::Command::new("cmd").args(["/C", "mklink", "/J"]).arg(link).arg(target)
                .stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status().is_ok_and(|s| s.success())
        }
        #[cfg(not(windows))]
        { std::os::unix::fs::symlink(target, link).is_ok() }
    }

    #[test]
    fn moves_mods_out_of_imm() {
        let imp = temp("move");
        let mods = imp.join("Mods");
        let store = mods.join(STORE);
        mod_at(&store.join("Ellen Joe/Coca Cola"));
        mod_at(&store.join("Ellen Joe/Bunny"));
        mod_at(&store.join("Loose"));
        fs::create_dir_all(mods.join(LINKS).join("Ellen Joe")).unwrap();
        let linked = link_dir(&store.join("Ellen Joe/Coca Cola"), &mods.join(LINKS).join("Ellen Joe/Coca Cola"));
        fs::write(imp.join("d3dx_user.ini"), format!("[Constants]\r\n$\\mods\\{}\\ellen joe\\coca cola\\mod.ini\\swapvar = 2\r\n", LINKS.to_lowercase())).unwrap();
        let mut sources = HashMap::new();
        sources.insert("ellen joe/coca cola".to_string(), "https://gamebanana.com/mods/676139".to_string());

        let (ids, notes) = move_out(&mods, Some(&imp), &sources).unwrap();
        assert_eq!(ids.len(), 3, "{notes:?}");
        if linked {
            assert!(mods.join("Ellen Joe/Coca Cola/mod.ini").is_file(), "{notes:?}");
            let sc = library::read_sidecar(&mods.join("Ellen Joe/Coca Cola")).unwrap();
            assert_eq!(sc.source.unwrap().mod_id, 676139);
            assert_eq!(sc.character.as_deref(), Some("Ellen Joe"));
            assert_eq!(crate::ini::user_vars(&imp, "Ellen Joe/Coca Cola").unwrap()[0].value, "2");
            assert!(!mods.join(LINKS).exists());
        }
        assert!(mods.join("Ellen Joe/DISABLED Bunny/mod.ini").is_file());
        assert!(mods.join("DISABLED Loose/mod.ini").is_file());
        assert!(!store.exists());
        fs::remove_dir_all(&imp).unwrap();
    }

    #[test]
    fn refuses_when_a_target_exists() {
        let imp = temp("clash");
        let mods = imp.join("Mods");
        mod_at(&mods.join(STORE).join("Ellen Joe/Bunny"));
        mod_at(&mods.join("Ellen Joe/DISABLED Bunny"));
        let err = move_out(&mods, None, &HashMap::new()).err().unwrap();
        assert!(matches!(&err, Error::Conflict(m) if m.contains("Ellen Joe/DISABLED Bunny")), "{err}");
        // nothing moved
        assert!(mods.join(STORE).join("Ellen Joe/Bunny/mod.ini").is_file());
        fs::remove_dir_all(&imp).unwrap();
    }

    #[test]
    fn detects_counts() {
        let imp = temp("detect");
        let mods = imp.join("Mods");
        mod_at(&mods.join(STORE).join("Miyabi/Snow"));
        let cfg = imp.join("imm");
        fs::create_dir_all(&cfg).unwrap();
        fs::write(cfg.join("configZZ.json"), r#"{"data":{"Miyabi\\Snow":{"source":"https://gamebanana.com/mods/5"}}}"#).unwrap();
        let db = Db::memory().unwrap();
        crate::games::save_paths(&db, "zzz", &crate::games::GamePaths { mods_dir: Some(mods.to_string_lossy().into()), ..Default::default() }).unwrap();
        let info = detect_in(&db, Some(&cfg));
        assert!(info.found);
        assert_eq!(info.games.len(), 1);
        assert_eq!((info.games[0].mods, info.games[0].enabled, info.games[0].with_source), (1, 0, 1));
        assert!(!detect_in(&Db::memory().unwrap(), Some(&imp.join("missing"))).found);
        fs::remove_dir_all(&imp).unwrap();
    }

    #[test]
    fn reads_gamebanana_ids() {
        assert_eq!(gb_mod_id("https://gamebanana.com/mods/676139"), Some(676139));
        assert_eq!(gb_mod_id("https://GameBanana.com/mods/12?x=1"), Some(12));
        assert_eq!(gb_mod_id("https://example.com"), None);
    }
}
