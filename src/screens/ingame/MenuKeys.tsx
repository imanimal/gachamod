// The skin menu's keys, each one the player's to pick (live.rs MENU_BINDS): what moves up and down, shows a skin, goes
// back to the characters and closes the menu, on the keyboard and on a controller, plus the controller's buttons that
// open it. Tucked into a fold under the key that opens the menu. Owner: INGAME area.
import { useEffect, useRef, useState } from "react";
import { KEY_LIST_SHOWN, MENU_BINDS, type MenuSettings } from "../../lib/api";
import { Icon } from "../../ui/Icon";
import { captureKeys } from "../../ui/KeyEditor";
import { Button, Checkbox, IconButton } from "../../ui/kit";
import { bindingLabel } from "../modtools/keyNames";
import { useSetting } from "../settings/parts";
import "../../ui/key-editor.css";

/** live.rs MAX_BINDS. */
const MOST = 4;

const ROWS: Array<{ id: string; label: string; tip: string }> = [
  { id: "up", label: "Move up", tip: "The row above. From the first row it goes to the last" },
  { id: "down", label: "Move down", tip: "The row below. From the last row it goes to the first" },
  { id: "show", label: "Show the skin", tip: "Shows the row's skin. On the list of characters it opens the character" },
  { id: "back", label: "Back to characters", tip: "From a character's skins to the list of characters" },
  { id: "close", label: "Close the menu", tip: "The key that opens the menu closes it too" },
  { id: "open", label: "Open with a controller", tip: "Controller buttons only, pressed together. The keyboard key is Key that opens it, above" },
  { id: "keys", label: "Show the key list", tip: "Shows the keys of the mods on screen, from the skin menu" },
];

const same = (a: string[], b: readonly string[]) => a.length === b.length && a.every((k, i) => k === b[i]);

/** Wait for the next keys the player presses (keyboard, mouse or controller). The label says what is held so far, null
 *  while nothing is being recorded; calling `start` again stops it. */
function useCapture(onBinding: (binding: string) => void): [string | null, () => void] {
  const [live, setLive] = useState<string | null>(null);
  const cancel = useRef<(() => void) | null>(null);
  useEffect(() => () => cancel.current?.(), []);
  const start = () => {
    if (live !== null) { cancel.current?.(); return; }
    const c = captureKeys((l) => setLive(l));
    cancel.current = c.cancel;
    setLive("");
    void c.done.then((b) => {
      cancel.current = null;
      setLive(null);
      if (b) onBinding(b);
    });
  };
  return [live, start];
}

function BindChip({ binding, what, onBinding, onRemove }: { binding: string; what: string; onBinding: (b: string) => void; onRemove: () => void }) {
  const [live, start] = useCapture(onBinding);
  const label = bindingLabel(binding);
  return (
    <span className="live-bind-c">
      <button type="button" className={`ke-chip${live !== null ? " capturing" : ""}`} onClick={start}
        title={live !== null ? "Press the new key, combination or controller buttons. Esc or B cancels" : `Change ${label}: click, then press the new key, combination or controller buttons`}
        aria-label={live !== null ? "Waiting for keys" : `${what}: ${label}. Change`}>
        {live !== null ? <span className="ke-chip-live" aria-live="polite">{live || "Press keys"}</span>
          : <><span className="kbd">{label}</span><Icon name="edit" className="ke-chip-i" /></>}
      </button>
      <IconButton size="sm" icon="x" label={`Remove ${label} from ${what}`} onClick={onRemove} />
    </span>
  );
}

function AddKey({ what, onBinding }: { what: string; onBinding: (b: string) => void }) {
  const [live, start] = useCapture(onBinding);
  if (live !== null) {
    return (
      <button type="button" className="ke-chip capturing" onClick={start} title="Press the key, combination or controller buttons. Esc or B cancels" aria-label="Waiting for keys">
        <span className="ke-chip-live" aria-live="polite">{live || "Press keys"}</span>
      </button>
    );
  }
  return <IconButton size="sm" icon="plus" label={`Add a key to ${what}`} title={`Add another key or controller button to ${what}`} onClick={start} />;
}

/** `onChange` gets every thing's keys with one changed; the backend says when a key already does something else. */
export function MenuKeys({ menu, onChange }: { menu: MenuSettings; onChange: (binds: Record<string, string[]>) => void }) {
  const rows = ROWS.filter((r) => r.id !== "keys" || KEY_LIST_SHOWN);
  const usual = rows.every((r) => same(menu.binds[r.id] ?? [], MENU_BINDS[r.id] ?? []));
  const set = (id: string, keys: string[]) => onChange({ ...menu.binds, [id]: keys });
  // otherkeys.rs ASK: the toasts that ask when another app has one of gachamod's keys
  const [ask, setAsk] = useSetting("otherKeys.ask", "1");
  return (
    <details className="live-binds">
      <summary title="Change the keys and controller buttons that move, pick and close in the skin menu">Menu keys</summary>
      <ul className="live-binds-l">
        {rows.map((r) => {
          const keys = menu.binds[r.id] ?? [];
          return (
            <li key={r.id} className="live-bind">
              <span className="live-bind-t" title={r.tip}>{r.label}</span>
              <span className="live-bind-k">
                {keys.map((k, i) => (
                  <BindChip key={k} binding={k} what={r.label}
                    onBinding={(b) => set(r.id, keys.map((x, j) => (j === i ? b : x)))} onRemove={() => set(r.id, keys.filter((_, j) => j !== i))} />
                ))}
                {keys.length < MOST && <AddKey what={r.label} onBinding={(b) => set(r.id, [...keys, b])} />}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="hint">
        Keyboard keys work in both menus. In the menu over the game the arrow keys and Enter always work as well, and a
        controller moves in it the way it does in gachamod.{!menu.pad && " Controller buttons are off: turn on Use a controller in the menu."}
      </p>
      <Checkbox checked={ask !== "0"} onChange={(v) => setAsk(v ? "1" : "0")} label="Say when another app uses one of these keys"
        title="When Medal, OBS, Steam or another recorder listens for the key that opens the skin menu, gachamod says so and offers a free key. The note on this page shows either way" />
      {!usual && <Button size="sm" variant="ghost" icon="undo" title="Arrow keys, Enter, the D-pad, A, B and both sticks, as the menu starts out"
        onClick={() => onChange({ ...MENU_BINDS })}>Use the usual keys</Button>}
    </details>
  );
}
