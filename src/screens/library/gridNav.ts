// Arrow keys between the buttons of a grid or list (cards, tiles). Owner: LIBRARY area.
import type { KeyboardEvent } from "react";

/** Moves focus for arrow keys, Home and End. True when it handled the key. */
export function moveInGrid(e: KeyboardEvent, container: HTMLElement | null, selector: string): boolean {
  if (!container || e.altKey || e.ctrlKey || e.metaKey) return false;
  const items = [...container.querySelectorAll<HTMLElement>(selector)];
  const at = items.indexOf((e.target as HTMLElement).closest<HTMLElement>(selector) as HTMLElement);
  if (at < 0) return false;
  const top = items[0]!.getBoundingClientRect().top;
  const cols = Math.max(1, items.filter((x) => Math.abs(x.getBoundingClientRect().top - top) < 2).length);
  const to = e.key === "ArrowRight" ? at + 1 : e.key === "ArrowLeft" ? at - 1 : e.key === "ArrowDown" ? at + cols
    : e.key === "ArrowUp" ? at - cols : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : null;
  if (to === null) return false;
  e.preventDefault();
  items[Math.max(0, Math.min(items.length - 1, to))]?.focus();
  return true;
}
