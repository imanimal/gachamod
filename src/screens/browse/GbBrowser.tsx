// The GameBanana browser as a component: the Browse screen, Home's embedded browser and a character page's Online tab
// all use it. Filters are remembered per game and shared by every copy (lib: ./state.ts), so Expand on Home opens
// the full browser with the same filters. Owner: BROWSE area.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { errorText, type GameId, type GameState } from "../../lib/api";
import { aiShown, askAi, useAiShow } from "../../lib/ai";
import { cardHasWords, categories, filterHq, isAbort, kindCategory, listByCreators, listMods, modsByNamedCreator, useCharacterListOrNull, type GbCard, type GbCategoryRef, type GbKind } from "../../lib/gamebanana";
import { oxford } from "../../lib/notes";
import { ideasTask, recommend, surpriseMe } from "../../lib/recommend";
import { setNsfw, useCreators, useHiddenMods, useNsfw, type NsfwMode } from "../../lib/prefs";
import { go, useGames } from "../../lib/store";
import { Button, Chip, Empty, IconButton, Menu, SearchField, Segmented, Toggle, Waiting } from "../../ui/kit";
import { openMenu } from "../../ui/ContextMenu";
import { Icon } from "../../ui/Icon";
import { Popover } from "../../ui/Popover";
import { toast } from "../../ui/toast";
import { CharRow, charsOpenAtStart } from "./CharRow";
import { CardSkeleton, ModCard } from "./ModCard";
import { moveInGrid } from "../library/gridNav";
import { nsfwTip } from "./menus";
import { applySaved, describe, isPlain, matching, removeSaved, renameSaved, saveFilters, useSavedFilters } from "./saved";
import { KINDS, SORTS, beginVisit, endCarry, endVisit, kindLabel, kindTitle, openWithFilters, setFilters, sortLabel, takePlace, useFilters, useLibIndex, type BrowseFilters, type BrowseSort } from "./state";
import type { GbCategoryRef as Cat } from "../../lib/gamebanana";
import "./browse.css";
import { LazyImg } from "../../ui/LazyImg";
import { useHint } from "../../shell/hints";
import { gameShort } from "../../lib/games";
import { t, tn } from "../../lib/i18n";

export interface GbBrowserProps {
  game: GameId;
  /** Smaller, for Home: fewer filters showing, a fixed height. `onExpand` opens the full browser (default: Browse). */
  embedded?: boolean;
  onExpand?: () => void;
  /** Fixed to one character (a character page): the character filter is hidden. */
  character?: string;
}

export function GbBrowser(props: GbBrowserProps) {
  const games = useGames();
  const game = games.find((g) => g.id === props.game);
  if (!game) return null;
  return <Browser key={game.id} {...props} gs={game} />;
}

interface Query {
  game: GameId;
  gbId: number;
  sort: BrowseSort;
  /** One type of mod, or null for all. */
  kind: GbKind | null;
  /** The character's name ("For you" filters by it). */
  character: string | null;
  categoryId: number | null;
  search: string;
  hq: boolean;
  /** Followed creators' ids when "only followed" is on. */
  followed: number[] | null;
  prio: number[];
  per: number;
}

interface Pages { items: GbCard[]; pinned: GbCard[]; page: number; complete: boolean; loading: boolean; error: string | null; dropped: number }
const START: Pages = { items: [], pinned: [], page: 0, complete: false, loading: true, error: null, dropped: 0 };

/** Pages of mods for a query. Each fetch reads pages until `want` mods pass the filters (at most 4 pages a time, 6
 *  with High quality), so the browser can keep a batch ready below the ones it shows. */
