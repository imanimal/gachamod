//! Other names for characters, and matching any text (a folder name, an archive name, a name in an optimizer export)
//! to a character of the game's roster. Owner: LIBRARY area (docs/spec.md, "Characters").
//!
//! The roster comes from GameBanana at runtime (library::characters_sync). The tables in `data/characters/<game>.json`
//! add what a folder or an export might call a character instead: nicknames ("Ei" for Raiden Shogun), in-game file
//! names ("Anbi"), optimizer keys ("TopazAndNumby"), in-game ids (HSR "1205") and names in other languages. Names
//! that only differ in spaces, case or punctuation ("HuTao", "hu_tao", "Hu-Tao") match without being listed, so a
//! character the table doesn't know yet still matches by its roster name.
//!
//! Matching a hint, best first: the whole hint equals a name; a name's words appear in a row among the hint's words
//! ("Raiden_Ei_Bikini" has "Ei"); a name of 5 letters or more appears inside the hint ("ellenjoebunny"); one word of a
//! roster name of 4 letters or more is a word of the hint ("Ellen" for "Ellen Joe"). Short names (3 letters or less)
//! only ever match as whole words, so "Ei" never matches inside "Eight". Longer matches beat shorter ones.

use serde::Deserialize;
use std::collections::HashMap;
use std::sync::OnceLock;

const DATA: &[(&str, &str)] = &[
    ("gi", include_str!("../data/characters/gi.json")),
    ("hsr", include_str!("../data/characters/hsr.json")),
    ("zzz", include_str!("../data/characters/zzz.json")),
    ("ww", include_str!("../data/characters/ww.json")),
    ("hi3", include_str!("../data/characters/hi3.json")),
    ("ef", include_str!("../data/characters/ef.json")),
    ("pgr", include_str!("../data/characters/pgr.json")),
    ("at", include_str!("../data/characters/at.json")),
];

/// One character in a game's table.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct Entry {
    /// GameBanana's category name, as far as it was known when the table was written.
    pub name: String,
    /// In-game ids that exports use (HSR "1205", GI "10000052").
    pub ids: Vec<String>,
    /// Other names.
    pub aka: Vec<String>,
}

/// Several characters one name stands for: "Traveler" is Aether or Lumine.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct Group {
    pub name: String,
    pub members: Vec<String>,
    pub aka: Vec<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct Table {
    pub groups: Vec<Group>,
    /// Roster names that aren't characters ("NPCs & Entities"): nothing matches them.
    pub skip: Vec<String>,
    pub characters: Vec<Entry>,
}

/// The table of a game (empty for games without one).
pub fn table(game: &str) -> &'static Table {
    static ALL: OnceLock<HashMap<&'static str, Table>> = OnceLock::new();
    static EMPTY: OnceLock<Table> = OnceLock::new();
    let all = ALL.get_or_init(|| DATA.iter().map(|(g, text)| (*g, serde_json::from_str(text).unwrap_or_default())).collect());
    all.get(game).unwrap_or_else(|| EMPTY.get_or_init(Table::default))
}

/// Games that have a table.
pub fn games() -> impl Iterator<Item = &'static str> { DATA.iter().map(|(g, _)| *g) }

// ── text ──

/// Letters and digits only, lower case: "Hu-Tao" -> "hutao".
pub fn norm(s: &str) -> String { s.chars().filter(|c| c.is_alphanumeric()).flat_map(|c| c.to_lowercase()).collect() }

