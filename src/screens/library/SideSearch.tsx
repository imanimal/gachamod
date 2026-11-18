// The field over the list of characters down the left (the Character list and Three panes layouts) that narrows the
// list as you type. Arrow down or Enter goes to the first match, arrow up from the first match comes back, Esc clears.
// It is a plain text field, not a search box, so "/" and Ctrl+F still go to the page's search and it draws no key
// hint. Owner: LIBRARY area.
import { useLayoutEffect, useState, type KeyboardEvent, type Ref, type RefObject } from "react";
import { Icon } from "../../ui/Icon";
import { t } from "../../lib/i18n";

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** A test for names that hold every word typed, ignoring case and accents, or null when nothing is typed. */
export function matcher(query: string): ((name: string) => boolean) | null {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  return (name) => { const n = fold(name); return words.every((w) => n.includes(w)); };
}

/** True while `ref` is too narrow for the field: the narrow-window layout keeps only the pictures (library.css). */
export function useNarrow(ref: RefObject<HTMLElement | null>, on: boolean): boolean {
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!on || !el) return;
    const check = () => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      setNarrow(el.getBoundingClientRect().width < 7 * rem);
    };
    check();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, on]);
  return on && narrow;
}

/** Arrow up on the first item of `list` goes back to the field. True when it handled the key. */
export function upToField(e: KeyboardEvent, list: HTMLElement | null, selector: string, field: HTMLInputElement | null): boolean {
  if (e.key !== "ArrowUp" || !list || !field || e.altKey || e.ctrlKey || e.metaKey) return false;
  const first = list.querySelector<HTMLElement>(selector);
  if (!first || (e.target as HTMLElement).closest(selector) !== first) return false;
  e.preventDefault();
  field.focus();
  return true;
}

export function SideSearch({ value, onChange, list, selector, placeholder, ref }: {
  value: string; onChange: (v: string) => void;
  /** The list it narrows, and its items, for the arrow keys. */
  list: RefObject<HTMLElement | null>; selector: string;
  placeholder: string; ref?: Ref<HTMLInputElement>;
}) {
  const toFirst = () => { list.current?.querySelector<HTMLElement>(selector)?.focus(); };
  return (
    <label className="search lib-side-search" title={t("Shows only the names that match. Arrow down goes to the first one, Esc clears")}>
      <Icon name="search" />
      <input ref={ref} type="text" role="searchbox" value={value} placeholder={placeholder} aria-label={placeholder} spellCheck={false} autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "Enter") { e.preventDefault(); toFirst(); }
          else if (e.key === "Escape" && value) { e.preventDefault(); e.stopPropagation(); onChange(""); }
        }} />
      {value && <button type="button" className="search-x" aria-label={t("Clear")} title={t("Clear (Esc)")} onClick={() => onChange("")}><Icon name="x" /></button>}
    </label>
  );
}
