// The right-click menus for an installed mod and for a character (the same everywhere they show), and the global
// search's characters and installed mods. Imported once by the Mods screen so they register at start.
// Owner: LIBRARY area.
import { library, type GameId, type ModEntry } from "../../lib/api";
import { trashPhrase } from "../settings/automatic";
import type { ModHealth } from "../../lib/fixes";
import { charNoun } from "../../lib/games";
import { portraitNow } from "../../lib/portraits";
import { registerCommands, scoreCommand, type Command } from "../../lib/search";
import { currentGame, go, onApp } from "../../lib/store";
import { held } from "../../lib/tauri";
import { registerMenu, type MenuEntry } from "../../ui/ContextMenu";
import { isOwned, toggleOwned } from "../characters/owned";
import { characterNames, isCharHidden, setCharHidden } from "../characters/roster";
import {
  cachedProfiles, checkForUpdates, combineMods, exportMods, fixForUpdate, getUpdate, keysOnlyOnScreen, onlyOnScreenFn, openDetails,
  openFolder, openOnGb, previewFromGb, resetPreview, setFavourite, setInProfile, setOn, setParent, trashMods, warmProfiles,
} from "./actions";
import { askLib } from "./LibDialogs";
import { overlappingAll } from "./overlap";
import { liveCharacterOf, liveShownInstead } from "../ingame/data";
import { onPublish } from "./data";

// what the mod screens saw last, so menus opened anywhere know a mod's health and a character's mods
const lastHealth = new Map<GameId, Map<string, ModHealth>>();
const lastMods = new Map<GameId, ModEntry[]>();
export function noteLibrary(game: GameId, mods: ModEntry[] | null, health?: Map<string, ModHealth>) {
  if (mods) lastMods.set(game, mods);
  if (health) lastHealth.set(game, health);
}
export const healthOf = (game: GameId, id: string) => lastHealth.get(game)?.get(id);

/** A hash swap fixes it, or a fixer gachamod gets and runs. */
const isBroken = (h: ModHealth | undefined) => h?.status === "broken" || (h?.status === "unfixable" && !!h.tool);

/** "Make sub-mod of" with the mods it could go with (the same character's first), or "Unlink" for a sub-mod. */
function subModItem(game: GameId, mod: ModEntry): MenuEntry {
  const all = lastMods.get(game) ?? [];
  if (mod.parent) {
    const p = all.find((m) => m.id === mod.parent);
    return { label: p ? `Unlink from ${p.name}` : "Unlink from its mod", icon: "link",
      title: "Make it a mod of its own again, so turning it on asks about the character's other mods", onClick: () => void setParent(game, mod, "", all) };
  }
  if (all.some((m) => m.parent === mod.id)) return { label: "Make sub-mod of", icon: "link", disabled: true, title: "It has sub-mods of its own" };
  const same = (m: ModEntry) => !!mod.character && m.character?.toLowerCase() === mod.character.toLowerCase();
  const picks = all.filter((m) => m.id !== mod.id && !m.parent)
    .sort((a, b) => Number(same(b)) - Number(same(a)) || Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name))
    .slice(0, 40);
  return {
    label: "Make sub-mod of", icon: "link",
    title: "For an add-on that goes with another mod, like a hair recolour for one outfit. It turns off with that mod, comes back with it, and never counts as another skin",
    items: picks.map((m) => ({ label: m.name, title: `${m.character ?? "No character"}${m.enabled ? ", on" : ", off"}`, onClick: () => void setParent(game, mod, m.id, all) })),
  };
}