/// Words of a name, split at anything that isn't a letter or digit, where a lower case letter meets an upper case
/// one ("EllenJoe_bunny" -> ellen, joe, bunny) and before the last capital of a run that starts a word
/// ("DHILMidsummer" -> dhil, midsummer; "NPCs" stays one word).
pub fn tokens(s: &str) -> Vec<String> {
    let chars: Vec<char> = s.chars().collect();
    let mut out = Vec::new();
    let mut cur: Vec<char> = Vec::new();
    let flush = |cur: &mut Vec<char>, out: &mut Vec<String>| {
        if !cur.is_empty() { out.push(cur.iter().flat_map(|c| c.to_lowercase()).collect()); cur.clear(); }
    };
    for (i, &c) in chars.iter().enumerate() {
        if !c.is_alphanumeric() { flush(&mut cur, &mut out); continue; }
        if let Some(&p) = cur.last() {
            if c.is_uppercase() && (p.is_lowercase() || p.is_numeric()) {
                flush(&mut cur, &mut out);
            } else if c.is_lowercase() && p.is_uppercase() && cur.len() >= 2 && cur[cur.len() - 2].is_uppercase()
                && chars.get(i + 1).is_some_and(|n| n.is_lowercase()) {
                let last = cur.pop().unwrap();
                flush(&mut cur, &mut out);
                cur.push(last);
            }
        }
        cur.push(c);
    }
    flush(&mut cur, &mut out);
    out
}

/// How long a name is for matching: a Latin letter or digit counts 1, any other character 2 ("胡桃" is 4).
fn weight(n: &str) -> usize { n.chars().map(|c| if c.is_ascii() { 1 } else { 2 }).sum() }

// ── matching ──

/// Words of names that are everyday words in mod names too ("Even Bigger Pan Mod" is not Ben Bigger's). Whole names
/// still match.
const COMMON: &[&str] = &[
    "white", "black", "king", "queen", "bigger", "wheel", "flint", "star", "moon", "snow", "rose", "lord", "lady",
    "doctor", "dragon", "angel", "demon", "girl", "summer", "winter", "night", "light", "dark", "fire", "water", "maid",
    "wolf", "bunny", "gold", "golden", "silver", "shadow", "default", "outfit", "knight", "dream", "heart", "flower",
    "sword", "pink", "mods", "skin", "body", "dress", "hair", "face", "young", "little", "great", "grand", "prince",
    "princess", "master", "miss", "sister", "brother", "father", "mother", "sweet", "pure", "holy", "blood",
];

/// A name to look for, pointing at a target (a roster name).
struct Needle { target: usize, toks: Vec<String>, norm: String, w: usize }

/// Matches text against one game's roster and table. Build it once per scan.
pub struct Matcher {
    targets: Vec<String>,
    exact: HashMap<String, usize>,
    /// first word -> needles starting with it
    runs: HashMap<String, Vec<usize>>,
    needles: Vec<Needle>,
    /// needles long enough to be found inside a longer word
    inside: Vec<usize>,
    /// a word of a roster name (4 letters or more) -> (target, weight)
    parts: HashMap<String, Vec<(usize, usize)>>,
    /// roster name words of 5 letters or more, found inside a word
    part_inside: Vec<(String, usize, usize)>,
    ids: HashMap<String, usize>,
    groups: HashMap<String, Vec<usize>>,
}

impl Matcher {
    /// A matcher for `game` over `roster` (the game's character names, from GameBanana). Table characters the
    /// roster doesn't have are matched under the table's name.
    pub fn new(game: &str, roster: &[String]) -> Matcher { Matcher::build(Some(table(game)), roster) }

    /// Only the roster names, no table.
    pub fn plain(roster: &[String]) -> Matcher { Matcher::build(None, roster) }

