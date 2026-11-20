//! Reference files for one AI helper run: the app's stylesheets and the screen's HTML for a theme, a mod's ini and text
//! files for mod jobs. A CLI with read-only file tools (Claude Code, Gemini CLI) gets them as a folder of copies to
//! read from; the others get as many as fit pasted after the request. Nothing here points a chatbot at the user's own
//! folders: mod files are copied, so a CLI never works inside the Mods folder. Owner: SETTINGS/AI area.

use crate::db::Db;
use crate::Result;
use serde::{Deserialize, Serialize};
use std::fmt::Write as _;
use std::path::{Path, PathBuf};

/// One file for a run: where it goes in the run's folder, one line on what it is, and its text.
#[derive(Debug, Clone, Deserialize)]
pub struct JobFile {
    pub path: String,
    #[serde(default)]
    pub about: String,
    pub text: String,
}

/// A file as written in the run's folder.
#[derive(Debug, Clone)]
pub struct Written {
    pub path: String,
    pub about: String,
    pub size: usize,
}

/// Most a run's folder holds, and most one file in it.
const FOLDER_MAX: usize = 24 * 1024 * 1024;
const FILE_MAX: usize = 3 * 1024 * 1024;

/// `path` as a relative path inside the run's folder: plain names only, no drive, no `..`. None when nothing is left.
fn safe_rel(path: &str) -> Option<PathBuf> {
    let mut out = PathBuf::new();
    for part in path.split(['/', '\\']) {
        let clean: String = part.chars().filter(|c| !matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*') && !c.is_control()).collect();
        let clean = clean.trim().trim_end_matches('.').to_string();
        if clean.is_empty() || clean == "." || clean == ".." {
            continue;
        }
        out.push(clean.chars().take(120).collect::<String>());
    }
    (!out.as_os_str().is_empty()).then_some(out)
}

/// Writes the files into `dir` and returns the ones written, as they're named there.
pub fn write(dir: &Path, files: &[JobFile]) -> Result<Vec<Written>> {
    let mut written = Vec::new();
    let mut total = 0;
    for f in files {
        let Some(rel) = safe_rel(&f.path) else { continue };
        if f.text.len() > FILE_MAX || total + f.text.len() > FOLDER_MAX {
            continue;
        }
        let path = dir.join(&rel);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&path, &f.text)?;
        total += f.text.len();
        written.push(Written { path: rel.to_string_lossy().replace('\\', "/"), about: f.about.clone(), size: f.text.len() });
    }
    Ok(written)
}

fn size(n: usize) -> String {
    if n < 1024 { format!("{n} B") } else { format!("{} KB", n.div_ceil(1024)) }
}

/// The request for a CLI that reads the files itself: the files listed after it.
pub fn listed(prompt: &str, files: &[Written]) -> String {
    if files.is_empty() {
        return prompt.to_string();
    }
    let mut out = format!("{prompt}\n\nReference files in the current folder. Read the ones that help with your file tools (Read, Glob, Grep). They are copies for this request only: don't change, create or delete files.\n");
    for f in files {
        let _ = write!(out, "\n- {} ({}){}", f.path, size(f.size), if f.about.is_empty() { String::new() } else { format!(": {}", f.about) });
    }
    out
}

/// The request with as many files as fit in `budget` characters pasted after it, in the order given, and the names
/// of the ones left out.
pub fn inlined(prompt: &str, files: &[JobFile], budget: usize) -> String {
    if files.is_empty() {
        return prompt.to_string();
    }
    let mut out = format!("{prompt}\n\nReference files follow, each after a ===== line with its name.\n");
    let mut left = Vec::new();
    for f in files {
        let head = format!("\n===== {}{} =====\n", f.path, if f.about.is_empty() { String::new() } else { format!(": {}", f.about) });
        if out.len() + head.len() + f.text.len() > budget {
            left.push(f.path.as_str());
            continue;
        }
        out.push_str(&head);
        out.push_str(&f.text);
        out.push('\n');
    }
    if !left.is_empty() {
        let _ = write!(out, "\n===== end =====\nLeft out for length: {}.\n", left.join(", "));
    }
    out
}

