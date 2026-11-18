// The developer console: drops down from the top on ~ (the key left of 1). Output shows everything the window and
// backend log as it happens; the line at the bottom takes commands (help lists them, Tab completes, Up and Down go
// through earlier ones). Flows has a button for each new user flow, and in the demo the switches for its dummy data.
// Only in dev builds and the browser demo (main.tsx mounts it). Plain English: it's a tool, not app text.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKey } from "react";
import { createRoot } from "react-dom/client";
import { inTauri } from "../../lib/tauri";
import { COMMANDS, completions, exec, view } from "./commands";
import { installCapture, useLines, type Line } from "./log";
import "./console.css";

const HISTORY = "gm.console.history";
const HEIGHT = "gm.console.height";
const readHistory = (): string[] => { try { return JSON.parse(localStorage.getItem(HISTORY) ?? "[]") as string[]; } catch { return []; } };
const time = (at: number) => new Date(at).toTimeString().slice(0, 8) + "." + String(at % 1000).padStart(3, "0");

type Scen = { imm: boolean; nrmm: boolean; others: boolean; running: boolean; blockedSplit: boolean; newChecks: boolean };
type ScenMod = typeof import("../../lib/demo/scenario");

function useScenario(): [Scen | null, ScenMod | null] {
  const [mod, setMod] = useState<ScenMod | null>(null);
  useEffect(() => { if (!inTauri()) void import("../../lib/demo/scenario").then(setMod); }, []);
  const s = useSyncExternalStore((f) => (mod ? mod.onScenario(f) : () => {}), () => (mod ? mod.scenario() : null));
  return [s, mod];
}

const FLOWS: Array<{ title: string; demo?: boolean; items: Array<[label: string, cmd: string]> }> = [
  { title: "Moving from other managers", items: [
    ["Zenless: IMM, NRMM, XX Mod Manager, WZMM", "managers zzz"],
    ["Genshin: IMM, JASM, GIMM", "managers gi"],
    ["Put the moved mods back", "reset"],
  ] },
  { title: "First start", demo: true, items: [
    ["First start with games set up", "firststart"],
    ["First start with no mod loaders (setup page)", "firststart fresh"],
  ] },
  { title: "Merged mods", demo: true, items: [
    ["Open a merged mod in Zenless", "merged zzz"],
    ["Open a merged mod in Genshin", "merged gi"],
  ] },
  { title: "Watching Mods folders", demo: true, items: [
    ["Copy a mod into Mods in Explorer", "addmod"],
    ["Delete a mod in Explorer", "delmod"],
    ["The switch (Settings, Mods)", "go settings set-watch-mods"],
  ] },
  { title: "New problem checks", items: [
    ["Tools > Problems", "go tools problems"],
  ] },
  { title: "Search and layouts", items: [
    ["Settings (Ctrl+F or / searches both menus)", "go settings"],
    ["Tools", "go tools"],
    ["Cards", "layout cards"], ["Character list", "layout chars"], ["Three panes", "layout panes"], ["Compact list", "layout rows"],
  ] },
  { title: "Language", items: [
    ["English", "lang en"], ["简体中文", "lang zh-CN"], ["Español", "lang es"], ["Português", "lang pt-BR"], ["Русский", "lang ru"],
    ["A backend message, translated", "toast Moved 15 mods from No Reload Mod Manager"],
    ["An error that names a place", "error No Reload Mod Manager manages it. Move your mods out of it first (Tools, Share and import)"],
  ] },
  { title: "Logs", items: [
    ["Print the end of gachamod.log", "log"],
    ["List games", "games"],
  ] },
];

const SCEN_LABELS: Array<[keyof Scen, string]> = [
  ["imm", "Integrated Mod Manager has mods (Zenless, Genshin)"],
  ["nrmm", "No Reload Mod Manager has mods (Zenless)"],
  ["others", "XX Mod Manager, WZMM, JASM and GIMM are installed"],
  ["running", "GIMM is open"],
  ["blockedSplit", "Splitting a merged mod is refused"],
  ["newChecks", "Mods have the new problems (library copy, missing library, FPS cost)"],
];

