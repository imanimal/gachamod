// Tests for the GameBanana helpers that don't need a DOM: links, list parsing, update checks.
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildRequest, hasNewerFile, listMods, modPage, parseGbLink } from "./gamebanana";
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
