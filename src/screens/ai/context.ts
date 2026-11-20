// Reference files for the AI helper when the chatbot answers in the app (lib/ai.ts JobFile): gachamod's stylesheets
// and the screen showing now for a theme, and each mod's file list, ini and text files for mod jobs. A CLI that reads
// files gets them as a folder of copies, the others as much as fits pasted after the request, so every list runs from
// most to least useful. Owner: SETTINGS/AI area.
import type { GameState, ModEntry } from "../../lib/api";
import { modFilesForAi, neutralName, type JobFile, type ModFiles } from "../../lib/ai";
import { THEMES, customThemesPref, themeState, type CustomTheme } from "../../lib/theme";
import { themeText } from "../settings/customThemes";

// ── gachamod's look, for a theme ──

/** Every stylesheet in the app as text, each loaded only when a theme job asks for it. Keys are "../../styles/kit.css". */
const SHEETS = import.meta.glob("../../**/*.css", { query: "?raw", import: "default" }) as Record<string, () => Promise<string>>;

/** The first sentence of a stylesheet's header comment ("kit.css: the UI kit's classes ..."), as its description. */
function headline(css: string): string {
  const c = /^\s*\/\*([\s\S]*?)\*\//.exec(css)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
  const first = c.replace(/^[\w./-]+\.css:\s*/, "").split(/(?<=\.)\s/)[0] ?? "";
  return first.replace(/\s*Owner: [A-Z/ ]+ area\.?/, "").slice(0, 160);
}

/** How useful a stylesheet is for writing a theme on `base`: lower comes first. */
function rank(path: string, base: string): number {
  const name = path.split("/").pop()!;
  if (path === "styles/base.css") return 0;
  if (path === "styles/themes/default.css") return 1;
  if (path === "styles/kit.css") return 2;
  if (path === "styles/shell.css") return 3;
  if (base !== "default" && path.startsWith("styles/themes/") && (name.startsWith(`${base}.`) || name.startsWith(`${base}-`))) return 4;
  if (path.startsWith("screens/")) return 5;
  if (path.startsWith("ui/")) return 6;
  if (path.startsWith("styles/themes/")) return 7;
  return 8;
}

/** The HTML of the screen showing now, cut down to structure: tags, classes, roles, states and short text. No images,
 *  links or inline styles with addresses, icon shapes left out, and long lists cut to their first dozen. */
function screenHtml(): string {
  const root = document.getElementById("root");
  if (!root) return "";
  const copy = root.cloneNode(true) as HTMLElement;
  const KEEP = /^(class|id|role|type|disabled|checked|selected|open|title|tabindex|aria-[\w-]+|data-[\w-]+)$/;
  const walk = (el: Element) => {
    if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|CANVAS|VIDEO|IFRAME)$/.test(el.tagName)) { el.remove(); return; }
    for (const a of [...el.attributes]) {
      const keep = KEEP.test(a.name) ? a.value.length <= 80 : a.name === "style" && a.value.length <= 80 && !a.value.includes("url(");
      if (!keep) el.removeAttribute(a.name);
      else if (a.name === "title" || a.name.startsWith("aria-") || a.name.startsWith("data-")) el.setAttribute(a.name, neutralName(a.value));
    }
    if (el.tagName.toLowerCase() === "svg") { el.replaceChildren(); return; }
    const kids = [...el.children];
    if (kids.length > 24) {
      for (const k of kids.slice(12)) k.remove();
      el.append(document.createComment(` ${kids.length - 12} more like these `));
    }
    for (const n of [...el.childNodes]) {
      if (n.nodeType === Node.TEXT_NODE) {
        const text = (n.textContent ?? "").replace(/\s+/g, " ");
        n.textContent = text.trim() ? neutralName(text.length > 60 ? `${text.slice(0, 59)}…` : text) : "";
      } else if (n.nodeType === Node.ELEMENT_NODE) walk(n as Element);
    }
  };
  walk(copy);
  const html = document.documentElement;
  const attrs = [...html.attributes].filter((a) => a.name.startsWith("data-") || a.name === "lang").map((a) => ` ${a.name}="${a.value}"`).join("");
  const body = copy.outerHTML.replace(/></g, ">\n<");
  return `<html${attrs}>\n<body>\n${body.length > 150_000 ? `${body.slice(0, 150_000)}\n<!-- cut for length -->` : body}\n</body>\n</html>\n`;
}

