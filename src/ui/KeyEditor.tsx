// An installed mod's keys, editable: rebind a key (press the new keys with the keyboard, mouse or a controller), turn
// one off, make all of them work only while the mod's character is on screen (so mods for characters not in the
// party stop taking keys), or put back the author's files. Every change is written to the mod's .ini with a backup
// and an Undo step (lib/history.ts), and the author's copy of each ini is kept from before the first change. The
// Rust side is crates/gacha-core/src/keys.rs. Owner: KEYBINDS area.
import { useCallback, useEffect, useRef, useState } from "react";
import { aiShown, askAi, useAiShow } from "../lib/ai";
import { backups, errorText, library, modKeys, type Backup, type GameId, type KeyEdit, type KeyEntry, type KeyLine, type ModEntry, type ModKeys } from "../lib/api";
import { modPage } from "../lib/gamebanana";
import { record } from "../lib/history";
import { detectKeybinds, type DescKey } from "../lib/keybinds";
import { useGame } from "../lib/store";
import { MOUSE_TOKEN, PAD_TOKEN, bindingLabel, heldOf, modifierOf, sameKeys, tokenOf, type Modifier } from "../screens/modtools/keyNames";
import { Icon } from "./Icon";
import { Button, Panel, Skeleton, Toggle } from "./kit";
import { toast } from "./toast";
import "./key-editor.css";

// ── keys changed: the editor and the clashes list stay in step ──

type Changed = (game: string, modId: string) => void;
const changedSubs = new Set<Changed>();
/** Say a mod's keys changed (after an edit, an undo or a redo). */
export function keysChanged(game: string, modId: string) { changedSubs.forEach((f) => f(game, modId)); }
export function onKeysChanged(f: Changed): () => void { changedSubs.add(f); return () => { changedSubs.delete(f); }; }

/** Record an edit that took backups: Undo restores them, and restoring hands back the backups that redo it. */
export function recordBackups(label: string, taken: Array<{ game: string; modId: string; backup: Backup }>) {
  let next = taken.slice();
  const flip = async () => {
    const out: typeof next = [];
    let failed: unknown = null;
    for (const t of next) {
      try { out.push({ ...t, backup: await backups.restore(t.backup.id) }); } catch (e) { failed ??= e; out.push(t); }
    }
    next = out;
    for (const t of next) keysChanged(t.game, t.modId);
    if (failed) throw failed;
  };
  record({ label, undo: flip, redo: flip });
}

/** Apply a KeyEdit's result: Undo with its backup, a note when there is one. */
export function recordEdit(game: GameId, modId: string, edit: KeyEdit, fallback: string) {
  keysChanged(game, modId);
  if (!edit.backup) { toast(edit.note ?? fallback); return; }
  recordBackups(edit.note ? `${edit.backup.label}. ${edit.note}` : edit.backup.label, [{ game, modId, backup: edit.backup }]);
}

// ── press-to-capture ──

const PAD_MODS: Modifier[] = ["ctrl", "alt", "shift", "windows"];
let stopActive: (() => void) | null = null;

/** Read the next key combination from the keyboard, mouse or a controller. `live` gets what is held so far. Resolves
 *  to a binding ("ctrl VK_F6", "XB_LEFT_SHOULDER XB_A") or null when cancelled: Esc, B alone, a plain click
 *  elsewhere, leaving the window, or 10 seconds without a press. While it runs, the app's own keys, clicks and
 *  controller handling get nothing. */
