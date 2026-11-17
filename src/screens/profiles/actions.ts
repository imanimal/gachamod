// Everything you can do to a profile, each with Undo: make one (from the mods on now, or empty, through the
// new-profile dialog any screen can open), duplicate, rename, change, save the mods on now into it, delete.
// Deleting keeps a snapshot, so Undo puts it back with its mods, options and hotkey. Also the "open the editor"
// request that menus anywhere use (the Profiles screen answers it).
// Owner: HOME/PROFILES area.
import { useSyncExternalStore } from "react";
import { errorText, hotkeys, profiles, type GameId, type Profile, type ProfilePatch, type ProfileSnapshot } from "../../lib/api";
import { record, undo } from "../../lib/history";
import { t } from "../../lib/i18n";
import { currentRoute, emitApp, go } from "../../lib/store";
import { toast } from "../../ui/toast";
import { publish } from "../library/data";
import { knownProfiles, loadProfiles, profilesChanged, switchingNow, switchProfile } from "./data";

const fail = (e: unknown) => toast(errorText(e), true);
const syncKeys = () => void hotkeys.sync().catch(() => {});

/** Switch with errors as toasts. */
export async function switchTo(game: GameId, to: Profile, list: Profile[] | null) {
  if (to.active || switchingNow()) return;
  try { await switchProfile(game, to, list?.find((p) => p.active) ?? null); } catch (e) { fail(e); }
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

/** The other profile of the game that holds `combo` now, if any. Giving the combo to `id` takes it from that one. */
export async function hotkeyHolder(game: GameId, combo: string | undefined, id: number | null): Promise<Profile | undefined> {
  if (!combo) return undefined;
  const list = knownProfiles(game) ?? await loadProfiles(game).catch(() => [] as Profile[]);
  return list.find((x) => x.id !== id && x.hotkey === combo);
}

/** Make a profile from the new-profile dialog. `extra` is the rest of what was filled in (icon, hotkey...). One made
 *  from the mods on now becomes the profile in use (it matches them, so no files change). Undo takes it away, gives a
 *  moved hotkey back, and puts the old profile back in use. */
export async function makeProfile(game: GameId, start: NewStart, name: string, extra: ProfilePatch): Promise<Profile | null> {
  const list = knownProfiles(game) ?? await loadProfiles(game).catch(() => [] as Profile[]);
  const was = list.find((x) => x.active) ?? null;
  const holder = await hotkeyHolder(game, extra.hotkey, null);
  const activate = async (to: number) => { const r = await profiles.activate(to); publish(game, r.change); return r.profile; };
  let p: Profile;
  let switched = false;
  try {
    if (start === "empty") {
      const now = Math.floor(Date.now() / 1000);
      const blank: Profile = { id: 0, game, name, icon: null, color: null, banner: null, description: null, active: false, modCount: 0, createdAt: now, updatedAt: now, hotkey: null };
      p = await profiles.restore({ profile: blank, mods: [], vars: [] });
    } else {
      p = await profiles.create(game, name, null);
      try { p = await activate(p.id); switched = true; } catch (e) { fail(e); }
    }
    profilesChanged(game);
  } catch (e) { fail(e); return null; }
  // the profile is made either way, so a bad field is a toast, not a second try that would make another
  if (Object.keys(extra).length) {
    try { p = await profiles.update(p.id, extra); } catch (e) { fail(e); }
    profilesChanged(game);
  }

  const moved = holder && p.hotkey === extra.hotkey ? holder : undefined;
  let id = p.id;
  let snap: ProfileSnapshot | null = null;
  const made = start === "empty" ? t("Made {name}, with no mods on", { name: p.name })
    : switched ? t("Made {name} from the mods on now and switched to it", { name: p.name }) : t("Made {name} from the mods on now", { name: p.name });
  const label = moved ? t("{label}. Moved {key} from {name}", { label: made, key: moved.hotkey ?? "", name: moved.name }) : made;
  const e = record({
    label,
    undo: async () => {
      if (switched && was) await activate(was.id);
      snap = await profiles.snapshot(id);
      await profiles.remove(id);
      if (moved?.hotkey) await profiles.update(moved.id, { hotkey: moved.hotkey });
      profilesChanged(game);
      if (snap.profile.hotkey) syncKeys();
    },
    redo: async () => {
      if (!snap) return;
      id = (await profiles.restore(snap)).id;
      if (switched) await activate(id);
      profilesChanged(game);
      if (snap.profile.hotkey) syncKeys();
    },
  }, start === "empty");
  if (start === "empty") {
    // switching turns every mod off, so it waits for a click
    const id0: number = toast(t("{label}.", { label }), false, { label: t("Undo"), run: () => void undo(e, id0) }, {
      label: t("Switch to it"),
      run: async () => {
        const now = await loadProfiles(game).catch(() => null);
        const to = now?.find((x) => x.id === id);
        if (to) await switchTo(game, to, now);
      },
    });
  }
  return p;
}

/** One click: make a profile from the mods on now ("New profile 2"), switch to it, and start renaming it. The
 *  toast's Undo takes it away. The dialog (startNewProfile) is there for the extras. */
export async function quickNewProfile(game: GameId): Promise<Profile | null> {
  const list = knownProfiles(game) ?? await loadProfiles(game).catch(() => [] as Profile[]);
  const taken = new Set(list.map((x) => x.name.toLowerCase()));
  let name = t("New profile");
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = t("New profile {n}", { n });
  const p = await makeProfile(game, "now", name, {});
  if (p) requestEdit(p.id, "rename");
  return p;
}

/** Copy a profile, then name the copy: its card (or the editor, on a profile's page) opens with the name selected. */
export async function duplicateProfile(game: GameId, p: Profile): Promise<Profile | null> {
  try {
    const c = await profiles.create(game, t("{name} copy", { name: p.name }), p.id);
    profilesChanged(game);
    undoable(game, t("Made {name}", { name: c.name }), c);
    requestEdit(c.id, "rename");
    return c;
  } catch (e) { fail(e); return null; }
}

/** Change a profile's fields, with Undo back to what they were. A hotkey taken from another profile goes back to it
 *  on Undo too. */
export async function patchProfile(game: GameId, p: Profile, patch: ProfilePatch, label: string): Promise<boolean> {
  const before: ProfilePatch = {};
  for (const k of Object.keys(patch) as Array<keyof ProfilePatch>) (before as Record<string, string>)[k] = p[k] ?? "";
  const keysChanged = "hotkey" in patch && (patch.hotkey ?? "") !== (p.hotkey ?? "");
  const holder = keysChanged ? await hotkeyHolder(game, patch.hotkey, p.id) : undefined;
  const put = async (x: ProfilePatch, back = false) => {
    await profiles.update(p.id, x);
    if (back && holder?.hotkey) await profiles.update(holder.id, { hotkey: holder.hotkey });
    profilesChanged(game);
    if (keysChanged) syncKeys();
  };
  try {
    await put(patch);
    record({ label: holder ? t("{label}. Moved {key} from {name}", { label, key: holder.hotkey ?? "", name: holder.name }) : label, undo: () => put(before, true), redo: () => put(patch) });
    return true;
  } catch (e) { fail(e); return false; }
}

export function renameProfile(game: GameId, p: Profile, name: string) {
  const n = name.trim();
  if (!n || n === p.name) return Promise.resolve(false);
  return patchProfile(game, p, { name: n }, t("Renamed {old} to {name}", { old: p.name, name: n }));
}

/** Replace a profile's mods with the ones on now. Undo puts its old list back. */
export async function saveInto(game: GameId, p: Profile) {
  if (p.active) { toast(t("{name} is on now, so it follows your changes already", { name: p.name })); return; }
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
    record({ label: t("Saved the mods on now into {name}", { name: p.name }), undo: swap, redo: swap });
  } catch (e) { fail(e); }
}

