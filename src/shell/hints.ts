// Soft pointers on the usual way to get a mod, in place of a tour. They show only for someone who just set gachamod
// up, in that first session: Browse in the sidebar looks faintly selected until it's opened, the first card's
// Install button shows with a faint outline until the first install, and Downloads looks faintly selected while a
// download runs until it's opened. Each is gone for good once done. Nothing is blocked and nothing pops up.
// Settings, General turns them off ("hints.on"). Owner: SHELL area.
import { useSyncExternalStore } from "react";
import { jsonPref, pref } from "../lib/prefs";

export type HintId = "browse" | "install" | "downloads";

const donePref = jsonPref<HintId[]>("hints.done", []);
export const hintsOnPref = pref<boolean>("hints.on", true, (r) => (r === "1" ? true : r === "0" ? false : undefined), (v) => (v ? "1" : "0"));

// set when this session finished a first setup (screens/settings/Onboarding.tsx); a later start shows no hints
let fresh = false;
const subs = new Set<() => void>();
export function startHints() {
  if (fresh) return;
  fresh = true;
  subs.forEach((f) => f());
}
const useFresh = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => fresh);

/** True while the hint should show (first session, hints on, step not done yet). The caller adds its own condition. */
export function useHint(id: HintId): boolean {
  const isFresh = useFresh();
  const on = hintsOnPref.use();
  const done = donePref.use();
  return isFresh && on && !done.includes(id);
}

/** The step was done: its hint never shows again. */
export function doneHint(id: HintId) {
  if (!fresh) return;
  void donePref.ready.then(() => {
    const done = donePref.get();
    if (!done.includes(id)) void donePref.set([...done, id]).catch(() => {});
  });
}

/** The class that marks a hinted button, or "" (for className lists). Nav items use " is-hint" instead. */
export const hintClass = (show: boolean) => (show ? " hint-ring" : "");
