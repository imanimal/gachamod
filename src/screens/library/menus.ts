// The right-click menus for an installed mod and for a character (the same everywhere they show), and the global
// search's characters and installed mods. Imported once by the Mods screen so they register at start.
// Owner: LIBRARY area.
import { errorText, library, settings, type GameId, type ModEntry } from "../../lib/api";
import { trashDaysPref } from "../settings/automatic";
import type { ModHealth } from "../../lib/fixes";
import { charNoun } from "../../lib/games";
import { holdMods, holdOn, holdsNow, releaseMods } from "../../lib/holds";
import { portraitNow } from "../../lib/portraits";
import { registerCommands, scoreCommand, type Command } from "../../lib/search";
import { currentGame, go, onApp } from "../../lib/store";
import { held } from "../../lib/tauri";
import { menuFor, registerMenu, type MenuEntry } from "../../ui/ContextMenu";
import { isOwned, toggleOwned } from "../characters/owned";
import { characterNames, isCharHidden, setCharHidden } from "../characters/roster";
import {
  cachedProfiles, checkForUpdates, combineMods, exportMods, fixForUpdate, getUpdate, keysOnlyOnScreen, onlyOnScreenFn, openDetails,
  openFolder, openOnGb, previewFromGb, resetPreview, setFavourite, setInProfile, setOn, setParent, trashMods, warmProfiles,
} from "./actions";
import { askLib } from "./LibDialogs";
import { overlappingAll } from "./overlap";
import { liveCharacterOf, liveShownInstead } from "../ingame/data";
import { changeStates, onPublish } from "./data";
import { toast } from "../../ui/toast";
import { queueLatest } from "../../lib/gamebanana";
import { stops, t, tn } from "../../lib/i18n";

// what the mod screens saw last, so menus opened anywhere know a mod's health and a character's mods
const lastHealth = new Map<GameId, Map<string, ModHealth>>();
const lastMods = new Map<GameId, ModEntry[]>();
export function noteLibrary(game: GameId, mods: ModEntry[] | null, health?: Map<string, ModHealth>) {
  if (mods) lastMods.set(game, mods);
  if (health) lastHealth.set(game, health);
}
export const healthOf = (game: GameId, id: string) => lastHealth.get(game)?.get(id);
/** A mod as the mod screens saw it last, for menus opened elsewhere (Tools rows). Undefined before they've loaded. */
export const knownMod = (game: GameId, id: string) => lastMods.get(game)?.find((m) => m.id === id);

/** A hash swap fixes it, or a fixer gachamod gets and runs. */
export const isBroken = (h: ModHealth | undefined) => h?.status === "broken" || (h?.status === "unfixable" && !!h.tool);

/** Download the update of each of these mods that has one, with one toast for all of them. */
export async function getUpdates(game: GameId, list: ModEntry[]) {
  const due = list.filter((m) => m.updateAvailable && m.source);
  if (due.length === 1) return getUpdate(game, due[0]!);
  if (!due.length) return;
  const missed: string[] = [];
  for (const m of due) {
    try { if (!(await queueLatest(game, m.source!.modId, m.id))) missed.push(m.name); }
    catch { missed.push(m.name); }
  }
  const got = due.length - missed.length;
  const first = missed.slice(0, 3).join(", ");
  const names = missed.length > 3 ? t("{names} and {n} more", { names: first, n: missed.length - 3 }) : first;
  const downloading = tn(got, "Downloading {n} update", "Downloading {n} updates");
  const text = !missed.length ? downloading
    : got ? t("{text}. Couldn't find a newer file for {names}", { text: downloading, names })
    : t("Couldn't find a newer file for {names}", { names });
  toast(text, !got, got ? { label: t("Downloads"), run: () => go("downloads") } : undefined);
}

