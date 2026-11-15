// The first start, without a welcome window. When XXMI Launcher already has a game ready, the app opens straight to
// it and one toast says what was found. When no game is ready, the main view is this page: the games found on this
// PC and one button that installs XXMI Launcher and their mod loaders (lib/setup.ts). It keeps looking for games while
// it's open, so a game installed meanwhile shows up by itself. Sets "onboarded". Owner: SETTINGS/AI area.
import { useEffect, useState } from "react";
import { Button, Progress, Waiting, formatBytes, plural } from "../../ui/kit";
import { GameBadge } from "../../ui/GameBadge";
import { toast } from "../../ui/toast";
import { HOLD } from "../../lib/activity";
import { imm, settings, type GameState, type ImmInfo } from "../../lib/api";
import { allGames, go, useGames } from "../../lib/store";
import { canInstallLoader, installLoaders, recheck, useSetup } from "../../lib/setup";
import { startHints } from "../../shell/hints";
import "./settings.css";

const listNames = (list: GameState[]) => {
  const n = list.map((g) => g.name);
  return n.length <= 1 ? n.join("") : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
};

/** Called once the games are known at start. With a game ready and no first start yet, says what was found (and the
 *  usage data note) in a toast, offers loaders for other games on this PC, and points at mods IMM keeps. */
export async function welcome(list: GameState[] = allGames()) {
  if ((await settings.get("onboarded").catch(() => null)) === "1") return;
  void settings.set("onboarded", "1").catch(() => {});
  startHints();
  const ready = list.filter((g) => g.modsDir && g.shown);
  if (ready.length) {
    toast(`Found ${listNames(ready)}. gachamod sends its developer anonymous usage counts and crash reports`, false,
      { label: "Turn those off", run: () => go({ view: "settings", section: "feedback" }) });
  }
  const more = list.filter(canInstallLoader);
  if (more.length) {
    toast(`${listNames(more)} ${more.length === 1 ? "is" : "are"} on this PC too, without a mod loader`, false,
      { label: "Install mod loaders", run: () => void installLoaders(more.map((g) => g.id)) });
  }
  imm.detect().then((info) => {
    const n = immMods(info);
    if (n) toast(`Integrated Mod Manager keeps ${plural(n, "mod")} in its own folders`, false, { label: "Move them", run: () => go({ view: "tools", section: "imm" }) });
  }).catch(() => {});
}

/** The setup was done from the page: no welcome toast, the page said it all. A first setup gets the hints. */
export async function setupDone() {
  if ((await settings.get("onboarded").catch(() => null)) === "1") return;
  void settings.set("onboarded", "1").catch(() => {});
  startHints();
}

const immMods = (i: ImmInfo | null) => (i?.found ? i.games.reduce((n, g) => n + g.mods, 0) : 0);

/** The main view while no game has a Mods folder. `looking`: the first search hasn't finished yet. */
export function SetupPage({ looking }: { looking: boolean }) {
  const all = useGames();
  const setup = useSetup();
  const [immInfo, setImm] = useState<ImmInfo | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { imm.detect().then(setImm).catch(() => {}); }, []);

  // keep looking while this page is open: every 10 seconds and when the window comes back to the front
  useEffect(() => {
    const look = () => { if (document.visibilityState === "visible") void recheck(true); };
    const t = window.setInterval(look, 10_000);
    window.addEventListener("focus", look);
    return () => { window.clearInterval(t); window.removeEventListener("focus", look); };
  }, []);

  if (looking) return <Waiting className="setup-page setup-wait" what="Looking for your games and XXMI Launcher" hold={HOLD.detect} />;

  const can = all.filter(canInstallLoader);
  const lookAgain = async () => {
    setBusy(true);
    const list = await recheck(true);
    setBusy(false);
    if (list && !list.some((g) => g.modsDir || canInstallLoader(g))) toast("Still no games. gachamod keeps looking while this page is open");
  };
  const n = immMods(immInfo);

  return (
    <div className="page setup-page">
      {can.length > 0 ? (
        <>
          <h1>Get your games ready for mods</h1>
          <div className="setup-games">
            {can.map((g) => (
              <span key={g.id} className="setup-game" title={g.gameDir ?? undefined}><GameBadge game={g} size={48} /><b>{g.name}</b></span>
            ))}
          </div>
          <p>One click installs XXMI Launcher and the mod loader for {listNames(can)}. It downloads about 65 MB from GitHub and takes a minute or two.</p>
          {setup.running ? <Installing /> : (
            <div className="row setup-go">
              <Button variant="primary" size="lg" icon="install" autoFocus onClick={() => void installLoaders(can.map((g) => g.id))}
                title="Downloads XXMI Launcher and each game's mod loader from their GitHub pages and sets them up in %APPDATA%\XXMI Launcher">
                Install mod loaders
              </Button>
            </div>
          )}
        </>
      ) : (
        <>
          <h1>No games found yet</h1>
          <p>gachamod looks in HoYoPlay, the Wuthering Waves launcher, GRYPHLINK, Steam and XXMI Launcher, and keeps looking while this page is open. Install a game and it shows up here.</p>
          <div className="row setup-go">
            <Button variant="primary" size="lg" icon="search" busy={busy} autoFocus onClick={() => void lookAgain()} title="Look for games and XXMI Launcher again">Look again</Button>
          </div>
        </>
      )}

      {n > 0 && (
        <div className="setup-note">
          <span>Integrated Mod Manager keeps {plural(n, "mod")} in its own folders. gachamod can move them into the normal Mods folders, keeping their options.</span>
          <Button size="sm" icon="swap" onClick={() => go({ view: "tools", section: "imm" })} title="Opens Tools, where you pick which games to move">Move them</Button>
        </div>
      )}

      <p className="hint setup-more">
        Mods already in a folder XXMI doesn't know, or a game XXMI doesn't support, like Punishing: Gray Raven?{" "}
        <button type="button" className="qlink" onClick={() => go({ view: "settings", section: "games" })} title="Settings, Games: every game with its folders">Settings, Games</button> has those.
      </p>
      <p className="hint setup-more">
        gachamod sends its developer anonymous usage counts and crash reports.{" "}
        <button type="button" className="qlink" onClick={() => go({ view: "settings", section: "feedback" })} title="Opens Settings, Feedback and data">Turn them off</button> any time.
      </p>
    </div>
  );
}

/** The install as it runs: the step, its download and a timer. */
export function Installing({ compact }: { compact?: boolean }) {
  const { step } = useSetup();
  const frac = step?.total ? step.done / step.total : null;
  const what = step ? `${step.step}${step.total ? ` (${formatBytes(step.done)} of ${formatBytes(step.total)})` : ""}` : "Starting the install";
  return (
    <div className={`setup-run${compact ? " is-compact" : ""}`}>
      <Progress value={frac} label={what} />
      <Waiting what={what} />
    </div>
  );
}
