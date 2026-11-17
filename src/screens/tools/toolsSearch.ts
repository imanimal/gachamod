// Tools' pages and panels for the search at the top of Settings and Tools (settings/MenuSearch.tsx), with the words
// people use for them, the way settings/settingsSearch.ts lists Settings'. Owner: SETTINGS/AI area.
import type { PageInfo } from "../settings/Paged";
import type { SectionInfo } from "../settings/settingsSearch";
import { t } from "../../lib/i18n";

/** Tools' pages in order. A page holds the panels that belong together. Its name is a word or two; the tip says
 *  what is on it, and the keywords keep older and longer names findable. */
/** Search words for "Mods from other managers": the names people know their old manager by. */
export const MOVE_KEYWORDS = "other mod manager move switch from import migrate take over imm integrated mod manager no reload nrmm jasm ssi skinselectimpact xxmm xx mod manager zzz mod manager peaky gimm gmm wzmm emmm fairy's secret folder flairx wuwa mod manager hestia presets";

export const TOOL_PAGES: PageInfo[] = [
  { id: "problems", label: t("Problems"), icon: "warn", tip: t("What stops a mod from showing right in game, and the fixers for mods a game update broke"),
    keywords: "problems and fixes broken mods" },
  { id: "conflicts", label: t("Conflicts"), icon: "layers", tip: t("Mods that are on and change the same parts of a model, or use the same keys") },
  { id: "ingame", label: t("In-game menu"), icon: "swap", tip: t("The menu over the game for picking skins without a reload, and the key list"),
    keywords: "switch skins in game overlay" },
  { id: "packs", label: t("Sharing"), icon: "package", tip: t("Share mods and profiles as a .gachamod file, or bring in mods from another mod manager"),
    keywords: "share and move export import" },
  { id: "makers", label: t("Mod makers"), icon: "code", tip: t("Reloading mods in game, the shader cache, 3DMigoto's files and log, and looking up a hash"),
    keywords: "developer dev tools modding" },
];

/** The panels on those pages, in order. Labels are the panels' titles. */
export const TOOL_SECTIONS: SectionInfo[] = [
  { id: "problems", page: "problems", label: t("Problems"), icon: "warn", keywords: "problems issues mod not showing wrong missing broken ini errors health check ignored" },
  { id: "fixes", page: "problems", label: t("Fixes"), icon: "wand", keywords: "fixer fixes broken mods hash game update patch repair outdated need their author" },
  { id: "conflicts", page: "conflicts", label: t("Conflicts"), icon: "layers", keywords: "conflict conflicting overlap same parts model clash two mods" },
  { id: "key-clashes", page: "conflicts", label: t("Key clashes"), icon: "keyboard", keywords: "key clash conflict conflicting same key toggles hotkeys keybinds" },
  { id: "ingame", page: "ingame", label: t("Switch skins in game"), icon: "swap", keywords: "in game overlay switch mods skins without reload f10 toggle menu key keys f7 rebind shortcut live" },
  { id: "keylist", page: "ingame", label: t("Key list in game"), icon: "keyboard", keywords: "mod keys toggles hotkeys help f8 in game overlay cheat sheet" },
  { id: "packs", page: "packs", label: t(".gachamod files"), icon: "package", keywords: "export import share send friend backup gachamod pack file links library profiles" },
  { id: "others", page: "packs", label: t("Mods from other managers"), icon: "swap", keywords: MOVE_KEYWORDS },
  { id: "dev", page: "makers", label: t("Files and logs"), icon: "bug", keywords: "shader cache clear frame dumps frameanalysis log d3dx ini d3dx_user wipe reload loader folder shaderfixes 3dmigoto saved options" },
  { id: "hash", page: "makers", label: t("Find a hash"), icon: "search", keywords: "hash lookup search which mod uses texture buffer ib vb" },
];

/** The page a panel is on, for a route to one that isn't shown. */
export const toolsPageOf = (id: string): string | undefined => TOOL_SECTIONS.find((s) => s.id === id && s.page !== id)?.page;

/** "Tools › Problems" for a page. */
export const toolsWhere = (page: string): string =>
  t("Tools › {page}", { page: TOOL_PAGES.find((p) => p.id === page)?.label ?? page });
