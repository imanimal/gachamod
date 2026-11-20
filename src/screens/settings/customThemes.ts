// Saving, importing, sharing and deleting custom themes (lib/theme.ts checks and applies them). Every change has
// Undo. Used by Settings > Custom themes and the AI helper's theme task. Owner: SETTINGS/AI area.
import type { GameState } from "../../lib/api";
import { record } from "../../lib/history";
import { applyCustomTheme, customThemesPref, setThemePick, setThemePicks, themePick, validateCustomTheme, type CustomTheme } from "../../lib/theme";
import { toast } from "../../ui/toast";
import type { MenuEntry } from "../../ui/ContextMenu";
import { t, tn } from "../../lib/i18n";
import { gameName } from "../../lib/games";
import { allGames, currentGame } from "../../lib/store";
import { extName, extensionsNow, removeExtension } from "../../lib/extensions";
import { readThemeText } from "./themeSource";

/** `id`, or `id-2`, `id-3` ... when a theme in `list` already has it. */
export function uniqueId(id: string, list: CustomTheme[]): string {
  const base = /^custom:[a-z0-9-]{1,40}$/.test(id) ? id : "custom:theme";
  if (!list.some((t) => t.id === base)) return base;
  for (let n = 2; ; n++) if (!list.some((t) => t.id === `${base}-${n}`)) return `${base}-${n}`;
}

/** Save the list, drop lib/theme's cached copy, and set the game's pick. */
async function put(list: CustomTheme[], game: GameState | null, pick: string | null) {
  await customThemesPref.set(list);
  applyCustomTheme(null);
  if (game && pick !== null) setThemePick(game, pick);
}

/** Save a theme. A new one is also picked for `game`; an edited one stays picked where it was. `quiet` keeps it on
 *  the undo list without a toast, for the AI helper, whose done window already says what it saved. */
export async function saveTheme(theme: CustomTheme, isNew: boolean, game: GameState | null, quiet = false): Promise<CustomTheme> {
  const before = customThemesPref.get();
  // an edited theme that was deleted while it was open is saved again rather than lost
  const known = !isNew && before.some((x) => x.id === theme.id);
  const saved = { ...theme, id: known ? theme.id : uniqueId(theme.id, before) };
  const after = known ? before.map((x) => (x.id === saved.id ? saved : x)) : [...before, saved];
  const pickBefore = game ? themePick(game.id) : null;
  const pickAfter = game && isNew ? saved.id : pickBefore;
  await put(after, game, pickAfter);
  record({
    label: !isNew ? t("Changed the theme {theme}", { theme: saved.name })
      : game ? t("Made the theme {theme} for {game}", { theme: saved.name, game: gameName(game) }) : t("Made the theme {theme}", { theme: saved.name }),
    brief: isNew ? t("Made the theme") : t("Saved the theme"),
    undo: () => put(before, game, pickBefore),
    redo: () => put(after, game, pickAfter),
  }, quiet);
  return saved;
}

/** Delete one of the user's themes (made, imported or from the AI helper). Games that used it go back to Match the
 *  game; Undo brings back the theme and those picks. */
export async function deleteTheme(theme: CustomTheme) {
  const before = customThemesPref.get();
  const after = before.filter((x) => x.id !== theme.id);
  const users = allGames().filter((g) => themePick(g.id) === theme.id).map((g) => g.id);
  const set = async (list: CustomTheme[], pick: string) => {
    await put(list, null, null);
    if (users.length) setThemePicks(Object.fromEntries(users.map((g) => [g, pick])), currentGame());
  };
  await set(after, "auto");
  record({ label: t("Deleted the theme {theme}", { theme: theme.name }), brief: t("Deleted the theme"), undo: () => set(before, theme.id), redo: () => set(after, "auto") });
}

/** The package a theme came from, while it's installed. */
export const packageOf = (th: CustomTheme) => (th.pkg ? extensionsNow().find((e) => e.id === th.pkg) ?? null : null);