/** "Make sub-mod of" with the mods it could go with (the same character's first), or "Unlink" for a sub-mod. */
function subModItem(game: GameId, mod: ModEntry): MenuEntry {
  const all = lastMods.get(game) ?? [];
  if (mod.parent) {
    const p = all.find((m) => m.id === mod.parent);
    return { label: p ? t("Unlink from {mod}", { mod: p.name }) : t("Unlink from its mod"), icon: "link",
      title: t("Make it a separate mod again, so turning it on asks about the character's other mods"), onClick: () => void setParent(game, mod, "", all) };
  }
  if (all.some((m) => m.parent === mod.id)) return { label: t("Make sub-mod of"), icon: "link", disabled: true, title: t("It already has sub-mods") };
  const same = (m: ModEntry) => !!mod.character && m.character?.toLowerCase() === mod.character.toLowerCase();
  const picks = all.filter((m) => m.id !== mod.id && !m.parent)
    .sort((a, b) => Number(same(b)) - Number(same(a)) || Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name))
    .slice(0, 40);
  return {
    label: t("Make sub-mod of"), icon: "link",
    title: t("For an add-on that goes with another mod, like a hair recolour for one outfit. It turns off with that mod, comes back with it, and never counts as another skin"),
    items: picks.map((m) => ({ label: m.name, title: m.enabled ? t("{name}, on", { name: m.character ?? t("No character") }) : t("{name}, off", { name: m.character ?? t("No character") }), onClick: () => void setParent(game, mod, m.id, all) })),
  };
}

export function profileItems(game: GameId, list: ModEntry[]): MenuEntry[] {
  const c = cachedProfiles(game);
  if (!c) return [{ label: t("Loading profiles"), disabled: true }];
  return c.list.map((p) => {
    const inIt = (m: ModEntry) => (p.active ? m.enabled : c.members.get(p.id)?.has(m.id) ?? false);
    const all = list.every(inIt);
    const one = list.length === 1, profile = p.name;
    const title = all ? (one ? t("Take it out of {profile}", { profile }) : t("Take them out of {profile}", { profile }))
      : p.active ? (one ? t("Add it to {profile} (turns them on, it's the profile in use)", { profile }) : t("Add them to {profile} (turns them on, it's the profile in use)", { profile }))
      : one ? t("Add it to {profile}", { profile }) : t("Add them to {profile}", { profile });
    return {
      label: p.name, checked: all, title,
      onClick: () => void setInProfile(game, p, list, !all).then(() => warmProfiles(game, true)),
    };
  });
}

