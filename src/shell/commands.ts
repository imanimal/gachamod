// The shell's own palette commands (pages, everyday actions, games) and the right-click menu for a game. Other areas
// register their own (characters, mods, profiles, creators, settings). `keywords` hold the words people use for a
// thing, so "installed" finds Mods and "nsfw" finds the adult content switch. Owner: SHELL area.
import { errorText, games as gamesApi, library, shell, type GameId, type GameState } from "../lib/api";
import { checkUpdates } from "../lib/gamebanana";
import { charNoun, gameName, gameShort } from "../lib/games";
import { english, t, tn } from "../lib/i18n";
import { record, redo, undo } from "../lib/history";
import { nsfwPref, setNsfw, type NsfwMode } from "../lib/prefs";
import { allGames, back, currentGame, emitApp, forward, go, onlyGame, setGame, setGames, setOnlyGame, type Route } from "../lib/store";
import { registerCommands, type Command } from "../lib/search";
import { openKofi } from "../lib/support";
import { registerMenu, type MenuEntry } from "../ui/ContextMenu";
import { retoast, toast, type ToastAction } from "../ui/toast";
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
    toast(tn(l.length, "Found {n} mod", "Found {n} mods"));
  } catch (e) { toast(errorText(e), true); return; }
  // a rescan asked for by hand also looks for updates
  await checkModUpdates(game, true);
}

export async function checkModUpdates(game: GameState, quiet = false) {
  // one toast that turns into the result
  const id = quiet ? null : toast(t("Checking for mod updates"));
  const say = (text: string, action?: ToastAction, bad = false) => { if (id === null || !retoast(id, text, action, bad)) toast(text, bad, action); };
  try {
    const ids = await checkUpdates(await library.list(game.id));
    await library.markUpdates(game.id, ids);
    emitApp({ type: "library-refresh", game: game.id });
    say(ids.length ? tn(ids.length, "{n} mod has an update", "{n} mods have an update") : t("Every mod is up to date"),
      ids.length ? { label: t("View updates"), run: () => { setGame(game.id); go({ view: "library", flag: "updates" }); } } : undefined);
  } catch (e) { say(errorText(e), undefined, true); }
}

export function openModsFolder(game: GameState) {
  if (!game.modsDir) { toast(t("This game has no Mods folder yet")); return; }
  shell.openPath(game.modsDir).catch((e) => toast(errorText(e), true));
}

/** Turn one-game mode on for a game, or off (null), with Undo. `say`: a toast with Undo when it hides the other games,
 *  for the game menu, which closes (Settings' picker shows the choice, so it stays quiet). Showing them all again is
 *  quiet everywhere: they come back in the sidebar. */
export function focusGame(id: GameId | null, say = false) {
  const before = onlyGame()?.id ?? null;
  if (before === id) return;
  const g = id ? allGames().find((x) => x.id === id) : null;
  setOnlyGame(id);
  if (id) setGame(id);
  record({ label: g ? t("Showed only {game}", { game: gameShort(g) }) : t("Showed all games again"), brief: g ? t("Showed only this game") : undefined,
    undo: async () => setOnlyGame(before), redo: async () => setOnlyGame(id) }, !(g && say));
}

/** Hide a game from the sidebar (with Undo). Its mods and settings stay. */
export async function hideGame(id: GameId) {
  const g = allGames().find((x) => x.id === id);
  if (!g) return;
  const set = async (shown: boolean) => { setGames(await gamesApi.setShown(id, shown)); };
  try {
    await set(false);
    record({ label: t("Hid {game}", { game: gameName(g) }), brief: t("Hid the game"), undo: () => set(true), redo: () => set(false) });
  } catch (e) { toast(errorText(e), true); }
}

// ── the game menu ──

