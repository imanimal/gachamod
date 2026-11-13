// First start: look for games and XXMI, show what was found, offer XXMI or moving mods from IMM. Sets "onboarded".
// Owner: SYSTEM area.
import { useEffect, useRef, useState } from "react";
import { Button, Card, Dialog, Progress, Toggle, plural } from "../../ui/kit";
import { GameBadge } from "../../ui/GameBadge";
import { toast } from "../../ui/toast";
import { errorText, games, imm, settings, shell, xxmi, type GameState, type ImmInfo, type XxmiStatus } from "../../lib/api";
import { go, setGames, useGames } from "../../lib/store";
import { XXMI_RELEASES } from "./Settings";
import "./settings.css";

export function Onboarding({ onDone }: { onDone: () => void }) {
  const all = useGames();
  const [scanning, setScanning] = useState(true);
  const [step, setStep] = useState(0);
  const [x, setX] = useState<XxmiStatus | null>(null);
  const [immInfo, setImm] = useState<ImmInfo | null>(null);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  useEffect(() => {
    const steps = window.setInterval(() => setStep((s) => Math.min(s + 1, 3)), 350);
    const minWait = new Promise((r) => setTimeout(r, 1400));
    Promise.all([
      games.detect().then((l) => { if (live.current) setGames(l); }).catch((e) => toast(errorText(e), true)),
      xxmi.status().then((s) => { if (live.current) setX(s); }).catch(() => {}),
      imm.detect().then((i) => { if (live.current) setImm(i); }).catch(() => {}),
      minWait,
    ]).finally(() => { window.clearInterval(steps); if (live.current) setScanning(false); });
    return () => window.clearInterval(steps);
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
  const what = ["Reading XXMI Launcher's settings", "Checking game launchers", "Looking through Steam", "Counting mods"];

  return (
    <Dialog title="Welcome to gachamod" icon="sparkle" size="lg" className="onboard" onClose={() => finish()} locked={scanning ? "Looking for games" : undefined}
      footer={!scanning && <>
        <Button variant="ghost" onClick={() => finish(() => go({ view: "settings", section: "games" }))}>Set folders by hand</Button>
        <Button variant="primary" autoFocus onClick={() => finish()}>Start</Button>
      </>}>
      {scanning ? (
        <div className="onboard-scan">
          <Progress value={(step + 1) / 4} label="Looking for games" />
          <p>{what[step]}…</p>
        </div>
      ) : (
        <>
          <p>{found.length ? `Found ${plural(found.length, "game")}. Pick the ones to show in the rail; you can change this in Settings later.`
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
              <div className="row"><Button icon="external" onClick={() => shell.openUrl(XXMI_RELEASES).catch((e) => toast(errorText(e), true))}>Open the download page</Button></div>
            </Card>
          )}
          {immInfo?.found && immMods > 0 && (
            <Card className="onboard-card">
              <b>Integrated Mod Manager keeps {plural(immMods, "mod")} in its own folders</b>
              <span className="hint">gachamod can move them back into the normal Mods folders, keeping their options and GameBanana links, so both apps aren't fighting over them.</span>
              <div className="row"><Button icon="swap" onClick={() => finish(() => go({ view: "tools", section: "imm" }))}>Move mods from IMM</Button></div>
            </Card>
          )}
        </>
      )}
    </Dialog>
  );
}