function Console() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"output" | "flows">("output");
  const [filter, setFilter] = useState("");
  const [level, setLevel] = useState<"all" | "warn" | "error">("all");
  const [calls, setCalls] = useState(true);
  const [text, setText] = useState("");
  const [hist, setHist] = useState<string[]>(readHistory);
  const [hi, setHi] = useState(-1);
  const [pick, setPick] = useState(0);
  const [openIds, setOpenIds] = useState<Set<number>>(new Set());
  const [height, setHeight] = useState(() => Number(localStorage.getItem(HEIGHT)) || 46);
  const lines = useLines();
  const out = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const stick = useRef(true);
  const [scen, scenMod] = useScenario();

  // commands change the view through this
  view.filter = filter; view.level = level; view.calls = calls; view.tab = tab;
  view.set = (p) => { if (p.filter !== undefined) setFilter(p.filter); if (p.level) setLevel(p.level); if (p.calls !== undefined) setCalls(p.calls); if (p.tab) setTab(p.tab); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Backquote" || e.ctrlKey || e.altKey || e.metaKey) return;
      const t = e.target as HTMLElement | null;
      const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      if (typing && t !== input.current) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setOpen((o) => !o);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  useEffect(() => { if (open) requestAnimationFrame(() => input.current?.focus()); }, [open]);

  const shown = useMemo(() => {
    const f = filter.toLowerCase();
    return lines.filter((l) =>
      (level === "all" || (level === "warn" ? l.level === "warn" || l.level === "error" : l.level === "error"))
      && (calls || l.source !== "call" || l.level === "error")
      && (!f || l.text.toLowerCase().includes(f) || l.source.includes(f)));
  }, [lines, filter, level, calls]);

  useLayoutEffect(() => {
    const el = out.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [shown, open, tab]);

  const hints = text && !text.includes(" ") || (text.includes(" ") && completions(text).length) ? completions(text).slice(0, 8) : [];

  const run = (line: string) => {
    const l = line.trim();
    if (!l) return;
    const h = [...hist.filter((x) => x !== l), l].slice(-100);
    setHist(h);
    try { localStorage.setItem(HISTORY, JSON.stringify(h)); } catch { /* fine */ }
    setHi(-1); setText(""); setPick(0);
    stick.current = true;
    if (tab !== "output") setTab("output");
    void exec(l);
  };

  const onInputKey = (e: ReactKey<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); run(hints.length && pick > 0 ? hints[pick - 1]! : text); return; }
    if (e.key === "Escape") { e.preventDefault(); if (text) setText(""); else setOpen(false); return; }
    if (e.key === "Tab") {
      e.preventDefault();
      const c = completions(text);
      if (c.length === 1) setText(`${c[0]} `);
      else if (c.length > 1) {
        // the longest start they share
        let p = c[0]!;
        for (const x of c) while (!x.startsWith(p)) p = p.slice(0, -1);
        if (p.length > text.length) setText(p); else setPick((n) => (n % Math.min(c.length, 8)) + 1);
      }
      return;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      if (hints.length && pick > 0 || (hints.length && e.key === "ArrowDown" && hi === -1 && text)) {
        setPick((n) => Math.max(0, Math.min(hints.length, n + (e.key === "ArrowDown" ? 1 : -1))));
        return;
      }
      if (!hist.length) return;
      const n = e.key === "ArrowUp" ? (hi === -1 ? hist.length - 1 : Math.max(0, hi - 1)) : hi === -1 ? -1 : hi + 1 >= hist.length ? -1 : hi + 1;
      setHi(n);
      setText(n === -1 ? "" : hist[n]!);
    }
  };

  const drag = (e: React.PointerEvent) => {
    const start = e.clientY, h0 = height;
    const move = (ev: PointerEvent) => setHeight(Math.max(20, Math.min(92, h0 + ((ev.clientY - start) / window.innerHeight) * 100)));
    const up = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      setHeight((h) => { try { localStorage.setItem(HEIGHT, String(Math.round(h))); } catch { /* fine */ } return h; });
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };

  if (!open) return null;
  const counts = { warn: lines.filter((l) => l.level === "warn").length, error: lines.filter((l) => l.level === "error").length };
  const toggle = (id: number) => setOpenIds((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="gmc" style={{ height: `${height}vh` }} role="dialog" aria-label="Console">
      <div className="gmc-bar">
        <div className="gmc-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "output"} className={tab === "output" ? "on" : ""} onClick={() => setTab("output")}>Output</button>
          <button type="button" role="tab" aria-selected={tab === "flows"} className={tab === "flows" ? "on" : ""} onClick={() => setTab("flows")}>Flows</button>
        </div>
        {tab === "output" && <>
          <div className="gmc-seg" role="group" aria-label="Level">
            {(["all", "warn", "error"] as const).map((l) => (
              <button key={l} type="button" className={level === l ? "on" : ""} onClick={() => setLevel(l)} title={`Type: level ${l}`}>
                {l === "all" ? "All" : l === "warn" ? `Warnings ${counts.warn + counts.error}` : `Errors ${counts.error}`}
              </button>
            ))}
          </div>
          <label className="gmc-check" title="Type: calls on or calls off. Failed calls always show">
            <input type="checkbox" checked={calls} onChange={(e) => setCalls(e.target.checked)} /> Calls
          </label>
          <input className="gmc-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter" aria-label="Filter the output" />
          <button type="button" onClick={() => void exec("copy")} title="Type: copy">Copy</button>
          <button type="button" onClick={() => void exec("clear")} title="Type: clear">Clear</button>
        </>}
        <span className="gmc-grow" />
        <span className="gmc-mode">{inTauri() ? "app" : "demo"}</span>
        <button type="button" onClick={() => setOpen(false)} title="Close (~ or Esc)">Close</button>
      </div>

      {tab === "output" ? (
        <div className="gmc-out" ref={out} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24; }}>
          {shown.map((l) => <Row key={l.id} l={l} open={openIds.has(l.id)} onToggle={() => toggle(l.id)} />)}
          {shown.length === 0 && <div className="gmc-empty">{lines.length ? "Nothing matches the filters" : "Nothing logged yet"}</div>}
        </div>
      ) : (
        <div className="gmc-flows">
          {scen && scenMod && (
            <section>
              <h3>Dummy data on this PC</h3>
              {SCEN_LABELS.map(([k, label]) => (
                <label key={k} className="gmc-check gmc-scen" title={`Type: scenario ${k}`}>
                  <input type="checkbox" checked={scen[k]} onChange={(e) => scenMod.setScenario({ [k]: e.target.checked })} /> {label}
                </label>
              ))}
              <p className="gmc-note">Pages read these when they open, so open the page again after a change.</p>
            </section>
          )}
          {FLOWS.filter((f) => !f.demo || !inTauri()).map((f) => (
            <section key={f.title}>
              <h3>{f.title}</h3>
              <div className="gmc-btns">
                {f.items.filter(([, cmd]) => !inTauri() || !COMMANDS.find((c) => c.name === cmd.split(" ")[0])?.demo).map(([label, cmd]) => (
                  <button key={cmd} type="button" onClick={() => void exec(cmd)} title={`Type: ${cmd}`}>{label}</button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {hints.length > 0 && text && (
        <div className="gmc-hints">
          {hints.map((h, i) => {
            const c = COMMANDS.find((x) => x.name === h.split(" ")[0]);
            return (
              <button key={h} type="button" className={pick === i + 1 ? "on" : ""} onMouseDown={(e) => { e.preventDefault(); setText(`${h} `); input.current?.focus(); }}>
                <span>{h}</span>{!h.includes(" ") && c && <em>{c.args ? `${c.args}  ` : ""}{c.help}</em>}
              </button>
            );
          })}
        </div>
      )}
      <div className="gmc-in">
        <span aria-hidden="true">]</span>
        <input ref={input} value={text} spellCheck={false} autoComplete="off" aria-label="Command"
          onChange={(e) => { setText(e.target.value); setHi(-1); setPick(0); }} onKeyDown={onInputKey} placeholder="help" />
        <button type="button" onClick={() => run(text)}>Submit</button>
      </div>
      <div className="gmc-grip" onPointerDown={drag} title="Drag to resize" />
    </div>
  );
}

function Row({ l, open, onToggle }: { l: Line; open: boolean; onToggle: () => void }) {
  return (
    <div className={`gmc-line gmc-${l.level} gmc-src-${l.source}${l.detail ? " more" : ""}`} onClick={l.detail ? onToggle : undefined}
      title={l.detail && !open ? "Click for the details" : undefined}>
      <span className="gmc-t">{time(l.at)}</span>
      <span className="gmc-s">{l.source}</span>
      <span className="gmc-x">{l.text}{l.detail && <span className="gmc-caret">{open ? " ▾" : " ▸"}</span>}</span>
      {open && l.detail && <pre className="gmc-d">{l.detail}</pre>}
    </div>
  );
}

/** Start capturing logs and add the console to the page (hidden until ~). */
export function mountConsole() {
  installCapture();
  const el = document.createElement("div");
  el.id = "gm-console";
  document.body.appendChild(el);
  createRoot(el).render(<Console />);
}
