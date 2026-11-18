// A GameBanana member's name style (Subject Shaper) as CSS for gachamod: their colour moved just far enough to read
// on the current theme, their font, and their text effect. ui/name-style.css draws it. Owner: BROWSE area.
import type { CSSProperties } from "react";
import type { GbNameStyle } from "./gamebanana";
import { contrastOf, readableOn, themeState, tokenHex } from "./theme";

let bgCache: { key: unknown; hex: string } | null = null;
/** The theme's window background as #rrggbb, read again only when the theme changes. */
export function themeBg(): string {
  const key = themeState();
  if (!bgCache || bgCache.key !== key) bgCache = { key, hex: tokenHex("--bg") };
  return bgCache.hex;
}

/** Class names and CSS variables for a name drawn in `style` on `bg`. `min` is the contrast the text needs: 4.5 for
 *  names in running text, 3 for a page title. An outline that reads on `bg` carries the name by itself, so then the
 *  colour stays as they picked it. */
export function nameStyleProps(style: GbNameStyle, bg = themeBg(), min = 4.5): { className: string; style: CSSProperties } {
  const vars: Record<string, string> = {};
  const classes = ["gb-name"];
  const outlined = style.effect === "stroke" && !!style.effectColor && contrastOf(style.effectColor, bg) >= 3;
  const fit = (c: string) => (outlined ? c : readableOn(c, bg, min));
  if (style.color) { vars["--sh-c"] = fit(style.color); classes.push("has-c"); }
  if (style.hoverColor) { vars["--sh-hc"] = fit(style.hoverColor); classes.push("has-hc"); }
  if (style.font) vars["--sh-font"] = style.font;
  if (style.effect) {
    classes.push(`fx-${style.effect}`);
    if (style.effectColor) vars["--sh-ec"] = style.effectColor;
    if (style.effectHoverColor) vars["--sh-ehc"] = style.effectHoverColor;
  }
  return { className: classes.join(" "), style: vars as CSSProperties };
}
