// The switch for the developer console (Settings, Feedback and privacy, Log files). Kept apart from Console.tsx so the
// Settings page doesn't load the console to show it.
import { pref } from "../../lib/prefs";

/** The backquote key opens the console. On until turned off. */
export const consolePref = pref<boolean>("ui.console", true, (r) => (r === "1" ? true : r === "0" ? false : undefined), (v) => (v ? "1" : "0"));
