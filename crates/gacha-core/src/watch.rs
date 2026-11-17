//! Watching each game's Mods folder, so a mod dragged in, renamed, deleted or turned off by another tool shows up
//! without a Rescan. Owner: LIBRARY area.
//!
//! One thread owns a notify watcher (ReadDirectoryChangesW on Windows) with each set-up game's Mods folder, recursive,
//! and the folder above it, not recursive, which sees the Mods folder itself deleted, renamed or made again. Changes
//! are settled per game: the scan runs once the folder has been quiet for `QUIET`, or `MAX_WAIT` after the first
//! change of a burst (an extraction writes thousands of files). The scan is `library::scan`, the one Rescan runs, and
//! `library-changed` goes out only when the list it gives differs from the one before.
//!
//! gachamod's own writes don't start scans. Paths the scan never reads are ignored (`is_noise`: sidecars and other
//! dot files, `gachamod live`, d3dx_user.ini, logs, shader caches, temp files). Installs, imports, toggles and scans
//! `hold` their game, and a settled change waits until they let go. What's left is idempotent: a scan writes only
//! what changed (a new mod's sidecar, a live skin's folder), so the scan after it finds nothing new and emits
//! nothing. Should a writer ever keep answering every scan, `Settler` stops following that echo after a few rounds.
//!
//! A folder that can't be watched (missing, a drive that isn't there) is logged once and tried again on the next
//! `resync`, which runs whenever a game's folders or the "library.watch" setting change.

use crate::db::Shared;
use crate::model::ModEntry;
use crate::Result;
use notify::event::ModifyKind;
use notify::{Event, EventKind, RecursiveMode, Watcher};
use std::collections::{HashMap, HashSet};
use std::path::{Component, Path, PathBuf};
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// How long a game's Mods folder must stay quiet before it is scanned.
pub const QUIET: Duration = Duration::from_millis(700);
/// The longest a burst of changes holds a scan back.
pub const MAX_WAIT: Duration = Duration::from_secs(4);
/// Changes this soon after a scan finished still count as written by it.
const ECHO: Duration = Duration::from_millis(300);
/// Scans in a row that found nothing and were started only by the scan before them, after which its writes are ignored.
const ECHO_ROUNDS: u8 = 2;
/// The setting: "0" turns watching off. Missing means on.
pub const SETTING: &str = "library.watch";

// ── which changes count ──

/// A changed path, relative to its Mods folder, that a scan never reads: nothing a player sees can change.
pub fn is_noise(rel: &Path) -> bool {
    let parts: Vec<String> = rel.components().filter_map(|c| match c {
        Component::Normal(s) => Some(s.to_string_lossy().to_lowercase()),
        _ => None,
    }).collect();
    // the Mods folder itself (made again, or Windows lost track of changes): always look
    let Some(name) = parts.last() else { return false };
    if parts.iter().any(|p| crate::library::skip_dir(p)) { return true; }
    let ext = name.rsplit_once('.').map(|(_, e)| e).unwrap_or("");
    name == "d3dx_user.ini" || name == "desktop.ini" || name == "thumbs.db" || name.starts_with("~$")
        || matches!(ext, "log" | "tmp" | "temp" | "crdownload" | "part" | "partial" | "bak")
}

/// Whether an event changes anything. A folder's own "modified" only says something inside it changed, which comes
/// as its own event (and is how a sidecar written into a mod folder would echo back), so it doesn't count.
pub fn counts(kind: &EventKind, is_dir: impl FnOnce() -> bool) -> bool {
    match kind {
        EventKind::Access(_) => false,
        EventKind::Any | EventKind::Modify(ModifyKind::Any | ModifyKind::Data(_) | ModifyKind::Metadata(_) | ModifyKind::Other) => !is_dir(),
        _ => true,
    }
}

/// The event says a path appeared: made, or renamed to this name.
fn arrives(kind: &EventKind) -> bool { matches!(kind, EventKind::Create(_) | EventKind::Modify(ModifyKind::Name(_))) }

