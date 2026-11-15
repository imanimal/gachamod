//! Parts of a mod: the folders inside a mod folder that hold their own .ini files (an archive's several mods
//! installed as one, or a mod split into body, hair and weapon). A part is off when its folder name starts with
//! DISABLED, which 3DMigoto skips, so turning one off leaves the rest of the mod on.

use super::*;

/// One part of a mod, as the drawer lists it.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModPart {
    /// The folder's name right now, with DISABLED when off. The key for `set_part`.
    pub folder: String,
    /// The folder's name without DISABLED.
    pub name: String,
    pub enabled: bool,
    pub ini_count: u32,
    pub size_bytes: u64,
}

/// True when an ini (live or turned off by name) is in `dir` or below it.
fn holds_ini(dir: &Path, depth: u32) -> bool {
    if depth > 8 { return false; }
    let Ok(rd) = fs::read_dir(dir) else { return false };
    let mut kids = Vec::new();
    for e in rd.flatten() {
        let Ok(ft) = e.file_type() else { continue };
        let name = e.file_name().to_string_lossy().into_owned();
        if ft.is_file() && (is_ini(&name) || is_off_ini(&name)) { return true; }
        if ft.is_dir() && !skip_dir(&name) { kids.push(e.path()); }
    }
    kids.iter().any(|k| holds_ini(k, depth + 1))
}

/// The parts of the mod folder `dir`. Empty when there's nothing to choose between: no sub-folder with an ini, or
/// only one and no ini next to it (that one folder is the whole mod).
pub fn parts_in(dir: &Path) -> Vec<ModPart> {
    let Ok(rd) = fs::read_dir(dir) else { return Vec::new() };
    let mut root_ini = false;
    let mut out = Vec::new();
    for e in rd.flatten() {
        let Ok(ft) = e.file_type() else { continue };
        let folder = e.file_name().to_string_lossy().into_owned();
        if ft.is_file() {
            if is_ini(&folder) && !is_disabled_name(&folder) { root_ini = true; }
            continue;
        }
        if !ft.is_dir() || skip_dir(&folder) || !holds_ini(&e.path(), 0) { continue; }
        let f = dir_facts(&e.path());
        let enabled = !is_disabled_name(&folder);
        // a part that is off counts its inis as if it were on, so the list says what turning it on brings
        let inis = if enabled { f.inis } else { ini::mod_inis(&e.path()).len() as u32 };
        out.push(ModPart { name: display_folder(&folder).to_string(), folder, enabled, ini_count: inis, size_bytes: f.size });
    }
    if out.len() < 2 && !(root_ini && out.len() == 1) { return Vec::new(); }
    out.sort_by_key(|p| p.name.to_lowercase());
    out
}

/// The parts of a mod in the library.
pub fn parts(db: &Db, game: &str, id: &str) -> Result<Vec<ModPart>> {
    let e = get(db, game, id)?;
    Ok(parts_in(Path::new(&e.path)))
}

/// Saved options of a part that is off live in `mod_vars` under "<mod id>/<part name>", so they don't mix with the
/// mod's own (those are written back when the mod turns on).
fn part_key(id: &str, name: &str) -> String { format!("{id}/{}", name.to_lowercase()) }

