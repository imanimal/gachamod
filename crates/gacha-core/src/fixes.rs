//! Mod fixes after a game update. An update changes the hashes (and sometimes the buffer layouts) that mods target,
//! and the community's fixers rewrite the mods. `data/fixes/<game>.json` holds those fixers' hash tables and rules
//! (docs/fixers.md says what each field means). This finds installed mods that still use a hash an update replaced
//! and swaps it for the new one: the old line stays as a comment and the files get a backup, so Undo puts them back.
//!
//! Only hash swaps are done here. When a mod also needs a buffer rewrite or moved index ranges (a rule's trigger hash
//! is in it), the hash swap alone would leave it broken, so it is marked as needing the fixer that does the whole job
//! and left alone. Owner: FIXES area.

use crate::aliases::Matcher;
use crate::backups::{self, Backup};
use crate::db::Db;
use crate::error::{Error, Result};
use crate::keys::{ModBackup, ModSkip};
use crate::model::ModEntry;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

const DATA: &[(&str, &str)] = &[
    ("zzz", include_str!("../data/fixes/zzz.json")),
    ("ww", include_str!("../data/fixes/ww.json")),
    ("hsr", include_str!("../data/fixes/hsr.json")),
    ("gi", include_str!("../data/fixes/gi.json")),
    ("ef", include_str!("../data/fixes/ef.json")),
];

/// The comment a swapped hash line keeps: `; hash = <old> (before <version>, changed by gachamod)`.
const MARK: &str = "changed by gachamod";

// ── what the app shows ──

/// A community fixer the data comes from, or one the app links to.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Source {
    pub id: String,
    pub name: String,
    pub author: String,
    pub url: String,
    pub license: String,
    /// When the data was checked against the fixer ("2026-11-13").
    pub checked: String,
    /// What the app took from it ("data and rules", "NOT used ...").
    pub used: String,
}

/// A fixer to run by hand: its name and page.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolLink { pub name: String, pub url: String }

/// What a game update did to one installed mod. Mods with nothing known wrong are left out.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModHealth {
    pub mod_id: String,
    pub name: String,
    pub enabled: bool,
    /// "broken" (hashes gachamod can swap), "unfixable" (needs a fixer gachamod can't run) or "fixed" (gachamod
    /// swapped its hashes and nothing else is known wrong).
    pub status: String,
    /// One line each: "Uses Belle's Body Blend hash from before 1.1".
    pub reasons: Vec<String>,
    /// The oldest game version a broken hash comes from.
    pub since: Option<String>,
    /// The fixer to run for an "unfixable" mod.
    pub tool: Option<ToolLink>,
    /// How many hash lines a fix would change.
    pub swaps: u32,
    /// The game changed the model itself, so no fixer can repair the mod: it needs an update from its author.
    pub needs_author: bool,
    /// The last fixer run on it that left it broken.
    pub tried: Option<Tried>,
}

/// A fixer run that didn't fix a mod.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Tried {
    /// The fixer's name ("ZZZ Mod Fixer").
    pub tool: String,
    pub at: i64,
    /// Files it changed. 0: it found nothing in the mod it knows how to fix.
    pub changed: u32,
}

/// What the fix data holds for a game, for Tools > Fixes.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FixInfo {
    pub game: String,
    /// The newest game version the data knows ("3.3"; HSR says "unknown ...").
    pub current_version: String,
    /// Hash pairs gachamod can swap.
    pub pairs: u32,
    pub sources: Vec<Source>,
}

/// The result of fixing several mods: one backup per changed mod (Undo restores them) and why others were left.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FixAll { pub changed: Vec<ModBackup>, pub skipped: Vec<ModSkip> }

// ── the data ──

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct RawFile { current_version: String, sources: Vec<Source>, versions: Vec<RawBlock> }

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct RawBlock { version: String, hashes: Vec<RawPair>, rules: Vec<Value> }

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct RawPair { old: String, new: String, character: String, part: String, kind: String, also: Vec<String>, current: bool }

/// One `old -> new` pair. `rank` orders the versions: chains only move to later ones, so a hash that came back in a
/// later version can't loop.
#[derive(Debug, Clone)]
struct Step { new: String, rank: usize, version: String, character: String, also: Vec<String>, part: String, kind: String }

/// A change that needs more than a hash swap, and how to spot a mod that needs it.
#[derive(Debug, Clone)]
struct Rule {
    character: String,
    /// Old hashes: a mod that has one needs this change.
    triggers: Vec<String>,
    /// Old `match_first_index` / `match_index_count` values for the rule's character (WW): (key prefix, values).
    lines: Option<(String, Vec<String>)>,
    version: String,
    tool: String,
    /// The model itself changed: a mod with a trigger hash needs remaking by its author.
    model: bool,
}

