//! Download a file to a folder, hashing it on the way (MD5, as GameBanana lists file hashes). Written to
//! `<name>.part` and renamed when complete, so a broken download never looks finished.

use crate::error::{Error, Result};
use futures_util::StreamExt;
use md5::{Digest, Md5};
use reqwest::Url;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tokio::io::AsyncWriteExt;

pub const CANCELLED: &str = "Cancelled. Retry resumes it";

pub struct Downloaded { pub path: PathBuf, pub size: u64, pub md5: String }

/// GameBanana's file servers that serve `/mods/<file>` (`filecache<N>.gamebanana.com`, see docs/research.md).
/// `/dl/<fileId>` always sends a file to the same one, and any of them can drop to a few hundred KB/s for a while
/// when the others serve the same file at full speed.
const GB_FILE_SERVERS: &[u8] = &[20, 31, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 52, 53, 54];

/// When a download counts as slow, and where else it can get the same file.
pub struct Switch {
    /// Bytes per second. Slower than this for a whole `window` moves the download.
    pub below: u64,
    pub window: Duration,
    /// Less than this left to fetch is not worth a new connection.
    pub min_left: u64,
    /// The most moves for one download.
    pub most: u32,
    /// The same file on other servers, given the address the download ended up at (after redirects).
    pub others: fn(&Url) -> Vec<Url>,
}

/// Under 1 MB/s for 8 seconds with 8 MB or more to go: carry on from another of GameBanana's file servers.
pub static GAMEBANANA: Switch = Switch { below: 1_000_000, window: Duration::from_secs(8), min_left: 8_000_000, most: 3, others: gb_other_servers };

/// The same file on GameBanana's other file servers. Empty for any other address.
pub fn gb_other_servers(at: &Url) -> Vec<Url> {
    let Some(n) = at.host_str().and_then(|h| h.strip_prefix("filecache")?.strip_suffix(".gamebanana.com")?.parse::<u8>().ok()) else {
        return Vec::new();
    };
    if !at.path().starts_with("/mods/") { return Vec::new(); }
    GB_FILE_SERVERS.iter().filter(|&&o| o != n).filter_map(|o| {
        let mut u = at.clone();
        u.set_host(Some(&format!("filecache{o}.gamebanana.com"))).ok()?;
        Some(u)
    }).collect()
}

/// A file name safe on Windows.
pub fn safe_file_name(name: &str) -> String {
    let s: String = name.chars().map(|c| if "<>:\"/\\|?*".contains(c) || c.is_control() { '_' } else { c }).collect();
    let s = s.trim().trim_end_matches(['.', ' ']).to_string();
    if s.is_empty() { "download.bin".into() } else { s }
}

/// Where an unfinished download of `file_name` in `dir` is kept (`<name>.part`).
pub fn part_path(dir: &Path, file_name: &str) -> PathBuf {
    let path = dir.join(safe_file_name(file_name));
    path.with_extension(format!("{}part", path.extension().map(|e| format!("{}.", e.to_string_lossy())).unwrap_or_default()))
}

