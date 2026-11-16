// Live switching state for the Tools panel and the mod drawer: one store per game, reloaded when the library
// changes, and the actions with their Undo. Owner: INGAME area.
import { useEffect, useSyncExternalStore } from "react";
import { errorText, live, settings, type GameId, type LiveChange, type LiveGroup, type LiveInfo, type MenuSettings } from "../../lib/api";
import { record } from "../../lib/history";
import { emitApp, onApp } from "../../lib/store";
import { toast } from "../../ui/toast";
import { onPublish } from "../library/data";
import { sayF10Note } from "../../lib/elevation";

const infos = new Map<GameId, LiveInfo | null>();
const subs = new Set<() => void>();
const ping = () => subs.forEach((f) => f());

export async function reloadLive(game: GameId) {
  try { infos.set(game, await live.info(game)); } catch { infos.set(game, { groups: [], ready: [], running: false, menu: { style: "window", key: "F7", pad: true, fastSave: true }, blocked: false, all: false, allowed: false }); }
  ping();
}

// ── tester options ("ui.tester"): switching in game in the games it hasn't been checked in (live.rs CHECKED) ──

let tester: boolean | null = null;
let testerAsked = false;
const testerSubs = new Set<() => void>();

/** Whether tester options are on, shared by every place that shows the switch (Settings, Tools, Check this game). */
export function useTester(): boolean {
  useEffect(() => {
    if (testerAsked) return;
    testerAsked = true;
    settings.get("ui.tester").then((v) => { tester = v === "1"; testerSubs.forEach((f) => f()); }).catch(() => { testerAsked = false; });
  }, []);
  return useSyncExternalStore((f) => { testerSubs.add(f); return () => { testerSubs.delete(f); }; }, () => tester ?? false);
}

/** Turn tester options on or off. Every game's live info is read again, since what it allows changes. */
export async function setTester(on: boolean) {
  try {
    await settings.set("ui.tester", on ? "1" : "0");
    tester = on;
    testerSubs.forEach((f) => f());
    await Promise.all([...infos.keys()].map((g) => reloadLive(g)));
  } catch (e) { toast(errorText(e), true); }
}

/** Whether new groups can be set up in the game (null while its info hasn't loaded). */
export const liveAllowed = (game: GameId): boolean | null => infos.get(game)?.allowed ?? null;

let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  // a mod turned on or off (a live skin turned on is a pick), renamed, removed: names and states in the groups follow
  let t = 0;
  const later = (game: GameId) => {
    if (!infos.has(game)) return;
    window.clearTimeout(t);
    t = window.setTimeout(() => void reloadLive(game), 500);
  };
  onApp((e) => { if (e.type === "library-refresh") later(e.game); });
  onPublish((game) => later(game));
}

const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const load = (game: GameId) => { if (!infos.has(game)) { infos.set(game, null); void reloadLive(game); } };

/** The game's live groups, or null while loading. */
export function useLive(game: GameId): LiveInfo | null {
  wire();
  const v = useSyncExternalStore(subscribe, () => infos.get(game) ?? null);
  useEffect(() => load(game), [game]);
  return v;
}

/** The same outside React: null when it isn't a live skin or the game's groups haven't loaded. */
export const liveCharacterOf = (game: GameId, modId: string): string | null =>
  infos.get(game)?.groups.find((g) => g.mods.some((m) => m.modId === modId))?.character ?? null;

/** The live skin is the one its character shows next, but the running game gets it only at its next reload. */
export function useLiveWaiting(game: GameId, modId: string): boolean {
  wire();
  return useSyncExternalStore(subscribe, () => !!infos.get(game)?.groups.some((g) => g.waiting && g.mods.some((m) => m.modId === modId && m.slot === g.active)));
}

/** For a live skin that isn't showing: the name of the skin its character shows instead, or null. */
export function liveShownInstead(game: GameId, modId: string): string | null {
  const g = infos.get(game)?.groups.find((x) => x.mods.some((m) => m.modId === modId));
  if (!g || g.active === 0 || g.mods.some((m) => m.modId === modId && m.slot === g.active)) return null;
  return g.mods.find((m) => m.slot === g.active)?.name ?? null;
}

/** The character whose live skins a mod switches with, or null (for its card's tag). */
export function useLiveCharacter(game: GameId, modId: string): string | null {
  wire();
  const v = useSyncExternalStore(subscribe, () => infos.get(game)?.groups.find((g) => g.mods.some((m) => m.modId === modId))?.character ?? null);
  useEffect(() => load(game), [game]);
  return v;
}

const after = (game: GameId) => { emitApp({ type: "library-refresh", game }); void reloadLive(game); };

function skippedNote(c: LiveChange) {
  const s = c.skipped[0];
  if (!s) return;
  const more = c.skipped.length > 1 ? ` (and ${c.skipped.length - 1} more)` : "";
  toast(`${s.name} can't be switched in game: ${s.reason}${more}`, true);
}

/** Make mods live (normally all of one character's). One Undo step takes them out again. */
export async function makeLive(game: GameId, ids: string[], who: string) {
  try {
    const c = await live.add(game, ids);
    after(game);
    skippedNote(c);
    if (!c.changed.length) return;
    record({
      label: `Made ${who} switch in game. It starts after the game reloads once`,
      undo: async () => { await live.remove(game, c.changed); after(game); },
      redo: async () => { await live.add(game, c.changed); after(game); },
    });
  } catch (e) { toast(errorText(e), true); }
}

