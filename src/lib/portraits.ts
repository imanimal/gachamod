// Sharp character portraits. GameBanana's character icons are 32x32, which blurs at any real size. This looks the
// character up on the game's community wiki (lib/games.ts): an icon file when the wiki names them in a known pattern
// ("Agent Ellen Joe Icon.png"), else the character page's lead image, shown cropped to the face. When GameBanana and
// the wiki name someone differently ("Yanagi Tsukishiro" is "Tsukishiro Yanagi" there, "Soldier 0 Anby" is "Soldier 0 -
// Anby"), the wiki's search finds the page, kept only when its title has every word of the name. Lookups go in
// batches of up to 50 names per request, answers are kept 30 days (misses 3 days), so new characters and new
// pictures arrive on their own, and GameBanana's icon is the fallback. A picture the user picked for a character (lib/prefs.ts portraitPref) beats both. Owner: skeleton.
import { useEffect, useState, useSyncExternalStore } from "react";
import type { GameId } from "./api";
import { gameMeta } from "./games";
import { portraitKey, portraitPref } from "./prefs";

export interface PortraitHit { src: string; /** a tall picture: show its top part (the face) */ crop?: boolean }
/** v: the lookup's version. An answer from an older lookup is asked again (its picture stays up meanwhile), since a
 *  newer lookup may find a better one. */
type Cached = { at: number; hit: PortraitHit | null; v?: number };
const LOOKUP_VERSION = 4;

const DAY = 86_400_000;
const KEEP_HIT = 30 * DAY, KEEP_MISS = 3 * DAY;
const memory = new Map<GameId, Map<string, Cached>>();
const pending = new Map<GameId, Set<string>>();
const inflight = new Set<string>();
const subs = new Set<() => void>();
let version = 0;
const emit = () => { version++; subs.forEach((f) => f()); };

const norm = (s: string) => s.trim().toLowerCase();

function table(game: GameId): Map<string, Cached> {
  let t = memory.get(game);
  if (t) return t;
  t = new Map();
  try {
    const raw = localStorage.getItem(`gm.portraits.${game}`);
    if (raw) for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, Cached>)) t.set(k, v);
  } catch { /* storage off or bad */ }
  memory.set(game, t);
  return t;
}
function persist(game: GameId) {
  try { localStorage.setItem(`gm.portraits.${game}`, JSON.stringify(Object.fromEntries(table(game)))); } catch { /* storage full */ }
}
const fresh = (c: Cached | undefined) => !!c && (c.v ?? 1) >= LOOKUP_VERSION && Date.now() - c.at < (c.hit ? KEEP_HIT : KEEP_MISS);

/** The cached sharp portrait for a character, or undefined when not looked up yet (null when the wiki has none). */
export function cachedPortrait(game: GameId, name: string): PortraitHit | null | undefined {
  const c = table(game).get(norm(name));
  return c ? c.hit : undefined;
}

/** Ask for portraits; they arrive through usePortrait / subscribe. */
export function requestPortraits(game: GameId, names: string[]) {
  const meta = gameMeta(game);
  if (!meta.wiki) return;
  const t = table(game);
  let set = pending.get(game);
  for (const n of names) {
    const k = norm(n);
    if (!k || fresh(t.get(k)) || inflight.has(`${game}:${k}`)) continue;
    if (!set) { set = new Set(); pending.set(game, set); }
    set.add(n.trim());
  }
  if (set?.size) schedule();
}

let timer = 0;
function schedule() {
  if (timer) return;
  timer = window.setTimeout(() => {
    timer = 0;
    for (const [game, names] of pending) {
      pending.delete(game);
      const list = [...names];
      for (let i = 0; i < list.length; i += 25) void lookup(game, list.slice(i, i + 25));
    }
  }, 40);
}

interface WikiPage { title: string; missing?: string; imageinfo?: Array<{ thumburl?: string; url?: string; width?: number; height?: number; thumbwidth?: number; thumbheight?: number }>; thumbnail?: { source: string; width: number; height: number } }
interface WikiAnswer {
  query?: { pages?: Record<string, WikiPage>; normalized?: Array<{ from: string; to: string }>; redirects?: Array<{ from: string; to: string }>; search?: Array<{ title: string }> };
}

/** The words of a name, without punctuation: "Soldier 0 - Anby" gives soldier, 0, anby. */
const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const GENDER = new Set(["female", "male", "f", "m"]);

