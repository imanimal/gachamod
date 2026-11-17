// Settings: in-game hotkeys that switch profiles (gacha-core hotkeys.rs). Each profile's own key is set in its editor.
import { useEffect, useState } from "react";
import { errorText, hotkeys, settings, type HotkeyTaken } from "../../lib/api";
import { Button, Panel, Toggle } from "../../ui/kit";
import { go, useGame } from "../../lib/store";
import { useProfiles } from "../profiles/data";
import { toast } from "../../ui/toast";
import { HotkeyField } from "../profiles/HotkeyField";
import { AdminRow } from "./Feedback";

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
      const t = await hotkeys.sync();
      setTaken(t);
      const mine = v && k !== "on" ? t.find((x) => x.combo === v) : undefined;
      if (mine) toast(mine.reason, true);
    } catch (e) { toast(errorText(e), true); }
  };
  const takenFor = (v: string) => (v ? taken.find((x) => x.combo === v)?.reason ?? null : null);
  const on = vals.on !== "0";

  return (
    <Panel title="In-game profile hotkeys" icon="keyboard" id="hotkeys">
      <div className="set-rows">
        <div className="set-row" id="set-hotkeys-on">
          <span><b>Switch profiles with hotkeys</b><span className="hint">A key switches profile while a game runs, then reloads mods</span></span>
          <Toggle checked={on} onChange={(v) => void set("on", v ? "1" : "0")} />
        </div>
      </div>
      {on && (
        <div className="set-hotkeys">
          <HotkeyField label="Next profile" value={vals.next} onChange={(v) => void set("next", v)} taken={takenFor(vals.next)} hint="Off until you set a key, like Ctrl+Alt+Right" />
          <HotkeyField label="Previous profile" value={vals.prev} onChange={(v) => void set("prev", v)} taken={takenFor(vals.prev)} hint="Off until you set a key, like Ctrl+Alt+Left" />
        </div>
      )}
      {on && <ProfileKeys />}
      <div className="set-rows">
        <div className="set-row" id="set-hotkeys-menu">
          <span><b>In-game menu keys</b><span className="hint">The key that opens the skin menu over the game (F7 at first) and the keys that move through it</span></span>
          <Button size="sm" icon="swap" onClick={() => go({ view: "tools", section: "ingame" })} title="Opens Tools, Switch skins in game, where every menu key can be changed (Ctrl+7)">Menu keys</Button>
        </div>
      </div>
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
        <span><b>Profile keys</b><span className="hint">{list === null ? `Reading ${game.short}'s profiles`
          : keyed.length ? keyed.map((p) => `${p.name}: ${p.hotkey}`).join(", ")
          : `No ${game.short} profile has its own key yet. Set one in a profile's editor`}</span></span>
        <Button size="sm" icon="profiles" onClick={() => go({ view: "profiles" })} title="Opens Profiles, where each profile's editor sets its key (Ctrl+6)">Manage profiles</Button>
      </div>
    </div>
  );
}