function usePages(q: Query | null, shown: (c: GbCard) => boolean, want: number) {
  const [st, setSt] = useState<Pages>(START);
  const ref = useRef(st);
  ref.current = st;
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const wantRef = useRef(want);
  wantRef.current = want;
  const ctrl = useRef<AbortController | null>(null);

  const fetchPages = useCallback(async (reset: boolean) => {
    if (!q) return;
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    const signal = c.signal;
    let { items, pinned, page, complete, dropped } = reset ? START : ref.current;
    // the ref is set right away so a `more` in the same tick sees this fetch running
    const set = (s: Pages) => { ref.current = s; setSt(s); };
    set(reset ? START : { ...ref.current, loading: true, error: null });
    const seen = new Set([...items, ...pinned].map((i) => i.id));
    const prio = new Set(q.prio);
    const put = (loading: boolean, error: string | null = null) => { if (!signal.aborted) set({ items, pinned, page, complete, loading, error, dropped }); };
    try {
      if (q.sort === "foryou") {
        let list = await recommend(q.game, { limit: 80, signal });
        const words = q.search.toLowerCase().split(/\s+/).filter(Boolean);
        if (words.length) list = list.filter((c) => cardHasWords(c, words));
        if (q.character) list = list.filter((c) => c.character?.toLowerCase() === q.character!.toLowerCase());
        if (q.followed) list = list.filter((c) => c.submitter && q.followed!.includes(c.submitter.id));
        if (q.hq) { const before = list.length; list = await filterHq(list, q.gbId, prio, signal, q.kind); dropped = before - list.length; }
        items = list; page = 1; complete = true;
        put(false);
        return;
      }
      const sort = q.sort;
      if (q.followed) {
        if (!q.followed.length) { complete = true; put(false); return; }
        const r = await listByCreators(q.followed, { gbGameId: q.gbId, sort, categoryId: q.categoryId, search: q.search, signal });
        let list = r.items;
        if (q.hq) { const before = list.length; list = await filterHq(list, q.gbId, prio, signal, q.kind); dropped = before - list.length; }
        items = list; page = 1; complete = true;
        put(false);
        return;
      }
      // creators the user prioritized come first: their best matches for this view, once, at the top
      if (reset && q.prio.length) {
        try {
          const r = await listByCreators(q.prio, { gbGameId: q.gbId, sort, categoryId: q.categoryId, search: q.search, signal });
          pinned = r.items.filter((i) => shownRef.current(i)).slice(0, 6);
          pinned.forEach((i) => seen.add(i.id));
        } catch (e) { if (isAbort(e)) throw e; }
      }
      // GameBanana's mod search doesn't look at who made a mod: a search naming a creator lists their mods first
      if (reset && q.search.trim()) {
        try {
          const found = await modsByNamedCreator({ gbGameId: q.gbId, sort, categoryId: q.categoryId, search: q.search, signal });
          if (found.length) {
            let fresh = found.filter((i) => !seen.has(i.id));
            fresh.forEach((i) => seen.add(i.id));
            if (q.hq) { const before = fresh.length; fresh = await filterHq(fresh, q.gbId, prio, signal, q.kind); dropped += before - fresh.length; }
            items = fresh;
            put(true);
          }
        } catch (e) { if (isAbort(e)) throw e; }
      }
      let tries = 0;
      while (!complete && tries < (q.hq ? 6 : 4) && items.filter((i) => shownRef.current(i)).length < wantRef.current) {
        const r = await listMods({ gbGameId: q.gbId, page: page + 1, perPage: q.per, sort, categoryId: q.categoryId, search: q.search, signal });
        if (signal.aborted) return;
        page++; tries++;
        complete = r.complete;
        let fresh = r.items.filter((i) => !seen.has(i.id));
        fresh.forEach((i) => seen.add(i.id));
        if (q.hq) { const before = fresh.length; fresh = await filterHq(fresh, q.gbId, prio, signal, q.kind); dropped += before - fresh.length; }
        items = [...items, ...fresh];
        put(true);
      }
      put(false);
    } catch (e) {
      if (signal.aborted || isAbort(e)) return;
      put(false, errorText(e));
    }
  }, [q]);

  useEffect(() => {
    void fetchPages(true);
    return () => ctrl.current?.abort();
  }, [fetchPages]);

  const more = useCallback(() => {
    const s = ref.current;
    if (s.loading || s.complete || s.error || s.page === 0) return;
    if (s.items.filter((i) => shownRef.current(i)).length >= wantRef.current) return;
    void fetchPages(false);
  }, [fetchPages]);
  const retry = useCallback(() => { void fetchPages(ref.current.page === 0); }, [fetchPages]);
  return { ...st, more, retry };
}

