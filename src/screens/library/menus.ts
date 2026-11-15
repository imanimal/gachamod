// The right-click menus for an installed mod and for a character (the same everywhere they show), and the global
// search's characters and installed mods. Imported once by the Mods screen so they register at start.
// Owner: LIBRARY area.
import { library, type GameId, type ModEntry } from "../../lib/api";
import { trashPhrase } from "../settings/automatic";
import type { ModHealth } from "../../lib/fixes";
import { charNoun } from "../../lib/games";
import { portraitNow } from "../../lib/portraits";
import { registerCommands, type Command } from "../../lib/search";
import { currentGame, go } from "../../lib/store";
import { registerMenu, type MenuEntry } from "../../ui/ContextMenu";
import { isOwned, toggleOwned } from "../characters/owned";
import { characterNames, isCharHidden, setCharHidden } from "../characters/roster";
import {
  cachedProfiles, checkForUpdates, combineMods, exportMods, fixForUpdate, getUpdate, keysOnlyOnScreen, onlyOnScreenFn, openDetails,
  openFolder, openOnGb, previewFromGb, resetPreview, setFavourite, setInProfile, setOn, setParent, trashMods, warmProfiles,
} from "./actions";
import { askLib } from "./LibDialogs";
import { fixerInApp, openFixer } from "../browse/state";

// what the mod screens saw last, so menus opened anywhere know a mod's health and a character's mods
const lastHealth = new Map<GameId, Map<string, ModHealth>>();
const lastMods = new Map<GameId, ModEntry[]>();
export function noteLibrary(game: GameId, mods: ModEntry[] | null, health?: Map<string, ModHealth>) {
  if (mods) lastMods.set(game, mods);
  if (health) lastHealth.set(game, health);
}
export const healthOf = (game: GameId, id: string) => lastHealth.get(game)?.get(id);

const isBroken = (h: ModHealth | undefined) => h?.status === "broken";

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
  return [
    many && { header: `${list.length} mods selected` },
    { label: allOn ? "Turn off" : "Turn on", icon: "power", keys: "Space", onClick: () => void setOn(game, list, !allOn) },
    !many && { label: "Details", icon: "info", keys: "Enter", onClick: () => openDetails(mod) },
    !many && (mod.parts ?? 0) > 0 && { label: "Parts", icon: "layers", title: "Folders inside it that turn on and off by themselves", onClick: () => openDetails(mod, "parts") },
    !many && mod.hasKeys && { label: "Toggles", icon: "key", title: "Its toggles, to change their keys or turn them off", onClick: () => openDetails(mod, "keys") },
    !many && mod.conflicts > 0 && { label: "Conflicts", icon: "warn", title: "Mods that change the same parts as this one, to pick which one wins", onClick: () => openDetails(mod, "conflicts") },
    !many && mod.iniCount > 0 && { label: "View in 3D", icon: "box", title: "Turn the mod's model around, as its toggles are set now", onClick: () => openDetails(mod, "model") },
    broken.length > 0 && { label: "Fix for the game update", icon: "wand", title: reasons.slice(0, 3).join(". ") || "A game update broke it and a fix is known", onClick: () => void fixForUpdate(game, broken) },
    !many && healthOf(game, mod.id)?.tool && { label: `Get ${healthOf(game, mod.id)!.tool!.name}`, icon: fixerInApp(healthOf(game, mod.id)!.tool!) ? "downloads" : "external", title: `${healthOf(game, mod.id)!.reasons[0] ?? "A game update broke it"}. Opens the fixer's page`, onClick: () => openFixer(healthOf(game, mod.id)!.tool!) },
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

let modsCache: { game: GameId; at: number; list: ModEntry[] } | null = null;
async function modsFor(game: GameId) {
  if (modsCache?.game === game && Date.now() - modsCache.at < 5000) return modsCache.list;
  const list = await library.list(game);
  modsCache = { game, at: Date.now(), list };
  return list;
}

registerCommands("library.characters", async (query) => {
  const g = currentGame();
  if (!g || !query.trim()) return [];
  const one = charNoun(g.id, true), many = charNoun(g.id);
  const [names, mods] = await Promise.all([characterNames(g.id), modsFor(g.id).catch(() => [] as ModEntry[])]);
  const count = new Map<string, number>();
  for (const m of mods) if (m.character) count.set(m.character.toLowerCase(), (count.get(m.character.toLowerCase()) ?? 0) + 1);
  const out: Command[] = [];
  for (const c of names) {
    const n = count.get(c.name.toLowerCase()) ?? 0;
    const img = portraitNow(g.id, c.name, c.icon);
    out.push({ id: `char:${g.id}:${c.name}`, title: c.name, section: many, img, icon: "characters",
      keywords: `${one} ${many} character page skins outfits`, hint: n ? `${n} ${n === 1 ? "mod" : "mods"}` : undefined, priority: n ? 4 : 0,
      run: () => go({ view: "characters", character: c.name }) });
    if (n) out.push({ id: `charmods:${g.id}:${c.name}`, title: `${c.name}'s mods`, section: "Mods", img, icon: "mods",
      keywords: `${one} installed mods skins my`, hint: `${n}`, priority: 5, run: () => go({ view: "library", character: c.name }) });
  }
  return out;
});

registerCommands("library.mods", async (query) => {
  const g = currentGame();
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!g || !words.length) return [];
  const one = charNoun(g.id, true);
  const mods = await modsFor(g.id).catch(() => [] as ModEntry[]);
  return mods
    .filter((m) => { const hay = `${m.name} ${m.character ?? ""} ${m.tags.join(" ")} ${m.source?.submitter ?? ""}`.toLowerCase(); return words.some((w) => hay.includes(w.slice(0, 3))); })
    .slice(0, 60)
    .map((m) => ({
      id: `mod:${g.id}:${m.id}`, title: m.name, section: "Mods", icon: "mods" as const,
      keywords: `${m.character ?? ""} ${one} installed mod ${m.tags.join(" ")} ${m.source?.submitter ?? ""}`,
      hint: m.enabled ? "On" : "Off", run: () => go({ view: "library", modId: m.id }),
    }));
});
