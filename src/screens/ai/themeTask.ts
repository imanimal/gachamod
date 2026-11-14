// The "theme" task: a custom theme from a description. The prompt gives the chatbot what it needs to make a good one
// without seeing the app: the built-in themes, every token with its value in the theme showing now, how the tokens
// relate, the class names custom CSS can target and the look to avoid. It is kept short enough to ride in the
// chatbot's link (lib/ai.ts MAX_LINK) so the user doesn't have to paste it. The chatbot answers with a base theme,
// token values, a layout and optional CSS; lib/theme.ts validateCustomTheme checks all of it, and anything it can't
// use is listed as skipped. Applying saves the theme and uses it for the current game, with Undo.
// Owner: SETTINGS/AI area.
import type { AiTask } from "../../lib/ai";
import { currentGame } from "../../lib/store";
import { CUSTOM_CSS_MAX, THEMES, THEME_TOKENS, themeState, validateCustomTheme } from "../../lib/theme";
import { plural } from "../../ui/kit";
import { saveTheme } from "../settings/customThemes";
import { ReplyError, type Built, type TaskInput } from "./tasks";

const FIELDS = ["name", "base", "scheme", "tokens", "layout", "css"];

/** What custom CSS can target, for the prompt. Class names come from styles/kit.css and styles/shell.css. */
const CSS_PARTS = ".titlebar (top strip), .side (sidebar: .nv view buttons, .nv.on the open one, .side-p profile rows, .play-btn), "
  + ".page-h (page header), .btn-primary .btn-secondary .btn-ghost .btn-danger .ibtn (buttons), .panel .card .mod-card .tile (boxes), "
  + ".chip .seg-o .tab .toggle .check (pickers and switches), .search .field input .select select, .badge, .dialog .drawer .popover .menu-i, "
  + ".toast, .hero .empty .note, .portrait. .on marks a picked item";

export async function buildThemeTask(_t: AiTask, input: TaskInput): Promise<Built> {
  const want = input.text.trim();
  const now = themeState();
  const nowName = THEMES.find((t) => t.id === now.id)?.name ?? now.id;
  const game = currentGame();
  const css = getComputedStyle(document.documentElement);
  const value = (k: string) => css.getPropertyValue(k).trim().replace(/\s+/g, " ").slice(0, 90);
  // "--bg #0c0e13: window background". Shadows, fonts, textures and easing go without their long current values, and a
  // meaning's own advice in brackets is left to the rules below.
  const tokens = Object.entries(THEME_TOKENS).map(([k, v]) => {
    const cur = v.kind === "color" || v.kind === "length" || v.kind === "time" ? value(k) : "";
    return `${k}${cur ? ` ${cur}` : ""}: ${v.meaning.replace(/\s*\((?:keep|must) [^()]*\)$/, "")}`;
  }).join("\n");
  const gameAccent = value("--game-accent");

  const prompt = [
    `Make a theme for gachamod, a Windows app for game mods, from this description: "${want}".`,
    `"base" is the built-in theme it sits on:\n${THEMES.map((t) => `${t.id}: ${t.description}`).join("\n")}\n` +
      `"default" is plain and suits most descriptions. The others keep drawing their game's menus (textures, shapes) under your colours, so use one only when that game's look is asked for.`,
    `Showing now: ${nowName} (${now.scheme})${game ? ` for ${game.name}` : ""}${gameAccent ? `, game colour ${gameAccent}` : ""}. Tokens (only these) with their current values. Colours: #hex, rgb(), hsl(), oklch(), color-mix() or var(--token).\n${tokens}`,
    [
      "Rules:",
      "- --bg-2, --bg, --surface, --surface-2, --surface-3, --raised are one ramp in one hue with small steps: lighter each step in dark; in light --surface is lightest.",
      "- --line and --line-2 sit just past --surface-2. --text, --text-2, --text-3 go strong to faint.",
      "- With --accent also set --on-accent, --accent-soft (accent at 12-18% alpha), --accent-ink (accent readable on --surface) and --ring.",
      "- Keep --ok green, --warn amber, --bad red.",
      "- Flat colour: no gradients, glows or neon. --tex is none unless a texture is asked for. One accent, used sparingly. No purple unless asked.",
      "- Contrast at least 7:1 for --text on --bg and --surface, 4.5:1 for --text-3 on --surface and --on-accent on --accent.",
      "- Leave out tokens the description gives no reason to change.",
    ].join("\n"),
    `"scheme": dark, light or system. "layout" may set density (compact, cozy, roomy), sidebar (left, right), nav (list, grid), corners (sharp, soft, round), buttons (both, icons, text); only what's asked.`,
    `"css" is optional, only for what tokens can't do: under ${CUSTOM_CSS_MAX.toLocaleString()} characters, no @import, no !important, url() only for data: images. Start each selector with :root[data-custom] so it beats the base theme. Parts: ${CSS_PARTS}.`,
    "Reply with one code block marked json, shaped like this, and nothing after it. No other fields.",
    "```json\n" + `{"name":"Navy and gold","base":"default","scheme":"dark","tokens":{"--bg":"#0b1222","--surface":"#121b30","--accent":"#d8b25a","--on-accent":"#1a1408"},"layout":{"corners":"sharp"},"css":""}` + "\n```",
  ].join("\n\n");

  return {
    prompt,
    shares: ["What you typed", "The theme settings gachamod understands, with the colours of the theme showing now (nothing about your mods or files)"],
    read(reply) {
      if (!reply || typeof reply !== "object" || Array.isArray(reply)) throw new ReplyError("The answer should be one theme object.");
      const extra = Object.keys(reply).filter((k) => !FIELDS.includes(k));
      if (extra.length) throw new ReplyError(`The theme has fields that weren't asked for: ${extra.join(", ")}.`);
      const { theme, problems } = validateCustomTheme(reply);
      if (!theme) throw new ReplyError(problems[0] ?? "That isn't a theme.");
      const game = currentGame();
      const base = THEMES.find((b) => b.id === theme.base)?.name ?? theme.base;
      const lay = Object.entries(theme.layout);
      return {
        summary: `${theme.name}, on ${base}`,
        rows: [
          { title: "Colours and sizes", lines: Object.entries(theme.tokens).map(([k, v]) => ({ label: k, after: v })) },
          ...(lay.length ? [{ title: "Layout", lines: lay.map(([k, v]) => ({ label: k, after: String(v) })) }] : []),
          ...(theme.css ? [{ title: "Extra CSS", lines: [{ label: "CSS", after: plural(theme.css.split("\n").length, "line") }] }] : []),
        ],
        skipped: problems,
        text: [],
        links: [],
        apply: async () => {
          const t = await saveTheme(theme, true, game);
          return [`Saved the theme ${t.name}`, game ? `Using it for ${game.name}. Change it in Settings, Appearance` : "Pick it for a game in Settings, Custom themes"];
        },
      };
    },
  };
}
