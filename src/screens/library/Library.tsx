// Mods: the current game's library (Installed) and the mods removed from it (Trash). Installed has one row of search,
// All/On/Off, sort and layout, then one scrolling row of filters: Updates, Favourites and Problems when there are any,
// then types and characters. Then the shared mod grid with selection and its bulk bar. Only sort and layout are kept;
// the filters reset when the page is left, so Mods always opens on every mod. The route holds the page: tab "archive", character (only that character's mods), kind (only mods without
// a character of that type), modId (the details drawer). Owner: LIBRARY area (docs/spec.md, "Library").
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { errorText, library, settings, type GameState, type ModEntry } from "../../lib/api";
import { canInstallLoader, getReady, pickModsFolder, useSetup } from "../../lib/setup";
import { checkUpdates } from "../../lib/gamebanana";
import { useModHealth } from "../../lib/fixes";
import { holdOn, useHolds } from "../../lib/holds";
import { usePortraitBatch, portraitNow, usePortraitsVersion } from "../../lib/portraits";
import { useNsfw } from "../../lib/prefs";
import { consumeRoute, go, patchRoute, recountMods, useGame, useRoute } from "../../lib/store";
import { openPalette } from "../../shell/state";
import { menuFor, menuHandler, type MenuEntry } from "../../ui/ContextMenu";
import { withoutKeys } from "../../lib/menuHints";
import { Button, Chip, Empty, IconButton, PageHeader, Segmented, Select, SearchField, formatBytes } from "../../ui/kit";
import { toast } from "../../ui/toast";
import { shuffleOutfits, shuffleWhenPref, type ShuffleWhen } from "./shuffle";
import { useBackendRoster } from "../characters/roster";
import { reveal, rowKeys, useRovingTab, useSideScroll } from "../browse/sideScroll";
import { ShowAll, useRowOpen } from "../../ui/ShowAll";
import { Archive } from "./Archive";
import { useMods, type ModsError } from "./data";
import { LIB_KINDS, libKind, type LibKind } from "./kinds";
import { ModDrawerHost } from "./ModDrawer";
import { ModGrid } from "./ModGrid";
import { SideSearch, matcher, upToField, useNarrow } from "./SideSearch";
import { getUpdates } from "./menus";
import { moveInGrid } from "./gridNav";
import { useModsFormat } from "../../lib/theme";
import "./library.css";
import { t, tn } from "../../lib/i18n";
import { charNoun, gameName, gameShort } from "../../lib/games";

type Show = "all" | "on" | "off";
type Flag = "updates" | "favourites" | "problems";
type Sort = "added" | "name" | "character" | "size";
interface Prefs { sort: Sort; view: "grid" | "list" }
const DEFAULT_PREFS: Prefs = { sort: "added", view: "grid" };
const UPDATE_EVERY = 30 * 60 * 1000;

// right-click on Shuffle: when it shuffles by itself, the same choice as in Settings
const SHUFFLE_WHEN: Array<[ShuffleWhen, string, string]> = [
  ["off", t("Only when I click Shuffle"), t("Stopped shuffling outfits")],
  ["play", t("At each Play"), t("Shuffling outfits at each Play")],
  ["day", t("Once a day"), t("Shuffling outfits once a day")],
];
const shuffleMenu = (): MenuEntry[] => {
  const cur = shuffleWhenPref.get();
  return [
    { header: t("Shuffle outfits") },
    ...SHUFFLE_WHEN.map(([v, label, done]): MenuEntry => ({ label, checked: cur === v, onClick: () => void shuffleWhenPref.set(v, done) })),
    "-",
    { label: t("Shuffle settings"), icon: "settings", onClick: () => go({ view: "settings", section: "set-shuffle" }) },
  ];
};

function loadPrefs(game: string): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem(`gm.lib.${game}`) ?? "{}") as Partial<Prefs>;
    return { sort: saved.sort ?? DEFAULT_PREFS.sort, view: saved.view ?? DEFAULT_PREFS.view };
  }
  catch { return DEFAULT_PREFS; }
}

