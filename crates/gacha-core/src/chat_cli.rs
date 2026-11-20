//! Asks a chat CLI the user is signed in to (Claude Code, Codex CLI, Antigravity CLI or Gemini CLI) and reads its answer as it is
//! written, so the AI helper shows the reply in the app instead of sending the user to a website and back. It runs on
//! the plan the user signed in with: API-key variables are taken out of the child's environment, so nothing is billed
//! per use and nothing goes through a server of ours. Each run gets a folder of its own, empty or holding copies of the
//! request's reference files (ai_files.rs), deleted afterwards. Claude Code and Gemini CLI may read those with
//! read-only file tools and nothing else; Codex and Antigravity get them pasted after the request. Claude Code also
//! loads no settings, hooks, MCP servers, slash commands or CLAUDE.md files, keeps no session, and gets the helper's
//! rules as its whole system prompt from a file (a long one would overflow a Windows command line). The user may pick
//! the model and how hard it thinks (`Options`); the run reports each file it reads, its thinking and what it used.
//! Owner: SETTINGS/AI area.

use crate::ai_files::{self, JobFile};
use crate::{Error, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

/// The CLIs, in the order they are offered. "agy" is Antigravity CLI, which took over Gemini CLI's free Google sign-in.
pub const TOOLS: [&str; 4] = ["claude", "codex", "agy", "gemini"];
/// A run gives up after this long.
pub const TIMEOUT: Duration = Duration::from_secs(600);

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn home() -> Option<PathBuf> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from)
}

/// Where these CLIs install besides PATH.
fn extra_dirs() -> Vec<PathBuf> {
    let mut v = Vec::new();
    if let Some(h) = home() {
        v.push(h.join(".local").join("bin"));
        v.push(h.join(".claude").join("local"));
        v.push(h.join(".bun").join("bin"));
        v.push(h.join(".volta").join("bin"));
        if cfg!(windows) {
            v.push(h.join("scoop").join("shims"));
        } else {
            v.push(h.join(".npm-global").join("bin"));
        }
    }
    if cfg!(windows) {
        if let Some(a) = std::env::var_os("APPDATA") {
            v.push(PathBuf::from(a).join("npm"));
        }
        if let Some(a) = std::env::var_os("LOCALAPPDATA") {
            v.push(PathBuf::from(&a).join("Volta").join("bin"));
            v.push(PathBuf::from(&a).join("agy").join("bin"));
        }
        if let Some(p) = std::env::var_os("ProgramFiles") {
            v.push(PathBuf::from(p).join("nodejs"));
        }
    } else {
        v.extend(["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"].map(PathBuf::from));
    }
    v
}

fn search_dirs() -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    for d in extra_dirs() {
        if !v.contains(&d) {
            v.push(d);
        }
    }
    v
}

/// The CLI's program: a native binary first, then an npm shim.
pub fn locate(name: &str) -> Option<PathBuf> {
    let names: Vec<String> = if cfg!(windows) { ["exe", "cmd", "bat"].iter().map(|x| format!("{name}.{x}")).collect() } else { vec![name.to_string()] };
    for d in search_dirs() {
        for n in &names {
            let p = d.join(n);
            if p.is_file() {
                return Some(p);
            }
        }
    }
    #[cfg(windows)]
    if name == "codex" {
        return store_codex();
    }
    None
}

/// The Codex app from the Microsoft Store carries the CLI inside its package.
#[cfg(windows)]
fn store_codex() -> Option<PathBuf> {
    use std::os::windows::process::CommandExt;
    let out = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", "(Get-AppxPackage -Name OpenAI.Codex | Select-Object -First 1).InstallLocation"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    let install = std::str::from_utf8(&out.stdout).ok()?.trim();
    let exe = Path::new(install).join("app").join("resources").join("codex.exe");
    (out.status.success() && exe.is_absolute() && exe.is_file()).then_some(exe)
}

/// The CLIs on this PC, by id ("claude", "codex", "gemini").
pub fn found() -> Vec<&'static str> {
    TOOLS.into_iter().filter(|t| locate(t).is_some()).collect()
}

fn name(tool: &str) -> &'static str {
    match tool {
        "claude" => "Claude Code",
        "codex" => "Codex",
        "agy" => "Antigravity",
        _ => "Gemini CLI",
    }
}

/// The environment every run gets: the signed-in plan rather than an API key, and a PATH that has node for npm shims
/// (a desktop app's PATH may not).
fn prepare(cmd: &mut Command, exe: &Path) {
    for k in ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY", "CODEX_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX"] {
        cmd.env_remove(k);
    }
    let mut path: Vec<PathBuf> = exe.parent().map(|p| vec![p.to_path_buf()]).unwrap_or_default();
    path.extend(search_dirs());
    if let Ok(p) = std::env::join_paths(path) {
        cmd.env("PATH", p);
    }
}

/// Whether the CLI gets the reference files as a folder to read (with read-only tools) rather than pasted in.
pub fn reads_files(tool: &str) -> bool {
    matches!(tool, "claude" | "gemini")
}

/// How much of the reference files is pasted after the request for a CLI that can't read them, in characters.
pub fn paste_budget(tool: &str) -> usize {
    match tool {
        "codex" => 300_000,
        "gemini-api" => 400_000,
        _ => 200_000,
    }
}

/// What the user picked for a run: a model ("opus", "flash", "gpt-5-codex") and how hard it thinks ("low" to "max").
/// Empty means the tool's default. Anything that doesn't look right is left off the command line.
#[derive(Debug, Default, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Options {
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub effort: String,
}

