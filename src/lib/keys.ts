// Keyboard shortcuts for what is used over and over, none of them taken by Windows or the webview. Typing in a
// field is never interrupted (only Escape and Ctrl combinations work there). Ctrl+Z/Y (lib/history.ts) and
// Ctrl+= - 0 (lib/zoom.ts) live with what they change. Owner: SHELL area.
import { KEY_VIEWS, viewLabel } from "../shell/names";
import { currentGame } from "./store";

// The Ctrl+1 ... 8 line names the fourth page as the current game does (Resonators in WuWa, Agents in ZZZ). It's
// read each time the list draws, so it follows game switches.
const viewKeys = ["Ctrl+1 … Ctrl+8", ""] as [string, string];
Object.defineProperty(viewKeys, 1, {
  enumerable: true,
  get: () => KEY_VIEWS.map((v) => viewLabel(v, currentGame()?.id)).join(", "),
});

export const SHORTCUTS: Array<[string, string]> = [
  ["Ctrl+K, or start typing", "Search everything: pages, mods, characters, settings, actions"],
  ["/", "Find: the search field of the screen or the open window"],
  ["Ctrl+F", "Find, too"],
  viewKeys,
  ["Alt+Left, Alt+Right", "Back, forward (mouse buttons 4 and 5 too)"],
  ["Ctrl+Tab, Ctrl+Shift+Tab", "Next or previous game"],
  ["Ctrl+Enter", "Play the current game"],
  ["Ctrl+B", "Fold the sidebar to icons, or unfold it"],
  ["F6, Shift+F6", "Move between the page, messages, title bar and sidebar"],
  ["Shift+F10, Menu key", "The focused thing's right-click menu"],
  ["Escape", "Close the top window, drawer or menu"],
  ["Ctrl+Z, Ctrl+Y", "Undo, redo"],
  ["Ctrl+=, Ctrl+-, Ctrl+0", "Text size"],
  ["?", "This list"],
];

/** Keys on a mod card or row, for the shortcuts list. */
export const MOD_SHORTCUTS: Array<[string, string]> = [
  ["Enter", "Open its details"],
  ["Space", "Turn it on or off (the selected mods, when it's one of them)"],
  ["Shift+Space", "Turn it on and keep the character's other mods on too"],
  ["Ctrl+Space, Ctrl+click", "Select it, or take it out of the selection"],
  ["Shift+arrow keys, Shift+click", "Select a range"],
  ["Ctrl+A", "Select every mod shown"],
  ["F2", "Rename"],
  ["Del", "Move to the trash"],
  ["Arrow keys, Home, End", "Move between mods"],
  ["I", "Install, on a Browse card"],
  ["O", "Mark as owned, on a character's page"],
];

/** The controller's buttons (Xbox names; PlayStation's are in the same places), for the shortcuts list. */
export const PAD_SHORTCUTS: Array<[string, string]> = [
  ["D-pad, left stick", "Move between buttons"],
  ["A", "Press"],
  ["B", "Close, or back"],
  ["X", "The focused mod's main action"],
  ["Y", "Find, or search everything"],
  ["LB, RB", "Previous, next view"],
  ["View + LB, View + RB", "Previous, next game"],
  ["View + Y", "The newest message's button"],
  ["LT, RT, right stick", "Scroll"],
  ["View (tap)", "Back"],
  ["Right stick press", "The focused thing's menu"],
  ["Menu", "Play"],
];

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !["checkbox", "radio", "button"].includes((el as HTMLInputElement).type)));
};

/** The layer on top: an open window, menu or viewer, else the screen. */
export function topLayer(): ParentNode {
  const layers = [...document.querySelectorAll<HTMLElement>(".lightbox, .overlay, .popover")];
  return layers[layers.length - 1] ?? document.querySelector(".app .view") ?? document;
}

/** Focus the search field of the layer on top (the screen's when nothing is open). */
export function focusSearch(): boolean {
  const field = topLayer().querySelector<HTMLInputElement>('input[type="search"], .fbox input');
  if (!field || field.offsetParent === null) return false;
  field.focus();
  field.select();
  return true;
}

// F6 regions, in the order F6 visits them. Messages are skipped when none show
const REGIONS = ["main.view", ".toasts", "header.titlebar", "aside.side"];
const visible = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2 && getComputedStyle(el).visibility !== "hidden"; };
const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Focus the newest message's button (its action, else Dismiss). False when no message shows. */
export function focusToast(): boolean {
  const all = [...document.querySelectorAll<HTMLElement>(".toasts .toast:not(.gone)")];
  const t = all[all.length - 1];
  const b = t?.querySelector<HTMLElement>(".toast-act") ?? t?.querySelector<HTMLElement>(".toast-x");
  if (!b) return false;
  document.documentElement.classList.add("kbd");
  b.focus();
  return true;
}

