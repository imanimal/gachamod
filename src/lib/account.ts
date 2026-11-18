// Signing in to GameBanana from the app (the account card at the top of the sidebar), so following creators and liking
// mods reach the user's GameBanana account. The user signs in on GameBanana's own page in a small window over
// gachamod; the app never sees the password, and the session cookie stays in Rust (src-tauri commands/account.rs,
// gacha-core gb_account.rs). One click on the account card is all it takes.
// Owner: ACCOUNT area.
import { useSyncExternalStore } from "react";
import { errorText, settings } from "./api";
import { forgetModPage } from "./gamebanana";
import { record } from "./history";
import { t, tb, tn } from "./i18n";
import { creatorsPref, jsonPref, nsfwPref, pref, setRemoteFollow, type CreatorFlags, type CreatorRef, type NsfwMode } from "./prefs";
import { call, listen } from "./tauri";
import { toast } from "../ui/toast";

export interface GbAccount { id: number; name: string; avatar: string | null }
export interface AccountState {
  /** False when sign-in is turned off in Settings. */
  available: boolean;
  user: GbAccount | null;
  /** GameBanana's sign-in window is open (UI only). */
  signing?: boolean;
}

let state: AccountState = { available: false, user: null };
const subs = new Set<() => void>();
export const accountState = () => state;
export function setAccountState(s: AccountState) {
  state = s;
  // following a creator in the app follows them on GameBanana too, while signed in
  setRemoteFollow(s.available && s.user ? followRemote : null);
  subs.forEach((f) => f());
}

/** The setting that turns sign-in off when "0" (read by Rust too). Older versions started with it off; signing in
 *  turns it back on. */
const ON_KEY = "account.gbSignIn";

let started = false;
/** Sign out is running: the account card shows it, so the event it sends gets no toast. */
let leaving = false;
function start() {
  if (started) return;
  started = true;
  call<AccountState>("gb_account").then((s) => {
    setAccountState({ ...s, signing: false });
    if (s.available && s.user) void matchAdult("start");
  }).catch(() => {});
  void listen<AccountState>("gb-account", (s) => {
    const was = state.user;
    setAccountState({ ...s, signing: false });
    if (s.user && !was) {
      toast(t("Signed in to GameBanana"));
      void matchAdult("signin");
    } else if (!s.user && was && !leaving) toast(t("You're signed out of GameBanana"), false, { label: t("Sign in"), run: () => void signIn() });
  }).catch(() => {});
  // the sign-in window closed without a sign-in: say so, and why when there was an error
  void listen<string | null>("gb-login-closed", (why) => {
    if (!state.signing) return;
    setAccountState({ ...state, signing: false });
    toast(why ? t("Couldn't finish signing in to GameBanana. {why}", { why: tb(why) }) : t("You're not signed in to GameBanana"), !!why, { label: why ? t("Try again") : t("Sign in"), run: () => void signIn() });
  }).catch(() => {});
}
export const useAccount = () => useSyncExternalStore((f) => { start(); subs.add(f); return () => { subs.delete(f); }; }, () => state);
/** Hear every change to the sign-in state, outside React. */
export function onAccount(f: () => void): () => void { start(); subs.add(f); return () => { subs.delete(f); }; }

/** Open GameBanana's sign-in page over gachamod. It closes by itself once the user is in. */
export async function signIn() {
  start();
  try {
    if (!state.available) await settings.set(ON_KEY, "1");
    setAccountState({ ...state, available: true, signing: true });
    await call("gb_sign_in");
  } catch (e) { setAccountState({ ...state, signing: false }); toast(errorText(e), true); }
}

export async function signOut() {
  leaving = true;
  try { setAccountState({ ...(await call<AccountState>("gb_sign_out")), signing: false }); } catch (e) { toast(errorText(e), true); }
  finally { leaving = false; }
}

/** Follow or unfollow on GameBanana. Errors are said once and don't undo the app's own follow. */
async function followRemote(id: number, on: boolean): Promise<void> {
  try { await call("gb_follow", { member: id, on }); } catch (e) { toast(on ? t("GameBanana didn't take the follow: {error}", { error: errorText(e) }) : t("GameBanana didn't take the unfollow: {error}", { error: errorText(e) }), true); }
}

// ── content settings ──