impl Options {
    /// The model name, when it looks like one: letters, digits and . _ - : / [ ].
    pub fn model(&self) -> Option<&str> {
        let m = self.model.trim();
        (!m.is_empty() && m.len() <= 80 && m.chars().all(|c| c.is_ascii_alphanumeric() || "._-:/[]".contains(c))).then_some(m)
    }
    /// The thinking level, when `tool` takes that one.
    pub fn effort(&self, tool: &str) -> Option<&str> {
        let e = self.effort.trim();
        efforts(tool).contains(&e).then_some(e)
    }
}

/// The thinking levels each tool takes, lowest first. Gemini CLI and Antigravity have no option for it.
pub fn efforts(tool: &str) -> &'static [&'static str] {
    match tool {
        "claude" => &["low", "medium", "high", "xhigh", "max"],
        "codex" => &["minimal", "low", "medium", "high", "xhigh"],
        "gemini-api" => &["minimal", "low", "medium", "high"],
        _ => &[],
    }
}

/// The command line for one run. Claude Code reads the rules from `sys_file`; the others have no system prompt of their
/// own, so the rules head their stdin instead. `files`: the run's folder holds reference files to read. `newer`: Claude
/// Code gets the options older versions don't know (the thinking level, and its thinking as text).
fn build(tool: &str, exe: &Path, sys_file: &Path, files: bool, opts: &Options, newer: bool) -> Command {
    // an npm shim (.cmd) runs too: std quotes arguments for cmd.exe itself
    let mut cmd = Command::new(exe);
    match tool {
        "claude" => {
            cmd.args(["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages"]);
            // reading only: no shell, no edits, no web
            let tools = if files { "Read,Glob,Grep" } else { "" };
            cmd.args(["--tools", tools, "--allowedTools", tools]);
            cmd.args(["--no-session-persistence", "--setting-sources", "", "--strict-mcp-config", "--disable-slash-commands"]);
            cmd.args(["--model", opts.model().unwrap_or("sonnet")]);
            if newer {
                if let Some(e) = opts.effort(tool) {
                    cmd.args(["--effort", e]);
                }
                // printed runs leave thinking out unless asked for summaries
                cmd.args(["--thinking-display", "summarized"]);
            }
            cmd.arg("--system-prompt-file").arg(sys_file);
        }
        "codex" => {
            cmd.args(["-a", "never", "--disable", "shell_tool", "-c", "web_search=\"disabled\""]);
            if let Some(m) = opts.model() {
                cmd.args(["-m", m]);
            }
            if let Some(e) = opts.effort(tool) {
                cmd.arg("-c").arg(format!("model_reasoning_effort=\"{e}\""));
            }
            cmd.args(["exec", "--ignore-user-config", "--ephemeral", "--json", "--skip-git-repo-check", "--sandbox", "read-only", "--color", "never", "-"]);
        }
        // one {"event":"user"} line on stdin; it has no flag for rules or for turning tools off, so the rules head the
        // message, its folder stays empty and the files are pasted in (writes and commands are refused headless)
        "agy" => {
            cmd.args(["--input-format", "stream-json", "--output-format", "stream-json", "--disable-slash-commands"]);
            cmd.env("AGY_CLI_DISABLE_AUTO_UPDATE", "true");
        }
        // plan mode: read-only tools only, which read the run's folder. Models: auto, pro, flash, flash-lite or a name.
        _ => {
            cmd.args(["--output-format", "stream-json", "--approval-mode", "plan", "--extensions", "none"]);
            if let Some(m) = opts.model() {
                cmd.args(["-m", m]);
            }
        }
    }
    prepare(&mut cmd, exe);
    cmd.env("NO_COLOR", "1");
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Ends a process and everything it started (an npm shim is cmd.exe running node).
fn kill_tree(pid: u32) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill.exe")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("kill").args(["-9", &pid.to_string()]).status();
    }
}

/// One request, so it can be stopped from another thread (a CLI's process) or task (a Gemini API request).
#[derive(Default)]
pub struct Run {
    pid: Mutex<Option<u32>>,
    stopped: AtomicBool,
    wake: tokio::sync::Notify,
}

impl Run {
    pub fn stop(&self) {
        self.stopped.store(true, Ordering::Relaxed);
        self.wake.notify_one();
        let pid = *self.pid.lock().unwrap();
        if let Some(pid) = pid {
            kill_tree(pid);
        }
    }
    pub fn is_stopped(&self) -> bool {
        self.stopped.load(Ordering::Relaxed)
    }
    /// Returns once Stop is pressed, for racing an async request against it.
    pub async fn until_stopped(&self) {
        while !self.is_stopped() {
            self.wake.notified().await;
        }
    }
}

/// What a run gave back. The app words the failure itself from `problem`, so it can be translated.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reply {
    /// The answer, or as much of it as came before a failure.
    pub text: String,
    /// None when it answered. Else "signin" (not signed in), "limit" (usage limit reached), "outdated" (the CLI is
    /// older than the options used here), "node" (an npm CLI without Node.js), "timeout", "stopped", "missing" (not on
    /// this PC) or "failed". The Gemini API adds "key" (no key, or Google rejected it), "blocked" (Gemini refused the
    /// request) and "busy" (Google's servers are overloaded).
    pub problem: Option<&'static str>,
    /// The CLI's own words for the failure.
    pub error: Option<String>,
    /// When a usage limit resets, in Unix seconds, when the CLI says.
    pub resets_at: Option<u64>,
    /// What the run used, as far as the tool says.
    pub usage: Usage,
}