function focusRegion(sel: string): boolean {
  if (sel === ".toasts") return focusToast();
  const root = document.querySelector<HTMLElement>(sel);
  if (!root) return false;
  const el = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].find(visible);
  if (!el) return false;
  el.focus();
  el.scrollIntoView({ block: "nearest", inline: "nearest" });
  return true;
}

/** F6: jump to the next part of the window (page, messages, title bar, sidebar), skipping long runs of Tab stops. */
export function nextRegion(d: 1 | -1) {
  const a = document.activeElement;
  const at = REGIONS.findIndex((sel) => a?.closest(sel));
  for (let n = 1; n <= REGIONS.length; n++) {
    const i = ((at < 0 ? (d > 0 ? -1 : 0) : at) + d * n + REGIONS.length * 2) % REGIONS.length;
    if (i === at) break;
    if (focusRegion(REGIONS[i]!)) return;
  }
}

export interface KeyActions {
  views: string[];
  go: (view: string) => void;
  help: () => void;
  back: () => void;
  forward: () => void;
  nextGame: (d: number) => void;
  play: () => void;
  /** Open the search, with text already typed when given. */
  palette: (text?: string) => void;
  sidebar: () => void;
  menu: () => void;
}

export function installKeys(opts: KeyActions): () => void {
  const h = (e: KeyboardEvent) => {
    if (e.defaultPrevented) return;
    const inField = typing(e.target);
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (ctrl && !e.altKey && !e.shiftKey && /^[1-9]$/.test(e.key)) {
      const v = opts.views[Number(e.key) - 1];
      if (v) { e.preventDefault(); opts.go(v); }
      return;
    }
    if (ctrl && !e.altKey && !e.shiftKey && k === "k") { e.preventDefault(); opts.palette(); return; }
    if (ctrl && !e.altKey && !e.shiftKey && k === "b" && !(e.target as HTMLElement | null)?.isContentEditable) { e.preventDefault(); opts.sidebar(); return; }
    if (ctrl && !e.altKey && k === "f") { if (focusSearch()) e.preventDefault(); return; }
    if (ctrl && e.key === "Tab") { e.preventDefault(); opts.nextGame(e.shiftKey ? -1 : 1); return; }
    // Play only from the screen: in a field or with a window or menu open, Ctrl+Enter belongs to that
    if (ctrl && e.key === "Enter") {
      if (inField || document.querySelector(".overlay, .popover, .ctx, .lightbox")) return;
      e.preventDefault(); opts.play(); return;
    }
    if (e.altKey && !ctrl && e.key === "ArrowLeft" && !inField) { e.preventDefault(); opts.back(); return; }
    if (e.altKey && !ctrl && e.key === "ArrowRight" && !inField) { e.preventDefault(); opts.forward(); return; }
    if ((e.shiftKey && e.key === "F10") || e.key === "ContextMenu") { e.preventDefault(); opts.menu(); return; }
    if (e.key === "F6" && !ctrl && !e.altKey) {
      // inside a window or menu, F6 stays there
      if (document.querySelector(".overlay, .popover, .ctx, .lightbox")) return;
      e.preventDefault(); nextRegion(e.shiftKey ? -1 : 1); return;
    }
    if (e.key === "BrowserBack") { e.preventDefault(); opts.back(); return; }
    if (e.key === "BrowserForward") { e.preventDefault(); opts.forward(); return; }
    if (inField || ctrl || e.altKey) return;
    if (e.key === "/") { if (focusSearch()) e.preventDefault(); return; }
    // the shortcuts list opens over the screen, not over a window or menu that is already open
    if (e.key === "?") { if (!document.querySelector(".overlay, .ctx, .popover, .lightbox")) { e.preventDefault(); opts.help(); } return; }
    // type to search: a letter or digit with nothing to type into opens the search with it. Screens with their own
    // letter keys (I on a card, O on a character page) handle them first, and anything open on top keeps them
    if (e.key.length === 1 && /[\p{L}\p{N}]/u.test(e.key) && !document.querySelector(".overlay, .ctx, .popover, .lightbox")) {
      const key = e.key;
      window.setTimeout(() => { if (!e.defaultPrevented) opts.palette(key); }, 0);
    }
  };
  window.addEventListener("keydown", h);
  return () => window.removeEventListener("keydown", h);
}

