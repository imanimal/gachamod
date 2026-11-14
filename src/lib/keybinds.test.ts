import { describe, expect, it } from "vitest";
import { detectKeybinds } from "./keybinds";
import { KEYBIND_FIXTURES } from "./keybinds.fixtures";

describe("detectKeybinds on the fixtures", () => {
  for (const f of KEYBIND_FIXTURES) {
    it(f.name, () => {
      expect(detectKeybinds(f.html).keys).toEqual(f.expect);
    });
  }
});

describe("detectKeybinds anchors", () => {
  it("marks the heading above the list and leaves the rest of the HTML alone", () => {
    const html = `<p>Intro text.</p><h2>Controls</h2><ul><li>H: toggle jacket</li><li>Y: toggle hat</li></ul>`;
    const r = detectKeybinds(html);
    expect(r.anchor).toBe("gm-keys-1");
    expect(r.html).toBe(`<p>Intro text.</p><h2><span id="gm-keys-1" class="gm-keys-anchor"></span>Controls</h2><ul><li>H: toggle jacket</li><li>Y: toggle hat</li></ul>`);
  });
  it("marks the first key line when there's no heading", () => {
    const r = detectKeybinds(`Some text<br>Ctrl + 1 - top<br>Ctrl + 2 - bottom`);
    expect(r.html).toBe(`Some text<br><span id="gm-keys-1" class="gm-keys-anchor"></span>Ctrl + 1 - top<br>Ctrl + 2 - bottom`);
  });
  it("puts a table's mark inside its first cell", () => {
    const r = detectKeybinds(`<table><tr><td>1</td><td>Hat</td></tr><tr><td>2</td><td>Coat</td></tr></table>`);
    expect(r.html).toBe(`<table><tr><td><span id="gm-keys-1" class="gm-keys-anchor"></span>1</td><td>Hat</td></tr><tr><td>2</td><td>Coat</td></tr></table>`);
  });
  it("gives each separate list its own mark", () => {
    const r = detectKeybinds(`<b>Toggles</b><br>F6 - outfit<br>F7 - hair<br>a<br>b<br>c<br>d<br>e<br>Menu keys:<br>Ctrl+M - open the menu<br>Ctrl+L - lock it`);
    expect(r.keys.length).toBe(4);
    expect(r.html).toContain(`id="gm-keys-1"`);
    expect(r.html).toContain(`id="gm-keys-2"`);
  });
  it("leaves HTML with no keys untouched", () => {
    const html = `<p>Just an outfit. <b>Enjoy</b></p>`;
    expect(detectKeybinds(html)).toEqual({ keys: [], html, anchor: null });
  });
  it("never throws on broken HTML", () => {
    for (const html of ["<", "<b>", "<td>1</td>", "<tr><td>", "&#xFFFFFFF;", "[[[", "((((", "Press", "Ctrl+", "\u0007\u0007"]) {
      expect(() => detectKeybinds(html)).not.toThrow();
    }
  });
});
