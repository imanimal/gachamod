// "For you" and Surprise me: GameBanana mods you don't have yet that fit what you do have. It reads the library
// (which characters you collect mods for, whose mods you keep) and GameBanana's public lists; nothing is sent
// anywhere. Owner: BROWSE area.
//
// Candidates: the game's most liked mods of the last 30 days, the newest and the all-time best for the 4 characters
// you have the most mods for, and new mods by creators you follow or favourite. Each gets
//
//   score = quality * (0.5 + character) * (1 + 0.6 * creator) * type
//
// quality is the High quality score (1 = the top fifth for its age, capped at 2.5); character is how many of your
// mods are for its character (enabled ones count double) against your top character, 0 to 1; creator is 1 for
// creators you follow or favourite and 0.6 for creators whose mods you have; type favours outfits (recolors 0.55,
// tools 0.5). With an empty library it comes down to quality. Mods you have, removed before, hid, or by blocked
// creators never show, and each further pick for the same character or creator counts 18% less so one favourite
// doesn't fill the list.
import { library, type GameId, type ModEntry } from "./api";
import { hideFromAi, type AiTask } from "./ai";
import { characterList, hqBar, hqScore, isAbort, listByCreators, listMods, type GbCard, type GbKind } from "./gamebanana";
import { creatorsPref, hiddenModsPref, nsfwPref } from "./prefs";
import { allGames, currentGame, currentRoute, go } from "./store";
import { toast } from "../ui/toast";

interface Taste {
  /** Character (lower case) to weight. */
  chars: Map<string, number>;
  /** Creator names (lower case) whose mods are in the library. */
  makers: Set<string>;
  /** GameBanana ids installed now, and ones removed before. */
  have: Set<number>;
  gone: Set<number>;
  mods: ModEntry[];
}

const KIND_WEIGHT: Record<GbKind, number> = { outfit: 1, texture: 0.55, weapon: 0.6, tool: 0.5, ui: 0.5, other: 0.45 };

async function taste(game: GameId): Promise<Taste> {
  const [mods, archived] = await Promise.all([
    library.list(game).catch(() => [] as ModEntry[]),
    library.archive(game).catch(() => []),
  ]);
  const t: Taste = { chars: new Map(), makers: new Set(), have: new Set(), gone: new Set(), mods };
  for (const m of mods) {
    if (m.character) { const k = m.character.toLowerCase(); t.chars.set(k, (t.chars.get(k) ?? 0) + (m.enabled ? 2 : 1) + (m.favorite ? 1 : 0)); }
    if (m.source?.submitter) t.makers.add(m.source.submitter.toLowerCase());
    if (m.source?.modId) t.have.add(m.source.modId);
  }
  for (const a of Array.isArray(archived) ? archived : []) if (a?.source?.modId) t.gone.add(a.source.modId);
  return t;
}

