// Right after a new mod installs (not an update): with "Turn on new mods" (default), it turns on, and its character's
// other skin goes off unless "<game>.oneSkin" keeps both. One toast says what happened. The first time, the toast
// offers to keep new mods off instead; when a character now has two skins, it offers switching them while playing.
// Installs that finish close together share one toast that counts up ("Installed 7 of 12 mods"), and skins for one
// character share one switch offer. Owner: LIBRARY area.
import { errorText, library, queue, settings, type GameId, type ModEntry } from "../../lib/api";
import { record } from "../../lib/history";
import { go, currentGame, setGame } from "../../lib/store";
import { dismissToast, retoast, toast, type ToastAction } from "../../ui/toast";
import { enableNewPref } from "../settings/automatic";
import { liveCharacterOf, liveReady, makeLive } from "../ingame/data";
import { publish, restoreStates } from "./data";
import { overlapping } from "./overlap";

const ASKED_KEY = "mods.enableNew.asked";
/** Two installs this close together share a toast. */
const BURST_MS = 10000;
const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

// ── the one-time "Keep new mods off" offer ──
// It shows once, newer toasts never push it out, and it counts as asked only once it has been used, dismissed or has
// timed out. While it shows, every mod turned on by itself joins it, so its button turns them all back off.
type Turned = { game: GameId; before: Map<string, boolean>; ids: string[] };
let asked: boolean | null = null;
let offer: { id: number; turned: Turned[] } | null = null;
const openOffer = () => offer;
async function wasAsked(): Promise<boolean> {
  if (asked === null) { const v = (await settings.get(ASKED_KEY).catch(() => null)) === "1"; asked ??= v; }
  return asked;
}
function showOffer(text: string, first: Turned) {
  const turned = [first];
  const id = toast(`${text}. New mods turn on by themselves`, false, {
    label: "Keep new mods off",
    run: async () => {
      dismissToast(id);
      await enableNewPref.set(false);
      for (const t of turned) await restoreStates(t.game, t.before, t.ids).catch(() => {});
      toast(turned.length > 1 ? `New mods stay off until you turn them on. ${turned.length} mods went back off` : "New mods stay off until you turn them on",
        false, { label: "Open the setting", run: () => go({ view: "settings", section: "set-enable-new" }) });
    },
  }, undefined, {
    keep: true,
    onEnd: () => { offer = null; asked = true; void settings.set(ASKED_KEY, "1").catch(() => {}); },
  });
  offer = { id, turned };
}

// ── one toast for a run of installs ──
type Result = { on: boolean; prefOff: boolean; off: number };
let single: ({ id: number; at: number } & Result) | null = null;
let burst: { id: number; n: number; on: number; prefOff: number; off: number } | null = null;
const downloads: ToastAction = { label: "Downloads", run: () => go({ view: "downloads" }) };

async function burstText(b: NonNullable<typeof burst>): Promise<string> {
  const s = (await queue.get().catch(() => null))?.summary;
  const left = s ? s.running + s.waiting : 0;
  let t = `Installed ${left ? `${b.n} of ${b.n + left}` : b.n} mods`;
  if (b.on === b.n) t += " and turned them on";
  else if (b.on) t += `, ${b.on} turned on`;
  else if (b.prefOff === b.n) t += ". Turn them on in Mods";
  if (b.off) t += `. ${b.off === 1 ? "1 other skin" : `${b.off} other skins`} went off`;
  return t;
}

/** Say one install finished: on its own toast, or counted into the toast of the installs just before it. */
async function say(text: string, open: ToastAction, r: Result) {
  const now = Date.now();
  if (burst) {
    const b = burst;
    b.n++; b.on += +r.on; b.prefOff += +r.prefOff; b.off += r.off;
    if (retoast(b.id, await burstText(b), downloads)) return;
    if (burst === b) burst = null;
  } else if (single && now - single.at < BURST_MS) {
    const s = single;
    single = null;
    const b = { id: s.id, n: 2, on: +s.on + +r.on, prefOff: +s.prefOff + +r.prefOff, off: s.off + r.off };
    burst = b;
    if (retoast(b.id, await burstText(b), downloads)) return;
    if (burst === b) burst = null;
  }
  single = { id: toast(text, false, open), at: now, ...r };
}

