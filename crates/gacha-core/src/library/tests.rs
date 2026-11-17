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
    // the swap needs no note: the cards show it
    assert!(ch.notes.is_empty(), "{:?}", ch.notes);
    assert!(list_rows(&d).iter().filter(|m| m.character.as_deref() == Some("Ellen Joe") && m.enabled).count() == 1);

    // a bulk turn-on of two Ellen skins turns both on: the rule only turns off the ones not asked for
    set_enabled(&d, "zzz", &[maid.clone(), bunny.clone()], true).unwrap();
    let rows = list_rows(&d);
    assert!(rows.iter().find(|m| m.id == bunny).unwrap().enabled);
    assert!(rows.iter().find(|m| m.id == maid).unwrap().enabled);
    assert!(!rows.iter().find(|m| m.id == off_hoodie).unwrap().enabled);

    // with the rule off, turning one more on keeps the others
    d.set_setting("zzz.oneSkin", "0").unwrap();
    set_enabled(&d, "zzz", &[off_hoodie.clone()], true).unwrap();
    let rows = list_rows(&d);
    assert_eq!(rows.iter().filter(|m| m.character.as_deref() == Some("Ellen Joe") && m.enabled).count(), 3);
    // the disk agrees with the rows
    for m in rows { assert_eq!(m.enabled, !rel_disabled(&m.rel_path)); assert!(Path::new(&m.path).is_dir(), "{}", m.path); }
}

#[test]
fn scan_keeps_folders_an_ini_reaches_into() {
    let t = Tree::new("reach");
    let top = t.mods.join("Roxy/Overalls");
    fs::create_dir_all(top.join("resources")).unwrap();
    fs::create_dir_all(top.join("toggles")).unwrap();
    fs::write(top.join("resources/Roxy.ini"), "[ResourceMenu]\nfilename = ../toggles/Menu.dds\n").unwrap();
    fs::write(top.join("toggles/Menu.dds"), "dds").unwrap();
    let db = t.db();
    let list = scan(&db, "zzz").unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].rel_path, "Roxy/Overalls");
}

#[test]
fn sub_mods_go_with_their_parent() {
    let t = Tree::new("submods");
    t.add("Ellen Joe/Maid Ellen");
    t.add("Ellen Joe/DISABLED Hair Recolour");
    t.add("Ellen Joe/DISABLED Shark Hoodie");
    let db = t.db();
    let list = scan(&db, "zzz").unwrap();
    let d = db.lock().unwrap();
    let maid = by_name(&list, "Maid Ellen").id.clone();
    let hair = by_name(&list, "Hair Recolour").id.clone();
    let hoodie = by_name(&list, "Shark Hoodie").id.clone();
    let on = |id: &str| list_rows(&d).iter().find(|m| m.id == id).unwrap().enabled;
    let parent = |p: &str| MetaPatch { parent: Some(p.into()), ..Default::default() };

    // a sub-mod never counts as another skin: turning it on keeps its parent on
    let e = update_meta(&d, "zzz", &hair, &parent(&maid)).unwrap();
    assert_eq!(e.parent.as_deref(), Some(maid.as_str()));
    set_enabled(&d, "zzz", std::slice::from_ref(&hair), true).unwrap();
    assert!(on(&maid) && on(&hair));

    // the parent off takes its sub-mods with it, and on again brings them back
    set_enabled(&d, "zzz", std::slice::from_ref(&maid), false).unwrap();
    assert!(!on(&maid) && !on(&hair));
    set_enabled(&d, "zzz", std::slice::from_ref(&maid), true).unwrap();
    assert!(on(&maid) && on(&hair));

    // another skin turns the whole family off; a sub-mod turned on brings its parent back
    set_enabled(&d, "zzz", std::slice::from_ref(&hoodie), true).unwrap();
    assert!(on(&hoodie) && !on(&maid) && !on(&hair));
    set_enabled(&d, "zzz", std::slice::from_ref(&hair), true).unwrap();
    assert!(on(&maid) && on(&hair) && !on(&hoodie));

    // "Keep both on" leaves the other skin alone
    set_enabled_with(&d, "zzz", std::slice::from_ref(&hoodie), true, Some(false)).unwrap();
    assert!(on(&maid) && on(&hoodie));

    // picking a sub-mod as a parent uses its parent; a mod with sub-mods can't become one; "" unlinks
    let e = update_meta(&d, "zzz", &hoodie, &parent(&hair)).unwrap();
    assert_eq!(e.parent.as_deref(), Some(maid.as_str()));
    assert!(update_meta(&d, "zzz", &maid, &parent(&hoodie)).is_err());
    let e = update_meta(&d, "zzz", &hair, &parent("")).unwrap();
    assert_eq!(e.parent, None);
    drop(d);
    // the link lives in the sidecar, so a rescan keeps it
    assert_eq!(by_name(&scan(&db, "zzz").unwrap(), "Shark Hoodie").parent.as_deref(), Some(maid.as_str()));
}

fn list_rows(d: &Db) -> Vec<ModEntry> { list(d, "zzz").unwrap() }

