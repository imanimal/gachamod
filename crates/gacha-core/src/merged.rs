//! Mods made by merging several mods into one with GIMI's merge script (`genshin_merge_mods.py` by
//! SilentNightSound, also used by SkinSelectImpact setups): finding them, naming each swap value after the variant
//! it shows, and splitting one back into separate mods. Owner: MODTOOLS area (docs/spec.md, "Mod internals").
//!
//! What the script leaves: `merged.ini` (any name with `-n`) whose first line is `; Merged Mod: <ini>, <ini>...` in
//! swap order and whose last lines name the merger script, `global persist $swapvar = 0`, a `[KeySwap]` that cycles
//! `$swapvar = 0,1,2...`, every resource renamed `[Resource<name>.<n>]` and pointed into variant n's folder, and each
//! original ini renamed `DISABLED<name>.ini` (no separator). With `-c` it deleted every file that was byte for byte
//! one it had already seen and pointed the resource at that first copy, which can be in another variant's folder.

use crate::backups::Backup;
use crate::db::{Db, Shared};
use crate::error::{Error, Result};
use crate::ini::{self, Ini};
use crate::library;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MergedVariant {
    /// The swap value that shows it ("0" is the one the mod starts with).
    pub value: String,
    /// Its folder's name, or its ini's name when it sits in the mod's main folder ("Raiden Kimono").
    pub name: String,
    /// Its ini inside the mod folder as it is now ("Raiden Kimono/DISABLEDRaidenKimono.ini"); None when it's gone.
    pub ini: Option<String>,
}

/// A merged mod, as the mod's details show it.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MergedInfo {
    /// The merged ini inside the mod folder ("merged.ini").
    pub ini: String,
    /// The variable the swap key cycles, without `$` ("swapvar").
    pub var: String,
    pub variants: Vec<MergedVariant>,
    /// Files a split copies into a variant's folder because the merge (`-c`) kept one copy for several variants.
    pub copy_files: u32,
    pub copy_bytes: u64,
    /// Why it can't be split, when it can't.
    pub blocked: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitResult {
    /// Restoring it puts the merged mod back (the library needs a rescan after).
    pub backup: Backup,
    /// The new mods' names, in swap order.
    pub mods: Vec<String>,
    /// The one left on: the variant the swap key showed last, when the merged mod was on.
    pub on: Option<String>,
    pub copied_files: u32,
    pub copied_bytes: u64,
}

/// One variant as found on disk.
#[derive(Debug, Clone)]
struct Found {
    /// Its ini (DISABLED or not) and the folder it is in.
    ini: Option<PathBuf>,
    folder: Option<PathBuf>,
}

/// A file the split copies: from the copy the merge kept, to where the variant's own ini looks for it.
#[derive(Debug, Clone)]
struct Copy { from: PathBuf, to: PathBuf, bytes: u64 }

#[derive(Debug)]
struct Plan { info: MergedInfo, merged: PathBuf, found: Vec<Found>, copies: Vec<Copy>, default: String }

// ── finding one ──

/// True when the text is an ini the merge script wrote: its header, or (when someone took the header out) the
/// footer that names the script.
fn is_merged_text(text: &str) -> bool {
    let first = text.trim_start_matches('\u{feff}').lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("");
    first.to_ascii_lowercase().starts_with("; merged mod:")
        || text.lines().rev().take(12).any(|l| { let l = l.trim().to_ascii_lowercase(); l.starts_with(';') && l.contains("mod merger script") })
}

/// The inis named in the header, in swap order. Names may hold commas, so the list splits after ".ini".
fn listed_inis(text: &str) -> Vec<String> {
    let Some(line) = text.trim_start_matches('\u{feff}').lines().map(str::trim).find(|l| !l.is_empty()) else { return Vec::new() };
    let lower = line.to_ascii_lowercase();
    let Some(rest_at) = lower.find("merged mod:").map(|i| i + "merged mod:".len()) else { return Vec::new() };
    let (line, lower) = (&line[rest_at..], &lower[rest_at..]);
    let mut out = Vec::new();
    let (mut start, mut from) = (0, 0);
    while let Some(pos) = lower[from..].find(".ini") {
        let end = from + pos + 4;
        let next = line[end..].trim_start();
        if next.is_empty() || next.starts_with(',') {
            let item = line[start..end].trim();
            if !item.is_empty() { out.push(item.to_string()); }
            start = line.len() - next.len() + usize::from(!next.is_empty());
            from = start;
            if next.is_empty() { break; }
        } else {
            from = end;
        }
    }
    out
}

