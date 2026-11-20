// GameBanana's public API (apiv11, no key, CORS allowed), called straight from the UI in Tauri and in the browser demo.
// Owner: BROWSE area (docs/spec.md, "Downloads and Browse"; API notes in docs/research.md, section 2).
// Every function caches in memory (and sessionStorage/localStorage where noted) and never throws for a missing
// optional field. The signatures below are the contract other areas compile against: keep them.
import { useEffect, useState } from "react";
import type { GameId, ModEntry } from "./api";
import { queue, type QueueItem, type QueueRequest } from "./api/online";
import { currentGame } from "./store";
import { HOLD, track } from "./activity";
import { doneHint } from "../shell/hints";
import { t } from "./i18n";
import { note as noteUsage } from "./telemetry";
import { attrStyle, inlineStyle } from "./inlineStyle";

export const GB = "https://gamebanana.com/apiv11";

export interface GbGameInfo { id: number; name: string; icon: string | null; banner: string | null }

/** One image at the sizes GameBanana serves. Any of them may be missing; `full` always exists. */
export interface GbImage { full: string; s100?: string; s220?: string; s530?: string; s800?: string; caption?: string; width?: number; height?: number }

export interface GbUser {
  id: number; name: string; avatar: string | null; url: string;
  /** Their name style on GameBanana, when the record carries it (mod lists and pages do). */
  style?: GbNameStyle | null;
  /** The avatar GameBanana swaps in on hover. */
  hoverAvatar?: string | null;
  /** Their signature picture (comments carry it). */
  sig?: string | null;
}

export interface GbCategoryRef { id: number; name: string; icon: string | null }

/** A mod in a list (Mod/Index, Util/Search/Results). */
export interface GbCard {
  id: number;
  name: string;
  url: string;
  image: GbImage | null;
  submitter: GbUser | null;
  category: GbCategoryRef | null;
  /** The character when the category is one of the game's character categories. */
  character: string | null;
  likes: number;
  views: number;
  downloads: number | null;
  added: number;
  updated: number;
  nsfw: boolean;
  version: string | null;
  /** Comments on GameBanana (_nPostCount). */
  comments?: number;
  /** GameBanana featured it at some point. */
  featured?: boolean;
  /** The game it belongs to (lists across games, like a creator's page). */
  game?: { id: number; name: string } | null;
  /** What sort of mod it is (kindOf). */
  kind?: GbKind;
}

/** "outfit": character outfits and model edits. "texture": recolors, makeup, face and texture-only edits. "tool":
 *  shaders, effect removers, camera and other fixes. "other": NPCs, Bangboo, objects and the rest. */
export type GbKind = "outfit" | "texture" | "weapon" | "tool" | "ui" | "other";

export interface GbFile {
  id: number;
  name: string;
  size: number;
  description: string;
  added: number;
  downloads: number;
  md5: string | null;
  downloadUrl: string;
  /** GameBanana's virus scan result: "clean", "suspicious", "pending" or similar; null when absent. */
  analysis: string | null;
  archived: boolean;
  /** What GameBanana's file check noticed, in words ("Has program files (3)"). */
  warnings?: string[];
}

export interface GbMod extends GbCard {
  summary: string | null;
  descriptionHtml: string;
  images: GbImage[];
  files: GbFile[];
  superCategory: GbCategoryRef | null;
  ratings: string[];
  visibility: "show" | "warn" | "hide";
  updatesCount: number;
  game: { id: number; name: string } | null;
  /** A GameBanana tool (a fixer, a script) rather than a mod: it is downloaded, never installed. */
  tool?: boolean;
  /** Members subscribed to it on GameBanana (_nSubscriberCount). */
  subscribers?: number;
  /** Thanks its creator got for it (_nThanksCount). */
  thanks?: number;
}

export interface GbUpdate { id: number; name: string; version: string | null; added: number; changes: Array<{ cat: string; text: string }>; text: string }

/** "popular" and "downloads" are most downloaded of all time; "week" and "month" are the most liked mods added in
 *  the last 7 or 30 days (gathered from the newest pages, GameBanana has no such sort). "relevance" is the best match
 *  for a search (most downloaded without one). */
export type GbSort = "relevance" | "popular" | "newest" | "updated" | "downloads" | "likes" | "views" | "week" | "month";

export interface ListQuery {
  /** 0 lists every game (a creator's mods everywhere). */
  gbGameId: number;
  /** Only this member's mods. */
  submitterId?: number | null;
  page: number;
  /** Up to 50 for lists; search returns 15 per page whatever this says. */
  perPage?: number;
  sort?: GbSort;
  categoryId?: number | null;
  search?: string;
  signal?: AbortSignal;
}

export interface ListResult { items: GbCard[]; total: number; complete: boolean }

// ── requests: at most 4 at once, one retry on a server error or a dropped connection, abortable ──

const OFFLINE = t("GameBanana didn't answer. Check your connection and try again.");
type Json = Record<string, unknown>;

let inFlight = 0;
const waiting: Array<() => void> = [];

function abortError(): Error { return new DOMException("Aborted", "AbortError"); }
export const isAbort = (e: unknown): boolean => e instanceof DOMException && e.name === "AbortError";
/** GameBanana answered 404: the page (a mod, a member) isn't there. */
export const isNotFound = (e: unknown): boolean => e instanceof Error && (e as Error & { notFound?: boolean }).notFound === true;

async function acquire(signal?: AbortSignal): Promise<void> {
  if (inFlight < 4) { inFlight++; return; }
  await new Promise<void>((resolve, reject) => {
    const go = () => { signal?.removeEventListener("abort", stop); inFlight++; resolve(); };
    const stop = () => { const i = waiting.indexOf(go); if (i >= 0) waiting.splice(i, 1); reject(abortError()); };
    if (signal?.aborted) { reject(abortError()); return; }
    signal?.addEventListener("abort", stop, { once: true });
    waiting.push(go);
  });
}
function release() { inFlight--; waiting.shift()?.(); }

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(abortError()); return; }
    const timer = setTimeout(() => { signal?.removeEventListener("abort", stop); resolve(); }, ms);
    const stop = () => { clearTimeout(timer); reject(abortError()); };
    signal?.addEventListener("abort", stop, { once: true });
  });
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  await acquire(signal);
  try {
    for (let attempt = 0; ; attempt++) {
      let r: Response;
      try {
        // a connection that goes quiet fails after 30 seconds instead of waiting forever
        const quiet = AbortSignal.timeout(30_000);
        r = await track(fetch(url, { signal: signal ? AbortSignal.any([signal, quiet]) : quiet, headers: { Accept: "application/json" } }),
          t("Waiting on GameBanana"), HOLD.gb);
      } catch (e) {
        if (signal?.aborted) throw abortError();
        if (isAbort(e) || (e instanceof DOMException && e.name === "TimeoutError")) {
          throw new Error(t("GameBanana didn't answer for 30 seconds. Check your connection, or try again in a minute."));
        }
        if (attempt === 0) { await pause(800, signal); continue; }
        throw new Error(OFFLINE);
      }
      if (r.status >= 500 && attempt === 0) { await pause(800, signal); continue; }
      if (r.status === 404) throw Object.assign(new Error(t("GameBanana doesn't have that page. It may have been removed.")), { notFound: true });
      if (!r.ok) throw new Error(t("GameBanana answered with an error ({status}). Try again in a minute.", { status: String(r.status) }));
      let body: unknown;
      try { body = await r.json(); } catch { throw new Error(t("GameBanana sent something gachamod couldn't read. Try again in a minute.")); }
      if (body && typeof body === "object" && "_sErrorCode" in body) {
        throw new Error(t("GameBanana didn't accept the request ({code}).", { code: String((body as Json)._sErrorCode) }));
      }
      return body;
    }
  } finally { release(); }
}

// ── caches ──

const memo = new Map<string, { at: number; value: unknown }>();
const MIN5 = 5 * 60_000;

async function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value as T;
  const value = await load();
  memo.set(key, { at: Date.now(), value });
  if (memo.size > 400) { const first = memo.keys().next().value; if (first !== undefined) memo.delete(first); }
  return value;
}

function storeGet<T>(store: "local" | "session", key: string, ttl: number): T | null {
  try {
    const s = store === "local" ? localStorage : sessionStorage;
    const raw = s.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as { at: number; value: T };
    return Date.now() - v.at < ttl ? v.value : null;
  } catch { return null; }
}
function storeSet(store: "local" | "session", key: string, value: unknown) {
  try { (store === "local" ? localStorage : sessionStorage).setItem(key, JSON.stringify({ at: Date.now(), value })); } catch { /* storage full or blocked */ }
}

// ── parsing: every field optional, unknown shapes skipped ──

