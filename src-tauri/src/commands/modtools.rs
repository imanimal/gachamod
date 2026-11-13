//! Mod internals, .gachamod and IMM commands. Owner: MODTOOLS area.
use crate::state::{blocking, AppState};
use gacha_core::imm::{self, ImmInfo};
use gacha_core::ini::{self, ConflictGroup, HashHit, ModInspect, ModProblems, VarValue};
use gacha_core::pack::{self, ExportRequest, ExportResult, ImportOptions, ImportResult, PackPreview};
use gacha_core::Result;
use tauri::{Emitter, State};

#[tauri::command]
pub async fn mod_inspect(st: State<'_, AppState>, game: String, id: String) -> Result<ModInspect> {
    let db = st.db.clone();
    blocking(move || ini::inspect(&db.lock().unwrap(), &game, &id)).await
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

#[tauri::command]
pub async fn hash_lookup(st: State<'_, AppState>, game: String, hash: String) -> Result<Vec<HashHit>> {
    let db = st.db.clone();
    blocking(move || ini::hash_lookup(&db.lock().unwrap(), &game, &hash)).await
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

#[tauri::command]
pub async fn pack_import(app: tauri::AppHandle, st: State<'_, AppState>, path: String, opts: ImportOptions) -> Result<ImportResult> {
    let db = st.db.clone();
    blocking(move || pack::import(&db, std::path::Path::new(&path), &opts, &|done, total| { let _ = app.emit("pack-progress", serde_json::json!({ "done": done, "total": total })); })).await
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
