//! Library and character commands. Owner: LIBRARY area.
use crate::state::{blocking, AppState};
use gacha_core::library::{self, CharacterRef, MetaPatch, TrashEntry};
use gacha_core::model::{Character, ModChange, ModEntry};
use gacha_core::Result;
use tauri::State;

/// The database, or a plain error when an earlier failure left it locked.
fn lock(db: &gacha_core::db::Shared) -> Result<std::sync::MutexGuard<'_, gacha_core::db::Db>> {
    db.lock().map_err(|_| gacha_core::Error::Db("The local database is stuck after an earlier error. Restart gachamod".into()))
}

#[tauri::command]
pub async fn library_scan(st: State<'_, AppState>, game: String) -> Result<Vec<ModEntry>> {
    let db = st.db.clone();
    blocking(move || library::scan(&db, &game)).await
}

#[tauri::command]
pub async fn library_list(st: State<'_, AppState>, game: String) -> Result<Vec<ModEntry>> {
    let db = st.db.clone();
    blocking(move || library::list(&*lock(&db)?, &game)).await
}

#[tauri::command]
pub async fn mod_get(st: State<'_, AppState>, game: String, id: String) -> Result<ModEntry> {
    let db = st.db.clone();
    blocking(move || library::get(&*lock(&db)?, &game, &id)).await
}

/// Of `others`, the mods that change the same parts as any of `ids` (asked before turning mods on).
#[tauri::command]
pub async fn mods_overlapping(st: State<'_, AppState>, game: String, ids: Vec<String>, others: Vec<String>) -> Result<Vec<String>> {
    let db = st.db.clone();
    blocking(move || library::overlapping(&*lock(&db)?, &game, &ids, &others)).await
}

#[tauri::command]
/// `turn_off_others`: what the user picked when the UI asked about the character's other mods (None follows the
/// "<game>.oneSkin" setting).
pub async fn mods_set_enabled(st: State<'_, AppState>, game: String, ids: Vec<String>, on: bool, turn_off_others: Option<bool>) -> Result<ModChange> {
    let db = st.db.clone();
    blocking(move || {
        let mut c = library::set_enabled_with(&*lock(&db)?, &game, &ids, on, turn_off_others)?;
        // live skins switch in the running game once the database is free
        c.notes.extend(gacha_core::live::flush_sends(&db));
        Ok(c)
    }).await
}

/// The folders inside a mod that hold their own inis, each on or off (library::parts).
#[tauri::command]
pub async fn mod_parts(st: State<'_, AppState>, game: String, id: String) -> Result<Vec<library::ModPart>> {
    let db = st.db.clone();
    blocking(move || library::parts(&*lock(&db)?, &game, &id)).await
}

#[tauri::command]
pub async fn mod_set_part(st: State<'_, AppState>, game: String, id: String, folder: String, on: bool) -> Result<ModEntry> {
    let db = st.db.clone();
    blocking(move || library::set_part(&*lock(&db)?, &game, &id, &folder, on)).await
}

/// Make several mods the parts of one mod (library::merge).
#[tauri::command]
pub async fn mods_merge(st: State<'_, AppState>, game: String, ids: Vec<String>) -> Result<ModChange> {
    let db = st.db.clone();
    blocking(move || library::merge(&*lock(&db)?, &game, &ids)).await
}

#[tauri::command]
pub async fn mod_update_meta(st: State<'_, AppState>, game: String, id: String, patch: MetaPatch) -> Result<ModEntry> {
    let db = st.db.clone();
    blocking(move || library::update_meta(&*lock(&db)?, &game, &id, &patch)).await
}

#[tauri::command]
pub async fn mod_move(st: State<'_, AppState>, game: String, id: String, group: Option<String>) -> Result<ModEntry> {
    let db = st.db.clone();
    blocking(move || library::move_to_group(&*lock(&db)?, &game, &id, group.as_deref())).await
}

#[tauri::command]
pub async fn mods_remove(st: State<'_, AppState>, game: String, ids: Vec<String>) -> Result<ModChange> {
    let db = st.db.clone();
    let data = st.data_dir.clone();
    blocking(move || library::remove(&*lock(&db)?, &data, &game, &ids, "removed")).await
}

