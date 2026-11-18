// What gachamod is waiting on right now. Every backend call and GameBanana request is noted here with what it does
// and what can hold it up, so a wait is never a blank spinner: the title bar names anything that takes longer than a
// moment (shell/Activity.tsx) and the kit's Waiting says why it may be stuck once it runs long. Owner: SHELL area.
import { useEffect, useState, useSyncExternalStore } from "react";
import { t } from "./i18n";

export interface Task {
  id: number;
  /** What it does, as a short sentence: "Reading the Mods folder". */
  what: string;
  /** What can hold it up, shown once it runs long. */
  hold: string;
  started: number;
}

/** A wait shorter than this never shows in the title bar. */
export const SLOW_MS = 1200;
/** Past this, a wait says what could be holding it. */
export const STUCK_MS = 10_000;

const tasks = new Map<number, Task>();
let list: Task[] = [];
let n = 0;
const subs = new Set<() => void>();
let queued = false;
// after the current task, since a call can start while a component renders and React can't update another then
const changed = () => {
  if (queued) return;
  queued = true;
  queueMicrotask(() => { queued = false; list = [...tasks.values()].sort((a, b) => a.started - b.started); subs.forEach((f) => f()); });
};

/** Note a wait; the function it returns ends it. */
export function begin(what: string, hold: string): () => void {
  const id = ++n;
  tasks.set(id, { id, what, hold, started: Date.now() });
  changed();
  return () => { if (tasks.delete(id)) changed(); };
}

/** Note a wait for as long as `p` runs. */
export function track<T>(p: Promise<T>, what: string, hold: string): Promise<T> {
  const end = begin(what, hold);
  return p.finally(end);
}

/** Everything running now, oldest first. Re-renders each second while anything runs, so elapsed times stay current. */
export function useActivity(): Task[] {
  const now = useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => list);
  useTick(now.length > 0);
  return now;
}

/** Seconds since `since`, updated each second while `on`. */
export function useElapsed(since: number, on = true): number {
  useTick(on);
  return Math.floor((Date.now() - since) / 1000);
}

function useTick(on: boolean) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return;
    const timer = window.setInterval(() => set((x) => x + 1), 1000);
    return () => window.clearInterval(timer);
  }, [on]);
}

export function seconds(s: number): string {
  return s < 60 ? t("{s}s", { s }) : t("{m}m {s}s", { m: Math.floor(s / 60), s: String(s % 60).padStart(2, "0") });
}

// ── what each backend command does, and what can hold it ──

export const HOLD = {
  disk: t("This reads and writes files on disk. A cloud-synced folder (OneDrive, Google Drive) still fetching files, an antivirus scan, or a sleeping external drive can hold it."),
  db: t("This waits on gachamod's database. Another task that is saving a lot (a mod scan, a big install) holds it until it's done."),
  gb: t("This waits on GameBanana. A slow or dropped connection, a VPN, or GameBanana being down can hold it. It gives up after 30 seconds without an answer."),
  github: t("This waits on GitHub. A slow or dropped connection or a VPN can hold it. It gives up after 30 seconds without an answer."),
  web: t("This waits on a website. A slow or dropped connection or a VPN can hold it. It gives up after 30 seconds without an answer."),
  detect: t("This looks through XXMI Launcher, game launchers and every Steam library. A disconnected network drive or a sleeping USB drive listed as a Steam library can hold it."),
  xxmi: t("This reads or starts XXMI Launcher. An XXMI Launcher window waiting for an answer (an update, an installer, an error) can hold it. Check the taskbar for one."),
  game: t("This starts the game. A launcher window waiting for an answer (an update, a login, an error) can hold it. Check the taskbar for one."),
  archive: t("This unpacks or packs an archive. A big archive on a slow drive takes a while, and an antivirus scanning each file slows it more."),
  dialog: t("This waits on a window that asks you something. Look for it behind gachamod or on another screen."),
} as const;