struct Index {
    current_version: String,
    sources: Vec<Source>,
    steps: HashMap<String, Vec<Step>>,
    /// Hashes the newest table lists as live (ZZZ): never broken.
    current: HashSet<String>,
    rules: Vec<Rule>,
    pairs: u32,
}

fn hex8(s: &str) -> Option<String> {
    let s = s.trim().trim_start_matches("0x").to_ascii_lowercase();
    (s.len() == 8 && s.chars().all(|c| c.is_ascii_hexdigit())).then_some(s)
}

fn strings(v: Option<&Value>) -> Vec<String> {
    match v {
        Some(Value::String(s)) => vec![s.clone()],
        Some(Value::Array(a)) => a.iter().filter_map(|x| x.as_str().map(String::from)).collect(),
        _ => vec![],
    }
}

impl Index {
    fn build(text: &str) -> Index {
        let raw: RawFile = serde_json::from_str(text).unwrap_or_default();
        let mut ranks: Vec<String> = Vec::new();
        let mut idx = Index {
            current_version: raw.current_version, sources: raw.sources, steps: HashMap::new(),
            current: HashSet::new(), rules: Vec::new(), pairs: 0,
        };
        for b in &raw.versions {
            if !ranks.contains(&b.version) { ranks.push(b.version.clone()); }
        }
        for b in raw.versions {
            let rank = ranks.iter().position(|v| *v == b.version).unwrap_or(0);
            for p in b.hashes {
                let (Some(old), Some(new)) = (hex8(&p.old), hex8(&p.new)) else { continue };
                if old == new { continue; }
                if p.current { idx.current.insert(new.clone()); }
                idx.pairs += 1;
                idx.steps.entry(old).or_default().push(Step {
                    new, rank, version: b.version.clone(), character: p.character, also: p.also, part: p.part, kind: p.kind,
                });
            }
            for r in b.rules {
                let get = |k: &str| r.get(k).and_then(Value::as_str).unwrap_or_default().to_string();
                // `trigger_hash` says which mods need the change. `blend_hash` only says which buffer it rewrites, so it
                // is the trigger only for a rule that names nothing else (Belle's 1.1 remap names her position hash as
                // the buffer, and that hash stayed live until 3.0)
                let mut triggers: Vec<String> = strings(r.get("trigger_hash")).iter().filter_map(|h| hex8(h)).collect();
                if triggers.is_empty() {
                    triggers = strings(r.get("blend_hash")).iter().filter_map(|h| hex8(h)).collect();
                    if let Some(Value::Object(m)) = r.get("position_to_blend") { triggers.extend(m.keys().filter_map(|h| hex8(h))); }
                }
                let model = get("kind") == "model_change";
                // WW line value changes: only the index ranges with large old values, which can't be anything else
                let mut lines = None;
                let prefix = get("line_prefix");
                if matches!(prefix.as_str(), "match_first_index" | "match_index_count") {
                    let olds: Vec<String> = r.get("replacements").and_then(Value::as_array).into_iter().flatten()
                        .flat_map(|x| strings(x.get("old"))).collect();
                    if !olds.is_empty() && olds.iter().all(|o| o.parse::<u64>().is_ok_and(|n| n >= 1000)) { lines = Some((prefix, olds)); }
                }
                if triggers.is_empty() && lines.is_none() { continue; }
                idx.rules.push(Rule { character: get("character"), triggers, lines, version: b.version.clone(), tool: get("tool"), model });
            }
        }
        // a trigger only counts when it is an old hash: a live one would flag every mod of that character
        let olds: HashSet<String> = idx.steps.keys().cloned().collect();
        // (a model change lists hashes the game dropped, which have no new hash to be the old one of)
        for r in idx.rules.iter_mut().filter(|r| !r.model) { r.triggers.retain(|h| olds.contains(h)); }
        idx.rules.retain(|r| !r.triggers.is_empty() || r.lines.is_some());
        idx
    }

