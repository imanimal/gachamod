use super::*;
use crate::keys::KeyTarget;
use crate::model::ModSource;
use std::sync::{Arc, Mutex};

struct Env { root: PathBuf, db: Shared, mods: PathBuf, importer: PathBuf }
impl Drop for Env { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.root); } }

fn env(name: &str) -> Env {
    let root = std::env::temp_dir().join(format!("gachamod-pack-{name}-{}", library::new_id()));
    let importer = root.join("ZZMI");
    let mods = importer.join("Mods");
    fs::create_dir_all(&mods).unwrap();
    let db = Db::open(&root.join("data").join("gachamod.sqlite")).unwrap();
    crate::games::save_paths(&db, "zzz", &crate::games::GamePaths { importer_dir: Some(importer.to_string_lossy().into()), mods_dir: Some(mods.to_string_lossy().into()), ..Default::default() }).unwrap();
    Env { root, db: Arc::new(Mutex::new(db)), mods, importer }
}

const INI: &str = "[Constants]\nglobal persist $swapvar = 0\n[KeySwap]\nkey = VK_DOWN\ntype = cycle\n$swapvar = 0,1\n[TextureOverrideA]\nhash = 12345678\nvb0 = ResourceA\n";

/// A mod folder like the ones people have: an ini, a texture, a preview and some junk.
fn make_mod(dir: &Path, id: &str, name: &str, source: Option<ModSource>) -> Sidecar {
    fs::create_dir_all(dir.join("Textures")).unwrap();
    fs::write(dir.join("mod.ini"), INI).unwrap();
    fs::write(dir.join("Textures/a.dds"), vec![7u8; 5000]).unwrap();
    fs::write(dir.join("preview.png"), b"\x89PNG fake").unwrap();
    fs::write(dir.join("desktop.ini"), "junk").unwrap();
    fs::write(dir.join("old.bak"), "junk").unwrap();
    fs::create_dir_all(dir.join("ShaderCache")).unwrap();
    fs::write(dir.join("ShaderCache/x.bin"), "junk").unwrap();
    let sidecar = Sidecar { format: 1, id: id.into(), name: name.into(), character: Some("Ellen Joe".into()), source, ..Default::default() };
    library::write_sidecar(dir, &sidecar).unwrap();
    sidecar
}

fn gb(mod_id: u64, file_id: u64) -> ModSource {
    ModSource { site: "gamebanana".into(), mod_id, file_id: Some(file_id), url: format!("https://gamebanana.com/mods/{mod_id}"), file_name: Some("coca.zip".into()), ..Default::default() }
}

/// A format 1 file, as the first gachamod wrote them.
fn manifest(game: &str) -> Manifest {
    Manifest { format: 1, app_version: "test".into(), created_at: 1, kind: "mods".into(), title: "Test".into(), game: game.into(), ..Default::default() }
}

fn import_test(e: &Env, pack: &Path, mode: &str, profiles: bool) -> ImportResult {
    let mut z = open_zip(pack).unwrap();
    let m = read_manifest(&mut z).unwrap();
    let data = e.root.join("data");
    let opts = ImportOptions { only: vec![], on_existing: mode.into(), apply_profile: profiles };
    import_all(&e.db, &mut z, &m, &opts, &data, &data.join("staging").join("t"), &|_, _| {}).unwrap()
}

