// The first start, without a welcome window. When XXMI Launcher already has a game ready, the app opens straight to
// it and one toast says what was found. When no game is ready, the main view is this page: the games found on this
// PC and one button that installs XXMI Launcher and their mod loaders (lib/setup.ts). It keeps looking for games while
// it's open, so a game installed meanwhile shows up by itself. Both ways offer the Mods layouts (FormatPicker.tsx), with
// the one resembling a mod manager found on this PC already picked. Sets "onboarded". Owner: SETTINGS/AI area.
import { useEffect, useState, useSyncExternalStore } from "react";
import { Button, Progress, Waiting, formatBytes } from "../../ui/kit";
import { GameBadge } from "../../ui/GameBadge";
import { toast } from "../../ui/toast";
import { HOLD } from "../../lib/activity";
import { imm, otherManagers, settings, type GameState } from "../../lib/api";
import { findOtherManagers } from "../../lib/otherManagers";
import { layoutPick, setModsFormat, type ModsFormat } from "../../lib/theme";
import { FormatPicker } from "./FormatPicker";
import { allGames, go, useGames } from "../../lib/store";
import { canInstallLoader, installLoaders, recheck, useSetup } from "../../lib/setup";
import { startHints } from "../../shell/hints";
import { oxford } from "../../lib/notes";
import { t, tb, tn, tx } from "../../lib/i18n";
import { gameName } from "../../lib/games";
import "./settings.css";

const listNames = (list: GameState[]) => oxford(list.map((g) => gameName(g)), 12);

/** Called once the games are known at start. With a game ready and no first start yet, says what was found (and the
 *  usage data note) in a toast, offers loaders for other games on this PC, and points at mods IMM keeps. */
export async function welcome(list: GameState[] = allGames()) {
  if ((await settings.get("onboarded").catch(() => null)) === "1") return;
  void settings.set("onboarded", "1").catch(() => {});
  startHints();
  const ready = list.filter((g) => g.modsDir && g.shown);
  if (ready.length) {
    toast(t("Found {games}. gachamod sends its developer anonymous usage counts and crash reports", { games: listNames(ready) }), false,
      { label: t("Turn those off"), run: () => go({ view: "settings", section: "privacy" }) });
  }
  const more = list.filter(canInstallLoader);
  if (more.length) {
    toast(tn(more.length, "{games} is on this PC too, without a mod loader", "{games} are on this PC too, without a mod loader", { games: listNames(more) }), false,
      { label: t("Install mod loaders"), run: () => void installLoaders(more.map((g) => g.id)) });
  }
  void offerFormat(list);
  findOtherManagers(list).then((names) => {
    if (names.length) toast(t("Found mods from {managers}", { managers: oxford(names) }), false, { label: t("Bring them in"), run: () => go({ view: "tools", section: "others" }) });
  }).catch(() => {});
}

/** The setup was done from the page: no welcome toast, the page said it all. A first setup gets the hints. */
export async function setupDone() {
  if ((await settings.get("onboarded").catch(() => null)) === "1") return;
  void settings.set("onboarded", "1").catch(() => {});
  startHints();
}

// ── the Mods layout at the first start ──

/** Managers whose look a layout copies, by the name managers.rs gives them. */
const MANAGER_FORMAT: Record<string, ModsFormat> = { JASM: "chars", "XX Mod Manager": "panes" };

/** The layout resembling a mod manager on this PC: Integrated Mod Manager's folders, or JASM's or XX Mod Manager's
 *  files next to the mods of a game that has a Mods folder. */
async function managerFormat(list: GameState[]): Promise<{ format: ModsFormat; manager: string } | null> {
  const info = await imm.detect().catch(() => null);
  if (info?.found) return { format: "panes", manager: "Integrated Mod Manager" };
  for (const g of list.filter((x) => x.modsDir)) {
    const found = await otherManagers.detect(g.id).catch(() => null);
    const hit = found?.managers.find((m) => MANAGER_FORMAT[m.manager]);
    if (hit) return { format: MANAGER_FORMAT[hit.manager]!, manager: hit.manager };
  }
  return null;
}

/** Picks the layout resembling a manager found, unless one was picked already. Returns that manager's name. */
async function pickFromManager(list: GameState[]): Promise<string | null> {
  const hit = await managerFormat(list);
  if (!hit || layoutPick().format !== "cards") return null;
  setModsFormat(hit.format);
  return hit.manager;
}