function Browser({ gs, embedded, onExpand, character: fixedChar }: GbBrowserProps & { gs: GameState }) {
  const game = gs.id;
  // a fresh visit starts without the last one's character, category and search; a quick return keeps them, and the
  // full browser puts back how far it was scrolled
  const full = !embedded && !fixedChar;
  const visited = useRef<GameId | null>(null);
  const resume = useRef<{ scroll: number; limit: number } | null>(null);
  if (visited.current !== game) {
    visited.current = game;
    const kept = beginVisit(game);
    const p = full ? takePlace(game) : null;
    resume.current = kept ? p : null;
  }
  useEffect(() => { endCarry(game); }, [game]);
  const f = useFilters(game);
  const nsfw = useNsfw();
  const creators = useCreators();
  const installHint = useHint("install");
  const hidden = useHiddenMods();
  const lib = useLibIndex(game);
  // null while the character list loads (a few seconds at most); then a name it lacks is searched for instead
  const charList = useCharacterListOrNull(game);
  const chars = charList ?? NO_CHARS;
  const [cats, setCats] = useState<GbCategoryRef[] | null>(null);
  const aiShow = useAiShow();
  // bumped to empty the search field when a filter change clears the search
  const [clearText, setClearText] = useState(0);
  const [menu, setMenu] = useState<{ el: HTMLElement; kind: "sort" | "filters" } | null>(null);
  const savedSets = useSavedFilters(game);
  const savedNow = matching(savedSets, f);
  const [charsOpen, setCharsOpen] = useState(charsOpenAtStart);
  // mods hidden with Not interested show again while this is on (their menu has Show in Browse again)
  const [showHidden, setShowHidden] = useState(false);
  const set = useCallback((p: Partial<BrowseFilters>) => setFilters(game, p), [game]);

  useEffect(() => {
    let live = true;
    categories(gs.gamebananaId).then((l) => { if (live) setCats(l); }).catch(() => { if (live) setCats([]); });
    return () => { live = false; };
  }, [gs.gamebananaId]);

  const character = fixedChar ?? f.character;
  const charRef = character ? chars.find((c) => c.name.toLowerCase() === character.toLowerCase()) ?? null : null;
  // a character the list doesn't know: search for the name instead
  const waitChars = !!character && charList === null;
  // a type narrows GameBanana's list to its top category where there is one (tools: Other/Misc), then each card's type
  const typeCat = kindCategory(f.kind, cats ?? []);
  const waitCats = !!f.kind && f.kind !== "other" && cats === null;
  const categoryId = charRef?.id ?? (character ? null : f.category?.id ?? typeCat);
  const search = character && !charRef && !waitChars ? [character, f.search].filter(Boolean).join(" ") : f.search;

  const prioIds = useMemo(() => Object.values(creators).filter((c) => c.prio && !c.blocked).map((c) => c.id).sort((a, b) => a - b), [creators]);
  const subIds = useMemo(() => Object.values(creators).filter((c) => (c.sub || c.prio) && !c.blocked).map((c) => c.id).sort((a, b) => a - b), [creators]);
  const key = JSON.stringify([gs.gamebananaId, f.sort, f.kind, character, categoryId, search, f.hq, f.followed ? subIds : null, prioIds, embedded]);
  const query = useMemo<Query | null>(() => (waitChars || waitCats ? null : {
    game, gbId: gs.gamebananaId, sort: f.sort, kind: f.kind, character, categoryId, search, hq: f.hq, followed: f.followed ? subIds : null, prio: prioIds,
    per: 50,
  }), [key, waitChars, waitCats]); // eslint-disable-line react-hooks/exhaustive-deps

  // cards show a batch at a time, and the next batch is always loaded before it is needed
  const step = embedded ? 18 : 36;
  const [limit, setLimit] = useState(() => Math.max(step, resume.current?.limit ?? 0));
  const firstQuery = useRef(true);
  useEffect(() => {
    // the first query of a return keeps the batch count it had, so the old place is there to scroll back to
    if (!query) return;
    if (firstQuery.current) { firstQuery.current = false; if (resume.current) return; }
    setLimit(step);
  }, [query, step]);

  /** Why a card is left out, or null when it shows. */
  const leftOut = useCallback((c: GbCard): LeftOut | null => {
    if (c.submitter && creators[String(c.submitter.id)]?.blocked) return "blocked";
    if (!showHidden && hidden.includes(c.id)) return "hid";
    if (nsfw === "hide" && c.nsfw) return "adults";
    if (f.hideInstalled && lib.byMod.has(c.id)) return "have";
    if (f.kind && (c.kind ?? "outfit") !== f.kind) return "types";
    return null;
  }, [creators, hidden, showHidden, nsfw, f.hideInstalled, f.kind, lib]);
  const shown = useCallback((c: GbCard) => leftOut(c) === null, [leftOut]);

  // Home's copy shows two rows and no more: it measures how many cards fit across, and Expand opens the rest in Browse
  const [cols, setCols] = useState(4);
  const gridObs = useRef<ResizeObserver | null>(null);
  const gridRef = useCallback((el: HTMLDivElement | null) => {
    gridObs.current?.disconnect();
    gridObs.current = null;
    if (!el || !embedded) return;
    const measure = () => {
      const n = getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean).length;
      if (n) setCols(n);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    gridObs.current = ro;
  }, [embedded]);
  const cap = embedded ? cols * 2 : limit;

  const pages = usePages(query, shown, embedded ? cap : limit + step);
  const pinned = pages.pinned.filter(shown).slice(0, cap);
  const pinnedIds = new Set(pinned.map((p) => p.id));
  const ready = pages.items.filter((i) => shown(i) && !pinnedIds.has(i.id));
  const items = ready.slice(0, embedded ? Math.max(0, cap - pinned.length) : limit);
  const filteredOut = pages.items.length + pages.pinned.length - ready.length - pages.pinned.filter(shown).length;
  const loading = pages.loading || waitChars || waitCats;
  // waiting on GameBanana for cards that should already show (the batch below ran out)
  const waiting = loading && (embedded ? pinned.length + ready.length < cap : ready.length < limit);
  const hasMore = (embedded ? pinned.length + ready.length > cap : ready.length > limit) || !pages.complete;

  // the next batch loads in the background once one is shown
  const { more } = pages;
  useEffect(() => { more(); }, [limit, cap, more]);

  // near the end of the grid, the ready batch shows at once; with none ready, the next one loads
  const showMore = useCallback(() => {
    if (ready.length > limit) setLimit((l) => l + step);
    else more();
  }, [ready.length, limit, step, more]);
  const sentinel = useRef<HTMLDivElement>(null);
  const [nearEnd, setNearEnd] = useState(0);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || embedded) return;
    // observing again after every change reports whether the end is still near. The root is the box that scrolls
    // (the screen's own, or the embedded list): with the window as root, that box clips the margin away.
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setNearEnd((n) => n + 1); },
      { root: scroller(el), rootMargin: "1200px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [embedded, items.length, ready.length, pages.loading]);
  useEffect(() => { if (nearEnd) showMore(); }, [nearEnd]); // eslint-disable-line react-hooks/exhaustive-deps

  // the full browser remembers how far it was scrolled and puts it back on a quick return
  const scrollAt = useRef(0);
  const limitRef = useRef(limit);
  limitRef.current = limit;
  useLayoutEffect(() => {
    const el = sentinel.current && scroller(sentinel.current);
    if (!full || !el) return () => endVisit(game);
    const onScroll = () => { scrollAt.current = el.scrollTop; };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => { el.removeEventListener("scroll", onScroll); endVisit(game, { scroll: scrollAt.current, limit: limitRef.current }); };
  }, [full, game]);
  useEffect(() => {
    const want = resume.current;
    if (!want) return;
    const timer = window.setTimeout(() => { resume.current = null; }, 15000);
    if (waiting || (items.length < want.limit && !pages.complete && !pages.error)) return () => window.clearTimeout(timer);
    resume.current = null;
    const el = sentinel.current && scroller(sentinel.current);
    if (el) { el.style.scrollBehavior = "auto"; el.scrollTop = want.scroll; el.style.scrollBehavior = ""; scrollAt.current = el.scrollTop; }
    return () => window.clearTimeout(timer);
  }, [waiting, items.length, pages.complete, pages.error]);

  const toggleFollowed = () => {
    if (!f.followed && !subIds.length) { toast(t("You don't follow anyone yet. Right-click a creator's name and pick Follow")); return; }
    set({ followed: !f.followed });
  };
  const expand = () => { openWithFilters(game); (onExpand ?? (() => go({ view: "browse" })))(); };

  // active filters as removable chips
  const chips: Array<{ key: string; label: string; icon?: Parameters<typeof Chip>[0]["icon"]; img?: string | null; clear: () => void }> = [];
  if (!fixedChar && f.character) chips.push({ key: "c", label: f.character, img: charRef?.icon, icon: "characters", clear: () => set({ character: null }) });
  if (f.category && !f.character) chips.push({ key: "k", label: f.category.name, icon: "filter", clear: () => set({ category: null }) });
  if (f.kind) chips.push({ key: "t", label: kindLabel(f.kind), icon: "shirt", clear: () => set({ kind: null }) });
  if (f.followed) chips.push({ key: "f", label: t("Creators you follow"), icon: "feed", clear: () => set({ followed: false }) });
  if (f.hideInstalled) chips.push({ key: "i", label: t("Not installed"), icon: "check", clear: () => set({ hideInstalled: false }) });
  if (showHidden) chips.push({ key: "h", label: t("Mods you hid"), icon: "eye", clear: () => setShowHidden(false) });
  // filters inside the Filters button (High quality and the search show in the bar)
  // any set that isn't the plain view can be saved, High quality or a sort on its own too
  const canSave = !embedded && !savedNow && !isPlain(f);
  // a search for a character's exact name offers the character filter, which finds their mods far better
  const charHit = !fixedChar && f.search && f.character?.toLowerCase() !== f.search.toLowerCase()
    ? chars.find((c) => c.name.toLowerCase() === f.search.toLowerCase()) ?? null : null;
  const hidden_n = [f.kind, f.category && !f.character, f.followed, f.hideInstalled, showHidden].filter(Boolean).length;
  const clearAll = () => { setClearText((n) => n + 1); setShowHidden(false); set({ search: "", character: fixedChar ? f.character : null, category: null, kind: null, hq: false, followed: false, hideInstalled: false }); };

  const hqTip = f.kind && f.kind !== "outfit"
    ? t("The best-liked {kind} for their age, about the top fifth. Creators you prioritize always show", { kind: kindLabel(f.kind).toLowerCase() })
    : t("The best-liked outfits for their age, about the top fifth. Recolors, tools and UI are left out unless you pick that type. Creators you prioritize always show");
  const surprise = () => { void surpriseMe(game); };
  const surpriseMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    openMenu({ x: e.clientX, y: e.clientY }, [
      { label: t("Surprise me"), icon: "dice", onClick: surprise },
      { label: t("Show all picks for you"), icon: "sparkle", onClick: () => set({ sort: "foryou" }) },
      aiShown("extra", aiShow) && { label: t("Ask your chatbot for ideas"), icon: "ai", onClick: () => { void ideasTask(game).then(askAi); } },
    ]);
  };
  /** "8 you have, 3 for adults, and 1 from creators you blocked" */
  const outWhy = () => {
    const n = new Map<LeftOut, number>();
    const seen = new Set<number>();
    for (const c of [...pages.pinned, ...pages.items]) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      const w = leftOut(c);
      if (w) n.set(w, (n.get(w) ?? 0) + 1);
    }
    return oxford([...n].map(([w, k]) => leftOutText(w, k)));
  };
  const emptyText = f.followed && !subIds.length ? t("Right-click a creator's name and pick Follow, and their mods show here.")
    : filteredOut > 0 ? tn(filteredOut, "{n} mod is hidden: {why}.", "{n} mods are hidden: {why}.", { why: outWhy() })
    : f.hq && pages.dropped > 0 ? tn(pages.dropped, "{n} mod was left out by High quality.", "{n} mods were left out by High quality.")
    : f.sort === "foryou" && !lib.byMod.size ? t("Install a few mods and this fills with ones that suit them.")
    : search ? t("Try fewer or different words.") : t("Try another category or sort.");

  // the search box's ArrowDown, and Enter once the results are for what's typed, go to the first result
  const firstCard = () => document.querySelector<HTMLElement>(".gbb .gb-grid .gb-card")?.focus();

  return (
    <div className={`gbb${embedded ? " is-embedded" : ""}`}>
      <div className="gbb-bar">
        <BrowseSearch search={f.search} set={set} clear={clearText} placeholder={t("Search {game} mods or creators", { game: gameShort(gs) })} firstCard={firstCard} />
        <Button className="gbb-sort" variant="secondary" icon="sort" iconRight="down" title={t("Sort")} onClick={(e) => setMenu(menu?.kind === "sort" ? null : { el: e.currentTarget, kind: "sort" })}>{sortLabel(f.sort)}</Button>
        <Chip on={f.hq} icon="quality" onClick={() => set({ hq: !f.hq })} title={hqTip}>{t("High quality")}</Chip>
        <Button className={`gbb-filters${hidden_n ? " is-on" : ""}`} variant="secondary" icon="filter" iconRight="down"
          title={t("Type, category, creators you follow, mods you have, mods for adults and saved filters")}
          onClick={(e) => setMenu(menu?.kind === "filters" ? null : { el: e.currentTarget, kind: "filters" })}>
          {savedNow ? savedNow.name : t("Filters")}{hidden_n > 0 && !savedNow && <span className="chip-n">{hidden_n}</span>}
        </Button>
        <IconButton className="gbb-surprise" icon="dice" label={t("Surprise me: open a mod you don't have that suits your library (right-click for more)")}
          onClick={surprise} onContextMenu={surpriseMenu} />
        {embedded && <IconButton className="gbb-expand" icon="expand" label={t("Open the full browser (keeps these filters)")} onClick={expand} />}
      </div>

      {!embedded && !fixedChar && (
        <CharRow game={game} chars={chars} value={f.character} onChange={(c) => set({ character: c })} expanded={charsOpen} onExpanded={setCharsOpen} />
      )}

      {(chips.length > 0 || canSave || charHit) && (
        <div className="gbb-chips" aria-label={t("Active filters")}>
          {charHit && (
            <Button size="sm" variant="secondary" icon="characters" title={t("Clear the search and list {name}'s mods", { name: charHit.name })}
              onClick={() => { setClearText((n) => n + 1); set({ character: charHit.name, search: "" }); }}>{t("Show only {name}", { name: charHit.name })}</Button>
          )}
          {chips.map((c) => (
            <span key={c.key} className="chip on gbb-fchip">
              {c.img ? <LazyImg className="chip-img" src={c.img} alt="" /> : c.icon && <Icon name={c.icon} />}
              <span className="chip-t">{c.label}</span>
              <button type="button" className="gbb-fchip-x" aria-label={t("Remove {name}", { name: c.label })} title={t("Remove this filter")} onClick={c.clear}><Icon name="x" /></button>
            </span>
          ))}
          {chips.length > 1 && <Button size="sm" variant="ghost" icon="x" className="gbb-clear" onClick={clearAll} title={t("Remove every filter")}>{t("Clear all")}</Button>}
          {canSave && (
            <Button size="sm" variant="ghost" icon="pin" className="gbb-clear" onClick={() => saveFilters(game)}
              title={t("Keep this set of filters under Saved, to put it back in one click")}>{t("Save filters")}</Button>
          )}
        </div>
      )}

      <div>
        {pages.error && !items.length && !pinned.length ? (
          <Empty icon="warn" title={t("Couldn't load GameBanana")} actions={<Button icon="refresh" onClick={pages.retry}>{t("Try again")}</Button>}>{pages.error}</Empty>
        ) : !loading && pages.complete && !items.length && !pinned.length ? (
          <Empty icon="browse" title={f.followed && !subIds.length ? t("You don't follow anyone yet") : search ? t("Nothing found for \"{search}\"", { search }) : t("No mods here")}
            actions={chips.length || filteredOut > 0 ? <>
              {chips.length > 0 && <Button icon="x" onClick={clearAll}>{t("Clear filters")}</Button>}
              {!showHidden && [...pages.pinned, ...pages.items].some((c) => hidden.includes(c.id)) && (
                <Button icon="eye" title={t("Show the mods you picked Not interested on. Their menu has Show in Browse again")} onClick={() => setShowHidden(true)}>{t("Show mods you hid")}</Button>
              )}
              {nsfw === "hide" && filteredOut > 0 && <Button icon="eye" title={t("Settings, GameBanana")} onClick={() => go({ view: "settings", section: "set-nsfw" })}>{t("Mods for adults")}</Button>}
            </> : undefined}>{emptyText}</Empty>
        ) : waiting && !items.length && !pinned.length ? (
          <Waiting what={t("Asking GameBanana for mods")}>
            <div ref={gridRef} className="cards gb-grid" aria-hidden="true">
              {Array.from({ length: embedded ? cap : 12 }, (_, i) => <CardSkeleton key={`s${i}`} />)}
            </div>
          </Waiting>
        ) : (
          <div ref={gridRef} className="cards gb-grid" aria-busy={waiting} onKeyDown={(e) => moveInGrid(e, e.currentTarget, ".gb-card")}>
            {pinned.map((m) => <ModCard key={`p${m.id}`} game={game} mod={m} lib={lib} nsfw={nsfw} prio />)}
            {items.map((m, i) => <ModCard key={m.id} game={game} mod={m} lib={lib} nsfw={nsfw} prio={!!(m.submitter && creators[String(m.submitter.id)]?.prio)} hint={installHint && i === 0 && !pinned.length} />)}
            {waiting && Array.from({ length: embedded ? Math.max(0, cap - pinned.length - items.length) : 6 }, (_, i) => <CardSkeleton key={`s${i}`} />)}
          </div>
        )}
        <div ref={sentinel} className="gb-sentinel" aria-hidden="true" />
        {hasMore && (items.length > 0 || pinned.length > 0) && (
          <div className="gb-more">
            {embedded ? <Button variant="ghost" iconRight="chevron" onClick={expand} title={t("Open the full browser (keeps these filters)")}>{t("More in Browse")}</Button>
              : pages.error && ready.length <= limit ? <Button icon="refresh" onClick={pages.retry}>{t("Couldn't load more. Try again")}</Button>
              : <Button variant="ghost" busy={waiting} onClick={showMore}>{t("Load more")}</Button>}
          </div>
        )}
        {f.hq && pages.dropped > 0 && (items.length > 0 || pinned.length > 0) && (
          <p className="hint gbb-note">{tn(pages.dropped, "High quality left out {n} mod.", "High quality left out {n} mods.")} <button type="button" className="link-btn" onClick={() => set({ hq: false })} title={t("Turn off High quality")}>{t("Show them")}</button></p>
        )}
      </div>

      {menu?.kind === "filters" && (
        <Popover anchor={menu.el} onClose={() => setMenu(null)} label={t("Filters")} width="24em">
          <FiltersPanel game={game} f={f} set={set} cats={fixedChar ? [] : cats ?? []} nsfw={nsfw} following={subIds.length > 0}
            hiddenCount={hidden.length} showHidden={showHidden} onShowHidden={setShowHidden}
            onFollowed={toggleFollowed} onClear={hidden_n || chips.length ? () => { clearAll(); } : null} onPick={() => setMenu(null)} />
        </Popover>
      )}
      {menu?.kind === "sort" && (
        <Popover anchor={menu.el} onClose={() => setMenu(null)} label={t("Sort")} width="15em">
          <Menu items={SORTS.filter((s) => s.value !== "relevance" || f.search).map((s) => ({
            label: s.label, hint: s.value === "foryou" && f.search ? t("Only the mods picked for you that match the search") : s.title,
            icon: s.value === f.sort ? "check" : undefined, onClick: () => { set({ sort: s.value }); setMenu(null); },
          }))} />
        </Popover>
      )}
    </div>
  );
}

