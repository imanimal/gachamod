//! Where disk space goes, for Settings › Storage: each game's mods (on and off, per character and per mod), the app's
//! trash, downloaded archives, backups, fix tools, the loader's shader cache, frame dumps and log, mods another
//! manager keeps outside Mods, XXMI Launcher and gachamod's data folder. It also finds mods installed twice.
//!
//! Measuring only reads. Mod sizes come from the library's last scan; everything else is walked on the caller's
//! (blocking) thread, and `cancel` stops a walk that runs long, so the report comes back with `complete` false.
//! Cleanup uses the paths that already keep files safe: a copy goes to the app's trash (`remove_copies`), downloaded
//! archives to the Recycle Bin (`recycle_archives`), and the shader cache and frame dumps through devtools.
//! Owner: SYSTEM area (docs/spec.md, "Storage").

use crate::db::{now, Db, Shared};
use crate::error::{Error, Result};
use crate::model::{ModChange, ModEntry, Sidecar, SIDECAR_FILE};
use crate::{games, library};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

/// `Step`: what a measure is reading now, sent while it runs.
pub const PROGRESS_EVENT: &str = "storage-progress";

/// Something on disk and how big it is. Mirrors `StorageItem` in src/lib/api/storage.ts.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    /// What it is. A game's: "mods-on", "mods-off", "trash", "archives", "parts" (unfinished downloads), "backups",
    /// "fixers", "shader-cache", "frame-dumps", "log", "loader" (the rest of the loader folder), "others" (another
    /// manager's mods outside Mods). gachamod's data: "database", "thumbs", "cache", "logs", "staging",
    /// "extensions", "archive" (removed mods' pictures), "backups", "fixers", "other", and "xxmi".
    pub key: String,
    /// The group it counts toward (`category_of`).
    pub category: String,
    pub bytes: u64,
    /// Mods for mods, entries for the trash and backups, files for the rest.
    pub count: u32,
    /// The folder or file, for "Show in Explorer".
    pub path: Option<String>,
    /// The other manager's name, for "others".
    pub name: Option<String>,
}

/// One game's share. Mirrors `StorageGame`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameUse {
    pub game: String,
    pub bytes: u64,
    pub items: Vec<Item>,
}

/// One mod's size. Mirrors `StorageMod`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModUse {
    pub id: String,
    pub game: String,
    pub name: String,
    pub character: Option<String>,
    /// The folder is on (a live skin on standby counts).
    pub enabled: bool,
    pub bytes: u64,
    pub files: u32,
    pub path: String,
    pub installed_at: i64,
    /// The mod's picture (ModEntry::preview), a local path or a URL. `thumb` is its small copy when there is one.
    pub preview: Option<String>,
    pub thumb: Option<String>,
    /// Marked for adults, so the picture follows the "Mods for adults" setting.
    pub nsfw: bool,
}

/// One character's mods in one game; `name` None for mods without a character. Mirrors `StorageCharacter`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CharUse {
    pub game: String,
    pub name: Option<String>,
    pub bytes: u64,
    pub mods: u32,
    pub enabled: u32,
}

/// Mods installed more than once. Mirrors `StorageDuplicate`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DupGroup {
    pub game: String,
    /// "same": the files are the same, byte for byte (the sidecar and preview pictures aside). "download": the same
    /// GameBanana file installed twice, but the files differ (one was edited or fixed since).
    pub kind: String,
    /// The copy that stays: the newest of the ones that are on, or the newest.
    pub keep: String,
    /// The other copies, which "Keep newest" sends to the trash.
    pub remove: Vec<String>,
    /// Space the other copies take.
    pub bytes: u64,
}

