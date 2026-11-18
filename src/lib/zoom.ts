// Zoom and text size. Zoom scales the whole window, pictures and spacing too: the webview's zoom in the app, CSS
// zoom on <html> in the browser demo. Ctrl+= and Ctrl+- step it, Ctrl+0 resets, and the level shows for a moment in
// the corner. Text size is separate: every size is in em from --fs, so one number scales only the text (pixel icons
// stay crisp at their own sizes). Both are remembered.
import { inTauri } from "./tauri";

const KEY = "pm.textSize";
export const SIZES = [12, 13, 14, 15, 16, 18, 20, 22, 24, 28] as const;
const DEFAULT = 14;

export function getTextSize(): number {
  try { const v = Number(localStorage.getItem(KEY)); if (SIZES.includes(v as never)) return v; } catch { /* storage unavailable */ }
  return DEFAULT;
}
export function setTextSize(px: number) {
  document.documentElement.style.setProperty("--fs", `${px}px`);
  try { localStorage.setItem(KEY, String(px)); } catch { /* storage unavailable */ }
  window.dispatchEvent(new CustomEvent("pm-text-size", { detail: px }));
}
export function applyTextSize() { const px = getTextSize(); if (px !== DEFAULT) document.documentElement.style.setProperty("--fs", `${px}px`); }

// ── zoom ──

const ZOOM_KEY = "gm.zoom";
export const ZOOMS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;

export function getZoom(): number {
  try { const v = Number(localStorage.getItem(ZOOM_KEY)); if (ZOOMS.includes(v as never)) return v; } catch { /* storage unavailable */ }
  return 1;
}
/** "110%" */
export const zoomLabel = (z: number) => `${Math.round(z * 100)}%`;

function show(z: number) {
  if (inTauri()) {
    void import("@tauri-apps/api/webview").then(({ getCurrentWebview }) => getCurrentWebview().setZoom(z)).catch(() => undefined);
  } else {
    document.documentElement.style.zoom = z === 1 ? "" : String(z);
  }
}

/** Zoom the window to one of ZOOMS and remember it. */
export function setZoom(z: number) {
  if (!ZOOMS.includes(z as never)) return;
  show(z);
  try { if (z === 1) localStorage.removeItem(ZOOM_KEY); else localStorage.setItem(ZOOM_KEY, String(z)); } catch { /* storage unavailable */ }
  window.dispatchEvent(new CustomEvent("gm-zoom", { detail: z }));
}
/** One step bigger (1) or smaller (-1). */
export function stepZoom(dir: 1 | -1) {
  const cur = ZOOMS.indexOf(getZoom() as never);
  setZoom(ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, cur + dir))]!);
}
/** The remembered zoom, at startup. */
export function applyZoom() { const z = getZoom(); if (z !== 1) show(z); }

/** The level in the window's corner for a moment after a key changes it. */
let badge: HTMLElement | null = null;
let badgeTimer = 0;
function flashLevel(z: number) {
  if (!badge) {
    badge = document.createElement("div");
    badge.className = "zoom-level";
    badge.setAttribute("role", "status");
    document.body.append(badge);
  }
  badge.textContent = zoomLabel(z);
  badge.classList.add("on");
  clearTimeout(badgeTimer);
  badgeTimer = window.setTimeout(() => badge?.classList.remove("on"), 1200);
}

export function installZoomKeys(): () => void {
  const h = (ev: KeyboardEvent) => {
    if (!(ev.ctrlKey || ev.metaKey) || ev.altKey) return;
    if (ev.key === "=" || ev.key === "+") stepZoom(1);
    else if (ev.key === "-") stepZoom(-1);
    else if (ev.key === "0") setZoom(1);
    else return;
    ev.preventDefault();
    flashLevel(getZoom());
  };
  window.addEventListener("keydown", h);
  return () => window.removeEventListener("keydown", h);
}
