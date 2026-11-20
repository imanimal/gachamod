// The question before tester options go on: the menu the game draws, in the games that don't have it already
// (live.rs drawn_menu_open), with what it costs.
// Every place with the switch (Settings, Check this game) asks through askTesterRisks, which mounts itself on first
// use. Owner: INGAME area.
import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { t } from "../../lib/i18n";
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
    <Confirm title={t("Turn on tester options?")} yes={t("Turn on")} onYes={() => done(true)} onClose={() => done(false)}>
      <p>
        {t("Tester options add the skin menu the game draws itself to {ww}, {ef} and the other games. {zzz}, {gi}, {hsr} and {hi3} always have it. Unlike gachamod's menu over the game, it opens in exclusive fullscreen.", {
          ww: t("Wuthering Waves"), ef: t("Endfield"), zzz: t("Zenless Zone Zero"), gi: t("Genshin Impact"), hsr: t("Star Rail"), hi3: t("Honkai Impact 3rd"),
        })}
      </p>
      <p>{t("The menu's pictures load with the game's mods, so the game takes a little longer to load them and uses more memory.")}</p>
      <p>{t("The Check this game walkthrough sends the developer what worked and what didn't.")}</p>
    </Confirm>
  );
}