    fn get(game: &str) -> Option<&'static Index> {
        static ALL: OnceLock<HashMap<&'static str, Index>> = OnceLock::new();
        ALL.get_or_init(|| DATA.iter().map(|(g, t)| (*g, Index::build(t))).collect()).get(game)
    }

    /// A fixer's name from its link: a known source's name, else the repository's ("ZZZ Mod Fixer"). The data may say
    /// more than the link ("<link> (--rendering-33)", "<link> and <link>"): the first link is the fixer.
    fn tool_link(&self, text: &str) -> ToolLink {
        let url = text.split_whitespace().find(|w| w.starts_with("https://") || w.starts_with("http://")).unwrap_or(text.trim());
        if let Some(s) = self.sources.iter().find(|s| !s.url.is_empty() && url.trim_end_matches('/').eq_ignore_ascii_case(s.url.trim_end_matches('/'))) {
            return ToolLink { name: s.name.clone(), url: url.into() };
        }
        let last = url.trim_end_matches('/').rsplit('/').next().unwrap_or_default();
        let name = if url.contains("github.com/") && !last.is_empty() { last.replace(['-', '_'], " ") } else { "the fixer".into() };
        ToolLink { name, url: url.into() }
    }
}

// ── matching a mod ──

/// Which roster character a data name means ("Ellen Campus", "AemeathMecha"), cached per scan.
struct Who<'a> { m: &'a Matcher, cache: HashMap<String, Option<String>> }

