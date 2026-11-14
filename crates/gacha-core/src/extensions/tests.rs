use super::*;
use crate::db::Db;

fn manifest(id: &str) -> serde_json::Value {
    serde_json::json!({
        "format": 1, "id": id, "name": "Build notes", "version": "1.0.0", "author": "Player",
        "description": "Notes on each character's page.",
        "characterTab": { "title": "Notes", "entry": "notes.html" },
        "permissions": { "library": true, "net": ["http://127.0.0.1:47900/", "https://API.example.com/x"] },
        "needs": [{ "name": "Other app", "url": "https://example.com", "paths": ["%PUBLIC%\\Other app\\other.exe"],
                    "running": "http://127.0.0.1:47900/ping", "open": "otherapp://" }]
    })
}

fn write_pkg(dir: &Path, id: &str) {
    fs::create_dir_all(dir).unwrap();
    fs::write(dir.join(MANIFEST), serde_json::to_vec(&manifest(id)).unwrap()).unwrap();
    fs::write(dir.join("notes.html"), "<!doctype html><html><head></head><body>hi</body></html>").unwrap();
}

fn zip_dir(dir: &Path, out: &Path, prefix: &str) {
    let mut w = zip::ZipWriter::new(fs::File::create(out).unwrap());
    for e in walkdir::WalkDir::new(dir) {
        let e = e.unwrap();
        if !e.file_type().is_file() { continue; }
        let rel = e.path().strip_prefix(dir).unwrap().to_string_lossy().replace('\\', "/");
        w.start_file(format!("{prefix}{rel}"), zip::write::SimpleFileOptions::default()).unwrap();
        w.write_all(&fs::read(e.path()).unwrap()).unwrap();
    }
    w.finish().unwrap();
}

#[test]
fn checks_manifests() {
    let tmp = tempfile::tempdir().unwrap();
    write_pkg(tmp.path(), "build-notes");
    let m = read_manifest(tmp.path()).unwrap();
    assert_eq!(m.kind(), "extension");
    // origins are normalised: no path, lower case host
    assert_eq!(m.permissions.net, vec!["http://127.0.0.1:47900", "https://api.example.com"]);

    let mut bad_id = manifest("Build Notes");
    bad_id["id"] = "Build Notes".into();
    assert!(check(serde_json::from_value(bad_id).unwrap(), None).is_err());

    // plain http only on this PC
    let mut v = manifest("a-b");
    v["permissions"]["net"] = serde_json::json!(["http://example.com"]);
    assert!(check(serde_json::from_value(v).unwrap(), None).is_err());

    // a running check needs its origin in permissions
    let mut v = manifest("a-b");
    v["permissions"]["net"] = serde_json::json!([]);
    assert!(check(serde_json::from_value(v).unwrap(), None).is_err());

    // files outside known folders, and ways out of them
    for f in ["C:\\Windows", "%LOCALAPPDATA%\\..\\x", "%TEMP%\\x"] {
        let mut v = manifest("a-b");
        v["permissions"]["files"] = serde_json::json!([f]);
        assert!(check(serde_json::from_value(v).unwrap(), None).is_err(), "{f}");
    }

    // an http open link is not an app's own link
    let mut v = manifest("a-b");
    v["needs"][0]["open"] = "https://example.com".into();
    assert!(check(serde_json::from_value(v).unwrap(), None).is_err());

    // a page that isn't in the package
    fs::remove_file(tmp.path().join("notes.html")).unwrap();
    assert!(read_manifest(tmp.path()).is_err());

    // a package that adds nothing
    let mut v = manifest("a-b");
    v.as_object_mut().unwrap().remove("characterTab");
    assert!(check(serde_json::from_value(v).unwrap(), None).is_err());

    // newer than this build
    let mut v = manifest("a-b");
    v["app"] = "999.0.0".into();
    assert!(check(serde_json::from_value(v).unwrap(), None).is_err());
}

