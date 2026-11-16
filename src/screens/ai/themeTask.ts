// The "theme" task: a custom theme from a description, as full as the built-in game themes. The prompt gives the
// chatbot what it needs without seeing the app: the built-in themes, every token with its value in the theme showing
// now, how the tokens relate, how a game theme is built and a map of the window's parts (lib/theme-anatomy.ts). It is
// too long for a chatbot link, so it is copied for the user to paste. The chatbot answers with a json block (name,
// base, scheme, tokens, layout) and a css block with the stylesheet; a long stylesheet can come in several css blocks
// over several answers, pasted one after another. lib/theme.ts validateCustomTheme checks it all and scopeCss scopes
// every rule to the theme, so the chatbot writes plain `.btn { }` rules. Anything that can't be used is listed as
// skipped. Applying saves the theme and uses it for the current game, with Undo.
// Owner: SETTINGS/AI area.
import type { AiTask } from "../../lib/ai";
import { currentGame } from "../../lib/store";
import { CUSTOM_CSS_MAX, THEMES, THEME_TOKENS, themeState, validateCustomTheme } from "../../lib/theme";
import { THEME_ANATOMY, anatomyText } from "../../lib/theme-anatomy";
import { plural } from "../../ui/kit";
import { saveTheme } from "../settings/customThemes";
import { ReplyError } from "./reply";
import type { Built, TaskInput } from "./tasks";
import { CUT_NOTE, parseThemeReply } from "./themeReply";

const FIELDS = ["name", "base", "scheme", "tokens", "layout", "css"];