export function Library() {
  const game = useGame()!;
  const gid = game.id;
  const route = useRoute();
  const { mods, setMods, loaded, error, scanning, rescan } = useMods(gid, { showsErrors: true });
  const tab = route.tab === "archive" ? "archive" : "installed";
  // the Mods folder came back (found by the setup watch, picked in Settings): read it again by itself
  const found = !!game.modsDir && !game.modsMissing;
  const notSetUp = error?.kind === "not_set_up";
  useEffect(() => { if (found && notSetUp) void rescan(true); }, [found, notSetUp, game.modsDir, rescan]);
  // the layout picked in Settings, Appearance: a list of characters on the left (chars), and the details docked on
  // the right (panes). Trash keeps its own page
  const format = useModsFormat();
  const side = tab === "installed" && (format === "chars" || format === "panes");
  const docked = side && format === "panes";
  return (
    <div className={`page library${side ? " has-side" : ""}${docked ? " has-pane" : ""}`}>
      {tab === "installed"
        ? <Installed gid={gid} game={game} mods={mods} setMods={setMods} loaded={loaded} error={error} scanning={scanning} rescan={rescan} side={side} />
        : <Archive game={gid} tabs={<LibTabs tab={tab} />} />}
      <ModDrawerHost game={gid} mods={mods} loaded={loaded} docked={docked} />
    </div>
  );
}

/** Installed or Trash: a switch, always first in the header's action row (library.css gives that row its own line), so
 *  it stays in the same place on both pages. */
function LibTabs({ tab }: { tab: "installed" | "archive" }) {
  return (
    <Segmented size="sm" label={t("Show")} value={tab} onChange={(v) => patchRoute({ tab: v === "archive" ? "archive" : undefined, modId: undefined, character: undefined, kind: undefined })}
      options={[
        { value: "installed", label: t("Installed"), icon: "mods", title: t("Mods in the Mods folder") },
        { value: "archive", label: t("Trash"), icon: "trash", title: t("Mods you removed, to put back or download again") },
      ]} />
  );
}

