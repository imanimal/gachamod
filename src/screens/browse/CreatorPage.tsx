// A GameBanana member's page inside the app ({ view: "browse", user: id }): who they are, follow / favourite /
// priority / block, their mods for this game (most popular first), then their mods for other games.
// Owner: BROWSE area.
import { useEffect, useMemo, useState } from "react";
import { errorText, type GameState } from "../../lib/api";
import { isAbort, listMods, memberProfile, type GbCard, type GbMember } from "../../lib/gamebanana";
import { setCreatorFlag, useCreators, useNsfw, useHiddenMods } from "../../lib/prefs";
import { go, useGames } from "../../lib/store";
import { Avatar, Badge, Button, Empty, Skeleton, formatCount, plural } from "../../ui/kit";
import { menuFor, menuHandler } from "../../ui/ContextMenu";
import { openExternal } from "./actions";
import { CardSkeleton, ModCard } from "./ModCard";
import { useLibIndex } from "./state";

export function CreatorPage({ id, game }: { id: number; game: GameState }) {
  const [member, setMember] = useState<GbMember | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const creators = useCreators();
  const flags = creators[String(id)];

  useEffect(() => {
    const c = new AbortController();
    setMember(null); setError(null);
    memberProfile(id, c.signal)
      .then((m) => { if (!c.signal.aborted) { if (m) setMember(m); else setError("GameBanana didn't send this member's page."); } })
      .catch((e) => { if (!c.signal.aborted && !isAbort(e)) setError(errorText(e)); });
    return () => c.abort();
  }, [id, attempt]);

  const name = member?.name ?? flags?.name ?? "Creator";
  const ref = { id, name, avatar: member?.avatar ?? flags?.avatar ?? null };
  const flag = (k: "sub" | "fav" | "prio" | "blocked") => setCreatorFlag(ref, k, !flags?.[k]);
  const url = member?.url ?? `https://gamebanana.com/members/${id}`;

  return (
    <div className="page gb-creator">
      <header className="gb-creator-h" onContextMenu={menuHandler(() => menuFor("creator", ref))}>
        {member || flags ? <Avatar src={ref.avatar} name={name} size={88} ring={!!flags?.prio} /> : <Skeleton w={88} h={88} round />}
        <div className="gb-creator-who">
          <h1 className="gb-creator-name">{member || flags ? name : <Skeleton w="12rem" h="1.6rem" />}</h1>
          {member && (
            <div className="gb-creator-stats">
              <span title={member.rank ? `Rank ${member.rank.toLocaleString()} by points on GameBanana` : undefined}><strong>{formatCount(member.points)}</strong> points</span>
              <span><strong>{formatCount(member.subs)}</strong> subscribers</span>
              {member.submissions !== null && <span><strong>{formatCount(member.submissions)}</strong> submissions</span>}
              {member.title && <Badge>{member.title}</Badge>}
            </div>
          )}
          {error && <p className="hint">{error} <button type="button" className="link-btn" onClick={() => setAttempt((a) => a + 1)}>Try again</button></p>}
          <div className="gb-creator-act">
            <Button variant={flags?.sub ? "secondary" : "primary"} icon={flags?.sub ? "check" : "feed"} onClick={() => flag("sub")}
              title={flags?.sub ? "Stop following" : "Their new mods show on Home"}>{flags?.sub ? "Following" : "Follow"}</Button>
            <Button icon="star" className={flags?.fav ? "is-on" : undefined} aria-pressed={!!flags?.fav} onClick={() => flag("fav")}
              title={flags?.fav ? "Remove from favourite creators" : "Listed first among your creators"}>{flags?.fav ? "Favourite" : "Add to favourites"}</Button>
            <Button icon="crown" className={flags?.prio ? "is-on" : undefined} aria-pressed={!!flags?.prio} onClick={() => flag("prio")}
              title="Their mods come first in Browse and always count as high quality">{flags?.prio ? "Prioritized" : "Prioritize"}</Button>
            <Button variant={flags?.blocked ? "secondary" : "ghost"} icon="block" onClick={() => flag("blocked")}
              title={flags?.blocked ? "Show their mods again" : "Hide their mods everywhere (Undo in the toast)"}>{flags?.blocked ? "Unblock" : "Block"}</Button>
            <Button variant="ghost" icon="external" onClick={() => openExternal(url)}>Open on GameBanana</Button>
          </div>
          {flags?.blocked && <p className="hint">You blocked {name}. Their mods are hidden everywhere else.</p>}
        </div>
      </header>

      <CreatorMods id={id} game={game} name={name} />
    </div>
  );
}

