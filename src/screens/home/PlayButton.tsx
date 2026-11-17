// The big Play button at the bottom of the sidebar (and on Home). Owner: HOME/PROFILES area.
// States: Play, Starting (until the game-state event says it runs, or 60 s), Running (disabled, shows the time),
// and Set up (no folder yet: installs the mod loader when XXMI can, else goes to Settings). Ctrl+Enter and the controller's Menu button click `.side .play-btn`.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button, IconButton, Menu } from "../../ui/kit";
import { Popover } from "../../ui/Popover";
import { canInstallLoader, installLoaders, useSetup } from "../../lib/setup";
import { toast } from "../../ui/toast";
import { errorText, games, settings, xxmi, type GameState } from "../../lib/api";
import { windowAction } from "../../lib/tauri";
import { go, useGame } from "../../lib/store";
import { shuffleBeforePlay } from "../library/shuffle";
import { setKickFixDone } from "../../lib/kickFix";
import { askKick } from "./KickWarning";
import "./home.css";

// shared by every Play button, so the sidebar's and Home's agree
const starting = new Map<string, number>();
const startedAt = new Map<string, number>();
const subs = new Set<() => void>();
let version = 0;
const changed = () => { version++; subs.forEach((f) => f()); };
const useLaunchState = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => version);

/** Folders are in place to start this game. */
export const canPlay = (g: GameState) => g.viaXxmi || !!g.gameDir;

/** "1:05:09" or "12:34". */
function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}

let asking = false;

/** Start a game (with or without mods). Errors become toasts; the button shows Starting until it runs. Genshin
 *  Impact with mods first warns about its "Illegal tool detected" kick until the fix is done (lib/kickFix.ts). */
export async function play(game: GameState, vanilla = false) {
  if (starting.has(game.id) || game.running || asking) return;
  if (game.id === "gi" && !vanilla) {
    asking = true;
    try {
      const k = await games.kickCheck(game.id).catch(() => null);
      if (k?.warn) {
        const a = await askKick(k.undone);
        if (a === "cancel") return;
        if (a === "done") await setKickFixDone(true);
      }
    } finally { asking = false; }
  }
  starting.set(game.id, Date.now());
  changed();
  try {
    if (!vanilla) await shuffleBeforePlay(game.id);
    const note = await games.launch(game.id, vanilla);
    toast(note ?? (vanilla ? `Starting ${game.name} without mods` : `Starting ${game.name}`));
    const close = await settings.get(`${game.id}.closeOnLaunch`).catch(() => null);
    if (close === "1") window.setTimeout(() => void windowAction("close"), 1500);
  } catch (e) {
    starting.delete(game.id);
    changed();
    toast(errorText(e), true);
  }
}

export function PlayButton({ big = false }: { big?: boolean }) {
  const game = useGame();
  useLaunchState();
  const [, tick] = useState(0);
  const [menu, setMenu] = useState(false);
  const more = useRef<HTMLSpanElement>(null);
  const id = game?.id;
  const isRunning = !!game?.running;

  // running: note when it started; stopped: forget it
  useEffect(() => {
    if (!id) return;
    if (isRunning) {
      if (!startedAt.has(id)) startedAt.set(id, Date.now());
      if (starting.delete(id)) changed();
    } else if (startedAt.delete(id)) changed();
  }, [id, isRunning]);

  // the game-state event also clears Starting for games that aren't current
  useEffect(() => {
    let live = true;
    const off = games.onState((p) => {
      if (!live) return;
      if (p.running) { starting.delete(p.game); startedAt.set(p.game, Date.now()); } else startedAt.delete(p.game);
      changed();
    });
    return () => { live = false; off.then((f) => f()).catch(() => {}); };
  }, []);

  const startTime = id ? starting.get(id) : undefined;
  // tick each second while starting or running; give up on Starting after 60 s
  useEffect(() => {
    if (!id || (!isRunning && startTime === undefined)) return;
    const t = window.setInterval(() => {
      if (startTime !== undefined && !isRunning && Date.now() - startTime > 60_000) { starting.delete(id); changed(); }
      tick((n) => n + 1);
    }, 1000);
    return () => window.clearInterval(t);
  }, [id, isRunning, startTime]);

  const setup = useSetup();
  if (!game) return null;
  const cls = `play${big ? " play-big" : ""}`;

  if (!canPlay(game)) {
    return (
      <div className={cls}>
        {canInstallLoader(game)
          ? <Button className="play-btn play-setup" variant="primary" size="lg" icon="install" busy={setup.running}
              title={`Installs XXMI Launcher and ${game.short}'s mod loader`} onClick={() => void installLoaders([game.id])}>Set up</Button>
          : <Button className="play-btn play-setup" variant="secondary" size="lg" icon="settings" title={`Find or pick ${game.name}'s folders in Settings, Games and mod loaders`}
              onClick={() => go({ view: "settings", section: "games" })}>Set up</Button>}
      </div>
    );
  }

  const isStarting = startTime !== undefined && !isRunning;
  const label = isRunning ? `Running ${elapsed(Date.now() - (startedAt.get(game.id) ?? Date.now()))}` : isStarting ? "Starting" : "Play";
  const ranMs = isRunning ? Date.now() - (startedAt.get(game.id) ?? Date.now()) : 0;
  const tip = isRunning && ranMs >= 4 * 3600_000 ? `Running for ${Math.floor(ranMs / 3600_000)} hours. Maybe drink some water`
    : isRunning ? `${game.name} is running (${label.toLowerCase()})` : game.viaXxmi ? `Start ${game.name} with mods through XXMI (Ctrl+Enter)` : `Start ${game.name} (Ctrl+Enter)`;

  return (
    <div className={`${cls}${isRunning ? " running" : ""}${isStarting ? " starting" : ""}`}>
      <Button className="play-btn" variant="primary" size="lg" icon={isRunning ? "zap" : "play"} busy={isStarting}
        disabled={isRunning} title={tip} onClick={() => void play(game)}>{label}</Button>
      <span ref={more} className="play-more-w">
        <IconButton className="play-more" icon="menu" variant="primary" size="lg" label="More ways to start" title="More ways to start: without mods, XXMI Launcher, launch options" on={menu}
          onClick={() => setMenu((m) => !m)} />
      </span>
      {menu && (
        <Popover anchor={more.current} onClose={() => setMenu(false)} width="15em" label="Start options">
          <Menu items={[
            { label: "Play without mods", icon: "play", disabled: isRunning || isStarting, hint: "Starts the game with no mods, the way the developers intended. Brave",
              onClick: () => { setMenu(false); void play(game, true); } },
            ...(game.xxmi ? [{ label: "Open XXMI Launcher", icon: "external" as const, onClick: () => {
              setMenu(false); xxmi.open().catch((e) => toast(errorText(e), true));
            } }] : []),
            { label: "Launch options", icon: "sliders", onClick: () => { setMenu(false); go({ view: "settings", section: "launch" }); } },
          ]} />
        </Popover>
      )}
    </div>
  );
}