/// Everything Tools › Storage shows. Mirrors `StorageReport`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub total: u64,
    /// Games with anything on disk, biggest first.
    pub games: Vec<GameUse>,
    /// gachamod's data and XXMI Launcher, biggest first.
    pub app: Vec<Item>,
    /// Every mod, biggest first.
    pub mods: Vec<ModUse>,
    /// Biggest first.
    pub characters: Vec<CharUse>,
    pub duplicates: Vec<DupGroup>,
    /// "trash.days".
    pub trash_days: i64,
    /// Trash files past "trash.days" that weren't deleted yet (a file was in use when the trash was emptied).
    pub trash_overdue: u64,
    /// "downloads.keep": archives stay after installing.
    pub keep_archives: bool,
    /// Every folder was measured and copies compared. False for the quick pass (mods only) or a skipped measure.
    pub complete: bool,
    pub measured_at: i64,
}

/// What a measure is reading now. Mirrors `StorageStep`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Step {
    /// "mods", "data", "loader", "copies", "others" or "xxmi".
    pub step: String,
    pub game: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct Options {
    /// Walk the folders and compare copies. Without it only the library's sizes are read (instant).
    pub full: bool,
    /// Also read places that other apps on the PC keep: other managers' libraries and
    /// XXMI Launcher.
    pub outside: bool,
}

/// The group an item counts toward in the "by category" view: "on", "off", "trash", "downloads", "backups",
/// "loader", "others" or "app".
pub fn category_of(key: &str) -> &'static str {
    match key {
        "mods-on" => "on",
        "mods-off" => "off",
        "trash" => "trash",
        "archives" | "parts" => "downloads",
        "backups" => "backups",
        "shader-cache" | "frame-dumps" | "log" | "loader" | "xxmi" => "loader",
        "others" => "others",
        _ => "app",
    }
}

// ── stopping ──

static GENERATION: AtomicU64 = AtomicU64::new(0);

/// Stop the measure that runs now. It returns what it has, with `complete` false.
pub fn cancel() { GENERATION.fetch_add(1, Ordering::SeqCst); }

#[derive(Clone, Copy)]
enum Stop {
    Gen(u64),
    /// Tests, which must not stop when another test's measure is cancelled.
    #[cfg(test)]
    Never,
}

impl Stop {
    fn now() -> Self { Stop::Gen(GENERATION.load(Ordering::SeqCst)) }
    fn hit(self) -> bool { matches!(self, Stop::Gen(g) if GENERATION.load(Ordering::SeqCst) != g) }
}

// ── walking ──

#[derive(Debug, Clone, Copy, Default, PartialEq)]
struct Use { files: u32, bytes: u64 }

impl Use {
    fn add(&mut self, o: Use) { self.files += o.files; self.bytes += o.bytes; }
}

/// Files and bytes under `p` (a folder or one file), never following links, leaving out what `skip` names.
fn walk(p: &Path, skip: &dyn Fn(&Path) -> bool, stop: Stop) -> Use {
    let mut u = Use::default();
    let Ok(meta) = std::fs::symlink_metadata(p) else { return u };
    if meta.is_file() { return Use { files: 1, bytes: meta.len() }; }
    let mut n = 0u32;
    let it = walkdir::WalkDir::new(p).follow_links(false).into_iter().filter_entry(|e| e.depth() == 0 || !skip(e.path()));
    for e in it.flatten() {
        n += 1;
        if n % 256 == 0 && stop.hit() { break; }
        if e.file_type().is_file() {
            u.files += 1;
            u.bytes += e.metadata().map(|m| m.len()).unwrap_or(0);
        }
    }
    u
}

fn no_skip(_: &Path) -> bool { false }

/// Paths compared the way Windows does: case and slashes don't matter.
fn path_key(p: &Path) -> String {
    p.to_string_lossy().replace('/', "\\").trim_end_matches('\\').to_lowercase()
}

fn same_path(a: &Path, b: &Path) -> bool { path_key(a) == path_key(b) }

fn inside(child: &Path, parent: &Path) -> bool {
    let (c, p) = (path_key(child), path_key(parent));
    c == p || c.starts_with(&format!("{p}\\"))
}

fn item(key: &str, u: Use, path: Option<&Path>) -> Item {
    Item { key: key.into(), category: category_of(key).into(), bytes: u.bytes, count: u.files, path: path.map(|p| p.to_string_lossy().into_owned()), name: None }
}