/** Stop switching mods live. The one showing stays on. */
export async function stopLive(game: GameId, ids: string[], who: string) {
  try {
    const c = await live.remove(game, ids);
    after(game);
    if (!c.changed.length) return;
    record({
      label: `Stopped switching ${who} in game`,
      undo: async () => { await live.add(game, c.changed); after(game); },
      redo: async () => { await live.remove(game, c.changed); after(game); },
    });
  } catch (e) { toast(errorText(e), true); }
}

/** The panel's one switch. On: every mod that has a character switches in game, and new ones join by themselves.
 *  Off: every character stops switching and keeps the skin it shows. Undo flips it back. */
export async function setAll(game: GameId, on: boolean) {
  try {
    const c = await live.setAll(game, on);
    after(game);
    skippedNote(c);
    record({
      label: on ? "Turned on switching skins in game. It starts after the game reloads once"
        : "Turned off switching skins in game. Each character keeps the skin it showed",
      undo: async () => { await live.setAll(game, !on); after(game); },
      redo: async () => { await live.setAll(game, on); after(game); },
    });
  } catch (e) { toast(errorText(e), true); }
}

/** Change how the skin menu opens while playing. Undo puts the old way back. */
export async function setMenu(game: GameId, before: MenuSettings, menu: MenuSettings) {
  try {
    await live.setMenu(game, menu);
    await reloadLive(game);
    record({
      label: `Set the in-game menu to ${menu.style === "window" ? "open over the game" : "be drawn by the game"} with ${menu.key}`,
      undo: async () => { await live.setMenu(game, before); await reloadLive(game); },
      redo: async () => { await live.setMenu(game, menu); await reloadLive(game); },
    });
  } catch (e) { toast(errorText(e), true); }
}

// ── skins not shown in game yet ──
// The first time a newly installed skin shows, the game can draw the character wrong until it leaves the screen and
// comes back (switch to another character and back). The menu marks those skins and says so. Kept in this computer's
// browser storage; the first time it's read, every live skin counts as shown, so only skins that join later are new.

const seenKey = (game: GameId) => `ingame.seen.${game}`;
const liveIds = (info: LiveInfo) => info.groups.flatMap((g) => g.mods.map((m) => m.modId));
function seen(game: GameId, info: LiveInfo): Set<string> {
  try {
    const raw = localStorage.getItem(seenKey(game));
    if (raw) return new Set((JSON.parse(raw) as unknown[]).filter((x): x is string => typeof x === "string"));
    const all = liveIds(info);
    localStorage.setItem(seenKey(game), JSON.stringify(all));
    return new Set(all);
  } catch { return new Set(liveIds(info)); }
}

/** A live skin that hasn't been shown in game since it was installed (the one showing now never counts). */
export function isNewSkin(game: GameId, info: LiveInfo, g: LiveGroup, modId: string): boolean {
  if (g.mods.some((m) => m.modId === modId && m.slot === g.active)) return false;
  return !seen(game, info).has(modId);
}

/** Note a skin as shown in game. */
export function markShown(game: GameId, modId: string) {
  try {
    const raw = localStorage.getItem(seenKey(game));
    const list = raw ? (JSON.parse(raw) as string[]) : [];
    if (!list.includes(modId)) localStorage.setItem(seenKey(game), JSON.stringify([...list, modId]));
  } catch { /* it just reads as new again */ }
}

/** What to do when a new skin looks wrong. */
export const newSkinTip = (character: string) =>
  `The first time a new skin shows, ${character} can look wrong. Switch to another character and back to fix it. If it still looks wrong after that, the mod itself has a problem.`;

const nameOf = (g: LiveGroup, slot: number) => g.mods.find((m) => m.slot === slot)?.name ?? "that mod";

/** Show a group's slot (0: none). Sent to the game when it runs. Undo picks the one before. */
export async function pickLive(game: GameId, g: LiveGroup, slot: number) {
  const before = g.active;
  const put = async (s: number) => {
    const p = await live.pick(game, g.group, s);
    // the library shows the picked skin as on and the others as off
    after(game);
    return p;
  };
  const info = infos.get(game);
  const picked = g.mods.find((m) => m.slot === slot);
  const fresh = !!info && !!picked && isNewSkin(game, info, g, picked.modId);
  try {
    // also the one the app thinks shows: the game may show another, picked in its own menu
    const p = await put(slot);
    const f10 = sayF10Note(p.note);
    if (p.send && picked) markShown(game, picked.modId);
    if (before === slot) { if (p.note && !f10) toast(p.note); return; }
    const what = slot === 0 ? `none of ${g.character}'s live skins` : nameOf(g, slot);
    const label = p.reload ? `Turned on ${what}. It shows after the game reloads`
      : p.send ? `Switched to ${what} in game${fresh ? `. If ${g.character} looks wrong, switch to another character and back` : ""}` : `Picked ${what} for the next start`;
    record({ label: p.note && !f10 ? `${label}. ${p.note}` : label, undo: async () => { await put(before); }, redo: async () => { await put(slot); } });
  } catch (e) { toast(errorText(e), true); }
}
