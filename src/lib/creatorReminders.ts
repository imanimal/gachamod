// Now and then, while signed in to GameBanana, a quiet toast names one creator whose mods the user has on and hasn't
// followed yet, with "Like and follow" (or "Follow" when the mod is liked already) and "Don't remind me". It shows
// at most once every few days, never in the first minutes after gachamod opens, never while a game runs or the
// window is in the background, and never twice for one creator. Settings, GameBanana account turns it off.
// Owner: ACCOUNT area.
import { games, library, type ModEntry } from "./api";
import { accountState, likeAndFollow, modMe, onAccount, type GbAccount } from "./account";
import { findMember } from "./gamebanana";
import { t } from "./i18n";
import { creatorsPref, jsonPref, pref } from "./prefs";
import { allGames, go } from "./store";
import { call } from "./tauri";
import { dismissToast, toast } from "../ui/toast";

/** The setting (Settings, GameBanana account). On by default; only ever acts while signed in. */
export const remindPref = pref<boolean>("gb.remind", true, (r) => (r === "1" ? true : r === "0" ? false : undefined), (v) => (v ? "1" : "0"));
/** When the last reminder showed (unix ms). */
const lastPref = pref<number>("gb.remindLast", 0, (r) => Number(r) || 0, (v) => String(v));
/** Creators already named once (name keys), so none comes back. */
const remindedPref = jsonPref<string[]>("gb.reminded", []);

/** Not before this long after gachamod opens. */
const FIRST_MS = 10 * 60_000;
/** At most one reminder in this long. */
const GAP_MS = 4 * 24 * 3600_000;

const key = (s: string) => s.toLowerCase().replace(/[\s._-]+/g, "");

export function setRemind(on: boolean) {
  void remindPref.set(on, on ? t("Turned on reminders to like and follow creators") : t("Turned off reminders to like and follow creators"));
}

interface Candidate { name: string; mod: ModEntry; score: number }

/** Creators of mods the user has on or starred, the most used first. */
async function candidates(): Promise<Candidate[]> {
  const me = accountState().user;
  const by = new Map<string, Candidate>();
  const rank = (m: ModEntry) => (m.enabled ? 3 : 0) + (m.favorite ? 2 : 0);
  for (const g of allGames()) {
    if (!g.installed || !g.modsDir || !g.modCount) continue;
    const mods = await library.list(g.id).catch(() => [] as ModEntry[]);
    for (const m of mods) {
      const s = m.source;
      if (s?.site !== "gamebanana" || !s.submitter || !(s.modId > 0) || m.parent) continue;
      const k = key(s.submitter);
      if (!k || (me && key(me.name) === k)) continue;
      const c = by.get(k);
      if (!c) { by.set(k, { name: s.submitter, mod: m, score: 1 + rank(m) }); continue; }
      c.score += 1 + rank(m);
      if (rank(m) > rank(c.mod) || (rank(m) === rank(c.mod) && m.installedAt < c.mod.installedAt)) c.mod = m;
    }
  }
  const asked = new Set(remindedPref.get());
  const known = Object.values(creatorsPref.get());
  const skip = new Set(known.filter((c) => c.sub || c.blocked).map((c) => key(c.name)));
  return [...by.entries()]
    .filter(([k, c]) => !asked.has(k) && !skip.has(k) && (c.mod.enabled || c.mod.favorite))
    .map(([, c]) => c)
    .sort((a, b) => b.score - a.score);
}

const running = new Map<string, boolean>();
const gameRunning = () => {
  const on = new Set(allGames().filter((g) => g.running).map((g) => g.id as string));
  for (const [g, r] of running) if (r) on.add(g); else on.delete(g);
  return on.size > 0;
};

let armed = false;
let busy = false;
/** One look per session at most: shown, or nobody to name. */
let done = false;

async function tryRemind() {
  if (!armed || busy || done) return;
  const acc = accountState();
  if (!acc.available || !acc.user || gameRunning() || document.visibilityState !== "visible" || !document.hasFocus()) return;
  busy = true;
  try {
    await Promise.all([remindPref.ready, lastPref.ready, remindedPref.ready, creatorsPref.ready]);
    if (!remindPref.get() || Date.now() - lastPref.get() < GAP_MS) { done = true; return; }
    const list = await candidates();
    if (!list.length) { done = true; return; }
    const following = new Set((await call<GbAccount[]>("gb_following").catch(() => [] as GbAccount[])).map((u) => u.id));
    for (const c of list.slice(0, 3)) {
      const member = await findMember(c.name, c.mod.source!.modId).catch(() => null);
      if (!member) continue;
      const flags = creatorsPref.get()[String(member.id)];
      if (flags?.sub || flags?.blocked || following.has(member.id) || member.id === accountState().user?.id) continue;
      const mine = await modMe(c.mod.source!.modId);
      if (mine?.own) continue;
      // the state may have changed during the lookups
      if (!accountState().user || gameRunning() || !remindPref.get()) return;
      show(c, member, mine?.liked !== true);
      done = true;
      return;
    }
    done = true;
  } finally { busy = false; }
}

function show(c: Candidate, member: { id: number; name: string; avatar: string | null }, like: boolean) {
  void lastPref.set(Date.now());
  void remindedPref.set([...remindedPref.get(), key(c.name)]);
  const modId = c.mod.source!.modId;
  const text = like
    ? t("You use {mod} by {creator}. Like it and follow them on GameBanana?", { mod: c.mod.name, creator: member.name })
    : t("You use {mod} by {creator}. Follow them on GameBanana?", { mod: c.mod.name, creator: member.name });
  const id = toast(text, "info", {
    label: like ? t("Like and follow") : t("Follow"),
    run: () => { dismissToast(id); void likeAndFollow({ id: modId, name: c.mod.name }, { id: member.id, name: member.name, avatar: member.avatar }, like); },
  }, {
    label: t("Don't remind me"),
    run: async () => {
      await remindPref.set(false);
      // the reminder is gone and the switch is in Settings: say so, with the way there
      toast(t("Turned off reminders to like and follow creators"), false, { label: t("Open the setting"), run: () => go({ view: "settings", section: "set-gb-remind" }) });
    },
  });
}

/** Start watching for a good moment. App.tsx calls this once. */
export function installCreatorReminders(): () => void {
  const retry = () => void tryRemind();
  const timer = window.setTimeout(() => { armed = true; retry(); }, FIRST_MS);
  window.addEventListener("focus", retry);
  const offAccount = onAccount(retry);
  let offGames: (() => void) | null = null;
  let gone = false;
  games.onState((p) => { running.set(p.game, p.running); if (!p.running) retry(); })
    .then((off) => { if (gone) off(); else offGames = off; }).catch(() => {});
  return () => {
    gone = true;
    window.clearTimeout(timer);
    window.removeEventListener("focus", retry);
    offAccount();
    offGames?.();
  };
}