    fn build(table: Option<&Table>, roster: &[String]) -> Matcher {
        let mut m = Matcher {
            targets: Vec::new(), exact: HashMap::new(), runs: HashMap::new(), needles: Vec::new(), inside: Vec::new(),
            parts: HashMap::new(), part_inside: Vec::new(), ids: HashMap::new(), groups: HashMap::new(),
        };
        let skip: Vec<String> = table.map(|t| t.skip.iter().map(|s| norm(s)).collect()).unwrap_or_default();
        let mut by_norm: HashMap<String, usize> = HashMap::new();
        for r in roster {
            let n = norm(r);
            if n.is_empty() || skip.contains(&n) || by_norm.contains_key(&n) { continue; }
            by_norm.insert(n, m.targets.len());
            m.targets.push(r.trim().to_string());
        }
        // every roster name is a needle, with its words as parts
        for t in 0..m.targets.len() {
            let name = m.targets[t].clone();
            m.add(t, &name);
            m.add_parts(t, &name);
        }
        let Some(table) = table else { m.drop_shared_parts(); return m };
        for e in &table.characters {
            let names: Vec<&String> = std::iter::once(&e.name).chain(e.aka.iter()).collect();
            let found = names.iter().find_map(|n| by_norm.get(&norm(n)).copied());
            let t = match found {
                Some(t) => t,
                None => {
                    let n = norm(&e.name);
                    if n.is_empty() || skip.contains(&n) { continue; }
                    let t = m.targets.len();
                    m.targets.push(e.name.trim().to_string());
                    by_norm.insert(n, t);
                    m.add_parts(t, &e.name);
                    t
                }
            };
            for n in names { m.add(t, n); }
            for id in &e.ids { m.ids.entry(id.trim().to_ascii_lowercase()).or_insert(t); }
        }
        for g in &table.groups {
            let members: Vec<usize> = g.members.iter().filter_map(|n| by_norm.get(&norm(n)).copied()).collect();
            if members.is_empty() { continue; }
            for n in std::iter::once(&g.name).chain(g.aka.iter()) {
                let k = norm(n);
                if !k.is_empty() { m.groups.entry(k).or_insert_with(|| members.clone()); }
            }
        }
        m.drop_shared_parts();
        m
    }

    /// A word that is part of several names ("Kamisato", "Kaslana", "Soldier") says nothing about which one.
    fn drop_shared_parts(&mut self) {
        self.parts.retain(|_, v| v.len() == 1);
        let mut count: HashMap<String, std::collections::HashSet<usize>> = HashMap::new();
        for (p, t, _) in &self.part_inside { count.entry(p.clone()).or_default().insert(*t); }
        self.part_inside.retain(|(p, _, _)| count.get(p).is_some_and(|s| s.len() == 1));
    }

    fn add(&mut self, target: usize, name: &str) {
        let n = norm(name);
        if n.is_empty() { return; }
        // the first target to claim a name keeps it
        if self.exact.get(&n).is_some_and(|&t| t != target) { return; }
        let toks = tokens(name);
        if toks.is_empty() || self.needles.iter().any(|x| x.target == target && x.norm == n) { return; }
        let w = weight(&n);
        let i = self.needles.len();
        self.exact.entry(n.clone()).or_insert(target);
        self.runs.entry(toks[0].clone()).or_default().push(i);
        if w >= 5 && !n.chars().all(|c| c.is_ascii_digit()) { self.inside.push(i); }
        self.needles.push(Needle { target, toks, norm: n, w });
    }

    fn add_parts(&mut self, target: usize, name: &str) {
        for p in tokens(name) {
            let w = weight(&p);
            if w < 4 || p.chars().all(|c| c.is_ascii_digit()) || COMMON.contains(&p.as_str()) { continue; }
            let list = self.parts.entry(p.clone()).or_default();
            if !list.iter().any(|(t, _)| *t == target) { list.push((target, w)); }
            if w >= 5 { self.part_inside.push((p, target, w)); }
        }
    }