#[tauri::command]
pub async fn trash_list(st: State<'_, AppState>, game: String) -> Result<Vec<TrashEntry>> {
    let db = st.db.clone();
    blocking(move || library::trash_list(&*lock(&db)?, &game)).await
}

#[tauri::command]
pub async fn trash_restore(st: State<'_, AppState>, id: i64) -> Result<ModChange> {
    let db = st.db.clone();
    blocking(move || library::trash_restore(&*lock(&db)?, id)).await
}

#[tauri::command]
pub async fn trash_purge(st: State<'_, AppState>, id: Option<i64>) -> Result<u64> {
    let db = st.db.clone();
    blocking(move || library::trash_purge(&*lock(&db)?, id)).await
}

#[tauri::command]
pub async fn characters_list(st: State<'_, AppState>, game: String) -> Result<Vec<Character>> {
    let db = st.db.clone();
    blocking(move || library::characters(&*lock(&db)?, &game)).await
}

#[tauri::command]
pub async fn characters_sync(st: State<'_, AppState>, game: String, list: Vec<CharacterRef>) -> Result<()> {
    let db = st.db.clone();
    blocking(move || library::characters_sync(&*lock(&db)?, &game, &list)).await
}

#[tauri::command]
pub async fn mods_mark_updates(st: State<'_, AppState>, game: String, ids: Vec<String>) -> Result<()> {
    let db = st.db.clone();
    blocking(move || library::mark_updates(&*lock(&db)?, &game, &ids)).await
}

/// Copy an image file into the mod's folder as its preview.
#[tauri::command]
pub async fn mod_set_preview(st: State<'_, AppState>, game: String, id: String, path: String) -> Result<ModEntry> {
    let db = st.db.clone();
    blocking(move || library::set_preview_file(&*lock(&db)?, &game, &id, std::path::Path::new(&path))).await
}

/// Save image bytes (a paste or a drop from a browser) as the mod's preview. `ext` is png, jpg, webp or gif.
#[tauri::command]
pub async fn mod_set_preview_data(st: State<'_, AppState>, game: String, id: String, data: Vec<u8>, ext: String) -> Result<ModEntry> {
    let db = st.db.clone();
    blocking(move || library::set_preview(&*lock(&db)?, &game, &id, &data, &ext)).await
}

/// The user's own preview as raw bytes (empty when there's none). The UI keeps it for Undo before replacing or
/// resetting it.
#[tauri::command]
pub async fn mod_custom_preview(st: State<'_, AppState>, game: String, id: String) -> Result<tauri::ipc::Response> {
    let db = st.db.clone();
    let bytes = blocking(move || library::custom_preview_bytes(&*lock(&db)?, &game, &id)).await?;
    Ok(tauri::ipc::Response::new(bytes.unwrap_or_default()))
}

#[tauri::command]
pub async fn mod_clear_preview(st: State<'_, AppState>, game: String, id: String) -> Result<ModEntry> {
    let db = st.db.clone();
    blocking(move || library::clear_preview(&*lock(&db)?, &game, &id)).await
}

/// Download a picture (GameBanana's first image) and save it as the mod's preview.<ext>.
#[tauri::command]
pub async fn mod_fetch_preview(st: State<'_, AppState>, game: String, id: String, url: String) -> Result<ModEntry> {
    let (bytes, ext) = gacha_core::previews::download(&st.http, &url).await?;
    let db = st.db.clone();
    blocking(move || library::save_fetched_preview(&*lock(&db)?, &game, &id, &bytes, &ext)).await
}

/// Removed mods of a game (or of every game with null): in the trash, then details only. Newest first.
#[tauri::command]
pub async fn archive_list(st: State<'_, AppState>, game: Option<String>) -> Result<Vec<library::ArchiveEntry>> {
    let db = st.db.clone();
    blocking(move || library::archive_list(&*lock(&db)?, game.as_deref())).await
}

/// Forget removed mods for good ("t<trash id>" / "a<archive id>" keys). With `recycle`, files of mods with no
/// GameBanana link go to the Recycle Bin instead of being deleted.
#[tauri::command]
pub async fn archive_forget(st: State<'_, AppState>, keys: Vec<String>, recycle: Option<bool>) -> Result<u64> {
    let db = st.db.clone();
    blocking(move || library::archive_forget(&*lock(&db)?, &keys, recycle.unwrap_or(false))).await
}
