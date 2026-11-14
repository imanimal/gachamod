//! What other mod managers leave in a Mods folder, read so their mods come in with their names, characters,
//! GameBanana links, pictures and on/off state. Owner: LIBRARY area (docs/spec.md, "Finding mods").
//!
//! Files read, per mod folder:
//! - JASM and JASM+: `.JASM_ModConfig.json` (CustomName, Author, Version, ModUrl, ImagePath, Description) and the
//!   picture `.JASM_Cover.<ext>`. Mods sit in `Mods/<category>/<character>/<mod>` with lowercase character folders.
//! - XX Mod Manager: `mod.json` (modName, author, character, url, tags, description, preview).
//! - FlairX Mod Manager: `mod.json` (author, url, version, isNSFW; the folder name is the name).
//! - EMMM: `info.json` (actual_name, author, version, tags, description, is_favorite) and `preview_custom.<ext>`.
//! - Fairy's Secret Folder: `.zmm-meta.json` (gb_mod_id, source_url, author, notes, tags) and, in the
//!   `<Character> - <Skin>` folder above, `category.json` (character_id like "jane_doe").
//! - No Reload Mod Manager: `modname` (a text file with the name), `fav`, and the group folder's `groupname`.
//! - WZMM: `modmeta.json` (character, author, previewUrl). GIMM: `GIMM.json(c)` (character, name, author, version).
//! IMM is imm.rs. Every manager above turns a mod off with a DISABLED prefix (any case and separator), which
//! library reads; inis renamed to "DISABLED_x.ini" or "x.ini.disabled" are read there too.
//!
//! Detection only reads. The import writes nothing but gachamod's own `.gachamod.json` files and returns the old
//! ones so Undo can put them back. The other manager's files are never changed.

use crate::aliases::Matcher;
use crate::db::Shared;
use crate::error::{Error, Result};
use crate::library;
use crate::model::{ModSource, Sidecar};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

/// What another manager knew about one mod.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Foreign {
    /// The managers whose files were found ("JASM", "FlairX" ...).
    pub managers: Vec<&'static str>,
    pub name: Option<String>,
    pub author: Option<String>,
    /// The mod's page (a GameBanana link, or any other site).
    pub url: Option<String>,
    pub gb_mod_id: Option<u64>,
    pub version: Option<String>,
    /// Text naming the character ("Raiden Shogun", "jane_doe"), matched against the roster.
    pub character: Option<String>,
    /// A picture: a file name inside the mod folder, or an https link.
    pub preview: Option<String>,
    pub tags: Vec<String>,
    pub notes: Option<String>,
    pub nsfw: bool,
    pub favorite: bool,
    pub installed_at: Option<i64>,
}

const MAX_JSON: u64 = 2 * 1024 * 1024;

fn read_json(p: &Path) -> Option<Value> {
    if fs::metadata(p).ok()?.len() > MAX_JSON { return None; }
    let text = crate::ini::decode(&fs::read(p).ok()?);
    let text = text.trim_start_matches('\u{feff}');
    serde_json::from_str(text).ok().or_else(|| {
        // JSON with comments (GIMM.jsonc): drop whole-line // comments and try again
        let clean: String = text.lines().filter(|l| !l.trim_start().starts_with("//")).collect::<Vec<_>>().join("\n");
        serde_json::from_str(&clean).ok()
    })
}

fn read_text(p: &Path) -> Option<String> {
    if fs::metadata(p).ok()?.len() > 4096 { return None; }
    let t = crate::ini::decode(&fs::read(p).ok()?);
    let t = t.trim_start_matches('\u{feff}').trim().to_string();
    (!t.is_empty() && !t.contains('\n')).then_some(t)
}

/// The first of `keys` (any case) that holds a non-empty string or a number.
fn field(v: &Value, keys: &[&str]) -> Option<String> {
    let o = v.as_object()?;
    for k in keys {
        let Some((_, x)) = o.iter().find(|(name, _)| name.eq_ignore_ascii_case(k)) else { continue };
        let s = match x {
            Value::String(s) => s.trim().to_string(),
            Value::Number(n) => n.to_string(),
            _ => continue,
        };
        if !s.is_empty() && s != "0000-00-00" { return Some(s); }
    }
    None
}