registerMenu("mod", ({ game, mod, selection }) => {
  const list = selection && selection.length > 1 && selection.some((m) => m.id === mod.id) ? selection : [mod];
  const many = list.length > 1;
  const allOn = list.every((m) => m.enabled);
  const allFav = list.every((m) => m.favorite);
  const broken = list.filter((m) => isBroken(healthOf(game, m.id)));
  const fromGb = list.filter((m) => m.source);
  const due = fromGb.filter((m) => m.updateAvailable);
  const onScreen = onlyOnScreenFn();
  const reasons = [...new Set(broken.flatMap((m) => healthOf(game, m.id)?.reasons ?? []))];
  // problems the user can set aside, and mods whose problems were set aside already (lib/holds)
  const holds = holdsNow(game);
  const heldList = list.filter((m) => holdOn(holds, m));
  const hurt = (m: ModEntry) => ["broken", "unfixable"].includes(healthOf(game, m.id)?.status ?? "");
  const loud = list.filter((m) => holdOn(holds, m)?.kind !== "ignore" && (m.conflicts > 0 || m.iniCount === 0 || hurt(m)));
  const canWait = list.filter((m) => !holdOn(holds, m) && hurt(m));
  // turning on next to the character's other mods that are on (live skins switch instead, one at a time)
  const going = list.filter((m) => !m.enabled && !liveCharacterOf(game, m.id));
  const beside = !allOn && going.length ? overlappingAll(going, lastMods.get(game) ?? []).filter((o) => !liveCharacterOf(game, o.id)) : [];
  const shownInstead = liveShownInstead(game, mod.id);
  return [
    many && { header: tn(list.length, "{n} mod selected", "{n} mods selected") },
    { label: allOn ? t("Turn off") : t("Turn on"), icon: "power", keys: "Space", onClick: () => void setOn(game, list, !allOn) },
    !many && !mod.enabled && !!shownInstead && { label: t("Show next to {mod}", { mod: shownInstead }), icon: "layers", keys: "Shift+Space",
      title: t("Turns it on next to {mod} instead of replacing it. It stops switching in game, and the game shows it after it reloads its mods", { mod: shownInstead }),
      onClick: () => void setOn(game, list, true, lastMods.get(game), undefined, true) },
    beside.length > 0 && { label: t("Turn on with others"), icon: "layers", keys: "Shift+Space",
      title: beside.length === 1
        ? (many ? t("Turns them on and keeps {mod} on too, for mods that go together like a hair recolour and an outfit. Shift+click on a switch does the same", { mod: beside[0]!.name })
          : t("Turns it on and keeps {mod} on too, for mods that go together like a hair recolour and an outfit. Shift+click on a switch does the same", { mod: beside[0]!.name }))
        : (many ? t("Turns them on and keeps the {n} other mods on too, for mods that go together like a hair recolour and an outfit. Shift+click on a switch does the same", { n: beside.length })
          : t("Turns it on and keeps the {n} other mods on too, for mods that go together like a hair recolour and an outfit. Shift+click on a switch does the same", { n: beside.length })),
      onClick: () => void setOn(game, list, true, lastMods.get(game), undefined, true) },
    !many && { label: t("Details"), icon: "info", keys: "Enter", onClick: () => openDetails(mod) },
    !many && (mod.parts ?? 0) > 0 && { label: t("Parts"), icon: "layers", title: t("Folders inside it that turn on and off by themselves"), onClick: () => openDetails(mod, "parts") },
    !many && mod.hasKeys && { label: t("Toggles"), icon: "key", title: t("Change the mod's toggle keys or turn them off"), onClick: () => openDetails(mod, "keys") },
    !many && mod.conflicts > 0 && { label: t("Conflicts"), icon: "warn", title: t("Mods that change the same parts as this one, to pick which one wins"), onClick: () => openDetails(mod, "conflicts") },
    !many && mod.iniCount > 0 && { label: t("View in 3D"), icon: "box", title: t("Turn the mod's model around, as its toggles are set now"), onClick: () => openDetails(mod, "model") },
    broken.length > 0 && { label: t("Attempt fix for the game update"), icon: "wand", title: stops(reasons.slice(0, 3)) || t("A game update broke it. Swaps its outdated hashes, or runs the fixer it needs"), onClick: () => void fixForUpdate(game, broken) },
    canWait.length > 0 && { label: t("Wait for an update"), icon: "bell-off",
      title: many ? t("Stops the game update warning until you install a newer version of them from their author. If that one is still broken, it warns again")
        : t("Stops the game update warning until you install a newer version of it from its author. If that one is still broken, it warns again"),
      onClick: () => void holdMods(game, canWait, "update") },
    loud.length > 0 && { label: t("Ignore problems"), icon: "hide",
      title: many ? t("Stops every warning about them: the red marks, the Problems filter and Tools. Conflicts are ignored on both sides. Show problems again brings them back")
        : t("Stops every warning about it: the red marks, the Problems filter and Tools. Conflicts are ignored on both sides. Show problems again brings them back"),
      onClick: () => void holdMods(game, loud, "ignore") },
    heldList.length > 0 && { label: t("Show problems again"), icon: "eye",
      title: heldList.every((m) => holds[m.id]?.kind === "update") ? t("Stop waiting for an update and warn about it again now") : t("Warn about its problems again"),
      onClick: () => void releaseMods(game, heldList) },
    onScreen && mod.hasKeys && { label: t("Toggles only while on screen"), icon: "keyboard", title: t("The mod's toggles only work while its character is on screen, so they stop taking keys meant for other mods"), onClick: () => void keysOnlyOnScreen(game, list) },
    "-",
    !many && { label: t("Rename"), icon: "edit", keys: "F2", onClick: () => askLib({ kind: "rename", game, mod }) },
    { label: t("Set character"), icon: "characters", onClick: () => askLib({ kind: "character", game, mods: list }) },
    { label: t("Tags"), icon: "tag", onClick: () => askLib({ kind: "tags", game, mods: list }) },
    { label: t("Favourite"), icon: "star", checked: allFav, onClick: () => void setFavourite(game, list, !allFav) },
    { label: t("Profiles"), icon: "profiles", items: profileItems(game, list) },
    !many && subModItem(game, mod),
    "-",
    !many && !mod.preview && mod.source && { label: t("Get preview from GameBanana"), icon: "image", onClick: () => void previewFromGb(game, mod) },
    !many && mod.customPreview && { label: t("Reset preview"), icon: "undo", title: t("Go back to the picture the mod came with"), onClick: () => void resetPreview(game, mod) },
    !many && { label: t("Open folder"), icon: "folder", onClick: () => openFolder(mod) },
    !many && mod.source && { label: t("Open on GameBanana"), icon: "external", onClick: () => openOnGb(mod) },
    due.length > 0 && { label: due.length === 1 ? t("Update") : t("Update ({n})", { n: due.length }), icon: "update",
      title: many && due.length === 1 ? t("Only {mod} has one", { mod: due[0]!.name }) : undefined, onClick: () => void getUpdates(game, due) },
    fromGb.length > 0 && { label: t("Check for updates"), icon: "refresh", onClick: () => void checkForUpdates(game, fromGb) },
    many && { label: t("Combine into one mod"), icon: "layers", title: t("One mod with each of these as a part you can turn on or off in its details. For mods that came in the same download"), onClick: () => void combineMods(game, list) },
    { label: t("Share as .gachamod"), icon: "share", title: t("A small file with GameBanana links and your settings, to send to a friend or another PC"), onClick: () => exportMods(game, list) },
    "-",
    trashDaysPref.get() > 0
      ? { label: t("Move to trash"), icon: "trash", danger: true, keys: "Del",
        title: many ? tn(trashDaysPref.get(), "The files stay on your PC for {n} day. Undo or Mods, Trash puts them back", "The files stay on your PC for {n} days. Undo or Mods, Trash puts them back")
          : tn(trashDaysPref.get(), "The files stay on your PC for {n} day. Undo or Mods, Trash puts it back", "The files stay on your PC for {n} days. Undo or Mods, Trash puts it back"),
        onClick: () => void trashMods(game, list) }
      : { label: t("Delete"), icon: "trash", danger: true, keys: "Del", title: t("The files are deleted right away. Mods from GameBanana can be downloaded again from Undo or Mods, Trash; others are asked about first"), onClick: () => void trashMods(game, list) },
  ];
});

