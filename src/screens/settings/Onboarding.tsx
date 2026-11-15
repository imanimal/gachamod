// First start: look for games and XXMI, show what was found, offer XXMI or moving mods from IMM. Sets "onboarded".
// Owner: SETTINGS/AI area.
import { useEffect, useRef, useState } from "react";
import { Button, Card, Dialog, Progress, Spinner, Toggle, plural } from "../../ui/kit";
import { Icon } from "../../ui/Icon";
import { HOLD, STUCK_MS, seconds, useElapsed } from "../../lib/activity";
import { GameBadge } from "../../ui/GameBadge";
import { toast } from "../../ui/toast";
import { errorText, games, imm, settings, shell, xxmi, type GameState, type ImmInfo, type XxmiStatus } from "../../lib/api";
import { go, setGames, useGames } from "../../lib/store";
import { XXMI_RELEASES } from "./Settings";
import "./settings.css";

export function Onboarding({ onDone }: { onDone: () => void }) {
  const all = useGames();
  const [scanning, setScanning] = useState(true);
  const [steps, setSteps] = useState<Record<StepKey, StepState>>({ games: { at: "run" }, xxmi: { at: "run" }, imm: { at: "run" } });
  const [x, setX] = useState<XxmiStatus | null>(null);
  const [immInfo, setImm] = useState<ImmInfo | null>(null);
  const [since] = useState(Date.now);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  // three real searches, each shown with its own state; results that arrive after "Skip" still fill in
  useEffect(() => {
    const step = <T,>(key: StepKey, p: Promise<T>, use: (v: T) => void) => p.then((v) => {
      if (!live.current) return;
      use(v);
      setSteps((s) => ({ ...s, [key]: { at: "done" } }));
    }, (e) => { if (live.current) setSteps((s) => ({ ...s, [key]: { at: "fail", error: errorText(e) } })); });
    Promise.all([
      step("games", games.detect(), setGames),
      step("xxmi", xxmi.status(), setX),
      step("imm", imm.detect(), setImm),
      new Promise((r) => setTimeout(r, 600)),
    ]).finally(() => { if (live.current) setScanning(false); });
  }, []);

  const finish = (then?: () => void) => {
    settings.set("onboarded", "1").catch(() => {});
    onDone();
    then?.();
  };
  const show = async (g: GameState, v: boolean) => {
    try { setGames(await games.setShown(g.id, v)); } catch (e) { toast(errorText(e), true); }
  };

  const found = all.filter((g) => g.modsDir || g.installed);
  const immMods = immInfo?.found ? immInfo.games.reduce((n, g) => n + g.mods, 0) : 0;

  return (
    <Dialog title="Welcome to gachamod" icon="sparkle" size="lg" className="onboard" onClose={() => finish()} locked={scanning ? "Looking for games. Skip it to close" : undefined}
      footer={scanning ? <SkipButton since={since} onSkip={() => setScanning(false)} /> : <>
        <Button variant="ghost" onClick={() => finish(() => go({ view: "settings", section: "games" }))} title="Pick each game's folders yourself in Settings">Set folders by hand</Button>
        <Button variant="primary" autoFocus onClick={() => finish()}>Start</Button>
      </>}>
      {scanning ? (
        <div className="onboard-scan">
          <Progress value={Object.values(steps).filter((t) => t.at !== "run").length / 3} label="Looking for games" />
          <ul className="onboard-steps">
            {STEPS.map(([key, what, hold]) => <Step key={key} what={what} hold={hold} state={steps[key]} since={since} />)}
          </ul>
        </div>
      ) : (
        <>
          {Object.values(steps).some((t) => t.at !== "done") && (
            <ul className="onboard-steps">
              {STEPS.filter(([key]) => steps[key].at !== "done").map(([key, what, hold]) => <Step key={key} what={what} hold={hold} state={steps[key]} since={since} />)}
            </ul>
          )}
          <p>{found.length ? `Found ${plural(found.length, "game")}. Turn on the ones you play: they show in the sidebar, where you switch games. You can change this in Settings.`
            : "No games found yet. Install XXMI Launcher below, or pick a game's folders in Settings."}</p>
          {found.length > 0 && (
            <div className="onboard-games">
              {found.map((g) => (
                <Card key={g.id} className="onboard-game" selected={g.shown}>
                  <GameBadge game={g} size={40} />
                  <span className="onboard-game-t">
                    <b>{g.name}</b>
                    <span className="hint" title={g.modsDir ?? g.gameDir ?? ""}>
                      {g.modsDir ? `${plural(g.modCount, "mod")}${g.viaXxmi ? ` · ${g.importer} via XXMI` : ""}` : "Game found, no mod loader yet"}
                    </span>
                  </span>
                  <Toggle checked={g.shown} onChange={(v) => void show(g, v)} />
                </Card>
              ))}
            </div>
          )}
          {x && !x.found && (
            <Card className="onboard-card">
              <b>Get XXMI Launcher</b>
              <span className="hint">It loads mods into Genshin Impact, Star Rail, Zenless Zone Zero, Wuthering Waves, Honkai Impact 3rd and Endfield. Install it, open it once, then press Detect again in Settings.</span>
              <div className="row"><Button icon="external" onClick={() => shell.openUrl(XXMI_RELEASES).catch((e) => toast(errorText(e), true))} title="XXMI Launcher's releases on GitHub">Open the download page</Button></div>
            </Card>
          )}
          {immInfo?.found && immMods > 0 && (
            <Card className="onboard-card">
              <b>Integrated Mod Manager keeps {plural(immMods, "mod")} in its own folders</b>
              <span className="hint">gachamod can move them back into the normal Mods folders, keeping their options and GameBanana links, so both apps aren't fighting over them.</span>
              <div className="row"><Button icon="swap" onClick={() => finish(() => go({ view: "tools", section: "imm" }))} title="Opens Tools, where you pick which games to move">Move mods from IMM</Button></div>
            </Card>
          )}
          <p className="hint onboard-data">gachamod sends its developer anonymous counts of which screens and buttons get used, and crash reports.
            {" "}<button type="button" className="qlink" onClick={() => finish(() => go({ view: "settings", section: "feedback" }))}
              title="Opens Settings, Feedback and data">Turn them off</button> any time in Settings.</p>
        </>
      )}
    </Dialog>
  );
}

