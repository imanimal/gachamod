//! Which picture shows a mod, and fetching one from the web. Owner: BACKEND area (docs/spec.md, "Previews").
//!
//! Mods ship their textures as images too (a `Body_Diffuse.jpg` next to the ini), so "the first image in the folder"
//! is often a texture. A picture counts as a preview only when it is named `preview.*`, or when it is a root-level
//! image that no ini of the mod loads and whose name or folder doesn't look like a texture.

use crate::error::{Error, Result};
use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};

pub const IMAGE_EXT: &[&str] = &["png", "jpg", "jpeg", "webp", "gif"];
/// Pictures bigger than this are refused.
pub const MAX_BYTES: usize = 25 * 1024 * 1024;

fn ext_of(name: &str) -> String {
    name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default()
}

fn stem_of(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
    base.rsplit_once('.').map(|(s, _)| s).unwrap_or(base).to_ascii_lowercase()
}

/// An image type the app shows (png, jpg, jpeg, webp, gif).
pub fn is_image_name(name: &str) -> bool { IMAGE_EXT.contains(&ext_of(name).as_str()) }

/// `preview.png`, `Preview.JPG` ...
pub fn is_preview_name(name: &str) -> bool { is_image_name(name) && stem_of(name) == "preview" }

/// True when a path inside a mod (forward or back slashes) looks like a texture: a .dds, a file in a folder named
/// like "Textures" or "tex", or a name like `Body_Diffuse`, `Hair_LightMap`, `NormalMap`, `MaterialMap`,
/// `Texture01`, `Face_d.jpg` or `Face_n.png`.
pub fn looks_like_texture(rel: &str) -> bool {
    let l = rel.to_ascii_lowercase().replace('\\', "/");
    if ext_of(&l) == "dds" { return true; }
    let mut parts: Vec<&str> = l.split('/').filter(|p| !p.is_empty()).collect();
    parts.pop();
    if parts.iter().any(|p| p.contains("texture") || matches!(*p, "tex" | "texs" | "textures")) { return true; }
    let stem = stem_of(&l);
    ["diffuse", "lightmap", "normalmap", "materialmap", "texture"].iter().any(|w| stem.contains(w))
        || stem.ends_with("_d") || stem.ends_with("_n")
}

/// Lower-case path inside `root` with forward slashes, or None when `p` leaves it.
fn rel_inside(root: &Path, p: &Path) -> Option<String> {
    let rel = p.strip_prefix(root).ok()?;
    let mut out: Vec<String> = Vec::new();
    for c in rel.components() {
        match c {
            Component::Normal(s) => out.push(s.to_string_lossy().to_lowercase()),
            Component::ParentDir => { out.pop()?; }
            Component::CurDir => {}
            _ => return None,
        }
    }
    (!out.is_empty()).then(|| out.join("/"))
}

/// Every file the mod's ini files load (`filename = Textures\Body.jpg`), as lower-case paths inside `dir` with
/// forward slashes.
pub fn ini_referenced(dir: &Path) -> HashSet<String> {
    let mut out = HashSet::new();
    for e in walkdir::WalkDir::new(dir).max_depth(8).into_iter().flatten() {
        if !e.file_type().is_file() { continue; }
        let name = e.file_name().to_string_lossy().to_ascii_lowercase();
        if !name.ends_with(".ini") || name == "desktop.ini" { continue; }
        // an ini this big is generated data, not a list of textures
        if e.metadata().is_ok_and(|m| m.len() > 8 * 1024 * 1024) { continue; }
        let Ok(bytes) = std::fs::read(e.path()) else { continue };
        let text = String::from_utf8_lossy(&bytes);
        let base = e.path().parent().unwrap_or(dir);
        for line in text.lines() {
            let line = line.trim();
            if line.starts_with(';') { continue; }
            let Some((k, v)) = line.split_once('=') else { continue };
            if !k.trim().eq_ignore_ascii_case("filename") { continue; }
            let v = v.split(';').next().unwrap_or("").trim().trim_matches('"').trim();
            if v.is_empty() { continue; }
            let joined: PathBuf = v.split(['/', '\\']).fold(base.to_path_buf(), |p, part| if part.is_empty() { p } else { p.join(part) });
            if let Some(r) = rel_inside(dir, &joined) { out.insert(r); }
        }
    }
    out
}

/// The first root-level image of a mod (by name) that is a picture and not a texture, from the file names in its
/// root. `skip` leaves out names the caller doesn't want (the installer's own downloaded preview).
pub fn root_picture(dir: &Path, files: &[String], skip: impl Fn(&str) -> bool) -> Option<String> {
    let mut images: Vec<&String> = files.iter().filter(|f| is_image_name(f) && !skip(f) && !looks_like_texture(f)).collect();
    if images.is_empty() { return None; }
    images.sort_by_key(|f| f.to_ascii_lowercase());
    let loaded = ini_referenced(dir);
    images.into_iter().find(|f| !loaded.contains(&f.to_lowercase())).cloned()
}

/// The image type for a Content-Type header, or None when it isn't a picture the app shows.
pub fn ext_for_type(content_type: &str) -> Option<&'static str> {
    let t = content_type.split(';').next().unwrap_or("").trim().to_ascii_lowercase();
    match t.as_str() {
        "image/png" => Some("png"),
        "image/jpeg" | "image/jpg" | "image/pjpeg" => Some("jpg"),
        "image/webp" => Some("webp"),
        "image/gif" => Some("gif"),
        _ => None,
    }
}

