// Right-click menus, everywhere. A component passes its items with `onContextMenu={menuHandler(() => items)}`; a thing
// that appears on many screens (a mod, a character, a creator, a profile, a game) gets its items from one builder
// registered by the area that owns it (`registerMenu`), so the same thing has the same menu wherever it shows.
// Anything without its own menu still gets a useful one from the shell (App.tsx: copy and paste in fields, back,
// search, undo). Shift+F10, the Menu key and the controller's right stick press open the focused thing's menu.
// Owner: skeleton.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { GameId, ModEntry } from "../lib/api";
import type { GbCard } from "../lib/gamebanana";
import { Icon, type IconName } from "./Icon";
import { LazyImg } from "./LazyImg";

export interface MenuItem {
  label: string;
  icon?: IconName;
  /** A key that does the same, shown on the right ("Ctrl+Z", "Del"). */
  keys?: string;
  /** A hover tip. */
  title?: string;
  danger?: boolean;
  disabled?: boolean;
  /** A check mark: true on, false off (room kept), undefined none. */
  checked?: boolean;
  onClick?: () => void;
  /** A submenu. */
  items?: MenuEntry[];
  /** Picture at the start instead of an icon (a portrait, an avatar). */
  img?: string | null;
}
/** "-" draws a line; `{ header }` a small title; falsy entries are skipped (so `cond && item` works). */
export type MenuEntry = MenuItem | "-" | { header: string } | null | false | undefined;

// ── shared builders for things that show on many screens ──

export interface MenuSubjects {
  /** An installed mod. `selection`: every selected mod when this one is part of a selection. */
  mod: { game: GameId; mod: ModEntry; selection?: ModEntry[] };
  /** A mod on GameBanana. */
  gbmod: { game: GameId; card: GbCard };
  /** A character of a game. */
  character: { game: GameId; name: string };
  /** A GameBanana member. `modId` helps find their id when only the name is known. */
  creator: { id?: number | null; name: string; avatar?: string | null; modId?: number | null };
  /** A profile. */
  profile: { game: GameId; id: number };
  /** A game. */
  game: { id: GameId };
}
type Builder<K extends keyof MenuSubjects> = (d: MenuSubjects[K]) => MenuEntry[];
const builders: { [K in keyof MenuSubjects]?: Builder<K> } = {};

/** Register the menu builder for a kind of thing (each area for its own). */
export function registerMenu<K extends keyof MenuSubjects>(kind: K, build: Builder<K>) { (builders as Record<string, unknown>)[kind] = build; }
/** The registered items for a thing (empty when nothing is registered). */
export function menuFor<K extends keyof MenuSubjects>(kind: K, d: MenuSubjects[K]): MenuEntry[] {
  const b = builders[kind] as Builder<K> | undefined;
  return b ? b(d) : [];
}

// ── opening ──

interface Open { x: number; y: number; items: MenuEntry[]; key: number; from: Element | null; onClose?: () => void }
let open: Open | null = null;
let seq = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

const visible = (items: MenuEntry[]) => items.some((i) => i && i !== "-" && !("header" in i));

// A left press on the button that opened the menu closes it. The click that ends that press would open it again,
// so that button opens nothing until the press is over: a second click on a menu button closes its menu.
let shut: Element | null = null;
const unshut = () => { shut = null; };
function holdShut(el: Element) {
  shut = el;
  // the click comes right after mouseup, in the same task
  window.addEventListener("mouseup", () => window.setTimeout(unshut), { capture: true, once: true });
  window.addEventListener("keydown", unshut, { capture: true, once: true });
}

/** Show a menu at a point, or by an element (keyboard). Nothing shows when every entry is empty. `onClose` runs
 *  when it closes, picked or not (before the picked item's own onClick). */
