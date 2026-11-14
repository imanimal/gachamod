//! The characters a player has, per game, so the Characters view can show them even without mods.
//! Owner: LIBRARY area (docs/spec.md, "Characters").
//!
//! Imports read the usual exports and fall back to walking any JSON or a pasted list of names:
//! - Genshin: GOOD (Genshin Optimizer, Inventory Kamera, Irminsul, yas), Enka.Network profiles, HoYoLAB lists.
//! - Star Rail: SROD (Star Rail Optimizer), HSR-Scanner and reliquary_archiver exports, Fribbels optimizer saves,
//!   Enka.Network profiles, HoYoLAB lists.
//! - Zenless: ZOD (Zenless Optimizer), Enka.Network profiles, HoYoLAB lists.
//! - Wuthering Waves: Inventory Kamera, wuwatracker pull history, any JSON with resonator ids or names.
//! - gachamod's own file (`export`), to move the list to another PC or keep it through a reinstall.
//! Names go through the game's alias table (aliases.rs), so optimizer keys ("KamisatoAyaka"), in-game ids ("1205")
//! and nicknames all land on the roster's names. Anything that doesn't is reported back, never an error.
//! `fetch_profile` reads a player's public Enka.Network profile by UID (Genshin, Star Rail, Zenless): the characters on
//! their in-game showcase, with no sign-in.

use crate::aliases::{self, Matcher};
use crate::db::{now, Db};
use crate::error::{Error, Result};
use crate::library;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeSet;
use std::path::Path;

pub const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS owned_characters (
    game TEXT NOT NULL,
    name TEXT NOT NULL COLLATE NOCASE,
    added_at INTEGER NOT NULL,
    source TEXT,
    PRIMARY KEY (game, name)
);";

/// The characters marked as owned for a game, by name.
pub fn list(db: &Db, game: &str) -> Result<Vec<String>> {
    let mut st = db.conn.prepare("SELECT name FROM owned_characters WHERE game = ?1 ORDER BY name")?;
    let v = st.query_map([game], |r| r.get::<_, String>(0))?.collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(v)
}

/// Mark characters as owned or not. Returns the ones that changed, so Undo can flip just those.
pub fn set(db: &Db, game: &str, names: &[String], owned: bool) -> Result<Vec<String>> {
    set_from(db, game, names, owned, "by hand")
}

fn set_from(db: &Db, game: &str, names: &[String], owned: bool, source: &str) -> Result<Vec<String>> {
    let mut changed = Vec::new();
    let t = now();
    for n in names {
        let n = n.trim();
        if n.is_empty() || changed.iter().any(|c: &String| c.eq_ignore_ascii_case(n)) { continue; }
        let rows = if owned {
            db.conn.execute("INSERT OR IGNORE INTO owned_characters (game, name, added_at, source) VALUES (?1, ?2, ?3, ?4)", rusqlite::params![game, n, t, source])?
        } else {
            db.conn.execute("DELETE FROM owned_characters WHERE game = ?1 AND name = ?2", [game, n])?
        };
        if rows > 0 { changed.push(n.to_string()); }
    }
    Ok(changed)
}

/// What an import did.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OwnedImport {
    /// The game the characters went to. The file decides when it clearly belongs to one game.
    pub game: String,
    /// What the file was read as ("GOOD", "Enka.Network profile", "list of names" ...).
    pub format: String,
    /// Newly marked as owned (Undo clears these).
    pub added: Vec<String>,
    /// Found but already marked.
    pub already: u32,
    /// Names that matched no character.
    pub unknown: Vec<String>,
}

/// Read an export (JSON, or a pasted list of names) and mark everything in it as owned.
pub fn import(db: &Db, game: &str, text: &str) -> Result<OwnedImport> {
    let parsed = parse(text);
    let mut res = resolve_best(db, game, &parsed)?;
    if res.names.is_empty() {
        return Err(Error::Invalid(if res.unknown.is_empty() {
            "Found no characters in that. Try an export from an optimizer (GOOD, SROD, ZOD), an Enka.Network profile or a list of names".into()
        } else {
            format!("None of those names matched a character, for example \"{}\"", res.unknown[0])
        }));
    }
    let added = set_from(db, &res.game, &res.names, true, &parsed.format)?;
    let already = (res.names.len() - added.len()) as u32;
    res.unknown.truncate(200);
    Ok(OwnedImport { game: res.game, format: parsed.format, added, already, unknown: res.unknown })
}

