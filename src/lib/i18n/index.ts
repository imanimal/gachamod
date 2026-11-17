// The app's language. English text is the key: t("View mods") looks the words up in the picked language's catalog
// (zh-CN.json and the rest beside this file) and falls back to the English when a line has no translation yet.
// The language is fixed for a page load: picking another one saves it and reloads the window, so text built at
// import time is right too. Messages from the backend arrive in English; tb() translates them by the patterns in
// backend.ts. Each translated line remembers its English, so code that goes by a message's words (lib/places.ts,
// toast helpers) still works: english(text) gives the words back. docs/i18n.md has the rules for adding text.
import { createElement, Fragment, type ReactNode } from "react";
import { BACKEND } from "./backend";

export type Lang = "en" | "zh-CN" | "es" | "pt-BR" | "ru";
/** What the Language setting holds: a language, or "auto" to follow Windows. */
export type LangChoice = Lang | "auto";

/** Every language, named in itself, in the order the picker lists them. */
export const LANGS: Array<{ id: Lang; name: string; english: string }> = [
  { id: "en", name: "English", english: "English" },
  { id: "zh-CN", name: "简体中文", english: "Chinese (Simplified)" },
  { id: "es", name: "Español", english: "Spanish" },
  { id: "pt-BR", name: "Português (Brasil)", english: "Portuguese (Brazil)" },
  { id: "ru", name: "Русский", english: "Russian" },
];

type Plural = Partial<Record<Intl.LDMLPluralRule, string>>;
type Entry = string | Plural;
export type Catalog = Record<string, Entry>;
// only the language in use is loaded (each catalog is about 400 KB); modules that import this wait for it
const CATALOGS: Record<Exclude<Lang, "en">, () => Promise<{ default: Catalog }>> = {
  "zh-CN": () => import("./zh-CN.json"), es: () => import("./es.json"), "pt-BR": () => import("./pt-BR.json"), ru: () => import("./ru.json"),
};

const KEY = "gm.lang";
const isLang = (v: unknown): v is Lang => LANGS.some((l) => l.id === v);

/** The language Windows (or the browser, for the demo) uses, if gachamod has it. */
export function systemLang(): Lang {
  const list = typeof navigator === "undefined" ? [] : navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const raw of list) {
    const tag = (raw ?? "").toLowerCase();
    if (tag === "zh" || tag.startsWith("zh-cn") || tag.startsWith("zh-sg") || tag.startsWith("zh-hans")) return "zh-CN";
    if (tag.startsWith("zh")) continue; // Traditional Chinese readers get English until zh-TW exists
    if (tag.startsWith("es")) return "es";
    if (tag.startsWith("pt")) return "pt-BR";
    if (tag.startsWith("ru")) return "ru";
    if (tag.startsWith("en")) return "en";
  }
  return "en";
}

function readChoice(): LangChoice {
  try { const v = localStorage.getItem(KEY); if (v === "auto" || isLang(v)) return v; } catch { /* storage blocked */ }
  return "auto";
}

let choice: LangChoice = readChoice();
/** The language in use for this page load. */
export const lang: Lang = choice === "auto" ? systemLang() : choice;
const catalog: Catalog = lang === "en" ? {} : (await CATALOGS[lang]().catch(() => ({ default: {} }))).default;
const plurals = new Intl.PluralRules(lang);
const enPlurals = new Intl.PluralRules("en");
const numbers = new Intl.NumberFormat(lang, { maximumFractionDigits: 2 });

/** The Language setting as saved ("auto" follows Windows). */
export const langChoice = (): LangChoice => choice;

/** Save a language and reload the window in it. The settings value is kept too, so it travels with a settings export. */
export function setLangChoice(v: LangChoice, save?: (v: LangChoice) => Promise<void> | void) {
  if (v === choice) return;
  choice = v;
  try { localStorage.setItem(KEY, v); } catch { /* storage blocked: it applies for this run only */ }
  void Promise.resolve(save?.(v)).catch(() => {}).finally(() => location.reload());
}

/** At start: when the saved setting disagrees with this window's copy (a settings import, cleared storage), take the
 *  setting and reload once. */
export function adoptSavedChoice(saved: string | null | undefined) {
  if (saved !== "auto" && !isLang(saved)) return;
  if (saved === choice) return;
  setLangChoice(saved);
}

// ── lookups ──

export type Params = Record<string, string | number>;

const back = new Map<string, string>();
/** Keep the English for a translated line, so english() can give it back. Bounded, oldest out first. */
function remember(shown: string, en: string) {
  if (shown === en) return;
  if (back.size > 2000) back.delete(back.keys().next().value as string);
  back.set(shown, en);
}

const show = (v: string | number) => (typeof v === "number" ? numbers.format(v) : v);
function fill(s: string, params?: Params): string {
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? show(params[k]) : m));
}

function lookup(key: string, n?: number): string | undefined {
  const e = catalog[key];
  if (typeof e === "string") return e || undefined;
  if (e && typeof e === "object") return (n !== undefined ? e[plurals.select(n)] : undefined) ?? e.other;
  return undefined;
}

