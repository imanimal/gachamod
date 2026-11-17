// Settings other areas read: everything the app does by itself (each can be turned off) and how long removed mods
// keep their files. Live prefs (lib/prefs.ts): change one in Settings and every reader sees it at once.
// Owner: SETTINGS/AI area.
import { pref } from "../../lib/prefs";

const flag = (key: string, fallback: boolean) =>
  pref<boolean>(key, fallback, (r) => (r === "1" ? true : r === "0" ? false : undefined), (v) => (v ? "1" : "0"));

/** What gachamod does about its own new versions, looking at start and every 6 hours (src-tauri commands/app.rs
 *  reads the same key): "1" downloads them and installs at quit, "tell" only says one is out, "0" never looks. */
export type AppUpdateMode = "1" | "tell" | "0";
export const appUpdateModePref = pref<AppUpdateMode>("app.updateCheck", "1", (r) => (r === "1" || r === "tell" || r === "0" ? r : undefined), (v) => v);
/** Look up installed GameBanana mods for updates when Mods opens and every 30 minutes. */
export const modUpdateCheckPref = flag("updates.check", true);
/** Read the Mods folder again when Mods opens, so files added by hand show up. While watching is on, only the first
 *  time each session. */
export const autoRescanPref = flag("library.autoScan", true);
/** Watch each game's Mods folder and rescan it when something changes there (the backend's gacha_core::watch reads
 *  "library.watch"), so a mod added, renamed or deleted in Explorer shows up at once. */
export const watchModsPref = flag("library.watch", true);
/** Keep the downloaded .zip/.7z after installing (the downloader reads "downloads.keep"). Off deletes them. */
export const keepArchivesPref = flag("downloads.keep", false);
/** An archive that holds several mods installs all of them as one mod without asking (the downloader reads
 *  "downloads.allParts"). Off shows the picker. */
export const installAllPartsPref = flag("downloads.allParts", false);
/** A GameBanana download under 1 MB/s for 8 seconds carries on from another of GameBanana's file servers (the
 *  downloader reads "downloads.otherServers"). Off, it stays on the server GameBanana picked. */
export const otherServersPref = flag("downloads.otherServers", true);
/** A mod turns on as soon as it installs (screens/library/afterInstall.ts). Its character's other skin goes off, by
 *  the "<game>.oneSkin" rule. Off, new mods wait in Mods, turned off. */
export const enableNewPref = flag("mods.enableNew", true);
/** A download whose files gachamod couldn't place (no .ini, nothing that says where they go) goes in Mods as it came;
 *  this asks to look at them (App.tsx). Off, the Downloads row still says so. */
export const reviewUnsurePref = flag("downloads.reviewUnsure", true);
/** Look on GameBanana for new fixer tools (Tools > Fixes lists them; nothing is downloaded). */
export const fixesAutoUpdatePref = flag("fixes.autoUpdate", true);

/** Days removed mods keep their files in the app's trash (backend setting "trash.days", 0 to 3650, default 0).
 *  0 deletes the files right away; a short record with the GameBanana link always stays in Mods, Trash. */
export const trashDaysPref = pref<number>("trash.days", 0,
  (r) => { const n = Number.parseInt(r, 10); return Number.isFinite(n) ? Math.max(0, Math.min(3650, n)) : undefined; }, (v) => String(v));
export const useTrashDays = () => trashDaysPref.use();
