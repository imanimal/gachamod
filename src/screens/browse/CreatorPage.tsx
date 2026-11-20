// A GameBanana member's page inside the app ({ view: "browse", user: id }): who they are, follow / favourite /
// prioritize / block, their mods for this game (most downloaded or newest first), then their mods for other games.
// Owner: BROWSE area.
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { errorText, type GameState } from "../../lib/api";
import { isAbort, isNotFound, listMods, memberProfile, memberUberstyle, type GbCard, type GbMember } from "../../lib/gamebanana";
import { setCreatorFlag, useCreatorStyles, useCreators, useNsfw, useHiddenMods, useUberstyles } from "../../lib/prefs";
import { go, useGames } from "../../lib/store";
import { tokenHex, useTheme } from "../../lib/theme";
import { nameStyleProps, themeBg } from "../../lib/nameStyle";
import { uberScheme, uberTheme, uberVars } from "../../lib/uberstyle";
import { CreatorCard } from "./CreatorCard";
import { Cubeatar } from "../../ui/Cubeatar";
import "./uberstyle.css";
import { Avatar, Badge, Button, Empty, Segmented, Skeleton, Waiting, formatCount } from "../../ui/kit";
import { menuHandler } from "../../ui/ContextMenu";
import { creatorItems } from "./menus";
import { openExternal } from "./actions";
import { CardSkeleton, ModCard } from "./ModCard";
import { useLibIndex } from "./state";
import { moveInGrid } from "../library/gridNav";
import { gameName, gameShort } from "../../lib/games";
import { t, tn, tx } from "../../lib/i18n";

