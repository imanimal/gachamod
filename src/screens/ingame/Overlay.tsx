// The menu shown over a running game (src-tauri overlay.rs): its own window, opened with the menu key or by pressing
// both sticks of a controller. Characters down the left with their pictures, the picked character's skins and other
// mods on the right, any mod's details, and GameBanana to get more. Picking a skin shows it in the game and the menu
// stays open. In a browser, #overlay shows it with the demo data. Owner: INGAME area.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorText, fileUrl, library, skinMenu, type GameId, type LiveGroup, type ModEntry } from "../../lib/api";
import { imageAt, isAbort, listMods, queueLatest, useCharacterList, type GbCard } from "../../lib/gamebanana";
import { installGamepad, moveFocus } from "../../lib/gamepad";
import { useNsfw } from "../../lib/prefs";
import { refreshGames, useGames } from "../../lib/store";
import { held, listen } from "../../lib/tauri";
import { applyGameTheme } from "../../lib/theme";
import { Icon } from "../../ui/Icon";
import { Badge, Button, IconButton, SearchField, Segmented, Skeleton, Waiting, formatBytes, plural, timeAgo } from "../../ui/kit";
import { LazyImg } from "../../ui/LazyImg";
import { Portrait } from "../../ui/Portrait";
import { reloadLive, useLive } from "./data";
import "./overlay.css";

type Tab = "mine" | "browse";
/** Mods with no character sit under this name, last in the list. */
const OTHER = "Other mods";

const recentKey = (game: GameId) => `overlay.recent.${game}`;
function recent(game: GameId): string[] {
  try { return (JSON.parse(localStorage.getItem(recentKey(game)) ?? "[]") as unknown[]).filter((x): x is string => typeof x === "string"); } catch { return []; }
}
function touch(game: GameId, character: string) {
  try { localStorage.setItem(recentKey(game), JSON.stringify([character, ...recent(game).filter((c) => c !== character)].slice(0, 40))); } catch { /* the order just isn't kept */ }
}

export function Overlay() {
  const [game, setGame] = useState<GameId | null>(null);
  const [opened, setOpened] = useState(0);
  const games = useGames();
  const state = games.find((g) => g.id === game) ?? null;

  useEffect(() => {
    void refreshGames();
    void skinMenu.game().then((g) => { if (g) setGame(g); });
    return held(listen<{ game: GameId }>("overlay-open", (p) => { setGame(p.game); void reloadLive(p.game); setOpened((n) => n + 1); }));
  }, []);
  useEffect(() => { applyGameTheme(state); }, [state?.id, state?.theme, state?.accent]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!game) return <div className="ov"><div className="ov-wait"><Waiting what="Finding the game this menu is for" /></div></div>;
  return <Menu key={game} game={game} gbGameId={state?.gamebananaId ?? null} opened={opened} />;
}

/** One character in the list: the skins that switch in game (if any) and the rest of its mods. */
interface Who { name: string; group: LiveGroup | null; mods: ModEntry[]; showing: string | null }

/** The game's installed mods (null while reading), read again each time the menu opens and when the library changes. */
function useMods(game: GameId, opened: number): [ModEntry[] | null, () => Promise<void>] {
  const [mods, setMods] = useState<ModEntry[] | null>(null);
  const live = useRef(true);
  const load = useCallback(
    () => library.list(game).then((l) => { if (live.current) setMods(l); }).catch(() => { if (live.current) setMods((m) => m ?? []); }),
    [game]);
  useEffect(() => {
    live.current = true;
    void load();
    const off = held(library.onChanged((p) => { if (p.game === game) void load(); }));
    return () => { live.current = false; off(); };
  }, [game, opened, load]);
  return [mods, load];
}