#[test]
fn installs_replaces_removes_and_restores() {
    let data = tempfile::tempdir().unwrap();
    let src = tempfile::tempdir().unwrap();
    let db = Db::memory().unwrap();
    write_pkg(&src.path().join("pkg"), "build-notes");
    // GitHub-style zip: everything inside one folder
    let z = src.path().join("p.zip");
    zip_dir(&src.path().join("pkg"), &z, "build-notes-main/");

    let r = install_zip(&db, data.path(), &z, Some(("build-notes", "1.0.0")), Some("https://x/index.json".into())).unwrap();
    assert!(r.replaced.is_none());
    assert!(r.extension.enabled);
    assert_eq!(r.extension.source.as_deref(), Some("https://x/index.json"));
    assert!(root(data.path()).join("build-notes").join(MANIFEST).is_file());

    // the repo said another version
    assert!(install_zip(&db, data.path(), &z, Some(("build-notes", "2.0.0")), None).is_err());

    // turned off stays off across an update
    set_enabled(&db, "build-notes", false).unwrap();
    let r2 = install_zip(&db, data.path(), &z, None, None).unwrap();
    assert!(!r2.extension.enabled);
    let old = r2.replaced.unwrap();
    assert!(trash_root(data.path()).join(&old).is_dir());

    assert_eq!(list(&db, data.path()).unwrap().len(), 1);
    let key = remove(&db, data.path(), "build-notes").unwrap().unwrap();
    assert!(list(&db, data.path()).unwrap().is_empty());
    restore(&db, data.path(), &key).unwrap();
    assert_eq!(list(&db, data.path()).unwrap().len(), 1);
    assert!(restore(&db, data.path(), "../x~1").is_err());
}

#[test]
fn refuses_unsafe_zips() {
    let data = tempfile::tempdir().unwrap();
    let db = Db::memory().unwrap();
    let z = data.path().join("evil.zip");
    {
        let mut w = zip::ZipWriter::new(fs::File::create(&z).unwrap());
        w.start_file("../outside.txt", zip::write::SimpleFileOptions::default()).unwrap();
        w.write_all(b"x").unwrap();
        w.start_file(MANIFEST, zip::write::SimpleFileOptions::default()).unwrap();
        w.write_all(&serde_json::to_vec(&manifest("evil")).unwrap()).unwrap();
        w.finish().unwrap();
    }
    // the manifest's page is missing, and nothing was written outside staging
    assert!(install_zip(&db, data.path(), &z, None, None).is_err());
    assert!(!data.path().join("outside.txt").exists());
    assert!(!data.path().join("staging").join("outside.txt").exists());
}

#[test]
fn links_folders_and_serves_files() {
    let data = tempfile::tempdir().unwrap();
    let src = tempfile::tempdir().unwrap();
    let db = Db::memory().unwrap();
    write_pkg(src.path(), "dev-pkg");
    let e = link_folder(&db, data.path(), src.path()).unwrap();
    assert!(e.linked);
    assert!(page_file(&db, data.path(), "dev-pkg", "notes.html").unwrap().is_some());
    assert!(page_file(&db, data.path(), "dev-pkg", "../x").unwrap().is_none());
    set_enabled(&db, "dev-pkg", false).unwrap();
    assert!(page_file(&db, data.path(), "dev-pkg", "notes.html").is_err());
    // unlinking leaves the folder alone
    assert!(remove(&db, data.path(), "dev-pkg").unwrap().is_none());
    assert!(src.path().join(MANIFEST).is_file());
    assert!(list(&db, data.path()).unwrap().is_empty());
}

#[test]
fn checks_urls_and_paths() {
    let m = check(serde_json::from_value(manifest("a-b")).unwrap(), None).unwrap();
    assert!(allowed_url(&m, "http://127.0.0.1:47900/build?c=1").is_ok());
    assert!(allowed_url(&m, "https://api.example.com/v1").is_ok());
    assert!(allowed_url(&m, "https://api.example.com.evil.net/").is_err());
    assert!(allowed_url(&m, "http://127.0.0.1:47901/").is_err());
    assert!(allowed_url(&m, "file:///C:/x").is_err());

    let tmp = tempfile::tempdir().unwrap();
    std::env::set_var("PUBLIC", tmp.path());
    fs::create_dir_all(tmp.path().join("Other app").join("exports")).unwrap();
    fs::write(tmp.path().join("Other app").join("exports").join("a.json"), "{}").unwrap();
    fs::write(tmp.path().join("secret.txt"), "no").unwrap();
    let mut m = m;
    m.permissions.files = vec!["%PUBLIC%\\Other app\\exports".into()];
    assert_eq!(read_file(&m, "%PUBLIC%\\Other app\\exports\\a.json").unwrap(), "{}");
    assert!(read_file(&m, "%PUBLIC%\\secret.txt").is_err());
    assert!(read_file(&m, &tmp.path().join("Other app").join("exports").join("..").join("..").join("secret.txt").to_string_lossy()).is_err());
    assert_eq!(list_dir(&m, "%PUBLIC%\\Other app\\exports").unwrap().len(), 1);
    // the app is found by its path
    let exe = tmp.path().join("Other app").join("other.exe");
    fs::write(&exe, "").unwrap();
    let apps = find_apps(&m);
    assert!(apps[0].installed && apps[0].can_open);
    assert_eq!(open_target(&m, "Other app").unwrap(), "otherapp://");
}

