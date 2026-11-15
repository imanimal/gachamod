// The command palette (Ctrl+K, the title bar's search box, or onApp "palette" with text): one forgiving search over
// every page, action, setting, character, mod, profile, game and creator other areas register (lib/search.ts).
// Empty, it shows recent picks and the pages. Arrows move, Enter runs, Tab and Shift+Tab jump between sections,
// Escape closes; a controller moves with the D-pad, A runs, B closes. Owner: SHELL area.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { commandSources, noteRecent, recentIds, scoreCommand, type Command } from "../lib/search";
import { onApp } from "../lib/store";
import { Icon } from "../ui/Icon";
import { LazyImg } from "../ui/LazyImg";

const ORDER = ["Recent", "Pages", "Actions", "Characters", "Mods", "Profiles", "Settings", "Creators", "Games"];
const PER_SECTION = 6;
const PER_SECTION_ALONE = 30;

interface Group { section: string; items: Command[] }

async function gather(query: string): Promise<Command[]> {
  const all = await Promise.all(commandSources().map(async (src) => { try { return await src(query); } catch { return []; } }));
  const seen = new Set<string>();
  return all.flat().filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
}

function rank(query: string, list: Command[]): Group[] {
  if (!query.trim()) {
    const byId = new Map(list.map((c) => [c.id, c]));
    const recent = recentIds().map((id) => byId.get(id)).filter((c): c is Command => !!c).slice(0, 6);
    const used = new Set(recent.map((c) => c.id));
    const pages = list.filter((c) => c.section === "Pages" && !used.has(c.id)).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0)).slice(0, 8);
    return [{ section: "Recent", items: recent }, { section: "Pages", items: pages }].filter((g) => g.items.length);
  }
  const scored = list.map((c) => ({ c, s: scoreCommand(query, c) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  const groups = new Map<string, Array<{ c: Command; s: number }>>();
  for (const x of scored) { const g = groups.get(x.c.section) ?? []; g.push(x); groups.set(x.c.section, g); }
  const alone = groups.size === 1;
  // the section holding the best match leads; the rest follow in the usual order
  return [...groups.entries()]
    .sort((a, b) => (b[1][0]!.s - a[1][0]!.s) || (idx(a[0]) - idx(b[0])))
    .map(([section, xs]) => ({ section, items: xs.slice(0, alone ? PER_SECTION_ALONE : PER_SECTION).map((x) => x.c) }));
}
const idx = (s: string) => { const i = ORDER.indexOf(s); return i < 0 ? ORDER.length : i; };

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [cmds, setCmds] = useState<Command[]>([]);
  const [sel, setSel] = useState(0);
  const [focusTick, setFocusTick] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const back = useRef<Element | null>(null);
  const seq = useRef(0);
  // opened by typing: the caret goes after the typed letter instead of selecting it
  const keepText = useRef(false);

  useEffect(() => onApp((e) => {
    if (e.type !== "palette") return;
    if (!open) back.current = document.activeElement;
    setText(e.text ?? "");
    keepText.current = !!e.text;
    setSel(0);
    setOpen(true);
    setFocusTick((n) => n + 1);
  }), [open]);
  // focus the field once it is on screen (and again when opened anew while open)
  useLayoutEffect(() => {
    if (!open || !input.current) return;
    input.current.focus();
    if (keepText.current) { const n = input.current.value.length; input.current.setSelectionRange(n, n); } else input.current.select();
  }, [open, focusTick]);

  // the list for what is typed (sources may be slow: a newer query wins)
  useEffect(() => {
    if (!open) return;
    const n = ++seq.current;
    const t = window.setTimeout(() => { void gather(text).then((l) => { if (seq.current === n) setCmds(l); }); }, text ? 60 : 0);
    return () => window.clearTimeout(t);
  }, [text, open]);

  const groups = useMemo(() => rank(text, cmds), [text, cmds]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  useEffect(() => { setSel(0); }, [text]);
  useLayoutEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel, open]);

  const close = () => {
    setOpen(false);
    const b = back.current;
    if (b instanceof HTMLElement && b.isConnected) b.focus({ preventScroll: true });
  };
  const run = (c: Command | undefined) => {
    if (!c) return;
    noteRecent(c.id);
    setOpen(false);
    // the command may move focus itself (open a page, a drawer); give the old focus back only when it doesn't
    const b = back.current;
    c.run();
    window.setTimeout(() => { if (document.activeElement === document.body && b instanceof HTMLElement && b.isConnected) b.focus({ preventScroll: true }); }, 0);
  };

  const starts = useMemo(() => { const out: number[] = []; let n = 0; for (const g of groups) { out.push(n); n += g.items.length; } return out; }, [groups]);

  const onKey = (e: ReactKeyboardEvent) => {
    const n = flat.length;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (text) setText(""); else close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); if (n) setSel((s) => (s + 1) % n); }
    else if (e.key === "ArrowUp") { e.preventDefault(); if (n) setSel((s) => (s - 1 + n) % n); }
    else if (e.key === "PageDown") { e.preventDefault(); if (n) setSel((s) => Math.min(n - 1, s + 8)); }
    else if (e.key === "PageUp") { e.preventDefault(); if (n) setSel((s) => Math.max(0, s - 8)); }
    else if (e.key === "Tab") {
      e.preventDefault();
      if (!starts.length) return;
      const cur = starts.reduce((a, s, i) => (sel >= s ? i : a), 0);
      const next = (cur + (e.shiftKey ? -1 : 1) + starts.length) % starts.length;
      setSel(starts[next]!);
    } else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); run(flat[sel]); }
  };

  if (!open) return null;
  let i = 0;
  return createPortal(
    <div className="overlay palette-ov" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="palette" role="dialog" aria-label="Search everything" onKeyDown={onKey}>
        <div className="palette-in">
          <Icon name="search" />
          <input ref={input} type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search pages, mods, characters, settings, actions"
            aria-label="Search everything" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={flat[sel] ? `pc-${sel}` : undefined}
            spellCheck={false} autoComplete="off" />
          <kbd className="kbd" title="Close (Escape)">Esc</kbd>
        </div>
        <div className="palette-list" id="palette-list" ref={listRef} role="listbox">
          {!flat.length && <div className="palette-none">{text ? `Nothing called "${text}". Try another word, like "mods" or "update".` : "Type to search."}</div>}
          {groups.map((g) => (
            <div key={g.section} className="palette-sec" role="group" aria-label={g.section}>
              <div className="palette-h">{g.section}</div>
              {g.items.map((c) => {
                const n = i++;
                return (
                  <button key={c.id} id={`pc-${n}`} type="button" role="option" aria-selected={n === sel} data-i={n} tabIndex={-1}
                    className={`palette-i${n === sel ? " on" : ""}`}
                    onMouseMove={() => { if (sel !== n) setSel(n); }} onFocus={() => setSel(n)} onClick={() => run(c)}>
                    {c.img ? <LazyImg className="palette-img" src={c.img} alt="" /> : <Icon name={c.icon ?? "chevron"} />}
                    <span className="palette-tw">
                      <span className="palette-t">{c.title}</span>
                      {c.where && <span className="palette-where">{c.where}</span>}
                    </span>
                    {c.hint && <span className="palette-hint">{c.hint}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="palette-foot" aria-hidden="true">
          <span><kbd className="kbd">↑</kbd><kbd className="kbd">↓</kbd> move</span>
          <span><kbd className="kbd">Enter</kbd> open</span>
          <span><kbd className="kbd">Tab</kbd> next section</span>
        </div>
      </div>
    </div>,
    document.querySelector(".app") ?? document.body,
  );
}