async function wiki(api: string, params: Record<string, string>): Promise<WikiAnswer> {
  const q = new URLSearchParams({ action: "query", format: "json", origin: "*", ...params });
  const r = await fetch(`${api}?${q}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`wiki ${r.status}`);
  return (await r.json()) as WikiAnswer;
}

/** Map each asked title to the page the wiki answered with (through its normalising and redirects). */
function pagesByTitle(a: WikiAnswer): Map<string, WikiPage> {
  const pages = Object.values(a.query?.pages ?? {});
  const byTitle = new Map(pages.map((p) => [p.title, p]));
  const out = new Map<string, WikiPage>(byTitle);
  const hop = new Map<string, string>();
  for (const n of a.query?.normalized ?? []) hop.set(n.from, n.to);
  for (const n of a.query?.redirects ?? []) hop.set(n.from, n.to);
  for (const from of hop.keys()) {
    let to = from, guard = 0;
    while (hop.has(to) && guard++ < 4) to = hop.get(to)!;
    const p = byTitle.get(to);
    if (p) out.set(from, p);
  }
  return out;
}

/** Icon files in the wiki's own naming, by the wiki's title for each name (name to title). */
async function iconFiles(api: string, icons: string[], asked: Map<string, string>, found: Map<string, PortraitHit>) {
  const names = [...asked.keys()].filter((n) => !found.has(n));
  const titles = names.flatMap((n) => icons.map((p) => `File:${p.replace("{name}", asked.get(n)!)}`));
  for (let i = 0; i < titles.length; i += 50) {
    const part = titles.slice(i, i + 50);
    const a = await wiki(api, { titles: part.join("|"), prop: "imageinfo", iiprop: "url|size", iiurlwidth: "256" });
    const byTitle = pagesByTitle(a);
    for (const n of names) {
      if (found.has(n)) continue;
      for (const p of icons) {
        const page = byTitle.get(`File:${p.replace("{name}", asked.get(n)!)}`);
        const info = page && !("missing" in page) ? page.imageinfo?.[0] : undefined;
        const src = info?.thumburl ?? info?.url;
        if (src) { found.set(n, { src, crop: !!(info?.width && info.height && info.width / info.height < 0.8) }); break; }
      }
    }
  }
}

/** Pictures for characters by the wiki's title for each (name to title): 1. an icon file in the wiki's own naming,
 *  2. the page's lead image. An icon beats a lead image, also when the page lives under another title. */
async function pictures(api: string, icons: string[] | undefined, asked: Map<string, string>, found: Map<string, PortraitHit>) {
  if (icons?.length) await iconFiles(api, icons, asked, found);
  const rest = [...asked.keys()].filter((n) => !found.has(n));
  const lead = new Map<string, PortraitHit>();
  const moved = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 50) {
    const part = rest.slice(i, i + 50);
    const a = await wiki(api, { titles: part.map((n) => asked.get(n)!).join("|"), prop: "pageimages", piprop: "thumbnail", pithumbsize: "320", redirects: "1" });
    const byTitle = pagesByTitle(a);
    for (const n of part) {
      const page = byTitle.get(asked.get(n)!);
      if (!page || "missing" in page) continue;
      const th = page.thumbnail;
      if (th?.source) lead.set(n, { src: th.source, crop: th.width / th.height < 0.85 });
      if (page.title !== asked.get(n)) moved.set(n, page.title);
    }
  }
  // "Orphie Magnusson" redirects to "Orphie Magnusson & Magus", and the icon is named after the page it lands on
  if (icons?.length && moved.size) await iconFiles(api, icons, moved, found);
  for (const [n, hit] of lead) if (!found.has(n)) found.set(n, hit);
}

/** The wiki's page title for a name it spells another way: the first search hit (not a subpage) that has every word. */
async function searchTitle(api: string, name: string): Promise<string | null> {
  // "Rover Female" and "Endministrator (F)" share one page with the other form
  const want = words(name).filter((w) => !GENDER.has(w));
  if (!want.length) return null;
  const a = await wiki(api, { list: "search", srsearch: want.join(" "), srnamespace: "0", srlimit: "5" });
  for (const { title } of a.query?.search ?? []) {
    if (title.includes("/")) continue;
    const have = new Set(words(title));
    if (want.every((w) => have.has(w))) return title;
  }
  return null;
}

async function lookup(game: GameId, names: string[]) {
  const meta = gameMeta(game).wiki;
  if (!meta) return;
  const api = meta.api ?? `https://${meta.host}/api.php`;
  const keys = names.map((n) => `${game}:${norm(n)}`);
  keys.forEach((k) => inflight.add(k));
  const t = table(game);
  const found = new Map<string, PortraitHit>();
  let ok = true;
  try {
    await pictures(api, meta.icons, new Map(names.map((n) => [n, n])), found);
    // 3. names the wiki spells another way: find its page, then look again under that title
    const titles = new Map<string, string>();
    for (const n of names.filter((x) => !found.has(x))) {
      const title = await searchTitle(api, n);
      if (title && title !== n) titles.set(n, title);
    }
    if (titles.size) await pictures(api, meta.icons, titles, found);
  } catch (e) {
    ok = false; // offline or the wiki is down: ask again next time
    console.warn("portraits:", e);
  } finally {
    keys.forEach((k) => inflight.delete(k));
  }
  const now = Date.now();
  for (const n of names) {
    const hit = found.get(n) ?? null;
    if (hit || ok) t.set(norm(n), { at: now, hit, v: LOOKUP_VERSION });
  }
  persist(game);
  emit();
}

const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
/** Re-render when portraits arrive. */
export const usePortraitsVersion = () => useSyncExternalStore(subscribe, () => version);

/** The best picture for a character: the user's pick, a sharp wiki portrait, else `fallback` (GameBanana's icon). */
export function usePortrait(game: GameId | null | undefined, name: string | null | undefined, fallback?: string | null): { src: string | null; crop: boolean; sharp: boolean } {
  usePortraitsVersion();
  const custom = portraitPref.use();
  useEffect(() => { if (game && name) requestPortraits(game, [name]); }, [game, name]);
  if (!game || !name) return { src: fallback ?? null, crop: false, sharp: false };
  const mine = custom[portraitKey(game, name)];
  if (mine) return { src: mine, crop: false, sharp: true };
  const hit = cachedPortrait(game, name);
  if (hit) return { src: hit.src, crop: !!hit.crop, sharp: true };
  return { src: fallback ?? null, crop: false, sharp: false };
}

/** Look up many at once (a roster), so one request covers the screen. */
export function usePortraitBatch(game: GameId | null | undefined, names: string[]) {
  const key = names.join("|");
  const [, set] = useState(0);
  useEffect(() => { if (game && names.length) requestPortraits(game, names); set((n) => n + 1); }, [game, key]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** The picture for a character outside React (menus, prompts). */
export function portraitNow(game: GameId, name: string, fallback?: string | null): string | null {
  const mine = portraitPref.get()[portraitKey(game, name)];
  if (mine) return mine;
  return cachedPortrait(game, name)?.src ?? fallback ?? null;
}