export function captureKeys(live: (label: string) => void): { done: Promise<string | null>; cancel: () => void } {
  stopActive?.();
  let resolve: (v: string | null) => void = () => {};
  const done = new Promise<string | null>((r) => { resolve = r; });
  const held = new Set<Modifier>();
  const used = new Set<Modifier>();
  const keys: string[] = [];
  const down = new Set<string>();
  const pads: string[] = [];
  const padDown = new Set<number>();
  let padIgnore: Set<number> | null = null;
  let over = false;
  let raf = 0;
  let timer = 0;

  const realPads = (): Gamepad[] => {
    try { return [...(Navigator.prototype.getGamepads?.call(navigator) ?? [])].filter((p): p is Gamepad => !!p && p.connected); } catch { return []; }
  };
  const pressedNow = () => {
    const s = new Set<number>();
    for (const p of realPads()) p.buttons.forEach((b, i) => { if (b.pressed) s.add(i); });
    return s;
  };
  // the app's controller handling reads navigator.getGamepads each frame: it sees no pads until we're done
  const hidePads = "getGamepads" in navigator;
  if (hidePads) { try { Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [] }); } catch { /* read-only: the app still sees the pad */ } }
  const showPads = () => { if (hidePads) { try { delete (navigator as unknown as Record<string, unknown>).getGamepads; } catch { /* ignore */ } } };

  const label = () => {
    if (pads.length) return bindingLabel(pads.join(" "));
    const mods = PAD_MODS.filter((m) => held.has(m) || used.has(m));
    const text = bindingLabel([...mods, ...keys].join(" "));
    return keys.length ? text : text ? `${text}+` : "";
  };
  const kick = () => { window.clearTimeout(timer); timer = window.setTimeout(() => finish(null, true), 10_000); };

  const block = (e: Event) => { e.preventDefault(); e.stopImmediatePropagation(); };
  const finish = (value: string | null, now = false) => {
    if (over) return;
    over = true;
    stopActive = null;
    window.clearTimeout(timer);
    // let the release of the last key or click go by unseen, then hand the controller back once it's let go
    const remove = () => { for (const [t, f] of listeners) window.removeEventListener(t, f, true); };
    if (now) remove(); else window.setTimeout(remove, 0);
    const release = () => {
      if (pressedNow().size === 0) { cancelAnimationFrame(raf); showPads(); return; }
      raf = requestAnimationFrame(release);
    };
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(release);
    resolve(value);
  };
  const keyFinish = () => {
    if (down.size || !keys.length) return;
    const mods = PAD_MODS.filter((m) => used.has(m));
    finish([...mods, ...keys].join(" "));
  };

  const idOf = (e: KeyboardEvent) => e.code || e.key;
  const onKeyDown = (e: KeyboardEvent) => {
    block(e);
    if (e.repeat) return;
    kick();
    if (e.key === "Escape" && !keys.length && !pads.length) { finish(null); return; }
    const mod = modifierOf(e);
    if (mod) { held.add(mod); down.add(idOf(e)); live(label()); return; }
    const t = tokenOf(e);
    if (!t) return;
    if (!keys.includes(t)) keys.push(t);
    held.forEach((m) => used.add(m));
    heldOf(e).forEach((m) => used.add(m));
    down.add(idOf(e));
    live(label());
  };
  const onKeyUp = (e: KeyboardEvent) => {
    block(e);
    if (!down.delete(idOf(e))) return;
    const mod = modifierOf(e);
    if (mod) held.delete(mod);
    live(label());
    keyFinish();
  };
  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") { finish(null, true); return; }
    const plain = (e.button === 0 || e.button === 2) && held.size === 0 && heldOf(e).length === 0 && !keys.length;
    // a plain click elsewhere is "never mind", and the click goes through
    if (plain) { finish(null, true); return; }
    block(e);
    kick();
    const t = MOUSE_TOKEN[e.button];
    if (!t) return;
    if (!keys.includes(t)) keys.push(t);
    held.forEach((m) => used.add(m));
    heldOf(e).forEach((m) => used.add(m));
    down.add(`mouse${e.button}`);
    live(label());
  };
  const onPointerUp = (e: PointerEvent) => {
    block(e);
    if (!down.delete(`mouse${e.button}`)) return;
    keyFinish();
  };
  const listeners: Array<[string, EventListener]> = [
    ["keydown", onKeyDown as EventListener], ["keyup", onKeyUp as EventListener],
    ["pointerdown", onPointerDown as EventListener], ["pointerup", onPointerUp as EventListener],
    ["mousedown", block], ["mouseup", block], ["click", block], ["auxclick", block], ["contextmenu", block], ["wheel", block],
  ];
  for (const [t, f] of listeners) window.addEventListener(t, f, { capture: true, passive: false });
  const onBlur = () => finish(null, true);
  window.addEventListener("blur", onBlur, { once: true });

  const poll = () => {
    if (over) return;
    raf = requestAnimationFrame(poll);
    const now = pressedNow();
    // buttons already held when it started (the A that pressed the button) count only after they're let go
    if (!padIgnore) padIgnore = new Set(now);
    for (const i of [...padIgnore]) if (!now.has(i)) padIgnore.delete(i);
    let changed = false;
    for (const i of now) {
      if (padIgnore.has(i) || padDown.has(i)) continue;
      padDown.add(i);
      const t = PAD_TOKEN[i];
      if (t && !pads.includes(t)) { pads.push(t); changed = true; }
      kick();
    }
    for (const i of [...padDown]) if (!now.has(i)) padDown.delete(i);
    if (changed) live(label());
    if (pads.length && padDown.size === 0) {
      // B alone backs out everywhere in the app, so it cancels here too
      finish(pads.length === 1 && pads[0] === "XB_B" ? null : pads.join(" "));
    }
  };
  raf = requestAnimationFrame(poll);
  kick();
  live("");
  const cancel = () => { window.removeEventListener("blur", onBlur); finish(null, true); };
  stopActive = cancel;
  done.finally(() => window.removeEventListener("blur", onBlur));
  return { done, cancel };
}