let sheets: Promise<Array<{ path: string; text: string }>> | null = null;
const loadSheets = () => (sheets ??= Promise.all(Object.entries(SHEETS)
  .filter(([k]) => !k.includes("/dev/"))
  .map(async ([k, load]) => ({ path: k.replace(/^(\.\.\/)+/, ""), text: await load() }))));

/** For a theme: the screen showing now, the custom theme showing (to change it), and every stylesheet. `editing`: the
 *  theme being changed, which the prompt carries itself. */
export async function themeFiles(editing?: CustomTheme): Promise<JobFile[]> {
  const now = themeState();
  const showing = now.id.startsWith("custom:") ? customThemesPref.get().find((x) => x.id === now.id) : undefined;
  const custom = editing ? undefined : showing;
  const base = editing?.base ?? custom?.base ?? (THEMES.some((x) => x.id === now.id) ? now.id : "default");
  const out: JobFile[] = [];
  const html = screenHtml();
  if (html) out.push({ path: "app/screen.html", about: "the HTML of the screen showing now, cut down to its structure (classes, roles, states)", text: html });
  if (custom) out.push({ path: "app/current-theme.json", about: "the custom theme showing now, in the same shape as your answer", text: themeText(custom) });
  const all = await loadSheets();
  for (const s of [...all].sort((a, b) => rank(a.path, base) - rank(b.path, base) || a.path.localeCompare(b.path))) {
    out.push({ path: s.path, about: headline(s.text), text: s.text });
  }
  return out;
}

// ── mods' files, for mod jobs ──

/** What a mod draws, from its inis' override sections: "EllenBody, EllenHair, 3 keys". */
function draws(f: ModFiles | undefined): string {
  if (!f) return "";
  const names = f.texts.flatMap((x) => x.sections);
  const parts = [...new Set(names.filter((s) => /^(TextureOverride|ShaderOverride)/i.test(s)).map((s) => s.replace(/^(TextureOverride|ShaderOverride)/i, "")))];
  const keys = names.filter((s) => /^Key/i.test(s)).length;
  const shown = parts.slice(0, 10).map(neutralName).join(", ");
  return [shown + (parts.length > 10 ? ` +${parts.length - 10}` : ""), keys ? `${keys} key${keys === 1 ? "" : "s"}` : ""].filter(Boolean).join(", ");
}

const size = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

const cache = new Map<string, { at: number; files: Promise<ModFiles[]> }>();
/** The backend's read of these mods' files, kept a minute so typing in the helper doesn't read them again. */
function readMods(game: GameState, ids: string[], perMod: number): Promise<ModFiles[]> {
  const key = `${game.id}|${perMod}|${ids.join(",")}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.files;
  const files = (async () => {
    const out: ModFiles[] = [];
    for (let i = 0; i < ids.length; i += 40) out.push(...await modFilesForAi(game.id, ids.slice(i, i + 40), perMod));
    return out;
  })();
  files.catch(() => cache.delete(key));
  cache.set(key, { at: Date.now(), files });
  return files;
}

export interface ModContext {
  /** Each mod's files under mods/<number>/, numbered like the prompt's list. */
  files: JobFile[];
  /** What each mod draws, by mod id, for the prompt's list. */
  draws: Map<string, string>;
}

/** For mod jobs: each mod's file list and its ini and text files, with less of each when there are many mods. */
export async function modContext(game: GameState, mods: ModEntry[]): Promise<ModContext> {
  const perMod = Math.max(4096, Math.min(384 * 1024, Math.floor((6 * 1024 * 1024) / Math.max(1, mods.length))));
  const read = await readMods(game, mods.map((m) => m.id), perMod).catch(() => [] as ModFiles[]);
  const byId = new Map(read.map((f) => [f.id, f]));
  const files: JobFile[] = [];
  const drawn = new Map<string, string>();
  mods.forEach((m, i) => {
    const f = byId.get(m.id);
    if (!f) return;
    const n = i + 1;
    drawn.set(m.id, draws(f));
    const list = f.files.map((x) => `${neutralName(x.path)}  ${size(x.size)}`);
    if (f.more) list.push(`and ${f.more} more files`);
    files.push({ path: `mods/${n}/files.txt`, about: `every file in mod ${n}`, text: `${list.join("\n")}\n` });
    for (const x of f.texts) {
      if (!x.text) continue;
      files.push({ path: `mods/${n}/${neutralName(x.path)}`, about: `mod ${n}${x.cut ? ", only the start of the file" : ""}`, text: neutralName(x.text) });
    }
  });
  return { files, draws: drawn };
}
