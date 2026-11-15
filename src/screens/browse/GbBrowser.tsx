// The GameBanana browser as a component: the Browse screen, Home's embedded browser and a character page's Online tab
// all use it. Filters are remembered per game and shared by every copy (lib: ./state.ts), so Expand on Home opens
// the full browser with the same filters. Owner: BROWSE area.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorText, type GameId, type GameState } from "../../lib/api";
import { aiShown, askAi, useAiShow } from "../../lib/ai";
import { cardHasWords, categories, filterHq, isAbort, kindCategory, listByCreators, listMods, modsByNamedCreator, useCharacterList, type GbCard, type GbCategoryRef, type GbKind } from "../../lib/gamebanana";
import { ideasTask, recommend, surpriseMe } from "../../lib/recommend";
import { setNsfw, useCreators, useHiddenMods, useNsfw, type NsfwMode } from "../../lib/prefs";
import { go, useGames } from "../../lib/store";
import { Button, Chip, Empty, IconButton, Menu, SearchField, Segmented, plural } from "../../ui/kit";
import { openMenu } from "../../ui/ContextMenu";
import { Icon } from "../../ui/Icon";
import { Popover } from "../../ui/Popover";
import { toast } from "../../ui/toast";
import { CharRow, charsOpenAtStart } from "./CharRow";
import { CardSkeleton, ModCard } from "./ModCard";
import { applySaved, describe, isPlain, matching, removeSaved, renameSaved, saveFilters, useSavedFilters } from "./saved";
import { KINDS, SORTS, beginVisit, endCarry, kindLabel, openWithFilters, setFilters, sortLabel, useFilters, useLibIndex, type BrowseFilters, type BrowseSort } from "./state";
import "./browse.css";

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
  // a fresh visit starts without the last one's character, category and search
  const visited = useRef<GameId | null>(null);
  if (visited.current !== game) { visited.current = game; beginVisit(game); }
  useEffect(() => { endCarry(game); }, [game]);
  const f = useFilters(game);
  const nsfw = useNsfw();
  const creators = useCreators();
  const hidden = useHiddenMods();
  const lib = useLibIndex(game);
  const chars = useCharacterList(game);
  const [cats, setCats] = useState<GbCategoryRef[] | null>(null);
  const aiShow = useAiShow();
  const [text, setText] = useState(f.search);
  const [menu, setMenu] = useState<{ el: HTMLElement; kind: "sort" | "cat" | "type" | "saved" } | null>(null);
  const savedSets = useSavedFilters(game);
  const savedNow = matching(savedSets, f);
  const [charsOpen, setCharsOpen] = useState(charsOpenAtStart);
  const set = useCallback((p: Partial<BrowseFilters>) => setFilters(game, p), [game]);

  useEffect(() => {
    let live = true;
    categories(gs.gamebananaId).then((l) => { if (live) setCats(l); }).catch(() => { if (live) setCats([]); });
    return () => { live = false; };
  }, [gs.gamebananaId]);

  // the field follows the filter (a search from elsewhere); typing reaches the filter once it pauses
  useEffect(() => { setText(f.search); }, [f.search]);
  useEffect(() => {
    if (text.trim() === f.search) return;
    const t = window.setTimeout(() => set({ search: text.trim() }), 350);
    return () => window.clearTimeout(t);
  }, [text, f.search, set]);

  const character = fixedChar ?? f.character;
  const charRef = character ? chars.find((c) => c.name.toLowerCase() === character.toLowerCase()) ?? null : null;
  // a character the list doesn't know (yet): search for the name instead
  const waitChars = !!character && !charRef && chars.length === 0;
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
  const [limit, setLimit] = useState(step);
  useEffect(() => { setLimit(step); }, [query, step]);

  const shown = useCallback((c: GbCard) => {
    if (c.submitter && creators[String(c.submitter.id)]?.blocked) return false;
    if (hidden.includes(c.id)) return false;
    if (nsfw === "hide" && c.nsfw) return false;
    if (f.hideInstalled && lib.byMod.has(c.id)) return false;
    if (f.kind && (c.kind ?? "outfit") !== f.kind) return false;
    return true;
  }, [creators, hidden, nsfw, f.hideInstalled, f.kind, lib]);

  const pages = usePages(query, shown, limit + step);
  const pinned = pages.pinned.filter(shown);
  const pinnedIds = new Set(pinned.map((p) => p.id));
  const ready = pages.items.filter((i) => shown(i) && !pinnedIds.has(i.id));
  const items = ready.slice(0, limit);
  const filteredOut = pages.items.length + pages.pinned.length - ready.length - pinned.length;
  const loading = pages.loading || waitChars || waitCats;
  // waiting on GameBanana for cards that should already show (the batch below ran out)
  const waiting = loading && ready.length < limit;
  const hasMore = ready.length > limit || !pages.complete;

  // the next batch loads in the background once one is shown
  const { more } = pages;
  useEffect(() => { more(); }, [limit, more]);

  // near the end of the grid, the ready batch shows at once; with none ready, the next one loads
  const showMore = useCallback(() => {
    if (ready.length > limit) setLimit((l) => l + step);
    else more();
  }, [ready.length, limit, step, more]);
  const sentinel = useRef<HTMLDivElement>(null);
  const [nearEnd, setNearEnd] = useState(0);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    // observing again after every change reports whether the end is still near. The root is the box that scrolls
    // (the screen's own, or the embedded list): with the window as root, that box clips the margin away.
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setNearEnd((n) => n + 1); },
      { root: scroller(el), rootMargin: "1200px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [embedded, items.length, ready.length, pages.loading]);
  useEffect(() => { if (nearEnd) showMore(); }, [nearEnd]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleFollowed = () => {
    if (!f.followed && !subIds.length) { toast("You don't follow anyone yet. Right-click a creator's name and pick Follow"); return; }
    set({ followed: !f.followed });
  };
  const expand = () => { openWithFilters(game); (onExpand ?? (() => go({ view: "browse" })))(); };

  // active filters as removable chips
  const chips: Array<{ key: string; label: string; icon?: Parameters<typeof Chip>[0]["icon"]; img?: string | null; clear: () => void }> = [];
  if (f.search) chips.push({ key: "q", label: `"${f.search}"`, icon: "search", clear: () => { setText(""); set({ search: "" }); } });
  if (!fixedChar && f.character) chips.push({ key: "c", label: f.character, img: charRef?.icon, icon: "characters", clear: () => set({ character: null }) });
  if (f.category && !f.character) chips.push({ key: "k", label: f.category.name, icon: "filter", clear: () => set({ category: null }) });
  if (f.kind) chips.push({ key: "t", label: kindLabel(f.kind), icon: "shirt", clear: () => set({ kind: null }) });
  if (f.hq) chips.push({ key: "hq", label: "High quality", icon: "quality", clear: () => set({ hq: false }) });
  if (f.followed) chips.push({ key: "f", label: "Creators you follow", icon: "feed", clear: () => set({ followed: false }) });
  if (f.hideInstalled) chips.push({ key: "i", label: "Not installed", icon: "check", clear: () => set({ hideInstalled: false }) });
  const clearAll = () => { setText(""); set({ search: "", character: fixedChar ? f.character : null, category: null, kind: null, hq: false, followed: false, hideInstalled: false }); };

  const hqTip = f.kind && f.kind !== "outfit"
    ? `The best-liked ${kindLabel(f.kind).toLowerCase()} for their age, about the top fifth. Creators you prioritize always show`
    : "The best-liked outfits for their age, about the top fifth. Recolors, tools and UI are left out unless you pick that type. Creators you prioritize always show";
  const surprise = () => { void surpriseMe(game); };
  const surpriseMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    openMenu({ x: e.clientX, y: e.clientY }, [
      { label: "Surprise me", icon: "dice", onClick: surprise },
      { label: "Show all picks for you", icon: "sparkle", onClick: () => set({ sort: "foryou" }) },
      aiShown("extra", aiShow) && { label: "Ask your chatbot for ideas", icon: "ai", onClick: () => { void ideasTask(game).then(askAi); } },
    ]);
  };
  const emptyText = f.followed && !subIds.length ? "Right-click a creator's name and pick Follow, and their mods show here."
    : filteredOut > 0 ? `${plural(filteredOut, "mod")} ${filteredOut === 1 ? "is" : "are"} left out by your filters or blocked creators.`
    : f.hq && pages.dropped > 0 ? `${plural(pages.dropped, "mod")} ${pages.dropped === 1 ? "was" : "were"} left out by High quality.`
    : f.sort === "foryou" && !lib.byMod.size ? "Install a few mods and this fills with ones that suit them."
    : search ? "Try fewer or different words." : "Try another category or sort.";

  return (
    <div className={`gbb${embedded ? " is-embedded" : ""}`}>
      <div className="gbb-bar">
        <SearchField className="gbb-search" value={text} onChange={setText} placeholder={`Search ${gs.short} mods or creators`} onEnter={() => set({ search: text.trim() })} />
        <Button className="gbb-sort" variant="secondary" icon="sort" iconRight="down" title="Sort" onClick={(e) => setMenu(menu ? null : { el: e.currentTarget, kind: "sort" })}>{sortLabel(f.sort)}</Button>
        {!embedded && !!cats?.length && !fixedChar && (
          <Button className="gbb-cat" variant="secondary" icon="filter" iconRight="down" title="Show one category"
            onClick={(e) => setMenu(menu ? null : { el: e.currentTarget, kind: "cat" })}>{f.category?.name ?? "All categories"}</Button>
        )}
        <Button className="gbb-kind" variant="secondary" icon="shirt" iconRight="down" title="Show one type of mod: outfits, recolors, tools, UI ..."
          onClick={(e) => setMenu(menu ? null : { el: e.currentTarget, kind: "type" })}>{kindLabel(f.kind)}</Button>
        <Chip on={f.hq} icon="quality" onClick={() => set({ hq: !f.hq })} title={hqTip}>High quality</Chip>
        {!embedded && <Chip on={f.followed} icon="feed" onClick={toggleFollowed} title="Only mods by creators you follow">Following</Chip>}
        {!embedded && <Chip on={f.hideInstalled} icon="check" onClick={() => set({ hideInstalled: !f.hideInstalled })} title="Leave out mods you already have">Not installed</Chip>}
        {!embedded && <AdultSwitch value={nsfw} />}
        <IconButton className="gbb-surprise" icon="dice" label="Surprise me: open a mod you don't have that suits your library (right-click for more)"
          onClick={surprise} onContextMenu={surpriseMenu} />
        {!embedded && (
          <Button className="gbb-saved-btn" variant="secondary" icon="pin" iconRight="down"
            title="Saved filters: put a whole set back in one click, or save the ones on now"
            onClick={(e) => setMenu(menu ? null : { el: e.currentTarget, kind: "saved" })}>{savedNow ? savedNow.name : "Saved"}</Button>
        )}
        {embedded && <IconButton className="gbb-expand" icon="expand" label="Open the full browser (keeps these filters)" onClick={expand} />}
      </div>

      {!embedded && !fixedChar && (
        <CharRow game={game} chars={chars} value={f.character} onChange={(c) => set({ character: c })} expanded={charsOpen} onExpanded={setCharsOpen} />
      )}

      {chips.length > 0 && (
        <div className="gbb-chips" aria-label="Active filters">
          {chips.map((c) => (
            <span key={c.key} className="chip on gbb-fchip">
              {c.img ? <img className="chip-img" src={c.img} alt="" /> : c.icon && <Icon name={c.icon} />}
              <span className="chip-t">{c.label}</span>
              <button type="button" className="gbb-fchip-x" aria-label={`Remove ${c.label}`} title="Remove this filter" onClick={c.clear}><Icon name="x" /></button>
            </span>
          ))}
          {chips.length > 1 && <Button size="sm" variant="ghost" icon="x" className="gbb-clear" onClick={clearAll} title="Remove every filter">Clear all</Button>}
          {!embedded && !savedNow && !isPlain(f) && (
            <Button size="sm" variant="ghost" icon="pin" className="gbb-clear" onClick={() => saveFilters(game)}
              title="Keep this set of filters under Saved, to put it back in one click">Save filters</Button>
          )}
        </div>
      )}

      <div className="gbb-scroll">
        {pages.error && !items.length && !pinned.length ? (
          <Empty icon="warn" title="Couldn't load GameBanana" actions={<Button icon="refresh" onClick={pages.retry}>Try again</Button>}>{pages.error}</Empty>
        ) : !loading && pages.complete && !items.length && !pinned.length ? (
          <Empty icon="browse" title={f.followed && !subIds.length ? "You don't follow anyone yet" : search ? `Nothing found for "${search}"` : "No mods here"}
            actions={chips.length ? <Button icon="x" onClick={clearAll}>Clear filters</Button> : undefined}>{emptyText}</Empty>
        ) : (
          <div className="cards gb-grid" aria-busy={waiting}>
            {pinned.map((m) => <ModCard key={`p${m.id}`} game={game} mod={m} lib={lib} nsfw={nsfw} prio />)}
            {items.map((m) => <ModCard key={m.id} game={game} mod={m} lib={lib} nsfw={nsfw} prio={!!(m.submitter && creators[String(m.submitter.id)]?.prio)} />)}
            {waiting && Array.from({ length: items.length ? 6 : embedded ? 8 : 12 }, (_, i) => <CardSkeleton key={`s${i}`} />)}
          </div>
        )}
        <div ref={sentinel} className="gb-sentinel" aria-hidden="true" />
        {hasMore && (items.length > 0 || pinned.length > 0) && (
          <div className="gb-more">
            {pages.error && ready.length <= limit ? <Button icon="refresh" onClick={pages.retry}>Couldn't load more. Try again</Button>
              : <Button variant="ghost" busy={waiting} onClick={showMore}>Load more</Button>}
          </div>
        )}
        {f.hq && pages.dropped > 0 && (items.length > 0 || pinned.length > 0) && (
          <p className="hint gbb-note">High quality left out {plural(pages.dropped, "mod")}. <button type="button" className="link-btn" onClick={() => set({ hq: false })} title="Turn off High quality">Show them</button></p>
        )}
      </div>

      {menu?.kind === "saved" && (
        <Popover anchor={menu.el} onClose={() => setMenu(null)} label="Saved filters" width="19em">
          <SavedPanel game={game} f={f} onPick={() => setMenu(null)} />
        </Popover>
      )}
      {menu?.kind === "sort" && (
        <Popover anchor={menu.el} onClose={() => setMenu(null)} label="Sort" width="15em">
          <Menu items={SORTS.filter((s) => s.value !== "relevance" || f.search).map((s) => ({
            label: s.label, hint: s.value === "foryou" && f.search ? "Only the mods picked for you that match the search" : s.title,
            icon: s.value === f.sort ? "check" : undefined, onClick: () => { set({ sort: s.value }); setMenu(null); },
          }))} />
        </Popover>
      )}
      {menu?.kind === "type" && (
        <Popover anchor={menu.el} onClose={() => setMenu(null)} label="Type" width="16em">
          <Menu items={[
            { label: "All types", icon: !f.kind ? "check" : undefined, onClick: () => { set({ kind: null }); setMenu(null); } },
            "-",
            ...KINDS.map((k) => ({ label: k.label, hint: k.title, icon: f.kind === k.value ? "check" as const : undefined, onClick: () => { set({ kind: k.value }); setMenu(null); } })),
          ]} />
        </Popover>
      )}
      {menu?.kind === "cat" && (
        <Popover anchor={menu.el} onClose={() => setMenu(null)} label="Categories" width="16em">
          <Menu items={[
            { label: "All categories", icon: !f.category ? "check" : "grid", onClick: () => { set({ category: null }); setMenu(null); } },
            "-",
            ...(cats ?? []).map((c) => ({ label: c.name, icon: f.category?.id === c.id ? "check" as const : undefined, onClick: () => { set({ category: c, character: null }); setMenu(null); } })),
          ]} />
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

/** Hide, Blur, Show for mods for adults (the app-wide setting, with Undo). */
export function AdultSwitch({ value, size = "sm" }: { value: NsfwMode; size?: "sm" | "md" }) {
  return (
    <Segmented<NsfwMode> label="Mods for adults" size={size} value={value} onChange={setNsfw} options={[
      { value: "hide", label: "Hide", title: "Mods for adults: leave out mods GameBanana marks for adults" },
      { value: "blur", label: "Blur", title: "Mods for adults: blur their pictures until opened" },
      { value: "show", label: "Show", title: "Pictures show unblurred. Warning: No panic button, sorry" },
    ]} />
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
        title={cur ? `These are saved as "${cur.name}"` : isPlain(f) ? "Pick some filters first" : `Save as "${describe(f)}"`}>Save the filters on now</Button>
      {list.length === 0
        ? <p className="hint">Saved sets show here. Picking one puts back its sort, type, character, search and the rest.</p>
        : (
          <ul className="gbb-saved-l">
            {list.map((s) => (
              <li key={s.id} className={`gbb-saved-i${cur?.id === s.id ? " is-on" : ""}`} onKeyDown={(e) => {
                if (edit === s.id) return;
                if (e.key === "F2") { e.preventDefault(); setEdit(s.id); setName(s.name); }
                else if (e.key === "Delete") { e.preventDefault(); removeSaved(game, s.id); }
              }}>
                {edit === s.id
                  ? <input className="gbb-saved-in" autoFocus value={name} aria-label="New name" onChange={(e) => setName(e.target.value)} onBlur={() => finish(s.id)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); finish(s.id); } else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setEdit(null); } }} />
                  : (
                    <button type="button" className="gbb-saved-b" title={describe(s.f)} onClick={() => { applySaved(game, s); onPick(); }}>
                      <Icon name={cur?.id === s.id ? "check" : "pin"} /><span>{s.name}</span>
                    </button>
                  )}
                <IconButton size="sm" icon="edit" label="Rename (F2)" onClick={() => { setEdit(s.id); setName(s.name); }} />
                <IconButton size="sm" icon="x" label="Remove (Del). Ctrl+Z brings it back" onClick={() => removeSaved(game, s.id)} />
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}
