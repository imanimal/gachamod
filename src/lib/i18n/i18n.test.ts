// Lookups in Russian, which has the most plural forms: plurals pick the right form, backend messages are matched by
// their patterns (alone and inside a longer message), and english() gives the words back.
import { beforeAll, describe, expect, it, vi } from "vitest";
import ru from "./ru.json";
import { BACKEND } from "./backend";

type I18n = typeof import("./index");
let i18n: I18n;
beforeAll(async () => {
  vi.stubGlobal("localStorage", { getItem: () => "ru", setItem: () => {} });
  vi.resetModules();
  i18n = await import("./index");
});

const cat = ru as Record<string, string | Record<string, string>>;
const fillX = (s: string) => s.replace(/\{(\w+)\}/g, "X");

describe("i18n in Russian", () => {
  it("uses the saved language", () => { expect(i18n.lang).toBe("ru"); });

  it("translates a line and gives its English back", () => {
    const shown = i18n.t("Settings");
    expect(shown).toBe(cat.Settings);
    expect(i18n.english(shown)).toBe("Settings");
  });

  it("picks Russian plural forms", () => {
    const [key, forms] = Object.entries(cat).find(([k, v]) => typeof v === "object" && k.includes("{n}") && v.few && v.many) as [string, Record<string, string>];
    const fill = (s: string, n: number) => s.replace("{n}", String(n));
    expect(i18n.tn(1, "one", key)).toBe(fill(forms.one, 1));
    expect(i18n.tn(3, "one", key)).toBe(fill(forms.few, 3));
    expect(i18n.tn(7, "one", key)).toBe(fill(forms.many, 7));
  });

  it("matches backend messages by pattern, alone and inside a longer message", () => {
    const withNames = BACKEND.filter((k) => /\{\w+\}/.test(k) && typeof cat[k] === "string" && /[.!?]$/.test(k));
    expect(withNames.length).toBeGreaterThan(0);
    for (const key of withNames.slice(0, 40)) {
      const msg = key.replace(/\{(\w+)\}/g, "X");
      const got = i18n.tb(msg);
      // a more specific pattern listed earlier may win; either way the message is no longer English
      expect(got, key).not.toBe(msg);
    }
    const [a, b] = withNames;
    const joined = i18n.tb(`${fillX(a)} ${fillX(b)}`);
    expect(joined).toContain(fillX(cat[a] as string));
  });

  it("leaves unknown text alone", () => {
    expect(i18n.tb("Something no pattern knows about 12345")).toBe("Something no pattern knows about 12345");
  });
});
