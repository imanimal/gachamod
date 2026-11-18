// The AI helper: hands work that can't be fully automated (a theme from a description, renaming 300 mods, making a
// mod's keys work only while its character is on screen when the ini is too odd to patch) to the chatbot the user
// already uses. No API key, no account: the app writes the prompt with everything the chatbot needs, copies it and
// opens the chatbot (with the prompt already in the box where the site allows it), then reads the answer back when
// pasted, checks it, shows what would change and applies it with Undo. Nothing is sent anywhere without the user
// clicking. How much of this shows is the user's call: off (no AI element anywhere), useful (default: only entry
// points that save real work) or all. Adult mods stay out of prompts unless the user turns that off, and nothing in
// a prompt says a mod is for adults: chatbots refuse a whole request over one explicit name or label.
// Owner: SETTINGS/AI area.
import type { GameId } from "./api";
import { call } from "./tauri";
import { emitApp } from "./store";
import { pref } from "./prefs";
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
export const chatbotPref = pref<ChatbotId | "">("ai.chatbot", "", (r) => (CHATBOTS.some((c) => c.id === r) || r === "" ? (r as ChatbotId | "") : undefined), (v) => v);
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
}

export const CHATBOTS: Chatbot[] = [
  { id: "chatgpt", name: "ChatGPT", url: "https://chatgpt.com/", prefill: (q) => `https://chatgpt.com/?q=${encodeURIComponent(q)}` },
  { id: "claude", name: "Claude", url: "https://claude.ai/new", prefill: (q) => `https://claude.ai/new?q=${encodeURIComponent(q)}` },
  { id: "gemini", name: "Gemini", url: "https://gemini.google.com/app" },
  { id: "copilot", name: "Copilot", url: "https://copilot.microsoft.com/" },
  { id: "grok", name: "Grok", url: "https://grok.com/", prefill: (q) => `https://grok.com/?q=${encodeURIComponent(q)}` },
  { id: "other", name: t("Other"), url: "" },
];
export const chatbotOf = (id: ChatbotId | "" | null | undefined): Chatbot | undefined => CHATBOTS.find((c) => c.id === id);

/** A chatbot's hover tip: where it opens and whether the prompt is typed in for you. */
export function chatbotTip(bot: Chatbot, installed: boolean): string {
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

/** What to ask for. Areas start one with askAi(); the AI host (screens/ai/AiHost.tsx) builds the prompt. */
export interface AiTask {
  /** "theme": a theme from a description; "mods": mass edits to mods (rename, tags, characters, hide adult names);
   *  "keys-offscreen": make these mods' keys work only while they are on screen;
   *  "recommend": mod ideas from a library summary in `detail`; "custom": free text about these mods. */
  kind: "theme" | "mods" | "keys-offscreen" | "recommend" | "custom" | (string & {});
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
