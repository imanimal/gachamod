//! Fixers the player downloads from GameBanana in Tools > Fixes. Each file goes to
//! `<data>/fixers/<game>/<tool name>/<file name>/` (archives are extracted there) and is listed in
//! `<data>/fixers/<game>/fixers.json`. gachamod only downloads them: it never reads, copies or runs their code.
//! Owner: FIXES area.

use crate::download::{download, safe_file_name};
use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// A downloaded fixer file.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct FixerFile {
    pub tool_id: u64,
    pub file_id: u64,
    /// The tool's name on GameBanana ("7.2 Odette and Vesna Fix").
    pub tool: String,
    /// The file's name on GameBanana ("version_72_fix.exe").
    pub file: String,
    /// The folder it was saved in.
    pub dir: String,
    /// What Explorer shows: the one program in the folder (an .exe, else a .bat or .py), or the folder itself.
    pub main: String,
    pub at: i64,
}

/// One file of a GameBanana tool to download.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct FixerRequest {
    pub tool_id: u64,
    pub file_id: u64,
    pub tool: String,
    pub file: String,
    pub url: String,
    /// The MD5 GameBanana lists for the file, checked when given.
    pub md5: Option<String>,
}

const LIST: &str = "fixers.json";

fn root(data_dir: &Path, game: &str) -> Result<PathBuf> {
    // a game id is one plain folder name (extension games included)
    if game.is_empty() || game.len() > 40 || !game.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err(Error::Invalid(format!("Unknown game \"{game}\"")));
    }
    Ok(data_dir.join("fixers").join(game))
}

/// A folder name from a name on GameBanana, kept short so the paths inside stay under Windows' limit.
fn folder_name(name: &str, fallback: &str) -> String {
    let s: String = safe_file_name(name).chars().take(60).collect();
    let s = s.trim().trim_end_matches(['.', ' ']).to_string();
    if s.is_empty() || s == "download.bin" { fallback.into() } else { s }
}

/// The fixers downloaded for a game, oldest first. Ones whose files were deleted since are left out.
pub fn list(data_dir: &Path, game: &str) -> Result<Vec<FixerFile>> {
    let path = root(data_dir, game)?.join(LIST);
    let all: Vec<FixerFile> = std::fs::read_to_string(&path).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    Ok(all.into_iter().filter(|f| Path::new(&f.main).exists()).collect())
}

fn remember(data_dir: &Path, game: &str, entry: &FixerFile) -> Result<()> {
    let mut all = list(data_dir, game)?;
    all.retain(|f| f.file_id != entry.file_id);
    all.push(entry.clone());
    let path = root(data_dir, game)?.join(LIST);
    std::fs::write(&path, serde_json::to_string_pretty(&all).map_err(|e| Error::Invalid(e.to_string()))?)?;
    Ok(())
}

/// Only GameBanana's own https links are downloaded.
fn from_gamebanana(url: &str) -> bool {
    url::Url::parse(url).is_ok_and(|u| {
        u.scheme() == "https" && u.host_str().is_some_and(|h| h == "gamebanana.com" || h.ends_with(".gamebanana.com"))
    })
}

/// Download one file of a GameBanana tool and keep it in the fixers folder. Downloading a file again replaces it.
pub async fn fetch(http: &reqwest::Client, data_dir: &Path, game: &str, req: FixerRequest) -> Result<FixerFile> {
    if !from_gamebanana(&req.url) { return Err(Error::Invalid("Fixers are only downloaded from GameBanana".into())); }
    fetch_from(http, data_dir, game, req).await
}

async fn fetch_from(http: &reqwest::Client, data_dir: &Path, game: &str, req: FixerRequest) -> Result<FixerFile> {
    let base = root(data_dir, game)?;
    let tmp = base.join(".downloading");
    let got = download(http, &req.url, &tmp, &req.file, |_, _| true).await?;
    if let Some(want) = req.md5.as_deref().map(str::trim).filter(|m| !m.is_empty()) {
        if !got.md5.eq_ignore_ascii_case(want) {
            let _ = tokio::fs::remove_file(&got.path).await;
            return Err(Error::Invalid("The download doesn't match the checksum GameBanana lists. Try again".into()));
        }
    }
    let (data, game) = (data_dir.to_path_buf(), game.to_string());
    tokio::task::spawn_blocking(move || place(&data, &game, &req, &got.path))
        .await
        .unwrap_or_else(|e| Err(Error::Invalid(e.to_string())))
}

