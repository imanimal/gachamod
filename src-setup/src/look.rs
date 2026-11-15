//! Which look the window wears.
//!
//! Installing: a theme named on the command line, else a game named by the download. Windows notes where a file came
//! from (its Zone.Identifier stream: the page that linked it and the address it came from), and browsers keep the
//! file name, so `gachamod-setup-zzz.exe`, a page like `.../gachamod/?theme=genshin`, or a renamed
//! `gachamod-setup (wuwa).exe` all work. Without one it's the look gachamod last showed, for someone who already has
//! it, else the Default theme.
//!
//! Repair and uninstall: the look gachamod last showed. The app writes it to look.json in its data folder whenever
//! its theme changes (src-tauri commands::system::save_look), so this is the theme of the game in use.
use serde_json::{json, Value};
use std::path::Path;

struct Game { id: &'static str, theme: &'static str, accent: &'static str, name: &'static str, short: &'static str, importer: &'static str, words: &'static [&'static str] }

/// Games a link can name (the XXMI games; crates/gacha-core/src/games.rs has the rest of what the app knows).
const GAMES: &[Game] = &[
    Game { id: "gi", theme: "gi", accent: "#d3bc8e", name: "Genshin Impact", short: "Genshin", importer: "GIMI", words: &["gi", "genshin", "teyvat", "gimi"] },
    Game { id: "hsr", theme: "hsr", accent: "#a596f5", name: "Honkai: Star Rail", short: "Star Rail", importer: "SRMI", words: &["hsr", "starrail", "srmi"] },
    Game { id: "zzz", theme: "zzz", accent: "#ff7a1c", name: "Zenless Zone Zero", short: "ZZZ", importer: "ZZMI", words: &["zzz", "zenless", "eridu", "zzmi"] },
    Game { id: "ww", theme: "ww", accent: "#e9d58a", name: "Wuthering Waves", short: "WuWa", importer: "WWMI", words: &["ww", "wuwa", "wuthering", "solaris", "wwmi"] },
    Game { id: "ef", theme: "ef", accent: "#f2e33a", name: "Arknights: Endfield", short: "Endfield", importer: "EFMI", words: &["ef", "endfield", "talos", "efmi"] },
    Game { id: "hi3", theme: "default", accent: "#59c3f5", name: "Honkai Impact 3rd", short: "HI3", importer: "HIMI", words: &["hi3", "honkaiimpact", "himi"] },
];
/// Themes that can be named directly (src/lib/theme-info.ts).
const THEMES: &[&str] = &["default", "zzz", "gi", "hsr", "ww", "ef", "clay"];

fn game_look(g: &Game, source: &str) -> Value {
    json!({ "theme": g.theme, "game": { "id": g.id, "name": g.name, "short": g.short, "importer": g.importer, "accent": g.accent }, "source": source })
}

/// A theme id or a game word ("zzz", "genshin", "default").
fn by_name(name: &str, source: &str) -> Option<Value> {
    let n = name.trim().to_ascii_lowercase();
    if let Some(g) = GAMES.iter().find(|g| g.words.contains(&n.as_str()) || g.id == n) { return Some(game_look(g, source)); }
    THEMES.contains(&n.as_str()).then(|| json!({ "theme": n, "source": source }))
}

/// A game named somewhere in a file name or address: `theme=` or `game=` first, then whole short words ("zzz" in
/// "gachamod-setup-zzz.exe") and long words anywhere ("genshin" in "GenshinMods").
fn in_text(text: &str, source: &str) -> Option<Value> {
    let lower = text.to_ascii_lowercase();
    for part in lower.split(['?', '&', '#', ';']) {
        if let Some((k, v)) = part.split_once('=') {
            if matches!(k.trim(), "theme" | "game") { if let Some(l) = by_name(v, source) { return Some(l); } }
        }
    }
    let tokens: Vec<&str> = lower.split(|c: char| !c.is_ascii_alphanumeric()).filter(|t| !t.is_empty()).collect();
    let squashed: String = lower.chars().filter(char::is_ascii_alphanumeric).collect();
    GAMES.iter()
        .find(|g| g.words.iter().any(|w| if w.len() <= 4 { tokens.contains(w) } else { squashed.contains(w) }))
        .map(|g| game_look(g, source))
}

/// Where Windows says a downloaded file came from: the page that linked it, then the file name in the address it
/// came from (signed download addresses are long and random, so only their file name counts).
fn download_source(exe: &Path) -> Vec<String> {
    let mut p = exe.as_os_str().to_owned();
    p.push(":Zone.Identifier");
    let Ok(text) = std::fs::read_to_string(&p) else { return vec![] };
    let mut referrer = None;
    let mut host = None;
    for line in text.lines() {
        match line.split_once('=') {
            Some(("ReferrerUrl", v)) => referrer = Some(v.trim().to_string()),
            Some(("HostUrl", v)) => host = Some(v.trim().to_string()),
            _ => {}
        }
    }
    let host = host.map(|h| {
        let (path, query) = h.split_once('?').unwrap_or((&h, ""));
        let file = path.rsplit('/').next().unwrap_or("").to_string();
        let named = decode(query).split('&').find_map(|kv| kv.split_once("filename=").map(|(_, f)| f.to_string())).unwrap_or_default();
        format!("{} {}", decode(&file), named)
    });
    referrer.into_iter().chain(host).collect()
}