/// Add an item, merging it into one with the same key and name. Empty ones are left out.
fn push(list: &mut Vec<Item>, it: Item) {
    if it.bytes == 0 && it.count == 0 { return; }
    if let Some(o) = list.iter_mut().find(|o| o.key == it.key && o.name == it.name) {
        o.bytes += it.bytes;
        o.count += it.count;
        if o.path.is_none() { o.path = it.path; }
        return;
    }
    list.push(it);
}

fn by_size(list: &mut [Item]) { list.sort_by(|a, b| b.bytes.cmp(&a.bytes).then_with(|| a.key.cmp(&b.key))); }

// ── gachamod's data folder ──

#[derive(Default)]
struct DataUse { app: Vec<Item>, games: HashMap<String, Vec<Item>> }

fn known_game(name: &str) -> Option<String> {
    games::GAMES.iter().find(|g| g.id.eq_ignore_ascii_case(name)).map(|g| g.id.to_string())
}

fn child_dirs(p: &Path) -> Vec<(String, PathBuf)> {
    std::fs::read_dir(p).into_iter().flatten().flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
        .map(|e| (e.file_name().to_string_lossy().into_owned(), e.path())).collect()
}

/// The game a backup folder belongs to, from its manifest.
fn backup_game(dir: &Path) -> Option<String> {
    let text = std::fs::read(dir.join("manifest.json")).ok()?;
    let v: serde_json::Value = serde_json::from_slice(&text).ok()?;
    known_game(v.get("game")?.as_str()?)
}

/// Sort the data folder into items: each game's trash, downloads, backups and fix tools, and gachamod's other files.
fn data_items(data: &Path, stop: Stop) -> DataUse {
    let mut out = DataUse::default();
    let Ok(rd) = std::fs::read_dir(data) else { return out };
    for e in rd.flatten() {
        if stop.hit() { break; }
        let name = e.file_name().to_string_lossy().to_lowercase();
        let p = e.path();
        match name.as_str() {
            "gachamod.sqlite" | "gachamod.sqlite-wal" | "gachamod.sqlite-shm" => push(&mut out.app, item("database", walk(&p, &no_skip, stop), Some(&p))),
            "cache" => {
                let thumbs = p.join("thumbs");
                push(&mut out.app, item("thumbs", walk(&thumbs, &no_skip, stop), Some(&thumbs)));
                push(&mut out.app, item("cache", walk(&p, &|x| same_path(x, &thumbs), stop), Some(&p)));
            }
            "logs" | "staging" | "extensions" | "archive" => push(&mut out.app, item(&name, walk(&p, &no_skip, stop), Some(&p))),
            "downloads" => for (n, dir) in child_dirs(&p) {
                let Some(game) = known_game(&n) else { push(&mut out.app, item("other", walk(&dir, &no_skip, stop), Some(&dir))); continue };
                let parts = walk(&dir, &|x| x.is_file() && !is_part(x), stop);
                let mut all = walk(&dir, &no_skip, stop);
                all.files -= parts.files.min(all.files);
                all.bytes -= parts.bytes.min(all.bytes);
                let list = out.games.entry(game).or_default();
                push(list, item("archives", all, Some(&dir)));
                push(list, item("parts", parts, Some(&dir)));
            },
            "trash" => for (n, dir) in child_dirs(&p) {
                let u = walk(&dir, &no_skip, stop);
                match known_game(&n) {
                    Some(game) => {
                        let mut it = item("trash", u, Some(&dir));
                        it.count = child_dirs(&dir).len() as u32;
                        push(out.games.entry(game).or_default(), it);
                    }
                    // removed extensions count with the extensions; anything else is just other files
                    None => push(&mut out.app, item(if n.eq_ignore_ascii_case("extensions") { "extensions" } else { "other" }, u, Some(&dir))),
                }
            },
            "backups" => for b in std::fs::read_dir(&p).into_iter().flatten().flatten() {
                let bp = b.path();
                let mut it = item("backups", walk(&bp, &no_skip, stop), Some(&p));
                it.count = 1;
                match bp.is_dir().then(|| backup_game(&bp)).flatten() {
                    Some(game) => push(out.games.entry(game).or_default(), it),
                    None => push(&mut out.app, it),
                }
            },
            "fixers" => for (n, dir) in child_dirs(&p) {
                let it = item("fixers", walk(&dir, &no_skip, stop), Some(&dir));
                match known_game(&n) {
                    Some(game) => push(out.games.entry(game).or_default(), it),
                    None => push(&mut out.app, it),
                }
            },
            _ => push(&mut out.app, item("other", walk(&p, &no_skip, stop), Some(data))),
        }
    }
    out
}

