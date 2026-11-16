import { describe, expect, it } from "vitest";
import { CutOff, ReplyError } from "./reply";
import { parseThemeReply } from "./themeReply";

const JSON_BLOCK = "```json\n{\"name\":\"Ink\",\"base\":\"default\",\"scheme\":\"dark\",\"tokens\":{},\"layout\":{}}\n```";
const css = (r: { theme: unknown }) => (r.theme as { css?: string }).css;

describe("parseThemeReply", () => {
  it("joins the json block and the css block", () => {
    const r = parseThemeReply(`Here it is.\n\n${JSON_BLOCK}\n\n\`\`\`css\n.btn { color: red; }\n\`\`\`\nEnjoy.`);
    expect(r.cut).toBe(false);
    expect((r.theme as { name: string }).name).toBe("Ink");
    expect(css(r)).toBe(".btn { color: red; }");
  });

  it("still reads a bare JSON answer", () => {
    expect(parseThemeReply("{\"name\":\"Ink\",\"base\":\"default\"}")).toEqual({ theme: { name: "Ink", base: "default" }, cut: false });
  });

  it("keeps a json css field and adds the css blocks after it", () => {
    const r = parseThemeReply("```json\n{\"name\":\"Ink\",\"base\":\"default\",\"css\":\".a { }\"}\n```\n```css\n.b { }\n```");
    expect(css(r)).toBe(".a { }\n\n.b { }");
  });

  it("joins several css blocks, braces inside strings and comments don't count", () => {
    const r = parseThemeReply(`${JSON_BLOCK}\n\`\`\`css\n.a::before { content: "{"; } /* { */\n\`\`\`\nMore:\n\`\`\`css\n.b { color: blue; }\n\`\`\``);
    expect(r.cut).toBe(false);
    expect(css(r)).toBe(".a::before { content: \"{\"; } /* { */\n\n.b { color: blue; }");
  });

  it("applies up to the last whole rule when the answer stops partway", () => {
    const r = parseThemeReply(`${JSON_BLOCK}\n\`\`\`css\n.a { color: red; }\n.b { color: bl`);
    expect(r.cut).toBe(true);
    expect(css(r)).toBe(".a { color: red; }");
  });

  it("marks a css block that never closes as cut even when its rules are whole", () => {
    const r = parseThemeReply(`${JSON_BLOCK}\n\`\`\`css\n.a { color: red; }\n`);
    expect(r.cut).toBe(true);
    expect(css(r)).toBe(".a { color: red; }");
  });

  it("joins a cut answer with the next one that goes on mid-rule", () => {
    const first = `${JSON_BLOCK}\n\`\`\`css\n.a { color: red; }\n.b { color: blue;`;
    const next = "Here's the rest:\n```css\n  border: 0; }\n.c { gap: 0; }\n```";
    const r = parseThemeReply(`${first}\n\n${next}`);
    expect(r.cut).toBe(false);
    expect(css(r)).toBe(".a { color: red; }\n.b { color: blue;\n\nborder: 0; }\n.c { gap: 0; }");
  });

  it("drops the unfinished rule when the next answer starts it over", () => {
    const first = `${JSON_BLOCK}\n\`\`\`css\n.a { color: red; }\n.b { color: bl`;
    const next = "Continuing from .b:\n```css\n.b { color: blue; }\n```";
    const r = parseThemeReply(`${first}\n\n${next}`);
    expect(r.cut).toBe(false);
    expect(css(r)).toBe(".a { color: red; }\n\n.b { color: blue; }");
  });

  it("reads a continuation pasted after a closed fence (Paste the rest)", () => {
    const first = `${JSON_BLOCK}\n\`\`\`css\n.a { color: red; }\n.b { color: bl\n\`\`\``;
    const next = "```css\n.b { color: blue; }\n```";
    const r = parseThemeReply(`${first}\n\n${next}`);
    expect(css(r)).toBe(".a { color: red; }\n\n.b { color: blue; }");
  });

  it("says what's wrong when the json block is missing, cut or broken", () => {
    expect(() => parseThemeReply("```css\n.a { }\n```")).toThrow(ReplyError);
    expect(() => parseThemeReply("```json\n{\"name\":\"In")).toThrow(CutOff);
    expect(() => parseThemeReply("```json\n{\"name\":\n```")).not.toThrow(CutOff);
    expect(() => parseThemeReply("```json\n{\"name\":\n```")).toThrow(ReplyError);
    expect(() => parseThemeReply("   ")).toThrow(ReplyError);
  });
});
