import { describe, expect, it } from "vitest";
import { contrastOf } from "./theme-info";
import { cssRules, uberScheme, uberTheme, uberVars, type UberTheme } from "./uberstyle";

// Trimmed from real Uberstyles (Member/UiConfig's _sUberstyleUrl), keeping the rules that matter here and the
// mistakes they shipped with (a missing semicolon, an invalid `solid #161616`, GameBanana's defaults copied in).

/** A Steam look done with GameBanana's variables and see-through modules. */
const STEAM = `:root
{
	--AuxiliaryColumnBackground: transparent;
	--BodyBackground: #000000 url("https://files.gamebanana.com/bitpit/steam_bg.png") top center no-repeat fixed;
	--DefaultTextFontFamily: "Motiva Sans", Arial, Helvetica, sans-serif;
	--DefaultTextColor: #969696;
	--LinkColor: #FFFFFF;
	--LinkHoverColor: #56A1CC;
}
#SiteLogo:after { content: url("https://files.gamebanana.com/bitpit/steam_gb.png") !important; }
#SubNavigator, #HeadlineWrapper overlay { background: #171A21; }
#ContentGrid { background: linear-gradient(to right, rgba(109, 38, 44, 0.301), rgba(50, 255, 193, 0.103)); }
.PageModule>h2, .PageModule>.Content { backdrop-filter: blur(15px); background: rgba( 0, 0, 0, 0.3 ); border-radius: 3px; padding: 6px 9px; }
.PageModule>h2 { color: #FFFFFF; }
.PageModule { border-right: var(--AuxiliaryColumnBorder); }`;

/** A wallpaper GIF under a deep red content area. */
const WALLPAPER = `
@import url("https://bonkmaykrq.github.io/gbubers/snippets/cursor.css");
:root{
    --DefaultTextFontFamily: "Open Sans", sans-serif;
    --BodyWrapperBackground: rgba(64,107,75,0.00);
    --DefaultTextColor: #31cebd;
    --DefaultGreyColor: #31cebd;
    --LinkColor: #a5a5d6;
    --LinkHoverColor: #8cff52;
    --PageTitleColor: rgba(66,18,1,0.00);
    --InputBackgroundColor: #eebab9
    --ButtonBackground: #57372e
}
 body {
    background: url(https://i.pinimg.com/originals/b0/d3/72/b0d3728ddd1616ee3903525291f3be60.gif);
    background-size: cover;
    background-repeat: no-repeat;
    background-attachment: fixed;
    background-position: center center;
}
  #MainContent{ background: rgba(66,18,1,0.90); border-radius: 25px; border-style: solid; border-width: 20px; border-color: #eebab9; }
.PageModule>.Content { background: #57372e; border-radius: 50px; }`;

/** Built from a tutorial that pastes GameBanana's whole :root block, defaults and all. */
const TUTORIAL = `/*
This uberstyle is free to use and take snipits from!
*/
:root{
    --DefaultTextFontFamily: "Open Sans", sans-serif;
    /*Obviously, change this if you want to change the color of your default text*/
    --DefaultTextColor: #943131;
    --DefaultGreyColor: #7E5353;
    --LinkColor: #FFE033;
    --LinkHoverColor: #FD70E1;
    --PageTitleColor: white;
}
 body { background: #050101; }
dt { color: #7E5353; }
  #MainContent{
   background-image: url(https://i.postimg.cc/Xq5CPYQm/66e3c283dbcf26724e50c57dbe6f5ae5.jpg);
   background-size: auto;
   background-repeat: repeat;
}
#PageTitle{ font-size: 70px; text-align: center; color: #832020; text-shadow: rgba(100, 100, 100, 0.3) 2px 5px; }
#ContentGrid{ background: solid #161616; }
.PageModule>.Content {
   background-image: linear-gradient(to right,  #161616 , #0D0D0D);
   border-left: 2px solid #B82020;
   border-bottom: 2px solid #B82020;
   border-radius: 8px;
}
b, h2, h3 { background: #161616 !important; text-align: center !important; border-radius: 8px; }
a { color: #7E1414; }
a:hover{ color:#690B3D; }`;