/// Turn one part of a mod on or off by renaming its folder. Returns the mod with its new ini count and size.
pub fn set_part(db: &Db, game: &str, id: &str, folder: &str, on: bool) -> Result<ModEntry> {
    let e = get(db, game, id)?;
    if is_imm_rel(&e.rel_path) { return Err(imm_error()); }
    let cx = ctx(db, game)?;
    let dir = PathBuf::from(&e.path);
    let part = parts_in(&dir).into_iter().find(|p| p.folder == folder)
        .ok_or_else(|| Error::Invalid(format!("{} has no part named \"{}\" anymore. Reopen it to refresh the list", e.name, display_folder(folder))))?;
    if part.enabled == on { return Ok(e); }
    let key = part_key(&e.id, &part.name);
    let rel = |f: &str| format!("{}/{f}", e.rel_path);

    if !on && e.loaded() {
        if let Some(imp) = &cx.importer {
            if let Ok(v) = ini::user_vars(imp, &rel(&part.folder)) { if !v.is_empty() { let _ = keep_vars(db, game, &key, &v, true); } }
        }
    }
    let want = if on { part.name.clone() } else { format!("{DISABLED_PREFIX}{}", part.name) };
    let new = unique_child(&dir, &want);
    rename_dir(&dir.join(&part.folder), &new)?;

    if on && e.loaded() && !cx.running {
        if let (Some(imp), Ok(vals)) = (&cx.importer, kept_vars(db, game, &key)) {
            if !vals.is_empty() && ini::set_user_vars(imp, &rel(&name_of(&new)), &vals).is_ok() {
                let _ = db.conn.execute("DELETE FROM mod_vars WHERE game = ?1 AND mod_id = ?2", params![game, key]);
            }
        }
    }
    let entry = add_folder(db, game, &dir, None)?;
    crate::live::regate(db, game);
    Ok(entry)
}

// ── combining mods into one ──

/// "Coca Cola - Red", "Coca Cola - Blue" -> ("Coca Cola", ["Red", "Blue"]): the longest " - " prefix all names share.
fn split_names(names: &[String]) -> Option<(String, Vec<String>)> {
    let first = names.first()?;
    let cut = first.match_indices(" - ").map(|(i, _)| i)
        .filter(|&i| names.iter().all(|n| n.len() > i + 3 && n.is_char_boundary(i + 3) && n[..i + 3].eq_ignore_ascii_case(&first[..i + 3])))
        .last()?;
    Some((first[..cut].trim().to_string(), names.iter().map(|n| n[cut + 3..].trim().to_string()).collect()))
}

