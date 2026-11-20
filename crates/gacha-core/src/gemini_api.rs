//! Asks Gemini over Google's API with the user's own key from Google AI Studio, for people without a chat CLI. A key
//! made there has no billing account behind it, so it runs on Google's free tier: it costs nothing and nothing goes
//! through a server of ours. The key is saved with Windows' data protection (only this Windows user can read it back)
//! in its own file, out of settings exports, and is sent in a header, never in an address. The answer streams back
//! like a CLI's (`chat_cli::Reply`), with Gemini's thought summaries and token counts. The user may pick the model and
//! how hard it thinks. Owner: SETTINGS/AI area.

use crate::ai_files::JobFile;
use crate::chat_cli::{Options, Reply, Run, Usage, TIMEOUT};
use crate::{dpapi, Error, Result};
use futures_util::StreamExt;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const BASE: &str = "https://generativelanguage.googleapis.com/v1beta";
/// Google's name for its newest Flash model, the one the free tier serves. When it's gone, `find_model` picks one.
const MODEL: &str = "gemini-flash-latest";
const SITE: &str = "Google's Gemini API";

/// A client of its own: a model can think for a while before its first words, longer than the app's 30-second read
/// timeout allows.
fn client() -> &'static reqwest::Client {
    static C: OnceLock<reqwest::Client> = OnceLock::new();
    C.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(crate::user_agent())
            .connect_timeout(Duration::from_secs(15))
            .read_timeout(Duration::from_secs(180))
            .build()
            .unwrap_or_default()
    })
}

fn key_file(dir: &Path) -> PathBuf {
    dir.join("gemini.key")
}

pub fn has_key(dir: &Path) -> bool {
    key_file(dir).is_file()
}

fn load_key(dir: &Path) -> Option<String> {
    let sealed = std::fs::read(key_file(dir)).ok()?;
    String::from_utf8(dpapi::unprotect(&sealed).ok()?).ok().filter(|k| !k.is_empty())
}

/// What a pasted key must look like before it's sent anywhere: letters, digits, dashes and underscores.
fn clean_key(key: &str) -> Result<String> {
    let k = key.trim();
    if k.len() < 20 || k.len() > 200 || !k.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err(Error::Invalid("That doesn't look like a Gemini key. Copy the whole key from Google AI Studio.".into()));
    }
    Ok(k.to_string())
}

/// Checks a key with Google, then saves it.
pub async fn set_key(dir: &Path, key: &str) -> Result<()> {
    let key = clean_key(key)?;
    let resp = client()
        .get(format!("{BASE}/models?pageSize=1"))
        .header("x-goog-api-key", &key)
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|e| Error::unreachable(SITE, e.without_url()))?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        let (_, message) = classify(status.as_u16(), &body);
        return Err(Error::Invalid(match message {
            Problem::Key => "Google didn't accept that key. Copy it again from Google AI Studio.".into(),
            Problem::Other(m) => format!("Google couldn't check the key: {m}"),
            _ => "Google couldn't check the key right now. Try again in a minute.".into(),
        }));
    }
    std::fs::create_dir_all(dir)?;
    crate::xxmi::write_atomic(&key_file(dir), &dpapi::protect(key.as_bytes())?)
}

pub fn remove_key(dir: &Path) -> Result<()> {
    match std::fs::remove_file(key_file(dir)) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
        _ => Ok(()),
    }
}

enum Problem {
    Key,
    Limit(Option<u64>),
    Busy,
    Model,
    Other(String),
}

/// What an error answer from Google means: {"error":{"code","message","status","details":[..]}}.
fn classify(code: u16, body: &str) -> (&'static str, Problem) {
    let v: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    let message = v.pointer("/error/message").and_then(Value::as_str).unwrap_or("").to_string();
    let status = v.pointer("/error/status").and_then(Value::as_str).unwrap_or("");
    let details = v.pointer("/error/details").and_then(Value::as_array).cloned().unwrap_or_default();
    let reason = details.iter().find_map(|d| d.get("reason").and_then(Value::as_str)).unwrap_or("");
    // "37s", from the RetryInfo detail
    let retry = details.iter().find_map(|d| d.get("retryDelay").and_then(Value::as_str)).and_then(|s| s.trim_end_matches('s').parse::<f64>().ok());
    let lower = message.to_lowercase();
    if reason == "API_KEY_INVALID" || code == 401 || (matches!(code, 400 | 403) && lower.contains("api key")) {
        ("key", Problem::Key)
    } else if code == 429 || status == "RESOURCE_EXHAUSTED" {
        let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        ("limit", Problem::Limit(retry.map(|s| now + s.ceil() as u64)))
    } else if code == 404 {
        ("failed", Problem::Model)
    } else if matches!(code, 500 | 502 | 503 | 504) {
        ("busy", Problem::Busy)
    } else {
        let m = if message.is_empty() { format!("Google answered {code}") } else { message.chars().take(400).collect() };
        ("failed", Problem::Other(m))
    }
}

