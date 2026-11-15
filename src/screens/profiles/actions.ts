// Everything you can do to a profile, each with Undo: make one (from the mods on now, or empty, through the
// new-profile dialog any screen can open), duplicate, rename, change, save the mods on now into it, delete.
// Deleting keeps a snapshot, so Undo puts it back with its mods, options and hotkey. Also the "open the editor"
// request that menus anywhere use (the Profiles screen answers it).
// Owner: HOME/PROFILES area.
import { useSyncExternalStore } from "react";
import { errorText, hotkeys, profiles, type GameId, type Profile, type ProfilePatch, type ProfileSnapshot } from "../../lib/api";
import { record } from "../../lib/history";
import { currentRoute, emitApp, go } from "../../lib/store";
import { posthog, posthogLogger } from "../../lib/posthog";
import { toast } from "../../ui/toast";
import { profilesChanged, switchProfile } from "./data";

const fail = (e: unknown) => toast(errorText(e), true);
const syncKeys = () => void hotkeys.sync().catch(() => {});

/** Switch with errors as toasts. */
export async function switchTo(game: GameId, to: Profile, list: Profile[] | null) {
  if (to.active) return;
  try {
    await switchProfile(game, to, list?.find((p) => p.active) ?? null);
    posthog?.capture("profile_switched", { game_id: game });
    posthogLogger?.info("profile switched", { game_id: game });
  } catch (e) { fail(e); }
}

/** A deleted profile's way back: put it back from the snapshot, then remember the new id. */
function undoable(game: GameId, label: string, made: Profile) {
  let id = made.id;
  let snap: ProfileSnapshot | null = null;
  record({
    label,
    undo: async () => { snap = await profiles.snapshot(id); await profiles.remove(id); profilesChanged(game); if (snap.profile.hotkey) syncKeys(); },
    redo: async () => { if (!snap) return; id = (await profiles.restore(snap)).id; profilesChanged(game); if (snap.profile.hotkey) syncKeys(); },
  });
}

/** What a new profile starts with: the mods on now, or none (switching to it turns every mod off, like a clean game). */
export type NewStart = "now" | "empty";

/** Make a profile from the new-profile dialog. `extra` is the rest of what was filled in (icon, hotkey...). */
export async function makeProfile(game: GameId, start: NewStart, name: string, extra: ProfilePatch): Promise<Profile | null> {
  let p: Profile;
  try {
    if (start === "empty") {
      const now = Math.floor(Date.now() / 1000);
      const blank: Profile = { id: 0, game, name, icon: null, color: null, banner: null, description: null, active: false, modCount: 0, createdAt: now, updatedAt: now, hotkey: null };
      p = await profiles.restore({ profile: blank, mods: [], vars: [] });
    } else p = await profiles.create(game, name, null);
    profilesChanged(game);
    posthog?.capture("profile_created", { game_id: game, creation_mode: start });
    undoable(game, start === "empty" ? `Made ${p.name}, with no mods on` : `Made ${p.name} from the mods on now`, p);
  } catch (e) { fail(e); return null; }
  // the profile is made either way, so a bad field is a toast, not a second try that would make another
  if (Object.keys(extra).length) {
    try { p = await profiles.update(p.id, extra); } catch (e) { fail(e); }
    profilesChanged(game);
  }
  return p;
}

export async function duplicateProfile(game: GameId, p: Profile): Promise<Profile | null> {
  try {
    const c = await profiles.create(game, `${p.name} copy`, p.id);
    profilesChanged(game);
    posthog?.capture("profile_created", { game_id: game, creation_mode: "duplicate" });
    undoable(game, `Made ${c.name}`, c);
    return c;
  } catch (e) { fail(e); return null; }
}

