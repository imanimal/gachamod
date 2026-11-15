import { describe, expect, it } from "vitest";
import { libKind } from "./kinds";

const mod = (name: string, group: string | null = null, tags: string[] = []) => ({ name, folder: name, group, tags });

describe("libKind", () => {
  it("finds shader and fix libraries by name, wherever they sit", () => {
    expect(libKind(mod("RabbitFX"))).toBe("tool");
    expect(libKind(mod("ZZMI RabbitFX - Glow FX + Censor Remover", "OtherMisc"))).toBe("tool");
    expect(libKind(mod("ORFix", "Other"))).toBe("tool");
    expect(libKind(mod("Camera Fix", "OtherMisc"))).toBe("tool");
  });

  it("uses the group folder before the name", () => {
    expect(libKind(mod("Cleaner HUD", "UI"))).toBe("ui");
    expect(libKind(mod("Golden Fang", "Swords"))).toBe("weapon");
    expect(libKind(mod("Something", "W-Engines"))).toBe("weapon");
  });

  it("reads the name when the folder says nothing", () => {
    expect(libKind(mod("Bigger loading screen"))).toBe("ui");
    expect(libKind(mod("Eous plushie", "OtherMisc"))).toBe("other");
    expect(libKind(mod("Build menu icons"))).toBe("ui");
  });

  it("doesn't take version notes for what the mod is", () => {
    expect(libKind(mod("Eous plushie (1.7 Fix)", "OtherMisc"))).toBe("other");
  });
});
