// Right-click menus for GameBanana mods ("gbmod") and GameBanana members ("creator"), the same on every screen.
// Registered once, when the app loads OnlineOverlays. Owner: BROWSE area.
import type { GbCard } from "../../lib/gamebanana";
import { creatorOf, hideMod, hiddenModsPref, nsfwPref, setNsfw, type NsfwMode } from "../../lib/prefs";
import { allGames, go } from "../../lib/store";
import { registerMenu, type MenuEntry } from "../../ui/ContextMenu";
import { copyText, flagCreator, installLatest, openCreator, openExternal, wantFiles, withCreator } from "./actions";
import { libIndexNow, openGbMod } from "./state";

const NSFW: Array<[NsfwMode, string, string]> = [
  ["hide", "Hide", "Leave out mods GameBanana marks for adults"],
  ["blur", "Blur", "Blur their pictures until opened"],
  ["show", "Show", "Show everything"],
];

/** The adult mode switch as menu items (checked on the current one). */
export function nsfwItems(): MenuEntry[] {
  const cur = nsfwPref.get();
  return NSFW.map(([v, label, title]) => ({ label, title, checked: cur === v, onClick: () => setNsfw(v) }));
}

/** A creator's items: their page, follow, favourite, priority, block. */
export function creatorItems(c: { id?: number | null; name: string; avatar?: string | null; modId?: number | null }): MenuEntry[] {
  const f = creatorOf(c.id);
  return [
    { label: "View creator", icon: "user", title: "Their mods in this game first, then other games", onClick: () => void withCreator(c, (r) => openCreator(r.id)) },
    "-",
    { label: "Follow", icon: "feed", checked: !!f?.sub, title: "Their new mods show on Home", onClick: () => flagCreator(c, "sub", !f?.sub) },
    { label: "Favourite", icon: "star", checked: !!f?.fav, title: "Listed first among your creators", onClick: () => flagCreator(c, "fav", !f?.fav) },
    { label: "Priority", icon: "crown", checked: !!f?.prio, title: "Their mods come first in Browse and always count as high quality", onClick: () => flagCreator(c, "prio", !f?.prio) },
    "-",
    f?.blocked
      ? { label: "Unblock", icon: "block", onClick: () => flagCreator(c, "blocked", false) }
      : { label: "Block", icon: "block", danger: true, title: "Hide their mods everywhere (Undo in the toast)", onClick: () => flagCreator(c, "blocked", true) },
    c.id ? { label: "Open on GameBanana", icon: "external", onClick: () => openExternal(`https://gamebanana.com/members/${c.id}`) } : null,
  ];
}

export function gbModItems(game: Parameters<typeof libIndexNow>[0], card: GbCard): MenuEntry[] {
  const idx = libIndexNow(game);
  const inst = idx.byMod.get(card.id);
  const arch = idx.archived.get(card.id);
  const upd = inst?.find((m) => m.updateAvailable);
  const hidden = hiddenModsPref.get().includes(card.id);
  const c = card.submitter;
  // a mod for a game other than the one it would install into (a creator's other games) can't be installed from here
  const g = allGames().find((x) => x.id === game);
  const foreign = !!(card.game && g && card.game.id !== g.gamebananaId);
  return [
    foreign ? null : upd ? { label: "Update", icon: "update", title: "Download the newest file. Its options, tags and on/off state stay", onClick: () => void installLatest(game, card.id, card.name, upd.id) }
      : inst?.[0] ? { label: "Install again", icon: "refresh", title: "Download the newest file and replace the installed copy", onClick: () => void installLatest(game, card.id, card.name, inst[0]!.id) }
      : arch ? { label: "Reinstall", icon: "install", title: "Download it again. Your settings for it come back", onClick: () => void installLatest(game, card.id, card.name, undefined, true) }
      : { label: "Install latest", icon: "install", title: "Download and install the newest file", onClick: () => void installLatest(game, card.id, card.name) },
    foreign ? null : { label: "Choose a file", icon: "file", onClick: () => { wantFiles(); openGbMod(card.id); } },
    { label: "Open details", icon: "info", onClick: () => openGbMod(card.id) },
    "-",
    card.character ? { label: `${card.character}'s page`, icon: "characters", onClick: () => go({ view: "characters", character: card.character! }) } : null,
    c ? { label: c.name, img: c.avatar, icon: "user", items: creatorItems({ ...c, modId: card.id }) } : null,
    "-",
    { label: "Open on GameBanana", icon: "external", onClick: () => openExternal(card.url) },
    { label: "Copy link", icon: "link", onClick: () => copyText(card.url, "the link") },
    "-",
    card.nsfw ? { label: "Mods for adults", icon: "eye", items: nsfwItems() } : null,
    hidden
      ? { label: "Show in Browse again", icon: "eye", onClick: () => hideMod(card.id, card.name, false) }
      : { label: "Not interested", icon: "hide", title: "Hide this mod from Browse (Undo in the toast)", onClick: () => hideMod(card.id, card.name) },
  ];
}

let done = false;
export function registerBrowseMenus() {
  if (done) return;
  done = true;
  registerMenu("gbmod", ({ game, card }) => gbModItems(game, card));
  registerMenu("creator", (c) => creatorItems(c));
}