function Menu({ game, gbGameId, opened }: { game: GameId; gbGameId: number | null; opened: number }) {
  const info = useLive(game);
  const [mods, reloadMods] = useMods(game, opened);
  const [tab, setTab] = useState<Tab>("mine");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const [detail, setDetail] = useState<{ mod: ModEntry } | { card: GbCard } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const close = useCallback(() => void skinMenu.hide(game), [game]);
  const detailRef = useRef(detail);
  detailRef.current = detail;

  const everyone = useMemo<Who[]>(() => {
    if (!info || !mods) return [];
    const byId = new Map(mods.map((m) => [m.id, m]));
    const live = new Set(info.groups.flatMap((g) => g.mods.map((m) => m.modId)));
    const names = new Map<string, Who>();
    const at = (name: string) => { let w = names.get(name); if (!w) { w = { name, group: null, mods: [], showing: null }; names.set(name, w); } return w; };
    for (const g of info.groups) {
      const w = at(g.character);
      w.group = g;
      w.showing = g.mods.find((m) => m.slot === g.active)?.name ?? null;
    }
    for (const m of mods) if (!live.has(m.id)) at(m.character ?? OTHER).mods.push(m);
    for (const w of names.values()) {
      w.mods.sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name));
      w.showing ??= w.mods.find((m) => m.enabled && byId.has(m.id))?.name ?? null;
    }
    const order = recent(game);
    const rank = (w: Who) => { const i = order.indexOf(w.name); return i < 0 ? order.length : i; };
    return [...names.values()].sort((a, b) => Number(a.name === OTHER) - Number(b.name === OTHER) || rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, [info, mods, game, opened]); // eslint-disable-line react-hooks/exhaustive-deps

  const words = q.trim().toLowerCase();
  const shown = useMemo(() => {
    if (tab !== "mine" || !words) return everyone;
    const hit = (s: string) => s.toLowerCase().includes(words);
    return everyone.filter((w) => hit(w.name) || w.mods.some((m) => hit(m.name)) || w.group?.mods.some((m) => hit(m.name)));
  }, [everyone, words, tab]);
  const who = shown.find((w) => w.name === sel) ?? shown[0] ?? null;
  const loading = info === null || mods === null;

  // each time it opens: no search or details left over, on the character played last, on the skin that is showing
  useEffect(() => {
    setQ("");
    setNote(null);
    setDetail(null);
    setTab("mine");
    setSel(null);
  }, [opened]);
  useEffect(() => {
    if (loading) return;
    const t = window.setTimeout(() => (root.current?.querySelector<HTMLElement>(".ov-tile.on") ?? root.current?.querySelector<HTMLElement>(".ov-tile, .ov-who"))?.focus(), 80);
    return () => window.clearTimeout(t);
  }, [opened, loading]);

  useEffect(() => {
    const search = () => root.current?.querySelector<HTMLInputElement>(".ov-top input")?.focus();
    const back = () => { if (detailRef.current) setDetail(null); else close(); };
    const flip = () => setTab((t) => (t === "mine" ? "browse" : "mine"));
    const details = () => (document.activeElement?.closest(".ov-cell")?.querySelector<HTMLElement>(".ov-more") ?? null)?.click();
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement;
      if (e.key === "Escape") { if (!(typing && (e.target as HTMLInputElement).value)) back(); return; }
      const dir: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
      const d = dir[e.key];
      if (d && !(typing && d[0] !== 0)) { e.preventDefault(); moveFocus(d[0], d[1]); return; }
      if (typing || e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key === "Tab") { e.preventDefault(); flip(); return; }
      if (e.key === "i" || e.key === "I") { e.preventDefault(); details(); return; }
      // "/" and plain typing go to the search field
      if (e.key === "/" || (e.key.length === 1 && e.key !== " ")) {
        if (e.key === "/") e.preventDefault();
        search();
      }
    };
    window.addEventListener("keydown", onKey);
    const offPad = installGamepad({ nextView: flip, play: () => {}, menu: details, back, palette: search });
    return () => { window.removeEventListener("keydown", onKey); offPad(); };
  }, [game, close]);

  const say = (text: string, bad = false) => setNote({ text, bad });

  const pick = async (w: Who, slot: number) => {
    if (busy || !w.group) return;
    setBusy(`${w.name}-${slot}`);
    setNote(null);
    try {
      // also the one the app thinks shows: the game may show another, picked in its own menu
      const p = await skinMenu.pick(game, w.group.group, slot);
      touch(game, w.name);
      await reloadLive(game);
      const name = slot === 0 ? `${w.name}'s own look` : w.group.mods.find((m) => m.slot === slot)?.name ?? "That skin";
      if (p.reload) say(`${name} was off. It shows after the game reloads.`);
      else if (p.note) say(`${p.note}.`, true);
      else say(p.send ? `${name} is showing.` : `${name} shows the next time the game starts.`);
    } catch (e) { say(errorText(e), true); } finally { setBusy(null); }
  };

  const turn = async (m: ModEntry, on: boolean) => {
    if (busy) return;
    setBusy(m.id);
    setNote(null);
    try {
      await library.setEnabled(game, [m.id], on);
      touch(game, m.character ?? OTHER);
      await reloadMods();
      setDetail((d) => (d && "mod" in d && d.mod.id === m.id ? { mod: { ...m, enabled: on } } : d));
      say(`${m.name} is ${on ? "on" : "off"}. The game shows it after it reloads its mods (F10).`);
    } catch (e) { say(errorText(e), true); } finally { setBusy(null); }
  };

  const install = async (c: GbCard) => {
    if (busy) return;
    setBusy(`gb-${c.id}`);
    setNote(null);
    try {
      const item = await queueLatest(game, c.id);
      say(item ? `Downloading ${c.name}. It is listed under My mods once it is installed.` : `${c.name} has no file gachamod can install.`, !item);
    } catch (e) { say(errorText(e), true); } finally { setBusy(null); }
  };

  const modOf = (id: string) => mods?.find((m) => m.id === id) ?? null;
  const key = info?.menu.key ?? "the menu key";

  return (
    <div className="ov" ref={root} key={opened}>
      <header className="ov-top">
        <Segmented size="sm" label="What to show" value={tab} onChange={(t) => { setTab(t); setDetail(null); }}
          options={[
            { value: "mine", label: "My mods", icon: "mods", title: "Your characters, their skins and their other mods (Tab switches)" },
            { value: "browse", label: "Browse", icon: "browse", title: "Find more on GameBanana (Tab switches)" },
          ]} />
        <SearchField value={q} onChange={setQ} placeholder={tab === "mine" ? "Find a character or a mod" : "Search GameBanana"} />
        <IconButton icon="x" label="Close" title={`Close (Esc or ${key})`} onClick={close} />
      </header>

      <div className="ov-body">
        {tab === "mine" ? (
          loading ? <div className="ov-wait"><Waiting what="Reading your mods" /></div>
          : !shown.length ? (
            <p className="muted ov-empty">{words ? "No character or mod matches that." : "No mods here yet. Browse has some."}</p>
          ) : (<>
            <nav className="ov-rail" aria-label="Characters">
              {shown.map((w, i) => (
                <button key={w.name} type="button" className={`ov-who${w === who ? " on" : ""}`} style={{ "--i": Math.min(i, 14) } as React.CSSProperties}
                  aria-current={w === who} onClick={() => setSel(w.name)} onFocus={() => setSel(w.name)}
                  title={`${w.name}: ${plural((w.group?.mods.length ?? 0) + w.mods.length, "mod")}${w.showing ? `, ${w.showing} is showing` : ""}`}>
                  {w.name === OTHER ? <span className="ov-who-i"><Icon name="mods" /></span> : <Portrait game={game} name={w.name} size={38} />}
                  <span className="ov-who-t">
                    <span className="ov-who-n">{w.name}</span>
                    <span className="ov-who-s">{w.showing ?? (w.name === OTHER ? plural(w.mods.length, "mod") : "The game's own look")}</span>
                  </span>
                  <span className="ov-who-c">{(w.group?.mods.length ?? 0) + w.mods.length}</span>
                </button>
              ))}
            </nav>
            {who && (
              <main className="ov-pane" key={who.name}>
                <div className="ov-hero">
                  {who.name === OTHER ? <span className="ov-who-i big"><Icon name="mods" /></span> : <Portrait game={game} name={who.name} size={64} />}
                  <div className="ov-hero-t">
                    <h1>{who.name}</h1>
                    <span className="muted">{who.showing ? `${who.showing} is showing` : who.name === OTHER ? "Mods that aren't for one character" : "Wearing the game's own look"}</span>
                  </div>
                </div>
                {who.group && (
                  <section>
                    <h2 className="ov-h" title="These switch at once, without reloading the game">Skins</h2>
                    <div className="ov-grid" role="radiogroup" aria-label={`${who.name}'s skin`}>
                      {!words && (
                        <Tile i={0} on={who.group.active === 0} busy={busy === `${who.name}-0`} name="None" icon="block"
                          title={`${who.name} wears the game's own look`} onPick={() => void pick(who, 0)} />
                      )}
                      {who.group.mods.filter((m) => !words || who.name.toLowerCase().includes(words) || m.name.toLowerCase().includes(words)).map((m, i) => {
                        const full = modOf(m.modId);
                        return (
                          <Tile key={m.modId} i={i + 1} on={who.group!.active === m.slot} busy={busy === `${who.name}-${m.slot}`} name={m.name} src={fileUrl(m.preview)} blur={full?.nsfw}
                            title={who.group!.active === m.slot ? `${m.name} is showing` : !m.enabled ? `${m.name} is off. Picking it turns it on, and it shows after the game reloads` : `Show ${m.name}`}
                            onPick={() => void pick(who, m.slot)} onMore={full ? () => setDetail({ mod: full }) : undefined} />
                        );
                      })}
                    </div>
                  </section>
                )}
                {who.mods.length > 0 && (
                  <section>
                    <h2 className="ov-h" title="Turning one on or off shows after the game reloads its mods (F10)">{who.group ? "Other mods" : "Mods"}</h2>
                    <div className="ov-grid">
                      {who.mods.filter((m) => !words || who.name.toLowerCase().includes(words) || m.name.toLowerCase().includes(words)).map((m, i) => (
                        <Tile key={m.id} i={i} on={m.enabled} check busy={busy === m.id} name={m.name} src={fileUrl(m.preview)} blur={m.nsfw}
                          title={m.enabled ? `${m.name} is on. Click to turn it off` : `${m.name} is off. Click to turn it on`}
                          onPick={() => void turn(m, !m.enabled)} onMore={() => setDetail({ mod: m })} />
                      ))}
                    </div>
                  </section>
                )}
              </main>
            )}
          </>)
        ) : (
          <BrowsePane game={game} gbGameId={gbGameId} q={q} busy={busy} onOpen={(card) => setDetail({ card })} />
        )}

        {detail && (
          <aside className="ov-detail" aria-label="Details">
            <IconButton icon="x" label="Back" title="Back (Esc)" className="ov-detail-x" onClick={() => setDetail(null)} />
            {"mod" in detail
              ? <ModDetail game={game} m={detail.mod} group={everyone.find((w) => w.group?.mods.some((x) => x.modId === detail.mod.id)) ?? null} busy={!!busy}
                  onShow={(w, slot) => void pick(w, slot)} onTurn={(on) => void turn(detail.mod, on)} />
              : <CardDetail c={detail.card} busy={busy === `gb-${detail.card.id}`} have={!!mods?.some((m) => m.source?.modId === detail.card.id)} onInstall={() => void install(detail.card)} />}
          </aside>
        )}
      </div>

      <footer className={`ov-foot${note?.bad ? " bad" : note ? " said" : ""}`} role="status">
        {note?.text ?? `Arrows or the D-pad move, Enter or A picks, I or the menu button shows details, Tab or the bumpers switch to ${tab === "mine" ? "Browse" : "My mods"}, Esc or ${key} closes.`}
      </footer>
    </div>
  );
}