fn is_part(p: &Path) -> bool { p.extension().is_some_and(|x| x.eq_ignore_ascii_case("part")) }

// ── the loader's folder ──

fn frame_dump_dirs(importer: &Path) -> Vec<PathBuf> {
    child_dirs(importer).into_iter().filter(|(n, _)| n.to_lowercase().starts_with("frameanalysis")).map(|(_, p)| p).collect()
}

/// The loader folder's shader cache, frame dumps and log, and the rest of it (ShaderFixes, d3dx.ini, the dlls)
/// without the Mods folder. The rest is left out when the loader sits in the game folder (community loaders),
/// which would count the whole game.
fn loader_items(importer: &Path, mods: Option<&Path>, game_dir: Option<&Path>, stop: Stop) -> Vec<Item> {
    let mut v = Vec::new();
    let cache = importer.join("ShaderCache");
    push(&mut v, item("shader-cache", walk(&cache, &no_skip, stop), Some(&cache)));
    let dumps = frame_dump_dirs(importer);
    let mut d = Use::default();
    for p in &dumps { d.add(walk(p, &no_skip, stop)); }
    push(&mut v, item("frame-dumps", d, Some(importer)));
    let log = importer.join("d3d11_log.txt");
    push(&mut v, item("log", walk(&log, &no_skip, stop), Some(&log)));
    let in_game = game_dir.is_some_and(|g| inside(importer, g) || inside(g, importer));
    if !in_game && importer.join("d3dx.ini").is_file() {
        let skip = |p: &Path| mods.is_some_and(|m| same_path(p, m)) || same_path(p, &cache) || same_path(p, &log) || dumps.iter().any(|x| same_path(p, x));
        push(&mut v, item("loader", walk(importer, &skip, stop), Some(importer)));
    }
    v
}

// ── mods ──

fn mod_use(m: &ModEntry) -> ModUse {
    ModUse {
        id: m.id.clone(), game: m.game.clone(), name: m.name.clone(), character: m.character.clone(), enabled: m.loaded(),
        bytes: m.size_bytes, files: m.file_count, path: m.path.clone(), installed_at: m.installed_at,
        preview: m.preview.clone(), thumb: m.thumb.clone(), nsfw: m.nsfw,
    }
}

fn mod_items(mods: &[ModEntry], mods_dir: Option<&Path>) -> Vec<Item> {
    let mut v = Vec::new();
    for (key, on) in [("mods-on", true), ("mods-off", false)] {
        let picked: Vec<&ModEntry> = mods.iter().filter(|m| m.loaded() == on).collect();
        let mut it = item(key, Use { files: picked.len() as u32, bytes: picked.iter().map(|m| m.size_bytes).sum() }, mods_dir);
        it.count = picked.len() as u32;
        push(&mut v, it);
    }
    v
}

/// Each character's mods per game, biggest first. Mods without a character share one row (`name` None).
fn characters(mods: &[ModEntry]) -> Vec<CharUse> {
    let mut by: HashMap<(String, Option<String>), CharUse> = HashMap::new();
    for m in mods {
        let name = m.character.as_deref().map(str::trim).filter(|c| !c.is_empty()).map(String::from);
        let c = by.entry((m.game.clone(), name.clone())).or_insert_with(|| CharUse { game: m.game.clone(), name, ..Default::default() });
        c.bytes += m.size_bytes;
        c.mods += 1;
        if m.loaded() { c.enabled += 1; }
    }
    let mut v: Vec<CharUse> = by.into_values().collect();
    v.sort_by(|a, b| b.bytes.cmp(&a.bytes).then_with(|| a.game.cmp(&b.game)).then_with(|| a.name.cmp(&b.name)));
    v
}