    /// The best match for one hint with its score (0 when nothing matches).
    fn score(&self, hint: &str) -> Option<(usize, usize)> {
        let hn = norm(hint);
        if hn.is_empty() { return None; }
        let toks = tokens(hint);
        // "Yixuan on Lucia", "Valeriy over Varka": a look put over another character is that character's mod
        if let Some(i) = toks.iter().rposition(|t| matches!(t.as_str(), "over" | "on" | "as")) {
            if i > 0 && i + 1 < toks.len() {
                if let Some(r) = self.score(&toks[i + 1..].join(" ")).filter(|r| r.0 >= 200) { return Some(r); }
            }
        }
        let mut best: Option<(usize, usize)> = None;
        let mut offer = |score: usize, t: usize| { if best.is_none_or(|(b, _)| score > b) { best = Some((score, t)); } };
        if let Some(&t) = self.exact.get(&hn) { offer(1000 + weight(&hn), t); }
        let mut runs: Vec<&str> = Vec::new();
        for (i, tok) in toks.iter().enumerate() {
            for &ni in self.runs.get(tok).map(Vec::as_slice).unwrap_or(&[]) {
                let nd = &self.needles[ni];
                if toks.len() - i >= nd.toks.len() && toks[i..i + nd.toks.len()] == nd.toks[..] { offer(500 + nd.w, nd.target); runs.push(&nd.norm); }
            }
        }
        for &ni in &self.inside {
            let nd = &self.needles[ni];
            if hn.len() > nd.norm.len() && hn.contains(nd.norm.as_str()) {
                // "DanHengPTMod" holds "Dan Heng" as words and "Dan Heng PT" inside: the longer name is meant
                let longer = runs.iter().any(|r| nd.norm.len() > r.len() && nd.norm.contains(r));
                offer(if longer { 500 } else { 200 } + nd.w, nd.target);
            }
        }
        for tok in &toks {
            for &(t, w) in self.parts.get(tok).map(Vec::as_slice).unwrap_or(&[]) { offer(w + 1, t); }
        }
        for (p, t, w) in &self.part_inside {
            if hn.contains(p.as_str()) { offer(*w, *t); }
        }
        best
    }

    /// The best character for some hints, with its score: 1000+ the whole hint is a name, 500+ a name's words are in
    /// it, 200+ a name is inside it, below that a word of a name. On a tie the earlier hint wins.
    pub fn best_scored(&self, hints: &[&str]) -> Option<(String, usize)> {
        let mut best: Option<(usize, usize)> = None;
        for h in hints {
            if let Some((s, t)) = self.score(h) { if best.is_none_or(|(b, _)| s > b) { best = Some((s, t)); } }
        }
        best.map(|(s, t)| (self.targets[t].clone(), s))
    }

    /// The best character for some hints (folder names from Mods down, a mod name), or None.
    pub fn best(&self, hints: &[&str]) -> Option<String> { self.best_scored(hints).map(|(n, _)| n) }

    /// The character whose name or other name is exactly this (any case, spaces and punctuation ignored).
    pub fn exact(&self, s: &str) -> Option<String> { self.exact.get(&norm(s)).map(|&t| self.targets[t].clone()) }

    /// The character with this in-game id ("1205", "10000052").
    pub fn by_id(&self, id: &str) -> Option<String> { self.ids.get(&id.trim().to_ascii_lowercase()).map(|&t| self.targets[t].clone()) }

    /// The characters a group name stands for ("TravelerAnemo" -> Aether and Lumine).
    pub fn group(&self, s: &str) -> Option<Vec<String>> {
        self.groups.get(&norm(s)).map(|v| v.iter().map(|&t| self.targets[t].clone()).collect())
    }

    /// Every character this matcher knows (the roster first, then table characters the roster doesn't have).
    pub fn names(&self) -> &[String] { &self.targets }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roster(names: &[&str]) -> Vec<String> { names.iter().map(|s| s.to_string()).collect() }

