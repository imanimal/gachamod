import { describe, expect, it } from "vitest";
import { parseCardStyle, parseNameStyle } from "./gamebanana";

describe("member name styles", () => {
  it("keeps colours, GameBanana's font and the effect", () => {
    expect(parseNameStyle(
      { _sBorderStyle: "Glow", _sFont: "Courier New", _sTextColor: "#FFC800", _sTextHoverColor: "#00fffb", _sBorderColor: "#f0f", _sBorderHoverColor: "#00ff0080" },
      "https://images.gamebanana.com/img/upic/570e787dd7db9.gif",
    )).toEqual({
      color: "#ffc800",
      hoverColor: "#00fffb",
      font: "'Courier New', monospace",
      effect: "glow",
      effectColor: "#ff00ff",
      effectHoverColor: "#00ff00",
      upic: "https://images.gamebanana.com/img/upic/570e787dd7db9.gif",
    });
  });

  it("maps GameBanana's font names to the fonts it draws", () => {
    expect(parseNameStyle({ _sFont: "Comic Sans" })?.font).toBe("'Comic Sans MS', cursive");
    expect(parseNameStyle({ _sFont: "Book Antique" })?.font).toBe("'Palatino Linotype', 'Book Antiqua', 'Palatino', serif");
    expect(parseNameStyle({ _sFont: "Wingdings" })).toBeNull();
  });

  it("is null for a member who set nothing", () => {
    expect(parseNameStyle(undefined)).toBeNull();
    expect(parseNameStyle({ _sBorderStyle: "none", _sFont: "default", _sTextColor: "" }, "")).toBeNull();
  });

  it("keeps a upic alone (comment posters carry only that)", () => {
    expect(parseNameStyle(undefined, "https://images.gamebanana.com/img/upic/a.png")?.upic).toBe("https://images.gamebanana.com/img/upic/a.png");
  });

  it("drops anything that isn't a plain value", () => {
    expect(parseNameStyle(
      { _sTextColor: "red; position: fixed", _sFont: "x\"; background: url(https://example.com/t.png)", _sBorderStyle: "0 0 9px red" },
      "https://example.com/upic.gif",
    )).toBeNull();
    expect(parseNameStyle(undefined, "http://images.gamebanana.com/img/upic/a.png")).toBeNull();
    expect(parseNameStyle(undefined, "https://images.gamebanana.com.example.com/u.gif")).toBeNull();
    expect(parseNameStyle(undefined, "https://images.gamebanana.com/a\".png")?.upic).toBe("https://images.gamebanana.com/a%22.png");
  });
});

describe("member hover card styles", () => {
  it("reads a Cooltip record", () => {
    expect(parseCardStyle({
      _sBorderStyle: "none", _sFont: "Courier New", _sBoxBorderStyle: "solid", _sBackgroundImageFile: null,
      _sBackgroundImageBaseUrl: "https://images.gamebanana.com/Member/cooltip_bgs",
      _sBackgroundImageUrl: "url(https://images.gamebanana.com/Member/cooltip_bgs/cbg_1382_67e6be3b43d64.png)",
      _sBoxBorderSize: 2, _sBoxBorderColor: "#bb6868",
    })).toEqual({
      font: "'Courier New', monospace", effect: null, effectColor: null, color: null, background: null,
      image: "https://images.gamebanana.com/Member/cooltip_bgs/cbg_1382_67e6be3b43d64.png",
      borderWidth: 2, borderStyle: "solid", borderColor: "#bb6868", link: null, linkHover: null,
    });
  });

  it("builds the picture from its file name and keeps a see-through background", () => {
    const c = parseCardStyle({ _sBackgroundImageFile: "cbg_1.png", _sBackgroundImageBaseUrl: "https://images.gamebanana.com/Member/cooltip_bgs/", _sBackgroundColor: "#11223380" });
    expect(c?.image).toBe("https://images.gamebanana.com/Member/cooltip_bgs/cbg_1.png");
    expect(c?.background).toBe("#11223380");
  });

  it("drops bad borders, pictures and sizes", () => {
    expect(parseCardStyle({ _sBoxBorderStyle: "solid; top: 0", _sBoxBorderSize: 90, _sBackgroundImageUrl: "url(javascript:alert(1))" })).toBeNull();
    expect(parseCardStyle({ _sBoxBorderStyle: "dashed", _sBoxBorderSize: 90 })?.borderWidth).toBe(8);
    expect(parseCardStyle({ _sBackgroundImageFile: "../x.png", _sBackgroundImageBaseUrl: "https://images.gamebanana.com/b" })).toBeNull();
  });
});