/// Lower-case path parts, so `D:\ZZZ Mods` and `d:\zzz mods\` match (Windows paths ignore case).
fn parts_of(p: &Path) -> Vec<String> {
    p.components().filter_map(|c| match c {
        Component::Prefix(x) => Some(x.as_os_str().to_string_lossy().to_lowercase()),
        Component::Normal(s) => Some(s.to_string_lossy().to_lowercase()),
        _ => None,
    }).collect()
}

/// The game whose Mods folder holds `path` (the deepest one, should one sit inside another), and the path relative to it.
pub fn route<'a>(roots: &'a [(String, PathBuf)], path: &Path) -> Option<(&'a str, PathBuf)> {
    let want = parts_of(path);
    let (game, root) = roots.iter()
        .map(|(g, r)| (g, parts_of(r)))
        .filter(|(_, r)| !r.is_empty() && want.len() >= r.len() && want[..r.len()] == r[..])
        .max_by_key(|(_, r)| r.len())?;
    let skip = root.len();
    let rel: PathBuf = path.components().filter(|c| matches!(c, Component::Prefix(_) | Component::Normal(_))).skip(skip)
        .collect();
    Some((game.as_str(), rel))
}

/// What to watch for these Mods folders: each one recursively, and the folder above it alone (not recursive) unless
/// a recursive watch already covers it.
pub fn plan(roots: &[(String, PathBuf)]) -> Vec<(PathBuf, bool)> {
    let mut out: Vec<(PathBuf, bool)> = Vec::new();
    let covered = |p: &Path, out: &[(PathBuf, bool)]| {
        let k = parts_of(p);
        out.iter().any(|(q, rec)| { let r = parts_of(q); r == k || (*rec && k.len() > r.len() && k[..r.len()] == r[..]) })
    };
    for (_, r) in roots {
        let k = parts_of(r);
        out.retain(|(q, _)| parts_of(q) != k);
        out.push((r.clone(), true));
    }
    for (_, r) in roots {
        let Some(parent) = r.parent().filter(|p| p.components().count() > 0) else { continue };
        if !covered(parent, &out) { out.push((parent.to_path_buf(), false)); }
    }
    out
}

/// Whether a scan changed what the app shows: mods added, gone or different in any field.
pub fn differs(before: &[ModEntry], after: &[ModEntry]) -> bool {
    if before.len() != after.len() { return true; }
    let old: HashMap<&str, serde_json::Value> = before.iter().map(|m| (m.id.as_str(), serde_json::to_value(m).unwrap_or_default())).collect();
    after.iter().any(|m| old.get(m.id.as_str()) != Some(&serde_json::to_value(m).unwrap_or_default()))
}

// ── settling bursts ──

/// One game's changes since its last scan.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Debounce {
    first: Option<Instant>,
    last: Option<Instant>,
    /// Some change came from outside the last scan's own writes.
    fresh: bool,
}

impl Debounce {
    pub fn push(&mut self, at: Instant, fresh: bool) {
        self.first = Some(self.first.map_or(at, |f| f.min(at)));
        self.last = Some(self.last.map_or(at, |l| l.max(at)));
        self.fresh |= fresh;
    }
    /// When the scan should run: `QUIET` after the last change, and never later than `MAX_WAIT` after the first.
    pub fn due_at(&self) -> Option<Instant> { Some((self.last? + QUIET).min(self.first? + MAX_WAIT)) }
    pub fn due(&self, now: Instant) -> bool { self.due_at().is_some_and(|d| now >= d) }
}

/// When each game's next scan runs. Pure bookkeeping (no files, no clock), so tests drive it with made-up times.
#[derive(Debug, Default)]
pub struct Settler {
    pending: HashMap<String, Debounce>,
    /// Due while gachamod itself was busy with the folder: runs once it lets go.
    blocked: HashMap<String, bool>,
    /// The last scan of each game, from its start to `ECHO` after its end.
    last_scan: HashMap<String, (Instant, Instant)>,
    /// Scans in a row that found nothing and were started only by the scan before them.
    echo_rounds: HashMap<String, u8>,
}