/** Their mods for another game: installable when that game is set up here. */
function OtherGame({ name, list, fallback }: { name: string; list: GbCard[]; fallback: GameState["id"] }) {
  const games = useGames();
  const nsfw = useNsfw();
  const target = games.find((g) => g.gamebananaId === list[0]?.game?.id);
  const lib = useLibIndex(target?.id ?? null);
  return (
    <section className="gb-creator-sec">
      <h2 className="sub-h">{name} <span className="muted">{list.length}</span></h2>
      <div className="cards gb-grid gb-grid-other">
        {list.map((m) => <ModCard key={m.id} game={target?.id ?? fallback} mod={m} lib={lib} nsfw={nsfw} noInstall={!target} />)}
      </div>
    </section>
  );
}

function CreatorMods({ id, game, name }: { id: number; game: GameState; name: string }) {
  const nsfw = useNsfw();
  const hidden = useHiddenMods();
  const lib = useLibIndex(game.id);
  const [here, setHere] = useState<GbCard[] | null>(null);
  const [herePage, setHerePage] = useState(1);
  const [hereDone, setHereDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [elsewhere, setElsewhere] = useState<GbCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const c = new AbortController();
    setHere(null); setElsewhere(null); setError(null); setHerePage(1);
    listMods({ gbGameId: game.gamebananaId, submitterId: id, page: 1, perPage: 30, sort: "popular", signal: c.signal })
      .then((r) => { if (!c.signal.aborted) { setHere(r.items); setHereDone(r.complete); } })
      .catch((e) => { if (!c.signal.aborted && !isAbort(e)) setError(errorText(e)); });
    listMods({ gbGameId: 0, submitterId: id, page: 1, perPage: 50, sort: "popular", signal: c.signal })
      .then((r) => { if (!c.signal.aborted) setElsewhere(r.items.filter((m) => m.game && m.game.id !== game.gamebananaId)); })
      .catch(() => { if (!c.signal.aborted) setElsewhere([]); });
    return () => c.abort();
  }, [id, game.gamebananaId]);

  const loadMore = async () => {
    setBusy(true);
    try {
      const r = await listMods({ gbGameId: game.gamebananaId, submitterId: id, page: herePage + 1, perPage: 30, sort: "popular" });
      setHere((h) => { const seen = new Set(h?.map((m) => m.id)); return [...(h ?? []), ...r.items.filter((m) => !seen.has(m.id))]; });
      setHerePage((p) => p + 1);
      setHereDone(r.complete);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  const keep = (m: GbCard) => !hidden.includes(m.id) && !(nsfw === "hide" && m.nsfw);
  const groups = useMemo(() => {
    const by = new Map<string, GbCard[]>();
    for (const m of elsewhere ?? []) if (keep(m)) { const g = m.game?.name || "Other games"; by.set(g, [...(by.get(g) ?? []), m]); }
    return [...by.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [elsewhere, hidden, nsfw]); // eslint-disable-line react-hooks/exhaustive-deps
  const mine = (here ?? []).filter(keep);
  const hiddenHere = (here?.length ?? 0) - mine.length;

  return (
    <>
      <section className="gb-creator-sec">
        <h2 className="sub-h">{name}'s mods for {game.name}</h2>
        {error && !here ? <Empty icon="warn" title="Couldn't load their mods">{error}</Empty>
          : here && !mine.length ? <p className="muted">{hiddenHere ? <>{plural(hiddenHere, "mod")} for adults {hiddenHere === 1 ? "is" : "are"} hidden. <Button size="sm" variant="ghost" icon="eye" title="Settings, Mods" onClick={() => go({ view: "settings", section: "set-nsfw" })}>Mods for adults</Button></> : `No mods for ${game.short} yet.`}</p>
          : (
            <div className="cards gb-grid">
              {here ? mine.map((m) => <ModCard key={m.id} game={game.id} mod={m} lib={lib} nsfw={nsfw} />)
                : Array.from({ length: 8 }, (_, i) => <CardSkeleton key={i} />)}
            </div>
          )}
        {here && !hereDone && <div className="gb-more"><Button variant="ghost" busy={busy} onClick={() => void loadMore()}>Load more</Button></div>}
      </section>
      {groups.map(([g, list]) => <OtherGame key={g} name={g} list={list} fallback={game.id} />)}
    </>
  );
}
