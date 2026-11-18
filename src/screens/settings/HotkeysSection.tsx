// Settings > Hotkeys: every key in the app. The in-game hotkeys that switch profiles (gacha-core hotkeys.rs; each
// profile's key is set in its editor), the skin menu's keys for the game picked in the sidebar (the same fields and
// store as Tools > Switch skins in game, ingame/MenuKeyFields.tsx) and the app's shortcuts (the lists the ? sheet
// shows, shell/Shortcuts.tsx).
import { useEffect, useState } from "react";
import { errorText, hotkeys, settings, type GameId, type HotkeyTaken } from "../../lib/api";
import { Button, Panel, Toggle, Waiting } from "../../ui/kit";
import { go, useGame } from "../../lib/store";
import { useProfiles } from "../profiles/data";
import { toast } from "../../ui/toast";
import { HotkeyField } from "../profiles/HotkeyField";
import { AdminRow } from "./Feedback";
import { t, tb } from "../../lib/i18n";
import { gameShort } from "../../lib/games";
import { reloadLive, useLive, useLiveError } from "../ingame/data";
import { KeyClashNote } from "../ingame/KeyClash";
import { saveKeyList, useKeyList } from "../ingame/KeyListParts";
import { MenuKeyFields } from "../ingame/MenuKeyFields";
import { ShortcutGroups } from "../../shell/Shortcuts";

const KEYS = { on: "hotkeys.enabled", next: "hotkeys.next", prev: "hotkeys.prev" } as const;

export function HotkeysSection() {
  const [vals, setVals] = useState({ on: "1", next: "", prev: "" });
  const [taken, setTaken] = useState<HotkeyTaken[]>([]);

  useEffect(() => {
    let live = true;
    void Promise.all([settings.get(KEYS.on), settings.get(KEYS.next), settings.get(KEYS.prev)]).then(([on, next, prev]) => {
      if (live) setVals({ on: on ?? "1", next: next ?? "", prev: prev ?? "" });
    }).catch(() => {});
    return () => { live = false; };
  }, []);

  const set = async (k: keyof typeof KEYS, v: string) => {
    setVals((x) => ({ ...x, [k]: v }));
    try {
      await settings.set(KEYS[k], v);
      setTaken(await hotkeys.sync());
    } catch (e) { toast(errorText(e), true); }
  };
  const takenFor = (v: string) => { const r = v ? taken.find((x) => x.combo === v)?.reason : undefined; return r ? tb(r) : null; };
  const on = vals.on !== "0";

  return (
    <Panel title={t("In-game profile hotkeys")} icon="keyboard" id="hotkeys">
      <div className="set-rows">
        <div className="set-row" id="set-hotkeys-on">
          <span><b>{t("Switch profiles with hotkeys")}</b><span className="hint">{t("A key switches profile while a game runs, then reloads mods")}</span></span>
          <Toggle checked={on} onChange={(v) => void set("on", v ? "1" : "0")} />
        </div>
      </div>
      {on && (
        <div className="set-hotkeys">
          <HotkeyField label={t("Next profile")} value={vals.next} onChange={(v) => void set("next", v)} taken={takenFor(vals.next)} hint={t("Off until you set a key, like Ctrl+Alt+Right")} />
          <HotkeyField label={t("Previous profile")} value={vals.prev} onChange={(v) => void set("prev", v)} taken={takenFor(vals.prev)} hint={t("Off until you set a key, like Ctrl+Alt+Left")} />
        </div>
      )}
      {on && <ProfileKeys />}
      {on && <AdminRow />}
    </Panel>
  );
}

/** Each profile of the game picked in the sidebar with its own key, and a way to the profiles to change them. */
function ProfileKeys() {
  const game = useGame();
  const { list } = useProfiles(game?.id);
  if (!game) return null;
  const keyed = (list ?? []).filter((p) => p.hotkey);
  return (
    <div className="set-rows">
      <div className="set-row" id="set-hotkeys-profiles">
        <span><b>{t("Profile keys")}</b><span className="hint">{list === null ? t("Reading {game}'s profiles", { game: gameShort(game) })
          : keyed.length ? keyed.map((p) => `${p.name}: ${p.hotkey}`).join(t(", "))
          : t("No {game} profile has a key yet. Set one in a profile's editor", { game: gameShort(game) })}</span></span>
        <Button size="sm" icon="profiles" onClick={() => go({ view: "profiles" })} title={t("Opens Profiles, where each profile's editor sets its key (Ctrl+6)")}>{t("Manage profiles")}</Button>
      </div>
    </div>
  );
}

/** The skin menu's keys and the key list's key for the game picked in the sidebar. */
export function MenuKeysSection() {
  const game = useGame();
  if (!game) return null;
  return <MenuKeysPanel key={game.id} game={game.id} name={gameShort(game)} />;
}

function MenuKeysPanel({ game, name }: { game: GameId; name: string }) {
  const info = useLive(game);
  const error = useLiveError(game);
  const kl = useKeyList(game);
  const s = kl.list?.settings;
  const [busy, setBusy] = useState(false);
  const retry = async () => { setBusy(true); try { await reloadLive(game); } finally { setBusy(false); } };
  return (
    <Panel title={t("In-game menu keys")} icon="swap" id="menu-keys">
      {error ? (
        <p className="hint row"><span>{t("Couldn't read the game's skins: {error}", { error })}</span>
          <Button size="sm" icon="refresh" busy={busy} onClick={() => void retry()} title={t("Read the game's skins again")}>{t("Try again")}</Button></p>
      ) : !info ? <Waiting what={t("Reading {game}'s menu keys", { game: name })} /> : (
        <>
          <p className="hint row">
            <span>{info.all ? t("The skin menu in {game}. Each game keeps its own keys.", { game: name })
              : t("Switching skins in game is off in {game}, so these keys do nothing there until it's on.", { game: name })}</span>
            <Button size="sm" variant={info.all ? "ghost" : "secondary"} icon="swap" onClick={() => go({ view: "tools", section: "ingame" })}
              title={t("Opens Tools, Switch skins in game: the switch, how the menu opens and which characters are in it")}>{t("Switch skins in game")}</Button>
          </p>
          {info.all && <KeyClashNote game={game} />}
          <div className="live-menu" id="set-hotkeys-menu">
            <MenuKeyFields game={game} menu={info.menu} open />
          </div>
        </>
      )}
      <div className="live-menu" id="set-hotkeys-keylist">
        {s ? (
          <div className="live-menu-row">
            <HotkeyField label={t("Key that shows the key list")} value={s.key} bareF keep onChange={(key) => { if (key && key !== s.key) void saveKeyList(game, s, { ...s, key }, kl.settle); }}
              hint={s.on ? undefined : t("The key list is off, so this key does nothing.")} />
            <Button size="sm" variant="ghost" icon="keyboard" onClick={() => go({ view: "tools", section: "keylist" })}
              title={t("Opens Key list in game: its key, where it shows and which mods it lists")}>{t("Key list settings")}</Button>
          </div>
        ) : kl.error ? <p className="hint">{t("Couldn't read the key list: {error}", { error: kl.error })}</p>
          : <Waiting what={t("Reading the key list")} />}
      </div>
    </Panel>
  );
}

/** The app's keys, as the ? sheet lists them. None of them can be changed. */
export function ShortcutsSection() {
  return (
    <Panel title={t("App shortcuts")} icon="keyboard" id="shortcuts">
      <p className="hint">{t("These work in gachamod's window and stay the same. Press ? on any page to see them.")}</p>
      <ShortcutGroups />
    </Panel>
  );
}
