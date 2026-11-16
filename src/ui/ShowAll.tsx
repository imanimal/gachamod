// "Show all" for a row that scrolls sideways (browse/sideScroll.ts): one button lays the whole row out on as many
// lines as it needs, and puts it back in one row. Each row remembers which way it was left, and copies of a row agree.
// The row gets the class `is-all` while open (kit.css).
import { useSyncExternalStore } from "react";
import { IconButton } from "./kit";

const KEY = "gm.rowsOpen";
const subs = new Set<() => void>();
let open: Record<string, true> | null = null;

function read(): Record<string, true> {
  if (open) return open;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown;
    open = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, true>) : {};
  } catch { open = {}; }
  return open;
}
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

/** Whether the row `id` is laid out in full, and a toggle for it. */
export function useRowOpen(id: string): [boolean, () => void] {
  const on = useSyncExternalStore(subscribe, () => !!read()[id]);
  const toggle = () => {
    const next = { ...read() };
    if (next[id]) delete next[id]; else next[id] = true;
    open = next;
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage off */ }
    subs.forEach((f) => f());
  };
  return [on, toggle];
}

/** The button. Shown while the row doesn't fit on one line, and while it is open so it can go back. */
export function ShowAll({ open, onToggle, fits, label }: { open: boolean; onToggle: () => void; fits: boolean; label: string }) {
  if (fits && !open) return null;
  return <IconButton size="sm" className="show-all" icon={open ? "collapse" : "grid"} on={open} label={open ? "Show in one row" : label} onClick={onToggle} />;
}
