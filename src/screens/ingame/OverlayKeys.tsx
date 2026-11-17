// The Keys tab of the menu over the game (Overlay.tsx): the toggle keys of the mods showing now, grouped by
// character (the ones played last first), with a search by character, mod or key. A click on a key rebinds it in the
// mod's ini, with Undo (keys.rs through ui/KeyEditor.tsx). Mods the player left out aren't listed (Tools > Key list
// in game). Owner: INGAME area.
import { useEffect, useMemo, useRef, useState } from "react";
import { errorText, fileUrl, modKeys, type GameId, type KeyLine, type KeyList, type KeyRow, type ModKeyList } from "../../lib/api";
import { t, tb, tn } from "../../lib/i18n";
import { Icon } from "../../ui/Icon";
import { KeyChip, recordEdit } from "../../ui/KeyEditor";
import { Button, SearchField, Waiting } from "../../ui/kit";
import { LazyImg } from "../../ui/LazyImg";
import { Portrait } from "../../ui/Portrait";
import { byCharacter, keyHits, rowNote, rowTip } from "./KeyListParts";
import "../../ui/key-editor.css";

export function KeysTab({ game, list, error, order, query, onRetry, onMine, onSettings, onSay }: {
  game: GameId; list: KeyList | null; error: string | null;
  /** What the search starts with: a mod's name when its Toggles tag opened this tab. */
  query?: string;
  /** Characters in the order they were played last (the same order as My mods). */
  order: string[];
  onRetry: () => void; onMine: () => void; onSettings: () => void;
  /** A line for the bottom of the menu ("Press F10 in game to load the change"). */
  onSay: (text: string, bad?: boolean) => void;
}) {
  const [q, setQ] = useState(query ?? "");
  const root = useRef<HTMLDivElement>(null);
  const words = q.trim().toLowerCase();
  const showing = useMemo(() => list?.mods.filter((m) => m.showing) ?? [], [list]);
  const listed = useMemo(() => showing.filter((m) => m.listed), [showing]);
  const hidden = showing.length - listed.length;
  const groups = useMemo(() => {
    const found = listed.flatMap((m) => { const rows = keyHits(m, words); return rows ? [{ ...m, rows }] : []; });
    return byCharacter(found, order);
  }, [listed, words, order]);
  // one rebind at a time. The keys stay enabled meanwhile, so the one in focus keeps the focus
  const busy = useRef(false);
  /** Write the keys the player pressed to the mod's ini. The list reads itself again when the keys change. */
  const rebind = async (m: ModKeyList, r: KeyRow, l: KeyLine, binding: string) => {
    if (busy.current) return;
    busy.current = true;
    try {
      const edit = await modKeys.rebind(game, m.modId, { ini: r.ini, section: r.section, field: l.field, index: l.index }, binding);
      recordEdit(game, m.modId, edit, t("That's already the key"));
      if (edit.backup && edit.note) onSay(t("{note}.", { note: tb(edit.note) }));
    } catch (e) { onSay(errorText(e), true); } finally { busy.current = false; }
  };

  // on the first mod's first key once the list is read, so arrows and the D-pad move from there
  const ready = !!list;
  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => root.current?.querySelector<HTMLElement>(".ov-kmod .ke-chip")?.focus({ preventScroll: true }), 80);
    return () => window.clearTimeout(timer);
  }, [ready]);
  /** Enter in the search: on to the first key found. After the key is done, so the same Enter does nothing more. */
  const toFirst = () => window.setTimeout(() => root.current?.querySelector<HTMLElement>(".ov-kmod .ke-chip")?.focus(), 0);

  if (error && !list) {
    return (
      <div className="ov-page ov-scroll">
        <div className="ov-empty bad">
          <p>{error}</p>
          <Button size="sm" icon="refresh" onClick={onRetry} title={t("Read the mods' keys again")}>{t("Try again")}</Button>
        </div>
      </div>
    );
  }
  if (!list) return <div className="ov-wait"><Waiting what={t("Reading mod keys")} /></div>;

  const empty = !list.settings.on ? (
    <div className="ov-empty"><p>{t("The key list is turned off for this game.")}</p>
      <Button size="sm" icon="settings" onClick={onSettings} title={t("Opens Tools, Key list in game, in gachamod's own window")}>{t("Key list settings")}</Button></div>
  ) : !list.mods.length ? (
    <p className="muted ov-empty">{t("None of your mods for this game has keys.")}</p>
  ) : !showing.length ? (
    <div className="ov-empty"><p className="muted">{t("None of the mods showing now has keys. Turn one on in My mods.")}</p>
      <Button size="sm" icon="mods" onClick={onMine} title={t("Your characters and their mods (Tab switches)")}>{t("My mods")}</Button></div>
  ) : !listed.length ? (
    <div className="ov-empty"><p className="muted">{t("You left the mods showing now out of the list.")}</p>
      <Button size="sm" icon="settings" onClick={onSettings} title={t("Choose which mods the key list shows. Opens Tools, Key list in game, in gachamod's own window")}>{t("Choose mods")}</Button></div>
  ) : null;

  return (
    <div className="ov-page ov-scroll ov-keys" ref={root}>
      {empty ?? (
        <>
          <div className="ov-kbar">
            <SearchField value={q} onChange={setQ} placeholder={t("Find a character, mod or key")} onEnter={toFirst} />
          </div>
          {!groups.length && <p className="muted ov-none">{t("No character, mod or key matches that.")}</p>}
          {groups.map((g) => (
            <section key={g.name} className="ov-kwho">
              <h2 className="ov-kwho-h">
                {g.other ? <span className="ov-who-i"><Icon name="mods" /></span> : <Portrait game={game} name={g.name} size={30} />}
                <span>{g.name}</span>
              </h2>
              <div className="ov-kgrid">
                {g.mods.map((m, i) => <KeyCard key={m.modId} m={m} i={i} onBinding={(r, l, b) => void rebind(m, r, l, b)} />)}
              </div>
            </section>
          ))}
          {hidden > 0 && !words && (
            <p className="muted ov-khidden">
              {tn(hidden, "{n} mod showing now isn't listed: you left it out.", "{n} mods showing now aren't listed: you left them out.")}
              <Button size="sm" variant="ghost" onClick={onSettings} title={t("Choose which mods the key list shows. Opens Tools, Key list in game, in gachamod's own window")}>{t("Choose mods")}</Button>
            </p>
          )}
        </>
      )}
    </div>
  );
}

