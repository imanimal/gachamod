// The UI kit: every screen builds from these, so the app looks and behaves the same everywhere and a theme only has
// to style this list of classes (docs/spec.md, "UI kit"). Props are the contract; markup may gain decoration spans.
import { useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./Icon";
import { leave } from "./motion";
import { STUCK_MS, seconds, useActivity, useElapsed } from "../lib/activity";

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");

// ── buttons ──

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type Size = "sm" | "md" | "lg";

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant; size?: Size; icon?: IconName; iconRight?: IconName; busy?: boolean;
};

/** A button with text. `primary` is for the one main action of a screen or dialog. */
export function Button({ variant = "secondary", size = "md", icon, iconRight, busy, children, className, disabled, type = "button", ...rest }: BtnProps) {
  return (
    <button type={type} className={cx("btn", `btn-${variant}`, `btn-${size}`, busy && "busy", className)} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy ? <Spinner /> : icon && <Icon name={icon} />}
      {children !== undefined && <span className="btn-t">{children}</span>}
      {iconRight && <Icon name={iconRight} className="btn-ir" />}
    </button>
  );
}

/** An icon-only button. `label` is its tooltip and accessible name. */
export function IconButton({ icon, label, variant = "ghost", size = "md", on, className, type = "button", ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string; variant?: ButtonVariant; size?: Size; on?: boolean }) {
  return (
    <button type={type} className={cx("ibtn", `btn-${variant}`, `btn-${size}`, on && "on", className)} aria-label={label} title={label} aria-pressed={on} {...rest}>
      <Icon name={icon} />
    </button>
  );
}

/** Runs an async job with the button busy meanwhile. */
export function useBusy(): [boolean, (job: () => Promise<unknown>) => Promise<void>] {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (job: () => Promise<unknown>) => {
    setBusy(true);
    try { await job(); } finally { setBusy(false); }
  }, []);
  return [busy, run];
}

// ── inputs ──

export function Toggle({ checked, onChange, label, hint, disabled, size = "md" }:
  { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; hint?: ReactNode; disabled?: boolean; size?: "sm" | "md" }) {
  return (
    <label className={cx("toggle", `toggle-${size}`, checked && "on", disabled && "off")}>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden="true"><span className="toggle-knob" /></span>
      {(label || hint) && <span className="toggle-l">{label && <span className="toggle-t">{label}</span>}{hint && <span className="hint">{hint}</span>}</span>}
    </label>
  );
}

export function Checkbox({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cx("check", checked && "on", disabled && "off")}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="check-box" aria-hidden="true"><Icon name="check" /></span>
      {label && <span className="check-t">{label}</span>}
    </label>
  );
}

export function Chip({ on, onClick, icon, img, count, children, title, className }:
  { on?: boolean; onClick?: () => void; icon?: IconName; img?: string | null; count?: number; children: ReactNode; title?: string; className?: string }) {
  return (
    <button type="button" className={cx("chip", on && "on", className)} onClick={onClick} title={title} aria-pressed={on}>
      {img ? <img className="chip-img" src={img} alt="" loading="lazy" /> : icon && <Icon name={icon} />}
      <span className="chip-t">{children}</span>
      {count !== undefined && <span className="chip-n">{count}</span>}
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label, size = "md" }:
  { value: T; options: Array<{ value: T; label: ReactNode; icon?: IconName; title?: string }>; onChange: (v: T) => void; label?: string; size?: Size }) {
  return (
    <div className={cx("seg", `seg-${size}`)} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={cx("seg-o", value === o.value && "on")}
          onClick={() => onChange(o.value)} title={o.title ?? (typeof o.label === "string" ? o.label : undefined)}>
          {o.icon && <Icon name={o.icon} />}{o.label !== "" && <span>{o.label}</span>}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, tabs, onChange }: { value: T; tabs: Array<{ value: T; label: ReactNode; icon?: IconName; count?: number; title?: string }>; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} type="button" role="tab" aria-selected={value === t.value} className={cx("tab", value === t.value && "on")} onClick={() => onChange(t.value)} title={t.title}>
          {t.icon && <Icon name={t.icon} />}<span>{t.label}</span>{t.count !== undefined && <span className="tab-n">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** A search box. "/" and Ctrl+F focus it (lib/keys.ts). */
export function SearchField({ value, onChange, placeholder = "Search", onEnter, autoFocus, className }:
  { value: string; onChange: (v: string) => void; placeholder?: string; onEnter?: () => void; autoFocus?: boolean; className?: string }) {
  return (
    <label className={cx("search", className)}>
      <Icon name="search" />
      <input type="search" value={value} placeholder={placeholder} autoFocus={autoFocus} spellCheck={false}
        onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onEnter?.(); if (e.key === "Escape" && value) { e.stopPropagation(); onChange(""); } }} />
      {value ? <button type="button" className="search-x" aria-label="Clear" title="Clear (Esc)" onClick={() => onChange("")}><Icon name="x" /></button> : <kbd className="search-k">/</kbd>}
    </label>
  );
}

