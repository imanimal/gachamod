// The Keys tab of the menu over the game (Overlay.tsx): the toggle keys of the mods showing now, grouped by
// character, with a search by character, mod or key. Mods that show their own key help, and mods the player left out,
// aren't listed (Tools > Key list in game). Owner: INGAME area.
import { useEffect, useMemo, useRef, useState } from "react";
import { fileUrl, type GameId, type KeyList, type ModKeyList } from "../../lib/api";
import { Icon } from "../../ui/Icon";
import { Button, SearchField, Waiting, plural } from "../../ui/kit";
import { LazyImg } from "../../ui/LazyImg";
import { Portrait } from "../../ui/Portrait";
import { KeyCombo, byCharacter, keyHits, rowNote, rowTip } from "./KeyListParts";

export function KeysTab({ game, list, error, onRetry, onMine, onSettings }: {
  game: GameId; list: KeyList | null; error: string | null; onRetry: () => void; onMine: () => void; onSettings: () => void;
}) {
  const [q, setQ] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const words = q.trim().toLowerCase();
  const showing = useMemo(() => list?.mods.filter((m) => m.showing) ?? [], [list]);
  const listed = useMemo(() => showing.filter((m) => m.listed), [showing]);
  const hidden = showing.length - listed.length;
  const groups = useMemo(() => {
    const found = listed.flatMap((m) => { const rows = keyHits(m, words); return rows ? [{ ...m, rows }] : []; });
    return byCharacter(found);
  }, [listed, words]);

  // on the first mod once the list is read, so arrows and the D-pad move from there
  const ready = !!list;
  useEffect(() => {
    if (!ready) return;
    const t = window.setTimeout(() => root.current?.querySelector<HTMLElement>(".ov-kmod")?.focus({ preventScroll: true }), 80);
    return () => window.clearTimeout(t);
  }, [ready]);
  /** Enter in the search: on to the first mod found. After the key is done, so the same Enter does nothing more. */
  const toFirst = () => window.setTimeout(() => root.current?.querySelector<HTMLElement>(".ov-kmod")?.focus(), 0);

  if (error && !list) {
    return (
      <div className="ov-page ov-scroll">
        <div className="ov-empty bad">
          <p>{error}</p>
          <Button size="sm" icon="refresh" onClick={onRetry} title="Read the mods' keys again">Try again</Button>
        </div>
      </div>
    );
  }
  if (!list) return <div className="ov-wait"><Waiting what="Reading mod keys" /></div>;

  const empty = !list.settings.on ? (
    <div className="ov-empty"><p>The key list is turned off for this game.</p>
      <Button size="sm" icon="settings" onClick={onSettings} title="Opens Tools, Key list in game, in gachamod's own window">Key list settings</Button></div>
  ) : !list.mods.length ? (
    <p className="muted ov-empty">None of your mods for this game has keys.</p>
  ) : !showing.length ? (
    <div className="ov-empty"><p className="muted">None of the mods showing now has keys. Turn one on in My mods.</p>
      <Button size="sm" icon="mods" onClick={onMine} title="Your characters and their mods (Tab switches)">My mods</Button></div>
  ) : !listed.length ? (
    <div className="ov-empty"><p className="muted">The mods showing now show their own key help in the game, or you left them out of the list.</p>
      <Button size="sm" icon="settings" onClick={onSettings} title="Choose which mods the key list shows. Opens Tools, Key list in game, in gachamod's own window">Choose mods</Button></div>
  ) : null;

  return (
    <div className="ov-page ov-scroll ov-keys" ref={root}>
      {empty ?? (
        <>
          <div className="ov-kbar">
            <SearchField value={q} onChange={setQ} placeholder="Find a character, mod or key" onEnter={toFirst} />
          </div>
          {!groups.length && <p className="muted ov-none">No character, mod or key matches that.</p>}
          {groups.map((g) => (
            <section key={g.name} className="ov-kwho">
              <h2 className="ov-kwho-h">
                {g.other ? <span className="ov-who-i"><Icon name="mods" /></span> : <Portrait game={game} name={g.name} size={30} />}
                <span>{g.name}</span>
              </h2>
              <div className="ov-kgrid">
                {g.mods.map((m, i) => <KeyCard key={m.modId} m={m} i={i} />)}
              </div>
            </section>
          ))}
          {hidden > 0 && !words && (
            <p className="muted ov-khidden">
              {hidden === 1 ? "1 mod showing now isn't listed: it shows" : `${plural(hidden, "mod")} showing now aren't listed: they show`} their own key help, or you left {hidden === 1 ? "it" : "them"} out.
              <Button size="sm" variant="ghost" onClick={onSettings} title="Choose which mods the key list shows. Opens Tools, Key list in game, in gachamod's own window">Choose mods</Button>
            </p>
          )}
        </>
      )}
    </div>
  );
}

function KeyCard({ m, i }: { m: ModKeyList; i: number }) {
  const src = fileUrl(m.preview);
  return (
    <div className="ov-kmod" tabIndex={0} role="group" aria-label={`Keys of ${m.name}`} style={{ "--i": Math.min(i, 16) } as React.CSSProperties}>
      <div className="ov-kmod-h">
        <span className="ov-kpic">{src ? <LazyImg src={src} alt="" draggable={false} /> : <Icon name="mods" />}</span>
        <span className="ov-kmod-t">
          <span className="ov-kmod-n">{m.name}</span>
          {m.ownHelp && m.helpKey && <span className="ov-kmod-s">Its own key help: {m.helpKey}</span>}
        </span>
      </div>
      <ul className="ov-krows">
        {m.rows.map((r, n) => {
          const note = rowNote(r);
          return (
            <li key={n} title={rowTip(r, m.character)}>
              <KeyCombo keys={r.keys} />
              <span className="ov-kwhat">{r.what}{note && <span className="ov-knote">{note}</span>}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