/// A file name without a turned-off mark: "DISABLEDRaiden.ini" and "Raiden.ini.disabled" -> "Raiden.ini".
fn live_name(name: &str) -> &str {
    let l = name.to_ascii_lowercase();
    let n = if l.ends_with(".disabled") { &name[..name.len() - 9] } else if l.ends_with(".disable") { &name[..name.len() - 8] } else { name };
    library::display_folder(n)
}

/// The ini `file` in `folder`, on or turned off.
fn ini_in(folder: &Path, file: &str) -> Option<PathBuf> {
    let mut hits: Vec<PathBuf> = std::fs::read_dir(folder).ok()?.flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .filter(|e| live_name(&e.file_name().to_string_lossy()).eq_ignore_ascii_case(file))
        .map(|e| e.path()).collect();
    // the script's own DISABLED<name> first, then any other turned-off copy, then a live one (merged with -s)
    hits.sort_by_key(|p| {
        let n = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        (!n.starts_with("DISABLED") || n.len() != file.len() + 8, n.eq_ignore_ascii_case(file))
    });
    hits.into_iter().next()
}

/// Where a listed ini is now. The script lists paths from where it ran (".\Raiden Kimono\RaidenKimono.ini"), or
/// full paths when it ran with `-r`: shorter and shorter tails are tried from the merged ini's folder.
fn locate(base: &Path, dir: &Path, listed: &str) -> Option<PathBuf> {
    let parts: Vec<&str> = listed.split(['\\', '/']).filter(|p| !p.is_empty() && *p != ".").collect();
    for skip in 0..parts.len() {
        let (file, dirs) = parts[skip..].split_last()?;
        if dirs.iter().any(|d| d.contains(':')) { continue; }
        let folder = if dirs.is_empty() { Some(base.to_path_buf()) } else { ini::find_ci(base, &dirs.join("/")) };
        let Some(folder) = folder.filter(|f| f.is_dir() && ini::lexical(f).starts_with(dir)) else { continue };
        if let Some(f) = ini_in(&folder, file) { return Some(f); }
    }
    None
}

/// The variable the swap key cycles: the first `$var = 0,1,...` in a `[KeySwap*]` section, else "swapvar".
fn swap_var(ini: &Ini) -> String {
    ini.sections.iter().filter(|s| s.lower.starts_with("keyswap")).chain(ini.sections.iter().filter(|s| s.lower.starts_with("key")))
        .flat_map(|s| &s.lines)
        .find_map(|l| l.lkey.strip_prefix('$').filter(|v| !v.is_empty() && !v.contains(['\\', ' '])).filter(|_| l.value.as_deref().is_some_and(|v| v.contains(','))))
        .map(String::from).unwrap_or_else(|| "swapvar".into())
}

/// Its start value from `[Constants]` (`global persist $swapvar = 0`).
fn start_value(ini: &Ini, var: &str) -> String {
    ini.sections.iter().filter(|s| s.lower == "constants").flat_map(|s| &s.lines)
        .find(|l| l.lkey.split_whitespace().last().is_some_and(|t| t.strip_prefix('$').is_some_and(|n| n.eq_ignore_ascii_case(var))))
        .and_then(|l| l.value.as_deref()).map(ini::norm_value).unwrap_or_else(|| "0".into())
}

/// Folders the merged ini's `[Resource<name>.<n>]` sections point into, per n. Used when the header is gone.
fn folders_from_resources(ini: &Ini, base: &Path) -> Vec<(usize, PathBuf)> {
    let mut out: Vec<(usize, PathBuf)> = Vec::new();
    for s in ini.sections.iter().filter(|s| s.lower.starts_with("resource")) {
        let Some(n) = s.lower.rsplit_once('.').and_then(|(_, n)| n.parse::<usize>().ok()) else { continue };
        if out.iter().any(|(i, _)| *i == n) { continue; }
        let Some(f) = s.first("filename") else { continue };
        let f = f.trim().trim_matches('"').replace('\\', "/");
        let Some((folder, _)) = f.rsplit_once('/') else { continue };
        if let Some(p) = ini::find_ci(base, folder) { out.push((n, p)); }
    }
    out.sort_by_key(|(n, _)| *n);
    out
}

