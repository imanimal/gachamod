// Tests for the GameBanana helpers that don't need a DOM: links, list parsing, update checks.
import { afterEach, describe, expect, it, vi } from "vitest";
import { HQ_PASS, buildRequest, characterList, gbLinkTarget, hasNewerFile, hqScore, hqShape, kindOf, listByCreators, listMods, modPage, onCharacters, parseGbLink } from "./gamebanana";
import type { ModEntry } from "./api";

describe("parseGbLink", () => {
  it("reads every link shape", () => {
    expect(parseGbLink("https://gamebanana.com/mods/527935")).toEqual({ modId: 527935 });
    expect(parseGbLink("gamebanana.com/mods/527935/")).toEqual({ modId: 527935 });
    expect(parseGbLink("https://www.gamebanana.com/mods/527935?tab=files#x")).toEqual({ modId: 527935 });
    expect(parseGbLink("https://gamebanana.com/mods/download/527935")).toEqual({ modId: 527935 });
    expect(parseGbLink("https://gamebanana.com/mmdl/1857996,Mod,527935")).toEqual({ modId: 527935, fileId: 1857996 });
    expect(parseGbLink("gachamod:https://gamebanana.com/mmdl/1857996,Mod,527935")).toEqual({ modId: 527935, fileId: 1857996 });
    expect(parseGbLink("gachamod://mod/42/")).toEqual({ modId: 42 });
    expect(parseGbLink("  https://gamebanana.com/mods/7  ")).toEqual({ modId: 7 });
  });
  it("refuses what isn't a mod link", () => {
    expect(parseGbLink("https://gamebanana.com/dl/1857996")).toBeNull();
    expect(parseGbLink("https://gamebanana.com/mods/cats/30305")).toBeNull();
    expect(parseGbLink("https://example.com/mods/5")).toBeNull();
    expect(parseGbLink("")).toBeNull();
  });
});

const index = {
  _aMetadata: { _nRecordCount: 31, _bIsComplete: false, _nPerpage: 30 },
  _aRecords: [
    {
      _idRow: 739901, _sModelName: "Mod", _sName: "severian but black", _sProfileUrl: "https://gamebanana.com/mods/739901",
      _tsDateAdded: 1794558612, _tsDateModified: 1794558612,
      _aPreviewMedia: { _aImages: [{ _sType: "screenshot", _sBaseUrl: "https://images.gamebanana.com/img/ss/mods", _sFile: "a.jpg", _sFile530: "530-90_a.jpg", _wFile530: 530, _hFile530: 510 }] },
      _aSubmitter: { _idRow: 1, _sName: "waveee", _sAvatarUrl: "https://images.gamebanana.com/static/img/defaults/avatar.gif" },
      _aRootCategory: { _sName: "Character Skins", _sProfileUrl: "https://gamebanana.com/mods/cats/30305" },
      _aSubCategory: { _sName: "Severian Lowell", _sProfileUrl: "https://gamebanana.com/mods/cats/50548", _sIconUrl: "https://images.gamebanana.com/x.png" },
      _sInitialVisibility: "warn", _bHasContentRatings: true, _nLikeCount: 2, _nViewCount: 12,
    },
    { _idRow: "not a number" },
    { _idRow: 5, _sModelName: "Tool", _sName: "a tool" },
  ],
};
const chars = [{ _idRow: 50548, _sName: "Severian Lowell", _sIconUrl: "https://images.gamebanana.com/x.png" }];

function stubFetch(routes: Array<[RegExp, unknown]>) {
  const f = vi.fn(async (url: string) => {
    const hit = routes.find(([re]) => re.test(url));
    return { ok: !!hit, status: hit ? 200 : 404, json: async () => hit?.[1] } as Response;
  });
  vi.stubGlobal("fetch", f);
  return f;
}

afterEach(() => vi.unstubAllGlobals());

describe("listMods", () => {
  it("parses cards, skips unknown shapes and names the character", async () => {
    stubFetch([[/Mod\/Index/, index], [/Mod\/Categories\?_idCategoryRow=30305/, chars]]);
    const r = await listMods({ gbGameId: 19567, page: 1, perPage: 30, sort: "newest" });
    expect(r.items).toHaveLength(1);
    const c = r.items[0]!;
    expect(c.character).toBe("Severian Lowell");
    expect(c.category?.id).toBe(50548);
    expect(c.nsfw).toBe(true);
    expect(c.image?.s530).toBe("https://images.gamebanana.com/img/ss/mods/530-90_a.jpg");
    expect(r.complete).toBe(false);
    expect(r.total).toBe(31);
  });
});