/// Make several mods the parts of one mod: a new folder (next to the first mod that is on) holds each mod's folder,
/// named after it. The whole keeps the first one's id, details and preview, so profiles and links still find it. A
/// part that draws the same thing as an earlier one starts off. Saved options move along.
pub fn merge(db: &Db, game: &str, ids: &[String]) -> Result<ModChange> {
    let mut mods: Vec<ModEntry> = ids.iter().map(|id| get(db, game, id)).collect::<Result<_>>()?;
    if mods.len() < 2 { return Err(Error::Invalid("Pick at least two mods to combine".into())); }
    if mods.iter().any(|m| is_imm_rel(&m.rel_path)) { return Err(imm_error()); }
    if let Some(m) = mods.iter().find(|m| !Path::new(&m.path).is_dir()) {
        return Err(Error::Invalid(format!("{}'s folder is gone. Rescan to refresh the list", m.name)));
    }
    // the first one that is on leads (an archive's main mod), the rest keep their order
    if let Some(i) = mods.iter().position(|m| m.loaded()) { let lead = mods.remove(i); mods.insert(0, lead); }
    let cx = ctx(db, game)?;
    let names: Vec<String> = mods.iter().map(|m| m.name.clone()).collect();
    let (base, part_names) = split_names(&names).unwrap_or_else(|| (mods[0].name.clone(), names.clone()));
    let lead_dir = PathBuf::from(&mods[0].path);
    let lead_sc = read_sidecar(&lead_dir).unwrap_or_default();
    let parent = lead_dir.parent().map(Path::to_path_buf).unwrap_or_else(|| cx.root.clone());
    let top = unique_child(&parent, &crate::install::sanitize_name(&base));
    fs::create_dir_all(&top)?;

    let mut seen: HashSet<String> = HashSet::new();
    let mut vars: Vec<VarValue> = Vec::new();
    let mut parts_off = Vec::new();
    for (m, name) in mods.iter().zip(&part_names) {
        let dir = PathBuf::from(&m.path);
        // options as they are now: from d3dx_user.ini when on, else gachamod's own store
        let mut own = if m.loaded() { cx.importer.as_ref().and_then(|imp| ini::user_vars(imp, &m.rel_path).ok()).unwrap_or_default() } else { Vec::new() };
        own.extend(kept_vars(db, game, &m.id).unwrap_or_default());
        let hashes = ini::quick_facts(&dir).hashes;
        let on = !hashes.iter().any(|h| seen.contains(h));
        if on { seen.extend(hashes); }
        let part = crate::install::sanitize_name(name);
        let want = if on { part.clone() } else { format!("{DISABLED_PREFIX}{part}") };
        let target = unique_child(&top, &want);
        rename_dir(&dir, &target)?;
        let _ = fs::remove_file(target.join(SIDECAR_FILE));
        let folder = name_of(&target);
        if on {
            vars.extend(own.into_iter().map(|v| VarValue { ini: format!("{folder}/{}", v.ini), ..v }));
        } else {
            let key = part_key(&mods[0].id, display_folder(&folder));
            if !own.is_empty() { let _ = keep_vars(db, game, &key, &own, true); }
            parts_off.push(folder.clone());
        }
        // the lead's own picture moves up so the whole shows it
        if m.id == mods[0].id {
            for f in lead_sc.custom_preview.iter().chain(lead_sc.preview.iter().filter(|p| !p.contains("://"))) {
                if target.join(f).is_file() && !top.join(f).exists() { let _ = fs::copy(target.join(f), top.join(f)); }
            }
        }
    }

    let sc = Sidecar { name: base.clone(), variant: None, preview_backups: Vec::new(), ..lead_sc };
    for m in &mods[1..] {
        db.conn.execute("DELETE FROM mods WHERE game = ?1 AND id = ?2", params![game, m.id])?;
        db.conn.execute("DELETE FROM mod_vars WHERE game = ?1 AND mod_id = ?2", params![game, m.id])?;
    }
    db.conn.execute("DELETE FROM mod_vars WHERE game = ?1 AND mod_id = ?2", params![game, mods[0].id])?;
    let entry = add_folder(db, game, &top, Some(sc))?;
    if !vars.is_empty() {
        keep_vars(db, game, &entry.id, &vars, true)?;
        if entry.loaded() && !cx.running { write_kept(db, &cx, &entry); }
    }
    crate::live::regate(db, game);
    let mut change = ModChange { changed: vec![entry], removed: mods[1..].iter().map(|m| m.id.clone()).collect(), notes: Vec::new() };
    change.notes.push(format!("Combined {} mods into {base}", mods.len()));
    if !parts_off.is_empty() {
        change.notes.push(format!("{} of its parts draw the same things as another part, so they're off", parts_off.len()));
    }
    finish(db, game, &change);
    Ok(change)
}

/// Mods an older gachamod installed one per folder from the same archive ("Coca Cola - Red", "Coca Cola - Blue")
/// become the parts of one mod. Runs once per game, from the scan.
pub(crate) fn merge_split_installs(db: &Db, game: &str) {
    let key = format!("{game}.partsMerged");
    if db.setting(&key).ok().flatten().is_some() { return; }
    let _ = db.set_setting(&key, "1");
    let Ok(all) = list(db, game) else { return };
    let mut groups: HashMap<(u64, u64, String), Vec<(String, String)>> = HashMap::new();
    for m in &all {
        let Some(src) = &m.source else { continue };
        let Some(sc) = read_sidecar(Path::new(&m.path)) else { continue };
        if sc.variant.is_none() || is_imm_rel(&m.rel_path) { continue; }
        let k = (src.mod_id, src.file_id.unwrap_or(0), m.group.clone().unwrap_or_default().to_lowercase());
        groups.entry(k).or_default().push((m.id.clone(), m.name.clone()));
    }
    for list in groups.into_values().filter(|l| l.len() > 1) {
        let names: Vec<String> = list.iter().map(|(_, n)| n.clone()).collect();
        if split_names(&names).is_none() { continue; }
        let ids: Vec<String> = list.into_iter().map(|(id, _)| id).collect();
        let _ = merge(db, game, &ids);
    }
}