/** A key as a button: click (or Enter, or A on a controller), then press the new keys. */
export function KeyChip({ line, onBinding, disabled, title }:
  { line: Pick<KeyLine, "label" | "original" | "originalLabel" | "off" | "field">; onBinding: (binding: string) => void; disabled?: boolean; title?: string }) {
  const [live, setLive] = useState<string | null>(null);
  const cancel = useRef<(() => void) | null>(null);
  useEffect(() => () => cancel.current?.(), []);
  const start = () => {
    if (live !== null) { cancel.current?.(); return; }
    const c = captureKeys((l) => setLive(l));
    cancel.current = c.cancel;
    setLive("");
    c.done.then((b) => {
      cancel.current = null;
      setLive(null);
      if (b) onBinding(b);
    });
  };
  const tip = live !== null
    ? "Press the new key, combination or controller buttons. Esc or B cancels"
    : title ?? (line.original
      ? `You changed this key. The mod's own key is ${line.originalLabel ?? line.original}. Click to change it again`
      : "Change this key: click, then press the new key, combination or controller buttons");
  return (
    <button type="button" className={`ke-chip${live !== null ? " capturing" : ""}${line.original ? " changed" : ""}${line.off ? " off" : ""}`}
      onClick={start} disabled={disabled} title={tip} aria-label={live !== null ? "Waiting for keys" : `${line.field === "back" ? "Back key" : "Key"} ${line.label}. Change`}>
      {live !== null ? <span className="ke-chip-live" aria-live="polite">{live || "Press keys"}</span>
        : <><span className="kbd">{line.label || "?"}</span><Icon name="edit" className="ke-chip-i" /></>}
    </button>
  );
}

// ── description labels ──

const DESC_TTL = 24 * 3600 * 1000;
function cachedDesc(gbId: number): DescKey[] | null {
  try {
    const raw = localStorage.getItem(`gm.desckeys.${gbId}`);
    if (!raw) return null;
    const v = JSON.parse(raw) as { at: number; keys: DescKey[] };
    return Date.now() - v.at < DESC_TTL && Array.isArray(v.keys) ? v.keys : null;
  } catch { return null; }
}
function saveDesc(gbId: number, keys: DescKey[]) {
  try { localStorage.setItem(`gm.desckeys.${gbId}`, JSON.stringify({ at: Date.now(), keys: keys.slice(0, 60) })); } catch { /* storage off */ }
}

