// Settings: in-game hotkeys that switch profiles (gacha-core hotkeys.rs). Each profile's own key is set in its editor.
import { useEffect, useState } from "react";
import { errorText, hotkeys, settings, type HotkeyTaken } from "../../lib/api";
import { Panel, Toggle } from "../../ui/kit";
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
    <Panel title="In-game hotkeys" icon="keyboard" id="hotkeys">
      <div className="set-rows">
        <div className="set-row">
          <span><b>In-game hotkeys</b><span className="hint">Switch profile while a game runs, then reload mods. Give a profile its key in the profile's editor</span></span>
          <Toggle checked={on} onChange={(v) => void set("on", v ? "1" : "0")} />
        </div>
      </div>
      {on && (
        <div className="set-hotkeys">
          <HotkeyField label="Next profile" value={vals.next} onChange={(v) => void set("next", v)} taken={takenFor(vals.next)} hint="Off until you set a key, like Ctrl+Alt+Right" />
          <HotkeyField label="Previous profile" value={vals.prev} onChange={(v) => void set("prev", v)} taken={takenFor(vals.prev)} hint="Off until you set a key, like Ctrl+Alt+Left" />
        </div>
      )}
      {on && <AdminRow />}
    </Panel>
  );
}
