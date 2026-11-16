// Tools > Key list in game: the toggle keys of the mods showing now, shown while playing for mods that don't show
// their own key help (gacha-core keylist.rs, docs/ingame.md). One switch, where it shows, its key, and which mods it
// lists. Owner: INGAME area.
import { useMemo, useState } from "react";
import { errorText, fileUrl, keyList, type GameId, type KeyListSettings, type ModKeyList } from "../../lib/api";
import { record } from "../../lib/history";
import { go } from "../../lib/store";
import { Icon } from "../../ui/Icon";
import { Badge, Button, Checkbox, Panel, SearchField, Segmented, Skeleton, Toggle } from "../../ui/kit";
import { LazyImg } from "../../ui/LazyImg";
import { toast } from "../../ui/toast";
import { HotkeyField } from "../profiles/HotkeyField";
import { keyHits, useKeyList } from "./KeyListParts";

const STYLE_HINT: Record<KeyListSettings["style"], (key: string) => string> = {
  window: (key) => `${key} opens gachamod's menu over the game on its Keys tab. In exclusive fullscreen the game draws the list in its top right corner instead. The game reloads once after a change here.`,
  game: (key) => `The game draws the list in its top right corner, and it stays there while you play until you press ${key} again. Works in exclusive fullscreen too. The game reloads once after a change here.`,
};

/** What a change of the settings did, for Undo. */
function changeLabel(before: KeyListSettings, next: KeyListSettings): string {
  if (before.on !== next.on) return next.on ? "Turned the key list on" : "Turned the key list off";
  if (before.style !== next.style) return next.style === "window" ? "Set the key list to show over the game" : "Set the key list to show inside the game";
  if (before.key !== next.key) return `Set the key list's key to ${next.key}`;
  return next.own ? "Listed mods that show their own key help" : "Left out mods that show their own key help";
}

export function KeyListPanel({ game }: { game: GameId }) {
  const kl = useKeyList(game);
  const { list } = kl;
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const words = q.trim().toLowerCase();
  const found = useMemo(() => list?.mods.filter((m) => keyHits(m, words)) ?? [], [list, words]);

  const save = async (next: KeyListSettings) => {
    if (!list) return;
    const before = list.settings;
    setBusy("settings");
    try {
      kl.settle(await keyList.set(game, next));
      record({
        label: changeLabel(before, next),
        undo: async () => { kl.settle(await keyList.set(game, before)); },
        redo: async () => { kl.settle(await keyList.set(game, next)); },
      });
    } catch (e) { toast(errorText(e), true); } finally { setBusy(null); }
  };
  const choose = async (m: ModKeyList, listed: boolean | null) => {
    setBusy(m.modId);
    try { kl.patch(await keyList.choose(game, m.modId, listed)); } catch (e) { toast(errorText(e), true); } finally { setBusy(null); }
  };

  if (!list) {
    return (
      <Panel id="keylist" title="Key list in game" icon="keyboard">
        {kl.error
          ? <p className="hint row"><span>{kl.error}</span><Button size="sm" icon="refresh" onClick={() => void kl.reload()} title="Read the mods' keys again">Try again</Button></p>
          : <div className="kl-all"><Skeleton h="3rem" /></div>}
      </Panel>
    );
  }

  const s = list.settings;
  return (
    <Panel id="keylist" title="Key list in game" icon="keyboard" count={list.mods.length || undefined}>
      <div className="kl-all">
        <Toggle checked={s.on} disabled={busy === "settings"} onChange={(on) => void save({ ...s, on })} label="Show mod keys while playing"
          hint={s.on ? `Press ${s.key} while you play to see the toggle keys of the mods showing now.${s.own ? "" : " Mods that show their own key help are left out."}`
            : `Off: ${s.key} does nothing in the game.`} />
        {!list.available && (
          <div className="kl-off">
            <p className="hint">The key list opens from the menu while you play, which needs Switch skins in game turned on.</p>
            <Button size="sm" icon="swap" onClick={() => go({ view: "tools", section: "ingame" })} title="Opens Switch skins in game">Switch skins in game</Button>
          </div>
        )}
      </div>
      {s.on && list.available && (
        <>
          <div className="kl-opts">
            <div className="kl-opts-row">
              <span className="kl-opts-l">Where it shows</span>
              <Segmented label="Where it shows" size="sm" value={s.style} disabled={busy === "settings"} onChange={(style) => void save({ ...s, style })} options={[
                { value: "window", label: "Over the game", title: `The Keys tab of gachamod's menu over the game, which ${s.key} opens. In exclusive fullscreen the game always draws it` },
                { value: "game", label: "Inside the game", title: "The game draws it in the top right corner and it stays there while you play. Also works in exclusive fullscreen" },
              ]} />
            </div>
            <div className="kl-opts-row">
              <HotkeyField label="Key that opens it" value={s.key} bareF keep onChange={(key) => { if (key && key !== s.key) void save({ ...s, key }); }} />
              <Checkbox checked={s.own} disabled={busy === "settings"} onChange={(own) => void save({ ...s, own })} label="Also list mods that show their own key help"
                title="Some mods draw their own key help in the game, like a picture that F1 shows. They're left out unless this is on. A mod's own pick below still wins" />
            </div>
            <p className="hint">{STYLE_HINT[s.style](s.key)}</p>
          </div>
          <div className="kl-h">
            <h3>Mods with keys</h3>
            {list.mods.length > 0 && <SearchField value={q} onChange={setQ} placeholder="Find a mod, character or key" />}
          </div>
          {!list.mods.length ? <p className="muted kl-none">None of your mods for this game has keys.</p>
            : !found.length ? <p className="muted kl-none">No mod, character or key matches that.</p>
            : (
              <ul className="kl-list">
                {found.map((m) => <KeyModRow key={m.modId} m={m} own={s.own} busy={busy === m.modId} onChoose={(v) => void choose(m, v)} />)}
              </ul>
            )}
        </>
      )}
    </Panel>
  );
}

function KeyModRow({ m, own, busy, onChoose }: { m: ModKeyList; own: boolean; busy: boolean; onChoose: (listed: boolean | null) => void }) {
  const src = fileUrl(m.preview);
  const facts = [m.character, m.rows.length === 1 ? "1 key" : `${m.rows.length} keys`, m.showing ? "showing now" : null].filter(Boolean).join(", ");
  const auto = m.ownHelp && !own ? "left out, since it shows its own key help" : "listed";
  return (
    <li className="kl-mod">
      <span className="kl-thumb">{src ? <LazyImg src={src} alt="" draggable={false} /> : <Icon name="mods" />}</span>
      <span className="kl-name">
        <button type="button" className="kl-link" title="Open in Mods" onClick={() => go({ view: "library", modId: m.modId })}>{m.name}</button>
        <span className="hint" title={m.rows.map((r) => `${r.keys.join(" or ")}: ${r.what}`).join("\n")}>{facts}</span>
      </span>
      <span className="kl-acts">
        {m.ownHelp && (
          <Badge tone="info" title={m.helpKey ? `This mod shows its own key help with ${m.helpKey}` : "This mod shows its own key help in the game"}>Own help</Badge>
        )}
        {m.choice !== null && (
          <Button size="sm" variant="ghost" icon="undo" disabled={busy} onClick={() => onChoose(null)} title={`Go back to automatic: ${auto}`}>Automatic</Button>
        )}
        <Checkbox checked={m.listed} disabled={busy} onChange={(v) => onChoose(v)} label="Listed"
          title={m.listed ? `${m.name}'s keys show in the key list. Click to leave it out` : `${m.name} is left out of the key list. Click to list it`} />
      </span>
    </li>
  );
}