fn model() -> String {
    chosen().lock().unwrap().clone().unwrap_or_else(|| MODEL.to_string())
}

fn chosen() -> &'static Mutex<Option<String>> {
    static M: Mutex<Option<String>> = Mutex::new(None);
    &M
}

/// A Flash model the key can use, for when Google retires the "latest" name: the newest plain one.
async fn find_model(key: &str) -> Option<String> {
    let resp = client().get(format!("{BASE}/models?pageSize=200")).header("x-goog-api-key", key).timeout(Duration::from_secs(20)).send().await.ok()?;
    let v: Value = resp.json().await.ok()?;
    let skip = ["lite", "image", "tts", "audio", "live", "exp", "preview", "thinking", "embedding", "8b"];
    v.get("models")?
        .as_array()?
        .iter()
        .filter(|m| m.get("supportedGenerationMethods").and_then(Value::as_array).is_some_and(|a| a.iter().any(|x| x == "generateContent")))
        .filter_map(|m| m.get("name").and_then(Value::as_str)?.strip_prefix("models/"))
        .filter(|n| n.contains("flash") && !skip.iter().any(|s| n.contains(s)))
        .max()
        .map(String::from)
}

type Emit<'a> = &'a (dyn Fn(&str, bool) + Sync);
type Think<'a> = &'a (dyn Fn(&str) + Sync);

/// Asks Gemini with the saved key, with as many of `files` as fit pasted after the request, on the model and thinking
/// level in `opts` (the newest Flash by default). `emit` gets each piece of the answer as it comes, `think` its
/// thought summaries.
#[allow(clippy::too_many_arguments)]
pub async fn ask(dir: &Path, prompt: &str, system: &str, files: &[JobFile], opts: &Options, run: &Run, emit: Emit<'_>, think: Think<'_>) -> Reply {
    let Some(key) = load_key(dir) else { return Reply::failed("key", "No Gemini key is saved.") };
    let request = crate::ai_files::inlined(prompt, files, crate::chat_cli::paste_budget("gemini-api"));
    let prompt = request.as_str();
    let effort = opts.effort("gemini-api");
    // a model the user picked is asked as it is: if Google doesn't have it, they hear so
    if let Some(m) = opts.model() {
        return ask_model(&key, m, effort, prompt, system, run, emit, think).await.unwrap_or_else(into_reply);
    }
    let first = ask_model(&key, &model(), effort, prompt, system, run, emit, think).await;
    if !matches!(first, Err(Problem::Model)) {
        return first.unwrap_or_else(into_reply);
    }
    // the model name is gone: find one this key can use and remember it
    let Some(found) = find_model(&key).await else { return Reply::failed("failed", "Google has no Gemini Flash model for this key.") };
    *chosen().lock().unwrap() = Some(found.clone());
    ask_model(&key, &found, effort, prompt, system, run, emit, think).await.unwrap_or_else(into_reply)
}

/// How a request asks for thinking. Gemini 3 takes a level, 2.5 a token budget, and an older model neither.
#[derive(Clone, Copy)]
enum Thinking {
    Level,
    Budget,
    Plain,
}

fn thinking(effort: Option<&str>, how: Thinking) -> Option<Value> {
    let budget = |e: &str| match e {
        "minimal" => 512,
        "low" => 1024,
        "medium" => 8192,
        _ => 24576,
    };
    match (how, effort) {
        (Thinking::Plain, _) => None,
        (Thinking::Level, Some(e)) => Some(json!({ "includeThoughts": true, "thinkingLevel": e })),
        (Thinking::Budget, Some(e)) => Some(json!({ "includeThoughts": true, "thinkingBudget": budget(e) })),
        (_, None) => Some(json!({ "includeThoughts": true })),
    }
}