// ── a mod's files, for mod jobs ──

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRow {
    pub path: String,
    pub size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextFile {
    pub path: String,
    pub text: String,
    /// Only the start of the file is here (or none of it, when the job's room ran out).
    pub cut: bool,
    /// An ini's section names from the whole file, like "TextureOverrideEllenHair": they say what the mod draws.
    pub sections: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModFiles {
    pub id: String,
    /// Every file, up to LIST_MAX, as paths inside the mod's folder.
    pub files: Vec<FileRow>,
    /// Files past LIST_MAX.
    pub more: usize,
    /// The text files (ini, txt, md, json): what the mod draws, its readme and its settings.
    pub texts: Vec<TextFile>,
}

const LIST_MAX: usize = 300;
const TEXT_MAX: usize = 64 * 1024;
const MOD_TEXT_MAX: usize = 384 * 1024;
const SECTIONS_MAX: usize = 200;
const TEXT_EXT: [&str; 6] = ["ini", "txt", "md", "json", "toml", "cfg"];

/// The files of each mod in `ids`, for a chatbot to read, with up to `per_mod` bytes of text each (a job about many
/// mods sends less of each). Mods that aren't there any more are left out.
pub fn mod_files(db: &Db, game: &str, ids: &[String], per_mod: usize) -> Vec<ModFiles> {
    let per_mod = per_mod.clamp(4 * 1024, MOD_TEXT_MAX);
    ids.iter().filter_map(|id| {
        let m = crate::library::get(db, game, id).ok()?;
        let root = PathBuf::from(&m.path);
        root.is_dir().then(|| read_mod(id, &root, per_mod))
    }).collect()
}

/// Section names in an ini, in order, without repeats.
fn sections_of(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for line in text.lines() {
        let l = line.trim();
        if let Some(name) = l.strip_prefix('[').and_then(|r| r.split(']').next()) {
            let name = name.trim();
            if !name.is_empty() && !out.iter().any(|x| x.eq_ignore_ascii_case(name)) {
                out.push(name.to_string());
                if out.len() >= SECTIONS_MAX {
                    break;
                }
            }
        }
    }
    out
}

fn read_mod(id: &str, root: &Path, per_mod: usize) -> ModFiles {
    let mut all = Vec::new();
    walk(root, root, 0, &mut all);
    // inis first (what the mod draws), shallow before deep, then readmes and the rest
    all.sort_by_key(|(rel, _)| {
        let ext = Path::new(rel).extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
        (ext != "ini", rel.matches('/').count(), rel.to_ascii_lowercase())
    });
    let mut texts = Vec::new();
    let mut used = 0;
    for (rel, n) in &all {
        let ext = Path::new(rel).extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
        // inis are always read for their section names, even once the text room is used up
        let ini = ext == "ini";
        if !TEXT_EXT.contains(&ext.as_str()) || (!ini && used >= per_mod) || *n > 16 * 1024 * 1024 {
            continue;
        }
        let Ok(bytes) = std::fs::read(root.join(rel)) else { continue };
        if bytes.contains(&0) {
            continue;
        }
        let sections = if ini { sections_of(&String::from_utf8_lossy(&bytes)) } else { Vec::new() };
        let room = TEXT_MAX.min(per_mod.saturating_sub(used));
        let cut = bytes.len() > room;
        let mut text = String::from_utf8_lossy(&bytes[..bytes.len().min(room)]).into_owned();
        if cut {
            // end on a whole line
            text.truncate(text.rfind('\n').map_or(0, |i| i + 1));
        }
        used += text.len();
        if text.is_empty() && sections.is_empty() {
            continue;
        }
        texts.push(TextFile { path: rel.clone(), text, cut, sections });
    }
    let more = all.len().saturating_sub(LIST_MAX);
    all.truncate(LIST_MAX);
    ModFiles { id: id.to_string(), files: all.into_iter().map(|(path, size)| FileRow { path, size }).collect(), more, texts }
}

fn walk(root: &Path, dir: &Path, depth: usize, out: &mut Vec<(String, u64)>) {
    if depth > 8 || out.len() > 5000 {
        return;
    }
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let path = e.path();
        let Ok(meta) = e.metadata() else { continue };
        if meta.is_dir() {
            walk(root, &path, depth + 1, out);
        } else if let Ok(rel) = path.strip_prefix(root) {
            out.push((rel.to_string_lossy().replace('\\', "/"), meta.len()));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn f(path: &str, text: &str) -> JobFile {
        JobFile { path: path.into(), about: "a file".into(), text: text.into() }
    }

    #[test]
    fn keeps_files_inside_the_folder() {
        assert_eq!(safe_rel("styles/kit.css"), Some(PathBuf::from("styles").join("kit.css")));
        assert_eq!(safe_rel("../../Windows/x.txt"), Some(PathBuf::from("Windows").join("x.txt")));
        assert_eq!(safe_rel("C:\\Users\\x.ini"), Some(PathBuf::from("C").join("Users").join("x.ini")));
        assert_eq!(safe_rel(".."), None);
        let dir = std::env::temp_dir().join(format!("gm-aifiles-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let w = write(&dir, &[f("../evil.txt", "x"), f("mods/1/Ellen.ini", "[TextureOverrideEllen]")]).unwrap();
        assert_eq!(w.iter().map(|x| x.path.as_str()).collect::<Vec<_>>(), ["evil.txt", "mods/1/Ellen.ini"]);
        assert!(dir.join("evil.txt").is_file() && !dir.parent().unwrap().join("evil.txt").is_file());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn pastes_what_fits_and_names_the_rest() {
        let files = [f("a.css", &"a".repeat(50)), f("b.css", &"b".repeat(500)), f("c.css", &"c".repeat(20))];
        let out = inlined("Make a theme.", &files, 260);
        assert!(out.starts_with("Make a theme."));
        assert!(out.contains("===== a.css: a file =====") && out.contains("===== c.css"));
        assert!(!out.contains("bbbb"));
        assert!(out.contains("Left out for length: b.css."));
        let listed = listed("Make a theme.", &[Written { path: "styles/kit.css".into(), about: "a file".into(), size: 54_000 }]);
        assert!(listed.contains("- styles/kit.css (53 KB): a file"));
    }

    #[test]
    fn reads_a_mods_inis_first() {
        let dir = std::env::temp_dir().join(format!("gm-aimod-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("Body")).unwrap();
        std::fs::write(dir.join("readme.txt"), "Ellen maid outfit").unwrap();
        std::fs::write(dir.join("Ellen.ini"), "[TextureOverrideEllenBody]\nhash = 1234\n").unwrap();
        std::fs::write(dir.join("Body").join("EllenBody.buf"), [0u8, 1, 2]).unwrap();
        let m = read_mod("m1", &dir, MOD_TEXT_MAX);
        assert_eq!(m.files[0].path, "Ellen.ini");
        assert_eq!(m.texts[0].sections, ["TextureOverrideEllenBody"]);
        assert_eq!(m.texts.iter().map(|t| t.path.as_str()).collect::<Vec<_>>(), ["Ellen.ini", "readme.txt"]);
        assert!(m.files.iter().any(|r| r.path == "Body/EllenBody.buf" && r.size == 3));
        // no room left for text: the ini still names its sections, the readme stays out
        let m = read_mod("m1", &dir, 0);
        assert_eq!(m.texts.len(), 1);
        assert!(m.texts[0].text.is_empty() && m.texts[0].cut && m.texts[0].sections.len() == 1);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