impl Settler {
    /// A change in `game`'s Mods folder at `at`.
    pub fn change(&mut self, game: &str, at: Instant) {
        let echo = self.last_scan.get(game).is_some_and(|(s, e)| at >= *s && at <= *e);
        if echo && self.echo_rounds.get(game).copied().unwrap_or(0) >= ECHO_ROUNDS { return; }
        if !echo { self.echo_rounds.remove(game); }
        if let Some(fresh) = self.blocked.get_mut(game) { *fresh |= !echo; return; }
        self.pending.entry(game.to_string()).or_default().push(at, !echo);
    }

    /// The soonest time a scan is due.
    pub fn next_due(&self) -> Option<Instant> { self.pending.values().filter_map(Debounce::due_at).min() }

    /// Games due at `now`, taken off the list. A game `held` by gachamod's own work waits for `released`.
    pub fn take_due(&mut self, now: Instant, held: impl Fn(&str) -> bool) -> Vec<(String, bool)> {
        let due: Vec<String> = self.pending.iter().filter(|(_, d)| d.due(now)).map(|(g, _)| g.clone()).collect();
        let mut out = Vec::new();
        for g in due {
            let Some(d) = self.pending.remove(&g) else { continue };
            if held(&g) { *self.blocked.entry(g).or_insert(false) |= d.fresh; } else { out.push((g, d.fresh)); }
        }
        out.sort();
        out
    }

    /// gachamod finished its own work on `game`: a change that waited on it settles from `now`.
    pub fn released(&mut self, game: &str, now: Instant) {
        if let Some(fresh) = self.blocked.remove(game) { self.pending.entry(game.to_string()).or_default().push(now, fresh); }
    }

    /// A scan of `game` ran from `start` to `end`. `fresh`: something outside the last scan started it.
    pub fn scanned(&mut self, game: &str, start: Instant, end: Instant, fresh: bool, changed: bool) {
        self.last_scan.insert(game.to_string(), (start, end + ECHO));
        if changed || fresh { self.echo_rounds.remove(game); } else { *self.echo_rounds.entry(game.to_string()).or_insert(0) += 1; }
    }

    /// Every game that has a Mods folder to look at again (Windows lost track of what changed).
    pub fn all(&mut self, games: impl IntoIterator<Item = String>, at: Instant) {
        for g in games { self.echo_rounds.remove(&g); self.change(&g, at); }
    }

    /// Forget a game that is no longer watched.
    pub fn forget(&mut self, game: &str) {
        self.pending.remove(game);
        self.blocked.remove(game);
        self.last_scan.remove(game);
        self.echo_rounds.remove(game);
    }
}

// ── gachamod's own work on a folder ──

static HOLDS: Mutex<Vec<(String, u32)>> = Mutex::new(Vec::new());
static WORKER: Mutex<Option<Sender<Msg>>> = Mutex::new(None);

/// While this lives, changes in `game`'s Mods folder wait: gachamod itself is writing there. Dropping it lets them settle.
#[must_use]
pub struct Hold(String);

pub fn hold(game: &str) -> Hold {
    let mut h = HOLDS.lock().unwrap_or_else(|e| e.into_inner());
    match h.iter_mut().find(|(g, _)| g == game) {
        Some((_, n)) => *n += 1,
        None => h.push((game.to_string(), 1)),
    }
    Hold(game.to_string())
}

impl Drop for Hold {
    fn drop(&mut self) {
        let last = {
            let mut h = HOLDS.lock().unwrap_or_else(|e| e.into_inner());
            let Some(i) = h.iter().position(|(g, _)| *g == self.0) else { return };
            h[i].1 -= 1;
            if h[i].1 == 0 { h.swap_remove(i); true } else { false }
        };
        if last { send(Msg::Released(std::mem::take(&mut self.0))); }
    }
}