const obj = (v: unknown): Json | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const https = (u: string | null): string | null => (u && /^https:\/\//i.test(u) ? u : u && u.startsWith("//") ? `https:${u}` : null);

function catIdFromUrl(u: unknown): number | null {
  const m = typeof u === "string" ? /\/cats\/(\d+)/.exec(u) : null;
  return m ? Number(m[1]) : null;
}

function parseImage(raw: unknown): GbImage | null {
  const o = obj(raw);
  if (!o) return null;
  const direct = https(str(o._sUrl));
  if (direct) return { full: direct };
  const base = str(o._sBaseUrl), file = str(o._sFile);
  if (!base || !file) return null;
  const at = (k: string) => { const f = str(o[k]); return f ? `${base}/${f}` : undefined; };
  const img: GbImage = { full: `${base}/${file}`, s100: at("_sFile100"), s220: at("_sFile220"), s530: at("_sFile530"), s800: at("_sFile800") };
  const caption = str(o._sCaption);
  if (caption) img.caption = caption;
  for (const s of ["800", "530", "220", "100"]) {
    const w = num(o[`_wFile${s}`]), h = num(o[`_hFile${s}`]);
    if (w && h) { img.width = w; img.height = h; break; }
  }
  return img;
}

function parseImages(media: unknown): GbImage[] {
  const list = Array.isArray(media) ? media : arr(obj(media)?._aImages);
  return list.map(parseImage).filter((i): i is GbImage => !!i);
}

function parseUser(raw: unknown): GbUser | null {
  const o = obj(raw);
  const id = num(o?._idRow), name = str(o?._sName);
  if (!o || id === null || !name) return null;
  const u: GbUser = { id, name, avatar: https(str(o._sAvatarUrl)), url: str(o._sProfileUrl) ?? `https://gamebanana.com/members/${id}` };
  // mod lists and pages carry the submitter's name style, upic and hover avatar
  const style = parseNameStyle(o._aSubjectShaper, o._sUpicUrl);
  if (style) u.style = style;
  const hover = styleImage(o._sHovatarUrl) ?? styleImage(o._sHdHovatarUrl);
  if (hover) u.hoverAvatar = hover;
  const sig = styleImage(o._sSigUrl);
  if (sig) u.sig = sig;
  return u;
}

function parseCategory(raw: unknown): GbCategoryRef | null {
  const o = obj(raw);
  const name = str(o?._sName);
  const id = num(o?._idRow) ?? catIdFromUrl(o?._sProfileUrl ?? o?._sUrl);
  if (!o || !name || id === null) return null;
  return { id, name, icon: https(str(o._sIconUrl)) };
}

function matchCharacter(cat: GbCategoryRef | null, chars: GbCategoryRef[]): string | null {
  if (!cat || !chars.length) return null;
  const byId = chars.find((c) => c.id === cat.id);
  if (byId) return byId.name;
  const n = cat.name.trim().toLowerCase();
  return chars.find((c) => c.name.trim().toLowerCase() === n)?.name ?? null;
}

// ── what sort of mod: from the category, the name and the "Software Used" tags creators add ──
//
// Checked against 1,600 of the newest mods of zzz, gi, hsr and ww. GameBanana only knows the category (Skins, UI,
// Other/Misc ...), so inside Skins the name decides between an outfit and a texture edit: "Danica Darker Recolor",
// "Claret Eye Recolour", "arlecchino makeup" and "Tanned Xiao" are texture edits; "Velina - Deathblow (New
// skirt+color)" and "Purple Sister over Remielle" are outfits. A part added with "+" ("Rina Thicc + Makeup",
// "Cozy Winter Freminet (+ Serpent Spine Recolour)") doesn't count, and a mod whose only software tags are paint
// programs (no Blender) is a texture edit.

const K_TEXTURE = /\b(tex|re-?colou?r(s|ed)?|re-?textur(e|es|ed)|textures|make-?up|face ?(mod|edit)|refined face|eye-?lash(es)?|lipstick|nail polish|skin ?tone|shadow ?maps?|(sun-?)?tanned|tan|palette)\b/i;
const K_OUTFIT = /\b(over|outfits?|dress(es)?|skirts?|suits?|swimsuits?|bikinis?|maid|uniforms?|costumes?|clothes|clothing|jackets?|coats?|hoodie|armou?r|bunny|lingerie|kimono|cosplay|nude|naked|thicc|thick|body|mashup|modbash|drip|\w*wear|bodysuit|capes?|gowns?|robes?|fat|slim|skinny|buff(ed)?|beef(y|ier)?|hefty|curvy|pear-shaped|petite|muscular|chubby|toggles?)\b/i;
const K_SOFT = /\b(colou?rs?|colou?red|eyes?|hair ?colou?r|shader|shading|tint)\b/i;
const K_HUE = "(black|white|pink|red|blue|green|purple|teal|gold|golden|silver|brown|dark|darker|pale|paler)";
const K_HUED = new RegExp(`\\b(but|to|in)\\s+${K_HUE}\\b|\\(\\s*${K_HUE}\\s*\\)|\\b${K_HUE}\\s+(hair|skin|eyes|version|ver)\\b|\\bless pale\\b`, "i");
export const K_TOOL = /\b(fix(es|ed)?|remov(e|er|al)|fx|reshade|shaders?|camera|lib|library|toggler|filter|map\+?|outlines?|bloom|sharpen|x-?ray|downsizer|script|fps|censor|tools?|utility|cursor|screenshot)\b/i;
const K_PAINT = /paint|photoshop|gimp|sai\b|krita|clip studio|medibang|substance|procreate/i;
const escapeRe = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The sort of mod (GbKind). `root` is the top category ("Skins", "UI", "Other/Misc"), `category` the most exact
 *  one ("Vesna", "Swords"), `software` the creator's "Software Used" tags. */
export function kindOf(m: { name: string; root: string | null; category: string | null; isCharacter: boolean; software?: string[] }): GbKind {
  const root = m.root ?? "", cat = m.category ?? "";
  if (/^\s*ui\s*$|interface|\bhud\b/i.test(root)) return "ui";
  // "(1.7 Fix)" and "[1.2 FIXED]" are version notes, not what the mod is
  if (/other|misc/i.test(root)) return K_TOOL.test(m.name.replace(/\([^)]*\)|\[[^\]]*\]/g, " ")) ? "tool" : "other";
  if (/bangboo|npc|entit|object|gadget|creature|enem|waverider|cutscene/i.test(`${root} ${cat}`)) return "other";
  if (/^\s*(swords?|claymores?|polearms?|bows?|catalysts?|weapons?|w-engines?|light ?cones?)\s*$/i.test(cat) || /weapon/i.test(root)) return "weapon";
  if (!/skin|character|playable|agent|resonator/i.test(root) && !m.isCharacter) return root ? "other" : "outfit";
  // "+ Makeup" and "(+ ...)" are extras on top of the mod
  const core = m.name.replace(/\(\s*\+[^)]*\)|\[\s*\+[^\]]*\]|\s\+\s.*$/g, " ");
  if (K_TEXTURE.test(core) && !/\bover\b|mashup|modbash/i.test(core)) return "texture";
  if (K_OUTFIT.test(core)) return "outfit";
  // the character's own name says nothing ("Burnice White", "Black Swan")
  let rest = core;
  for (const w of cat.split(/\s+/)) if (w.length > 2) rest = rest.replace(new RegExp(`\\b${escapeRe(w)}\\b`, "gi"), " ");
  if (K_SOFT.test(rest) || K_HUED.test(rest)) return "texture";
  const sw = m.software ?? [];
  if (sw.length && sw.some((tag) => K_PAINT.test(tag)) && sw.every((tag) => K_PAINT.test(tag) || /notepad|sublime|text|code/i.test(tag))) return "texture";
  return "outfit";
}

/** The "Software Used" tags of a record (strings like "Software Used: Blender", or {_sTitle, _sValue}). */
function softwareTags(raw: unknown): string[] {
  const out: string[] = [];
  for (const item of arr(raw)) {
    const o = obj(item);
    const text = typeof item === "string" ? item : o ? `${str(o._sTitle) ?? ""}: ${str(o._sValue) ?? ""}` : "";
    const m = /^\s*software used\s*:\s*(.+)$/i.exec(text);
    if (m) out.push(m[1]!.trim());
  }
  return out;
}

function parseCard(raw: unknown, chars: GbCategoryRef[]): GbCard | null {
  const o = obj(raw);
  const id = num(o?._idRow), name = str(o?._sName);
  if (!o || id === null || !name) return null;
  if (o._sModelName !== undefined && o._sModelName !== "Mod") return null;
  const category = parseCategory(o._aSubCategory) ?? parseCategory(o._aCategory) ?? parseCategory(o._aRootCategory);
  const visibility = str(o._sInitialVisibility);
  const added = num(o._tsDateAdded) ?? 0;
  const g = obj(o._aGame), gid = num(g?._idRow);
  const character = matchCharacter(category, chars);
  return {
    id, name, url: str(o._sProfileUrl) ?? `https://gamebanana.com/mods/${id}`,
    image: parseImages(o._aPreviewMedia)[0] ?? null,
    submitter: parseUser(o._aSubmitter),
    category,
    character,
    likes: num(o._nLikeCount) ?? 0,
    views: num(o._nViewCount) ?? 0,
    downloads: num(o._nDownloadCount),
    added,
    updated: num(o._tsDateUpdated) ?? num(o._tsDateModified) ?? added,
    nsfw: o._bHasContentRatings === true || o._bIsNsfw === true || visibility === "warn" || visibility === "hide",
    version: str(o._sVersion),
    comments: num(o._nPostCount) ?? 0,
    featured: o._bWasFeatured === true,
    game: g && gid !== null ? { id: gid, name: str(g._sName) ?? "" } : null,
    kind: kindOf({
      name, category: category?.name ?? null, isCharacter: !!character,
      root: str(obj(o._aRootCategory)?._sName) ?? str(obj(o._aSuperCategory)?._sName) ?? null,
      software: softwareTags(o._aTags),
    }),
  };
}

const WARNING_WORDS: Record<string, string> = { contains_exe: t("Has program files"), contains_dll: t("Has program libraries"), contains_script: t("Has scripts") };

function parseFile(raw: unknown, archived: boolean): GbFile | null {
  const o = obj(raw);
  const id = num(o?._idRow);
  if (!o || id === null) return null;
  const warnings = Object.entries(obj(o._aAnalysisWarnings) ?? {}).map(([k, v]) => {
    const words = WARNING_WORDS[k] ?? k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
    return Array.isArray(v) && v.length ? `${words} (${v.length})` : words;
  });
  const av = str(o._sAvResult), check = str(o._sAnalysisResult), state = str(o._sAnalysisState);
  return {
    id,
    name: str(o._sFile) ?? `file-${id}`,
    size: num(o._nFilesize) ?? 0,
    description: str(o._sDescription) ?? "",
    added: num(o._tsDateAdded) ?? 0,
    downloads: num(o._nDownloadCount) ?? 0,
    md5: str(o._sMd5Checksum),
    downloadUrl: https(str(o._sDownloadUrl)) ?? `https://gamebanana.com/dl/${id}`,
    analysis: av ?? (state && state !== "done" ? "pending" : check === "ok" ? "clean" : check),
    archived: archived || o._bIsArchived === true,
    warnings: warnings.length ? warnings : undefined,
  };
}

// ── characters ──

/** Each game's character category, so lists can name the character without a lookup (docs/research.md 2.3). */
const CHAR_CATS: Record<string, { gb: number; cat: number }> = {
  gi: { gb: 8552, cat: 18140 }, hsr: { gb: 18366, cat: 22832 }, zzz: { gb: 19567, cat: 30305 },
  ww: { gb: 20357, cat: 29524 }, hi3: { gb: 10349, cat: 23620 }, ef: { gb: 21842, cat: 42770 },
};

function charCatFor(game: GameId): number | null {
  const g = currentGame();
  if (g && g.id === game && g.gbCharacterCategory) return g.gbCharacterCategory;
  return CHAR_CATS[game]?.cat ?? null;
}
function charCatForGb(gbGameId: number): number | null {
  const g = currentGame();
  if (g && g.gamebananaId === gbGameId && g.gbCharacterCategory) return g.gbCharacterCategory;
  return Object.values(CHAR_CATS).find((c) => c.gb === gbGameId)?.cat ?? null;
}

// The character list is never built into the app: it is GameBanana's character categories, kept in localStorage.
// A kept list is used at once and fetched again in the background once it is a day old (stale while revalidate),
// and sooner when a mod names a character category the kept list lacks (a character added since). Screens that
// show the list hear about a new one through onCharacters / useCharacterList.

const DAY = 86_400_000;
const charLive = new Map<number, GbCategoryRef[]>();
const charFetching = new Map<number, Promise<GbCategoryRef[]>>();
const charTried = new Map<number, number>();
const charSubs = new Set<(cat: number) => void>();

const charKey = (cat: number) => `gm.gb.chars.${Object.entries(CHAR_CATS).find(([, v]) => v.cat === cat)?.[0] ?? cat}`;

function storeRead<T>(key: string): { at: number; value: T } | null {
  try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as { at: number; value: T }) : null; } catch { return null; }
}

function fetchChars(cat: number): Promise<GbCategoryRef[]> {
  const running = charFetching.get(cat);
  if (running) return running;
  charTried.set(cat, Date.now());
  const p = getJson(`${GB}/Mod/Categories?_idCategoryRow=${cat}&_sSort=a_to_z&_bShowEmpty=true`).then((raw) => {
    const list = arr(raw).map(parseCategory).filter((c): c is GbCategoryRef => !!c);
    if (list.length) {
      const before = charLive.get(cat);
      charLive.set(cat, list);
      storeSet("local", charKey(cat), list);
      const changed = !before || before.length !== list.length || before.some((c, i) => c.id !== list[i]?.id || c.icon !== list[i]?.icon);
      if (changed) charSubs.forEach((f) => f(cat));
    }
    return list.length ? list : charLive.get(cat) ?? [];
  }).finally(() => charFetching.delete(cat));
  charFetching.set(cat, p);
  return p;
}

