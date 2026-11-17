// The setup window's look: the same attributes and variables lib/theme.ts puts on <html> in the app, from the look
// src-setup chose (a game named by the download link, or what gachamod last showed; src-setup/src/look.rs).
import { BRAND_ACCENT, darkShade, onColor, THEMES, type Scheme } from "../lib/theme-info";

export interface LookGame { id: string; name: string; short: string; importer: string; accent: string }
export interface Look {
  theme: string;
  scheme?: Scheme | null;
  /** The accent picked for a theme that offers several (an id from THEMES[].accents). */
  accent?: string | null;
  /** Every theme shown all dark or all light (the app's "all themes" choice). */
  full?: boolean;
  motion?: "full" | "reduced";
  vars?: Record<string, string> | null;
  layout?: Record<string, string> | null;
  custom?: { id: string; css: string; layout?: Record<string, string> | null } | null;
  game?: LookGame | null;
  /** Where it came from: asked (--theme), file (the setup's file name), link (where it was downloaded from), app, default. */
  source?: string;
}

const LAYOUT = ["density", "corners", "buttons"];

function systemScheme(): Scheme {
  try { return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"; } catch { return "dark"; }
}

/** The scheme a look shows: its own, else the system's for the Default theme with nothing saved, else the theme's. */
export function schemeOf(look: Look, themeId = look.theme): Scheme {
  const info = THEMES.find((t) => t.id === themeId) ?? THEMES[0]!;
  const want = look.scheme ?? (look.source === "default" ? systemScheme() : info.native);
  return info.schemes.includes(want) ? want : info.native;
}

export function applyLook(look: Look, pick?: { theme?: string; scheme?: Scheme }) {
  const info = THEMES.find((t) => t.id === (pick?.theme ?? look.theme)) ?? THEMES[0]!;
  const own = info.id === look.theme;
  const scheme = pick?.scheme ?? schemeOf(look, info.id);
  const r = document.documentElement;
  r.dataset.theme = info.id;
  r.dataset.scheme = info.schemes.includes(scheme) ? scheme : info.native;
  r.dataset.game = look.game?.id ?? "";
  r.dataset.accent = (own && look.accent) || info.accents?.[0]?.id || "";
  r.dataset.motion = look.motion === "reduced" ? "reduced" : "full";
  if (own && look.full) r.dataset.full = ""; else delete r.dataset.full;
  const accent = look.game?.accent ?? look.vars?.["--game-accent"] ?? BRAND_ACCENT;
  const vars = { "--game-accent": accent, "--game-on-accent": onColor(accent), "--game-accent-dk": darkShade(accent), ...(look.vars ?? {}) };
  for (const [k, v] of Object.entries(vars)) if (k.startsWith("--")) r.style.setProperty(k, v);
  // a custom theme from the app: its CSS and layout, only while its own base theme shows
  const custom = own ? look.custom : null;
  let style = document.getElementById("gm-custom-theme");
  if (custom?.css) {
    if (!style) {
      style = document.createElement("style");
      style.id = "gm-custom-theme";
      // a release build's CSP carries a nonce, which makes the browser ignore 'unsafe-inline' for styles added later
      const nonce = document.querySelector<HTMLStyleElement>("style[nonce]")?.nonce;
      if (nonce) (style as HTMLStyleElement).nonce = nonce;
      document.head.appendChild(style);
    }
    style.textContent = custom.css;
    r.dataset.custom = custom.id;
  } else { style?.remove(); delete r.dataset.custom; }
  const layout = { ...(look.layout ?? {}), ...(custom?.layout ?? {}) };
  for (const k of LAYOUT) { const v = layout[k]; if (typeof v === "string") r.setAttribute(`data-${k}`, v); else r.removeAttribute(`data-${k}`); }
}