/// One model, asked again in the next way when it refuses how thinking was asked for.
#[allow(clippy::too_many_arguments)]
async fn ask_model(key: &str, model: &str, effort: Option<&str>, prompt: &str, system: &str, run: &Run, emit: Emit<'_>, think: Think<'_>) -> std::result::Result<Reply, Problem> {
    let tries: &[Thinking] = if effort.is_some() { &[Thinking::Level, Thinking::Budget, Thinking::Plain] } else { &[Thinking::Level, Thinking::Plain] };
    let mut last = Err(Problem::Busy);
    for how in tries {
        last = stream(key, model, thinking(effort, *how), prompt, system, run, emit, think).await;
        if !matches!(&last, Err(Problem::Other(m)) if m.to_lowercase().contains("think")) {
            break;
        }
    }
    last
}

fn into_reply(p: Problem) -> Reply {
    match p {
        Problem::Key => Reply::failed("key", "Google didn't accept the Gemini key."),
        Problem::Limit(at) => Reply { resets_at: at, ..Reply::failed("limit", "Gemini's free limit is used up for now.") },
        Problem::Busy => Reply::failed("busy", "Gemini is overloaded right now."),
        Problem::Model => Reply::failed("failed", "Google has no such Gemini model."),
        Problem::Other(m) => Reply::failed("failed", m),
    }
}

fn stopped(text: String) -> Reply {
    Reply { text, ..Reply::failed("stopped", "Stopped") }
}

