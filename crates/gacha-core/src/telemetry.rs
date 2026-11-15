//! Anonymous usage counts, crash reports and feedback, sent to the developer's PostHog project. Owner: SYSTEM area.
//!
//! Usage counts and crash reports each have a switch in Settings, both on unless the player turns them off. Feedback
//! goes only when the player sends it. Events carry fixed names (a screen, a command, a setting's key) and short plain
//! values, never mod names, file paths or account details; text that leaves (a crash, attached log lines) has the
//! user's folder and name taken out first (`logs::scrub`). docs/telemetry.md lists every event.
//!
//! The project key comes from GACHAMOD_POSTHOG_KEY when gachamod is built (GACHAMOD_POSTHOG_HOST for the EU
//! server). Without it nothing is sent. Debug builds send usage and crashes only with GACHAMOD_TELEMETRY_DEV set.

use crate::db::{Db, Shared};
use crate::error::{Error, Result};
use crate::logs;
use serde_json::{json, Map, Value};
use std::sync::Mutex;
use std::time::Duration;

const KEY: &str = match option_env!("GACHAMOD_POSTHOG_KEY") { Some(k) => k, None => "" };
const HOST: &str = match option_env!("GACHAMOD_POSTHOG_HOST") { Some(h) => h, None => "https://us.i.posthog.com" };
const USAGE: &str = "telemetry.usage";
const CRASHES: &str = "telemetry.crashes";
const ID: &str = "telemetry.id";
const VERSION: &str = env!("CARGO_PKG_VERSION");

/// The names an event may have. Anything else from the window is dropped.
const NAMES: &[&str] = &["app started", "screen", "click", "setting", "input", "used", "f10 note"];

/// This build has somewhere to send to.
pub fn configured() -> bool { !KEY.is_empty() }

/// A developer's build sends nothing on its own, so their clicks don't count as players'.
fn quiet_build() -> bool { cfg!(debug_assertions) && std::env::var_os("GACHAMOD_TELEMETRY_DEV").is_none() }

pub fn usage_on(db: &Db) -> bool { db.setting(USAGE).ok().flatten().as_deref() != Some("0") }
pub fn crashes_on(db: &Db) -> bool { db.setting(CRASHES).ok().flatten().as_deref() != Some("0") }

#[derive(serde::Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct State {
    pub usage: bool,
    pub crashes: bool,
    /// False in a build without the project key: the switches still work, nothing is sent.
    pub configured: bool,
    pub logs_dir: Option<String>,
}

pub fn state(db: &Db) -> State {
    State { usage: usage_on(db), crashes: crashes_on(db), configured: configured(), logs_dir: logs::dir().map(|d| d.to_string_lossy().into_owned()) }
}

/// Turn usage counts or crash reports on or off. Off drops what was waiting to go.
pub fn set(db: &Db, usage: Option<bool>, crashes: Option<bool>) -> Result<State> {
    if let Some(on) = usage {
        db.set_setting(USAGE, if on { "1" } else { "0" })?;
        if !on { queue().clear(); }
    }
    if let Some(on) = crashes { db.set_setting(CRASHES, if on { "1" } else { "0" })?; }
    Ok(state(db))
}

/// A random id for this install, so counts can tell one player from many. Nothing ties it to the person.
fn install_id(db: &Db) -> String {
    if let Some(id) = db.setting(ID).ok().flatten().filter(|s| s.len() == 32) { return id; }
    let id = random_id();
    let _ = db.set_setting(ID, &id);
    id
}

