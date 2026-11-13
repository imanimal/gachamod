// Mods: the current game's library. Search, filters, a character row, sort, grid or list, cards that turn mods on
// and off at once (with Undo), multi-select with a bulk bar, the details drawer and Recently removed.
// Owner: LIBRARY area (docs/spec.md, "Library").
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { characters as charactersApi, errorText, library, settings, shell, type Character, type ModEntry } from "../../lib/api";
import { checkUpdates, queueLatest } from "../../lib/gamebanana";
import { consumeRoute, emitApp, go, setBadge, useGame, useRoute } from "../../lib/store";
import { record } from "../../lib/history";
import { Button, Chip, Empty, IconButton, Menu, PageHeader, Segmented, Select, SearchField, Skeleton, formatBytes } from "../../ui/kit";
import { Popover } from "../../ui/Popover";
import { toast } from "../../ui/toast";
import { ModCard } from "./ModCard";
import { ModDrawer } from "./ModDrawer";
import { TrashDialog } from "./TrashDialog";
import { publish, removeMods, toggleMods, useMods } from "./data";
import { useNsfwMode } from "./Preview";
import "./library.css";

type Filter = "all" | "on" | "off" | "updates" | "favourites" | "problems";
type Sort = "added" | "name" | "character" | "size";
interface Prefs { filter: Filter; sort: Sort; view: "grid" | "list"; character: string | null }
const DEFAULT_PREFS: Prefs = { filter: "all", sort: "added", view: "grid", character: null };
const UPDATE_EVERY = 30 * 60 * 1000;

function loadPrefs(game: string): Prefs {
  try { return { ...DEFAULT_PREFS, ...(JSON.parse(localStorage.getItem(`gm.lib.${game}`) ?? "{}") as Partial<Prefs>) }; }
  catch { return DEFAULT_PREFS; }
}

const isProblem = (m: ModEntry) => m.conflicts > 0 || m.iniCount === 0;