async function charsForCat(cat: number | null): Promise<GbCategoryRef[]> {
  if (!cat) return [];
  const live = charLive.get(cat);
  if (live) {
    if (Date.now() - (charTried.get(cat) ?? 0) > DAY) void fetchChars(cat).catch(() => {});
    return live;
  }
  const kept = storeRead<GbCategoryRef[]>(charKey(cat));
  if (kept?.value?.length) {
    charLive.set(cat, kept.value);
    charTried.set(cat, kept.at);
    if (Date.now() - kept.at > DAY) void fetchChars(cat).catch((e) => console.warn("GameBanana characters:", e));
    return kept.value;
  }
  return fetchChars(cat);
}

/** A mod named this character category: fetch the list again when it doesn't have it (at most every 10 minutes). */
function noteCharCategory(cat: number | null, ref: GbCategoryRef | null) {
  if (!cat || !ref) return;
  const list = charLive.get(cat);
  if (!list || list.some((c) => c.id === ref.id)) return;
  if (Date.now() - (charTried.get(cat) ?? 0) < 10 * 60_000) return;
  void fetchChars(cat).catch(() => {});
}

async function charsQuiet(cat: number | null): Promise<GbCategoryRef[]> {
  try { return await charsForCat(cat); } catch (e) { console.warn("GameBanana characters:", e); return []; }
}

/** Hear when a game's character list changes (a new character on GameBanana). */
export function onCharacters(cb: (game: GameId) => void): () => void {
  const f = (cat: number) => {
    const g = Object.entries(CHAR_CATS).find(([, v]) => v.cat === cat)?.[0] ?? (currentGame()?.gbCharacterCategory === cat ? currentGame()!.id : null);
    if (g) cb(g as GameId);
  };
  charSubs.add(f);
  return () => { charSubs.delete(f); };
}

// ── the API ──

/** A game's name, icon and banner. */
export async function gameInfo(gbGameId: number): Promise<GbGameInfo | null> {
  if (!gbGameId) return null;
  const key = `gm.gb.game.${gbGameId}`;
  const stored = storeGet<GbGameInfo>("session", key, 86_400_000);
  if (stored) return stored;
  try {
    return await cached(`game:${gbGameId}`, 3_600_000, async () => {
      const o = obj(await getJson(`${GB}/Game/${gbGameId}/ProfilePage`));
      if (!o) return null;
      const media = arr(obj(o._aPreviewMedia)?._aImages).map(obj);
      const ofType = (kind: string) => https(str(media.find((m) => m?._sType === kind)?._sUrl));
      const info: GbGameInfo = { id: gbGameId, name: str(o._sName) ?? "", icon: ofType("icon") ?? https(str(o._sIconUrl)), banner: ofType("banner") ?? https(str(o._sBannerUrl)) };
      storeSet("session", key, info);
      return info;
    });
  } catch (e) {
    console.warn("GameBanana game info:", e);
    return null;
  }
}

const INDEX_SORT: Record<GbSort, string> = {
  relevance: "Generic_MostDownloaded", popular: "Generic_MostDownloaded", downloads: "Generic_MostDownloaded", newest: "Generic_Newest",
  updated: "Generic_LatestUpdated", likes: "Generic_MostLiked", views: "Generic_MostViewed",
  week: "Generic_Newest", month: "Generic_Newest",
};
const SEARCH_ORDER: Partial<Record<GbSort, string>> = { popular: "popularity", downloads: "popularity", newest: "date", updated: "udate", week: "date", month: "date", likes: "popularity", views: "popularity" };
const WINDOW_DAYS: Partial<Record<GbSort, number>> = { week: 7, month: 30 };

/** A tool on GameBanana (a fixer, a script). */
export interface GbTool { id: number; name: string; url: string; added: number; submitter: string | null }

/** A game's newest tools on GameBanana (Tools > Fixes looks for new fixers here). Kept for an hour. */
export function gameTools(gbGameId: number): Promise<GbTool[]> {
  return cached(`tools:${gbGameId}`, 3_600_000, async () => {
    const body = obj(await getJson(`${GB}/Tool/Index?_nPage=1&_nPerpage=50&_aFilters[Generic_Game]=${gbGameId}&_sSort=Generic_Newest`));
    return arr(body?._aRecords).flatMap((raw): GbTool[] => {
      const o = obj(raw);
      const id = num(o?._idRow), name = str(o?._sName);
      if (!o || !id || !name) return [];
      return [{ id, name, url: https(str(o._sProfileUrl)) ?? `https://gamebanana.com/tools/${id}`, added: num(o._tsDateAdded) ?? 0, submitter: str(obj(o._aSubmitter)?._sName) }];
    });
  });
}

/** Likes, plus views and comments in like-sized units (a mod gets roughly one like per 80 to 100 views). */
export const attention = (c: Pick<GbCard, "likes" | "views" | "comments">) => c.likes + c.views / 100 + (c.comments ?? 0) / 2;

/** One page straight from GameBanana (no week/month gathering). */
async function rawPage(q: ListQuery, sort: GbSort, page: number): Promise<ListResult> {
  const search = q.search?.trim() ?? "";
  let url: string;
  let perPage: number;
  if (search) {
    perPage = 15;
    url = `${GB}/Util/Search/Results?_sModelName=Mod&_sOrder=${SEARCH_ORDER[sort] ?? "best_match"}${q.gbGameId ? `&_idGameRow=${q.gbGameId}` : ""}&_sSearchString=${encodeURIComponent(search)}&_nPage=${page}`;
  } else {
    perPage = Math.min(50, Math.max(1, q.perPage ?? 30));
    url = `${GB}/Mod/Index?_nPage=${page}&_nPerpage=${perPage}&_sSort=${INDEX_SORT[sort]}`;
    if (q.gbGameId) url += `&_aFilters[Generic_Game]=${q.gbGameId}`;
    if (q.categoryId) url += `&_aFilters[Generic_Category]=${q.categoryId}`;
    if (q.submitterId) url += `&_aFilters[Generic_Submitter]=${q.submitterId}`;
  }
  const result = await cached(`list:${url}`, MIN5, async () => {
    const charCat = q.gbGameId ? charCatForGb(q.gbGameId) : null;
    const [raw, chars] = await Promise.all([getJson(url, q.signal), charsQuiet(charCat)]);
    const o = obj(raw);
    const meta = obj(o?._aMetadata);
    const records = arr(o?._aRecords);
    const items: GbCard[] = [];
    for (const r of records) {
      const c = parseCard(r, chars);
      if (!c) continue;
      items.push(c);
      // a character category under a root character category (zzz, ww) that the kept list lacks: a new character
      if (charCat && c.category && !c.character && catIdFromUrl(obj(obj(r)?._aRootCategory)?._sProfileUrl) === charCat) noteCharCategory(charCat, c.category);
    }
    const total = num(meta?._nRecordCount) ?? items.length;
    const complete = meta?._bIsComplete === true || records.length === 0 || page * perPage >= total;
    return { items, total, complete } satisfies ListResult;
  });
  // search can't filter by category or member on GameBanana's side
  if (search && (q.categoryId || q.submitterId)) {
    const cat = q.categoryId, who = q.submitterId;
    return { ...result, items: result.items.filter((c) => (!cat || c.category?.id === cat) && (!who || c.submitter?.id === who)) };
  }
  return result;
}

/** Mods added in the last `days`, most attention first: newest pages until the window ends (at most 10). */
async function windowList(q: ListQuery, days: number): Promise<GbCard[]> {
  const key = `win:${q.gbGameId}:${q.categoryId ?? ""}:${q.submitterId ?? ""}:${q.search ?? ""}:${days}`;
  return cached(key, MIN5, async () => {
    const since = Date.now() / 1000 - days * 86400;
    const out: GbCard[] = [];
    for (let p = 1; p <= 10; p++) {
      const r = await rawPage({ ...q, perPage: 50 }, "newest", p);
      out.push(...r.items.filter((c) => c.added >= since));
      const oldest = r.items.reduce((m, c) => Math.min(m, c.added), Infinity);
      if (r.complete || oldest < since || !r.items.length) break;
    }
    const seen = new Set<number>();
    return out.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true))).sort((a, b) => attention(b) - attention(a));
  });
}

/** A page of mods for a game, newest/popular/etc., optionally in one category, by one member or matching text. */
export async function listMods(q: ListQuery): Promise<ListResult> {
  const page = Math.max(1, Math.floor(q.page || 1));
  const sort = q.sort ?? "popular";
  const days = WINDOW_DAYS[sort];
  if (!days) return rawPage(q, sort, page);
  const all = await windowList(q, days);
  const per = q.search?.trim() ? 15 : Math.min(50, Math.max(1, q.perPage ?? 30));
  const items = all.slice((page - 1) * per, page * per);
  return { items, total: all.length, complete: page * per >= all.length };
}

const SORT_CMP: Partial<Record<GbSort, (a: GbCard, b: GbCard) => number>> = {
  newest: (a, b) => b.added - a.added,
  updated: (a, b) => b.updated - a.updated,
  likes: (a, b) => b.likes - a.likes,
  views: (a, b) => b.views - a.views,
};

/** Mods by any of these members in one game, merged and sorted (up to 50 newest-or-best each, in one go). For "only
 *  creators you follow" and Home's strip. Members GameBanana fails to answer for are skipped. */
export async function listByCreators(ids: number[], q: Omit<ListQuery, "page" | "submitterId">): Promise<ListResult> {
  const sort = q.sort ?? "newest";
  const days = WINDOW_DAYS[sort];
  const fetchSort: GbSort = days ? "newest" : sort;
  const lists = await Promise.allSettled(ids.slice(0, 60).map((id) => rawPage({ ...q, page: 1, search: undefined, perPage: 50, submitterId: id }, fetchSort, 1)));
  if (lists.length && lists.every((l) => l.status === "rejected")) throw (lists[0] as PromiseRejectedResult).reason;
  let items = lists.flatMap((l) => (l.status === "fulfilled" ? l.value.items : []));
  const text = q.search?.trim().toLowerCase();
  if (text) { const words = text.split(/\s+/); items = items.filter((c) => cardHasWords(c, words)); }
  if (days) { const since = Date.now() / 1000 - days * 86400; items = items.filter((c) => c.added >= since); }
  const seen = new Set<number>();
  items = items.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
  items.sort(SORT_CMP[sort] ?? ((a, b) => attention(b) - attention(a)));
  return { items, total: items.length, complete: true };
}

/** What a GameBanana page is: a mod, or a tool (fixers and scripts live under Tool). */
export type GbModel = "Mod" | "Tool";

/** Everything about one mod (Mod/<id>/ProfilePage). */
export function modPage(id: number, signal?: AbortSignal): Promise<GbMod | null> {
  return itemPage("Mod", id, signal);
}

/** Read a mod's page fresh next time, after a like, subscription or thanks changed its counts. */
export function forgetModPage(id: number) { memo.delete(`mod:${id}`); }

/** Everything about one tool (Tool/<id>/ProfilePage, the same shape as a mod's page). */
export function toolPage(id: number, signal?: AbortSignal): Promise<GbMod | null> {
  return itemPage("Tool", id, signal);
}