/** Short and flat: a grey page, modules without boxes. */
const FLAT = `body { opacity: 1; background: #171717; font-size: 0.85em; }
#TopNav, #SideNav { background: #1b1b1b !important; }
#BodyWrapper { background: transparent !important; }
.PageModule { background: 0; border: 0; }
column { background: 0 !important; border: 0 !important; }
#SubNavigator li spriteIcon { display: none; }`;

const GRADIENT = `body{
  background: radial-gradient(ellipse at bottom, #351b1b 0%, #0f0909 100%);
}
#BodyWrapper>*{ background: rgba(0,0,0,0.4); border-radius: 10px; backdrop-filter: blur(5px); }
row>*{    box-shadow: inset 0 0 3vh var(--color-red);
  border: 2px solid var(--color-red);}`;

/** Everything lives in sheets it imports, which are never followed. */
const IMPORTS_ONLY = `/* STYLE */
@import url('https://thepsychicmewtwo.github.io/gamebanana-css/mewse-style.css');
/*@import url('');*/
@import url('https://thepsychicmewtwo.github.io/gamebanana-css/mewse-bg.css');`;

/** Written against the profile's <module> elements, with GameBanana variables for the picture. */
const MODULES = `:root{
    --defaultCursor: url("https://files.gamebanana.com/bitpit/normal_85f4a.png"),default !important;
    --BodyBackground: url("https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExYjJ3dGlpN2g1cHA3M2E2NHB6YjVodjVkNHo5Z2hxbTYycmR3a3l6dCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/yNZBiGoV73NUN8Sn14/giphy.gif");
    --BodyWrapperBackground:rgba(0,0,0,0.4);
    --LinkColor:#ff0000;
    --LinkHoverColor:#ff5555;
}
h1, h2, h3 { font-family: daggersquare; }
body { background-size:cover; background-repeat:no-repeat; background-attachment:fixed; background-position:center; }
#BodyWrapper > #MainContent { backdrop-filter: blur(5px); border-bottom:1px solid #ff0000; }
#MainContentWrapper { background:rgba(0,0,0,0.4); border:1px solid #ff0000; border-top:none; border-bottom:none; }
module > h2{ background: #660000; color:#ff6666; border:1px solid red; font-size: 22px !important; font-family: daggersquare !important; }
module > p.Description { background: #660000; color:#cc7777 !important; }
module > div.Content { background: #66000044; color:#ff6666; border:1px solid #ff0000; }`;

/** Its own variables, gradients over a colour, and ornament gradients inside the module boxes. */
const OWN_VARS = `@import url('https://fonts.googleapis.com/css2?family=Black+Ops+One&family=Share+Tech+Mono&display=swap');
:root{
    --DefaultTextFontFamily: "Share Tech Mono", "Courier New", monospace;
    --DefaultTextColor: #b8ffcf;
    --DefaultGreyColor: #3b4a40;
    --LinkColor: #4ade80;
    --LinkHoverColor: #eafff0;
    --PageTitleColor: #d9ffe6;
    --ac-flir: #b8ffcf;          /* white-hot phosphor */
    --ac-green: #4ade80;
    --ac-panel: rgba(2,18,9,0.74);
    --ac-amber: #ffb020;
}
body{
    background-color: #020a05;
    background-image:
        linear-gradient(rgba(74,222,128,0.06) 1px, transparent 1px),
        linear-gradient(90deg, rgba(74,222,128,0.06) 1px, transparent 1px),
        radial-gradient(ellipse at 50% 40%, rgba(74,222,128,0.12), transparent 60%);
    background-size: 44px 44px, 44px 44px, cover;
    background-attachment: fixed;
    background-music: url("https://YOUR-HOST/ac130-ambience.mp3");
}
.PageModule>.Content{
    --b: var(--ac-flir);
    background:
        linear-gradient(var(--b),var(--b)) top left / 16px 2px no-repeat,
        linear-gradient(var(--b),var(--b)) bottom right / 2px 16px no-repeat,
        var(--ac-panel);
    border: 1px solid rgba(74,222,128,0.28);
    border-radius: 0;
}
.PageModule>h2{
    font-family: "Black Ops One", "Impact", sans-serif !important;
    color: var(--ac-flir) !important;
    border-left: 6px solid var(--ac-amber) !important;
}
a{ color: var(--ac-green); }
a:hover{ color: #eafff0; text-shadow: 0 0 8px rgba(74,222,128,0.9); }`;