fn decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    let hex = |c: u8| (c as char).to_digit(16).map(|d| d as u8);
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let (Some(h), Some(l)) = (hex(b[i + 1]), hex(b[i + 2])) { out.push(h * 16 + l); i += 3; continue; }
        }
        out.push(if b[i] == b'+' { b' ' } else { b[i] });
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The look gachamod last showed (look.json in its data folder).
pub fn from_app() -> Option<Value> {
    let file = crate::sys::roaming_appdata().join(crate::sys::IDENTIFIER).join("look.json");
    let mut v: Value = serde_json::from_str(&std::fs::read_to_string(file).ok()?).ok()?;
    if !v["theme"].is_string() { return None; }
    v["source"] = json!("app");
    Some(v)
}

fn default() -> Value { json!({ "theme": "default", "source": "default" }) }

/// The note a game's own setup leaves for gachamod's first start (src-tauri commands::system::setup_game).
pub const GAME_NOTE: &str = "setup-game.json";

/// The game this setup was named for (`gachamod-setup-zzz.exe`, a link, `--theme`), not the look gachamod last showed.
pub fn named_game(look: &Value) -> Option<String> {
    if matches!(look["source"].as_str(), Some("app" | "default")) { return None; }
    look["game"]["id"].as_str().map(String::from)
}

/// After a fresh install from a game's own setup: gachamod starts in one-game mode for that game.
pub fn leave_game_note(game: &str) {
    let dir = crate::sys::roaming_appdata().join(crate::sys::IDENTIFIER);
    let _ = std::fs::create_dir_all(&dir);
    let _ = std::fs::write(dir.join(GAME_NOTE), json!({ "game": game }).to_string());
}

/// The look for installing.
pub fn for_install(asked: Option<&str>) -> Value {
    if let Some(l) = asked.and_then(|t| by_name(t, "asked")) { return l; }
    if let Ok(exe) = std::env::current_exe() {
        let name = exe.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        if let Some(l) = in_text(&name, "file") { return l; }
        if let Some(l) = download_source(&exe).iter().find_map(|t| in_text(t, "link")) { return l; }
    }
    from_app().unwrap_or_else(default)
}

/// The look for repair and uninstall.
pub fn for_maintenance(asked: Option<&str>) -> Value {
    asked.and_then(|t| by_name(t, "asked")).or_else(from_app).unwrap_or_else(default)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn theme(v: Option<Value>) -> String { v.map(|v| v["theme"].as_str().unwrap_or("").to_string()).unwrap_or_default() }

    #[test]
    fn only_a_named_setup_picks_a_game() {
        assert_eq!(named_game(&in_text("gachamod-setup-zzz.exe", "file").unwrap()).as_deref(), Some("zzz"));
        assert_eq!(named_game(&by_name("genshin", "asked").unwrap()).as_deref(), Some("gi"));
        assert_eq!(named_game(&default()), None);
        assert_eq!(named_game(&by_name("default", "asked").unwrap()), None);
        let mut app = in_text("gachamod-setup-zzz.exe", "file").unwrap();
        app["source"] = json!("app");
        assert_eq!(named_game(&app), None);
    }

    #[test]
    fn names_in_file_names_and_links() {
        assert_eq!(theme(in_text("gachamod-setup-zzz.exe", "t")), "zzz");
        assert_eq!(theme(in_text("gachamod-setup-genshin (1).exe", "t")), "gi");
        assert_eq!(theme(in_text("gachamod-setup (WuWa).exe", "t")), "ww");
        assert_eq!(theme(in_text("Gachamod Star-Rail setup.exe", "t")), "hsr");
        assert_eq!(theme(in_text("https://example.com/get?theme=endfield", "t")), "ef");
        assert_eq!(theme(in_text("https://example.com/get?game=hi3", "t")), "default");
        assert_eq!(theme(in_text("https://example.com/?theme=clay", "t")), "clay");
        assert_eq!(theme(in_text("gachamod_0.1.1_x64-setup.exe", "t")), "");
        assert_eq!(theme(in_text("gachamod-setup.exe", "t")), "");
        // short words count only on their own
        assert_eq!(theme(in_text("https://example.com/reference/effects", "t")), "");
    }

    #[test]
    fn percent_decoding() {
        assert_eq!(decode("attachment%3B%20filename%3Dgachamod-setup-zzz.exe"), "attachment; filename=gachamod-setup-zzz.exe");
        assert_eq!(decode("100%"), "100%");
    }
}
