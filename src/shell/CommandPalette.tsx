// The command palette (Ctrl+K, the title bar's search box, or onApp "palette" with text): one forgiving search over
// every page, action, setting, character, mod, profile, game and creator other areas register (lib/search.ts).
// Empty, it shows recent picks and the pages. Arrows move, Enter runs, Tab and Shift+Tab jump between sections,
// Escape closes; a controller moves with the D-pad, A runs, B closes. Sources that answer at once show on the same
// key and slow ones (installed mods, characters) join when they answer. Enter pressed before every source has
// answered for what is typed waits for them, then opens the best match, so typing "raiden" and pressing Enter at
// once never opens a match for "rai" or the GameBanana search. Owner: SHELL area.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { commandSources, noteRecent, recentIds, scoreCommand, type Command } from "../lib/search";
import { onApp } from "../lib/store";
import { Icon } from "../ui/Icon";
import { Spinner } from "../ui/kit";
import { LazyImg } from "../ui/LazyImg";

const ORDER = ["Recent", "Pages", "Actions", "Characters", "Mods", "Profiles", "Settings", "Creators", "Games", "Online"];
const PER_SECTION = 6;
const PER_SECTION_ALONE = 30;
/** How long Enter waits for slow sources before it stops and leaves the pick to you. */
const WAIT_MS = 2500;

interface Group { section: string; items: Command[] }
/** Each source's latest answer (by source id), the query asked last, and the last one every source has answered.
 *  One state, so a render never sees "all answered" without the answers. */
interface Answers { parts: ReadonlyMap<string, Command[]>; asked: number; askedText: string; answered: number }

