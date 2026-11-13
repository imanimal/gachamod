// Browse: GameBanana mods for the current game, with search, sort, character and category filters, and each mod's
// page in a drawer. Owner: ONLINE area (docs/spec.md, "Downloads and Browse").
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Avatar, Badge, Button, Card, Chip, Empty, IconButton, Menu, PageHeader, SearchField, Segmented, Skeleton, formatCount, timeAgo } from "../../ui/kit";
import { Icon } from "../../ui/Icon";
import { Popover } from "../../ui/Popover";
import { toast } from "../../ui/toast";
import { errorText, library, settings, shell, type GameState, type ModEntry } from "../../lib/api";
import { held } from "../../lib/tauri";
import { categories, characterList, imageAt, isAbort, listMods, type GbCard, type GbCategoryRef, type GbSort } from "../../lib/gamebanana";
import { consumeRoute, useGame, useRoute } from "../../lib/store";
import { ModDrawer } from "./ModDrawer";
import { useQueue } from "./useQueue";
import "./browse.css";

export type NsfwMode = "hide" | "blur" | "show";

const SORTS: Array<{ value: GbSort; label: string; title: string }> = [
  { value: "popular", label: "Popular", title: "Most downloaded first (best match when searching)" },
  { value: "newest", label: "New", title: "Newest first" },
  { value: "updated", label: "Updated", title: "Recently updated mods" },
  { value: "likes", label: "Most liked", title: "Most liked first" },
];
const SORT_KEY = "gm.browse.sort";
const readSort = (): GbSort => {
  try { const v = localStorage.getItem(SORT_KEY); if (SORTS.some((s) => s.value === v)) return v as GbSort; } catch { /* storage unavailable */ }
  return "popular";
};

export function Browse() {
  const game = useGame();
  if (!game) return null;
  return <BrowseGame game={game} />;
}