const profile = {
  _idRow: 527935, _sName: "Censor Remover", _sProfileUrl: "https://gamebanana.com/mods/527935", _tsDateAdded: 100, _tsDateUpdated: 900,
  _aPreviewMedia: { _aImages: [{ _sBaseUrl: "https://images.gamebanana.com/img/ss/mods", _sFile: "b.jpg", _sFile530: "530-90_b.jpg" }] },
  _aFiles: [
    { _idRow: 2, _sFile: "new.zip", _nFilesize: 10, _tsDateAdded: 800, _sMd5Checksum: "aa", _sAvResult: "clean", _aAnalysisWarnings: { contains_exe: ["x", "y"] } },
    { _idRow: 1, _sFile: "old.zip", _nFilesize: 9, _tsDateAdded: 500, _bIsArchived: true },
  ],
  _aGame: { _idRow: 19567, _sName: "Zenless Zone Zero" },
  _aCategory: { _idRow: 50548, _sName: "Severian Lowell" }, _aSuperCategory: { _idRow: 30305, _sName: "Character Skins" },
  _aContentRatings: { sa: "Skimpy Attire" }, _sInitialVisibility: "warn", _sVersion: "v3", _nUpdatesCount: 2,
};

describe("modPage and queueing", () => {
  it("builds a queue request from the newest file", async () => {
    stubFetch([[/Mod\/527935\/ProfilePage/, profile], [/Mod\/Categories/, chars]]);
    const m = await modPage(527935);
    expect(m?.character).toBe("Severian Lowell");
    expect(m?.files.map((f) => f.id)).toEqual([2, 1]);
    expect(m?.files[0]?.warnings).toEqual(["Has program files (2)"]);
    expect(m?.files[1]?.archived).toBe(true);
    const req = buildRequest("zzz", m!, m!.files[0]!, "abc");
    expect(req.meta.source).toMatchObject({ site: "gamebanana", modId: 527935, fileId: 2, remoteUpdated: 800 });
    expect(req.meta.previewUrl).toBe("https://images.gamebanana.com/img/ss/mods/530-90_b.jpg");
    expect(req.meta.replaces).toBe("abc");
    expect(req.meta.nsfw).toBe(true);
  });
});

describe("hasNewerFile", () => {
  const mod = (remoteUpdated: number | null, fileId: number | null): ModEntry => ({
    id: "x", game: "zzz", name: "x", folder: "x", relPath: "x", path: "x", enabled: true, character: null, group: null,
    source: { site: "gamebanana", modId: 1, fileId, url: "", submitter: null, fileName: null, remoteUpdated },
    version: null, installedAt: 1000, sizeBytes: 0, fileCount: 0, iniCount: 0, preview: null, tags: [], notes: null,
    favorite: false, nsfw: false, hasKeys: false, conflicts: 0, updateAvailable: false,
  });
  it("needs a non-archived file a minute newer", () => {
    expect(hasNewerFile(mod(500, 1), [{ id: 2, added: 600, archived: false }])).toBe(true);
    expect(hasNewerFile(mod(500, 1), [{ id: 2, added: 540, archived: false }])).toBe(false);
    expect(hasNewerFile(mod(500, 1), [{ id: 2, added: 900, archived: true }])).toBe(false);
    expect(hasNewerFile(mod(null, null), [{ id: 2, added: 1100, archived: false }])).toBe(true);
    expect(hasNewerFile(mod(500, 2), [{ id: 2, added: 900, archived: false }])).toBe(false);
  });
});

// ── added with the BROWSE redesign ──

describe("gbLinkTarget", () => {
  it("knows mod and member links", () => {
    expect(gbLinkTarget("https://gamebanana.com/mods/42")).toEqual({ mod: 42 });
    expect(gbLinkTarget("https://gamebanana.com/members/7?x=1")).toEqual({ member: 7 });
    expect(gbLinkTarget("https://gamebanana.com/mods/cats/30305")).toBeNull();
    expect(gbLinkTarget("https://example.com/mods/42")).toBeNull();
  });
});

const rec = (id: number, ageDays: number, likes: number, submitter = 1) => ({
  _idRow: id, _sModelName: "Mod", _sName: `mod ${id}`, _tsDateAdded: Math.floor(Date.now() / 1000 - ageDays * 86400),
  _aSubmitter: { _idRow: submitter, _sName: `member ${submitter}` }, _nLikeCount: likes, _nViewCount: likes * 80, _nPostCount: 0,
});

