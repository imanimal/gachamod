// The switch for the developer console (Settings, Feedback and privacy, Log files). Kept apart from Console.tsx so the
// Settings page doesn't load the console to show it.
import { pref } from "../../lib/prefs";
import { inTauri } from "../../lib/tauri";

/** Shift+` opens the console. On at first in dev builds and the browser demo; in releases it waits until someone turns
 *  it on (to read the log while tracking down a problem). */
export const consolePref = pref<boolean>("ui.console", import.meta.env.DEV || !inTauri(), (r) => (r === "1" ? true : r === "0" ? false : undefined), (v) => (v ? "1" : "0"));
