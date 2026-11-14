// The Keys box at the top of a GameBanana mod's description: the keys the author lists (read by lib/keybinds.ts),
// and a button that scrolls the description to where they list them. Owner: KEYBINDS area.
import { useState } from "react";
import type { DescKeys as Found } from "../lib/keybinds";
import { Icon } from "./Icon";
import { Kbd } from "./kit";
import "./desc-keys.css";

const SHOWN = 8;

/** "Ctrl++" is Ctrl and +, "Num +" is one key. */
function comboParts(k: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < k.length; i++) {
    const c = k[i]!;
    if (c === "+" && cur && !cur.endsWith(" ") && i < k.length - 1) { out.push(cur); cur = ""; }
    else cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

function KeyCombo({ keys }: { keys: string }) {
  const alts = keys.split(" / ");
  return (
    <span className="dkeys-k">
      {alts.map((alt, i) => {
        const pad = alt.startsWith("Pad ");
        const parts = comboParts(pad ? alt.slice(4) : alt);
        return (
          <span key={i} className="dkeys-alt">
            {i > 0 && <span className="dkeys-or">or</span>}
            {pad && <span className="dkeys-pad" title="Controller"><Icon name="gamepad" /></span>}
            {parts.map((p, n) => (
              <span key={n} className="dkeys-part">{n > 0 && <span className="dkeys-plus">+</span>}<Kbd>{p}</Kbd></span>
            ))}
          </span>
        );
      })}
    </span>
  );
}

/** `found` comes from detectKeybinds(description). `onJump` scrolls the description to `found.anchor`. Renders
 *  nothing when no keys were found. */
export function DescKeys({ found, onJump }: { found: Found; onJump?: () => void }) {
  const [all, setAll] = useState(false);
  if (!found.keys.length) return null;
  const list = all ? found.keys : found.keys.slice(0, SHOWN);
  const jump = () => {
    onJump?.();
    const el = found.anchor ? document.getElementById(found.anchor) : null;
    if (!el) return;
    el.classList.remove("flash");
    void el.offsetWidth; // restart the animation
    el.classList.add("flash");
    window.setTimeout(() => el.classList.remove("flash"), 1800);
  };
  return (
    <section className="dkeys" aria-label="Toggles">
      <header className="dkeys-h">
        <Icon name="keyboard" />
        <h3 className="sub-h">Toggles</h3>
        <span className="dkeys-n" title="Read from the description. The mod's files may differ">{found.keys.length}</span>
        {onJump && (
          <button type="button" className="dkeys-jump" onClick={jump} title="Scroll the description to where the author lists the toggles">
            Show in description
          </button>
        )}
      </header>
      <ul className="dkeys-list">
        {list.map((k, i) => (
          <li key={i}>
            <KeyCombo keys={k.keys} />
            {k.action && <span className="dkeys-a">{k.action}</span>}
          </li>
        ))}
      </ul>
      {found.keys.length > SHOWN && (
        <button type="button" className="dkeys-more" onClick={() => setAll((a) => !a)}>
          {all ? "Show fewer" : `Show all ${found.keys.length}`}
        </button>
      )}
    </section>
  );
}