function BrowseGame({ game }: { game: GameState }) {
  const route = useRoute();
  const snap = useQueue();
  const [text, setText] = useState(route.search ?? "");
  const [query, setQuery] = useState((route.search ?? "").trim());
  const [sort, setSortState] = useState<GbSort>(readSort);
  const [chars, setChars] = useState<GbCategoryRef[]>([]);
  const [cats, setCats] = useState<GbCategoryRef[]>([]);
  const [character, setCharacter] = useState<GbCategoryRef | null>(null);
  const [category, setCategory] = useState<GbCategoryRef | null>(null);
  const wantChar = useRef<string | null>(route.character ?? null);
  const [nsfw, setNsfwState] = useState<NsfwMode>("blur");
  const [openId, setOpenId] = useState<number | null>(null);
  const [lib, setLib] = useState<ModEntry[]>([]);
  const [catMenu, setCatMenu] = useState<HTMLElement | null>(null);

  // one-shot route params: a mod to open, a character to filter, a search
  useEffect(() => {
    const id = typeof route.modId === "number" ? route.modId : Number(route.modId);
    if (route.modId !== undefined && Number.isFinite(id) && id > 0) setOpenId(id);
    if (route.character) {
      wantChar.current = route.character;
      const hit = chars.find((c) => c.name.toLowerCase() === route.character!.toLowerCase());
      if (hit) { setCharacter(hit); setCategory(null); wantChar.current = null; }
    }
    if (route.search !== undefined) { setText(route.search); setQuery(route.search.trim()); }
    if (route.modId !== undefined || route.character || route.search !== undefined) consumeRoute(["modId", "character", "search"]);
  }, [route.modId, route.character, route.search, chars]);

  // search waits for typing to pause
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(text.trim()), 350);
    return () => window.clearTimeout(t);
  }, [text]);

  const setSort = (s: GbSort) => {
    setSortState(s);
    try { localStorage.setItem(SORT_KEY, s); } catch { /* storage unavailable */ }
  };

  useEffect(() => {
    let live = true;
    settings.get("ui.nsfw").then((v) => { if (live && (v === "hide" || v === "blur" || v === "show")) setNsfwState(v); }).catch(() => {});
    characterList(game.id).then((list) => {
      if (!live) return;
      setChars(list);
      const want = wantChar.current?.toLowerCase();
      const hit = want ? list.find((c) => c.name.toLowerCase() === want) : undefined;
      if (hit) { setCharacter(hit); wantChar.current = null; }
    }).catch(() => {});
    categories(game.gamebananaId).then((list) => { if (live) setCats(list); }).catch(() => {});
    return () => { live = false; };
  }, [game.id, game.gamebananaId]);

  const setNsfw = (v: NsfwMode) => {
    setNsfwState(v);
    settings.set("ui.nsfw", v).catch((e) => toast(errorText(e), true));
  };

  // the library, to mark what is installed
  useEffect(() => {
    let live = true;
    const load = () => library.list(game.id).then((l) => { if (live) setLib(l); }).catch(() => {});
    void load();
    const off = held(library.onChanged((p) => { if (p.game === game.id) void load(); }));
    return () => { live = false; off(); };
  }, [game.id]);
  const byMod = useMemo(() => {
    const m = new Map<number, ModEntry[]>();
    for (const e of lib) if (e.source?.modId) m.set(e.source.modId, [...(m.get(e.source.modId) ?? []), e]);
    return m;
  }, [lib]);

  // pages of mods
  const [items, setItems] = useState<GbCard[]>([]);
  const [page, setPage] = useState(0);
  const [complete, setComplete] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const filterId = character?.id ?? category?.id ?? null;

  const load = useCallback(async (p: number, reset: boolean) => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setLoading(true);
    setError(null);
    if (reset) { setItems([]); setComplete(false); setPage(0); }
    try {
      const r = await listMods({ gbGameId: game.gamebananaId, page: p, perPage: 30, sort, categoryId: filterId, search: query, signal: c.signal });
      if (c.signal.aborted) return;
      setItems((prev) => {
        const base = reset ? [] : prev;
        const seen = new Set(base.map((i) => i.id));
        return [...base, ...r.items.filter((i) => !seen.has(i.id))];
      });
      setPage(p);
      setComplete(r.complete);
    } catch (e) {
      if (!c.signal.aborted && !isAbort(e)) setError(errorText(e));
    } finally {
      if (ctrl.current === c) setLoading(false);
    }
  }, [game.gamebananaId, sort, filterId, query]);

  useEffect(() => {
    void load(1, true);
    return () => ctrl.current?.abort();
  }, [load]);

  const more = useCallback(() => {
    if (!loading && !complete && !error && page > 0) void load(page + 1, false);
  }, [loading, complete, error, page, load]);

  // infinite scroll: load the next page when the end of the grid comes near
  const sentinel = useRef<HTMLDivElement>(null);
  const [nearEnd, setNearEnd] = useState(false);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => setNearEnd(entries.some((e) => e.isIntersecting)), { rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => { if (nearEnd) more(); }, [nearEnd, more]);

  const shown = nsfw === "hide" ? items.filter((i) => !i.nsfw) : items;
  const hiddenCount = items.length - shown.length;
  const closeDrawer = useCallback(() => setOpenId(null), []);
  const pickCharacter = (c: GbCategoryRef | null) => { setCharacter(c); setCategory(null); };
  const filterLabel = category?.name ?? "All categories";

  return (
    <div className="page gb-browse">
      <PageHeader title="Browse" icon="browse" sub={`Mods for ${game.name} on GameBanana`}
        actions={<>
          <Segmented<NsfwMode> label="Mods for adults" size="sm" value={nsfw} onChange={setNsfw} options={[
            { value: "hide", label: "Hide", title: "Leave out mods GameBanana marks for adults" },
            { value: "blur", label: "Blur", title: "Blur their pictures until opened" },
            { value: "show", label: "Show", title: "Show everything" },
          ]} />
          <IconButton icon="external" label="Open GameBanana in the browser"
            onClick={() => shell.openUrl(`https://gamebanana.com/games/${game.gamebananaId}`).catch((e) => toast(errorText(e), true))} />
        </>}>
        <div className="gb-filters">
          <SearchField className="gb-search" value={text} onChange={setText} placeholder={`Search ${game.short} mods`} onEnter={() => setQuery(text.trim())} />
          <Segmented<GbSort> label="Sort" value={sort} onChange={setSort} options={SORTS} />
          {cats.length > 0 && (
            <Button className="gb-cat-btn" variant="secondary" icon="filter" iconRight="down" onClick={(e) => setCatMenu(catMenu ? null : e.currentTarget)}
              title="Show one category">{character ? character.name : filterLabel}</Button>
          )}
        </div>
        {chars.length > 0 && (
          <div className="gb-chars" role="toolbar" aria-label="Characters">
            <Chip className="gb-char" on={!character} onClick={() => pickCharacter(null)} icon="characters">All</Chip>
            {chars.map((c) => (
              <Chip key={c.id} className="gb-char" on={character?.id === c.id} img={c.icon} title={c.name}
                onClick={() => pickCharacter(character?.id === c.id ? null : c)}>{c.name}</Chip>
            ))}
          </div>
        )}
      </PageHeader>

      {error && items.length === 0 ? (
        <Empty icon="warn" title="Couldn't load GameBanana" actions={<Button icon="refresh" onClick={() => void load(1, true)}>Try again</Button>}>{error}</Empty>
      ) : !loading && shown.length === 0 && complete ? (
        <Empty icon="browse" title={query ? `Nothing found for "${query}"` : "No mods here yet"}>
          {hiddenCount > 0 ? `${hiddenCount} mods for adults are hidden. Change that with the Hide, Blur, Show switch.` : query ? "Try fewer or different words, or clear the character filter." : "Try another category or sort."}
        </Empty>
      ) : (
        <div className="cards gb-grid" aria-busy={loading}>
          {shown.map((m) => (
            <ModCard key={m.id} mod={m} nsfw={nsfw} lib={byMod.get(m.id)} onOpen={() => setOpenId(m.id)} />
          ))}
          {loading && Array.from({ length: items.length ? 4 : 12 }, (_, i) => (
            <div key={`skel-${i}`} className="card gb-card gb-card-skel" aria-hidden="true">
              <Skeleton className="gb-card-img" />
              <div className="gb-card-b"><Skeleton w="80%" h="1rem" /><Skeleton w="50%" h=".8rem" /></div>
            </div>
          ))}
        </div>
      )}

      <div ref={sentinel} className="gb-sentinel" aria-hidden="true" />
      {!complete && items.length > 0 && (
        <div className="gb-more">
          {error ? <Button icon="refresh" onClick={() => { setError(null); void load(page + 1, false); }}>Couldn't load more. Try again</Button>
            : <Button variant="ghost" busy={loading} onClick={more}>Load more</Button>}
        </div>
      )}

      {catMenu && (
        <Popover anchor={catMenu} onClose={() => setCatMenu(null)} label="Categories" width="16em">
          <Menu items={[
            { label: "All categories", icon: "grid", onClick: () => { setCategory(null); setCharacter(null); setCatMenu(null); } },
            "-",
            ...cats.map((c) => ({ label: c.name, onClick: () => { setCategory(c); setCharacter(null); setCatMenu(null); } })),
          ]} />
        </Popover>
      )}
      {openId !== null && <ModDrawer game={game} modId={openId} lib={lib} snap={snap} nsfw={nsfw} onClose={closeDrawer} />}
    </div>
  );
}

