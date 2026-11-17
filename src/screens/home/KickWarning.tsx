// The warning before Genshin Impact starts with mods through XXMI while the "Illegal tool detected" fix isn't done
// (lib/kickFix.ts). It mounts itself on first use, like ingame/TesterConfirm. Owner: HOME/PROFILES area.
import { useEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { Button, Dialog, Waiting } from "../../ui/kit";
import { toast } from "../../ui/toast";
import { errorText, launchConfig, type DllConfig, type LaunchConfig } from "../../lib/api";
import { GI_KICK_GUIDE, openKickGuide } from "../../lib/kickFix";
import { KickSteps } from "../tools/KickSteps";
import { gameName } from "../../lib/games";
import { t } from "../../lib/i18n";

/** play: start this once. done: the player did the fix, so start and stop warning. */
export type KickAnswer = "play" | "done" | "cancel";

let answer: ((a: KickAnswer) => void) | null = null;
let undone = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
let mounted = false;

/** Show the warning. `wasUndone`: the player did the fix before, but XXMI's own d3d11.dll is back. */
export function askKick(wasUndone: boolean): Promise<KickAnswer> {
  if (!mounted) {
    mounted = true;
    const el = document.createElement("div");
    el.className = "kick-warning";
    document.body.appendChild(el);
    createRoot(el).render(<Host />);
  }
  answer?.("cancel");
  undone = wasUndone;
  return new Promise((resolve) => { answer = resolve; emit(); });
}

const done = (a: KickAnswer) => { const f = answer; answer = null; emit(); f?.(a); };

function Host() {
  const open = useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => answer !== null);
  if (!open) return null;
  const gi = gameName({ name: "Genshin Impact" });
  return (
    <Dialog title={t("Before you play {game}", { game: gi })} icon="warn" size="md" onClose={() => done("cancel")} footer={<>
      <Button variant="ghost" onClick={() => done("cancel")}>{t("Cancel")}</Button>
      <Button onClick={() => done("done")} title={t("Start the game and stop warning, until XXMI puts its own d3d11.dll back")}>{t("I did the fix")}</Button>
      <Button variant="primary" autoFocus onClick={() => done("play")} title={t("Start the game. gachamod warns again next time")}>{t("Play anyway")}</Button>
    </>}>
      {undone ? (
        <p>
          {t("You did the fix before, but XXMI has put its own d3d11.dll back, most likely in an update. {game}'s anti-cheat flags that one and can stop the game with \"Illegal tool detected\" (10612-4001).", { game: gi })}
        </p>
      ) : (
        <p>
          {t("{game}'s anti-cheat flags the d3d11.dll that XXMI loads mods with. It can stop the game with \"Illegal tool detected\" (10612-4001) and flag your account.", { game: gi })}
        </p>
      )}
      <p>{t("A GameBanana guide shows a fix you do by hand. That fix goes against the game's terms too.")}</p>
      <p>
        <Button size="sm" variant="ghost" icon="external" onClick={openKickGuide} title={t("Open {url} in your browser", { url: GI_KICK_GUIDE })}>{t("Open the guide")}</Button>
      </p>
      <GuideSteps />
    </Dialog>
  );
}

/** The guide's steps (tools/KickSteps.tsx) with XXMI's settings for Genshin Impact. Each change saves at once. */
function GuideSteps() {
  const [cfg, setCfg] = useState<LaunchConfig | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let on = true;
    const read = () => launchConfig.get("gi").then((c) => { if (on) setCfg(c); });
    read().catch(() => { if (on) setFailed(true); });
    // back from XXMI Launcher (Unsafe Mode) or the GIMI folder: show what changed
    const back = () => { void read().catch(() => undefined); };
    window.addEventListener("focus", back);
    return () => { on = false; window.removeEventListener("focus", back); };
  }, []);
  if (failed) return null;
  if (!cfg) return <Waiting what={t("Reading XXMI's settings")} />;
  if (!cfg.dll || cfg.via !== "xxmi") return null;

  const change = (d: Partial<DllConfig>) => {
    const before = cfg;
    const next = { ...cfg, dll: { ...cfg.dll!, ...d } };
    setCfg(next);
    launchConfig.set("gi", next).then(setCfg).catch((e) => { setCfg(before); toast(errorText(e), true); });
  };
  return <><h3 className="sub-h">{t("Steps from the guide")}</h3><KickSteps dll={cfg.dll} locked={cfg.locked} onChange={change} /></>;
}