export function Library() {
  const game = useGame()!;
  const gid = game.id;
  const route = useRoute();
  const { mods, setMods, loaded, scanning, rescan } = useMods(gid);
  const nsfw = useNsfwMode();
  const [prefs, setPrefsState] = useState<Prefs>(() => loadPrefs(gid));
  const [search, setSearch] = useState(() => route.search ?? "");
  const [chars, setChars] = useState<Character[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawer, setDrawer] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ mod: ModEntry; anchor: HTMLElement } | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const anchor = useRef<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const modsRef = useRef(mods);
  modsRef.current = mods;

  const setPrefs = useCallback((p: Partial<Prefs>) => {
    setPrefsState((old) => {
      const next = { ...old, ...p };
      try { localStorage.setItem(`gm.lib.${gid}`, JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  }, [gid]);

  // portraits for the character row
  useEffect(() => {
    let live = true;
    charactersApi.list(gid).then((c) => { if (live) setChars(c); }).catch(() => {});
    return () => { live = false; };
  }, [gid]);

  // a route can open a mod's details or filter to a character
  useEffect(() => {
    if (route.character) { setPrefs({ character: route.character }); consumeRoute(["character"]); }
    if (route.search) consumeRoute(["search"]);
  }, [route.character, route.search, setPrefs]);
  useEffect(() => {
    if (typeof route.modId === "string" && loaded) {
      if (mods.some((m) => m.id === route.modId)) setDrawer(route.modId);
      consumeRoute(["modId"]);
    }
  }, [route.modId, loaded, mods]);

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

  const charIcons = useMemo(() => new Map(chars.map((c) => [c.name.toLowerCase(), c.icon])), [chars]);
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

  const counts = useMemo(() => ({
    all: mods.length, on: mods.filter((m) => m.enabled).length, off: mods.filter((m) => !m.enabled).length,
    updates: mods.filter((m) => m.updateAvailable).length, favourites: mods.filter((m) => m.favorite).length,
    problems: mods.filter(isProblem).length,
  }), [mods]);

  const shown = useMemo(() => {
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const ch = prefs.character?.toLowerCase();
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
  }, [mods, prefs, search, nsfw]);

  // selection never holds mods that are gone
  useEffect(() => {
    setSelected((s) => {
      if (!s.size) return s;
      const ids = new Set(mods.map((m) => m.id));
      const next = new Set([...s].filter((id) => ids.has(id)));
      return next.size === s.size ? s : next;
    });
  }, [mods]);

  const shownRef = useRef(shown);
  shownRef.current = shown;

  // ── actions ──

  const toggle = useCallback(async (ids: string[], on: boolean) => {
    const prior = modsRef.current;
    const before = new Map(prior.map((m) => [m.id, m.enabled]));
    const want = new Set(ids);
    setMods((l) => l.map((m) => (want.has(m.id) && m.enabled !== on ? { ...m, enabled: on } : m)));
    try {
      const ch = await toggleMods(gid, ids, on, prior);
      // mods the one-skin rule skipped go back to how they were
      const done = new Set(ch.changed.map((m) => m.id));
      setMods((l) => l.map((m) => (want.has(m.id) && !done.has(m.id) && m.enabled !== before.get(m.id) ? { ...m, enabled: before.get(m.id)! } : m)));
    } catch (e) {
      setMods((l) => l.map((m) => (want.has(m.id) ? { ...m, enabled: before.get(m.id) ?? m.enabled } : m)));
      toast(errorText(e), true);
    }
  }, [gid, setMods]);

  const remove = useCallback(async (list: ModEntry[]) => {
    if (!list.length) return;
    try {
      const ch = await removeMods(gid, list);
      if (drawer && ch.removed.includes(drawer)) setDrawer(null);
      setSelected(new Set());
    } catch (e) { toast(errorText(e), true); }
  }, [gid, drawer]);

  const update = useCallback(async (m: ModEntry) => {
    if (!m.source) return;
    try {
      const item = await queueLatest(gid, m.source.modId, m.id);
      if (item) toast(`Downloading the update for ${m.name}`);
      else toast(`Couldn't find a newer file for ${m.name} on GameBanana`, true);
    } catch (e) { toast(errorText(e), true); }
  }, [gid]);

  const moveTo = useCallback(async (m: ModEntry, group: string | null) => {
    const from = m.group;
    try {
      const e = await library.move(gid, m.id, group);
      publish(gid, { changed: [e], removed: [], notes: [] });
      record({
        label: group ? `Moved ${m.name} to ${group}` : `Moved ${m.name} to the Mods folder`,
        undo: async () => { publish(gid, { changed: [await library.move(gid, m.id, from)], removed: [], notes: [] }); },
        redo: async () => { publish(gid, { changed: [await library.move(gid, m.id, group)], removed: [], notes: [] }); },
      });
    } catch (e) { toast(errorText(e), true); }
  }, [gid]);

  const open = useCallback((m: ModEntry, e: MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      setSelected((s) => { const n = new Set(s); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n; });
      anchor.current = m.id;
      return;
    }
    if (e.shiftKey && anchor.current) {
      const ids = shownRef.current.map((x) => x.id);
      const a = ids.indexOf(anchor.current), b = ids.indexOf(m.id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSelected((s) => new Set([...s, ...ids.slice(lo, hi + 1)]));
        return;
      }
    }
    anchor.current = m.id;
    setDrawer(m.id);
  }, []);

  const onToggleCard = useCallback((m: ModEntry, on: boolean) => void toggle([m.id], on), [toggle]);
  const onMenu = useCallback((m: ModEntry, el: HTMLElement) => setMenu({ mod: m, anchor: el }), []);
  const onUpdate = useCallback((m: ModEntry) => void update(m), [update]);

  // keyboard in the grid: arrows move, Space toggles, Delete removes, Ctrl+A selects all, Escape clears
  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const hit = (e.target as HTMLElement).closest<HTMLElement>(".mod-card-hit");
    if (!hit || !gridRef.current) return;
    const idx = Number(hit.dataset.idx ?? -1);
    const m = shown[idx];
    if (!m) return;
    const items = [...gridRef.current.querySelectorAll<HTMLElement>(".mod-card-hit")];
    let cols = 1;
    if (prefs.view === "grid") { const top = items[0]?.getBoundingClientRect().top; cols = Math.max(1, items.filter((x) => x.getBoundingClientRect().top === top).length); }
    const move = (to: number) => { e.preventDefault(); items[Math.max(0, Math.min(items.length - 1, to))]?.focus(); };
    if (e.key === "ArrowRight") move(idx + 1);
    else if (e.key === "ArrowLeft") move(idx - 1);
    else if (e.key === "ArrowDown") move(idx + cols);
    else if (e.key === "ArrowUp") move(idx - cols);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(items.length - 1);
    else if (e.key === " ") { e.preventDefault(); void toggle([m.id], !m.enabled); }
    else if (e.key === "Delete") { e.preventDefault(); void remove(selected.size ? mods.filter((x) => selected.has(x.id)) : [m]); }
    else if (e.key.toLowerCase() === "a" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); setSelected(new Set(shown.map((x) => x.id))); }
    else if (e.key === "Escape" && selected.size) { e.preventDefault(); e.stopPropagation(); setSelected(new Set()); }
  };

  // Delete with a selection works from anywhere on the screen (not while typing or with a window open)
  useEffect(() => {
    if (!selected.size) return;
    const h = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Delete" || document.querySelector(".overlay, .popover")) return;
      const t = e.target as HTMLElement | null;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable) || t?.closest(".mod-grid")) return;
      e.preventDefault();
      void remove(modsRef.current.filter((x) => selected.has(x.id)));
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [selected, remove]);

  const drawerMod = drawer ? mods.find((m) => m.id === drawer) : undefined;
  const picked = mods.filter((m) => selected.has(m.id));
  const filtersOn = prefs.filter !== "all" || !!prefs.character || !!search.trim();
  const size = useMemo(() => mods.reduce((n, m) => n + m.sizeBytes, 0), [mods]);

  const filterChips: Array<{ id: Filter; label: string; title?: string }> = [
    { id: "all", label: "All" }, { id: "on", label: "On" }, { id: "off", label: "Off" },
    { id: "updates", label: "Updates", title: "Mods with a newer version on GameBanana" },
    { id: "favourites", label: "Favourites" },
    { id: "problems", label: "Problems", title: "Mods that conflict with another mod that is on, or have no .ini file" },
  ];

  return (
    <div className="page library">
      <PageHeader title="Mods" icon="mods"
        sub={loaded ? `${mods.length === 1 ? "1 mod" : `${mods.length} mods`}, ${counts.on} on, ${formatBytes(size)}` : "Reading the Mods folder"}
        actions={<>
          <SearchField value={search} onChange={setSearch} placeholder="Search name, character, tag, author" className="library-search" />
          <IconButton icon="trash" label="Recently removed" onClick={() => setTrashOpen(true)} />
          <Button icon="refresh" busy={scanning} onClick={() => void rescan()} title="Read the Mods folder again (it also happens on its own when you open this screen)">Rescan</Button>
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
        {charRow.length > 0 && (
          <div className="library-chars" role="group" aria-label="Characters">
            {charRow.map((c) => (
              <Chip key={c.name} className="char-chip" img={charIcons.get(c.name.toLowerCase()) ?? null} icon="user" count={c.n}
                on={prefs.character?.toLowerCase() === c.name.toLowerCase()}
                onClick={() => setPrefs({ character: prefs.character?.toLowerCase() === c.name.toLowerCase() ? null : c.name })}>
                {c.name}
              </Chip>
            ))}
          </div>
        )}
      </PageHeader>

      {picked.length > 0 && (
        <div className="toolbar library-bulk" role="toolbar" aria-label="Selected mods">
          <span className="library-bulk-n">{picked.length} selected</span>
          <Button size="sm" icon="power" onClick={() => void toggle(picked.map((m) => m.id), true)}>Turn on</Button>
          <Button size="sm" icon="power" onClick={() => void toggle(picked.map((m) => m.id), false)}>Turn off</Button>
          <Button size="sm" icon="export" onClick={() => emitApp({ type: "export-mods", game: gid, modIds: picked.map((m) => m.id) })}>Export</Button>
          <Button size="sm" variant="danger" icon="trash" onClick={() => void remove(picked)} title="Delete key">Remove</Button>
          <span className="grow" />
          <IconButton icon="x" size="sm" label="Clear the selection (Esc)" onClick={() => setSelected(new Set())} />
        </div>
      )}

      {!loaded ? (
        <div className="mod-grid is-loading" aria-busy="true">
          {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="mod-card-skel" />)}
        </div>
      ) : !mods.length ? (
        <Empty icon="mods" title="No mods yet"
          actions={<>
            <Button variant="primary" icon="browse" onClick={() => go("browse")}>Browse GameBanana</Button>
            <Button icon="refresh" busy={scanning} onClick={() => void rescan()}>Rescan</Button>
          </>}>
          Install mods from Browse with one click, or drop a mod archive (.zip, .7z or .rar) anywhere on this window.
          Mods already in {game.name}'s Mods folder show up here after a scan.
        </Empty>
      ) : !shown.length ? (
        <Empty icon="search" title="Nothing matches"
          actions={filtersOn ? <Button onClick={() => { setSearch(""); setPrefs({ filter: "all", character: null }); }}>Clear filters</Button> : undefined}>
          {nsfw === "hide" && mods.some((m) => m.nsfw) ? "NSFW mods are hidden (Settings, Mods)." : "Try another search or filter."}
        </Empty>
      ) : (
        <div ref={gridRef} className={`mod-grid ${prefs.view === "list" ? "is-list" : "cards"}`} onKeyDown={onGridKey}
          onKeyUp={(e) => { if (e.key === " " && (e.target as HTMLElement).closest(".mod-card-hit")) e.preventDefault(); }}>
          {shown.map((m, i) => (
            <ModCard key={m.id} mod={m} index={i} row={prefs.view === "list"} selected={selected.has(m.id)} nsfw={nsfw}
              portrait={m.character ? charIcons.get(m.character.toLowerCase()) ?? null : null}
              onOpen={open} onToggle={onToggleCard} onMenu={onMenu} onUpdate={onUpdate} />
          ))}
        </div>
      )}

      {menu && (
        <Popover anchor={menu.anchor} onClose={() => setMenu(null)} width="16em" label={`${menu.mod.name} actions`}>
          <Menu items={[
            { label: "Details", icon: "info", onClick: () => { setDrawer(menu.mod.id); setMenu(null); } },
            { label: "Open folder", icon: "folder", onClick: () => { void shell.openPath(menu.mod.path).catch((e) => toast(errorText(e), true)); setMenu(null); } },
            menu.mod.character && menu.mod.group?.toLowerCase() !== menu.mod.character.toLowerCase()
              ? { label: `Move to ${menu.mod.character}`, icon: "folder", hint: `Moves the folder into Mods\\${menu.mod.character}`, onClick: () => { void moveTo(menu.mod, menu.mod.character); setMenu(null); } }
              : { label: "Move to character", icon: "folder", disabled: true, hint: menu.mod.character ? "It is already in its character's folder" : "Set its character in the details first", onClick: () => {} },
            { label: "Export as .gachamod", icon: "export", onClick: () => { emitApp({ type: "export-mods", game: gid, modIds: [menu.mod.id] }); setMenu(null); } },
            ...(menu.mod.source ? [{ label: "Open on GameBanana", icon: "external" as const, onClick: () => { void shell.openUrl(menu.mod.source!.url).catch((e) => toast(errorText(e), true)); setMenu(null); } }] : []),
            "-",
            { label: "Remove", icon: "trash", danger: true, hint: "Moves it to Recently removed for 14 days", onClick: () => { void remove([menu.mod]); setMenu(null); } },
          ]} />
        </Popover>
      )}

      {drawerMod && (
        <ModDrawer game={gid} mod={drawerMod} chars={chars} nsfw={nsfw} onClose={() => setDrawer(null)}
          onToggle={onToggleCard} onRemove={(m) => void remove([m])} onUpdate={onUpdate} />
      )}
      {trashOpen && <TrashDialog game={gid} onClose={() => setTrashOpen(false)} />}
    </div>
  );
}
