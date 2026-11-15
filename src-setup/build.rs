//! Tauri's build step, plus the update key and address from the app's own config (src-tauri/tauri.conf.json), so a
//! repair checks a download the same way the app's updater does.
use std::path::Path;

fn main() {
    let conf = Path::new(env!("CARGO_MANIFEST_DIR")).join("../src-tauri/tauri.conf.json");
    println!("cargo:rerun-if-changed={}", conf.display());
    let text = std::fs::read_to_string(&conf).expect("read src-tauri/tauri.conf.json");
    let v: serde_json::Value = serde_json::from_str(&text).expect("parse src-tauri/tauri.conf.json");
    let updater = &v["plugins"]["updater"];
    let pubkey = updater["pubkey"].as_str().unwrap_or_default();
    let latest = updater["endpoints"][0].as_str().unwrap_or_default();
    let homepage = v["bundle"]["homepage"].as_str().unwrap_or_default();
    let out = format!(
        "/// The app updater's public key (minisign, base64).\npub const UPDATE_PUBKEY: &str = {pubkey:?};\n\
         /// Where the newest release is described.\npub const LATEST_JSON: &str = {latest:?};\n\
         /// The project page.\npub const HOMEPAGE: &str = {homepage:?};\n"
    );
    std::fs::write(Path::new(&std::env::var("OUT_DIR").unwrap()).join("consts.rs"), out).expect("write consts.rs");
    tauri_build::build()
}
