// Which widgets Home shows and in what order (setting "home.layout"). Ids the app doesn't know any more are dropped
// and new ones are added at the end, so an old layout keeps working after an update. Owner: HOME/PROFILES area.
import { useSyncExternalStore } from "react";
import { jsonPref } from "../../lib/prefs";
import type { IconName } from "../../ui/Icon";
import { t } from "../../lib/i18n";

export type WidgetId = "start" | "updates" | "subscribed" | "hq" | "foryou" | "followed" | "characters" | "recent" | "browser";

export const WIDGETS: Record<WidgetId, { title: string; icon: IconName; tip: string }> = {
  start: { title: t("Play and profiles"), icon: "play", tip: t("Play, your profiles and quick actions") },
  updates: { title: t("Updates"), icon: "update", tip: t("Installed mods with a newer version on GameBanana") },
  subscribed: { title: t("Subscribed mods"), icon: "bell", tip: t("Mods you subscribed to, the ones with an update first. Hidden until you subscribe to one") },
  hq: { title: t("New high-quality mods"), icon: "quality", tip: t("New mods that pass the High quality filter") },
  foryou: { title: t("For you"), icon: "sparkle", tip: t("Picks based on the mods you have and the creators you follow") },
  followed: { title: t("From creators you follow"), icon: "feed", tip: t("New mods by creators you follow. Hidden until you follow someone") },
  characters: { title: t("Your characters"), icon: "characters", tip: t("Characters you have mods for") },
  recent: { title: t("Recently installed"), icon: "clock", tip: t("Your newest mods") },
  browser: { title: "GameBanana", icon: "browse", tip: t("A small mod browser. Expand opens Browse with the same filters") },
};

export const DEFAULT_ORDER: WidgetId[] = ["start", "updates", "subscribed", "hq", "foryou", "characters", "followed", "recent", "browser"];

export interface HomeLayout { order: WidgetId[]; hidden: WidgetId[] }
export const DEFAULT_LAYOUT: HomeLayout = { order: DEFAULT_ORDER, hidden: [] };
export const homeLayoutPref = jsonPref<HomeLayout>("home.layout", DEFAULT_LAYOUT);

const known = (x: unknown): x is WidgetId => typeof x === "string" && x in WIDGETS;

/** A saved layout made safe: known ids only, each once, every widget present. */
export function normalize(l: Partial<HomeLayout> | null | undefined): HomeLayout {
  const order = [...new Set((Array.isArray(l?.order) ? l.order : []).filter(known))];
  for (const id of DEFAULT_ORDER) if (!order.includes(id)) order.push(id);
  const hidden = [...new Set((Array.isArray(l?.hidden) ? l.hidden : []).filter(known))];
  return { order, hidden };
}

export function move(l: HomeLayout, id: WidgetId, by: -1 | 1): HomeLayout {
  const order = [...l.order];
  const i = order.indexOf(id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= order.length) return l;
  [order[i], order[j]] = [order[j]!, order[i]!];
  return { ...l, order };
}

export function setShown(l: HomeLayout, id: WidgetId, shown: boolean): HomeLayout {
  const hidden = l.hidden.filter((x) => x !== id);
  if (!shown) hidden.push(id);
  return { ...l, hidden };
}

// edit mode, so the search's "Customise Home" can turn it on from anywhere
let editing = false;
const subs = new Set<() => void>();
export const useHomeEditing = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => editing);
export function setHomeEditing(on: boolean) { if (editing !== on) { editing = on; subs.forEach((f) => f()); } }
