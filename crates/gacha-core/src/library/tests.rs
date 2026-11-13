//! Library and profile tests on a temporary Mods tree. Nothing here touches a real game folder.
use super::*;
use crate::games::GamePaths;
use std::sync::{Arc, Mutex};

struct Tree { root: PathBuf, mods: PathBuf, data: PathBuf }

impl Tree {
    fn new(tag: &str) -> Self {
        let root = std::env::temp_dir().join(format!("gachamod-test-library-{tag}-{}-{}", std::process::id(), new_id()));
        let mods = root.join("ZZMI").join("Mods");
        fs::create_dir_all(&mods).unwrap();
        Tree { data: root.join("data"), mods, root }
    }
    fn db(&self) -> Shared {
        let db = Db::memory().unwrap();
        games::save_paths(&db, "zzz", &GamePaths {
            importer_dir: Some(self.root.join("ZZMI").to_string_lossy().into_owned()),
            mods_dir: Some(self.mods.to_string_lossy().into_owned()),
            ..Default::default()
        }).unwrap();
        characters_sync(&db, "zzz", &["Ellen Joe", "Hoshimi Miyabi", "Jane Doe", "Zhu Yuan"].map(|n| CharacterRef { name: n.into(), ..Default::default() })).unwrap();
        Arc::new(Mutex::new(db))
    }
    /// A mod folder with one ini.
    fn add(&self, rel: &str) -> PathBuf {
        let d = self.mods.join(rel);
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join("mod.ini"), "[TextureOverrideBody]\nhash = 0011aabb\n").unwrap();
        d
    }
}

impl Drop for Tree {
    fn drop(&mut self) { let _ = fs::remove_dir_all(&self.root); }
}

fn by_name<'a>(list: &'a [ModEntry], name: &str) -> &'a ModEntry {
    list.iter().find(|m| m.name == name).unwrap_or_else(|| panic!("no mod named {name} in {:?}", list.iter().map(|m| &m.name).collect::<Vec<_>>()))
}

#[test]
fn names_and_prefixes() {
    assert_eq!(display_folder("DISABLED Coca Cola"), "Coca Cola");
    assert_eq!(display_folder("disabled_coca"), "coca");
    assert_eq!(display_folder("DISABLED - x"), "x");
    assert_eq!(display_folder("Disabledx"), "x");
    assert_eq!(display_folder("Coca"), "Coca");
    assert!(is_disabled_name("disabled"));
    assert!(!is_disabled_name("disable"));
    assert!(!is_disabled_name("Ä"));
    assert!(rel_disabled("Ellen/DISABLED x/y"));
    assert_eq!(disabled_parent("DISABLED Ellen/x"), Some("DISABLED Ellen"));
    assert_eq!(disabled_parent("Ellen/DISABLED x"), None);
    assert_eq!(clean_group(" Ellen Joe / ../x?* "), Some("Ellen Joe/x".into()));
    assert_eq!(clean_group(".."), None);
}

#[test]
fn character_matching() {
    let names: Vec<String> = ["Ellen Joe", "Hoshimi Miyabi", "Jane Doe", "Qingyi", "Wise", "Soldier 11"].iter().map(|s| s.to_string()).collect();
    let m = |h: &str| match_character(&names, &[h]);
    assert_eq!(m("ellen").as_deref(), Some("Ellen Joe"));
    assert_eq!(m("EllenJoe").as_deref(), Some("Ellen Joe"));
    assert_eq!(m("ellen_joe_bunny").as_deref(), Some("Ellen Joe"));
    assert_eq!(m("Soul Vessel Miyabi").as_deref(), Some("Hoshimi Miyabi"));
    assert_eq!(m("soulvesselmiyabi").as_deref(), Some("Hoshimi Miyabi"));
    assert_eq!(m("Wise").as_deref(), Some("Wise"));
    assert_eq!(m("otherwise"), None);
    assert_eq!(m("Doe"), None);
    assert_eq!(m("Character"), None);
    // the longest match wins across hints
    assert_eq!(match_character(&names, &["Jane", "Ellen Joe"]).as_deref(), Some("Ellen Joe"));
}