/// A picture deeper in the mod when its root has none ("Velina/Preview/cover.jpg"): up to three folders down,
/// preview-named files first, then the shallowest, then by name. Textures, files an ini loads and anything in a
/// disabled folder are left out. Returns the path inside `dir` with forward slashes.
pub fn nested_picture(dir: &Path) -> Option<String> {
    let mut found: Vec<(bool, usize, String)> = Vec::new();
    let walk = walkdir::WalkDir::new(dir).max_depth(4).into_iter()
        .filter_entry(|e| e.depth() == 0 || !e.file_name().to_string_lossy().to_ascii_lowercase().starts_with("disabled"));
    // root files are root_picture's; walkdir hands entries skipped by min_depth to no filter, so depth is checked here
    for e in walk.flatten() {
        if !e.file_type().is_file() || e.depth() < 2 { continue; }
        let name = e.file_name().to_string_lossy().into_owned();
        if !is_image_name(&name) { continue; }
        let Ok(rel) = e.path().strip_prefix(dir) else { continue };
        let rel = rel.to_string_lossy().replace('\\', "/");
        if looks_like_texture(&rel) { continue; }
        found.push((!is_preview_name(&name) && !crate::managers::is_cover_name(&name), e.depth(), rel));
        if found.len() > 200 { break; }
    }
    if found.is_empty() { return None; }
    found.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)).then_with(|| a.2.to_ascii_lowercase().cmp(&b.2.to_ascii_lowercase())));
    let loaded = ini_referenced(dir);
    found.into_iter().map(|(_, _, rel)| rel).find(|rel| !loaded.contains(&rel.to_lowercase()))
}

/// Download a picture from an https link. Returns its bytes and extension (png, jpg, webp or gif).
pub async fn download(http: &reqwest::Client, link: &str) -> Result<(Vec<u8>, String)> {
    let u = url::Url::parse(link.trim()).map_err(|_| Error::Invalid("That isn't a web link".into()))?;
    if u.scheme() != "https" { return Err(Error::Invalid("Only https links can be used for a preview".into())); }
    let mut resp = http.get(u).timeout(std::time::Duration::from_secs(30)).send().await?;
    if !resp.status().is_success() {
        return Err(Error::Network(format!("The picture didn't load (HTTP {})", resp.status().as_u16())));
    }
    let ctype = resp.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let ext = ext_for_type(&ctype).ok_or_else(|| Error::Invalid("That link isn't a PNG, JPG, WebP or GIF picture".into()))?;
    if resp.content_length().is_some_and(|n| n as usize > MAX_BYTES) { return Err(Error::Invalid("That picture is over 25 MB".into())); }
    let mut bytes = Vec::new();
    while let Some(chunk) = resp.chunk().await? {
        bytes.extend_from_slice(&chunk);
        if bytes.len() > MAX_BYTES { return Err(Error::Invalid("That picture is over 25 MB".into())); }
    }
    if bytes.is_empty() { return Err(Error::Invalid("That picture is empty".into())); }
    Ok((bytes, ext.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn texture_names() {
        for t in ["Body_Diffuse.jpg", "HairLightMap.png", "face_normalmap.png", "x_MaterialMap.jpg", "Texture01.png", "Face_d.jpg",
            "Face_N.png", "Textures/Velina.jpg", "tex/a.png", "a.dds"] {
            assert!(looks_like_texture(t), "{t}");
        }
        for p in ["preview.jpg", "Velina.png", "screenshot_1.jpg", "dress.png", "Ellen_dn.png"] {
            assert!(!looks_like_texture(p), "{p}");
        }
        assert!(is_preview_name("Preview.JPG"));
        assert!(!is_preview_name("preview.dds"));
        assert_eq!(ext_for_type("image/jpeg; charset=binary"), Some("jpg"));
        assert_eq!(ext_for_type("text/html"), None);
    }

    #[test]
    fn root_picture_skips_what_the_ini_loads() {
        let dir = std::env::temp_dir().join(format!("gachamod-test-previews-{}-{}", std::process::id(), crate::library::new_id()));
        std::fs::create_dir_all(dir.join("b")).unwrap();
        std::fs::write(dir.join("b/mod.ini"), "[ResourceBody]\nfilename = ..\\Velina.jpg ; the body\n[ResourceX]\nFileName=\"Cover.png\"\n").unwrap();
        let files: Vec<String> = ["Velina.jpg", "Body_Diffuse.png", "Real shot.png", "mod.ini"].iter().map(|s| s.to_string()).collect();
        assert!(ini_referenced(&dir).contains("velina.jpg"));
        assert_eq!(root_picture(&dir, &files, |_| false).as_deref(), Some("Real shot.png"));
        assert_eq!(root_picture(&dir, &files[..2], |_| false), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn nested_picture_finds_a_cover_in_a_subfolder() {
        let dir = std::env::temp_dir().join(format!("gachamod-test-nested-{}-{}", std::process::id(), crate::library::new_id()));
        for d in ["Velina/Textures", "Velina/Shots", "DISABLED_old", "Velina/Body"] { std::fs::create_dir_all(dir.join(d)).unwrap(); }
        for f in ["Velina/Textures/Body.png", "Velina/Body/Skin.jpg", "DISABLED_old/preview.png", "Velina/Shots/a.jpg", "Velina/Shots/preview.webp"] {
            std::fs::write(dir.join(f), b"x").unwrap();
        }
        std::fs::write(dir.join("Velina/mod.ini"), "[ResourceSkin]\nfilename = Body\\Skin.jpg\n").unwrap();
        assert_eq!(nested_picture(&dir).as_deref(), Some("Velina/Shots/preview.webp"));
        std::fs::remove_file(dir.join("Velina/Shots/preview.webp")).unwrap();
        assert_eq!(nested_picture(&dir).as_deref(), Some("Velina/Shots/a.jpg"));
        std::fs::remove_file(dir.join("Velina/Shots/a.jpg")).unwrap();
        assert_eq!(nested_picture(&dir), None);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
