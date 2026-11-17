// Right-click menus for GameBanana mods ("gbmod") and GameBanana members ("creator"), the same on every screen.
// Registered once, when the app loads OnlineOverlays. Owner: BROWSE area.
import type { GbCard } from "../../lib/gamebanana";
import { creatorOf, hideMod, hiddenModsPref, nsfwPref, setNsfw, type NsfwMode } from "../../lib/prefs";
import { allGames, go, goIn } from "../../lib/store";
import { registerMenu, type MenuEntry } from "../../ui/ContextMenu";
import { copyText, flagCreator, installLatest, openCreator, openExternal, wantFiles, withCreator } from "./actions";
import { setOn } from "../library/actions";
import { libIndexNow, openGbMod, openWithFilters } from "./state";

const NSFW: Array<[NsfwMode, string, string]> = [
  ["hide", "Hide", "leave them out"],
  ["blur", "Blur", "blur their pictures until opened"],
  ["show", "Show", "show their pictures unblurred"],
];

/** The hover tip for an adult mode, the same in Browse, the drawer, Settings and menus. */
export const nsfwTip = (v: NsfwMode) => `Mods for adults: ${NSFW.find((x) => x[0] === v)![2]}`;

/** The adult mode switch as menu items (checked on the current one). */
export function nsfwItems(): MenuEntry[] {
  const cur = nsfwPref.get();
  return NSFW.map(([v, label]) => ({ label, title: nsfwTip(v), checked: cur === v, onClick: () => setNsfw(v) }));
}

/** A creator's items: their page, follow, favourite, prioritize, block. The creator page's buttons use the same names.
 *  `gone`: GameBanana no longer has the member, so Follow and Prioritize only show to turn them off. */
export function creatorItems(c: { id?: number | null; name: string; avatar?: string | null; modId?: number | null }, opts: { gone?: boolean } = {}): MenuEntry[] {
  const f = creatorOf(c.id);
  return [
    { label: "View creator", icon: "user", title: "Their mods in this game first, then other games", onClick: () => void withCreator(c, (r) => openCreator(r.id)) },
    "-",
    opts.gone && !f?.sub ? null : { label: "Follow", icon: "feed", checked: !!f?.sub, title: "Their new mods show on Home", onClick: () => flagCreator(c, "sub", !f?.sub) },
    { label: "Favourite", icon: "star", checked: !!f?.fav, title: "Listed first among your creators", onClick: () => flagCreator(c, "fav", !f?.fav) },
    opts.gone && !f?.prio ? null : { label: "Prioritize", icon: "crown", checked: !!f?.prio, title: "Their mods come first in Browse and always count as high quality", onClick: () => flagCreator(c, "prio", !f?.prio) },
    "-",
    f?.blocked
      ? { label: "Unblock", icon: "block", onClick: () => flagCreator(c, "blocked", false) }
      : { label: "Block", icon: "block", danger: true, title: "Hide their mods everywhere (Undo in the toast)", onClick: () => flagCreator(c, "blocked", true) },
    c.id ? { label: "Open on GameBanana", icon: "external", onClick: () => openExternal(`https://gamebanana.com/members/${c.id}`) } : null,
  ];
}

/** `inDrawer`: for the mod's own page, which already shows its details, its files and a GameBanana button. */
export function gbModItems(game: Parameters<typeof libIndexNow>[0], card: GbCard, inDrawer = false): MenuEntry[] {
  const idx = libIndexNow(game);
  const inst = idx.byMod.get(card.id);
  const arch = idx.archived.get(card.id);
  const upd = inst?.find((m) => m.updateAvailable);
  const hidden = hiddenModsPref.get().includes(card.id);
  const c = card.submitter;
  // a mod for a game other than the one it would install into (a creator's other games) can't be installed from here
  const g = allGames().find((x) => x.id === game);
  const foreign = !!(card.game && g && card.game.id !== g.gamebananaId);
  const on = !!inst?.some((m) => m.enabled);
  return [
    foreign || !inst?.[0] ? null : on
      ? { label: "Turn off", icon: "power", onClick: () => void setOn(game, inst.filter((m) => m.enabled), false) }
      : { label: "Turn on", icon: "power", onClick: () => void setOn(game, [inst[0]!], true) },
    foreign ? null : upd ? { label: "Update", icon: "update", title: "Download the newest file. Its options, tags and on/off state stay", onClick: () => void installLatest(game, card.id, card.name, upd.id) }
      : inst?.[0] ? null
      : arch ? { label: "Reinstall", icon: "install", title: "Download it again. Your settings for it come back", onClick: () => void installLatest(game, card.id, card.name, undefined, true) }
      : { label: "Install latest", icon: "install", title: "Download and install the newest file", onClick: () => void installLatest(game, card.id, card.name) },
    foreign || !inst?.[0] ? null : { label: "Show in Mods", icon: "mods", onClick: () => goIn(game, { view: "library", modId: inst[0]!.id }) },
    foreign || upd || !inst?.[0] ? null : { label: "Install again", icon: "refresh", title: "Download the newest file and replace the installed copy", onClick: () => void installLatest(game, card.id, card.name, inst[0]!.id) },
    foreign || inDrawer ? null : { label: "Choose a file", icon: "file", onClick: () => { wantFiles(); openGbMod(card.id); } },
    inDrawer ? null : { label: "Open details", icon: "info", onClick: () => openGbMod(card.id) },
    "-",
    card.character ? { label: `${card.character}'s page`, icon: "characters", onClick: () => go({ view: "characters", character: card.character! }) }
      : card.category ? { label: `Browse ${card.category.name} mods`, icon: "browse", onClick: () => { openWithFilters(game, { category: card.category!, character: null }); go({ view: "browse" }); } }
      : null,
    c ? { label: c.name, img: c.avatar, icon: "user", items: creatorItems({ ...c, modId: card.id }) } : null,
    "-",
    inDrawer ? null : { label: "Open on GameBanana", icon: "external", onClick: () => openExternal(card.url) },
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