#[test]
fn scan_finds_mods_by_the_rules() {
    let t = Tree::new("scan");
    t.add("Coca Cola");
    t.add("Ellen Joe/Maid Ellen");
    t.add("Ellen Joe/DISABLED Shark Hoodie");
    // a wrapper with a generic inner name takes the outer name
    t.add("Ellen Joe/Bunny/mod");
    // a sub-mod inside a mod belongs to it
    let parent = t.add("Hoshimi Miyabi/Soul Vessel");
    t.add("Hoshimi Miyabi/Soul Vessel/variant b");
    // everything under a DISABLED group is off
    t.add("DISABLED Old/Jane Gym");
    // junk that isn't a mod
    fs::create_dir_all(t.mods.join("Empty group/nothing here")).unwrap();
    fs::write(t.mods.join("desktop.ini"), "").unwrap();
    fs::create_dir_all(t.mods.join("ShaderFixes")).unwrap();
    fs::write(t.mods.join("ShaderFixes/x.ini"), "").unwrap();
    fs::write(parent.join("preview.jpg"), "x").unwrap();

    let db = t.db();
    let list = scan(&db, "zzz").unwrap();
    assert_eq!(list.len(), 6, "{:?}", list.iter().map(|m| &m.rel_path).collect::<Vec<_>>());
    let coca = by_name(&list, "Coca Cola");
    assert!(coca.enabled);
    assert_eq!(coca.group, None);
    let maid = by_name(&list, "Maid Ellen");
    assert_eq!(maid.character.as_deref(), Some("Ellen Joe"));
    assert_eq!(maid.group.as_deref(), Some("Ellen Joe"));
    assert!(!by_name(&list, "Shark Hoodie").enabled);
    let bunny = by_name(&list, "Bunny");
    assert_eq!(bunny.rel_path, "Ellen Joe/Bunny/mod");
    let soul = by_name(&list, "Soul Vessel");
    assert_eq!(soul.character.as_deref(), Some("Hoshimi Miyabi"));
    assert_eq!(soul.ini_count, 2);
    assert!(soul.preview.as_deref().is_some_and(|p| p.ends_with("preview.jpg")));
    let gym = by_name(&list, "Jane Gym");
    assert!(!gym.enabled);
    assert_eq!(gym.character.as_deref(), Some("Jane Doe"));
    // every mod got a sidecar, and a second scan keeps the ids
    assert!(t.mods.join("Coca Cola").join(SIDECAR_FILE).is_file());
    let again = scan(&db, "zzz").unwrap();
    assert_eq!(by_name(&again, "Coca Cola").id, coca.id);
    assert_eq!(list_ids(&db), list_ids(&db));
}

fn list_ids(db: &Shared) -> Vec<String> {
    let mut v: Vec<String> = list(&db.lock().unwrap(), "zzz").unwrap().into_iter().map(|m| m.id).collect();
    v.sort();
    v
}

#[test]
fn copied_folder_gets_a_new_id() {
    let t = Tree::new("dup");
    let a = t.add("Ellen Joe/Coca Cola");
    let db = t.db();
    let first = scan(&db, "zzz").unwrap();
    let id = first[0].id.clone();
    // the user copies the folder; the copy sorts first but the original keeps its id
    let b = t.mods.join("Ellen Joe/Coca Cola - Copy");
    copy_dir(&a, &b).unwrap();
    let b2 = t.mods.join("Ellen Joe/A copy");
    copy_dir(&a, &b2).unwrap();
    let list = scan(&db, "zzz").unwrap();
    assert_eq!(list.len(), 3);
    let orig = list.iter().find(|m| m.rel_path == "Ellen Joe/Coca Cola").unwrap();
    assert_eq!(orig.id, id);
    let ids: HashSet<&str> = list.iter().map(|m| m.id.as_str()).collect();
    assert_eq!(ids.len(), 3);
    // the copies' sidecars were rewritten with their new ids
    assert_eq!(read_sidecar(&b2).unwrap().id, list.iter().find(|m| m.rel_path == "Ellen Joe/A copy").unwrap().id);
}