/** Chinese comments, a font embedded as data, GameBanana's submission cards and long id chains. */
const CARDS = `/* 修正1：用Base64嵌入字体 */
@font-face { font-family: "league_script"; src: url(data:font/truetype;base64,AAEAAAASAQAABAAgRkZUTXSNENEAAQIwAAAAHEdERUY); }
#MainContentHeader #HeadlineWrapper #Headline #PageTitle {
  font-family: "league_script", "微软雅黑", sans-serif !important;
  color: #19cfff !important;
  text-shadow: 0 0 5px rgba(255, 255, 255, 0.9), 0 0 10px rgba(150, 220, 255, 0.8) !important;
}
body.site-gamebanana {
    background: linear-gradient(to bottom, #000000, #333333) !important;
    background-repeat: no-repeat !important;
    background-attachment: fixed !important;
}
#IdentityModule .Content { color: #ffffff !important; }
#SubmissionsList .Record {
  border: 2px solid #87CEEB !important;
  border-radius: 12px !important;
  background-color: rgba(10, 15, 30, 0.8) !important;
}
row > column { background: linear-gradient(to bottom, #000000, #333333) !important; border-radius: 4px; color: white; }
@media (max-width: 600px) { #SubmissionsList .Record > .PreviewWrapper { width: 100% !important; } }
@keyframes twinkle { 0% { opacity: 0.2; } 100% { color: red; } }`;

/** Sky blue behind a wallpaper, with white text. */
const SKY = `:root { --DefaultTextColor: #FFFFFF; --LinkColor: #FFFFFF; }
#BodyWrapper { background: skyblue url('https://files.catbox.moe/rsi2a1.png'); background-size: 100% auto; background-attachment: fixed; background-repeat: repeat-y; }`;

const SAMPLES = { STEAM, WALLPAPER, TUTORIAL, FLAT, GRADIENT, MODULES, OWN_VARS, CARDS, SKY };

const theme = (css: string) => {
  const t = uberTheme(css);
  if (!t) throw new Error("no theme");
  return t;
};

describe("the CSS reader", () => {
  it("reads rules inside @media and @supports and skips the other at-rules", () => {
    const rules = cssRules(`@charset "utf-8"; @import url(x.css);
      @media screen { @supports (display: grid) { a { color: red } } }
      @font-face { font-family: X; src: url(x.woff) } @keyframes k { from { color: blue } }
      b { color: green }`);
    expect(rules.map((r) => [r.selectors, r.nested])).toEqual([[["a"], true], [["b"], false]]);
  });

  it("splits selector lists outside brackets and keeps semicolons inside url()", () => {
    const [r] = cssRules(`:is(a, b), c[title="x,y"] { background: #000 url(data:image/png;base64,AAAA) !important; --V: 1 }`);
    expect(r!.selectors).toEqual([":is(a, b)", `c[title="x,y"]`]);
    expect(r!.decls).toEqual([
      { prop: "background", value: "#000 url(data:image/png;base64,AAAA)", important: true },
      { prop: "--V", value: "1", important: false },
    ]);
  });

  it("doesn't let braces and comments inside strings end a rule", () => {
    const rules = cssRules(`a::after { content: "} /* not a comment */ {"; color: red } b { color: blue }`);
    expect(rules.map((r) => r.selectors[0])).toEqual(["a::after", "b"]);
    expect(rules[0]!.decls[1]).toEqual({ prop: "color", value: "red", important: false });
  });
});