/// Move a downloaded file into its folder (extracting an archive) and list it.
pub fn place(data_dir: &Path, game: &str, req: &FixerRequest, downloaded: &Path) -> Result<FixerFile> {
    let file = safe_file_name(&req.file);
    let stem = Path::new(&file).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let dir = root(data_dir, game)?.join(folder_name(&req.tool, "Fixer")).join(folder_name(&stem, "Files"));
    if dir.exists() { std::fs::remove_dir_all(&dir)?; }
    std::fs::create_dir_all(&dir)?;
    if crate::archive::detect(downloaded).is_ok() {
        let r = crate::archive::extract(downloaded, &dir);
        let _ = std::fs::remove_file(downloaded);
        r?;
    } else {
        let to = dir.join(&file);
        if std::fs::rename(downloaded, &to).is_err() {
            std::fs::copy(downloaded, &to)?;
            let _ = std::fs::remove_file(downloaded);
        }
    }
    let entry = FixerFile {
        tool_id: req.tool_id, file_id: req.file_id, tool: req.tool.clone(), file: req.file.clone(),
        dir: dir.to_string_lossy().into_owned(), main: main_of(&dir).to_string_lossy().into_owned(), at: crate::db::now(),
    };
    remember(data_dir, game, &entry)?;
    Ok(entry)
}

/// The program to point at: the only .exe, else the only .bat or .cmd, else the only .py. Two of a kind (or none)
/// means the folder.
fn main_of(dir: &Path) -> PathBuf {
    let files: Vec<PathBuf> = walkdir::WalkDir::new(dir).max_depth(4).into_iter().flatten()
        .filter(|e| e.file_type().is_file()).map(|e| e.into_path()).collect();
    let ext = |p: &Path| p.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
    for kinds in [&["exe"][..], &["bat", "cmd"][..], &["py", "pyw"][..]] {
        let found: Vec<&PathBuf> = files.iter().filter(|p| kinds.contains(&ext(p).as_str())).collect();
        match found.len() {
            0 => continue,
            1 => return found[0].clone(),
            _ => break,
        }
    }
    dir.to_path_buf()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn req(file: &str, id: u64) -> FixerRequest {
        FixerRequest { tool_id: 24821, file_id: id, tool: "7.2 Odette and Vesna Fix".into(), file: file.into(), url: String::new(), md5: None }
    }

    #[test]
    fn only_gamebanana_links() {
        assert!(from_gamebanana("https://gamebanana.com/dl/1879008"));
        assert!(from_gamebanana("https://files.gamebanana.com/tools/x.zip"));
        assert!(!from_gamebanana("http://gamebanana.com/dl/1"));
        assert!(!from_gamebanana("https://gamebanana.com.evil.test/dl/1"));
        assert!(!from_gamebanana("https://example.com/gamebanana.com/dl/1"));
    }

    #[test]
    fn a_program_is_kept_as_it_is_and_listed() {
        let d = tempfile::tempdir().unwrap();
        let dl = d.path().join("version_72_fix.exe");
        std::fs::write(&dl, b"MZ not really").unwrap();
        let f = place(d.path(), "gi", &req("version_72_fix.exe", 1), &dl).unwrap();
        assert!(f.main.ends_with("version_72_fix.exe"));
        assert!(Path::new(&f.main).is_file());
        assert!(f.dir.contains("7.2 Odette and Vesna Fix"));
        assert_eq!(list(d.path(), "gi").unwrap(), vec![f.clone()]);
        // downloading it again replaces it
        std::fs::write(&dl, b"MZ again").unwrap();
        place(d.path(), "gi", &req("version_72_fix.exe", 1), &dl).unwrap();
        assert_eq!(list(d.path(), "gi").unwrap().len(), 1);
        // deleted by hand: no longer listed
        std::fs::remove_dir_all(&f.dir).unwrap();
        assert!(list(d.path(), "gi").unwrap().is_empty());
    }

    #[test]
    fn an_archive_is_extracted_and_its_program_found() {
        let d = tempfile::tempdir().unwrap();
        let dl = d.path().join("fix.zip");
        let mut z = zip::ZipWriter::new(std::fs::File::create(&dl).unwrap());
        let opt = zip::write::SimpleFileOptions::default();
        z.start_file("Fixer/readme.txt", opt).unwrap();
        z.write_all(b"put it in Mods").unwrap();
        z.start_file("Fixer/fix.exe", opt).unwrap();
        z.write_all(b"MZ").unwrap();
        z.start_file("Fixer/src/fix.py", opt).unwrap();
        z.write_all(b"print()").unwrap();
        z.finish().unwrap();
        let f = place(d.path(), "zzz", &req("fix.zip", 2), &dl).unwrap();
        assert!(f.main.replace('\\', "/").ends_with("Fixer/fix.exe"));
        assert!(!dl.exists());
    }

    #[test]
    fn two_programs_point_at_the_folder() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("a.exe"), b"").unwrap();
        std::fs::write(d.path().join("b.exe"), b"").unwrap();
        assert_eq!(main_of(d.path()), d.path());
    }

    #[test]
    fn a_game_id_is_one_folder() {
        let d = tempfile::tempdir().unwrap();
        assert!(list(d.path(), "../x").is_err());
        assert!(list(d.path(), "").is_err());
        assert!(list(d.path(), "zzz").unwrap().is_empty());
    }
}
