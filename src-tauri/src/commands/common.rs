//! Commands every area uses: app info, settings, opening paths. Owner: skeleton (change with care).
use crate::state::{blocking, AppState};
use gacha_core::Result;
use tauri::State;

#[tauri::command]
pub fn app_info() -> serde_json::Value {
    serde_json::json!({ "name": gacha_core::APP_NAME, "version": gacha_core::APP_VERSION })
}

/// A setting's value, or null.
#[tauri::command]
pub async fn settings_get(st: State<'_, AppState>, key: String) -> Result<Option<String>> {
    let db = st.db.clone();
    blocking(move || db.lock().unwrap().setting(&key)).await
}

#[tauri::command]
pub async fn settings_set(st: State<'_, AppState>, key: String, value: String) -> Result<()> {
    let db = st.db.clone();
    blocking(move || {
        let d = db.lock().unwrap();
        d.set_setting(&key, &value)?;
        // a shorter trash time applies now
        if key == "trash.days" { let _ = gacha_core::library::purge_expired(&d); }
        Ok(())
    }).await
}

/// Open a file or folder with Windows (Explorer for folders).
#[tauri::command]
pub fn open_path(path: String) -> Result<()> {
    if !std::path::Path::new(&path).exists() { return Err(gacha_core::Error::Invalid("That file or folder isn't there anymore".into())); }
    open_with_shell(&path)
}

/// Show a file selected in Explorer.
#[tauri::command]
pub fn reveal_path(path: String) -> Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("explorer").raw_arg(format!("/select,\"{path}\"")).spawn()?;
        Ok(())
    }
    #[cfg(not(windows))]
    open_with_shell(&path)
}

/// Open a web link in the default browser.
#[tauri::command]
pub fn open_url(url: String) -> Result<()> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(gacha_core::Error::Invalid("Only web links open in the browser".into()));
    }
    open_with_shell(&url)
}

pub fn open_with_shell(target: &str) -> Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: no console flash. The empty "" is start's window title.
        std::process::Command::new("cmd").args(["/C", "start", ""]).arg(target).creation_flags(0x0800_0000).spawn()?;
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("xdg-open").arg(target).spawn()?;
    }
    Ok(())
}
