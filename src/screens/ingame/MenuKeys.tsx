// The skin menu's keys, each one the player's to pick (live.rs MENU_BINDS): what moves up and down, shows a skin, goes
// back to the characters and closes the menu, on the keyboard and on a controller, plus the controller's buttons that
// open it. Tucked into a fold under the key that opens the menu. Owner: INGAME area.
import { useEffect, useRef, useState } from "react";
import { MENU_BINDS, type MenuSettings } from "../../lib/api";
import { t } from "../../lib/i18n";
import { Icon } from "../../ui/Icon";
import { captureKeys } from "../../ui/KeyEditor";
import { Button, IconButton } from "../../ui/kit";
import { bindingLabel } from "../modtools/keyNames";
import "../../ui/key-editor.css";

/** live.rs MAX_BINDS. */
const MOST = 4;

const ROWS: Array<{ id: string; label: string; tip: string }> = [
  { id: "up", label: t("Move up"), tip: t("The row above. From the first row it goes to the last") },
  { id: "down", label: t("Move down"), tip: t("The row below. From the last row it goes to the first") },
  { id: "show", label: t("Show the skin"), tip: t("Shows the row's skin. On the list of characters it opens the character") },
  { id: "back", label: t("Back to characters"), tip: t("From a character's skins to the list of characters") },
  { id: "close", label: t("Close the menu"), tip: t("The key that opens the menu closes it too") },
  { id: "open", label: t("Open with a controller"), tip: t("Controller buttons only, pressed together. The keyboard key is Key that opens it, above") },
  { id: "keys", label: t("Show the key list"), tip: t("Shows the keys of the mods on screen, from the skin menu") },
];

const same = (a: string[], b: readonly string[]) => a.length === b.length && a.every((k, i) => k === b[i]);

/** The row whose keys are controller buttons only. */
const PAD_ROW = "open";
const padOnly = (binding: string) => binding.split(/\s+/).filter(Boolean).every((k) => k.startsWith("XB_"));
/** What a chip asks for while it waits. */
const waitTip = (pad: boolean) => (pad ? t("Press the controller buttons. Esc or B cancels") : t("Press the new key, combination or controller buttons. Esc or B cancels"));

/** Wait for the next keys the player presses (keyboard, mouse or controller). The label says what is held so far, null
 *  while nothing is being recorded; calling `start` again stops it. `pad`: only controller buttons count, and a
 *  keyboard press is turned away with a note. */
function useCapture(onBinding: (binding: string) => void, pad: boolean): [string | null, () => void, string | null] {
  const [live, setLive] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const cancel = useRef<(() => void) | null>(null);
  useEffect(() => () => cancel.current?.(), []);
  const start = () => {
    if (live !== null) { cancel.current?.(); return; }
    const c = captureKeys((l) => setLive(l));
    cancel.current = c.cancel;
    setLive("");
    setNote(null);
    void c.done.then((b) => {
      cancel.current = null;
      setLive(null);
      if (b && pad && !padOnly(b)) setNote(t("Controller buttons only. The keyboard key is Key that opens it"));
      else if (b) onBinding(b);
    });
  };
  return [live, start, note];
}

function BindChip({ binding, what, pad, onBinding, onRemove }: { binding: string; what: string; pad: boolean; onBinding: (b: string) => void; onRemove: () => void }) {
  const [live, start, note] = useCapture(onBinding, pad);
  const label = bindingLabel(binding);
  return (
    <span className="live-bind-c">
      <button type="button" className={`ke-chip${live !== null ? " capturing" : ""}`} onClick={start}
        title={live !== null ? waitTip(pad) : pad ? t("Change {key}: click, then press the controller buttons", { key: label })
          : t("Change {key}: click, then press the new key, combination or controller buttons", { key: label })}
        aria-label={live !== null ? t("Waiting for keys") : t("{what}: {key}. Change", { what, key: label })}>
        {live !== null ? <span className="ke-chip-live" aria-live="polite">{live || t("Press keys")}</span>
          : <><span className="kbd">{label}</span><Icon name="edit" className="ke-chip-i" /></>}
      </button>
      <IconButton size="sm" icon="x" label={t("Remove {key} from {what}", { key: label, what })} onClick={onRemove} />
      {note && <span className="hint" role="status">{note}</span>}
    </span>
  );
}