#[test]
fn turning_on_names_a_disabled_folder_back() {
    let t = Tree::new("parent");
    t.add("DISABLED_old.zip/Jane Gym");
    t.add("DISABLED_old.zip/Jane Maid");
    t.add("DISABLED_old.zip/DISABLED Jane Bunny");
    let db = t.db();
    let list = scan(&db, "zzz").unwrap();
    let d = db.lock().unwrap();
    let gym = by_name(&list, "Jane Gym").id.clone();
    let maid = by_name(&list, "Jane Maid").id.clone();
    let ch = set_enabled(&d, "zzz", &[gym.clone()], true).unwrap();

    // the folder is named back, the mod is on, the others in it stay off on their own
    assert!(!t.mods.join("DISABLED_old.zip").exists());
    assert!(t.mods.join("old.zip/Jane Gym").is_dir());
    assert!(t.mods.join("old.zip/DISABLED Jane Maid").is_dir());
    assert!(t.mods.join("old.zip/DISABLED Jane Bunny").is_dir());
    let rows = list_rows(&d);
    let row = |id: &str| rows.iter().find(|r| r.id == id).unwrap().clone();
    assert!(row(&gym).enabled);
    assert_eq!(row(&gym).rel_path, "old.zip/Jane Gym");
    assert_eq!(row(&gym).group.as_deref(), Some("old.zip"));
    assert!(!row(&maid).enabled);
    assert_eq!(row(&maid).rel_path, "old.zip/DISABLED Jane Maid");
    assert!(ch.changed.iter().any(|c| c.id == maid && c.rel_path == "old.zip/DISABLED Jane Maid"));

    // turning on the other one afterwards works from the new paths ("Keep both on": both are Jane Doe's)
    set_enabled_with(&d, "zzz", &[maid.clone()], true, Some(false)).unwrap();
    assert!(t.mods.join("old.zip/Jane Maid").is_dir());
    drop(d);
    let again = scan(&db, "zzz").unwrap();
    assert!(by_name(&again, "Jane Gym").enabled && by_name(&again, "Jane Maid").enabled);
    assert!(!by_name(&again, "Jane Bunny").enabled);
}