#[test]
fn toggles_with_one_skin_rule() {
    let t = Tree::new("toggle");
    t.add("Ellen Joe/Maid Ellen");
    t.add("Ellen Joe/DISABLED Shark Hoodie");
    t.add("Ellen Joe/DISABLED Bunny");
    t.add("Ellen Joe/Shark Hoodie");
    t.add("Zhu Yuan/Gym");
    let db = t.db();
    let list = scan(&db, "zzz").unwrap();
    let d = db.lock().unwrap();
    let maid = by_name(&list, "Maid Ellen").id.clone();
    let off_hoodie = list.iter().find(|m| m.rel_path == "Ellen Joe/DISABLED Shark Hoodie").unwrap().id.clone();
    let on_hoodie = list.iter().find(|m| m.rel_path == "Ellen Joe/Shark Hoodie").unwrap().id.clone();
    let bunny = by_name(&list, "Bunny").id.clone();

    // turning off: plain rename with the prefix
    let ch = set_enabled(&d, "zzz", &[maid.clone()], false).unwrap();
    assert_eq!(ch.changed.len(), 1);
    assert_eq!(ch.changed[0].folder, "DISABLED Maid Ellen");
    assert!(t.mods.join("Ellen Joe/DISABLED Maid Ellen").is_dir());

    // turning on the off hoodie: its name is taken, so it becomes "Shark Hoodie (2)", and the other enabled Ellen
    // skin goes off (one skin per character)
    let ch = set_enabled(&d, "zzz", &[off_hoodie.clone()], true).unwrap();
    let on = ch.changed.iter().find(|m| m.id == off_hoodie).unwrap();
    assert!(on.enabled);
    assert_eq!(on.folder, "Shark Hoodie (2)");
    let other = ch.changed.iter().find(|m| m.id == on_hoodie).unwrap();
    assert!(!other.enabled);
    assert!(ch.notes.iter().any(|n| n == "Turned off Shark Hoodie (Ellen Joe)"), "{:?}", ch.notes);
    assert!(list_rows(&d).iter().filter(|m| m.character.as_deref() == Some("Ellen Joe") && m.enabled).count() == 1);

    // a bulk turn-on of two Ellen skins keeps the last one on
    let ch = set_enabled(&d, "zzz", &[maid.clone(), bunny.clone()], true).unwrap();
    let rows = list_rows(&d);
    assert!(rows.iter().find(|m| m.id == bunny).unwrap().enabled);
    assert!(!rows.iter().find(|m| m.id == maid).unwrap().enabled);
    assert!(!rows.iter().find(|m| m.id == off_hoodie).unwrap().enabled);
    assert!(ch.notes.iter().any(|n| n.contains("kept Bunny on")), "{:?}", ch.notes);

    // with the rule off, two skins can be on
    d.set_setting("zzz.oneSkin", "0").unwrap();
    set_enabled(&d, "zzz", &[maid.clone()], true).unwrap();
    let rows = list_rows(&d);
    assert_eq!(rows.iter().filter(|m| m.character.as_deref() == Some("Ellen Joe") && m.enabled).count(), 2);
    // the disk agrees with the rows
    for m in rows { assert_eq!(m.enabled, !rel_disabled(&m.rel_path)); assert!(Path::new(&m.path).is_dir(), "{}", m.path); }
}

fn list_rows(d: &Db) -> Vec<ModEntry> { list(d, "zzz").unwrap() }

#[test]
fn disabled_parent_is_a_conflict() {
    let t = Tree::new("parent");
    t.add("DISABLED Old/Jane Gym");
    let db = t.db();
    let list = scan(&db, "zzz").unwrap();
    let d = db.lock().unwrap();
    let err = set_enabled(&d, "zzz", &[list[0].id.clone()], true).unwrap_err();
    assert!(matches!(&err, Error::Conflict(m) if m.contains("DISABLED Old")), "{err}");
}