/// Two mods with their files in the pack (one off), written the way export writes them.
fn build_pack(e: &Env) -> PathBuf {
    let src = e.root.join("src");
    let items = [
        (src.join("Coca Cola"), make_mod(&src.join("Coca Cola"), &"a".repeat(32), "Coca Cola", None), true),
        (src.join("DISABLED Bunny"), make_mod(&src.join("DISABLED Bunny"), &"b".repeat(32), "Bunny", None), false),
    ];
    let mut gp = GamePart { game: "zzz".into(), ..Default::default() };
    let mut embeds = Vec::new();
    for (n, (dir, sidecar, enabled)) in items.into_iter().enumerate() {
        let files = mod_files(&dir);
        gp.mods.push(PackedMod {
            dir: format!("mods/{n}"), rel_path: clean_rel(&dir.file_name().unwrap().to_string_lossy()), enabled, sidecar,
            vars: vec![VarValue { ini: "mod.ini".into(), var: "swapvar".into(), value: "1".into() }],
            size: files.iter().map(|f| f.2).sum(), files: files.len() as u32, ..Default::default()
        });
        embeds.push(Embed { dir: format!("mods/{n}"), files });
    }
    let m = Manifest { format: FORMAT, app_version: "test".into(), created_at: 1, kind: "mods".into(), title: "Ellen skins".into(), games: vec![gp], ..Default::default() };
    let dest = e.root.join("out").join("Ellen skins.gachamod");
    let calls = std::cell::Cell::new(0);
    write_pack(&dest, &m, &embeds, &[], &|d, t| { assert!(d <= t); calls.set(calls.get() + 1); }).unwrap();
    assert!(calls.get() >= 1);
    assert!(dest.is_file());
    assert!(!e.root.join("out").join("Ellen skins.gachamod.part").exists());
    dest
}

#[test]
fn export_inspect_import_round_trip() {
    let e = env("trip");
    let pack = build_pack(&e);
    // manifest first, junk left out, no DISABLED in stored paths
    let mut z = open_zip(&pack).unwrap();
    assert_eq!(z.by_index(0).unwrap().name(), MANIFEST);
    let names: Vec<String> = entry_names(&mut z).into_iter().map(|(_, n)| n).collect();
    assert!(names.contains(&"mods/0/mod.ini".to_string()));
    assert!(names.contains(&"mods/0/.gachamod.json".to_string()));
    assert!(names.iter().all(|n| !n.contains("desktop.ini") && !n.ends_with(".bak") && !n.contains("ShaderCache") && !n.contains("DISABLED")), "{names:?}");
    assert_eq!(z.by_name("mods/0/preview.png").unwrap().compression(), zip::CompressionMethod::Stored);
    assert_eq!(z.by_name("mods/0/Textures/a.dds").unwrap().compression(), zip::CompressionMethod::Deflated);
    drop(z);

    let preview = inspect(&lock(&e.db), &pack).unwrap();
    assert_eq!(preview.game, "zzz");
    assert_eq!(preview.mods.len(), 2);
    assert_eq!(preview.mods[1].rel_path, "Bunny");
    assert_eq!(preview.mods[0].how, "inside");
    assert!(!preview.mods[1].enabled);
    let img = preview.mods[0].preview.clone().unwrap();
    assert!(Path::new(&img).is_file(), "{img}");

    let r = import_test(&e, &pack, "skip", false);
    assert_eq!(r.added.len(), 2, "{:?}", r.notes);
    assert!(e.mods.join("Coca Cola/mod.ini").is_file());
    assert!(e.mods.join("Coca Cola/Textures/a.dds").is_file());
    assert!(e.mods.join("DISABLED Bunny/mod.ini").is_file());
    assert_eq!(library::read_sidecar(&e.mods.join("Coca Cola")).unwrap().id, "a".repeat(32));
    // the enabled mod's value went to d3dx_user.ini
    assert_eq!(ini::user_vars(&e.importer, "Coca Cola").unwrap()[0].value, "1");
    assert!(!e.root.join("data/staging/t/zzz").exists());
}

#[test]
fn skip_and_keep_both_on_clash() {
    let e = env("clash");
    let pack = build_pack(&e);
    assert_eq!(import_test(&e, &pack, "skip", false).added.len(), 2);
    // both are in the library now
    let r = import_test(&e, &pack, "skip", false);
    assert_eq!((r.skipped, r.added.len()), (2, 0), "{:?}", r.notes);
    let r = import_test(&e, &pack, "keep_both", false);
    assert_eq!(r.added.len(), 2);
    assert!(e.mods.join("Coca Cola (2)/mod.ini").is_file());
    assert!(e.mods.join("DISABLED Bunny (2)").is_dir());
    let copy = library::read_sidecar(&e.mods.join("Coca Cola (2)")).unwrap();
    assert_ne!(copy.id, "a".repeat(32));
    assert_eq!(copy.name, "Coca Cola");
}