/// What a run used. Each tool reports different things, so every field may be missing.
#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    /// The model that answered, as the tool names it ("claude-sonnet-5-5").
    pub model: Option<String>,
    /// Tokens read in all, and how many of those came from the cache.
    pub input: Option<u64>,
    pub cached: Option<u64>,
    /// Tokens written, and how many of those were thinking.
    pub output: Option<u64>,
    pub thinking: Option<u64>,
    /// The most it held at once, and the most it can hold.
    pub context: Option<u64>,
    pub window: Option<u64>,
    /// Rounds of reading and writing.
    pub turns: Option<u64>,
}

/// Where a run's progress goes as it comes: the answer (true when the text replaces what came before), each tool call
/// (kind, what on, and a round number that calls made at once share) and the model's thinking.
pub struct Events<'a> {
    pub text: &'a dyn Fn(&str, bool),
    pub step: &'a dyn Fn(&str, &str, u32),
    pub think: &'a dyn Fn(&str),
}

impl Reply {
    pub(crate) fn failed(problem: &'static str, error: impl Into<String>) -> Self {
        Reply { problem: Some(problem), error: Some(error.into()), ..Default::default() }
    }
}

/// Text and diagnostics from one CLI's JSON stream.
#[derive(Default)]
struct Reader {
    text: String,
    streamed: bool,
    result_error: Option<String>,
    notice: Option<String>,
    rejected: bool,
    resets_at: Option<u64>,
    /// The answer is complete: nothing more to read (Antigravity's session stays open after its result).
    done: bool,
    /// The CLI said it succeeded, whatever its exit code (Antigravity is ended once its result is in).
    answered: bool,
    /// Tool calls not yet sent: ("read", "kit.css", 2), ("find", "*.css", 3). Calls in the same round were made at once.
    steps: Vec<(&'static str, String, u32)>,
    round: u32,
    /// The message the last tool call came in, to tell rounds apart.
    msg: String,
    /// Gemini CLI: tool calls since its last words, which share a round.
    in_tools: bool,
    /// Thinking not yet sent, and whether any came before (thoughts from separate rounds get a blank line between).
    thought: String,
    thought_any: bool,
    /// Tokens read for the message being written, for the most the model held at once.
    turn_in: u64,
    usage: Usage,
}

/// Adds a count to one that may not have come yet.
fn add(a: Option<u64>, b: Option<u64>) -> Option<u64> {
    match (a, b) {
        (None, None) => None,
        (a, b) => Some(a.unwrap_or(0) + b.unwrap_or(0)),
    }
}

/// A tool call as a status: read, find, search or work, and what on.
fn tool_status(name: &str, input: &Value) -> (&'static str, String) {
    let arg = |keys: &[&str]| keys.iter().find_map(|k| input.get(*k).and_then(Value::as_str)).unwrap_or("").to_string();
    let base = |p: String| p.rsplit(['/', '\\']).next().unwrap_or("").to_string();
    match name.to_ascii_lowercase().as_str() {
        "read" | "read_file" | "read_many_files" => ("read", base(arg(&["file_path", "absolute_path", "path"]))),
        "glob" | "ls" | "list_directory" => ("find", arg(&["pattern", "path"])),
        "grep" | "search_file_content" | "grep_search" => ("search", arg(&["pattern", "query"])),
        _ => ("work", name.to_string()),
    }
}

impl Reader {
    fn think(&mut self, t: &str, new_block: bool) {
        if new_block && self.thought_any {
            self.thought.push_str("\n\n");
        }
        if !t.is_empty() {
            self.thought.push_str(t);
            self.thought_any = true;
        }
    }

    /// Reads one event and returns any answer text it adds, with true when that text replaces what came before.
    fn line(&mut self, tool: &str, line: &str) -> Option<(String, bool)> {
        let v: Value = serde_json::from_str(line.trim()).ok()?;
        if tool == "agy" {
            return self.agy(&v);
        }
        self.event(tool, &v)
    }

    /// Antigravity: {"event":"step_update","step_update":{..}} lines with the answer in `text_delta`, then one
    /// {"event":"result","result":{"status","response","error"}} with the whole answer.
    fn agy(&mut self, v: &Value) -> Option<(String, bool)> {
        let field = |path| v.pointer(path).and_then(Value::as_str);
        match field("/event")? {
            "step_update" if field("/step_update/step_type") == Some("agent_response") => {
                field("/step_update/text_delta").filter(|t| !t.is_empty()).map(|t| (t.to_string(), false))
            }
            "result" => {
                self.done = true;
                self.usage.turns = v.pointer("/result/num_turns").and_then(Value::as_u64);
                if field("/result/status") == Some("SUCCESS") {
                    self.answered = true;
                    field("/result/response").filter(|t| !t.trim().is_empty()).map(|t| (t.to_string(), true))
                } else {
                    let error = field("/result/error").filter(|e| !e.trim().is_empty()).or(field("/result/status")).unwrap_or("ERROR");
                    self.result_error = Some(error.to_string());
                    None
                }
            }
            _ => None,
        }
    }