describe("uberTheme", () => {
  it("reads GameBanana's variables and see-through modules", () => {
    expect(theme(STEAM)).toEqual({
      background: "#000000",
      image: "https://files.gamebanana.com/bitpit/steam_bg.png",
      imageRepeat: "no-repeat", imageSize: "auto", imagePosition: "top center", imageAttachment: "fixed",
      // the #ContentGrid gradient, as one colour
      content: "#5e5d5234",
      text: "#969696", muted: null, link: "#ffffff", linkHover: "#56a1cc", heading: "#ffffff",
      font: `"Motiva Sans", "Arial", "Helvetica", sans-serif`, headingFont: null,
      panel: "#0000004d", panelBorder: null, panelRadius: 3,
    } satisfies UberTheme);
  });

  it("puts a content colour over the wallpaper and lets later longhands win", () => {
    expect(theme(WALLPAPER)).toMatchObject({
      background: null,
      image: "https://i.pinimg.com/originals/b0/d3/72/b0d3728ddd1616ee3903525291f3be60.gif",
      imageRepeat: "no-repeat", imageSize: "cover", imagePosition: "center center", imageAttachment: "fixed",
      content: "#421201e6",
      text: "#31cebd", muted: "#31cebd", link: "#a5a5d6", linkHover: "#8cff52",
      // an invisible page title colour and GameBanana's default font don't count
      heading: null, font: null,
      panel: "#57372e", panelRadius: 20,
    });
  });

  it("drops GameBanana's own defaults and lets rules beat variables", () => {
    expect(theme(TUTORIAL)).toEqual({
      background: "#050101",
      image: "https://i.postimg.cc/Xq5CPYQm/66e3c283dbcf26724e50c57dbe6f5ae5.jpg",
      imageRepeat: "repeat", imageSize: "auto", imagePosition: null, imageAttachment: null,
      // `background: solid #161616` is invalid, so #ContentGrid adds nothing
      content: null,
      text: "#943131", muted: "#7e5353", link: "#7e1414", linkHover: "#690b3d", heading: "#832020",
      font: null, headingFont: null,
      panel: "#121212", panelBorder: "#b82020", panelRadius: 8,
    } satisfies UberTheme);
  });

  it("keeps a transparent module box as a choice and reads `border: 0` as no border", () => {
    expect(theme(FLAT)).toMatchObject({ background: "#171717", content: null, panel: "#00000000", panelBorder: null, image: null });
  });

  it("stands a gradient in for the page colour", () => {
    expect(theme(GRADIENT)).toMatchObject({ background: "#221212", content: "#00000066", image: null });
  });

  it("is null for a sheet that only imports others", () => {
    expect(uberTheme(IMPORTS_ONLY)).toBeNull();
    expect(uberTheme("")).toBeNull();
    expect(uberTheme("#SiteLogo img { display: none }")).toBeNull();
  });

  it("reads <module> elements and stacks the content layers", () => {
    expect(theme(MODULES)).toMatchObject({
      image: expect.stringMatching(/^https:\/\/media1\.giphy\.com\/.+\/giphy\.gif$/),
      imageSize: "cover", imageRepeat: "no-repeat", imageAttachment: "fixed", imagePosition: "center",
      // #MainContent's 40% black under #MainContentWrapper's 40% black
      content: "#000000a3",
      text: "#ff6666", muted: "#cc7777", link: "#ff0000", linkHover: "#ff5555",
      heading: "#ff6666", headingFont: `"daggersquare"`, font: null,
      panel: "#66000044", panelBorder: "#ff0000",
    });
  });

  it("resolves the sheet's own variables and skips ornaments", () => {
    expect(theme(OWN_VARS)).toMatchObject({
      text: "#b8ffcf", muted: "#3b4a40", link: "#4ade80", linkHover: "#eafff0", heading: "#b8ffcf",
      font: `"Share Tech Mono", "Courier New", monospace`, headingFont: `"Black Ops One", "Impact", sans-serif`,
      panel: "#021209bd", panelBorder: "#4ade8047", panelRadius: 0,
      image: null,
    });
    // the faint green gradients tint #020a05 a little
    expect(contrastOf(theme(OWN_VARS).background!, "#020a05")).toBeLessThan(1.3);
  });

  it("reads submission cards, id chains and font names in any script", () => {
    expect(theme(CARDS)).toMatchObject({
      background: "#1a1a1a", text: "#ffffff", heading: "#19cfff",
      headingFont: `"league_script", "微软雅黑", sans-serif`,
      panel: "#0a0f1ecc", panelBorder: "#87ceeb", panelRadius: 12,
    });
  });
});