#[test]
fn remove_and_restore() {
    let t = Tree::new("trash");
    t.add("Ellen Joe/Maid Ellen");
    t.add("Ellen Joe/DISABLED Bunny");
    let db = t.db();
    let list = scan(&db, "zzz").unwrap();
    let d = db.lock().unwrap();
    profiles::list(&d, "zzz").unwrap();
    let maid = by_name(&list, "Maid Ellen").clone();
    let bunny = by_name(&list, "Bunny").clone();

    let ch = remove(&d, &t.data, "zzz", &[maid.id.clone(), bunny.id.clone()], "removed").unwrap();
    assert_eq!(ch.removed.len(), 2);
    assert!(!t.mods.join("Ellen Joe/Maid Ellen").exists());
    assert!(list_rows(&d).is_empty());
    let trash = trash_list(&d, "zzz").unwrap();
    assert_eq!(trash.len(), 2);

    // something new took the old place meanwhile: the restore lands beside it
    t.add("Ellen Joe/Maid Ellen");
    let entry = trash.iter().find(|x| x.mod_id == maid.id).unwrap();
    let ch = restore_ok(&d, entry.id);
    let back = &ch.changed[0];
    assert_eq!(back.id, maid.id);
    assert_eq!(back.folder, "Maid Ellen (2)");
    assert!(back.enabled);
    let entry = trash.iter().find(|x| x.mod_id == bunny.id).unwrap();
    let back = &restore_ok(&d, entry.id).changed[0];
    assert_eq!(back.folder, "DISABLED Bunny");
    assert!(!back.enabled);
    assert!(trash_list(&d, "zzz").unwrap().is_empty());
    // the profile still has them as they were
    let p = profiles::list(&d, "zzz").unwrap().remove(0);
    assert_eq!(profiles::members(&d, p.id).unwrap(), vec![maid.id.clone()]);

    // purge: one entry for good
    let ch = remove(&d, &t.data, "zzz", &[bunny.id.clone()], "removed").unwrap();
    assert_eq!(ch.removed, vec![bunny.id.clone()]);
    let tid = trash_list(&d, "zzz").unwrap()[0].id;
    assert_eq!(trash_purge(&d, Some(tid)).unwrap(), 1);
    assert!(trash_list(&d, "zzz").unwrap().is_empty());
    assert_eq!(trash_purge(&d, None).unwrap(), 0);
}

fn restore_ok(d: &Db, id: i64) -> ModChange { trash_restore(d, id).unwrap() }

#[test]
fn move_meta_and_add_folder() {
    let t = Tree::new("move");
    t.add("Coca Cola");
    let db = t.db();
    let list = scan(&db, "zzz").unwrap();
    let d = db.lock().unwrap();
    let id = list[0].id.clone();
    let e = move_to_group(&d, "zzz", &id, Some("Ellen Joe")).unwrap();
    assert_eq!(e.rel_path, "Ellen Joe/Coca Cola");
    assert_eq!(e.group.as_deref(), Some("Ellen Joe"));
    let e = update_meta(&d, "zzz", &id, &MetaPatch { name: Some("Coke".into()), character: Some("Ellen Joe".into()), tags: Some(vec!["red".into(), "Red".into()]), ..Default::default() }).unwrap();
    assert_eq!(e.name, "Coke");
    assert_eq!(e.tags, vec!["red".to_string()]);
    assert_eq!(read_sidecar(Path::new(&e.path)).unwrap().name, "Coke");
    let e = move_to_group(&d, "zzz", &id, None).unwrap();
    assert_eq!(e.rel_path, "Coca Cola");
    // the empty character folder went away
    assert!(!t.mods.join("Ellen Joe").exists());

    let placed = t.add("Jane Doe/Office");
    let e = add_folder(&d, "zzz", &placed, None).unwrap();
    assert_eq!(e.character.as_deref(), Some("Jane Doe"));
    assert!(read_sidecar(&placed).is_some());
    mark_updates(&d, "zzz", &[e.id.clone()]).unwrap();
    assert!(get(&d, "zzz", &e.id).unwrap().update_available);
    mark_updates(&d, "zzz", &[]).unwrap();
    assert!(!get(&d, "zzz", &e.id).unwrap().update_available);
    let chars = characters(&d, "zzz").unwrap();
    assert_eq!(chars.iter().find(|c| c.name == "Jane Doe").unwrap().mod_count, 1);
    assert_eq!(chars.len(), 4);
}