    /// Text from one event, with true when it replaces the text so far. Only the last message is the answer: words
    /// written before reading a file ("Let me look at the stylesheet") are replaced by what comes after.
    fn event(&mut self, tool: &str, v: &Value) -> Option<(String, bool)> {
        let field = |path| v.pointer(path).and_then(Value::as_str);
        let count = |path| v.pointer(path).and_then(Value::as_u64);
        let kind = field("/type")?;
        if tool == "gemini" && kind == "message" {
            self.in_tools = false;
        }
        match (tool, kind) {
            ("claude", "system") if field("/subtype") == Some("init") => {
                self.usage.model = field("/model").map(String::from);
                None
            }
            ("claude", "stream_event") => {
                let ev = v.get("event")?;
                match ev.get("type")?.as_str()? {
                    "message_start" => {
                        let n = |k: &str| ev.pointer(&format!("/message/usage/{k}")).and_then(Value::as_u64).unwrap_or(0);
                        self.turn_in = n("input_tokens") + n("cache_read_input_tokens") + n("cache_creation_input_tokens");
                        if let Some(m) = ev.pointer("/message/model").and_then(Value::as_str) {
                            self.usage.model.get_or_insert_with(|| m.to_string());
                        }
                        (!self.text.is_empty()).then(|| (String::new(), true))
                    }
                    "message_delta" => {
                        let held = self.turn_in + ev.pointer("/usage/output_tokens").and_then(Value::as_u64).unwrap_or(0);
                        if held > 0 {
                            self.usage.context = Some(self.usage.context.unwrap_or(0).max(held));
                        }
                        None
                    }
                    "content_block_start" => {
                        if ev.pointer("/content_block/type").and_then(Value::as_str) == Some("thinking") {
                            self.think("", true);
                        }
                        None
                    }
                    "content_block_delta" => {
                        let d = ev.get("delta")?;
                        match d.get("type")?.as_str()? {
                            "text_delta" => {
                                self.streamed = true;
                                Some((d.get("text")?.as_str()?.to_string(), false))
                            }
                            "thinking_delta" => {
                                self.think(d.get("thinking")?.as_str()?, false);
                                None
                            }
                            _ => None,
                        }
                    }
                    _ => None,
                }
            }
            // tool calls, and the whole message when no deltas came. A message's blocks come as separate events with
            // the same id, so calls with the same id were made at once.
            ("claude", "assistant") => {
                let parts = v.get("message")?.get("content")?.as_array()?;
                let calls: Vec<&Value> = parts.iter().filter(|p| p.get("type").and_then(Value::as_str) == Some("tool_use")).collect();
                if !calls.is_empty() {
                    let id = field("/message/id").unwrap_or("");
                    if id.is_empty() || id != self.msg {
                        self.round += 1;
                        self.msg = id.to_string();
                    }
                    for p in calls {
                        let (kind, on) = tool_status(p.get("name").and_then(Value::as_str).unwrap_or(""), p.get("input").unwrap_or(&Value::Null));
                        self.steps.push((kind, on, self.round));
                    }
                }
                if self.streamed {
                    return None;
                }
                let t: String = parts
                    .iter()
                    .filter(|p| p.get("type").and_then(Value::as_str) == Some("text"))
                    .filter_map(|p| p.get("text").and_then(Value::as_str))
                    .collect();
                (!t.is_empty()).then_some((t, true))
            }
            ("claude", "rate_limit_event") => {
                self.rejected = field("/rate_limit_info/status") == Some("rejected");
                self.resets_at = v.pointer("/rate_limit_info/resetsAt").and_then(Value::as_u64);
                None
            }
            ("claude", "result") => {
                let cached = count("/usage/cache_read_input_tokens");
                if let Some(i) = count("/usage/input_tokens") {
                    self.usage.input = Some(i + cached.unwrap_or(0) + count("/usage/cache_creation_input_tokens").unwrap_or(0));
                }
                self.usage.cached = cached;
                self.usage.output = count("/usage/output_tokens");
                self.usage.thinking = count("/usage/output_tokens_details/thinking_tokens").filter(|n| *n > 0);
                self.usage.turns = count("/num_turns");
                // the model that did the work; a small one may also show for the CLI's own odd jobs
                let main = v.get("modelUsage").and_then(Value::as_object).and_then(|o| {
                    o.iter().max_by_key(|(_, m)| m.get("outputTokens").and_then(Value::as_u64).unwrap_or(0))
                });
                if let Some((name, m)) = main {
                    self.usage.window = m.get("contextWindow").and_then(Value::as_u64);
                    self.usage.model.get_or_insert_with(|| name.clone());
                }
                if v.get("is_error").and_then(Value::as_bool) == Some(true) {
                    let error = field("/result").filter(|s| !s.trim().is_empty()).or(field("/errors/0"));
                    self.result_error = Some(error.map(String::from).unwrap_or_else(|| field("/subtype").unwrap_or("error").replace('_', " ")));
                    return None;
                }
                // the final text, when the stream had none
                let r = field("/result").unwrap_or("");
                (self.text.is_empty() && !r.is_empty()).then(|| (r.to_string(), false))
            }
            ("codex", "item.completed") if field("/item/type") == Some("agent_message") => field("/item/text").map(|t| (t.to_string(), true)),
            ("codex", "item.completed") if field("/item/type") == Some("reasoning") => {
                self.think(field("/item/text").unwrap_or(""), true);
                None
            }
            ("codex", "turn.completed") => {
                self.usage.input = add(self.usage.input, count("/usage/input_tokens"));
                self.usage.cached = add(self.usage.cached, count("/usage/cached_input_tokens"));
                self.usage.output = add(self.usage.output, count("/usage/output_tokens"));
                self.usage.thinking = add(self.usage.thinking, count("/usage/reasoning_output_tokens"));
                self.usage.turns = add(self.usage.turns, Some(1));
                None
            }
            ("codex", "turn.failed") => {
                self.result_error = Some(field("/error/message").unwrap_or("The turn failed.").into());
                None
            }
            ("gemini", "message") if field("/role") == Some("assistant") => field("/content").map(|t| (t.to_string(), false)),
            ("gemini", "init") => {
                self.usage.model = field("/model").map(String::from);
                None
            }
            ("gemini", "tool_use") => {
                if !self.in_tools {
                    self.round += 1;
                    self.in_tools = true;
                }
                let (kind, on) = tool_status(field("/tool_name").unwrap_or(""), v.get("parameters").unwrap_or(&Value::Null));
                self.steps.push((kind, on, self.round));
                (!self.text.is_empty()).then(|| (String::new(), true))
            }
            ("gemini", "result") => {
                self.usage.input = count("/stats/input_tokens").or(self.usage.input);
                self.usage.cached = count("/stats/cached").or(self.usage.cached);
                self.usage.output = count("/stats/output_tokens").or(self.usage.output);
                if field("/status") == Some("error") {
                    self.result_error = Some(field("/error/message").unwrap_or("The request failed.").into());
                }
                None
            }
            ("codex" | "gemini", "error") => {
                self.notice = field("/message").map(String::from);
                None
            }
            _ => None,
        }
    }

