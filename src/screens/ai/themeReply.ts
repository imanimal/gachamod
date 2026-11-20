// Reading the theme task's answer: its json block and the css blocks after it, also when the answer came in parts
// because the chatbot ran out of room. Nothing from the app but lib/i18n, so it is tested on its own
// (themeReply.test.ts). Owner: SETTINGS/AI area.
import { t } from "../../lib/i18n";
import { CutOff, ReplyError, parseReply } from "./reply";

interface Block { lang: string; body: string; cut: boolean }

/** A line that only says what comes next ("Here's the rest:"), not CSS. */
const PROSE = (l: string) => /[a-z]{3,}[.:!?]\s*$/i.test(l) && !/[{};]/.test(l);

/** The fenced code blocks in a reply. `cut` marks a block that never closes: the reply stopped partway. A block that
    opens inside another means the first was cut off and the next answer was pasted after it: the first ends there,
    without the lines that introduce the next answer. */
function blocksOf(text: string): Block[] {
  const blocks: Block[] = [];
  let cur: { lang: string; lines: string[] } | null = null;
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const fence = /^\s*```+\s*([\w+-]*)/.exec(line);
    if (!fence) { cur?.lines.push(line); continue; }
    if (cur && !fence[1]) { blocks.push({ lang: cur.lang, body: cur.lines.join("\n"), cut: false }); cur = null; continue; }
    if (cur) {
      while (cur.lines.length && (!cur.lines[cur.lines.length - 1]!.trim() || PROSE(cur.lines[cur.lines.length - 1]!))) cur.lines.pop();
      blocks.push({ lang: cur.lang, body: cur.lines.join("\n"), cut: true });
    }
    cur = { lang: fence[1]!.toLowerCase(), lines: [] };
  }
  if (cur) blocks.push({ lang: cur.lang, body: cur.lines.join("\n"), cut: true });
  return blocks;
}

/** How deep in { } a stylesheet ends (above 0: it stops inside a rule) and where its last complete top-level rule
    ends. Comments and strings don't count. */
function braces(css: string): { depth: number; lastTop: number } {
  let depth = 0, lastTop = 0;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === "/" && css[i + 1] === "*") { const end = css.indexOf("*/", i + 2); if (end < 0) break; i = end + 1; }
    else if (c === '"' || c === "'") { for (i++; i < css.length && css[i] !== c && css[i] !== "\n"; i++) if (css[i] === "\\") i++; }
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) lastTop = i + 1;
  }
  return { depth, lastTop };
}

export const CUT_NOTE = t("The stylesheet stops partway (the chatbot ran out of room). Apply uses what's here. For the rest, ask the chatbot to go on in a new css block, copy that answer and press Paste the rest.");

/** The theme in a pasted reply: its json block, with every css block joined as the stylesheet. Several answers pasted
    one after another work: a block that was cut off is joined with the next, or cut back to its last whole rule when
    the next starts over. `cut` says the stylesheet still stops partway. A reply without code blocks is read as one
    bare JSON object. */
export function parseThemeReply(text: string): { theme: unknown; cut: boolean } {
  if (!text.trim()) throw new ReplyError(t("Paste the chatbot's answer first."));
  const blocks = blocksOf(text);
  if (!blocks.length) return { theme: parseReply(text), cut: false };
  const json = blocks.find((b) => b.lang === "json") ?? blocks.find((b) => b.lang !== "css" && /^\s*\{/.test(b.body));
  if (!json) {
    if (blocks.some((b) => b.cut)) throw new CutOff(t("The answer stops before the json code block (the chatbot ran out of room). Ask it to send the json block, copy that answer and press Paste the rest."));
    throw new ReplyError(t("There's no json code block in that answer. Copy the chatbot's whole reply, including the code blocks."));
  }
  let theme: unknown;
  try { theme = JSON.parse(json.body); } catch {
    if (json.cut) throw new CutOff(t("The answer stops inside the json code block. Ask the chatbot to send the json block again, copy that answer and press Paste the rest."));
    throw new ReplyError(t("The json code block isn't valid JSON. Ask the chatbot to send it again."));
  }
  if (!theme || typeof theme !== "object" || Array.isArray(theme)) throw new ReplyError(t("The json code block should be one theme object."));

  const css = blocks.filter((b) => b.lang === "css");
  const parts = css.map((b) => b.body.trim());
  // a part cut inside a rule: the next part either goes on from there (it closes more than it opens) or starts over
  for (let i = 0; i < parts.length - 1; i++) {
    const here = braces(parts[i]!);
    if (here.depth > 0 && braces(parts[i + 1]!).depth >= 0) parts[i] = parts[i]!.slice(0, here.lastTop);
  }
  let sheet = parts.filter(Boolean).join("\n\n");
  const end = braces(sheet);
  let cut = !!css[css.length - 1]?.cut;
  if (end.depth > 0) { sheet = sheet.slice(0, end.lastTop).trim(); cut = true; }
  const own = (theme as { css?: unknown }).css;
  if (sheet) theme = { ...theme, css: typeof own === "string" && own.trim() ? `${own}\n\n${sheet}` : sheet };
  return { theme, cut };
}
