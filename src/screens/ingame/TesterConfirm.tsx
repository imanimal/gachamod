// The question before tester options go on: the menu the game draws, in the games that don't have it already
// (live.rs drawn_menu_open), with what it costs.
// Every place with the switch (Settings, Check this game) asks through askTesterRisks, which mounts itself on first
// use. Owner: INGAME area.
import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { Confirm } from "../../ui/kit";

let answer: ((yes: boolean) => void) | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
let mounted = false;

/** Show the question. True once the player says yes; false for Cancel, Esc or a click outside. */
export function askTesterRisks(): Promise<boolean> {
  if (!mounted) {
    mounted = true;
    const el = document.createElement("div");
    el.className = "tester-confirm";
    document.body.appendChild(el);
    createRoot(el).render(<Host />);
  }
  answer?.(false);
  return new Promise((resolve) => { answer = resolve; emit(); });
}

const done = (yes: boolean) => { const a = answer; answer = null; emit(); a?.(yes); };

function Host() {
  const open = useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => answer !== null);
  if (!open) return null;
  return (
    <Confirm title="Turn on tester options?" yes="Turn on" onYes={() => done(true)} onClose={() => done(false)}>
      <p>
        Tester options add the menu the game draws itself to Switch skins in game in Wuthering Waves, Endfield and
        the other games. Zenless Zone Zero, Genshin Impact, Star Rail and Honkai Impact 3rd always have it. It opens
        in exclusive fullscreen, where gachamod's menu over the game can't.
      </p>
      <p>Its pictures load with the game's mods, so the game takes a little longer to load them and uses more memory.</p>
      <p>Check this game sends what worked and what didn't to the developer.</p>
    </Confirm>
  );
}
