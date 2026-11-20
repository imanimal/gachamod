// The UI kit: every screen builds from these, so the app looks and behaves the same everywhere and a theme only has
// to style this list of classes (docs/spec.md, "UI kit"). Props are the contract; markup may gain decoration spans.
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type KeyboardEvent as KeyEvent, type MouseEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./Icon";
import { leave } from "./motion";
import { STUCK_MS, seconds, useActivity, useElapsed } from "../lib/activity";
import { LazyImg } from "./LazyImg";
import { Popover } from "./Popover";
import { openFeedback } from "../lib/feedback";
import { t, tn } from "../lib/i18n";

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

/** `onChange` gets whether Shift was held (Shift+click on a mod's switch keeps its character's other mods on).
 *  `ariaLabel` names a switch that has no `label` of its own. */
/** The id of a row label that names the control in it (a settings row's title), so a bare Toggle there gets a name. */
export const RowLabel = createContext<string | undefined>(undefined);

export function Toggle({ checked, onChange, label, hint, disabled, size = "md", title, ariaLabel }:
  { checked: boolean; onChange: (v: boolean, shift: boolean) => void; label?: ReactNode; hint?: ReactNode; disabled?: boolean; size?: "sm" | "md"; title?: string; ariaLabel?: string }) {
  const rowLabel = useContext(RowLabel);
  const labelledBy = !ariaLabel && !label ? rowLabel : undefined;
  return (
    <label className={cx("toggle", `toggle-${size}`, checked && "on", disabled && "off")} title={title}>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} aria-label={ariaLabel} aria-labelledby={labelledBy} onChange={(e) => onChange(e.target.checked, (e.nativeEvent as { shiftKey?: boolean }).shiftKey === true)} />
      <span className="toggle-track" aria-hidden="true"><span className="toggle-knob" /></span>
      {(label || hint) && <span className="toggle-l">{label && <span className="toggle-t">{label}</span>}{hint && <span className="hint">{hint}</span>}</span>}
    </label>
  );
}

export function Checkbox({ checked, onChange, label, disabled, title }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean; title?: string }) {
  return (
    <label className={cx("check", checked && "on", disabled && "off")} title={title}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="check-box" aria-hidden="true"><Icon name="check" /></span>
      {label && <span className="check-t">{label}</span>}
    </label>
  );
}