/// The same, from a file.
pub fn import_file(db: &Db, game: &str, path: &Path) -> Result<OwnedImport> {
    let len = std::fs::metadata(path)?.len();
    if len > 50 * 1024 * 1024 { return Err(Error::Invalid("That file is too big to be a character export".into())); }
    let text = crate::ini::decode(&std::fs::read(path)?);
    import(db, game, &text)
}

/// Format name of gachamod's own file.
pub const OWN_FORMAT: &str = "gachamod";

/// The owned list as gachamod's own JSON, which `import` reads back:
/// `{"format": "gachamod", "version": 1, "game": "zzz", "characters": ["Ellen Joe", ...]}`.
pub fn export(db: &Db, game: &str) -> Result<String> {
    let v = serde_json::json!({ "format": OWN_FORMAT, "version": 1, "game": game, "characters": list(db, game)? });
    Ok(serde_json::to_string_pretty(&v)?)
}

/// The same, written to a file. Returns how many characters it lists.
pub fn export_file(db: &Db, game: &str, path: &Path) -> Result<usize> {
    let n = list(db, game)?.len();
    std::fs::write(path, export(db, game)?)?;
    Ok(n)
}

// ── the player's public profile ──

/// Enka.Network's address for a player's public profile, for the games it covers.
pub fn profile_url(game: &str, uid: &str) -> Option<String> {
    let path = match game { "gi" => "uid", "hsr" => "hsr/uid", "zzz" => "zzz/uid", _ => return None };
    Some(format!("https://enka.network/api/{path}/{uid}/"))
}

/// Read a player's public profile from Enka.Network: the text for `import`. It lists the characters on the
/// player's in-game showcase.
pub async fn fetch_profile(http: &reqwest::Client, game: &str, uid: &str) -> Result<String> {
    let uid = uid.trim();
    if !(6..=10).contains(&uid.len()) || !uid.chars().all(|c| c.is_ascii_digit()) {
        return Err(Error::Invalid("A UID is the 9 or 10 digit number on your in-game profile".into()));
    }
    let Some(url) = profile_url(game, uid) else {
        return Err(Error::Invalid("Reading a profile by UID works for Genshin, Star Rail and Zenless".into()));
    };
    let r = http.get(&url).timeout(std::time::Duration::from_secs(20)).send().await?;
    let status = r.status().as_u16();
    let text = match status {
        200 => r.text().await?,
        400 | 404 => return Err(Error::Invalid(format!("Enka.Network has no player with UID {uid} in this game. Check the number"))),
        424 => return Err(Error::Invalid("The game is down for maintenance, so profiles can't be read until it's back".into())),
        429 => return Err(Error::Invalid("Enka.Network asked to slow down. Try again in a minute".into())),
        _ => return Err(Error::Network(format!("Enka.Network answered {status}"))),
    };
    if parse(&text).ids.is_empty() {
        return Err(Error::Invalid("That profile shows no characters. Put the ones you own on your showcase in game, wait a few minutes and try again".into()));
    }
    Ok(text)
}

// ── reading exports ──

/// What a file says, before matching it to a roster.
#[derive(Debug, Default, Clone)]
pub struct Parsed {
    pub format: String,
    /// The game the format belongs to, when it says.
    pub game: Option<&'static str>,
    /// In-game ids ("10000052", "1205").
    pub ids: Vec<String>,
    /// Names or keys to match. `strict` ones are reported when nothing matches.
    pub names: Vec<(String, bool)>,
    /// The player character's name or id when the file says (Stelle or Caelus), to pick one of a pair.
    pub player: Option<String>,
}