async function itemPage(model: GbModel, id: number, signal?: AbortSignal): Promise<GbMod | null> {
  if (!Number.isFinite(id) || id <= 0) return null;
  return cached(`${model === "Mod" ? "mod" : "tool"}:${id}`, MIN5, async () => {
    const o = obj(await getJson(`${GB}/${model}/${id}/ProfilePage`, signal));
    if (!o) return null;
    const gameId = num(obj(o._aGame)?._idRow);
    const charCat = gameId ? charCatForGb(gameId) : null;
    const chars = await charsQuiet(charCat);
    const card = parseCard({ ...o, _sModelName: "Mod" }, chars);
    if (!card) return null;
    const category = parseCategory(o._aCategory) ?? card.category;
    const superCategory = parseCategory(o._aSuperCategory);
    const character = (superCategory && charCat && superCategory.id === charCat && category ? category.name : null) ?? matchCharacter(category, chars);
    if (superCategory && charCat && superCategory.id === charCat) noteCharCategory(charCat, category);
    const images = parseImages(o._aPreviewMedia);
    const files = [
      ...arr(o._aFiles).map((f) => parseFile(f, false)),
      ...arr(o._aArchivedFiles).map((f) => parseFile(f, true)),
    ].filter((f): f is GbFile => !!f);
    const seen = new Set<number>();
    const unique = files.filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true))).sort((a, b) => b.added - a.added);
    const ratings = Object.values(obj(o._aContentRatings) ?? {}).filter((v): v is string => typeof v === "string");
    const vis = str(o._sInitialVisibility);
    const visibility: GbMod["visibility"] = vis === "warn" || vis === "hide" ? vis : "show";
    const game = obj(o._aGame);
    return {
      ...card,
      category, character,
      image: images[0] ?? card.image,
      nsfw: card.nsfw || ratings.length > 0 || visibility !== "show",
      summary: str(o._sDescription),
      descriptionHtml: str(o._sText) ?? "",
      images, files: unique, superCategory, ratings, visibility,
      updatesCount: num(o._nUpdatesCount) ?? 0,
      subscribers: num(o._nSubscriberCount) ?? 0,
      thanks: num(o._nThanksCount) ?? 0,
      game: game && gameId !== null ? { id: gameId, name: str(game._sName) ?? "" } : null,
      ...(model === "Tool" ? { tool: true, character: null, kind: "tool" as const, url: card.url.includes("/tools/") ? card.url : `https://gamebanana.com/tools/${id}` } : {}),
    } satisfies GbMod;
  });
}

/** A mod's (or tool's) update posts, newest first. Rejects when GameBanana can't be read. */
export async function modUpdates(id: number, model: GbModel = "Mod"): Promise<GbUpdate[]> {
  return cached(`updates:${model}:${id}`, MIN5, async () => {
    const o = obj(await getJson(`${GB}/${model}/${id}/Updates?_nPage=1&_nPerpage=20`));
    return arr(o?._aRecords).map((r): GbUpdate | null => {
      const u = obj(r);
      const uid = num(u?._idRow);
      if (!u || uid === null) return null;
      const changes = arr(u._aChangeLog).map(obj).filter((c): c is Json => !!c)
        .map((c) => ({ cat: str(c.cat) ?? "", text: str(c.text) ?? "" })).filter((c) => c.text);
      return { id: uid, name: str(u._sName) ?? t("Update"), version: str(u._sVersion), added: num(u._tsDateAdded) ?? 0, changes, text: str(u._sText) ?? "" };
    }).filter((u): u is GbUpdate => !!u).sort((a, b) => b.added - a.added);
  });
}

export interface GbComment {
  id: number;
  author: GbUser | null;
  added: number;
  /** Raw HTML from GameBanana: always pass it through sanitizeHtml before showing it. */
  html: string;
  replies: number;
  pinned: boolean;
  /** Labels GameBanana puts on the post, like "Submitter". */
  labels: string[];
}
export interface GbCommentPage { items: GbComment[]; total: number; complete: boolean }

function parseComment(raw: unknown): GbComment | null {
  const o = obj(raw);
  const id = num(o?._idRow);
  // status "0" is a live post; others are trashed or held ("[trashed]" with no poster)
  if (!o || id === null || String(o._nStatus ?? "0") !== "0") return null;
  const html = str(o._sText);
  if (!html) return null;
  return {
    id, html, author: parseUser(o._aPoster), added: num(o._tsDateAdded) ?? 0, replies: num(o._nReplyCount) ?? 0,
    pinned: (num(o._iPinLevel) ?? 0) > 0, labels: arr(o._aLabels).filter((l): l is string => typeof l === "string"),
  };
}

async function commentPage(url: string, signal?: AbortSignal): Promise<GbCommentPage> {
  return cached(url, MIN5, async () => {
    const o = obj(await getJson(url, signal));
    const meta = obj(o?._aMetadata);
    const items = arr(o?._aRecords).map(parseComment).filter((c): c is GbComment => !!c);
    return { items, total: num(meta?._nRecordCount) ?? items.length, complete: meta?._bIsComplete === true };
  });
}

/** A mod's (or tool's) comments, 15 a page (GameBanana ignores other page sizes). `popular` matches the site's
 *  default order. */
export function modComments(id: number, page: number, sort: "popular" | "newest" = "popular", signal?: AbortSignal, model: GbModel = "Mod"): Promise<GbCommentPage> {
  return commentPage(`${GB}/${model}/${id}/Posts?_nPage=${page}&_nPerpage=15&_sSort=${sort}`, signal);
}

/** Replies to one comment, oldest first, 15 a page. */
export function commentReplies(postId: number, page: number, signal?: AbortSignal): Promise<GbCommentPage> {
  return commentPage(`${GB}/Post/${postId}/Posts?_nPage=${page}&_nPerpage=15`, signal);
}

/** The game's character categories with portrait icons (cached a day). Empty for games without one. */
export async function characterList(game: GameId): Promise<GbCategoryRef[]> {
  return charsQuiet(charCatFor(game));
}

/** How long a filter waits for the character list before it searches for the name instead. */
const CHAR_WAIT_MS = 4000;

function charsNow(game: GameId | null | undefined): GbCategoryRef[] | null {
  const cat = game ? charCatFor(game) : null;
  if (!cat) return [];
  const kept = charLive.get(cat) ?? storeRead<GbCategoryRef[]>(charKey(cat))?.value;
  return kept?.length ? kept : null;
}

/** characterList as React state, updated when GameBanana adds a character. Null while the first list loads, for at
 *  most a few seconds; then an empty list until it arrives. Games with no character category get [] at once. */
export function useCharacterListOrNull(game: GameId | null | undefined): GbCategoryRef[] | null {
  const [list, setList] = useState<GbCategoryRef[] | null>(() => charsNow(game));
  useEffect(() => {
    const now = charsNow(game);
    setList(now);
    if (!game || (now && !charCatFor(game))) return;
    let live = true;
    const timer = now ? 0 : window.setTimeout(() => { if (live) setList((l) => l ?? []); }, CHAR_WAIT_MS);
    const load = () => characterList(game).then((l) => { if (live) setList(l); });
    void load();
    const off = onCharacters((g) => { if (g === game) void load(); });
    return () => { live = false; window.clearTimeout(timer); off(); };
  }, [game]);
  return list;
}

/** useCharacterListOrNull with an empty list while it loads. */
export function useCharacterList(game: GameId | null | undefined): GbCategoryRef[] {
  return useCharacterListOrNull(game) ?? EMPTY_CHARS;
}
const EMPTY_CHARS: GbCategoryRef[] = [];

/** The game's top-level mod categories (Skins, UI, Other ...). */
export async function categories(gbGameId: number): Promise<GbCategoryRef[]> {
  if (!gbGameId) return [];
  try {
    return await cached(`cats:${gbGameId}`, 3_600_000, async () => {
      const raw = await getJson(`${GB}/Mod/Categories?_idGameRow=${gbGameId}&_sSort=a_to_z&_bShowEmpty=true`);
      return arr(raw).map(parseCategory).filter((c): c is GbCategoryRef => !!c);
    });
  } catch (e) {
    console.warn("GameBanana categories:", e);
    return [];
  }
}

// ── members (creators) ──

export interface GbMemberStats { id: number; points: number; subs: number }
export interface GbMember extends GbMemberStats {
  name: string;
  avatar: string | null;
  url: string;
  /** GameBanana's rank by points (1 is the top). */
  rank: number | null;
  title: string | null;
  joined: number | null;
  submissions: number | null;
  /** How they dressed up their name on GameBanana, or null when they didn't. */
  style: GbNameStyle | null;
  /** The avatar GameBanana swaps in while their avatar is hovered (HD when they have it). */
  hoverAvatar: string | null;
  /** Online on GameBanana right now; null when GameBanana didn't say. */
  online: boolean | null;
  /** Their own words for being online or offline ("Present"), whichever applies now; null for the plain words. */
  status: string | null;
  /** A title GameBanana's staff gave them ("End Boss"). */
  honorary: string | null;
  /** Their signature picture, shown under their posts on GameBanana. */
  sig: string | null;
  /** Their avatar on a spinning cube: turns per frame around each axis, as GameBanana draws it. */
  cube: { src: string; speed: number; axes: [number, number, number] } | null;
  /** How their hover card looks on GameBanana (Cooltip). */
  card: GbCardStyle | null;
  /** The answers on their profile ("Cat or Dog": "Cat"). */
  about: Array<{ q: string; a: string }>;
}

/** A member's name style (GameBanana's Subject Shaper, plus their upic). Plain values only, never their CSS: colours
 *  as #rrggbb, a font from GameBanana's own list, pictures from GameBanana's own hosts. */
export interface GbNameStyle {
  color: string | null;
  hoverColor: string | null;
  /** A CSS font list from GameBanana's choices ("'Courier New', monospace"). */
  font: string | null;
  /** The text effect: an outline, a drop shadow, a glow or a soft drop glow. */
  effect: GbTextEffect | null;
  effectColor: string | null;
  effectHoverColor: string | null;
  /** A picture GameBanana shows in place of their name, often an animated GIF. */
  upic: string | null;
}
export type GbTextEffect = "stroke" | "shadow" | "glow" | "dropGlow";

/** A member's hover card on GameBanana (Cooltip), as plain values. */
export interface GbCardStyle {
  font: string | null;
  effect: GbTextEffect | null;
  effectColor: string | null;
  color: string | null;
  /** #rrggbb or #rrggbbaa. */
  background: string | null;
  image: string | null;
  borderWidth: number;
  borderStyle: string | null;
  borderColor: string | null;
  link: string | null;
  linkHover: string | null;
}

/** GameBanana's name and hover card fonts, as it writes them in CSS. */
const GB_FONTS: Record<string, string> = {
  "Arial": "'Arial', 'Helvetica', sans-serif",
  "Arial Black": "'Arial Black', 'Gadget', sans-serif",
  "Comic Sans": "'Comic Sans MS', cursive",
  "Courier New": "'Courier New', monospace",
  "Georgia": "'Georgia', serif",
  "Impact": "'Impact', 'Charcoal', sans-serif",
  "Lucida Console": "'Lucida Console', 'Monaco', monospace",
  "Lucida Console Unicode": "'Lucida Sans Unicode', 'Lucida Grande', sans-serif",
  "Book Antique": "'Palatino Linotype', 'Book Antiqua', 'Palatino', serif",
  "Tahoma": "'Tahoma', 'Geneva', sans-serif",
  "Times New Roman": "'Times New Roman', 'Times', serif",
  "Trebuchet MS": "'Trebuchet MS', sans-serif",
  "Verdana": "'Verdana', 'Geneva', sans-serif",
  "MS Sans Serif": "'MS Sans Serif', 'Geneva', sans-serif",
  "MS Serif": "'MS Serif', 'New York', serif",
};
const GB_EFFECTS: Record<string, GbTextEffect> = { "Stroke": "stroke", "Drop Shadow": "shadow", "Glow": "glow", "Drop Glow": "dropGlow" };
const GB_BORDERS = new Set(["dotted", "dashed", "solid", "double", "groove", "ridge", "inset", "outset"]);