    fn finish(self, ok: bool, stderr: &str) -> Reply {
        let ok = ok || self.answered;
        if ok && !self.rejected && self.result_error.is_none() && !self.text.trim().is_empty() {
            return Reply { text: self.text, usage: self.usage, ..Default::default() };
        }
        let error = self.result_error.as_deref().unwrap_or("");
        let notice = self.notice.as_deref().unwrap_or("");
        let diagnostic = format!("{error}\n{notice}\n{stderr}");
        let message: String = [error, notice, stderr.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("")]
            .into_iter()
            .map(str::trim)
            .find(|l| !l.is_empty())
            .unwrap_or("It stopped without answering.")
            .chars()
            .take(400)
            .collect();
        let problem = if self.rejected || is_usage_limit(&diagnostic) { "limit" } else { problem_of(&diagnostic) };
        Reply { text: self.text, problem: Some(problem), error: Some(message), resets_at: self.resets_at.filter(|_| problem == "limit"), usage: self.usage }
    }
}

fn is_usage_limit(message: &str) -> bool {
    let m = message.to_ascii_lowercase();
    [
        "rate limit", "rate_limit", "usage limit", "usage_limit", "limit reached", "hit your limit", "hit your 5-hour limit",
        "hit your weekly limit", "quota", "resource_exhausted", "too many requests", "status 429", "credits_required",
    ]
    .iter()
    .any(|w| m.contains(w))
}

/// What usually went wrong, from the CLI's words.
fn problem_of(message: &str) -> &'static str {
    let m = message.to_lowercase();
    if ["login", "log in", "sign in", "authenticat", "auth method", "api key", "gemini_api_key", "credential", "unauthorized", "401", "oauth", "token"].iter().any(|k| m.contains(k)) {
        "signin"
    } else if m.contains("unknown option") || m.contains("unexpected argument") || m.contains("unrecognized") {
        "outdated"
    } else if m.contains("node") && (m.contains("not recognized") || m.contains("not found")) {
        "node"
    } else {
        "failed"
    }
}

static SEQ: AtomicU64 = AtomicU64::new(0);

/// Asks `tool` with `system` as its rules and `prompt` as the request, with `files` to refer to, in a folder of its own
/// under `dir` (the app's AI folder) that goes away afterwards, with the model and thinking level in `opts`. `ev` gets
/// the answer, each file it reads or searches and its thinking as they come.
#[allow(clippy::too_many_arguments)]
pub fn ask(tool: &str, prompt: &str, system: &str, dir: &Path, files: &[JobFile], opts: &Options, run: &Run, ev: &Events) -> Reply {
    let Some(tool) = TOOLS.into_iter().find(|t| *t == tool) else { return Reply::failed("failed", format!("Unknown chat tool: {tool}")) };
    let Some(exe) = locate(tool) else { return Reply::failed("missing", format!("{} isn't on this PC.", name(tool))) };
    let n = SEQ.fetch_add(1, Ordering::Relaxed);
    let job = dir.join(format!("run-{}-{n}", std::process::id()));
    if let Err(e) = std::fs::create_dir_all(&job) {
        return Reply::failed("failed", format!("Couldn't make the AI folder: {e}"));
    }
    let sys_file = dir.join(format!("system-{}-{n}.md", std::process::id()));
    let reply = ask_in(tool, &exe, prompt, system, &job, &sys_file, files, opts, run, ev);
    let _ = std::fs::remove_file(&sys_file);
    let _ = std::fs::remove_dir_all(&job);
    reply
}

