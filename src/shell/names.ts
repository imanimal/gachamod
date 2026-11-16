// Names for pages: the title bar's breadcrumb, the Back and Forward history menus and the palette all call a page
// the same thing. Names that need a lookup (a mod, a creator) are fetched once and cached; until then a plain
// placeholder shows. Owner: SHELL area.
import { useEffect, useState } from "react";
import { library, profiles, type GameId } from "../lib/api";
import { extensionsNow } from "../lib/extensions";
import { modPage } from "../lib/gamebanana";
import { charNoun } from "../lib/games";
import { creatorOf } from "../lib/prefs";
import type { Route, View } from "../lib/store";
import type { IconName } from "../ui/Icon";

export const VIEW_INFO: Record<View, { label: string; icon: IconName }> = {
  home: { label: "Home", icon: "home" },
  library: { label: "My Mods", icon: "mods" },
  characters: { label: "Characters", icon: "characters" },
  browse: { label: "Browse", icon: "browse" },
  downloads: { label: "Downloads", icon: "downloads" },
  profiles: { label: "Profiles", icon: "profiles" },
  tools: { label: "Tools", icon: "tools" },
  settings: { label: "Settings", icon: "settings" },
  extensions: { label: "Extensions", icon: "puzzle" },
};

/** Ctrl+1 … Ctrl+8, in this order. The sidebar lists the same views but Profiles, which has its own list there. */
export const KEY_VIEWS: View[] = ["home", "browse", "library", "characters", "downloads", "profiles", "tools", "settings"];

/** A view's label in a game ("Agents" for Characters in Zenless Zone Zero). */
export function viewLabel(view: View, game?: GameId | null): string {
  return view === "characters" ? charNoun(game) : VIEW_INFO[view].label;
}

/** Settings' pages and panels (settings/settingsSearch.ts has the same names) and Tools' pages, by route section. */
const SECTIONS: Record<string, string> = {
  games: "Games and mod loaders", "game-start": "Administrator and launch options", xxmi: "XXMI Launcher",
  mods: "Mods and downloads", adult: "Mods for adults", "mod-folders": "Mods folders", installing: "Downloads and installing",
  automatic: "Automatic updates and scans", "broken-mods": "Mods a game update broke", storage: "Trash and removed mods",
  creators: "Creators", hotkeys: "In-game profile hotkeys",
  appearance: "Appearance", layout: "Layout, text size and animations", themes: "Custom themes", graphics: "Hardware acceleration and rendering log",
  fun: "Fun extras", account: "GameBanana account", integrations: "1-click installs and .gachamod files", ai: "AI helper",
  feedback: "Feedback, privacy and logs", privacy: "Usage counts and crash reports", logs: "Log files",
  about: "About and updates", updates: "gachamod updates", transfer: "Back up or move your settings", repair: "Repair, reset or uninstall",
  launch: "Launch options", fixes: "Mod fixers", ingame: "In-game menu",
  history: "History", dev: "Dev tools", extensions: "Extensions",
};
/** "set-trash-days" (one setting in Settings) reads "Trash days". */
const sectionLabel = (id: string) => SECTIONS[id] ?? cap(id.replace(/^set-/, "").replace(/-/g, " "));
const TABS: Record<string, string> = { archive: "Trash", online: "Online", all: "All games", installed: "Installed", every: "Add mods" };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ── names that need a lookup ──

const names = new Map<string, string | null>();
const pending = new Set<string>();
const subs = new Set<() => void>();
let version = 0;
function fetchName(key: string, job: () => Promise<string | null | undefined>) {
  if (names.has(key) || pending.has(key)) return;
  pending.add(key);
  job().then((n) => { names.set(key, n ?? null); }).catch(() => { names.set(key, null); })
    .finally(() => { pending.delete(key); version++; subs.forEach((f) => f()); });
}

function modName(game: GameId | null, id: string | number): string | null {
  if (typeof id === "number") {
    const key = `gb:${id}`;
    fetchName(key, async () => (await modPage(id))?.name);
    return names.get(key) ?? null;
  }
  if (!game) return null;
  const key = `lib:${game}:${id}`;
  fetchName(key, async () => (await library.get(game, id)).name);
  return names.get(key) ?? null;
}

function profileName(game: GameId | null, id: number): string | null {
  if (!game) return null;
  const key = `profile:${game}:${id}`;
  fetchName(key, async () => (await profiles.list(game)).find((p) => p.id === id)?.name);
  return names.get(key) ?? null;
}

/** Re-render when a looked-up name arrives. */
export function useNamesVersion(): number {
  const [v, setV] = useState(version);
  useEffect(() => { const f = () => setV(version); subs.add(f); return () => { subs.delete(f); }; }, []);
  return v;
}

export interface Crumb { label: string; route: Route; title?: string }

/** The parts of a page below its view, each with the route that goes there: a character, a creator, a section, a
 *  tab, an open mod. */
export function subCrumbs(route: Route, game: GameId | null): Crumb[] {
  const out: Crumb[] = [];
  let r: Route = { view: route.view };
  if (route.character) {
    r = { ...r, character: route.character };
    out.push({ label: route.character, route: r, title: route.view === "characters" ? undefined : `Only ${route.character}` });
  }
  if (route.user) {
    r = { ...r, user: route.user };
    out.push({ label: creatorOf(route.user)?.name ?? names.get(`user:${route.user}`) ?? "Creator", route: r });
  }
  if (route.profile !== undefined) {
    r = { ...r, profile: route.profile };
    out.push({ label: profileName(game, route.profile) ?? "Profile", route: r });
  }
  if (route.ext) {
    r = { ...r, ext: route.ext };
    const e = extensionsNow().find((x) => x.id === route.ext);
    out.push({ label: e?.manifest?.page?.title ?? e?.manifest?.name ?? "Extension", route: r });
  }
  if (route.section) {
    r = { ...r, section: route.section };
    const label = route.view === "extensions" ? (route.section === "themes" ? "Themes" : "Extensions") : sectionLabel(route.section);
    out.push({ label, route: r });
  }
  if (route.tab) {
    r = { ...r, tab: route.tab };
    const e = route.tab.startsWith("ext:") ? extensionsNow().find((x) => `ext:${x.id}` === route.tab) : undefined;
    out.push({ label: e?.manifest?.characterTab?.title ?? TABS[route.tab] ?? cap(route.tab), route: r });
  }
  if (route.modId !== undefined && route.modId !== "") {
    r = { ...r, modId: route.modId };
    out.push({ label: modName(game, route.modId) ?? (typeof route.modId === "number" ? "Mod" : "Mod details"), route: r });
  }
  if (route.search && !out.length) out.push({ label: `"${route.search}"`, route: { ...r, search: route.search } });
  return out;
}

/** One line for a page: "Mods, Furina" or "Browse". */
export function pageName(route: Route, game: GameId | null): string {
  const sub = subCrumbs(route, game);
  return [viewLabel(route.view, game), ...sub.map((c) => c.label)].join(", ");
}
