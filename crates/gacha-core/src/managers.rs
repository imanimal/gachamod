//! What other mod managers leave in a Mods folder, read so their mods come in with their names, characters,
//! GameBanana links, pictures, tags, notes and on/off state. Owner: LIBRARY area (docs/spec.md, "Finding mods").
//!
//! Files read, per mod folder:
//! - JASM and JASM+: `.JASM_ModConfig.json` (CustomName, Author, Version, ModUrl, ImagePath, Description,
//!   DateAdded, CharacterSkinOverride, Preferences; JASM+ also Variants and Addons as [{Name, FolderName, Enabled}])
//!   and the picture `.JASM_Cover.<ext>`. Mods sit in `Mods/<category>/<character>/<mod>` with lowercase character
//!   folders. DateAdded is .NET's DateTime.ToString() in the user's locale ("13/11/2026 10:00:00").
//! - SkinSelectImpact: `SSI.txt` (`Url = `, `Notes = `, `Randomize = ` lines), older `SkinSelectImpact.txt` and
//!   `Url.txt` (the link), `preview.png` (library reads it). Mods sit in `Mods/SkinSelectImpact/<Character>/<mod>`.
//! - `mod.json`, written by several managers, told apart by their keys:
//!   - XX Mod Manager: id, location, modName, author, character, url, tags, category, description, hotkeys, preview
//!     ("Unknown" and "no description" when unset).
//!   - FlairX Mod Manager: author, url, version, isNSFW (the folder name is the name).
//!   - ZZZ Mod Manager: character, description, url, imagePath, keyswap.
//!   - WuWa Mod Manager: id, author, description, version, category (a character name), url; `thumbnail.png`.
//! - Peaky Mod Manager: `modinfo.json` (name is the folder, title, description, source, coverImage, modType,
//!   character like "ZhuYuan" when modType is "Character", outfitId).
//! - Hestia: `⬢HESTIA/metadata.json` ({metadata: {user: {title, description, notes, cover_image, category}},
//!   source: {gamebanana: {mod_id, url}, snapshot: {title, authors, version}}, unsafe_content, created_at}) and
//!   `⬢HESTIA/Personal Note.txt`. Hestia turns a mod off by moving its files into `<mod>/DISABLED_BY_HESTIA`.
//! - EMMM: `info.json` (actual_name, author, version, tags, description, is_favorite, is_pinned, is_safe,
//!   preset_name, metadata) and `preview_custom.<ext>`.
//! - d3dxSkinManage-Plus: `.d3dxmeta/info.json` ({kind, name, info: {author, description, version, url,
//!   age_rating, tags, custom_data: {gamebanana: {mod_id, page_url, submitter_name}}}, previews}) with the pictures
//!   in `.d3dxmeta/previews/`.
//! - Fairy's Secret Folder: `.zmm-meta.json` (gb_mod_id, source_url, author, notes, tags) and, in the
//!   `<Character> - <Skin>` folder above, `category.json` (character_id like "jane_doe").
//! - No Reload Mod Manager: `modname` (a text file with the name), `modlink` (the mod's page), `icon.png`, `fav`, and
//!   the group folder's `groupname`. Its layout and on/off state are nrmm.rs.
//! - WZMM: `modmeta.json` (character, author, previewUrl). GIMM: `GIMM.json(c)` (character, name, author, version).
//!
//! IMM is imm.rs. uyujkk's Integrated Mod Manager and HoyoModManagerGo keep their details in their own databases,
//! nothing per mod. Most managers above turn a mod off with a DISABLED prefix (any case and separator), which
//! library reads; inis renamed to "DISABLED_x.ini" or "x.ini.disabled" are read there too. WZMM moves off mods out
//! of Mods to `<ZZMI>/dismods` and Peaky keeps them in its own library (only on mods are linked into Mods).
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
    /// A manager's own grouping: a character name (WuWa Mod Manager), a type like "NPC" or "UI" (Peaky), or a
    /// folder of the user's (Hestia). A character when it names one, otherwise a tag.
    pub category: Option<String>,
    /// JASM's CharacterSkinOverride: the in-game skin the mod replaces ("RaidenShogunDefault").
    pub skin: Option<String>,
    pub notes: Option<String>,
    pub nsfw: bool,
    pub favorite: bool,
    pub installed_at: Option<i64>,
    /// JASM+ variants and add-ons: folders inside the mod, for a later step to treat as parts or sub-mods.
    pub parts: Vec<ForeignPart>,
    /// JASM's saved option values (`$swapvar` = "2"), keyed by the part after `$\mods\<mod path>\`.
    pub preferences: BTreeMap<String, String>,
    /// EMMM's preset names the mod is in.
    pub presets: Vec<String>,
}