type Desc = [what: string, hold: string];
const EXACT: Record<string, Desc> = {
  games_detect: [t("Looking for games and XXMI Launcher"), HOLD.detect],
  games_list: [t("Reading your games"), HOLD.db],
  dev_wipe_user_config: [t("Resetting saved mod options"), HOLD.disk],
  dev_unwipe_user_config: [t("Putting back saved mod options"), HOLD.disk],
  game: [t("Reading this game's setup"), HOLD.db],
  game_launch: [t("Starting the game"), t("This starts the game. A Steam copy first waits up to 90 seconds for Steam to start and sign in, and Steam may close and start again to take the game's launch options. A Steam or launcher window waiting for an answer (a sign-in, an update, an error) can hold it. Check the taskbar for one.")],
  game_running: [t("Checking if the game runs"), HOLD.game],
  game_kick_check: [t("Checking Genshin Impact's d3d11.dll"), HOLD.disk],
  launch_unsafe_off: [t("Turning off Unsafe Mode in XXMI's settings"), HOLD.disk],
  game_kick_fix_done: [t("Saving that you did the fix"), HOLD.db],
  game_set_paths: [t("Saving the game's folders"), HOLD.disk],
  xxmi_status: [t("Reading XXMI Launcher's settings"), HOLD.xxmi],
  xxmi_open: [t("Opening XXMI Launcher"), HOLD.xxmi],
  xxmi_install: [t("Installing XXMI Launcher and the mod loaders"), t("This downloads about 65 MB from GitHub and unpacks it into XXMI Launcher's folder. A slow connection, a VPN or an antivirus scanning the new files can hold it.")],
  imm_detect: [t("Looking for Integrated Mod Manager"), HOLD.disk],
  imm_takeover: [t("Moving mods out of Integrated Mod Manager"), HOLD.disk],
  migrate_detect: [t("Looking for other mod managers"), HOLD.disk],
  migrate_import: [t("Bringing in mods from the other manager"), HOLD.disk],
  migrate_undo: [t("Putting the other manager's mods back"), HOLD.disk],
  nrmm_detect: [t("Looking for No Reload Mod Manager"), HOLD.disk],
  nrmm_takeover: [t("Moving mods out of No Reload Mod Manager"), HOLD.disk],
  merged_split: [t("Splitting the merged mod"), HOLD.disk],
  library_scan: [t("Reading the Mods folder"), HOLD.disk],
  library_list: [t("Reading your mods"), HOLD.db],
  conflicts_scan: [t("Looking for mods that clash"), HOLD.disk],
  lint_scan: [t("Checking mod files for problems"), HOLD.disk],
  install_local: [t("Installing from a file"), HOLD.archive],
  pack_import: [t("Unpacking a .gachamod file"), HOLD.archive],
  pack_export: [t("Packing a .gachamod file"), HOLD.archive],
  pack_inspect: [t("Reading a .gachamod file"), HOLD.archive],
  pack_plan: [t("Working out what goes in the pack"), HOLD.disk],
  mods_merge: [t("Merging mods"), HOLD.disk],
  mods_remove: [t("Moving mods to the trash"), HOLD.disk],
  mods_overlapping: [t("Checking which mods change the same parts"), HOLD.disk],
  mod_mesh: [t("Reading the model"), HOLD.disk],
  mod_fetch_preview: [t("Downloading a preview"), HOLD.gb],
  hash_lookup: [t("Matching mods with GameBanana"), HOLD.gb],
  owned_fetch: [t("Reading your characters online"), HOLD.web],
  characters_sync: [t("Saving the character list"), HOLD.db],
  app_update_check: [t("Checking for a gachamod update"), HOLD.github],
  app_update_install: [t("Downloading the gachamod update"), HOLD.github],
  app_update_status: [t("Reading the update status"), HOLD.db],
  extensions_repos: [t("Reading extension lists"), HOLD.github],
  extensions_fetch: [t("Reading an extension list"), HOLD.github],
  extensions_install: [t("Installing an extension"), HOLD.github],
  fixers_download: [t("Downloading a fix tool"), HOLD.github],
  fixers_github: [t("Downloading a fix tool from GitHub"), HOLD.github],
  fixers_run_all: [t("Watching what the fixer changes"), t("The fixer opened in a separate window. Run it there. gachamod carries on a few seconds after it stops changing files, or when you choose Stop waiting. The window can stay open.")],
  fixers_run: [t("Running the fixer on the mod"), t("A fixer that opens a window waits until you close it. One that waits for a key press is stopped after 2 minutes.")],
  xxmi_uninstall: [t("Uninstalling the mod loaders"), t("This moves files to the Recycle Bin. A game or XXMI Launcher that has the files open can hold it.")],
  app_reset: [t("Getting ready to start over"), HOLD.disk],
  app_relaunch: [t("Restarting gachamod"), HOLD.disk],
  setup_game: [t("Reading what setup left"), HOLD.disk],
  fixes_apply: [t("Updating mods for the new game version"), HOLD.disk],
  settings_import: [t("Bringing in settings"), HOLD.disk],
  settings_export: [t("Saving your settings to a file"), HOLD.disk],
  trash_purge: [t("Emptying the trash"), HOLD.disk],
  storage_measure: [t("Measuring disk space"), t("This adds up the size of every file in the Mods folders, the trash, downloads, backups and loader folders. A big library on a slow or sleeping drive takes a while. Skip shows what's measured so far.")],
  storage_cancel: [t("Stopping the measure"), HOLD.disk],
  storage_remove_copies: [t("Moving copies to the trash"), HOLD.disk],
  storage_recycle_archives: [t("Moving archives to the Recycle Bin"), t("This moves files to the Recycle Bin. A download or an antivirus scan that has the files open can hold it.")],
  profile_activate: [t("Switching profile"), HOLD.disk],
  ai_chatbots_installed: [t("Looking for AI apps"), HOLD.disk],
  feedback_send: [t("Sending your feedback"), HOLD.web],
  admin_set_always: [t("Changing how gachamod starts"), HOLD.disk],
  app_restart_admin: [t("Waiting for Windows to allow administrator"), HOLD.dialog],
  game_check_send: [t("Sending the check's results"), HOLD.web],
  setup_available: [t("Looking for gachamod setup"), HOLD.disk],
  setup_open: [t("Opening gachamod setup"), HOLD.disk],
};
/** By prefix, for everything not named above. */
const PREFIX: Array<[string, Desc]> = [
  ["settings_", [t("Reading settings"), HOLD.db]],
  ["gb_like", [t("Sending your like to GameBanana"), HOLD.gb]],
  ["gb_subscribe", [t("Subscribing on GameBanana"), HOLD.gb]],
  ["gb_thank", [t("Sending your thanks to GameBanana"), HOLD.gb]],
  ["gb_", [t("Waiting on GameBanana"), HOLD.gb]],
  ["queue_", [t("Updating the download list"), HOLD.db]],
  ["extensions_", [t("Working on extensions"), HOLD.disk]],
  ["owned_", [t("Reading your characters"), HOLD.db]],
  ["characters", [t("Reading the character list"), HOLD.db]],
  ["profile", [t("Working on profiles"), HOLD.disk]],
  ["keys_", [t("Reading mod keys"), HOLD.disk]],
  ["keylist_set", [t("Saving the key list settings"), HOLD.disk]],
  ["keylist_choose", [t("Saving which mods the key list shows"), HOLD.db]],
  ["keylist_choose_many", [t("Saving which mods the key list shows"), HOLD.db]],
  ["keylist_", [t("Reading mod keys"), HOLD.disk]],
  ["otherkeys_move", [t("Changing gachamod's key"), HOLD.disk]],
  ["otherkeys_change", [t("Changing the other app's key"), t("This writes one value in the other app's settings, after a copy of them. The app still closing, or an antivirus scan, can hold it.")]],
  ["otherkeys_keep", [t("Saving which key stays"), HOLD.db]],
  ["otherkeys_", [t("Reading other apps' keys"), HOLD.disk]],
  ["live_", [t("Talking to the running game"), HOLD.disk]],
  ["overlay_", [t("Updating the in-game menu"), HOLD.disk]],
  ["mod_", [t("Working on a mod"), HOLD.disk]],
  ["mods", [t("Working on mods"), HOLD.disk]],
  ["library_", [t("Working on your mods"), HOLD.disk]],
  ["trash_", [t("Reading the trash"), HOLD.disk]],
  ["backup_", [t("Restoring files"), HOLD.disk]],
  ["archive_", [t("Reading downloaded archives"), HOLD.disk]],
  ["foreign_", [t("Reading another mod manager's files"), HOLD.disk]],
  ["fixes_", [t("Checking mods against the game version"), HOLD.disk]],
  ["fixers_", [t("Reading fix tools"), HOLD.disk]],
  ["lint_", [t("Fixing mod files"), HOLD.disk]],
  ["dev_", [t("Running a developer tool"), HOLD.disk]],
  ["launch_", [t("Reading launch options"), HOLD.xxmi]],
  ["integration", [t("Reading app links"), HOLD.db]],
  ["report_", [t("Reading what gachamod sends"), HOLD.db]],
  ["render_", [t("Reading the rendering log"), HOLD.disk]],
  ["admin_", [t("Checking how gachamod runs"), HOLD.disk]],
  ["game_check_", [t("Reading the game's setup"), HOLD.disk]],
];

/** Commands that wait on the person (a file dialog, a sign-in window), or run in the background where nobody waits on
 *  them (usage counts, log lines), and so never count as slow. */
const WAITS_ON_PERSON = new Set(["gb_sign_in", "gb_content_settings", "gb_mod_me","telemetry_events", "log_write", "report_ui_error", "render_events", "game_check_saved", "game_check_menu", "save_look"]);

/** What a backend command does and what can hold it. */
export function describeCall(cmd: string): Desc | null {
  if (WAITS_ON_PERSON.has(cmd)) return null;
  const hit = EXACT[cmd] ?? PREFIX.find(([p]) => cmd.startsWith(p))?.[1];
  return hit ?? [t("Working"), t("gachamod's backend is still on it. It may be waiting for another task to finish with the database or the Mods folder.")];
}