export function profileItems(game: GameId, list: ModEntry[]): MenuEntry[] {
  const c = cachedProfiles(game);
  if (!c) return [{ label: "Loading profiles", disabled: true }];
  return c.list.map((p) => {
    const inIt = (m: ModEntry) => (p.active ? m.enabled : c.members.get(p.id)?.has(m.id) ?? false);
    const all = list.every(inIt);
    return {
      label: p.name, checked: all, title: all ? `Take ${list.length === 1 ? "it" : "them"} out of ${p.name}` : `Add ${list.length === 1 ? "it" : "them"} to ${p.name}${p.active ? " (turns them on, it's the profile in use)" : ""}`,
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
  const onScreen = onlyOnScreenFn();
  const reasons = broken.flatMap((m) => healthOf(game, m.id)?.reasons ?? []);
  // turning on next to the character's other mods that are on (live skins switch instead, one at a time)
  const going = list.filter((m) => !m.enabled && !liveCharacterOf(game, m.id));
  const beside = !allOn && going.length ? overlappingAll(going, lastMods.get(game) ?? []).filter((o) => !liveCharacterOf(game, o.id)) : [];
  const shownInstead = liveShownInstead(game, mod.id);
  return [
    many && { header: `${list.length} mods selected` },
    { label: allOn ? "Turn off" : "Turn on", icon: "power", keys: "Space", onClick: () => void setOn(game, list, !allOn) },
    !many && !mod.enabled && !!shownInstead && { label: `Show next to ${shownInstead}`, icon: "layers", keys: "Shift+Space",
      title: `Turns it on next to ${shownInstead} instead of replacing it. It stops switching in game, and the game shows it after it reloads its mods`,
      onClick: () => void setOn(game, list, true, lastMods.get(game), undefined, true) },
    beside.length > 0 && { label: "Turn on with others", icon: "layers", keys: "Shift+Space",
      title: `Turns ${many ? "them" : "it"} on and keeps ${beside.length === 1 ? beside[0]!.name : `the ${beside.length} other mods`} on too, for mods that go together like a hair recolour and an outfit. Shift+click on a switch does the same`,
      onClick: () => void setOn(game, list, true, lastMods.get(game), undefined, true) },
    !many && { label: "Details", icon: "info", keys: "Enter", onClick: () => openDetails(mod) },
    !many && (mod.parts ?? 0) > 0 && { label: "Parts", icon: "layers", title: "Folders inside it that turn on and off by themselves", onClick: () => openDetails(mod, "parts") },
    !many && mod.hasKeys && { label: "Toggles", icon: "key", title: "Its toggles, to change their keys or turn them off", onClick: () => openDetails(mod, "keys") },
    !many && mod.conflicts > 0 && { label: "Conflicts", icon: "warn", title: "Mods that change the same parts as this one, to pick which one wins", onClick: () => openDetails(mod, "conflicts") },
    !many && mod.iniCount > 0 && { label: "View in 3D", icon: "box", title: "Turn the mod's model around, as its toggles are set now", onClick: () => openDetails(mod, "model") },
    broken.length > 0 && { label: "Attempt fix for the game update", icon: "wand", title: reasons.slice(0, 3).join(". ") || "A game update broke it. Swaps its outdated hashes, or runs the fixer it needs", onClick: () => void fixForUpdate(game, broken) },
    onScreen && mod.hasKeys && { label: "Toggles only while on screen", icon: "keyboard", title: "Its toggles only work while its character is on screen, so they stop taking keys meant for other mods", onClick: () => void keysOnlyOnScreen(game, list) },
    "-",
    !many && { label: "Rename", icon: "edit", keys: "F2", onClick: () => askLib({ kind: "rename", game, mod }) },
    { label: "Set character", icon: "characters", onClick: () => askLib({ kind: "character", game, mods: list }) },
    { label: "Tags", icon: "tag", onClick: () => askLib({ kind: "tags", game, mods: list }) },
    { label: "Favourite", icon: "star", checked: allFav, onClick: () => void setFavourite(game, list, !allFav) },
    { label: "Profiles", icon: "profiles", items: profileItems(game, list) },
    !many && subModItem(game, mod),
    "-",
    !many && !mod.preview && mod.source && { label: "Get preview from GameBanana", icon: "image", onClick: () => void previewFromGb(game, mod) },
    !many && mod.customPreview && { label: "Reset preview", icon: "undo", title: "Go back to the picture the mod came with", onClick: () => void resetPreview(game, mod) },
    !many && { label: "Open folder", icon: "folder", onClick: () => openFolder(mod) },
    !many && mod.source && { label: "Open on GameBanana", icon: "external", onClick: () => openOnGb(mod) },
    !many && mod.updateAvailable && mod.source && { label: "Get the update", icon: "update", onClick: () => void getUpdate(game, mod) },
    fromGb.length > 0 && { label: "Check for update", icon: "refresh", onClick: () => void checkForUpdates(game, fromGb) },
    many && { label: "Combine into one mod", icon: "layers", title: "One mod with each of these as a part you can turn on or off in its details. For mods that came in the same download", onClick: () => void combineMods(game, list) },
    { label: "Share as .gachamod", icon: "share", title: "A small file with GameBanana links and your settings, to send to a friend or another PC", onClick: () => exportMods(game, list) },
    "-",
    { label: "Move to trash", icon: "trash", danger: true, keys: "Del", title: `The files ${trashPhrase()}. A short record stays in Mods, Trash so you can download it again`, onClick: () => void trashMods(game, list) },
  ];
});

registerMenu("character", ({ game, name }) => {
  const mods = (lastMods.get(game) ?? []).filter((m) => m.character?.toLowerCase() === name.toLowerCase());
  const known = lastMods.has(game);
  const hidden = isCharHidden(game, name);
  const forAll = async (on: boolean) => {
    const all = await library.list(game);
    await setOn(game, all.filter((m) => m.character?.toLowerCase() === name.toLowerCase()), on, all);
  };
  return [
    { header: name },
    { label: "Open page", icon: "characters", onClick: () => go({ view: "characters", character: name }) },
    { label: "Find mods online", icon: "browse", onClick: () => go({ view: "characters", character: name, tab: "online" }) },
    "-",
    { label: "Turn on all mods", icon: "power", disabled: known && (!mods.length || mods.every((m) => m.enabled)),
      title: "With one skin per character on, only the last one stays on", onClick: () => void forAll(true) },
    { label: "Turn off all mods", icon: "power", disabled: known && !mods.some((m) => m.enabled), onClick: () => void forAll(false) },
    "-",
    { label: "Owned", keys: "O", checked: isOwned(game, name), title: "Owned ones show under Owned on the Characters page", onClick: () => void toggleOwned(game, name) },
    { label: "Set a picture", icon: "image", title: `A file, a link or one of ${name}'s mod previews`, onClick: () => askLib({ kind: "portrait", game, name }) },
    hidden
      ? { label: "Show in the roster", icon: "eye", onClick: () => setCharHidden(game, name, false) }
      : { label: "Hide from the roster", icon: "hide", onClick: () => setCharHidden(game, name, true) },
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
    out.push({ id: `char:${g.id}:${c.name}`, title: c.name, section: many, img, icon: "characters",
      keywords: `${one} ${many} character page skins outfits`, hint: n ? `${n} ${n === 1 ? "mod" : "mods"}` : undefined, priority: n ? 4 : 1,
      run: () => go({ view: "characters", character: c.name }) });
    if (n) out.push({ id: `charmods:${g.id}:${c.name}`, title: `${c.name}'s mods`, section: "Mods", img, icon: "mods",
      keywords: `${one} installed mods skins my`, hint: `${n}`, where: "Mods", priority: 5, run: () => go({ view: "library", character: c.name }) });
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
      hint: m.enabled ? "On" : "Off", where: `Mods › ${m.character ?? "No character"}`, run: () => go({ view: "library", modId: m.id }),
    }))
    .map((c) => ({ c, s: scoreCommand(query, c) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 60)
    .map((x) => x.c);
});
