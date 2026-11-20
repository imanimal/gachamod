// Mods the user subscribed to (the bell under a mod's pictures). gachamod watches them itself: when one gets an
// update on GameBanana a toast says so with View, and Home's Subscribed mods row puts it first, marked Updated until
// it's opened. Subscribing works signed out. Signed in, it subscribes on GameBanana too, and the mods the member
// subscribed to there come in at sign-in. Owner: ACCOUNT area.
import { errorText } from "./api";
import { accountState, onAccount } from "./account";
import { forgetModPage, modCards, type GbCard } from "./gamebanana";
import { record } from "./history";
import { t, tn } from "./i18n";
import { jsonPref, pref } from "./prefs";
import { currentRoute, go } from "./store";
import { call } from "./tauri";
import { toast } from "../ui/toast";

export interface ModSub {
  id: number;
  name: string;
  /** The mod's GameBanana game, so each game's Home lists its own. */
  game: number | null;
  /** When the user subscribed (unix ms). */
  at: number;
  /** The mod's update time at the last check (unix s). */
  updated: number;
  /** The update time the user has seen. Opening the mod catches up; anything newer shows as Updated. */
  seen: number;
  /** Subscribed on GameBanana too, as far as gachamod knows. */
  gb?: boolean;
}

export const modSubsPref = jsonPref<Record<string, ModSub>>("gb.modSubs", {});
export const useModSubs = () => modSubsPref.use();
export const useModSub = (id: number): ModSub | undefined => modSubsPref.use()[String(id)];
/** A subscribed mod with an update the user hasn't opened yet. */
export const isNew = (s: ModSub) => s.updated > s.seen;

/** The toast when a subscribed mod updates (Settings, GameBanana account). */
export const subToastPref = pref<boolean>("gb.subToast", true, (r) => (r === "1" ? true : r === "0" ? false : undefined), (v) => (v ? "1" : "0"));

/** The hourly look at GameBanana for updates to subscribed mods (Settings, GameBanana account). Off: gachamod asks
 *  nothing, so Home marks nothing as Updated and no message comes either. */
export const subCheckPref = pref<boolean>("gb.subCheck", true, (r) => (r === "1" ? true : r === "0" ? false : undefined), (v) => (v ? "1" : "0"));

/** The mod ids GameBanana subscriptions were marked with before gachamod kept its own list. */
const oldPref = jsonPref<number[]>("gb.subscribed", []);

async function put(list: Record<string, ModSub>) { await modSubsPref.set(list); }

/** Ask GameBanana to subscribe or unsubscribe too, while signed in. True when it took it. */
async function remote(id: number, on: boolean): Promise<boolean> {
  const acc = accountState();
  if (!acc.available || !acc.user) return false;
  try {
    await call("gb_subscribe", { modId: id, on });
    forgetModPage(id);
    return true;
  } catch (e) {
    toast(on ? t("GameBanana didn't take the subscription: {error}", { error: errorText(e) }) : t("GameBanana didn't take the unsubscribe: {error}", { error: errorText(e) }), true);
    return false;
  }
}

type ModLike = Pick<GbCard, "id" | "name"> & { updated?: number; game?: { id: number } | null };

/** Subscribe to a mod, or stop. The bell shows it, so no toast; Undo takes it back here and on GameBanana. */
export async function setModSub(mod: ModLike, on: boolean) {
  const key = String(mod.id);
  const before = modSubsPref.get()[key];
  const apply = async (v: boolean) => {
    const list = { ...modSubsPref.get() };
    if (v) {
      const now = mod.updated ?? before?.updated ?? 0;
      list[key] = { ...(before ?? {}), id: mod.id, name: mod.name, game: mod.game?.id ?? before?.game ?? null, at: before?.at ?? Date.now(), updated: now, seen: now, gb: before?.gb };
    } else delete list[key];
    await put(list);
    const took = await remote(mod.id, v);
    if (took && v) {
      const cur = modSubsPref.get()[key];
      if (cur && !cur.gb) await put({ ...modSubsPref.get(), [key]: { ...cur, gb: true } });
    }
  };
  await apply(on);
  record({
    label: on ? t("Subscribed to {name}", { name: mod.name }) : t("Unsubscribed from {name}", { name: mod.name }),
    brief: on ? t("Subscribed to the mod") : t("Unsubscribed from the mod"),
    undo: () => apply(!on), redo: () => apply(on),
  }, true);
}

/** What GameBanana said about the member's subscription to a mod (read when its page opens). On there and not
 *  here: it comes in. Off there after gachamod saw it on: it was undone on GameBanana, so it goes here too. */
