//! The AI helper's native side: which chatbot desktop apps and chat CLIs are on this PC, the saved Gemini key, and
//! asking a chat CLI (gacha-core `chat_cli`) or Gemini with that key (`gemini_api`), the answer sent back piece by
//! piece as "ai-chunk" events, each file it reads as an "ai-status" event and its thinking as "ai-think" events.
//! Owner: SETTINGS/AI area.
use crate::state::{blocking, AppState};
use gacha_core::ai_files::{self, JobFile, ModFiles};
use gacha_core::chat_cli::{self, Events, Options, Reply, Run};
use gacha_core::{gemini_api, Error, Result};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, LazyLock, Mutex};
use tauri::{AppHandle, Emitter, State};

/// Ids of the chatbot apps found ("chatgpt", "claude", "copilot"). Store apps leave a folder under
/// %LOCALAPPDATA%\Packages named after their package; Claude's classic installer uses %LOCALAPPDATA%\AnthropicClaude.
/// Only folder names are checked; nothing is read from them.
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

/// The chat CLIs on this PC: "claude", "codex", "agy", "gemini".
#[tauri::command]
pub async fn ai_clis() -> Vec<&'static str> {
    tauri::async_runtime::spawn_blocking(chat_cli::found).await.unwrap_or_default()
}

/// Requests running now, by the id the window gave them, so Stop can find them.
static RUNS: LazyLock<Mutex<HashMap<String, Arc<Run>>>> = LazyLock::new(Default::default);

#[derive(Clone, serde::Serialize)]
struct Chunk<'a> {
    id: &'a str,
    delta: &'a str,
    reset: bool,
}

#[derive(Clone, serde::Serialize)]
struct Status<'a> {
    id: &'a str,
    /// "read", "find", "search" or "work"
    kind: &'a str,
    on: &'a str,
    /// Calls made at once share a round.
    round: u32,
}

#[derive(Clone, serde::Serialize)]
struct Thought<'a> {
    id: &'a str,
    delta: &'a str,
}

/// Asks a chat CLI, or Gemini with the saved key when `tool` is "gemini-api", with `files` as reference (a folder to
/// read for Claude Code and Gemini CLI, pasted in for the rest) and the model and thinking level in `opts`. The answer
/// arrives as "ai-chunk" events while it is written, and whole in the reply with what the run used.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn ai_run(app: AppHandle, st: State<'_, AppState>, id: String, tool: String, prompt: String, system: String, files: Option<Vec<JobFile>>, opts: Option<Options>) -> Result<Reply> {
    let files = files.unwrap_or_default();
    let opts = opts.unwrap_or_default();
    let run = Arc::new(Run::default());
    {
        let mut runs = RUNS.lock().unwrap();
        if runs.contains_key(&id) {
            return Err(Error::Invalid("That request is already running.".into()));
        }
        runs.insert(id.clone(), run.clone());
    }
    let dir = st.data_dir.join("ai");
    let key = id.clone();
    let reply = if tool == "gemini-api" {
        let emit = |delta: &str, reset: bool| {
            let _ = app.emit("ai-chunk", Chunk { id: &id, delta, reset });
        };
        let think = |delta: &str| {
            let _ = app.emit("ai-think", Thought { id: &id, delta });
        };
        Ok(gemini_api::ask(&dir, &prompt, &system, &files, &opts, &run, &emit, &think).await)
    } else {
        blocking(move || {
            let text = |delta: &str, reset: bool| {
                let _ = app.emit("ai-chunk", Chunk { id: &id, delta, reset });
            };
            let step = |kind: &str, on: &str, round: u32| {
                let _ = app.emit("ai-status", Status { id: &id, kind, on, round });
            };
            let think = |delta: &str| {
                let _ = app.emit("ai-think", Thought { id: &id, delta });
            };
            Ok(chat_cli::ask(&tool, &prompt, &system, &dir, &files, &opts, &run, &Events { text: &text, step: &step, think: &think }))
        })
        .await
    };
    RUNS.lock().unwrap().remove(&key);
    reply
}

/// The files of some mods (listing, inis with their section names, readmes), for the AI helper to send along with a
/// mod job, with up to `per_mod` bytes of text each.
#[tauri::command]
pub async fn ai_mod_files(st: State<'_, AppState>, game: String, ids: Vec<String>, per_mod: usize) -> Result<Vec<ModFiles>> {
    let db = st.db.clone();
    blocking(move || Ok(ai_files::mod_files(&db.lock().unwrap(), &game, &ids, per_mod))).await
}

/// Whether a Gemini key is saved. The key itself never goes back to the window.
#[tauri::command]
pub fn ai_key_status(st: State<'_, AppState>) -> bool {
    gemini_api::has_key(&st.data_dir.join("ai"))
}

/// Checks a Gemini key with Google and saves it.
#[tauri::command]
pub async fn ai_key_set(st: State<'_, AppState>, key: String) -> Result<()> {
    gemini_api::set_key(&st.data_dir.join("ai"), &key).await
}

#[tauri::command]
pub async fn ai_key_remove(st: State<'_, AppState>) -> Result<()> {
    let dir = st.data_dir.join("ai");
    blocking(move || gemini_api::remove_key(&dir)).await
}

/// Stops a request and the CLI it started.
#[tauri::command]
pub async fn ai_cancel(id: String) {
    let run = RUNS.lock().unwrap().get(&id).cloned();
    if let Some(run) = run {
        let _ = tauri::async_runtime::spawn_blocking(move || run.stop()).await;
    }
}

/// Opens a chat CLI in a console window so the user can sign in.
#[tauri::command]
pub async fn ai_cli_sign_in(st: State<'_, AppState>, tool: String) -> Result<()> {
    let dir = st.data_dir.join("ai");
    blocking(move || chat_cli::sign_in(&tool, &dir)).await
}
