// Live switching state for the Tools panel and the mod drawer: one store per game, reloaded when the library
// changes, and the actions with their Undo. Owner: INGAME area.
import { useEffect, useSyncExternalStore } from "react";
import { errorText, games, library, live, settings, type GameId, type LiveChange, type LiveGroup, type LiveInfo, type MenuSettings } from "../../lib/api";
import { record } from "../../lib/history";
import { emitApp, onApp } from "../../lib/store";
import { toast } from "../../ui/toast";
import { onPublish } from "../library/data";
import { sayF10Note } from "../../lib/elevation";
import { held } from "../../lib/tauri";
import { heldOf, modifierOf, tokenOf } from "../modtools/keyNames";
import { askTesterRisks } from "./TesterConfirm";

const infos = new Map<GameId, LiveInfo | null>();
/** Why the game's live info couldn't be read, for the panel's "Try again". */
const errors = new Map<GameId, string>();
const subs = new Set<() => void>();
const ping = () => subs.forEach((f) => f());

export async function reloadLive(game: GameId) {
  try { infos.set(game, await live.info(game)); errors.delete(game); } catch (e) { errors.set(game, errorText(e)); infos.set(game, { groups: [], ready: [], running: false, menu: { style: "window", key: "F7", pad: true, fastSave: true, binds: {} }, blocked: false, all: false, allowed: false, checked: false }); }
  ping();
}

// ── tester options (live.rs TESTER): the menu the game draws, in the games that do not have it already ──

/** Set only after the player confirmed the risks (TesterConfirm). The older "ui.tester" isn't read any more. */
const TESTER = "ui.testerOk";
let tester: boolean | null = null;
let testerAsked = false;
const testerSubs = new Set<() => void>();

/** Whether tester options are on, shared by every place that shows the switch (Settings, Check this game). */
export function useTester(): boolean {
  useEffect(() => {
    if (testerAsked) return;
    testerAsked = true;
    settings.get(TESTER).then((v) => { tester = v === "1"; testerSubs.forEach((f) => f()); }).catch(() => { testerAsked = false; });
  }, []);
  return useSyncExternalStore((f) => { testerSubs.add(f); return () => { testerSubs.delete(f); }; }, () => tester ?? false);
}

/** Turn tester options on (after the player confirms the risks) or off. Every game's live info is read again, since
 *  what it allows changes. True when they're on afterwards. */
export async function setTester(on: boolean): Promise<boolean> {
  if (on && !(await askTesterRisks())) return false;
  try {
    await settings.set(TESTER, on ? "1" : "0");
    tester = on;
    testerSubs.forEach((f) => f());
    await Promise.all([...infos.keys()].map((g) => reloadLive(g)));
    return on;
  } catch (e) { toast(errorText(e), true); return !!tester; }
}

/** Whether the game's live info has loaded (after an install, switching in game is offered only then). */
export const liveReady = (game: GameId): boolean => !!infos.get(game);

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
  // the game saved its values (a pick it took at a reload clears "Next reload"), or it started or closed
  held(library.onChanged((p) => later(p.game)));
  held(games.onState((p) => later(p.game)));
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

/** Why the game's live info couldn't be read the last time, or null. */
export function useLiveError(game: GameId): string | null {
  wire();
  return useSyncExternalStore(subscribe, () => errors.get(game) ?? null);
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

/** Change how the skin menu opens while playing. Undo puts the old way back. `label`: what the Undo step says, when
 *  the caller knows better (which key changed). */
export async function setMenu(game: GameId, before: MenuSettings, menu: MenuSettings, label?: string) {
  try {
    await live.setMenu(game, menu);
    await reloadLive(game);
    record({
      label: label ?? (JSON.stringify(before.binds) !== JSON.stringify(menu.binds) ? "Changed the in-game menu's keys"
        : `Set the in-game menu to ${menu.style === "window" ? "open over the game" : "be drawn by the game"} with ${menu.key}`),
      undo: async () => { await live.setMenu(game, before); await reloadLive(game); },
      redo: async () => { await live.setMenu(game, menu); await reloadLive(game); },
    });
  } catch (e) { toast(errorText(e), true); }
}

/** Changes waiting to save, per game: each one starts from the one before it, not from what the panel showed when it
 *  was made, so two quick changes both stay. */
const menuQueue = new Map<GameId, { last: MenuSettings; chain: Promise<void> }>();

/** Change part of the menu's settings, after any change still saving. `patch` can read the settings it applies to. */
export function patchMenu(game: GameId, menu: MenuSettings, patch: Partial<MenuSettings> | ((m: MenuSettings) => Partial<MenuSettings>), label?: string): Promise<void> {
  const q = menuQueue.get(game);
  const before = q?.last ?? menu;
  const next = { ...before, ...(typeof patch === "function" ? patch(before) : patch) };
  const chain = (q?.chain ?? Promise.resolve()).then(() => setMenu(game, before, next, label));
  const entry = { last: next, chain };
  menuQueue.set(game, entry);
  void chain.finally(() => { if (menuQueue.get(game) === entry) menuQueue.delete(game); });
  return chain;
}

// ── the menu's own keys in the menu over the game ──

/** Arrow keys and Enter keep what they do in a window; a key bound to them needs no help. */
const WINDOW_KEYS = new Set(["VK_UP", "VK_DOWN", "VK_LEFT", "VK_RIGHT", "VK_RETURN"]);

/** What a key press does in the skin menu by the keys the player picked (`MenuSettings.binds`): "up", "down", "show",
 *  "back", "keys" or "close". Null for a key that isn't bound, a modifier by itself, and the arrow keys and Enter. */
export function boundAction(e: KeyboardEvent, binds: Record<string, string[]> | undefined): string | null {
  if (!binds || modifierOf(e)) return null;
  const key = tokenOf(e);
  if (!key) return null;
  const pressed = [...heldOf(e), key].join(" ");
  if (WINDOW_KEYS.has(pressed)) return null;
  return ["up", "down", "show", "back", "keys", "close"].find((a) => binds[a]?.includes(pressed)) ?? null;
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
