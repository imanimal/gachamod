// html[data-idle] while nobody is looking at the window: it lost focus, it's hidden or minimized, or a game is
// running. Each game theme's endless decoration (the drifting sky, the turning rings, small orbits beside the
// content) stops under it, so the window draws no frames behind a game. A new looping decoration needs its own
// pause rule next to the theme's others. html[data-gpu="off"] marks a run without hardware acceleration (Settings, Appearance, read
// once since it counts from the next start): the backdrop stays still and nothing blurs. main.tsx installs it.
// Owner: THEME area.
import { games, settings } from "./api";
import { allGames } from "./store";

export function installIdle() {
  const r = document.documentElement;
  // game state events as they come; the game list (App keeps it in step) covers games that ran before this window
  const live = new Map<string, boolean>();
  let gpuOff = false;
  const gameRunning = () => {
    const on = new Set(allGames().filter((g) => g.running).map((g) => g.id as string));
    for (const [g, running] of live) if (running) on.add(g); else on.delete(g);
    return on.size > 0;
  };
  const update = () => {
    const idle = gpuOff || document.visibilityState === "hidden" || !document.hasFocus() || gameRunning();
    if (idle) { if (!("idle" in r.dataset)) r.dataset.idle = ""; } else delete r.dataset.idle;
  };
  window.addEventListener("blur", update);
  window.addEventListener("focus", update);
  document.addEventListener("visibilitychange", update);
  games.onState((p) => { live.set(p.game, p.running); update(); }).catch(() => {});
  settings.get("app.gpu").then((v) => {
    gpuOff = v === "0";
    if (gpuOff) r.dataset.gpu = "off"; else delete r.dataset.gpu;
    update();
  }).catch(() => {});
  update();
}