/** Change a profile's fields, with Undo back to what they were. */
export async function patchProfile(game: GameId, p: Profile, patch: ProfilePatch, label: string): Promise<boolean> {
  const before: ProfilePatch = {};
  for (const k of Object.keys(patch) as Array<keyof ProfilePatch>) (before as Record<string, string>)[k] = p[k] ?? "";
  const keysChanged = "hotkey" in patch && (patch.hotkey ?? "") !== (p.hotkey ?? "");
  const put = async (x: ProfilePatch) => { await profiles.update(p.id, x); profilesChanged(game); if (keysChanged) syncKeys(); };
  try {
    await put(patch);
    record({ label, undo: () => put(before), redo: () => put(patch) });
    return true;
  } catch (e) { fail(e); return false; }
}

export function renameProfile(game: GameId, p: Profile, name: string) {
  const n = name.trim();
  if (!n || n === p.name) return Promise.resolve(false);
  return patchProfile(game, p, { name: n }, `Renamed ${p.name} to ${n}`);
}

/** Replace a profile's mods with the ones on now. Undo puts its old list back. */
export async function saveInto(game: GameId, p: Profile) {
  if (p.active) { toast(`${p.name} is on now, so it follows your changes already`); return; }
  try {
    let id = p.id;
    let before = await profiles.snapshot(id);
    await profiles.capture(id);
    profilesChanged(game);
    const swap = async () => {
      const prior = await profiles.snapshot(id);
      await profiles.remove(id);
      id = (await profiles.restore(before)).id;
      before = prior;
      profilesChanged(game);
    };
    record({ label: `Saved the mods on now into ${p.name}`, undo: swap, redo: swap });
  } catch (e) { fail(e); }
}

/** Delete with Undo (no question first: the toast's Undo brings it back whole). */
export async function deleteProfile(game: GameId, p: Profile, list: Profile[] | null) {
  if ((list?.length ?? 2) <= 1) { toast("The only profile can't be deleted", true); return; }
  try {
    let snap = await profiles.snapshot(p.id);
    let id = p.id;
    await profiles.remove(id);
    profilesChanged(game);
    if (p.hotkey) syncKeys();
    record({
      label: p.active ? `Deleted ${p.name}. The next profile is on now, with the same mods` : `Deleted ${p.name}`,
      undo: async () => { id = (await profiles.restore(snap)).id; profilesChanged(game); if (p.hotkey) syncKeys(); },
      redo: async () => { snap = await profiles.snapshot(id); await profiles.remove(id); profilesChanged(game); if (p.hotkey) syncKeys(); },
    });
  } catch (e) { fail(e); }
}

export const exportProfile = (game: GameId, p: Profile) => emitApp({ type: "export-profile", game, profileId: p.id });

// ── the new-profile dialog: any screen opens it, NewProfileHost (in App) draws it ──

let newReq: { game: GameId; start: NewStart; n: number } | null = null;
let newCount = 0;
const newSubs = new Set<() => void>();
const setNewReq = (r: typeof newReq) => { newReq = r; newSubs.forEach((f) => f()); };

/** Open the new-profile dialog. Its defaults make the profile in one more click (or Enter). */
export const startNewProfile = (game: GameId, start: NewStart = "now") => setNewReq({ game, start, n: ++newCount });
export const closeNewProfile = () => setNewReq(null);
export const useNewProfileRequest = () => useSyncExternalStore((f) => { newSubs.add(f); return () => { newSubs.delete(f); }; }, () => newReq);

// ── asking the Profiles screen to open its editor (from a menu anywhere) ──

export type EditFocus = "all" | "rename" | "hotkey" | "icon" | "banner";
let pending: { id: number; focus: EditFocus } | null = null;
const editSubs = new Set<() => void>();

/** Open a profile's editor ("rename" edits the name on its card). Goes to Profiles first when elsewhere. */
export function requestEdit(id: number, focus: EditFocus = "all") {
  pending = { id, focus };
  editSubs.forEach((f) => f());
  if (currentRoute().view !== "profiles") go("profiles");
}
export const useEditRequest = () => useSyncExternalStore((f) => { editSubs.add(f); return () => { editSubs.delete(f); }; }, () => pending);
export function takeEditRequest() { const p = pending; pending = null; editSubs.forEach((f) => f()); return p; }