fn random_id() -> String {
    let mut b = [0u8; 16];
    let _ = getrandom::fill(&mut b);
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// One event from the window: a name from `NAMES` and a few short values.
#[derive(serde::Deserialize, Debug, Clone)]
pub struct UiEvent {
    pub name: String,
    #[serde(default)]
    pub props: Map<String, Value>,
}

impl UiEvent {
    pub fn new(name: &str, props: Value) -> Self {
        UiEvent { name: name.into(), props: props.as_object().cloned().unwrap_or_default() }
    }
}

static QUEUE: Mutex<Vec<Value>> = Mutex::new(Vec::new());
fn queue() -> std::sync::MutexGuard<'static, Vec<Value>> { QUEUE.lock().unwrap_or_else(|e| e.into_inner()) }

fn plain_key(k: &str) -> bool { !k.is_empty() && k.len() <= 30 && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') }

fn plain_value(v: &Value) -> bool {
    match v {
        Value::Bool(_) | Value::Number(_) => true,
        Value::String(s) => s.len() <= 60 && s.chars().all(|c| c.is_ascii_alphanumeric() || " _.-".contains(c)),
        _ => false,
    }
}

/// Note usage events. Dropped when usage counts are off; only known names and short plain values get in, so nothing
/// personal can by mistake.
pub fn note(db: &Db, events: Vec<UiEvent>) {
    if !usage_on(db) { return; }
    let now = chrono::Utc::now().to_rfc3339();
    let mut q = queue();
    for e in events {
        if !NAMES.contains(&e.name.as_str()) { continue; }
        let props: Map<String, Value> = e.props.into_iter().filter(|(k, v)| plain_key(k) && plain_value(v)).collect();
        q.push(json!({ "event": e.name, "properties": props, "timestamp": now }));
    }
    let over = q.len().saturating_sub(2000);
    q.drain(..over);
}

/// What every event carries besides its own values.
fn common(id: &str) -> Map<String, Value> {
    let v = json!({
        "distinct_id": id,
        // counts only: PostHog keeps no profile of the player
        "$process_person_profile": false,
        "$lib": "gachamod",
        "$os": "Windows",
        "app_version": VERSION,
        "elevated": crate::devtools::self_elevated(),
        "dev": cfg!(debug_assertions),
    });
    v.as_object().cloned().unwrap_or_default()
}

fn with_common(mut event: Value, base: &Map<String, Value>) -> Value {
    if let Some(p) = event.get_mut("properties").and_then(Value::as_object_mut) {
        for (k, v) in base { p.entry(k.clone()).or_insert_with(|| v.clone()); }
    }
    event
}

/// The noted events, ready to send. None when there are none or none may go.
fn take_usage(db: &Db) -> Option<Value> {
    if !configured() || quiet_build() || !usage_on(db) { queue().clear(); return None; }
    let events = std::mem::take(&mut *queue());
    if events.is_empty() { return None; }
    let base = common(&install_id(db));
    Some(json!({ "api_key": KEY, "batch": events.into_iter().map(|e| with_common(e, &base)).collect::<Vec<_>>() }))
}

fn cut(s: &str, max: usize) -> String {
    if s.len() <= max { return s.to_string(); }
    let mut end = max;
    while !s.is_char_boundary(end) { end -= 1; }
    format!("{}…", &s[..end])
}

/// A crash as PostHog's error tracking expects it.
fn crash_event(c: &logs::Crash, base: &Map<String, Value>) -> Value {
    let message = logs::scrub(&c.message);
    let at = logs::scrub(&c.at);
    let fingerprint = if at.is_empty() { format!("{}:{}", c.kind, cut(&message, 120)) } else { format!("{}:{at}", c.kind) };
    with_common(json!({
        "event": "$exception",
        "properties": {
            "$exception_list": [{ "type": c.kind, "value": message, "mechanism": { "handled": false, "synthetic": false } }],
            "$exception_fingerprint": fingerprint,
            "crash_kind": c.kind,
            "at": at,
            "stack": cut(&logs::scrub(&c.stack), 16_000),
            "crash_version": c.version,
        },
        "timestamp": c.time,
    }), base)
}

/// Crash files not sent yet, ready to send, and the files they came from.
fn take_crashes(db: &Db) -> Option<(Value, Vec<std::path::PathBuf>)> {
    if !configured() || quiet_build() || !crashes_on(db) { return None; }
    let list = logs::pending();
    if list.is_empty() { return None; }
    let base = common(&install_id(db));
    let (files, events): (Vec<_>, Vec<_>) = list.iter().take(10).map(|(p, c)| (p.clone(), crash_event(c, &base))).unzip();
    Some((json!({ "api_key": KEY, "batch": events }), files))
}

async fn post(http: &reqwest::Client, body: &Value) -> std::result::Result<(), String> {
    let r = http.post(format!("{HOST}/batch/")).json(body).timeout(Duration::from_secs(15)).send().await.map_err(|e| e.to_string())?;
    if r.status().is_success() { Ok(()) } else { Err(format!("the server answered {}", r.status())) }
}

/// Send the noted usage and any crash files not sent yet. The app calls this every few minutes and when it quits.
pub async fn flush(http: &reqwest::Client, db: &Shared) {
    let (usage, crashes) = {
        let Ok(d) = db.lock() else { return };
        (take_usage(&d), take_crashes(&d))
    };
    if let Some(b) = usage {
        if let Err(e) = post(http, &b).await { logs::warn(format!("usage counts weren't sent: {e}")); }
    }
    if let Some((b, files)) = crashes {
        match post(http, &b).await {
            Ok(()) => { for f in &files { logs::mark_sent(f); } logs::info(format!("sent {} crash report(s)", files.len())); }
            Err(e) => logs::warn(format!("crash reports weren't sent: {e}")),
        }
    }
}

/// gachamod started: one event with how it runs (not which mods or games).
pub fn note_start(db: &Db) {
    let shown = crate::games::list(db).map(|g| g.iter().filter(|g| g.shown).count()).unwrap_or(0);
    note(db, vec![UiEvent::new("app started", json!({ "games": shown, "always_admin": crate::devtools::always_admin() }))]);
}

/// A message from the player to the developer.
#[derive(serde::Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Feedback {
    /// "problem", "idea" or "other".
    pub kind: String,
    pub text: String,
    /// How to answer, when the player wants an answer.
    #[serde(default)]
    pub contact: Option<String>,
    /// Attach the end of the log (the user's folder and name taken out).
    #[serde(default)]
    pub logs: bool,
    #[serde(default)]
    pub screen: Option<String>,
    #[serde(default)]
    pub game: Option<String>,
}

/// One event the player chose to send (feedback, a game check), ready to post. It goes with usage counts on or off;
/// with them off it gets a new random id, so it can't be tied to the counts.
pub(crate) fn hand_sent(db: &Db, event: &str, props: Map<String, Value>) -> Value {
    let id = if usage_on(db) { install_id(db) } else { random_id() };
    let mut p = common(&id);
    p.extend(props);
    json!({ "api_key": KEY, "batch": [{ "event": event, "properties": p, "timestamp": chrono::Utc::now().to_rfc3339() }] })
}

/// Post what `hand_sent` made. `what` names it in the error ("Your feedback").
pub(crate) async fn post_hand_sent(http: &reqwest::Client, body: &Value, what: &str) -> Result<()> {
    if !configured() { return Err(Error::Invalid("This copy of gachamod was built without an address to send to".into())); }
    post(http, body).await.map_err(|e| Error::Invalid(format!("{what} wasn't sent ({e}). Check your connection and try again")))
}

/// Text that may go in a hand-sent event, trimmed and cut to `max` bytes.
pub(crate) fn text(s: &str, max: usize) -> String { cut(s.trim(), max) }

/// Keep only short plain values (see `note`), for values the window sends.
pub(crate) fn plain(props: Map<String, Value>) -> Map<String, Value> {
    props.into_iter().filter(|(k, v)| plain_key(k) && plain_value(v)).collect()
}

fn feedback_body(db: &Db, f: &Feedback) -> Value {
    let mut p = Map::new();
    let kind = if ["problem", "idea", "other"].contains(&f.kind.as_str()) { f.kind.as_str() } else { "other" };
    p.insert("kind".into(), json!(kind));
    p.insert("message".into(), json!(text(&f.text, 8000)));
    if let Some(c) = f.contact.as_deref().map(str::trim).filter(|c| !c.is_empty()) { p.insert("contact".into(), json!(cut(c, 200))); }
    if let Some(s) = f.screen.as_deref().filter(|s| plain_value(&json!(s))) { p.insert("screen".into(), json!(s)); }
    if let Some(g) = f.game.as_deref().filter(|s| plain_value(&json!(s))) { p.insert("game".into(), json!(g)); }
    if f.logs { p.insert("log".into(), json!(logs::scrub(&logs::tail(30_000)))); }
    hand_sent(db, "feedback", p)
}

/// Send feedback now. Works with usage counts off; it's the player's own choice to send.
pub async fn send_feedback(http: &reqwest::Client, db: &Shared, f: Feedback) -> Result<()> {
    if f.text.trim().is_empty() { return Err(Error::Invalid("Write something first".into())); }
    let body = { let d = db.lock().map_err(|_| Error::Invalid("The database is busy. Try again".into()))?; feedback_body(&d, &f) };
    post_hand_sent(http, &body, "Your feedback").await?;
    logs::info("feedback sent");
    Ok(())
}

/// An error in the window's code: logged, and kept as a crash for the next send.
pub fn ui_error(message: &str, stack: &str) {
    logs::error(format!("window error: {message}\n{stack}"));
    logs::save_crash(&logs::Crash { kind: "ui".into(), message: cut(message, 500), at: String::new(), stack: cut(stack, 8000), version: VERSION.into(), time: chrono::Utc::now().to_rfc3339() });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_known_events_and_plain_values_get_in() {
        let db = Db::memory().unwrap();
        queue().clear();
        note(&db, vec![
            UiEvent::new("screen", json!({ "view": "library", "path": "C:\\Users\\x", "n": 3, "nested": { "a": 1 } })),
            UiEvent::new("mod renamed", json!({ "name": "Maid" })),
        ]);
        // other tests may note events meanwhile: only this one's count
        let q: Vec<Value> = queue().iter().filter(|e| e["event"] == json!("screen") || e["event"] == json!("mod renamed")).cloned().collect();
        assert_eq!(q.len(), 1);
        let p = q[0]["properties"].as_object().unwrap();
        assert_eq!(p.get("view"), Some(&json!("library")));
        assert_eq!(p.get("n"), Some(&json!(3)));
        assert!(!p.contains_key("path") && !p.contains_key("nested"));
    }

    #[test]
    fn usage_off_notes_nothing() {
        let db = Db::memory().unwrap();
        set(&db, Some(false), None).unwrap();
        note(&db, vec![UiEvent::new("screen", json!({ "view": "home" }))]);
        assert!(!state(&db).usage);
        assert!(queue().iter().all(|e| e["properties"]["view"] != json!("home")));
    }

    #[test]
    fn feedback_keeps_its_words_and_the_install_id_only_with_usage_on() {
        let db = Db::memory().unwrap();
        let f = Feedback { kind: "idea".into(), text: "  Add a dark grid  ".into(), contact: Some("me@example.com".into()), logs: false, screen: Some("library".into()), game: Some("zzz".into()) };
        let b = feedback_body(&db, &f);
        let p = &b["batch"][0]["properties"];
        assert_eq!(p["message"], json!("Add a dark grid"));
        assert_eq!(p["kind"], json!("idea"));
        assert_eq!(p["distinct_id"], json!(install_id(&db)));
        assert!(p.get("log").is_none());
        set(&db, Some(false), None).unwrap();
        let b = feedback_body(&db, &f);
        assert_ne!(b["batch"][0]["properties"]["distinct_id"], json!(install_id(&db)));
    }

    #[test]
    fn a_crash_becomes_an_exception() {
        let c = logs::Crash { kind: "panic".into(), message: "index out of range".into(), at: "crates/gacha-core/src/live.rs:10".into(), stack: "frames".into(), version: "0.1.0".into(), time: "2026-11-14T00:00:00Z".into() };
        let e = crash_event(&c, &common("abc"));
        assert_eq!(e["event"], json!("$exception"));
        assert_eq!(e["properties"]["$exception_list"][0]["value"], json!("index out of range"));
        assert_eq!(e["properties"]["$exception_fingerprint"], json!("panic:crates/gacha-core/src/live.rs:10"));
        assert_eq!(e["properties"]["distinct_id"], json!("abc"));
    }
}
