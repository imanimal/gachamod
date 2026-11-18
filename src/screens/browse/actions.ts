// Small actions the browser, its cards, the drawer and the right-click menus share. Owner: BROWSE area.
import { errorText, shell, type GameId } from "../../lib/api";
import { findMember, queueLatest } from "../../lib/gamebanana";
import { setCreatorFlag, type CreatorFlag, type CreatorRef } from "../../lib/prefs";
import { go } from "../../lib/store";
import { toast } from "../../ui/toast";
import { t } from "../../lib/i18n";

/** Queue a mod's newest file. `replaces`: the library id it updates. `say`: a toast with Show, for places that don't
 *  show the download (a Browse card and the mod page draw it themselves, so they pass false). */
export async function installLatest(game: GameId, modId: number, replaces?: string, archived?: boolean, say = true) {
  try {
    const item = await queueLatest(game, modId, replaces);
    if (!item) { toast(t("The mod has no file to download"), true); return; }
    if (!say) return;
    const text = replaces ? t("Updating the mod") : archived ? t("Reinstalling the mod") : t("Downloading the mod");
    toast(text, false, { label: t("Show"), run: () => go("downloads") });
  } catch (e) { toast(errorText(e), true); }
}

export function openExternal(url: string) {
  shell.openUrl(url).catch((e) => toast(errorText(e), true));
}

/** Copy text and say so. `done`: the toast when it worked ("Copied the link"). */
export function copyText(text: string, done: string) {
  navigator.clipboard.writeText(text).then(() => toast(done)).catch(() => toast(t("Couldn't copy to the clipboard"), true));
}

export function openCreator(id: number) { go({ view: "browse", user: id }); }

/** Find a creator's id from a name (and a mod of theirs), then act. Toasts when GameBanana doesn't know them. */
export async function withCreator(c: { id?: number | null; name: string; avatar?: string | null; modId?: number | null }, run: (c: CreatorRef) => void) {
  if (c.id) { run({ id: c.id, name: c.name, avatar: c.avatar ?? null }); return; }
  try {
    const u = await findMember(c.name, c.modId);
    if (u) run({ id: u.id, name: u.name, avatar: u.avatar ?? c.avatar ?? null });
    else toast(t("Couldn't find the creator on GameBanana"), true);
  } catch (e) { toast(errorText(e), true); }
}

/** `say`: a toast with Undo, for menus that close and don't show the creator's state (the creator page's buttons do). */
export function flagCreator(c: { id?: number | null; name: string; avatar?: string | null; modId?: number | null }, flag: CreatorFlag, on: boolean, say = true) {
  void withCreator(c, (ref) => setCreatorFlag(ref, flag, on, say));
}

// The drawer reads this once when it opens, to scroll to its files ("Choose a file" in a menu).
let focusFiles = false;
export function wantFiles() { focusFiles = true; }
export function takeWantFiles(): boolean { const v = focusFiles; focusFiles = false; return v; }