function KeyCard({ m, i, onBinding }: { m: ModKeyList; i: number; onBinding: (r: KeyRow, l: KeyLine, binding: string) => void }) {
  const src = fileUrl(m.preview);
  return (
    <div className="ov-kmod" role="group" aria-label={t("Keys of {name}", { name: m.name })} style={{ "--i": Math.min(i, 16) } as React.CSSProperties}>
      <div className="ov-kmod-h">
        <span className="ov-kpic">{src ? <LazyImg src={src} alt="" draggable={false} /> : <Icon name="mods" />}</span>
        <span className="ov-kmod-t">
          <span className="ov-kmod-n">{m.name}</span>
          {m.ownHelp && m.helpKey && <span className="ov-kmod-s">{t("Shows its key help with {key}", { key: m.helpKey })}</span>}
        </span>
      </div>
      <ul className="ov-krows">
        {m.rows.map((r, n) => {
          const note = rowNote(r);
          return (
            <li key={n}>
              <span className="ov-kchips">
                {r.lines.map((l) => (
                  <span key={`${l.field}-${l.index}`} className="ke-line">
                    {l.field === "back" && <span className="ke-back hint" title={t("Steps back through the looks")}>{t("Back")}</span>}
                    <KeyChip line={l} onBinding={(b) => onBinding(r, l, b)} />
                  </span>
                ))}
              </span>
              <span className="ov-kwhat" title={rowTip(r, m.character)}>{r.what}{note && <span className="ov-knote">{note}</span>}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
