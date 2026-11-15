//! Mod internals, .gachamod and IMM commands. Owner: MODTOOLS area.
use crate::runner::{emit_snapshot, lk, persist};
use crate::state::{blocking, AppState};
use gacha_core::imm::{self, ImmInfo};
use gacha_core::mesh::{self, ModMesh};
use gacha_core::keys::{self, DrawRef, IniOutline, KeyClash, KeyEdit, KeyTarget, ModKeys, OnScreenAll, OnScreenMod};
use gacha_core::backups::Backup;
use gacha_core::fixers::{self, FixerFile, FixerRequest};
use gacha_core::fixes::{self, FixAll, FixInfo, ModHealth};
use gacha_core::ini::{self, ConflictGroup, HashHit, ModInspect, ModProblems, ProblemFix, VarValue};
use gacha_core::pack::{self, ExportPlan, ExportRequest, ExportResult, ImportOptions, ImportResult, PackPreview};
use gacha_core::Result;
use tauri::{Emitter, State};

#[tauri::command]
pub async fn mod_inspect(st: State<'_, AppState>, game: String, id: String) -> Result<ModInspect> {
    let db = st.db.clone();
    blocking(move || ini::inspect(&db.lock().unwrap(), &game, &id)).await
}

/// The mod's model for the 3D preview. The database is only held for the lookup, not while the files are read.
#[tauri::command]
pub async fn mod_mesh(st: State<'_, AppState>, game: String, id: String) -> Result<ModMesh> {
    let db = st.db.clone();
    blocking(move || {
        let (dir, saved) = mesh::source(&db.lock().unwrap(), &game, &id)?;
        mesh::read(&dir, &saved)
    }).await
}

#[tauri::command]
pub async fn mod_set_var(st: State<'_, AppState>, game: String, id: String, value: VarValue) -> Result<()> {
    let db = st.db.clone();
    blocking(move || ini::set_var(&db.lock().unwrap(), &game, &id, &value)).await
}

#[tauri::command]
pub async fn conflicts_scan(st: State<'_, AppState>, game: String) -> Result<Vec<ConflictGroup>> {
    let db = st.db.clone();
    blocking(move || ini::conflicts(&db.lock().unwrap(), &game)).await
}

#[tauri::command]
pub async fn lint_scan(st: State<'_, AppState>, game: String) -> Result<Vec<ModProblems>> {
    let db = st.db.clone();
    blocking(move || ini::lint(&db.lock().unwrap(), &game)).await
}

/// Make a fix `lint_scan` offered; the backup undoes it.
#[tauri::command]
pub async fn lint_fix(st: State<'_, AppState>, game: String, id: String, fix: ProblemFix) -> Result<Backup> {
    let db = st.db.clone();
    blocking(move || ini::apply_fix(&db.lock().unwrap(), &game, &id, &fix)).await
}

/// The fix data and fixers known for a game (Tools > Fixes).
#[tauri::command]
pub async fn fixes_info(game: String) -> Result<FixInfo> {
    blocking(move || Ok(fixes::info(&game))).await
}

/// Mods a game update broke (or that gachamod fixed).
#[tauri::command]
pub async fn fixes_health(st: State<'_, AppState>, game: String) -> Result<Vec<ModHealth>> {
    let db = st.db.clone();
    blocking(move || fixes::health(&db.lock().unwrap(), &game)).await
}

/// Swap outdated hashes in these mods; each changed mod's backup undoes it.
#[tauri::command]
pub async fn fixes_apply(st: State<'_, AppState>, game: String, ids: Vec<String>) -> Result<FixAll> {
    let db = st.db.clone();
    blocking(move || fixes::fix(&db, &game, &ids)).await
}

/// Fixers downloaded for a game (Tools > Fixes).
#[tauri::command]
pub async fn fixers_list(st: State<'_, AppState>, game: String) -> Result<Vec<FixerFile>> {
    let data = st.data_dir.clone();
    blocking(move || fixers::list(&data, &game)).await
}

/// Download one file of a GameBanana fixer into the app's fixers folder. Nothing in it is run.
#[tauri::command]
pub async fn fixers_download(st: State<'_, AppState>, game: String, req: FixerRequest) -> Result<FixerFile> {
    fixers::fetch(&st.http, &st.data_dir, &game, req).await
}

#[tauri::command]
pub async fn hash_lookup(st: State<'_, AppState>, game: String, hash: String) -> Result<Vec<HashHit>> {
    let db = st.db.clone();
    blocking(move || ini::hash_lookup(&db.lock().unwrap(), &game, &hash)).await
}

/// What an export would hold (counts, sizes, the links as text), for the export window.
#[tauri::command]
pub async fn pack_plan(st: State<'_, AppState>, req: ExportRequest) -> Result<ExportPlan> {
    let db = st.db.clone();
    blocking(move || pack::plan(&db.lock().unwrap(), &req)).await
}

