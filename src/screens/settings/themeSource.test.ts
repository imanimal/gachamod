import { describe, expect, it } from "vitest";
import { readThemeText, themeSettingsText } from "./themeSource";

const THEME = { name: "Night \"blue\"", base: "default", scheme: "dark", tokens: { "--accent": "#ff5c8a", "--bg": "color-mix(in srgb, #000 80%, #123)" }, layout: { density: "compact" } };
const CSS = ":root { --gilt: #c9a; }\n.btn::before { content: \"}\"; }\n/* a { in a comment */\n.panel {\n  border: 1px solid var(--gilt);\n}";
const value = (text: string) => {
  const r = readThemeText(text);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

describe("theme text", () => {
  it("shows one token per line and no stylesheet", () => {
    const text = themeSettingsText({ ...THEME, css: CSS } as typeof THEME);
    expect(text).toContain("\n    \"--accent\": \"#ff5c8a\",\n");
    expect(text).not.toContain("css");
  });

  it("reads its own text back unchanged", () => {
    expect(value(themeSettingsText(THEME))).toEqual(THEME);
  });

  it("reads the one-line JSON with the stylesheet inside", () => {
    expect(value(JSON.stringify({ ...THEME, css: CSS }))).toEqual({ ...THEME, css: CSS });
  });

  it("takes plain CSS after the settings as the stylesheet", () => {
    expect(value(`${themeSettingsText(THEME)}\n\n${CSS}\n`)).toEqual({ ...THEME, css: CSS });
  });

  it("adds CSS after the settings to a css field they have", () => {
    expect(value(`${JSON.stringify({ ...THEME, css: ".a { }" })}\n.b { }`).css).toBe(".a { }\n\n.b { }");
  });

  it("reads a chatbot's fenced json and css blocks", () => {
    expect(value(`\`\`\`json\n${JSON.stringify(THEME)}\n\`\`\`\n\`\`\`css\n${CSS}\n\`\`\``)).toEqual({ ...THEME, css: CSS });
  });

  it("names the line after a missing comma, which says to check the line before", () => {
    // line 6 is "--accent" without its comma, so JSON stops at "--bg" on line 7
    const text = themeSettingsText(THEME).replace("\"#ff5c8a\",", "\"#ff5c8a\"");
    const r = readThemeText(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/line 7\b.*line before/);
  });

  it("says when the settings never close or are missing", () => {
    expect(readThemeText("{ \"name\": \"x\"").ok).toBe(false);
    expect(readThemeText(".btn { }").ok).toBe(false);
    expect(readThemeText("  ").ok).toBe(false);
  });
});
