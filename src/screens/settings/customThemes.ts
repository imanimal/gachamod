// Saving, importing, sharing and deleting custom themes (lib/theme.ts checks and applies them). Every change has
// Undo. Used by Settings > Custom themes and the AI helper's theme task. Owner: SETTINGS/AI area.
import type { GameState } from "../../lib/api";
import { record } from "../../lib/history";
import { applyCustomTheme, customThemesPref, setThemePick, themePick, validateCustomTheme, type CustomTheme } from "../../lib/theme";
import { plural } from "../../ui/kit";
import { toast } from "../../ui/toast";

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

/** Save a theme. A new one is also picked for `game`; an edited one stays picked where it was. */
export async function saveTheme(theme: CustomTheme, isNew: boolean, game: GameState | null): Promise<CustomTheme> {
  const before = customThemesPref.get();
  const t = { ...theme, id: isNew ? uniqueId(theme.id, before) : theme.id };
  const after = isNew ? [...before, t] : before.map((x) => (x.id === t.id ? t : x));
  const pickBefore = game ? themePick(game.id) : null;
  const pickAfter = game && isNew ? t.id : pickBefore;
  await put(after, game, pickAfter);
  record({
    label: isNew ? `Made the theme ${t.name}${game ? ` for ${game.name}` : ""}` : `Changed the theme ${t.name}`,
    undo: () => put(before, game, pickBefore),
    redo: () => put(after, game, pickAfter),
  });
  return t;
}

export async function deleteTheme(theme: CustomTheme) {
  const before = customThemesPref.get();
  const after = before.filter((x) => x.id !== theme.id);
  await put(after, null, null);
  record({ label: `Deleted the theme ${theme.name}`, undo: () => put(before, null, null), redo: () => put(after, null, null) });
}

/** A copy to edit: "Night (copy)". */
export function duplicateOf(theme: CustomTheme, list: CustomTheme[]): CustomTheme {
  const name = `${theme.name} (copy)`.slice(0, 60);
  const { pkg: _pkg, ...own } = theme;
  return { ...own, name, id: uniqueId(validateCustomTheme({ ...theme, id: undefined, name }).theme?.id ?? "custom:copy", list) };
}

/** The theme as text to share (no id: the importer makes its own). */
export const themeText = (t: CustomTheme) => JSON.stringify({ name: t.name, base: t.base, scheme: t.scheme, tokens: t.tokens, layout: t.layout, ...(t.css ? { css: t.css } : {}) }, null, 2);

export function copyTheme(t: CustomTheme) {
  navigator.clipboard.writeText(themeText(t))
    .then(() => toast(`Copied ${t.name}. Anyone can import it in Settings, Custom themes`))
    .catch(() => toast("Couldn't copy to the clipboard", true));
}

/** Themes in some text: one theme, a list of them, or { themes: [...] }. Bad parts are left out with a reason. */
export function readThemes(text: string): { themes: CustomTheme[]; problems: string[] } {
  let raw: unknown;
  try { raw = JSON.parse(text.trim().replace(/^```(?:json)?\s*|```$/g, "")); } catch { return { themes: [], problems: ["That isn't a theme (not JSON)"] }; }
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
  for (const { pkg: _pkg, ...t } of themes) after.push({ ...t, id: uniqueId(t.id, after) });
  await put(after, null, null);
  record({ label: `Imported ${themes.length === 1 ? `the theme ${themes[0]!.name}` : plural(themes.length, "theme")}`, undo: () => put(before, null, null), redo: () => put(after, null, null) });
}
