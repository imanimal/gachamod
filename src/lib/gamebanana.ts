// GameBanana's public API (apiv11, no key, CORS allowed), called straight from the UI in Tauri and in the browser demo.
// Owner: ONLINE area (docs/spec.md, "Browse"; API notes in docs/research.md, section 2).
// Every function caches in memory (and sessionStorage/localStorage where noted) and never throws for a missing
// optional field. The signatures below are the contract other areas compile against: keep them.
import type { GameId, ModEntry } from "./api";
import { queue, type QueueItem, type QueueRequest } from "./api/online";
import { currentGame } from "./store";

export const GB = "https://gamebanana.com/apiv11";

export interface GbGameInfo { id: number; name: string; icon: string | null; banner: string | null }

/** One image at the sizes GameBanana serves. Any of them may be missing; `full` always exists. */
export interface GbImage { full: string; s100?: string; s220?: string; s530?: string; s800?: string; caption?: string; width?: number; height?: number }

export interface GbUser { id: number; name: string; avatar: string | null; url: string }

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
}

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
}

export interface GbUpdate { id: number; name: string; version: string | null; added: number; changes: Array<{ cat: string; text: string }>; text: string }

export type GbSort = "popular" | "newest" | "updated" | "downloads" | "likes" | "views";

export interface ListQuery {
  gbGameId: number;
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

const OFFLINE = "GameBanana didn't answer. Check your connection and try again.";
type Json = Record<string, unknown>;

let inFlight = 0;
const waiting: Array<() => void> = [];

function abortError(): Error { return new DOMException("Aborted", "AbortError"); }
export const isAbort = (e: unknown): boolean => e instanceof DOMException && e.name === "AbortError";

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
    const t = setTimeout(() => { signal?.removeEventListener("abort", stop); resolve(); }, ms);
    const stop = () => { clearTimeout(t); reject(abortError()); };
    signal?.addEventListener("abort", stop, { once: true });
  });
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  await acquire(signal);
  try {
    for (let attempt = 0; ; attempt++) {
      let r: Response;
      try {
        r = await fetch(url, { signal, headers: { Accept: "application/json" } });
      } catch (e) {
        if (signal?.aborted || isAbort(e)) throw abortError();
        if (attempt === 0) { await pause(800, signal); continue; }
        throw new Error(OFFLINE);
      }
      if (r.status >= 500 && attempt === 0) { await pause(800, signal); continue; }
      if (r.status === 404) throw new Error("GameBanana doesn't have that page. It may have been removed.");
      if (!r.ok) throw new Error(`GameBanana answered with an error (${r.status}). Try again in a minute.`);
      let body: unknown;
      try { body = await r.json(); } catch { throw new Error("GameBanana sent something gachamod couldn't read. Try again in a minute."); }
      if (body && typeof body === "object" && "_sErrorCode" in body) {
        throw new Error(`GameBanana didn't accept the request (${String((body as Json)._sErrorCode)}).`);
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
  return { id, name, avatar: https(str(o._sAvatarUrl)), url: str(o._sProfileUrl) ?? `https://gamebanana.com/members/${id}` };
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

function parseCard(raw: unknown, chars: GbCategoryRef[]): GbCard | null {
  const o = obj(raw);
  const id = num(o?._idRow), name = str(o?._sName);
  if (!o || id === null || !name) return null;
  if (o._sModelName !== undefined && o._sModelName !== "Mod") return null;
  const category = parseCategory(o._aSubCategory) ?? parseCategory(o._aCategory) ?? parseCategory(o._aRootCategory);
  const visibility = str(o._sInitialVisibility);
  const added = num(o._tsDateAdded) ?? 0;
  return {
    id, name, url: str(o._sProfileUrl) ?? `https://gamebanana.com/mods/${id}`,
    image: parseImages(o._aPreviewMedia)[0] ?? null,
    submitter: parseUser(o._aSubmitter),
    category,
    character: matchCharacter(category, chars),
    likes: num(o._nLikeCount) ?? 0,
    views: num(o._nViewCount) ?? 0,
    downloads: num(o._nDownloadCount),
    added,
    updated: num(o._tsDateUpdated) ?? num(o._tsDateModified) ?? added,
    nsfw: o._bHasContentRatings === true || visibility === "warn" || visibility === "hide",
    version: str(o._sVersion),
  };
}

const WARNING_WORDS: Record<string, string> = { contains_exe: "Has program files", contains_dll: "Has program libraries", contains_script: "Has scripts" };

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

async function charsForCat(cat: number | null): Promise<GbCategoryRef[]> {
  if (!cat) return [];
  const game = Object.entries(CHAR_CATS).find(([, v]) => v.cat === cat)?.[0] ?? String(cat);
  const key = `gm.gb.chars.${game}`;
  const stored = storeGet<GbCategoryRef[]>("local", key, 86_400_000);
  if (stored) return stored;
  return cached(`chars:${cat}`, 86_400_000, async () => {
    const raw = await getJson(`${GB}/Mod/Categories?_idCategoryRow=${cat}&_sSort=a_to_z&_bShowEmpty=true`);
    const list = arr(raw).map(parseCategory).filter((c): c is GbCategoryRef => !!c);
    if (list.length) storeSet("local", key, list);
    return list;
  });
}

async function charsQuiet(cat: number | null): Promise<GbCategoryRef[]> {
  try { return await charsForCat(cat); } catch (e) { console.warn("GameBanana characters:", e); return []; }
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
      const ofType = (t: string) => https(str(media.find((m) => m?._sType === t)?._sUrl));
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
  popular: "Generic_MostDownloaded", downloads: "Generic_MostDownloaded", newest: "Generic_Newest",
  updated: "Generic_LatestUpdated", likes: "Generic_MostLiked", views: "Generic_MostViewed",
};
const SEARCH_ORDER: Partial<Record<GbSort, string>> = { newest: "date", updated: "udate" };

/** A page of mods for a game, newest/popular/etc., optionally in one category or matching text. */
export async function listMods(q: ListQuery): Promise<ListResult> {
  const page = Math.max(1, Math.floor(q.page || 1));
  const search = q.search?.trim() ?? "";
  const sort = q.sort ?? "popular";
  let url: string;
  let perPage: number;
  if (search) {
    perPage = 15;
    url = `${GB}/Util/Search/Results?_sModelName=Mod&_sOrder=${SEARCH_ORDER[sort] ?? "best_match"}&_idGameRow=${q.gbGameId}&_sSearchString=${encodeURIComponent(search)}&_nPage=${page}`;
  } else {
    perPage = Math.min(50, Math.max(1, q.perPage ?? 30));
    url = `${GB}/Mod/Index?_nPage=${page}&_nPerpage=${perPage}&_aFilters[Generic_Game]=${q.gbGameId}&_sSort=${INDEX_SORT[sort]}`;
    if (q.categoryId) url += `&_aFilters[Generic_Category]=${q.categoryId}`;
  }
  const result = await cached(`list:${url}`, MIN5, async () => {
    const [raw, chars] = await Promise.all([getJson(url, q.signal), charsQuiet(charCatForGb(q.gbGameId))]);
    const o = obj(raw);
    const meta = obj(o?._aMetadata);
    const records = arr(o?._aRecords);
    const items = records.map((r) => parseCard(r, chars)).filter((c): c is GbCard => !!c);
    const total = num(meta?._nRecordCount) ?? items.length;
    const complete = meta?._bIsComplete === true || records.length === 0 || page * perPage >= total;
    return { items, total, complete } satisfies ListResult;
  });
  // search can't filter by category on GameBanana's side
  if (search && q.categoryId) {
    const id = q.categoryId;
    return { ...result, items: result.items.filter((c) => c.category?.id === id) };
  }
  return result;
}

/** Everything about one mod (Mod/<id>/ProfilePage). */
export async function modPage(id: number, signal?: AbortSignal): Promise<GbMod | null> {
  if (!Number.isFinite(id) || id <= 0) return null;
  return cached(`mod:${id}`, MIN5, async () => {
    const o = obj(await getJson(`${GB}/Mod/${id}/ProfilePage`, signal));
    if (!o) return null;
    const gameId = num(obj(o._aGame)?._idRow);
    const charCat = gameId ? charCatForGb(gameId) : null;
    const chars = await charsQuiet(charCat);
    const card = parseCard({ ...o, _sModelName: "Mod" }, chars);
    if (!card) return null;
    const category = parseCategory(o._aCategory) ?? card.category;
    const superCategory = parseCategory(o._aSuperCategory);
    const character = (superCategory && charCat && superCategory.id === charCat && category ? category.name : null) ?? matchCharacter(category, chars);
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
      game: game && gameId !== null ? { id: gameId, name: str(game._sName) ?? "" } : null,
    } satisfies GbMod;
  });
}

/** A mod's update posts, newest first. */
export async function modUpdates(id: number): Promise<GbUpdate[]> {
  try {
    return await cached(`updates:${id}`, MIN5, async () => {
      const o = obj(await getJson(`${GB}/Mod/${id}/Updates?_nPage=1&_nPerpage=20`));
      return arr(o?._aRecords).map((r): GbUpdate | null => {
        const u = obj(r);
        const uid = num(u?._idRow);
        if (!u || uid === null) return null;
        const changes = arr(u._aChangeLog).map(obj).filter((c): c is Json => !!c)
          .map((c) => ({ cat: str(c.cat) ?? "", text: str(c.text) ?? "" })).filter((c) => c.text);
        return { id: uid, name: str(u._sName) ?? "Update", version: str(u._sVersion), added: num(u._tsDateAdded) ?? 0, changes, text: str(u._sText) ?? "" };
      }).filter((u): u is GbUpdate => !!u).sort((a, b) => b.added - a.added);
    });
  } catch (e) {
    console.warn("GameBanana updates:", e);
    return [];
  }
}

/** The game's character categories with portrait icons (cached a day). Empty for games without one. */
export async function characterList(game: GameId): Promise<GbCategoryRef[]> {
  return charsQuiet(charCatFor(game));
}

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

const KEEP = new Set(["p", "br", "b", "strong", "i", "em", "u", "s", "a", "img", "ul", "ol", "li", "h1", "h2", "h3", "h4", "blockquote", "span", "div", "hr", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption"]);
const DROP = new Set(["script", "style", "noscript", "template", "object", "embed", "svg", "math", "form", "input", "button", "select", "textarea", "link", "meta", "head", "title", "audio", "video", "canvas"]);

function safeUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim(), "https://gamebanana.com/");
    return u.protocol === "https:" ? u.href : null;
  } catch { return null; }
}

function youtubeId(src: string | null): string | null {
  const m = src ? /(?:youtube(?:-nocookie)?\.com\/embed\/|youtu\.be\/|youtube\.com\/watch\?v=)([\w-]{6,})/i.exec(src) : null;
  return m ? m[1]! : null;
}

/** Description HTML with everything unsafe removed (see docs/spec.md). Links keep their text and carry the address
 *  in data-href (no href); the page opens them with shell.openUrl. */
export function sanitizeHtml(html: string): string {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out = doc.createElement("div");
  const copy = (from: Node, to: Node) => {
    for (const n of Array.from(from.childNodes)) {
      if (n.nodeType === Node.TEXT_NODE) { to.appendChild(doc.createTextNode(n.textContent ?? "")); continue; }
      if (n.nodeType !== Node.ELEMENT_NODE) continue;
      const el = n as Element;
      const tag = el.tagName.toLowerCase();
      if (DROP.has(tag)) continue;
      if (tag === "iframe") {
        const id = youtubeId(el.getAttribute("src"));
        if (!id) continue;
        const a = doc.createElement("a");
        a.setAttribute("data-href", `https://www.youtube.com/watch?v=${id}`);
        a.setAttribute("class", "gb-yt");
        a.setAttribute("title", "Play on YouTube");
        a.setAttribute("role", "link");
        a.setAttribute("tabindex", "0");
        const img = doc.createElement("img");
        img.setAttribute("src", `https://img.youtube.com/vi/${id}/hqdefault.jpg`);
        img.setAttribute("alt", "YouTube video");
        img.setAttribute("loading", "lazy");
        img.setAttribute("decoding", "async");
        a.appendChild(img);
        to.appendChild(a);
        continue;
      }
      if (/^h[56]$/.test(tag)) { const h = doc.createElement("h4"); copy(el, h); to.appendChild(h); continue; }
      if (!KEEP.has(tag)) { copy(el, to); continue; }
      if (tag === "img") {
        const src = safeUrl(el.getAttribute("src") ?? el.getAttribute("data-src"));
        if (!src) continue;
        const img = doc.createElement("img");
        img.setAttribute("src", src);
        img.setAttribute("alt", el.getAttribute("alt") ?? "");
        img.setAttribute("loading", "lazy");
        img.setAttribute("decoding", "async");
        to.appendChild(img);
        continue;
      }
      const clean = doc.createElement(tag);
      if (tag === "a") {
        const href = safeUrl(el.getAttribute("href"));
        if (href) {
          clean.setAttribute("data-href", href);
          clean.setAttribute("title", href);
          clean.setAttribute("class", "gb-link");
          clean.setAttribute("role", "link");
          clean.setAttribute("tabindex", "0");
        }
      }
      if (tag === "td" || tag === "th") {
        for (const k of ["colspan", "rowspan"]) { const v = el.getAttribute(k); if (v && /^\d{1,2}$/.test(v)) clean.setAttribute(k, v); }
      }
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