function AddKey({ what, pad, onBinding }: { what: string; pad: boolean; onBinding: (b: string) => void }) {
  const [live, start, note] = useCapture(onBinding, pad);
  if (live !== null) {
    return (
      <button type="button" className="ke-chip capturing" onClick={start} title={waitTip(pad)} aria-label={t("Waiting for keys")}>
        <span className="ke-chip-live" aria-live="polite">{live || (pad ? t("Press buttons") : t("Press keys"))}</span>
      </button>
    );
  }
  return (
    <>
      <IconButton size="sm" icon="plus" label={pad ? t("Add buttons to {what}", { what }) : t("Add a key to {what}", { what })}
        title={pad ? t("Add another controller button combination to {what}", { what }) : t("Add another key or controller button to {what}", { what })} onClick={start} />
      {note && <span className="hint" role="status">{note}</span>}
    </>
  );
}

/** A change to the menu's keys: it gets the keys as they are when it saves (another change may still be saving). */
export type BindsUpdate = (binds: Record<string, string[]>) => Record<string, string[]>;

/** `onChange` gets the change, what its Undo step says ("Added K to Close the menu") and `say`: true when the chip or
 *  button that made it goes away, so the change gets a toast with Undo. The backend says when a key already does
 *  something else. `open`: the fold starts open (Settings > Hotkeys). */
export function MenuKeys({ menu, onChange, open }: { menu: MenuSettings; onChange: (update: BindsUpdate, label: string, say?: boolean) => void; open?: boolean }) {
  const usual = ROWS.every((r) => same(menu.binds[r.id] ?? [], MENU_BINDS[r.id] ?? []));
  const set = (id: string, f: (keys: string[]) => string[], label: string, say = false) => onChange((b) => ({ ...b, [id]: f(b[id] ?? []) }), label, say);
  return (
    <details className="live-binds" open={open}>
      <summary title={t("Change the keys and controller buttons that move, pick and close in the skin menu")}>{t("Menu keys")}</summary>
      <ul className="live-binds-l">
        {ROWS.map((r) => {
          const keys = menu.binds[r.id] ?? [];
          return (
            <li key={r.id} className="live-bind">
              <span className="live-bind-t" title={r.tip}>{r.label}</span>
              <span className="live-bind-k">
                {keys.map((k) => (
                  <BindChip key={k} binding={k} what={r.label} pad={r.id === PAD_ROW}
                    onBinding={(b) => set(r.id, (ks) => ks.map((x) => (x === k ? b : x)), t("Changed {old} to {key} for {what}", { old: bindingLabel(k), key: bindingLabel(b), what: r.label }))}
                    onRemove={() => set(r.id, (ks) => ks.filter((x) => x !== k), t("Removed {key} from {what}", { key: bindingLabel(k), what: r.label }), true)} />
                ))}
                {keys.length < MOST && <AddKey what={r.label} pad={r.id === PAD_ROW}
                  onBinding={(b) => set(r.id, (ks) => (ks.length < MOST && !ks.includes(b) ? [...ks, b] : ks), t("Added {key} to {what}", { key: bindingLabel(b), what: r.label }))} />}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="hint">
        {menu.pad ? t("Click a key to rebind it. Keyboard keys work in both menus. In the menu over the game the arrow keys and Enter always work as well, and a controller moves in it the way it does in gachamod.")
          : t("Click a key to rebind it. Keyboard keys work in both menus. In the menu over the game the arrow keys and Enter always work as well, and a controller moves in it the way it does in gachamod. Controller buttons are off: turn on Use a controller in the menu.")}
      </p>
      {!usual && <Button size="sm" variant="ghost" icon="undo" title={t("Arrow keys, Enter, the D-pad, A, B and both sticks, as the menu starts out")}
        onClick={() => onChange(() => ({ ...MENU_BINDS }), t("Put back the usual menu keys"), true)}>{t("Use the usual keys")}</Button>}
    </details>
  );
}