#[test]
fn turning_on_two_mods_in_one_disabled_folder() {
    let t = Tree::new("parent2");
    t.add("DISABLED Old/Jane Gym");
    t.add("DISABLED Old/Ellen Maid");
    let db = t.db();
    let list = scan(&db, "zzz").unwrap();
    let d = db.lock().unwrap();
    let ids: Vec<String> = list.iter().map(|m| m.id.clone()).collect();
    set_enabled_with(&d, "zzz", &ids, true, Some(false)).unwrap();
    assert!(t.mods.join("Old/Jane Gym").is_dir() && t.mods.join("Old/Ellen Maid").is_dir());
    assert!(list_rows(&d).iter().all(|r| r.enabled && r.rel_path.starts_with("Old/")));
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
    // the files go at once by default; this test keeps them
    d.set_setting("trash.days", "14").unwrap();

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
fn remove_deletes_files_by_default() {
    let t = Tree::new("trash0");
    t.add("Ellen Joe/Maid Ellen");
    let db = t.db();
    let list = scan(&db, "zzz").unwrap();
    let d = db.lock().unwrap();
    let maid = by_name(&list, "Maid Ellen").clone();
    remove(&d, &t.data, "zzz", std::slice::from_ref(&maid.id), "removed").unwrap();
    // nothing kept on disk, but the record stays so it can be downloaded again
    assert!(trash_list(&d, "zzz").unwrap().is_empty());
    assert!(!t.data.join("trash").join("zzz").read_dir().is_ok_and(|mut r| r.next().is_some()));
    let a = archive_list(&d, Some("zzz")).unwrap();
    assert_eq!(a.len(), 1);
    assert!(a[0].trash_id.is_none() && a[0].mod_id == maid.id);
}

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

#[test]
fn profile_set_mods_snapshot_and_restore() {
    let t = Tree::new("profset");
    t.add("Ellen Joe/Maid Ellen");
    t.add("Jane Doe/Gym Jane");
    let db = t.db();
    let list = scan(&db, "zzz").unwrap();
    let (maid, gym) = (by_name(&list, "Maid Ellen").id.clone(), by_name(&list, "Gym Jane").id.clone());
    let d = db.lock().unwrap();
    let default = profiles::list(&d, "zzz").unwrap().remove(0);
    let two = profiles::create(&d, "zzz", "Two", None).unwrap();

    // another profile: only its rows change, no files move
    let r = profiles::set_mods(&d, two.id, std::slice::from_ref(&maid), false).unwrap();
    assert!(r.change.changed.is_empty());
    assert!(t.mods.join("Ellen Joe/Maid Ellen").is_dir());
    assert_eq!(profiles::members(&d, two.id).unwrap(), vec![gym.clone()]);
    assert_eq!(profiles::members(&d, default.id).unwrap().len(), 2);

    // the active profile: a normal toggle
    let r = profiles::set_mods(&d, default.id, std::slice::from_ref(&gym), false).unwrap();
    assert_eq!(r.change.changed.len(), 1);
    assert!(t.mods.join("Jane Doe/DISABLED Gym Jane").is_dir());
    assert_eq!(profiles::members(&d, default.id).unwrap(), vec![maid.clone()]);
    assert!(profiles::set_mods(&d, two.id, &["nope".into()], true).is_err());

    // delete and put back: same id, name and rows
    let snap = profiles::snapshot(&d, two.id).unwrap();
    profiles::delete(&d, two.id).unwrap();
    let back = profiles::restore(&d, &snap).unwrap();
    assert_eq!((back.id, back.name.as_str(), back.active), (two.id, "Two", false));
    assert_eq!(profiles::members(&d, back.id).unwrap(), vec![gym.clone()]);
    // the active one comes back active, under a free name when another took it
    let snap = profiles::snapshot(&d, default.id).unwrap();
    profiles::delete(&d, default.id).unwrap();
    profiles::update(&d, back.id, &crate::model::ProfilePatch { name: Some("Default".into()), ..Default::default() }).unwrap();
    let again = profiles::restore(&d, &snap).unwrap();
    assert!(again.active);
    assert_eq!(again.name, "Default (2)");
    assert!(!profiles::get(&d, back.id).unwrap().active);
}

#[test]
fn texture_images_are_not_previews() {
    let t = Tree::new("texprev");
    let dir = t.add("Velina Airgid/Velina");
    fs::write(dir.join("mod.ini"), "[ResourceBody]\nfilename = Body.jpg\n").unwrap();
    fs::write(dir.join("Body.jpg"), "tex").unwrap();
    fs::write(dir.join("Hair_LightMap.png"), "tex").unwrap();
    let db = t.db();
    assert_eq!(scan(&db, "zzz").unwrap()[0].preview, None);
    fs::write(dir.join("cover.png"), "real").unwrap();
    assert!(scan(&db, "zzz").unwrap()[0].preview.as_deref().is_some_and(|p| p.ends_with("cover.png")));
    // a GameBanana picture fetched later wins over the root picture, and keeps a shipped preview.* under another name
    let id = list(&db.lock().unwrap(), "zzz").unwrap()[0].id.clone();
    let e = save_fetched_preview(&db.lock().unwrap(), "zzz", &id, b"gb", "jpg").unwrap();
    assert!(e.preview.as_deref().is_some_and(|p| p.ends_with("preview.jpg")) && !e.custom_preview);
    let e = save_fetched_preview(&db.lock().unwrap(), "zzz", &id, b"gb2", "png").unwrap();
    assert!(e.preview.as_deref().is_some_and(|p| p.ends_with("preview.png")));
    assert_eq!(fs::read(dir.join("preview-original.jpg")).unwrap(), b"gb");
}

#[test]
fn other_managers_folders_come_in_with_their_details() {
    let t = Tree::new("managers");
    // JASM: Mods/<category>/<lowercase character>/<mod>, its own config and cover
    let maid = t.add("character/ellen joe/DISABLED_Maid");
    fs::write(maid.join(".JASM_ModConfig.json"), r#"{"Id":"x","CustomName":"Maid Ellen","Author":"Someone","ModUrl":"https://gamebanana.com/mods/111","ImagePath":".JASM_Cover.png"}"#).unwrap();
    fs::write(maid.join(".JASM_Cover.png"), "img").unwrap();
    t.add("character/hoshimi miyabi/Kimono");
    // a nickname as the only hint
    t.add("Unagi Swimsuit");
    // Fairy's Secret Folder: "<Character> - <Skin>/<mod>" and the character's id in category.json
    let thief = t.add("Jane Doe - Default Outfit/Thief");
    fs::write(t.mods.join("Jane Doe - Default Outfit/category.json"), r#"{"character_id":"jane_doe","skin_id":"default"}"#).unwrap();
    fs::write(thief.join(".zmm-meta.json"), r#"{"gb_mod_id":"222","author":"B","tags":["outfit"]}"#).unwrap();
    // turned off by renaming its ini
    let police = t.mods.join("Police Uniform");
    fs::create_dir_all(&police).unwrap();
    fs::write(police.join("DISABLED_PoliceUniform.ini"), "[TextureOverrideBody]\nhash = 0011aabb\n").unwrap();
    fs::write(police.join("ZhuYuanBody.ib"), "x").unwrap();

    let db = t.db();
    let list = scan(&db, "zzz").unwrap();
    let maid = by_name(&list, "Maid Ellen");
    assert_eq!((maid.character.as_deref(), maid.enabled), (Some("Ellen Joe"), false));
    assert_eq!(maid.source.as_ref().map(|s| s.mod_id), Some(111));
    assert!(maid.preview.as_deref().is_some_and(|p| p.ends_with(".JASM_Cover.png")));
    assert_eq!(by_name(&list, "Kimono").character.as_deref(), Some("Hoshimi Miyabi"));
    assert_eq!(by_name(&list, "Unagi Swimsuit").character.as_deref(), Some("Hoshimi Miyabi"));
    let thief = by_name(&list, "Thief");
    assert_eq!((thief.character.as_deref(), thief.source.as_ref().map(|s| s.mod_id)), (Some("Jane Doe"), Some(222)));
    assert_eq!(thief.tags, vec!["outfit"]);
    let police = by_name(&list, "Police Uniform");
    assert!(!police.enabled);
    // the other manager's files stay as they were
    assert!(t.mods.join("character/ellen joe/DISABLED_Maid/.JASM_ModConfig.json").is_file());

    // turning it on names the ini back
    let id = police.id.clone();
    let ch = set_enabled(&db.lock().unwrap(), "zzz", &[id.clone()], true).unwrap();
    assert!(ch.changed.iter().any(|m| m.id == id && m.enabled));
    assert!(t.mods.join("Police Uniform/PoliceUniform.ini").is_file());
    assert!(scan(&db, "zzz").unwrap().iter().any(|m| m.id == id && m.enabled));

    // details added later by the other manager fill the gaps of a known mod, with a way back
    let kimono = t.mods.join("character/hoshimi miyabi/Kimono");
    fs::write(kimono.join(".JASM_ModConfig.json"), r#"{"CustomName":"Winter Kimono","ModUrl":"https://gamebanana.com/mods/333"}"#).unwrap();
    let info = crate::managers::detect(&db, "zzz").unwrap();
    assert_eq!(info.fillable, 1);
    let r = crate::managers::import(&db, "zzz").unwrap();
    assert_eq!(r.changed, 1);
    let after = super::list(&db.lock().unwrap(), "zzz").unwrap();
    let k = after.iter().find(|m| m.rel_path.ends_with("Kimono")).unwrap();
    assert_eq!((k.name.as_str(), k.source.as_ref().map(|s| s.mod_id)), ("Winter Kimono", Some(333)));
    crate::managers::undo(&db, "zzz", &r.undo).unwrap();
    let back = super::list(&db.lock().unwrap(), "zzz").unwrap();
    let k = back.iter().find(|m| m.rel_path.ends_with("Kimono")).unwrap();
    assert_eq!((k.name.as_str(), k.source.is_none()), ("Kimono", true));
}

/// Scan a copy of a real Mods folder and print what each mod became. Not run by default: set GACHAMOD_SCAN_DIR (a
/// scratch copy, the scan writes .gachamod.json files into it), GACHAMOD_SCAN_GAME and GACHAMOD_ROSTERS (a folder
/// with "<game>.json" GameBanana rosters). Run with `cargo test -p gacha-core scan_a_real_copy -- --ignored --nocapture`.
#[test]
#[ignore]
fn scan_a_real_copy() {
    let (Ok(dir), Ok(game), Ok(rosters)) = (std::env::var("GACHAMOD_SCAN_DIR"), std::env::var("GACHAMOD_SCAN_GAME"), std::env::var("GACHAMOD_ROSTERS")) else { return };
    let db = Db::memory().unwrap();
    games::save_paths(&db, &game, &GamePaths { mods_dir: Some(dir.clone()), ..Default::default() }).unwrap();
    let raw = fs::read_to_string(format!("{rosters}/{game}.json")).unwrap();
    let list: Vec<(u64, String, u64)> = serde_json::from_str(&raw).unwrap();
    characters_sync(&db, &game, &list.into_iter().map(|r| CharacterRef { name: r.1, ..Default::default() }).collect::<Vec<_>>()).unwrap();
    let db: Shared = Arc::new(Mutex::new(db));
    for m in scan(&db, &game).unwrap() {
        println!("{:60} -> {:28} on={} name={:?}", m.rel_path, m.character.as_deref().unwrap_or("-"), m.enabled, m.name);
    }
}

#[test]
fn live_skins_switch_from_the_library() {
    let t = Tree::new("live");
    let ini = "[TextureOverrideBody]\nhash = 0011aabb\nib = ResourceIB\ndrawindexed = auto\n";
    for rel in ["Ellen Joe/Maid Ellen", "Ellen Joe/DISABLED Bunny", "Ellen Joe/DISABLED Plain"] {
        let d = t.mods.join(rel);
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join("mod.ini"), ini).unwrap();
    }
    let db = t.db();
    let list = scan(&db, "zzz").unwrap();
    let (maid, bunny, plain) = (by_name(&list, "Maid Ellen").id.clone(), by_name(&list, "Bunny").id.clone(), by_name(&list, "Plain").id.clone());
    let d = db.lock().unwrap();
    let row = |id: &str| get(&d, "zzz", id).unwrap();

    // Maid was on, so it shows; Bunny's folder comes on but it waits on standby, off in the library
    crate::live::add(&d, "zzz", &[maid.clone(), bunny.clone()]).unwrap();
    assert!(row(&maid).enabled && !row(&maid).standby);
    assert!(!row(&bunny).enabled && row(&bunny).standby && !rel_disabled(&row(&bunny).rel_path));

    // turning Bunny on picks it: no folder is renamed, Maid goes on standby
    let ch = set_enabled(&d, "zzz", &[bunny.clone()], true).unwrap();
    assert!(ch.changed.iter().any(|m| m.id == bunny && m.enabled));
    assert!(ch.changed.iter().any(|m| m.id == maid && m.standby));
    assert!(!rel_disabled(&row(&maid).rel_path) && !rel_disabled(&row(&bunny).rel_path));

    // turning the one showing off shows none of them
    set_enabled(&d, "zzz", &[bunny.clone()], false).unwrap();
    assert!(!row(&maid).enabled && !row(&bunny).enabled && row(&maid).standby && row(&bunny).standby);

    set_enabled(&d, "zzz", &[maid.clone()], true).unwrap();
    assert!(row(&maid).enabled && row(&bunny).standby);

    // a profile switch (and so a profile hotkey) picks the same way, without renaming anything
    let home = profiles::list(&d, "zzz").unwrap()[0].id;
    let other = profiles::create(&d, "zzz", "Bunny day", Some(home)).unwrap().id;
    profiles::set_mods(&d, other, &[bunny.clone()], true).unwrap();
    profiles::set_mods(&d, other, &[maid.clone()], false).unwrap();
    profiles::activate(&d, other).unwrap();
    assert!(row(&bunny).enabled && row(&maid).standby && !rel_disabled(&row(&maid).rel_path));
    profiles::activate(&d, home).unwrap();
    assert!(row(&maid).enabled && row(&bunny).standby);

    // a skin that isn't live comes on: the live ones show none (one skin per character)
    let ch = set_enabled(&d, "zzz", &[plain.clone()], true).unwrap();
    assert!(row(&plain).enabled && row(&maid).standby, "{:?}", ch.notes);
    assert!(ch.notes.is_empty(), "the swap needs no note: {:?}", ch.notes);
    // and a live skin coming on turns the plain one off again
    let ch = set_enabled(&d, "zzz", &[maid.clone()], true).unwrap();
    assert!(row(&maid).enabled && !row(&plain).enabled && rel_disabled(&row(&plain).rel_path), "{:?}", ch.notes);

    // an update puts back an ini without the gate: the next scan gates it again
    let maid_ini = Path::new(&row(&maid).path).join("mod.ini");
    fs::write(&maid_ini, ini).unwrap();
    drop(d);
    scan(&db, "zzz").unwrap();
    assert!(fs::read_to_string(&maid_ini).unwrap().contains("; gachamod:begin"));
    let d = db.lock().unwrap();
    assert!(get(&d, "zzz", &maid).unwrap().enabled && get(&d, "zzz", &bunny).unwrap().standby);

    // stop switching: the one showing stays on, the other goes off for real
    crate::live::remove(&d, "zzz", &[maid.clone(), bunny.clone()]).unwrap();
    let (m, b) = (get(&d, "zzz", &maid).unwrap(), get(&d, "zzz", &bunny).unwrap());
    assert!(m.enabled && !m.standby && !b.enabled && !b.standby && rel_disabled(&b.rel_path));
    assert!(!fs::read_to_string(&maid_ini).unwrap().contains("gachamod"));
}

#[test]
fn every_character_joins_and_new_mods_follow() {
    let t = Tree::new("liveall");
    let ini = "[TextureOverrideBody]\nhash = 0011aabb\nib = ResourceIB\ndrawindexed = auto\n";
    let make = |rel: &str| {
        let d = t.mods.join(rel);
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join("mod.ini"), ini).unwrap();
    };
    for rel in ["Ellen Joe/Maid Ellen", "Ellen Joe/DISABLED Bunny", "Anby Demara/Punk Anby"] { make(rel); }
    let db = t.db();
    let list = scan(&db, "zzz").unwrap();
    let anby = by_name(&list, "Punk Anby").id.clone();
    {
        let d = db.lock().unwrap();
        // every mod that has a character goes live, the one that was off too
        let c = crate::live::set_all(&d, "zzz", true).unwrap();
        assert_eq!(c.changed.len(), 3);
        let info = crate::live::info(&d, "zzz").unwrap();
        assert!(info.all && info.groups.len() == 2);
        // one taken out by hand
        crate::live::remove(&d, "zzz", &[anby.clone()]).unwrap();
    }
    // a new mod joins at the next scan, and the one taken out by hand stays out
    make("Ellen Joe/Plain");
    scan(&db, "zzz").unwrap();
    let d = db.lock().unwrap();
    let info = crate::live::info(&d, "zzz").unwrap();
    assert_eq!(info.groups.len(), 1);
    assert_eq!(info.groups[0].mods.len(), 3);
    // turning it on again brings that one back
    assert_eq!(crate::live::set_all(&d, "zzz", true).unwrap().changed, vec![anby]);
}

/// Switching in game is on by default in Zenless Zone Zero: the first start turns it on, also where an older version
/// turned it off. After that only the player's switch turns it off, and off takes every character out.
#[test]
fn switching_in_game_starts_on_and_only_the_switch_turns_it_off() {
    let t = Tree::new("starton");
    for rel in ["Ellen Joe/Maid", "Ellen Joe/DISABLED Bunny"] {
        let d = t.mods.join(rel);
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join("mod.ini"), "[TextureOverrideBody]\nhash = 0011aabb\nib = ResourceIB\ndrawindexed = auto\n").unwrap();
    }
    let db = t.db();
    let list = scan(&db, "zzz").unwrap();
    let maid = by_name(&list, "Maid").id.clone();
    let d = db.lock().unwrap();
    // what 0.1.1-beta.3 left behind
    d.set_setting("zzz.liveAll", "0").unwrap();
    crate::live::on_start(&d);
    let info = crate::live::info(&d, "zzz").unwrap();
    assert!(info.all && info.groups.len() == 1 && info.groups[0].mods.len() == 2);
    // the switch turned off: no character switches, and the skin that showed stays on
    crate::live::set_all(&d, "zzz", false).unwrap();
    let info = crate::live::info(&d, "zzz").unwrap();
    assert!(!info.all && info.groups.is_empty());
    assert!(get(&d, "zzz", &maid).unwrap().enabled);
    // and the next start leaves it off
    crate::live::on_start(&d);
    assert!(!crate::live::info(&d, "zzz").unwrap().all);
}

/// The game runs as administrator (or wouldn't come to the front): a pick the app couldn't key in waits in live.ini
/// for the game's next load, and what the game saves before it took it doesn't undo the pick in the app.
#[test]
fn a_pick_the_game_missed_waits_for_its_next_load() {
    let t = Tree::new("waiting");
    for rel in ["Ellen Joe/Maid", "Ellen Joe/Bunny"] {
        let d = t.add(rel);
        fs::write(d.join("mod.ini"), "[TextureOverrideBody]\nhash = 0011aabb\nib = ResourceIB\ndrawindexed = auto\n").unwrap();
    }
    let db = t.db();
    scan(&db, "zzz").unwrap();
    crate::live::set_all(&db.lock().unwrap(), "zzz", true).unwrap();
    let user = t.root.join("ZZMI").join("d3dx_user.ini");
    let live_ini = || fs::read_to_string(t.mods.join(crate::live::DIR).join("live.ini")).unwrap();
    let saved = |g: u32, asked: u32| {
        // a save comes after the app's last tap (file times are compared)
        std::thread::sleep(std::time::Duration::from_millis(30));
        fs::write(&user, format!("[Constants]\n$\\gachamod\\live\\g1 = {g}\n$\\gachamod\\live\\asked = {asked}\n")).unwrap();
    };
    let active = || crate::live::info(&db.lock().unwrap(), "zzz").unwrap().groups[0].active;
    assert_eq!(active(), 1);

    crate::launch::TEST_RUNNING.with(|r| r.set(true));
    // the keys don't reach the game: the pick waits, and live.ini asks for it once
    crate::live::pick(&db.lock().unwrap(), "zzz", 1, 2).unwrap();
    crate::live::flush_sends(&db);
    let ini = live_ini();
    assert!(ini.contains("[CommandListGachamodAsked]\r\nif $asked != 1\r\n  $g1 = 2\r\n  $asked = 1\r\nendif\r\n"), "{ini}");
    assert!(ini.contains("[Present]\r\nrun = CommandListGachamodAsked\r\n"));
    // the game saves what it shows before it took the pick: the app keeps its pick
    saved(1, 0);
    assert_eq!(active(), 2);
    // a second pick of the same character while waiting asks again under a new number
    crate::live::pick(&db.lock().unwrap(), "zzz", 1, 0).unwrap();
    crate::live::flush_sends(&db);
    assert!(live_ini().contains("if $asked != 2\r\n  $g1 = 0\r\n"));
    saved(1, 1);
    assert_eq!(active(), 0, "an older request taken isn't the latest");
    // the game took it (F10): the request goes, and picks made in the game's own menu are read back again
    saved(0, 2);
    assert_eq!(active(), 0);
    assert!(!live_ini().contains("GachamodAsked"));
    saved(2, 2);
    assert_eq!(active(), 2);

    // a pick that waits, then one that the keys bring in: nothing is left to ask for
    crate::live::pick(&db.lock().unwrap(), "zzz", 1, 1).unwrap();
    crate::live::flush_sends(&db);
    assert!(live_ini().contains("GachamodAsked"));
    crate::live::TEST_TAPS.with(|t| t.set(true));
    crate::live::pick(&db.lock().unwrap(), "zzz", 1, 2).unwrap();
    crate::live::flush_sends(&db);
    assert!(!live_ini().contains("GachamodAsked"));
    assert_eq!(active(), 2);
    crate::live::TEST_TAPS.with(|t| t.set(false));

    // the game took a waiting pick, then the player picked in its menu and closed it: the game's pick stands
    crate::live::pick(&db.lock().unwrap(), "zzz", 1, 1).unwrap();
    crate::live::flush_sends(&db);
    // the fourth request
    assert!(live_ini().contains("if $asked != 4\r\n"));
    saved(2, 4);
    crate::launch::TEST_RUNNING.with(|r| r.set(false));
    assert_eq!(active(), 2);
    assert!(fs::read_to_string(&user).unwrap().contains("$\\gachamod\\live\\g1 = 2"));

    // a pick that waits when the game closes is what it loads next time
    crate::launch::TEST_RUNNING.with(|r| r.set(true));
    crate::live::pick(&db.lock().unwrap(), "zzz", 1, 1).unwrap();
    crate::live::flush_sends(&db);
    crate::launch::TEST_RUNNING.with(|r| r.set(false));
    assert_eq!(active(), 1);
    assert!(fs::read_to_string(&user).unwrap().contains("$\\gachamod\\live\\g1 = 1"));
    assert!(!live_ini().contains("GachamodAsked"));
}

/// The game closed before it saved a pick the keys brought in: the app's pick stands and goes into the saved values.
/// A save after the pick (one made in the game's menu) still wins.
#[test]
fn a_pick_the_game_closed_on_is_kept() {
    let t = Tree::new("closed-on");
    for rel in ["Ellen Joe/Maid", "Ellen Joe/Bunny"] {
        let d = t.add(rel);
        fs::write(d.join("mod.ini"), "[TextureOverrideBody]\nhash = 0011aabb\nib = ResourceIB\ndrawindexed = auto\n").unwrap();
    }
    let db = t.db();
    scan(&db, "zzz").unwrap();
    crate::live::set_all(&db.lock().unwrap(), "zzz", true).unwrap();
    let user = t.root.join("ZZMI").join("d3dx_user.ini");
    let active = || crate::live::info(&db.lock().unwrap(), "zzz").unwrap().groups[0].active;
    fs::write(&user, "[Constants]\n$\\gachamod\\live\\g1 = 1\n").unwrap();
    std::thread::sleep(std::time::Duration::from_millis(30));

    crate::launch::TEST_RUNNING.with(|r| r.set(true));
    crate::live::TEST_TAPS.with(|t| t.set(true));
    crate::live::pick(&db.lock().unwrap(), "zzz", 1, 2).unwrap();
    crate::live::flush_sends(&db);
    crate::launch::TEST_RUNNING.with(|r| r.set(false));
    assert_eq!(active(), 2);
    assert!(fs::read_to_string(&user).unwrap().contains("$\\gachamod\\live\\g1 = 2"));

    crate::launch::TEST_RUNNING.with(|r| r.set(true));
    crate::live::pick(&db.lock().unwrap(), "zzz", 1, 1).unwrap();
    crate::live::flush_sends(&db);
    std::thread::sleep(std::time::Duration::from_millis(30));
    fs::write(&user, "[Constants]\n$\\gachamod\\live\\g1 = 2\n").unwrap();
    crate::launch::TEST_RUNNING.with(|r| r.set(false));
    assert_eq!(active(), 2, "a pick the game saved after the app's");
    crate::live::TEST_TAPS.with(|t| t.set(false));
}

/// A character that becomes live while the game runs may get the number of a group that's gone, whose pick the game
/// still has saved. Its pick is asked for at the reload, and the old saved value isn't read back meanwhile.
#[test]
fn a_new_group_asks_for_its_pick() {
    let t = Tree::new("new-group");
    for rel in ["Ellen Joe/Maid", "Ellen Joe/Bunny"] {
        let d = t.add(rel);
        fs::write(d.join("mod.ini"), "[TextureOverrideBody]\nhash = 0011aabb\nib = ResourceIB\ndrawindexed = auto\n").unwrap();
    }
    let db = t.db();
    scan(&db, "zzz").unwrap();
    let user = t.root.join("ZZMI").join("d3dx_user.ini");
    fs::write(&user, "[Constants]\n$\\gachamod\\live\\g1 = 3\n").unwrap();
    crate::launch::TEST_RUNNING.with(|r| r.set(true));
    crate::live::set_all(&db.lock().unwrap(), "zzz", true).unwrap();
    let ini = fs::read_to_string(t.mods.join(crate::live::DIR).join("live.ini")).unwrap();
    assert!(ini.contains("if $asked != 1\r\n  $g1 = 1\r\n"), "{ini}");
    let info = crate::live::info(&db.lock().unwrap(), "zzz").unwrap();
    assert_eq!(info.groups[0].active, 1);
    crate::launch::TEST_RUNNING.with(|r| r.set(false));
}

/// A pick made in the game's own menu reaches the library when the game saves, and turning off the skin the library
/// showed before says what the game wears. A pick the keys can't bring in says each time that it waits for a reload,
/// and its group says so until the game takes it.
#[test]
fn the_library_follows_picks_made_in_the_game() {
    let t = Tree::new("follow");
    for rel in ["Ellen Joe/Maid", "Ellen Joe/Bunny"] {
        let d = t.add(rel);
        fs::write(d.join("mod.ini"), "[TextureOverrideBody]\nhash = 0011aabb\nib = ResourceIB\ndrawindexed = auto\n").unwrap();
    }
    let db = t.db();
    scan(&db, "zzz").unwrap();
    crate::live::set_all(&db.lock().unwrap(), "zzz", true).unwrap();
    let user = t.root.join("ZZMI").join("d3dx_user.ini");
    let group = || crate::live::info(&db.lock().unwrap(), "zzz").unwrap().groups.remove(0);
    let g = group();
    let id_of = |slot: u32| g.mods.iter().find(|m| m.slot == slot).unwrap().mod_id.clone();
    let name_of = |slot: u32| g.mods.iter().find(|m| m.slot == slot).unwrap().name.clone();
    assert_eq!(g.active, 1);
    crate::launch::TEST_RUNNING.with(|r| r.set(true));

    // the player picks the second skin in the game's menu, and the game saves it
    std::thread::sleep(std::time::Duration::from_millis(30));
    fs::write(&user, "[Constants]\n$\\gachamod\\live\\g1 = 2\n").unwrap();
    assert!(crate::live::follow_game(&db.lock().unwrap(), "zzz"), "news for the windows");
    assert!(!crate::live::follow_game(&db.lock().unwrap(), "zzz"), "only once");
    let rows = list(&db.lock().unwrap(), "zzz").unwrap();
    assert!(rows.iter().any(|m| m.id == id_of(2) && m.enabled), "{:?} {:?}", rows.iter().map(|m| (&m.id, &m.name, m.enabled, m.standby)).collect::<Vec<_>>(), g.mods);
    assert!(rows.iter().any(|m| m.id == id_of(1) && m.standby && !m.enabled));

    // turning off the one the library showed before does nothing, and says what shows
    let c = set_enabled(&db.lock().unwrap(), "zzz", &[id_of(1)], false).unwrap();
    assert_eq!(c.notes, vec![format!("{} isn't showing. Ellen Joe wears {} in the game", name_of(1), name_of(2))]);
    assert_eq!(group().active, 2);

    // the keys don't reach the game: every pick says it waits, and the group waits until the game takes it
    for slot in [1, 0] {
        crate::live::pick(&db.lock().unwrap(), "zzz", 1, slot).unwrap();
        let notes = crate::live::flush_sends(&db);
        assert!(notes.len() == 1 && notes[0].starts_with("Ellen Joe's skin changes"), "{notes:?}");
        assert!(group().waiting);
    }
    std::thread::sleep(std::time::Duration::from_millis(30));
    fs::write(&user, "[Constants]\n$\\gachamod\\live\\g1 = 0\n$\\gachamod\\live\\asked = 2\n").unwrap();
    assert!(crate::live::follow_game(&db.lock().unwrap(), "zzz"));
    let g = group();
    assert!(!g.waiting && g.active == 0);
    crate::launch::TEST_RUNNING.with(|r| r.set(false));
}

#[test]
fn only_the_drawn_menu_is_a_tester_option_outside_the_games_it_is_open_in() {
    let db = Db::memory().unwrap();
    // switching in game itself works in every game
    if let Err(e) = crate::live::add(&db, "ww", &["x".to_string()]) { assert!(!e.to_string().contains("Tester options"), "{e}"); }
    assert!(crate::live::set_all(&db, "ww", false).is_ok());
    // the checked games and the ones that draw the same way have the drawn menu; the rest don't
    for g in ["zzz", "gi", "hsr", "hi3"] { assert!(crate::live::allowed(&db, g), "{g}"); }
    for g in ["ww", "ef", "pgr"] { assert!(!crate::live::allowed(&db, g), "{g}"); }
    // only the checked games get switching turned on by themselves
    crate::live::on_start(&db);
    assert!(!crate::live::all_on(&db, "hsr") && !crate::live::all_on(&db, "hi3"));
    db.set_setting("hsr.liveMenu", "game").unwrap();
    assert_eq!(crate::live::menu_settings(&db, "hsr").style, "game");
    // the menu the game draws needs tester options elsewhere
    let game = crate::live::MenuSettings { style: "game".into(), key: "F7".into(), ..Default::default() };
    let e = crate::live::set_menu(&db, "ww", &game).unwrap_err();
    assert!(e.to_string().contains("Tester options"), "{e}");
    // a saved "Inside the game" reads as the window over the game, so F7 still opens a menu
    db.set_setting("ww.liveMenu", "game").unwrap();
    assert_eq!(crate::live::menu_settings(&db, "ww").style, "window");
    // the older switch, set without the question about the risks, doesn't count
    db.set_setting("ui.tester", "1").unwrap();
    assert!(!crate::live::allowed(&db, "ww"));
    db.set_setting(crate::live::TESTER, "1").unwrap();
    assert!(crate::live::allowed(&db, "ww"));
    assert_eq!(crate::live::menu_settings(&db, "ww").style, "game");
}

#[test]
fn mods_that_change_other_parts_stay_on() {
    let t = Tree::new("parts");
    let body = "[TextureOverrideBody]\nhash = 0011aabb\nib = ResourceIB\ndrawindexed = auto\n";
    let hair = "[TextureOverrideHair]\nhash = 2233ccdd\nps-t0 = ResourcePink\n";
    for (rel, ini) in [("Ellen Joe/Maid", body), ("Ellen Joe/DISABLED Bunny", body), ("Ellen Joe/DISABLED Pink Hair", hair)] {
        fs::write(t.add(rel).join("mod.ini"), ini).unwrap();
    }
    let db = t.db();
    let list = scan(&db, "zzz").unwrap();
    let (maid, bunny, pink) = (by_name(&list, "Maid").id.clone(), by_name(&list, "Bunny").id.clone(), by_name(&list, "Pink Hair").id.clone());
    let d = db.lock().unwrap();
    let on = |id: &str| get(&d, "zzz", id).unwrap().enabled;

    // the hair changes other parts than the outfit, so the outfit stays on
    assert_eq!(overlapping(&d, "zzz", &[pink.clone()], &[maid.clone()]).unwrap(), Vec::<String>::new());
    set_enabled(&d, "zzz", &[pink.clone()], true).unwrap();
    assert!(on(&pink) && on(&maid));

    // another outfit changes the same body: the old one goes off, the hair stays
    assert_eq!(overlapping(&d, "zzz", &[bunny.clone()], &[maid.clone(), pink.clone()]).unwrap(), vec![maid.clone()]);
    set_enabled(&d, "zzz", &[bunny.clone()], true).unwrap();
    assert!(on(&bunny) && !on(&maid) && on(&pink));
}

#[test]
fn shift_on_a_live_skin_shows_it_next_to_the_one_showing() {
    let t = Tree::new("release");
    let ini = "[TextureOverrideBody]\nhash = 0011aabb\nib = ResourceIB\ndrawindexed = auto\n";
    for rel in ["Ellen Joe/Maid", "Ellen Joe/DISABLED Bunny"] { fs::write(t.add(rel).join("mod.ini"), ini).unwrap(); }
    let db = t.db();
    let list = scan(&db, "zzz").unwrap();
    let (maid, bunny) = (by_name(&list, "Maid").id.clone(), by_name(&list, "Bunny").id.clone());
    let d = db.lock().unwrap();
    crate::live::add(&d, "zzz", &[maid.clone(), bunny.clone()]).unwrap();
    assert!(get(&d, "zzz", &bunny).unwrap().standby);

    // "keep the others on" for Bunny: it leaves the group and goes on beside Maid, which keeps showing
    let ch = set_enabled_with(&d, "zzz", &[bunny.clone()], true, Some(false)).unwrap();
    let (m, b) = (get(&d, "zzz", &maid).unwrap(), get(&d, "zzz", &bunny).unwrap());
    assert!(m.enabled && !m.standby && b.enabled && !b.standby, "{:?}", ch.notes);
    assert!(ch.changed.iter().any(|e| e.id == bunny && e.enabled));
    assert_eq!(ch.notes, vec!["Bunny is on next to Maid. It doesn't switch in game any more, so the game shows it after it reloads its mods".to_string()]);
    let groups = crate::live::info(&d, "zzz").unwrap().groups;
    assert!(groups.iter().all(|g| g.mods.iter().all(|x| x.mod_id != bunny)));
    assert!(!fs::read_to_string(Path::new(&b.path).join("mod.ini")).unwrap().contains("gachamod"));
}

#[test]
fn picks_made_in_the_game_are_saved_right_away() {
    let t = Tree::new("fastsave");
    let d3dx = t.root.join("ZZMI").join("d3dx.ini");
    let original = "[System]\r\n; how often\r\nsettings_auto_save_interval = 60\r\n\r\n[Rendering]\r\ntexture_hash = 0\r\n";
    fs::write(&d3dx, original).unwrap();
    for rel in ["Ellen Joe/Maid", "Ellen Joe/Bunny"] {
        fs::write(t.add(rel).join("mod.ini"), "[TextureOverrideBody]\nhash = 0011aabb\nib = ResourceIB\ndrawindexed = auto\n").unwrap();
    }
    let db = t.db();
    scan(&db, "zzz").unwrap();
    let d = db.lock().unwrap();
    let interval = || crate::gamecheck::d3dx_value(&fs::read_to_string(&d3dx).unwrap(), "settings_auto_save_interval").unwrap();

    // no live characters: the loader's own value stays
    crate::live::menu_sync(&d, "zzz");
    assert_eq!(interval(), "60");

    crate::live::set_all(&d, "zzz", true).unwrap();
    crate::live::menu_sync(&d, "zzz");
    assert_eq!(interval(), "1");
    assert_eq!(fs::read_to_string(t.root.join("ZZMI").join("d3dx.ini.gachamod.bak")).unwrap(), original);
    assert!(fs::read_to_string(&d3dx).unwrap().contains("\r\n[Rendering]\r\ntexture_hash = 0"));

    // turned off: the value it had goes back
    let mut m = crate::live::menu_settings(&d, "zzz");
    m.fast_save = false;
    crate::live::set_menu(&d, "zzz", &m).unwrap();
    assert_eq!(interval(), "60");
    assert_eq!(fs::read_to_string(&d3dx).unwrap(), original);
}