/** "Mods for adults" follows the content settings on the member's GameBanana account (Settings, GameBanana, Mods for adults). */
export const matchGbAdultPref = pref<boolean>("gb.matchAdult", true, (r) => (r === "1" ? true : r === "0" ? false : undefined), (v) => (v ? "1" : "0"));
/** What GameBanana's settings gave last time, so a change made in the app stays until the one there changes. */
const gbAdultSeenPref = pref<string>("gb.adultSeen", "", (r) => r, (v) => v);
const MODES: readonly string[] = ["hide", "blur", "show"];
const MATCHED: Record<NsfwMode, string> = {
  hide: t("Mods for adults: hidden, to match your GameBanana settings"),
  blur: t("Mods for adults: blurred, to match your GameBanana settings"),
  show: t("Mods for adults: shown, to match your GameBanana settings"),
};

/** Bring "Mods for adults" in line with the member's GameBanana content settings. At start it only acts when they
 *  changed there since last time; signing in always looks, but GameBanana's untouched defaults change nothing unless
 *  the person just turned matching on. */
async function matchAdult(when: "start" | "signin" | "asked") {
  try {
    await Promise.all([matchGbAdultPref.ready, gbAdultSeenPref.ready, nsfwPref.ready]);
    if (!matchGbAdultPref.get() || !state.user) return;
    const r = await call<{ mode: string; untouched: boolean } | null>("gb_content_settings");
    if (!r || !MODES.includes(r.mode)) return;
    const mode = r.mode as NsfwMode;
    const seen = when === "start" ? gbAdultSeenPref.get() : "";
    if (mode === seen) return;
    await gbAdultSeenPref.set(mode);
    if (r.untouched && !seen && when !== "asked") return;
    if (mode === nsfwPref.get()) return;
    // a change past the switch the person used (or none at all, at start): say it
    await nsfwPref.set(mode, MATCHED[mode], true);
  } catch { /* the app's setting stays as it is */ }
}

/** Turn matching on or off. Turning it on while signed in matches right away. */
export async function setMatchGbAdult(on: boolean) {
  await matchGbAdultPref.set(on, on ? t("Mods for adults follow your GameBanana settings") : t("Mods for adults no longer follow GameBanana"));
  if (on) await matchAdult("asked");
}

/** Mods the user liked, subscribed to or thanked, as the app last knew it (GameBanana doesn't tell guests, and this
 *  keeps the buttons right before it answers). */
const likedPref = jsonPref<number[]>("gb.liked", []);
const subscribedPref = jsonPref<number[]>("gb.subscribed", []);
const thankedPref = jsonPref<number[]>("gb.thanked", []);
export const useLiked = (modId: number) => likedPref.use().includes(modId);
export const useSubscribed = (modId: number) => subscribedPref.use().includes(modId);
export const useThanked = (modId: number) => thankedPref.use().includes(modId);

async function mark(p: typeof likedPref, modId: number, on: boolean) {
  if (p.get().includes(modId) === on) return;
  const list = p.get().filter((x) => x !== modId);
  await p.set(on ? [...list, modId] : list);
}

/** What the signed-in member did on a mod, as GameBanana says. Null fields weren't in its answer. */
export interface ModMe {
  liked: boolean | null; subscribed: boolean | null; thanked: boolean | null;
  /** The member made it: GameBanana offers no like, subscribe or thanks on your own mod. */
  own: boolean | null;
  points: number | null;
  /** The first thanks of the day is free: GameBanana pays the points. */
  freeThank: boolean | null;
}

/** Ask GameBanana what the member did on a mod, and correct what the app remembers. Null when signed out or it
 *  couldn't ask (the remembered state stays). */
export async function modMe(modId: number): Promise<ModMe | null> {
  if (!state.available || !state.user) return null;
  try {
    const me = await call<ModMe>("gb_mod_me", { modId });
    if (me.liked !== null) await mark(likedPref, modId, me.liked);
    if (me.subscribed !== null) await mark(subscribedPref, modId, me.subscribed);
    if (me.thanked !== null) await mark(thankedPref, modId, me.thanked);
    return me;
  } catch { return null; }
}