impl<'a> Who<'a> {
    fn new(m: &'a Matcher) -> Self { Who { m, cache: HashMap::new() } }
    fn of(&mut self, name: &str) -> Option<String> {
        if let Some(c) = self.cache.get(name) { return c.clone(); }
        let r = self.m.exact(name).or_else(|| self.m.best(&[name]));
        self.cache.insert(name.into(), r.clone());
        r
    }
    fn is(&mut self, data_name: &str, character: &str) -> bool {
        self.of(data_name).is_some_and(|c| c.eq_ignore_ascii_case(character))
    }
}

/// The first step of a chain a mod's hash is on, and where the chain ends.
#[derive(Debug, Clone)]
struct Hop { new: String, version: String, rank: usize, character: String, part: String }

/// Where `h` ends up after every update the data knows, for a mod of `character` (None: unknown). None when it isn't
/// an outdated hash for this mod, or when the data can't say which way it went.
fn resolve(idx: &Index, h: &str, character: Option<&str>, who: &mut Who) -> Option<Hop> {
    if idx.current.contains(h) || !idx.steps.contains_key(h) { return None; }
    let mut ok = |s: &Step| match character {
        Some(c) => who.is(&s.character, c) || s.also.iter().any(|a| who.is(a, c)),
        // without a character only mesh hashes are safe: textures are shared and move differently per character
        None => s.kind != "texture",
    };
    let mut seen: Vec<String> = vec![h.to_string()];
    let mut cur = h.to_string();
    let mut rank: Option<usize> = None;
    let mut first: Option<Hop> = None;
    for _ in 0..64 {
        // the next update after the current one, from any hash on the chain so far (a newer source may map an earlier
        // hash straight to a later target: prefer that over stopping)
        let mut cands: Vec<(&String, &Step)> = Vec::new();
        for v in &seen {
            for s in idx.steps.get(v).into_iter().flatten() {
                if rank.is_none_or(|r| s.rank > r) && ok(s) { cands.push((v, s)); }
            }
        }
        let Some(low) = cands.iter().map(|(_, s)| s.rank).min() else { break };
        cands.retain(|(_, s)| s.rank == low);
        let mut targets: BTreeSet<&str> = cands.iter().map(|(_, s)| s.new.as_str()).collect();
        if targets.len() > 1 {
            // two answers for the same update: the one from the hash the chain is on now, if that settles it
            let here: BTreeSet<&str> = cands.iter().filter(|(v, _)| **v == cur).map(|(_, s)| s.new.as_str()).collect();
            if here.len() != 1 { return None; }
            targets = here;
        }
        let next = targets.into_iter().next()?.to_string();
        let step = cands.iter().map(|(_, s)| *s).find(|s| s.new == next)?;
        first.get_or_insert_with(|| Hop { new: String::new(), version: step.version.clone(), rank: step.rank, character: step.character.clone(), part: step.part.clone() });
        rank = Some(low);
        if !seen.contains(&next) { seen.push(next.clone()); }
        cur = next;
    }
    let mut hop = first?;
    if cur == h { return None; }
    hop.new = cur;
    Some(hop)
}

/// What is wrong with one mod folder: the swaps a fix makes (old -> hop) and the fixers it needs instead.
#[derive(Debug, Default)]
struct Check { swaps: Vec<(String, Hop)>, needs: Vec<(String, ToolLink)>, since_rank: Option<(usize, String)>, needs_author: bool }

fn check_dir(idx: &Index, dir: &Path, character: Option<&str>, who: &mut Who) -> Check {
    let facts = crate::ini::quick_facts(dir);
    let mut c = Check::default();
    let has: HashSet<&str> = facts.hashes.iter().map(String::as_str).collect();
    for h in &facts.hashes {
        // a mod that already has the new hash was fixed by adding a section (the GI 4.1 fix does that): the old one
        // left beside it is harmless, and swapping it would make two sections for one hash
        if let Some(hop) = resolve(idx, h, character, who).filter(|hop| !has.contains(hop.new.as_str())) { c.swaps.push((h.clone(), hop)); }
    }
    let mut texts: Option<Vec<String>> = None;
    for r in &idx.rules {
        let hit = if r.model {
            // a hash of the old model, in a mod of that character (or of nobody known)
            r.triggers.iter().any(|t| has.contains(t.as_str())) && character.is_none_or(|ch| who.is(&r.character, ch))
        } else if !r.triggers.is_empty() {
            // the trigger is an old hash of this mod's character, and the mod doesn't have its new hash yet
            r.triggers.iter().any(|t| has.contains(t.as_str()) && resolve(idx, t, character, who).is_some_and(|hop| !has.contains(hop.new.as_str())))
        } else if let (Some((prefix, olds)), Some(ch)) = (&r.lines, character) {
            who.is(&r.character, ch) && texts.get_or_insert_with(|| ini_texts(dir)).iter().any(|t| has_line(t, prefix, olds))
        } else { false };
        if !hit { continue; }
        let tool = idx.tool_link(&r.tool);
        let who_s = if r.character.is_empty() || r.character.starts_with("all") || r.character.starts_with("see ") { String::new() } else { format!("{}'s ", r.character) };
        let why = if r.model {
            c.needs_author = true;
            format!("The {} update changed {}model, so this mod needs an update from its author", r.version, if who_s.is_empty() { "the ".into() } else { who_s })
        } else {
            format!("Needs {} for {who_s}{} change", tool.name, r.version)
        };
        if c.needs.iter().any(|(w, _)| *w == why) { continue; }
        // the model change goes first: it is why nothing else will fix the mod
        if r.model { c.needs.insert(0, (why, tool)); } else { c.needs.push((why, tool)); }
    }
    for (_, hop) in &c.swaps {
        if c.since_rank.as_ref().is_none_or(|(r, _)| hop.rank < *r) { c.since_rank = Some((hop.rank, hop.version.clone())); }
    }
    c
}

fn ini_texts(dir: &Path) -> Vec<String> {
    crate::ini::mod_inis(dir).into_iter()
        .filter(|(p, _)| std::fs::metadata(p).is_ok_and(|m| m.len() < 4 * 1024 * 1024))
        .filter_map(|(p, _)| std::fs::read(p).ok().map(|b| crate::ini::decode(&b)))
        .collect()
}

/// A live `<prefix>... = <one of olds>` line.
fn has_line(text: &str, prefix: &str, olds: &[String]) -> bool {
    text.lines().any(|l| {
        let t = l.trim();
        if t.starts_with(';') { return false; }
        let Some((k, v)) = t.split_once('=') else { return false };
        k.trim().to_ascii_lowercase().starts_with(prefix) && olds.iter().any(|o| o == v.trim())
    })
}

fn reasons(c: &Check) -> Vec<String> {
    let mut out: Vec<String> = c.needs.iter().map(|(w, _)| w.clone()).collect();
    let mut seen = HashSet::new();
    for (_, hop) in &c.swaps {
        let part = if hop.part.is_empty() { String::new() } else { format!("{} ", hop.part) };
        let line = format!("Uses {}'s {part}hash from before {}", hop.character, hop.version);
        if seen.insert(line.clone()) { out.push(line); }
    }
    out
}

fn health_of(m: &ModEntry, c: &Check, fixed: bool, tried: &HashMap<String, Tried>) -> Option<ModHealth> {
    let since = c.since_rank.as_ref().map(|(_, v)| v.clone());
    let base = ModHealth {
        mod_id: m.id.clone(), name: m.name.clone(), enabled: m.enabled, reasons: reasons(c), since, swaps: c.swaps.len() as u32,
        needs_author: c.needs_author, tried: tried.get(&m.id).cloned(),
        ..Default::default()
    };
    // the fixer to try: the first one a rule links to
    if !c.needs.is_empty() {
        let tool = c.needs.iter().map(|(_, t)| t).find(|t| t.url.starts_with("http")).cloned();
        return Some(ModHealth { status: "unfixable".into(), tool, ..base });
    }
    if !c.swaps.is_empty() { return Some(ModHealth { status: "broken".into(), ..base }); }
    fixed.then(|| ModHealth { status: "fixed".into(), reasons: vec!["gachamod swapped its outdated hashes".into()], tried: None, ..base })
}

fn matcher(game: &str, mods: &[ModEntry]) -> Matcher {
    let roster: Vec<String> = mods.iter().filter_map(|m| m.character.clone()).collect::<BTreeSet<_>>().into_iter().collect();
    Matcher::new(game, &roster)
}

fn fixed_key(game: &str) -> String { format!("fixes.fixed.{game}") }
fn tried_key(game: &str) -> String { format!("fixes.tried.{game}") }

/// Remember that a fixer ran on a mod and how many files it changed. Health shows it for as long as the mod stays
/// broken, so "the fixer did nothing here" is still said after the toast is gone.
pub fn note_attempt(db: &Db, game: &str, mod_id: &str, tool: &str, changed: usize) -> Result<()> {
    let mut all: HashMap<String, Tried> = db.setting_json(&tried_key(game))?.unwrap_or_default();
    if all.len() > 2000 {
        // drop the older half
        let mut ats: Vec<i64> = all.values().map(|t| t.at).collect();
        ats.sort_unstable();
        let cut = ats[ats.len() / 2];
        all.retain(|_, t| t.at > cut);
    }
    all.insert(mod_id.into(), Tried { tool: tool.into(), at: crate::db::now(), changed: changed as u32 });
    db.set_setting_json(&tried_key(game), &all)
}

fn mods_of(db: &Db, game: &str) -> Result<Vec<ModEntry>> {
    match crate::library::list(db, game) { Ok(l) => Ok(l), Err(Error::Todo(_)) => Ok(Vec::new()), Err(e) => Err(e) }
}

// ── the API ──

/// The fixers and data the app has for a game.
pub fn info(game: &str) -> FixInfo {
    let Some(idx) = Index::get(game) else { return FixInfo { game: game.into(), ..Default::default() } };
    FixInfo { game: game.into(), current_version: idx.current_version.clone(), pairs: idx.pairs, sources: idx.sources.clone() }
}

/// Mods of a game (on or off) that a game update broke, or that gachamod fixed.
pub fn health(shared: &crate::db::Shared, game: &str) -> Result<Vec<ModHealth>> {
    let Some(idx) = Index::get(game) else { return Ok(vec![]) };
    // the database is held for the three reads only, not while every mod's inis are read
    let (mods, fixed, tried) = {
        let db = shared.lock().map_err(|_| Error::Db("The local database is stuck. Restart gachamod".into()))?;
        let fixed: HashSet<String> = db.setting_json::<Vec<String>>(&fixed_key(game))?.unwrap_or_default().into_iter().collect();
        let tried: HashMap<String, Tried> = db.setting_json(&tried_key(game))?.unwrap_or_default();
        (mods_of(&db, game)?, fixed, tried)
    };
    let mt = matcher(game, &mods);
    let mut who = Who::new(&mt);
    let mut out = Vec::new();
    for m in &mods {
        let dir = Path::new(&m.path);
        if !dir.is_dir() { continue; }
        let c = check_dir(idx, dir, m.character.as_deref(), &mut who);
        // "fixed" lasts while the swapped lines are there: an update from the author or an Undo takes them away
        let clean = c.swaps.is_empty() && c.needs.is_empty();
        let fixed = clean && fixed.contains(&m.id) && ini_texts(dir).iter().any(|t| t.contains(MARK));
        if let Some(h) = health_of(m, &c, fixed, &tried) { out.push(h); }
    }
    Ok(out)
}

/// Swap the outdated hashes in one mod folder. Returns the backup, or None when there was nothing to swap.
fn fix_dir(db: &Db, game: &str, m: &ModEntry, c: &Check) -> Result<Option<Backup>> {
    if c.swaps.is_empty() { return Ok(None); }
    let dir = PathBuf::from(&m.path);
    let plan: HashMap<&str, &Hop> = c.swaps.iter().map(|(o, h)| (o.as_str(), h)).collect();
    let mut docs: Vec<(String, PathBuf, crate::keys::Doc)> = Vec::new();
    for (abs, rel) in crate::ini::mod_inis(&dir) {
        let Ok(raw) = std::fs::read(&abs) else { continue };
        let mut doc = crate::keys::Doc::from_bytes(&raw);
        if swap_doc(&mut doc, &plan) > 0 { docs.push((rel, abs, doc)); }
    }
    if docs.is_empty() { return Ok(None); }
    let files: Vec<String> = docs.iter().map(|(r, ..)| r.clone()).collect();
    let n = c.swaps.len();
    let label = format!("Fixed {} for the game update ({})", m.name, if n == 1 { "1 hash".into() } else { format!("{n} hashes") });
    let b = backups::take(db, game, &m.id, &dir, &files, &label)?;
    for (_, abs, doc) in &docs {
        if let Err(e) = std::fs::write(abs, doc.to_bytes()) {
            // a file that can't be written (the game has it open): put the ones already changed back, so the mod
            // is never left half swapped
            let _ = backups::restore(db, &b.id);
            return Err(e.into());
        }
    }
    Ok(Some(b))
}

/// Replace live `hash = old` lines of TextureOverride sections, keeping each old line above as a comment.
fn swap_doc(doc: &mut crate::keys::Doc, plan: &HashMap<&str, &Hop>) -> usize {
    let mut edits: Vec<(usize, String, String)> = Vec::new();
    let mut in_override = false;
    for (i, line) in doc.lines.iter().enumerate() {
        if let Some(h) = crate::keys::header_name(line) { in_override = h.to_ascii_lowercase().starts_with("textureoverride"); continue; }
        if !in_override { continue; }
        let Some((k, v)) = crate::keys::kv(line) else { continue };
        if k != "hash" { continue; }
        let Some(old) = hex8(v) else { continue };
        let Some(hop) = plan.get(old.as_str()) else { continue };
        let indent: String = line.chars().take_while(|c| c.is_whitespace()).collect();
        edits.push((i, format!("{indent}; hash = {old} (before {}, {MARK})", hop.version), crate::keys::with_value(line, &hop.new)));
    }
    for (i, comment, new) in edits.iter().rev() {
        doc.lines[*i] = new.clone();
        doc.insert(*i, comment.clone());
    }
    edits.len()
}

/// Fix these mods (the ones with hashes gachamod can swap). Each changed mod gets its own backup.
pub fn fix(shared: &crate::db::Shared, game: &str, ids: &[String]) -> Result<FixAll> {
    let lock = || shared.lock().map_err(|_| Error::Db("The local database is stuck. Restart gachamod".into()));
    let Some(idx) = Index::get(game) else { return Ok(FixAll::default()) };
    let mods = { mods_of(&*lock()?, game)? };
    let mt = matcher(game, &mods);
    let mut who = Who::new(&mt);
    let mut out = FixAll::default();
    let mut any_on = false;
    for id in ids {
        let Some(m) = mods.iter().find(|m| m.id == *id) else { continue };
        let skip = |reason: String| ModSkip { mod_id: m.id.clone(), name: m.name.clone(), reason };
        let dir = Path::new(&m.path);
        if !dir.is_dir() { out.skipped.push(skip("Its folder isn't there any more".into())); continue; }
        let c = check_dir(idx, dir, m.character.as_deref(), &mut who);
        if let Some((why, _)) = c.needs.first() { out.skipped.push(skip(why.clone())); continue; }
        if c.swaps.is_empty() { continue; }
        match fix_dir(&*lock()?, game, m, &c) {
            Ok(Some(backup)) => { any_on |= m.loaded(); out.changed.push(ModBackup { mod_id: m.id.clone(), name: m.name.clone(), backup }); }
            // its hashes sit where a swap doesn't reach (a ShaderOverride section, a quoted value)
            Ok(None) => out.skipped.push(skip("Its outdated hashes are written in a way gachamod can't change".into())),
            Err(e) => out.skipped.push(skip(e.to_string())),
        }
    }
    if !out.changed.is_empty() {
        let d = lock()?;
        let mut fixed: Vec<String> = d.setting_json::<Vec<String>>(&fixed_key(game))?.unwrap_or_default();
        for c in &out.changed { if !fixed.contains(&c.mod_id) { fixed.push(c.mod_id.clone()); } }
        if fixed.len() > 5000 { fixed.drain(..fixed.len() - 5000); }
        d.set_setting_json(&fixed_key(game), &fixed)?;
    }
    if any_on { crate::devtools::mark_changed(game); }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn idx() -> &'static Index { Index::get("zzz").unwrap() }

    #[test]
    fn data_loads_for_every_game() {
        for (g, _) in DATA {
            let i = Index::get(g).unwrap();
            assert!(!i.sources.is_empty(), "{g} has no sources");
        }
        assert!(idx().pairs > 500);
        assert!(Index::get("ww").unwrap().pairs > 1000);
    }

    /// Blocks are ranked by where their version first appears, and a chain only moves to a later rank. A block out of
    /// order (or one with no version, which used to sit last and so counted as the newest update) sends chains to a
    /// hash that is itself outdated.
    #[test]
    fn blocks_are_listed_oldest_first() {
        for (g, text) in DATA {
            let raw: RawFile = serde_json::from_str(text).unwrap();
            let mut last = 0.0f64;
            for b in &raw.versions {
                let digits: String = b.version.chars().take_while(|c| c.is_ascii_digit() || *c == '.').collect();
                let n: f64 = digits.parse().unwrap_or_else(|_| panic!("{g}.json has a block with the version \"{}\", which can't be ordered", b.version));
                assert!(n >= last, "{g}.json lists {} after a later version", b.version);
                last = n;
            }
        }
    }

    #[test]
    fn hsr_kafka_goes_to_her_3_2_hashes() {
        let hsr = Index::get("hsr").unwrap();
        let mt = Matcher::new("hsr", &["Kafka".to_string(), "Stelle".to_string()]);
        let mut who = Who::new(&mt);
        // head and hair each keep their own chain (the assets history once listed them swapped)
        for (old, new) in [("e811b655", "07e0c801"), ("91133916", "7ee24742"), ("132595c5", "1cb6a0c8"), ("7cbe836d", "650b9edf"), ("cdda77a3", "d46f6a11")] {
            assert_eq!(resolve(hsr, old, Some("Kafka"), &mut who).map(|h| h.new).as_deref(), Some(new), "{old}");
        }
        // a hash from before 1.4 carries on through the later updates
        let end = resolve(hsr, "0a98b451", Some("Stelle"), &mut who).expect("Stelle's first body texture").new;
        assert_ne!(end, "a19a8d2c");
        assert!(resolve(hsr, &end, Some("Stelle"), &mut who).is_none(), "{end} is outdated too");
    }

    #[test]
    fn every_pair_in_the_data_is_two_hashes() {
        for (g, text) in DATA {
            let raw: RawFile = serde_json::from_str(text).unwrap_or_else(|e| panic!("{g}.json doesn't parse: {e}"));
            let bad: Vec<String> = raw.versions.iter().flat_map(|b| b.hashes.iter().map(move |p| (b, p)))
                .filter(|(_, p)| hex8(&p.old).is_none() || hex8(&p.new).is_none())
                .map(|(b, p)| format!("{} {} -> {}", b.version, p.old, p.new)).collect();
            assert!(bad.is_empty(), "{g}.json has pairs that aren't 8 hex digits and would be dropped: {bad:?}");
        }
    }

    #[test]
    fn a_chain_ends_at_the_newest_hash_and_needs_the_character() {
        let mt = Matcher::new("zzz", &["Belle".to_string(), "Ellen Joe".to_string()]);
        let mut who = Who::new(&mt);
        let hop = resolve(idx(), "d7ca821f", Some("Belle"), &mut who).expect("Belle's old body blend hash");
        assert_ne!(hop.new, "d7ca821f");
        assert_eq!(hop.character, "Belle");
        // another character's mod with the same hash is left alone
        assert!(resolve(idx(), "d7ca821f", Some("Ellen Joe"), &mut who).is_none());
        // a hash the data never saw
        assert!(resolve(idx(), "12345678", Some("Belle"), &mut who).is_none());
    }

    #[test]
    fn swaps_keep_the_old_line_and_the_rest_of_the_file() {
        let hop = Hop { new: "c92a17d8".into(), version: "1.1".into(), rank: 0, character: "Belle".into(), part: "Body Blend".into() };
        let plan: HashMap<&str, &Hop> = [("d7ca821f", &hop)].into_iter().collect();
        let text = "[TextureOverrideBelleBlend]\r\nhash = d7ca821f\r\nvb2 = ResourceBlend\r\n\r\n[ResourceBlend]\r\nhash = d7ca821f\r\n;hash = d7ca821f\r\n";
        let mut doc = crate::keys::Doc::from_bytes(text.as_bytes());
        assert_eq!(swap_doc(&mut doc, &plan), 1);
        let out = String::from_utf8(doc.to_bytes()).unwrap();
        assert_eq!(out, "[TextureOverrideBelleBlend]\r\n; hash = d7ca821f (before 1.1, changed by gachamod)\r\nhash = c92a17d8\r\nvb2 = ResourceBlend\r\n\r\n[ResourceBlend]\r\nhash = d7ca821f\r\n;hash = d7ca821f\r\n");
        // a second run finds nothing
        assert_eq!(swap_doc(&mut doc, &plan), 0);
    }

    #[test]
    fn a_mod_with_a_buffer_change_is_left_for_its_fixer() {
        let dir = std::env::temp_dir().join(format!("gachamod-fixes-{}", crate::library::new_id()));
        std::fs::create_dir_all(&dir).unwrap();
        // Ellen's 1.1 texcoord hash needs a stride change, which only ZZZ Mod Fixer does
        std::fs::write(dir.join("mod.ini"), "[TextureOverrideEllenTexcoord]\nhash = 9cddb082\n").unwrap();
        let mt = Matcher::new("zzz", &["Ellen Joe".to_string()]);
        let mut who = Who::new(&mt);
        let c = check_dir(idx(), &dir, Some("Ellen Joe"), &mut who);
        assert!(!c.needs.is_empty(), "the stride rule should fire");
        assert!(c.needs[0].1.url.contains("github.com"));
        let m = ModEntry { id: "x".into(), ..Default::default() };
        assert_eq!(health_of(&m, &c, false, &HashMap::new()).unwrap().status, "unfixable");
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn belle(ini: &str) -> (Check, PathBuf) {
        let dir = std::env::temp_dir().join(format!("gachamod-fixes-{}", crate::library::new_id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("mod.ini"), ini).unwrap();
        let mt = Matcher::new("zzz", &["Belle".to_string()]);
        let mut who = Who::new(&mt);
        let c = check_dir(idx(), &dir, Some("Belle"), &mut who);
        (c, dir)
    }

    #[test]
    fn the_buffer_a_rule_rewrites_is_not_its_trigger() {
        // Belle's 1.1 remap rewrites the buffer of her position hash d2844c01. A mod made after 1.1 (new texcoord
        // hash) doesn't need it, even once 3.0 replaced d2844c01
        let (c, dir) = belle("[TextureOverrideBelleBodyPosition]\nhash = d2844c01\n[TextureOverrideBelleBodyTexcoord]\nhash = 801edbf4\n");
        assert!(!c.needs.iter().any(|(w, _)| w.contains("1.1")), "{:?}", c.needs);
        let _ = std::fs::remove_dir_all(&dir);
        // one from 1.0 still does
        let (c, dir) = belle("[TextureOverrideBelleBodyTexcoord]\nhash = caf95576\n");
        assert!(c.needs.iter().any(|(w, _)| w.contains("1.1")), "{:?}", c.needs);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_changed_model_needs_the_author() {
        // 3.0 rebuilt Belle: her old body position hash means the mod was made for the old model
        let (c, dir) = belle("[TextureOverrideBelleBodyPosition]\nhash = d2844c01\n");
        assert!(c.needs_author);
        let m = ModEntry { id: "x".into(), ..Default::default() };
        let tried: HashMap<String, Tried> = [("x".to_string(), Tried { tool: "ZZZ Mod Fixer".into(), at: 1, changed: 0 })].into_iter().collect();
        let h = health_of(&m, &c, false, &tried).unwrap();
        assert_eq!(h.status, "unfixable");
        assert!(h.needs_author);
        assert!(h.reasons[0].contains("needs an update from its author"), "{:?}", h.reasons);
        // the fixer can still be tried again, and the last try is remembered
        assert!(h.tool.is_some());
        assert_eq!(h.tried.unwrap().changed, 0);
        let _ = std::fs::remove_dir_all(&dir);
        // a mod remade for the new model is left alone
        let (c, dir) = belle("[TextureOverrideBelleBodyPosition]\nhash = 5838ad30\n");
        assert!(!c.needs_author && c.needs.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_tool_link_is_only_the_first_link() {
        let ww = Index::get("ww").unwrap();
        let t = ww.tool_link("https://github.com/Moonholder/Wuwa_Mod_Fixer (--rendering-33)");
        assert_eq!(t.url, "https://github.com/Moonholder/Wuwa_Mod_Fixer");
        let hsr = Index::get("hsr").unwrap();
        assert_eq!(hsr.tool_link("https://gamebanana.com/tools/19559 and https://gamebanana.com/tools/19978").url, "https://gamebanana.com/tools/19559");
    }
}

#[cfg(test)]
mod real {
    /// `GACHAMOD_REAL_DB=<path to a copy of gachamod.sqlite> cargo test -p gacha-core real_library -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn real_library() {
        let Some(p) = std::env::var_os("GACHAMOD_REAL_DB") else { return };
        let db = std::sync::Arc::new(std::sync::Mutex::new(crate::db::Db::open(std::path::Path::new(&p)).unwrap()));
        for g in ["zzz", "ww", "hsr", "gi", "ef"] {
            let mods = super::mods_of(&db.lock().unwrap(), g).map(|m| m.len()).unwrap_or(0);
            let t = std::time::Instant::now();
            let h = super::health(&db, g).unwrap_or_default();
            println!("{g}: {mods} mods, {} flagged in {:?}", h.len(), t.elapsed());
            for r in h.iter().take(12) { println!("  {} [{}] {:?} {:?}", r.name, r.status, r.reasons.iter().take(3).collect::<Vec<_>>(), r.tool.as_ref().map(|t| &t.name)); }
        }
    }
}