registerMenu("game", ({ id }) => {
  const g = allGames().find((x) => x.id === id);
  if (!g) return [];
  const cur = currentGame()?.id === id;
  const shownCount = allGames().filter((x) => x.shown).length;
  const items: MenuEntry[] = [
    { header: gameName(g) },
    !cur && { label: t("Switch to {game}", { game: gameShort(g) }), icon: "swap", onClick: () => setGame(id) },
    { label: g.running ? t("Running") : t("Play"), icon: "play", disabled: g.running || (!g.viaXxmi && !g.gameDir), onClick: () => void play(g) },
    { label: t("Play without mods"), icon: "play", title: t("Starts the game with no mods"), disabled: g.running || !g.gameDir, onClick: () => void play(g, true) },
    "-",
    { label: t("Open Mods folder"), icon: "folder", disabled: !g.modsDir, title: g.modsDir ?? undefined, onClick: () => openModsFolder(g) },
    { label: t("Rescan mods"), icon: "refresh", title: t("Reads the Mods folder again, then checks every mod for updates on GameBanana"), disabled: !g.modsDir, onClick: () => void rescan(g) },
    { label: t("Game settings"), icon: "settings", onClick: () => { setGame(id); go({ view: "settings", section: "games" }); } },
    { label: t("Reload the icon"), icon: "image", title: t("After setting the game folder, the icon comes from the game itself"), onClick: () => refreshGameIcon(id) },
    "-",
    shownCount > 1 && { label: t("Only show {game}", { game: gameShort(g) }), icon: "focus", checked: onlyGame()?.id === id,
      title: t("One-game mode: the sidebar and menus offer only this game. The others stay set up and search still finds them"),
      onClick: () => focusGame(onlyGame()?.id === id ? null : id, true) },
    { label: t("Hide game"), icon: "hide", disabled: shownCount <= 1, title: shownCount <= 1 ? t("It's the only game shown") : t("Hidden games come back from Settings, Games"), onClick: () => void hideGame(id) },
  ];
  return items;
});

// ── palette commands ──

// Titles show in the user's language; the search also finds a command by its English title
const findable = (title: string, keywords: string) => (english(title) === title ? keywords : `${english(title)} ${keywords}`);

const PAGES: Array<{ route: Route; title: (g: GameId | null) => string; keywords: string; icon: Command["icon"]; hint?: string; where?: string }> = [
  { route: { view: "home" }, title: () => t("Home"), keywords: "start main dashboard overview front", icon: "home", hint: "Ctrl+1" },
  { route: { view: "library" }, title: () => t("Mods"), keywords: "library installed my mods list manage enable disable toggle", icon: "mods", hint: "Ctrl+3" },
  { route: { view: "characters" }, title: (g) => charNoun(g), keywords: "characters agents resonators roster heroes cast skins", icon: "characters", hint: "Ctrl+4" },
  { route: { view: "browse" }, title: () => t("Browse GameBanana"), keywords: "browse gamebanana online find new mods download discover store shop", icon: "browse", hint: "Ctrl+2" },
  { route: { view: "downloads" }, title: () => t("Downloads"), keywords: "queue downloading progress installs transfers", icon: "downloads", hint: "Ctrl+5" },
  { route: { view: "profiles" }, title: () => t("Profiles"), keywords: "presets loadouts sets outfits teams switch save", icon: "profiles", hint: "Ctrl+6" },
  { route: { view: "tools" }, title: () => t("Tools"), keywords: "utilities fixes conflicts share shader cache logs dev", icon: "tools", hint: "Ctrl+7" },
  { route: { view: "settings" }, title: () => t("Settings"), keywords: "options preferences config configuration setup", icon: "settings", hint: "Ctrl+8" },
  { route: { view: "library", tab: "archive" }, title: () => t("Trash"), keywords: "removed deleted trash bin recycle restore redownload archive history", icon: "trash", where: t("Mods › Trash") },
  { route: { view: "settings", section: "games" }, title: () => t("Game folders"), keywords: "paths folders setup add game xxmi location directory", icon: "folder", where: t("Settings › Games") },
  { route: { view: "settings", section: "appearance" }, title: () => t("Appearance"), keywords: "theme dark light mode colours colors accent look skin", icon: "palette", where: t("Settings › Appearance") },
  { route: { view: "settings", section: "launch" }, title: () => t("Launch options"), keywords: "start arguments args priority window mode exe xxmi", icon: "sliders", where: t("Settings › Launch options") },
];

registerCommands("shell.pages", () => {
  const gid = currentGame()?.id ?? null;
  return PAGES.map((p, i) => ({
    id: `page:${p.route.view}${p.route.section ? `:${p.route.section}` : ""}${p.route.tab ? `:${p.route.tab}` : ""}`,
    title: p.title(gid), section: "Pages", icon: p.icon, keywords: findable(p.title(gid), p.keywords), hint: p.hint, where: p.where, priority: 8 - i / 2, run: () => go(p.route),
  }));
});