// ── copies ──

/// Files that don't make two copies different: the sidecar and other dot files, preview pictures, Windows' own.
fn ignored_file(name: &str) -> bool {
    let n = name.to_lowercase();
    if n.starts_with('.') || n == "desktop.ini" || n == "thumbs.db" { return true; }
    let picture = [".png", ".jpg", ".jpeg", ".webp", ".gif"].iter().any(|x| n.ends_with(x));
    picture && n.starts_with("preview")
}

/// A mod's files that count, as (path inside the mod in lower case, size, full path), sorted.
fn content_files(dir: &Path, stop: Stop) -> Vec<(String, u64, PathBuf)> {
    let mut v = Vec::new();
    let it = walkdir::WalkDir::new(dir).follow_links(false).into_iter()
        .filter_entry(|e| e.depth() == 0 || !e.file_name().to_string_lossy().starts_with('.'));
    for (n, e) in it.flatten().enumerate() {
        if n % 256 == 255 && stop.hit() { return Vec::new(); }
        if !e.file_type().is_file() || ignored_file(&e.file_name().to_string_lossy()) { continue; }
        let Ok(rel) = e.path().strip_prefix(dir) else { continue };
        let rel = rel.to_string_lossy().replace('\\', "/").to_lowercase();
        v.push((rel, e.metadata().map(|m| m.len()).unwrap_or(0), e.path().to_path_buf()));
    }
    v.sort_by(|a, b| a.0.cmp(&b.0));
    v
}

/// A digest of the files' names, sizes and bytes. None when one can't be read or the measure was stopped.
fn content_digest(files: &[(String, u64, PathBuf)], stop: Stop) -> Option<[u8; 16]> {
    use md5::{Digest, Md5};
    let mut h = Md5::new();
    let mut buf = vec![0u8; 256 * 1024];
    for (rel, size, path) in files {
        if stop.hit() { return None; }
        h.update(rel.as_bytes());
        h.update([0]);
        h.update(size.to_le_bytes());
        let mut f = std::fs::File::open(path).ok()?;
        loop {
            let n = f.read(&mut buf).ok()?;
            if n == 0 { break; }
            h.update(&buf[..n]);
        }
    }
    Some(h.finalize().into())
}

fn sidecar_variant(m: &ModEntry) -> Option<String> {
    let text = std::fs::read(Path::new(&m.path).join(SIDECAR_FILE)).ok()?;
    serde_json::from_slice::<Sidecar>(&text).ok()?.variant
}

/// A mod gachamod can move to the trash and whose folder holds the files: not one of IMM's folders, and not a
/// link to another manager's folder (trashing the link would free nothing).
fn movable(m: &ModEntry) -> bool {
    let first = m.rel_path.split('/').next().unwrap_or("");
    if first.eq_ignore_ascii_case(library::IMM_STORE) || first.eq_ignore_ascii_case(library::IMM_LINKS) { return false; }
    std::fs::symlink_metadata(&m.path).is_ok_and(|md| md.is_dir() && !md.file_type().is_symlink())
}

fn group(game: &str, kind: &str, members: &[&ModEntry]) -> DupGroup {
    // the newest of the copies that are on stays, so what the game shows doesn't change; else the newest
    let keep = members.iter().max_by_key(|m| (m.loaded(), m.installed_at)).map(|m| m.id.clone()).unwrap_or_default();
    let others: Vec<&&ModEntry> = members.iter().filter(|m| m.id != keep).collect();
    DupGroup {
        game: game.into(), kind: kind.into(), keep,
        remove: others.iter().map(|m| m.id.clone()).collect(),
        bytes: others.iter().map(|m| m.size_bytes).sum(),
    }
}