/// One streamed request. Err only for an error answer before any text; everything after is in the Reply.
#[allow(clippy::too_many_arguments)]
async fn stream(key: &str, model: &str, thinking: Option<Value>, prompt: &str, system: &str, run: &Run, emit: Emit<'_>, think: Think<'_>) -> std::result::Result<Reply, Problem> {
    // the mod helper's jobs are names, tags and themes: only the worst content is blocked, so a skin called
    // "Bikini" doesn't stop a rename of 200 mods
    let safety: Vec<Value> = ["HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_HATE_SPEECH", "HARM_CATEGORY_SEXUALLY_EXPLICIT", "HARM_CATEGORY_DANGEROUS_CONTENT"]
        .iter()
        .map(|c| json!({ "category": c, "threshold": "BLOCK_ONLY_HIGH" }))
        .collect();
    let mut body = json!({
        "systemInstruction": { "parts": [{ "text": system }] },
        "contents": [{ "role": "user", "parts": [{ "text": prompt }] }],
        "safetySettings": safety,
    });
    if let Some(tc) = thinking {
        body["generationConfig"] = json!({ "thinkingConfig": tc });
    }
    let send = client()
        .post(format!("{BASE}/models/{model}:streamGenerateContent?alt=sse"))
        .header("x-goog-api-key", key)
        .json(&body)
        .timeout(TIMEOUT)
        .send();
    let resp = tokio::select! {
        r = send => r,
        _ = run.until_stopped() => return Ok(stopped(String::new())),
    };
    let resp = match resp {
        Ok(r) => r,
        Err(e) if e.is_timeout() => return Ok(Reply::failed("timeout", "No answer in time.")),
        Err(e) => return Ok(Reply::failed("failed", format!("Couldn't reach Google: {}", e.without_url()))),
    };
    let code = resp.status().as_u16();
    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(classify(code, &body).1);
    }
    emit("", true);
    let mut text = String::new();
    let mut pending: Vec<u8> = Vec::new();
    let mut finish: Option<String> = None;
    let mut blocked: Option<String> = None;
    let mut usage = Usage::default();
    let mut bytes = resp.bytes_stream();
    loop {
        let chunk = tokio::select! {
            c = bytes.next() => c,
            _ = run.until_stopped() => return Ok(stopped(text)),
        };
        let Some(chunk) = chunk else { break };
        let chunk = match chunk {
            Ok(c) => c,
            Err(e) if e.is_timeout() => return Ok(Reply { text, ..Reply::failed("timeout", "No answer in time.") }),
            Err(e) => return Ok(Reply { text, ..Reply::failed("failed", format!("The connection to Google dropped: {}", e.without_url())) }),
        };
        pending.extend_from_slice(&chunk);
        // whole lines only, so a character split between two chunks is never cut
        while let Some(i) = pending.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = pending.drain(..=i).collect();
            let line = String::from_utf8_lossy(&line);
            let Some(data) = line.trim().strip_prefix("data:") else { continue };
            let Ok(v) = serde_json::from_str::<Value>(data.trim()) else { continue };
            if let Some(e) = v.get("error") {
                let (problem, p) = classify(e.get("code").and_then(Value::as_u64).unwrap_or(500) as u16, &json!({ "error": e }).to_string());
                let mut r = into_reply(p);
                r.problem = Some(problem);
                r.text = text;
                return Ok(r);
            }
            if let Some(b) = v.pointer("/promptFeedback/blockReason").and_then(Value::as_str) {
                blocked = Some(b.to_string());
            }
            // each piece carries the counts so far
            if let Some(m) = v.get("usageMetadata") {
                let n = |k: &str| m.get(k).and_then(Value::as_u64);
                usage.input = n("promptTokenCount").or(usage.input);
                usage.cached = n("cachedContentTokenCount").or(usage.cached);
                usage.thinking = n("thoughtsTokenCount").or(usage.thinking);
                usage.output = n("candidatesTokenCount").map(|c| c + usage.thinking.unwrap_or(0)).or(usage.output);
                usage.context = n("totalTokenCount").or(usage.context);
            }
            if let Some(m) = v.get("modelVersion").and_then(Value::as_str) {
                usage.model = Some(m.to_string());
            }
            let Some(cand) = v.pointer("/candidates/0") else { continue };
            if let Some(parts) = cand.pointer("/content/parts").and_then(Value::as_array) {
                for p in parts {
                    // a thinking model's thoughts are not the answer
                    if p.get("thought").and_then(Value::as_bool) == Some(true) {
                        if let Some(t) = p.get("text").and_then(Value::as_str).filter(|t| !t.is_empty()) {
                            think(t);
                        }
                        continue;
                    }
                    if let Some(t) = p.get("text").and_then(Value::as_str).filter(|t| !t.is_empty()) {
                        text.push_str(t);
                        emit(t, false);
                    }
                }
            }
            if let Some(f) = cand.get("finishReason").and_then(Value::as_str) {
                finish = Some(f.to_string());
            }
        }
    }
    let refused = blocked.is_some() || matches!(finish.as_deref(), Some("SAFETY" | "PROHIBITED_CONTENT" | "BLOCKLIST" | "SPII" | "RECITATION"));
    if text.trim().is_empty() {
        if refused {
            let why = blocked.or(finish).unwrap_or_default();
            return Ok(Reply::failed("blocked", format!("Gemini refused the request ({why}).")));
        }
        return Ok(Reply { usage, ..Reply::failed("failed", "Gemini sent no answer.") });
    }
    Ok(Reply { text, usage, ..Default::default() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_googles_errors() {
        let bad_key = r#"{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT","details":[{"@type":"type.googleapis.com/google.rpc.ErrorInfo","reason":"API_KEY_INVALID"}]}}"#;
        assert_eq!(classify(400, bad_key).0, "key");
        let limit = r#"{"error":{"code":429,"message":"You exceeded your current quota","status":"RESOURCE_EXHAUSTED","details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"37s"}]}}"#;
        let (kind, p) = classify(429, limit);
        assert_eq!(kind, "limit");
        assert!(matches!(p, Problem::Limit(Some(_))));
        assert_eq!(classify(503, "").0, "busy");
        assert!(matches!(classify(404, "").1, Problem::Model));
        let (kind, p) = classify(400, r#"{"error":{"code":400,"message":"User location is not supported for the API use.","status":"FAILED_PRECONDITION"}}"#);
        assert_eq!(kind, "failed");
        assert!(matches!(p, Problem::Other(m) if m.contains("location")));
    }

    #[test]
    fn checks_a_pasted_key_before_sending_it() {
        assert!(clean_key("  AIzaSyA-abcdefghijklmnopqrstuvwxyz_0123  ").is_ok());
        assert!(clean_key("AIza key with spaces in it 1234").is_err());
        assert!(clean_key("short").is_err());
    }
}