/** The nearest box above `el` that scrolls up and down, or null for the window. */
function scroller(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(p).overflowY)) return p;
  }
  return null;
}

const NO_CHARS: Cat[] = [];

/** Why a card is left out of the grid. */
type LeftOut = "blocked" | "hid" | "adults" | "have" | "types";
/** "3 for adults", "1 from creators you blocked": one part of the hidden-mods line. */
function leftOutText(why: LeftOut, n: number): string {
  switch (why) {
    case "blocked": return tn(n, "{n} from creators you blocked", "{n} from creators you blocked");
    case "hid": return tn(n, "{n} you hid", "{n} you hid");
    case "adults": return tn(n, "{n} for adults", "{n} for adults");
    case "have": return tn(n, "{n} you have", "{n} you have");
    case "types": return tn(n, "{n} of other types", "{n} of other types");
  }
}

/** The search box. What's typed stays in here, so typing doesn't redraw the grid: it reaches the filter once typing
 *  pauses (350 ms), or on Enter. It follows the filter when a search comes from elsewhere, and empties when `clear`
 *  changes. */
function BrowseSearch({ search, set, clear, placeholder, firstCard }: {
  search: string; set: (p: Partial<BrowseFilters>) => void; clear: number; placeholder: string; firstCard: () => void;
}) {
  const [text, setText] = useState(search);
  useEffect(() => { setText(search); }, [search]);
  const cleared = useRef(clear);
  useEffect(() => { if (cleared.current !== clear) { cleared.current = clear; setText(""); } }, [clear]);
  useEffect(() => {
    if (text.trim() === search) return;
    const timer = window.setTimeout(() => set({ search: text.trim() }), 350);
    return () => window.clearTimeout(timer);
  }, [text, search, set]);
  return (
    <SearchField className="gbb-search" value={text} onChange={setText} placeholder={placeholder}
      onEnter={() => { if (text.trim() === (search ?? "")) firstCard(); else set({ search: text.trim() }); }} onDown={firstCard} />
  );
}

