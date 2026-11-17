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

// ── thumbnails ──
//
// Mod cards show a small copy of the preview, so a grid of 4K screenshots doesn't decode 4K pictures. The copies live
// in `<data>/cache/thumbs` (library::thumbs_dir); the drawer and the lightbox keep using the full picture.

/// The shorter side of a thumbnail, in pixels: sharp on a mod card at 150% display scaling.
pub const THUMB_SIDE: u32 = 400;

/// What the cache has for a picture.
#[derive(Debug, Clone, PartialEq)]
pub enum Thumb {
    Ready(PathBuf),
    /// Nothing to make: a remote picture, a GIF (a copy would stop moving), one already about thumbnail size, or one
    /// that can't be read.
    NotNeeded,
    ToMake,
}

/// A local picture's thumbnail name (no extension), from its file name, size and modified time: a mod folder that is
/// renamed or turned off keeps its thumbnail, and a changed picture gets a new one.
fn thumb_key(preview: &str) -> Option<String> {
    use sha2::{Digest, Sha256};
    if preview.contains("://") { return None; }
    let p = Path::new(preview);
    let name = p.file_name()?.to_string_lossy().to_lowercase();
    if !is_image_name(&name) || ext_of(&name) == "gif" { return None; }
    let meta = std::fs::metadata(p).ok().filter(|m| m.is_file())?;
    let t = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_nanos()).unwrap_or(0);
    let mut h = Sha256::new();
    h.update(name.as_bytes());
    h.update(meta.len().to_le_bytes());
    h.update(t.to_le_bytes());
    Some(hex::encode(&h.finalize()[..10]))
}

/// Look up a picture's thumbnail in `cache` without making it.
pub fn find_thumb(cache: &Path, preview: &str) -> Thumb {
    let Some(key) = thumb_key(preview) else { return Thumb::NotNeeded };
    for ext in ["jpg", "png"] {
        let p = cache.join(format!("{key}.{ext}"));
        if p.is_file() { return Thumb::Ready(p); }
    }
    if cache.join(format!("{key}.none")).is_file() { Thumb::NotNeeded } else { Thumb::ToMake }
}

/// The picture's thumbnail, made now when it isn't in `cache` yet (one picture: fine on a user's click, too slow for a
/// whole scan, which uses `make_thumbs_later`). None when the full picture should show.
pub fn thumb_now(cache: &Path, preview: &str) -> Option<PathBuf> {
    match find_thumb(cache, preview) {
        Thumb::Ready(p) => Some(p),
        Thumb::NotNeeded => None,
        Thumb::ToMake => make_thumb(cache, preview),
    }
}

/// Make a thumbnail: JPEG, or PNG when the picture has see-through parts. A picture that is already small or can't
/// be read gets a `.none` marker so it isn't tried again.
fn make_thumb(cache: &Path, preview: &str) -> Option<PathBuf> {
    use image::{imageops::FilterType, ImageReader};
    let key = thumb_key(preview)?;
    std::fs::create_dir_all(cache).ok()?;
    let made = (|| {
        let (w, h) = ImageReader::open(preview).ok()?.with_guessed_format().ok()?.into_dimensions().ok()?;
        if w.min(h) <= THUMB_SIDE * 5 / 4 { return None; }
        let img = ImageReader::open(preview).ok()?.with_guessed_format().ok()?.decode().ok()?;
        let k = THUMB_SIDE as f64 / w.min(h) as f64;
        let small = img.resize_exact(((w as f64 * k).round() as u32).max(1), ((h as f64 * k).round() as u32).max(1), FilterType::Triangle);
        let clear = small.color().has_alpha() && small.to_rgba8().pixels().any(|p| p[3] < 255);
        let ext = if clear { "png" } else { "jpg" };
        let out = cache.join(format!("{key}.{ext}"));
        // written next to it first, so the webview never reads half a file
        let tmp = cache.join(format!("{key}.{ext}.part"));
        let wrote = if clear {
            small.save_with_format(&tmp, image::ImageFormat::Png).is_ok()
        } else {
            std::fs::File::create(&tmp).ok().is_some_and(|f| {
                let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(std::io::BufWriter::new(f), 82);
                enc.encode_image(&small.to_rgb8()).is_ok()
            })
        };
        if !wrote || std::fs::rename(&tmp, &out).is_err() { let _ = std::fs::remove_file(&tmp); return None; }
        Some(out)
    })();
    if made.is_none() { let _ = std::fs::write(cache.join(format!("{key}.none")), b""); }
    made
}

/// Pictures waiting for a thumbnail, and whether a thread is working through them.
static PENDING: std::sync::Mutex<(Vec<(PathBuf, String)>, bool)> = std::sync::Mutex::new((Vec::new(), false));

/// Make these pictures' thumbnails on a background thread, one at a time. The next scan picks them up.
pub fn make_thumbs_later(cache: &Path, previews: Vec<String>) {
    if previews.is_empty() { return; }
    let Ok(mut q) = PENDING.lock() else { return };
    for p in previews {
        if !q.0.iter().any(|(_, x)| *x == p) { q.0.push((cache.to_path_buf(), p)); }
    }
    if q.1 { return; }
    q.1 = true;
    drop(q);
    let spawned = std::thread::Builder::new().name("thumbs".into()).spawn(|| loop {
        let next = match PENDING.lock() {
            Ok(mut q) => match q.0.pop() { Some(x) => x, None => { q.1 = false; return; } },
            Err(_) => return,
        };
        if find_thumb(&next.0, &next.1) == Thumb::ToMake { let _ = make_thumb(&next.0, &next.1); }
    });
    if spawned.is_err() { if let Ok(mut q) = PENDING.lock() { q.1 = false; } }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thumbnails_shrink_big_pictures_only() {
        let dir = std::env::temp_dir().join(format!("gachamod-test-thumbs-{}-{}", std::process::id(), crate::library::new_id()));
        let cache = dir.join("cache");
        std::fs::create_dir_all(&dir).unwrap();
        let big = dir.join("preview.png");
        image::RgbImage::from_pixel(1200, 800, image::Rgb([200, 40, 40])).save(&big).unwrap();
        let small = dir.join("small.png");
        image::RgbImage::from_pixel(300, 200, image::Rgb([0, 0, 0])).save(&small).unwrap();
        let (big, small) = (big.to_string_lossy().into_owned(), small.to_string_lossy().into_owned());

        assert_eq!(find_thumb(&cache, &big), Thumb::ToMake);
        let t = thumb_now(&cache, &big).unwrap();
        assert!(t.to_string_lossy().ends_with(".jpg"));
        assert_eq!(image::image_dimensions(&t).unwrap(), (600, 400));
        assert_eq!(find_thumb(&cache, &big), Thumb::Ready(t));

        assert_eq!(thumb_now(&cache, &small), None);
        assert_eq!(find_thumb(&cache, &small), Thumb::NotNeeded);
        assert_eq!(find_thumb(&cache, "https://example.com/a.png"), Thumb::NotNeeded);
        let _ = std::fs::remove_dir_all(&dir);
    }

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