/** Delete with Undo (no question first: the toast's Undo brings it back whole). True when it was deleted. */
export async function deleteProfile(game: GameId, p: Profile, list: Profile[] | null): Promise<boolean> {
  if ((list?.length ?? 2) <= 1) { toast(t("The only profile can't be deleted"), true); return false; }
  try {
    let snap = await profiles.snapshot(p.id);
    let id = p.id;
    await profiles.remove(id);
    profilesChanged(game);
    if (p.hotkey) syncKeys();
    record({
      label: p.active ? t("Deleted {name}. The next profile is on now, with the same mods", { name: p.name }) : t("Deleted {name}", { name: p.name }),
      undo: async () => { id = (await profiles.restore(snap)).id; profilesChanged(game); if (p.hotkey) syncKeys(); },
      redo: async () => { snap = await profiles.snapshot(id); await profiles.remove(id); profilesChanged(game); if (p.hotkey) syncKeys(); },
    });
    return true;
  } catch (e) { fail(e); return false; }
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

/** Open a profile's editor ("rename" edits the name on its card, or in the editor on a profile's page). Goes to
 *  Profiles first when elsewhere. The request waits until the profile is in the list, so a new one can be named. */
export function requestEdit(id: number, focus: EditFocus = "all") {
  pending = { id, focus };
  editSubs.forEach((f) => f());
  if (currentRoute().view !== "profiles") go("profiles");
}
export const useEditRequest = () => useSyncExternalStore((f) => { editSubs.add(f); return () => { editSubs.delete(f); }; }, () => pending);
export function takeEditRequest() { const p = pending; pending = null; editSubs.forEach((f) => f()); return p; }
