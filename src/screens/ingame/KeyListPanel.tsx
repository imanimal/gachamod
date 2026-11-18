// Tools > Key list in game: the toggle keys of the mods showing now, shown while playing for mods that don't show
// their own key help (gacha-core keylist.rs, docs/ingame.md). One switch, where it shows, its key, and which mods it
// lists. Owner: INGAME area.
import { useMemo, useState } from "react";
import { errorText, fileUrl, keyList, type GameId, type KeyListSettings, type ModKeyList } from "../../lib/api";
import { record } from "../../lib/history";
import { t, tn } from "../../lib/i18n";
import { go } from "../../lib/store";
import { Icon } from "../../ui/Icon";
import { Badge, Button, Checkbox, Panel, SearchField, Segmented, Skeleton, Toggle } from "../../ui/kit";
import { LazyImg } from "../../ui/LazyImg";
import { toast } from "../../ui/toast";
import { menuHandler, type MenuEntry } from "../../ui/ContextMenu";
import { HotkeyField } from "../profiles/HotkeyField";
import { keyHits, useKeyList } from "./KeyListParts";

const STYLE_HINT: Record<KeyListSettings["style"], (key: string) => string> = {
  window: (key) => t("{key} opens gachamod's menu over the game on the Keys tab. In exclusive fullscreen the game draws the list in its top right corner instead. The game reloads once after a change here.", { key }),
  game: (key) => t("The game draws the list in its top right corner, and it stays there while you play until you press {key} again. Works in exclusive fullscreen too. The game reloads once after a change here.", { key }),
};

const MENUS_TIP = t("Stops listing every mod that shows a key menu in game, now and for mods added later");
const ALL_TIP = t("Stops listing every mod here. Tick Listed on a mod to show it again");

/** What a change of the settings did, for Undo. */
function changeLabel(before: KeyListSettings, next: KeyListSettings): string {
  if (before.on !== next.on) return next.on ? t("Turned the key list on") : t("Turned the key list off");
  if (before.style !== next.style) return next.style === "window" ? t("Set the key list to show over the game") : t("Set the key list to show inside the game");
  if (before.key !== next.key) return t("Set the key list's key to {key}", { key: next.key });
  return next.own ? t("Listed mods with a key menu") : t("Left out mods with a key menu");
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
  /** Set several mods' picks at once, then read the list again. */
  const pickAll = async (picks: Array<[string, boolean | null]>) => {
    await Promise.all(picks.map(([id, v]) => keyList.choose(game, id, v)));
    await kl.reload();
  };
  /** Leave out every mod with a key menu: automatic leaves them out once `own` is off, and mods listed by hand go back
   *  to automatic. Undo puts the setting and those picks back. */
  const leaveOutMenus = async () => {
    if (!list) return;
    const before = list.settings;
    const next = { ...before, own: false };
    const picked = list.mods.filter((m) => m.ownHelp && m.choice === true).map((m) => m.modId);
    // the setting changes only when it was on, so the game doesn't reload for nothing
    const run = async (settings: KeyListSettings, v: boolean | null) => {
      if (before.own) kl.settle(await keyList.set(game, settings));
      await pickAll(picked.map((id) => [id, v]));
    };
    setBusy("bulk");
    try {
      await run(next, null);
      record({ label: t("Left out mods with a key menu"), undo: () => run(before, true), redo: () => run(next, null) });
    } catch (e) { toast(errorText(e), true); } finally { setBusy(null); }
  };
  /** Leave out every mod that's listed now. Undo gives each its pick from before. */
  const leaveOutAll = async () => {
    if (!list) return;
    const was = list.mods.filter((m) => m.listed).map((m): [string, boolean | null] => [m.modId, m.choice]);
    const off = was.map(([id]): [string, boolean | null] => [id, false]);
    setBusy("bulk");
    try {
      await pickAll(off);
      record({ label: tn(off.length, "Left {n} mod out of the key list", "Left {n} mods out of the key list"), undo: () => pickAll(was), redo: () => pickAll(off) });
    } catch (e) { toast(errorText(e), true); } finally { setBusy(null); }
  };

  if (!list) {
    return (
      <Panel id="keylist" title={t("Key list in game")} icon="keyboard">
        {kl.error
          ? <p className="hint row"><span>{kl.error}</span><Button size="sm" icon="refresh" onClick={() => void kl.reload()} title={t("Read the mods' keys again")}>{t("Try again")}</Button></p>
          : <div className="kl-all"><Skeleton h="3rem" /></div>}
      </Panel>
    );
  }

  const s = list.settings;
  const menusListed = list.mods.some((m) => m.ownHelp && m.listed);
  const anyListed = list.mods.some((m) => m.listed);
  const bulk: MenuEntry[] = [
    { label: t("Leave out mods with menus"), icon: "hide", disabled: !menusListed || !!busy, title: MENUS_TIP, onClick: () => void leaveOutMenus() },
    { label: t("Leave out all"), icon: "x", disabled: !anyListed || !!busy, title: ALL_TIP, onClick: () => void leaveOutAll() },
  ];
  return (
    <Panel id="keylist" title={t("Key list in game")} icon="keyboard" count={list.mods.length || undefined}>
      <div className="kl-all">
        <Toggle checked={s.on} disabled={busy === "settings"} onChange={(on) => void save({ ...s, on })} label={t("Show mod keys while playing")}
          hint={s.on && !list.available ? t("{key} shows the toggle keys of the mods showing now, once Switch skins in game is on.", { key: s.key })
            : s.on && s.own ? t("Press {key} while you play to see the toggle keys of the mods showing now.", { key: s.key })
            : s.on ? t("Press {key} while you play to see the toggle keys of the mods showing now. Mods with a key menu are left out.", { key: s.key })
            : t("Off: {key} does nothing in the game.", { key: s.key })} />
        {!list.available && (
          <div className="kl-off">
            <p className="hint">{t("The key list opens from the menu while you play, which needs Switch skins in game turned on.")}</p>
            <Button size="sm" icon="swap" onClick={() => go({ view: "tools", section: "ingame" })} title={t("Opens Switch skins in game")}>{t("Switch skins in game")}</Button>
          </div>
        )}
      </div>
      {s.on && list.available && (
        <>
          <div className="kl-opts">
            <div className="kl-opts-row">
              <span className="kl-opts-l">{t("Where it shows")}</span>
              <Segmented label={t("Where it shows")} size="sm" value={s.style} disabled={busy === "settings"} onChange={(style) => void save({ ...s, style })} options={[
                { value: "window", label: t("Over the game"), title: t("The Keys tab of gachamod's menu over the game, which {key} opens. In exclusive fullscreen the game always draws it", { key: s.key }) },
                { value: "game", label: t("Inside the game"), title: t("The game draws it in the top right corner and it stays there while you play. Also works in exclusive fullscreen") },
              ]} />
            </div>
            <div className="kl-opts-row">
              <HotkeyField label={t("Key that opens it")} value={s.key} bareF keep onChange={(key) => { if (key && key !== s.key) void save({ ...s, key }); }} />
              <Checkbox checked={s.own} disabled={busy === "settings"} onChange={(own) => void save({ ...s, own })} label={t("Also list mods with a key menu")}
                title={t("Some mods show a key menu in game, like a picture that F1 opens. They're left out unless this is on. A pick for one mod below still wins")} />
            </div>
            <p className="hint">{STYLE_HINT[s.style](s.key)}</p>
          </div>
          <div className="kl-h">
            <h3>{t("Mods with keys")}</h3>
            {list.mods.length > 0 && <>
              <Button size="sm" variant="ghost" icon="hide" disabled={!menusListed || !!busy} busy={busy === "bulk"} onClick={() => void leaveOutMenus()} title={MENUS_TIP}>{t("Leave out mods with menus")}</Button>
              <Button size="sm" variant="ghost" icon="x" disabled={!anyListed || !!busy} onClick={() => void leaveOutAll()} title={ALL_TIP}>{t("Leave out all")}</Button>
              <SearchField value={q} onChange={setQ} placeholder={t("Search")} title={t("Find a mod, character or key")} />
            </>}
          </div>
          {!list.mods.length ? <p className="muted kl-none">{t("None of your mods for this game has keys.")}</p>
            : !found.length ? <p className="muted kl-none">{t("No mod, character or key matches that.")}</p>
            : (
              <ul className="kl-list">
                {found.map((m) => <KeyModRow key={m.modId} m={m} own={s.own} busy={busy === m.modId} onChoose={(v) => void choose(m, v)} bulk={bulk} />)}
              </ul>
            )}
        </>
      )}
    </Panel>
  );
}

