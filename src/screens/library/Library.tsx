// Mods: the current game's library (Installed) and the mods removed from it (Trash). Installed has search,
// filters, a scrolling row of types and characters, sort, grid or list, and the shared mod grid with selection and its
// bulk bar. The route holds the page: tab "archive", character (only that character's mods), kind (only mods without
// a character of that type), modId (the details drawer). Owner: LIBRARY area (docs/spec.md, "Library").
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { errorText, library, settings, type ModEntry } from "../../lib/api";
import { checkUpdates } from "../../lib/gamebanana";
import { useModHealth } from "../../lib/fixes";
import { usePortraitBatch, portraitNow, usePortraitsVersion } from "../../lib/portraits";
import { useNsfw } from "../../lib/prefs";
import { consumeRoute, go, patchRoute, setBadge, useGame, useRoute } from "../../lib/store";
import { openPalette } from "../../shell/state";
import { menuFor, menuHandler } from "../../ui/ContextMenu";
import { Button, Chip, Empty, IconButton, PageHeader, Segmented, Select, SearchField, formatBytes } from "../../ui/kit";
import { toast } from "../../ui/toast";
import { shuffleOutfits } from "./shuffle";
import { useBackendRoster } from "../characters/roster";
import { rowKeys, useSideScroll } from "../browse/sideScroll";
import { Archive } from "./Archive";
import { useMods } from "./data";
import { LIB_KINDS, libKind, type LibKind } from "./kinds";
import { ModDrawerHost } from "./ModDrawer";
import { ModGrid } from "./ModGrid";
import "./menus";
import "./library.css";

type Filter = "all" | "on" | "off" | "updates" | "favourites" | "problems";
type Sort = "added" | "name" | "character" | "size";
interface Prefs { filter: Filter; sort: Sort; view: "grid" | "list" }
const DEFAULT_PREFS: Prefs = { filter: "all", sort: "added", view: "grid" };
const UPDATE_EVERY = 30 * 60 * 1000;

function loadPrefs(game: string): Prefs {
  try { return { ...DEFAULT_PREFS, ...(JSON.parse(localStorage.getItem(`gm.lib.${game}`) ?? "{}") as Partial<Prefs>) }; }
  catch { return DEFAULT_PREFS; }
}

export function Library() {
  const game = useGame()!;
  const gid = game.id;
  const route = useRoute();
  const { mods, setMods, loaded, scanning, rescan } = useMods(gid);
  const tab = route.tab === "archive" ? "archive" : "installed";
  return (
    <div className="page library">
      {tab === "installed"
        ? <Installed gid={gid} gameName={game.name} mods={mods} setMods={setMods} loaded={loaded} scanning={scanning} rescan={rescan} />
        : <Archive game={gid} tabs={<LibTabs tab={tab} />} />}
      <ModDrawerHost game={gid} mods={mods} loaded={loaded} />
    </div>
  );
}

/** Installed or Trash: a switch, always first in the header's action row (library.css gives that row its own line), so
 *  it stays in the same place on both pages. */
function LibTabs({ tab }: { tab: "installed" | "archive" }) {
  return (
    <Segmented size="sm" label="Show" value={tab} onChange={(v) => patchRoute({ tab: v === "archive" ? "archive" : undefined, modId: undefined, character: undefined, kind: undefined })}
      options={[
        { value: "installed", label: "Installed", icon: "mods", title: "Mods in the Mods folder" },
        { value: "archive", label: "Trash", icon: "trash", title: "Mods you removed, to put back or download again" },
      ]} />
  );
}