/// A readable name for each variant: its folder, the folder path when two share a name, its ini at the top.
fn variant_names(dir: &Path, found: &[Found], listed: &[String]) -> Vec<String> {
    let simple = |i: usize| -> String {
        let f = &found[i];
        match (&f.folder, &f.ini) {
            (Some(folder), _) if folder != dir => library::display_folder(&folder.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()).to_string(),
            (_, Some(ini)) => stem(&ini.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()),
            _ => stem(listed.get(i).map(|l| l.rsplit(['\\', '/']).next().unwrap_or(l)).unwrap_or("")),
        }
    };
    let mut names: Vec<String> = (0..found.len()).map(simple).collect();
    for i in 0..names.len() {
        if names.iter().filter(|n| n.eq_ignore_ascii_case(&names[i])).count() < 2 { continue; }
        if let Some(rel) = found[i].folder.as_ref().and_then(|f| f.strip_prefix(dir).ok()).filter(|r| r.components().count() > 1) {
            names[i] = rel.components().map(|c| library::display_folder(&c.as_os_str().to_string_lossy()).to_string()).collect::<Vec<_>>().join(" / ");
        }
    }
    for i in 0..names.len() {
        if names.iter().filter(|n| n.eq_ignore_ascii_case(&names[i])).count() < 2 { continue; }
        if let Some(ini) = &found[i].ini { names[i] = format!("{} ({})", names[i], stem(&ini.file_name().unwrap_or_default().to_string_lossy())); }
    }
    for (i, n) in names.iter_mut().enumerate() { if n.trim().is_empty() { *n = format!("Variant {}", i + 1); } }
    names
}

/// "DISABLEDRaidenKimono.ini" -> "RaidenKimono".
fn stem(file: &str) -> String {
    let n = live_name(file);
    n.get(..n.len().saturating_sub(4)).filter(|_| n.to_ascii_lowercase().ends_with(".ini")).unwrap_or(n).to_string()
}

