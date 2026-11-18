// One tip on each opening screen (splash/splash.ts), for things people forget exist. The list stays short on
// purpose so each one comes back often. [Ctrl+K] in a tip shows as a key; the icon sits above it. Owner: SHELL area.
import { ICONS, type IconName } from "../ui/icons";
import { t } from "../lib/i18n";

export interface Tip { id: string; text: string; icon: IconName; weight: number; /** ms the tip stays at least (longer to read) */ hold?: number }

const TIPS: Tip[] = [
  { id: "right-click", icon: "mouse", weight: 3, text: t("Right-click works on anything: mods, characters, profiles, downloads") },
  { id: "search", icon: "search", weight: 3, text: t("[Ctrl+K] searches the whole app. Or just start typing") },
  { id: "paste", icon: "link", weight: 1, text: t("Paste a GameBanana link anywhere to open it here") },
  { id: "drop", icon: "archive", weight: 1, text: t("Drop a mod's zip or folder onto the window to install it. A zip full of mods installs each one") },
  { id: "batches", icon: "downloads", weight: 1, text: t("In Downloads, turn a whole batch of new mods on or off at once") },
  { id: "undo", icon: "undo", weight: 2, text: t("[Ctrl+Z] undoes your last change. [Ctrl+Shift+Z] or [Ctrl+Y] redoes it") },
  { id: "games", icon: "swap", weight: 1, text: t("[Ctrl+Tab] switches to your next game") },
  { id: "play", icon: "play", weight: 1, text: t("[Ctrl+Enter] starts the current game") },
  { id: "keys", icon: "keyboard", weight: 1, text: t("Press [?] to see every shortcut") },
  { id: "pad", icon: "gamepad", weight: 1, text: t("Everything works with a controller too") },
];

/** Rare: one start in twenty. The code works on the keyboard and on a controller (lib/fun.ts). */
const KONAMI: Tip = { id: "konami", icon: "gamepad", weight: 0, hold: 3600, text: t("Try the Konami code [↑] [↑] [↓] [↓] [←] [→] [←] [→] [B] [A]") };

const LAST = "gm.tip";

/** This start's tip: the Konami one 5% of the time, else a weighted pick that isn't the last one shown. */
export function pickTip(): Tip {
  let last: string | null = null;
  try { last = localStorage.getItem(LAST); } catch { /* no storage */ }
  let tip = KONAMI;
  if (Math.random() >= 0.05 || last === KONAMI.id) {
    const pool = TIPS.filter((x) => x.id !== last);
    let r = Math.random() * pool.reduce((a, x) => a + x.weight, 0);
    tip = pool.find((x) => (r -= x.weight) < 0) ?? pool[0]!;
  }
  try { localStorage.setItem(LAST, tip.id); } catch { /* no storage */ }
  return tip;
}

/** The tip as DOM: an icon over a line of text, [keys] as <kbd> (a translation keeps the brackets). */
export function tipNodes(tip: Tip): Node[] {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "splash-tip-i");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", ICONS[tip.icon]);
  path.setAttribute("vector-effect", "non-scaling-stroke");
  svg.append(path);
  const line = document.createElement("span");
  line.className = "splash-tip-t";
  line.append(...tip.text.split(/(\[[^\]]+\])/).filter(Boolean).map((part) => {
    if (!/^\[.+\]$/.test(part)) return document.createTextNode(part);
    const k = document.createElement("kbd");
    k.textContent = part.slice(1, -1);
    return k;
  }));
  return [svg, line];
}