fn flag(v: &Value, keys: &[&str]) -> bool {
    let Some(o) = v.as_object() else { return false };
    keys.iter().any(|k| o.iter().any(|(n, x)| n.eq_ignore_ascii_case(k) && (x.as_bool() == Some(true) || x.as_str().is_some_and(|s| s.eq_ignore_ascii_case("true")))))
}

fn list(v: &Value, key: &str) -> Vec<String> {
    let Some(o) = v.as_object() else { return Vec::new() };
    let Some((_, x)) = o.iter().find(|(n, _)| n.eq_ignore_ascii_case(key)) else { return Vec::new() };
    match x {
        Value::Array(a) => a.iter().filter_map(|t| t.as_str()).map(|t| t.trim().to_string()).filter(|t| !t.is_empty()).take(30).collect(),
        Value::String(s) => s.split(',').map(|t| t.trim().to_string()).filter(|t| !t.is_empty()).take(30).collect(),
        _ => Vec::new(),
    }
}

/// The GameBanana mod id in a link: gamebanana.com/mods/123, /mods/download/123, or a 1-click link ending
/// ",Mod,123". Links to a single file (/dl/456) don't name the mod.
pub fn gb_mod_id(url: &str) -> Option<u64> {
    let l = url.trim().to_ascii_lowercase();
    if !l.contains("gamebanana.com") { return None; }
    let digits = |s: &str| -> Option<u64> { s.chars().take_while(|c| c.is_ascii_digit()).collect::<String>().parse().ok().filter(|&n| n > 0) };
    if let Some(i) = l.find(",mod,") { return digits(&l[i + 5..]); }
    let i = l.find("gamebanana.com/mods/")? + "gamebanana.com/mods/".len();
    let rest = &l[i..];
    digits(rest.strip_prefix("download/").unwrap_or(rest))
}

/// A picture another manager saves for a mod: `.JASM_Cover.png`, `preview_custom.png`, `preview001.jpg`,
/// `cover.jpg`, `预览.png`.
pub fn is_cover_name(name: &str) -> bool {
    let l = name.to_lowercase();
    let Some((stem, ext)) = l.rsplit_once('.') else { return false };
    if !["png", "jpg", "jpeg", "webp", "gif"].contains(&ext) { return false; }
    matches!(stem, ".jasm_cover" | "preview_custom" | "cover" | "预览")
        || stem.strip_prefix("preview").is_some_and(|d| !d.is_empty() && d.len() <= 3 && d.chars().all(|c| c.is_ascii_digit()))
}

/// A file in `dir` named `want` in any case.
fn find_file(names: &[String], want: &str) -> Option<String> { names.iter().find(|n| n.eq_ignore_ascii_case(want)).cloned() }

fn set<T>(slot: &mut Option<T>, v: Option<T>) { if slot.is_none() { *slot = v; } }