export function CreatorPage({ id, game }: { id: number; game: GameState }) {
  const [member, setMember] = useState<GbMember | null>(null);
  const [error, setError] = useState<string | null>(null);
  // GameBanana has no such member (removed or never there): following them would do nothing
  const [gone, setGone] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // their name as their mods give it, for when the member page didn't load
  const [seenName, setSeenName] = useState<string | null>(null);
  const creators = useCreators();
  const flags = creators[String(id)];

  useEffect(() => {
    const c = new AbortController();
    setMember(null); setError(null); setGone(false);
    memberProfile(id, c.signal)
      .then((m) => { if (!c.signal.aborted) { if (m) setMember(m); else setError(t("GameBanana didn't send this member's page.")); } })
      .catch((e) => {
        if (c.signal.aborted || isAbort(e)) return;
        setGone(isNotFound(e));
        setError(isNotFound(e) ? t("GameBanana doesn't have this member. Their account may have been removed.") : errorText(e));
      });
    return () => c.abort();
  }, [id, attempt]);

  const name = member?.name ?? flags?.name ?? seenName ?? t("Creator");
  const known = !!(member || flags || error);
  const ref = { id, name, avatar: member?.avatar ?? flags?.avatar ?? null };
  const flag = (k: "sub" | "fav" | "prio" | "blocked") => setCreatorFlag(ref, k, !flags?.[k]);
  const url = member?.url ?? `https://gamebanana.com/members/${id}`;
  // their Uberstyle (the CSS they made for their GameBanana profile), read into this page's tokens and never
  // injected. The theme around the page goes in as the palette, so every colour is checked against what's on screen.
  const showUber = useUberstyles();
  const theme = useTheme();
  const [uberCss, setUberCss] = useState<{ id: number; css: string } | null>(null);
  useEffect(() => {
    if (!showUber) return;
    const c = new AbortController();
    memberUberstyle(id, c.signal).then((css) => { if (!c.signal.aborted && css) setUberCss({ id, css }); }).catch(() => {});
    return () => c.abort();
  }, [id, showUber]);
  const uberRead = useMemo(() => (uberCss && uberCss.id === id ? uberTheme(uberCss.css) : null), [uberCss, id]);
  const uber = useMemo(() => {
    if (!showUber || !uberRead) return null;
    const palette = { bg: tokenHex("--bg"), surface: tokenHex("--surface"), text: tokenHex("--text"), accent: tokenHex("--accent") };
    return { vars: uberVars(uberRead, theme.scheme, palette), scheme: uberScheme(uberRead, theme.scheme, palette) };
  }, [showUber, uberRead, theme]);
  const openUberSetting = () => go({ view: "settings", section: "set-uberstyles" });

  // the menu matches the buttons: for a removed member, Follow and Prioritize only show to turn them off
  const menu = () => creatorItems(ref, { gone, uber: !!uber, page: true });

  // what they set on GameBanana: name style (colour moved just far enough to read here, on their Uberstyle's page
  // when it has one), upic, hover avatar, Cubeatar, hover card style, signature. Settings, Creators turns it all off.
  const showStyles = useCreatorStyles();
  const style = showStyles ? member?.style ?? null : null;
  const own = style ? nameStyleProps(style, uber?.vars["--bg"] ?? themeBg(), 3) : null;
  const hoverAvatar = showStyles ? member?.hoverAvatar ?? null : null;
  // a Cubeatar takes the avatar's place; if its picture doesn't load, the flat avatar comes back
  const [cubeFailed, setCubeFailed] = useState<string | null>(null);
  const cube = showStyles && member?.cube && member.cube.src !== cubeFailed ? member.cube : null;

  return (
    <div className={`page gb-creator${uber ? " uber" : ""}`} style={uber ? ({ ...uber.vars, colorScheme: uber.scheme } as CSSProperties) : undefined}>
      <header className="gb-creator-h" onContextMenu={menuHandler(menu)}>
        {known ? cube ? (
          <span className="gb-creator-av is-cube">
            <Cubeatar src={cube.src} speed={cube.speed} axes={cube.axes} size={88} title={name} onError={() => setCubeFailed(cube.src)} />
          </span>
        ) : (
          <span className="gb-creator-av">
            <Avatar src={ref.avatar} name={name} size={88} ring={!!flags?.prio} />
            {hoverAvatar && <img key={hoverAvatar} className="gb-creator-av-alt" src={hoverAvatar} alt="" onError={(e) => { e.currentTarget.hidden = true; }} />}
          </span>
        ) : <Skeleton w={88} h={88} round />}
        <div className="gb-creator-who">
          {known ? <h1 className={`gb-creator-name${own ? ` ${own.className}` : ""}`} style={own?.style}>{name}</h1> : (
            <Waiting what={t("Asking GameBanana about this creator")}>
              <Skeleton w="12rem" h="1.6rem" />
            </Waiting>
          )}
          {style?.upic && (
            <img key={style.upic} className="gb-creator-upic" src={style.upic} alt="" title={t("The picture {name} uses as their name on GameBanana", { name })}
              onError={(e) => { e.currentTarget.hidden = true; }} />
          )}
          {member && (
            <div className="gb-creator-stats">
              <span title={member.rank ? t("Rank {rank} by points on GameBanana", { rank: member.rank }) : undefined}>{tx("{n} points", { n: <strong>{formatCount(member.points)}</strong> })}</span>
              <span>{tx("{n} subscribers", { n: <strong>{formatCount(member.subs)}</strong> })}</span>
              {member.submissions !== null && <span>{tx("{n} submissions", { n: <strong>{formatCount(member.submissions)}</strong> })}</span>}
              {member.title && <Badge>{member.title}</Badge>}
              {member.honorary && <span title={t("A title from GameBanana's staff")}><Badge tone="accent">{member.honorary}</Badge></span>}
              {uber && <Badge icon="palette" onClick={openUberSetting} title={t("The colours and fonts here come from {name}'s Uberstyle on GameBanana. Click for the setting", { name })}>{t("Uberstyle")}</Badge>}
            </div>
          )}
          {error && <p className="hint">{error} {!gone && <button type="button" className="link-btn" onClick={() => setAttempt((a) => a + 1)}>{t("Try again")}</button>}</p>}
          <div className="gb-creator-act">
            {(!gone || flags?.sub) && (
              <Button variant={flags?.sub ? "secondary" : "primary"} icon={flags?.sub ? "check" : "feed"} onClick={() => flag("sub")}
                title={flags?.sub ? t("Stop following") : t("Their new mods show on Home")}>{flags?.sub ? t("Following") : t("Follow")}</Button>
            )}
            <Button icon="star" className={flags?.fav ? "is-on" : undefined} aria-pressed={!!flags?.fav} onClick={() => flag("fav")}
              title={flags?.fav ? t("Remove from favourite creators") : t("Listed first among your creators")}>{t("Favourite")}</Button>
            {(!gone || flags?.prio) && (
              <Button icon="crown" className={flags?.prio ? "is-on" : undefined} aria-pressed={!!flags?.prio} onClick={() => flag("prio")}
                title={flags?.prio ? t("Stop prioritizing. Their mods come first in Browse and always count as high quality") : t("Their mods come first in Browse and always count as high quality")}>{t("Prioritize")}</Button>
            )}
            <Button variant={flags?.blocked ? "secondary" : "ghost"} icon="block" onClick={() => flag("blocked")}
              title={flags?.blocked ? t("Show their mods again") : t("Hide their mods everywhere (Undo in the toast)")}>{flags?.blocked ? t("Unblock") : t("Block")}</Button>
            <Button variant="ghost" icon="external" onClick={() => openExternal(url)}>{t("Open on GameBanana")}</Button>
          </div>
          {flags?.blocked && <p className="hint">{t("You blocked {name}. Their mods are hidden everywhere else.", { name })}</p>}
          {member && <CreatorCard member={member} styled={showStyles} />}
          {showStyles && member?.sig && (
            <img key={member.sig} className="gb-sig" src={member.sig} alt="" title={t("{name}'s signature on GameBanana", { name })}
              onError={(e) => { e.currentTarget.hidden = true; }} />
          )}
        </div>
      </header>

      <CreatorMods id={id} game={game} name={name} onName={setSeenName} />
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
      <div className="cards gb-grid gb-grid-other" onKeyDown={(e) => moveInGrid(e, e.currentTarget, ".gb-card")}>
        {list.map((m) => <ModCard key={m.id} game={target?.id ?? fallback} mod={m} lib={lib} nsfw={nsfw} noInstall={!target} />)}
      </div>
    </section>
  );
}

