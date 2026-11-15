// The skin menu shown over a running game (src-tauri overlay.rs): its own small window, opened with the menu key or
// by pressing both sticks of a controller. Every live character with its skins as pictures; picking one shows it in
// the game and the window closes. In a browser, #overlay shows it with the demo data. Owner: INGAME area.
import { useEffect, useMemo, useRef, useState } from "react";
import { errorText, fileUrl, skinMenu, type GameId, type LiveGroup, type LiveMod } from "../../lib/api";
import { installGamepad, moveFocus } from "../../lib/gamepad";
import { refreshGames, useGames } from "../../lib/store";
import { held, listen } from "../../lib/tauri";
import { applyGameTheme } from "../../lib/theme";
import { Icon } from "../../ui/Icon";
import { IconButton, SearchField, Skeleton } from "../../ui/kit";
import { Portrait } from "../../ui/Portrait";
import { reloadLive, useLive } from "./data";
import "./overlay.css";

const recentKey = (game: GameId) => `overlay.recent.${game}`;
function recent(game: GameId): number[] {
  try { return JSON.parse(localStorage.getItem(recentKey(game)) ?? "[]") as number[]; } catch { return []; }
}
function touch(game: GameId, group: number) {
  try { localStorage.setItem(recentKey(game), JSON.stringify([group, ...recent(game).filter((g) => g !== group)].slice(0, 40))); } catch { /* the order just isn't kept */ }
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

  if (!game) return <div className="ov"><div className="ov-list"><Skeleton h="6rem" /><Skeleton h="6rem" /></div></div>;
  return <Menu key={game} game={game} opened={opened} />;
}

function Menu({ game, opened }: { game: GameId; opened: number }) {
  const info = useLive(game);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const close = () => void skinMenu.hide(game);

  // each time it opens: no search left over, back at the top, on the skin that is showing
  useEffect(() => {
    setQ("");
    setNote("");
    list.current?.scrollTo({ top: 0 });
    const t = window.setTimeout(() => (list.current?.querySelector<HTMLElement>(".ov-tile.on") ?? list.current?.querySelector<HTMLElement>(".ov-tile"))?.focus(), 60);
    return () => window.clearTimeout(t);
  }, [opened, info === null]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const search = () => document.querySelector<HTMLInputElement>(".ov-head input")?.focus();
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement;
      if (e.key === "Escape") { if (!(typing && (e.target as HTMLInputElement).value)) close(); return; }
      const dir: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
      const d = dir[e.key];
      if (d && !(typing && d[0] !== 0)) { e.preventDefault(); moveFocus(d[0], d[1]); return; }
      // "/" and plain typing go to the search field
      if (!typing && !e.ctrlKey && !e.altKey && !e.metaKey && (e.key === "/" || (e.key.length === 1 && e.key !== " "))) {
        if (e.key === "/") e.preventDefault();
        search();
      }
    };
    window.addEventListener("keydown", onKey);
    const offPad = installGamepad({ nextView: () => {}, play: () => {}, menu: () => {}, back: close, palette: search });
    return () => { window.removeEventListener("keydown", onKey); offPad(); };
  }, [game]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    if (!info) return [];
    const order = recent(game);
    const rank = (g: LiveGroup) => { const i = order.indexOf(g.group); return i < 0 ? order.length : i; };
    const words = q.trim().toLowerCase();
    return [...info.groups].sort((a, b) => rank(a) - rank(b) || a.character.localeCompare(b.character))
      .map((g) => (!words || g.character.toLowerCase().includes(words) ? g : { ...g, mods: g.mods.filter((m) => m.name.toLowerCase().includes(words)) }))
      .filter((g) => !words || g.character.toLowerCase().includes(words) || g.mods.length > 0);
  }, [info, q, game, opened]);

  const pick = async (g: LiveGroup, slot: number) => {
    if (busy) return;
    // also the one the app thinks shows: the game may show another, picked in its own menu
    setBusy(`${g.group}-${slot}`);
    setNote("");
    try {
      const p = await skinMenu.pick(game, g.group, slot);
      touch(game, g.group);
      await reloadLive(game);
      if (p.reload) setNote("That skin was off. It shows after the game reloads.");
      else if (p.note) setNote(`${p.note}.`);
      else if (!p.send) close();
    } catch (e) { setNote(errorText(e)); } finally { setBusy(null); }
  };

  return (
    <div className="ov">
      <header className="ov-head">
        <SearchField value={q} onChange={setQ} placeholder="Find a character or a skin" />
        <IconButton icon="x" label="Close" title="Close (Esc)" onClick={close} />
      </header>
      <div className="ov-list" ref={list}>
        {info === null && <><Skeleton h="6rem" /><Skeleton h="6rem" /></>}
        {groups.map((g) => (
          <section key={g.group} className="ov-group">
            <h2 className="ov-name"><Portrait game={game} name={g.character} size={28} />{g.character}</h2>
            <div className="ov-grid" role="radiogroup" aria-label={`${g.character}'s skin`}>
              {!q.trim() && <Tile on={g.active === 0} busy={busy === `${g.group}-0`} name="None" title={`${g.character} wears the game's own look`} onPick={() => void pick(g, 0)} />}
              {g.mods.map((m) => <Tile key={m.modId} m={m} on={g.active === m.slot} busy={busy === `${g.group}-${m.slot}`} name={m.name} onPick={() => void pick(g, m.slot)} />)}
            </div>
          </section>
        ))}
        {info && !groups.length && (
          <p className="muted ov-empty">{q.trim() ? "Nothing matches that." : "No character switches in game yet. Set one up in gachamod under Tools, Switch skins in game."}</p>
        )}
      </div>
      <footer className={`ov-foot${note ? " bad" : ""}`}>{note || `Arrows or the D-pad move, Enter or A shows a skin, Esc or ${info?.menu.key ?? "the menu key"} closes.`}</footer>
    </div>
  );
}

function Tile({ m, on, busy, name, title, onPick }: { m?: LiveMod; on: boolean; busy: boolean; name: string; title?: string; onPick: () => void }) {
  const src = fileUrl(m?.preview);
  return (
    <button type="button" role="radio" aria-checked={on} className={`ov-tile${on ? " on" : ""}${busy ? " busy" : ""}`} onClick={onPick}
      title={title ?? (on ? `${name} is showing` : m && !m.enabled ? `${name} is off. Picking it turns it on, and it shows after the game reloads` : `Show ${name}`)}>
      <span className="ov-pic">{src ? <img src={src} alt="" loading="lazy" draggable={false} /> : <Icon name={m ? "mods" : "block"} />}</span>
      <span className="ov-label"><span className="ov-t">{name}</span>{on && <Icon name="check" />}</span>
    </button>
  );
}
