//! The AI helper's one native need: which chatbot desktop apps are on this PC, so the helper lists them first.
//! Only folder names are checked; nothing is read from them. Owner: SETTINGS/AI area.
use std::path::PathBuf;

/// Ids of the chatbot apps found ("chatgpt", "claude", "copilot"). Store apps leave a folder under
/// %LOCALAPPDATA%\Packages named after their package; Claude's classic installer uses %LOCALAPPDATA%\AnthropicClaude.
#[tauri::command]
pub async fn ai_chatbots_installed() -> Vec<String> {
    tauri::async_runtime::spawn_blocking(find).await.unwrap_or_default()
}

fn find() -> Vec<String> {
    let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) else { return Vec::new() };
    let packages: Vec<String> = std::fs::read_dir(local.join("Packages"))
        .map(|rd| rd.flatten().map(|e| e.file_name().to_string_lossy().to_lowercase()).collect())
        .unwrap_or_default();
    let has = |prefix: &str| packages.iter().any(|p| p.starts_with(prefix));
    let mut out = Vec::new();
    if has("openai.chatgpt-desktop_") || local.join("Programs").join("ChatGPT").is_dir() {
        out.push("chatgpt".to_string());
    }
    if has("claude_") || has("anthropic.claude") || local.join("AnthropicClaude").is_dir() {
        out.push("claude".to_string());
    }
    if has("microsoft.copilot_") {
        out.push("copilot".to_string());
    }
    out
}