/** A colour as #rrggbb (or #rrggbbaa with `alpha`), from #rgb, #rgba, #rrggbb or #rrggbbaa only. */
function styleColor(v: unknown, alpha = false): string | null {
  const s = str(v)?.trim().toLowerCase();
  if (!s || !/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(s)) return null;
  const full = s.length <= 5 ? `#${[...s.slice(1)].map((c) => c + c).join("")}` : s;
  return alpha || full.length === 7 ? full : full.slice(0, 7);
}
/** An https picture on one of GameBanana's own hosts, normalized (quotes and spaces escaped, so it can sit inside a
 *  CSS url("...")). */
function styleImage(v: unknown): string | null {
  const u = https(str(v));
  if (!u) return null;
  try {
    const url = new URL(u);
    const host = url.hostname;
    return url.protocol === "https:" && (host === "gamebanana.com" || host.endsWith(".gamebanana.com")) ? url.href.replace(/["'\\()\s]/g, encodeURIComponent) : null;
  } catch { return null; }
}
const styleFont = (v: unknown): string | null => GB_FONTS[str(v)?.trim() ?? ""] ?? null;
const styleEffect = (v: unknown): GbTextEffect | null => GB_EFFECTS[str(v)?.trim() ?? ""] ?? null;

/** A name style from a Subject Shaper record (`_sTextColor`, `_sTextHoverColor`, `_sFont`, `_sBorderStyle`,
 *  `_sBorderColor`, `_sBorderHoverColor`) and an upic address. Null when none of it is set or usable. */
export function parseNameStyle(shaperRaw: unknown, upicRaw?: unknown): GbNameStyle | null {
  const s = obj(shaperRaw);
  const style: GbNameStyle = {
    color: styleColor(s?._sTextColor),
    hoverColor: styleColor(s?._sTextHoverColor),
    font: styleFont(s?._sFont),
    effect: styleEffect(s?._sBorderStyle),
    effectColor: styleColor(s?._sBorderColor),
    effectHoverColor: styleColor(s?._sBorderHoverColor),
    upic: styleImage(upicRaw),
  };
  return style.color || style.font || style.effect || style.upic ? style : null;
}

/** A hover card style from a Cooltip record. GameBanana gives the background picture as `_sBackgroundImageFile` under
 *  `_sBackgroundImageBaseUrl`, or as `_sBackgroundImageUrl` written `url(...)`. Null when none of it is set. */
export function parseCardStyle(raw: unknown): GbCardStyle | null {
  const c = obj(raw);
  if (!c) return null;
  const file = str(c._sBackgroundImageFile), base = str(c._sBackgroundImageBaseUrl);
  const inUrl = /^url\(\s*(['"]?)(https:\/\/[^'"()\s]+)\1\s*\)$/i.exec(str(c._sBackgroundImageUrl)?.trim() ?? "")?.[2];
  const image = styleImage(file && base && /^[\w.-]+$/.test(file) ? `${base.replace(/\/+$/, "")}/${file}` : inUrl);
  const width = num(c._sBoxBorderSize);
  const borderStyle = str(c._sBoxBorderStyle)?.trim().toLowerCase() ?? null;
  const card: GbCardStyle = {
    font: styleFont(c._sFont),
    effect: styleEffect(c._sBorderStyle),
    effectColor: styleColor(c._sBorderColor),
    color: styleColor(c._sTextColor),
    background: styleColor(c._sBackgroundColor, true),
    image,
    borderWidth: Math.max(0, Math.min(8, Math.round(width ?? 0))),
    borderStyle: borderStyle && GB_BORDERS.has(borderStyle) ? borderStyle : null,
    borderColor: styleColor(c._sBoxBorderColor),
    link: styleColor(c._sLinkColor),
    linkHover: styleColor(c._sLinkHoverColor),
  };
  const bordered = card.borderWidth > 0 && !!card.borderStyle;
  return card.font || card.effect || card.color || card.background || card.image || bordered || card.link ? card : null;
}

/** GameBanana draws a Cubeatar when it has a speed and an HD avatar (`_aCubeatar: { Speed, SpinAxes: [x, y, z] }`). */
function parseCube(raw: unknown, hd: string | null): GbMember["cube"] {
  const c = obj(raw);
  const speed = num(c?.Speed);
  const axes = arr(c?.SpinAxes).slice(0, 3).map((v) => Math.max(-1, Math.min(1, num(v) ?? 0)));
  if (!hd || !speed || speed <= 0 || axes.length !== 3 || axes.every((v) => v === 0)) return null;
  return { src: hd, speed: Math.min(speed, 50), axes: axes as [number, number, number] };
}

const MEMBER_KEY = "gm.gb.members";
const MEMBER_TTL = 3 * DAY;
type KeptStats = Record<string, { p: number; s: number; at: number }>;
let keptStats: KeptStats | null = null;
function statsTable(): KeptStats {
  if (keptStats) return keptStats;
  keptStats = storeRead<KeptStats>(MEMBER_KEY)?.value ?? {};
  return keptStats;
}
function saveStats() {
  const table = statsTable();
  const ids = Object.keys(table);
  if (ids.length > 4000) for (const id of ids.sort((a, b) => table[a]!.at - table[b]!.at).slice(0, ids.length - 3000)) delete table[id];
  storeSet("local", MEMBER_KEY, table);
}

/** Points and subscriber counts for members, kept 3 days (Member/Multi, 50 a request). Missing ones are left out. */
export async function memberStats(ids: number[], signal?: AbortSignal): Promise<Map<number, GbMemberStats>> {
  const table = statsTable();
  const now = Date.now();
  const out = new Map<number, GbMemberStats>();
  const need: number[] = [];
  for (const id of new Set(ids.filter((i) => i > 0))) {
    const k = table[String(id)];
    if (k && now - k.at < MEMBER_TTL) out.set(id, { id, points: k.p, subs: k.s });
    else need.push(id);
  }
  for (let i = 0; i < need.length; i += 50) {
    try {
      const raw = obj(await getJson(`${GB}/Member/Multi?_csvRowIds=${need.slice(i, i + 50).join(",")}&_csvProperties=_idRow,_nPoints,_nSubscriberCount`, signal));
      for (const v of Object.values(raw ?? {})) {
        const o = obj(v);
        const id = num(o?._idRow);
        if (!o || id === null) continue;
        const s = { id, points: Math.max(0, num(o._nPoints) ?? 0), subs: Math.max(0, num(o._nSubscriberCount) ?? 0) };
        out.set(id, s);
        table[String(id)] = { p: s.points, s: s.subs, at: now };
      }
    } catch (e) {
      if (isAbort(e)) throw e;
      console.warn("GameBanana members:", e);
    }
  }
  if (need.length) saveStats();
  return out;
}

const thumbCache = new Map<number, string | null>();

/** A small picture per mod (Mod/Multi, 50 a request), for lists of mods that only have their link. Mods GameBanana
 *  doesn't answer for are left out. */
export async function modThumbs(ids: number[], signal?: AbortSignal): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const need: number[] = [];
  for (const id of new Set(ids.filter((i) => i > 0))) {
    if (!thumbCache.has(id)) need.push(id);
    const thumb = thumbCache.get(id);
    if (thumb) out.set(id, thumb);
  }
  for (let i = 0; i < need.length; i += 50) {
    try {
      const raw = await getJson(`${GB}/Mod/Multi?_csvRowIds=${need.slice(i, i + 50).join(",")}&_csvProperties=_idRow,_aPreviewMedia`, signal);
      for (const v of arr(raw)) {
        const o = obj(v);
        const id = num(o?._idRow);
        if (!o || id === null) continue;
        const url = imageAt(parseImages(o._aPreviewMedia)[0], 220) ?? null;
        thumbCache.set(id, url);
        if (url) out.set(id, url);
      }
    } catch (e) {
      if (isAbort(e)) throw e;
      console.warn("GameBanana pictures:", e);
    }
  }
  return out;
}

/** What Mod/Multi can send for a card (it refuses _bHasContentRatings, _aSubCategory, _aTags and _bWasFeatured). */
const CARD_PROPS = "_idRow,_sName,_sProfileUrl,_aPreviewMedia,_aSubmitter,_aGame,_aCategory,_aRootCategory,_aSuperCategory,_nLikeCount,_nViewCount,_nDownloadCount,_nPostCount,_tsDateAdded,_tsDateUpdated,_tsDateModified,_bIsNsfw,_sVersion";

/** Cards for mods picked by id (Mod/Multi, 50 a request), in the order asked: subscribed mods and other lists that
 *  only have ids. Mods GameBanana withholds or removed come back nameless and are left out. */
export async function modCards(ids: number[], signal?: AbortSignal): Promise<GbCard[]> {
  const want = [...new Set(ids.filter((i) => i > 0))];
  const raw: Json[] = [];
  for (let i = 0; i < want.length; i += 50) {
    const got = await getJson(`${GB}/Mod/Multi?_csvRowIds=${want.slice(i, i + 50).join(",")}&_csvProperties=${CARD_PROPS}`, signal);
    for (const v of arr(got)) { const o = obj(v); if (o && str(o._sName)) raw.push(o); }
  }
  // characters come from each game's own list
  const chars = new Map<number, GbCategoryRef[]>();
  for (const gid of new Set(raw.map((o) => num(obj(o._aGame)?._idRow)).filter((g): g is number => g !== null))) {
    chars.set(gid, await charsQuiet(charCatForGb(gid)));
  }
  const byId = new Map<number, GbCard>();
  for (const o of raw) {
    const c = parseCard(o, chars.get(num(obj(o._aGame)?._idRow) ?? -1) ?? []);
    if (c) byId.set(c.id, c);
  }
  return want.map((id) => byId.get(id)).filter((c): c is GbCard => !!c);
}

/** A member's profile (Member/<id>/ProfilePage). */
export async function memberProfile(id: number, signal?: AbortSignal): Promise<GbMember | null> {
  if (!Number.isFinite(id) || id <= 0) return null;
  return cached(`member:${id}`, 10 * 60_000, async () => {
    const o = obj(await getJson(`${GB}/Member/${id}/ProfilePage`, signal));
    const name = str(o?._sName);
    if (!o || !name) return null;
    const core = obj(o._aCoreStats);
    const m: GbMember = {
      id, name,
      avatar: https(str(o._sHdAvatarUrl)) ?? https(str(o._sAvatarUrl)),
      url: str(o._sProfileUrl) ?? `https://gamebanana.com/members/${id}`,
      points: Math.max(0, num(o._nPoints) ?? num(core?._nPoints) ?? 0),
      subs: Math.max(0, num(o._nSubscriberCount) ?? num(core?._nCurrentSubscribers) ?? 0),
      rank: num(o._nPointsRank),
      title: str(o._sUserTitle),
      joined: num(o._tsJoinDate),
      submissions: num(core?._nCurrentSubmissions),
      style: parseNameStyle(o._aSubjectShaper, o._sUpicUrl),
      hoverAvatar: styleImage(o._sHdHovatarUrl) ?? styleImage(o._sHovatarUrl),
      online: typeof o._bIsOnline === "boolean" ? o._bIsOnline : null,
      status: (o._bIsOnline === true ? str(o._sOnlineTitle) : o._bIsOnline === false ? str(o._sOfflineTitle) : null)?.trim() || null,
      honorary: str(o._sHonoraryTitle)?.trim() || null,
      sig: styleImage(o._sSigUrl),
      cube: parseCube(o._aCubeatar, styleImage(o._sHdAvatarUrl)),
      card: parseCardStyle(o._aCooltip),
      about: arr(o._aBio).map(obj).flatMap((b) => {
        const q = str(b?._sTitle)?.trim(), a = str(b?._sValue)?.trim();
        return q && a ? [{ q: q.slice(0, 80), a: a.slice(0, 200) }] : [];
      }).slice(0, 20),
    };
    statsTable()[String(id)] = { p: m.points, s: m.subs, at: Date.now() };
    saveStats();
    return m;
  });
}

/** The text of a member's Uberstyle (the stylesheet GameBanana puts on their profile), or null when they have none.
 *  Member/UiConfig names it for a page path. Its address on files.gamebanana.com redirects without CORS headers, so it
 *  is read from images.gamebanana.com, which serves the same file directly. Kept 30 minutes. */
export async function memberUberstyle(id: number, signal?: AbortSignal): Promise<string | null> {
  if (!Number.isFinite(id) || id <= 0) return null;
  return cached(`uber:${id}`, 30 * 60_000, async () => {
    const o = obj(await getJson(`${GB}/Member/UiConfig?_sUrl=${encodeURIComponent(`/members/${id}`)}`, signal));
    const url = styleImage(o?._sUberstyleUrl);
    if (!url || !/\.css(?:[?#]|$)/i.test(url)) return null;
    const direct = url.replace(/^https:\/\/files\.gamebanana\.com\//i, "https://images.gamebanana.com/");
    for (const u of direct === url ? [url] : [direct, url]) {
      try {
        const quiet = AbortSignal.timeout(20_000);
        const r = await fetch(u, { signal: signal ? AbortSignal.any([signal, quiet]) : quiet });
        if (!r.ok) continue;
        const text = await r.text();
        return text.length > 200_000 ? text.slice(0, 200_000) : text;
      } catch (e) {
        if (signal?.aborted) throw abortError();
        if (isAbort(e)) throw e;
      }
    }
    return null;
  });
}

/** A member name to compare: lower case, without spaces, dots, dashes or underscores ("Mr.Avgv" and "mravgv" match). */
const nameKey = (s: string) => s.toLowerCase().replace(/[\s._-]+/g, "");

/** A member's id from their name: the submitter of `modId` when it matches, else GameBanana's member search. */
export async function findMember(name: string, modId?: number | null, signal?: AbortSignal): Promise<GbUser | null> {
  const want = nameKey(name.trim());
  if (modId) {
    try {
      const m = await modPage(modId, signal);
      if (m?.submitter && (!want || nameKey(m.submitter.name) === want)) return m.submitter;
    } catch (e) { if (isAbort(e)) throw e; /* else try the search */ }
  }
  if (!want) return null;
  return (await memberSearch(name, signal)).find((u) => nameKey(u.name) === want) ?? null;
}

/** GameBanana's member search, best match first (one page, kept 30 minutes). */
function memberSearch(name: string, signal?: AbortSignal): Promise<GbUser[]> {
  return cached(`members:${nameKey(name)}`, 30 * 60_000, async () => {
    const o = obj(await getJson(`${GB}/Util/Search/Results?_sModelName=Member&_sOrder=best_match&_sSearchString=${encodeURIComponent(name.trim())}&_nPage=1`, signal));
    return arr(o?._aRecords).map((r) => parseUser(r)).filter((u): u is GbUser => !!u);
  });
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length]!;
}

/** Whether a search word is close to a creator's name: the name or one of its parts, the start of it ("haeze" for
 *  "Haezeker_"), part of a longer name, or a typo or two away ("haezekr"). Words under 3 letters never match. */
export function nameClose(word: string, name: string): boolean {
  const w = nameKey(word);
  if (w.length < 3) return false;
  const keys = [nameKey(name), ...name.toLowerCase().split(/[\s._-]+/).filter(Boolean)];
  return keys.some((k) => k === w
    || (w.length >= 4 && k.startsWith(w))
    || (w.length >= 5 && k.includes(w))
    || (k.length >= 5 && w.startsWith(k))
    || (w.length >= 5 && Math.abs(w.length - k.length) <= 2 && editDistance(w, k) <= (w.length >= 8 ? 2 : 1)));
}

const SCAN_PAGES = 8;

/** Mods a search finds by who made them, which GameBanana's own search ignores. "avgv" lists AVGV's mods; "burnice
 *  haezeker" lists Burnice mods by a creator named close to "haezeker". Members named like a word are looked up first
 *  and their mods matched against the other words. When that finds nothing and GameBanana's search for the whole text
 *  has no mod with every word, up to 8 pages of a search for the other words are read for mods by a close name.
 *  Empty when the search names no creator. */
export async function modsByNamedCreator(q: Omit<ListQuery, "page" | "submitterId"> & { search: string }): Promise<GbCard[]> {
  const words = q.search.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const { signal } = q;
  const quiet = async <T,>(p: Promise<T>, none: T) => { try { return await p; } catch (e) { if (isAbort(e)) throw e; return none; } };
  const multi = words.length >= 2 && words.length <= 4;
  const without = (i: number) => words.filter((_, j) => j !== i).join(" ");

  const cands: { id: number; rest: string }[] = [];
  const add = (id: number, rest: string) => { if (!cands.some((c) => c.id === id)) cands.push({ id, rest }); };
  const whole = (await quiet(memberSearch(q.search, signal), [])).find((u) => nameKey(u.name) === nameKey(q.search));
  if (whole) add(whole.id, "");
  if (multi) {
    const each = await Promise.all(words.map((w) => quiet(memberSearch(w, signal), [])));
    each.forEach((users, i) => users.filter((u) => nameClose(words[i]!, u.name)).slice(0, 2).forEach((u) => add(u.id, without(i))));
  }
  const lists = await Promise.all(cands.slice(0, 6).map((c) => quiet(listByCreators([c.id], { ...q, search: c.rest }).then((r) => r.items), [])));
  let out = lists.flat();

  // GameBanana's search drops words it can't place ("burnice haezeker" lists every Burnice mod), so the scan runs
  // when no mod on its first page has every word
  if (!out.length && multi) {
    const plain = await quiet(listMods({ ...q, page: 1 }), null);
    const byName = (plain?.items ?? []).filter((c) => cardHasWords(c, words) && c.submitter && words.some((w) => nameClose(w, c.submitter!.name)));
    if (byName.length) out = byName;
    else if (plain && !plain.items.some((c) => cardHasWords(c, words))) {
      // best match finds an older mod sooner than newest-first; the week and month lists keep their window
      const scan = { ...q, sort: q.sort && WINDOW_DAYS[q.sort] ? q.sort : "popular" as const };
      const found = await Promise.all(words.map(async (w, i) => {
        const pick = (r: ListResult | null) => (r?.items ?? []).filter((c) => c.submitter && nameClose(w, c.submitter.name));
        const first = await quiet(listMods({ ...scan, search: without(i), page: 1 }), null);
        if (!first || first.complete) return pick(first);
        const pages = Math.min(SCAN_PAGES, Math.ceil(first.total / Math.max(1, first.items.length)));
        const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, k) => quiet(listMods({ ...scan, search: without(i), page: k + 2 }), null)));
        return [first, ...rest].flatMap(pick);
      }));
      out = found.flat().sort(SORT_CMP[q.sort ?? "popular"] ?? ((a, b) => attention(b) - attention(a)));
    }
  }
  const seen = new Set<number>();
  return out.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
}

/** Whether a mod's name, character, category or creator has every word (lower case). */
export const cardHasWords = (c: GbCard, words: string[]) => {
  const hay = `${c.name} ${c.character ?? ""} ${c.category?.name ?? ""} ${c.submitter?.name ?? ""}`.toLowerCase();
  return words.every((w) => hay.includes(w.toLowerCase()));
};

// ── the High quality filter ──
//
// High quality shows about the top fifth of a game's outfits, judged for their age. Measured on the 1,600 newest mods
// of zzz, gi, hsr and ww (November 2026):
//
//   A       attention = likes + views / 100 + comments / 2           (views and comments in like-sized units)
//   shape   how much of its attention a mod has at `age` days: a third in the first day, about 70% after a week, all
//           of it by three weeks, then a slow climb for years:
//           (0.7 (1 - e^(-age / 0.9)) + 0.3 (1 - e^(-age / 14))) * sqrt(1 + age / 365)
//   r       A / shape, the attention a mod is on track for
//   bar     the 80th percentile of r over the game's outfits aged 3 to 60 days among its newest 200 mods (kept a
//           day); `median` is the 50th. Another type picked (tools, UI ...) is measured among its own kind
//   T       the creator's record: the median r of their mods in this game aged 3 days or more (kept 3 days). A creator
//           with fewer than two here takes their best record from another game the app has measured, in units of
//           that game's bar (top fifth in zzz counts as top fifth in ww); with none anywhere, the game's median. At
//           most 1.5 bar, so a big name can't carry a mod nobody liked
//   est     (A + 0.25 T) / (shape + 0.25), times 1.2 when GameBanana featured it
//
// A mod passes when est >= bar. Early on the record carries most of the weight: a new mod by a creator whose mods
// usually land in the top fifth shows within the hour, one by a creator whose mods don't (none above 100 likes in
// zzz, say) waits until its own numbers say otherwise. After a month the record is worth a fifth. Only outfits pass
// unless another type is picked, and mods by creators the user prioritized always pass. About 20% of outfits pass
// in each game measured.

/** est / bar: a mod passes at 1 or more. */
export const HQ_PASS = 1;

export interface HqBar { bar: number; median: number }
const HQ_DEFAULT: HqBar = { bar: 300, median: 120 };
const HQ_K = 0.25;

/** How much of its attention a mod has at `age` days (see above). */
export function hqShape(age: number): number {
  const a = Math.max(0, age);
  return (0.7 * (1 - Math.exp(-a / 0.9)) + 0.3 * (1 - Math.exp(-a / 14))) * Math.sqrt(1 + a / 365);
}
const ageDays = (c: Pick<GbCard, "added">, now: number) => Math.max(0, now - c.added) / 86400;
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]!; };

/** The attention a mod is on track for (r above). `now` in unix seconds. */
export function hqOnTrack(c: Pick<GbCard, "likes" | "views" | "comments" | "added">, now = Date.now() / 1000): number {
  return attention(c) / Math.max(0.05, hqShape(ageDays(c, now)));
}

/** A mod's High quality score, est / bar (it passes at HQ_PASS). `record` is the creator's record (T), null when not
 *  known. `now` in unix seconds. */
export function hqScore(c: Pick<GbCard, "likes" | "views" | "comments" | "added" | "featured">, bar: HqBar, record: number | null | undefined, now = Date.now() / 1000): number {
  const s = hqShape(ageDays(c, now));
  const T = Math.min(record ?? bar.median, bar.bar * 1.5);
  const est = ((attention(c) + HQ_K * T) / (s + HQ_K)) * (c.featured ? 1.2 : 1);
  return est / Math.max(1, bar.bar);
}

/** The game's top category that holds a type of mod: Skins (the character one when there are several) for outfits,
 *  recolors and weapons, Other/Misc for tools, UI for UI. Null when the game has none or the type spans several. */
export function kindCategory(kind: GbKind | null | undefined, cats: GbCategoryRef[]): number | null {
  if (!kind || kind === "other") return null;
  const find = (re: RegExp, not?: RegExp) => cats.filter((c) => re.test(c.name) && !(not && not.test(c.name)));
  if (kind === "ui") return find(/^\s*ui\s*$/i)[0]?.id ?? null;
  if (kind === "tool") return find(/other|misc/i)[0]?.id ?? null;
  const skins = find(/skin/i, /bangboo|npc|weapon/i);
  return (skins.find((c) => /character/i.test(c.name)) ?? skins[0])?.id ?? null;
}

/** The game's bar and median for a type of mod (see above; outfits unless another type is given), kept a day. Each
 *  type is measured among its own kind, from its top category's newest 200 mods; a type with too few mods to measure
 *  uses the outfits' bar. */
export async function hqBar(gbGameId: number, signal?: AbortSignal, kind: GbKind = "outfit"): Promise<HqBar> {
  const key = `gm.gb.hqbar.${gbGameId}${kind === "outfit" ? "" : `.${kind}`}`;
  const kept = storeGet<HqBar>("local", key, DAY);
  if (kept && kept.bar > 0 && kept.median > 0) return kept;
  return cached(`hqbar:${gbGameId}:${kind}`, DAY, async () => {
    const now = Date.now() / 1000;
    const categoryId = kind === "outfit" ? null : kindCategory(kind, await categories(gbGameId));
    const cards: GbCard[] = [];
    try {
      for (let p = 1; p <= 4; p++) {
        const r = await rawPage({ gbGameId, categoryId, page: p, perPage: 50, signal }, "newest", p);
        cards.push(...r.items);
        if (r.complete) break;
      }
    } catch (e) {
      // offline or GameBanana down: this game's last bar, however old, beats a guess sized for another game
      const old = storeRead<HqBar>(key)?.value;
      if (!isAbort(e) && old && old.bar > 0 && old.median > 0) return old;
      throw e;
    }
    const onTrack = (keep: (c: GbCard, age: number) => boolean) => cards.filter((c) => keep(c, ageDays(c, now))).map((c) => hqOnTrack(c, now));
    let pool = onTrack((c, a) => c.kind === kind && a >= 3 && a <= 60);
    if (pool.length < 25) pool = onTrack((c, a) => c.kind === kind && a >= 3);
    if (kind !== "outfit" && pool.length < 10) return hqBar(gbGameId, signal, "outfit");
    if (pool.length < 25) pool = onTrack((_, a) => a >= 3);
    const b: HqBar = pool.length >= 8 ? { bar: Math.max(1, pct(pool, 0.8)), median: Math.max(1, pct(pool, 0.5)) } : HQ_DEFAULT;
    storeSet("local", key, b);
    return b;
  });
}

const RECORD_KEY = "gm.gb.records";
export type Records = Record<string, { r: number | null; at: number }>;
let recordsKept: Records | null = null;
const recordTable = (): Records => (recordsKept ??= storeRead<Records>(RECORD_KEY)?.value ?? {});

/** A creator's record in one game (T above): null when they have fewer than two mods there aged 3 days or more. */
export async function creatorRecord(gbGameId: number, memberId: number, signal?: AbortSignal): Promise<number | null> {
  const k = `${gbGameId}:${memberId}`;
  const hit = recordTable()[k];
  if (hit && Date.now() - hit.at < MEMBER_TTL) return hit.r;
  return cached(`record:${k}`, MIN5, async () => {
    const r = await rawPage({ gbGameId, submitterId: memberId, page: 1, perPage: 50, signal }, "newest", 1);
    const now = Date.now() / 1000;
    const xs = r.items.filter((c) => ageDays(c, now) >= 3).map((c) => hqOnTrack(c, now));
    const v = xs.length >= 2 ? pct(xs, 0.5) : null;
    const table = recordTable();
    table[k] = { r: v, at: Date.now() };
    const keys = Object.keys(table);
    if (keys.length > 3000) for (const old of keys.sort((a, b) => table[a]!.at - table[b]!.at).slice(0, keys.length - 2500)) delete table[old];
    storeSet("local", RECORD_KEY, table);
    return v;
  });
}

/** A creator's kept record in one game: undefined when it isn't kept or is older than MEMBER_TTL. */
function keptRecord(gbGameId: number, memberId: number): number | null | undefined {
  const hit = recordTable()[`${gbGameId}:${memberId}`];
  return hit && Date.now() - hit.at < MEMBER_TTL ? hit.r : undefined;
}

/** A creator's best record in the other games, in units of each game's bar, times this game's bar. `records` is the
 *  record table ("game:member" to record), `barOf` a game's last measured bar. Null when no other game knows them. */
export function borrowedRecord(records: Records, barOf: (gbGameId: number) => number | null, gbGameId: number, memberId: number, bar: number): number | null {
  let best: number | null = null;
  for (const [k, v] of Object.entries(records)) {
    const [g, m] = k.split(":").map(Number);
    if (m !== memberId || g === gbGameId || v.r == null) continue;
    const other = barOf(g!);
    if (!other || other <= 0) continue;
    const r = (v.r / other) * bar;
    if (best === null || r > best) best = r;
  }
  return best;
}
const keptBar = (gbGameId: number) => storeRead<HqBar>(`gm.gb.hqbar.${gbGameId}`)?.value.bar ?? null;

/** The cards that pass High quality, in the same order: outfits only, or `kind` when one is picked. `prio`: member
 *  ids whose mods (of that kind) always pass. */
export async function filterHq(cards: GbCard[], gbGameId: number, prio: Set<number>, signal?: AbortSignal, kind?: GbKind | null): Promise<GbCard[]> {
  const want = kind ?? "outfit";
  const typed = cards.filter((c) => (c.kind ?? "outfit") === want);
  if (!typed.length) return typed;
  const bar = await hqBar(gbGameId, signal, want).catch((e) => { if (isAbort(e)) throw e; return HQ_DEFAULT; });
  const now = Date.now() / 1000;
  // the record decides only young mods, so it's needed only where it could change the answer. Kept records cost
  // nothing; at most 16 more creators are looked up a call
  const undecided = (c: GbCard) => hqScore(c, bar, 0, now) < HQ_PASS && hqScore(c, bar, bar.bar * 3, now) >= HQ_PASS;
  const ids = [...new Set(typed.filter((c) => c.submitter && !prio.has(c.submitter.id) && undecided(c)).map((c) => c.submitter!.id))];
  const rec = new Map<number, number | null>();
  const look: number[] = [];
  for (const id of ids) { const k = keptRecord(gbGameId, id); if (k === undefined) look.push(id); else rec.set(id, k); }
  await Promise.all(look.slice(0, 16).map(async (id) => {
    try { rec.set(id, await creatorRecord(gbGameId, id, signal)); } catch (e) { if (isAbort(e)) throw e; }
  }));
  // a creator new to this game (or not looked up yet) is judged by how they do in the other games
  const table = recordTable();
  for (const id of ids) {
    if (rec.get(id) != null) continue;
    const b = borrowedRecord(table, keptBar, gbGameId, id, bar.bar);
    if (b != null) rec.set(id, b);
  }
  return typed.filter((c) => (c.submitter && prio.has(c.submitter.id)) || hqScore(c, bar, c.submitter ? rec.get(c.submitter.id) : null, now) >= HQ_PASS);
}

// ── updates ──

interface RemoteFiles { at: number; files: Array<{ id: number; added: number; archived: boolean }> }
const remoteFiles = new Map<number, RemoteFiles>();

/** True when a non-archived file was added more than a minute after the installed copy. */
export function hasNewerFile(mod: ModEntry, files: RemoteFiles["files"]): boolean {
  const base = mod.source?.remoteUpdated || mod.installedAt || 0;
  return files.some((f) => !f.archived && f.id !== mod.source?.fileId && f.added > base + 60);
}

/** Library ids of mods that have a newer file on GameBanana than the one installed. */
export async function checkUpdates(mods: ModEntry[]): Promise<string[]> {
  try {
    const tracked = mods.filter((m) => m.source?.site === "gamebanana" && (m.source.modId ?? 0) > 0);
    const now = Date.now();
    const need = [...new Set(tracked.map((m) => m.source!.modId))].filter((id) => { const c = remoteFiles.get(id); return !c || now - c.at > 3_600_000; });
    for (let i = 0; i < need.length; i += 50) {
      const batch = need.slice(i, i + 50);
      try {
        const raw = await getJson(`${GB}/Mod/Multi?_csvRowIds=${batch.join(",")}&_csvProperties=_idRow,_tsDateUpdated,_aFiles`);
        for (const r of arr(raw)) {
          const o = obj(r);
          const id = num(o?._idRow);
          if (!o || id === null) continue;
          const files = arr(o._aFiles).map((f) => parseFile(f, false)).filter((f): f is GbFile => !!f)
            .map((f) => ({ id: f.id, added: f.added, archived: f.archived }));
          remoteFiles.set(id, { at: now, files });
        }
      } catch (e) {
        console.warn("GameBanana update check:", e);
      }
    }
    // A mod GameBanana didn't answer for (offline, a failed batch) keeps the flag it had.
    return tracked.filter((m) => { const c = remoteFiles.get(m.source!.modId); return c ? hasNewerFile(m, c.files) : !!m.updateAvailable; }).map((m) => m.id);
  } catch (e) {
    console.warn("GameBanana update check:", e);
    return mods.filter((m) => m.updateAvailable).map((m) => m.id);
  }
}

// ── queueing ──

/** The request queueModFile sends (exported for tests and the demo). */
export function buildRequest(game: GameId, mod: GbMod, file: GbFile, replaces?: string): QueueRequest {
  const first = mod.images[0] ?? mod.image;
  return {
    game, gbModId: mod.id, fileId: file.id, url: file.downloadUrl, fileName: file.name, size: file.size, md5: file.md5,
    thumb: imageAt(first, 220) ?? null,
    meta: {
      name: mod.name,
      character: mod.character,
      category: mod.category?.name ?? null,
      source: { site: "gamebanana", modId: mod.id, fileId: file.id, url: mod.url, submitter: mod.submitter?.name ?? null, fileName: file.name, remoteUpdated: file.added || null },
      version: mod.version,
      nsfw: mod.nsfw,
      previewUrl: first ? (first.s530 ?? first.full) : null,
      replaces: replaces ?? null,
    },
  };
}

/** Queue one file of a mod for download and install. `replaces`: library id of the mod it updates. */
export async function queueModFile(game: GameId, mod: GbMod, file: GbFile, replaces?: string): Promise<QueueItem | null> {
  const snap = await queue.add(buildRequest(game, mod, file, replaces));
  noteUsage("download queued", { game, kind: replaces ? "update" : "new" });
  doneHint("install");
  const mine = snap.items.filter((i) => i.req.game === game && i.req.fileId === file.id);
  return mine.find((i) => i.state !== "done" && i.state !== "failed" && i.state !== "cancelled") ?? mine[mine.length - 1] ?? null;
}

/** The file to install by default: the newest one that isn't archived. */
export function newestFile(mod: GbMod): GbFile | null {
  return mod.files.filter((f) => !f.archived).sort((a, b) => b.added - a.added)[0] ?? null;
}

/** Fetch a mod by id and queue its newest file (used by Update badges in the library). */
export async function queueLatest(game: GameId, modId: number, replaces?: string): Promise<QueueItem | null> {
  const mod = await modPage(modId);
  if (!mod) return null;
  const file = newestFile(mod);
  return file ? queueModFile(game, mod, file, replaces) : null;
}

// ── links ──

/** Mod and file ids from a GameBanana or gachamod link; null when it isn't one (a bare /dl/<fileId> link has no
 *  mod id, so it is null too). */
export function parseGbLink(url: string): { modId: number; fileId?: number } | null {
  let s = (url ?? "").trim();
  try { if (/%[0-9a-f]{2}/i.test(s)) s = decodeURIComponent(s); } catch { /* keep as is */ }
  const app = /^gachamod:\/\/mod\/(\d+)/i.exec(s);
  if (app) return { modId: Number(app[1]) };
  s = s.replace(/^gachamod:(\/\/)?/i, "");
  s = s.split("#")[0]!.split("?")[0]!;
  const host = String.raw`^(?:https?:\/\/)?(?:www\.)?gamebanana\.com`;
  const mm = new RegExp(`${host}\\/mmdl\\/(\\d+),Mod,(\\d+)`, "i").exec(s);
  if (mm) return { modId: Number(mm[2]), fileId: Number(mm[1]) };
  const dl = new RegExp(`${host}\\/mods\\/download\\/(\\d+)`, "i").exec(s);
  if (dl) return { modId: Number(dl[1]) };
  const page = new RegExp(`${host}\\/mods\\/(\\d+)(?:[\\/,]|$)`, "i").exec(s);
  if (page) return { modId: Number(page[1]) };
  return null;
}

/** A file id from a bare /dl/<fileId> link (it has no mod id). */
export function fileIdFromLink(url: string): number | null {
  const m = /gamebanana\.com\/dl\/(\d+)/i.exec(url ?? "");
  return m ? Number(m[1]) : null;
}

// ── description HTML ──

const KEEP = new Set(["p", "br", "b", "strong", "i", "em", "u", "s", "a", "img", "ul", "ol", "li", "h1", "h2", "h3", "h4", "blockquote", "span", "div", "hr", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "pre", "code", "sup", "sub", "small", "mark"]);
const DROP = new Set(["script", "style", "noscript", "template", "object", "embed", "svg", "math", "form", "input", "button", "select", "textarea", "link", "meta", "head", "title", "audio", "video", "canvas"]);
/** Tags written another way. */
const RENAME: Record<string, string> = { del: "s", strike: "s", ins: "u", h5: "h4", h6: "h4", center: "div", font: "span", big: "strong", tt: "code", kbd: "code", figure: "div", figcaption: "small", section: "div", article: "div" };
/** GameBanana's colour classes ("RedColor") as CSS colours; the page keeps them readable in light and dark. */
const GB_COLORS: Record<string, string> = { red: "#e5484d", green: "#30a46c", blue: "#3e8ed0", purple: "#8e4ec6", orange: "#f76b15", yellow: "#e2b203", pink: "#d6409f", grey: "#8b8d98", gray: "#8b8d98", brown: "#a18072", cyan: "#05a2c2", teal: "#12a594", white: "#ededed", black: "#1c1c1c" };

function safeUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim(), "https://gamebanana.com/");
    return u.protocol === "https:" ? u.href : null;
  } catch { return null; }
}