fn held(game: &str) -> bool { HOLDS.lock().unwrap_or_else(|e| e.into_inner()).iter().any(|(g, _)| g == game) }

// ── the watcher thread ──

enum Msg {
    Fs(Instant, notify::Result<Event>),
    Resync,
    Released(String),
}

fn send(m: Msg) {
    if let Some(tx) = WORKER.lock().unwrap_or_else(|e| e.into_inner()).as_ref() { let _ = tx.send(m); }
}

/// Look at the games' folders and the setting again: watch new Mods folders, drop removed ones, retry failed ones.
/// Cheap and safe from anywhere (it only sends a message), and does nothing before `start`.
pub fn resync() { send(Msg::Resync); }

/// Start watching. `on_changed(game)` runs on the watcher's thread after a scan changed that game's list.
pub fn start(db: Shared, on_changed: impl Fn(&str) + Send + 'static) {
    let (tx, rx) = channel::<Msg>();
    {
        let mut w = WORKER.lock().unwrap_or_else(|e| e.into_inner());
        if w.is_some() { return; }
        *w = Some(tx.clone());
    }
    let fs_tx = tx.clone();
    std::thread::Builder::new().name("mods-watch".into()).spawn(move || {
        let watcher = notify::recommended_watcher(move |r| { let _ = fs_tx.send(Msg::Fs(Instant::now(), r)); });
        let mut w = match watcher {
            Ok(w) => w,
            Err(e) => { crate::logs::warn(format!("Can't watch Mods folders for changes: {e}")); return; }
        };
        let mut st = Worker::default();
        st.resync(&db, &mut w);
        loop {
            let msg = match st.settler.next_due() {
                Some(at) => rx.recv_timeout(at.saturating_duration_since(Instant::now())),
                None => rx.recv().map_err(|_| RecvTimeoutError::Disconnected),
            };
            match msg {
                Ok(Msg::Fs(at, Ok(ev))) => st.on_event(at, &ev, &mut w),
                Ok(Msg::Fs(_, Err(e))) => st.log_once(format!("Watching a Mods folder failed: {e}")),
                Ok(Msg::Resync) => st.resync(&db, &mut w),
                Ok(Msg::Released(g)) => st.settler.released(&g, Instant::now()),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => return,
            }
            for (game, fresh) in st.settler.take_due(Instant::now(), held) {
                let start = Instant::now();
                let changed = match rescan(&db, &game) {
                    Ok(c) => { st.failed_scan.remove(&game); c }
                    Err(e) => {
                        if st.failed_scan.insert(game.clone()) { crate::logs::warn(format!("Watching {game}'s Mods folder: the scan failed: {e}")); }
                        false
                    }
                };
                st.settler.scanned(&game, start, Instant::now(), fresh, changed);
                if changed { on_changed(&game); }
            }
        }
    }).ok();
    resync();
}

/// Scan `game` the way Rescan does. True when the list changed.
pub fn rescan(db: &Shared, game: &str) -> Result<bool> {
    let before = {
        let d = db.lock().map_err(|_| crate::Error::Db("The local database is stuck after an earlier error. Restart gachamod".into()))?;
        crate::library::list(&d, game)?
    };
    let after = crate::library::scan(db, game)?;
    Ok(differs(&before, &after))
}

/// The Mods folders to watch now: games with one saved and not hidden, when watching is on.
fn wanted(db: &Shared) -> Vec<(String, PathBuf)> {
    let Ok(d) = db.lock() else { return Vec::new() };
    if d.setting(SETTING).ok().flatten().as_deref() == Some("0") { return Vec::new(); }
    crate::games::GAMES.iter().filter_map(|g| {
        let mods = crate::games::paths(&d, g.id).ok()?.mods_dir.filter(|m| !m.trim().is_empty())?;
        let shown: Option<i64> = d.conn.query_row("SELECT shown FROM game_paths WHERE game = ?1", [g.id], |r| r.get(0)).ok().flatten();
        (shown != Some(0)).then(|| (g.id.to_string(), PathBuf::from(mods.trim())))
    }).collect()
}

