//! Storage tests on temporary folders. Nothing here reads a real game, XXMI or another manager's folder.
use super::*;
use crate::games::GamePaths;
use crate::model::ModSource;
use std::fs;
use std::sync::{Arc, Mutex};

fn temp(tag: &str) -> tempfile::TempDir {
    tempfile::Builder::new().prefix(&format!("gachamod-storage-{tag}-")).tempdir().unwrap()
}

fn write(p: &Path, bytes: usize) {
    if let Some(d) = p.parent() { fs::create_dir_all(d).unwrap(); }
    fs::write(p, vec![b'x'; bytes]).unwrap();
}

fn key<'a>(list: &'a [Item], key: &str) -> Option<&'a Item> { list.iter().find(|i| i.key == key) }

#[test]
fn categories() {
    assert_eq!(category_of("mods-on"), "on");
    assert_eq!(category_of("parts"), "downloads");
    assert_eq!(category_of("shader-cache"), "loader");
    assert_eq!(category_of("xxmi"), "loader");
    assert_eq!(category_of("thumbs"), "app");
    assert_eq!(category_of("others"), "others");
}

#[test]
fn the_data_folder_is_sorted_by_game_and_kind() {
    let d = temp("data");
    let p = d.path();
    write(&p.join("gachamod.sqlite"), 100);
    write(&p.join("gachamod.sqlite-wal"), 20);
    write(&p.join("cache/thumbs/a.jpg"), 30);
    write(&p.join("cache/packs/x/y.bin"), 40);
    write(&p.join("downloads/zzz/123-Ellen.zip"), 500);
    write(&p.join("downloads/zzz/124-Jane.zip.part"), 70);
    write(&p.join("trash/zzz/1/Coca Cola/mod.ini"), 60);
    write(&p.join("trash/zzz/2/Maid/mod.ini"), 5);
    write(&p.join("trash/extensions/old/main.js"), 8);
    fs::create_dir_all(p.join("backups/111-0")).unwrap();
    fs::write(p.join("backups/111-0/manifest.json"), r#"{"id":"111-0","game":"zzz","modId":"a","modDir":"","files":["mod.ini"],"created":[],"label":"Fix","at":1}"#).unwrap();
    write(&p.join("backups/111-0/mod.ini"), 9);
    write(&p.join("backups/gachamod-2026-11-17.sqlite"), 100);
    write(&p.join("fixers/gi/fix.py"), 11);
    write(&p.join("logs/gachamod.log"), 12);
    write(&p.join("look.json"), 3);

    let out = data_items(p, Stop::Never);
    assert_eq!(key(&out.app, "database").unwrap().bytes, 120);
    assert_eq!(key(&out.app, "thumbs").unwrap().bytes, 30);
    assert_eq!(key(&out.app, "cache").unwrap().bytes, 40, "the thumbnails aren't counted twice");
    assert_eq!(key(&out.app, "logs").unwrap().bytes, 12);
    let other = key(&out.app, "other").unwrap();
    assert_eq!((other.bytes, other.name.as_deref()), (3, Some("look.json")));
    assert!(other.path.as_deref().is_some_and(|x| x.ends_with("look.json")), "an unknown file opens by itself, not the data folder");
    assert_eq!(key(&out.app, "extensions-trash").unwrap().bytes, 8, "removed extensions have a row of their own");
    assert!(key(&out.app, "trash").is_none());
    let app_backups = key(&out.app, "backups").unwrap();
    assert!(app_backups.bytes >= 100 && app_backups.count == 1);

    let zzz = &out.games["zzz"];
    assert_eq!(key(zzz, "archives").unwrap().bytes, 500);
    assert_eq!(key(zzz, "parts").unwrap().bytes, 70);
    let trash = key(zzz, "trash").unwrap();
    assert_eq!((trash.bytes, trash.count), (65, 2));
    let b = key(zzz, "backups").unwrap();
    assert_eq!(b.count, 1);
    assert!(b.bytes >= 9);
    assert_eq!(key(&out.games["gi"], "fixers").unwrap().bytes, 11);
}

#[test]
fn the_loader_folder_leaves_out_mods_and_never_counts_the_game() {
    let d = temp("loader");
    let imp = d.path().join("ZZMI");
    write(&imp.join("d3dx.ini"), 10);
    write(&imp.join("d3d11.dll"), 1000);
    write(&imp.join("Mods/Ellen/mod.ini"), 5000);
    write(&imp.join("ShaderCache/a.bin"), 300);
    write(&imp.join("FrameAnalysis-2026-11-17/log.txt"), 200);
    write(&imp.join("d3d11_log.txt"), 50);
    let mods = imp.join("Mods");
    let v = loader_items(&imp, Some(&mods), None, Stop::Never);
    assert_eq!(key(&v, "shader-cache").unwrap().bytes, 300);
    assert_eq!(key(&v, "frame-dumps").unwrap().bytes, 200);
    assert_eq!(key(&v, "log").unwrap().bytes, 50);
    assert_eq!(key(&v, "loader").unwrap().bytes, 1010, "Mods, the cache, dumps and log are counted on their own");

    // a community loader inside the game folder: only its cache, dumps and log
    let v = loader_items(&imp, Some(&mods), Some(&imp), Stop::Never);
    assert!(key(&v, "loader").is_none());
    assert!(key(&v, "shader-cache").is_some());
}

fn entry(game: &str, id: &str, dir: &Path, on: bool, at: i64, size: u64) -> ModEntry {
    ModEntry {
        id: id.into(), game: game.into(), name: id.into(), folder: id.into(), rel_path: id.into(), path: dir.to_string_lossy().into_owned(),
        enabled: on, installed_at: at, size_bytes: size, ..Default::default()
    }
}

#[test]
fn copies_with_the_same_files_are_found_and_the_one_on_stays() {
    let d = temp("dupes");
    let mk = |name: &str, body: &str| {
        let m = d.path().join(name);
        fs::create_dir_all(m.join("tex")).unwrap();
        fs::write(m.join("mod.ini"), body).unwrap();
        fs::write(m.join("tex/body.dds"), "pixels").unwrap();
        m
    };
    let a = mk("A", "[TextureOverrideBody]\nhash = 1\n");
    let b = mk("B", "[TextureOverrideBody]\nhash = 1\n");
    let c = mk("C", "[TextureOverrideBody]\nhash = 2\n"); // same names and sizes, other bytes
    // what doesn't make copies different: the sidecar and a preview picture
    fs::write(a.join(SIDECAR_FILE), r#"{"id":"a"}"#).unwrap();
    fs::write(b.join(SIDECAR_FILE), r#"{"id":"b","name":"Other name"}"#).unwrap();
    fs::write(b.join("preview.jpg"), "a picture").unwrap();
    let mods = vec![entry("zzz", "a", &a, false, 300, 40), entry("zzz", "b", &b, true, 100, 50), entry("zzz", "c", &c, false, 200, 40)];
    let found = duplicates("zzz", &mods, &|_| None, Stop::Never);
    assert_eq!(found.len(), 1, "{found:?}");
    let g = &found[0];
    assert_eq!(g.kind, "same");
    assert_eq!(g.keep, "b", "the copy that is on stays, though another is newer");
    assert_eq!(g.remove, vec!["a".to_string()]);
    assert_eq!(g.bytes, 40);
}

#[test]
fn the_same_download_twice_counts_only_for_the_same_file_and_variant() {
    let d = temp("gb");
    let mk = |name: &str, body: &str| { let m = d.path().join(name); fs::create_dir_all(&m).unwrap(); fs::write(m.join("mod.ini"), body).unwrap(); m };
    let src = |file: u64| Some(ModSource { site: "gamebanana".into(), mod_id: 77, file_id: Some(file), ..Default::default() });
    let mut a = entry("zzz", "a", &mk("A", "one"), false, 100, 10);
    let mut b = entry("zzz", "b", &mk("B", "edited later"), false, 200, 12);
    let mut c = entry("zzz", "c", &mk("C", "another file"), false, 300, 9);
    let mut v = entry("zzz", "v", &mk("V", "variant two"), false, 400, 9);
    a.source = src(1);
    b.source = src(1);
    c.source = src(2);
    v.source = src(1);
    let variant = |m: &ModEntry| (m.id == "v").then(|| "Variant 2".to_string());
    let found = duplicates("zzz", &[a, b, c, v], &variant, Stop::Never);
    assert_eq!(found.len(), 1, "{found:?}");
    assert_eq!(found[0].kind, "download");
    assert_eq!(found[0].keep, "b", "the newest stays when none is on");
    assert_eq!(found[0].remove, vec!["a".to_string()]);
}

#[test]
fn nested_mods_and_sub_mods_are_never_offered_as_copies() {
    let d = temp("nested");
    let mk = |rel: &str| { let m = d.path().join(rel); fs::create_dir_all(&m).unwrap(); fs::write(m.join("mod.ini"), "same").unwrap(); m };
    // a mod folder holding another mod: the inner one has the same files as a third mod beside them
    let outer = mk("Outer");
    let inner = mk("Outer/Inner");
    let beside = mk("Outer copy");
    let mods = vec![entry("zzz", "o", &outer, true, 1, 8), entry("zzz", "i", &inner, true, 2, 4), entry("zzz", "b", &beside, true, 3, 4)];
    let ids: HashSet<String> = nested(&mods.iter().collect::<Vec<_>>());
    assert_eq!(ids, HashSet::from(["o".to_string(), "i".to_string()]), "a folder named like another plus more isn't nested");
    assert!(duplicates("zzz", &mods, &|_| None, Stop::Never).is_empty());

    // a sub-mod from the same download as its parent isn't a second copy of it
    let src = Some(ModSource { site: "gamebanana".into(), mod_id: 5, file_id: Some(9), ..Default::default() });
    let mut p = entry("zzz", "p", &mk("Skin"), true, 1, 10);
    let mut s = entry("zzz", "s", &mk("Skin hair"), true, 2, 3);
    fs::write(Path::new(&s.path).join("mod.ini"), "other").unwrap();
    p.source = src.clone();
    s.source = src;
    s.parent = Some("p".into());
    assert!(duplicates("zzz", &[p, s], &|_| None, Stop::Never).is_empty());
}

#[test]
fn characters_add_up_per_game() {
    let d = temp("chars");
    let mut a = entry("zzz", "a", d.path(), true, 1, 100);
    a.character = Some("Ellen Joe".into());
    let mut b = entry("zzz", "b", d.path(), false, 1, 50);
    b.character = Some("Ellen Joe".into());
    let c = entry("zzz", "c", d.path(), true, 1, 400);
    let mut e = entry("gi", "e", d.path(), true, 1, 70);
    e.character = Some("Ellen Joe".into());
    let v = characters(&[a, b, c, e]);
    assert_eq!(v[0], CharUse { game: "zzz".into(), name: None, bytes: 400, mods: 1, enabled: 1 });
    assert_eq!(v[1], CharUse { game: "zzz".into(), name: Some("Ellen Joe".into()), bytes: 150, mods: 2, enabled: 1 });
    assert_eq!(v[2].game, "gi");
}

#[test]
fn recycling_archives_skips_unfinished_and_busy_downloads() {
    let d = temp("arch");
    let dir = d.path().join("downloads").join("zzz");
    let old = std::time::SystemTime::now() - std::time::Duration::from_secs(3600);
    for (name, n) in [("1-a.zip", 100), ("2-b.7z", 50), ("3-c.zip.part", 70), ("4-d.zip", 30)] {
        write(&dir.join(name), n);
        fs::File::options().write(true).open(dir.join(name)).unwrap().set_modified(old).unwrap();
    }
    write(&dir.join("5-new.zip"), 20); // just written
    let busy = vec![dir.join("4-D.ZIP")];
    assert_eq!(recycle_archives(d.path(), Some("gi"), &busy).unwrap(), 0);
    assert_eq!(recycle_archives(d.path(), Some("zzz"), &busy).unwrap(), 150);
    assert!(!dir.join("1-a.zip").exists() && !dir.join("2-b.7z").exists());
    assert!(dir.join("3-c.zip.part").exists() && dir.join("4-d.zip").exists() && dir.join("5-new.zip").exists());
}

#[test]
fn a_measure_reads_the_library_and_trashed_copies_can_come_back() {
    let d = temp("measure");
    let imp = d.path().join("ZZMI");
    let mods = imp.join("Mods");
    let data = d.path().join("data");
    fs::create_dir_all(&data).unwrap();
    for (rel, body) in [("Ellen Joe/Maid", "[TextureOverrideBody]\nhash = 1\n"), ("Ellen Joe/Maid copy", "[TextureOverrideBody]\nhash = 1\n"), ("Jane Doe/Gym", "[TextureOverrideBody]\nhash = 2\n")] {
        write(&mods.join(rel).join("tex.dds"), 2000);
        fs::write(mods.join(rel).join("mod.ini"), body).unwrap();
    }
    write(&imp.join("d3dx.ini"), 10);
    write(&imp.join("ShaderCache/a.bin"), 300);
    let db = Db::memory().unwrap();
    games::save_paths(&db, "zzz", &GamePaths {
        importer_dir: Some(imp.to_string_lossy().into_owned()), mods_dir: Some(mods.to_string_lossy().into_owned()), ..Default::default()
    }).unwrap();
    library::characters_sync(&db, "zzz", &["Ellen Joe", "Jane Doe"].map(|n| library::CharacterRef { name: n.into(), ..Default::default() })).unwrap();
    let db: Shared = Arc::new(Mutex::new(db));
    let list = library::scan(&db, "zzz").unwrap();
    assert_eq!(list.len(), 3);

    let quick = measure(&db, &data, &Options::default(), &|_| {}).unwrap();
    assert!(!quick.complete && quick.duplicates.is_empty());
    assert_eq!(quick.mods.len(), 3);
    let zzz = quick.games.iter().find(|g| g.game == "zzz").unwrap();
    let on: u64 = list.iter().filter(|m| m.loaded()).map(|m| m.size_bytes).sum();
    assert_eq!(key(&zzz.items, "mods-on").unwrap().bytes, on);
    assert!(quick.characters.iter().any(|c| c.name.as_deref() == Some("Ellen Joe") && c.mods == 2));

    let steps = Mutex::new(Vec::new());
    let full = measure(&db, &data, &Options { full: true, outside: false }, &|s| steps.lock().unwrap().push(s.step.clone())).unwrap();
    assert!(full.complete);
    assert!(steps.lock().unwrap().contains(&"copies".to_string()));
    let zzz = full.games.iter().find(|g| g.game == "zzz").unwrap();
    assert_eq!(key(&zzz.items, "shader-cache").unwrap().bytes, 300);
    assert_eq!(full.duplicates.len(), 1, "{:?}", full.duplicates);
    let g = &full.duplicates[0];
    assert_eq!(g.kind, "same");

    // with "trash.days" at 0 a copy still waits in the trash for Undo
    let change = remove_copies(&db.lock().unwrap(), &data, "zzz", &g.remove).unwrap();
    assert_eq!(change.removed, g.remove);
    let trash = library::trash_list(&db.lock().unwrap(), "zzz").unwrap();
    assert_eq!(trash.len(), 1);
    assert_eq!(trash[0].reason, "replaced");
    library::trash_restore(&db.lock().unwrap(), trash[0].id).unwrap();
    assert_eq!(library::list(&db.lock().unwrap(), "zzz").unwrap().len(), 3);
}

fn age(p: &Path, days: u64) {
    let f = fs::File::options().write(true).open(p).unwrap();
    f.set_modified(std::time::SystemTime::now() - std::time::Duration::from_secs(days * 86_400)).unwrap();
}

#[test]
fn the_new_items_are_sorted_out() {
    assert_eq!(category_of("originals"), "backups");
    assert_eq!(category_of("live-menu"), "loader");
    let d = temp("new-items");
    let p = d.path();
    write(&p.join("originals/zzz/abc/files/mod.ini"), 20);
    write(&p.join("originals/zzz/abc/manifest.json"), 5);
    write(&p.join("extension-data/notes.json"), 7);
    write(&p.join("media/banners/a.png"), 9);
    write(&p.join("icons/zzz.png"), 11);
    write(&p.join(WEBVIEW_CLEAR), 0);
    let out = data_items(p, Stop::Never);
    let o = key(&out.games["zzz"], "originals").unwrap();
    assert_eq!((o.bytes, o.count), (25, 2));
    assert_eq!(key(&out.app, "extension-data").unwrap().bytes, 7);
    assert_eq!(key(&out.app, "media").unwrap().bytes, 9);
    assert_eq!(key(&out.app, "icons").unwrap().bytes, 11);
    assert!(key(&out.app, "other").is_none(), "the clear note isn't counted as another file");

    let imp = p.join("ZZMI");
    write(&imp.join("Mods/gachamod live/menu.dds"), 4000);
    let v = loader_items(&imp, Some(&imp.join("Mods")), None, Stop::Never);
    assert_eq!(key(&v, "live-menu").unwrap().bytes, 4000);
}

#[test]
fn what_other_files_held_has_rows_of_its_own() {
    let d = temp("named");
    let p = d.path();
    write(&p.join("gb-login/EBWebView/x.bin"), 30);
    write(&p.join("gb-session.bin"), 4);
    write(&p.join("ai/gemini.key"), 6);
    write(&p.join("xxmi-setup/launcher.zip"), 50);
    write(&p.join("trash/nrmm/zzz~1/Mods/a/mod.ini"), 70);
    write(&p.join("trash/odd/x.bin"), 2);
    write(&p.join("setup-game.json"), 1);
    let out = data_items(p, Stop::Never);
    let login = key(&out.app, "login").unwrap();
    assert_eq!(login.bytes, 34);
    assert!(login.path.as_deref().is_some_and(|x| x.ends_with("gb-login")));
    assert_eq!(key(&out.app, "ai").unwrap().bytes, 6);
    assert_eq!(key(&out.app, "setup").unwrap().bytes, 50);
    assert_eq!(key(&out.app, "nrmm-trash").unwrap().bytes, 70);
    let names: Vec<_> = out.app.iter().filter(|i| i.key == "other").filter_map(|i| i.name.clone()).collect();
    assert!(names.contains(&"setup-game.json".to_string()) && names.contains(&"trash/odd".to_string()), "{names:?}");

    let db = Db::memory().unwrap();
    assert_eq!(clear(&db, p, "nrmm-trash", None, false).unwrap(), 70);
    assert!(!p.join("trash/nrmm/zzz~1").exists());
    assert_eq!(clear(&db, p, "nrmm-trash", None, false).unwrap(), 0);
}

#[test]
fn old_logs_go_and_the_live_ones_stay() {
    let d = temp("logs");
    let p = d.path();
    let db = Db::memory().unwrap();
    write(&p.join("logs/gachamod.log"), 10);
    write(&p.join("logs/gachamod.old.log"), 20);
    write(&p.join("logs/crash-1.sent.json"), 3);
    write(&p.join("logs/crash-2.json"), 4);
    write(&p.join("logs/running"), 0);
    write(&p.join("logs/rendering/rendering.log"), 5);
    write(&p.join("logs/rendering/rendering.old.log"), 6);
    write(&p.join("logs/rendering/incident-1.txt"), 7);
    write(&p.join("logs/rendering/system.txt"), 8);
    assert_eq!(clear(&db, p, "logs-old", None, false).unwrap(), 36);
    for kept in ["gachamod.log", "crash-2.json", "running", "rendering/rendering.log", "rendering/system.txt"] {
        assert!(p.join("logs").join(kept).exists(), "{kept} stays");
    }
    assert!(!p.join("logs/gachamod.old.log").exists() && !p.join("logs/rendering/incident-1.txt").exists());
}

#[test]
fn caches_are_cleared_and_old_ones_age_out() {
    let d = temp("clear");
    let p = d.path();
    let db = Db::memory().unwrap();
    write(&p.join("cache/thumbs/a.jpg"), 30);
    write(&p.join("cache/packs/x/y.bin"), 40);
    assert_eq!(clear(&db, p, "cache", None, false).unwrap(), 40, "the thumbnails stay");
    assert!(p.join("cache/thumbs/a.jpg").is_file());
    assert_eq!(clear(&db, p, "thumbs", None, false).unwrap(), 30);

    // unpacked downloads: not while an install runs, and not what was just written
    write(&p.join("staging/old.bin"), 50);
    write(&p.join("staging/new.bin"), 60);
    age(&p.join("staging/old.bin"), 1);
    assert_eq!(clear(&db, p, "staging", None, true).unwrap(), 0);
    assert_eq!(clear(&db, p, "staging", None, false).unwrap(), 50);
    assert!(p.join("staging/new.bin").is_file());

    // the start drops pictures nobody has used for a long time
    write(&p.join("cache/thumbs/old.jpg"), 5);
    write(&p.join("cache/thumbs/new.jpg"), 5);
    write(&p.join("cache/packs/old.bin"), 5);
    age(&p.join("cache/thumbs/old.jpg"), 90);
    age(&p.join("cache/packs/old.bin"), 40);
    prune_caches(p);
    assert!(!p.join("cache/thumbs/old.jpg").exists() && !p.join("cache/packs/old.bin").exists());
    assert!(p.join("cache/thumbs/new.jpg").is_file());
    assert!(clear(&db, p, "nonsense", None, false).is_err());
}

#[test]
fn clearing_game_icons_keeps_the_quickstart_shortcut_icons() {
    let d = temp("icons");
    let p = d.path();
    let db = Db::memory().unwrap();
    write(&p.join("icons/zzz.png"), 11);
    write(&p.join("icons/quickstart-zzz-1-99.ico"), 20);
    assert_eq!(clear(&db, p, "icons", None, false).unwrap(), 11);
    assert!(!p.join("icons/zzz.png").exists());
    assert!(p.join("icons/quickstart-zzz-1-99.ico").is_file(), "a desktop shortcut still points at it");
}

#[test]
fn the_window_cache_clear_uses_the_queued_folder_and_stays_queued_until_it_is_done() {
    let d = temp("webview");
    let p = d.path();
    let db = Db::memory().unwrap();
    let profile = p.join("elsewhere/EBWebView");
    write(&profile.join("Default/Cache/a.bin"), 30);
    write(&profile.join("GrShaderCache/b.bin"), 20);
    write(&profile.join("chrome_debug.log"), 5);
    write(&profile.join("Default/Local Storage/keep.bin"), 7);
    fs::write(p.join(WEBVIEW_CLEAR), profile.to_string_lossy().as_bytes()).unwrap();
    on_start(&db, p);
    assert!(!profile.join("Default/Cache").exists() && !profile.join("GrShaderCache").exists() && !profile.join("chrome_debug.log").exists());
    assert!(profile.join("Default/Local Storage/keep.bin").is_file(), "saved page data stays");
    assert!(profile.is_dir(), "the profile itself stays");
    assert!(!p.join(WEBVIEW_CLEAR).exists(), "everything is gone, so the note goes");

    // a note that names a folder that is still in the way stays for the next start
    write(&profile.join("Default/Cache/a.bin"), 30);
    fs::write(p.join(WEBVIEW_CLEAR), profile.to_string_lossy().as_bytes()).unwrap();
    // a folder where the log should be can't be removed as a file, so the clear is not finished
    write(&profile.join("chrome_debug.log/inner.bin"), 1);
    on_start(&db, p);
    assert!(!profile.join("Default/Cache").exists());
    assert!(p.join(WEBVIEW_CLEAR).is_file(), "the log could not be deleted, so the request is kept");
}