/** What the author's description says a key does, when one of its keys is this entry's. */
function descFor(entry: KeyEntry, desc: DescKey[]): string | null {
  if (!desc.length) return null;
  const mine = new Set(entry.lines.map((l) => sameKeys(l.originalLabel ?? l.label)));
  for (const d of desc) {
    if (!d.action) continue;
    if (d.keys.split(" / ").some((k) => mine.has(sameKeys(k)))) return d.action.length > 70 ? `${d.action.slice(0, 68)}…` : d.action;
  }
  return null;
}

const what = (e: KeyEntry) => {
  const n = e.vars.find((v) => v.values.length > 1)?.values.length ?? 0;
  switch (e.kind) {
    case "cycle": return n > 2 ? `Cycles ${n} options` : "Switches";
    case "toggle": return "On or off";
    case "hold": return "While held";
    default: return "Press once";
  }
};

// ── the editor ──

export function KeyEditor({ game, modId, compact }: { game: GameId; modId: string; compact?: boolean }) {
  const [keys, setKeys] = useState<ModKeys | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [mod, setMod] = useState<ModEntry | null>(null);
  const [desc, setDesc] = useState<DescKey[]>([]);
  const running = !!useGame()?.running;
  useAiShow();
  const current = useRef(`${game}|${modId}`);
  current.current = `${game}|${modId}`;

  const load = useCallback(() => {
    const at = `${game}|${modId}`;
    modKeys.list(game, modId)
      .then((k) => { if (current.current === at) { setKeys(k); setFailed(null); } })
      .catch((e) => { if (current.current === at) { setKeys(null); setFailed(errorText(e)); } });
  }, [game, modId]);

  useEffect(() => {
    setKeys(null);
    setFailed(null);
    setDesc([]);
    load();
    let live = true;
    library.get(game, modId).then((m) => {
      if (!live) return;
      setMod(m);
      const gb = m.source?.site === "gamebanana" ? m.source.modId : 0;
      if (!gb) return;
      const hit = cachedDesc(gb);
      if (hit) { setDesc(hit); return; }
      modPage(gb).then((p) => {
        if (!p || !live) return;
        const found = detectKeybinds(p.descriptionHtml).keys;
        saveDesc(gb, found);
        setDesc(found);
      }).catch(() => { /* offline: no labels */ });
    }).catch(() => setMod(null));
    const off = onKeysChanged((g, id) => { if (g === game && id === modId) load(); });
    return () => { live = false; off(); };
  }, [game, modId, load]);

  const run = useCallback(async (what: string, job: () => Promise<KeyEdit>, fallback: string) => {
    setBusy(what);
    try {
      const edit = await job();
      if (current.current === `${game}|${modId}`) setKeys(edit.keys);
      recordEdit(game, modId, edit, fallback);
    } catch (e) {
      toast(errorText(e), true);
    } finally {
      setBusy(null);
    }
  }, [game, modId]);

  if (failed) return compact ? null : <p className="ke ke-failed hint">{failed}</p>;
  if (!keys) {
    return compact ? null : (
      <div className="ke ke-loading" aria-busy="true"><Skeleton h="1.2rem" w="30%" /><Skeleton h="2.2rem" /><Skeleton h="2.2rem" /></div>
    );
  }
  if (!keys.keys.length) return null;

  const who = mod?.character ?? "its character";
  const onScreen = keys.onScreen;
  const showAi = (onScreen === "cant" || onScreen === "partial") && aiShown("useful");
  const onScreenRow = onScreen === "global" ? (
    <p className="ke-os ke-os-global hint">{keys.onScreenNote ?? "This mod doesn't draw a character, so its toggles work everywhere."}</p>
  ) : (
    <div className="ke-os" title={onScreen === "own" ? "The mod's own ini already checks that its character is drawn before a toggle does anything"
      : `Toggles do nothing while ${who} isn't on screen, so mods for other characters can use the same keys. gachamod adds a check to the ini and can take it out again`}>
      <Toggle checked={onScreen === "on" || onScreen === "partial" || onScreen === "own"} disabled={busy !== null || onScreen === "own" || onScreen === "cant"}
        label="Toggles only while on screen"
        hint={onScreen === "own" ? "The mod does this itself"
          : onScreen === "cant" || onScreen === "partial" ? keys.onScreenNote ?? undefined
          : onScreen === "on" ? "Added by gachamod. Turn it off if a toggle stops working in game"
          : compact ? undefined : `Toggles do nothing while ${who} isn't on screen`}
        onChange={(on) => run("os", () => modKeys.onScreen(game, modId, on), on ? "Its toggles already work only while on screen" : "Nothing to take out")} />
      {showAi && (
        <Button size="sm" variant="ghost" icon="ai" title="Ask the AI helper which part of the mod draws the character, then apply its answer here. Works best with a strong chatbot"
          onClick={() => askAi({ kind: "keys-offscreen", game, modIds: [modId] })}>Ask the AI helper</Button>
      )}
    </div>
  );

  const body = (
    <>
      {onScreenRow}
      {running && !compact && <p className="ke-running hint">Changes load when you press F10 in game.</p>}
      <ul className="ke-list">
        {keys.keys.map((e) => {
          const said = descFor(e, desc);
          const at = `${e.ini}|${e.section}`;
          const where = `[${e.section}] in ${e.ini}${e.condition ? `, only when ${e.condition}` : ""}`;
          return (
            <li key={at} className={`ke-row${e.off ? " off" : ""}`}>
              <span className="ke-what" title={said ? `${where}. The description says: ${said}` : where}>
                <span className="ke-name">{said ?? e.name}</span>
                {!compact && <span className="ke-kind hint">{said ? `${e.name}, ${what(e).toLowerCase()}` : what(e)}</span>}
              </span>
              <span className="ke-keys">
                {e.lines.map((l) => (
                  <span key={`${l.field}-${l.index}`} className="ke-line">
                    {l.field === "back" && <span className="ke-back hint" title="Steps back through the looks">Back</span>}
                    <KeyChip line={l} disabled={busy !== null || l.off}
                      onBinding={(b) => run(`k${at}`, () => modKeys.rebind(game, modId, { ini: e.ini, section: e.section, field: l.field, index: l.index }, b), "That's already the key")} />
                  </span>
                ))}
              </span>
              <span className="ke-on" title={e.off ? "Turn this toggle back on" : "Turn this toggle off. The mod stays on, only this toggle stops working"}>
                <Toggle size="sm" checked={!e.off} disabled={busy !== null} ariaLabel={`${said ?? e.name} toggle`}
                  onChange={(on) => run(`o${at}`, () => modKeys.setOff(game, modId, e.ini, e.section, !on), "No change")} />
              </span>
            </li>
          );
        })}
      </ul>
      <p className="ke-tip hint">Click a key to rebind it</p>
    </>
  );

  const ours =keys.changed || onScreen === "on" || onScreen === "partial";
  const reset = ours && (
    <Button size="sm" variant="ghost" icon="undo" busy={busy === "reset"} disabled={busy !== null && busy !== "reset"}
      title="Take out every change gachamod made to this mod: changed keys, toggles turned off and the on-screen check. Each ini goes back to the copy gachamod kept from before its first change. Undo brings the changes back"
      onClick={() => run("reset", () => modKeys.putBack(game, modId), "The files are already the author's")}>Put back original files</Button>
  );

  if (compact) return <div className="ke ke-compact">{body}{reset && <div className="ke-foot">{reset}</div>}</div>;
  return (
    <Panel title="Toggles" icon="keyboard" className="ke mi-panel" count={keys.keys.length} actions={reset || undefined}>
      {body}
    </Panel>
  );
}