function Tile({ i, on, check, busy, name, src, icon = "mods", blur, title, onPick, onMore }: {
  i: number; on: boolean; check?: boolean; busy?: boolean; name: string; src?: string; icon?: "mods" | "block"; blur?: boolean; title: string;
  onPick: () => void; onMore?: () => void;
}) {
  const nsfw = useNsfw();
  return (
    <div className="ov-cell" style={{ "--i": Math.min(i, 16) } as React.CSSProperties}>
      <button type="button" role={check ? "checkbox" : "radio"} aria-checked={on} className={`ov-tile${on ? " on" : ""}${busy ? " busy" : ""}`} onClick={onPick} title={title}>
        <span className={`ov-pic${blur && nsfw !== "show" ? " blur" : ""}`}>{src ? <LazyImg src={src} alt="" draggable={false} /> : <Icon name={icon} />}</span>
        <span className="ov-label"><span className="ov-t">{name}</span>{on && <span className="ov-check"><Icon name="check" /></span>}</span>
      </button>
      {onMore && <IconButton size="sm" icon="info" label={`Details of ${name}`} title="Details (I)" className="ov-more" onClick={onMore} />}
    </div>
  );
}

function ModDetail({ game, m, group, busy, onShow, onTurn }: {
  game: GameId; m: ModEntry; group: Who | null; busy: boolean; onShow: (w: Who, slot: number) => void; onTurn: (on: boolean) => void;
}) {
  const nsfw = useNsfw();
  const src = fileUrl(m.preview);
  const slot = group?.group?.mods.find((x) => x.modId === m.id)?.slot ?? 0;
  const showing = !!group?.group && group.group.active === slot;
  const facts = [m.source?.submitter && `By ${m.source.submitter}`, m.version && `Version ${m.version}`, formatBytes(m.sizeBytes), m.installedAt ? `Installed ${timeAgo(m.installedAt)}` : null].filter(Boolean);
  return (
    <>
      <div className={`ov-detail-pic${m.nsfw && nsfw !== "show" ? " blur" : ""}`}>{src ? <img src={src} alt="" draggable={false} /> : <Icon name="mods" />}</div>
      <div className="ov-detail-t">
        <h1>{m.name}</h1>
        <div className="ov-detail-who">
          {m.character && <><Portrait game={game} name={m.character} size={22} /><span>{m.character}</span></>}
          {showing ? <Badge tone="ok" icon="check">Showing</Badge> : m.enabled ? <Badge tone="ok">On</Badge> : <Badge>Off</Badge>}
          {m.updateAvailable && <Badge tone="accent" title="GameBanana has a newer file. Get it in gachamod, under My Mods">Update</Badge>}
          {m.hasKeys && <Badge title="It has keys that change parts of it while you play">Toggles</Badge>}
        </div>
        <p className="muted">{facts.join(", ")}</p>
        {m.tags.length > 0 && <p className="ov-tags">{m.tags.map((t) => <Badge key={t}>{t}</Badge>)}</p>}
        {m.notes && <p className="ov-notes">{m.notes}</p>}
        <div className="ov-detail-a">
          {group?.group
            ? <Button variant="primary" icon="play" disabled={busy || showing} onClick={() => onShow(group, slot)}
                title={showing ? "This is the skin showing now" : "Shows it in the game now"}>{showing ? "Showing" : "Show in game"}</Button>
            : <Button variant="primary" icon={m.enabled ? "block" : "check"} disabled={busy} onClick={() => onTurn(!m.enabled)}
                title="The game shows the change after it reloads its mods (F10)">{m.enabled ? "Turn off" : "Turn on"}</Button>}
        </div>
      </div>
    </>
  );
}

