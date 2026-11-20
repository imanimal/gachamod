// The big Play button at the bottom of the sidebar (and on Home). Owner: HOME/PROFILES area.
// States: Play, Starting (until the game-state event says it runs; from 10 s it says what can hold it, at 60 s it gives
// up with a toast), Running (disabled, shows the time),
// and Set up (no folder yet: installs the mod loader when XXMI can, else goes to Settings). Ctrl+Enter and the controller's Menu button click `.side .play-btn`.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button, IconButton, Menu } from "../../ui/kit";
import { Popover } from "../../ui/Popover";
import { menuHandler } from "../../ui/ContextMenu";
import { canInstallLoader, installLoaders, useSetup } from "../../lib/setup";
import { toast } from "../../ui/toast";
import { app as appApi, errorText, games, settings, xxmi, type GameState } from "../../lib/api";
import { allGames, go, useGame } from "../../lib/store";
import { showsPage } from "../../lib/here";
import { HOLD, STUCK_MS } from "../../lib/activity";
import { shuffleBeforePlay } from "../library/shuffle";
import { setKickFixDone } from "../../lib/kickFix";
import { askKick } from "./KickWarning";
import { gameName, gameShort } from "../../lib/games";
import { t, tn } from "../../lib/i18n";
import { note as noteUsage } from "../../lib/telemetry";
import "./home.css";

// shared by every Play button, so the sidebar's and Home's agree
const starting = new Map<string, number>();
const startedAt = new Map<string, number>();
const subs = new Set<() => void>();
let version = 0;
const changed = () => { version++; subs.forEach((f) => f()); };
/** Starting gives up after this long without the game running. */
const GIVE_UP_MS = 60_000;
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
 *  Impact with mods first warns about its "Illegal tool detected" kick until the fix is done (lib/kickFix.ts).
 *  `needsYou` runs before anything the player has to see: that question, an error, a game that didn't start
 *  (quickstart shows its hidden window then). */