/** A labelled text field. `multiline` makes a textarea. */
export function TextField({ label, value, onChange, placeholder, hint, multiline, type = "text", mono, onBlur, autoFocus, disabled, rows = 3 }:
  { label?: ReactNode; value: string; onChange: (v: string) => void; placeholder?: string; hint?: ReactNode; multiline?: boolean; type?: string; mono?: boolean; onBlur?: () => void; autoFocus?: boolean; disabled?: boolean; rows?: number }) {
  return (
    <label className={cx("field", mono && "mono")}>
      {label && <span className="field-l">{label}</span>}
      {multiline
        ? <textarea value={value} placeholder={placeholder} rows={rows} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} autoFocus={autoFocus} disabled={disabled} spellCheck={!mono} />
        : <input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} autoFocus={autoFocus} disabled={disabled} spellCheck={!mono} />}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function Select<T extends string>({ label, value, options, onChange, hint }:
  { label?: ReactNode; value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; hint?: ReactNode }) {
  return (
    <label className="field">
      {label && <span className="field-l">{label}</span>}
      <span className="select"><select value={value} onChange={(e) => onChange(e.target.value as T)}>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select><Icon name="down" /></span>
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

// ── layout ──

/** The top of every screen: title, a line under it, actions on the right, and optional content below (filters). */
export function PageHeader({ title, sub, icon, actions, children }: { title: ReactNode; sub?: ReactNode; icon?: IconName; actions?: ReactNode; children?: ReactNode }) {
  // once the page scrolls, a sticky header (the game themes have one) folds to its controls: is-stuck hides the
  // subtitle and keeps rows of chips on one line, so it takes a strip instead of a quarter of the window
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    const view = el?.closest(".view");
    if (!el || !view) return;
    let on = false;
    const check = () => {
      // on past 60px, off under 8: folding moves the page up a little, so one threshold would flicker
      const next = (on ? view.scrollTop > 8 : view.scrollTop > 60) && getComputedStyle(el).position === "sticky";
      if (next !== on) { on = next; el.classList.toggle("is-stuck", on); }
    };
    check();
    view.addEventListener("scroll", check, { passive: true });
    return () => view.removeEventListener("scroll", check);
  }, []);
  return (
    <header ref={ref} className="page-h">
      {typeof title === "string" && <span className="page-h-ghost" aria-hidden="true">{title}</span>}
      <div className="page-h-row">
        <div className="page-h-t">
          <h1>{icon && <Icon name={icon} />}<span>{title}</span></h1>
          {sub && <p className="page-h-sub">{sub}</p>}
        </div>
        {actions && <div className="page-h-a">{actions}</div>}
      </div>
      {children && <div className="page-h-more">{children}</div>}
    </header>
  );
}

/** A titled block of a screen. */
export function Panel({ title, icon, actions, children, className, id, flush, count }:
  { title?: ReactNode; icon?: IconName; actions?: ReactNode; children: ReactNode; className?: string; id?: string; flush?: boolean; count?: ReactNode }) {
  return (
    <section className={cx("panel", flush && "flush", className)} id={id}>
      {(title || actions) && (
        <header className="panel-h">
          {title && <h2 className="panel-t">{icon && <Icon name={icon} />}<span>{title}</span>{count !== undefined && <span className="panel-n">{count}</span>}</h2>}
          {actions && <div className="panel-a">{actions}</div>}
        </header>
      )}
      <div className="panel-b">{children}</div>
    </section>
  );
}

