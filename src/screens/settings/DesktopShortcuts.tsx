// Settings, General: the desktop shortcuts setup offers, made again here (gacha-core shortcuts.rs), and the
// Background panel. gachamod's shortcut opens it; quickstart's starts the game you had open last, with mods
// (screens/home/quickstart.ts), and opens gachamod too only when its switch here says so. Each game can have a
// quickstart of its own. Background: closing the window keeps gachamod in the tray or quits (src-tauri background.rs);
// Desktop shortcuts shows the same setting as what happens after playing. Owner: SYSTEM area.
import { useEffect, useState } from "react";
import { errorText, shortcuts, type ShortcutState } from "../../lib/api";
import { backgroundPref, quickstartOpensPref } from "../../lib/prefs";
import { useGame, useShownGames } from "../../lib/store";
import { gameName } from "../../lib/games";
import { t } from "../../lib/i18n";
import { Button, IconButton, Panel, Segmented, Toggle } from "../../ui/kit";
import { toast } from "../../ui/toast";
import { SetRow } from "./parts";

type After = "tray" | "quit";

export function DesktopShortcutsSection() {
  const game = useGame();
  const shown = useShownGames();
  const opens = quickstartOpensPref.use();
  const keep = backgroundPref.use();
  const [st, setSt] = useState<ShortcutState | null>(null);
  // "app", "quickstart" or a game's id
  const [busy, setBusy] = useState<string | null>(null);
  // read again when the window comes back, so one deleted from the desktop meanwhile shows as gone
  useEffect(() => {
    const read = () => { shortcuts.state().then(setSt).catch(() => {}); };
    read();
    window.addEventListener("focus", read);
    return () => window.removeEventListener("focus", read);
  }, []);

  // adding or removing one flips the row's button; replacing one changes nothing on screen, so only that says so
  const make = async (key: string, run: () => Promise<ShortcutState>, replacing = false) => {
    setBusy(key);
    try {
      setSt(await run());
      if (replacing) toast(t("Replaced the shortcut on the desktop"));
    } catch (e) { toast(errorText(e), true); } finally { setBusy(null); }
  };
  const remove = async (run: () => Promise<ShortcutState>) => {
    try { setSt(await run()); } catch (e) { toast(errorText(e), true); }
  };

  /** One shortcut: Add to desktop, or Recreate and remove when it's there. `key` marks it busy. */
  const row = (key: string, there: boolean, label: string, hint: string, id: string,
    add: () => Promise<ShortcutState>, take: () => Promise<ShortcutState>, tip?: string) => (
    <SetRow key={id} id={id} label={label} hint={hint} tip={tip}>
      <span className="set-admin">
        <Button size="sm" icon={there ? "refresh" : "plus"} busy={busy === key} disabled={!st} onClick={() => void make(key, add, there)}
          title={there ? t("Replace it with a new one, for when it stopped working or still opens an old copy") : t("Put it on the desktop")}>
          {there ? t("Recreate") : t("Add to desktop")}
        </Button>
        {there && <IconButton size="sm" icon="trash" label={t("Remove from the desktop")} onClick={() => void remove(take)} />}
      </span>
    </SetRow>
  );

  const after: After = keep ? "tray" : "quit";
  return (
    <Panel title={t("Desktop shortcuts")} icon="link" id="desktop-shortcuts">
      <div className="set-rows">
        {row("app", st?.app ?? false, "gachamod", t("Opens gachamod"), "set-shortcut-app", () => shortcuts.create("app"), () => shortcuts.remove("app"))}
        {row("quickstart", st?.quickstart ?? false, t("Quickstart"), game
          ? t("Starts the game you had open last, with mods. Now that's {game}", { game: gameName(game) })
          : t("Starts the game you had open last, with mods"), "set-shortcut-quickstart",
        () => shortcuts.create("quickstart"), () => shortcuts.remove("quickstart"), t("Its icon is that game's icon, with quickstart's in the corner"))}
        {shown.map((g) => row(g.id, st?.games.includes(g.id) ?? false, t("{game} quickstart", { game: gameName(g) }),
          t("Always starts {game}, with mods", { game: gameName(g) }), `set-shortcut-${g.id}`,
          () => shortcuts.createGame(g.id), () => shortcuts.removeGame(g.id)))}
        <SetRow id="set-quickstart-opens" label={t("Open gachamod with quickstart")} hint={t("When it's off, only the game opens and gachamod stays in the tray")}
          tip={t("The menu over the game and automatic reloads still work")}>
          <Toggle checked={opens} onChange={(v) => void quickstartOpensPref.set(v, v ? t("Quickstart opens gachamod too") : t("Quickstart opens only the game"))} />
        </SetRow>
        <SetRow id="set-quickstart-after" label={t("After playing")} hint={keep ? t("gachamod stays in the tray, using almost no memory") : t("gachamod quits when the game closes")}
          tip={t("The same setting as Keep running in the background, so closing gachamod's window does this too")}>
          <Segmented<After> value={after} label={t("After playing")}
            onChange={(v) => void backgroundPref.set(v === "tray", v === "tray" ? t("Closing gachamod leaves it in the tray") : t("Closing gachamod quits it"))}
            options={[{ value: "tray", label: t("Stay in the tray") }, { value: "quit", label: t("Quit gachamod") }]} />
        </SetRow>
      </div>
    </Panel>
  );
}

/** Closing the window: keep gachamod in the tray, or quit. The first close asks (shell/CloseAsk.tsx). */
export function BackgroundSection() {
  const keep = backgroundPref.use();
  return (
    <Panel title={t("Running in the background")} icon="power" id="background">
      <div className="set-rows">
        <SetRow id="set-background" label={t("Keep running in the background")} hint={t("Closing the window leaves gachamod in the tray, using almost no memory")}
          tip={t("Quickstart starts your game from the tray without opening gachamod, the menu over the game and automatic reloads keep working, and updates install while it waits. Right-click the tray icon to quit")}>
          <Toggle checked={keep} onChange={(v) => void backgroundPref.set(v, v ? t("Closing gachamod leaves it in the tray") : t("Closing gachamod quits it"))} />
        </SetRow>
      </div>
    </Panel>
  );
}