// ── switching a character's skins in game: one offer per character ──
const switches = new Map<string, { id: number; n: number }>();
function offerSwitch(game: GameId, who: string, skins: ModEntry[], lead: string, open: ToastAction) {
  const key = `${game}:${who.toLowerCase()}`;
  const act: ToastAction = { label: "Switch in game", run: () => makeLive(game, skins.map((m) => m.id), who) };
  const was = switches.get(key);
  if (was && retoast(was.id, `Installed ${was.n + 1} skins for ${who}. Switch ${who}'s skins while you play?`, act, false, open)) { was.n++; return; }
  switches.set(key, { id: toast(`${lead}. Switch ${who}'s skins while you play?`, false, act, open), n: 1 });
}

/** The backend's text names the mod's group when it has no character ("Installed X for NPCs & Entities"): drop that. */
function plainText(text: string, mod?: ModEntry) {
  if (!mod || mod.character) return text;
  const dot = text.indexOf(". ");
  const head = dot < 0 ? text : text.slice(0, dot), tail = dot < 0 ? "" : text.slice(dot);
  const at = head.lastIndexOf(" for ");
  if (at < 0) return text;
  const what = head.slice(at + 5);
  // "Skin for Lumine" is the mod's own name, not a group
  if (mod.name.toLowerCase().includes(what.toLowerCase())) return text;
  return head.slice(0, at) + tail;
}

const wentOff = (off: ModEntry[]) => (off.length === 1 ? off[0]!.name : `${off.length} other skins`);
/** The one way an install toast says the mod is on and what went off for it. */
const onText = (text: string, off: ModEntry[]) => (off.length ? `${text}. It's on, and ${wentOff(off)} went off` : `${text}. It's on`);

/** `text` is the backend's "Installed X for Y". `modIds[0]` is the mod to turn on (the first of several variants). */
export async function afterInstall(rawText: string, game: GameId, modIds: string[]) {
  const open: ToastAction = { label: "Open", run: () => { if (currentGame()?.id !== game) setGame(game); go({ view: "library", modId: modIds[0] }); } };
  let text = rawText;
  try {
    await enableNewPref.ready;
    const all = await library.list(game);
    const mod = all.find((m) => m.id === modIds[0]);
    text = plainText(rawText, mod);
    if (!enableNewPref.get() || !modIds.length) { await say(`${text}. Turn it on in Mods`, open, { on: false, prefOff: true, off: 0 }); return; }
    if (!mod || mod.enabled) { await say(text, open, { on: false, prefOff: false, off: 0 }); return; }
    const others = liveCharacterOf(game, mod.id) ? [] : overlapping(mod, all);
    const keepBoth = others.length > 0 && (await settings.get(`${game}.oneSkin`).catch(() => null)) === "0";
    const change = await library.setEnabled(game, [mod.id], true, others.length ? !keepBoth : undefined);
    publish(game, change);
    const before = new Map(all.map((m) => [m.id, m.enabled]));
    const ids = change.changed.map((m) => m.id);
    const off = change.changed.filter((m) => !m.enabled);
    record({
      label: off.length ? `Turned on ${mod.name} and turned off ${off.length === 1 ? off[0]!.name : `${off.length} mods`}` : `Turned on ${mod.name}`,
      undo: () => restoreStates(game, before, ids),
      redo: async () => { publish(game, await library.setEnabled(game, [mod.id], true, others.length ? !keepBoth : undefined)); },
    }, true);

    // the first time: say it happens by itself, with the way out. Mods turned on while it shows join it
    const turned: Turned = { game, before, ids };
    if (!openOffer() && !(await wasAsked()) && !openOffer()) { showOffer(onText(text, off), turned); return; }
    openOffer()?.turned.push(turned);

    // two skins for one character: switching them while playing is one click away
    const who = mod.character;
    const skins = who ? all.filter((m) => same(m.character, who) && !m.parent) : [];
    if (who && skins.length > 1 && !liveCharacterOf(game, mod.id) && liveReady(game)) {
      offerSwitch(game, who, skins, onText(text, off), open);
      return;
    }
    await say(onText(text, off), open, { on: true, prefOff: false, off: off.length });
  } catch (e) {
    if (!enableNewPref.get()) toast(`${text}. Turn it on in Mods`, false, open);
    else toast(`${text}, but it couldn't be turned on: ${errorText(e)}`, true, open);
  }
}