/** Like a mod on GameBanana, or take the like back. Nobody is notified. Undo sends the opposite. */
export async function likeMod(modId: number, name: string, on: boolean) {
  const put = async (v: boolean) => {
    await call("gb_like", { modId, on: v });
    forgetModPage(modId);
    await mark(likedPref, modId, v);
  };
  try {
    await put(on);
    // the Like button shows it: no toast
    record({ label: on ? t("Liked {name} on GameBanana", { name }) : t("Took back the like on {name} on GameBanana", { name }), undo: () => put(!on), redo: () => put(on) }, true);
  } catch (e) { toast(errorText(e), true); }
}

/** Subscribe to a mod on GameBanana, or stop. GameBanana then tells the member there when it updates. Undo sends
 *  the opposite. */
export async function subscribeMod(modId: number, name: string, on: boolean) {
  const put = async (v: boolean) => {
    await call("gb_subscribe", { modId, on: v });
    forgetModPage(modId);
    await mark(subscribedPref, modId, v);
  };
  try {
    await put(on);
    record({ label: on ? t("Subscribed to {name} on GameBanana", { name }) : t("Unsubscribed from {name} on GameBanana", { name }), undo: () => put(!on), redo: () => put(on) }, true);
  } catch (e) { toast(errorText(e), true); }
}

/** Follow a creator, here and on GameBanana, and like one of their mods (`like` false: only follow). One Undo step
 *  takes both back. */
export async function likeAndFollow(mod: { id: number; name: string }, c: CreatorRef, like: boolean) {
  const key = String(c.id);
  const old = creatorsPref.get()[key];
  const put = async (on: boolean) => {
    if (like) {
      await call("gb_like", { modId: mod.id, on });
      forgetModPage(mod.id);
      await mark(likedPref, mod.id, on);
    }
    const list = { ...creatorsPref.get() };
    if (on) list[key] = { ...(list[key] ?? old ?? {}), id: c.id, name: c.name, avatar: c.avatar ?? list[key]?.avatar ?? null, sub: true, blocked: false, at: Date.now() };
    else if (old) list[key] = old;
    else delete list[key];
    await creatorsPref.set(list);
    await followRemote(c.id, on);
  };
  try {
    await put(true);
    record({
      label: like ? t("Liked {mod} and followed {creator} on GameBanana", { mod: mod.name, creator: c.name }) : t("Followed {creator} on GameBanana", { creator: c.name }),
      brief: like ? t("Liked the mod and followed the creator on GameBanana") : t("Followed the creator on GameBanana"),
      undo: () => put(false), redo: () => put(true),
    });
  } catch (e) { toast(errorText(e), true); }
}

/** Thank a mod's creator on GameBanana with `points` of the member's points (`free`: the first thanks of the day,
 *  which GameBanana pays for). It can't be taken back, so it isn't in Undo. True when GameBanana took it. */
export async function thankMod(modId: number, points: number, free = false): Promise<boolean> {
  try {
    await call("gb_thank", { modId, points });
    forgetModPage(modId);
    await mark(thankedPref, modId, true);
    toast(free ? t("Thanked the creator") : tn(points, "Thanked the creator with {n} point", "Thanked the creator with {n} points"));
    return true;
  } catch (e) { toast(errorText(e), true); return false; }
}

/** Follow in the app everyone the user follows on GameBanana (read only on GameBanana's side). One Undo step. */
export async function importFollowing() {
  try {
    const people = await call<GbAccount[]>("gb_following");
    const before = creatorsPref.get();
    const list: Record<string, CreatorFlags> = { ...before };
    let n = 0;
    for (const p of people) {
      const old = list[String(p.id)];
      if (old?.sub || old?.blocked) continue;
      list[String(p.id)] = { ...(old ?? {}), id: p.id, name: p.name, avatar: p.avatar ?? old?.avatar ?? null, sub: true, at: Date.now() };
      n++;
    }
    if (!n) { toast(people.length ? t("You already follow all of them here") : t("You don't follow anyone on GameBanana yet")); return; }
    // set without pushing back to GameBanana: they're followed there already
    await creatorsPref.set(list);
    record({ label: tn(n, "Followed {n} creator from GameBanana", "Followed {n} creators from GameBanana"), undo: () => creatorsPref.set(before), redo: () => creatorsPref.set(list) });
  } catch (e) { toast(errorText(e), true); }
}