fn rel_of(dir: &Path, p: &Path) -> String {
    p.strip_prefix(dir).map(|r| r.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/")).unwrap_or_default()
}

/// Files variant `n` needs that the merge (`-c`) left only in another variant's folder. Err when one is gone.
fn shared_files(dir: &Path, merged: &Ini, base: &Path, n: usize, ini_path: &Path, name: &str) -> std::result::Result<Vec<Copy>, String> {
    let Ok(text) = ini::read_text(ini_path, ini::FULL_MAX) else { return Ok(Vec::new()) };
    let own = ini::parse(&text);
    let folder = ini_path.parent().unwrap_or(dir);
    let mut out: Vec<Copy> = Vec::new();
    for s in own.sections.iter().filter(|s| s.lower.starts_with("resource")) {
        for f in s.get("filename").map(|f| f.trim().trim_matches('"')).filter(|f| !f.is_empty() && !Path::new(f).is_absolute()) {
            if ini::find_ci(folder, f).is_some() { continue; }
            // where the merged ini points this variant's copy of the resource
            let want = format!("{}.{n}", s.lower);
            let Some(theirs) = merged.sections.iter().find(|m| m.lower == want).and_then(|m| m.first("filename")) else { continue };
            let theirs = theirs.trim().trim_matches('"');
            let to = ini::lexical(&folder.join(f.replace('\\', "/")));
            let same = |p: &Path| ini::lexical(p).to_string_lossy().eq_ignore_ascii_case(&to.to_string_lossy());
            match ini::find_ci(base, theirs) {
                Some(from) if !same(&from) => {
                    if !to.starts_with(dir) { return Err(format!("{name} looks for {f} outside the mod folder, so it can't stand alone")); }
                    if !out.iter().any(|c| c.to == to) {
                        let bytes = std::fs::metadata(&from).map(|m| m.len()).unwrap_or(0);
                        out.push(Copy { from, to, bytes });
                    }
                }
                Some(_) => {}
                // the author never shipped it, or someone removed it; lint says so, the split doesn't care
                None if same(&base.join(theirs.replace('\\', "/"))) => {}
                None => return Err(format!("{name} needs {}, which the merge kept only in another variant's folder, and that copy is gone too", f.replace('\\', "/"))),
            }
        }
    }
    Ok(out)
}

/// The merged ini of a mod folder, when it has one: (path, text).
fn find_merged(dir: &Path) -> Option<(PathBuf, String, String)> {
    ini::mod_inis(dir).into_iter().find_map(|(abs, rel)| {
        let text = ini::read_text(&abs, ini::FULL_MAX).ok()?;
        is_merged_text(&text).then_some((abs, rel, text))
    })
}

fn plan(dir: &Path) -> Option<Plan> {
    let (merged_abs, merged_rel, text) = find_merged(dir)?;
    let base = merged_abs.parent().unwrap_or(dir).to_path_buf();
    let parsed = ini::parse(&text);
    let var = swap_var(&parsed);
    let listed = listed_inis(&text);
    let found: Vec<Found> = if listed.is_empty() {
        folders_from_resources(&parsed, &base).into_iter().map(|(_, folder)| {
            let ini = std::fs::read_dir(&folder).ok().into_iter().flatten().flatten().map(|e| e.path())
                .find(|p| p.is_file() && live_name(&p.file_name().unwrap_or_default().to_string_lossy()).to_ascii_lowercase().ends_with(".ini") && p != &merged_abs);
            Found { ini, folder: Some(folder) }
        }).collect()
    } else {
        listed.iter().map(|l| {
            let ini = locate(&base, dir, l);
            Found { folder: ini.as_ref().and_then(|p| p.parent()).map(Path::to_path_buf), ini }
        }).collect()
    };
    if found.is_empty() { return None; }
    let names = variant_names(dir, &found, &listed);
    let variants: Vec<MergedVariant> = found.iter().zip(&names).enumerate().map(|(i, (f, name))| MergedVariant {
        value: i.to_string(), name: name.clone(), ini: f.ini.as_ref().map(|p| rel_of(dir, p)),
    }).collect();

    let mut blocked: Option<String> = None;
    let mut copies: Vec<Copy> = Vec::new();
    let block = |b: &mut Option<String>, why: String| { if b.is_none() { *b = Some(why); } };
    for (i, f) in found.iter().enumerate() {
        let name = &names[i];
        let (Some(ini_path), Some(folder)) = (&f.ini, &f.folder) else {
            let what = listed.get(i).cloned().unwrap_or_else(|| name.clone());
            block(&mut blocked, format!("gachamod can't find {what}, one of the mods that went into the merge, so it can't split it"));
            continue;
        };
        if folder == dir || *folder == base {
            block(&mut blocked, format!("{name} sits in the mod's main folder, so it can't be a mod of its own"));
            continue;
        }
        for (j, other) in found.iter().enumerate().skip(i + 1) {
            let Some(of) = &other.folder else { continue };
            if of.starts_with(folder) || folder.starts_with(of) {
                block(&mut blocked, format!("{name} and {} share a folder, so they can't be separate mods", names[j]));
            }
        }
        match shared_files(dir, &parsed, &base, i, ini_path, name) {
            Ok(c) => for c in c { if !copies.iter().any(|x| x.to == c.to) { copies.push(c); } },
            Err(why) => block(&mut blocked, why),
        }
    }
    // an ini that isn't the merged one and isn't inside a variant's folder would stay behind on its own
    let folders: Vec<&PathBuf> = found.iter().filter_map(|f| f.folder.as_ref()).collect();
    if let Some((_, rel)) = ini::mod_inis(dir).into_iter().find(|(abs, _)| *abs != merged_abs && !folders.iter().any(|f| abs.starts_with(f))) {
        block(&mut blocked, format!("{rel} isn't one of the merged mods, so gachamod leaves this mod as it is"));
    }
    let info = MergedInfo {
        ini: merged_rel, var: var.clone(), variants,
        copy_files: copies.len() as u32, copy_bytes: copies.iter().map(|c| c.bytes).sum(), blocked,
    };
    Some(Plan { default: start_value(&parsed, &var), info, merged: merged_abs, found, copies })
}

/// The merged mod in a folder, with names for its swap values and whether it can be split.
pub fn info(dir: &Path) -> Option<MergedInfo> { plan(dir).map(|p| p.info) }

// ── splitting ──

/// Rename `from` to `to`, refusing to overwrite.
fn rename(from: &Path, to: &Path) -> Result<()> {
    if to.exists() { return Err(Error::Invalid(format!("{} is already there. Check the mod's folder", to.file_name().unwrap_or_default().to_string_lossy()))); }
    std::fs::rename(from, to)?;
    Ok(())
}

/// What the split changes, worked out before anything moves: (renames, sidecars to write, the chosen variant).
struct Steps { renames: Vec<(PathBuf, PathBuf)>, chosen: usize }

fn steps(p: &Plan, current: &str) -> Steps {
    let chosen = p.info.variants.iter().position(|v| v.value == current).unwrap_or(0);
    let mut renames = Vec::new();
    for (i, f) in p.found.iter().enumerate() {
        let (Some(ini), Some(folder)) = (&f.ini, &f.folder) else { continue };
        let name = ini.file_name().unwrap_or_default().to_string_lossy().into_owned();
        let live = live_name(&name).to_string();
        if i == chosen {
            if name != live { renames.push((ini.clone(), folder.join(&live))); }
        } else if name == live {
            // merged with -s: the original stayed on; the split leaves only one variant on
            renames.push((ini.clone(), folder.join(format!("DISABLED_{live}"))));
        }
    }
    Steps { renames, chosen }
}

/// Make the files of a merged mod into separate mods: each variant's folder gets its ini back and a sidecar, so
/// the library lists it as a mod of its own; the variant the swap key showed stays on and the rest are off; files
/// the merge shared between variants (`-c`) are copied into each variant that needs them; the merged ini and the
/// mod's sidecar go. The variant that stays on keeps the mod's id, so profiles and favourites follow it. Everything
/// is in one backup whose restore puts the merged mod back.
pub fn split(db: &Shared, game: &str, id: &str) -> Result<SplitResult> {
    let result = {
        let db = db.lock().unwrap_or_else(|e| e.into_inner());
        split_locked(&db, game, id)?
    };
    match library::scan(db, game) {
        Ok(_) | Err(Error::Todo(_)) => {}
        Err(e) => return Err(Error::Invalid(format!("The mod was split, but the rescan failed: {e}"))),
    }
    Ok(result)
}

fn split_locked(db: &Db, game: &str, id: &str) -> Result<SplitResult> {
    let m = library::get(db, game, id)?;
    let dir = PathBuf::from(&m.path);
    if !dir.is_dir() { return Err(Error::Invalid(format!("{}'s folder isn't there any more. Rescan to update the list", m.name))); }
    let p = plan(&dir).ok_or_else(|| Error::Invalid(format!("{} isn't a merged mod", m.name)))?;
    if let Some(why) = &p.info.blocked { return Err(Error::Invalid(why.clone())); }
    let mut saved = library::saved_vars(db, game, id).unwrap_or_default();
    if saved.is_empty() && m.loaded() {
        if let Ok(imp) = crate::games::importer_dir(db, game) { saved = ini::user_vars(&imp, &m.rel_path).unwrap_or_default(); }
    }
    let current = saved.iter().find(|v| v.ini.eq_ignore_ascii_case(&p.info.ini) && v.var.eq_ignore_ascii_case(&p.info.var))
        .map(|v| ini::norm_value(&v.value)).unwrap_or_else(|| p.default.clone());
    split_with(db, game, &m, &dir, &current)
}

/// The split itself, with the swap value the mod shows now.
fn split_with(db: &Db, game: &str, m: &crate::model::ModEntry, dir: &Path, current: &str) -> Result<SplitResult> {
    let dir = dir.to_path_buf();
    let p = plan(&dir).ok_or_else(|| Error::Invalid(format!("{} isn't a merged mod", m.name)))?;
    if let Some(why) = &p.info.blocked { return Err(Error::Invalid(why.clone())); }
    let s = steps(&p, current);
    for (_, to) in &s.renames {
        if to.exists() { return Err(Error::Invalid(format!("{} is already there. Check the mod's folder", rel_of(&dir, to)))); }
    }

    let base = library::read_sidecar(&dir).unwrap_or_else(|| crate::model::Sidecar {
        id: m.id.clone(), name: m.name.clone(), character: m.character.clone(), source: m.source.clone(),
        version: m.version.clone(), installed_at: m.installed_at, tags: m.tags.clone(), nsfw: m.nsfw, ..Default::default()
    });
    let mut sidecars: Vec<(PathBuf, crate::model::Sidecar)> = Vec::new();
    for (i, (f, v)) in p.found.iter().zip(&p.info.variants).enumerate() {
        let Some(folder) = &f.folder else { continue };
        let mut sc = crate::model::Sidecar {
            name: v.name.clone(), preview: None, custom_preview: None, preview_backups: Vec::new(), variant: None, parent: None,
            off_with_parent: false, ..base.clone()
        };
        if i != s.chosen { sc.id = library::new_id(); sc.favorite = false; sc.notes = None; }
        if sc.character.is_none() {
            // GIMI names a mod's ini after the character ("DISABLEDRaidenShogun.ini")
            let ini_stem = f.ini.as_ref().map(|p| stem(&p.file_name().unwrap_or_default().to_string_lossy())).unwrap_or_default();
            sc.character = library::infer_character(db, game, &[&ini_stem, &v.name]);
        }
        sidecars.push((folder.clone(), sc));
    }

    let side = crate::model::SIDECAR_FILE;
    let mut files: Vec<String> = vec![rel_of(&dir, &p.merged), side.to_string()];
    for (from, to) in &s.renames { files.push(rel_of(&dir, from)); files.push(rel_of(&dir, to)); }
    for (folder, _) in &sidecars { files.push(format!("{}/{side}", rel_of(&dir, folder))); }
    for c in &p.copies { files.push(rel_of(&dir, &c.to)); }
    files.dedup();
    let label = format!("Split {} into {} mods", m.name, p.info.variants.len());
    let backup = crate::backups::take(db, game, &format!("{}-split", m.id), &dir, &files, &label)?;

    for c in &p.copies {
        if let Some(parent) = c.to.parent() { std::fs::create_dir_all(parent)?; }
        std::fs::copy(&c.from, &c.to)?;
    }
    for (from, to) in &s.renames { rename(from, to)?; }
    for (folder, sc) in &sidecars { library::write_sidecar(folder, sc)?; }
    let own = dir.join(side);
    if own.is_file() { std::fs::remove_file(own)?; }
    // the backup holds the merged ini, so Undo brings it back
    std::fs::remove_file(&p.merged)?;
    if m.loaded() { crate::devtools::mark_changed(game); }

    Ok(SplitResult {
        backup,
        mods: p.info.variants.iter().map(|v| v.name.clone()).collect(),
        on: m.enabled.then(|| p.info.variants[s.chosen].name.clone()),
        copied_files: p.copies.len() as u32,
        copied_bytes: p.copies.iter().map(|c| c.bytes).sum(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("gachamod-merged-{name}-{}", library::new_id()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn write(p: &Path, text: &str) {
        if let Some(d) = p.parent() { fs::create_dir_all(d).unwrap(); }
        fs::write(p, text).unwrap();
    }

    const BODY: &str = "[TextureOverrideBody]\nhash = 11112222\nmatch_first_index = 0\nib = ResourceBodyIB\nps-t0 = ResourceBodyDiffuse\n\
        [ResourceBodyIB]\ntype = Buffer\nformat = DXGI_FORMAT_R32_UINT\nfilename = Body.ib\n[ResourceBodyDiffuse]\nfilename = BodyDiffuse.dds\n";

    /// A mod as the script leaves it: three variants, `-c` when `compress` (Kimono's diffuse is the same file as
    /// Regular's, deleted and pointed at Regular's copy).
    fn merged_mod(dir: &Path, compress: bool, merged_name: &str) {
        for (folder, ini) in [("Raiden Regular", "Raiden.ini"), ("Raiden Kimono", "RaidenKimono.ini"), ("Raiden Bikini", "Raiden.ini")] {
            write(&dir.join(folder).join(format!("DISABLED{ini}")), BODY);
            write(&dir.join(folder).join("Body.ib"), folder);
            if !(compress && folder == "Raiden Kimono") { write(&dir.join(folder).join("BodyDiffuse.dds"), "same bytes"); }
        }
        let kimono_diffuse = if compress { ".\\Raiden Regular\\BodyDiffuse.dds" } else { ".\\Raiden Kimono\\BodyDiffuse.dds" };
        let text = format!("; Merged Mod: .\\Raiden Regular\\Raiden.ini, .\\Raiden Kimono\\RaidenKimono.ini, .\\Raiden Bikini\\Raiden.ini\n\n\
            ; Constants ---------------------------\n\n[Constants]\nglobal persist $swapvar = 0\nglobal $active\nglobal $creditinfo = 0\n\n\
            [KeySwap]\ncondition = $active == 1\nkey = 5\ntype = cycle\n$swapvar = 0,1,2\n$creditinfo = 0\n\n[Present]\npost $active = 0\n\n\
            [TextureOverrideBody]\nhash = 11112222\nmatch_first_index = 0\nrun = CommandListBody\n\n\
            [CommandListBody]\nif $swapvar == 0\n\tib = ResourceBodyIB.0\nelse if $swapvar == 1\n\tib = ResourceBodyIB.1\nelse if $swapvar == 2\n\tib = ResourceBodyIB.2\nendif\n\n\
            [ResourceBodyIB.0]\nfilename = .\\Raiden Regular\\Body.ib\n[ResourceBodyDiffuse.0]\nfilename = .\\Raiden Regular\\BodyDiffuse.dds\n\
            [ResourceBodyIB.1]\nfilename = .\\Raiden Kimono\\Body.ib\n[ResourceBodyDiffuse.1]\nfilename = {kimono_diffuse}\n\
            [ResourceBodyIB.2]\nfilename = .\\Raiden Bikini\\Body.ib\n[ResourceBodyDiffuse.2]\nfilename = .\\Raiden Bikini\\BodyDiffuse.dds\n\n\n\
            ; .ini generated by GIMI (Genshin-Impact-Model-Importer) mod merger script\n\
            ; If you have any issues or find any bugs, please open a ticket at https://github.com/SilentNightSound/GI-Model-Importer/issues");
        write(&dir.join(merged_name), &text);
    }

    #[test]
    fn reads_the_header() {
        assert_eq!(listed_inis("; Merged Mod: .\\A\\a.ini, .\\B, C\\b.INI, .\\c.ini"), vec![".\\A\\a.ini", ".\\B, C\\b.INI", ".\\c.ini"]);
        assert_eq!(listed_inis("; Merged Mod: C:\\Mods\\X\\x.ini"), vec!["C:\\Mods\\X\\x.ini"]);
        assert!(listed_inis("[Constants]").is_empty());
        assert!(is_merged_text("\u{feff}; Merged Mod: .\\a\\a.ini\n[Constants]"));
        assert!(is_merged_text("[Constants]\n; .ini generated by GIMI (Genshin-Impact-Model-Importer) mod merger script\n"));
        assert!(!is_merged_text("; a mod\n[Constants]\nglobal persist $swapvar = 0\n"));
        assert_eq!(live_name("DISABLEDRaiden.ini"), "Raiden.ini");
        assert_eq!(live_name("DISABLED_Raiden.ini"), "Raiden.ini");
        assert_eq!(live_name("Raiden.ini.disabled"), "Raiden.ini");
        assert_eq!(stem("DISABLEDRaidenShogun.ini"), "RaidenShogun");
    }

    #[test]
    fn names_each_swap_value() {
        let d = temp("names");
        merged_mod(&d, false, "merged.ini");
        let info = info(&d).expect("a merged mod");
        assert_eq!(info.ini, "merged.ini");
        assert_eq!(info.var, "swapvar");
        let names: Vec<(&str, &str)> = info.variants.iter().map(|v| (v.value.as_str(), v.name.as_str())).collect();
        assert_eq!(names, vec![("0", "Raiden Regular"), ("1", "Raiden Kimono"), ("2", "Raiden Bikini")]);
        assert_eq!(info.variants[1].ini.as_deref(), Some("Raiden Kimono/DISABLEDRaidenKimono.ini"));
        assert_eq!(info.blocked, None);
        assert_eq!(info.copy_files, 0);
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn finds_a_renamed_merge_and_one_without_its_header() {
        let d = temp("renamed");
        merged_mod(&d, false, "RaidenToggle.ini");
        assert_eq!(info(&d).unwrap().ini, "RaidenToggle.ini");
        // header taken out: the footer still says what it is, and the resources say where the variants are
        let text = fs::read_to_string(d.join("RaidenToggle.ini")).unwrap();
        fs::write(d.join("RaidenToggle.ini"), text.split_once('\n').unwrap().1).unwrap();
        let info = info(&d).unwrap();
        assert_eq!(info.variants.iter().map(|v| v.name.as_str()).collect::<Vec<_>>(), vec!["Raiden Regular", "Raiden Kimono", "Raiden Bikini"]);
        assert_eq!(info.blocked, None);
        // a mod that isn't a merge
        let plain = temp("plain");
        write(&plain.join("mod.ini"), BODY);
        assert!(super::info(&plain).is_none());
        let _ = fs::remove_dir_all(&d);
        let _ = fs::remove_dir_all(&plain);
    }

    #[test]
    fn a_compressed_merge_copies_shared_files() {
        let d = temp("compress");
        merged_mod(&d, true, "merged.ini");
        let p = plan(&d).unwrap();
        assert_eq!(p.info.blocked, None);
        assert_eq!(p.info.copy_files, 1);
        assert_eq!(p.info.copy_bytes, "same bytes".len() as u64);
        assert_eq!(p.copies[0].to, d.join("Raiden Kimono").join("BodyDiffuse.dds"));
        // the copy the merge kept is gone too: nothing to copy from, so no split
        fs::remove_file(d.join("Raiden Regular").join("BodyDiffuse.dds")).unwrap();
        let blocked = info(&d).unwrap().blocked.unwrap();
        assert!(blocked.starts_with("Raiden Kimono needs BodyDiffuse.dds, which the merge kept only in another variant's folder"), "{blocked}");
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn refuses_what_it_cant_split() {
        let d = temp("refuse");
        merged_mod(&d, false, "merged.ini");
        write(&d.join("extra.ini"), BODY);
        assert_eq!(info(&d).unwrap().blocked.as_deref(), Some("extra.ini isn't one of the merged mods, so gachamod leaves this mod as it is"));
        fs::remove_file(d.join("extra.ini")).unwrap();
        fs::remove_file(d.join("Raiden Bikini").join("DISABLEDRaiden.ini")).unwrap();
        let why = info(&d).unwrap().blocked.unwrap();
        assert!(why.contains("can't find .\\Raiden Bikini\\Raiden.ini"), "{why}");
        // a variant in the main folder can't be a mod of its own
        let r = temp("root");
        write(&r.join("DISABLEDA.ini"), BODY);
        write(&r.join("B").join("DISABLEDB.ini"), BODY);
        write(&r.join("merged.ini"), "; Merged Mod: .\\A.ini, .\\B\\B.ini\n[Constants]\nglobal persist $swapvar = 0\n");
        assert_eq!(info(&r).unwrap().blocked.as_deref(), Some("A sits in the mod's main folder, so it can't be a mod of its own"));
        let _ = fs::remove_dir_all(&d);
        let _ = fs::remove_dir_all(&r);
    }

    #[test]
    fn split_steps_leave_one_variant_on() {
        let d = temp("steps");
        merged_mod(&d, false, "merged.ini");
        let p = plan(&d).unwrap();
        assert_eq!(p.default, "0");
        let s = steps(&p, "1");
        assert_eq!(s.chosen, 1);
        assert_eq!(s.renames, vec![(d.join("Raiden Kimono").join("DISABLEDRaidenKimono.ini"), d.join("Raiden Kimono").join("RaidenKimono.ini"))]);
        // merged with -s: the originals stayed on, so the others are turned off
        fs::rename(d.join("Raiden Regular").join("DISABLEDRaiden.ini"), d.join("Raiden Regular").join("Raiden.ini")).unwrap();
        let s = steps(&plan(&d).unwrap(), "1");
        assert!(s.renames.contains(&(d.join("Raiden Regular").join("Raiden.ini"), d.join("Raiden Regular").join("DISABLED_Raiden.ini"))));
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn splits_with_a_backup_that_undoes_it() {
        let data = temp("split-data");
        let db = Db::open(&data.join("gachamod.sqlite")).unwrap();
        let mods = temp("split-mods");
        let dir = mods.join("Raiden Merged");
        merged_mod(&dir, true, "merged.ini");
        let side = crate::model::Sidecar { id: library::new_id(), name: "Raiden Merged".into(), favorite: true, ..Default::default() };
        library::write_sidecar(&dir, &side).unwrap();
        let entry = crate::model::ModEntry { id: side.id.clone(), name: side.name.clone(), path: dir.to_string_lossy().into_owned(), ..Default::default() };
        let r = split_with(&db, "gi", &entry, &dir, "2").unwrap();
        assert_eq!(r.mods, vec!["Raiden Regular", "Raiden Kimono", "Raiden Bikini"]);
        assert_eq!(r.copied_files, 1);
        assert!(!dir.join("merged.ini").exists());
        assert!(!dir.join(crate::model::SIDECAR_FILE).exists());
        assert!(dir.join("Raiden Bikini").join("Raiden.ini").is_file());
        assert!(dir.join("Raiden Kimono").join("DISABLEDRaidenKimono.ini").is_file());
        assert!(dir.join("Raiden Kimono").join("BodyDiffuse.dds").is_file());
        // the one left on keeps the mod's id; the others are new mods
        assert_eq!(library::read_sidecar(&dir.join("Raiden Bikini")).unwrap().id, side.id);
        let kimono = library::read_sidecar(&dir.join("Raiden Kimono")).unwrap();
        assert_ne!(kimono.id, side.id);
        assert_eq!(kimono.name, "Raiden Kimono");
        assert!(!kimono.favorite);
        // Undo
        crate::backups::restore(&db, &r.backup.id).unwrap();
        assert!(dir.join("merged.ini").is_file());
        assert_eq!(library::read_sidecar(&dir).unwrap().id, side.id);
        assert!(dir.join("Raiden Bikini").join("DISABLEDRaiden.ini").is_file());
        assert!(!dir.join("Raiden Bikini").join("Raiden.ini").exists());
        assert!(!dir.join("Raiden Kimono").join("BodyDiffuse.dds").exists());
        assert!(!dir.join("Raiden Kimono").join(crate::model::SIDECAR_FILE).exists());
        assert!(info(&dir).is_some_and(|i| i.blocked.is_none()));
        drop(db);
        let _ = fs::remove_dir_all(&mods);
        let _ = fs::remove_dir_all(&data);
    }

    #[test]
    fn the_library_lists_the_split_mods() {
        let root = temp("split-library");
        let mods = root.join("Mods");
        let dir = mods.join("Raiden Shogun").join("Raiden Merged");
        merged_mod(&dir, false, "merged.ini");
        let db = Db::open(&root.join("gachamod.db")).unwrap();
        crate::games::save_paths(&db, "gi", &crate::games::GamePaths { mods_dir: Some(mods.to_string_lossy().into_owned()), ..Default::default() }).unwrap();
        let shared: Shared = std::sync::Arc::new(std::sync::Mutex::new(db));
        let before = library::scan(&shared, "gi").unwrap();
        assert_eq!(before.len(), 1);
        let r = split(&shared, "gi", &before[0].id).unwrap();
        assert_eq!(r.on.as_deref(), Some("Raiden Regular"));
        let mut after = library::list(&shared.lock().unwrap(), "gi").unwrap();
        after.sort_by_key(|m| m.name.clone());
        let rows: Vec<(&str, bool)> = after.iter().map(|m| (m.name.as_str(), m.enabled)).collect();
        assert_eq!(rows, vec![("Raiden Bikini", false), ("Raiden Kimono", false), ("Raiden Regular", true)]);
        assert!(after.iter().any(|m| m.id == before[0].id && m.name == "Raiden Regular"), "the one left on keeps the id");
        drop(shared);
        let _ = fs::remove_dir_all(&root);
    }
}
