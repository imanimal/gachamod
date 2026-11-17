// The shell's own palette commands (pages, everyday actions, games) and the right-click menu for a game. Other areas
// register their own (characters, mods, profiles, creators, settings). `keywords` hold the words people use for a
// thing, so "installed" finds Mods and "nsfw" finds the adult content switch. Owner: SHELL area.
import { appUpdate, errorText, games as gamesApi, library, shell, type GameId, type GameState } from "../lib/api";
import { checkUpdates } from "../lib/gamebanana";
import { charNoun } from "../lib/games";
import { record, redo, undo } from "../lib/history";
import { nsfwPref, setNsfw, type NsfwMode } from "../lib/prefs";
import { allGames, back, currentGame, emitApp, forward, go, onlyGame, setBadge, setGame, setGames, setOnlyGame, type Route } from "../lib/store";
import { registerCommands, type Command } from "../lib/search";
import { openKofi } from "../lib/support";
import { registerMenu, type MenuEntry } from "../ui/ContextMenu";
import { toast } from "../ui/toast";
import { play } from "../screens/home/PlayButton";
import { refreshGameIcon } from "../ui/GameBadge";
import { sideCollapsed, toggleHelp, toggleSide } from "./state";
import { openActivity } from "./Activity";
import { shuffleOutfits } from "../screens/library/shuffle";

// ── actions shared by the palette, the game menu and the sidebar ──

export async function rescan(game: GameState) {
  try {
    const l = await library.scan(game.id);
    emitApp({ type: "library-refresh", game: game.id });
    toast(`Found ${l.length === 1 ? "1 mod" : `${l.length} mods`} in ${game.name}`);
  } catch (e) { toast(errorText(e), true); return; }
  // a rescan asked for by hand also looks for updates
  await checkModUpdates(game, true);
}

export async function checkModUpdates(game: GameState, quiet = false) {
  if (!quiet) toast(`Checking ${game.name}'s mods for updates`);
  try {
    const ids = await checkUpdates(await library.list(game.id));
    await library.markUpdates(game.id, ids);
    setBadge("library", ids.length ? { count: ids.length, tone: "accent" } : null);
    emitApp({ type: "library-refresh", game: game.id });
    toast(ids.length ? `${ids.length === 1 ? "1 mod has" : `${ids.length} mods have`} an update` : "Every mod is up to date",
      false, ids.length ? { label: "Show", run: () => go("library") } : undefined);
  } catch (e) { toast(errorText(e), true); }
}

async function checkAppUpdate() {
  try {
    const c = await appUpdate.check();
    if (!c.reachable) toast("Couldn't get update info right now. Try again later");
    else if (!c.available) toast(`gachamod ${c.current} is the newest version`);
    else toast("A new version of gachamod is out", false, { label: "See it", run: () => go({ view: "settings", section: "updates" }) });
  } catch (e) { toast(errorText(e), true); }
}

export function openModsFolder(game: GameState) {
  if (!game.modsDir) { toast(`${game.name} has no Mods folder yet`); return; }
  shell.openPath(game.modsDir).catch((e) => toast(errorText(e), true));
}

/** Turn one-game mode on for a game, or off (null), with Undo. */
export function focusGame(id: GameId | null) {
  const before = onlyGame()?.id ?? null;
  if (before === id) return;
  const g = id ? allGames().find((x) => x.id === id) : null;
  setOnlyGame(id);
  if (id) setGame(id);
  // one toast that says what changed and carries Undo (the history list keeps the short label)
  const e = record({ label: g ? `Showed only ${g.short}` : "Showed all games again", undo: async () => setOnlyGame(before), redo: async () => setOnlyGame(id) }, true);
  toast(g ? `Only ${g.name} shows now. Search still finds your other games` : "All your games show again", false, { label: "Undo", run: () => void undo(e) });
}

/** Hide a game from the sidebar (with Undo). Its mods and settings stay. */
export async function hideGame(id: GameId) {
  const g = allGames().find((x) => x.id === id);
  if (!g) return;
  const set = async (shown: boolean) => { setGames(await gamesApi.setShown(id, shown)); };
  try {
    await set(false);
    record({ label: `Hid ${g.name}`, undo: () => set(true), redo: () => set(false) });
  } catch (e) { toast(errorText(e), true); }
}

// ── the game menu ──