/// A folder inside a mod that another manager lists as a variant or an add-on.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ForeignPart {
    pub name: String,
    pub folder: String,
    pub enabled: bool,
    /// An add-on that goes with the mod (JASM+ Addons) rather than one of its looks (Variants).
    pub addon: bool,
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
        if !s.is_empty() && !is_placeholder(&s) { return Some(s); }
    }
    None
}

/// What managers write when nothing was set: XX Mod Manager's "Unknown" and "no description", Peaky's
/// "No description provided.", ZZZ Mod Manager's sample text, WuWa's "*Uncategorized".
fn is_placeholder(s: &str) -> bool {
    let l = s.trim().trim_end_matches('.').to_lowercase();
    matches!(l.as_str(), "0000-00-00" | "unknown" | "none" | "null" | "n/a" | "no description" | "no description provided"
        | "this is a description of my mod" | "*uncategorized" | "uncategorized")
}

/// A text file that may run over several lines (notes), up to 16 KB.
fn read_note(p: &Path) -> Option<String> {
    if fs::metadata(p).ok()?.len() > 16 * 1024 { return None; }
    let t = crate::ini::decode(&fs::read(p).ok()?).replace("\r\n", "\n");
    let t = t.trim_start_matches('\u{feff}').trim().to_string();
    (!t.is_empty()).then_some(t)
}

/// A date another manager wrote, as unix seconds: RFC 3339 ("2026-11-13T10:00:00Z", Hestia), or .NET's
/// DateTime.ToString() in the user's locale (JASM: "13/11/2026 10:00:00", "11/13/2026 10:00:00 AM",
/// "2026-11-13 10:00:00", "13.11.2026 10:00:00"). Day and month that could be either are read day first.
fn parse_date(s: &str) -> Option<i64> {
    let s = s.trim();
    if let Ok(t) = chrono::DateTime::parse_from_rfc3339(s) { return Some(t.timestamp()); }
    let n: Vec<u32> = s.split(|c: char| !c.is_ascii_digit()).filter(|x| !x.is_empty()).take(6).filter_map(|x| x.parse().ok()).collect();
    if n.len() < 3 { return None; }
    let (y, m, d) = if n[0] >= 1000 { (n[0], n[1], n[2]) } else if n[1] > 12 { (n[2], n[0], n[1]) } else { (n[2], n[1], n[0]) };
    let (mut h, mi, sec) = (n.get(3).copied().unwrap_or(0), n.get(4).copied().unwrap_or(0), n.get(5).copied().unwrap_or(0));
    let l = s.to_ascii_lowercase();
    if l.ends_with("pm") && h < 12 { h += 12; }
    if l.ends_with("am") && h == 12 { h = 0; }
    let t = chrono::NaiveDate::from_ymd_opt(y as i32, m, d)?.and_hms_opt(h, mi, sec)?.and_utc().timestamp();
    (t > 946_684_800).then_some(t)
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
        set(&mut f.installed_at, field(&v, &["DateAdded"]).and_then(|d| parse_date(&d)));
        set(&mut f.skin, field(&v, &["CharacterSkinOverride"]));
        for (key, addon) in [("Variants", false), ("Addons", true)] {
            for p in v.get(key).and_then(Value::as_array).into_iter().flatten().take(50) {
                let Some(folder) = field(p, &["FolderName"]) else { continue };
                f.parts.push(ForeignPart { name: field(p, &["Name"]).unwrap_or_else(|| folder.clone()), folder, enabled: flag(p, &["Enabled"]), addon });
            }
        }
        if let Some(o) = v.get("Preferences").and_then(Value::as_object) {
            f.preferences = o.iter().filter_map(|(k, x)| Some((k.clone(), x.as_str()?.to_string()))).take(200).collect();
        }
    }
    ssi(dir, &names, &mut f);
    if let Some(v) = find_file(&names, "mod.json").and_then(|n| read_json(&dir.join(n))) { mod_json(dir, &names, &v, &mut f); }
    if let Some(v) = find_file(&names, "modinfo.json").and_then(|n| read_json(&dir.join(n))) {
        // Peaky writes every key, so name, title and modType together tell it from any other modinfo.json
        if ["name", "title", "modType", "coverImage"].iter().all(|k| v.get(*k).is_some()) {
            f.managers.push("Peaky Mod Manager");
            set(&mut f.name, field(&v, &["title"]));
            set(&mut f.url, field(&v, &["source"]));
            set(&mut f.notes, field(&v, &["description"]));
            set(&mut f.preview, field(&v, &["coverImage"]).and_then(|p| picture_in(dir, &p)));
            let kind = field(&v, &["modType"]);
            if kind.as_deref() == Some("Character") { set(&mut f.character, field(&v, &["character"])); } else { set(&mut f.category, kind); }
        }
    }
    hestia(dir, &mut f);
    if let Some(v) = find_file(&names, "info.json").and_then(|n| read_json(&dir.join(n))) {
        if v.get("actual_name").is_some() || v.get("is_safe").is_some() || v.get("is_pinned").is_some() {
            f.managers.push("EMMM");
            set(&mut f.name, field(&v, &["actual_name"]));
            set(&mut f.author, field(&v, &["author"]));
            set(&mut f.version, field(&v, &["version"]));
            set(&mut f.notes, field(&v, &["description"]));
            if f.tags.is_empty() { f.tags = list(&v, "tags"); }
            // gachamod has no pins: a pinned mod is one the user cares about, like a favourite
            f.favorite |= flag(&v, &["is_favorite", "is_pinned"]);
            // is_safe defaults to true, so only an explicit false marks the mod adult
            f.nsfw |= v.get("is_safe").and_then(Value::as_bool) == Some(false);
            if f.presets.is_empty() { f.presets = list(&v, "preset_name"); }
            if let Some(m) = v.get("metadata") { set(&mut f.url, gb_link_in(m)); }
        }
    }
    d3dx(dir, &mut f);
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
        set(&mut f.url, find_file(&names, "modlink").and_then(|n| read_text(&dir.join(n))).filter(|u| u.starts_with("http")));
        set(&mut f.preview, find_file(&names, "icon.png"));
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
    // a link typed where the name goes (a title or CustomName pasted from the browser) is the mod's page
    if f.name.as_deref().is_some_and(|n| n.starts_with("http://") || n.starts_with("https://") || gb_mod_id(n).is_some()) {
        let link = f.name.take();
        set(&mut f.url, link);
    }
    if f.gb_mod_id.is_none() { f.gb_mod_id = f.url.as_deref().and_then(gb_mod_id); }
    (!f.managers.is_empty()).then_some(f)
}