/** Hide, Blur, Show for mods for adults (the app-wide setting, with Undo). */
export function AdultSwitch({ value, size = "sm" }: { value: NsfwMode; size?: "sm" | "md" }) {
  return (
    <Segmented<NsfwMode> label={t("Mods for adults")} size={size} value={value} onChange={setNsfw} options={[
      { value: "hide", label: t("Hide"), title: nsfwTip("hide") },
      { value: "blur", label: t("Blur"), title: nsfwTip("blur") },
      { value: "show", label: t("Show"), title: nsfwTip("show") },
    ]} />
  );
}


/** Everything past sort and High quality, in one popover: type, category, two switches, mods for adults and saved
 *  sets. Each pick applies at once and leaves it open, so several can be set in a row. */
function FiltersPanel({ game, f, set, cats, nsfw, following, hiddenCount, showHidden, onShowHidden, onFollowed, onClear, onPick }: {
  game: GameId; f: BrowseFilters; set: (p: Partial<BrowseFilters>) => void; cats: Cat[]; nsfw: NsfwMode; following: boolean;
  /** Mods hidden with Not interested, and whether they show for now. */
  hiddenCount: number; showHidden: boolean; onShowHidden: (v: boolean) => void;
  onFollowed: () => void; onClear: (() => void) | null; onPick: () => void;
}) {
  return (
    <div className="gbb-fp">
      <div className="gbb-fp-s" role="group" aria-label={t("Type")}>
        <span className="gbb-fp-h">{t("Type")}</span>
        <div className="gbb-fp-o">
          <Chip on={!f.kind} onClick={() => set({ kind: null })} title={t("Every type of mod")}>{t("All")}</Chip>
          {KINDS.map((k) => <Chip key={k.value} on={f.kind === k.value} onClick={() => set({ kind: f.kind === k.value ? null : k.value })} title={kindTitle(k, game)}>{k.label}</Chip>)}
        </div>
      </div>
      {cats.length > 0 && (
        <div className="gbb-fp-s" role="group" aria-label={t("GameBanana category")}>
          <span className="gbb-fp-h" title={t("The section the creator filed the mod under on GameBanana. Type sorts mods by what they change, whatever their section")}>{t("GameBanana category")}</span>
          <div className="gbb-fp-o">
            <Chip on={!f.category} onClick={() => set({ category: null })} title={t("Every category")}>{t("All")}</Chip>
            {cats.filter((c) => !KINDS.some((k) => k.en.toLowerCase() === c.name.toLowerCase())).map((c) => (
              <Chip key={c.id} on={f.category?.id === c.id} onClick={() => set(f.category?.id === c.id ? { category: null } : { category: c, character: null })}
                title={t("Only mods filed under {name} on GameBanana", { name: c.name })}>{c.name}</Chip>
            ))}
          </div>
        </div>
      )}
      <div className="gbb-fp-s gbb-fp-t">
        <Toggle size="sm" checked={f.followed} onChange={onFollowed} label={t("Only creators you follow")}
          hint={following ? undefined : t("Right-click a creator's name and pick Follow")} />
        <Toggle size="sm" checked={f.hideInstalled} onChange={(v) => set({ hideInstalled: v })} label={t("Hide mods you have")} />
        {(hiddenCount > 0 || showHidden) && (
          <Toggle size="sm" checked={showHidden} onChange={onShowHidden} label={t("Show mods you hid ({n})", { n: hiddenCount })}
            hint={t("Mods you picked Not interested on. Right-click one and pick Show in Browse again to keep it")} />
        )}
      </div>
      <div className="gbb-fp-s gbb-fp-row">
        <span className="gbb-fp-h">{t("Mods for adults")}</span>
        <AdultSwitch value={nsfw} />
      </div>
      <div className="gbb-fp-s">
        <span className="gbb-fp-h">{t("Saved filters")}</span>
        <SavedPanel game={game} f={f} onPick={onPick} />
      </div>
      {onClear && <Button size="sm" variant="ghost" icon="x" className="gbb-fp-clear" onClick={onClear}>{t("Clear filters")}</Button>}
    </div>
  );
}