/** A clickable or static card. Grids of cards use `.cards` (auto-fill) on the parent. */
export function Card({ children, onClick, selected, className, style, title, disabled }:
  { children: ReactNode; onClick?: () => void; selected?: boolean; className?: string; style?: CSSProperties; title?: string; disabled?: boolean }) {
  if (onClick) {
    return <button type="button" className={cx("card", "card-btn", selected && "sel", className)} onClick={onClick} style={style} title={title} disabled={disabled}>{children}</button>;
  }
  return <div className={cx("card", selected && "sel", className)} style={style} title={title}>{children}</div>;
}

export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("toolbar", className)}>{children}</div>;
}

/** A label: value row for detail lists. */
export function Row({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return <div className="kv"><span className="kv-l">{label}</span><span className="kv-v">{children}</span>{hint && <span className="hint">{hint}</span>}</div>;
}

// ── status ──

export type Tone = "accent" | "ok" | "warn" | "bad" | "info" | "muted";

/** A small tag. With `onClick` it is a button that opens what it names (the mod's toggles, its conflicts): a tag
 *  that says something is there takes you to it. */
export function Badge({ tone = "muted", children, icon, title, onClick, className }: { tone?: Tone; children: ReactNode; icon?: IconName; title?: string; onClick?: (e: MouseEvent<HTMLButtonElement>) => void; className?: string }) {
  const cls = cx("badge", `t-${tone}`, className);
  if (onClick) return <button type="button" className={cls} title={title} onClick={onClick}>{icon && <Icon name={icon} />}{children}</button>;
  return <span className={cls} title={title}>{icon && <Icon name={icon} />}{children}</span>;
}

/** 0..1, or null for an unknown amount. */
export function Progress({ value, tone = "accent", label }: { value: number | null; tone?: Tone; label?: string }) {
  return (
    <div className={cx("progress", `t-${tone}`, value === null && "indet")} role="progressbar" aria-label={label}
      aria-valuenow={value === null ? undefined : Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <span className="progress-bar" style={value === null ? undefined : { width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

export function Spinner({ size }: { size?: number }) {
  return <span className="spin" aria-hidden="true" style={size ? { width: size, height: size } : undefined} />;
}

/** A wait that says what it's for. After a few seconds it counts up, and past ten it says what could be holding it:
 *  `hold`, or else whatever gachamod is waiting on right now (lib/activity.ts). `children` go below it (skeletons). */
export function Waiting({ what, hold, className, children }: { what: string; hold?: string; className?: string; children?: ReactNode }) {
  const [since] = useState(Date.now);
  const s = useElapsed(since);
  const running = useActivity()[0];
  const long = s * 1000 >= STUCK_MS;
  const why = hold ?? (running ? `It's waiting on this: ${running.what.toLowerCase()}. ${running.hold}`
    : "Nothing is running in the background, so this may be a fault in gachamod. Go to another page and back, or report it from Help.");
  return (
    <div className={cx("waiting", className)} role="status" aria-live="polite" aria-busy="true">
      <p className="waiting-t"><Spinner /><span>{what}{s >= 3 ? ` (${seconds(s)})` : ""}</span></p>
      {long && <p className="waiting-hold">{why}</p>}
      {children}
    </div>
  );
}

export function Skeleton({ w, h, round, className }: { w?: number | string; h?: number | string; round?: boolean; className?: string }) {
  return <span className={cx("skel", round && "round", className)} style={{ width: w, height: h }} aria-hidden="true" />;
}

export function Empty({ icon, title, children, actions }: { icon: IconName; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-i"><Icon name={icon} /></span>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {actions && <div className="empty-a">{actions}</div>}
    </div>
  );
}

/** A round picture with initials when there is none. `ring` draws an accent ring (current, active). */
export function Avatar({ src, name, size = 40, ring, square, className }: { src?: string | null; name: string; size?: number; ring?: boolean; square?: boolean; className?: string }) {
  const [broken, setBroken] = useState(false);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
  return (
    <span className={cx("avatar", ring && "ring", square && "square", className)} style={{ width: size, height: size, fontSize: size * 0.38 }} title={name}>
      {src && !broken ? <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} /> : <span className="avatar-t">{initials}</span>}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) { return <kbd className="kbd">{children}</kbd>; }

// ── layers ──

function useEscape(on: boolean, close: () => void) {
  useEffect(() => {
    if (!on) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [on, close]);
}

const layerHost = () => document.querySelector(".app") ?? document.body;

/** A centred window over a scrim. `locked` says why it can't close yet (work is running). */
export function Dialog({ title, icon, onClose, children, footer, size = "md", locked, className }:
  { title: ReactNode; icon?: IconName; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: "sm" | "md" | "lg" | "xl"; locked?: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => { if (!locked) leave(ref.current, onClose); }, [onClose, locked]);
  useEscape(true, close);
  return createPortal(
    <div ref={ref} className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <section className={cx("dialog", `dialog-${size}`, className)} role="dialog" aria-modal="true">
        <header className="dialog-h">
          <h2>{icon && <Icon name={icon} />}<span>{title}</span></h2>
          <IconButton icon="x" label={locked ?? "Close (Esc)"} onClick={close} disabled={!!locked} />
        </header>
        <div className="dialog-b">{children}</div>
        {footer && <footer className="dialog-f">{footer}</footer>}
      </section>
    </div>, layerHost());
}

/** A panel that slides in from the right (mod details, a GameBanana page). */
export function Drawer({ title, onClose, children, footer, width = "min(46rem, 92vw)", actions, className }:
  { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: string; actions?: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => leave(ref.current, onClose), [onClose]);
  useEscape(true, close);
  return createPortal(
    <div ref={ref} className="overlay overlay-side" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <aside className={cx("drawer", className)} style={{ width }} role="dialog" aria-modal="true">
        <header className="drawer-h">
          <h2>{title}</h2>
          {actions}
          <IconButton icon="x" label="Close (Esc)" onClick={close} />
        </header>
        <div className="drawer-b">{children}</div>
        {footer && <footer className="drawer-f">{footer}</footer>}
      </aside>
    </div>, layerHost());
}

/** A yes/no question. Use only for things that can't be undone; everything else acts and offers Undo. */
export function Confirm({ title, children, yes = "OK", danger, onYes, onClose }:
  { title: string; children?: ReactNode; yes?: string; danger?: boolean; onYes: () => void | Promise<void>; onClose: () => void }) {
  const [busy, run] = useBusy();
  return (
    <Dialog title={title} onClose={onClose} size="sm" footer={<>
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button variant={danger ? "danger" : "primary"} busy={busy} autoFocus onClick={() => void run(async () => { await onYes(); onClose(); })}>{yes}</Button>
    </>}>
      {children}
    </Dialog>
  );
}

/** A menu of actions for a Popover (ui/Popover.tsx). */
export function Menu({ items }: { items: Array<{ label: string; icon?: IconName; onClick: () => void; danger?: boolean; disabled?: boolean; hint?: string } | "-"> }) {
  return (
    <div className="menu" role="menu">
      {items.map((it, i) => it === "-" ? <hr key={i} /> : (
        <button key={it.label} type="button" role="menuitem" className={cx("menu-i", it.danger && "danger")} disabled={it.disabled} onClick={it.onClick} title={it.hint}>
          {it.icon && <Icon name={it.icon} />}<span>{it.label}</span>
        </button>
      ))}
    </div>
  );
}

// ── formatting ──

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(n);
}

export function formatBytes(bytes: number): string {
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0, v = bytes;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

/** "3 days ago", "just now", from unix seconds. */
export function timeAgo(unixSecs: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor(now / 1000 - unixSecs));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24); if (d < 30) return d === 1 ? "yesterday" : `${d} days ago`;
  const mo = Math.floor(d / 30); if (mo < 12) return mo === 1 ? "a month ago" : `${mo} months ago`;
  const y = Math.floor(d / 365); return y <= 1 ? "a year ago" : `${y} years ago`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