/// SkinSelectImpact: `SSI.txt` beside the mod's files, the older `SkinSelectImpact.txt` or `Url.txt`, and the
/// character from `Mods/SkinSelectImpact/<Character>/<mod>`.
fn ssi(dir: &Path, names: &[String], f: &mut Foreign) {
    let mut found = false;
    if let Some(text) = find_file(names, "SSI.txt").and_then(|n| read_note(&dir.join(n))) {
        found = true;
        let mut notes: Option<String> = None;
        for line in text.lines() {
            let key_value = line.split_once('=').map(|(k, v)| (k.trim().to_ascii_lowercase(), v.trim()));
            match key_value {
                Some((k, v)) if k == "url" => set(&mut f.url, Some(v.to_string()).filter(|v| !v.is_empty())),
                Some((k, v)) if k == "notes" => notes = Some(v.to_string()),
                Some((k, _)) if k == "randomize" => {}
                // a line under Notes that isn't another key belongs to the notes
                _ => if let Some(n) = notes.as_mut() { n.push('\n'); n.push_str(line); },
            }
        }
        set(&mut f.notes, notes.map(|n| n.trim().to_string()).filter(|n| !n.is_empty()));
    }
    for old in ["SkinSelectImpact.txt", "Url.txt"] {
        let Some(text) = find_file(names, old).and_then(|n| read_note(&dir.join(n))) else { continue };
        let link = text.lines().map(|l| l.split_once('=').filter(|(k, _)| k.trim().eq_ignore_ascii_case("url")).map_or(l, |(_, v)| v).trim())
            .find(|l| l.starts_with("http") || l.contains("gamebanana.com"));
        if let Some(link) = link { found = true; set(&mut f.url, Some(link.to_string())); }
    }
    let parent = dir.parent();
    let in_ssi = parent.and_then(Path::parent).and_then(Path::file_name).is_some_and(|n| n.to_string_lossy().eq_ignore_ascii_case("SkinSelectImpact"));
    if in_ssi {
        found = true;
        let c = parent.and_then(Path::file_name).map(|n| library::display_folder(&n.to_string_lossy()).trim().to_string());
        set(&mut f.character, c.filter(|c| !c.is_empty()));
    }
    if found { f.managers.push("SkinSelectImpact"); }
}