type StepKey = "games" | "xxmi" | "imm";
type StepState = { at: "run" | "done" } | { at: "fail"; error: string };
const STEPS: Array<[StepKey, string, string]> = [
  ["games", "Looking for games in XXMI Launcher, game launchers and Steam libraries", HOLD.detect],
  ["xxmi", "Reading XXMI Launcher's settings", HOLD.xxmi],
  ["imm", "Looking for Integrated Mod Manager", HOLD.disk],
];

/** One search: what it does, how long it's taken, and once it runs long, what could be holding it. */
function Step({ what, hold, state, since }: { what: string; hold: string; state: StepState; since: number }) {
  const s = useElapsed(since, state.at === "run");
  const long = state.at === "run" && s * 1000 >= STUCK_MS;
  return (
    <li className={`onboard-step is-${state.at}`}>
      {state.at === "run" ? <Spinner /> : <Icon name={state.at === "done" ? "check" : "warn"} />}
      <span className="onboard-step-t">
        <span>{what}{state.at === "run" && s >= 3 ? ` (${seconds(s)})` : ""}</span>
        {state.at === "fail" && <span className="hint">{state.error}</span>}
        {long && <span className="hint">Still going. {hold}</span>}
      </span>
    </li>
  );
}

/** After a few seconds, a way past a search that's hanging. What it finds later still shows. */
function SkipButton({ since, onSkip }: { since: number; onSkip: () => void }) {
  const s = useElapsed(since);
  if (s < 5) return null;
  return <Button variant="ghost" onClick={onSkip} title="Show what was found so far. Anything found later still shows up">Skip the search</Button>;
}
