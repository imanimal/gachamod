// The AI helper: hands work that can't be fully automated (a theme from a description, renaming 300 mods, making a
// mod's keys work only while its character is on screen when the ini is too odd to patch) to the chatbot the user
// already uses, at no cost to anyone but the user's own plan: the app writes the prompt with everything the chatbot
// needs. When the picked chatbot's CLI is on this PC (Claude Code for Claude, Codex for ChatGPT, Antigravity or Gemini
// CLI for Gemini) it asks it directly and the answer streams into the window, on the plan the user signed in with.
// Gemini also answers in the app with a free key from Google AI Studio the user pasted once. Otherwise, or with the
// CLI turned off (`aiCliPref`), it copies the prompt and opens the chatbot's website (with the prompt already in
// the box where the site allows it), and the user pastes the answer back. Either way the app checks the answer, shows
// what would change and applies it with Undo. Nothing is sent anywhere without the user clicking. How much of this shows is the user's call: off (no AI element anywhere), useful (default: only entry
// points that save work) or all. Adult mods stay out of prompts unless the user turns that off, and nothing in
// a prompt says a mod is for adults: chatbots refuse a whole request over one explicit name or label.
// Owner: SETTINGS/AI area.
import { useEffect, useSyncExternalStore } from "react";
import type { GameId } from "./api";
import { call, listen } from "./tauri";
import { emitApp } from "./store";
import { jsonPref, pref } from "./prefs";
import { t } from "./i18n";

export type AiShow = "off" | "useful" | "all";
export const aiShowPref = pref<AiShow>("ai.show", "useful", (r) => (r === "off" || r === "useful" || r === "all" ? r : undefined), (v) => v);
export const useAiShow = () => aiShowPref.use();
export const AI_SHOW_LABEL: Record<AiShow, string> = { off: t("Off"), useful: t("Most useful"), all: t("Everything") };

/** Whether an AI entry point shows. "useful" ones (fix my keys, rename these mods) show unless AI is off; "extra"
 *  ones (write a description, suggest tags) only when the user picked "all". */
export function aiShown(weight: "useful" | "extra", show: AiShow = aiShowPref.get()): boolean {
  return show === "all" || (show === "useful" && weight === "useful");
}

export type ChatbotId = "chatgpt" | "claude" | "gemini" | "copilot" | "grok" | "other";
/** A chat CLI the helper can run on this PC. "agy" is Antigravity CLI, Google's free one since Gemini CLI's free tier
 *  ended (June 2026). */
