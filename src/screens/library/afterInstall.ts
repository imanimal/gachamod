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
import { stops, t, tb, tn } from "../../lib/i18n";

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
  const id = toast(t("{text}. New mods turn on by themselves", { text }), false, {
    label: t("Keep new mods off"),
    run: async () => {
      dismissToast(id);
      await enableNewPref.set(false);
      for (const tu of turned) await restoreStates(tu.game, tu.before, tu.ids).catch(() => {});
      toast(turned.length > 1 ? tn(turned.length, "New mods stay off until you turn them on. {n} mod went back off", "New mods stay off until you turn them on. {n} mods went back off") : t("New mods stay off until you turn them on"),
        false, { label: t("Open the setting"), run: () => go({ view: "settings", section: "set-enable-new" }) });
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
const downloads: ToastAction = { label: t("Downloads"), run: () => go({ view: "downloads" }) };

async function burstText(b: NonNullable<typeof burst>): Promise<string> {
  const s = (await queue.get().catch(() => null))?.summary;
  const left = s ? s.running + s.waiting : 0;
  const p = { n: b.n, total: b.n + left, on: b.on };
  let text = b.on === b.n
    ? (left ? t("Installed {n} of {total} mods and turned them on", p) : tn(b.n, "Installed {n} mod and turned it on", "Installed {n} mods and turned them on"))
    : b.on
      ? (left ? t("Installed {n} of {total} mods, {on} turned on", p) : t("Installed {n} mods, {on} turned on", p))
      : (left ? t("Installed {n} of {total} mods", p) : tn(b.n, "Installed {n} mod", "Installed {n} mods"));
  if (b.on !== b.n && !b.on && b.prefOff === b.n) text = t("{text}. Turn them on in Mods", { text });
  if (b.off) text = tn(b.off, "{text}. {n} other skin went off", "{text}. {n} other skins went off", { text });
  return text;
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
  const act: ToastAction = { label: t("Switch in game"), run: () => makeLive(game, skins.map((m) => m.id), who) };
  const was = switches.get(key);
  if (was && retoast(was.id, t("Installed {n} skins for the same character. Switch them while you play?", { n: was.n + 1 }), act, false, open)) { was.n++; return; }
  switches.set(key, { id: toast(t("{text}. Switch this character's skins while you play?", { text: lead }), false, act, open), n: 1 });
}

/** One mod, a bundle of mods, or variants of one mod (only one of them belongs on). */
type Kind = "one" | "mods" | "variants";

/** An install note that names the mod, said without the name, or null for the others. */
function plainNote(note: string): string | null {
  const n = note.replace(/\.$/, "");
  if (/^.+ came back with its settings$/.test(n)) return t("The mod's settings came back");
  const parts = /^Turned off (\d+) parts? of .+ that change the same things as another part$/.exec(n);
  if (parts) return tn(Number(parts[1]), "Turned off {n} part that changes the same things as another part", "Turned off {n} parts that change the same things as another part");
  if (n === "Switch parts in its details") return t("Switch parts in its details");
  if (/^Toggles of .+ work only while its character is on screen$/.test(n)) return t("The mod's toggles work only while its character is on screen");
  return null;
}

/** The notes after "Installed X": the ones that name the mod said without it, the rest (errors) as they are. */
function plainNotes(tail: string): string[] {
  const out: string[] = [];
  let rest: string[] = [];
  // a run of other notes goes to tb() whole, so a message of several sentences still finds its translation
  const flush = () => { if (rest.length) out.push(tb(rest.join(". "))); rest = []; };
  for (const piece of tail.split(". ")) {
    const said = plainNote(piece);
    if (said === null) { rest.push(piece); continue; }
    flush();
    out.push(said);
  }
  flush();
  return out;
}

/** The backend's "Installed X for Y. Notes" in the user's language, without the names toasts never list: "Installed
 *  the mod. Notes", or "Installed 3 mods" for a bundle or several variants. */
function plainText(raw: string): { text: string; kind: Kind } {
  const dot = raw.indexOf(". ");
  const head = dot < 0 ? raw : raw.slice(0, dot), tail = dot < 0 ? "" : raw.slice(dot + 2);
  const m = /^Installed (\d+) (variants|mods) /.exec(head);
  const n = m ? Number(m[1]) : 1;
  const kind: Kind = !m ? "one" : m[2] === "variants" ? "variants" : "mods";
  const lead = kind === "one" ? t("Installed the mod") : kind === "variants" ? tn(n, "Installed {n} variant", "Installed {n} variants") : tn(n, "Installed {n} mod", "Installed {n} mods");
  return { text: tail ? stops([lead, ...plainNotes(tail)]) : lead, kind };
}

/** "Installed the mod. Turn it on in Mods": them for a bundle, one for variants. */
const turnOnText = (text: string, kind: Kind) => kind === "mods" ? t("{text}. Turn them on in Mods", { text })
  : kind === "variants" ? t("{text}. Turn one on in Mods", { text }) : t("{text}. Turn it on in Mods", { text });

/** The one way an install toast says the mod is on and what went off for it. With several installed, the first one
 *  is turned on. */
const onText = (text: string, off: ModEntry[], several = false) => several
  ? (!off.length ? t("{text}. The first one is on", { text })
    : tn(off.length, "{text}. The first one is on, and {n} other skin went off", "{text}. The first one is on, and {n} other skins went off", { text }))
  : (!off.length ? t("{text}. It's on", { text })
    : tn(off.length, "{text}. It's on, and {n} other skin went off", "{text}. It's on, and {n} other skins went off", { text }));

/** `text` is the backend's "Installed X for Y". `modIds[0]` is the mod to turn on (the first of several variants). */
export async function afterInstall(rawText: string, game: GameId, modIds: string[]) {
  const open: ToastAction = { label: t("Open"), run: () => { if (currentGame()?.id !== game) setGame(game); go({ view: "library", modId: modIds[0] }); } };
  // the backend's text in the user's language, without names
  const { text, kind } = plainText(rawText);
  const several = kind !== "one";
  try {
    await enableNewPref.ready;
    const all = await library.list(game);
    const mod = all.find((m) => m.id === modIds[0]);
    if (!enableNewPref.get() || !modIds.length) { await say(turnOnText(text, kind), open, { on: false, prefOff: true, off: 0 }); return; }
    if (!mod || mod.enabled) { await say(text, open, { on: false, prefOff: false, off: 0 }); return; }
    const others = liveCharacterOf(game, mod.id) ? [] : overlapping(mod, all);
    const keepBoth = others.length > 0 && (await settings.get(`${game}.oneSkin`).catch(() => null)) === "0";
    const change = await library.setEnabled(game, [mod.id], true, others.length ? !keepBoth : undefined);
    publish(game, change);
    const before = new Map(all.map((m) => [m.id, m.enabled]));
    const ids = change.changed.map((m) => m.id);
    const off = change.changed.filter((m) => !m.enabled);
    record({
      label: !off.length ? t("Turned on {mod}", { mod: mod.name })
        : off.length === 1 ? t("Turned on {mod} and turned off {other}", { mod: mod.name, other: off[0]!.name })
        : tn(off.length, "Turned on {mod} and turned off {n} mod", "Turned on {mod} and turned off {n} mods", { mod: mod.name }),
      undo: () => restoreStates(game, before, ids),
      redo: async () => { publish(game, await library.setEnabled(game, [mod.id], true, others.length ? !keepBoth : undefined)); },
    }, true);

    // the first time: say it happens by itself, with the way out. Mods turned on while it shows join it
    const turned: Turned = { game, before, ids };
    if (!openOffer() && !(await wasAsked()) && !openOffer()) { showOffer(onText(text, off, several), turned); return; }
    openOffer()?.turned.push(turned);

    // two skins for one character: switching them while playing is one click away
    const who = mod.character;
    const skins = who ? all.filter((m) => same(m.character, who) && !m.parent) : [];
    if (who && skins.length > 1 && !liveCharacterOf(game, mod.id) && liveReady(game)) {
      offerSwitch(game, who, skins, onText(text, off, several), open);
      return;
    }
    await say(onText(text, off, several), open, { on: true, prefOff: false, off: off.length });
  } catch (e) {
    if (!enableNewPref.get()) toast(turnOnText(text, kind), false, open);
    else toast(t("{text}, but it couldn't be turned on: {error}", { text, error: errorText(e) }), true, open);
  }
}