    #[test]
    fn every_table_reads_and_no_name_points_two_ways() {
        for g in games() {
            let t = table(g);
            assert!(!t.characters.is_empty(), "{g} has no characters");
            let mut seen: HashMap<String, String> = HashMap::new();
            for e in &t.characters {
                assert!(!e.name.trim().is_empty(), "{g}: a character without a name");
                for n in std::iter::once(&e.name).chain(e.aka.iter()) {
                    let k = norm(n);
                    assert!(!k.is_empty(), "{g}: an empty other name for {}", e.name);
                    if let Some(other) = seen.insert(k.clone(), e.name.clone()) {
                        assert_eq!(other, e.name, "{g}: \"{n}\" stands for both {other} and {}", e.name);
                    }
                }
            }
            let mut ids: HashMap<String, String> = HashMap::new();
            for e in &t.characters {
                for id in &e.ids {
                    if let Some(other) = ids.insert(id.clone(), e.name.clone()) { panic!("{g}: id {id} is both {other} and {}", e.name); }
                }
            }
            for gr in &t.groups {
                for m in &gr.members { assert!(t.characters.iter().any(|e| &e.name == m), "{g}: group {} names {m}, who isn't in the table", gr.name); }
            }
        }
    }

    #[test]
    fn nicknames_and_spellings_hit() {
        let gi = Matcher::new("gi", &roster(&["Raiden Shogun", "Hu Tao", "Lumine", "Aether", "Kamisato Ayaka", "Kaedehara Kazuha", "Jean"]));
        for h in ["Ei", "Raiden", "Baal", "RaidenShogun", "Shougun", "Ei_Bikini", "raiden ei swimsuit", "雷电将军", "雷電将軍_水着"] {
            assert_eq!(gi.best(&[h]).as_deref(), Some("Raiden Shogun"), "{h}");
        }
        for h in ["HuTao", "hu_tao", "Hu-Tao", "hutao_maid", "HuTaoMaid", "胡桃"] { assert_eq!(gi.best(&[h]).as_deref(), Some("Hu Tao"), "{h}"); }
        assert_eq!(gi.best(&["traveler (female)"]).as_deref(), Some("Lumine"));
        assert_eq!(gi.best(&["PlayerBoy"]).as_deref(), Some("Aether"));
        assert_eq!(gi.best(&["Qin"]).as_deref(), Some("Jean"));
        assert_eq!(gi.best(&["KamisatoAyaka"]).as_deref(), Some("Kamisato Ayaka"));
        // a table character the roster doesn't list yet still matches, under the table's name
        assert_eq!(gi.best(&["Scaramouche"]).as_deref(), Some("Wanderer"));

        let hsr = Matcher::new("hsr", &roster(&["Dan Heng", "Dan Heng Imbibitor Lunae", "March 7th", "Caelus", "Stelle", "Topaz"]));
        assert_eq!(hsr.best(&["Dan Heng IL"]).as_deref(), Some("Dan Heng Imbibitor Lunae"));
        assert_eq!(hsr.best(&["DHIL swimsuit"]).as_deref(), Some("Dan Heng Imbibitor Lunae"));
        assert_eq!(hsr.best(&["Dan Heng Imbibitor Lunae Skin"]).as_deref(), Some("Dan Heng Imbibitor Lunae"));
        assert_eq!(hsr.best(&["Dan Heng Casual"]).as_deref(), Some("Dan Heng"));
        assert_eq!(hsr.best(&["March 7th (Hunt)"]).as_deref(), Some("March 7th"));
        assert_eq!(hsr.best(&["march7"]).as_deref(), Some("March 7th"));
        assert_eq!(hsr.by_id("1205").as_deref(), Some("Blade"));
        assert_eq!(hsr.by_id("8006").as_deref(), Some("Stelle"));
        assert_eq!(hsr.exact("TopazAndNumby").as_deref(), Some("Topaz"));
        assert_eq!(hsr.group("TrailblazerHarmony"), Some(vec!["Caelus".to_string(), "Stelle".to_string()]));

        let zzz = Matcher::new("zzz", &roster(&["Anby Demara", "Soldier 0 Anby", "Nekomiya Mana", "Ellen Joe", "Wise", "Belle", "Alexandrina Sebastiane"]));
        assert_eq!(zzz.best(&["Anbi"]).as_deref(), Some("Anby Demara"));
        assert_eq!(zzz.best(&["Anby"]).as_deref(), Some("Anby Demara"));
        assert_eq!(zzz.best(&["Soldier0Anby"]).as_deref(), Some("Soldier 0 Anby"));
        assert_eq!(zzz.best(&["S0 Anby Coat"]).as_deref(), Some("Soldier 0 Anby"));
        assert_eq!(zzz.best(&["Nekomata"]).as_deref(), Some("Nekomiya Mana"));
        assert_eq!(zzz.best(&["Rina Maid"]).as_deref(), Some("Alexandrina Sebastiane"));
        assert_eq!(zzz.best(&["Miyabi"]).as_deref(), Some("Hoshimi Miyabi"));

        let ww = Matcher::new("ww", &roster(&["Rover Female", "Rover Male", "Jinhsi", "NPCs & Entities"]));
        assert_eq!(ww.best(&["RoverFemale"]).as_deref(), Some("Rover Female"));
        assert_eq!(ww.best(&["Female Rover Dress"]).as_deref(), Some("Rover Female"));
        assert_eq!(ww.best(&["Jinxi"]).as_deref(), Some("Jinhsi"));
        assert_eq!(ww.best(&["NPCs"]), None);
        assert_eq!(ww.by_id("1502").as_deref(), Some("Rover Female"));
    }