/// `progress(received, total)` is called as bytes arrive. A connection that drops is picked up again where it
/// stopped (a Range request), up to five times with a growing pause, so a long download survives
/// a hiccup. With `switch`, a download that stays slow carries on from another server with the same file, and goes
/// back to `url` if that server fails.
pub async fn download(http: &reqwest::Client, url: &str, dir: &Path, file_name: &str, switch: Option<&Switch>,
                      mut progress: impl FnMut(u64, Option<u64>) -> bool) -> Result<Downloaded> {
    tokio::fs::create_dir_all(dir).await?;
    let path = dir.join(safe_file_name(file_name));
    let part = part_path(dir, file_name);
    let mut attempt = 0u32;
    // the server the download moved to, the ones it left (slow or failed), and the full size `url` gave
    let mut other: Option<Url> = None;
    let mut left: HashSet<String> = HashSet::new();
    let mut moves = 0u32;
    let mut size: Option<u64> = None;
    loop {
        let watch = switch.filter(|s| moves < s.most);
        let from = other.as_ref().map_or(url, |u| u.as_str());
        match try_download(http, from, &part, other.is_some(), size, watch, &mut progress).await {
            Ok(Step::Done) => break,
            Ok(Step::Slow { at, total, rate }) => {
                size = size.or(total);
                left.insert(origin(&at));
                let s = watch.expect("only a watched download is slow");
                moves += 1;
                match pick((s.others)(&at).into_iter().filter(|u| !left.contains(&origin(u))).collect()) {
                    Some(next) => {
                        crate::logs::info(format!("Download of {file_name}: {} gave {} KB/s, carrying on from {}",
                            at.host_str().unwrap_or("?"), rate / 1000, next.host_str().unwrap_or("?")));
                        other = Some(next);
                    }
                    // nowhere left to go: stay, and stop watching
                    None => moves = s.most,
                }
            }
            Err(e) if matches!(&e, Error::Invalid(m) if m == CANCELLED) => return Err(e),
            Err(e) => match other.take() {
                Some(failed) => {
                    crate::logs::info(format!("Download of {file_name}: {} failed ({e}), back to {url}", failed.host_str().unwrap_or("?")));
                    left.insert(origin(&failed));
                }
                None if matches!(e, Error::Network(_)) && attempt < 5 => {
                    attempt += 1;
                    pause(attempt).await;
                }
                None => return Err(e),
            },
        }
    }
    // hash the finished file in one pass (it may have arrived in pieces)
    let (size, md5) = hash_file(&part).await?;
    tokio::fs::rename(&part, &path).await?;
    Ok(Downloaded { path, size, md5 })
}

async fn pause(attempt: u32) { tokio::time::sleep(Duration::from_secs(2u64.pow(attempt.min(4)))).await; }

fn origin(u: &Url) -> String { u.origin().ascii_serialization() }

/// One of `v` at random, so downloads that move spread over the servers.
fn pick<T>(mut v: Vec<T>) -> Option<T> {
    if v.is_empty() { return None; }
    let mut b = [0u8; 8];
    let _ = getrandom::fill(&mut b);
    Some(v.swap_remove((u64::from_le_bytes(b) % v.len() as u64) as usize))
}

async fn hash_file(p: &Path) -> Result<(u64, String)> {
    let mut f = tokio::fs::File::open(p).await?;
    let mut hash = Md5::new();
    let mut buf = vec![0u8; 1 << 20];
    let mut n_all = 0u64;
    loop {
        let n = tokio::io::AsyncReadExt::read(&mut f, &mut buf).await?;
        if n == 0 { break; }
        hash.update(&buf[..n]);
        n_all += n as u64;
    }
    Ok((n_all, hex::encode(hash.finalize())))
}

enum Step {
    Done,
    /// Slower than the switch allows. `at` is where the bytes came from, `total` the full size it gave.
    Slow { at: Url, total: Option<u64>, rate: u64 },
}