function CardDetail({ c, busy, have, onInstall }: { c: GbCard; busy: boolean; have: boolean; onInstall: () => void }) {
  const nsfw = useNsfw();
  const src = imageAt(c.image, 530);
  const facts = [c.submitter && `By ${c.submitter.name}`, plural(c.likes, "like"), c.downloads !== null && plural(c.downloads, "download"), c.updated ? `Updated ${timeAgo(c.updated)}` : null].filter(Boolean);
  return (
    <>
      <div className={`ov-detail-pic${c.nsfw && nsfw !== "show" ? " blur" : ""}`}>{src ? <img src={src} alt="" draggable={false} /> : <Icon name="mods" />}</div>
      <div className="ov-detail-t">
        <h1>{c.name}</h1>
        <div className="ov-detail-who">
          {c.character && <span>{c.character}</span>}
          {c.category && !c.character && <span>{c.category.name}</span>}
          {have && <Badge tone="ok" icon="check">Installed</Badge>}
        </div>
        <p className="muted">{facts.join(", ")}</p>
        <div className="ov-detail-a">
          <Button variant="primary" icon="downloads" busy={busy} onClick={onInstall}
            title="Downloads its newest file and installs it. The game shows it after it reloads its mods (F10)">{have ? "Install again" : "Install"}</Button>
        </div>
      </div>
    </>
  );
}