#[allow(clippy::too_many_arguments)]
fn ask_in(tool: &str, exe: &Path, prompt: &str, system: &str, job: &Path, sys_file: &Path, files: &[JobFile], opts: &Options, run: &Run, ev: &Events) -> Reply {
    // a CLI that reads files gets them as a folder; if writing it fails, or for the others, they're pasted in
    let written = if reads_files(tool) && !files.is_empty() { ai_files::write(job, files).ok().filter(|w| !w.is_empty()) } else { None };
    let reads = written.is_some();
    let request = match &written {
        Some(w) => ai_files::listed(prompt, w),
        None => ai_files::inlined(prompt, files, paste_budget(tool)),
    };
    let input = if tool == "claude" {
        if let Err(e) = std::fs::write(sys_file, system) {
            return Reply::failed("failed", format!("Couldn't write the instructions: {e}"));
        }
        request
    } else {
        let how = if reads {
            "Read the reference files listed in the request when they help, with your read-only file tools. Don't change, create or delete files."
        } else {
            "Answer directly from the request below and do not call tools."
        };
        let text = format!("{system}\n\n{how}\n\n=====\n\n{request}");
        if tool == "agy" {
            format!("{}\n", serde_json::json!({ "event": "user", "message": { "content": text } }))
        } else {
            text
        }
    };
    let mut cmd = build(tool, exe, sys_file, reads, opts, true);
    cmd.current_dir(job);
    let reply = read_run(tool, cmd, input.clone(), run, TIMEOUT, ev);
    // an older Claude Code that doesn't know the newer options is asked again without them
    let newer_refused = reply.problem == Some("outdated") && reply.error.as_deref().is_some_and(|e| e.contains("thinking-display") || e.contains("effort"));
    if tool == "claude" && newer_refused && !run.is_stopped() {
        let mut cmd = build(tool, exe, sys_file, reads, opts, false);
        cmd.current_dir(job);
        return read_run(tool, cmd, input, run, TIMEOUT, ev);
    }
    reply
}

fn read_run(tool: &str, mut cmd: Command, input: String, run: &Run, timeout: Duration, ev: &Events) -> Reply {
    if run.is_stopped() {
        return Reply::failed("stopped", "Stopped");
    }
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return Reply::failed("failed", format!("Couldn't start {}: {e}", name(tool))),
    };
    let pid = child.id();
    *run.pid.lock().unwrap() = Some(pid);
    // Stop pressed while it started
    if run.is_stopped() {
        kill_tree(pid);
    }
    // the prompt goes in on its own thread, so a full stdout pipe can't stall it; dropping stdin ends the input
    if let Some(mut si) = child.stdin.take() {
        std::thread::spawn(move || {
            let _ = si.write_all(input.as_bytes());
        });
    }
    let stderr = child.stderr.take().map(|mut se| {
        std::thread::spawn(move || {
            let mut bytes = Vec::new();
            let _ = se.read_to_end(&mut bytes);
            String::from_utf8_lossy(&bytes).into_owned()
        })
    });
    // past the timeout the run is ended; finishing first sends `done` and the watchdog goes away
    let (done, finished) = mpsc::channel::<()>();
    let timed_out = Arc::new(AtomicBool::new(false));
    let watchdog = {
        let timed_out = timed_out.clone();
        std::thread::spawn(move || {
            if let Err(mpsc::RecvTimeoutError::Timeout) = finished.recv_timeout(timeout) {
                timed_out.store(true, Ordering::Relaxed);
                kill_tree(pid);
            }
        })
    };
    (ev.text)("", true);
    let mut r = Reader::default();
    if let Some(out) = child.stdout.take() {
        for line in BufReader::new(out).lines().map_while(std::result::Result::ok) {
            if let Some((text, reset)) = r.line(tool, &line) {
                if reset {
                    r.text.clear();
                }
                r.text.push_str(&text);
                (ev.text)(&text, reset);
            }
            for (kind, on, round) in r.steps.drain(..) {
                (ev.step)(kind, &on, round);
            }
            if !r.thought.is_empty() {
                (ev.think)(&std::mem::take(&mut r.thought));
            }
            if r.done {
                break;
            }
        }
    }
    // the answer is in but the CLI is still open (Antigravity keeps its session): end it
    if r.done && matches!(child.try_wait(), Ok(None)) {
        kill_tree(pid);
    }
    let status = child.wait();
    let _ = done.send(());
    let _ = watchdog.join();
    run.pid.lock().unwrap().take();
    let stderr = stderr.and_then(|t| t.join().ok()).unwrap_or_default();
    if run.is_stopped() {
        return Reply { text: r.text, usage: r.usage, ..Reply::failed("stopped", "Stopped") };
    }
    if timed_out.load(Ordering::Relaxed) {
        return Reply { text: r.text, usage: r.usage, ..Reply::failed("timeout", format!("No answer after {} minutes.", timeout.as_secs() / 60)) };
    }
    r.finish(status.is_ok_and(|s| s.success()), &stderr)
}