type CreatorSort = "popular" | "newest";
/** The sort for creators' lists, kept while the app runs. */
let creatorSort: CreatorSort = "popular";

function CreatorMods({ id, game, name, onName }: { id: number; game: GameState; name: string; onName: (name: string | null) => void }) {
  const nsfw = useNsfw();
  const hidden = useHiddenMods();
  const lib = useLibIndex(game.id);
  const [here, setHere] = useState<GbCard[] | null>(null);
  const [herePage, setHerePage] = useState(1);
  const [hereDone, setHereDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [elsewhere, setElsewhere] = useState<GbCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<CreatorSort>(creatorSort);
  const [attempt, setAttempt] = useState(0);
  // mods hidden with Not interested show again while this is on
  const [showHidden, setShowHidden] = useState(false);
  const pickSort = (s: CreatorSort) => { creatorSort = s; setSort(s); };
  const nameFrom = (list: GbCard[]) => { const n = list.find((m) => m.submitter?.id === id)?.submitter?.name; if (n) onName(n); };

  useEffect(() => {
    const c = new AbortController();
    setHere(null); setError(null); setHerePage(1);
    listMods({ gbGameId: game.gamebananaId, submitterId: id, page: 1, perPage: 30, sort, signal: c.signal })
      .then((r) => { if (!c.signal.aborted) { setHere(r.items); setHereDone(r.complete); nameFrom(r.items); } })
      .catch((e) => { if (!c.signal.aborted && !isAbort(e)) setError(errorText(e)); });
    return () => c.abort();
  }, [id, game.gamebananaId, sort, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const c = new AbortController();
    setElsewhere(null);
    listMods({ gbGameId: 0, submitterId: id, page: 1, perPage: 50, sort: "popular", signal: c.signal })
      .then((r) => { if (!c.signal.aborted) { setElsewhere(r.items.filter((m) => m.game && m.game.id !== game.gamebananaId)); nameFrom(r.items); } })
      .catch(() => { if (!c.signal.aborted) setElsewhere([]); });
    return () => c.abort();
  }, [id, game.gamebananaId, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = async () => {
    setBusy(true); setError(null);
    try {
      const r = await listMods({ gbGameId: game.gamebananaId, submitterId: id, page: herePage + 1, perPage: 30, sort });
      setHere((h) => { const seen = new Set(h?.map((m) => m.id)); return [...(h ?? []), ...r.items.filter((m) => !seen.has(m.id))]; });
      setHerePage((p) => p + 1);
      setHereDone(r.complete);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  const youHid = (m: GbCard) => !showHidden && hidden.includes(m.id);
  const keep = (m: GbCard) => !youHid(m) && !(nsfw === "hide" && m.nsfw);
  const groups = useMemo(() => {
    const by = new Map<string, GbCard[]>();
    for (const m of elsewhere ?? []) if (keep(m)) { const g = m.game?.name || t("Other games"); by.set(g, [...(by.get(g) ?? []), m]); }
    return [...by.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [elsewhere, hidden, showHidden, nsfw]); // eslint-disable-line react-hooks/exhaustive-deps
  const mine = (here ?? []).filter(keep);
  // what the list leaves out, and why: mods the user hid, and mods for adults
  const all = [...(here ?? []), ...(elsewhere ?? [])];
  const hid = all.filter(youHid).length;
  const adults = all.filter((m) => !youHid(m) && nsfw === "hide" && m.nsfw).length;

  return (
    <>
      <section className="gb-creator-sec">
        <div className="row gb-creator-sec-h" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
          <h2 className="sub-h">{t("{name}'s mods for {game}", { name, game: gameName(game) })}</h2>
          <Segmented<CreatorSort> label={t("Sort")} size="sm" value={sort} onChange={pickSort} options={[
            { value: "popular", label: t("Most downloaded"), title: t("Most downloaded of all time") },
            { value: "newest", label: t("New"), title: t("Newest first") },
          ]} />
        </div>
        {error && !here ? <Empty icon="warn" title={t("Couldn't load their mods")} actions={<Button icon="refresh" onClick={() => setAttempt((a) => a + 1)}>{t("Try again")}</Button>}>{error}</Empty>
          : !here ? (
            <Waiting what={t("Asking GameBanana for mods")}>
              <div className="cards gb-grid" aria-hidden="true">{Array.from({ length: 8 }, (_, i) => <CardSkeleton key={i} />)}</div>
            </Waiting>
          )
          : here && !mine.length ? <p className="muted">{here.length ? t("Every mod for {game} is left out.", { game: gameShort(game) }) : t("No mods for {game} yet.", { game: gameShort(game) })}</p>
          : (
            <div className="cards gb-grid" onKeyDown={(e) => moveInGrid(e, e.currentTarget, ".gb-card")}>
              {mine.map((m) => <ModCard key={m.id} game={game.id} mod={m} lib={lib} nsfw={nsfw} />)}
            </div>
          )}
        {(hid > 0 || adults > 0) && (
          <p className="hint">
            {tn(hid + adults, "{n} mod is left out:", "{n} mods are left out:")}{" "}
            {hid > 0 && <>{tn(hid, "{n} you hid", "{n} you hid")} <button type="button" className="link-btn" title={t("Show the mods you picked Not interested on")} onClick={() => setShowHidden(true)}>{t("Show them")}</button></>}
            {hid > 0 && adults > 0 && ", "}
            {adults > 0 && <>{tn(adults, "{n} for adults", "{n} for adults")} <button type="button" className="link-btn" title={t("Settings, GameBanana")} onClick={() => go({ view: "settings", section: "set-nsfw" })}>{t("Mods for adults")}</button></>}
          </p>
        )}
        {showHidden && (
          <p className="hint">{t("Showing the mods you hid.")} <button type="button" className="link-btn" title={t("Hide the mods you picked Not interested on again")} onClick={() => setShowHidden(false)}>{t("Hide them again")}</button></p>
        )}
        {here && !hereDone && (
          <div className="gb-more">
            {error && !busy ? <Button icon="refresh" title={error} onClick={() => void loadMore()}>{t("Couldn't load more. Try again")}</Button>
              : <Button variant="ghost" busy={busy} onClick={() => void loadMore()}>{t("Load more")}</Button>}
          </div>
        )}
      </section>
      {groups.map(([g, list]) => <OtherGame key={g} name={g} list={list} fallback={game.id} />)}
    </>
  );
}
