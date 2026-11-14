// The global search (Ctrl+K): every page, action, setting, character, mod, profile, game and creator in one list.
// Areas add what they own with registerCommands. Matching forgives: words in any order, prefixes ("prof" finds
// Profiles), letters skipped ("rscn" finds Rescan), one typo in words of 4+ letters ("charcters"), and each command
// carries the other names people use for it in `keywords` ("nsfw 18+ adult lewd" for the adult content switch).
// Owner: skeleton.
import type { IconName } from "../ui/Icon";

export interface Command {
  /** Stable id (recent picks are remembered by it). */
  id: string;
  title: string;
  /** Group in the list: "Pages", "Actions", "Settings", "Characters", "Mods", "Profiles", "Games", "Creators". */
  section: string;
  icon?: IconName;
  img?: string | null;
  /** Other words people might type for it. */
  keywords?: string;
  /** Shown on the right: a shortcut or where it is ("Ctrl+Z", "In Settings"). */
  hint?: string;
  /** Higher shows first among equal matches. */
  priority?: number;
  run: () => void;
}

/** Commands for a query. Sources that are cheap return everything and let the matcher pick; slow ones (installed
 *  mods, GameBanana) may filter by the query themselves. */
export type CommandSource = (query: string) => Command[] | Promise<Command[]>;

const sources = new Map<string, CommandSource>();
export function registerCommands(id: string, src: CommandSource): () => void {
  sources.set(id, src);
  return () => { if (sources.get(id) === src) sources.delete(id); };
}
export const commandSources = () => [...sources.values()];

// ── matching ──

const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9+#]+/g, " ").trim();
const words = (s: string) => fold(s).split(" ").filter(Boolean);

function editWithin(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  // Damerau-Levenshtein, small strings only
  const m = a.length, n = b.length;
  let prev2: number[] = [], prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2]! + 1);
      cur.push(v);
      if (v < best) best = v;
    }
    if (best > max) return false;
    prev2 = prev; prev = cur;
  }
  return prev[n]! <= max;
}

function subsequence(q: string, t: string): boolean {
  let i = 0;
  for (const c of t) if (c === q[i]) i++;
  return i === q.length;
}

/** How well one typed word matches a list of target words (0 = not at all). */
function wordScore(q: string, targets: string[], joined: string): number {
  let best = 0;
  for (const t of targets) {
    if (t === q) return 10;
    if (t.startsWith(q)) best = Math.max(best, 8 - Math.min(3, (t.length - q.length) / 4));
    else if (q.length >= 3 && t.includes(q)) best = Math.max(best, 5);
    else if (q.length >= 4 && editWithin(q, t.slice(0, q.length + 1), q.length >= 7 ? 2 : 1)) best = Math.max(best, 4);
    else if (q.length >= 4 && editWithin(q, t, q.length >= 7 ? 2 : 1)) best = Math.max(best, 4);
  }
  if (!best && q.length >= 3 && subsequence(q, joined.replace(/ /g, ""))) best = 1.5;
  return best;
}

/** A match score for a command (0 = no match). */
export function scoreCommand(query: string, c: Pick<Command, "title" | "keywords" | "priority">): number {
  const qs = words(query);
  if (!qs.length) return 1 + (c.priority ?? 0) / 10;
  const title = words(c.title), kw = words(c.keywords ?? "");
  const joinedTitle = title.join(" ");
  let total = 0;
  for (const q of qs) {
    const inTitle = wordScore(q, title, joinedTitle);
    const inKw = wordScore(q, kw, kw.join(" ")) * 0.8;
    const s = Math.max(inTitle, inKw);
    if (!s) return 0;
    total += s;
  }
  const fq = fold(query);
  if (fold(c.title).startsWith(fq)) total += 6;
  else if (fold(c.title).includes(fq)) total += 3;
  return total + (c.priority ?? 0) / 10;
}

// ── recent picks ──

const RECENT = "gm.palette.recent";
export function recentIds(): string[] { try { return JSON.parse(localStorage.getItem(RECENT) ?? "[]") as string[]; } catch { return []; } }
export function noteRecent(id: string) {
  try { localStorage.setItem(RECENT, JSON.stringify([id, ...recentIds().filter((x) => x !== id)].slice(0, 12))); } catch { /* storage off */ }
}