export function openMenu(at: { x: number; y: number } | Element, items: MenuEntry[], onClose?: () => void) {
  if (!visible(items)) return;
  const from = at instanceof Element ? at : document.activeElement;
  if (from && from === shut) { shut = null; return; }
  open?.onClose?.();
  let x: number, y: number;
  if (at instanceof Element) { const r = at.getBoundingClientRect(); x = r.left + Math.min(24, r.width / 2); y = r.top + Math.min(r.height, 28); }
  else { x = at.x; y = at.y; }
  open = { x, y, items, key: ++seq, from, onClose };
  emit();
}
export function closeMenu() {
  if (!open) return;
  const { from: f, onClose } = open;
  open = null;
  emit();
  if (f instanceof HTMLElement && f.isConnected) f.focus({ preventScroll: true });
  onClose?.();
}
export const menuIsOpen = () => !!open;

/** onContextMenu handler that opens these items. Stops the event so the shell's default menu stays away. */
export function menuHandler(build: () => MenuEntry[]) {
  return (e: ReactMouseEvent) => {
    const items = build();
    if (!visible(items)) return;
    e.preventDefault();
    e.stopPropagation();
    openMenu(e.nativeEvent instanceof MouseEvent && (e.clientX || e.clientY) ? { x: e.clientX, y: e.clientY } : (e.currentTarget as Element), items);
  };
}

/** Open the focused element's menu (Shift+F10, the Menu key, the controller). */
export function menuForFocus() {
  const el = document.activeElement as HTMLElement | null;
  const target = el && el !== document.body ? el : document.querySelector(".app .view") as HTMLElement | null;
  if (!target) return;
  const r = target.getBoundingClientRect();
  target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + Math.min(24, r.width / 2), clientY: r.top + Math.min(r.height, 28), button: 2 }));
}

// ── the menu ──

export function ContextMenuHost() {
  const cur = useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => open);
  if (!cur) return null;
  return createPortal(<Panel key={cur.key} items={cur.items} x={cur.x} y={cur.y} depth={0} onClose={closeMenu} />, document.querySelector(".app") ?? document.body);
}