const NSFW: Array<[NsfwMode, string, string]> = [
  ["hide", t("Hide mods for adults"), "nsfw 18+ adult lewd explicit hide filter safe sfw"],
  ["blur", t("Blur mods for adults"), "nsfw 18+ adult lewd explicit blur censor"],
  ["show", t("Show mods for adults"), "nsfw 18+ adult lewd explicit show uncensor unblur"],
];

registerCommands("shell.actions", () => {
  const g = currentGame();
  const nsfw = nsfwPref.get();
  const list: Command[] = [
    { id: "act:undo", title: t("Undo"), section: "Actions", icon: "undo", keywords: "revert go back mistake oops", hint: "Ctrl+Z", run: () => void undo() },
    { id: "act:redo", title: t("Redo"), section: "Actions", icon: "redo", keywords: "again repeat", hint: "Ctrl+Y", run: () => void redo() },
    { id: "act:back", title: t("Back"), section: "Actions", icon: "left", keywords: "previous page return", hint: "Alt+Left", run: () => back() },
    { id: "act:forward", title: t("Forward"), section: "Actions", icon: "right", keywords: "next page", hint: "Alt+Right", run: () => forward() },
    { id: "act:sidebar", title: sideCollapsed() ? t("Expand the sidebar") : t("Collapse the sidebar"), section: "Actions", icon: "sidebar", keywords: "sidebar minimise minimize collapse expand hide menu rail compact", hint: "Ctrl+B", run: toggleSide },
    { id: "act:shortcuts", title: t("Keyboard shortcuts"), section: "Actions", icon: "keyboard", keywords: "keys hotkeys help controller gamepad bindings", hint: "?", run: toggleHelp },
    { id: "act:activity", title: t("Show what's running"), section: "Actions", icon: "clock", keywords: "loading waiting stuck hung frozen slow busy spinner progress background tasks", run: openActivity },
    { id: "act:kofi", title: t("Tip on Ko-fi"), section: "Actions", icon: "coffee", keywords: "kofi ko-fi tip donate support coffee money thanks developer", run: openKofi },
    ...NSFW.map(([v, title, keywords]) => ({ id: `act:nsfw:${v}`, title, section: "Actions", icon: (v === "show" ? "eye" : "hide") as Command["icon"], keywords,
      hint: nsfw === v ? t("On now") : undefined, run: () => setNsfw(v) })),
  ];
  if (g) {
    list.push(
      { id: "act:play", title: t("Play {game}", { game: gameName(g) }), section: "Actions", icon: "play", keywords: "start launch run game", hint: "Ctrl+Enter", priority: 6, run: () => void play(g) },
      { id: "act:vanilla", title: t("Play without mods"), section: "Actions", icon: "play", keywords: "vanilla clean start launch no mods", run: () => void play(g, true) },
      { id: "act:shuffle", title: t("Shuffle outfits"), section: "Actions", icon: "dice", keywords: "random randomize randomise outfits skins surprise mix", run: () => void shuffleOutfits(g.id).catch((e) => toast(errorText(e), true)) },
      { id: "act:rescan", title: t("Rescan mods"), section: "Actions", icon: "refresh", keywords: "refresh reload scan look again find new check updates force", priority: 10, run: () => void rescan(g) },
      { id: "act:updates", title: t("Check mods for updates"), section: "Actions", icon: "update", keywords: "update outdated new version gamebanana", priority: 10, run: () => void checkModUpdates(g) },
      { id: "act:folder", title: t("Open the Mods folder"), section: "Actions", icon: "folder", keywords: "explorer files directory location show in folder", run: () => openModsFolder(g) },
    );
  }
  return list.map((c) => ({ ...c, keywords: findable(c.title, c.keywords ?? "") }));
});

registerCommands("shell.games", () => allGames().filter((g) => g.shown).map((g) => ({
  id: `game:${g.id}`, title: gameName(g), section: "Games", icon: "controller" as const, keywords: `${g.name} ${g.short} ${gameShort(g)} ${g.id} ${g.importer} game switch`,
  hint: currentGame()?.id === g.id ? t("Current") : undefined, priority: 10, run: () => setGame(g.id),
})));
