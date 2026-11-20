// A custom theme as text in the editor: its settings as indented JSON (name, base, light or dark, one token per line,
// layout), while the stylesheet keeps its own box. Reading takes that, the one-line JSON that Copy as text and older
// versions make (the stylesheet inside as "css"), or the settings followed by the stylesheet as plain CSS. Nothing
// from the app but lib/i18n, so it is tested on its own (themeSource.test.ts). Owner: SETTINGS/AI area.
import { t } from "../../lib/i18n";

/** The parts of a theme the text shows. */
interface Settings { name: string; base: string; scheme: string; tokens: Record<string, string>; layout: object }

/** A theme's settings as indented JSON, without its stylesheet. */
export function themeSettingsText(th: Settings): string {
  return JSON.stringify({ name: th.name, base: th.base, scheme: th.scheme, tokens: th.tokens, layout: th.layout }, null, 2);
}

/** Just past the brace that closes the object starting at `from`, or -1 when it never closes. Brackets inside strings
    don't count. */
function objectEnd(text: string, from: number): number {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === "\"") { for (i++; i < text.length && text[i] !== "\""; i++) if (text[i] === "\\") i++; }
    else if (c === "{" || c === "[") depth++;
    else if ((c === "}" || c === "]") && --depth === 0) return i + 1;
  }
  return -1;
}

/** The line an offset in `text` is on, counting from 1. */
const lineAt = (text: string, at: number) => text.slice(0, at).split("\n").length;

export type ThemeTextRead = { ok: true; value: Record<string, unknown> } | { ok: false; error: string };

/** Read theme text: a settings object, then optionally plain CSS, which becomes the stylesheet (after the object's own
    "css", if it has one). Code fences (```json, ```css) are dropped. `error` says what's wrong and on which line. */
export function readThemeText(text: string): ThemeTextRead {
  const src = text.replace(/\r\n?/g, "\n").replace(/^\s*```(?:json)?[^\n]*\n/, "");
  const start = src.search(/\S/);
  if (start < 0) return { ok: false, error: t("Paste or type a theme here") };
  if (src[start] !== "{") return { ok: false, error: t("A theme starts with {, then the name, base, tokens and layout") };
  const end = objectEnd(src, start);
  if (end < 0) return { ok: false, error: t("The settings never close. A } is missing at the end, or a quote is left open") };
  let value: unknown;
  try { value = JSON.parse(src.slice(start, end)); } catch (e) {
    const at = /position (\d+)/.exec(e instanceof Error ? e.message : "");
    return {
      ok: false,
      error: at ? t("Can't read line {line}. Check it and the line before for a missing quote, or a missing or extra comma", { line: lineAt(src, start + Number(at[1])) })
        : t("This isn't valid JSON. Check for a missing quote, or a missing or extra comma"),
    };
  }
  // the fences around a pasted chatbot answer's blocks aren't CSS
  const rest = src.slice(end).replace(/^[ \t]*```[\w+-]*[ \t]*$/gm, "").trim();
  const own = (value as { css?: unknown }).css;
  if (rest) value = { ...(value as object), css: typeof own === "string" && own.trim() ? `${own}\n\n${rest}` : rest };
  return { ok: true, value: value as Record<string, unknown> };
}
