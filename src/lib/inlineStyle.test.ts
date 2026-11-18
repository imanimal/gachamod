// Inline styles from GameBanana HTML. The fixtures are copied from real descriptions and posts (ids in the names);
// the rest try to get something past the filter.
// @ts-expect-error The app's tsconfig loads browser types only, so Node's modules have none here
import * as nodeFs from "node:fs";
import { describe, expect, it } from "vitest";
import { attrStyle, cssColor, inlineStyle } from "./inlineStyle";

const fs = nodeFs as unknown as { readFileSync(file: URL, encoding: "utf8"): string };
const none = { classes: [], style: "" };
/** Every class inlineStyle may return; gb-inline.css (and browse.css for gb-center) styles each one. */
const KNOWN = ["gb-left", "gb-center", "gb-right", "gb-justify", "gb-bold", "gb-regular", "gb-italic", "gb-upright", "gb-under", "gb-strike", "gb-upper", "gb-lower", "gb-caps", "gb-size", "gb-font", "gb-mono", "gb-bg", "gb-border", "gb-bc", "gb-round", "gb-pad", "gb-width"];
const attrs = (o: Record<string, string>) => (k: string) => o[k] ?? null;
/** attrStyle then the element's own style, the way sanitizeHtml calls them. */
const both = (tag: string, a: Record<string, string>, style = "", as = tag) => inlineStyle(`${attrStyle(tag, attrs(a))}; ${style}`, as);

describe("real descriptions", () => {
  it("keeps a bordered box (mod 202093)", () => {
    expect(inlineStyle("padding 4px; border: thin solid #BEBEBE; -moz-border-radius: 5px; -webkit-border-radius-: 5px; border-radius: 5px; font-family: Arial, Helvetica, sans-serif; font-size: 23px; color: #bebebe", "div")).toEqual({
      classes: ["gb-size", "gb-font", "gb-border", "gb-bc", "gb-round"],
      style: "--gbfs: 1.44em; --gbff: Arial, Helvetica, sans-serif; --gbbw: 1px; --gbbs: solid; --gbbc: #bebebe",
    });
  });

  it("drops a layout built on background pictures (mod 193788)", () => {
    expect(inlineStyle("background:url('http://files.gamebanana.com/bitpit/fp-bg.jpg')top center repeat-y; width:483px;", "div")).toEqual(none);
    expect(inlineStyle("background:url('http://files.gamebanana.com/bitpit/fp-features.png') top left no-repeat; background-size:100%; min-height:430px; line-height:27px; color:#000;", "div")).toEqual(none);
    expect(inlineStyle("padding-top:90px; padding-left:190px; padding-bottom:90px;", "div")).toEqual(none);
    expect(inlineStyle("width:100%; overflow:hidden;", "div")).toEqual(none);
  });

  it("keeps alignment but not the padding around it (mod 193788)", () => {
    expect(inlineStyle("padding:10px 22px; text-align:justify;", "p")).toEqual({ classes: ["gb-justify"], style: "" });
    expect(inlineStyle("text-align:right; padding-right:20px;", "p")).toEqual({ classes: ["gb-right"], style: "" });
    expect(inlineStyle("text-align: center;", "div")).toEqual({ classes: ["gb-center"], style: "" });
  });

  it("keeps sizes and capitals, leaves colour to the caller (mods 197237, 208739, 210106, 231179)", () => {
    expect(inlineStyle("text-transform: uppercase; color: rgb(255, 216, 0);", "b")).toEqual({ classes: ["gb-upper"], style: "" });
    expect(inlineStyle("color: red; font-size: 30px;", "p")).toEqual({ classes: ["gb-size"], style: "--gbfs: 1.88em" });
    expect(inlineStyle("color: red; font-size: 20px;", "p")).toEqual({ classes: ["gb-size"], style: "--gbfs: 1.25em" });
    expect(inlineStyle("color: red; font-size: large", "span")).toEqual({ classes: ["gb-size"], style: "--gbfs: 1.13em" });
    expect(inlineStyle("font-size: small;", "span")).toEqual({ classes: ["gb-size"], style: "--gbfs: 0.81em" });
    expect(inlineStyle("font-size: xx-large;", "span")).toEqual({ classes: ["gb-size"], style: "--gbfs: 2em" });
    expect(inlineStyle("color: lime;", "a")).toEqual(none);
  });

  it("keeps a GameBanana font (mod 100239)", () => {
    expect(inlineStyle("font-family:  Verdana", "div")).toEqual({ classes: ["gb-font"], style: "--gbff: Verdana, Geneva, sans-serif" });
  });

  it("ignores text pasted from GameBanana's own page (posts 13033046, 11458669)", () => {
    expect(inlineStyle(`color: rgb(226, 226, 226); font-family: "Open Sans", sans-serif; font-size: 16px;`, "span")).toEqual(none);
    expect(inlineStyle("color: rgb(226, 226, 226); font-family: Open\\ Sans, sans-serif", "span")).toEqual(none);
  });

  it("ignores a zero border on a picture (mod 106241)", () => {
    expect(inlineStyle("border-width:0", "img")).toEqual(none);
  });
});