/// Everything other managers left in a mod folder (and the folder above it). None when there is nothing.
pub fn read(dir: &Path) -> Option<Foreign> {
    let names: Vec<String> = fs::read_dir(dir).ok()?.flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .map(|e| e.file_name().to_string_lossy().into_owned()).collect();
    let mut f = Foreign::default();

    if let Some(v) = find_file(&names, ".JASM_ModConfig.json").and_then(|n| read_json(&dir.join(n))) {
        f.managers.push("JASM");
        set(&mut f.name, field(&v, &["CustomName"]));
        set(&mut f.author, field(&v, &["Author"]));
        set(&mut f.url, field(&v, &["ModUrl"]));
        set(&mut f.version, field(&v, &["Version"]));
        set(&mut f.notes, field(&v, &["Description"]));
        set(&mut f.preview, field(&v, &["ImagePath"]).and_then(|p| picture_in(dir, &p)));
    }
    if let Some(v) = find_file(&names, "mod.json").and_then(|n| read_json(&dir.join(n))) {
        let flairx = ["isNSFW", "dateChecked", "gbChangeDate", "statusKeeperSync", "modBroken"].iter().any(|k| field(&v, &[k]).is_some() || v.get(*k).is_some());
        f.managers.push(if flairx { "FlairX" } else if v.get("modName").is_some() || v.get("location").is_some() { "XX Mod Manager" } else { "another manager" });
        set(&mut f.name, field(&v, &["modName", "name"]));
        set(&mut f.author, field(&v, &["author"]));
        set(&mut f.url, field(&v, &["url", "link", "source"]));
        set(&mut f.version, field(&v, &["version"]));
        set(&mut f.character, field(&v, &["character"]).filter(|c| !c.eq_ignore_ascii_case("unknown")));
        set(&mut f.notes, field(&v, &["description"]));
        set(&mut f.preview, field(&v, &["preview"]).and_then(|p| picture_in(dir, &p)));
        if f.tags.is_empty() { f.tags = list(&v, "tags"); }
        f.nsfw |= flag(&v, &["isNSFW"]);
    }
    if let Some(v) = find_file(&names, "info.json").and_then(|n| read_json(&dir.join(n))) {
        if v.get("actual_name").is_some() || v.get("is_safe").is_some() || v.get("is_pinned").is_some() {
            f.managers.push("EMMM");
            set(&mut f.name, field(&v, &["actual_name"]));
            set(&mut f.author, field(&v, &["author"]));
            set(&mut f.version, field(&v, &["version"]));
            set(&mut f.notes, field(&v, &["description"]));
            if f.tags.is_empty() { f.tags = list(&v, "tags"); }
            f.favorite |= flag(&v, &["is_favorite"]);
            if let Some(m) = v.get("metadata") { set(&mut f.url, gb_link_in(m)); }
        }
    }
    if let Some(v) = find_file(&names, ".zmm-meta.json").and_then(|n| read_json(&dir.join(n))) {
        f.managers.push("Fairy's Secret Folder");
        set(&mut f.gb_mod_id, field(&v, &["gb_mod_id"]).and_then(|s| s.parse().ok()).filter(|&n: &u64| n > 0));
        set(&mut f.url, field(&v, &["source_url"]));
        set(&mut f.author, field(&v, &["author"]));
        set(&mut f.notes, field(&v, &["notes"]));
        if f.tags.is_empty() { f.tags = list(&v, "tags"); }
        set(&mut f.installed_at, field(&v, &["downloaded_at"]).and_then(|s| s.parse().ok()));
    }
    if let Some(v) = find_file(&names, "modmeta.json").and_then(|n| read_json(&dir.join(n))) {
        f.managers.push("WZMM");
        set(&mut f.character, field(&v, &["character"]));
        set(&mut f.author, field(&v, &["author"]));
        set(&mut f.preview, field(&v, &["previewUrl"]).filter(|p| p.starts_with("https://")));
    }
    if let Some(v) = find_file(&names, "GIMM.json").or_else(|| find_file(&names, "GIMM.jsonc")).and_then(|n| read_json(&dir.join(n))) {
        f.managers.push("GIMM");
        set(&mut f.name, field(&v, &["name"]));
        set(&mut f.character, field(&v, &["character"]));
        set(&mut f.author, field(&v, &["author"]));
        set(&mut f.version, field(&v, &["version"]));
    }
    if let Some(n) = find_file(&names, "modname").and_then(|n| read_text(&dir.join(n))) {
        f.managers.push("No Reload Mod Manager");
        set(&mut f.name, Some(n));
        f.favorite |= find_file(&names, "fav").is_some();
    }
    // the folder above: Fairy's "<Character> - <Skin>" folder, No Reload's group folder
    if let Some(parent) = dir.parent() {
        if let Some(c) = read_json(&parent.join("category.json")).and_then(|v| field(&v, &["character_id"])) {
            if !f.managers.contains(&"Fairy's Secret Folder") { f.managers.push("Fairy's Secret Folder"); }
            set(&mut f.character, Some(c.replace('_', " ")));
        }
        if let Some(g) = read_text(&parent.join("groupname")) {
            if !f.managers.contains(&"No Reload Mod Manager") { f.managers.push("No Reload Mod Manager"); }
            set(&mut f.character, Some(g));
        }
    }
    if f.preview.is_none() {
        let mut covers: Vec<&String> = names.iter().filter(|n| is_cover_name(n)).collect();
        covers.sort_by_key(|n| (!n.to_lowercase().starts_with(".jasm_cover"), n.to_lowercase()));
        f.preview = covers.first().map(|n| n.to_string());
    }
    if f.gb_mod_id.is_none() { f.gb_mod_id = f.url.as_deref().and_then(gb_mod_id); }
    (!f.managers.is_empty()).then_some(f)
}

/// A GameBanana link anywhere inside a JSON value.
fn gb_link_in(v: &Value) -> Option<String> {
    match v {
        Value::String(s) if gb_mod_id(s).is_some() => Some(s.clone()),
        Value::Array(a) => a.iter().find_map(gb_link_in),
        Value::Object(o) => o.values().find_map(gb_link_in),
        _ => None,
    }
}