function KeyModRow({ m, own, busy, onChoose, bulk }: { m: ModKeyList; own: boolean; busy: boolean; onChoose: (listed: boolean | null) => void; bulk: MenuEntry[] }) {
  const src = fileUrl(m.preview);
  const facts = [m.character, tn(m.rows.length, "{n} key", "{n} keys"), m.showing ? t("showing now") : null].filter(Boolean).join(", ");
  const auto = m.ownHelp && !own;
  const items = (): MenuEntry[] => [
    { label: t("Listed"), icon: "check", checked: m.listed, disabled: busy, onClick: () => onChoose(!m.listed) },
    m.choice !== null && { label: t("Automatic"), icon: "undo", disabled: busy, onClick: () => onChoose(null) },
    { label: t("Open in Mods"), icon: "mods", onClick: () => go({ view: "library", modId: m.modId }) },
    "-",
    ...bulk,
  ];
  return (
    <li className="kl-mod" onContextMenu={menuHandler(items)}>
      <span className="kl-thumb">{src ? <LazyImg src={src} alt="" draggable={false} /> : <Icon name="mods" />}</span>
      <span className="kl-name">
        <button type="button" className="kl-link" title={t("Open in Mods")} onClick={() => go({ view: "library", modId: m.modId })}>{m.name}</button>
        <span className="hint" title={m.rows.map((r) => t("{keys}: {what}", { keys: r.keys.reduce((a, b) => t("{a} or {b}", { a, b })), what: r.what })).join("\n")}>{facts}</span>
      </span>
      <span className="kl-acts">
        {m.ownHelp && (
          <Badge tone="info" title={m.helpKey ? t("This mod shows a key menu in game ({key})", { key: m.helpKey }) : t("This mod shows a key menu in game")}>{t("Has menu")}</Badge>
        )}
        {m.choice !== null && (
          <Button size="sm" variant="ghost" icon="undo" disabled={busy} onClick={() => onChoose(null)} title={auto ? t("Go back to automatic: left out, since it has a key menu") : t("Go back to automatic: listed")}>{t("Automatic")}</Button>
        )}
        <Checkbox checked={m.listed} disabled={busy} onChange={(v) => onChoose(v)} label={t("Listed")}
          title={m.listed ? t("{name}'s keys show in the key list. Click to leave it out", { name: m.name }) : t("{name} is left out of the key list. Click to list it", { name: m.name })} />
      </span>
    </li>
  );
}