/** The fonts the app carries (styles/fonts.css and the game themes' own), as "Rubik 400-900, Anton 400". */
function fontList(): string {
  const weights = new Map<string, Set<number>>();
  try {
    document.fonts.forEach((f) => {
      const family = f.family.replace(/^["']|["']$/g, "");
      const w = parseInt(f.weight, 10);
      if (!family || !Number.isFinite(w)) return;
      if (!weights.has(family)) weights.set(family, new Set());
      weights.get(family)!.add(w);
    });
  } catch { /* no font list */ }
  return [...weights].sort(([a], [b]) => a.localeCompare(b)).map(([family, ws]) => {
    const l = [...ws].sort((a, b) => a - b);
    const run = l.length > 2 && l.every((w, i) => i === 0 || w - l[i - 1]! === 100);
    return `${family} ${run ? `${l[0]}-${l[l.length - 1]}` : l.join("/")}`;
  }).join(", ");
}

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
  const fonts = fontList();

  const prompt = [
    `Make a theme for gachamod, a Windows app that manages game mods, from this description: "${want}".`,
    "How themes work here: a theme is a base theme, token values, a layout and a stylesheet. The built-in game themes are 60 to 100 KB of CSS each. They define their own materials as custom properties (surfaces, ink, rims, textures made from gradients or inline SVG) and then restyle every part with them: buttons, toggles, chips, tabs, fields, panels, cards, dialogs, menus, toasts, the title bar, the sidebar, page headers, each screen, decoration and motion. Work at that depth. When the description names a style, a material, a game or a mood, give every part in the map below a deliberate look in that style, not just new colours. A small request (\"a pink accent\") only needs tokens.",
    `"base" is the built-in theme it sits on:\n${THEMES.map((t) => `${t.id}: ${t.description}`).join("\n")}\n` +
      `Use "default" unless the description asks for one of those games' looks. The game themes keep drawing their own menus (shapes, textures) under yours, so your CSS would have to override them.`,
    `Showing now: ${nowName} (${now.scheme})${game ? ` for ${game.name}` : ""}${gameAccent ? `, game colour ${gameAccent}` : ""}. Tokens (only these go in "tokens") with their current values. Colours: #hex, rgb(), hsl(), oklch(), color-mix() or var(--token).\n${tokens}`,
    [
      "Token rules:",
      "- --bg-2, --bg, --surface, --surface-2, --surface-3, --raised are one ramp in one hue with small steps: lighter each step in dark; in light --surface is lightest.",
      "- --line and --line-2 sit just past --surface-2. --text, --text-2, --text-3 go strong to faint.",
      "- With --accent also set --on-accent, --accent-soft (accent at 12-18% alpha), --accent-ink (accent readable on --surface) and --ring.",
      "- Keep --ok green, --warn amber, --bad red.",
      "- Contrast at least 7:1 for --text on --bg and --surface, 4.5:1 for --text-3 on --surface and --on-accent on --accent.",
      "- Leave out tokens the description gives no reason to change.",
    ].join("\n"),
    [
      "Stylesheet rules:",
      "- Write a plain stylesheet. gachamod scopes every rule to this theme, so `.btn { }` applies only while the theme is on and beats the base theme's rules. Don't add prefixes.",
      "- `:root` is the window's root element. Declare your materials there as custom properties (`:root { --rim: #4c4c4c; --dots: radial-gradient(circle at 1px 1px, #fff2 .8px, transparent 1px) 0 0 / 4px 4px; }`) and build every part from them. Key light and dark on its attributes: `:root[data-scheme=\"light\"] .panel { }`.",
      "- Use the tokens for colour where they fit, so the palette stays in one place.",
      "- Effects follow the description: gradients, textures, glows and patterns when the look calls for them, flat colour when it doesn't. One accent colour for state (picked, on, the main button). No purple unless asked.",
      "- Nesting, ::before and ::after, @keyframes, @font-face, @media, @supports and @container all work. No @import. url() only takes data: images and fonts; inline SVG works as url(\"data:image/svg+xml,...\") with # written as %23.",
      `- Fonts on hand: ${fonts ? `${fonts}, and ` : ""}Windows fonts like Segoe UI Variable, Bahnschrift, Georgia and Cascadia Mono.`,
      "- Icons are inline SVG drawn with currentColor: colour them with color, thicken them with stroke-width.",
      "- Keep every state clear: :hover, :active, :disabled, .on (picked), and a visible :focus-visible ring on anything you can press (people use the keyboard and game controllers).",
      "- Motion is short (80 to 300 ms). Under :root[data-motion=\"reduced\"] stop every animation and transition you add.",
      "- Keep the layout working: don't hide or move controls, and don't change the shell's grid, sizes or positions beyond padding, borders, corners and gaps. The layout field moves the sidebar and sets density.",
      "- A few sizes are set inline (.gbadge, .avatar, .spin, icons in toasts, where menus open): change those with !important or leave them. Everything else needs no !important.",
      "- If \"scheme\" is system, style dark and light both.",
      `- At most ${CUSTOM_CSS_MAX.toLocaleString("en-US")} characters.`,
    ].join("\n"),
    `Parts of the window:\n${anatomyText()}`,
    `Reply with a json code block, then a css code block with the whole stylesheet, and nothing after them. "scheme" is dark, light or system. "layout" may set density (compact, cozy, roomy), sidebar (left, right), nav (list, grid), corners (sharp, soft, round), buttons (both, icons, text), only what's asked. If you run out of room, end the css block after a complete rule and say so; when asked to go on, put the rest in a new css block.`,
    "```json\n" + `{"name":"Navy and gold","base":"default","scheme":"dark","tokens":{"--bg":"#0b1222","--surface":"#121b30","--accent":"#d8b25a","--on-accent":"#1a1408"},"layout":{"corners":"sharp"}}` + "\n```",
    "```css\n:root { --gilt: color-mix(in srgb, var(--accent) 55%, transparent); }\n.panel { border: 1px solid var(--gilt); }\n```",
  ].join("\n\n");

  return {
    prompt,
    shares: ["What you typed", "The theme settings gachamod understands, the colours of the theme showing now and the names of the window's parts (nothing about your mods or files)"],
    parse: parseThemeReply,
    read(parsed) {
      const { theme: reply, cut } = parsed as ReturnType<typeof parseThemeReply>;
      if (!reply || typeof reply !== "object" || Array.isArray(reply)) throw new ReplyError("The answer should be one theme object.");
      const extra = Object.keys(reply).filter((k) => !FIELDS.includes(k));
      if (extra.length) throw new ReplyError(`The theme has fields that weren't asked for: ${extra.join(", ")}.`);
      const { theme, problems } = validateCustomTheme(reply);
      if (!theme) throw new ReplyError(problems[0] ?? "That isn't a theme.");
      const game = currentGame();
      const base = THEMES.find((b) => b.id === theme.base)?.name ?? theme.base;
      const lay = Object.entries(theme.layout);
      const reach = theme.css ? partsStyled(theme.css) : null;
      return {
        summary: `${theme.name}, on ${base}`,
        rows: [
          ...(Object.keys(theme.tokens).length ? [{ title: "Colours and sizes", lines: Object.entries(theme.tokens).map(([k, v]) => ({ label: k, after: v })) }] : []),
          ...(lay.length ? [{ title: "Layout", lines: lay.map(([k, v]) => ({ label: k, after: String(v) })) }] : []),
          ...(theme.css && reach ? [{
            title: "Stylesheet",
            lines: [
              { label: "Size", after: `${Math.max(1, Math.round(theme.css.length / 1024))} KB, ${plural(theme.css.split("\n").length, "line")}` },
              ...(reach.styled.length ? [{ label: "Restyles", after: reach.styled.join(", ") }] : []),
              ...(reach.left.length ? [{ label: "Left to the base", after: reach.left.join(", ") }] : []),
            ],
          }] : []),
        ],
        skipped: problems,
        cut: cut ? CUT_NOTE : undefined,
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

/** Which areas of the parts map a stylesheet touches (it names one of their classes), and which it leaves alone. */
function partsStyled(css: string): { styled: string[]; left: string[] } {
  const styled: string[] = [], left: string[] = [];
  for (const area of THEME_ANATOMY) {
    const classes = new Set(area.parts.flatMap((p) => [...p.sel.matchAll(/\.([a-z][\w-]*)/gi)].map((m) => m[1]!)));
    if (!classes.size) continue;
    const hit = [...classes].some((c) => new RegExp(`\\.${c.replace(/-/g, "\\-")}(?![\\w-])`).test(css));
    (hit ? styled : left).push(area.name);
  }
  return { styled, left };
}