/// A picture path from another manager's file, as a file name inside `dir` when it is there.
fn picture_in(dir: &Path, p: &str) -> Option<String> {
    let p = p.trim().replace('\\', "/");
    if p.starts_with("https://") { return Some(p); }
    let name = p.rsplit('/').next()?.to_string();
    (library::preview_ext(&name).is_some() && dir.join(&name).is_file()).then_some(name)
}

/// Fill a sidecar from another manager's details. Fields the user (or gachamod) already set stay as they are; while
/// adopting a new folder its guessed name and character give way. True when anything changed.
pub fn merge(sc: &mut Sidecar, f: &Foreign, m: &Matcher, default_name: &str, adopting: bool) -> bool {
    let before = sc.clone();
    let clean = |s: &Option<String>| s.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    if let Some(n) = clean(&f.name) {
        if adopting || sc.name.trim().is_empty() || sc.name == default_name { sc.name = n.chars().take(200).collect(); }
    }
    if let Some(hint) = clean(&f.character) {
        if adopting || sc.character.as_deref().is_none_or(|c| c.trim().is_empty()) {
            if let Some(c) = m.exact(&hint).or_else(|| m.best(&[&hint])) { sc.character = Some(c); }
        }
    }
    let author = clean(&f.author);
    match (&mut sc.source, f.gb_mod_id) {
        (None, Some(id)) => {
            sc.source = Some(ModSource { site: "gamebanana".into(), mod_id: id, url: format!("https://gamebanana.com/mods/{id}"), submitter: author.clone(), ..Default::default() });
        }
        (Some(s), _) if s.submitter.is_none() && author.is_some() => s.submitter = author.clone(),
        _ => {}
    }
    if sc.version.is_none() { sc.version = clean(&f.version); }
    if sc.preview.is_none() && sc.custom_preview.is_none() { sc.preview = clean(&f.preview); }
    // the rest only for a folder seen for the first time: on a known mod, empty tags or an unticked favourite may be
    // what the user chose
    if adopting {
        if sc.tags.is_empty() && !f.tags.is_empty() { sc.tags = f.tags.clone(); }
        if sc.notes.is_none() {
            sc.notes = clean(&f.notes).map(|n| n.chars().take(2000).collect());
            // a link to another site still helps: keep it in the notes
            if sc.notes.is_none() && f.gb_mod_id.is_none() { sc.notes = clean(&f.url).filter(|u| u.starts_with("http")).map(|u| format!("Link: {u}")); }
        }
        if f.nsfw { sc.nsfw = true; }
        if f.favorite { sc.favorite = true; }
        if let Some(t) = f.installed_at.filter(|&t| t > 946_684_800) { sc.installed_at = t; }
    }
    *sc != before
}

// ── finding them and bringing them in ──

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagerCount { pub manager: String, pub mods: u32 }

/// Other managers' details in a game's Mods folder.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForeignInfo {
    /// Each manager with how many mods carry its details.
    pub managers: Vec<ManagerCount>,
    /// Mods whose details an import would add to (a name, character, link, picture ...).
    pub fillable: u32,
}

/// A mod's sidecar before an import changed it, to put back on Undo.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarBack { pub rel: String, pub sidecar: Sidecar }

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForeignImport {
    pub changed: u32,
    pub managers: Vec<String>,
    pub undo: Vec<SidecarBack>,
    pub notes: Vec<String>,
}

fn lock(db: &Shared) -> Result<std::sync::MutexGuard<'_, crate::db::Db>> {
    db.lock().map_err(|_| Error::Db("The local database is stuck after an earlier error. Restart gachamod".into()))
}

/// The mod folders with another manager's details, and what an import would do. Reads only.
pub fn detect(db: &Shared, game: &str) -> Result<ForeignInfo> {
    let (root, m) = { let d = lock(db)?; (crate::games::mods_dir(&d, game)?, library::matcher(&d, game)?) };
    let mut counts: BTreeMap<&'static str, u32> = BTreeMap::new();
    let mut fillable = 0;
    for (dir, rel) in library::mod_dirs(&root) {
        let Some(f) = read(&dir) else { continue };
        for x in &f.managers { *counts.entry(x).or_default() += 1; }
        let Some(mut sc) = library::read_sidecar(&dir) else { fillable += 1; continue };
        let default = library::display_folder(rel.rsplit('/').next().unwrap_or(&rel)).to_string();
        if merge(&mut sc, &f, &m, &default, false) { fillable += 1; }
    }
    let mut managers: Vec<ManagerCount> = counts.into_iter().map(|(k, v)| ManagerCount { manager: k.to_string(), mods: v }).collect();
    managers.sort_by(|a, b| b.mods.cmp(&a.mods).then(a.manager.cmp(&b.manager)));
    Ok(ForeignInfo { managers, fillable })
}