export function Chip({ on, onClick, onContextMenu, icon, img, count, children, title, className }:
  { on?: boolean; onClick?: () => void; onContextMenu?: (e: MouseEvent<HTMLElement>) => void; icon?: IconName; img?: string | null; count?: number; children: ReactNode; title?: string; className?: string }) {
  return (
    <button type="button" className={cx("chip", on && "on", className)} onClick={onClick} onContextMenu={onContextMenu} title={title ?? (typeof children === "string" ? children : undefined)} aria-pressed={on}>
      {img ? <LazyImg className="chip-img" src={img} alt="" /> : icon && <Icon name={icon} />}
      <span className="chip-t">{children}</span>
      {count !== undefined && <span className="chip-n">{count}</span>}
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label, size = "md", disabled }:
  { value: T; options: Array<{ value: T; label: ReactNode; icon?: IconName; title?: string }>; onChange: (v: T) => void; label?: string; size?: Size; disabled?: boolean }) {
  return (
    <div className={cx("seg", `seg-${size}`)} role="radiogroup" aria-label={label} aria-disabled={disabled || undefined}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={cx("seg-o", value === o.value && "on")} disabled={disabled}
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
      {tabs.map((tab) => (
        <button key={tab.value} type="button" role="tab" aria-selected={value === tab.value} className={cx("tab", value === tab.value && "on")} onClick={() => onChange(tab.value)} title={tab.title}>
          {tab.icon && <Icon name={tab.icon} />}<span>{tab.label}</span>{tab.count !== undefined && <span className="tab-n">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** A search box. "/" and Ctrl+F focus it (lib/keys.ts). ArrowDown runs `onDown`, or `onEnter` when there is none,
 *  so it can move to the results. */
export function SearchField({ value, onChange, placeholder = t("Search"), onEnter, onDown, autoFocus, className, title }:
  { value: string; onChange: (v: string) => void; placeholder?: string; onEnter?: () => void; onDown?: () => void; autoFocus?: boolean; className?: string; title?: string }) {
  return (
    <label className={cx("search", className)} title={title}>
      <Icon name="search" />
      <input type="search" value={value} placeholder={placeholder} autoFocus={autoFocus} spellCheck={false}
        onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => {
          if (e.key === "Enter") onEnter?.();
          if (e.key === "ArrowDown" && (onDown ?? onEnter)) { e.preventDefault(); (onDown ?? onEnter)!(); }
          if (e.key === "Escape" && value) { e.stopPropagation(); onChange(""); }
        }} />
      {value ? <button type="button" className="search-x" aria-label={t("Clear")} title={t("Clear (Esc)")} onClick={() => onChange("")}><Icon name="x" /></button> : <kbd className="search-k">/</kbd>}
    </label>
  );
}

/** A labelled text field. `multiline` makes a textarea. */
/** A text box. `suggest`: an example shown as the placeholder; while the box is empty, Tab or the Tab chip at its end
 *  fills it in. */
export function TextField({ label, value, onChange, placeholder, hint, multiline, type = "text", mono, onBlur, autoFocus, disabled, rows = 3, suggest }:
  { label?: ReactNode; value: string; onChange: (v: string) => void; placeholder?: string; hint?: ReactNode; multiline?: boolean; type?: string; mono?: boolean; onBlur?: () => void; autoFocus?: boolean; disabled?: boolean; rows?: number; suggest?: string }) {
  // the hint sits outside the label, so it is read as the field's description and not as part of its name
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const box = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const offer = !!suggest && !value && !disabled;
  const fill = () => {
    onChange(suggest!);
    // the caret goes after the example, ready to change it
    requestAnimationFrame(() => { const el = box.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } });
  };
  const onKeyDown = (e: KeyEvent) => {
    if (offer && e.key === "Tab" && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.nativeEvent.isComposing) { e.preventDefault(); fill(); }
  };
  const common = { id, value, placeholder: suggest ?? placeholder, onBlur, autoFocus, disabled, spellCheck: !mono, "aria-describedby": hintId, ref: box, onKeyDown };
  const field = multiline
    ? <textarea {...common} rows={rows} onChange={(e) => onChange(e.target.value)} />
    : <input {...common} type={type} onChange={(e) => onChange(e.target.value)} />;
  return (
    <div className={cx("field", mono && "mono")}>
      {label && <label className="field-l" htmlFor={id}>{label}</label>}
      {suggest ? (
        <span className={cx("field-box", multiline && "multi", offer && "offer")}>
          {field}
          {offer && <button type="button" className="field-suggest" onClick={fill} title={t("Use this example (Tab)")} aria-label={t("Use the example: {text}", { text: suggest })}><kbd>Tab</kbd></button>}
        </span>
      ) : field}
      {hint && <span className="hint" id={hintId}>{hint}</span>}
    </div>
  );
}

/** A drop-down list. Clicking it, Enter, Space or A on a controller opens a menu of the options by it (the system's
 *  own list can't be opened from a controller). `title` is a hover tip, and the accessible name when there is no
 *  `label`; with neither, a settings row's title names it (RowLabel). */
export function Select<T extends string>({ label, value, options, onChange, hint, disabled, title }:
  { label?: ReactNode; value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; hint?: ReactNode; disabled?: boolean; title?: string }) {
  const rowLabel = useContext(RowLabel);
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const [open, setOpen] = useState<HTMLSelectElement | null>(null);
  // a second click, Enter or Space on the list closes the menu it opened
  const toggle = (el: HTMLSelectElement) => { if (!disabled) setOpen((o) => (o ? null : el)); };
  const name = typeof label === "string" ? label : title;
  return (
    <div className="field" title={title}>
      {label && <label className="field-l" htmlFor={id}>{label}</label>}
      <span className="select">
        <select id={id} value={value} disabled={disabled} aria-label={label ? undefined : title} aria-labelledby={!label && !title ? rowLabel : undefined}
          aria-describedby={hintId} onChange={(e) => onChange(e.target.value as T)}
          // the system's list opens on mousedown: stop it there and open the app's menu on click instead
          onMouseDown={(e) => { if (e.button !== 0) return; e.preventDefault(); e.currentTarget.focus({ preventScroll: true }); }}
          onClick={(e) => toggle(e.currentTarget)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " " || e.key === "F4" || (e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp"))) { e.preventDefault(); toggle(e.currentTarget); }
          }}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <Icon name="down" />
      </span>
      {hint && <span className="hint" id={hintId}>{hint}</span>}
      {open && (
        <Popover anchor={open} onClose={() => setOpen(null)} role="menu" label={name} labelledBy={name ? undefined : rowLabel}
          align="start" width={`${Math.max(open.offsetWidth, 160)}px`}>
          {/* the .menu wrapper takes the same theme rules as every other menu; the popover stays the menu role */}
          <div className="menu" role="none">
            {options.map((o) => (
              <button key={o.value} type="button" role="menuitemradio" aria-checked={o.value === value} className={cx("menu-i", o.value === value && "on")}
                onClick={() => { setOpen(null); if (o.value !== value) onChange(o.value); }}>
                <span className="menu-c">{o.value === value && <Icon name="check" />}</span>
                <span className="menu-t">{o.label}</span>
              </button>
            ))}
          </div>
        </Popover>
      )}
    </div>
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
    const view = el?.closest<HTMLElement>(".view");
    if (!el || !view) return;
    let on = false;
    // Folding takes height out of the page (a lot when every character chip is showing). The scroll moves by that
    // height so the mods stay put, and the header only folds when that move still leaves it well past the unfold
    // line. Otherwise fold and unfold would trigger each other and throw the page back to the top.
    let need = 60; // scroll needed before folding: 60 plus the height the fold takes, learned on each fold
    const set = (v: boolean) => {
      const h = el.offsetHeight;
      const s = view.scrollTop;
      const anchor = view.style.overflowAnchor;
      view.style.overflowAnchor = "none";
      el.classList.toggle("is-stuck", v);
      const lost = v ? h - el.offsetHeight : el.offsetHeight - h;
      need = 60 + Math.max(0, lost);
      if (v && s - lost < 60) el.classList.remove("is-stuck"); // not far enough yet, leave the page as it was
      else { on = v; view.scrollTop = v ? s - lost : s + lost; }
      view.style.overflowAnchor = anchor;
    };
    const check = () => {
      const sticky = getComputedStyle(el).position === "sticky";
      if (on && (!sticky || view.scrollTop <= 8)) set(false);
      else if (!on && sticky && view.scrollTop > need) set(true);
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
  const fault = !hold && !running;
  const why = hold ?? (running ? t("It's waiting on this: {what}. {hold}", { what: running.what.toLowerCase(), hold: running.hold })
    : t("Nothing is running in the background, so this may be a fault in gachamod. Go to another page and back, or send feedback."));
  return (
    <div className={cx("waiting", className)} role="status" aria-live="polite" aria-busy="true">
      <p className="waiting-t"><Spinner /><span>{what}{s >= 3 ? ` (${seconds(s)})` : ""}</span></p>
      {long && <p className="waiting-hold">{why}</p>}
      {long && fault && <Button size="sm" icon="help" onClick={() => openFeedback({ text: t("Stuck on \"{what}\" for {time}.", { what, time: seconds(s) }) })}>{t("Send feedback")}</Button>}
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
      {src && !broken ? <LazyImg src={src} alt="" onError={() => setBroken(true)} /> : <span className="avatar-t">{initials}</span>}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) { return <kbd className="kbd">{children}</kbd>; }

// ── layers ──

/** Escape closes the layer, but only while its `.overlay` is the top one: with a dialog open over a drawer, one
 *  press closes the dialog and leaves the drawer. Every layer listens on window, so stopping the event can't do this. */
function useEscape(layer: RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const layers = document.querySelectorAll(".overlay");
      if (!layer.current || layers[layers.length - 1] !== layer.current) return;
      e.stopPropagation();
      close();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [layer, close]);
}

const layerHost = () => document.querySelector(".app") ?? document.body;

export const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
/** True when a window or drawer is open and `el` is on the screen behind it, so its keys shouldn't act. */
export function behindLayer(el: Element): boolean {
  const layers = document.querySelectorAll(".overlay");
  const top = layers[layers.length - 1];
  return !!top && !top.contains(el);
}

const shown = (el: HTMLElement) => el.offsetParent !== null || el.getClientRects().length > 0;

/** Keyboard focus for a window or drawer: it moves in when the layer opens (unless something inside took it with
 *  autoFocus), Tab and Shift+Tab go round inside it while it is the top layer, and closing puts focus back on
 *  whatever opened it. `box` is the window itself, `layer` the overlay around it. */
function useLayerFocus(box: RefObject<HTMLElement | null>, layer: RefObject<HTMLElement | null>) {
  // read during the first render, before any autoFocus inside the layer moves it
  const [opener] = useState(() => document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null);
  useEffect(() => {
    const el = box.current;
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
    const tab = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return;
      const own = layer.current, inner = box.current;
      if (!own || !inner) return;
      // only the layer on top, and not while a menu that floats above it has the keys
      const layers = document.querySelectorAll(".lightbox, .overlay");
      if (layers[layers.length - 1] !== own) return;
      const at = document.activeElement as HTMLElement | null;
      if (at && !own.contains(at) && at.closest(".popover, .ctx")) return;
      const items = [...inner.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(shown);
      if (!items.length) { e.preventDefault(); inner.focus({ preventScroll: true }); return; }
      const first = items[0]!, last = items[items.length - 1]!;
      const inside = !!at && inner.contains(at);
      if (e.shiftKey ? (!inside || at === first || at === inner) : (!inside || at === last)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    };
    window.addEventListener("keydown", tab);
    return () => {
      window.removeEventListener("keydown", tab);
      // back to the opener once the layer is gone, unless focus already went somewhere on purpose
      const now = document.activeElement;
      const lost = !now || now === document.body || !now.isConnected || !!(box.current && box.current.contains(now));
      if (lost && opener?.isConnected) window.setTimeout(() => {
        const a = document.activeElement;
        if ((!a || a === document.body) && opener.isConnected) opener.focus({ preventScroll: true });
      }, 0);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

/** A centred window over a scrim. `locked` says why it can't close yet (work is running). */
export function Dialog({ title, icon, onClose, children, footer, size = "md", locked, className }:
  { title: ReactNode; icon?: IconName; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: "sm" | "md" | "lg" | "xl"; locked?: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLElement>(null);
  const close = useCallback(() => { if (!locked) leave(ref.current, onClose); }, [onClose, locked]);
  const titleId = useId();
  useEscape(ref, close);
  useLayerFocus(box, ref);
  return createPortal(
    <div ref={ref} className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <section ref={box} className={cx("dialog", `dialog-${size}`, className)} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} style={{ outline: "none" }}>
        <header className="dialog-h">
          <h2 id={titleId}>{icon && <Icon name={icon} />}<span>{title}</span></h2>
          <IconButton icon="x" label={locked ?? t("Close (Esc)")} onClick={close} disabled={!!locked} />
        </header>
        <div className="dialog-b">{children}</div>
        {footer && <footer className="dialog-f">{footer}</footer>}
      </section>
    </div>, layerHost());
}

/** A panel that slides in from the right (mod details, a GameBanana page). */
interface DrawerProps { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: string; actions?: ReactNode; className?: string;
  /** Drawn in the page as a pane (the "Three panes" Mods layout) instead of sliding in over it: no layer, focus stays
   *  where it was, and Escape closes it only from inside. */
  docked?: boolean }

/** A panel at the right edge with a title, a close button and an optional footer. */
export function Drawer(props: DrawerProps) {
  return props.docked ? <DockedDrawer {...props} /> : <LayerDrawer {...props} />;
}

function DockedDrawer({ title, onClose, children, footer, actions, className }: DrawerProps) {
  const box = useRef<HTMLElement>(null);
  const titleId = useId();
  const close = () => {
    // a field that saves when it loses focus saves now, before the pane empties
    const a = document.activeElement;
    if (a instanceof HTMLElement && box.current?.contains(a)) a.blur();
    onClose();
  };
  return (
    <aside ref={box} className={cx("drawer", "is-docked", className)} aria-labelledby={titleId}
      onKeyDown={(e) => { if (e.key === "Escape" && !e.defaultPrevented && !behindLayer(e.currentTarget)) { e.stopPropagation(); close(); } }}>
      <header className="drawer-h">
        <h2 id={titleId}>{title}</h2>
        {actions}
        <IconButton icon="x" label={t("Close (Esc)")} onClick={close} />
      </header>
      <div className="drawer-b">{children}</div>
      {footer && <footer className="drawer-f">{footer}</footer>}
    </aside>
  );
}

function LayerDrawer({ title, onClose, children, footer, width = "min(46rem, 92vw)", actions, className }: DrawerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLElement>(null);
  const close = useCallback(() => {
    // a field that saves when it loses focus (a mod's name, notes, tags) saves now, before the drawer goes
    const a = document.activeElement;
    if (a instanceof HTMLElement && box.current?.contains(a)) { a.blur(); box.current.focus({ preventScroll: true }); }
    leave(ref.current, onClose);
  }, [onClose]);
  const titleId = useId();
  useEscape(ref, close);
  useLayerFocus(box, ref);
  return createPortal(
    <div ref={ref} className="overlay overlay-side" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <aside ref={box} className={cx("drawer", className)} style={{ width, outline: "none" }} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className="drawer-h">
          <h2 id={titleId}>{title}</h2>
          {actions}
          <IconButton icon="x" label={t("Close (Esc)")} onClick={close} />
        </header>
        <div className="drawer-b">{children}</div>
        {footer && <footer className="drawer-f">{footer}</footer>}
      </aside>
    </div>, layerHost());
}

/** A yes/no question. Use only for things that can't be undone; everything else acts and offers Undo. */
export function Confirm({ title, children, yes = t("OK"), danger, onYes, onClose }:
  { title: string; children?: ReactNode; yes?: string; danger?: boolean; onYes: () => void | Promise<void>; onClose: () => void }) {
  const [busy, run] = useBusy();
  return (
    <Dialog title={title} onClose={onClose} size="sm" footer={<>
      {/* a risky question starts on Cancel, so a stray Enter or A press doesn't do it */}
      <Button variant="ghost" autoFocus={danger} onClick={onClose}>{t("Cancel")}</Button>
      <Button variant={danger ? "danger" : "primary"} busy={busy} autoFocus={!danger} onClick={() => void run(async () => { await onYes(); onClose(); })}>{yes}</Button>
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
  if (s < 60) return t("just now");
  const m = Math.floor(s / 60); if (m < 60) return tn(m, "{n} min ago", "{n} min ago");
  const h = Math.floor(m / 60); if (h < 24) return tn(h, "{n} h ago", "{n} h ago");
  const d = Math.floor(h / 24); if (d < 30) return d === 1 ? t("yesterday") : tn(d, "{n} day ago", "{n} days ago");
  const mo = Math.floor(d / 30); if (mo < 12) return mo === 1 ? t("a month ago") : tn(mo, "{n} month ago", "{n} months ago");
  const y = Math.floor(d / 365); return y <= 1 ? t("a year ago") : tn(y, "{n} year ago", "{n} years ago");
}

