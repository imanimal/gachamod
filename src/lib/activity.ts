// What gachamod is waiting on right now. Every backend call and GameBanana request is noted here with what it does
// and what can hold it up, so a wait is never a blank spinner: the title bar names anything that takes longer than a
// moment (shell/Activity.tsx) and the kit's Waiting says why it may be stuck once it runs long. Owner: SHELL area.
import { useEffect, useState, useSyncExternalStore } from "react";

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
    const t = window.setInterval(() => set((x) => x + 1), 1000);
    return () => window.clearInterval(t);
  }, [on]);
}

export function seconds(s: number): string {
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

// ── what each backend command does, and what can hold it ──

export const HOLD = {
  disk: "This reads and writes files on disk. A cloud-synced folder (OneDrive, Google Drive) still fetching files, an antivirus scan, or a sleeping external drive can hold it.",
  db: "This waits on gachamod's own database. Another task that is saving a lot (a mod scan, a big install) holds it until it's done.",
  gb: "This waits on GameBanana. A slow or dropped connection, a VPN, or GameBanana being down can hold it. It gives up after 30 seconds without an answer.",
  github: "This waits on GitHub. A slow or dropped connection or a VPN can hold it. It gives up after 30 seconds without an answer.",
  web: "This waits on a website. A slow or dropped connection or a VPN can hold it. It gives up after 30 seconds without an answer.",
  detect: "This looks through XXMI Launcher, game launchers and every Steam library. A disconnected network drive or a sleeping USB drive listed as a Steam library can hold it.",
  xxmi: "This reads or starts XXMI Launcher. An XXMI Launcher window waiting for an answer (an update, an installer, an error) can hold it. Check the taskbar for one.",
  game: "This starts the game. A launcher window waiting for an answer (an update, a login, an error) can hold it. Check the taskbar for one.",
  archive: "This unpacks or packs an archive. A big archive on a slow drive takes a while, and an antivirus scanning each file slows it more.",
  dialog: "This waits on a window that asks you something. Look for it behind gachamod or on another screen.",
} as const;

type Desc = [what: string, hold: string];
const EXACT: Record<string, Desc> = {
  games_detect: ["Looking for games and XXMI Launcher", HOLD.detect],
  games_list: ["Reading your games", HOLD.db],
  game: ["Reading this game's setup", HOLD.db],
  game_launch: ["Starting the game", HOLD.game],
  game_running: ["Checking if the game runs", HOLD.game],
  game_set_paths: ["Saving the game's folders", HOLD.disk],
  xxmi_status: ["Reading XXMI Launcher's settings", HOLD.xxmi],
  xxmi_open: ["Opening XXMI Launcher", HOLD.xxmi],
  xxmi_install: ["Installing XXMI Launcher and the mod loaders", "This downloads about 65 MB from GitHub and unpacks it into XXMI Launcher's folder. A slow connection, a VPN or an antivirus scanning the new files can hold it."],
  imm_detect: ["Looking for Integrated Mod Manager", HOLD.disk],
  imm_takeover: ["Moving mods out of Integrated Mod Manager", HOLD.disk],
  library_scan: ["Reading the Mods folder", HOLD.disk],
  library_list: ["Reading your mods", HOLD.db],
  conflicts_scan: ["Looking for mods that clash", HOLD.disk],
  lint_scan: ["Checking mod files for problems", HOLD.disk],
  install_local: ["Installing from a file", HOLD.archive],
  pack_import: ["Unpacking a .gachamod file", HOLD.archive],
  pack_export: ["Packing a .gachamod file", HOLD.archive],
  pack_inspect: ["Reading a .gachamod file", HOLD.archive],
  pack_plan: ["Working out what goes in the pack", HOLD.disk],
  mods_merge: ["Merging mods", HOLD.disk],
  mods_remove: ["Moving mods to the trash", HOLD.disk],
  mods_overlapping: ["Checking which mods change the same parts", HOLD.disk],
  mod_mesh: ["Reading the model", HOLD.disk],
  mod_fetch_preview: ["Downloading a preview", HOLD.gb],
  hash_lookup: ["Matching mods with GameBanana", HOLD.gb],
  owned_fetch: ["Reading your characters online", HOLD.web],
  characters_sync: ["Saving the character list", HOLD.db],
  app_update_check: ["Checking for a gachamod update", HOLD.github],
  app_update_install: ["Downloading the gachamod update", HOLD.github],
  app_update_status: ["Reading the update status", HOLD.db],
  extensions_repos: ["Reading extension lists", HOLD.github],
  extensions_fetch: ["Reading an extension list", HOLD.github],
  extensions_install: ["Installing an extension", HOLD.github],
  fixers_download: ["Downloading a fix tool", HOLD.github],
  fixers_github: ["Downloading a fix tool from GitHub", HOLD.github],
  fixers_run_all: ["Watching what the fixer changes", "The fixer opened in its own window. Run it there. gachamod carries on a few seconds after it stops changing files, or when you choose Stop waiting. The window can stay open."],
  fixers_run: ["Running the fixer on the mod", "A fixer with its own window waits until you close it. One that waits for a key press is stopped after 2 minutes."],
  xxmi_uninstall: ["Uninstalling the mod loaders", "This moves files to the Recycle Bin. A game or XXMI Launcher that has the files open can hold it."],
  app_reset: ["Getting ready to start over", HOLD.disk],
  app_relaunch: ["Restarting gachamod", HOLD.disk],
  setup_game: ["Reading what setup left", HOLD.disk],
  fixes_apply: ["Updating mods for the new game version", HOLD.disk],
  settings_import: ["Bringing in settings", HOLD.disk],
  settings_export: ["Saving your settings to a file", HOLD.disk],
  trash_purge: ["Emptying the trash", HOLD.disk],
  profile_activate: ["Switching profile", HOLD.disk],
  ai_chatbots_installed: ["Looking for AI apps", HOLD.disk],
  feedback_send: ["Sending your feedback", HOLD.web],
  admin_set_always: ["Changing how gachamod starts", HOLD.disk],
  app_restart_admin: ["Waiting for Windows to allow administrator", HOLD.dialog],
  game_check_send: ["Sending the check's results", HOLD.web],
  setup_available: ["Looking for gachamod setup", HOLD.disk],
  setup_open: ["Opening gachamod setup", HOLD.disk],
};
/** By prefix, for everything not named above. */
const PREFIX: Array<[string, Desc]> = [
  ["settings_", ["Reading settings", HOLD.db]],
  ["gb_", ["Waiting on GameBanana", HOLD.gb]],
  ["queue_", ["Updating the download list", HOLD.db]],
  ["extensions_", ["Working on extensions", HOLD.disk]],
  ["owned_", ["Reading your characters", HOLD.db]],
  ["characters", ["Reading the character list", HOLD.db]],
  ["profile", ["Working on profiles", HOLD.disk]],
  ["keys_", ["Reading mod keys", HOLD.disk]],
  ["keylist_set", ["Saving the key list settings", HOLD.disk]],
  ["keylist_choose", ["Saving which mods the key list shows", HOLD.db]],
  ["keylist_", ["Reading mod keys", HOLD.disk]],
  ["live_", ["Talking to the running game", HOLD.disk]],
  ["overlay_", ["Updating the in-game menu", HOLD.disk]],
  ["mod_", ["Working on a mod", HOLD.disk]],
  ["mods", ["Working on mods", HOLD.disk]],
  ["library_", ["Working on your mods", HOLD.disk]],
  ["trash_", ["Reading the trash", HOLD.disk]],
  ["backup_", ["Restoring files", HOLD.disk]],
  ["archive_", ["Reading downloaded archives", HOLD.disk]],
  ["foreign_", ["Reading another mod manager's files", HOLD.disk]],
  ["fixes_", ["Checking mods against the game version", HOLD.disk]],
  ["fixers_", ["Reading fix tools", HOLD.disk]],
  ["lint_", ["Fixing mod files", HOLD.disk]],
  ["dev_", ["Running a developer tool", HOLD.disk]],
  ["launch_", ["Reading launch options", HOLD.xxmi]],
  ["integration", ["Reading app links", HOLD.db]],
  ["report_", ["Reading what gachamod sends", HOLD.db]],
  ["render_", ["Reading the rendering log", HOLD.disk]],
  ["admin_", ["Checking how gachamod runs", HOLD.disk]],
  ["game_check_", ["Reading the game's setup", HOLD.disk]],
];

/** Commands that wait on the person (a file dialog, a sign-in window), or run in the background where nobody waits on
 *  them (usage counts, log lines), and so never count as slow. */
const WAITS_ON_PERSON = new Set(["gb_sign_in", "telemetry_events", "log_write", "report_ui_error", "render_events", "game_check_saved", "game_check_menu", "save_look"]);

/** What a backend command does and what can hold it. */
export function describeCall(cmd: string): Desc | null {
  if (WAITS_ON_PERSON.has(cmd)) return null;
  const hit = EXACT[cmd] ?? PREFIX.find(([p]) => cmd.startsWith(p))?.[1];
  return hit ?? ["Working", "gachamod's backend is still on it. It may be waiting for another task to finish with the database or the Mods folder."];
}