// whether "<game>.oneSkin" keeps mods of one character on together ("0"), read when a character menu opens
const togetherOk = new Map<GameId, boolean>();
const readTogether = (game: GameId) => void settings.get(`${game}.oneSkin`).then((v) => togetherOk.set(game, v === "0"), () => {});

registerMenu("character", ({ game, name }) => {
  const same = (m: ModEntry) => m.character?.toLowerCase() === name.toLowerCase();
  const mods = (lastMods.get(game) ?? []).filter(same);
  const known = lastMods.has(game);
  const hidden = isCharHidden(game, name);
  readTogether(game);
  const forAll = async (on: boolean) => {
    const all = await library.list(game);
    await setOn(game, all.filter(same), on, all);
  };
  // wear one outfit: it goes on, the character's other outfits go off (sub-mods follow their parent)
  const wear = async (id: string) => {
    try {
      const all = await library.list(game);
      const mod = all.find((m) => m.id === id);
      if (!mod) return;
      const offs = all.filter((m) => same(m) && !m.parent && m.enabled && m.id !== id).map((m) => m.id);
      await changeStates(game, t("{name} wears {mod}", { name, mod: mod.name }), mod.enabled ? [] : [id], offs, all);
    } catch (e) { toast(errorText(e), true); }
  };
  const outfits = mods.filter((m) => !m.parent).sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name));
  return [
    { header: name },
    { label: t("Open page"), icon: "characters", onClick: () => go({ view: "characters", character: name }) },
    { label: t("Find mods online"), icon: "browse", onClick: () => go({ view: "characters", character: name, tab: "online" }) },
    "-",
    { label: t("Wear"), icon: "layers", disabled: known && !outfits.length, title: known && !outfits.length ? t("No mods for {name} yet", { name }) : t("Pick the mod {name} wears. The others turn off", { name }),
      items: outfits.slice(0, 40).map((m) => ({ label: m.name, checked: m.enabled, onClick: () => void wear(m.id) })) },
    togetherOk.get(game) && { label: t("Turn on all mods"), icon: "power", disabled: known && (!mods.length || mods.every((m) => m.enabled)), onClick: () => void forAll(true) },
    { label: t("Default outfit"), icon: "undo", disabled: known && !mods.some((m) => m.enabled), title: t("Turns off every mod for {name}", { name }), onClick: () => void forAll(false) },
    "-",
    { label: t("Owned"), keys: "O", checked: isOwned(game, name), title: t("Owned ones show under Owned on the {page} page", { page: charNoun(game) }), onClick: () => void toggleOwned(game, name) },
    { label: t("Set a picture"), icon: "image", title: t("A file, a link or one of {name}'s mod previews", { name }), onClick: () => askLib({ kind: "portrait", game, name }) },
    hidden
      ? { label: t("Show in the roster"), icon: "eye", onClick: () => setCharHidden(game, name, false) }
      : { label: t("Hide from the roster"), icon: "hide", onClick: () => setCharHidden(game, name, true) },
  ];
});

