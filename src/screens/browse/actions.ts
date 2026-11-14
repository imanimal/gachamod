// Small actions the browser, its cards, the drawer and the right-click menus share. Owner: BROWSE area.
import { errorText, shell, type GameId } from "../../lib/api";
import { findMember, queueLatest } from "../../lib/gamebanana";
import { setCreatorFlag, type CreatorFlag, type CreatorRef } from "../../lib/prefs";
import { go } from "../../lib/store";
import { toast } from "../../ui/toast";

/** Queue a mod's newest file. `replaces`: the library id it updates. */
export async function installLatest(game: GameId, modId: number, name: string, replaces?: string, archived?: boolean) {
  try {
    const item = await queueLatest(game, modId, replaces);
    if (!item) { toast(`${name} has no file to download`, true); return; }
    const verb = replaces ? "Updating" : archived ? "Reinstalling" : "Downloading";
    toast(`${verb} ${name}`, false, { label: "Show", run: () => go("downloads") });
  } catch (e) { toast(errorText(e), true); }
}

export function openExternal(url: string) {
  shell.openUrl(url).catch((e) => toast(errorText(e), true));
}

export function copyText(text: string, what: string) {
  navigator.clipboard.writeText(text).then(() => toast(`Copied ${what}`)).catch(() => toast("Couldn't copy to the clipboard", true));
}

export function openCreator(id: number) { go({ view: "browse", user: id }); }

/** Find a creator's id from a name (and a mod of theirs), then act. Toasts when GameBanana doesn't know them. */
export async function withCreator(c: { id?: number | null; name: string; avatar?: string | null; modId?: number | null }, run: (c: CreatorRef) => void) {
  if (c.id) { run({ id: c.id, name: c.name, avatar: c.avatar ?? null }); return; }
  try {
    const u = await findMember(c.name, c.modId);
    if (u) run({ id: u.id, name: u.name, avatar: u.avatar ?? c.avatar ?? null });
    else toast(`Couldn't find ${c.name} on GameBanana`, true);
  } catch (e) { toast(errorText(e), true); }
}

export function flagCreator(c: { id?: number | null; name: string; avatar?: string | null; modId?: number | null }, flag: CreatorFlag, on: boolean) {
  void withCreator(c, (ref) => setCreatorFlag(ref, flag, on));
}

// The drawer reads this once when it opens, to scroll to its files ("Choose a file" in a menu).
let focusFiles = false;
export function wantFiles() { focusFiles = true; }
export function takeWantFiles(): boolean { const v = focusFiles; focusFiles = false; return v; }