/// `mod.json`: XX Mod Manager, FlairX, ZZZ Mod Manager and WuWa Mod Manager all use the name, each with its own keys.
fn mod_json(dir: &Path, names: &[String], v: &Value, f: &mut Foreign) {
    let has = |k: &str| v.get(k).is_some();
    let flairx = ["isNSFW", "dateChecked", "gbChangeDate", "statusKeeperSync", "modBroken"].iter().any(|k| has(k));
    let xx = has("modName") || has("location");
    let zzmm = !xx && (has("imagePath") || has("keyswap"));
    // WuWa Mod Manager writes exactly these six keys, with a UUID id
    let wuwa = !flairx && !xx && !zzmm && has("id")
        && v.as_object().is_some_and(|o| o.keys().all(|k| ["id", "author", "description", "version", "category", "url"].contains(&k.as_str())));
    f.managers.push(if flairx { "FlairX" } else if xx { "XX Mod Manager" } else if zzmm { "ZZZ Mod Manager" } else if wuwa { "WuWa Mod Manager" } else { "another manager" });
    set(&mut f.name, field(v, &["modName", "name"]));
    set(&mut f.author, field(v, &["author"]));
    set(&mut f.url, field(v, &["url", "link", "source"]));
    set(&mut f.version, field(v, &["version"]));
    set(&mut f.character, field(v, &["character"]));
    set(&mut f.category, field(v, &["category"]));
    set(&mut f.notes, field(v, &["description"]));
    set(&mut f.preview, field(v, &["preview", "imagePath"]).and_then(|p| picture_in(dir, &p)));
    if wuwa { set(&mut f.preview, find_file(names, "thumbnail.png")); }
    if f.tags.is_empty() { f.tags = list(v, "tags"); }
    f.nsfw |= flag(v, &["isNSFW"]);
}

/// Hestia's `⬢HESTIA` folder. A mod Hestia turned off has its files in `<mod>/DISABLED_BY_HESTIA`, so that folder
/// reads its details from the one above.
fn hestia(dir: &Path, f: &mut Foreign) {
    const META: &str = "\u{2B22}HESTIA";
    let off = dir.file_name().is_some_and(|n| n.to_string_lossy().eq_ignore_ascii_case("DISABLED_BY_HESTIA"));
    let Some(root) = (if off { dir.parent() } else { Some(dir) }) else { return };
    let meta = root.join(META);
    if !meta.is_dir() { return; }
    let v = read_json(&meta.join("metadata.json"));
    let note = read_note(&meta.join("Personal Note.txt"));
    if v.is_none() && note.is_none() { return; }
    f.managers.push("Hestia");
    let v = v.unwrap_or(Value::Null);
    let user = v.pointer("/metadata/user").unwrap_or(&Value::Null);
    let gb = v.pointer("/source/gamebanana").unwrap_or(&Value::Null);
    let snap = v.pointer("/source/snapshot").unwrap_or(&Value::Null);
    set(&mut f.name, field(user, &["title"]).or_else(|| field(snap, &["title"])));
    set(&mut f.gb_mod_id, gb.get("mod_id").and_then(Value::as_u64).filter(|&n| n > 0));
    set(&mut f.url, field(gb, &["url"]));
    set(&mut f.author, snap.get("authors").and_then(Value::as_array).and_then(|a| a.iter().find_map(|x| x.as_str())).map(str::to_string));
    set(&mut f.version, field(snap, &["version"]));
    set(&mut f.notes, note.or_else(|| field(user, &["notes"])).or_else(|| field(user, &["description"])));
    set(&mut f.category, field(user, &["category"]));
    // the cover is a path from the mod's folder ("⬢HESTIA/gb_123_1.jpg"), so only the folder itself can use it
    if !off { set(&mut f.preview, field(user, &["cover_image"]).and_then(|p| picture_rel(root, &p))); }
    let pref = v.get("unsafe_content_preference").and_then(Value::as_str).unwrap_or("Auto");
    f.nsfw |= pref == "Yes" || (pref != "No" && flag(&v, &["unsafe_content"]));
    set(&mut f.installed_at, field(&v, &["created_at"]).and_then(|d| parse_date(&d)));
}