describe("hostile sheets", () => {
  it("keeps only https pictures", () => {
    const image = (bg: string) => uberTheme(`body { background: ${bg} }`)?.image ?? null;
    expect(image("url(javascript:alert(1)) #123456")).toBeNull();
    expect(uberTheme("body { background: url(javascript:alert(1)) #123456 }")?.background).toBe("#123456");
    expect(image("url(http://example.com/a.png)")).toBeNull();
    expect(image("url(data:image/png;base64,AAAA)")).toBeNull();
    expect(image("url(//example.com/a.png)")).toBeNull();
    expect(image("url(https://user:pw@example.com/a.png)")).toBeNull();
    expect(image(`url("https://example.com/a.png\\") x")`)).toBeNull();
    expect(image("url(https://example.com/a\\29.png)")).toBeNull();
    expect(image("url(https://example.com/a.png), url(https://example.com/b.png)")).toBe("https://example.com/a.png");
    expect(image("url( 'https://example.com/a b.png' )")).toBeNull();
  });

  it("refuses expressions, escapes and anything that isn't a plain colour", () => {
    expect(uberTheme("a { color: expression(alert(1)) }")).toBeNull();
    expect(uberTheme("a { color: \\72 ed }")).toBeNull();
    expect(uberTheme("a { color: #f/**/00 }")).toBeNull();
    expect(uberTheme("a { color: rgb(calc(1), 0, 0) }")).toBeNull();
    expect(uberTheme("a { color: currentColor }")).toBeNull();
    expect(uberTheme("a { color: #FFA5000 }")).toBeNull();
    expect(uberTheme("a { color: hsl(120deg 100% 25%) }")?.link).toBe("#008000");
  });

  it("drops a var() it can't resolve and survives var loops", () => {
    expect(uberTheme("a { color: var(--nope) }")).toBeNull();
    expect(uberTheme(":root { --a: var(--b); --b: var(--a) } a { color: var(--a) }")).toBeNull();
    const wide = ":root { --a: #fff; " + Array.from({ length: 8 }, (_, i) => `--v${i + 1}: var(--v${i}) var(--v${i}) var(--v${i});`).join(" ").replace("var(--v0) var(--v0) var(--v0)", "var(--a)") + " } a { color: var(--v8) }";
    expect(uberTheme(wide)).toBeNull();
    expect(uberTheme(":root { --c: red } a { color: var(--missing, var(--c)) }")?.link).toBe("#ff0000");
  });

  it("can't be broken out of with braces, quotes or semicolons", () => {
    expect(uberTheme("a { color: red } } } body { background: #222 }")).toMatchObject({ link: "#ff0000", background: "#222222" });
    const t = uberTheme(`.PageModule>.Content { font-family: "x}; body { background: url(https://evil.example/a.png) } y" } body { background: #333 }`);
    expect(t).toMatchObject({ background: "#333333", image: null, font: null });
    expect(uberTheme(`body { font-family: "Arial; color: red", 'Comic Sans MS', <script>, Ari\\al }`)?.font).toBe(`"Comic Sans MS"`);
    expect(uberTheme(`body { font-family: inherit }`)).toBeNull();
    expect(uberTheme(`a { color: red; ; color: ; : blue }`)?.link).toBe("#ff0000");
  });

  it("clamps or refuses huge lengths", () => {
    expect(uberTheme(".PageModule>.Content { border-radius: 999999px }")?.panelRadius).toBe(20);
    expect(uberTheme(".PageModule>.Content { border-radius: 1e9px }")).toBeNull();
    expect(uberTheme("body { background: url(https://example.com/a.png) 99999999px 0 / 1e9px }")).toBeNull();
    expect(uberTheme("body { background-image: url(https://example.com/a.png); background-size: 20000px; background-position: -50000px }")).toMatchObject({ imageSize: null, imagePosition: null });
  });

  it("never follows @import and skips print rules, deep nesting and unclosed blocks safely", () => {
    expect(uberTheme(`@import url("https://evil.example/x.css"); @import "https://evil.example/y.css" screen; body { background: #101010 }`))
      .toMatchObject({ background: "#101010", image: null, link: null });
    expect(uberTheme("@media print { a { color: red } }")).toBeNull();
    const nest = (n: number) => "@media screen { ".repeat(n) + "a { color: red }" + " }".repeat(n);
    expect(uberTheme(nest(4))?.link).toBe("#ff0000");
    expect(uberTheme(nest(5))).toBeNull();
    expect(uberTheme("body { background: #0a0a0a; /* never closed")?.background).toBe("#0a0a0a");
    expect(uberTheme("body { background: #0b0b0b; content: 'unclosed\n a { color: red }")?.background).toBe("#0b0b0b");
  });
});