/// One request: from the start, or the rest of a `.part` left by an earlier try. `strict` is for a server other than
/// the file's own link: it fails instead of starting over or sending a file of another `size`.
async fn try_download(http: &reqwest::Client, url: &str, part: &Path, strict: bool, size: Option<u64>, watch: Option<&Switch>,
                      progress: &mut impl FnMut(u64, Option<u64>) -> bool) -> Result<Step> {
    let have = tokio::fs::metadata(part).await.map(|m| m.len()).unwrap_or(0);
    let mut req = http.get(url);
    if have > 0 { req = req.header("Range", format!("bytes={have}-")); }
    let resp = req.send().await.map_err(|e| Error::Network(format!("{}. Retry to resume", e.without_url())))?;
    // asked for the rest of a file that is already complete
    if have > 0 && resp.status().as_u16() == 416 { progress(have, Some(have)); return Ok(Step::Done); }
    if !resp.status().is_success() {
        return Err(Error::Http { status: resp.status().as_u16(), message: "The link expired. Try the file again".into() });
    }
    let resumed = have > 0 && resp.status().as_u16() == 206;
    let mut received = if resumed { have } else { 0 };
    let total = resp.content_length().map(|l| l + received);
    if strict && have > 0 && !resumed { return Err(Error::Network("it can't resume".into())); }
    if strict && size.is_some() && total != size { return Err(Error::Network("its copy is another size".into())); }
    let at = resp.url().clone();
    let watch = watch.filter(|s| !(s.others)(&at).is_empty());
    let mut file = if resumed { tokio::fs::OpenOptions::new().append(true).open(part).await? } else { tokio::fs::File::create(part).await? };
    let mut stream = resp.bytes_stream();
    let to_go = |received: u64| total.map_or(0, |t| t.saturating_sub(received));
    let mut window = (Instant::now(), received);
    loop {
        let next = match watch {
            Some(s) => match tokio::time::timeout(s.window, stream.next()).await {
                Ok(n) => n,
                // nothing at all for a whole window
                Err(_) if to_go(received) >= s.min_left => { file.flush().await?; return Ok(Step::Slow { at, total, rate: 0 }); }
                Err(_) => stream.next().await,
            },
            None => stream.next().await,
        };
        let Some(chunk) = next else { break };
        let chunk = chunk.map_err(|e| Error::Network(format!("{}. Retry to resume", e.without_url())))?;
        file.write_all(&chunk).await?;
        received += chunk.len() as u64;
        // false: the user cancelled; the part stays, so starting it again resumes
        if !progress(received, total) { file.flush().await?; return Err(Error::Invalid(CANCELLED.into())); }
        if let Some(s) = watch {
            let took = window.0.elapsed();
            if took >= s.window {
                let rate = ((received - window.1) as f64 / took.as_secs_f64()) as u64;
                if rate < s.below && to_go(received) >= s.min_left {
                    file.flush().await?;
                    return Ok(Step::Slow { at, total, rate });
                }
                window = (Instant::now(), received);
            }
        }
    }
    file.flush().await?;
    drop(file);
    if total.is_some_and(|t| t != received) {
        // keep the part: the next try asks for the rest
        return Err(Error::Network(format!("Stopped early at {received} of {} bytes. Retry to resume", total.unwrap_or(0))));
    }
    Ok(Step::Done)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Write};
    use std::sync::{Arc, Mutex, OnceLock};

    /// A one-file HTTP server that honours Range requests. It writes `piece` bytes at a time with `pause` between
    /// them, and records where each request started.
    fn serve_paced(body: &'static [u8], piece: usize, pause: Duration) -> (String, Arc<Mutex<Vec<usize>>>) {
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = l.local_addr().unwrap();
        let starts = Arc::new(Mutex::new(Vec::new()));
        let seen = starts.clone();
        std::thread::spawn(move || {
            for s in l.incoming().flatten() {
                let seen = seen.clone();
                std::thread::spawn(move || {
                    let mut r = BufReader::new(s.try_clone().unwrap());
                    let mut from = 0usize;
                    loop {
                        let mut line = String::new();
                        if r.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" { break; }
                        if let Some(v) = line.to_lowercase().strip_prefix("range: bytes=") { from = v.trim().trim_end_matches('-').parse().unwrap_or(0); }
                    }
                    seen.lock().unwrap().push(from);
                    let mut s = s;
                    let part = &body[from.min(body.len())..];
                    let status = if from > 0 { "206 Partial Content" } else { "200 OK" };
                    let _ = write!(s, "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", part.len());
                    for p in part.chunks(piece.max(1)) {
                        if s.write_all(p).is_err() { return; }
                        let _ = s.flush();
                        if !pause.is_zero() { std::thread::sleep(pause); }
                    }
                });
            }
        });
        (format!("http://{addr}/mods/file.zip"), starts)
    }

    fn serve(body: &'static [u8]) -> String { serve_paced(body, body.len(), Duration::ZERO).0 }

    fn bytes(n: usize) -> &'static [u8] { Box::leak((0..n).map(|i| (i % 251) as u8).collect::<Vec<_>>().into_boxed_slice()) }

    fn http() -> reqwest::Client { reqwest::Client::builder().no_proxy().build().unwrap() }

    #[tokio::test]
    async fn resumes_a_part_file_and_hashes_the_whole() {
        let body: &'static [u8] = b"hello world, this is a mod archive";
        let url = serve(body);
        let dir = tempfile::tempdir().unwrap();
        // half of it is already there from an earlier try
        std::fs::write(dir.path().join("m.zip.part"), &body[..10]).unwrap();
        let d = download(&http(), &url, dir.path(), "m.zip", None, |_, _| true).await.unwrap();
        assert_eq!(std::fs::read(&d.path).unwrap(), body);
        assert_eq!(d.md5, hex::encode(Md5::digest(body)));
        assert!(!dir.path().join("m.zip.part").exists());
    }

    static FAST: OnceLock<String> = OnceLock::new();
    static WRONG: OnceLock<String> = OnceLock::new();
    fn to_fast(_: &Url) -> Vec<Url> { vec![FAST.get().unwrap().parse().unwrap()] }
    fn to_wrong(_: &Url) -> Vec<Url> { vec![WRONG.get().unwrap().parse().unwrap()] }
    fn quick(others: fn(&Url) -> Vec<Url>) -> Switch {
        Switch { below: 1_000_000, window: Duration::from_millis(200), min_left: 10_000, most: 3, others }
    }

    #[tokio::test]
    async fn a_slow_server_hands_the_rest_to_a_fast_one() {
        let body = bytes(200_000);
        // about 100 KB/s
        let (slow, slow_starts) = serve_paced(body, 1000, Duration::from_millis(10));
        let (fast, fast_starts) = serve_paced(body, 64 * 1024, Duration::ZERO);
        FAST.set(fast).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let d = download(&http(), &slow, dir.path(), "m.zip", Some(&quick(to_fast)), |_, _| true).await.unwrap();
        assert_eq!(std::fs::read(&d.path).unwrap(), body);
        assert_eq!(*slow_starts.lock().unwrap(), vec![0]);
        let fast_starts = fast_starts.lock().unwrap();
        assert_eq!(fast_starts.len(), 1);
        assert!(fast_starts[0] > 0, "the fast server only sends the rest");
    }

    #[tokio::test]
    async fn another_server_with_a_different_file_is_left_alone() {
        let body = bytes(60_000);
        let (slow, slow_starts) = serve_paced(body, 1000, Duration::from_millis(10));
        let (wrong, wrong_starts) = serve_paced(bytes(90_000), 64 * 1024, Duration::ZERO);
        WRONG.set(wrong).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let d = download(&http(), &slow, dir.path(), "m.zip", Some(&quick(to_wrong)), |_, _| true).await.unwrap();
        assert_eq!(std::fs::read(&d.path).unwrap(), body);
        assert_eq!(wrong_starts.lock().unwrap().len(), 1);
        // back to its own link, which finished it
        assert!(slow_starts.lock().unwrap().len() >= 2);
    }

    #[test]
    fn other_gamebanana_servers() {
        let at: Url = "https://filecache46.gamebanana.com/mods/vela_503c4.zip".parse().unwrap();
        let o = gb_other_servers(&at);
        assert_eq!(o.len(), GB_FILE_SERVERS.len() - 1);
        assert!(o.iter().all(|u| u.path() == "/mods/vela_503c4.zip" && u.host_str() != at.host_str()));
        assert!(o.iter().any(|u| u.as_str() == "https://filecache20.gamebanana.com/mods/vela_503c4.zip"));
        assert!(gb_other_servers(&"https://gamebanana.com/dl/1835701".parse().unwrap()).is_empty());
        assert!(gb_other_servers(&"https://github.com/x/y/releases/download/v1/a.zip".parse().unwrap()).is_empty());
    }

    #[test]
    fn names() {
        assert_eq!(safe_file_name("ArchiveXL-4198-1-28-6.zip"), "ArchiveXL-4198-1-28-6.zip");
        assert_eq!(safe_file_name("a/b:c?.7z"), "a_b_c_.7z");
        assert_eq!(safe_file_name(" . "), "download.bin");
    }
}
