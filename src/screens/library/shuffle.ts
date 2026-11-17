// Shuffle outfits: for every character with two or more mods and one of them on, turn one on at random and the others off, as
// one change with Undo. Sub-mods aren't outfits: they follow their parent. Characters with every mod off stay that way. Runs from a button (Mods, Characters, search) or on its own: each time you press Play, or at
// the first Play of the day (Settings, Mods). Mods hidden as for adults stay out of it. Owner: LIBRARY area.
import { library, type GameId, type ModEntry } from "../../lib/api";
import { nsfwPref, pref } from "../../lib/prefs";
import { toast } from "../../ui/toast";
import { changeStates } from "./data";
import { t, tn } from "../../lib/i18n";

export type ShuffleWhen = "off" | "play" | "day";
export const shuffleWhenPref = pref<ShuffleWhen>("mods.shuffle", "off", (r) => (r === "play" || r === "day" || r === "off" ? r : undefined), (v) => v);
const lastDay = pref<string>("mods.shuffleDay", "", (r) => r, (v) => v);

/** Pick new outfits. Returns how many characters changed (0 also shows why). */
export async function shuffleOutfits(game: GameId): Promise<number> {
  const mods = await library.list(game);
  const hide = nsfwPref.get() === "hide";
  const byChar = new Map<string, ModEntry[]>();
  for (const m of mods) {
    if (!m.character || m.parent || m.iniCount === 0 || (hide && m.nsfw)) continue;
    const list = byChar.get(m.character) ?? [];
    list.push(m);
    byChar.set(m.character, list);
  }
  const ons: string[] = [], offs: string[] = [];
  let n = 0;
  for (const list of byChar.values()) {
    if (list.length < 2) continue;
    const wearing = list.filter((m) => m.enabled);
    if (!wearing.length) continue;
    // something other than what's on now, so every shuffle shows a change
    const pool = wearing.length === 1 ? list.filter((m) => m.id !== wearing[0]!.id) : list;
    const pick = pool[Math.floor(Math.random() * pool.length)]!;
    ons.push(pick.id);
    offs.push(...wearing.filter((m) => m.id !== pick.id).map((m) => m.id));
    n++;
  }
  if (!n) { toast(t("Nothing to shuffle yet. A character needs two or more mods, with one of them on")); return 0; }
  await changeStates(game, tn(n, "Shuffled outfits for {n} character", "Shuffled outfits for {n} characters"), ons, offs, mods);
  return n;
}

/** Before Play: shuffle when Settings asks for it (each Play, or the first Play of the day). Never blocks the start. */
export async function shuffleBeforePlay(game: GameId) {
  const when = shuffleWhenPref.get();
  if (when === "off") return;
  if (when === "day") {
    const today = new Date().toDateString();
    if (lastDay.get() === today) return;
    void lastDay.set(today);
  }
  try { await shuffleOutfits(game); } catch { /* the game still starts */ }
}