// the card offered at the first start, while it shows: the manager its layout was picked for, if any
let offer: { manager: string | null } | null = null;
const offerSubs = new Set<() => void>();
const setOffer = (v: typeof offer) => { offer = v; offerSubs.forEach((f) => f()); };

async function offerFormat(list: GameState[]) {
  // a layout already picked (settings brought from another PC) says enough
  if (layoutPick().format !== "cards") return;
  setOffer({ manager: await pickFromManager(list) });
}

/** A small card at the first start, bottom right (not a window): the Mods layouts, with the one resembling a mod manager
 *  found on this PC already picked. A pick applies at once, so they can be tried in turn; Done closes it. */
export function FormatIntro() {
  const now = useSyncExternalStore((f) => { offerSubs.add(f); return () => { offerSubs.delete(f); }; }, () => offer);
  if (!now) return null;
  return (
    <aside className="fmt-intro" aria-label={t("Mods layout")}>
      <b>{t("Pick how Mods looks")}</b>
      <p className="hint">{now.manager
        ? t("Mods is laid out like {manager} now, since {manager} is on this PC. Every layout has the same features", { manager: now.manager })
        : t("Coming from another mod manager? Pick the layout you know. Every layout has the same features")}</p>
      <FormatPicker className="is-small" />
      <div className="row fmt-intro-a">
        <span className="hint grow">{t("You can change this in Settings, Appearance")}</span>
        <Button size="sm" variant="ghost" icon="settings" onClick={() => { setOffer(null); go({ view: "settings", section: "set-format" }); }}
          title={t("Opens Settings, Appearance at the Mods layout")}>{t("Appearance settings")}</Button>
        <Button size="sm" variant="primary" onClick={() => setOffer(null)} title={t("Keep this layout and close the card")}>{t("Done")}</Button>
      </div>
    </aside>
  );
}