/// Add other managers' details to every mod that lacks them, then rescan (new folders are adopted with them).
pub fn import(db: &Shared, game: &str) -> Result<ForeignImport> {
    let (root, m) = { let d = lock(db)?; (crate::games::mods_dir(&d, game)?, library::matcher(&d, game)?) };
    let mut out = ForeignImport::default();
    for (dir, rel) in library::mod_dirs(&root) {
        let Some(f) = read(&dir) else { continue };
        for x in &f.managers { if !out.managers.iter().any(|y| y == x) { out.managers.push(x.to_string()); } }
        let Some(before) = library::read_sidecar(&dir) else { out.changed += 1; continue };
        let mut sc = before.clone();
        let default = library::display_folder(rel.rsplit('/').next().unwrap_or(&rel)).to_string();
        if !merge(&mut sc, &f, &m, &default, false) { continue; }
        match library::write_sidecar(&dir, &sc) {
            Ok(()) => { out.changed += 1; out.undo.push(SidecarBack { rel, sidecar: before }); }
            Err(e) => out.notes.push(format!("Couldn't update {}: {e}", sc.name)),
        }
    }
    library::scan(db, game)?;
    Ok(out)
}

/// Put back the sidecars an import replaced, then rescan.
pub fn undo(db: &Shared, game: &str, items: &[SidecarBack]) -> Result<()> {
    let root = { let d = lock(db)?; crate::games::mods_dir(&d, game)? };
    for it in items {
        let mut dir = root.clone();
        for part in it.rel.split('/') {
            if part.is_empty() || part == "." || part == ".." || part.contains(':') { return Err(Error::Invalid("That folder path looks wrong".into())); }
            dir.push(part);
        }
        // only where the same mod still is
        if library::read_sidecar(&dir).is_some_and(|now| now.id == it.sidecar.id) { library::write_sidecar(&dir, &it.sidecar)?; }
    }
    library::scan(db, game)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("gachamod-managers-{tag}-{}", library::new_id()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn reads_links() {
        assert_eq!(gb_mod_id("https://gamebanana.com/mods/123456"), Some(123456));
        assert_eq!(gb_mod_id("https://gamebanana.com/mods/download/77"), Some(77));
        assert_eq!(gb_mod_id("jasm-plus:https://gamebanana.com/mmdl/1,Mod,99"), Some(99));
        assert_eq!(gb_mod_id("https://gamebanana.com/dl/555"), None);
        assert_eq!(gb_mod_id("https://example.com/mods/1"), None);
        assert!(is_cover_name(".JASM_Cover.png") && is_cover_name("preview001.jpg") && is_cover_name("preview_custom.webp"));
        assert!(!is_cover_name("preview.png") && !is_cover_name("BodyDiffuse.png") && !is_cover_name("preview2024x.png"));
    }

    #[test]
    fn reads_each_manager() {
        let root = temp("read");
        let m = Matcher::new("gi", &["Raiden Shogun".to_string(), "Hu Tao".to_string()]);

        let jasm = root.join("character/raiden shogun/Kimono");
        fs::create_dir_all(&jasm).unwrap();
        fs::write(jasm.join(".JASM_ModConfig.json"), r#"{"Id":"5e1c","CustomName":"Summer Kimono","Author":"Someone","ModUrl":"https://gamebanana.com/mods/123456","ImagePath":".JASM_Cover.png","DateAdded":"13/11/2026 10:00:00"}"#).unwrap();
        fs::write(jasm.join(".JASM_Cover.png"), "x").unwrap();
        let f = read(&jasm).unwrap();
        assert_eq!(f.managers, vec!["JASM"]);
        assert_eq!((f.name.as_deref(), f.gb_mod_id, f.preview.as_deref()), (Some("Summer Kimono"), Some(123456), Some(".JASM_Cover.png")));

        let xx = root.join("xx");
        fs::create_dir_all(&xx).unwrap();
        fs::write(xx.join("mod.json"), r#"{"id":"abc","location":"D:/x","modName":"Butterfly","character":"Hu Tao","url":"https://gamebanana.com/mods/42","tags":["dress"],"preview":"preview.png"}"#).unwrap();
        let f = read(&xx).unwrap();
        assert_eq!(f.managers, vec!["XX Mod Manager"]);
        let mut sc = Sidecar { name: "xx".into(), ..Default::default() };
        assert!(merge(&mut sc, &f, &m, "xx", true));
        assert_eq!((sc.name.as_str(), sc.character.as_deref(), sc.source.as_ref().map(|s| s.mod_id)), ("Butterfly", Some("Hu Tao"), Some(42)));
        assert_eq!(sc.tags, vec!["dress"]);

        let fx = root.join("Raiden Shogun/Battle Dress");
        fs::create_dir_all(&fx).unwrap();
        fs::write(fx.join("mod.json"), r#"{"author":"A","url":"https://gamebanana.com/mods/7","version":"1.2","dateUpdated":"0000-00-00","isNSFW":true}"#).unwrap();
        let f = read(&fx).unwrap();
        assert_eq!(f.managers, vec!["FlairX"]);
        assert!(f.nsfw);
        assert_eq!(f.version.as_deref(), Some("1.2"));

        let fairy = root.join("Hu Tao - Default Outfit/Ghost");
        fs::create_dir_all(&fairy).unwrap();
        fs::write(root.join("Hu Tao - Default Outfit/category.json"), r#"{"character_id":"hu_tao","skin_id":"default"}"#).unwrap();
        fs::write(fairy.join(".zmm-meta.json"), r#"{"gb_mod_id":"9001","downloaded_at":"1760000000","source_url":"https://gamebanana.com/mods/9001","author":"B","notes":"","tags":[]}"#).unwrap();
        let f = read(&fairy).unwrap();
        assert_eq!((f.gb_mod_id, f.character.as_deref(), f.installed_at), (Some(9001), Some("hu tao"), Some(1760000000)));
        let mut sc = Sidecar::default();
        merge(&mut sc, &f, &m, "", true);
        assert_eq!(sc.character.as_deref(), Some("Hu Tao"));

        let nr = root.join("_MANAGED_/group_3/slot a");
        fs::create_dir_all(&nr).unwrap();
        fs::write(root.join("_MANAGED_/group_3/groupname"), "Raiden").unwrap();
        fs::write(nr.join("modname"), "Raiden Bikini").unwrap();
        let f = read(&nr).unwrap();
        let mut sc = Sidecar::default();
        merge(&mut sc, &f, &m, "", true);
        assert_eq!((sc.name.as_str(), sc.character.as_deref()), ("Raiden Bikini", Some("Raiden Shogun")));

        let em = root.join("em");
        fs::create_dir_all(&em).unwrap();
        fs::write(em.join("info.json"), r#"{"actual_name":"Night Dress","author":"C","is_safe":true,"is_favorite":true,"metadata":{"gb":"https://gamebanana.com/mods/31"}}"#).unwrap();
        let f = read(&em).unwrap();
        assert_eq!((f.name.as_deref(), f.gb_mod_id, f.favorite), (Some("Night Dress"), Some(31), true));

        // a plain mod has nothing to read
        let plain = root.join("plain");
        fs::create_dir_all(&plain).unwrap();
        fs::write(plain.join("info.json"), r#"{"anything":1}"#).unwrap();
        assert_eq!(read(&plain), None);
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn merge_keeps_what_the_user_set() {
        let m = Matcher::new("gi", &["Raiden Shogun".to_string(), "Hu Tao".to_string()]);
        let f = Foreign { managers: vec!["JASM"], name: Some("Other".into()), character: Some("Hu Tao".into()), gb_mod_id: Some(5), ..Default::default() };
        let mut sc = Sidecar { name: "My name".into(), character: Some("Raiden Shogun".into()), ..Default::default() };
        assert!(merge(&mut sc, &f, &m, "folder", false));
        assert_eq!((sc.name.as_str(), sc.character.as_deref()), ("My name", Some("Raiden Shogun")));
        assert_eq!(sc.source.unwrap().mod_id, 5);
        let mut again = Sidecar { name: "folder".into(), ..Default::default() };
        merge(&mut again, &f, &m, "folder", false);
        assert_eq!(again.name, "Other");
    }
}