export async function play(game: GameState, vanilla = false, needsYou?: () => void) {
  if (starting.has(game.id) || game.running || asking) return;
  if (game.id === "gi" && !vanilla) {
    asking = true;
    try {
      const k = await games.kickCheck(game.id).catch(() => null);
      if (k?.warn) {
        needsYou?.();
        const a = await askKick(k.undone);
        if (a === "cancel") return;
        if (a === "done") await setKickFixDone(true);
      }
    } finally { asking = false; }
  }
  const stamp = Date.now();
  starting.set(game.id, stamp);
  changed();
  // still Starting a minute after the launch went out (this same press): stop waiting and say so, once for every
  // Play button. A Steam copy can spend a while inside games.launch first, so the minute starts after it
  const giveUp = () => window.setTimeout(() => {
    if (starting.get(game.id) !== stamp) return;
    starting.delete(game.id);
    changed();
    const again = { label: t("Try again"), run: () => { const g = allGames().find((x) => x.id === game.id); if (g) void play(g, vanilla); } };
    needsYou?.();
    toast(t("{game} didn't start. A launcher window waiting for an answer can hold it, so check the taskbar", { game: gameName(game) }), true,
      game.xxmi ? { label: t("Open XXMI Launcher"), run: () => { xxmi.open().catch((e) => toast(errorText(e), true)); } } : again,
      game.xxmi ? again : undefined);
  }, GIVE_UP_MS);
  try {
    if (!vanilla) await shuffleBeforePlay(game.id);
    const note = await games.launch(game.id, vanilla);
    noteUsage("game launched", { game: game.id, mode: vanilla ? "vanilla" : "modded" });
    giveUp();
    // the Play button says Starting: only a note from the launch is news
    if (note) toast(note, "info");
    const close = await settings.get(`${game.id}.closeOnLaunch`).catch(() => null);
    // to the background or quit, as Keep running in the background says, never with the first-close question
    if (close === "1") window.setTimeout(() => { appApi.close(false).catch(() => {}); }, 1500);
  } catch (e) {
    starting.delete(game.id);
    changed();
    needsYou?.();
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
  // tick each second while starting or running (play() gives up on Starting after a minute)
  useEffect(() => {
    if (!id || (!isRunning && startTime === undefined)) return;
    const timer = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [id, isRunning, startTime]);

  const setup = useSetup();
  if (!game) return null;
  const cls = `play${big ? " play-big" : ""}`;

  if (!canPlay(game)) {
    return (
      <div className={cls}>
        {canInstallLoader(game)
          ? <Button className="play-btn play-setup" variant="primary" size="lg" icon="install" busy={setup.running}
              title={t("Installs XXMI Launcher and {game}'s mod loader", { game: gameShort(game) })} onClick={() => void installLoaders([game.id])}>{t("Set up")}</Button>
          : <Button className="play-btn play-setup" variant="secondary" size="lg" icon="settings" title={t("Find or pick {game}'s folders in Settings, Games", { game: gameName(game) })}
              onClick={() => go({ view: "settings", section: "games" })}>{t("Set up")}</Button>}
      </div>
    );
  }

  const isStarting = startTime !== undefined && !isRunning;
  const ranMs = isRunning ? Date.now() - (startedAt.get(game.id) ?? Date.now()) : 0;
  // Starting for 10 s or more: say what can hold it
  const waitMs = isStarting ? Date.now() - (startTime ?? Date.now()) : 0;
  const slow = waitMs >= STUCK_MS;
  const name = gameName(game);
  const label = isRunning ? t("Running {time}", { time: elapsed(ranMs) }) : isStarting ? t("Starting") : t("Play");
  const tip = isRunning && ranMs >= 4 * 3600_000 ? tn(Math.floor(ranMs / 3600_000), "Running for {n} hour. Maybe drink some water", "Running for {n} hours. Maybe drink some water")
    : isRunning ? t("{game} is running ({time})", { game: name, time: elapsed(ranMs) })
    : slow ? t("Starting {game} ({time}). {hold}", { game: name, time: elapsed(waitMs), hold: HOLD.game })
    : game.viaXxmi ? t("Start {game} with mods through XXMI (Ctrl+Enter)", { game: name }) : t("Start {game} (Ctrl+Enter)", { game: name });
  // the same entries for the More button and a right-click on Play
  const startItems = (close: () => void) => [
    { label: t("Play without mods"), icon: "play" as const, disabled: isRunning || isStarting, hint: t("Starts the game with no mods"),
      onClick: () => { close(); void play(game, true); } },
    ...(game.xxmi ? [{ label: t("Open XXMI Launcher"), icon: "external" as const, onClick: () => {
      close(); xxmi.open().catch((e) => toast(errorText(e), true));
    } }] : []),
    // on Settings' Launch page already: its counterpart, Tools
    showsPage("settings", "launch")
      ? { label: t("Tools"), icon: "tools" as const, hint: t("Problems, conflicts and the in-game menu"), onClick: () => { close(); go("tools"); } }
      : { label: t("Launch options"), icon: "sliders" as const, onClick: () => { close(); go({ view: "settings", section: "launch" }); } },
  ];

  return (
    <div className={`${cls}${isRunning ? " running" : ""}${isStarting ? " starting" : ""}`} style={big && slow ? { flexWrap: "wrap" } : undefined}
      onContextMenu={menuHandler(() => startItems(() => {}).map(({ hint, ...it }) => ({ ...it, title: hint })))}>
      <Button className="play-btn" variant="primary" size="lg" icon={isRunning ? "zap" : "play"} busy={isStarting}
        disabled={isRunning} title={tip} onClick={() => void play(game)}>{label}</Button>
      <span ref={more} className="play-more-w">
        <IconButton className="play-more" icon="menu" variant="primary" size="lg" label={t("More ways to start")} title={t("More ways to start: without mods, XXMI Launcher, launch options")} on={menu}
          onClick={() => setMenu((m) => !m)} />
      </span>
      {big && slow && <p className="hint" role="status" style={{ flexBasis: "100%", maxWidth: "18rem", margin: 0 }}>{HOLD.game}</p>}
      {menu && (
        <Popover anchor={more.current} onClose={() => setMenu(false)} width="15em" label={t("Start options")}>
          <Menu items={startItems(() => setMenu(false))} />
        </Popover>
      )}
    </div>
  );
}