#[test]
fn replace_sends_old_copy_to_trash() {
    let e = env("replace");
    let pack = build_pack(&e);
    assert_eq!(import_test(&e, &pack, "skip", false).added.len(), 2);
    fs::write(e.mods.join("Coca Cola/old.txt"), "old").unwrap();
    let r = import_test(&e, &pack, "replace", false);
    assert_eq!(r.replaced.len(), 2, "{:?}", r.notes);
    assert!(e.mods.join("Coca Cola/mod.ini").is_file());
    assert!(!e.mods.join("Coca Cola/old.txt").exists());
}

#[test]
fn crafted_zip_cannot_escape() {
    let e = env("slip");
    let pack = e.root.join("evil.gachamod");
    {
        let mut z = zip::ZipWriter::new(File::create(&pack).unwrap());
        let o = zip::write::SimpleFileOptions::default();
        let mut m = manifest("zzz");
        m.mods.push(PackedMod { dir: "mods/0".into(), rel_path: "../../Escaped".into(), enabled: true, sidecar: Sidecar { name: "Evil".into(), ..Default::default() }, ..Default::default() });
        m.mods.push(PackedMod { dir: "../outside".into(), rel_path: "X".into(), enabled: true, ..Default::default() });
        z.start_file(MANIFEST, o).unwrap();
        z.write_all(serde_json::to_string(&m).unwrap().as_bytes()).unwrap();
        z.start_file("mods/0/ok.ini", o).unwrap();
        z.write_all(b"[Key]\n").unwrap();
        z.start_file("mods/0/../../../evil.txt", o).unwrap();
        z.write_all(b"no").unwrap();
        z.start_file("mods/0/..\\..\\evil2.txt", o).unwrap();
        z.write_all(b"no").unwrap();
        z.finish().unwrap();
    }
    let r = import_test(&e, &pack, "skip", false);
    assert_eq!(r.added.len(), 1, "{:?}", r.notes);
    assert!(r.notes.iter().any(|n| n.contains("outside")), "{:?}", r.notes);
    assert!(e.mods.join("Evil/ok.ini").is_file());
    for p in [e.root.join("evil.txt"), e.importer.join("evil.txt"), e.mods.join("evil.txt"), e.root.join("evil2.txt"), e.root.join("data/evil.txt"), e.root.join("Escaped")] {
        assert!(!p.exists(), "{}", p.display());
    }
}

#[test]
fn refuses_newer_format_and_unknown_games() {
    let e = env("format");
    let write = |m: &Manifest, p: &Path| {
        let mut z = zip::ZipWriter::new(File::create(p).unwrap());
        z.start_file(MANIFEST, zip::write::SimpleFileOptions::default()).unwrap();
        z.write_all(serde_json::to_string(m).unwrap().as_bytes()).unwrap();
        z.finish().unwrap();
    };
    let p = e.root.join("new.gachamod");
    let mut m = manifest("zzz");
    m.format = 9;
    write(&m, &p);
    assert!(matches!(inspect(&lock(&e.db), &p), Err(Error::Invalid(_))));
    let p2 = e.root.join("gi.gachamod");
    write(&manifest("gi"), &p2);
    assert!(matches!(inspect(&lock(&e.db), &p2), Err(Error::NotSetUp(m)) if m.contains("Genshin Impact")));
    let p3 = e.root.join("plain.zip");
    { let mut z = zip::ZipWriter::new(File::create(&p3).unwrap()); z.start_file("a.ini", zip::write::SimpleFileOptions::default()).unwrap(); z.finish().unwrap(); }
    assert!(matches!(inspect(&lock(&e.db), &p3), Err(Error::Archive(_))));
    // a file with a game that is set up and one that isn't opens, and says which can't come in
    let p4 = e.root.join("both.gachamod");
    let both = Manifest { format: 2, kind: "all".into(), games: vec![
        GamePart { game: "zzz".into(), mods: vec![PackedMod { sidecar: Sidecar { name: "A".into(), source: Some(gb(1, 2)), ..Default::default() }, ..Default::default() }], ..Default::default() },
        GamePart { game: "gi".into(), mods: vec![PackedMod { sidecar: Sidecar { name: "B".into(), ..Default::default() }, ..Default::default() }], ..Default::default() },
    ], ..Default::default() };
    write(&both, &p4);
    let pv = inspect(&lock(&e.db), &p4).unwrap();
    assert_eq!(pv.games.iter().map(|g| (g.game.as_str(), g.ready)).collect::<Vec<_>>(), vec![("zzz", true), ("gi", false)]);
    assert_eq!(pv.mods.iter().map(|m| m.how.as_str()).collect::<Vec<_>>(), vec!["download", "missing"]);
}

