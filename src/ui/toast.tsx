// Toasts: short messages at the bottom of the window. One can carry an action (Undo, Redo, Open); an Undo toast
// turns into a Redo toast once used, like mail apps do. A toast holds still while the pointer is on it or one of its
// buttons has focus (F6 or the controller's View + Y reach the newest one, lib/keys.ts).
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { english, t, tb } from "../lib/i18n";

export interface ToastAction { label: string; run: () => void | Promise<void> }
/** `keep`: newer toasts never push it out (a one-time offer); it still times out. `onEnd` runs once when it leaves
 *  for any reason: used, dismissed, timed out or pushed out. */
export interface ToastOpts { keep?: boolean; onEnd?: () => void }
/** A toast's tone: true for a failure, "info" for news that isn't a confirmation (a new version, Starting). */
export type ToastTone = boolean | "info";
type Toast = { id: number; text: string; bad?: boolean; info?: boolean; action?: ToastAction; more?: ToastAction; ms: number; keep?: boolean; leaving?: boolean };
let next = 1;
const MAX = 4;
const subs = new Set<(t: Toast) => void>();
const updates = new Set<(id: number, patch: Partial<Toast>) => void>();
const removers = new Set<(id: number) => void>();
const live = new Set<number>();
/** The text of each toast on screen, so the same message twice refreshes the one showing instead of stacking. */
const texts = new Map<number, string>();
const ends = new Map<number, () => void>();
/** A toast is gone: forget it and run its onEnd. Safe to call twice. */
function ended(id: number) {
  live.delete(id);
  texts.delete(id);
  const f = ends.get(id);
  ends.delete(id);
  f?.();
}
const lifetime = (action?: ToastAction, bad?: boolean) => (action ? 9000 : bad ? 7000 : 4600);

const helpers: Array<{ test: (text: string) => boolean; action: ToastAction }> = [];
/** Give every toast whose text passes `test`, and has no button of its own, this button. The F10 note from the
 *  backend gets "Restart as administrator" this way (lib/elevation.ts). */
export function toastHelper(test: (text: string) => boolean, action: ToastAction) { helpers.push({ test, action }); }

/** Hears every toast as it shows, with its English (the console in src/dev/console logs them). */
const shown = new Set<(text: string, en: string, bad: boolean, action?: string) => void>();
export function onToastShown(f: (text: string, en: string, bad: boolean, action?: string) => void): () => void { shown.add(f); return () => { shown.delete(f); }; }

/** Show a short message. `tone`: true for a failure, "info" for news rather than a confirmation. With an action, it
 *  stays longer and offers its button; `more` adds a second, quieter one ("Don't show again"). Returns its id. */
export function toast(text: string, tone: ToastTone = false, action?: ToastAction, more?: ToastAction, opts?: ToastOpts): number {
  const bad = tone === true, info = tone === "info";
  // a message from the backend may still be English: show it in the user's language, but match helpers by its words
  text = tb(text);
  const en = english(text);
  shown.forEach((f) => f(text, en, bad, action?.label));
  action ??= helpers.find((h) => h.test(en))?.action;
  // the same message while it still shows (a retry, a key held down): restart that one
  if (!opts) {
    for (const [id, t] of texts) {
      if (t === text && live.has(id) && retoast(id, text, action, bad)) return id;
    }
  }
  const t: Toast = { id: next++, text, bad, info, action, more, ms: lifetime(action, bad), keep: opts?.keep };
  texts.set(t.id, text);
  if (opts?.onEnd) ends.set(t.id, opts.onEnd);
  subs.forEach((s) => s(t));
  return t.id;
}
/** Change a toast in place (an Undo that became a Redo, a count going up) and restart its timer. `more` replaces
 *  the second button when given. False when it has gone. */
export function retoast(id: number, text: string, action?: ToastAction, bad = false, more?: ToastAction): boolean {
  if (!live.has(id)) return false;
  text = tb(text);
  texts.set(id, text);
  updates.forEach((u) => u(id, { text, action, bad, ms: lifetime(action, bad), ...(more ? { more } : {}) }));
  return true;
}
/** Take a toast away now (its button did what it offered). */
export function dismissToast(id: number) {
  if (!live.has(id)) return;
  removers.forEach((r) => r(id));
}