function Installed({ gid, gameName, mods, setMods, loaded, scanning, rescan }: {
  gid: string; gameName: string; mods: ModEntry[]; setMods: ReturnType<typeof useMods>["setMods"]; loaded: boolean; scanning: boolean; rescan: (quiet?: boolean) => Promise<void>;
}) {
  const route = useRoute();
  const nsfw = useNsfw();
  const health = useModHealth(gid);
  const roster = useBackendRoster(gid);
  usePortraitsVersion();
  const [prefs, setPrefsState] = useState<Prefs>(() => loadPrefs(gid));
  const [search, setSearch] = useState(() => route.search ?? "");
  const modsRef = useRef(mods);
  modsRef.current = mods;
  const character = route.character ?? null;
  const kind = LIB_KINDS.some((k) => k.value === route.kind) ? route.kind as LibKind : null;

  useEffect(() => { setPrefsState(loadPrefs(gid)); }, [gid]);
  const setPrefs = useCallback((p: Partial<Prefs>) => {
    setPrefsState((old) => {
      const next = { ...old, ...p };
      try { localStorage.setItem(`gm.lib.${gid}`, JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  }, [gid]);

  // a route's search fills the box once
  useEffect(() => { if (route.search) { setSearch(route.search); consumeRoute(["search"]); } }, [route.search]);

  // update check: on open and every 30 minutes while open
  useEffect(() => {
    if (!loaded) return;
    let live = true;
    const run = async () => {
      try {
        if ((await settings.get("updates.check")) === "0") return;
        const ids = await checkUpdates(modsRef.current);
        if (!live) return;
        await library.markUpdates(gid, ids);
        if (!live) return;
        const want = new Set(ids);
        setMods((l) => l.map((m) => (m.updateAvailable === want.has(m.id) ? m : { ...m, updateAvailable: want.has(m.id) })));
        setBadge("library", ids.length ? { count: ids.length, tone: "accent" } : null);
      } catch { /* offline: try again next time */ }
    };
    void run();
    const t = window.setInterval(() => void run(), UPDATE_EVERY);
    return () => { live = false; window.clearInterval(t); };
  }, [loaded, gid, setMods]);

  // ── what is shown ──

  const icons = useMemo(() => new Map((roster ?? []).map((c) => [c.name.toLowerCase(), c.icon])), [roster]);
  const charRow = useMemo(() => {
    const counts = new Map<string, { name: string; n: number }>();
    for (const m of mods) {
      if (!m.character) continue;
      const k = m.character.toLowerCase();
      const c = counts.get(k) ?? { name: m.character, n: 0 };
      c.n++;
      counts.set(k, c);
    }
    return [...counts.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  }, [mods]);
  usePortraitBatch(gid, charRow.map((c) => c.name));
  // mods without a character by type, and how many of each type there are
  const kinds = useMemo(() => new Map(mods.filter((m) => !m.character).map((m) => [m.id, libKind(m)])), [mods]);
  const kindRow = useMemo(() => LIB_KINDS.map((k) => ({ ...k, n: [...kinds.values()].filter((v) => v === k.value).length })).filter((k) => k.n > 0), [kinds]);

  const isProblem = useCallback((m: ModEntry) => m.conflicts > 0 || m.iniCount === 0 || health.get(m.id)?.status === "broken" || health.get(m.id)?.status === "unfixable", [health]);
  const counts = useMemo(() => ({
    all: mods.length, on: mods.filter((m) => m.enabled).length, off: mods.filter((m) => !m.enabled).length,
    updates: mods.filter((m) => m.updateAvailable).length, favourites: mods.filter((m) => m.favorite).length,
    problems: mods.filter(isProblem).length,
  }), [mods, isProblem]);

  const shown = useMemo(() => {
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const ch = character?.toLowerCase();
    const out = mods.filter((m) => {
      if (m.nsfw && nsfw === "hide") return false;
      switch (prefs.filter) {
        case "on": if (!m.enabled) return false; break;
        case "off": if (m.enabled) return false; break;
        case "updates": if (!m.updateAvailable) return false; break;
        case "favourites": if (!m.favorite) return false; break;
        case "problems": if (!isProblem(m)) return false; break;
        default: break;
      }
      if (ch && m.character?.toLowerCase() !== ch) return false;
      if (kind && kinds.get(m.id) !== kind) return false;
      if (!words.length) return true;
      const hay = [m.name, m.character ?? "", m.tags.join(" "), m.source?.submitter ?? "", m.folder].join(" ").toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    const byName = (a: ModEntry, b: ModEntry) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
    out.sort(
      prefs.sort === "name" ? byName
      : prefs.sort === "character" ? (a, b) => (a.character ?? "￿").localeCompare(b.character ?? "￿") || byName(a, b)
      : prefs.sort === "size" ? (a, b) => b.sizeBytes - a.sizeBytes || byName(a, b)
      : (a, b) => b.installedAt - a.installedAt || byName(a, b));
    return out;
  }, [mods, prefs, search, nsfw, character, kind, kinds, isProblem]);

  const filtersOn = prefs.filter !== "all" || !!character || !!kind || !!search.trim();
  const size = useMemo(() => mods.reduce((n, m) => n + m.sizeBytes, 0), [mods]);
  const setCharacter = (c: string | null) => patchRoute({ character: c ?? undefined, kind: undefined });
  const setKind = (k: LibKind | null) => patchRoute({ kind: k ?? undefined, character: undefined });

  const filterChips: Array<{ id: Filter; label: string; title?: string }> = [
    { id: "all", label: "All" }, { id: "on", label: "On" }, { id: "off", label: "Off" },
    { id: "updates", label: "Updates", title: "Mods with a newer version on GameBanana" },
    { id: "favourites", label: "Favourites" },
    { id: "problems", label: "Problems", title: "Mods that conflict with another mod that is on, have no .ini file, or were broken by a game update" },
  ];

  return (
    <>
      <PageHeader title="My Mods" icon="mods"
        sub={loaded ? `${mods.length === 1 ? "1 mod" : `${mods.length} mods`}, ${counts.on} on, ${formatBytes(size)}` : "Reading the Mods folder"}
        actions={<>
          <LibTabs tab="installed" />
          <SearchField value={search} onChange={setSearch} placeholder="Search name, character, tag, creator" className="library-search" />
          <Button icon="refresh" busy={scanning} onClick={() => void rescan()} title="Reads the Mods folder again for changes made outside gachamod, then checks every mod for updates on GameBanana. Opening this screen only reads the folder">Rescan</Button>
          <IconButton icon="dice" label="Shuffle outfits: one random mod on for each character with two or more. Undo puts them back. It can also happen at each Play (Settings, Mods)"
            onClick={() => void shuffleOutfits(gid).catch((e) => toast(errorText(e), true))} />
          <Segmented size="sm" label="Layout" value={prefs.view} onChange={(v) => setPrefs({ view: v })}
            options={[{ value: "grid", label: "", icon: "grid", title: "Grid" }, { value: "list", label: "", icon: "list", title: "List" }]} />
        </>}>
        <div className="library-filters">
          {filterChips.map((f) => (
            <Chip key={f.id} on={prefs.filter === f.id} title={f.title} count={f.id === "all" ? undefined : counts[f.id]}
              onClick={() => setPrefs({ filter: f.id })}>{f.label}</Chip>
          ))}
          <span className="grow" />
          <Select<Sort> value={prefs.sort} onChange={(v) => setPrefs({ sort: v })}
            options={[{ value: "added", label: "Recently added" }, { value: "name", label: "Name" }, { value: "character", label: "Character" }, { value: "size", label: "Size" }]} />
        </div>
        {kindRow.length + charRow.length > 0 && <CharRow deps={[kindRow.length, charRow.length, character, kind]}>
          {kindRow.map((k) => (
            <Chip key={k.value} className="char-chip kind-chip" icon={k.icon} count={k.n} on={kind === k.value}
              title={kind === k.value ? `${k.title}. Click again for every mod` : k.title}
              onClick={() => setKind(kind === k.value ? null : k.value)}>{k.label}</Chip>
          ))}
          {kindRow.length > 0 && charRow.length > 0 && <span className="library-chars-sep" aria-hidden="true" />}
          {charRow.map((c) => (
            <Chip key={c.name} className="char-chip" img={portraitNow(gid, c.name, icons.get(c.name.toLowerCase()) ?? null)} icon="user" count={c.n}
              on={character?.toLowerCase() === c.name.toLowerCase()} title={`Only ${c.name}'s mods. Right-click for more`}
              onClick={() => setCharacter(character?.toLowerCase() === c.name.toLowerCase() ? null : c.name)}>
              <span onContextMenu={menuHandler(() => menuFor("character", { game: gid, name: c.name }))}>{c.name}</span>
            </Chip>
          ))}
        </CharRow>}
      </PageHeader>

      <ModGrid game={gid} mods={shown} all={mods} setMods={setMods} view={prefs.view} loading={!loaded} icons={icons}
        empty={!mods.length ? (
          <Empty icon="mods" title="No mods yet"
            actions={<>
              <Button variant="primary" icon="browse" onClick={() => go("browse")}>Browse GameBanana</Button>
              <Button icon="refresh" busy={scanning} onClick={() => void rescan()} title="Reads the Mods folder again, for mods put there outside gachamod">Rescan</Button>
            </>}>
            Get mods from Browse, or drop a .zip, .7z or .rar anywhere on this window. If {gameName}'s Mods folder
            already has mods, Rescan picks them up.
          </Empty>
        ) : (
          <Empty icon="search" title="Nothing matches"
            actions={<>
              {filtersOn && <Button onClick={() => { setSearch(""); setPrefs({ filter: "all" }); setCharacter(null); }}>Clear filters</Button>}
              {nsfw === "hide" && mods.some((m) => m.nsfw) && <Button icon="eye" onClick={() => go({ view: "settings", section: "set-nsfw" })} title="Settings, Mods">Mods for adults</Button>}
              {search.trim() && <Button variant="ghost" icon="search" onClick={() => openPalette(search.trim())} title="Search pages, settings, GameBanana and the rest (Ctrl+K)">Search everywhere</Button>}
            </>}>
            {nsfw === "hide" && mods.some((m) => m.nsfw) ? "Mods for adults are hidden." : "Try another search or filter."}
          </Empty>
        )} />
    </>
  );
}

/** The row of type and character chips. It scrolls sideways with the mouse wheel, the arrow buttons (shown when it
 *  doesn't fit) and the arrow keys, and keeps the picked chip in view. */
function CharRow({ deps, children }: { deps: unknown[]; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const { left, right, page } = useSideScroll(ref, deps);
  useEffect(() => {
    const el = ref.current, on = el?.querySelector<HTMLElement>(".chip.on");
    if (!el || !on) return;
    const box = el.getBoundingClientRect(), r = on.getBoundingClientRect();
    if (r.left < box.left || r.right > box.right) el.scrollBy({ left: r.left - box.left - (box.width - r.width) / 2, behavior: "smooth" });
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  const arrows = left || right;
  return (
    <div className="library-chars-wrap">
      {arrows && <IconButton size="sm" icon="left" label="Scroll left" disabled={!left} onClick={() => page(-1)} />}
      <div ref={ref} className="library-chars" role="toolbar" aria-label="Types and characters" onKeyDown={(e) => rowKeys(e, ".chip")}>
        {children}
      </div>
      {arrows && <IconButton size="sm" icon="right" label="Scroll right" disabled={!right} onClick={() => page(1)} />}
    </div>
  );
}