/// Ids of mods whose folder holds another mod's folder or sits inside one. Trashing either would take the other
/// along, so they're never offered as copies.
fn nested(mods: &[&ModEntry]) -> HashSet<String> {
    // the separator sorts first, so a folder's subfolders follow it directly ("a", "a\b", then "a b")
    let mut keys: Vec<(String, &str)> = mods.iter().map(|m| (path_key(Path::new(&m.path)).replace('\\', "\u{1}"), m.id.as_str())).collect();
    keys.sort();
    let mut out = HashSet::new();
    let mut stack: Vec<(String, &str)> = Vec::new();
    for (k, id) in keys {
        while stack.last().is_some_and(|(top, _)| !k.starts_with(&format!("{top}\u{1}"))) { stack.pop(); }
        if !stack.is_empty() {
            out.insert(id.to_string());
            out.extend(stack.iter().map(|(_, i)| i.to_string()));
        }
        stack.push((k, id));
    }
    out
}

/// Mods of one game installed more than once. Copies with the same files come first ("same"); then the same
/// GameBanana file (and the same variant of it) installed twice with files that differ ("download").
fn duplicates(game: &str, mods: &[ModEntry], variant: &dyn Fn(&ModEntry) -> Option<String>, stop: Stop) -> Vec<DupGroup> {
    let mods: Vec<&ModEntry> = mods.iter().filter(|m| movable(m)).collect();
    let inner = nested(&mods);
    let mods: Vec<&ModEntry> = mods.into_iter().filter(|m| !inner.contains(&m.id)).collect();
    // a sub-mod comes from the same download as its parent, so the same file id says nothing about them
    let family: HashSet<&str> = mods.iter().filter_map(|m| m.parent.as_deref()).collect();
    // same names and sizes first (cheap), then the bytes of only those
    let mut shapes: HashMap<Vec<(String, u64)>, Vec<(usize, Vec<(String, u64, PathBuf)>)>> = HashMap::new();
    for (i, m) in mods.iter().enumerate() {
        if stop.hit() { return Vec::new(); }
        let files = content_files(Path::new(&m.path), stop);
        if files.is_empty() { continue; }
        let shape = files.iter().map(|(r, s, _)| (r.clone(), *s)).collect();
        shapes.entry(shape).or_default().push((i, files));
    }
    let mut out = Vec::new();
    let mut grouped: HashSet<usize> = HashSet::new();
    let mut alike: Vec<Vec<(usize, Vec<(String, u64, PathBuf)>)>> = shapes.into_values().filter(|v| v.len() > 1).collect();
    alike.sort_by_key(|v| v.iter().map(|(i, _)| *i).min());
    for set in alike {
        let mut by_digest: HashMap<[u8; 16], Vec<usize>> = HashMap::new();
        for (i, files) in &set {
            match content_digest(files, stop) {
                Some(d) => by_digest.entry(d).or_default().push(*i),
                None if stop.hit() => return out,
                None => {}
            }
        }
        let mut sets: Vec<Vec<usize>> = by_digest.into_values().filter(|v| v.len() > 1).collect();
        sets.sort();
        for ids in sets {
            grouped.extend(&ids);
            out.push(group(game, "same", &ids.iter().map(|i| mods[*i]).collect::<Vec<_>>()));
        }
    }
    let mut downloads: HashMap<(u64, u64, Option<String>), Vec<usize>> = HashMap::new();
    for (i, m) in mods.iter().enumerate() {
        if grouped.contains(&i) || m.parent.is_some() || family.contains(m.id.as_str()) { continue; }
        let Some(src) = &m.source else { continue };
        let Some(file) = src.file_id else { continue };
        downloads.entry((src.mod_id, file, variant(m))).or_default().push(i);
    }
    let mut sets: Vec<Vec<usize>> = downloads.into_values().filter(|v| v.len() > 1).collect();
    sets.sort();
    for ids in sets { out.push(group(game, "download", &ids.iter().map(|i| mods[*i]).collect::<Vec<_>>())); }
    out
}

// ── measuring ──

fn lock(db: &Shared) -> Result<std::sync::MutexGuard<'_, Db>> {
    db.lock().map_err(|_| Error::Db("The local database is stuck after an earlier error. Restart gachamod".into()))
}