describe("listMods week and month", () => {
  it("gathers the newest pages until the window ends and sorts by attention", async () => {
    const page1 = { _aMetadata: { _nRecordCount: 400, _bIsComplete: false }, _aRecords: [rec(11, 1, 5), rec(12, 3, 50), rec(13, 6, 20)] };
    const page2 = { _aMetadata: { _nRecordCount: 400, _bIsComplete: false }, _aRecords: [rec(14, 6.5, 80), rec(15, 9, 999)] };
    const f = stubFetch([[/Generic_Game\]=4242.*/, null], [/Mod\/Categories/, []]]);
    f.mockImplementation(async (url: string) => {
      const body = /_nPage=1&/.test(url) ? page1 : /_nPage=2&/.test(url) ? page2 : { _aMetadata: { _bIsComplete: true }, _aRecords: [] };
      return { ok: true, status: 200, json: async () => body } as Response;
    });
    const r = await listMods({ gbGameId: 4242, page: 1, perPage: 30, sort: "week" });
    expect(r.items.map((c) => c.id)).toEqual([14, 12, 13, 11]);
    expect(r.complete).toBe(true);
    // page 3 was never asked for: page 2 already reached mods older than a week
    expect(f.mock.calls.some(([u]) => /_nPage=3&/.test(String(u)))).toBe(false);
  });
});

describe("listByCreators", () => {
  it("merges each member's mods, newest first, without repeats", async () => {
    stubFetch([
      [/Generic_Submitter\]=501/, { _aMetadata: { _bIsComplete: true }, _aRecords: [rec(21, 2, 1, 501), rec(22, 10, 1, 501)] }],
      [/Generic_Submitter\]=502/, { _aMetadata: { _bIsComplete: true }, _aRecords: [rec(23, 1, 1, 502), rec(21, 2, 1, 501)] }],
      [/Mod\/Categories/, []],
    ]);
    const r = await listByCreators([501, 502], { gbGameId: 4343, sort: "newest" });
    expect(r.items.map((c) => c.id)).toEqual([23, 21, 22]);
  });
});

describe("the High quality score", () => {
  const now = 2_000_000_000;
  const mod = (ageHours: number, likes: number, views = likes * 60, featured = false) => ({ likes, views, comments: 0, added: now - ageHours * 3600, featured });
  // zzz in November 2026: the top fifth of outfits is on track for about 400, the median for about 156
  const zzz = { bar: 400, median: 156 };
  it("keeps a day-old mod with 30 likes by a creator whose mods stay under 100 likes out", () => {
    // "Female Seth": 30 likes and 2,390 views at 22 hours; the creator's other mods sit around 88
    expect(hqScore(mod(22.5, 30, 2390), zzz, 88, now)).toBeLessThan(HQ_PASS);
    expect(hqScore(mod(22.5, 30, 2390), zzz, null, now)).toBeLessThan(HQ_PASS);
  });
  it("lets mods that took off through early", () => {
    // 541 likes and 6,269 views in 23 hours by an unknown creator
    expect(hqScore(mod(22.7, 541, 6269), zzz, null, now)).toBeGreaterThanOrEqual(HQ_PASS);
    // 783 likes at three days by a creator whose mods usually do very well
    expect(hqScore(mod(78, 783, 12487), zzz, 1206, now)).toBeGreaterThanOrEqual(HQ_PASS);
  });
  it("trusts a strong record for an hour-old mod, and only a strong one", () => {
    expect(hqScore(mod(1, 2, 50), zzz, 1200, now)).toBeGreaterThanOrEqual(HQ_PASS);
    expect(hqScore(mod(1, 2, 50), zzz, 300, now)).toBeLessThan(HQ_PASS);
    expect(hqScore(mod(1, 2, 50), zzz, null, now)).toBeLessThan(HQ_PASS);
  });
  it("judges month-old mods by their own numbers", () => {
    expect(hqScore(mod(24 * 30, 100, 5000), zzz, 2000, now)).toBeLessThan(HQ_PASS);
    expect(hqScore(mod(24 * 30, 400, 15000), zzz, 50, now)).toBeGreaterThanOrEqual(HQ_PASS);
    // featured helps a mod near the bar
    expect(hqScore(mod(24 * 30, 230, 9000, true), zzz, null, now)).toBeGreaterThan(hqScore(mod(24 * 30, 230, 9000), zzz, null, now));
  });
  it("scales with the game: the same numbers pass in a small game, not in a big one", () => {
    expect(hqScore(mod(24 * 10, 120, 6000), { bar: 150, median: 60 }, null, now)).toBeGreaterThanOrEqual(HQ_PASS);
    expect(hqScore(mod(24 * 10, 120, 6000), { bar: 600, median: 200 }, null, now)).toBeLessThan(HQ_PASS);
  });
  it("collects most attention in the first days", () => {
    expect(hqShape(0)).toBe(0);
    expect(hqShape(1)).toBeGreaterThan(0.4);
    expect(hqShape(1)).toBeLessThan(0.6);
    expect(hqShape(7)).toBeGreaterThan(0.75);
    expect(hqShape(30)).toBeCloseTo(1, 1);
  });
});