function rank(query: string, list: Command[]): Group[] {
  if (!query.trim()) {
    const byId = new Map(list.map((c) => [c.id, c]));
    const recent = recentIds().map((id) => byId.get(id)).filter((c): c is Command => !!c).slice(0, 6);
    const used = new Set(recent.map((c) => c.id));
    const pages = list.filter((c) => c.section === "Pages" && !used.has(c.id)).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0)).slice(0, 8);
    return [{ section: "Recent", items: recent }, { section: "Pages", items: pages }].filter((g) => g.items.length);
  }
  const scored = list.map((c) => ({ c, s: scoreCommand(query, c) })).filter((x) => x.s > 0)
    // a fallback ("Search GameBanana for ...") matches every query, so it goes after every other match
    .map((x) => (x.c.fallback ? { c: x.c, s: 0.001 } : x))
    .sort((a, b) => b.s - a.s);
  const groups = new Map<string, Array<{ c: Command; s: number }>>();
  for (const x of scored) { const g = groups.get(x.c.section) ?? []; g.push(x); groups.set(x.c.section, g); }
  const alone = [...groups.values()].filter((g) => !g[0]!.c.fallback).length === 1;
  // the section holding the best match leads; the rest follow in the usual order
  return [...groups.entries()]
    .sort((a, b) => (b[1][0]!.s - a[1][0]!.s) || (idx(a[0]) - idx(b[0])))
    .map(([section, xs]) => ({ section, items: xs.slice(0, alone ? PER_SECTION_ALONE : PER_SECTION).map((x) => x.c) }));
}
const idx = (s: string) => { const i = ORDER.indexOf(s); return i < 0 ? ORDER.length : i; };

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [answers, setAnswers] = useState<Answers>(() => ({ parts: new Map(), asked: 0, askedText: "", answered: 0 }));
  // Enter came before every answer was in: it runs when they are
  const [pending, setPending] = useState(false);
  // Enter waited WAIT_MS and some answers still hadn't come: the next Enter opens what's highlighted
  const [slow, setSlow] = useState(false);
  const [sel, setSel] = useState(0);
  const [focusTick, setFocusTick] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const back = useRef<Element | null>(null);
  const seq = useRef(0);
  // the query number when the palette opened: answers to older ones are dropped
  const base = useRef(0);
  // the newest query number each source has answered
  const applied = useRef(new Map<string, number>());
  // the highlight was moved by hand since the last key typed: it stays on that entry when the list changes
  const moved = useRef(false);
  const pickedId = useRef<string | null>(null);
  // opened by typing: the caret goes after the typed letter instead of selecting it
  const keepText = useRef(false);

  // open right now, before a render shows it (keys typed in a burst each ask to open it)
  const isOpen = useRef(false);
  useEffect(() => onApp((e) => {
    if (e.type !== "palette") return;
    if (isOpen.current && e.typed && e.text) { const t = e.text; setText((s) => s + t); return; }
    if (!isOpen.current) { back.current = document.activeElement; base.current = seq.current; setAnswers((a) => ({ ...a, parts: new Map() })); }
    isOpen.current = true;
    setText(e.text ?? "");
    keepText.current = !!e.text;
    setSel(0);
    setPending(false);
    setSlow(false);
    setOpen(true);
    setFocusTick((n) => n + 1);
  }), []);
  // focus the field once it is on screen (and again when opened anew while open)
  useLayoutEffect(() => {
    if (!open || !input.current) return;
    input.current.focus();
    if (keepText.current) { const n = input.current.value.length; input.current.setSelectionRange(n, n); } else input.current.select();
  }, [open, focusTick]);

  // ask every source about what is typed, on every key. Quick ones show at once; slow ones replace their last
  // answer when they answer (an older query's answer never replaces a newer one's).
  useEffect(() => {
    if (!open) return;
    const n = ++seq.current;
    const take = (id: string) => {
      if (n <= base.current || n < (applied.current.get(id) ?? 0)) return false;
      applied.current.set(id, n);
      return true;
    };
    const ids: string[] = [];
    const now = new Map<string, Command[]>();
    const later: Array<[string, Promise<Command[]>]> = [];
    for (const [id, src] of commandSources()) {
      ids.push(id);
      let r: Command[] | Promise<Command[]>;
      try { r = src(text); } catch { r = []; }
      if (Array.isArray(r)) { if (take(id)) now.set(id, r); } else later.push([id, r]);
    }
    let left = later.length;
    setAnswers((a) => {
      // sources that went away (another game picked) drop out
      const parts = new Map<string, Command[]>();
      for (const id of ids) { const l = now.get(id) ?? a.parts.get(id); if (l) parts.set(id, l); }
      return { parts, asked: n, askedText: text, answered: left ? a.answered : n };
    });
    for (const [id, p] of later) {
      void Promise.resolve(p).catch(() => [] as Command[]).then((list) => {
        const fresh = take(id), last = --left === 0;
        setAnswers((a) => ({
          ...a,
          parts: fresh ? new Map(a.parts).set(id, list) : a.parts,
          answered: last && a.asked === n ? n : a.answered,
        }));
      });
    }
  }, [text, open]);

  const cmds = useMemo(() => {
    const seen = new Set<string>();
    return [...answers.parts.values()].flat().filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
  }, [answers.parts]);
  const groups = useMemo(() => rank(text, cmds), [text, cmds]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  // every source has answered for exactly what is typed
  const ready = answers.answered === answers.asked && answers.askedText === text;

  // typing starts over: the highlight goes back to the top and a waiting Enter is dropped
  useEffect(() => { setSel(0); moved.current = false; setPending(false); setSlow(false); }, [text]);
  useEffect(() => { pickedId.current = moved.current ? flat[sel]?.id ?? null : null; }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps
  // answers that arrive late reorder the list: a highlight moved by hand stays on its entry
  useLayoutEffect(() => {
    const id = pickedId.current;
    const i = moved.current && id ? flat.findIndex((c) => c.id === id) : -1;
    if (i >= 0) { if (i !== sel) setSel(i); } else if (sel && sel >= flat.length) setSel(0);
  }, [flat]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel, open]);

  const close = () => {
    isOpen.current = false;
    setOpen(false);
    setPending(false);
    const b = back.current;
    if (b instanceof HTMLElement && b.isConnected) b.focus({ preventScroll: true });
  };
  const run = (c: Command | undefined) => {
    if (!c) return;
    noteRecent(c.id);
    isOpen.current = false;
    setOpen(false);
    setPending(false);
    // the command may move focus itself (open a page, a drawer); give the old focus back only when it doesn't
    const b = back.current;
    c.run();
    window.setTimeout(() => { if (document.activeElement === document.body && b instanceof HTMLElement && b.isConnected) b.focus({ preventScroll: true }); }, 0);
  };

  // the waiting Enter: every answer is in, so open the best match for what is typed
  useEffect(() => {
    if (pending && ready) run(flat[sel]);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!pending) return;
    const t = window.setTimeout(() => { setPending(false); setSlow(true); }, WAIT_MS);
    return () => window.clearTimeout(t);
  }, [pending]);

  const starts = useMemo(() => { const out: number[] = []; let n = 0; for (const g of groups) { out.push(n); n += g.items.length; } return out; }, [groups]);

  const pick = (f: (s: number) => number) => { moved.current = true; setPending(false); setSel(f); };
  const onKey = (e: ReactKeyboardEvent) => {
    const n = flat.length;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (text) setText(""); else close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); if (n) pick((s) => (s + 1) % n); }
    else if (e.key === "ArrowUp") { e.preventDefault(); if (n) pick((s) => (s - 1 + n) % n); }
    else if (e.key === "PageDown") { e.preventDefault(); if (n) pick((s) => Math.min(n - 1, s + 8)); }
    else if (e.key === "PageUp") { e.preventDefault(); if (n) pick((s) => Math.max(0, s - 8)); }
    else if (e.key === "Tab") {
      e.preventDefault();
      if (!starts.length) return;
      const cur = starts.reduce((a, s, i) => (sel >= s ? i : a), 0);
      const next = (cur + (e.shiftKey ? -1 : 1) + starts.length) % starts.length;
      pick(() => starts[next]!);
    } else if (e.key === "Enter") {
      e.preventDefault(); e.stopPropagation();
      // open now when the highlight was picked by hand, when Enter already waited, or when every answer for
      // what is typed is in; otherwise wait for them (a second Enter while waiting changes nothing)
      if (moved.current || slow || ready) run(flat[sel]);
      else setPending(true);
    }
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
          {!flat.length && <div className="palette-none">{!text ? "Type to search." : ready ? `Nothing called "${text}". Try another word, like "mods" or "update".` : `Looking for "${text.trim()}"`}</div>}
          {groups.map((g) => (
            <div key={g.section} className="palette-sec" role="group" aria-label={g.section}>
              <div className="palette-h">{g.section}</div>
              {g.items.map((c) => {
                const n = i++;
                return (
                  <button key={c.id} id={`pc-${n}`} type="button" role="option" aria-selected={n === sel} data-i={n} tabIndex={-1}
                    className={`palette-i${n === sel ? " on" : ""}`}
                    onMouseMove={() => { if (sel !== n && !pending) pick(() => n); }} onFocus={() => setSel(n)} onClick={() => run(c)}>
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
        <div className="palette-foot">
          <span aria-hidden="true"><kbd className="kbd">↑</kbd><kbd className="kbd">↓</kbd> move</span>
          <span aria-hidden="true"><kbd className="kbd">Enter</kbd> open</span>
          <span aria-hidden="true"><kbd className="kbd">Tab</kbd> next section</span>
          {pending ? <span className="palette-wait" role="status"><Spinner /><span className="palette-wait-t">Looking for "{text.trim()}"</span></span>
            : slow && !ready ? <span className="palette-slow" role="status">Still loading some results. Enter opens the highlighted one.</span>
            : null}
        </div>
      </div>
    </div>,
    document.querySelector(".app") ?? document.body,
  );
}