#[test]
fn reads_indexes() {
    let ix = parse_index(r#"{ "format": 1, "name": "Test", "submit": "http://insecure", "packages": [
        { "id": "good-one", "name": "Good", "version": "1.2.0", "kind": "theme", "download": "https://x/good.zip",
          "sha256": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "size": 10, "icon": "http://x/i.png" },
        { "id": "Bad", "name": "Bad", "version": "1.0.0", "download": "https://x/b.zip", "sha256": "", "size": 1 },
        { "id": "plain-http", "name": "P", "version": "1.0.0", "download": "http://x/p.zip",
          "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "size": 1 }
    ]}"#).unwrap();
    assert!(ix.submit.is_none());
    assert_eq!(ix.packages.len(), 1);
    assert_eq!(ix.packages[0].sha256, "a".repeat(64));
    assert!(ix.packages[0].icon.is_none());
    assert!(parse_index(r#"{ "format": 9, "packages": [] }"#).is_err());
}

#[test]
fn packs_folders_and_themes() {
    let tmp = tempfile::tempdir().unwrap();
    let src = tmp.path().join("pkg");
    write_pkg(&src, "build-notes");
    fs::create_dir_all(src.join(".git")).unwrap();
    fs::write(src.join(".git").join("HEAD"), "x").unwrap();
    let out = tmp.path().join("build-notes-1.0.0.zip");
    let p = pack_folder(&src, &out).unwrap();
    assert_eq!(p.id, "build-notes");
    assert_eq!(p.sha256.len(), 64);
    let names: Vec<String> = { let z = zip::ZipArchive::new(fs::File::open(&out).unwrap()).unwrap(); z.file_names().map(str::to_string).collect() };
    assert!(names.contains(&MANIFEST.to_string()) && !names.iter().any(|n| n.starts_with(".git")));

    let theme = serde_json::json!({ "name": "Night", "base": "default", "scheme": "dark", "tokens": { "--accent": "#ff5c8a" } });
    let out2 = tmp.path().join("night.zip");
    let t = pack_theme(&theme, ThemeMeta { id: "night".into(), name: "Night".into(), author: "Player".into(), ..Default::default() }, &out2).unwrap();
    assert_eq!(t.version, "1.0.0");
    let db = Db::memory().unwrap();
    let r = install_zip(&db, tmp.path(), &out2, None, None).unwrap();
    assert_eq!(r.extension.kind, "theme");
    assert_eq!(themes(&db, tmp.path(), "night").unwrap()[0]["name"], "Night");
}

#[test]
fn keeps_storage() {
    let tmp = tempfile::tempdir().unwrap();
    storage_set(tmp.path(), "a-b", "k", Some(serde_json::json!({"x": 1}))).unwrap();
    assert_eq!(storage_get(tmp.path(), "a-b").unwrap()["k"]["x"], 1);
    storage_set(tmp.path(), "a-b", "k", None).unwrap();
    assert!(storage_get(tmp.path(), "a-b").unwrap().is_empty());
    assert!(storage_set(tmp.path(), "a-b", "big", Some(serde_json::Value::String("x".repeat(MAX_STORAGE)))).is_err());
    assert!(storage_get(tmp.path(), "../x").is_err());
}

/// The example packages and index in extensions-repo/ (the seed of the public repo) must pass the same checks.
#[test]
fn repo_examples_check_out() {
    let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../extensions-repo");
    for e in fs::read_dir(repo.join("packages")).unwrap().flatten() {
        let m = read_manifest(&e.path()).unwrap_or_else(|err| panic!("{}: {err}", e.path().display()));
        assert_eq!(m.id, e.file_name().to_string_lossy());
    }
    let ix = parse_index(&fs::read_to_string(repo.join("index.json")).unwrap()).unwrap();
    assert!(!ix.packages.is_empty());
    let data = tempfile::tempdir().unwrap();
    let db = Db::memory().unwrap();
    for p in &ix.packages {
        let zip = repo.join("dist").join(format!("{}-{}.zip", p.id, p.version));
        assert_eq!(hex::encode(Sha256::digest(fs::read(&zip).unwrap())), p.sha256, "{}", p.id);
        let r = install_zip(&db, data.path(), &zip, Some((&p.id, &p.version)), None).unwrap();
        assert_eq!(r.extension.kind, p.kind);
    }
}