fn s(v: &Value) -> Option<String> {
    match v {
        Value::String(x) => Some(x.trim().to_string()).filter(|x| !x.is_empty()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

fn arr<'a>(v: &'a Value, path: &[&str]) -> &'a [Value] {
    let mut cur = v;
    for k in path {
        match cur.get(*k) { Some(x) => cur = x, None => return &[] }
    }
    cur.as_array().map(|a| a.as_slice()).unwrap_or(&[])
}

fn digits(id: &str) -> String { id.trim().chars().take_while(|c| c.is_ascii_digit()).collect() }

fn is_id(s: &str) -> bool { (4..=9).contains(&s.len()) && s.chars().all(|c| c.is_ascii_digit()) }

/// Work out what `text` is and what it lists.
pub fn parse(text: &str) -> Parsed {
    let text = text.trim_start_matches('\u{feff}').trim();
    let Ok(v) = serde_json::from_str::<Value>(text) else { return pasted(text) };
    let mut p = Parsed::default();
    let format = v.get("format").and_then(|f| f.as_str()).unwrap_or("");
    let chars = arr(&v, &["characters"]);
    let keys = |p: &mut Parsed, list: &[Value]| {
        for c in list {
            if let Some(k) = c.get("key").and_then(s) { p.names.push((k, true)); }
        }
    };
    if format.eq_ignore_ascii_case(OWN_FORMAT) {
        p.format = "gachamod list".into();
        let g = v.get("game").and_then(|g| g.as_str()).unwrap_or("");
        p.game = aliases::games().find(|x| *x == g);
        p.names = chars.iter().filter_map(s).map(|n| (n, true)).collect();
        return p;
    }
    match format.to_ascii_uppercase().as_str() {
        "GOOD" => { p.format = "GOOD".into(); p.game = Some("gi"); keys(&mut p, chars); return p; }
        "SROD" => { p.format = "SROD".into(); p.game = Some("hsr"); keys(&mut p, chars); trailblazer(&v, &mut p); return p; }
        "ZOD" | "ZOOD" => { p.format = "ZOD".into(); p.game = Some("zzz"); keys(&mut p, chars); return p; }
        _ => {}
    }
    // Enka.Network profiles
    let gi_enka: Vec<&Value> = arr(&v, &["avatarInfoList"]).iter().chain(arr(&v, &["playerInfo", "showAvatarInfoList"])).collect();
    if !gi_enka.is_empty() {
        p.format = "Enka.Network profile".into();
        p.game = Some("gi");
        p.ids = gi_enka.iter().filter_map(|a| a.get("avatarId").and_then(s)).collect();
        return p;
    }
    let hsr_enka: Vec<&Value> = arr(&v, &["detailInfo", "avatarDetailList"]).iter().chain(arr(&v, &["detailInfo", "assistAvatarList"])).collect();
    if !hsr_enka.is_empty() {
        p.format = "Enka.Network profile".into();
        p.game = Some("hsr");
        p.ids = hsr_enka.iter().filter_map(|a| a.get("avatarId").and_then(s)).collect();
        return p;
    }
    let zzz_enka = arr(&v, &["PlayerInfo", "ShowcaseDetail", "AvatarList"]);
    if !zzz_enka.is_empty() {
        p.format = "Enka.Network profile".into();
        p.game = Some("zzz");
        p.ids = zzz_enka.iter().filter_map(|a| a.get("Id").and_then(s)).collect();
        return p;
    }
    // Star Rail scanners (HSR-Scanner, reliquary_archiver) and Fribbels optimizer saves
    let source = v.get("source").and_then(|x| x.as_str()).unwrap_or("").to_ascii_lowercase();
    let starrail = ["hsr", "reliquary", "star", "march"].iter().any(|k| source.contains(k));
    if !chars.is_empty() && (starrail || v.get("relics").is_some_and(|r| r.is_array())) {
        p.format = if starrail { "Star Rail scanner export".into() } else { "Fribbels optimizer save".into() };
        p.game = Some("hsr");
        for c in chars {
            match c.get("id").and_then(s).map(|id| digits(&id)).filter(|id| is_id(id)) {
                Some(id) => p.ids.push(id),
                None => if let Some(k) = c.get("key").or_else(|| c.get("name")).and_then(s) { p.names.push((k, true)); },
            }
        }
        trailblazer(&v, &mut p);
        return p;
    }
    // wuwatracker pull history: everything pulled is owned
    let pulls = arr(&v, &["pulls"]);
    if !pulls.is_empty() && pulls.iter().any(|x| x.get("resourceId").is_some()) {
        p.format = "wuwatracker pull history".into();
        p.game = Some("ww");
        for x in pulls {
            let kind = x.get("resourceType").and_then(|t| t.as_str()).unwrap_or("").to_ascii_lowercase();
            let id = x.get("resourceId").and_then(s).unwrap_or_default();
            if kind.contains("weapon") || (kind.is_empty() && id.len() != 4) { continue; }
            if is_id(&id) { p.ids.push(id); } else if let Some(n) = x.get("name").and_then(s) { p.names.push((n, true)); }
        }
        return p;
    }
    // Inventory Kamera for Wuthering Waves: an object keyed by resonator id
    if let Some(o) = v.as_object() {
        let keyed = o.iter().filter(|(k, x)| k.len() == 4 && k.chars().all(|c| c.is_ascii_digit()) && x.is_object()).count();
        if keyed >= 1 && keyed * 2 >= o.len() {
            p.format = "Inventory Kamera".into();
            p.game = Some("ww");
            p.ids = o.keys().filter(|k| k.len() == 4 && k.chars().all(|c| c.is_ascii_digit())).cloned().collect();
            return p;
        }
    }
    p.format = if v.pointer("/data/avatar_list").is_some() || v.pointer("/data/avatars").is_some() { "HoYoLAB list".into() } else { "JSON file".into() };
    walk(&v, None, 0, &mut p);
    trailblazer(&v, &mut p);
    p
}

/// HSR-Scanner and some SROD exports say which Trailblazer the player picked.
fn trailblazer(v: &Value, p: &mut Parsed) {
    if let Some(t) = v.pointer("/metadata/trailblazer").and_then(s) { p.player = Some(t); }
}

const NAME_KEYS: &[&str] = &["name", "key", "character", "charactername", "charname", "char", "avatar", "avatarname", "resonator", "resonatorname", "agent", "agentname"];
/// Keys whose unmatched names are worth reporting (a "name" can just as well be a weapon's).
const STRICT_KEYS: &[&str] = &["character", "charactername", "charname", "avatarname", "resonator", "resonatorname", "agent", "agentname"];
const ID_KEYS: &[&str] = &["id", "avatarid", "avatar_id", "characterid", "character_id", "charid", "roleid", "role_id", "resourceid", "resonatorid", "agentid"];

/// Any JSON: names and ids under the usual keys, string lists, and objects keyed by id or by name.
fn walk(v: &Value, key: Option<&str>, depth: usize, p: &mut Parsed) {
    if depth > 12 || p.names.len() + p.ids.len() > 20_000 { return; }
    match v {
        Value::Object(o) => {
            for (k, x) in o {
                let lk = k.to_ascii_lowercase();
                if x.is_object() && is_id(k) { p.ids.push(k.clone()); }
                else if x.is_object() && !k.is_empty() && k.len() <= 40 && !lk.contains('_') && k.chars().next().is_some_and(|c| c.is_uppercase() || !c.is_ascii()) {
                    // {"Raiden Shogun": {...}}: a guess, never reported
                    p.names.push((k.clone(), false));
                }
                walk(x, Some(&lk), depth + 1, p);
            }
        }
        Value::Array(a) => {
            if a.iter().all(|x| x.is_string()) && key.is_some_and(|k| !k.contains("tag")) {
                for x in a.iter().take(2000) {
                    let Some(t) = s(x) else { continue };
                    if is_id(&t) { p.ids.push(t); } else if t.chars().count() <= 40 { p.names.push((t, false)); }
                }
            } else {
                for x in a { walk(x, key, depth + 1, p); }
            }
        }
        Value::String(_) | Value::Number(_) => {
            let (Some(k), Some(t)) = (key, s(v)) else { return };
            if ID_KEYS.contains(&k) {
                let id = digits(&t);
                // "1205", or "1001b1" (Fribbels marks some forms with a suffix)
                if is_id(&id) && t.len() <= id.len() + 3 { p.ids.push(id); }
            } else if NAME_KEYS.contains(&k) && t.chars().count() <= 40 && !t.starts_with("http") {
                p.names.push((t, STRICT_KEYS.contains(&k)));
            }
        }
        _ => {}
    }
}

/// A pasted list: one name per line, or separated by commas, semicolons or tabs. Bullets and numbering are dropped.
fn pasted(text: &str) -> Parsed {
    let mut p = Parsed { format: "list of names".into(), ..Default::default() };
    for item in text.split(['\n', '\r', ',', ';', '\t', '|']) {
        let mut t = item.trim().trim_start_matches(['-', '*', '•', '·']).trim();
        // "3. Hu Tao", "3) Hu Tao"
        if let Some(rest) = t.trim_start_matches(|c: char| c.is_ascii_digit()).strip_prefix(['.', ')']) {
            if t.starts_with(|c: char| c.is_ascii_digit()) { t = rest.trim(); }
        }
        if t.is_empty() || t.chars().count() > 60 { continue; }
        if is_id(t) { p.ids.push(t.to_string()); } else if t.chars().any(char::is_alphabetic) { p.names.push((t.to_string(), true)); }
    }
    p
}

// ── matching ──

/// Characters found for one game.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct Resolved { pub game: String, pub names: Vec<String>, pub unknown: Vec<String> }

/// Match what a file lists against one game's roster and aliases.
pub fn resolve(game: &str, m: &Matcher, p: &Parsed) -> Resolved {
    let mut names: Vec<String> = Vec::new();
    let mut unknown: BTreeSet<String> = BTreeSet::new();
    let push = |n: String, names: &mut Vec<String>| if !names.contains(&n) { names.push(n); };
    let player = p.player.as_deref().and_then(|x| m.by_id(x).or_else(|| m.exact(x)));
    for id in &p.ids {
        if let Some(n) = m.by_id(id) { push(n, &mut names); }
    }
    for (raw, strict) in &p.names {
        if let Some(n) = m.exact(raw) { push(n, &mut names); continue; }
        if let Some(members) = m.group(raw) {
            // Traveler, Trailblazer, Rover: the one the player picked, or both when the file doesn't say
            match &player {
                Some(pl) if members.contains(pl) => push(pl.clone(), &mut names),
                _ => for x in members { push(x, &mut names) },
            }
            continue;
        }
        match m.best_scored(&[raw]) {
            Some((n, score)) if score >= 200 => push(n, &mut names),
            _ => if *strict { unknown.insert(raw.clone()); },
        }
    }
    Resolved { game: game.to_string(), names, unknown: unknown.into_iter().collect() }
}

/// The game a file belongs to: the one its format names, else the one asked for, else whichever game matches the
/// most when the one asked for matches nothing (a Star Rail export dropped while looking at Genshin).
fn resolve_best(db: &Db, game: &str, p: &Parsed) -> Result<Resolved> {
    if let Some(g) = p.game { return Ok(resolve(g, &library::matcher(db, g)?, p)); }
    let here = resolve(game, &library::matcher(db, game)?, p);
    if !here.names.is_empty() { return Ok(here); }
    let mut best = here;
    for g in aliases::games().filter(|g| *g != game) {
        let r = resolve(g, &library::matcher(db, g)?, p);
        if r.names.len() > best.names.len() { best = r; }
    }
    Ok(best)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(game: &str, text: &str) -> (Parsed, Resolved) {
        let p = parse(text);
        let g = p.game.unwrap_or(game);
        let r = resolve(g, &Matcher::new(g, &[]), &p);
        (p, r)
    }

    fn has(r: &Resolved, n: &str) -> bool { r.names.iter().any(|x| x == n) }

    #[test]
    fn reads_good() {
        let (p, r) = run("zzz", r#"{"format":"GOOD","version":2,"source":"Inventory Kamera","characters":[
            {"key":"RaidenShogun","level":90,"constellation":2},{"key":"KamisatoAyaka","level":80},
            {"key":"TravelerAnemo","level":70},{"key":"HuTao"},{"key":"SomeoneNew"}],
            "weapons":[{"key":"EngulfingLightning","location":"RaidenShogun"}]}"#);
        assert_eq!((p.format.as_str(), r.game.as_str()), ("GOOD", "gi"));
        for n in ["Raiden Shogun", "Kamisato Ayaka", "Hu Tao", "Aether", "Lumine"] { assert!(has(&r, n), "{n} in {:?}", r.names); }
        assert_eq!(r.unknown, vec!["SomeoneNew"]);
    }

    #[test]
    fn reads_star_rail_exports() {
        let (_, r) = run("gi", r#"{"format":"SROD","version":1,"characters":[{"key":"Acheron"},{"key":"TopazAndNumby"},{"key":"March7thTheHunt"},{"key":"TrailblazerRemembrance"}]}"#);
        assert_eq!(r.game, "hsr");
        for n in ["Acheron", "Topaz", "March 7th", "Caelus", "Stelle"] { assert!(has(&r, n), "{n} in {:?}", r.names); }

        let (p, r) = run("gi", r#"{"source":"reliquary_archiver","build":"v0.1","version":4,"metadata":{"uid":1,"trailblazer":"Stelle"},
            "characters":[{"id":"1205","name":"Blade","level":80},{"id":"8006","name":"Trailblazer"},{"id":"1308","name":"Acheron"}],"light_cones":[],"relics":[]}"#);
        assert_eq!(p.format, "Star Rail scanner export");
        assert!(has(&r, "Blade") && has(&r, "Stelle") && has(&r, "Acheron") && !has(&r, "Caelus"));

        let (_, r) = run("gi", r#"{"source":"HSR-Scanner","version":3,"metadata":{"trailblazer":"Caelus"},"characters":[{"key":"TrailblazerHarmony"},{"key":"Firefly"}]}"#);
        assert!(has(&r, "Caelus") && has(&r, "Firefly") && !has(&r, "Stelle"), "{:?}", r.names);

        let (p, r) = run("gi", r#"{"version":"v4.8.1","relics":[{"part":"Head"}],"characters":[{"id":"1205","form":{}},{"id":"1001b1","form":{}}]}"#);
        assert_eq!(p.format, "Fribbels optimizer save");
        assert!(has(&r, "Blade") && has(&r, "March 7th"));
    }

    #[test]
    fn reads_enka_and_hoyolab() {
        let (_, r) = run("ww", r#"{"playerInfo":{"nickname":"x","showAvatarInfoList":[{"avatarId":10000052,"level":90},{"avatarId":10000007}]},"uid":"1"}"#);
        assert_eq!(r.game, "gi");
        assert_eq!(r.names, vec!["Raiden Shogun", "Lumine"]);
        let (_, r) = run("gi", r#"{"detailInfo":{"avatarDetailList":[{"avatarId":1205},{"avatarId":8002}]}}"#);
        assert_eq!((r.game.as_str(), r.names.clone()), ("hsr", vec!["Blade".to_string(), "Stelle".to_string()]));
        let (_, r) = run("gi", r#"{"PlayerInfo":{"ShowcaseDetail":{"AvatarList":[{"Id":1091},{"Id":1261}]}}}"#);
        assert_eq!((r.game.as_str(), r.names.clone()), ("zzz", vec!["Hoshimi Miyabi".to_string(), "Jane Doe".to_string()]));
        // HoYoLAB doesn't say the game: the one being looked at decides
        let (p, r) = run("zzz", r#"{"retcode":0,"data":{"avatar_list":[{"id":1091,"name_mi18n":"Miyabi"},{"id":1011,"name_mi18n":"Anby"}]}}"#);
        assert_eq!(p.format, "HoYoLAB list");
        assert!(has(&r, "Hoshimi Miyabi") && has(&r, "Anby Demara"), "{:?}", r.names);
    }

    #[test]
    fn reads_wuthering_waves() {
        let (_, r) = run("gi", r#"{"playerId":"1","pulls":[{"cardPoolType":"1","resourceId":1304,"qualityLevel":5,"resourceType":"Resonators","name":"Jinhsi"},
            {"resourceId":21010016,"resourceType":"Weapons","name":"Some Sword"},{"resourceId":1502,"resourceType":"Resonators","name":"Rover"}]}"#);
        assert_eq!((r.game.as_str(), r.names.clone()), ("ww", vec!["Jinhsi".to_string(), "Rover Female".to_string()]));
        let (p, r) = run("gi", r#"{"1205":{"level":90,"ascension":6,"chain":0},"1505":{"level":80}}"#);
        assert_eq!(p.format, "Inventory Kamera");
        assert_eq!(r.names, vec!["Changli", "Shorekeeper"]);
    }

    #[test]
    fn reads_any_json_and_lists() {
        let (p, r) = run("gi", r#"{"team":{"owned":["Ei","Nahida","Furina"]},"notes":"hi","builds":[{"character":"Hu Tao","weapon":{"name":"Staff of Homa"}},{"character":"Nobody Real"}]}"#);
        assert_eq!(p.format, "JSON file");
        for n in ["Raiden Shogun", "Nahida", "Furina", "Hu Tao"] { assert!(has(&r, n), "{n} in {:?}", r.names); }
        assert_eq!(r.unknown, vec!["Nobody Real"]);

        let (p, r) = run("gi", "Raiden Shogun\n- Ayaka\n3. hutao, Kazuha; Mona C2\nnot a real one\n10000052\n");
        assert_eq!(p.format, "list of names");
        for n in ["Raiden Shogun", "Kamisato Ayaka", "Hu Tao", "Kaedehara Kazuha", "Mona"] { assert!(has(&r, n), "{n} in {:?}", r.names); }
        assert_eq!(r.unknown, vec!["not a real one"]);
        assert_eq!(r.names.iter().filter(|n| *n == "Raiden Shogun").count(), 1);
    }

    #[test]
    fn import_marks_and_undoes() {
        let db = Db::memory().unwrap();
        let r = import(&db, "gi", "Ei\nNahida\nWho").unwrap();
        assert_eq!((r.game.as_str(), r.added.len(), r.already, r.unknown.clone()), ("gi", 2, 0, vec!["Who".to_string()]));
        let again = import(&db, "gi", "Raiden Shogun").unwrap();
        assert_eq!((again.added.len(), again.already), (0, 1));
        assert_eq!(list(&db, "gi").unwrap(), vec!["Nahida", "Raiden Shogun"]);
        // dropped on the wrong game: the file's own game wins
        let hsr = import(&db, "gi", r#"{"format":"SROD","characters":[{"key":"Blade"}]}"#).unwrap();
        assert_eq!((hsr.game.as_str(), hsr.added.clone()), ("hsr", vec!["Blade".to_string()]));
        assert_eq!(set(&db, "gi", &r.added, false).unwrap().len(), 2);
        assert!(list(&db, "gi").unwrap().is_empty());
        assert!(import(&db, "gi", "{}").is_err());
        assert!(import(&db, "gi", "nobody\nnone").is_err());
    }

    #[test]
    fn own_file_round_trips() {
        let db = Db::memory().unwrap();
        import(&db, "zzz", "Miyabi\nJane Doe").unwrap();
        let text = export(&db, "zzz").unwrap();
        assert!(text.contains(r#""format": "gachamod""#), "{text}");
        let fresh = Db::memory().unwrap();
        // read back while looking at another game: the file's game wins
        let r = import(&fresh, "gi", &text).unwrap();
        assert_eq!((r.game.as_str(), r.format.as_str()), ("zzz", "gachamod list"));
        assert_eq!(list(&fresh, "zzz").unwrap(), vec!["Hoshimi Miyabi", "Jane Doe"]);
        assert_eq!(profile_url("hsr", "800069903").as_deref(), Some("https://enka.network/api/hsr/uid/800069903/"));
        assert!(profile_url("ww", "1").is_none());
    }
}