    #[test]
    fn near_misses_stay_misses() {
        let gi = Matcher::new("gi", &roster(&["Raiden Shogun", "Hu Tao", "Xiao", "Kujou Sara"]));
        // short names only match as whole words
        for h in ["Eight", "Eileen", "Reina", "Weird Hat", "Character", "Mods", "Others", "Sarah Dress", "Xiaomi Theme"] {
            assert_eq!(gi.best(&[h]), None, "{h}");
        }
        assert_eq!(gi.best(&["ei"]).as_deref(), Some("Raiden Shogun"));
        let zzz = Matcher::new("zzz", &roster(&["Ben Bigger", "Seed", "Wise"]));
        for h in ["Bench", "Benny", "Seeds of", "otherwise", "Soldier"] { assert_eq!(zzz.best(&[h]), None, "{h}"); }
        // a short name alone is fine
        assert_eq!(zzz.best(&["Ben"]).as_deref(), Some("Ben Bigger"));
        // ids never match folder names
        let hsr = Matcher::new("hsr", &roster(&["Blade"]));
        assert_eq!(hsr.best(&["Mod 1205"]), None);
    }

    #[test]
    fn words_split_like_people_write_them() {
        assert_eq!(tokens("EllenJoe_bunny"), ["ellen", "joe", "bunny"]);
        assert_eq!(tokens("DHILMidsummer"), ["dhil", "midsummer"]);
        assert_eq!(tokens("DanHengPTMod"), ["dan", "heng", "pt", "mod"]);
        assert_eq!(tokens("NPCs v2"), ["npcs", "v2"]);
        assert_eq!(tokens("Raiden2Bikini"), ["raiden2", "bikini"]);
        let hsr = Matcher::new("hsr", &roster(&["Dan Heng", "Dan Heng Imbibitor Lunae", "Dan Heng Permansor Terrae"]));
        assert_eq!(hsr.best(&["DHILMidsummer"]).as_deref(), Some("Dan Heng Imbibitor Lunae"));
        assert_eq!(hsr.best(&["DanHengPTMod"]).as_deref(), Some("Dan Heng Permansor Terrae"));
        assert_eq!(hsr.best(&["DanHengCasual"]).as_deref(), Some("Dan Heng"));
        let zzz = Matcher::new("zzz", &roster(&["Yixuan", "Lucia Elowen", "Ben Bigger", "Pan Yinhu"]));
        assert_eq!(zzz.best(&["Yixuan On Lucia"]).as_deref(), Some("Lucia Elowen"));
        assert_eq!(zzz.best(&["Even Bigger Pan Mod"]), None);
        assert_eq!(zzz.best(&["Yixuan on the beach"]).as_deref(), Some("Yixuan"));
    }