#[derive(Default)]
struct Worker {
    settler: Settler,
    roots: Vec<(String, PathBuf)>,
    /// Paths watched now, and whether recursively.
    watching: Vec<(PathBuf, bool)>,
    /// Paths that couldn't be watched and were logged, so they are logged once.
    failed: HashSet<PathBuf>,
    failed_scan: HashSet<String>,
    logged: HashSet<String>,
}

impl Worker {
    fn log_once(&mut self, text: String) { if self.logged.insert(text.clone()) { crate::logs::warn(text); } }

    fn arm(&mut self, w: &mut impl Watcher, path: &Path, recursive: bool) -> bool {
        let _ = w.unwatch(path);
        let mode = if recursive { RecursiveMode::Recursive } else { RecursiveMode::NonRecursive };
        match w.watch(path, mode) {
            Ok(()) => { self.failed.remove(path); true }
            Err(e) => {
                if self.failed.insert(path.to_path_buf()) { crate::logs::warn(format!("Can't watch {} for changes: {e}", path.display())); }
                false
            }
        }
    }

    fn resync(&mut self, db: &Shared, w: &mut impl Watcher) {
        let roots = wanted(db);
        let want = plan(&roots);
        for (p, rec) in std::mem::take(&mut self.watching) {
            if want.contains(&(p.clone(), rec)) { self.watching.push((p, rec)); } else { let _ = w.unwatch(&p); }
        }
        for (p, rec) in want {
            // tried again on every resync (a failed one may work now); logged only the first time
            if self.watching.contains(&(p.clone(), rec)) { continue; }
            if self.arm(w, &p, rec) { self.watching.push((p, rec)); }
        }
        let keep: HashSet<&str> = roots.iter().map(|(g, _)| g.as_str()).collect();
        for (g, _) in &self.roots { if !keep.contains(g.as_str()) { self.settler.forget(g); } }
        self.failed_scan.retain(|g| keep.contains(g.as_str()));
        self.roots = roots;
    }