describe("presentational attributes", () => {
  it("sizes pictures the way gacha mod pages do", () => {
    expect(attrStyle("img", attrs({ width: "30%" }))).toBe("width: 30%");
    expect(both("img", { width: "30%" })).toEqual({ classes: ["gb-width"], style: "--gbw: 30%" });
    expect(both("img", { width: "256", height: "144" })).toEqual({ classes: ["gb-width"], style: "--gbw: 256px" });
    expect(both("img", { width: "100%" })).toEqual({ classes: ["gb-width"], style: "--gbw: 100%" });
    expect(both("img", { width: "1%" })).toEqual({ classes: ["gb-width"], style: "--gbw: 5%" });
    expect(both("img", { width: "90000" })).toEqual(none);
    expect(both("img", { width: "50%" }, "width: 200px")).toEqual({ classes: ["gb-width"], style: "--gbw: 200px" });
  });

  it("reads <font size> and <font face>", () => {
    expect(both("font", { size: "6" }, "", "span")).toEqual({ classes: ["gb-size"], style: "--gbfs: 2em" });
    expect(both("font", { size: "5" }, "", "span")).toEqual({ classes: ["gb-size"], style: "--gbfs: 1.5em" });
    expect(both("font", { size: "+1" }, "", "span")).toEqual({ classes: ["gb-size"], style: "--gbfs: 1.13em" });
    expect(both("font", { size: "3" }, "", "span")).toEqual(none);
    expect(both("font", { face: "IBM Plex Mono, monospace" }, "", "span")).toEqual({ classes: ["gb-mono"], style: "" });
    expect(both("font", { face: "quote-cjk-patch, Inter, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Oxygen, Ubuntu, Cantarell, Open Sans, Helvetica Neue, sans-serif" }, "", "span")).toEqual(none);
    expect(both("font", { face: "Comic Sans MS" }, "", "span")).toEqual({ classes: ["gb-font"], style: "--gbff: 'Comic Sans MS', 'Comic Sans', cursive" });
  });

  it("reads align on blocks only", () => {
    expect(both("p", { align: "right" })).toEqual({ classes: ["gb-right"], style: "" });
    expect(attrStyle("img", attrs({ align: "left" }))).toBe("");
    expect(attrStyle("table", attrs({ align: "center" }))).toBe("");
  });

  it("can't smuggle declarations through face", () => {
    expect(both("font", { face: "Georgia; background: red" }, "", "span")).toEqual(none);
  });
});