function Panel({ items, x, y, depth, onClose, onBack, flipLeft }: { items: MenuEntry[]; x: number; y: number; depth: number; onClose: () => void; onBack?: () => void; flipLeft?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [sub, setSub] = useState<{ index: number; x: number; y: number; left: number } | null>(null);
  const hoverTimer = useRef(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight, vw = window.innerWidth, vh = window.innerHeight, pad = 6;
    let left = x, top = y;
    if (left + w > vw - pad) left = flipLeft !== undefined ? Math.max(pad, flipLeft - w) : Math.max(pad, vw - w - pad);
    if (top + h > vh - pad) top = depth ? Math.max(pad, vh - h - pad) : Math.max(pad, y - h);
    setPos({ left, top });
  }, [x, y, depth, flipLeft]);

  useEffect(() => {
    if (depth) return;
    const down = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (t?.closest?.(".ctx")) return;
      const from = open?.from;
      if (e.button === 0 && from && from !== document.body && from.contains(t)) holdShut(from);
      onClose();
    };
    const away = () => onClose();
    document.addEventListener("mousedown", down, true);
    window.addEventListener("blur", away);
    window.addEventListener("resize", away);
    document.addEventListener("scroll", away, true);
    return () => { document.removeEventListener("mousedown", down, true); window.removeEventListener("blur", away); window.removeEventListener("resize", away); document.removeEventListener("scroll", away, true); };
  }, [depth, onClose]);

  // focus the first item so arrows work at once
  useEffect(() => { if (pos) (ref.current?.querySelector<HTMLElement>(".menu-i:not(:disabled)"))?.focus({ preventScroll: true }); }, [pos === null]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = items.filter((i): i is MenuItem | "-" | { header: string } => !!i)
    .filter((i, n, a) => i !== "-" || (n > 0 && n < a.length - 1 && a[n - 1] !== "-"));

  const openSub = (index: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setSub({ index, x: r.right - 4, y: r.top - 6, left: r.left + 4 });
  };

  const onKey = (e: ReactKeyboardEvent) => {
    const btns = [...(ref.current?.querySelectorAll<HTMLElement>(":scope > .menu > .menu-i:not(:disabled)") ?? [])];
    const i = btns.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => { e.preventDefault(); e.stopPropagation(); btns[(to + btns.length) % btns.length]?.focus(); };
    if (e.key === "ArrowDown") move(i + 1);
    else if (e.key === "ArrowUp") move(i - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(btns.length - 1);
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); (onBack ?? onClose)(); }
    else if (e.key === "ArrowLeft" && onBack) { e.preventDefault(); e.stopPropagation(); onBack(); }
    else if (e.key === "ArrowRight") {
      const el = document.activeElement as HTMLElement | null;
      const idx = Number(el?.dataset.idx ?? -1);
      const it = list[idx];
      if (el && it && it !== "-" && !("header" in it) && it.items) { e.preventDefault(); e.stopPropagation(); openSub(idx, el); }
    } else if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.altKey) {
      // type a letter to jump to the next item starting with it
      const k = e.key.toLowerCase();
      const start = Math.max(0, i + 1);
      const order = [...btns.slice(start), ...btns.slice(0, start)];
      const hit = order.find((b) => (b.textContent ?? "").trim().toLowerCase().startsWith(k));
      if (hit) { e.preventDefault(); hit.focus(); }
    }
  };

  return (
    <div ref={ref} className="popover ctx" role="menu" onKeyDown={onKey} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden", zIndex: 95 + depth }}>
      <div className="menu">
        {list.map((it, n) => {
          if (it === "-") return <hr key={`-${n}`} />;
          if ("header" in it) return <div key={`h${n}`} className="menu-h">{it.header}</div>;
          const hasSub = !!it.items && visible(it.items);
          return (
            <button key={`${it.label}-${n}`} type="button" role="menuitem" data-idx={n} className={`menu-i${it.danger ? " danger" : ""}${it.checked !== undefined ? " has-check" : ""}${sub?.index === n ? " on" : ""}`}
              disabled={it.disabled || (!!it.items && !hasSub)} title={it.title} aria-haspopup={hasSub ? "menu" : undefined} aria-checked={it.checked}
              onMouseEnter={(e) => {
                window.clearTimeout(hoverTimer.current);
                const el = e.currentTarget;
                hoverTimer.current = window.setTimeout(() => { if (hasSub) openSub(n, el); else setSub(null); }, hasSub ? 90 : 160);
              }}
              onClick={(e) => {
                if (hasSub) { openSub(n, e.currentTarget); return; }
                closeMenu();
                it.onClick?.();
              }}>
              {it.checked !== undefined ? <span className="menu-c" aria-hidden="true">{it.checked && <Icon name="check" />}</span> : null}
              {it.img ? <LazyImg className="menu-img" src={it.img} alt="" /> : it.icon ? <Icon name={it.icon} /> : it.checked === undefined ? <span className="menu-ni" aria-hidden="true" /> : null}
              <span className="menu-t">{it.label}</span>
              {it.keys && <kbd className="menu-k">{it.keys}</kbd>}
              {hasSub && <Icon name="chevron" className="menu-sub" />}
            </button>
          );
        })}
      </div>
      {sub && (() => {
        const it = list[sub.index];
        if (!it || it === "-" || "header" in it || !it.items) return null;
        return <Panel items={it.items} x={sub.x} y={sub.y} depth={depth + 1} flipLeft={sub.left} onClose={onClose}
          onBack={() => { const i = sub.index; setSub(null); window.setTimeout(() => ref.current?.querySelector<HTMLElement>(`[data-idx="${i}"]`)?.focus(), 0); }} />;
      })()}
    </div>
  );
}

/** A small wrapper that gives its child area a menu (for places that aren't a single element). */
export function WithMenu({ items, children, className }: { items: () => MenuEntry[]; children: ReactNode; className?: string }) {
  return <div className={className} onContextMenu={menuHandler(items)}>{children}</div>;
}