// ── tokens ──

const SAFE_VALUE = new RegExp([
  String.raw`#[0-9a-f]{6}(?:[0-9a-f]{2})?`,
  String.raw`\d+px`,
  "none",
  String.raw`(?:(?:"[\p{L}\p{N} _-]+"|[a-z-]+)(?:, |$))+`,
  String.raw`linear-gradient\((#[0-9a-f]{6,8}), \1\), url\("https://[^"\s()\\;{}<>]+"\) [a-z0-9%. -]+ / [a-z0-9%. -]+ [a-z -]+ [a-z]+, #[0-9a-f]{6}`,
].map((p) => `^(?:${p})$`).join("|"), "u");

function rgba(h: string): [number, number, number, number] {
  const n = [1, 3, 5, 7].map((i) => parseInt(h.slice(i, i + 2) || "ff", 16));
  return [n[0]!, n[1]!, n[2]!, n[3]! / 255];
}
/** The veil in --uber-bg drawn over a black and a white picture. */
function veilEnds(v: Record<string, string>): string[] {
  const m = /^linear-gradient\((#[0-9a-f]+),/.exec(v["--uber-bg"]!);
  if (!m) return [];
  const [r, g, b, a] = rgba(m[1]!);
  return [0, 255].map((under) => "#" + [r, g, b].map((c) => Math.round(c * a + under * (1 - a)).toString(16).padStart(2, "0")).join(""));
}

describe("uberVars", () => {
  const cases = Object.entries(SAMPLES).flatMap(([name, css]) => (["dark", "light"] as const).map((s) => [name, css, s] as const));

  it.each(cases)("%s in the %s scheme stays readable", (_, css, scheme) => {
    const v = uberVars(theme(css), scheme);
    const on = (fg: string, bgs: string[], min: number) => bgs.forEach((bg) => expect(contrastOf(v[fg]!, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(min));
    const page = v["--uber-bg"]!.startsWith("linear-gradient") ? veilEnds(v) : [v["--bg"]!];
    const all = [...page, v["--bg"]!, v["--surface"]!];
    on("--text", [...all, v["--surface-2"]!], 4.5);
    on("--text-2", all, 4.5);
    on("--text-3", all, 3);
    on("--accent-ink", all, 4.5);
    if (v["--uber-link-hover"]) on("--uber-link-hover", all, 4.5);
    if (v["--uber-heading"]) on("--uber-heading", page, 3);
    on("--line-3", [v["--surface"]!], 3);
  });

  it.each(cases)("%s in the %s scheme writes only plain values", (_, css, scheme) => {
    for (const [k, val] of Object.entries(uberVars(theme(css), scheme))) {
      expect(k).toMatch(/^--[a-z0-9-]+$/);
      expect(val, k).toMatch(SAFE_VALUE);
      expect(val).not.toMatch(/[;{}\\]|expression|javascript|var\(/i);
    }
  });

  it("keeps hostile sheets to plain values too", () => {
    const sheets = [
      `body { background: url("https://example.com/a.png") center / cover no-repeat fixed; color: #fff }`,
      `:root { --LinkColor: red;}} body{background:url(javascript:x)} .PageModule>.Content { font-family: "a\\"b", "c;d" }`,
      `body { font-family: "x" , y ; background: #fff url(https://example.com/x.png?a=1&b=2#frag) }`,
    ];
    for (const css of sheets) {
      const t = uberTheme(css);
      for (const val of Object.values(t ? uberVars(t, "dark") : {})) expect(val).toMatch(SAFE_VALUE);
    }
  });

  it("veils a picture just enough, keeping the member's own veil", () => {
    const alpha = (v: Record<string, string>) => rgba(/^linear-gradient\((#[0-9a-f]+)/.exec(v["--uber-bg"]!)![1]!)[3];
    // white text and links on black need about half; a quarter of the picture always shows unless their veil is
    // thicker. Links in the theme's purple need more than white text does.
    expect(alpha(uberVars(theme(`body { background: #000 url(https://example.com/a.png); color: #fff } a { color: #fff }`), "dark"))).toBeLessThan(0.6);
    expect(alpha(uberVars(theme(`body { background: #000 url(https://example.com/a.png); color: #fff }`), "dark"))).toBeLessThanOrEqual(0.77);
    expect(alpha(uberVars(theme(STEAM), "dark"))).toBeLessThanOrEqual(0.77);
    expect(alpha(uberVars(theme(WALLPAPER), "dark"))).toBeCloseTo(0.9, 2);
    expect(uberVars(theme(WALLPAPER), "dark")["--uber-bg"]).toContain(`url("https://i.pinimg.com/originals/b0/d3/72/b0d3728ddd1616ee3903525291f3be60.gif") center center / cover no-repeat fixed`);
  });

  it("deepens a light page colour behind a picture instead of greying the member's white text", () => {
    const v = uberVars(theme(SKY), "dark");
    expect(v["--text"]).toBe("#ffffff");
    expect(v["--uber-bg"]).toMatch(/, #87ceeb$/);
    expect(uberScheme(theme(SKY), "light")).toBe("dark");
  });

  it("with a picture and no colour, veils it with the theme's own page colour", () => {
    const t = theme(`body { background-image: url(https://example.com/a.png) }`);
    expect(uberVars(t, "dark")["--bg"]).toBe("#0c0e13");
    expect(uberVars(t, "light", { bg: "#fafafa", surface: "#ffffff", text: "#111111" })["--bg"]).toBe("#fafafa");
  });

  it("flips a dark theme for a white page", () => {
    const t = theme("body { background: #ffffff; color: #222222 } a { color: #ffe033 }");
    expect(uberScheme(t, "dark")).toBe("light");
    const v = uberVars(t, "dark");
    expect(v).toMatchObject({ "--bg": "#ffffff", "--text": "#222222", "--accent": "#ffe033", "--uber-bg": "#ffffff" });
    // GameBanana yellow can't be text on white, so the ink darkens; the button fill keeps the colour
    expect(contrastOf(v["--accent-ink"]!, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  it("with only text colours, leaves the page alone and checks them against the theme", () => {
    const v = uberVars(theme("a { color: #000080 } a:hover { color: #ff00ff } h2 { color: #333 }"), "dark");
    expect(Object.keys(v).sort()).toEqual(["--accent", "--accent-ink", "--accent-soft", "--on-accent", "--ring", "--uber-heading", "--uber-link-hover"]);
    expect(contrastOf(v["--accent-ink"]!, "#13161d")).toBeGreaterThanOrEqual(4.5);
    expect(contrastOf(v["--uber-heading"]!, "#0c0e13")).toBeGreaterThanOrEqual(3);
    const custom = uberVars(theme("a { color: #000080 }"), "light", { bg: "#000000", surface: "#000000" });
    expect(contrastOf(custom["--accent-ink"]!, "#000000")).toBeGreaterThanOrEqual(4.5);
  });

  it("gives fonts a fallback and headings the body font when they have none", () => {
    const v = uberVars(theme(`body { font-family: daggersquare } .PageModule>.Content { border-radius: 12px }`), "dark");
    expect(v["--font"]).toBe(`"daggersquare", system-ui, sans-serif`);
    expect(v["--font-display"]).toBe(v["--font"]);
    expect(v).toMatchObject({ "--radius": "12px", "--radius-sm": "8px", "--radius-lg": "14px" });
    expect(uberVars(theme(OWN_VARS), "dark")["--font-display"]).toBe(`"Black Ops One", "Impact", sans-serif`);
  });

  it("draws hidden module boxes as a plain step up from the page", () => {
    const v = uberVars(theme(FLAT), "dark");
    expect(v["--bg"]).toBe("#171717");
    expect(v["--surface"]).not.toBe("#171717");
    expect(v["--uber-bg"]).toBe("#171717");
  });
});
