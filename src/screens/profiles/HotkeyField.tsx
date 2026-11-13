// A field that records a key combo like "Ctrl+Alt+1": focus it, press the keys. Used for profile hotkeys and the
// next/previous profile keys in Settings. The combo format matches gacha-core's hotkeys.rs.
import { useState, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "../../ui/kit";

const NAMED: Record<string, string> = {
  ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
  Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown", Insert: "Insert", Delete: "Delete", Space: "Space",
};

/** The key part of a combo for a KeyboardEvent.code, or null for keys a hotkey can't use. */
function keyOf(code: string): string | null {
  let m: RegExpMatchArray | null;
  if ((m = code.match(/^Key([A-Z])$/))) return m[1]!;
  if ((m = code.match(/^Digit(\d)$/))) return m[1]!;
  if ((m = code.match(/^Numpad(\d)$/))) return `Num${m[1]}`;
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code;
  return NAMED[code] ?? null;
}

function mods(e: KeyboardEvent): string[] {
  return [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Win"].filter(Boolean) as string[];
}

export function HotkeyField({ label, value, onChange, taken, hint }:
  { label?: ReactNode; value: string; onChange: (v: string) => void; taken?: string | null; hint?: ReactNode }) {
  const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState("");
  const [problem, setProblem] = useState("");

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Tab") return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") { (e.target as HTMLInputElement).blur(); return; }
    const m = mods(e);
    if (!m.length && (e.key === "Backspace" || e.key === "Delete")) { onChange(""); setProblem(""); return; }
    const key = keyOf(e.code);
    if (!key) { setPartial(m.length ? `${m.join("+")}+` : ""); return; }
    if (!m.some((x) => x !== "Shift")) { setProblem(`Hold Ctrl, Alt or Win with ${key}, like Ctrl+Alt+${key}`); return; }
    if (key === "F10") { setProblem("F10 is the game's reload key. Pick another key"); return; }
    setProblem("");
    setPartial("");
    onChange([...m, key].join("+"));
  };

  const shown = listening && partial ? partial : value;
  const note = problem || taken || hint;
  return (
    <div className={`field hotkey-field${taken || problem ? " bad" : ""}`}>
      {label && <span className="field-l">{label}</span>}
      <span className="hotkey-row">
        <input readOnly value={shown} className="mono" aria-invalid={!!(taken || problem) || undefined}
          placeholder={listening ? "Press the keys" : "Click, then press the keys"}
          title="Click and press a combo like Ctrl+Alt+1. Backspace clears it, Esc stops"
          onFocus={() => setListening(true)} onBlur={() => { setListening(false); setPartial(""); }}
          onKeyDown={onKeyDown} onKeyUp={(e) => { if (!mods(e).length) setPartial(""); }} />
        {value && <Button size="sm" variant="ghost" icon="x" title="Clear the hotkey" onClick={() => { onChange(""); setProblem(""); }} />}
      </span>
      {note && <span className="hint">{note}</span>}
    </div>
  );
}