/** Mods you don't have that fit your library, best first. Throws only when GameBanana can't be reached at all. */
export async function recommend(game: GameId, opts: { limit?: number; signal?: AbortSignal } = {}): Promise<GbCard[]> {
  const gs = allGames().find((g) => g.id === game);
  if (!gs?.gamebananaId) return [];
  const gbGameId = gs.gamebananaId, signal = opts.signal;
  const t = await taste(game);
  const creators = creatorsPref.get();
  const liked = Object.values(creators).filter((c) => (c.sub || c.fav || c.prio) && !c.blocked).map((c) => c.id);
  const top = [...t.chars.entries()].sort((a, b) => b[1] - a[1]);
  const maxChar = top[0]?.[1] ?? 1;
  const cats = await characterList(game).catch(() => []);

  const lists: Array<Promise<GbCard[]>> = [
    listMods({ gbGameId, page: 1, perPage: 50, sort: "month", signal }).then((r) => r.items),
    listMods({ gbGameId, page: 2, perPage: 50, sort: "month", signal }).then((r) => r.items),
  ];
  for (const [name] of top.slice(0, 4)) {
    const cat = cats.find((c) => c.name.toLowerCase() === name);
    if (!cat) continue;
    lists.push(listMods({ gbGameId, page: 1, perPage: 30, sort: "newest", categoryId: cat.id, signal }).then((r) => r.items));
    lists.push(listMods({ gbGameId, page: 1, perPage: 30, sort: "likes", categoryId: cat.id, signal }).then((r) => r.items));
  }
  if (liked.length) lists.push(listByCreators(liked.slice(0, 20), { gbGameId, sort: "newest", signal }).then((r) => r.items));
  const got = await Promise.allSettled(lists);
  const aborted = got.find((g) => g.status === "rejected" && isAbort(g.reason));
  if (aborted) throw (aborted as PromiseRejectedResult).reason;
  if (got.every((g) => g.status === "rejected")) throw (got[0] as PromiseRejectedResult).reason;

  const hidden = new Set(hiddenModsPref.get());
  const hideAdult = nsfwPref.get() === "hide";
  const seen = new Set<number>();
  const cards = got.flatMap((g) => (g.status === "fulfilled" ? g.value : [])).filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    if (t.have.has(c.id) || t.gone.has(c.id) || hidden.has(c.id)) return false;
    if (c.submitter && creators[String(c.submitter.id)]?.blocked) return false;
    return !(hideAdult && c.nsfw);
  });
  const bar = await hqBar(gbGameId, signal).catch((e) => { if (isAbort(e)) throw e; return { bar: 300, median: 120 }; });
  const now = Date.now() / 1000;
  const scored = cards.map((c) => {
    const quality = Math.min(2.5, hqScore(c, bar, null, now));
    const character = c.character ? (t.chars.get(c.character.toLowerCase()) ?? 0) / maxChar : 0;
    const who = c.submitter;
    const creator = who && liked.includes(who.id) ? 1 : who && t.makers.has(who.name.toLowerCase()) ? 0.6 : 0;
    return { c, score: quality * (0.5 + character) * (1 + 0.6 * creator) * KIND_WEIGHT[c.kind ?? "outfit"] };
  }).sort((a, b) => b.score - a.score);

  // spread the picks: each further mod for the same character or by the same creator counts 18% less
  const out: GbCard[] = [];
  const perChar = new Map<string, number>(), perMaker = new Map<number, number>();
  const left = [...scored];
  const limit = opts.limit ?? 40;
  while (left.length && out.length < limit) {
    let best = 0, bestScore = -1;
    for (let i = 0; i < Math.min(left.length, 60); i++) {
      const { c, score } = left[i]!;
      const n = (c.character ? perChar.get(c.character) ?? 0 : 0) + (c.submitter ? perMaker.get(c.submitter.id) ?? 0 : 0);
      const s = score * 0.82 ** n;
      if (s > bestScore) { best = i; bestScore = s; }
    }
    const { c } = left.splice(best, 1)[0]!;
    out.push(c);
    if (c.character) perChar.set(c.character, (perChar.get(c.character) ?? 0) + 1);
    if (c.submitter) perMaker.set(c.submitter.id, (perMaker.get(c.submitter.id) ?? 0) + 1);
  }
  return out;
}

const surprised: number[] = [];

/** Open a mod you don't have that suits your library: one of the best 25 "For you" picks, better ones more likely,
 *  not one it showed you lately. Returns it, or null (a toast says why). */
export async function surpriseMe(game?: GameId | null): Promise<GbCard | null> {
  const g = game ?? currentGame()?.id;
  if (!g) return null;
  let recs: GbCard[];
  try { recs = await recommend(g, { limit: 40 }); } catch { toast("Couldn't reach GameBanana. Try again in a moment", true); return null; }
  let pool = recs.filter((c) => !surprised.includes(c.id)).slice(0, 25);
  if (!pool.length && recs.length) { surprised.length = 0; pool = recs.slice(0, 25); }
  if (!pool.length) { toast("Nothing new to suggest right now"); return null; }
  const weights = pool.map((_, i) => 1 / (1 + i * 0.15));
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  let pick = pool[pool.length - 1]!;
  for (let i = 0; i < pool.length; i++) { r -= weights[i]!; if (r <= 0) { pick = pool[i]!; break; } }
  surprised.push(pick.id);
  if (surprised.length > 30) surprised.shift();
  go({ ...currentRoute(), modId: pick.id });
  return pick;
}

/** A task for the chatbot: suggest mods from what the library holds (AiHost builds the prompt). */
export async function ideasTask(game: GameId): Promise<AiTask> {
  const t = await taste(game);
  const chars = [...t.chars.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
    .map(([k, n]) => `${t.mods.find((m) => m.character?.toLowerCase() === k)?.character ?? k} (${n})`);
  const makers = [...t.makers].slice(0, 15);
  // adult mods' names stay out (lib/ai.ts)
  const names = t.mods.filter((m) => !hideFromAi(m)).slice(0, 40).map((m) => m.name);
  const detail = [
    chars.length ? `Characters I have the most mods for (weight): ${chars.join(", ")}.` : "I don't have any mods yet.",
    makers.length ? `Creators whose mods I keep: ${makers.join(", ")}.` : "",
    names.length ? `Some of my mods: ${names.join("; ")}.` : "",
  ].filter(Boolean).join("\n");
  return { kind: "recommend", title: "Mod ideas", game, detail };
}