/// Progress goes out as the event "pack-progress" `{ done, total }` (bytes).
#[tauri::command]
pub async fn pack_export(app: tauri::AppHandle, st: State<'_, AppState>, req: ExportRequest) -> Result<ExportResult> {
    let db = st.db.clone();
    blocking(move || pack::export(&db, &req, &|done, total| { let _ = app.emit("pack-progress", serde_json::json!({ "done": done, "total": total })); })).await
}

#[tauri::command]
pub async fn pack_inspect(st: State<'_, AppState>, path: String) -> Result<PackPreview> {
    let db = st.db.clone();
    blocking(move || pack::inspect(&db.lock().unwrap(), std::path::Path::new(&path))).await
}

/// Mods in the file as links go to the download queue, each carrying how to set it up.
#[tauri::command]
pub async fn pack_import(app: tauri::AppHandle, st: State<'_, AppState>, path: String, opts: ImportOptions) -> Result<ImportResult> {
    let db = st.db.clone();
    let a = app.clone();
    let mut r = blocking(move || {
        let mut r = pack::import(&db, std::path::Path::new(&path), &opts, &|done, total| { let _ = a.emit("pack-progress", serde_json::json!({ "done": done, "total": total })); })?;
        // a profile it switched to may have picked live skins
        r.notes.extend(gacha_core::live::flush_sends(&db));
        Ok(r)
    }).await?;
    let mut reqs = std::mem::take(&mut r.downloads);
    if !reqs.is_empty() {
        r.notes.extend(pack::resolve(&st.http, &mut reqs).await);
        let items: Vec<_> = { let mut q = lk(&st.queue); reqs.into_iter().map(|req| q.add(req)).collect() };
        for i in &items { persist(&st.db, i); }
        r.queued = items.len() as u32;
        st.pump.notify_one();
        emit_snapshot(&app);
    }
    Ok(r)
}

#[tauri::command]
pub async fn imm_detect(st: State<'_, AppState>) -> Result<ImmInfo> {
    let db = st.db.clone();
    blocking(move || imm::detect(&db.lock().unwrap())).await
}

#[tauri::command]
pub async fn imm_takeover(st: State<'_, AppState>, game: String) -> Result<ImportResult> {
    let db = st.db.clone();
    blocking(move || imm::takeover(&db, &game)).await
}

// ── keys: rebinding, turning keys off, "only while on screen" and clashes ──

#[tauri::command]
pub async fn keys_list(st: State<'_, AppState>, game: String, id: String) -> Result<ModKeys> {
    let db = st.db.clone();
    blocking(move || keys::list(&db.lock().unwrap(), &game, &id)).await
}

#[tauri::command]
pub async fn keys_rebind(st: State<'_, AppState>, game: String, id: String, target: KeyTarget, binding: String) -> Result<KeyEdit> {
    let db = st.db.clone();
    blocking(move || keys::rebind(&db.lock().unwrap(), &game, &id, &target, &binding)).await
}

#[tauri::command]
pub async fn keys_set_off(st: State<'_, AppState>, game: String, id: String, ini: String, section: String, off: bool) -> Result<KeyEdit> {
    let db = st.db.clone();
    blocking(move || keys::set_off(&db.lock().unwrap(), &game, &id, &ini, &section, off)).await
}

#[tauri::command]
pub async fn keys_put_back(st: State<'_, AppState>, game: String, id: String) -> Result<KeyEdit> {
    let db = st.db.clone();
    blocking(move || keys::put_back(&db.lock().unwrap(), &game, &id)).await
}

#[tauri::command]
pub async fn keys_on_screen_mods(st: State<'_, AppState>, game: String) -> Result<Vec<OnScreenMod>> {
    let db = st.db.clone();
    blocking(move || keys::on_screen_mods(&db.lock().unwrap(), &game)).await
}

#[tauri::command]
pub async fn keys_on_screen(st: State<'_, AppState>, game: String, id: String, on: bool, draw: Option<Vec<DrawRef>>) -> Result<KeyEdit> {
    let db = st.db.clone();
    blocking(move || keys::on_screen(&db.lock().unwrap(), &game, &id, on, draw.as_deref())).await
}

#[tauri::command]
pub async fn keys_on_screen_all(st: State<'_, AppState>, game: String, on: bool) -> Result<OnScreenAll> {
    let db = st.db.clone();
    blocking(move || keys::on_screen_all(&db, &game, on)).await
}

#[tauri::command]
pub async fn keys_clashes(st: State<'_, AppState>, game: String) -> Result<Vec<KeyClash>> {
    let db = st.db.clone();
    blocking(move || keys::clashes(&db.lock().unwrap(), &game)).await
}

#[tauri::command]
pub async fn keys_outline(st: State<'_, AppState>, game: String, id: String) -> Result<Vec<IniOutline>> {
    let db = st.db.clone();
    blocking(move || keys::outline(&db.lock().unwrap(), &game, &id)).await
}
