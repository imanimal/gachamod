// One scrolling row of GameBanana mods ("New high-quality mods", "From creators you follow"): the wheel, the arrow
// buttons, arrow keys and a controller's D-pad scroll it. "See all" opens Browse with the same filters.
// Owner: BROWSE area.
import { useEffect, useMemo, useRef, useState } from "react";
import { errorText, type GameId } from "../../lib/api";
import { filterHq, isAbort, listByCreators, listMods, useCharacterListOrNull, type GbCard, type GbSort } from "../../lib/gamebanana";
import { useCreators, useHiddenMods, useNsfw } from "../../lib/prefs";
import { recommend } from "../../lib/recommend";
import { go, useGames } from "../../lib/store";
import { Button, IconButton, Waiting } from "../../ui/kit";
import { CardSkeleton, ModCard } from "./ModCard";
import { rowKeys, useSideScroll } from "./sideScroll";
import { ShowAll, useRowOpen } from "../../ui/ShowAll";
import { openWithFilters, useLibIndex } from "./state";
import "./browse.css";

export interface GbStripQuery {
  /** "foryou": mods that suit the library (lib/recommend.ts). */
  sort?: "new" | "updated" | "popular" | "liked" | "foryou";
  /** Only mods that pass the High quality filter. */
  hq?: boolean;
  /** Only creators the user follows. */
  followed?: boolean;
  character?: string;
}

const SORT: Record<NonNullable<GbStripQuery["sort"]>, GbSort | "foryou"> = { new: "newest", updated: "updated", popular: "popular", liked: "likes", foryou: "foryou" };
const COUNT = 16;

export function GbStrip({ game, title, query, more }: { game: GameId; title: string; query: GbStripQuery; more?: () => void }) {
  const gs = useGames().find((g) => g.id === game);
  // null while the character list loads (a few seconds at most); then a name it lacks is searched for instead
  const chars = useCharacterListOrNull(game);
  const creators = useCreators();
  const hidden = useHiddenMods();
  const nsfw = useNsfw();
  const lib = useLibIndex(game);
  const [items, setItems] = useState<GbCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const sort = SORT[query.sort ?? "new"];
  const charId = query.character ? chars?.find((c) => c.name.toLowerCase() === query.character!.toLowerCase())?.id ?? null : null;
  const waitChars = !!query.character && chars === null;
  const subIds = useMemo(() => Object.values(creators).filter((c) => (c.sub || c.prio) && !c.blocked).map((c) => c.id).sort((a, b) => a - b), [creators]);
  const prio = useMemo(() => new Set(Object.values(creators).filter((c) => c.prio).map((c) => c.id)), [creators]);
  const subKey = query.followed ? subIds.join(",") : "";

  useEffect(() => {
    if (!gs || waitChars) return;
    const c = new AbortController();
    const signal = c.signal;
    setItems(null); setError(null);
    (async () => {
      const base = { gbGameId: gs.gamebananaId, sort: sort === "foryou" ? "newest" as const : sort, categoryId: charId, search: query.character && !charId ? query.character : undefined, signal };
      let out: GbCard[] = [];
      if (sort === "foryou") {
        out = await recommend(game, { limit: COUNT * 2, signal });
        if (query.character) out = out.filter((m) => m.character?.toLowerCase() === query.character!.toLowerCase());
        if (query.followed) out = out.filter((m) => m.submitter && subIds.includes(m.submitter.id));
        if (query.hq) out = await filterHq(out, gs.gamebananaId, prio, signal);
      } else if (query.followed) {
        if (!subIds.length) { setItems([]); return; }
        out = (await listByCreators(subIds, base)).items;
        if (query.hq) out = await filterHq(out, gs.gamebananaId, prio, signal);
      } else {
        for (let p = 1; p <= (query.hq ? 4 : 2) && out.length < COUNT * 1.5; p++) {
          const r = await listMods({ ...base, page: p, perPage: 40 });
          out.push(...(query.hq ? await filterHq(r.items, gs.gamebananaId, prio, signal) : r.items));
          if (r.complete) break;
        }
      }
      if (!signal.aborted) setItems(out);
    })().catch((e) => { if (!signal.aborted && !isAbort(e)) setError(errorText(e)); });
    return () => c.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gs?.gamebananaId, sort, charId, query.character, query.followed, query.hq, subKey, waitChars, attempt]);

  const shown = (items ?? []).filter((m) => !(m.submitter && creators[String(m.submitter.id)]?.blocked) && !hidden.includes(m.id) && !(nsfw === "hide" && m.nsfw)).slice(0, COUNT);
  const row = useRef<HTMLDivElement>(null);
  const [all, toggleAll] = useRowOpen(`strip.${title}`);
  const { left, right, page } = useSideScroll(row, [shown.length, all, !!error]);
  if (!gs) return null;

  const seeAll = more ?? (() => {
    openWithFilters(game, { sort, hq: !!query.hq, followed: !!query.followed, character: query.character ?? null, search: "" });
    go({ view: "browse" });
  });

  return (
    <section className="gb-strip" aria-label={title}>
      <header className="gb-strip-h">
        <h3 className="sub-h">{title}</h3>
        <span className="grow" />
        {!all && <>
          <IconButton size="sm" icon="left" label="Scroll left" disabled={!left} onClick={() => page(-1)} />
          <IconButton size="sm" icon="right" label="Scroll right" disabled={!right} onClick={() => page(1)} />
        </>}
        <ShowAll open={all} onToggle={toggleAll} fits={!items || (!left && !right)} label={`Show all ${shown.length} here`} />
        <Button size="sm" variant="ghost" iconRight="chevron" onClick={seeAll} title="Open these in Browse">See all</Button>
      </header>
      {error ? (
        <div className="gb-strip-msg hint">Couldn't load GameBanana. <button type="button" className="link-btn" onClick={() => setAttempt((a) => a + 1)}>Try again</button></div>
      ) : items && !shown.length ? (
        <div className="gb-strip-msg hint">
          {query.followed && !subIds.length ? "Follow creators (right-click a creator's name) and their new mods show here." : "Nothing new here right now."}
        </div>
      ) : !items ? (
        <Waiting what="Asking GameBanana for mods">
          <div className="gb-strip-row" aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <CardSkeleton key={i} />)}</div>
        </Waiting>
      ) : (
        <div ref={row} className={`gb-strip-row${all ? " is-all" : ""}`} role="list" onKeyDown={(e) => rowKeys(e, ".gb-card")}>
          {shown.map((m) => <ModCard key={m.id} game={game} mod={m} lib={lib} nsfw={nsfw} prio={!!(m.submitter && prio.has(m.submitter.id))} />)}
        </div>
      )}
    </section>
  );
}