export function Toasts() {
  const [list, setList] = useState<Toast[]>([]);
  const timers = useRef(new Map<number, number>());
  // why each toast holds still: "hover", "focus"
  const holds = useRef(new Map<number, Set<string>>());
  const leaveRef = useRef<(id: number) => void>(() => {});
  const listRef = useRef(list);
  listRef.current = list;
  useEffect(() => {
    const arm = (t: Toast, ms = t.ms) => {
      const old = timers.current.get(t.id);
      if (old) clearTimeout(old);
      timers.current.delete(t.id);
      if (holds.current.get(t.id)?.size) return;
      timers.current.set(t.id, window.setTimeout(() => leave(t.id), ms));
    };
    const leave = (id: number) => {
      ended(id);
      holds.current.delete(id);
      const old = timers.current.get(id);
      if (old) clearTimeout(old);
      timers.current.delete(id);
      setList((l) => l.map((x) => x.id === id ? { ...x, leaving: true } : x));
      window.setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), 220);
    };
    leaveRef.current = leave;
    const add = (t: Toast) => {
      live.add(t.id);
      setList((l) => {
        const shown = l.filter((x) => !x.leaving);
        // the newest ones stay, and kept ones never go: drop the oldest of the rest
        const kept = shown.filter((x) => x.keep);
        const rest = shown.filter((x) => !x.keep);
        const room = Math.max(0, MAX - 1 - kept.length);
        const stay = new Set([...kept, ...rest.slice(rest.length - room)]);
        const out = shown.filter((x) => stay.has(x));
        for (const x of shown) if (!stay.has(x)) { ended(x.id); holds.current.delete(x.id); const tm = timers.current.get(x.id); if (tm) clearTimeout(tm); timers.current.delete(x.id); }
        return [...out, t];
      });
      arm(t);
    };
    const patch = (id: number, p: Partial<Toast>) => setList((l) => l.map((x) => { if (x.id !== id) return x; const n = { ...x, ...p, leaving: false }; arm(n); return n; }));
    const remove = (id: number) => leave(id);
    subs.add(add); updates.add(patch); removers.add(remove);
    return () => { subs.delete(add); updates.delete(patch); removers.delete(remove); };
  }, []);

  const hold = (id: number, why: string, on: boolean) => {
    if (!listRef.current.some((x) => x.id === id && !x.leaving)) return;
    const set = holds.current.get(id) ?? new Set<string>();
    if (on) set.add(why); else set.delete(why);
    holds.current.set(id, set);
    const old = timers.current.get(id);
    if (old) clearTimeout(old);
    timers.current.delete(id);
    // let go: a short while longer to finish reading
    if (!set.size) timers.current.set(id, window.setTimeout(() => leaveRef.current(id), 2400));
  };
  const close = (id: number) => { ended(id); setList((l) => l.filter((x) => x.id !== id)); };

  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((item) => (
        <div key={item.id} className={`toast${item.bad ? " bad" : item.info ? " info" : ""}${item.action ? " act" : ""}${item.leaving ? " gone" : ""}`}
          onMouseEnter={() => hold(item.id, "hover", true)} onMouseLeave={() => hold(item.id, "hover", false)}
          onFocus={() => hold(item.id, "focus", true)}
          onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) hold(item.id, "focus", false); }}>
          <Icon name={item.bad ? "warn" : english(item.action?.label ?? "") === "Redo" ? "redo" : item.info ? "info" : "check"} />
          <span className="tt" key={item.text} title={item.text.length > 110 ? item.text : undefined}>{item.text}</span>
          {item.action && <button type="button" className="toast-act" onClick={() => void item.action!.run()}>{item.action.label}</button>}
          {item.more && <button type="button" className="toast-act toast-more" onClick={() => { void item.more!.run(); close(item.id); }}>{item.more.label}</button>}
          <button type="button" className="toast-x" aria-label={t("Dismiss")} title={t("Dismiss")} onClick={() => close(item.id)}><Icon name="x" size={12} /></button>
          <i key={`${item.text}-${item.ms}`} className="t-life" style={{ animationDuration: `${item.ms}ms` }} aria-hidden="true" />
        </div>
      ))}
    </div>
  );
}