/// The sending PC: a linked mod with a rebound key and a picked option, and a mod with no link.
fn sender(e: &Env) -> (String, String) {
    let linked = "c".repeat(32);
    let local = "d".repeat(32);
    make_mod(&e.mods.join("Ellen Joe").join("Coca Cola"), &linked, "Coca Cola", Some(gb(555, 777)));
    make_mod(&e.mods.join("DISABLED Homemade"), &local, "Homemade", None);
    library::scan(&e.db, "zzz").unwrap();
    let d = lock(&e.db);
    crate::keys::rebind(&d, "zzz", &linked, &KeyTarget { ini: "mod.ini".into(), section: "KeySwap".into(), field: "key".into(), index: 0 }, "VK_F6").unwrap();
    library::stash_vars(&d, "zzz", &linked, &[VarValue { ini: "mod.ini".into(), var: "swapvar".into(), value: "1".into() }]).unwrap();
    (linked, local)
}

#[test]
fn link_lists_carry_settings_not_files() {
    let e = env("links");
    let (linked, local) = sender(&e);
    let req = |files: &str, dest: &str| ExportRequest { game: "zzz".into(), scope: "game".into(), files: files.into(), include_vars: true, dest: e.root.join(dest).to_string_lossy().into(), ..Default::default() };

    let p = plan(&lock(&e.db), &req("", "x")).unwrap();
    assert_eq!((p.mods, p.linked, p.unlinked, p.profiles), (2, 1, 1, 1));
    assert_eq!(p.suggested, "unlinked");
    assert_eq!(p.unlinked_names, vec!["Homemade".to_string()]);
    assert_eq!(p.links, "Coca Cola: https://gamebanana.com/mods/555");

    // links only: no files at all
    let r = export(&e.db, &req("links", "links.gachamod"), &|_, _| {}).unwrap();
    assert_eq!((r.mods, r.links, r.inside, r.profiles), (2, 1, 0, 1));
    let mut z = open_zip(Path::new(&r.path)).unwrap();
    assert_eq!(entry_names(&mut z).len(), 1, "only gachamod.json");
    let m = read_manifest(&mut z).unwrap();
    assert_eq!(m.format, 2);
    let c = m.games[0].mods.iter().find(|m| m.sidecar.id == linked).unwrap();
    assert!(c.dir.is_empty());
    assert_eq!(c.rel_path, "Ellen Joe/Coca Cola");
    assert_eq!(c.vars[0].value, "1");
    assert!(matches!(&c.keys[..], [KeyChange::Set { value, .. }] if value == "VK_F6"), "{:?}", c.keys);
    assert_eq!(c.inis, vec!["mod.ini".to_string()]);
    assert!(c.sidecar.preview.is_none(), "a local preview means nothing on another PC");
    let h = m.games[0].mods.iter().find(|m| m.sidecar.id == local).unwrap();
    assert!(h.dir.is_empty() && !h.enabled);
    assert!(m.games[0].profiles[0].active);
    assert!(m.games[0].profiles[0].mods.iter().any(|x| x.mod_id == linked && x.enabled));
    drop(z);

    // links, plus the files of the mod that has none
    let r = export(&e.db, &req("unlinked", "mixed.gachamod"), &|_, _| {}).unwrap();
    assert_eq!((r.links, r.inside), (1, 1));
    let mut z = open_zip(Path::new(&r.path)).unwrap();
    assert!(entry_names(&mut z).iter().any(|(_, n)| n == "mods/0/mod.ini"));
}