describe("kindOf", () => {
  const skin = (name: string, category: string, software?: string[]) => kindOf({ name, root: "Skins", category, isCharacter: true, software });
  it("tells outfits from texture edits", () => {
    expect(skin("Danica Darker Recolor", "Danica")).toBe("texture");
    expect(skin("Claret Eye Recolour", "Claret Flint")).toBe("texture");
    expect(skin("arlecchino makeup", "Arlecchino")).toBe("texture");
    expect(skin("Tanned Xiao", "Xiao")).toBe("texture");
    expect(skin("[Tex] Ellen Joe SHINING ERIDU (FES Animation CM)", "Ellen Joe")).toBe("texture");
    expect(skin("severian but black", "Severian")).toBe("texture");
    expect(skin("Dainsleif with Official 2k Textures", "Dainsleif")).toBe("texture");
    expect(skin("felixstrum's caelus", "Caelus", ["Paint.NET", "Photoshop"])).toBe("texture");
    expect(skin("Velina - Deathblow (New skirt+color)", "Velina Airgid")).toBe("outfit");
    expect(skin("Rina Thicc + Makeup", "Alexandrina Sebastiane")).toBe("outfit");
    expect(skin("Cozy Winter Freminet (+ Serpent Spine Recolour)", "Freminet")).toBe("outfit");
    expect(skin("Purple Sister over Remielle", "Remielle Dan")).toBe("outfit");
    expect(skin("Burnice White", "Burnice White")).toBe("outfit");
    expect(skin("Black Swan", "Black Swan")).toBe("outfit");
    expect(skin("Mysterious Mommy - Remielle - v1.3.1-Full Fix 3.2", "Remielle Dan")).toBe("outfit");
    expect(skin("Alice over Yanfei", "Yanfei", ["Blender", "Paint.NET"])).toBe("outfit");
    expect(skin("Office Velina", "Velina Airgid")).toBe("outfit");
  });
  it("sorts the other categories", () => {
    expect(kindOf({ name: "Censor Remover & No Outlines", root: "Other/Misc", category: null, isCharacter: false })).toBe("tool");
    expect(kindOf({ name: "ZZMI RabbitFX - Glow FX + Censor Remover", root: "Other/Misc", category: null, isCharacter: false })).toBe("tool");
    expect(kindOf({ name: "Tsaritsa's Gown", root: "Other/Misc", category: null, isCharacter: false })).toBe("other");
    expect(kindOf({ name: "Belle's Shelf - Toy Collection [1.2 FIXED]", root: "Other/Misc", category: null, isCharacter: false })).toBe("other");
    expect(kindOf({ name: "Zenless Reshade Zero [CompleteRT][UI FIX 1.1]", root: "Other/Misc", category: null, isCharacter: false })).toBe("tool");
    expect(kindOf({ name: "Banner Filter v3.1", root: "UI", category: null, isCharacter: false })).toBe("ui");
    expect(kindOf({ name: "Polar Star over Aqua Simulacra", root: "Skins", category: "Bows", isCharacter: false })).toBe("weapon");
    expect(kindOf({ name: "Eous Drip", root: "Bangboo Skins", category: "Eous", isCharacter: false })).toBe("other");
    expect(kindOf({ name: "Odette Skill Gooner Mod", root: "Objects", category: null, isCharacter: false })).toBe("other");
  });
});

describe("the character list", () => {
  it("fetches again when a mod names a character it lacks", async () => {
    // the list from the listMods test is kept; ten minutes later a mod shows a new character
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 11 * 60_000);
    const grown = [...chars, { _idRow: 60001, _sName: "Somebody New", _sIconUrl: "https://images.gamebanana.com/y.png" }];
    const f = stubFetch([[/Mod\/527937\/ProfilePage/, { ...profile, _idRow: 527937, _aCategory: { _idRow: 60001, _sName: "Somebody New" } }], [/Mod\/Categories\?_idCategoryRow=30305/, grown]]);
    const heard: string[] = [];
    const off = onCharacters((g) => heard.push(g));
    const m = await modPage(527937);
    expect(m?.character).toBe("Somebody New");
    await new Promise((r) => setTimeout(r, 0));
    off();
    vi.useRealTimers();
    expect(f.mock.calls.some(([u]) => /Mod\/Categories\?_idCategoryRow=30305/.test(String(u)))).toBe(true);
    expect(heard).toEqual(["zzz"]);
    expect((await characterList("zzz")).map((c) => c.name)).toContain("Somebody New");
  });
});