registerMenu("game", ({ id }) => {
  const g = allGames().find((x) => x.id === id);
  if (!g) return [];
  const cur = currentGame()?.id === id;
  const shownCount = allGames().filter((x) => x.shown).length;
  const items: MenuEntry[] = [
    { header: g.name },
    !cur && { label: `Switch to ${g.short}`, icon: "swap", onClick: () => setGame(id) },
    { label: g.running ? "Running" : "Play", icon: "play", disabled: g.running || (!g.viaXxmi && !g.gameDir), onClick: () => void play(g) },
    { label: "Play without mods", icon: "play", title: "Starts the game with no mods, the way the developers intended. Brave", disabled: g.running || !g.gameDir, onClick: () => void play(g, true) },
    "-",
    { label: "Open Mods folder", icon: "folder", disabled: !g.modsDir, title: g.modsDir ?? undefined, onClick: () => openModsFolder(g) },
    { label: "Rescan mods", icon: "refresh", title: "Reads the Mods folder again, then checks every mod for updates on GameBanana", disabled: !g.modsDir, onClick: () => void rescan(g) },
    { label: "Game settings", icon: "settings", onClick: () => { setGame(id); go({ view: "settings", section: "games" }); } },
    { label: "Reload the icon", icon: "image", title: "After setting the game folder, the icon comes from the game itself", onClick: () => refreshGameIcon(id) },
    "-",
    shownCount > 1 && { label: `Only show ${g.short}`, icon: "focus", checked: onlyGame()?.id === id,
      title: "One-game mode: the sidebar and menus offer only this game. The others stay set up and search still finds them",
      onClick: () => focusGame(onlyGame()?.id === id ? null : id) },
    { label: "Hide game", icon: "hide", disabled: shownCount <= 1, title: shownCount <= 1 ? "It's the only game shown" : "Hidden games come back from Settings, Games and mod loaders", onClick: () => void hideGame(id) },
  ];
  return items;
});

// ── palette commands ──

const PAGES: Array<{ route: Route; title: (g: GameId | null) => string; keywords: string; icon: Command["icon"]; hint?: string; where?: string }> = [
  { route: { view: "home" }, title: () => "Home", keywords: "start main dashboard overview front", icon: "home", hint: "Ctrl+1" },
  { route: { view: "library" }, title: () => "My Mods", keywords: "library installed my mods list manage enable disable toggle", icon: "mods", hint: "Ctrl+3" },
  { route: { view: "characters" }, title: (g) => charNoun(g), keywords: "characters agents resonators roster heroes cast skins", icon: "characters", hint: "Ctrl+4" },
  { route: { view: "browse" }, title: () => "Browse GameBanana", keywords: "browse gamebanana online find new mods download discover store shop", icon: "browse", hint: "Ctrl+2" },
  { route: { view: "downloads" }, title: () => "Downloads", keywords: "queue downloading progress installs transfers", icon: "downloads", hint: "Ctrl+5" },
  { route: { view: "profiles" }, title: () => "Profiles", keywords: "presets loadouts sets outfits teams switch save", icon: "profiles", hint: "Ctrl+6" },
  { route: { view: "tools" }, title: () => "Tools", keywords: "utilities fixes conflicts share shader cache logs dev", icon: "tools", hint: "Ctrl+7" },
  { route: { view: "settings" }, title: () => "Settings", keywords: "options preferences config configuration setup", icon: "settings", hint: "Ctrl+8" },
  { route: { view: "library", tab: "archive" }, title: () => "Trash", keywords: "removed deleted trash bin recycle restore redownload archive history", icon: "trash", where: "Mods › Trash" },
  { route: { view: "settings", section: "games" }, title: () => "Game folders", keywords: "paths folders setup add game xxmi location directory", icon: "folder", where: "Settings › Games and mod loaders" },
  { route: { view: "settings", section: "appearance" }, title: () => "Appearance", keywords: "theme dark light mode colours colors accent look skin", icon: "palette", where: "Settings › Appearance" },
  { route: { view: "settings", section: "launch" }, title: () => "Launch options", keywords: "start arguments args priority window mode exe xxmi", icon: "sliders", where: "Settings › Launch options" },
];