    fn on_event(&mut self, at: Instant, ev: &Event, w: &mut impl Watcher) {
        if matches!(ev.kind, EventKind::Access(_)) { return; }
        // no paths: Windows dropped what changed (too much at once), so look at every folder
        if ev.paths.is_empty() {
            let games: Vec<String> = self.roots.iter().map(|(g, _)| g.clone()).collect();
            self.settler.all(games, at);
            return;
        }
        for p in &ev.paths {
            let Some((game, rel)) = route(&self.roots, p) else { continue };
            if !counts(&ev.kind, || p.is_dir()) || (!rel.as_os_str().is_empty() && is_noise(&rel)) { continue; }
            let game = game.to_string();
            if rel.as_os_str().is_empty() {
                // the Mods folder itself went away (deleted, renamed, a drive pulled out): its rows stay until it comes
                // back or the player rescans, rather than a scan reading it as "no mods"
                if !p.is_dir() { continue; }
                // it came (back): it needs its own watch again
                if arrives(&ev.kind) {
                    let root = self.roots.iter().find(|(g, _)| *g == game).map(|(_, r)| r.clone());
                    if let Some(root) = root {
                        if self.arm(w, &root, true) && !self.watching.contains(&(root.clone(), true)) { self.watching.push((root, true)); }
                    }
                }
            }
            self.settler.change(&game, at);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ms(n: u64) -> Duration { Duration::from_millis(n) }

    #[test]
    fn noise_is_what_a_scan_never_reads() {
        for p in [".gachamod.json", "Ellen/.gachamod.json", "Ellen\\.gachamod.json", "gachamod live/live.ini", "GACHAMOD LIVE",
                  "ShaderCache/abc.bin", "d3dx_user.ini", "Ellen/d3dx.log", "x/~$draft.ini", "Ellen/mod.ini.tmp", "Ellen/Thumbs.db",
                  "a/.git/index", "Ellen/big.zip.crdownload"] {
            assert!(is_noise(Path::new(p)), "{p} is noise");
        }
        for p in ["", "Ellen", "DISABLED Ellen", "Ellen/mod.ini", "Ellen/preview.png", "Group/Ellen/Body.buf", "Ellen/DISABLED_mod.ini"] {
            assert!(!is_noise(Path::new(p)), "{p} counts");
        }
    }

    #[test]
    fn a_folders_own_modified_doesnt_count() {
        use notify::event::{CreateKind, RemoveKind, RenameMode};
        let modified = EventKind::Modify(ModifyKind::Any);
        assert!(!counts(&modified, || true), "a mod folder's time changed because a file inside did");
        assert!(counts(&modified, || false), "a file's contents changed");
        assert!(counts(&EventKind::Modify(ModifyKind::Name(RenameMode::To)), || true), "renamed (DISABLED by another tool)");
        assert!(counts(&EventKind::Create(CreateKind::Any), || true));
        assert!(counts(&EventKind::Remove(RemoveKind::Any), || false));
        assert!(!counts(&EventKind::Access(notify::event::AccessKind::Any), || false));
        assert!(arrives(&EventKind::Create(CreateKind::Any)) && !arrives(&modified));
    }

    #[test]
    fn routes_to_the_deepest_mods_folder_ignoring_case() {
        let roots = vec![("zzz".to_string(), PathBuf::from(r"D:\ZZMI\Mods")), ("gi".to_string(), PathBuf::from(r"D:\ZZMI\Mods\inner\"))];
        let (g, rel) = route(&roots, Path::new(r"d:\zzmi\mods\Ellen\mod.ini")).unwrap();
        assert_eq!((g, rel), ("zzz", PathBuf::from("Ellen").join("mod.ini")));
        assert_eq!(route(&roots, Path::new(r"D:\ZZMI\Mods\Inner\x")).unwrap().0, "gi");
        assert_eq!(route(&roots, Path::new(r"D:\ZZMI\Mods")).unwrap(), ("zzz", PathBuf::new()));
        assert!(route(&roots, Path::new(r"D:\ZZMI\d3dx_user.ini")).is_none());
        assert!(route(&roots, Path::new(r"D:\ZZMI\Mods2\x")).is_none(), "a sibling with the same start is another folder");
    }

    #[test]
    fn plans_each_folder_and_the_one_above() {
        let roots = vec![("zzz".to_string(), PathBuf::from(r"D:\ZZMI\Mods")), ("gi".to_string(), PathBuf::from(r"D:\GIMI\Mods"))];
        assert_eq!(plan(&roots), vec![
            (PathBuf::from(r"D:\ZZMI\Mods"), true), (PathBuf::from(r"D:\GIMI\Mods"), true),
            (PathBuf::from(r"D:\ZZMI"), false), (PathBuf::from(r"D:\GIMI"), false),
        ]);
        // a parent inside another game's Mods folder is covered by that watch
        let nested = vec![("zzz".to_string(), PathBuf::from(r"D:\Mods")), ("gi".to_string(), PathBuf::from(r"D:\Mods\GI\Mods"))];
        assert_eq!(plan(&nested), vec![(PathBuf::from(r"D:\Mods"), true), (PathBuf::from(r"D:\Mods\GI\Mods"), true), (PathBuf::from(r"D:\"), false)]);
    }

    #[test]
    fn a_burst_settles_into_one_scan() {
        let t = Instant::now();
        let mut s = Settler::default();
        for i in 0..50 { s.change("zzz", t + ms(i * 10)); }
        assert_eq!(s.next_due(), Some(t + ms(490) + QUIET));
        assert!(s.take_due(t + ms(1000), |_| false).is_empty(), "still settling");
        assert_eq!(s.take_due(t + ms(1190), |_| false), vec![("zzz".to_string(), true)]);
        assert!(s.take_due(t + ms(5000), |_| false).is_empty(), "one scan for the whole burst");
        assert_eq!(s.next_due(), None);
    }

    #[test]
    fn a_long_burst_scans_at_the_max_wait() {
        let t = Instant::now();
        let mut s = Settler::default();
        for i in 0..100 { s.change("zzz", t + ms(i * 100)); }
        assert_eq!(s.next_due(), Some(t + MAX_WAIT));
        assert_eq!(s.take_due(t + MAX_WAIT, |_| false).len(), 1);
    }

    #[test]
    fn games_settle_on_their_own() {
        let t = Instant::now();
        let mut s = Settler::default();
        s.change("zzz", t);
        s.change("gi", t + ms(500));
        assert_eq!(s.take_due(t + QUIET, |_| false), vec![("zzz".to_string(), true)]);
        assert_eq!(s.take_due(t + ms(500) + QUIET, |_| false), vec![("gi".to_string(), true)]);
    }

    #[test]
    fn waits_while_gachamod_works_on_the_folder() {
        let t = Instant::now();
        let mut s = Settler::default();
        s.change("zzz", t);
        assert!(s.take_due(t + QUIET, |g| g == "zzz").is_empty(), "an install holds it");
        assert_eq!(s.next_due(), None, "no timer while held");
        s.change("zzz", t + ms(900));
        assert_eq!(s.next_due(), None, "changes during the install wait too");
        s.released("zzz", t + ms(2000));
        assert_eq!(s.take_due(t + ms(2000) + QUIET, |_| false), vec![("zzz".to_string(), true)]);
        s.released("zzz", t + ms(3000));
        assert_eq!(s.next_due(), None, "a release with nothing waiting does nothing");
    }

    #[test]
    fn a_scans_own_writes_stop_after_a_few_rounds() {
        let t = Instant::now();
        let mut s = Settler::default();
        s.change("zzz", t);
        let mut now = t + QUIET;
        assert_eq!(s.take_due(now, |_| false), vec![("zzz".to_string(), true)]);
        // the first scan adopts a mod (changed) and its writes come back as changes
        s.scanned("zzz", now, now + ms(100), true, true);
        s.change("zzz", now + ms(50));
        for round in 0..ECHO_ROUNDS {
            now += ms(100) + QUIET;
            assert_eq!(s.take_due(now, |_| false), vec![("zzz".to_string(), false)], "round {round} follows the echo");
            s.scanned("zzz", now, now + ms(100), false, false);
            s.change("zzz", now + ms(50));
        }
        assert_eq!(s.next_due(), None, "a writer that answers every scan is ignored");
        // a change from outside still counts
        s.change("zzz", now + ms(5000));
        assert_eq!(s.take_due(now + ms(5000) + QUIET, |_| false), vec![("zzz".to_string(), true)]);
    }

    #[test]
    fn a_change_during_a_scan_that_found_something_is_followed() {
        let t = Instant::now();
        let mut s = Settler::default();
        s.scanned("zzz", t, t + ms(100), true, true);
        s.change("zzz", t + ms(50));
        assert_eq!(s.take_due(t + ms(50) + QUIET, |_| false), vec![("zzz".to_string(), false)]);
    }

    #[test]
    fn differs_on_any_field() {
        let a = ModEntry { id: "a".into(), name: "Ellen".into(), ..Default::default() };
        let b = ModEntry { id: "b".into(), name: "Lycaon".into(), ..Default::default() };
        assert!(!differs(&[a.clone(), b.clone()], &[b.clone(), a.clone()]), "order doesn't matter");
        assert!(differs(&[a.clone()], &[a.clone(), b.clone()]));
        assert!(differs(&[a.clone()], &[b.clone()]));
        let off = ModEntry { enabled: !a.enabled, ..a.clone() };
        assert!(differs(&[a], &[off]));
    }
}