describe("what's kept", () => {
  it("reads weight, slant, lines and case", () => {
    expect(inlineStyle("FONT-WEIGHT: BOLD; font-style: italic; text-decoration: underline line-through", "span")).toEqual({ classes: ["gb-bold", "gb-italic", "gb-under", "gb-strike"], style: "" });
    expect(inlineStyle("font-weight: 700", "span").classes).toEqual(["gb-bold"]);
    expect(inlineStyle("font-weight: normal; font-style: normal", "strong").classes).toEqual(["gb-regular", "gb-upright"]);
    expect(inlineStyle("font-weight: 500", "span")).toEqual(none);
    expect(inlineStyle("text-decoration: none", "span")).toEqual(none);
    expect(inlineStyle("text-transform: capitalize", "span").classes).toEqual(["gb-caps"]);
  });

  it("lets the last declaration win", () => {
    expect(inlineStyle("font-weight: bold; font-weight: normal", "span").classes).toEqual(["gb-regular"]);
    expect(inlineStyle("font-size: 30px; font-size: 12pt", "span")).toEqual(none);
    expect(inlineStyle("font-size: 30px !important", "span").style).toBe("--gbfs: 1.88em");
  });

  it("converts sizes to em and keeps them readable", () => {
    expect(inlineStyle("font-size: 150%", "span").style).toBe("--gbfs: 1.5em");
    expect(inlineStyle("font-size: 18pt", "span").style).toBe("--gbfs: 1.5em");
    expect(inlineStyle("font-size: 1.2rem", "span").style).toBe("--gbfs: 1.2em");
    expect(inlineStyle("font-size: 9999px", "span").style).toBe("--gbfs: 2em");
    expect(inlineStyle("font-size: 0", "span").style).toBe("--gbfs: 0.8em");
    expect(inlineStyle("font-size: 2px", "span").style).toBe("--gbfs: 0.8em");
    expect(inlineStyle("font-size: -4px", "span")).toEqual(none);
    expect(inlineStyle("font-size: 1e9px", "span")).toEqual(none);
  });

  it("only takes GameBanana's fonts, else a generic family", () => {
    expect(inlineStyle(`font-family: "Times New Roman", Times, serif`, "span").style).toBe("--gbff: 'Times New Roman', Times, serif");
    expect(inlineStyle("font-family: book antiqua", "span").style).toBe("--gbff: 'Palatino Linotype', 'Book Antiqua', Palatino, serif");
    expect(inlineStyle("font-family: Papyrus, serif", "span").style).toBe("--gbff: serif");
    expect(inlineStyle("font-family: sans-serif", "span")).toEqual(none);
    expect(inlineStyle("font-family: Arial; font-family: Papyrus", "span")).toEqual(none);
  });

  it("keeps plain background colours only", () => {
    expect(inlineStyle("background-color: #ffeb3b", "span")).toEqual({ classes: ["gb-bg"], style: "--gbbg: #ffeb3b" });
    expect(inlineStyle("background: rgb(255, 216, 0)", "div").style).toBe("--gbbg: rgb(255 216 0)");
    expect(inlineStyle("background-color: rgba(0, 0, 0, .5)", "div").style).toBe("--gbbg: rgba(0 0 0 / .5)");
    expect(inlineStyle("background-color: hsl(120deg 50% 40%)", "div").style).toBe("--gbbg: hsl(120deg 50% 40%)");
    expect(inlineStyle("background-color: transparent", "span")).toEqual(none);
    expect(inlineStyle("background-color: rgba(0, 0, 0, 0)", "span")).toEqual(none);
    expect(inlineStyle("background-color: #fff0", "span")).toEqual(none);
    expect(inlineStyle("background: #222 url(https://images.gamebanana.com/a.png)", "div")).toEqual(none);
    expect(inlineStyle("background: linear-gradient(red, blue)", "div")).toEqual(none);
  });

  it("keeps borders up to 4px, per side", () => {
    expect(inlineStyle("border-left: 3px solid #3e8ed0", "div")).toEqual({ classes: ["gb-border", "gb-bc"], style: "--gbbw: 0 0 0 3px; --gbbs: none none none solid; --gbbc: #3e8ed0" });
    expect(inlineStyle("border: 10px dashed red", "div").style).toBe("--gbbw: 4px; --gbbs: dashed; --gbbc: red");
    expect(inlineStyle("border: 1px solid", "td")).toEqual({ classes: ["gb-border"], style: "--gbbw: 1px; --gbbs: solid" });
    expect(inlineStyle("border: 1px", "div")).toEqual(none);
    expect(inlineStyle("border: 1px solid red; border: none", "div")).toEqual(none);
    expect(inlineStyle("border-style: solid; border-width: 1px 2px", "div").style).toBe("--gbbw: 1px 2px; --gbbs: solid");
    expect(inlineStyle("border: 1px groove rgb(1, 2, 3)", "div").style).toBe("--gbbw: 1px; --gbbs: solid; --gbbc: rgb(1 2 3)");
  });

  it("keeps padding and corners only on a box", () => {
    expect(inlineStyle("background: #1e1e1e; padding: 10px 20px; border-radius: 8px", "div")).toEqual({
      classes: ["gb-bg", "gb-round", "gb-pad"],
      style: "--gbbg: #1e1e1e; --gbp: 0.63em 1.25em",
    });
    expect(inlineStyle("border: 1px solid #444; padding: 400px", "div").style).toBe("--gbbw: 1px; --gbbs: solid; --gbbc: #444; --gbp: 1.5em");
    expect(inlineStyle("background: #222; padding: -20px", "div").style).toBe("--gbbg: #222");
    expect(inlineStyle("background: #222; padding: 5%", "div").style).toBe("--gbbg: #222");
    expect(inlineStyle("background: #222; padding-left: 16px", "div").style).toBe("--gbbg: #222; --gbp: 0 0 0 1em");
    expect(inlineStyle("border-radius: 8px; padding: 1em", "div")).toEqual(none);
  });

  it("sizes pictures only", () => {
    expect(inlineStyle("width: 50%", "img").style).toBe("--gbw: 50%");
    expect(inlineStyle("width: 50%", "div")).toEqual(none);
    expect(inlineStyle("width: 50%", "table")).toEqual(none);
    expect(inlineStyle("width: auto", "img")).toEqual(none);
  });

  it("aligns blocks, not inline text", () => {
    expect(inlineStyle("text-align: center", "span")).toEqual(none);
    expect(inlineStyle("text-align: end", "td").classes).toEqual(["gb-right"]);
  });
});