/** A colour from markup, only in shapes that can't carry anything else (#hex, rgb() numbers, a colour word). */
function safeColor(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (/^#[0-9a-f]{3,8}$/.test(v)) return v;
  if (/^[0-9a-f]{6}$/.test(v)) return `#${v}`;
  if (/^rgba?\(\s*[\d.]+%?\s*,?\s*[\d.]+%?\s*,?\s*[\d.]+%?\s*([,/]\s*[\d.]+%?\s*)?\)$/.test(v)) return v;
  if (/^[a-z]{3,20}$/.test(v) && !["inherit", "initial", "unset", "revert", "currentcolor", "transparent"].includes(v)) return GB_COLORS[v] ?? v;
  return null;
}

function youtubeId(src: string | null): string | null {
  const m = src ? /(?:youtube(?:-nocookie)?\.com\/(?:embed\/|shorts\/|watch\?(?:.*&)?v=)|youtu\.be\/)([\w-]{6,})/i.exec(src) : null;
  return m ? m[1]! : null;
}

/** Where a GameBanana link points inside the app: a member's page, a mod's page or a tool's page. */
export function gbLinkTarget(url: string): { member: number } | { mod: number } | { tool: number } | null {
  const m = /^https:\/\/(?:www\.)?gamebanana\.com\/(members|mods|tools)\/(\d+)(?:[/?#]|$)/i.exec(url);
  if (!m) return null;
  const kind = m[1]!.toLowerCase(), id = Number(m[2]);
  return kind === "members" ? { member: id } : kind === "tools" ? { tool: id } : { mod: id };
}

/** The tool id of a GameBanana tool link ("https://gamebanana.com/tools/24821"), else null. */
export function gbToolId(url: string | null | undefined): number | null {
  const t = gbLinkTarget((url ?? "").trim());
  return t && "tool" in t ? t.tool : null;
}

/** The safe part of an element's style attribute and its old width, size, face and align attributes
 *  (lib/inlineStyle.ts). */
function styleOf(el: Element, raw: string, tag: string) {
  return inlineStyle(`${attrStyle(raw, (k) => el.getAttribute(k))}; ${el.getAttribute("style") ?? ""}`, tag);
}

/** rgb() greys in a style attribute are text pasted from GameBanana's own page (rgb(226, 226, 226)), not a colour
 *  the author picked. */
function pastedGrey(v: string | undefined): boolean {
  const m = /^\s*rgba?\(\s*(\d{1,3})\s*,?\s*(\d{1,3})\s*,?\s*(\d{1,3})/i.exec(v ?? "");
  if (!m) return false;
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return Math.max(r, g, b) - Math.min(r, g, b) < 8;
}

/** Description HTML with everything unsafe removed and GameBanana's own markup made portable (docs/spec.md):
 *  - links keep their text and carry the address in data-href (no href); the page opens them (GameBanana mod and
 *    member links inside the app, others in the browser)
 *  - colours (font color, style color, "RedColor" classes) become class "gb-fc" with --gbc, which the page clamps to a
 *    lightness that reads in the current scheme
 *  - spoilers become class "gb-spoiler" (hidden until clicked), centred blocks class "gb-center"
 *  - YouTube embeds become a link card with the video's thumbnail; other iframes are dropped
 *  - images keep only an https src (class "gb-dimg"; the page opens them in the lightbox) and the width the author
 *    gave them
 *  - inline styles and old width/size/face/align attributes keep what lib/inlineStyle.ts allows (gb-* classes and
 *    --gb* variables, drawn by screens/browse/gb-inline.css) */
export function sanitizeHtml(html: string): string {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out = doc.createElement("div");
  const copy = (from: Node, to: Node) => {
    for (const n of Array.from(from.childNodes)) {
      if (n.nodeType === Node.TEXT_NODE) { to.appendChild(doc.createTextNode(n.textContent ?? "")); continue; }
      if (n.nodeType !== Node.ELEMENT_NODE) continue;
      const el = n as Element;
      const raw = el.tagName.toLowerCase();
      if (DROP.has(raw)) continue;
      if (raw === "iframe") {
        const id = youtubeId(el.getAttribute("src"));
        if (!id) continue;
        const a = doc.createElement("span");
        a.setAttribute("data-href", `https://www.youtube.com/watch?v=${id}`);
        a.setAttribute("class", "gb-yt");
        a.setAttribute("title", t("Watch on YouTube"));
        a.setAttribute("role", "link");
        a.setAttribute("tabindex", "0");
        const img = doc.createElement("img");
        img.setAttribute("src", `https://img.youtube.com/vi/${id}/hqdefault.jpg`);
        img.setAttribute("alt", "");
        img.setAttribute("loading", "lazy");
        img.setAttribute("decoding", "async");
        const label = doc.createElement("span");
        label.setAttribute("class", "gb-yt-t");
        label.textContent = t("Watch on YouTube");
        a.append(img, label);
        to.appendChild(a);
        continue;
      }
      const tag = RENAME[raw] ?? raw;
      if (!KEEP.has(tag)) { copy(el, to); continue; }
      if (tag === "img") {
        const src = safeUrl(el.getAttribute("src") ?? el.getAttribute("data-src"));
        if (!src) continue;
        const img = doc.createElement("img");
        img.setAttribute("src", src);
        img.setAttribute("alt", el.getAttribute("alt") ?? "");
        const st = styleOf(el, raw, "img");
        img.setAttribute("class", ["gb-dimg", ...st.classes].join(" "));
        if (st.style) img.setAttribute("style", st.style);
        img.setAttribute("loading", "lazy");
        img.setAttribute("decoding", "async");
        to.appendChild(img);
        continue;
      }
      const clean = doc.createElement(tag);
      const classes: string[] = [];
      const cls = ` ${el.getAttribute("class") ?? ""} `;
      if (raw === "center" || (el.getAttribute("align") ?? "").toLowerCase() === "center") classes.push("gb-center");
      if (/\sSpoiler\s/.test(cls)) { classes.push("gb-spoiler"); clean.setAttribute("tabindex", "0"); clean.setAttribute("role", "button"); clean.setAttribute("title", t("Spoiler: click to show")); }
      // a colour: <font color>, style="color: ...", or GameBanana's colour classes
      const styleColor = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(el.getAttribute("style") ?? "")?.[1];
      const classColor = /\s([A-Z][a-z]+)Color\s/.exec(cls)?.[1];
      const color = safeColor(raw === "font" ? el.getAttribute("color") : null) ?? (pastedGrey(styleColor) ? null : safeColor(styleColor)) ?? (classColor ? GB_COLORS[classColor.toLowerCase()] ?? null : null);
      const st = styleOf(el, raw, tag);
      classes.push(...st.classes);
      if (color) classes.push("gb-fc");
      const style = [color ? `--gbc: ${color}` : "", st.style].filter(Boolean).join("; ");
      if (style) clean.setAttribute("style", style);
      if (tag === "a") {
        const href = safeUrl(el.getAttribute("href"));
        if (href) {
          clean.setAttribute("data-href", href);
          clean.setAttribute("title", href);
          classes.push("gb-link");
          clean.setAttribute("role", "link");
          clean.setAttribute("tabindex", "0");
        }
      }
      if (tag === "td" || tag === "th") {
        for (const k of ["colspan", "rowspan"]) { const v = el.getAttribute(k); if (v && /^\d{1,2}$/.test(v)) clean.setAttribute(k, v); }
      }
      if (tag === "ol") { const v = el.getAttribute("start"); if (v && /^\d{1,4}$/.test(v)) clean.setAttribute("start", v); }
      if (classes.length) clean.setAttribute("class", [...new Set(classes)].join(" "));
      copy(el, clean);
      to.appendChild(clean);
    }
  };
  copy(doc.body, out);
  return out.innerHTML;
}

/** The best image URL for a width in CSS pixels. */
export function imageAt(img: GbImage | null | undefined, width: number): string | undefined {
  if (!img) return undefined;
  if (width <= 100 && img.s100) return img.s100;
  if (width <= 220 && img.s220) return img.s220;
  if (width <= 530 && img.s530) return img.s530;
  if (width <= 800 && img.s800) return img.s800;
  return img.full;
}
