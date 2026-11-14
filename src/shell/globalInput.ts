// App-wide mouse input: the right-click menu for anything without its own (copy and paste in fields, copy and search
// for selected text, else Back, Forward, Search, Undo, Redo, Settings), and the mouse's side buttons for Back and
// Forward (WebView2 would otherwise run its own history and leave the app). Owner: SHELL area.
import { canRedo, canUndo, redo, undo } from "../lib/history";
import { back, forward, go, recentPages } from "../lib/store";
import { openMenu, type MenuEntry } from "../ui/ContextMenu";
import { toast } from "../ui/toast";
import { openPalette } from "./state";


type Field = HTMLInputElement | HTMLTextAreaElement | HTMLElement;
const TEXT_INPUT = /^(text|search|url|email|password|tel|number)$/;

function fieldOf(t: EventTarget | null): Field | null {
  const el = t as HTMLElement | null;
  if (!el) return null;
  if (el instanceof HTMLTextAreaElement) return el;
  if (el instanceof HTMLInputElement && TEXT_INPUT.test(el.type)) return el;
  const ce = el.closest?.("[contenteditable=''], [contenteditable='true']") as HTMLElement | null;
  return ce;
}

function fieldItems(f: Field): MenuEntry[] {
  const input = f instanceof HTMLInputElement || f instanceof HTMLTextAreaElement ? f : null;
  const readOnly = input ? input.readOnly || input.disabled : false;
  const hasSel = input ? (input.selectionStart ?? 0) !== (input.selectionEnd ?? 0) : !!window.getSelection()?.toString();
  const secret = input instanceof HTMLInputElement && input.type === "password";
  const keep = () => f.focus({ preventScroll: true });
  return [
    { label: "Cut", icon: "cut", keys: "Ctrl+X", disabled: !hasSel || readOnly || secret, onClick: () => { keep(); document.execCommand("cut"); } },
    { label: "Copy", icon: "copy", keys: "Ctrl+C", disabled: !hasSel || secret, onClick: () => { keep(); document.execCommand("copy"); } },
    { label: "Paste", icon: "paste", keys: "Ctrl+V", disabled: readOnly, onClick: () => {
      keep();
      navigator.clipboard?.readText().then((t) => { keep(); document.execCommand("insertText", false, t); })
        .catch(() => toast("Paste with Ctrl+V here"));
    } },
    { label: "Select all", icon: "select", keys: "Ctrl+A", onClick: () => { keep(); if (input) input.select(); else document.execCommand("selectAll"); } },
  ];
}

function pageItems(): MenuEntry[] {
  return [
    { label: "Back", icon: "left", keys: "Alt+Left", disabled: !recentPages(-1, 1).length, onClick: () => back() },
    { label: "Forward", icon: "right", keys: "Alt+Right", disabled: !recentPages(1, 1).length, onClick: () => forward() },
    "-",
    { label: "Search", icon: "search", keys: "Ctrl+K", onClick: () => openPalette() },
    { label: "Undo", icon: "undo", keys: "Ctrl+Z", disabled: !canUndo(), onClick: () => void undo() },
    { label: "Redo", icon: "redo", keys: "Ctrl+Y", disabled: !canRedo(), onClick: () => void redo() },
    "-",
    { label: "Settings", icon: "settings", keys: "Ctrl+8", onClick: () => go("settings") },
  ];
}

export function installGlobalInput(): () => void {
  // React's handlers (menuHandler) stop the event before it gets here
  const ctx = (e: MouseEvent) => {
    if (e.defaultPrevented) return;
    e.preventDefault();
    const where = e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : (e.target as Element);
    const f = fieldOf(e.target);
    if (f) { openMenu(where, fieldItems(f)); return; }
    const sel = window.getSelection()?.toString().trim() ?? "";
    if (sel) {
      const short = sel.length > 28 ? `${sel.slice(0, 26)}...` : sel;
      openMenu(where, [
        { label: "Copy", icon: "copy", keys: "Ctrl+C", onClick: () => { navigator.clipboard?.writeText(sel).catch(() => document.execCommand("copy")); } },
        { label: `Search for "${short}"`, icon: "search", onClick: () => openPalette(sel.slice(0, 80)) },
        "-",
        ...pageItems(),
      ]);
      return;
    }
    openMenu(where, pageItems());
  };

  // mouse buttons 4 and 5 (button 3 and 4 in the event): stop WebView2's own navigation, then go back or forward
  const down = (e: MouseEvent) => { if (e.button === 3 || e.button === 4) e.preventDefault(); };
  const up = (e: MouseEvent) => {
    if (e.button !== 3 && e.button !== 4) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.button === 3) back(); else forward();
  };
  const aux = (e: MouseEvent) => { if (e.button === 3 || e.button === 4) e.preventDefault(); };

  window.addEventListener("contextmenu", ctx);
  window.addEventListener("mousedown", down, true);
  window.addEventListener("mouseup", up, true);
  window.addEventListener("auxclick", aux, true);
  return () => {
    window.removeEventListener("contextmenu", ctx);
    window.removeEventListener("mousedown", down, true);
    window.removeEventListener("mouseup", up, true);
    window.removeEventListener("auxclick", aux, true);
  };
}