// ── global search ──

// The search asks on every key, so the mod list and the roster are kept, and loaded again after the library
// changes. The last list answers while the new one loads, since a scan can hold the library for seconds.
const KEEP = 60_000;
const keptLists: Array<{ stale(): void }> = [];
let watching = false;
function watchLibrary() {
  if (watching) return;
  watching = true;
  const stale = () => keptLists.forEach((k) => k.stale());
  held(library.onChanged(stale));
  onApp((e) => { if (e.type === "library-refresh") stale(); });
  onPublish(stale);
}
function kept<T>(load: (game: GameId) => Promise<T>) {
  let game: GameId | null = null, value: T | undefined, at = 0, loading: Promise<T> | null = null;
  const refresh = (g: GameId) => {
    const p = load(g);
    loading = p;
    p.then((v) => { if (loading === p) { value = v; at = Date.now(); loading = null; } }, () => { if (loading === p) loading = null; });
    return p;
  };
  const k = {
    get(g: GameId): Promise<T> {
      watchLibrary();
      if (g !== game) { game = g; value = undefined; at = 0; loading = null; }
      if (value === undefined) return loading ?? refresh(g);
      if (Date.now() - at > KEEP && !loading) refresh(g).catch(() => {});
      return Promise.resolve(value);
    },
    stale() { at = 0; loading = null; },
  };
  keptLists.push(k);
  return k;
}
const keptMods = kept((g) => library.list(g));
const keptRoster = kept(characterNames);
const modsFor = (game: GameId) => keptMods.get(game).catch(() => [] as ModEntry[]);

registerCommands("library.characters", async (query) => {
  const g = currentGame();
  if (!g) return [];
  // the search just opened: load them now so the first letters typed find them
  if (!query.trim()) { keptRoster.get(g.id).catch(() => {}); void modsFor(g.id); return []; }
  const one = charNoun(g.id, true), many = charNoun(g.id);
  const [names, mods] = await Promise.all([keptRoster.get(g.id).catch(() => []), modsFor(g.id)]);
  const count = new Map<string, number>();
  for (const m of mods) if (m.character) count.set(m.character.toLowerCase(), (count.get(m.character.toLowerCase()) ?? 0) + 1);
  const out: Command[] = [];
  for (const c of names) {
    const n = count.get(c.name.toLowerCase()) ?? 0;
    const img = portraitNow(g.id, c.name, c.icon);
    // the character page goes before "<name> mods online" even with no mods
    out.push({ id: `char:${g.id}:${c.name}`, title: c.name, section: "Characters", img, icon: "characters",
      keywords: `${one} ${many} character page skins outfits`, hint: n ? tn(n, "{n} mod", "{n} mods") : undefined, priority: n ? 4 : 1,
      run: () => go({ view: "characters", character: c.name }), menu: () => menuFor("character", { game: g.id, name: c.name }) });
    if (n) out.push({ id: `charmods:${g.id}:${c.name}`, title: t("{name}'s mods", { name: c.name }), section: "Mods", img, icon: "mods",
      keywords: `${one} installed mods skins my`, hint: `${n}`, where: t("Mods"), priority: 5, run: () => go({ view: "library", character: c.name }) });
  }
  return out;
});

registerCommands("library.mods", async (query) => {
  const g = currentGame();
  if (!g || !query.trim()) return [];
  const one = charNoun(g.id, true);
  const mods = await modsFor(g.id);
  // the best 60 matches, not the first 60 in folder order
  return mods
    .map((m): Command => ({
      id: `mod:${g.id}:${m.id}`, title: m.name, section: "Mods", icon: "mods",
      keywords: `${m.character ?? ""} ${one} installed mod ${m.tags.join(" ")} ${m.source?.submitter ?? ""}`,
      hint: m.enabled ? t("On") : t("Off"), where: `${t("Mods")} › ${m.character ?? t("No character")}`, run: () => go({ view: "library", modId: m.id }),
      menu: () => menuFor("mod", { game: g.id, mod: m }),
    }))
    .map((c) => ({ c, s: scoreCommand(query, c) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 60)
    .map((x) => x.c);
});