    #[test]
    fn longer_and_whole_matches_win() {
        let zzz = Matcher::new("zzz", &roster(&["Jane Doe", "Ellen Joe", "Trigger"]));
        assert_eq!(zzz.best(&["Jane", "Ellen Joe"]).as_deref(), Some("Ellen Joe"));
        assert_eq!(zzz.best(&["Ellen Joe Trigger Happy"]).as_deref(), Some("Ellen Joe"));
        let plain = Matcher::plain(&roster(&["Ellen Joe", "Hoshimi Miyabi"]));
        assert_eq!(plain.best(&["ellen_joe_bunny"]).as_deref(), Some("Ellen Joe"));
        assert_eq!(plain.best(&["soulvesselmiyabi"]).as_deref(), Some("Hoshimi Miyabi"));
    }

    /// Hit rate on real folder names. Not run by default: it needs a sample file (lines "game, expected character,
    /// kind, name" separated by tabs) in GACHAMOD_ALIAS_SAMPLE and GameBanana rosters ("<game>.json", a list of
    /// [category id, name, count]) in GACHAMOD_ROSTERS. Run with `cargo test -p gacha-core sample -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn sample_hit_rate() {
        let (Ok(sample), Ok(rosters)) = (std::env::var("GACHAMOD_ALIAS_SAMPLE"), std::env::var("GACHAMOD_ROSTERS")) else { return };
        let text = std::fs::read_to_string(sample).unwrap();
        let mut matchers: HashMap<String, (Matcher, Matcher)> = HashMap::new();
        // (game, kind) -> [right, wrong, none]
        let mut stats: std::collections::BTreeMap<(String, String), [u32; 3]> = Default::default();
        let mut wrong: Vec<String> = Vec::new();
        let mut none: Vec<String> = Vec::new();
        for line in text.lines() {
            let f: Vec<&str> = line.split('\t').collect();
            let [game, expected, kind, name] = f[..] else { continue };
            let (m, plain) = matchers.entry(game.to_string()).or_insert_with(|| {
                let raw = std::fs::read_to_string(format!("{rosters}/{game}.json")).unwrap();
                let list: Vec<(u64, String, u64)> = serde_json::from_str(&raw).unwrap();
                let names: Vec<String> = list.into_iter().map(|r| r.1).collect();
                (Matcher::new(game, &names), Matcher::plain(&names))
            });
            let got = m.best(&[crate::library::display_folder(name)]);
            let s = stats.entry((game.to_string(), kind.to_string())).or_default();
            match &got {
                Some(g) if norm(g) == norm(expected) => s[0] += 1,
                Some(g) => { s[1] += 1; wrong.push(format!("{game} {kind}: {name:?} -> {g} (want {expected})")); }
                None => { s[2] += 1; if kind == "folder" { none.push(format!("{game}: {name:?} (want {expected})")); } }
            }
            // what the old rules (no table) would say, for comparison
            let old = plain.best(&[crate::library::display_folder(name)]);
            let o = stats.entry((game.to_string(), format!("{kind} (no table)"))).or_default();
            match old { Some(g) if norm(&g) == norm(expected) => o[0] += 1, Some(_) => o[1] += 1, None => o[2] += 1 }
        }
        for ((game, kind), [r, w, n]) in &stats {
            let all = (r + w + n).max(1) as f64;
            println!("{game:4} {kind:20} right {r:4} ({:5.1}%)  wrong {w:3} ({:4.1}%)  none {n:4}", *r as f64 * 100.0 / all, *w as f64 * 100.0 / all);
        }
        for w in &wrong { println!("{w}"); }
        if std::env::var("GACHAMOD_ALIAS_SHOW_NONE").is_ok() { for n in &none { println!("none {n}"); } }
    }
}