/** A line in the user's language: t("Turned off {n} mods", { n: 3 }). The English is the key, so write it exactly
 *  as English readers should see it. Placeholders are {name}; numbers get the language's digit grouping. */
export function t(key: string, params?: Params): string {
  if (lang === "en") return fill(key, params);
  const out = fill(lookup(key) ?? key, params);
  remember(out, fill(key, params));
  return out;
}

/** A line that changes with a count: tn(n, "{n} mod", "{n} mods"). The plural form is the key; `{n}` is the count. */
export function tn(n: number, one: string, other: string, params?: Params): string {
  const p = { ...params, n };
  const en = fill(enPlurals.select(n) === "one" ? one : other, p);
  if (lang === "en") return en;
  const hit = lookup(other, n);
  const out = hit ? fill(hit, p) : en;
  remember(out, en);
  return out;
}

/** Like t, but placeholders can be elements: tx("Press {key} in game", { key: <Kbd>F7</Kbd> }). */
export function tx(key: string, params: Record<string, ReactNode>): ReactNode {
  const s = lang === "en" ? key : lookup(key) ?? key;
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of s.matchAll(/\{(\w+)\}/g)) {
    if (!(m[1] in params)) continue;
    if (m.index > last) parts.push(s.slice(last, m.index));
    const v = params[m[1]];
    parts.push(typeof v === "number" ? numbers.format(v) : v);
    last = m.index + m[0].length;
  }
  if (last < s.length) parts.push(s.slice(last));
  return createElement(Fragment, null, ...parts);
}

/** Separately translated sentences as one text: joined by a space, or by nothing in Chinese. */
export const sentences = (parts: string[]): string => parts.join(lang === "zh-CN" ? "" : " ");

/** Lines without their full stops as one text: "A. B" in English, "A。B" in Chinese. `end` adds the last stop. */
export const stops = (parts: string[], end = false): string => {
  const stop = lang === "zh-CN" ? "。" : ". ";
  return parts.join(stop) + (end && parts.length ? stop.trimEnd() : "");
};

/** The English a translated line came from, or the text itself. For code that goes by a message's words. */
export const english = (text: string): string => back.get(text) ?? text;

// ── messages from the backend ──

interface Pattern { re: RegExp; names: string[]; key: string }
let patterns: Pattern[] | null = null;
function compiled(): Pattern[] {
  return patterns ??= BACKEND.map((key) => {
    const names: string[] = [];
    const src = key.split(/(\{\w+\})/).map((part) => {
      const m = /^\{(\w+)\}$/.exec(part);
      if (!m) return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      names.push(m[1]);
      // a placeholder never runs past the end of a sentence, so "Installed {name}" can't swallow the notes after it
      return "((?:(?![.!?] ).)+?)";
    }).join("");
    return { re: new RegExp(`^${src}$`, "s"), names, key };
  });
}

/** One sentence or a whole message, if a catalog line or pattern covers it. */
function backendOne(text: string): string | undefined {
  const exact = lookup(text);
  if (exact) return exact;
  for (const p of compiled()) {
    const m = p.re.exec(text);
    if (!m) continue;
    const tr = lookup(p.key);
    if (!tr) return undefined;
    const params: Params = {};
    // a game name or another known phrase inside the message is translated too
    p.names.forEach((name, i) => { params[name] = lookup(m[i + 1]) ?? m[i + 1]; });
    return fill(tr, params);
  }
  return undefined;
}

/** A message from the backend (an error, a toast it sent) in the user's language. Unknown text stays English. */
export function tb(text: string): string {
  if (lang === "en" || !text) return text;
  let out = backendOne(text);
  if (out === undefined) {
    // several sentences joined: translate the ones we know
    const sentences = text.split(/(?<=[.!?])\s+/);
    if (sentences.length > 1) {
      // a sentence cut from a message keeps its full stop, which its pattern may not have
      const one = (s: string) => {
        const hit = backendOne(s);
        if (hit !== undefined || !s.endsWith(".")) return hit;
        const bare = backendOne(s.slice(0, -1));
        return bare === undefined ? undefined : /[.!?。！？]$/.test(bare) ? bare : bare + (lang === "zh-CN" ? "。" : ".");
      };
      // take the longest run of sentences a pattern knows, so a two-sentence message joined to another still matches
      const done: string[] = [];
      let known = false;
      for (let i = 0; i < sentences.length;) {
        let j = sentences.length;
        let hit: string | undefined;
        for (; j > i; j--) if ((hit = one(sentences.slice(i, j).join(" "))) !== undefined) break;
        if (hit !== undefined) { done.push(hit); known = true; i = j; } else { done.push(sentences[i]); i++; }
      }
      if (known) out = done.join(lang === "zh-CN" ? "" : " ");
    }
  }
  if (out === undefined) return text;
  remember(out, text);
  return out;
}