registerCommands("shell.pages", () => {
  const gid = currentGame()?.id ?? null;
  return PAGES.map((p, i) => ({
    id: `page:${p.route.view}${p.route.section ? `:${p.route.section}` : ""}${p.route.tab ? `:${p.route.tab}` : ""}`,
    title: p.title(gid), section: "Pages", icon: p.icon, keywords: p.keywords, hint: p.hint, where: p.where, priority: 8 - i / 2, run: () => go(p.route),
  }));
});

const NSFW: Array<[NsfwMode, string, string]> = [
  ["hide", "Hide mods for adults", "nsfw 18+ adult lewd explicit hide filter safe sfw"],
  ["blur", "Blur mods for adults", "nsfw 18+ adult lewd explicit blur censor"],
  ["show", "Show mods for adults", "nsfw 18+ adult lewd explicit show uncensor unblur"],
];

registerCommands("shell.actions", () => {
  const g = currentGame();
  const nsfw = nsfwPref.get();
  const list: Command[] = [
    { id: "act:undo", title: "Undo", section: "Actions", icon: "undo", keywords: "revert go back mistake oops", hint: "Ctrl+Z", run: () => void undo() },
    { id: "act:redo", title: "Redo", section: "Actions", icon: "redo", keywords: "again repeat", hint: "Ctrl+Y", run: () => void redo() },
    { id: "act:back", title: "Back", section: "Actions", icon: "left", keywords: "previous page return", hint: "Alt+Left", run: () => back() },
    { id: "act:forward", title: "Forward", section: "Actions", icon: "right", keywords: "next page", hint: "Alt+Right", run: () => forward() },
    { id: "act:sidebar", title: sideCollapsed() ? "Expand the sidebar" : "Collapse the sidebar", section: "Actions", icon: "sidebar", keywords: "sidebar minimise minimize collapse expand hide menu rail compact", hint: "Ctrl+B", run: toggleSide },
    { id: "act:shortcuts", title: "Keyboard shortcuts", section: "Actions", icon: "keyboard", keywords: "keys hotkeys help controller gamepad bindings", hint: "?", run: toggleHelp },
    { id: "act:activity", title: "Show what's running", section: "Actions", icon: "clock", keywords: "loading waiting stuck hung frozen slow busy spinner progress background tasks", run: openActivity },
    { id: "act:appupdate", title: "Check for gachamod updates", section: "Actions", icon: "update", keywords: "app update new version upgrade", run: () => void checkAppUpdate() },
    { id: "act:kofi", title: "Tip on Ko-fi", section: "Actions", icon: "coffee", keywords: "kofi ko-fi tip donate support coffee money thanks developer", run: openKofi },
    ...NSFW.map(([v, title, keywords]) => ({ id: `act:nsfw:${v}`, title, section: "Actions", icon: (v === "show" ? "eye" : "hide") as Command["icon"], keywords,
      hint: nsfw === v ? "On now" : undefined, run: () => setNsfw(v) })),
  ];
  if (g) {
    list.push(
      { id: "act:play", title: `Play ${g.name}`, section: "Actions", icon: "play", keywords: "start launch run game", hint: "Ctrl+Enter", priority: 6, run: () => void play(g) },
      { id: "act:vanilla", title: "Play without mods", section: "Actions", icon: "play", keywords: "vanilla clean start launch no mods", run: () => void play(g, true) },
      { id: "act:shuffle", title: "Shuffle outfits", section: "Actions", icon: "dice", keywords: "random randomize randomise outfits skins surprise mix", run: () => void shuffleOutfits(g.id).catch((e) => toast(String(e), true)) },
      { id: "act:rescan", title: "Rescan mods", section: "Actions", icon: "refresh", keywords: "refresh reload scan look again find new check updates force", run: () => void rescan(g) },
      { id: "act:updates", title: "Check mods for updates", section: "Actions", icon: "update", keywords: "update outdated new version gamebanana", run: () => void checkModUpdates(g) },
      { id: "act:folder", title: "Open the Mods folder", section: "Actions", icon: "folder", keywords: "explorer files directory location show in folder", run: () => openModsFolder(g) },
    );
  }
  return list;
});

registerCommands("shell.games", () => allGames().filter((g) => g.shown).map((g) => ({
  id: `game:${g.id}`, title: g.name, section: "Games", icon: "controller" as const, keywords: `${g.short} ${g.id} ${g.importer} game switch`,
  hint: currentGame()?.id === g.id ? "Current" : undefined, run: () => setGame(g.id),
})));