function ModCard({ mod, nsfw, lib, onOpen }: { mod: GbCard; nsfw: NsfwMode; lib: ModEntry[] | undefined; onOpen: () => void }) {
  const [broken, setBroken] = useState(false);
  const blurred = mod.nsfw && nsfw === "blur";
  const update = lib?.some((m) => m.updateAvailable);
  const src = imageAt(mod.image, 530);
  return (
    <Card className={`gb-card${blurred ? " is-nsfw" : ""}`} onClick={onOpen} title={mod.name}>
      <span className="gb-card-img">
        {src && !broken
          ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />
          : <span className="gb-img-broken"><Icon name="image" /></span>}
        {mod.nsfw && <span className="gb-nsfw-badge" title="Marked for adults on GameBanana">18+</span>}
        {lib && lib.length > 0 && (
          <span className="gb-card-state">
            {update ? <Badge tone="accent" icon="update">Update</Badge> : <Badge tone="ok" icon="check">Installed</Badge>}
          </span>
        )}
      </span>
      <span className="gb-card-b">
        <span className="gb-card-t">{mod.name}</span>
        {(mod.character ?? mod.category?.name) && <span className="gb-card-c">{mod.character ?? mod.category?.name}</span>}
        <span className="gb-card-meta">
          {mod.submitter && <span className="gb-card-by"><Avatar src={mod.submitter.avatar} name={mod.submitter.name} size={18} /><span>{mod.submitter.name}</span></span>}
          <span className="gb-stat" title="Likes"><Icon name="heart" />{formatCount(mod.likes)}</span>
          <span className="gb-stat" title="Views"><Icon name="eye" />{formatCount(mod.views)}</span>
          <span className="gb-stat" title={new Date(mod.updated * 1000).toLocaleString()}>{timeAgo(mod.updated)}</span>
        </span>
      </span>
    </Card>
  );
}