/** The layouts on the setup page, with the one resembling a manager found already picked. */
function SetupFormat() {
  const all = useGames();
  const [manager, setManager] = useState<string | null>(null);
  // once, when the page opens
  useEffect(() => { void pickFromManager(all).then(setManager); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="setup-format">
      <h2>{t("How should Mods look?")}</h2>
      <FormatPicker />
      <p className="hint setup-more">
        {manager && <>{t("Picked to look like {manager}, which is on this PC.", { manager })} </>}
        {tx("You can change this in {link}.", {
          link: <button type="button" className="qlink" onClick={() => go({ view: "settings", section: "set-format" })} title={t("Opens Settings, Appearance at the Mods layout")}>{t("Settings, Appearance")}</button>,
        })}
      </p>
    </section>
  );
}

/** The main view while no game has a Mods folder. `looking`: the first search hasn't finished yet. `error`: reading
 *  the games failed at start, and `retry` reads them again. */
export function SetupPage({ looking, error, retry }: { looking: boolean; error?: string | null; retry?: () => Promise<void> }) {
  const all = useGames();
  const setup = useSetup();
  const [managers, setManagers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const ready = all.filter((g) => g.modsDir).map((g) => g.id).join();
  useEffect(() => { findOtherManagers(allGames()).then(setManagers).catch(() => {}); }, [ready]);

  // keep looking while this page is open: every 10 seconds and when the window comes back to the front
  useEffect(() => {
    const look = () => { if (document.visibilityState === "visible") void recheck(true); };
    const timer = window.setInterval(look, 10_000);
    window.addEventListener("focus", look);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", look); };
  }, []);

  if (looking) return <Waiting className="setup-page setup-wait" what={t("Looking for your games and XXMI Launcher")} hold={HOLD.detect} />;

  const can = all.filter(canInstallLoader);
  const lookAgain = async () => {
    setBusy(true);
    const list = await recheck(true);
    setBusy(false);
    if (list && !list.some((g) => g.modsDir || canInstallLoader(g))) toast(t("Still no games. gachamod keeps looking while this page is open"), "info");
  };
  const tryAgain = async () => {
    if (!retry) return;
    setRetrying(true);
    try { await retry(); } finally { setRetrying(false); }
  };
  const install = () => void installLoaders(can.map((g) => g.id));

  return (
    <div className="page setup-page">
      {error && can.length === 0 ? (
        <>
          <h1>{t("Couldn't read your games")}</h1>
          <p>{t("gachamod couldn't read its list of games when it started. Your mods and files weren't touched.")}</p>
          <pre className="crash-msg">{error}</pre>
          <div className="row setup-go">
            <Button variant="primary" size="lg" icon="refresh" busy={retrying} autoFocus onClick={() => void tryAgain()} title={t("Read the saved games again")}>{t("Try again")}</Button>
            <Button size="lg" icon="search" busy={busy} onClick={() => void lookAgain()} title={t("Look for games and XXMI Launcher again")}>{t("Look again")}</Button>
          </div>
        </>
      ) : can.length > 0 ? (
        <>
          <h1>{t("Get your games ready for mods")}</h1>
          <div className="setup-games">
            {can.map((g) => (
              <span key={g.id} className="setup-game" title={g.gameDir ?? undefined}><GameBadge game={g} size={48} /><b>{gameName(g)}</b></span>
            ))}
          </div>
          <p>{t("One click installs XXMI Launcher and the mod loader for {games}. It downloads about 65 MB from GitHub and takes a minute or two.", { games: listNames(can) })}</p>
          {setup.running ? <Installing /> : (
            <>
              {setup.error && <SetupError error={setup.error} />}
              <div className="row setup-go">
                <Button variant="primary" size="lg" icon={setup.error ? "refresh" : "install"} autoFocus onClick={install}
                  title={t("Downloads XXMI Launcher and each game's mod loader from their GitHub pages and sets them up in {folder}", { folder: "%APPDATA%\\XXMI Launcher" })}>
                  {setup.error ? t("Try again") : t("Install mod loaders")}
                </Button>
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <h1>{t("No games found yet")}</h1>
          <p>{t("gachamod looks in HoYoPlay, the Wuthering Waves launcher, GRYPHLINK, Steam and XXMI Launcher, and keeps looking while this page is open. Install a game and it shows up here.")}</p>
          <div className="row setup-go">
            <Button variant="primary" size="lg" icon="search" busy={busy} autoFocus onClick={() => void lookAgain()} title={t("Look for games and XXMI Launcher again")}>{t("Look again")}</Button>
          </div>
        </>
      )}

      <SetupFormat />

      {managers.length > 0 && (
        <div className="setup-note">
          <span>{t("Found mods from {managers}. gachamod can bring them in with their on or off state, options and presets.", { managers: oxford(managers) })}</span>
          <Button size="sm" icon="swap" onClick={() => go({ view: "tools", section: "others" })} title={t("Opens Tools, Sharing, with a button for each manager")}>{t("Bring them in")}</Button>
        </div>
      )}

      <p className="hint setup-more">
        {tx("Mods already in a folder XXMI doesn't know, or a game XXMI doesn't support, like Punishing: Gray Raven? {link} has those.", {
          link: <button type="button" className="qlink" onClick={() => go({ view: "settings", section: "games" })} title={t("Settings, Games: every game with its folders")}>{t("Settings, Games")}</button>,
        })}
      </p>
      <p className="hint setup-more">
        {tx("gachamod sends its developer anonymous usage counts and crash reports. {link} any time.", {
          link: <button type="button" className="qlink" onClick={() => go({ view: "settings", section: "privacy" })} title={t("Opens Settings, Feedback")}>{t("Turn them off")}</button>,
        })}
      </p>
    </div>
  );
}

/** Why the last mod loader install failed, under its button (the setup page and Settings, Games). */
export function SetupError({ error }: { error: string }) {
  return (
    <div className="setup-err" role="alert">
      <p>{t("Couldn't install the mod loaders.")}</p>
      <pre className="crash-msg">{error}</pre>
    </div>
  );
}

/** The install as it runs: the step, its download and a timer. */
export function Installing({ compact }: { compact?: boolean }) {
  const { step } = useSetup();
  const frac = step?.total ? step.done / step.total : null;
  const what = !step ? t("Starting the install") : step.total ? t("{step} ({done} of {total})", { step: tb(step.step), done: formatBytes(step.done), total: formatBytes(step.total) }) : tb(step.step);
  return (
    <div className={`setup-run${compact ? " is-compact" : ""}`}>
      <Progress value={frac} label={what} />
      <Waiting what={what} />
    </div>
  );
}