#[test]
fn importing_a_link_list_queues_downloads_that_set_up_like_the_sender() {
    let a = env("send");
    let (linked, local) = sender(&a);
    let pack = export(&a.db, &ExportRequest { game: "zzz".into(), scope: "game".into(), files: "unlinked".into(), include_vars: true, dest: a.root.join("p.gachamod").to_string_lossy().into(), ..Default::default() }, &|_, _| {}).unwrap();

    let b = env("receive");
    let pv = inspect(&lock(&b.db), Path::new(&pack.path)).unwrap();
    assert_eq!(pv.kind, "game");
    assert_eq!(pv.profiles.len(), 1);
    let r = import_test(&b, Path::new(&pack.path), "skip", true);
    // the mod with no link came with its files; the linked one waits for a download
    assert_eq!(r.added, vec![local.clone()], "{:?}", r.notes);
    assert!(b.mods.join("DISABLED Homemade/mod.ini").is_file());
    assert_eq!(r.downloads.len(), 1);
    let q = &r.downloads[0];
    assert_eq!((q.gb_mod_id, q.file_id), (555, 777));
    assert_eq!(q.url, "https://gamebanana.com/dl/777");
    let s = &q.meta.setups[0];
    assert_eq!(s.sidecar.id, linked);
    assert_eq!(s.rel_path, "Ellen Joe/Coca Cola");
    // the profile is made and in use, and points at the id the download will have
    let pid = r.profile_id.expect("switched to the file's profile");
    let snap = profiles::snapshot(&lock(&b.db), pid).unwrap();
    assert!(snap.mods.iter().any(|m| m.mod_id == linked && m.enabled), "{:?}", snap.mods);
    assert!(snap.mods.iter().any(|m| m.mod_id == local && !m.enabled), "{:?}", snap.mods);

    // the download lands: same id, folder, key and option
    let staging = b.root.join("dl");
    fs::create_dir_all(staging.join("Textures")).unwrap();
    fs::write(staging.join("mod.ini"), INI).unwrap();
    fs::write(staging.join("Textures/a.dds"), vec![7u8; 5000]).unwrap();
    let o = crate::install::place(&b.db, &b.root.join("data"), "zzz", &staging, &q.meta, &[]).unwrap();
    assert!(o.needs_choice.is_none());
    assert_eq!(o.installed[0].id, linked, "{:?}", o.notes);
    let ini_now = fs::read_to_string(b.mods.join("Ellen Joe/Coca Cola/mod.ini")).unwrap();
    assert!(ini_now.contains("key = VK_F6") && ini_now.contains("It was: key = VK_DOWN"), "{ini_now}");
    assert_eq!(ini::user_vars(&b.importer, "Ellen Joe/Coca Cola").unwrap()[0].value, "1");
    assert_eq!(library::read_sidecar(&b.mods.join("Ellen Joe/Coca Cola")).unwrap().source.unwrap().mod_id, 555);

    // opening the file again: the linked mod is there now, so nothing is queued
    let r = import_test(&b, Path::new(&pack.path), "skip", false);
    assert!(r.downloads.is_empty());
    assert_eq!(r.skipped, 2);
}

#[test]
fn several_mods_from_one_archive_need_one_download_and_no_question() {
    let mk = |id: &str, variant: Option<&str>, inis: &[&str]| PackedMod {
        sidecar: Sidecar { id: id.repeat(32), name: format!("Mod {id}"), source: Some(gb(9, 10)), variant: variant.map(String::from), ..Default::default() },
        rel_path: format!("Group/Mod {id}"), enabled: true, inis: inis.iter().map(|s| s.to_string()).collect(), ..Default::default()
    };
    let (a, b) = (mk("a", Some("Pack/A"), &[]), mk("b", None, &["b.ini"]));
    let mut list = Vec::new();
    for pm in [&a, &b] {
        let setup = ModSetup { sidecar: pm.sidecar.clone(), rel_path: pm.rel_path.clone(), enabled: true, variant: pm.sidecar.variant.clone(), inis: pm.inis.clone(), ..Default::default() };
        add_request(&mut list, link_request("zzz", pm, setup, None).unwrap());
    }
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].meta.setups.len(), 2);

    // an archive with three folders: A by its folder, B by its ini, C left out
    let e = env("variants");
    let staging = e.root.join("dl");
    for (d, f) in [("Pack/A", "a.ini"), ("Pack/B", "b.ini"), ("Pack/C", "c.ini")] {
        fs::create_dir_all(staging.join(d)).unwrap();
        fs::write(staging.join(d).join(f), INI).unwrap();
    }
    let o = crate::install::place(&e.db, &e.root.join("data"), "zzz", &staging, &list[0].meta, &[]).unwrap();
    assert!(o.needs_choice.is_none());
    let mut ids: Vec<String> = o.installed.iter().map(|m| m.id.clone()).collect();
    ids.sort();
    assert_eq!(ids, vec!["a".repeat(32), "b".repeat(32)]);
    assert!(e.mods.join("Group/Mod b/b.ini").is_file());
    assert!(!e.mods.join("Group/Mod c").exists());
    assert_eq!(library::read_sidecar(&e.mods.join("Group/Mod a")).unwrap().variant.as_deref(), Some("Pack/A"));
}