/// Opens the CLI in a console window of its own so the user can sign in: Codex's `login`, and the others' first run,
/// which asks how to sign in.
pub fn sign_in(tool: &str, dir: &Path) -> Result<()> {
    let tool = TOOLS.into_iter().find(|t| *t == tool).ok_or_else(|| Error::Invalid(format!("Unknown chat tool: {tool}")))?;
    let exe = locate(tool).ok_or_else(|| Error::Invalid(format!("{} isn't on this PC.", name(tool))))?;
    std::fs::create_dir_all(dir)?;
    let mut cmd = Command::new(&exe);
    if tool == "codex" {
        cmd.arg("login");
    }
    prepare(&mut cmd, &exe);
    cmd.current_dir(dir);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
        cmd.creation_flags(CREATE_NEW_CONSOLE);
    }
    cmd.spawn().map_err(|e| Error::Invalid(format!("Couldn't open {}: {e}", name(tool))))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read(tool: &str, lines: &[&str]) -> Reader {
        let mut r = Reader::default();
        for l in lines {
            if let Some((t, reset)) = r.line(tool, l) {
                if reset {
                    r.text.clear();
                }
                r.text.push_str(&t);
            }
        }
        r
    }

    #[test]
    fn reads_antigravitys_stream_and_takes_its_whole_answer() {
        let r = read("agy", &[
            r#"{"event":"init","conversation_id":"c","init":{"cwd":"x","tools":["run_command"],"permission_mode":"request-review"}}"#,
            r#"{"event":"step_update","step_update":{"conversation_id":"c","step_index":0,"state":"DONE","step_type":"user_input"}}"#,
            r#"{"event":"step_update","step_update":{"conversation_id":"c","step_index":3,"state":"ACTIVE","step_type":"agent_response","text_delta":"Git reb"}}"#,
            r#"{"event":"step_update","step_update":{"conversation_id":"c","step_index":3,"state":"DONE","step_type":"agent_response","text_delta":"ase moves commits.\n"}}"#,
            r#"{"event":"result","result":{"conversation_id":"c","status":"SUCCESS","response":"Git rebase moves commits.\n","num_turns":1}}"#,
        ]);
        assert!(r.done);
        let reply = r.finish(false, "");
        assert_eq!(reply.text, "Git rebase moves commits.\n");
        assert!(reply.problem.is_none());
    }

    #[test]
    fn reads_antigravitys_failures() {
        let r = read("agy", &[r#"{"event":"result","result":{"status":"ERROR","response":"","error":"authentication required"}}"#]);
        assert_eq!(r.finish(false, "").problem, Some("signin"));
        let r = read("agy", &[r#"{"event":"result","result":{"status":"ERROR","response":"","error":"weekly quota exhausted"}}"#]);
        assert_eq!(r.finish(false, "").problem, Some("limit"));
    }

    #[test]
    fn reads_claude_codes_stream() {
        let r = read("claude", &[
            r#"{"type":"system","subtype":"init"}"#,
            r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hel"}}}"#,
            r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"lo"}}}"#,
            r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]}}"#,
            r#"{"type":"result","subtype":"success","is_error":false,"result":"Hello"}"#,
        ]);
        let reply = r.finish(true, "");
        assert_eq!(reply.text, "Hello");
        assert!(reply.problem.is_none());
    }

    #[test]
    fn uses_the_whole_message_without_deltas() {
        let r = read("claude", &[r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Hi"},{"type":"tool_use"}]}}"#]);
        assert_eq!(r.text, "Hi");
    }

    #[test]
    fn keeps_only_the_message_after_reading_files() {
        let r = read("claude", &[
            r#"{"type":"stream_event","event":{"type":"message_start","message":{}}}"#,
            r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Let me read the stylesheet. ```css\n.x{}\n```"}}}"#,
            r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"C:\\run\\styles\\kit.css"}}]}}"#,
            r#"{"type":"stream_event","event":{"type":"message_start","message":{}}}"#,
            r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"```json\n{}\n```"}}}"#,
        ]);
        assert_eq!(r.text, "```json\n{}\n```");
        let mut r = Reader::default();
        r.line("claude", r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"C:\\run\\styles\\kit.css"}}]}}"#);
        assert_eq!(r.steps.pop(), Some(("read", "kit.css".to_string(), 1)));
        r.line("gemini", r#"{"type":"tool_use","tool_name":"search_file_content","tool_id":"1","parameters":{"pattern":"--accent"}}"#);
        assert_eq!(r.steps.pop(), Some(("search", "--accent".to_string(), 2)));
    }

    #[test]
    fn groups_calls_made_at_once_and_reads_thinking_and_usage() {
        let r = read("claude", &[
            r#"{"type":"system","subtype":"init","model":"claude-sonnet-5-5"}"#,
            r#"{"type":"stream_event","event":{"type":"message_start","message":{"model":"claude-sonnet-5-5","usage":{"input_tokens":10,"cache_read_input_tokens":3000,"cache_creation_input_tokens":0}}}}"#,
            r#"{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"thinking"}}}"#,
            r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Which files?"}}}"#,
            r#"{"type":"assistant","message":{"id":"m1","content":[{"type":"tool_use","name":"Read","input":{"file_path":"a/kit.css"}}]}}"#,
            r#"{"type":"assistant","message":{"id":"m1","content":[{"type":"tool_use","name":"Read","input":{"file_path":"a/base.css"}}]}}"#,
            r#"{"type":"stream_event","event":{"type":"message_delta","usage":{"output_tokens":90}}}"#,
            r#"{"type":"stream_event","event":{"type":"message_start","message":{"usage":{"input_tokens":5,"cache_read_input_tokens":9000}}}}"#,
            r#"{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"thinking"}}}"#,
            r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Now the theme."}}}"#,
            r#"{"type":"assistant","message":{"id":"m2","content":[{"type":"tool_use","name":"Grep","input":{"pattern":"--accent"}}]}}"#,
            r#"{"type":"stream_event","event":{"type":"message_delta","usage":{"output_tokens":40}}}"#,
            r#"{"type":"result","subtype":"success","is_error":false,"result":"","num_turns":3,"usage":{"input_tokens":15,"cache_read_input_tokens":12000,"cache_creation_input_tokens":100,"output_tokens":130},"modelUsage":{"claude-haiku-5-5":{"outputTokens":4,"contextWindow":200000},"claude-sonnet-5-5":{"outputTokens":130,"contextWindow":1000000}}}"#,
        ]);
        let rounds: Vec<u32> = r.steps.iter().map(|s| s.2).collect();
        assert_eq!(rounds, [1, 1, 2]);
        assert_eq!(r.thought, "Which files?\n\nNow the theme.");
        let u = &r.usage;
        assert_eq!(u.model.as_deref(), Some("claude-sonnet-5-5"));
        assert_eq!((u.input, u.cached, u.output, u.turns), (Some(12115), Some(12000), Some(130), Some(3)));
        assert_eq!((u.context, u.window), (Some(9045), Some(1_000_000)));

        let r = read("codex", &[
            r#"{"type":"item.completed","item":{"type":"reasoning","text":"Plan the names."}}"#,
            r#"{"type":"item.completed","item":{"type":"agent_message","text":"Done"}}"#,
            r#"{"type":"turn.completed","usage":{"input_tokens":2000,"cached_input_tokens":500,"output_tokens":300,"reasoning_output_tokens":120}}"#,
        ]);
        assert_eq!(r.thought, "Plan the names.");
        assert_eq!((r.usage.input, r.usage.cached, r.usage.thinking), (Some(2000), Some(500), Some(120)));
    }

    #[test]
    fn passes_only_sensible_options() {
        let o = Options { model: "opus".into(), effort: "max".into() };
        assert_eq!((o.model(), o.effort("claude"), o.effort("codex")), (Some("opus"), Some("max"), None));
        let o = Options { model: "opus --dangerously-skip-permissions".into(), effort: "huge".into() };
        assert_eq!((o.model(), o.effort("claude")), (None, None));
        assert_eq!(Options::default().model(), None);
    }

    #[test]
    fn names_a_missing_sign_in() {
        let r = read("claude", &[r#"{"type":"result","is_error":true,"subtype":"success","result":"Invalid API key · Please run /login"}"#]);
        let reply = r.finish(false, "");
        assert_eq!(reply.problem, Some("signin"));
        assert!(reply.error.unwrap().contains("/login"));
    }

    #[test]
    fn names_usage_limits_with_their_reset_time() {
        let r = read("claude", &[
            r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Part"}}}"#,
            r#"{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","resetsAt":1900000000}}"#,
        ]);
        let reply = r.finish(true, "");
        assert_eq!(reply.problem, Some("limit"));
        assert_eq!(reply.resets_at, Some(1900000000));
        assert_eq!(reply.text, "Part");

        let r = read("codex", &[r#"{"type":"turn.failed","error":{"message":"You've hit your usage limit. Try again later."}}"#]);
        assert_eq!(r.finish(false, "").problem, Some("limit"));
        let r = read("gemini", &[r#"{"type":"result","status":"error","error":{"message":"RESOURCE_EXHAUSTED"}}"#]);
        assert_eq!(r.finish(false, "").problem, Some("limit"));
    }

    #[test]
    fn a_warning_on_stderr_does_not_spoil_an_answer() {
        for (tool, line) in [
            ("codex", r#"{"type":"item.completed","item":{"type":"agent_message","text":"What is a rate limit?"}}"#),
            ("gemini", r#"{"type":"message","role":"assistant","content":"What is a rate limit?","delta":true}"#),
        ] {
            let reply = read(tool, &[line]).finish(true, "A warning about the rate limit");
            assert_eq!(reply.text, "What is a rate limit?");
            assert!(reply.problem.is_none());
        }
    }

    #[test]
    fn reads_other_failures() {
        assert_eq!(problem_of("error: unknown option '--strict-mcp-config'"), "outdated");
        assert_eq!(problem_of("'node' is not recognized as an internal or external command"), "node");
        assert_eq!(problem_of("Something odd"), "failed");
        let reply = Reader::default().finish(false, "first\nlast line\n\n");
        assert_eq!(reply.error.as_deref(), Some("last line"));
    }

    #[test]
    fn claude_code_runs_without_tools_or_user_settings() {
        let exe = PathBuf::from(if cfg!(windows) { "claude.exe" } else { "claude" });
        let cmd = build("claude", &exe, Path::new("sys.md"), false, &Options::default(), true);
        let args: Vec<String> = cmd.get_args().map(|a| a.to_string_lossy().into_owned()).collect();
        assert!(args.windows(2).any(|w| w[0] == "--tools" && w[1].is_empty()));
        assert!(args.windows(2).any(|w| w[0] == "--model" && w[1] == "sonnet"));
        assert!(!args.iter().any(|a| a == "--effort"));
        // with reference files: reading tools only, and the picked model and thinking level
        let cmd = build("claude", &exe, Path::new("sys.md"), true, &Options { model: "opus".into(), effort: "high".into() }, true);
        let args: Vec<String> = cmd.get_args().map(|a| a.to_string_lossy().into_owned()).collect();
        assert!(args.windows(2).any(|w| w[0] == "--tools" && w[1] == "Read,Glob,Grep"));
        assert!(args.windows(2).any(|w| w[0] == "--allowedTools" && w[1] == "Read,Glob,Grep"));
        assert!(args.windows(2).any(|w| w[0] == "--setting-sources" && w[1].is_empty()));
        assert!(args.iter().any(|a| a == "--strict-mcp-config"));
        assert!(args.windows(2).any(|w| w[0] == "--model" && w[1] == "opus"));
        assert!(args.windows(2).any(|w| w[0] == "--effort" && w[1] == "high"));
        assert!(args.windows(2).any(|w| w[0] == "--thinking-display" && w[1] == "summarized"));
        // an older Claude Code gets neither
        let cmd = build("claude", &exe, Path::new("sys.md"), true, &Options { model: "opus".into(), effort: "high".into() }, false);
        assert!(!cmd.get_args().any(|a| a == "--effort" || a == "--thinking-display"));
        assert!(cmd.get_envs().any(|(k, v)| k == "ANTHROPIC_API_KEY" && v.is_none()));
    }
}
