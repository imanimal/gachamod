// Names for pages: the title bar's breadcrumb, the Back and Forward history menus and the palette all call a page
// the same thing. Names that need a lookup (a mod, a creator) are fetched once and cached; until then a plain
// placeholder shows. Owner: SHELL area.
import { useEffect, useState } from "react";
import { library, profiles, type GameId } from "../lib/api";
import { extensionsNow } from "../lib/extensions";
import { modPage } from "../lib/gamebanana";
import { charNoun } from "../lib/games";
import { t } from "../lib/i18n";
import { creatorOf } from "../lib/prefs";
import type { Route, View } from "../lib/store";
import type { IconName } from "../ui/Icon";

export const VIEW_INFO: Record<View, { label: string; icon: IconName }> = {
  home: { label: t("Home"), icon: "home" },
  library: { label: t("Mods"), icon: "mods" },
  characters: { label: t("Characters"), icon: "characters" },
  browse: { label: t("Browse"), icon: "browse" },
  downloads: { label: t("Downloads"), icon: "downloads" },
  profiles: { label: t("Profiles"), icon: "profiles" },
  tools: { label: t("Tools"), icon: "tools" },
  settings: { label: t("Settings"), icon: "settings" },
  extensions: { label: t("Extensions"), icon: "puzzle" },
};

/** Ctrl+1 … Ctrl+8, in this order. The sidebar lists the same views but Profiles, which has its own list there. */
export const KEY_VIEWS: View[] = ["home", "browse", "library", "characters", "downloads", "profiles", "tools", "settings"];

/** A view's label in a game ("Agents" for Characters in Zenless Zone Zero). */
export function viewLabel(view: View, game?: GameId | null): string {
  return view === "characters" ? charNoun(game) : VIEW_INFO[view].label;
}

/** Settings' and Tools' pages and panels by route section, with the names settings/settingsSearch.ts and
 *  tools/toolsSearch.ts give them. Where a page and a panel share an id, the page's name wins. */
const SECTIONS: Record<string, string> = {
  general: t("General"), gamebanana: "GameBanana",
  games: t("Games"), "game-start": t("Run as administrator"), xxmi: "XXMI Launcher", migoto: t("Mod maker switches"),
  mods: t("Mods"), adult: t("Mods for adults"), "mod-folders": t("Mods folders"), installing: t("Downloads and installing"),
  automatic: t("Mod update checks and rescans"), "broken-mods": t("Mods a game update broke"), storage: t("Trash and removed mods"),
  creators: t("Creators"), hotkeys: t("Hotkeys"),
  appearance: t("Appearance"), layout: t("Layout, text size and animations"), themes: t("Custom themes"), graphics: t("Hardware acceleration and rendering log"),
  fun: t("Fun"), account: t("GameBanana account"), integrations: t("1-click installs and .gachamod files"), ai: t("AI helper"),
  feedback: t("Feedback and privacy"), privacy: t("Usage counts and crash reports"), logs: t("Log files"),
  about: t("About and updates"), updates: t("gachamod updates"), transfer: t("Back up or move your settings"), repair: t("Repair, reset or uninstall"),
  launch: t("Launch"), problems: t("Problems"), fixes: t("Fixes"), conflicts: t("Conflicts"), "key-clashes": t("Key clashes"),
  ingame: t("In-game menu"), keylist: t("Key list in game"), packs: t("Share and import"), others: t("Mods from other managers"),
  makers: t("Mod makers"), hash: t("Find a hash"),
  disk: t("Storage"), "disk-big": t("Biggest mods"), "disk-dupes": t("Mods installed twice"),
  history: t("History"), dev: t("Dev tools"), extensions: t("Extensions"),
};
/** "set-trash-days" (one setting in Settings) reads "Trash days". */
const sectionLabel = (id: string) => SECTIONS[id] ?? cap(id.replace(/^set-/, "").replace(/-/g, " "));
const TABS: Record<string, string> = { archive: t("Trash"), online: t("Online"), all: t("All games"), installed: t("Installed"), every: t("Add mods") };
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
    out.push({ label: route.character, route: r, title: route.view === "characters" ? undefined : t("Only {name}", { name: route.character }) });
  }
  if (route.user) {
    r = { ...r, user: route.user };
    out.push({ label: creatorOf(route.user)?.name ?? names.get(`user:${route.user}`) ?? t("Creator"), route: r });
  }
  if (route.profile !== undefined) {
    r = { ...r, profile: route.profile };
    out.push({ label: profileName(game, route.profile) ?? t("Profile"), route: r });
  }
  if (route.ext) {
    r = { ...r, ext: route.ext };
    const e = extensionsNow().find((x) => x.id === route.ext);
    out.push({ label: e?.manifest?.page?.title ?? e?.manifest?.name ?? t("Extension"), route: r });
  }
  if (route.section) {
    r = { ...r, section: route.section };
    const label = route.view === "extensions" ? (route.section === "themes" ? t("Themes") : t("Extensions")) : sectionLabel(route.section);
    out.push({ label, route: r });
  }
  if (route.tab) {
    r = { ...r, tab: route.tab };
    const e = route.tab.startsWith("ext:") ? extensionsNow().find((x) => `ext:${x.id}` === route.tab) : undefined;
    out.push({ label: e?.manifest?.characterTab?.title ?? TABS[route.tab] ?? cap(route.tab), route: r });
  }
  if (route.modId !== undefined && route.modId !== "") {
    r = { ...r, modId: route.modId };
    out.push({ label: modName(game, route.modId) ?? (typeof route.modId === "number" ? t("Mod") : t("Mod details")), route: r });
  }
  if (route.search && !out.length) out.push({ label: t("\"{text}\"", { text: route.search }), route: { ...r, search: route.search } });
  return out;
}

/** One line for a page: "Mods, Furina" or "Browse". */
export function pageName(route: Route, game: GameId | null): string {
  const sub = subCrumbs(route, game);
  return [viewLabel(route.view, game), ...sub.map((c) => c.label)].join(", ");
}