#[test]
fn gamebanana_answers_pick_the_file() {
    let json = r#"[
        {"_idRow":1,"_aFiles":[{"_idRow":10,"_sFile":"a.zip","_nFilesize":100,"_sMd5Checksum":"aa","_tsDateAdded":5,"_bIsArchived":true},
                               {"_idRow":11,"_sFile":"a2.zip","_nFilesize":200,"_tsDateAdded":9}],
         "_aPreviewMedia":{"_aImages":[{"_sBaseUrl":"https://images.gamebanana.com/img/ss/mods","_sFile":"x.jpg","_sFile220":"220-90_x.jpg","_sFile530":"530-90_x.jpg"}]}},
        {"_idRow":2,"_aFiles":[{"_idRow":20,"_sFile":"old.zip","_tsDateAdded":1},{"_idRow":21,"_sFile":"new.zip","_tsDateAdded":7},{"_idRow":22,"_sFile":"keep.zip","_tsDateAdded":3}]}
    ]"#;
    let info: HashMap<u64, resolve::RemoteMod> = resolve::parse_multi(json).unwrap().into_iter().map(|m| (m.id, m)).collect();
    assert!(resolve::parse_multi(r#"{"_sErrorCode":"x"}"#).is_none());
    let req = |m: u64, f: u64, name: &str| QueueRequest {
        game: "zzz".into(), gb_mod_id: m, file_id: f, file_name: name.into(),
        meta: InstallMeta { name: Some(format!("Mod {m}-{f}")), source: Some(gb(m, f)), ..Default::default() }, ..Default::default()
    };
    let mut reqs = vec![req(1, 10, ""), req(2, 99, "keep.zip"), req(2, 98, ""), req(3, 30, ""), req(4, 40, ""), req(4, 0, "")];
    let unknown: HashSet<u64> = [4].into_iter().collect();
    let notes = resolve::apply(&mut reqs, &info, &unknown);
    let got: Vec<(u64, u64)> = reqs.iter().map(|r| (r.gb_mod_id, r.file_id)).collect();
    // the shared file even when archived; the same name; the newest; mod 3 is gone; mod 4 couldn't be asked
    assert_eq!(got, vec![(1, 10), (2, 22), (2, 21), (4, 40)]);
    assert_eq!(reqs[0].size, 100);
    assert_eq!(reqs[0].md5.as_deref(), Some("aa"));
    assert_eq!(reqs[0].thumb.as_deref(), Some("https://images.gamebanana.com/img/ss/mods/220-90_x.jpg"));
    assert_eq!(reqs[1].meta.source.as_ref().unwrap().file_id, Some(22));
    assert_eq!(notes.len(), 3, "{notes:?}");
    assert!(notes[1].contains("Mod 3-30"), "{notes:?}");
    assert!(notes[2].contains("Mod 4-0"), "{notes:?}");
}

#[test]
fn helpers() {
    assert_eq!(clean_rel("Ellen Joe/DISABLED Coca Cola"), "Ellen Joe/Coca Cola");
    assert_eq!(safe_name("a:b?"), "a_b_");
    assert_eq!(safe_name(".."), "Mod");
    assert_eq!(percent_decode("C%3A/x%20y.png"), "C:/x y.png");
    assert!(stored("A.PNG") && !stored("a.dds"));
}
