// Signing in to GameBanana from the app, so following creators and liking mods reach the user's GameBanana account.
// The user signs in on GameBanana's own page in a separate window; the app never sees the password, and the session
// cookie stays in Rust (src-tauri commands/account.rs, gacha-core gb_account.rs). Sign-in starts turned off and
// Settings > Account turns it on. Owner: ACCOUNT area.
import { useSyncExternalStore } from "react";
import { errorText, settings } from "./api";
import { record } from "./history";
import { creatorsPref, jsonPref, setRemoteFollow, type CreatorFlags } from "./prefs";
import { call, inTauri, listen } from "./tauri";
import { posthog } from "./posthog";
import { toast } from "../ui/toast";

export interface GbAccount { id: number; name: string; avatar: string | null }
export interface AccountState {
  /** False when sign-in is turned off or can't work here (the browser demo). */
  available: boolean;
  user: GbAccount | null;
}

let state: AccountState = { available: false, user: null };
const subs = new Set<() => void>();
export const accountState = () => state;
export const useAccount = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => state);
export function setAccountState(s: AccountState) {
  const previousUser = state.user;
  state = s;

  if (s.user) {
    if (previousUser && previousUser.id !== s.user.id) posthog?.reset();
    if (!previousUser || previousUser.id !== s.user.id) {
      posthog?.identify(`gamebanana:${s.user.id}`, { gamebanana_username: s.user.name });
    }
  } else if (previousUser) {
    posthog?.reset();
  }

  // following a creator in the app follows them on GameBanana too, while signed in
  setRemoteFollow(s.available && s.user ? followRemote : null);
  subs.forEach((f) => f());
}

/** The setting that turns sign-in on (read by Rust too). */
const ON_KEY = "account.gbSignIn";

if (inTauri()) {
  call<AccountState>("gb_account").then(setAccountState).catch(() => {});
  void listen<AccountState>("gb-account", (s) => {
    const was = state.user;
    setAccountState(s);
    if (s.user && !was) toast(`Signed in to GameBanana as ${s.user.name}`);
    else if (!s.user && was) toast("You're signed out of GameBanana", false, { label: "Sign in", run: () => void signIn() });
  });
}

/** Turn sign-in on or off (Settings > Account). Off also signs out. */
export async function setSignInOn(on: boolean) {
  await settings.set(ON_KEY, on ? "1" : "0");
  if (!on && state.user) await signOut();
  if (inTauri()) setAccountState(await call<AccountState>("gb_account"));
}

/** Open GameBanana's login page. The window closes by itself once the user is in. */
export async function signIn() {
  if (!inTauri()) { toast("Signing in works in the app, not in the browser demo"); return; }
  try {
    await call("gb_sign_in");
    toast("Sign in on GameBanana's page. The window closes by itself when you're in");
  } catch (e) { toast(errorText(e), true); }
}

export async function signOut() {
  try { setAccountState(await call<AccountState>("gb_sign_out")); } catch (e) { toast(errorText(e), true); }
}

/** Follow or unfollow on GameBanana. Errors are said once and don't undo the app's own follow. */
async function followRemote(id: number, on: boolean): Promise<void> {
  try { await call("gb_follow", { member: id, on }); } catch (e) { toast(`GameBanana didn't take the ${on ? "follow" : "unfollow"}: ${errorText(e)}`, true); }
}

/** Mods the user liked from the app (GameBanana doesn't tell guests, and this keeps the button right). */
const likedPref = jsonPref<number[]>("gb.liked", []);
export const useLiked = (modId: number) => likedPref.use().includes(modId);

/** Like a mod on GameBanana, or take the like back. Nobody is notified. Undo sends the opposite. */
export async function likeMod(modId: number, name: string, on: boolean) {
  const put = async (v: boolean) => {
    await call("gb_like", { modId, on: v });
    const list = likedPref.get().filter((x) => x !== modId);
    await likedPref.set(v ? [...list, modId] : list);
  };
  try {
    await put(on);
    record({ label: `${on ? "Liked" : "Took back the like on"} ${name} on GameBanana`, undo: () => put(!on), redo: () => put(on) });
  } catch (e) { toast(errorText(e), true); }
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
    if (!n) { toast(people.length ? "You already follow all of them here" : "You don't follow anyone on GameBanana yet"); return; }
    // set without pushing back to GameBanana: they're followed there already
    await creatorsPref.set(list);
    record({ label: `Followed ${n === 1 ? "1 creator" : `${n} creators`} from GameBanana`, undo: () => creatorsPref.set(before), redo: () => creatorsPref.set(list) });
  } catch (e) { toast(errorText(e), true); }
}