export type CliId = "claude" | "codex" | "agy" | "gemini";
/** What answers in the app: a chat CLI on this PC, or Gemini with the user's free key. */
export type AppTool = CliId | "gemini-api";
export const CLI_NAME: Record<AppTool, string> = { claude: "Claude Code", codex: "Codex", agy: "Antigravity", gemini: "Gemini CLI", "gemini-api": "Gemini" };
const isCli = (x: string): x is CliId => x === "claude" || x === "codex" || x === "agy" || x === "gemini";
/** Ids saved while each CLI was a chatbot of its own, read as the chatbot it belongs to. */
const CLI_IDS: Record<string, ChatbotId> = { "claude-code": "claude", codex: "chatgpt", "gemini-cli": "gemini" };
export const chatbotPref = pref<ChatbotId | "">("ai.chatbot", "", (r) => {
  const id: string = CLI_IDS[r] ?? r;
  return CHATBOTS.some((c) => c.id === id) || id === "" ? (id as ChatbotId | "") : undefined;
}, (v) => v);
/** Ask the chatbot's CLI when it's on this PC (on by default). Off opens the website even then. */
export const aiCliPref = pref<boolean>("ai.useCli", true, (r) => (r === "1" ? true : r === "0" ? false : undefined), (v) => (v ? "1" : "0"));
/** The web address of the user's own chatbot when they picked "other" (empty: just copy the prompt). */
export const chatbotUrlPref = pref<string>("ai.chatbotUrl", "", (r) => (r === "" || /^https?:\/\//i.test(r) ? r : undefined), (v) => v);
/** Keep adult mods' names, folders and tags out of prompts (on by default). */
export const aiHideAdultPref = pref<boolean>("ai.hideAdult", true, (r) => (r === "1" ? true : r === "0" ? false : undefined), (v) => (v ? "1" : "0"));

/** Words that make a name explicit even when the mod isn't marked for adults. */
const ADULT_WORDS = /(^|[^a-z])(nsfw|r-?18|18\+|nude|nudity|naked|lewd|hentai|porn\w*|sex\w*|explicit|topless|bottomless|futa\w*|ahegao|lingerie|boobs?|breasts?|nipples?|genitals?|uncensored)([^a-z]|$)/i;

/** True when a mod's name stays out of prompts: it's marked for adults, or its name, folder or tags read as explicit.
 *  Always false when the user turned hiding off. */
export function hideFromAi(m: { name: string; folder?: string | null; tags?: string[]; nsfw?: boolean }): boolean {
  if (!aiHideAdultPref.get()) return false;
  return !!m.nsfw || ADULT_WORDS.test(m.name) || ADULT_WORDS.test(m.folder ?? "") || (m.tags ?? []).some((tag) => ADULT_WORDS.test(tag));
}

/** Explicit words inside ini file and section names ("BelleNudeBody"), matched anywhere since names run together. */
const ADULT_PARTS = /(?<![a-z])r-?18(?!\d)|18\+|nsfw|nudity|nude|naked|lewd|hentai|porn|sex|explicit|topless|bottomless|futa|ahegao|lingerie|boob|breast|nipple|genital|uncensored/gi;
/** A file or section name with explicit words swapped for "Alt" while hiding is on. */
export const neutralName = (s: string) => (aiHideAdultPref.get() ? s.replace(ADULT_PARTS, "Alt") : s);

/** Why a request can't be made when every mod in it stays out of prompts. Names the setting, so lib/places.ts adds
 *  its button. */
export const nothingToSendNote = (n: number) =>
  n === 1
    ? t("Nothing to send: \"Hide adult mods from the chatbot\" keeps this mod out of prompts.")
    : t("Nothing to send: \"Hide adult mods from the chatbot\" keeps these mods out of prompts.");

/** "done" once the first-run suggestion was answered or dismissed. */
export const aiIntroPref = pref<string>("ai.intro", "", (r) => r, (v) => v);

export interface Chatbot {
  id: ChatbotId;
  name: string;
  /** Where a new chat starts. */
  url: string;
  /** A link that opens a new chat with the prompt already typed, for sites that take one. */
  prefill?: (prompt: string) => string;
  /** Its chat CLIs on the same plan, the first one on this PC used. The app asks it and the answer shows in the window. */
  clis?: CliId[];
}

export const CHATBOTS: Chatbot[] = [
  { id: "chatgpt", name: "ChatGPT", url: "https://chatgpt.com/", prefill: (q) => `https://chatgpt.com/?q=${encodeURIComponent(q)}`, clis: ["codex"] },
  { id: "claude", name: "Claude", url: "https://claude.ai/new", prefill: (q) => `https://claude.ai/new?q=${encodeURIComponent(q)}`, clis: ["claude"] },
  { id: "gemini", name: "Gemini", url: "https://gemini.google.com/app", clis: ["agy", "gemini"] },
  { id: "copilot", name: "Copilot", url: "https://copilot.microsoft.com/" },
  { id: "grok", name: "Grok", url: "https://grok.com/", prefill: (q) => `https://grok.com/?q=${encodeURIComponent(q)}` },
  { id: "other", name: t("Other"), url: "" },
];
export const chatbotOf = (id: ChatbotId | "" | null | undefined): Chatbot | undefined => CHATBOTS.find((c) => c.id === id);

/** A chatbot's hover tip: what answers in the app (`tool`, from botTool), or where it opens and whether the prompt is
 *  typed in for you. */
export function chatbotTip(bot: Chatbot, installed: boolean, tool?: AppTool): string {
  if (tool === "gemini-api") return t("Asks Gemini with your free key. The answer shows here, with nothing to copy or paste");
  if (tool) return t("Runs {name} on this PC with {plan}. The answer shows here, with nothing to copy or paste", { name: CLI_NAME[tool], plan: cliPlan(tool) });
  if (bot.id === "other") return t("Any other chatbot. The prompt is copied for you to paste");
  const site = new URL(bot.url).host;
  const how = bot.prefill ? t("Opens {site} with the prompt typed in", { site }) : t("Opens {site} and copies the prompt for you to paste", { site });
  return installed ? t("{how}. The helper uses the website, not the app on this PC", { how }) : how;
}

/** Links longer than this don't carry the prompt (browsers and sites cut them); the user pastes it instead. */
const MAX_LINK = 7000;

/** Where to open the chatbot for a prompt: the prefilled link when the site takes one and the prompt fits, else the
 *  site. `prefilled` says whether the prompt is already in the box. Null when there is nothing to open. */
export function chatbotLink(id: ChatbotId | "", prompt: string): { url: string; prefilled: boolean } | null {
  const bot = chatbotOf(id);
  if (!bot) return null;
  if (bot.id === "other") { const u = chatbotUrlPref.get(); return u ? { url: u, prefilled: false } : null; }
  const pre = bot.prefill?.(prompt);
  if (pre && pre.length <= MAX_LINK) return { url: pre, prefilled: true };
  return { url: bot.url, prefilled: false };
}

let installed: Promise<ChatbotId[]> | null = null;
/** Chatbot desktop apps found on this PC (ChatGPT, Claude, Copilot), checked once per session. */
export function installedChatbots(): Promise<ChatbotId[]> {
  return installed ??= call<string[]>("ai_chatbots_installed")
    .then((l) => l.filter((x): x is ChatbotId => CHATBOTS.some((c) => c.id === x)))
    .catch(() => []);
}

let clis: Promise<CliId[]> | null = null;
/** Chat CLIs found on this PC, checked once per session unless `fresh` (Settings looks again when opened). */
export function foundClis(fresh = false): Promise<CliId[]> {
  if (fresh || !clis) clis = call<string[]>("ai_clis").then((l) => l.filter(isCli)).catch(() => []);
  return clis;
}

// ── the free Gemini key: saved by the backend (encrypted, never sent back here); this only knows whether there is one ──

let keySaved: boolean | null = null;
let keyAsked = false;
const keySubs = new Set<() => void>();
const keyIs = (v: boolean) => { keySaved = v; keySubs.forEach((f) => f()); };
/** Whether a free Gemini key is saved. False until the backend says. */
export function useGeminiKey(): boolean {
  useEffect(() => {
    if (keyAsked) return;
    keyAsked = true;
    void call<boolean>("ai_key_status").then(keyIs).catch(() => keyIs(false));
  }, []);
  return useSyncExternalStore((f) => { keySubs.add(f); return () => { keySubs.delete(f); }; }, () => keySaved ?? false);
}
/** Checks a pasted key with Google and saves it. Throws Google's reason when it isn't accepted. */
export async function saveGeminiKey(key: string) { await call<void>("ai_key_set", { key }); keyIs(true); }
export async function removeGeminiKey() { await call<void>("ai_key_remove"); keyIs(false); }
export const GEMINI_KEY_URL = "https://aistudio.google.com/app/apikey";

/** The plan something answers on, for tips: "your Claude plan". */
export const cliPlan = (tool: AppTool) => (tool === "claude" ? t("your Claude plan") : tool === "codex" ? t("your ChatGPT plan")
  : tool === "agy" ? t("your Google account") : tool === "gemini" ? t("your Gemini Code Assist plan") : t("your free Gemini key"));

/** The first of a chatbot's CLIs that's on this PC. */
export const foundCli = (bot: Chatbot | undefined, found: CliId[]): CliId | undefined => bot?.clis?.find((c) => found.includes(c));

/** The chatbots in the order they're offered: ones that answer in the app, then ones with an app on this PC, then the
 *  rest, Other last. */
export function botOrder(found: CliId[], installed: ChatbotId[], hasKey = false): Chatbot[] {
  const rank = (b: Chatbot) => (foundCli(b, found) || (hasKey && b.id === "gemini") ? 0 : installed.includes(b.id) ? 1 : 2);
  return [...CHATBOTS].sort((a, b) => rank(a) - rank(b));
}

/** The chatbot the helper uses: the saved one, else one whose CLI is on this PC, else Gemini with a saved key, else one
 *  with an app on this PC, else none (the user picks). */
export function pickBot(saved: ChatbotId | "", found: CliId[], installed: ChatbotId[], hasKey = false): ChatbotId | "" {
  if (chatbotOf(saved)) return saved;
  return CHATBOTS.find((b) => foundCli(b, found))?.id ?? (hasKey ? "gemini" : installed[0] ?? "");
}

/** What answers in the app for a chatbot: its CLI when it's on this PC and asking it isn't turned off, else Gemini's
 *  free key when one is saved. Undefined: the website. */
export function botTool(bot: Chatbot | undefined, found: CliId[], hasKey: boolean, useCli: boolean = aiCliPref.get()): AppTool | undefined {
  const cli = useCli ? foundCli(bot, found) : undefined;
  return cli ?? (hasKey && bot?.id === "gemini" ? "gemini-api" : undefined);
}

/** A model a tool answering in the app offers. `value` is its name on the command line (or Google's), "" the tool's
 *  default. */
export interface ModelChoice { value: string; label: string; title: string }
export const MODELS: Record<AppTool, ModelChoice[]> = {
  claude: [
    { value: "", label: "Sonnet", title: t("Claude's everyday model, and the default here. Good at themes and long lists") },
    { value: "opus", label: "Opus", title: t("Claude's strongest model. Uses your plan's limit faster") },
    { value: "haiku", label: "Haiku", title: t("Claude's fastest model. Fine for renames and tags, weaker at themes") },
    { value: "fable", label: "Fable", title: t("Claude's Fable model, when your plan has it") },
  ],
  codex: [{ value: "", label: t("Default"), title: t("The model Codex uses when none is named") }],
  agy: [{ value: "", label: t("Default"), title: t("Antigravity chooses the model") }],
  gemini: [
    { value: "", label: "Auto", title: t("Gemini CLI picks Pro or Flash for each request") },
    { value: "pro", label: "Pro", title: t("Gemini's strongest model. Slower, with a smaller free limit") },
    { value: "flash", label: "Flash", title: t("Fast, and good enough for most jobs") },
    { value: "flash-lite", label: "Flash-Lite", title: t("The fastest. Fine for renames and tags, weaker at themes") },
  ],
  "gemini-api": [
    { value: "", label: "Flash", title: t("Google's newest Flash model, which the free tier serves. The default") },
    { value: "gemini-flash-lite-latest", label: "Flash-Lite", title: t("Faster and lighter than Flash. Fine for renames and tags") },
    { value: "gemini-pro-latest", label: "Pro", title: t("Google's strongest model. A free key gets few requests a day with it, or none") },
  ],
};
/** Tools that take a model name typed in, for models not in the list above. */
export const typesModel = (tool: AppTool) => tool !== "agy";

/** How hard each tool can be told to think, lowest first (as gacha-core chat_cli `efforts`). Empty: no such option. */
export const EFFORTS: Record<AppTool, string[]> = {
  claude: ["low", "medium", "high", "xhigh", "max"],
  codex: ["minimal", "low", "medium", "high", "xhigh"],
  agy: [],
  gemini: [],
  "gemini-api": ["minimal", "low", "medium", "high"],
};
export const EFFORT_LABEL: Record<string, string> = {
  "": t("Default"), minimal: t("Minimal"), low: t("Low"), medium: t("Medium"), high: t("High"), xhigh: t("Extra high"), max: t("Max"),
};
export const EFFORT_TIP: Record<string, string> = {
  "": t("The model decides how long to think"),
  minimal: t("Hardly thinks. The fastest answers"),
  low: t("Thinks a little. Quick answers"),
  medium: t("Thinks some. A balance of speed and care"),
  high: t("Thinks it through. Slower, and better at themes and odd inis"),
  xhigh: t("Thinks longer still. Slow, and uses your plan's limit faster"),
  max: t("Thinks as long as it needs. The slowest, and uses your plan's limit fastest"),
};

/** The model and thinking level picked for each tool, shared by the helper window and Settings. */
export interface RunOpts { model: string; effort: string }
export const aiRunPref = jsonPref<Partial<Record<AppTool, RunOpts>>>("ai.run", {});
export const runOpts = (tool: AppTool, all = aiRunPref.get()): RunOpts => ({ model: all[tool]?.model ?? "", effort: all[tool]?.effort ?? "" });
export const setRunOpts = (tool: AppTool, change: Partial<RunOpts>) => aiRunPref.set({ ...aiRunPref.get(), [tool]: { ...runOpts(tool), ...change } });
/** "Opus, high thinking", for a summary line. */
export function runOptsText(tool: AppTool, o: RunOpts): string {
  const model = MODELS[tool].find((m) => m.value === o.model)?.label ?? o.model;
  return EFFORTS[tool].length && o.effort ? t("{model}, {level} thinking", { model, level: EFFORT_LABEL[o.effort]!.toLowerCase() }) : model;
}

/** The rules a CLI gets on top of the prompt, which already says everything about the job. */
export const CLI_SYSTEM = "You are the AI helper inside gachamod, a mod manager for gacha games. Answer the request in one reply, exactly in the format it asks for, and don't ask questions back. The request may come with reference files (the app's stylesheets, a screen's HTML, mods' ini files): use them to get details right, like exact selectors, section names and what a mod draws. Never change, create or delete files, and never run commands.";

/** A file sent with a request for a chatbot that answers in the app: a CLI that can read files gets them in a folder
 *  of copies, the others as much as fits pasted after the request. `about` says what it is in a few words. */
export interface JobFile { path: string; about: string; text: string }

/** A mod's files as the backend reads them for a job: every file's path and size, and the text ones (ini, txt, md,
 *  json) up to 64 KB each and `perMod` bytes in all, with each ini's section names from the whole file. */
export interface ModFiles {
  id: string;
  files: Array<{ path: string; size: number }>;
  more: number;
  texts: Array<{ path: string; text: string; cut: boolean; sections: string[] }>;
}
export const modFilesForAi = (game: GameId, ids: string[], perMod: number) => call<ModFiles[]>("ai_mod_files", { game, ids, perMod });

/** What a CLI is doing between answers: reading a file, finding files, searching them. Calls made at once share a
 *  round. */
export interface CliStatus { kind: "read" | "find" | "search" | "work"; on: string; round: number }

/** What a run used, as far as the tool says; each reports different things. `context`: the most it held at once,
 *  `window`: the most it can hold. */
export interface CliUsage {
  model: string | null; input: number | null; cached: number | null; output: number | null; thinking: number | null;
  context: number | null; window: number | null; turns: number | null;
}

export interface CliReply {
  text: string;
  /** Null when it answered; else "signin", "limit", "outdated", "node", "timeout", "stopped", "missing" or "failed",
   *  and for the Gemini key "key" (rejected), "blocked" (Gemini refused) or "busy" (Google overloaded). */
  problem: "signin" | "limit" | "outdated" | "node" | "timeout" | "stopped" | "missing" | "failed" | "key" | "blocked" | "busy" | null;
  /** The CLI's own words for a failure. */
  error: string | null;
  /** When a usage limit resets, in Unix seconds. */
  resetsAt: number | null;
  usage?: CliUsage;
}

let runs = 0;
/** Asks a chat CLI, or Gemini with the saved key, with `files` as reference, on the model and thinking level picked
 *  for it. `onText` gets the answer so far as it's written, `onStatus` each file it reads, `onThink` its thinking so
 *  far; `stop` ends it. */
export function askCli(tool: AppTool, prompt: string, onText: (text: string) => void,
  opts: { files?: JobFile[]; onStatus?: (s: CliStatus) => void; onThink?: (text: string) => void } = {}): { done: Promise<CliReply>; stop: () => void } {
  const id = `ai-${Date.now()}-${++runs}`;
  let text = "";
  const off = listen<{ id: string; delta: string; reset: boolean }>("ai-chunk", (c) => {
    if (c.id !== id) return;
    text = c.reset ? c.delta : text + c.delta;
    onText(text);
  });
  const offStatus = listen<CliStatus & { id: string }>("ai-status", (s) => { if (s.id === id) opts.onStatus?.({ kind: s.kind, on: s.on, round: s.round ?? 0 }); });
  let thought = "";
  const offThink = listen<{ id: string; delta: string }>("ai-think", (c) => {
    if (c.id !== id) return;
    thought += c.delta;
    opts.onThink?.(thought);
  });
  // listening before asking, so the first words aren't missed
  const done = Promise.all([off, offStatus, offThink])
    .then(() => call<CliReply>("ai_run", { id, tool, prompt, system: CLI_SYSTEM, files: opts.files ?? [], opts: runOpts(tool) }))
    .finally(() => { for (const u of [off, offStatus, offThink]) void u.then((f) => f()); });
  return { done, stop: () => void call("ai_cancel", { id }).catch(() => {}) };
}

/** Opens a chat CLI in a window of its own so the user can sign in. */
export const cliSignIn = (cli: CliId) => call<void>("ai_cli_sign_in", { tool: cli });

/** What went wrong, in words, with a hint for what to do. */
export function cliProblem(r: CliReply, name: string, tool: AppTool): { text: string; hint?: string } {
  switch (r.problem) {
    case "signin":
      return {
        text: t("{name} isn't signed in.", { name }),
        hint: tool === "claude" ? t("Click Sign in and pick your Claude plan in the window that opens, not an API key. If it opens a chat instead, type /login. Then ask again.")
          : tool === "codex" ? t("Click Sign in and sign in with ChatGPT in your browser. Then ask again.")
          : tool === "agy" ? t("Click Sign in. A window opens and your browser asks you to sign in with Google. Then ask again.")
          : t("Click Sign in and choose Sign in with Google in the window that opens. Then ask again."),
      };
    case "limit": {
      const at = r.resetsAt ? new Date(r.resetsAt * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
      return { text: at ? t("{name} hit the usage limit. It resets at {time}.", { name, time: at }) : t("{name} hit the usage limit.", { name }), hint: t("Pick another chatbot above to keep going.") };
    }
    case "key": return { text: t("Google didn't accept the Gemini key."), hint: t("Remove it and paste a new one from Google AI Studio.") };
    case "blocked":
      return {
        text: t("Gemini refused this request."),
        hint: aiHideAdultPref.get() ? t("Try fewer mods at once, or pick another chatbot above.") : t("Turn on \"Hide adult mods from the chatbot\" and ask again."),
      };
    case "busy": return { text: t("Gemini is overloaded right now. Ask again in a minute.") };
    case "outdated": return { text: t("This version of {name} doesn't know an option gachamod uses. Update it, then ask again.", { name }) };
    case "node": return { text: t("{name} needs Node.js, which isn't installed on this PC.", { name }) };
    case "timeout": return { text: t("{name} didn't answer in 10 minutes.", { name }) };
    case "missing": return { text: t("{name} isn't on this PC anymore. Pick another chatbot above.", { name }) };
    default: return { text: t("{name} stopped with an error: {error}", { name, error: r.error ?? "" }) };
  }
}

/** What to ask for. Areas start one with askAi(); the AI host (screens/ai/AiHost.tsx) builds the prompt. */
export interface AiTask {
  /** "theme": a theme from a description; "mods": mass edits to mods (rename, tags, characters, hide adult names);
   *  "keys-offscreen": make these mods' keys work only while they are on screen;
   *  "recommend": mod ideas from a library summary in `detail`; "custom": free text about these mods. */
  kind: "theme" | "theme-edit" | "mods" | "keys-offscreen" | "recommend" | "custom" | (string & {});
  /** "theme-edit": the id of the custom theme to change. */
  theme?: string;
  /** Shown as the helper's title ("Fix keys for 3 mods"). */
  title?: string;
  game?: GameId;
  modIds?: string[];
  /** Anything the area already knows that helps (the broken hashes, the ini text that couldn't be patched). For
   *  "mods", a goal id preselects it: "clean", "characters", "tags". For "theme", a starting description. */
  detail?: string;
}

/** Open the AI helper for a task. Does nothing while AI is off. */
export function askAi(task: AiTask) {
  if (aiShowPref.get() === "off") return;
  emitApp({ type: "ai", task });
}
