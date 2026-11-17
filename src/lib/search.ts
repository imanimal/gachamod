// The global search (Ctrl+K): every page, action, setting, character, mod, profile, game and creator in one list.
// Areas add what they own with registerCommands. Matching forgives: words in any order, prefixes ("prof" finds
// Profiles), letters skipped ("rscn" finds Rescan), one typo in words of 4+ letters ("charcters"), and each command
// carries the other names people use for it in `keywords` ("nsfw 18+ adult lewd" for the adult content switch).
// Owner: skeleton.
import type { MenuEntry } from "../ui/ContextMenu";
import type { IconName } from "../ui/Icon";
import { english, lang } from "./i18n";

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
  /** Shown on the right: a shortcut or a state ("Ctrl+Z", "On"). */
  hint?: string;
  /** Where it lives, shown under the title: "Settings › Mods › Storage". Matched by the search too. */
  where?: string;
  /** Higher shows first among equal matches. */
  priority?: number;
  /** Shown after everything else that matches, whatever its score ("Search GameBanana for ..."). */
  fallback?: boolean;
  /** The thing's usual right-click menu (a mod's, a profile's), shown on right-click or Shift+F10 on the result. */
  menu?: () => MenuEntry[];
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
export const commandSources = () => [...sources.entries()];

// ── matching ──

// letters and digits of any script, so Russian and Chinese titles match too
const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}+#]+/gu, " ").trim();
/** Chinese and Japanese run words together without spaces, so a two-character word is worth looking for inside one. */
const cjk = (s: string) => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(s);
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

function subsequence(q: string, target: string): boolean {
  let i = 0;
  for (const c of target) if (c === q[i]) i++;
  return i === q.length;
}

/** How well one typed word matches a list of target words (0 = not at all). */
function wordScore(q: string, targets: string[], joined: string): number {
  let best = 0;
  for (const w of targets) {
    if (w === q) return 10;
    if (w.startsWith(q)) best = Math.max(best, 8 - Math.min(3, (w.length - q.length) / 4));
    else if ((q.length >= 3 || cjk(q)) && w.includes(q)) best = Math.max(best, 5);
    else if (q.length >= 4 && editWithin(q, w.slice(0, q.length + 1), q.length >= 7 ? 2 : 1)) best = Math.max(best, 4);
    else if (q.length >= 4 && editWithin(q, w, q.length >= 7 ? 2 : 1)) best = Math.max(best, 4);
  }
  // skipped letters ("rscn" finds Rescan) only inside one title word: across several words nearly anything matches
  if (!best && q.length >= 3 && joined && targets.some((w) => w.length <= q.length * 2 + 2 && subsequence(q, w))) best = 1.5;
  return best;
}

/** A match score for a command (0 = no match). */
export function scoreCommand(query: string, c: Pick<Command, "title" | "keywords" | "priority" | "where">): number {
  const qs = words(query);
  if (!qs.length) return 1 + (c.priority ?? 0) / 10;
  // a translated title is found by its English words too ("settings" and "настройки" both work)
  const en = lang === "en" ? "" : `${english(c.title)} ${c.where ? english(c.where) : ""}`;
  const title = words(c.title), kw = words(`${c.keywords ?? ""} ${c.where ?? ""} ${en}`);
  const joinedTitle = title.join(" ");
  let total = 0;
  for (const q of qs) {
    const inTitle = wordScore(q, title, joinedTitle);
    const inKw = wordScore(q, kw, "") * 0.8;
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
