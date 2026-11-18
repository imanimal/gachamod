// Right-click menus for GameBanana mods ("gbmod") and GameBanana members ("creator"), the same on every screen.
// Registered once, when the app loads OnlineOverlays. Owner: BROWSE area.
import type { GbCard } from "../../lib/gamebanana";
import { creatorOf, hideMod, hiddenModsPref, nsfwPref, setNsfw, type NsfwMode } from "../../lib/prefs";
import { allGames, go, goIn } from "../../lib/store";
import { registerMenu, type MenuEntry } from "../../ui/ContextMenu";
import { copyText, flagCreator, installLatest, openCreator, openExternal, wantFiles, withCreator } from "./actions";
import { setOn } from "../library/actions";
import { libIndexNow, openGbMod, openWithFilters } from "./state";
import { t } from "../../lib/i18n";

const NSFW: Array<[NsfwMode, string, string]> = [
  ["hide", t("Hide"), t("Mods for adults: leave them out")],
  ["blur", t("Blur"), t("Mods for adults: blur their pictures until opened")],
  ["show", t("Show"), t("Mods for adults: show their pictures unblurred")],
];

/** The hover tip for an adult mode, the same in Browse, the drawer, Settings and menus. */
export const nsfwTip = (v: NsfwMode) => NSFW.find((x) => x[0] === v)![2];

/** The adult mode switch as menu items (checked on the current one). */
export function nsfwItems(): MenuEntry[] {
  const cur = nsfwPref.get();
  return NSFW.map(([v, label]) => ({ label, title: nsfwTip(v), checked: cur === v, onClick: () => setNsfw(v) }));
}

/** A creator's items: their page, follow, favourite, prioritize, block. The creator page's buttons use the same names.
 *  `gone`: GameBanana no longer has the member, so Follow and Prioritize only show to turn them off. */
/** `uber`: the page is wearing the member's Uberstyle, so the menu offers its setting. `page`: the menu is on the
 *  creator's page, whose buttons show the new state, so the changes don't toast (Block does anyway). */
export function creatorItems(c: { id?: number | null; name: string; avatar?: string | null; modId?: number | null }, opts: { gone?: boolean; uber?: boolean; page?: boolean } = {}): MenuEntry[] {
  const f = creatorOf(c.id);
  const say = !opts.page;
  return [
    { label: t("View creator"), icon: "user", title: t("Their mods in this game first, then other games"), onClick: () => void withCreator(c, (r) => openCreator(r.id)) },
    "-",
    opts.gone && !f?.sub ? null : { label: t("Follow"), icon: "feed", checked: !!f?.sub, title: t("Their new mods show on Home"), onClick: () => flagCreator(c, "sub", !f?.sub, say) },
    { label: t("Favourite"), icon: "star", checked: !!f?.fav, title: t("Listed first among your creators"), onClick: () => flagCreator(c, "fav", !f?.fav, say) },
    opts.gone && !f?.prio ? null : { label: t("Prioritize"), icon: "crown", checked: !!f?.prio, title: t("Their mods come first in Browse and always count as high quality"), onClick: () => flagCreator(c, "prio", !f?.prio, say) },
    "-",
    f?.blocked
      ? { label: t("Unblock"), icon: "block", onClick: () => flagCreator(c, "blocked", false, say) }
      : { label: t("Block"), icon: "block", danger: true, title: t("Hide their mods everywhere (Undo in the toast)"), onClick: () => flagCreator(c, "blocked", true, say) },
    c.id ? { label: t("Open on GameBanana"), icon: "external", onClick: () => openExternal(`https://gamebanana.com/members/${c.id}`) } : null,
    opts.uber ? { label: t("Uberstyle settings"), icon: "palette", title: t("Opens the switch for Uberstyles on creator pages"), onClick: () => go({ view: "settings", section: "set-uberstyles" }) } : null,
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
  // the card or the mod page the menu came from shows the download, so no toast for it
  const latest = (replaces?: string, archived = false) => void installLatest(game, card.id, replaces, archived, false);
  return [
    foreign || !inst?.[0] ? null : on
      ? { label: t("Turn off"), icon: "power", onClick: () => void setOn(game, inst.filter((m) => m.enabled), false) }
      : { label: t("Turn on"), icon: "power", onClick: () => void setOn(game, [inst[0]!], true) },
    foreign ? null : upd ? { label: t("Update"), icon: "update", title: t("Download the newest file. Options, tags and on/off state stay"), onClick: () => latest(upd.id) }
      : inst?.[0] ? null
      : arch ? { label: t("Reinstall"), icon: "install", title: t("Download it again. Your settings for it come back"), onClick: () => latest(undefined, true) }
      : { label: t("Install latest"), icon: "install", title: t("Download and install the newest file"), onClick: () => latest() },
    foreign || !inst?.[0] ? null : { label: t("Show in Mods"), icon: "mods", onClick: () => goIn(game, { view: "library", modId: inst[0]!.id }) },
    foreign || upd || !inst?.[0] ? null : { label: t("Install again"), icon: "refresh", title: t("Download the newest file and replace the installed copy"), onClick: () => latest(inst[0]!.id) },
    foreign || inDrawer ? null : { label: t("Choose a file"), icon: "file", onClick: () => { wantFiles(); openGbMod(card.id); } },
    inDrawer ? null : { label: t("Open details"), icon: "info", onClick: () => openGbMod(card.id) },
    "-",
    card.character ? { label: t("{name}'s page", { name: card.character }), icon: "characters", onClick: () => go({ view: "characters", character: card.character! }) }
      : card.category ? { label: t("Browse {name} mods", { name: card.category.name }), icon: "browse", onClick: () => { openWithFilters(game, { category: card.category!, character: null }); go({ view: "browse" }); } }
      : null,
    c ? { label: c.name, img: c.avatar, icon: "user", items: creatorItems({ ...c, modId: card.id }) } : null,
    "-",
    inDrawer ? null : { label: t("Open on GameBanana"), icon: "external", onClick: () => openExternal(card.url) },
    { label: t("Copy link"), icon: "link", onClick: () => copyText(card.url, t("Copied the link")) },
    "-",
    card.nsfw ? { label: t("Mods for adults"), icon: "eye", items: nsfwItems() } : null,
    hidden
      ? { label: t("Show in Browse again"), icon: "eye", onClick: () => hideMod(card.id, card.name, false) }
      : { label: t("Not interested"), icon: "hide", title: t("Hide this mod from Browse (Undo in the toast)"), onClick: () => hideMod(card.id, card.name) },
  ];
}

let done = false;
export function registerBrowseMenus() {
  if (done) return;
  done = true;
  registerMenu("gbmod", ({ game, card }) => gbModItems(game, card));
  registerMenu("creator", (c) => creatorItems(c));
}