/** The Saved popover: save the filters on now, put a saved set back, rename or remove one (with Undo). */
function SavedPanel({ game, f, onPick }: { game: GameId; f: BrowseFilters; onPick: () => void }) {
  const list = useSavedFilters(game);
  const cur = matching(list, f);
  const [edit, setEdit] = useState<string | null>(null);
  const [name, setName] = useState("");
  const finish = (id: string) => { renameSaved(game, id, name); setEdit(null); };
  return (
    <div className="gbb-saved">
      <Button size="sm" variant="secondary" icon="plus" disabled={isPlain(f) || !!cur} onClick={() => saveFilters(game)}
        title={cur ? t("These are saved as \"{name}\"", { name: cur.name }) : isPlain(f) ? t("Pick some filters first") : t("Save as \"{name}\"", { name: describe(f) })}>{t("Save these filters")}</Button>
      {list.length === 0
        ? <p className="hint">{t("Saved sets show here. Picking one puts back its sort, type, character, search and the rest.")}</p>
        : (
          <ul className="gbb-saved-l">
            {list.map((s) => (
              <li key={s.id} className={`gbb-saved-i${cur?.id === s.id ? " is-on" : ""}`} onKeyDown={(e) => {
                if (edit === s.id) return;
                if (e.key === "F2") { e.preventDefault(); setEdit(s.id); setName(s.name); }
                else if (e.key === "Delete") { e.preventDefault(); removeSaved(game, s.id); }
              }}>
                {edit === s.id
                  ? <input className="gbb-saved-in" autoFocus value={name} aria-label={t("New name")} onChange={(e) => setName(e.target.value)} onBlur={() => finish(s.id)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); finish(s.id); } else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setEdit(null); } }} />
                  : (
                    <button type="button" className="gbb-saved-b" title={s.name === describe(s.f) || s.name === describe(s.f, true) ? undefined : t("Puts back: {filters}", { filters: describe(s.f, true) })} onClick={() => { applySaved(game, s); onPick(); }}>
                      <Icon name={cur?.id === s.id ? "check" : "pin"} /><span>{s.name}</span>
                    </button>
                  )}
                <IconButton size="sm" icon="edit" label={t("Rename (F2)")} onClick={() => { setEdit(s.id); setName(s.name); }} />
                <IconButton size="sm" icon="x" label={t("Remove (Del). Ctrl+Z brings it back")} onClick={() => removeSaved(game, s.id)} />
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}