/// Bytes of trash files past "trash.days" (and copies an update replaced, past their 10 minutes).
fn trash_overdue(db: &Db) -> u64 {
    let t = now();
    let cutoff = t - library::trash_days(db) * 86400;
    db.conn.query_row(
        "SELECT COALESCE(SUM(size), 0) FROM trash WHERE kept_path <> '' AND ((reason <> 'replaced' AND removed_at <= ?1) OR (reason = 'replaced' AND removed_at <= ?2))",
        rusqlite::params![cutoff, cutoff.min(t - 600)], |r| r.get::<_, i64>(0),
    ).map(|n| n.max(0) as u64).unwrap_or(0)
}

struct GameDirs { id: String, importer: Option<PathBuf>, mods_dir: Option<PathBuf>, game_dir: Option<PathBuf>, mods: Vec<ModEntry> }

/// Measure. Without `opts.full` only the library is read; with it every folder is walked and copies compared, and
/// `progress` hears each step. `cancel` stops it early: what was measured comes back with `complete` false.
pub fn measure(db: &Shared, data_dir: &Path, opts: &Options, progress: &dyn Fn(&Step)) -> Result<Report> {
    let stop = Stop::now();
    let say = |step: &str, game: Option<&str>| progress(&Step { step: step.into(), game: game.map(String::from) });
    say("mods", None);
    let (dirs, overdue, days, keep, xxmi_root) = {
        let d = lock(db)?;
        let mut dirs = Vec::new();
        for g in games::GAMES {
            let p = games::paths(&d, g.id)?;
            let mods = library::list(&d, g.id)?;
            let mods_dir = p.mods_dir.as_deref().map(PathBuf::from);
            let importer = p.importer_dir.as_deref().map(PathBuf::from).or_else(|| mods_dir.as_ref().and_then(|m| m.parent().map(Path::to_path_buf)));
            if importer.is_none() && mods.is_empty() { continue; }
            dirs.push(GameDirs { id: g.id.into(), importer, mods_dir, game_dir: p.game_dir.as_deref().map(PathBuf::from), mods });
        }
        let keep = d.setting("downloads.keep").ok().flatten().is_some_and(|v| v == "1");
        (dirs, trash_overdue(&d), library::trash_days(&d), keep, d.setting("xxmi.root").ok().flatten())
    };

    let mut per_game: HashMap<String, Vec<Item>> = HashMap::new();
    let mut all_mods: Vec<ModEntry> = Vec::new();
    for g in &dirs {
        let list = per_game.entry(g.id.clone()).or_default();
        for it in mod_items(&g.mods, g.mods_dir.as_deref()) { push(list, it); }
        all_mods.extend(g.mods.iter().cloned());
    }
    let mut app: Vec<Item> = Vec::new();
    let mut dups: Vec<DupGroup> = Vec::new();
    let mut complete = false;

    if opts.full {
        'full: {
            say("data", None);
            let data = data_items(data_dir, stop);
            for it in data.app { push(&mut app, it); }
            for (game, items) in data.games {
                let list = per_game.entry(game).or_default();
                for it in items { push(list, it); }
            }
            for g in &dirs {
                if stop.hit() { break 'full; }
                let Some(imp) = &g.importer else { continue };
                say("loader", Some(&g.id));
                let list = per_game.entry(g.id.clone()).or_default();
                for it in loader_items(imp, g.mods_dir.as_deref(), g.game_dir.as_deref(), stop) { push(list, it); }
            }
            for g in &dirs {
                if stop.hit() { break 'full; }
                if g.mods.len() < 2 { continue; }
                say("copies", Some(&g.id));
                dups.extend(duplicates(&g.id, &g.mods, &sidecar_variant, stop));
            }
            if opts.outside {
                for g in &dirs {
                    if stop.hit() { break 'full; }
                    say("others", Some(&g.id));
                    let Ok(found) = crate::migrate::detect(db, &g.id, None) else { continue };
                    let list = per_game.entry(g.id.clone()).or_default();
                    for m in found.into_iter().filter(|m| m.outside > 0 && m.outside_bytes > 0) {
                        push(list, Item {
                            key: "others".into(), category: category_of("others").into(), bytes: m.outside_bytes, count: m.outside,
                            path: m.library.clone().or(Some(m.place.clone())), name: Some(m.name),
                        });
                    }
                }
                if stop.hit() { break 'full; }
                if let Some(root) = crate::xxmi::find_root(xxmi_root.as_deref()) {
                    say("xxmi", None);
                    let mine: Vec<PathBuf> = dirs.iter().flat_map(|g| [g.importer.clone(), g.mods_dir.clone()]).flatten().collect();
                    push(&mut app, item("xxmi", walk(&root, &|p| mine.iter().any(|m| same_path(p, m)), stop), Some(&root)));
                }
            }
            complete = !stop.hit();
        }
    }

    let mut games_out: Vec<GameUse> = per_game.into_iter().filter(|(_, v)| !v.is_empty()).map(|(game, mut items)| {
        by_size(&mut items);
        GameUse { bytes: items.iter().map(|i| i.bytes).sum(), game, items }
    }).collect();
    games_out.sort_by(|a, b| b.bytes.cmp(&a.bytes).then_with(|| a.game.cmp(&b.game)));
    by_size(&mut app);
    let mut mods: Vec<ModUse> = all_mods.iter().map(mod_use).collect();
    mods.sort_by(|a, b| b.bytes.cmp(&a.bytes).then_with(|| a.name.cmp(&b.name)));
    dups.sort_by(|a, b| a.kind.cmp(&b.kind).reverse().then_with(|| b.bytes.cmp(&a.bytes)));
    Ok(Report {
        total: games_out.iter().map(|g| g.bytes).sum::<u64>() + app.iter().map(|i| i.bytes).sum::<u64>(),
        characters: characters(&all_mods), games: games_out, app, mods, duplicates: dups,
        trash_days: days, trash_overdue: overdue, keep_archives: keep, complete, measured_at: now(),
    })
}

// ── cleaning up ──

/// Send copies of mods to the app's trash. They go as "replaced", like the old copy an update leaves: kept at least
/// 10 minutes even when "trash.days" is 0, so Undo can put them back, and not written to the archive afterwards,
/// since the copy that stays has the same files.
pub fn remove_copies(db: &Db, data_dir: &Path, game: &str, ids: &[String]) -> Result<ModChange> {
    library::remove(db, data_dir, game, ids, "replaced")
}

/// Kept archives in `<data>/downloads/<game>/` (every game with None). Unfinished downloads (.part), the files in
/// `busy` and anything written in the last two minutes are left alone.
fn archives(data_dir: &Path, game: Option<&str>, busy: &[PathBuf]) -> Vec<(PathBuf, u64)> {
    let root = data_dir.join("downloads");
    let recent = std::time::SystemTime::now() - std::time::Duration::from_secs(120);
    let mut out = Vec::new();
    for (name, dir) in child_dirs(&root) {
        if game.is_some_and(|g| !g.eq_ignore_ascii_case(&name)) || known_game(&name).is_none() { continue; }
        for e in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
            let p = e.path();
            let Ok(md) = e.metadata() else { continue };
            if !md.is_file() || is_part(&p) || busy.iter().any(|b| same_path(b, &p)) { continue; }
            if md.modified().is_ok_and(|m| m > recent) { continue; }
            out.push((p, md.len()));
        }
    }
    out
}

/// Move kept archives to the Recycle Bin. Returns the bytes moved.
pub fn recycle_archives(data_dir: &Path, game: Option<&str>, busy: &[PathBuf]) -> Result<u64> {
    let list = archives(data_dir, game, busy);
    let bytes = list.iter().map(|(_, n)| n).sum();
    let paths: Vec<PathBuf> = list.into_iter().map(|(p, _)| p).collect();
    // tests delete for good, so they don't fill the Recycle Bin
    if cfg!(test) { for p in &paths { std::fs::remove_file(p)?; } } else { crate::recycle::to_recycle_bin(&paths)?; }
    Ok(bytes)
}

#[cfg(test)]
mod tests;