describe("what's dropped", () => {
  const hostile = [
    "background: url(javascript:alert(1))",
    "background-image: url(https://example.com/track.png)",
    "width: expression(alert(1))",
    "behavior: url(evil.htc)",
    "-moz-binding: url(https://example.com/x.xml#y)",
    "position: fixed; top: 0; left: 0; z-index: 99999; width: 100vw; height: 100vh",
    "display: none",
    "float: left; margin: -9999px",
    "transform: scale(50)",
    "font-\\73ize: 99px",
    "font-size: 12px\\; position: fixed",
    "background-color: var(--accent)",
    "background-color: red/* */; position: absolute",
    "width: calc(100% + 400px)",
    "font-size: calc(1em + 100px)",
    "font-size: 20vw",
    "text-align: center}</style><script>alert(1)</script>",
    "border: 1px solid url(x)",
    "background: (red",
    "font-family: x; background: url(evil)",
    "content: 'x'; cursor: url(x), auto",
    "color: red",
    "",
  ];

  it("drops anything outside the list", () => {
    for (const s of hostile) expect(inlineStyle(s, "img"), s).toEqual(none);
  });

  it("never writes anything but --gb custom properties made of plain characters", () => {
    const extra = [
      "font-size: 18px; background: url(x) #fff; border: 2px solid expression(1)",
      "font-family: 'Comic Sans MS'; background-color: #000000aa; border-left: thick double hsl(0 100% 50%)",
      "background: rgb(255,0,0) ; padding: 1px 2px 3px 4px; border: 1px solid; width: 99%",
      ...hostile,
    ];
    for (const s of extra) {
      for (const tag of ["img", "div", "span", "p"]) {
        const out = inlineStyle(s, tag);
        for (const c of out.classes) expect(KNOWN).toContain(c);
        if (out.style) for (const d of out.style.split("; ")) expect(d, s).toMatch(/^--gb[a-z]+: [\w\s.,%#'/()-]+$/);
        expect(out.style).not.toMatch(/url\(|var\(|calc\(|expression|\\|[<>{};]\s*$/i);
      }
    }
  });

  it("handles missing and odd input", () => {
    expect(inlineStyle(null, "div")).toEqual(none);
    expect(inlineStyle(";;;:::", "div")).toEqual(none);
    expect(inlineStyle("font-weight", "div")).toEqual(none);
    expect(inlineStyle(`${"font-size: 16px;".repeat(2000)} font-weight: bold`, "span")).toEqual(none);
  });
});

describe("cssColor", () => {
  it("reads plain colours", () => {
    expect(cssColor("#BEBEBE")).toBe("#bebebe");
    expect(cssColor("rgb(255, 216, 0)")).toBe("rgb(255 216 0)");
    expect(cssColor("lightblue")).toBe("lightblue");
  });
  it("refuses anything else", () => {
    for (const v of ["currentColor", "inherit", "#12", "rgb(1, 2)", "rgb(1, 2, 3, 4, 5)", "rgb(var(--x), 0, 0)", "color(display-p3 1 0 0)", "red blue", "#00000000"]) expect(cssColor(v), v).toBeNull();
  });
});

describe("the stylesheet", () => {
  it("has a rule for every class and variable", () => {
    const css = ["../screens/browse/gb-inline.css", "../screens/browse/browse.css"].map((f) => fs.readFileSync(new URL(f, import.meta.url), "utf8")).join("\n");
    for (const c of KNOWN) expect(css, c).toMatch(new RegExp(`\.gb-desc [^{]*\.${c}(?![\w-])`));
    for (const v of ["--gbfs", "--gbff", "--gbbg", "--gbbw", "--gbbs", "--gbbc", "--gbp", "--gbw"]) expect(css, v).toContain(`var(${v})`);
  });
});