/** Delete a theme. A package's theme comes back from the package each start, so that removes the package, with any
 *  other themes in it. Both have Undo. */
export function removeTheme(th: CustomTheme): Promise<void> {
  const ext = packageOf(th);
  return ext ? removeExtension(ext) : deleteTheme(th);
}

/** The menu entry for removeTheme. `first` runs before it, to close an editor showing the theme. */
export function removeEntry(th: CustomTheme, first?: () => void): MenuEntry {
  const ext = packageOf(th);
  const onClick = () => { first?.(); void removeTheme(th); };
  return ext
    ? { label: t("Remove {name}", { name: extName(ext) }), icon: "trash", danger: true, keys: "Del", title: t("Removes the package this theme came from, with any other themes in it"), onClick }
    : { label: t("Delete"), icon: "trash", danger: true, keys: "Del", title: t("Games using it go back to Match the game. Undo brings it back"), onClick };
}

/** The tip on a theme card's delete button. */
export function removeTip(th: CustomTheme): string {
  const ext = packageOf(th);
  return ext ? t("Remove {name}, the package this theme came from (Del)", { name: extName(ext) }) : t("Delete the theme (Del)");
}

/** A copy to edit: "Night (copy)". */
export function duplicateOf(theme: CustomTheme, list: CustomTheme[]): CustomTheme {
  const name = t("{theme} (copy)", { theme: theme.name }).slice(0, 60);
  const { pkg: _pkg, ...own } = theme;
  return { ...own, name, id: uniqueId(validateCustomTheme({ ...theme, id: undefined, name }).theme?.id ?? "custom:copy", list) };
}

/** The theme as text to share (no id: the importer makes its own). */
export const themeText = (th: CustomTheme) => JSON.stringify({ name: th.name, base: th.base, scheme: th.scheme, tokens: th.tokens, layout: th.layout, ...(th.css ? { css: th.css } : {}) }, null, 2);

export function copyTheme(th: CustomTheme) {
  navigator.clipboard.writeText(themeText(th))
    .then(() => toast(t("Copied the theme. Anyone can import it in Settings, Custom themes")))
    .catch(() => toast(t("Couldn't copy to the clipboard"), true));
}

/** Themes in some text: one theme, a list of them, or { themes: [...] }. Bad parts are left out with a reason. */
export function readThemes(text: string): { themes: CustomTheme[]; problems: string[] } {
  let raw: unknown;
  try { raw = JSON.parse(text.trim().replace(/^```(?:json)?\s*|```$/g, "")); } catch {
    // the editor's form: the settings, then the stylesheet as plain CSS
    const r = readThemeText(text);
    if (!r.ok) return { themes: [], problems: [t("That isn't a theme. {problem}", { problem: r.error })] };
    raw = r.value;
  }
  const items = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { themes?: unknown }).themes) ? (raw as { themes: unknown[] }).themes : [raw];
  const themes: CustomTheme[] = [], problems: string[] = [];
  for (const item of items.slice(0, 50)) {
    const r = validateCustomTheme(item);
    if (r.theme) themes.push(r.theme);
    problems.push(...r.problems.map((p) => (items.length > 1 && r.theme ? `${r.theme.name}: ${p}` : p)));
  }
  return { themes, problems };
}

/** Add several themes at once (an import). */
export async function addThemes(themes: CustomTheme[]) {
  const before = customThemesPref.get();
  const after = [...before];
  // an imported theme is the user's own, even when its JSON names a package
  for (const { pkg: _pkg, ...own } of themes) after.push({ ...own, id: uniqueId(own.id, after) });
  await put(after, null, null);
  record({ label: themes.length === 1 ? t("Imported the theme {theme}", { theme: themes[0]!.name }) : tn(themes.length, "Imported {n} theme", "Imported {n} themes"),
    brief: themes.length === 1 ? t("Imported the theme") : undefined, undo: () => put(before, null, null), redo: () => put(after, null, null) });
}