export async function noteGbSub(mod: ModLike, on: boolean) {
  const key = String(mod.id);
  const cur = modSubsPref.get()[key];
  if (on && !cur) {
    const now = mod.updated ?? 0;
    await put({ ...modSubsPref.get(), [key]: { id: mod.id, name: mod.name, game: mod.game?.id ?? null, at: Date.now(), updated: now, seen: now, gb: true } });
  } else if (on && cur && !cur.gb) {
    await put({ ...modSubsPref.get(), [key]: { ...cur, gb: true } });
  } else if (!on && cur?.gb) {
    const list = { ...modSubsPref.get() };
    delete list[key];
    await put(list);
  }
}

/** The mod's page was opened: its update counts as seen. */
export function markSeen(id: number, updated?: number) {
  const cur = modSubsPref.get()[String(id)];
  if (!cur) return;
  const top = Math.max(cur.updated, updated ?? 0);
  if (cur.seen >= top && cur.updated >= top) return;
  void put({ ...modSubsPref.get(), [String(id)]: { ...cur, updated: top, seen: top } });
}

// ── importing GameBanana's subscriptions ──

/** Bring in the mods the member subscribes to on GameBanana (read only there). Quiet unless something came in. */
export async function importGbSubs(say = false) {
  try {
    const got = await call<Array<{ id: number; name: string; game: number | null; updated: number }>>("gb_subscribed_mods");
    const list = { ...modSubsPref.get() };
    let n = 0;
    for (const m of got) {
      const key = String(m.id);
      if (list[key]) { if (!list[key]!.gb) list[key] = { ...list[key]!, gb: true }; continue; }
      list[key] = { id: m.id, name: m.name, game: m.game, at: Date.now(), updated: m.updated, seen: m.updated, gb: true };
      n++;
    }
    await put(list);
    if (n || say) toast(n ? tn(n, "Added {n} mod you subscribe to on GameBanana", "Added {n} mods you subscribe to on GameBanana") : t("You already have every GameBanana subscription here"));
  } catch (e) { if (say) toast(errorText(e), true); }
}

// ── watching for updates ──

/** First look this long after gachamod opens, then every hour. GameBanana can't tell the app, so this asks. */
const FIRST_MS = 90_000;
const EVERY_MS = 3_600_000;
let checking = false;

/** Look for updates to every subscribed mod, unless the check is turned off. New ones get a toast (unless that is off). */
export async function checkModSubs() {
  if (checking) return;
  checking = true;
  try {
    await Promise.all([modSubsPref.ready, subToastPref.ready, subCheckPref.ready, oldPref.ready]);
    if (!subCheckPref.get()) return;
    await migrate();
    const subs = modSubsPref.get();
    const ids = Object.values(subs).map((s) => s.id);
    if (!ids.length) return;
    const cards = await modCards(ids);
    const list = { ...modSubsPref.get() };
    const fresh: ModSub[] = [];
    for (const c of cards) {
      const cur = list[String(c.id)];
      if (!cur) continue;
      const next = { ...cur, name: c.name, game: c.game?.id ?? cur.game };
      if (c.updated > cur.updated) {
        next.updated = c.updated;
        // a mod subscribed to before its first check only learns its time: that isn't news
        if (cur.updated > 0) fresh.push(next);
        else next.seen = c.updated;
      }
      list[String(c.id)] = next;
    }
    await put(list);
    if (fresh.length && subToastPref.get()) say(fresh);
  } catch (e) { console.warn("Subscribed mods:", e); }
  finally { checking = false; }
}

function say(fresh: ModSub[]) {
  const first = fresh[0]!;
  if (fresh.length === 1) {
    toast(t("{name} has an update", { name: first.name }), "info", { label: t("View"), run: () => { const { toolId: _, ...r } = currentRoute(); go({ ...r, modId: first.id }); } });
  } else {
    toast(tn(fresh.length, "{n} mod you subscribe to has an update", "{n} mods you subscribe to have an update"), "info",
      { label: t("View"), run: () => go("home") });
  }
}

/** The GameBanana subscriptions gachamod marked before it kept its own list come in once, named at the first check. */
async function migrate() {
  const old = oldPref.get();
  if (!old.length) return;
  const list = { ...modSubsPref.get() };
  for (const id of old) if (!list[String(id)]) list[String(id)] = { id, name: t("GameBanana mod {id}", { id }), game: null, at: Date.now(), updated: 0, seen: 0, gb: true };
  await put(list);
  await oldPref.set([]);
}

/** Start watching. App.tsx calls this once. */
export function installModSubWatch(): () => void {
  const run = () => void checkModSubs();
  const first = window.setTimeout(run, FIRST_MS);
  const timer = window.setInterval(run, EVERY_MS);
  let was = accountState().user?.id ?? null;
  const off = onAccount(() => {
    const now = accountState().user?.id ?? null;
    if (now && now !== was) void importGbSubs();
    was = now;
  });
  return () => { window.clearTimeout(first); window.clearInterval(timer); off(); };
}