function Installed({ gid, game, mods, setMods, loaded, error, scanning, rescan, side }: {
  gid: string; game: GameState; mods: ModEntry[]; setMods: ReturnType<typeof useMods>["setMods"]; loaded: boolean; error: ModsError | null;
  scanning: boolean; rescan: (quiet?: boolean) => Promise<void>;
  /** Types and characters go in a list down the left instead of a row of chips in the header. */
  side: boolean;
}) {
  const name = gameName(game), short = gameShort(game);
  const route = useRoute();
  const setup = useSetup();
  const nsfw = useNsfw();
  const format = useModsFormat();
  const health = useModHealth(gid);
  const roster = useBackendRoster(gid);
  usePortraitsVersion();
  const [prefs, setPrefsState] = useState<Prefs>(() => loadPrefs(gid));
  const [show, setShow] = useState<Show>("all");
  const [flag, setFlag] = useState<Flag | null>(null);
  const [search, setSearch] = useState(() => route.search ?? "");
  // the box updates at once; the list follows when the typing lets it
  const dSearch = useDeferredValue(search);
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
  // and a route's filter chip ("View updates" on the update check's toast)
  useEffect(() => {
    const f = route.flag;
    if (f === "updates" || f === "favourites" || f === "problems") { setFlag(f); consumeRoute(["flag"]); }
  }, [route.flag]);

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
        recountMods(gid);
      } catch { /* offline: try again next time */ }
    };
    void run();
    const timer = window.setInterval(() => void run(), UPDATE_EVERY);
    return () => { live = false; window.clearInterval(timer); };
  }, [loaded, gid, setMods]);

  // ── what is shown ──

  const icons = useMemo(() => new Map((roster ?? []).map((c) => [c.name.toLowerCase(), c.icon])), [roster]);
  // the filters count only the mods they can show: mods for adults are left out while they are hidden
  const visible = useMemo(() => (nsfw === "hide" ? mods.filter((m) => !m.nsfw) : mods), [mods, nsfw]);
  const charRow = useMemo(() => {
    const counts = new Map<string, { name: string; n: number }>();
    for (const m of visible) {
      if (!m.character) continue;
      const k = m.character.toLowerCase();
      const c = counts.get(k) ?? { name: m.character, n: 0 };
      c.n++;
      counts.set(k, c);
    }
    return [...counts.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  }, [visible]);
  usePortraitBatch(gid, charRow.map((c) => c.name));
  // mods without a character by type, and how many of each type there are
  const kinds = useMemo(() => new Map(visible.filter((m) => !m.character).map((m) => [m.id, libKind(m)])), [visible]);
  const kindRow = useMemo(() => LIB_KINDS.map((k) => ({ ...k, n: [...kinds.values()].filter((v) => v === k.value).length })).filter((k) => k.n > 0), [kinds]);

  const holds = useHolds(gid);
  // a mod whose problems were set aside leaves the filter: ignored ones for good, ones waiting for an update for
  // their game update warnings (health leaves them out already)
  const isProblem = useCallback((m: ModEntry) => holdOn(holds, m)?.kind !== "ignore"
    && (m.conflicts > 0 || m.iniCount === 0 || health.get(m.id)?.status === "broken" || health.get(m.id)?.status === "unfixable"), [health, holds]);
  const counts = useMemo(() => ({
    all: visible.length, on: visible.filter((m) => m.enabled).length, off: visible.filter((m) => !m.enabled).length,
    updates: visible.filter((m) => m.updateAvailable).length, favourites: visible.filter((m) => m.favorite).length,
    problems: visible.filter(isProblem).length,
  }), [visible, isProblem]);
  const onTotal = useMemo(() => mods.filter((m) => m.enabled).length, [mods]);

  const shown = useMemo(() => {
    const words = dSearch.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const ch = character?.toLowerCase();
    const out = mods.filter((m) => {
      if (m.nsfw && nsfw === "hide") return false;
      if (show === "on" && !m.enabled) return false;
      if (show === "off" && m.enabled) return false;
      switch (flag) {
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
  }, [mods, prefs, show, flag, dSearch, nsfw, character, kind, kinds, isProblem]);

  const filtersOn = show !== "all" || !!flag || !!character || !!kind || !!search.trim();
  const size = useMemo(() => mods.reduce((n, m) => n + m.sizeBytes, 0), [mods]);
  const setCharacter = (c: string | null) => patchRoute({ character: c ?? undefined, kind: undefined });
  const setKind = (k: LibKind | null) => patchRoute({ kind: k ?? undefined, character: undefined });

  // shown only while there is something to show (or it is the filter that is on)
  const flagChips = ([
    { id: "problems", label: t("Problems"), icon: "warn", title: t("Mods that conflict with another mod that is on, have no .ini file, or were broken by a game update. Right-click a mod to ignore its problems") },
    { id: "updates", label: t("Updates"), icon: "update", title: t("Mods with a newer version on GameBanana") },
    { id: "favourites", label: t("Favourites"), icon: "star", title: t("Mods you starred") },
  ] as const).filter((f) => counts[f.id] > 0 || flag === f.id);
  const [updating, setUpdating] = useState(false);
  const updateAll = async () => {
    setUpdating(true);
    try { await getUpdates(gid, visible.filter((m) => m.updateAvailable)); } finally { setUpdating(false); }
  };
  const clearFilters = () => { setSearch(""); setShow("all"); setFlag(null); setCharacter(null); };

  // the folder is missing, or nothing could be read and there is no list to fall back on
  // the game's own state counts too, so a folder that went missing hides the old cards before any scan runs
  const gameSaysMissing = !game.modsDir || !!game.modsMissing;
  const notSetUp = error?.kind === "not_set_up" || gameSaysMissing;
  const failed = notSetUp || (!!error && !mods.length);
  const missingText = error?.kind === "not_set_up" ? error.text : game.modsDir
    ? t("{game} has no Mods folder there anymore. Pick it again, or install the mod loader again if it was removed", { game: name })
    : t("{game} has no Mods folder yet. Install its mod loader or pick the folder", { game: name });
  const loader = canInstallLoader(game);
  const failure = !failed ? null : notSetUp ? (
    <Empty icon="folder" title={game.modsDir ? t("Mods folder not found") : t("No Mods folder yet")}
      actions={<>
        <Button variant="primary" icon={loader ? "install" : "search"} busy={setup.running}
          title={loader ? t("Installs XXMI Launcher and {game}'s mod loader, which makes the Mods folder", { game: short }) : t("Looks for {game}'s Mods folder again", { game: short })}
          onClick={() => void getReady(gid).then((ok) => { if (ok) void rescan(true); })}>
          {loader ? t("Install mod loader") : t("Find Mods folder")}
        </Button>
        <Button icon="folder" title={t("Pick {game}'s Mods folder yourself", { game: short })}
          onClick={() => void pickModsFolder(gid).then((ok) => { if (ok) void rescan(true); })}>{t("Pick folder")}</Button>
      </>}>
      {missingText}
    </Empty>
  ) : (
    <Empty icon="warn" title={t("Couldn't read your mods")}
      actions={<Button icon="refresh" busy={scanning} onClick={() => void rescan(true)} title={t("Reads the Mods folder again")}>{t("Try again")}</Button>}>
      {error?.text}
    </Empty>
  );

  // the flag, type and character chips: a row under the header, or the list down the left (side), which the field over
  // it narrows to the names typed
  const sideRef = useRef<HTMLDivElement>(null);
  const narrow = useNarrow(sideRef, side);
  const [find, setFind] = useState("");
  const fits = side && !narrow ? matcher(find) : null;
  const chipCount = flagChips.length + kindRow.length + charRow.length;
  const chipDeps = [flagChips.length, kindRow.length, charRow.length, character, kind, flag];
  const chipsOf = (fl: typeof flagChips, kr: typeof kindRow, cr: typeof charRow) => (
    <>
        {fl.map((f) => (
          <Chip key={f.id} className="char-chip flag-chip" icon={f.icon} count={counts[f.id]} on={flag === f.id}
            title={flag === f.id ? t("{tip}. Click again for every mod", { tip: f.title }) : f.title}
            onClick={() => setFlag(flag === f.id ? null : f.id)}>{f.label}</Chip>
        ))}
        {flag === "updates" && counts.updates > 0 && fl.some((f) => f.id === "updates") && (
          <Button size="sm" icon="downloads" className="lib-update-all" busy={updating} onClick={() => void updateAll()}
            title={t("Download the newest version of every mod with an update")}>{t("Update all ({n})", { n: counts.updates })}</Button>
        )}
        {fl.length > 0 && kr.length + cr.length > 0 && <span className="library-chars-sep" aria-hidden="true" />}
        {kr.map((k) => (
          <Chip key={k.value} className="char-chip kind-chip" icon={k.icon} count={k.n} on={kind === k.value}
            title={kind === k.value ? t("{tip}. Click again for every mod", { tip: k.title }) : k.title}
            onClick={() => setKind(kind === k.value ? null : k.value)}>{k.label}</Chip>
        ))}
        {kr.length > 0 && cr.length > 0 && <span className="library-chars-sep" aria-hidden="true" />}
        {cr.map((c) => (
          <Chip key={c.name} className="char-chip" img={portraitNow(gid, c.name, icons.get(c.name.toLowerCase()) ?? null)} icon="user" count={c.n}
            on={character?.toLowerCase() === c.name.toLowerCase()} title={t("Only {name}'s mods. Right-click for more", { name: c.name })}
            onClick={() => setCharacter(character?.toLowerCase() === c.name.toLowerCase() ? null : c.name)}
            onContextMenu={menuHandler(() => withoutKeys(menuFor("character", { game: gid, name: c.name })))}>
            {c.name}
          </Chip>
        ))}
    </>
  );
  const sideFlags = fits ? flagChips.filter((f) => fits(f.label)) : flagChips;
  const sideKinds = fits ? kindRow.filter((k) => fits(k.label)) : kindRow;
  const sideChars = fits ? charRow.filter((c) => fits(c.name)) : charRow;
  const sideCount = sideFlags.length + sideKinds.length + sideChars.length;

  return (
    <>
      <PageHeader title={t("Mods")} icon="mods"
        sub={failed ? undefined : loaded ? tn(mods.length, "{n} mod, {on} on, {size}", "{n} mods, {on} on, {size}", { on: onTotal, size: formatBytes(size) }) : t("Reading the Mods folder")}
        actions={<>
          <LibTabs tab="installed" />
          <SearchField value={search} onChange={setSearch} placeholder={t("Search mods")} className="library-search"
            title={t("Finds mods by name, character, tag or creator. Arrow down or Enter goes to the first match")}
            onEnter={() => document.querySelector<HTMLElement>(".library .mod-grid .mod-card-hit")?.focus()} />
          <Segmented size="sm" label={t("Show")} value={show} onChange={setShow}
            options={[
              { value: "all", label: t("All"), title: t("Every mod") },
              { value: "on", label: t("On"), title: t("Mods that are on ({n})", { n: counts.on }) },
              { value: "off", label: t("Off"), title: t("Mods that are off ({n})", { n: counts.off }) },
            ]} />
          <Select<Sort> value={prefs.sort} onChange={(v) => setPrefs({ sort: v })} title={t("Sort mods")}
            options={[{ value: "added", label: t("Recently added") }, { value: "name", label: t("Name") }, { value: "character", label: t("Character") }, { value: "size", label: t("Size") }]} />
          {format !== "rows" && <Segmented size="sm" label={t("Layout")} value={prefs.view} onChange={(v) => setPrefs({ view: v })}
            options={[{ value: "grid", label: "", icon: "grid", title: t("Grid") }, { value: "list", label: "", icon: "list", title: t("List") }]} />}
          <IconButton icon="refresh" className={scanning ? "lib-scanning" : undefined} disabled={scanning} onClick={() => void rescan()}
            label={scanning ? t("Reading the Mods folder") : t("Rescan: read the Mods folder again for changes made outside gachamod, then check every mod for updates on GameBanana")} />
          <IconButton icon="dice" label={t("Shuffle outfits: one random mod on for each character with two or more. Undo puts them back. Right-click to shuffle at each Play")}
            onClick={() => void shuffleOutfits(gid).catch((e) => toast(errorText(e), true))} onContextMenu={menuHandler(shuffleMenu)} />
        </>}>
        {!side && chipCount > 0 && <CharRow count={chipCount} deps={chipDeps}>{chipsOf(flagChips, kindRow, charRow)}</CharRow>}
      </PageHeader>

      {side && (
        <LibSide sideRef={sideRef} deps={[...chipDeps, find]} find={narrow || !chipCount ? null : find} onFind={setFind} noun={charNoun(gid).toLowerCase()}>
          <Chip className="char-chip all-chip" icon="mods" count={counts.all} on={!flag && !character && !kind}
            title={t("Every mod, with no type, character or filter picked")} onClick={() => { setFlag(null); setCharacter(null); }}>{t("All mods")}</Chip>
          {sideCount > 0 && <span className="library-chars-sep" aria-hidden="true" />}
          {chipsOf(sideFlags, sideKinds, sideChars)}
          {fits && !sideCount && chipCount > 0 && <p className="hint lib-side-none">{t("Nothing matches")}</p>}
        </LibSide>
      )}
      <Body side={side}>{failed ? failure : <ModGrid game={gid} mods={shown} all={mods} setMods={setMods} view={prefs.view} loading={!loaded} icons={icons}
        empty={!mods.length ? (
          <Empty icon="mods" title={t("No mods yet")}
            actions={<>
              <Button variant="primary" icon="browse" onClick={() => go("browse")}>{t("Browse GameBanana")}</Button>
              <Button icon="refresh" busy={scanning} onClick={() => void rescan()} title={t("Reads the Mods folder again, for mods put there outside gachamod")}>{t("Rescan")}</Button>
            </>}>
            {t("Get mods from Browse, or drop a .zip, .7z or .rar anywhere on this window. If {game}'s Mods folder already has mods, Rescan picks them up.", { game: name })}
          </Empty>
        ) : (
          <Empty icon="search" title={t("Nothing matches")}
            actions={<>
              {filtersOn && <Button onClick={clearFilters}>{t("Clear filters")}</Button>}
              {nsfw === "hide" && mods.some((m) => m.nsfw) && <Button icon="eye" onClick={() => go({ view: "settings", section: "set-nsfw" })} title={t("Settings, GameBanana")}>{t("Mods for adults")}</Button>}
              {search.trim() && <Button variant="ghost" icon="search" onClick={() => openPalette(search.trim())} title={t("Search pages, settings, GameBanana and the rest (Ctrl+K)")}>{t("Search everywhere")}</Button>}
            </>}>
            {nsfw === "hide" && mods.some((m) => m.nsfw) ? t("Mods for adults are hidden.") : t("Try another search or filter.")}
          </Empty>
        )} />}</Body>
    </>
  );
}

/** The mods beside the list of characters scroll by themselves (library.css); otherwise nothing wraps them. */
function Body({ side, children }: { side: boolean; children: ReactNode }) {
  return side ? <div className="lib-main">{children}</div> : <>{children}</>;
}

/** The types and characters as a list down the left (the Character list and Three panes layouts), with a field over
 *  it that narrows it (`find`, null where the window is too narrow for it). Up and down move in the list, and it is one
 *  Tab stop like the row of chips. */
function LibSide({ sideRef, deps, find, onFind, noun, children }: {
  sideRef: RefObject<HTMLDivElement | null>; deps: unknown[]; find: string | null; onFind: (v: string) => void; noun: string; children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const field = useRef<HTMLInputElement>(null);
  useRovingTab(ref, ".chip");
  useEffect(() => { ref.current?.querySelector<HTMLElement>(".chip.on")?.scrollIntoView({ block: "nearest" }); }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={sideRef} className="lib-side">
      {find !== null && <SideSearch ref={field} value={find} onChange={onFind} list={ref} selector=".chip" pinned=".all-chip" placeholder={t("Search {noun}", { noun })} />}
      <nav ref={ref} className="lib-side-list" aria-label={t("Types and characters")}
        onKeyDown={(e) => { if (!upToField(e, ref.current, ".chip", field.current)) moveInGrid(e, ref.current, ".chip"); }}>
        {children}
      </nav>
    </div>
  );
}

/** The row of type and character chips. It scrolls sideways with the mouse wheel, the arrow buttons (shown when it
 *  doesn't fit) and the arrow keys, and keeps the picked chip in view. */
function CharRow({ deps, count, children }: { deps: unknown[]; count: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [all, toggleAll] = useRowOpen("library.chips");
  const { left, right, page } = useSideScroll(ref, [...deps, all]);
  useRovingTab(ref, ".chip");
  useEffect(() => {
    const el = ref.current, on = el?.querySelector<HTMLElement>(".chip.on");
    if (el && on) reveal(el, on, "center");
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  const arrows = left || right;
  return (
    <div className={`library-chars-wrap${all ? " is-all" : ""}`}>
      {arrows && <IconButton size="sm" icon="left" label={t("Scroll left")} disabled={!left} onClick={() => page(-1)} />}
      <div ref={ref} className={`library-chars${all ? " is-all" : ""}`} role="toolbar" aria-label={t("Types and characters")} onKeyDown={(e) => rowKeys(e, ".chip")}>
        {children}
      </div>
      {arrows && <IconButton size="sm" icon="right" label={t("Scroll right")} disabled={!right} onClick={() => page(1)} />}
      <ShowAll open={all} onToggle={toggleAll} fits={!arrows} label={t("Show every type and character ({n})", { n: count })} />
    </div>
  );
}
