//! GameBanana details for a link list's downloads: which file to get (the shared one while GameBanana still has it,
//! else the mod's newest), its size, checksum and pictures. One Mod/Multi call per 50 mods (docs/research.md 2.5).

use crate::queue::QueueRequest;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::time::Duration;

const GB: &str = "https://gamebanana.com/apiv11";

#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct RemoteFile { pub id: u64, pub name: String, pub size: u64, pub md5: Option<String>, pub added: i64, pub archived: bool }

#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct RemoteMod { pub id: u64, pub files: Vec<RemoteFile>, pub thumb: Option<String>, pub image: Option<String> }

fn num(v: &Value) -> Option<u64> { v.as_u64().or_else(|| v.as_str().and_then(|s| s.trim().parse().ok())) }
fn text(v: &Value) -> Option<String> { v.as_str().map(str::trim).filter(|s| !s.is_empty()).map(String::from) }

/// The mods in a Mod/Multi answer (`_idRow`, `_aFiles`, `_aPreviewMedia`). None when it isn't a list (an error).
pub(crate) fn parse_multi(json: &str) -> Option<Vec<RemoteMod>> {
    let Ok(Value::Array(list)) = serde_json::from_str::<Value>(json) else { return None };
    Some(list.iter().filter_map(|m| {
        let id = num(&m["_idRow"])?;
        let files = m["_aFiles"].as_array().map(|fs| fs.iter().filter_map(|f| Some(RemoteFile {
            id: num(&f["_idRow"])?,
            name: text(&f["_sFile"]).unwrap_or_default(),
            size: num(&f["_nFilesize"]).unwrap_or(0),
            md5: text(&f["_sMd5Checksum"]),
            added: num(&f["_tsDateAdded"]).unwrap_or(0) as i64,
            archived: f["_bIsArchived"].as_bool().unwrap_or(false),
        })).collect()).unwrap_or_default();
        let img = &m["_aPreviewMedia"]["_aImages"][0];
        let base = text(&img["_sBaseUrl"]).filter(|b| b.starts_with("https://"));
        let at = |k: &str| base.as_ref().zip(text(&img[k])).map(|(b, f)| format!("{b}/{f}"));
        Some(RemoteMod { id, files, thumb: at("_sFile220").or_else(|| at("_sFile")), image: at("_sFile530").or_else(|| at("_sFile")) })
    }).collect())
}

/// The file to download: the shared one when it is still there (archived files too), else a live file with the same
/// name, the only live file, or the newest live file. The bool is true when it isn't the shared file.
fn pick_file<'a>(m: &'a RemoteMod, file_id: u64, file_name: &str) -> Option<(&'a RemoteFile, bool)> {
    if file_id > 0 { if let Some(f) = m.files.iter().find(|f| f.id == file_id) { return Some((f, false)); } }
    let live: Vec<&RemoteFile> = m.files.iter().filter(|f| !f.archived).collect();
    let pick = live.iter().find(|f| !file_name.is_empty() && f.name.eq_ignore_ascii_case(file_name)).copied()
        .or_else(|| (live.len() == 1).then(|| live[0]))
        .or_else(|| live.iter().max_by_key(|f| (f.added, f.id)).copied())?;
    Some((pick, file_id > 0))
}

/// Fill in the requests from what GameBanana said. `unknown` holds mod ids GameBanana couldn't be asked about
/// (offline): those keep their shared file when they have one. Requests that can't be downloaded are dropped, and the
/// notes say which.
pub(crate) fn apply(reqs: &mut Vec<QueueRequest>, info: &HashMap<u64, RemoteMod>, unknown: &HashSet<u64>) -> Vec<String> {
    let (mut gone, mut offline, mut newer) = (Vec::new(), Vec::new(), 0);
    reqs.retain_mut(|r| {
        let name = r.meta.name.clone().unwrap_or_else(|| format!("mod {}", r.gb_mod_id));
        let Some(m) = info.get(&r.gb_mod_id) else {
            if unknown.contains(&r.gb_mod_id) && r.file_id > 0 { return true; }
            if unknown.contains(&r.gb_mod_id) { offline.push(name); } else { gone.push(name); }
            return false;
        };
        let Some((f, other)) = pick_file(m, r.file_id, &r.file_name) else { gone.push(name); return false };
        if other { newer += 1; }
        r.file_id = f.id;
        r.url = format!("https://gamebanana.com/dl/{}", f.id);
        r.file_name = f.name.clone();
        r.size = f.size;
        r.md5 = f.md5.clone();
        if let Some(src) = r.meta.source.as_mut() {
            src.file_id = Some(f.id);
            src.file_name = Some(f.name.clone());
            if f.added > 0 { src.remote_updated = Some(f.added); }
        }
        if r.thumb.is_none() { r.thumb = m.thumb.clone(); }
        if r.meta.preview_url.is_none() { r.meta.preview_url = m.image.clone(); }
        true
    });
    let list = |v: &[String]| if v.len() > 3 { format!("{} and {} more", v[..3].join(", "), v.len() - 3) } else { v.join(", ") };
    let mut notes = Vec::new();
    if newer > 0 {
        notes.push(if newer == 1 { "1 shared file isn't on GameBanana anymore, so gachamod got the mod's newest file".into() }
            else { format!("{newer} shared files aren't on GameBanana anymore, so gachamod got each mod's newest file") });
    }
    if !gone.is_empty() { notes.push(format!("GameBanana doesn't have {} anymore", list(&gone))); }
    if !offline.is_empty() { notes.push(format!("Couldn't reach GameBanana for {}. Open the file again later to get them", list(&offline))); }
    notes
}

/// Look up every request's mod on GameBanana and fill in the file to download. Returns notes for a toast.
pub async fn resolve(http: &reqwest::Client, reqs: &mut Vec<QueueRequest>) -> Vec<String> {
    let mut ids: Vec<u64> = reqs.iter().map(|r| r.gb_mod_id).filter(|&id| id > 0).collect();
    ids.sort_unstable();
    ids.dedup();
    let mut info = HashMap::new();
    let mut unknown = HashSet::new();
    for chunk in ids.chunks(50) {
        let csv = chunk.iter().map(u64::to_string).collect::<Vec<_>>().join(",");
        let url = format!("{GB}/Mod/Multi?_csvRowIds={csv}&_csvProperties=_idRow,_aFiles,_aPreviewMedia");
        let body = match http.get(&url).timeout(Duration::from_secs(20)).send().await {
            Ok(r) if r.status().is_success() => r.text().await.ok(),
            _ => None,
        };
        match body.as_deref().and_then(parse_multi) {
            Some(list) => for m in list { info.insert(m.id, m); },
            None => unknown.extend(chunk.iter().copied()),
        }
    }
    apply(reqs, &info, &unknown)
}