/// d3dxSkinManage-Plus: `.d3dxmeta/info.json` in the mod's container (the folder itself or the one above).
fn d3dx(dir: &Path, f: &mut Foreign) {
    let Some((root, v)) = [Some(dir), dir.parent()].into_iter().flatten()
        .find_map(|r| read_json(&r.join(".d3dxmeta").join("info.json")).map(|v| (r, v))) else { return };
    if !field(&v, &["kind"]).is_some_and(|k| k.starts_with("d3dxSkinManage")) { return; }
    f.managers.push("d3dxSkinManage-Plus");
    let info = v.get("info").unwrap_or(&Value::Null);
    let gb = v.pointer("/info/custom_data/gamebanana").unwrap_or(&Value::Null);
    set(&mut f.name, field(&v, &["name"]));
    set(&mut f.author, field(info, &["author"]).or_else(|| field(gb, &["submitter_name"])));
    set(&mut f.version, field(info, &["version"]).or_else(|| field(gb, &["version"])));
    set(&mut f.gb_mod_id, field(gb, &["mod_id"]).and_then(|s| s.parse().ok()).filter(|&n: &u64| n > 0));
    set(&mut f.url, field(info, &["url"]).or_else(|| field(gb, &["page_url"])));
    set(&mut f.notes, field(info, &["description"]));
    if f.tags.is_empty() { f.tags = list(info, "tags"); }
    // age ratings G, P, R and X: R and X are adult
    f.nsfw |= field(info, &["age_rating"]).is_some_and(|r| r.eq_ignore_ascii_case("R") || r.eq_ignore_ascii_case("X"));
    if root == dir {
        let first = v.get("previews").and_then(Value::as_array).and_then(|a| a.iter().find_map(|x| x.as_str()));
        set(&mut f.preview, first.and_then(|p| picture_rel(root, &format!(".d3dxmeta/previews/{p}"))));
    }
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

/// A picture path relative to the mod's folder, which may be in a subfolder ("⬢HESTIA/gb_1_1.jpg"), when it is there.
fn picture_rel(dir: &Path, p: &str) -> Option<String> {
    let p = p.trim().replace('\\', "/");
    if p.starts_with("https://") { return Some(p); }
    let parts: Vec<&str> = p.split('/').filter(|x| !x.is_empty() && *x != ".").collect();
    if parts.is_empty() || parts.iter().any(|x| *x == ".." || x.contains(':')) { return None; }
    let rel = parts.join("/");
    (library::preview_ext(parts[parts.len() - 1]).is_some() && dir.join(&rel).is_file()).then_some(rel)
}

/// Fill a sidecar from another manager's details. Fields the user (or gachamod) already set stay as they are; while
/// adopting a new folder its guessed name and character give way. True when anything changed.
pub fn merge(sc: &mut Sidecar, f: &Foreign, m: &Matcher, default_name: &str, adopting: bool) -> bool {
    let before = sc.clone();
    let clean = |s: &Option<String>| s.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    if let Some(n) = clean(&f.name) {
        if adopting || sc.name.trim().is_empty() || sc.name == default_name { sc.name = n.chars().take(200).collect(); }
    }
    // a category counts only when it is a character's exact name; JASM's skin ("RaidenShogunDefault") is a weaker hint
    let category = clean(&f.category);
    let category_character = category.as_deref().and_then(|c| m.exact(c));
    let none_yet = sc.character.as_deref().is_none_or(|c| c.trim().is_empty());
    if adopting || none_yet {
        let found = clean(&f.character).and_then(|h| m.exact(&h).or_else(|| m.best(&[&h])))
            .or_else(|| category_character.clone())
            .or_else(|| if none_yet { clean(&f.skin).and_then(|s| m.best(&[&s])) } else { None });
        if let Some(c) = found { sc.character = Some(c); }
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
        if sc.tags.is_empty() {
            let mut tags = f.tags.clone();
            // a category that isn't a character ("NPC", "Weapons") is kept as a tag
            if let Some(c) = category.filter(|_| category_character.is_none()) {
                if !tags.iter().any(|t| t.eq_ignore_ascii_case(&c)) { tags.push(c); }
            }
            sc.tags = tags;
        }
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
        fs::write(nr.join("modlink"), "https://gamebanana.com/mods/4242").unwrap();
        fs::write(nr.join("icon.png"), "x").unwrap();
        let f = read(&nr).unwrap();
        assert_eq!((f.gb_mod_id, f.preview.as_deref()), (Some(4242), Some("icon.png")));
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

    #[test]
    fn reads_dates() {
        assert_eq!(parse_date("13/11/2026 10:00:00"), Some(1794564000));
        assert_eq!(parse_date("11/13/2026 10:00:00 AM"), Some(1794564000));
        assert_eq!(parse_date("11/13/2026 10:00:00 PM"), Some(1794564000 + 12 * 3600));
        assert_eq!(parse_date("2026-11-13 10:00:00"), Some(1794564000));
        assert_eq!(parse_date("2026-11-13T10:00:00.250Z"), Some(1794564000));
        assert_eq!(parse_date("13.11.2026"), Some(1794528000));
        assert_eq!(parse_date("yesterday"), None);
        assert_eq!(parse_date("31/02/2026"), None);
    }

    #[test]
    fn reads_jasm_plus_and_emmm_v2() {
        let root = temp("jasm");
        let m = Matcher::new("gi", &["Raiden Shogun".to_string()]);
        let dir = root.join("character/raiden shogun/Kimono");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(".JASM_ModConfig.json"), r#"{
  "Id": "9c3f2b1e-5d1a-4f7e-9a51-2c7e0f6a8b11",
  "CustomName": "Summer Kimono",
  "Author": "Someone",
  "ModUrl": "https://gamebanana.com/mods/123456",
  "CharacterSkinOverride": "RaidenShogunDefault",
  "DateAdded": "13/11/2026 10:00:00",
  "LastChecked": "14/11/2026 09:00:00",
  "Preferences": { "swapvar": "2", "swapkimono": "1" },
  "Variants": [ { "Name": "Red", "FolderName": "Red", "Enabled": true }, { "Name": "Blue", "FolderName": "DISABLED_Blue", "Enabled": false } ],
  "Addons": [ { "Name": "Hair clip", "FolderName": "HairClip", "Enabled": true } ]
}"#).unwrap();
        let f = read(&dir).unwrap();
        assert_eq!((f.installed_at, f.skin.as_deref()), (Some(1794564000), Some("RaidenShogunDefault")));
        assert_eq!(f.parts.len(), 3);
        assert_eq!(f.parts[1], ForeignPart { name: "Blue".into(), folder: "DISABLED_Blue".into(), enabled: false, addon: false });
        assert!(f.parts[2].addon && f.parts[2].enabled);
        assert_eq!(f.preferences.get("swapvar").map(String::as_str), Some("2"));
        // the skin names the character when nothing else does
        let mut sc = Sidecar::default();
        merge(&mut sc, &Foreign { character: None, ..f.clone() }, &m, "", true);
        assert_eq!(sc.character.as_deref(), Some("Raiden Shogun"));
        assert_eq!(sc.installed_at, 1794564000);

        let em = root.join("em");
        fs::create_dir_all(&em).unwrap();
        fs::write(em.join("info.json"), r#"{"actual_name":"Night Dress","author":"Unknown","description":"","version":"1.0","tags":["dress"],"is_safe":false,"is_favorite":false,"is_pinned":true,"is_auto_sync":false,"preset_name":["Night","Beach"],"metadata":{}}"#).unwrap();
        let f = read(&em).unwrap();
        assert_eq!((f.favorite, f.nsfw, f.author.as_deref()), (true, true, None));
        assert_eq!(f.presets, vec!["Night", "Beach"]);
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn reads_skin_select_impact() {
        let root = temp("ssi");
        let m = Matcher::new("gi", &["Raiden Shogun".to_string(), "Hu Tao".to_string()]);
        let dir = root.join("SkinSelectImpact/Raiden Shogun/DISABLED Kimono");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("SSI.txt"), "Url = https://gamebanana.com/mods/512345\r\nRandomize = locked\r\nNotes = Press F6 to swap the sash\r\nF7 = hat\r\n").unwrap();
        fs::write(dir.join("preview.png"), "x").unwrap();
        let f = read(&dir).unwrap();
        assert_eq!(f.managers, vec!["SkinSelectImpact"]);
        assert_eq!((f.gb_mod_id, f.character.as_deref()), (Some(512345), Some("Raiden Shogun")));
        assert_eq!(f.notes.as_deref(), Some("Press F6 to swap the sash\nF7 = hat"));

        // version 5 to 7 kept the link alone in SkinSelectImpact.txt, older ones in Url.txt
        let old = root.join("SkinSelectImpact/Hu Tao/Ghost");
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("SkinSelectImpact.txt"), "https://gamebanana.com/mods/4321\n").unwrap();
        let f = read(&old).unwrap();
        let mut sc = Sidecar::default();
        merge(&mut sc, &f, &m, "", true);
        assert_eq!((sc.character.as_deref(), sc.source.map(|s| s.mod_id)), (Some("Hu Tao"), Some(4321)));

        // a mod's own Url.txt without a link is not SSI's
        let plain = root.join("Other/plain");
        fs::create_dir_all(&plain).unwrap();
        fs::write(plain.join("Url.txt"), "made by me").unwrap();
        assert_eq!(read(&plain), None);
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn tells_mod_json_writers_apart() {
        let root = temp("modjson");
        let m = Matcher::new("zzz", &["Anby Demara".to_string(), "Camellya".to_string()]);

        let zz = root.join("zz");
        fs::create_dir_all(&zz).unwrap();
        fs::write(zz.join("mod.json"), r#"{"character":"Anby","description":"This is a description of my mod.","imagePath":"preview.png","url":"https://gamebanana.com/mods/300001","keyswap":["F6"]}"#).unwrap();
        fs::write(zz.join("preview.png"), "x").unwrap();
        let f = read(&zz).unwrap();
        assert_eq!(f.managers, vec!["ZZZ Mod Manager"]);
        assert_eq!((f.notes, f.preview.as_deref(), f.gb_mod_id), (None, Some("preview.png"), Some(300001)));

        let ww = root.join("Camellya Bunny v1.1");
        fs::create_dir_all(&ww).unwrap();
        fs::write(ww.join("mod.json"), r#"{
  "id": "0b8e4a8c-3c55-4d3a-9f0a-7d1f1d3c2b6e",
  "author": "Moon",
  "description": "Bunny outfit",
  "version": "1.1",
  "category": "Camellya",
  "url": "https://gamebanana.com/mods/567890"
}"#).unwrap();
        fs::write(ww.join("thumbnail.png"), "x").unwrap();
        let f = read(&ww).unwrap();
        assert_eq!(f.managers, vec!["WuWa Mod Manager"]);
        assert_eq!((f.category.as_deref(), f.preview.as_deref()), (Some("Camellya"), Some("thumbnail.png")));
        let mut sc = Sidecar::default();
        merge(&mut sc, &f, &m, "", true);
        assert_eq!((sc.character.as_deref(), sc.tags.len()), (Some("Camellya"), 0));

        let xx = root.join("xx");
        fs::create_dir_all(&xx).unwrap();
        fs::write(xx.join("mod.json"), r#"{"id":"a1b2","location":"D:/mods/xx","modName":"xx","author":"Unknown","character":"Unknown","url":"Unknown","tags":[],"category":"Weapons","description":"no description","hotkeys":[],"preview":"Unknown"}"#).unwrap();
        let f = read(&xx).unwrap();
        assert_eq!(f.managers, vec!["XX Mod Manager"]);
        assert_eq!((&f.author, &f.character, &f.url, &f.notes, &f.preview), (&None, &None, &None, &None, &None));
        let mut sc = Sidecar::default();
        merge(&mut sc, &f, &m, "", true);
        assert_eq!(sc.tags, vec!["Weapons"]);
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn reads_peaky_hestia_and_d3dx() {
        let root = temp("peaky");
        let m = Matcher::new("zzz", &["Zhu Yuan".to_string(), "Ellen Joe".to_string()]);

        let pk = root.join("ZhuYuanMaid");
        fs::create_dir_all(&pk).unwrap();
        fs::write(pk.join("modinfo.json"), r#"{"name":"ZhuYuanMaid","title":"Zhu Yuan Maid","modType":"Character","description":"No description provided.","source":"https://gamebanana.com/mods/498765","coverImage":"cover.jpg","character":"ZhuYuan","outfitId":0}"#).unwrap();
        fs::write(pk.join("cover.jpg"), "x").unwrap();
        let f = read(&pk).unwrap();
        assert_eq!(f.managers, vec!["Peaky Mod Manager"]);
        let mut sc = Sidecar::default();
        merge(&mut sc, &f, &m, "ZhuYuanMaid", true);
        assert_eq!((sc.name.as_str(), sc.character.as_deref(), sc.notes.as_deref()), ("Zhu Yuan Maid", Some("Zhu Yuan"), None));
        assert_eq!((sc.preview.as_deref(), sc.source.map(|s| s.mod_id)), (Some("cover.jpg"), Some(498765)));
        let ui = root.join("CleanHUD");
        fs::create_dir_all(&ui).unwrap();
        fs::write(ui.join("modinfo.json"), r#"{"name":"CleanHUD","title":null,"modType":"UI","description":"Hides the HUD","source":"","coverImage":""}"#).unwrap();
        let mut sc = Sidecar::default();
        merge(&mut sc, &read(&ui).unwrap(), &m, "CleanHUD", true);
        assert_eq!((sc.tags.clone(), sc.notes.as_deref()), (vec!["UI".to_string()], Some("Hides the HUD")));

        let hs = root.join("Ellen Maid");
        let meta = hs.join("\u{2B22}HESTIA");
        fs::create_dir_all(&meta).unwrap();
        fs::write(meta.join("metadata.json"), r#"{
  "id": "4f0f5c4e-8a43-4d0b-9a66-0b9b6f1f6a10",
  "metadata": {
    "extracted": { "description": null, "hotkeys": [], "discovered_executables": [], "readme_path": null },
    "user": { "title": "Ellen Maid Outfit", "description": "A maid outfit", "hotkeys": [], "notes": "", "folder_path": "Ellen Maid", "cover_image": "\u2B22HESTIA/gb_498766_1.jpg", "screenshots": [], "category": "Ellen" },
    "prompt_for_missing_metadata": false
  },
  "source": {
    "gamebanana": { "mod_id": 498766, "url": "https://gamebanana.com/mods/498766" },
    "snapshot": { "title": "Ellen Maid", "authors": ["Moon"], "version": "2.0", "publish_ts": 1760000000, "update_ts": null, "description": null, "preview_urls": [], "files": [] },
    "raw_profile_json": null, "file_set": {}, "prefs": {}, "history": {}, "baseline_content_mtime": null, "baseline_ini_hash": null
  },
  "unsafe_content": true,
  "unsafe_content_auto": true,
  "unsafe_content_preference": "Auto",
  "created_at": "2026-11-13T10:00:00Z",
  "updated_at": "2026-11-14T10:00:00Z"
}"#).unwrap();
        fs::write(meta.join("Personal Note.txt"), "Use with the hair fix\nPress 5 for the apron").unwrap();
        fs::write(meta.join("gb_498766_1.jpg"), "x").unwrap();
        let f = read(&hs).unwrap();
        assert_eq!(f.managers, vec!["Hestia"]);
        assert_eq!((f.name.as_deref(), f.author.as_deref(), f.version.as_deref(), f.gb_mod_id), (Some("Ellen Maid Outfit"), Some("Moon"), Some("2.0"), Some(498766)));
        assert_eq!((f.preview.as_deref(), f.nsfw, f.installed_at), (Some("\u{2B22}HESTIA/gb_498766_1.jpg"), true, Some(1794564000)));
        assert_eq!(f.notes.as_deref(), Some("Use with the hair fix\nPress 5 for the apron"));
        // turned off by Hestia: the files sit in DISABLED_BY_HESTIA, the details one folder up
        let off = hs.join("DISABLED_BY_HESTIA");
        fs::create_dir_all(&off).unwrap();
        let f = read(&off).unwrap();
        assert_eq!((f.gb_mod_id, f.preview), (Some(498766), None));

        let dx = root.join("container");
        fs::create_dir_all(dx.join(".d3dxmeta/previews")).unwrap();
        fs::write(dx.join(".d3dxmeta/info.json"), r#"{"schema":2,"kind":"d3dxSkinManage-Plus.mod-share","name":"Ellen Swimsuit","info":{"author":"Sun","description":"Swimsuit","version":"1.3","url":"","age_rating":"R","tags":["swimsuit"],"custom_data":{"gamebanana":{"mod_id":512000,"page_url":"https://gamebanana.com/mods/512000","submitter_name":"Sun"}}},"previews":["main.png"]}"#).unwrap();
        fs::write(dx.join(".d3dxmeta/previews/main.png"), "x").unwrap();
        let f = read(&dx).unwrap();
        assert_eq!(f.managers, vec!["d3dxSkinManage-Plus"]);
        assert_eq!((f.name.as_deref(), f.gb_mod_id, f.nsfw, f.preview.as_deref()), (Some("Ellen Swimsuit"), Some(512000), true, Some(".d3dxmeta/previews/main.png")));
        assert_eq!(f.tags, vec!["swimsuit"]);
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_link_in_the_name_is_the_page() {
        let root = temp("namelink");
        fs::write(root.join("GIMM.json"), r#"{"name":"https://gamebanana.com/mods/77001","character":"Hu Tao"}"#).unwrap();
        let f = read(&root).unwrap();
        assert_eq!((f.name, f.gb_mod_id), (None, Some(77001)));
        fs::remove_dir_all(&root).unwrap();
    }
}