#[test]
fn imm_links_list_each_mod_once() {
    let t = Tree::new("imm");
    let store = t.mods.join(IMM_STORE);
    let on = t.add(&format!("{IMM_STORE}/Ellen Joe/Maid"));
    t.add(&format!("{IMM_STORE}/Ellen Joe/Bunny"));
    let links = t.mods.join(IMM_LINKS);
    fs::create_dir_all(&links).unwrap();
    let link = links.join("Maid");
    let made = std::process::Command::new("cmd").args(["/c", "mklink", "/J"]).arg(&link).arg(&on).output().is_ok_and(|o| o.status.success());
    if !made { eprintln!("junction not made, skipping the link part"); }
    let db = t.db();
    let list = scan(&db, "zzz").unwrap();
    assert_eq!(list.len(), 2, "{:?}", list.iter().map(|m| &m.rel_path).collect::<Vec<_>>());
    if made {
        assert!(by_name(&list, "Maid").enabled);
    }
    assert!(!by_name(&list, "Bunny").enabled);
    assert!(store.is_dir());
    let d = db.lock().unwrap();
    let err = set_enabled(&d, "zzz", &[by_name(&list, "Bunny").id.clone()], true).unwrap_err();
    assert!(matches!(err, Error::Conflict(_)));
    if made { let _ = fs::remove_dir(&link); }
}

#[test]
fn profile_switch() {
    let t = Tree::new("profiles");
    t.add("Ellen Joe/Maid Ellen");
    t.add("Ellen Joe/DISABLED Bunny");
    t.add("Coca Cola");
    let db = t.db();
    let list = scan(&db, "zzz").unwrap();
    let d = db.lock().unwrap();
    let maid = by_name(&list, "Maid Ellen").id.clone();
    let bunny = by_name(&list, "Bunny").id.clone();
    let coca = by_name(&list, "Coca Cola").id.clone();

    let ps = profiles::list(&d, "zzz").unwrap();
    assert_eq!(ps.len(), 1);
    let default = ps[0].clone();
    assert!(default.active);
    assert_eq!(default.mod_count, 2);

    // "Bunny day": starts from now, then the toggles follow it because it is active
    let bunny_day = profiles::create(&d, "zzz", "Bunny day", None).unwrap();
    let r = profiles::activate(&d, bunny_day.id).unwrap();
    assert!(r.change.changed.is_empty());
    assert!(r.profile.active);
    set_enabled(&d, "zzz", &[bunny.clone()], true).unwrap();
    set_enabled(&d, "zzz", &[coca.clone()], false).unwrap();
    let mut m = profiles::members(&d, bunny_day.id).unwrap();
    m.sort();
    assert_eq!(m, vec![bunny.clone()]);

    // back to Default: Maid and Coca Cola on, Bunny off
    let r = profiles::activate(&d, default.id).unwrap();
    assert!(!r.vars_pending);
    let rows = list_rows(&d);
    let state = |id: &str| rows.iter().find(|m| m.id == id).unwrap().enabled;
    assert!(state(&maid) && state(&coca) && !state(&bunny));
    assert_eq!(r.change.changed.len(), 3);

    // names stay unique, the last profile can't go, deleting the active one moves the marker
    let again = profiles::create(&d, "zzz", "bunny DAY", Some(bunny_day.id)).unwrap();
    assert_eq!(again.name, "bunny DAY (2)");
    profiles::delete(&d, again.id).unwrap();
    profiles::delete(&d, default.id).unwrap();
    let ps = profiles::list(&d, "zzz").unwrap();
    assert_eq!(ps.len(), 1);
    assert!(ps[0].active);
    assert!(matches!(profiles::delete(&d, ps[0].id), Err(Error::Conflict(_))));
    let p = profiles::update(&d, ps[0].id, &ProfilePatchT { icon: Some("char:Ellen Joe".into()), color: Some("#ff8800".into()), ..Default::default() }).unwrap();
    assert_eq!(p.icon.as_deref(), Some("char:Ellen Joe"));
    let p = profiles::update(&d, p.id, &ProfilePatchT { icon: Some(String::new()), ..Default::default() }).unwrap();
    assert_eq!(p.icon, None);
    assert_eq!(p.color.as_deref(), Some("#ff8800"));
}