/** GameBanana inside the menu: the game's mods, one character's when picked, or a search. */
function BrowsePane({ game, gbGameId, q, busy, onOpen }: { game: GameId; gbGameId: number | null; q: string; busy: string | null; onOpen: (c: GbCard) => void }) {
  const nsfw = useNsfw();
  const cats = useCharacterList(game);
  const [cat, setCat] = useState<number | null>(null);
  const [sort, setSort] = useState<"popular" | "newest">("popular");
  const [cards, setCards] = useState<GbCard[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [slow, setSlow] = useState(q);
  useEffect(() => { const t = window.setTimeout(() => setSlow(q), 350); return () => window.clearTimeout(t); }, [q]);
  const search = slow.trim();

  useEffect(() => {
    if (!gbGameId) return;
    const stop = new AbortController();
    setCards(null);
    setFailed(null);
    listMods({ gbGameId, page: 1, perPage: 30, sort: search ? "relevance" : sort, categoryId: search ? null : cat, search: search || undefined, signal: stop.signal })
      .then((r) => setCards(r.items))
      .catch((e) => { if (!isAbort(e)) { setCards([]); setFailed(errorText(e)); } });
    return () => stop.abort();
  }, [gbGameId, cat, sort, search]);

  const list = (cards ?? []).filter((c) => !(c.nsfw && nsfw === "hide"));
  if (!gbGameId) return <p className="muted ov-empty">This game has no page on GameBanana.</p>;
  return (
    <>
      <nav className="ov-rail" aria-label="Characters on GameBanana">
        <button type="button" className={`ov-who${cat === null ? " on" : ""}`} aria-current={cat === null} onClick={() => setCat(null)} title="Mods for every character">
          <span className="ov-who-i"><Icon name="browse" /></span>
          <span className="ov-who-t"><span className="ov-who-n">Everything</span></span>
        </button>
        {cats.map((c, i) => (
          <button key={c.id} type="button" className={`ov-who${cat === c.id ? " on" : ""}`} style={{ "--i": Math.min(i, 14) } as React.CSSProperties}
            aria-current={cat === c.id} onClick={() => setCat(c.id)} title={`Mods for ${c.name}`}>
            <Portrait game={game} name={c.name} icon={c.icon} size={38} />
            <span className="ov-who-t"><span className="ov-who-n">{c.name}</span></span>
          </button>
        ))}
      </nav>
      <main className="ov-pane" key={`${cat}-${sort}-${search}`}>
        <div className="ov-hero slim">
          <div className="ov-hero-t">
            <h1>{search ? `"${search}" on GameBanana` : cat === null ? "On GameBanana" : cats.find((c) => c.id === cat)?.name ?? "On GameBanana"}</h1>
          </div>
          {!search && (
            <Segmented size="sm" label="Order" value={sort} onChange={setSort}
              options={[{ value: "popular", label: "Popular", title: "The most liked and viewed first" }, { value: "newest", label: "Newest", title: "The latest uploads first" }]} />
          )}
        </div>
        {cards === null ? <div className="ov-wait"><Waiting what={search ? `Searching GameBanana for "${search}"` : "Getting mods from GameBanana"} /></div>
          : failed ? <p className="ov-empty bad">{failed}</p>
          : !list.length ? <p className="muted ov-empty">{search ? "GameBanana found nothing for that." : "Nothing here yet."}</p>
          : (
            <div className="ov-grid">
              {list.map((c, i) => (
                <div key={c.id} className="ov-cell" style={{ "--i": Math.min(i, 16) } as React.CSSProperties}>
                  <button type="button" className={`ov-tile${busy === `gb-${c.id}` ? " busy" : ""}`} onClick={() => onOpen(c)} title={`${c.name}${c.submitter ? ` by ${c.submitter.name}` : ""}. Click for details and Install`}>
                    <span className={`ov-pic${c.nsfw && nsfw !== "show" ? " blur" : ""}`}>{imageAt(c.image, 220) ? <LazyImg src={imageAt(c.image, 220)!} alt="" draggable={false} /> : <Icon name="mods" />}</span>
                    <span className="ov-label"><span className="ov-t">{c.name}</span><span className="ov-likes" title={plural(c.likes, "like")}><Icon name="star" />{c.likes}</span></span>
                  </button>
                </div>
              ))}
            </div>
          )}
        {cards === null && <div className="ov-grid" aria-hidden="true">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} h="8rem" />)}</div>}
      </main>
    </>
  );
}