// ── hover tips ──
// Every `title` in the app shows as the app's own tip (themed, quick, never off screen) instead of the system's slow
// one, on hover and on keyboard or controller focus. The title moves to data-tip while shown, so the two never
// double up.
/** A button whose name the "Icons only" layout hides (the same rule as kit.css). */
const ICONS_ONLY = "html[data-buttons=icons] .btn:has(> .i):has(> .btn-t):not(.dialog .btn, .popover .btn, .menu .btn, .toast .btn)";
const TIPPED = `[title], [data-tip], .ibtn[aria-label], .wk[aria-label], ${ICONS_ONLY}`;
export function installTips(): () => void {
  let tip: HTMLDivElement | null = null;
  let timer = 0;
  let cur: HTMLElement | null = null;
  // the element just clicked: its tip stays away until the pointer leaves it
  let clicked: HTMLElement | null = null;
  const tipped = (t: EventTarget | null) => (t as Element | null)?.closest?.(TIPPED) as HTMLElement | null;
  const hide = () => {
    clearTimeout(timer);
    if (cur?.dataset.tip !== undefined && !cur.getAttribute("title")) { cur.setAttribute("title", cur.dataset.tip); delete cur.dataset.tip; }
    cur = null;
    tip?.remove(); tip = null;
  };
  const show = (el: HTMLElement) => {
    // an icon-only key with no title says what it is with its label
    let text = el.getAttribute("title") || el.dataset.tip || el.getAttribute("aria-label");
    // Buttons: icons only hides a button's name, so its tip starts with it
    const hidden = el.matches(ICONS_ONLY) ? el.querySelector(":scope > .btn-t")?.textContent?.trim() ?? "" : "";
    if (hidden && !(text ?? "").toLowerCase().startsWith(hidden.toLowerCase())) text = text ? `${hidden}. ${text}` : hidden;
    if (!text) return;
    hide();
    cur = el;
    if (el.hasAttribute("title") || el.dataset.tip) { el.dataset.tip = text; el.removeAttribute("title"); }
    timer = window.setTimeout(() => {
      if (cur !== el || !el.isConnected) return;
      tip = document.createElement("div");
      tip.className = "apptip";
      tip.setAttribute("role", "tooltip");
      tip.textContent = text;
      (document.querySelector(".app") ?? document.body).appendChild(tip);
      const r = el.getBoundingClientRect(), t = tip.getBoundingClientRect(), pad = 8;
      let top = r.bottom + 6;
      if (top + t.height > window.innerHeight - pad) top = r.top - t.height - 6;
      const left = Math.max(pad, Math.min(window.innerWidth - t.width - pad, r.left + r.width / 2 - t.width / 2));
      tip.style.left = `${left}px`; tip.style.top = `${Math.max(pad, top)}px`;
    }, 380);
  };
  const over = (e: Event) => {
    const el = tipped(e.target);
    if (el && el !== cur && el !== clicked) show(el);
    else if (!el && cur) hide();
  };
  const focus = (e: FocusEvent) => { const el = tipped(e.target); if (el && document.documentElement.classList.contains("kbd")) show(el); };
  const out = (e: MouseEvent) => {
    if (cur && !cur.contains(e.relatedTarget as Node)) hide();
    if (clicked && !clicked.contains(e.relatedTarget as Node)) clicked = null;
  };
  const down = (e: MouseEvent) => { hide(); clicked = tipped(e.target); };
  // keyboard or controller in use: focus shows tips and rings; the mouse puts it back
  // Shift+F10, the Menu key and F6 move focus too, so they turn the rings on before the menu or region takes it
  const kbd = (e: KeyboardEvent) => {
    if (e.key === "Tab" || e.key.startsWith("Arrow") || e.key === "F10" || e.key === "F6" || e.key === "ContextMenu") document.documentElement.classList.add("kbd");
  };
  // mouseover only fires on entering an element, so after a scroll hid the tip, moving the pointer brings it back
  const move = (e: MouseEvent) => {
    document.documentElement.classList.remove("kbd", "pad");
    if (cur) return;
    const el = tipped(e.target);
    if (el && el !== clicked) show(el);
  };
  document.addEventListener("mouseover", over);
  document.addEventListener("mouseout", out);
  document.addEventListener("focusin", focus);
  document.addEventListener("focusout", hide);
  document.addEventListener("mousedown", down, true);
  document.addEventListener("keydown", kbd, true);
  document.addEventListener("mousemove", move);
  window.addEventListener("scroll", hide, true);
  return () => {
    document.removeEventListener("mouseover", over); document.removeEventListener("mouseout", out); document.removeEventListener("focusin", focus);
    document.removeEventListener("focusout", hide); document.removeEventListener("mousedown", down, true); document.removeEventListener("keydown", kbd, true);
    document.removeEventListener("mousemove", move); window.removeEventListener("scroll", hide, true);
  };
}