use crate::model::ProfilePatch as ProfilePatchT;

#[test]
fn scan_of_a_thousand_mods_is_quick() {
    let t = Tree::new("speed");
    for i in 0..1000 {
        let d = t.add(&format!("Character {}/Mod {i}", i % 40));
        for f in 0..6 { fs::write(d.join(format!("part{f}.buf")), [0u8; 64]).unwrap(); }
        fs::write(d.join("preview.png"), [0u8; 16]).unwrap();
    }
    let db = t.db();
    let first = std::time::Instant::now();
    assert_eq!(scan(&db, "zzz").unwrap().len(), 1000);
    let adopt = first.elapsed();
    let again = std::time::Instant::now();
    assert_eq!(scan(&db, "zzz").unwrap().len(), 1000);
    let rescan = again.elapsed();
    eprintln!("1000 mods: first scan {adopt:?}, rescan {rescan:?}");
    assert!(rescan < std::time::Duration::from_secs(4), "rescan took {rescan:?}");
}

#[test]
fn custom_preview_wins_and_keeps_the_old_one() {
    let t = Tree::new("preview");
    let dir = t.add("Coca Cola");
    fs::write(dir.join("preview.jpg"), b"old jpg").unwrap();
    fs::write(dir.join("a shot.png"), b"other").unwrap();
    let picked = t.root.join("picked.PNG");
    fs::write(&picked, b"new png").unwrap();
    let db = t.db();
    let id = scan(&db, "zzz").unwrap()[0].id.clone();
    let d = db.lock().unwrap();
    assert!(get(&d, "zzz", &id).unwrap().preview.unwrap().ends_with("preview.jpg"));
    assert!(matches!(set_preview_file(&d, "zzz", &id, &t.root.join("notes.txt")), Err(Error::Invalid(_))));

    let e = set_preview_file(&d, "zzz", &id, &picked).unwrap();
    assert!(e.custom_preview);
    assert!(e.preview.as_deref().unwrap().ends_with("preview.png"));
    assert_eq!(fs::read(dir.join("preview.png")).unwrap(), b"new png");
    // the old preview is kept under a new name, and the picked file stays where it was
    assert_eq!(fs::read(dir.join("preview-original.jpg")).unwrap(), b"old jpg");
    assert!(!dir.join("preview.jpg").exists());
    assert!(picked.exists());

    // a preview that shows up later (an update) doesn't beat the user's own, through a rescan too
    fs::write(dir.join("preview.gif"), b"later").unwrap();
    drop(d);
    let e = scan(&db, "zzz").unwrap().into_iter().find(|m| m.id == id).unwrap();
    assert!(e.custom_preview);
    assert!(e.preview.as_deref().unwrap().ends_with("preview.png"));
    let d = db.lock().unwrap();

    // a second custom preview replaces gachamod's copy and keeps the later file
    let e = set_preview(&d, "zzz", &id, b"pasted", "webp").unwrap();
    assert!(e.preview.as_deref().unwrap().ends_with("preview.webp"));
    assert!(!dir.join("preview.png").exists());
    assert_eq!(fs::read(dir.join("preview-original.gif")).unwrap(), b"later");
    assert_eq!(read_sidecar(&dir).unwrap().preview_backups.len(), 2);

    // removing it puts the kept files back
    let e = clear_preview(&d, "zzz", &id).unwrap();
    assert!(!e.custom_preview);
    assert!(!dir.join("preview.webp").exists());
    assert_eq!(fs::read(dir.join("preview.jpg")).unwrap(), b"old jpg");
    assert_eq!(fs::read(dir.join("preview.gif")).unwrap(), b"later");
    assert!(!dir.join("preview-original.jpg").exists());
    let sc = read_sidecar(&dir).unwrap();
    assert!(sc.custom_preview.is_none() && sc.preview_backups.is_empty());
    assert!(e.preview.unwrap().contains("preview."));
}
