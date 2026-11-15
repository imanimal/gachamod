// MODTOOLS panels for the Tools screen: conflicts, key clashes, problems, hash lookup, packs, moving from IMM.
// Owner: MODTOOLS area. SYSTEM's Tools screen renders them.
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { inTauri } from "../../lib/tauri";
import { emitApp, go, useGame, useGames } from "../../lib/store";
import {
  dialogs, errorKind, errorText, imm, modKeys, modtools, type ConflictGroup, type HashHit, type ImmInfo, type KeyClash, type KeyEdit,
  type ModSkip, type OnScreenMod,
} from "../../lib/api";
import { aiShown, askAi, useAiShow } from "../../lib/ai";
import { Badge, Button, Confirm, Panel, Skeleton, TextField, plural } from "../../ui/kit";
import { Icon } from "../../ui/Icon";
import { KeyChip, keysChanged, onKeysChanged, recordBackups, recordEdit } from "../../ui/KeyEditor";
import { toast } from "../../ui/toast";
import { setToolsCount, turnOff } from "./toolsBadge";
import "./modtools.css";

function useMounted() {
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  return live;
}

/** Load a list for the current game; Todo (a part not built yet) quietly gives an empty list. */
function useGameList<T>(load: (game: string) => Promise<T[]>): { game: string | null; list: T[] | null; reload: () => void } {
  const game = useGame()?.id ?? null;
  const [state, setState] = useState<{ game: string | null; list: T[] | null }>({ game: null, list: null });
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (!game) return;
    let live = true;
    loadRef.current(game)
      .then((list) => { if (live) setState({ game, list }); })
      .catch((e) => {
        if (!live) return;
        if (errorKind(e) !== "todo") toast(errorText(e), true);
        setState({ game, list: [] });
      });
    return () => { live = false; };
  }, [game, tick]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { game, list: state.game === game ? state.list : null, reload };
}

const Loading = () => <div className="tp-loading" aria-busy="true"><Skeleton h="2.6rem" /><Skeleton h="2.6rem" /></div>;

// ── conflicts ──

export function ConflictsPanel() {
  const { game, list, reload } = useGameList<ConflictGroup>(modtools.conflicts);
  const [busy, setBusy] = useState<string | null>(null);
  const live = useMounted();
  useEffect(() => { if (game && list) setToolsCount(game, "conflicts", list.length); }, [game, list]);

  const keep = (g: ConflictGroup, keepId: string) => {
    if (!game) return;
    const others = g.mods.filter((m) => m.modId !== keepId);
    setBusy(keepId);
    turnOff(game, others.map((m) => m.modId), others.map((m) => m.name))
      .then(() => { emitApp({ type: "library-refresh", game }); if (live.current) reload(); })
      .catch((e) => toast(errorText(e), true))
      .finally(() => { if (live.current) setBusy(null); });
  };

  return (
    <>
    <Panel id="conflicts" title="Conflicts" icon="layers" className="tp tp-conflicts" count={list ? list.length : undefined}
      actions={<Button size="sm" variant="ghost" icon="refresh" onClick={reload} disabled={!list} title="Look for conflicts again">Check again</Button>}>
      <p className="hint tp-intro">Mods that are on and change the same parts of a model. Only one of them shows in game.</p>
      {!list ? <Loading /> : list.length === 0 ? (
        <p className="tp-none muted">No conflicts between the mods that are on. Enjoy it while it lasts.</p>
      ) : (
        <ul className="tp-list tp-conflict-list">
          {list.map((g) => (
            <li key={g.mods.map((m) => m.modId).join(",")} className="tp-conflict">
              <div className="tp-conflict-h">
                {g.character && <span className="tp-conflict-char">{g.character}</span>}
                <span className="hint" title={g.hashes.join(", ")}>{plural(g.hashes.length, "shared part")}</span>
              </div>
              <ul className="tp-conflict-mods">
                {g.mods.map((m) => (
                  <li key={m.modId} className="tp-conflict-mod row">
                    <button type="button" className="tp-link grow" title="Open in Mods" onClick={() => go({ view: "library", modId: m.modId })}>{m.name}</button>
                    <Button size="sm" busy={busy === m.modId} disabled={!!busy} title={`Keep ${m.name} on and turn the others in this group off`}
                      onClick={() => keep(g, m.modId)}>Keep this one</Button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Panel>
    <KeyClashesPanel />
    </>
  );
}

// ── key clashes ──

function KeyClashesPanel() {
  const { game, list, reload } = useGameList<KeyClash>(modKeys.clashes);
  const gated = useGameList<OnScreenMod>(modKeys.onScreenMods);
  const reloadGated = gated.reload;
  const [gatedOpen, setGatedOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<ModSkip[]>([]);
  const live = useMounted();
  useAiShow();
  useEffect(() => onKeysChanged((g) => { if (g === game && live.current) { reload(); reloadGated(); } }), [game, reload, reloadGated, live]);
  useEffect(() => { setSkipped([]); setGatedOpen(false); }, [game]);

  const edit = async (what: string, modId: string, job: () => Promise<KeyEdit>, fallback: string) => {
    if (!game) return;
    setBusy(what);
    try { recordEdit(game, modId, await job(), fallback); } catch (e) { toast(errorText(e), true); } finally { if (live.current) setBusy(null); }
  };
  const all = async (on: boolean) => {
    if (!game) return;
    setBusy(on ? "all-on" : "all-off");
    try {
      const r = await modKeys.onScreenAll(game, on);
      if (r.changed.length) {
        const n = plural(r.changed.length, "mod");
        recordBackups(on ? `Toggles of ${n} work only while on screen` : `Toggles of ${n} work any time again`, r.changed.map((c) => ({ game, modId: c.modId, backup: c.backup })));
        r.changed.forEach((c) => keysChanged(game, c.modId));
        // show which mods got it, so the check can come out of one that misbehaves
        if (on && live.current) setGatedOpen(true);
      } else {
        toast(on ? "Every mod with toggles already works this way" : "No mod had gachamod's check to take out");
      }
      if (live.current) setSkipped(on ? r.skipped : []);
    } catch (e) {
      toast(errorText(e), true);
    } finally {
      if (live.current) setBusy(null);
    }
  };

  return (
    <Panel id="key-clashes" title="Key clashes" icon="keyboard" className="tp tp-keys" count={list ? list.length : undefined}
      actions={<Button size="sm" variant="ghost" icon="refresh" onClick={reload} disabled={!list} title="Look for key clashes again">Check again</Button>}>
      <p className="hint tp-intro">Keys that two mods that are on both use, at times when both can react. Mods for different characters only clash when one of them takes keys while its character isn't on screen.</p>
      {!list ? <Loading /> : list.length === 0 ? (
        <p className="tp-none muted">No two mods that are on react to the same key.</p>
      ) : (
        <ul className="kc-list">
          {list.map((c) => (
            <li key={c.keys.map((k) => `${k.modId}|${k.section}|${k.field}|${k.index}`).join(",")} className="kc-item">
              <div className="kc-h">
                <span className="kbd">{c.label}</span>
                <span className="hint">{plural(new Set(c.keys.map((k) => k.modId)).size, "mod")}</span>
              </div>
              <ul className="kc-mods">
                {c.keys.map((k) => (
                  <li key={`${k.modId}|${k.section}|${k.field}|${k.index}`} className="kc-mod">
                    <span className="kc-name">
                      <button type="button" className="tp-link" title="Open in Mods" onClick={() => go({ view: "library", modId: k.modId })}>{k.name}</button>
                      <span className="hint">{k.what}{k.onScreen ? ", only while on screen" : ", any time"}</span>
                    </span>
                    <span className="kc-acts">
                      {k.fixable && !k.onScreen && (
                        <Button size="sm" busy={busy === `os${k.modId}`} disabled={!!busy && busy !== `os${k.modId}`}
                          title={`Make ${k.name}'s keys work only while ${k.character ?? "its character"} is on screen. Ends the clash unless the other mod is for the same character`}
                          onClick={() => edit(`os${k.modId}`, k.modId, () => modKeys.onScreen(game!, k.modId, true), "Its toggles already work only while on screen")}>Only while on screen</Button>
                      )}
                      <KeyChip line={{ label: k.label, field: k.field, original: null, originalLabel: null, off: false }} disabled={!!busy}
                        title={`Change this key in ${k.name}: click, then press the new key, combination or controller buttons`}
                        onBinding={(b) => edit(`k${k.modId}`, k.modId, () => modKeys.rebind(game!, k.modId, { ini: k.ini, section: k.section, field: k.field, index: k.index }, b), "That's already the key")} />
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      <div className="kc-foot">
        <Button size="sm" icon="keyboard" busy={busy === "all-on"} disabled={!game || (!!busy && busy !== "all-on")}
          title="For every mod with toggles: its toggles work only while its character is on screen. Mods that already do this are left alone"
          onClick={() => all(true)}>Toggles only while on screen for all mods</Button>
        <Button size="sm" variant="ghost" busy={busy === "all-off"} disabled={!game || (!!busy && busy !== "all-off")}
          title="Take gachamod's on-screen check out of every mod again"
          onClick={() => all(false)}>Take it out of all mods</Button>
      </div>
      {gated.list && gated.list.length > 0 && (
        <div className="kc-gated">
          <button type="button" className="kc-gated-t" aria-expanded={gatedOpen} onClick={() => setGatedOpen((o) => !o)}
            title="The mods gachamod added the on-screen check to. Take it out of any one whose toggles stop working in game">
            <Icon name={gatedOpen ? "down" : "chevron"} /><span>Mods with gachamod's on-screen check</span><span className="muted">{gated.list.length}</span>
          </button>
          {gatedOpen && (
            <>
              <p className="hint">If a mod's toggles stop working in game, take the check out of that mod. Its ini goes back to the copy gachamod kept from before.</p>
              <ul className="kc-gated-list">
                {gated.list.map((g) => (
                  <li key={g.modId} className="kc-mod">
                    <span className="kc-name">
                      <button type="button" className="tp-link" title="Open in Mods" onClick={() => go({ view: "library", modId: g.modId })}>{g.name}</button>
                      {(g.character || g.partial || !g.enabled) && (
                        <span className="hint">{[g.character, g.partial ? "some of its files" : null, g.enabled ? null : "turned off"].filter(Boolean).join(", ")}</span>
                      )}
                    </span>
                    <span className="kc-acts">
                      <Button size="sm" variant="ghost" icon="undo" busy={busy === `out${g.modId}`} disabled={!!busy && busy !== `out${g.modId}`}
                        title={`Take the check out of ${g.name}: its toggles work any time again and its ini goes back to how it was. Undo puts the check back`}
                        onClick={() => edit(`out${g.modId}`, g.modId, () => modKeys.onScreen(game!, g.modId, false), "Nothing to take out")}>Take it out</Button>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      {skipped.length > 0 && (
        <div className="kc-skip">
          <p className="hint">{plural(skipped.length, "mod")} stayed as {skipped.length === 1 ? "it was" : "they were"}: {skipped[0]!.reason.charAt(0).toLowerCase() + skipped[0]!.reason.slice(1)}.</p>
          <ul className="kc-skipped hint">{skipped.slice(0, 6).map((s) => <li key={s.modId}>{s.name}</li>)}{skipped.length > 6 && <li>and {skipped.length - 6} more</li>}</ul>
          {aiShown("useful") && game && (
            <Button size="sm" variant="ghost" icon="ai" title="Ask the AI helper which part of these mods draws the character, then apply its answer"
              onClick={() => askAi({ kind: "keys-offscreen", game, modIds: skipped.slice(0, 8).map((s) => s.modId) })}>Ask the AI helper</Button>
          )}
        </div>
      )}
    </Panel>
  );
}

// ── problems (ProblemsPanel.tsx) ──

export { ProblemsPanel } from "./ProblemsPanel";

// ── hash lookup ──

export function HashLookupPanel() {
  const game = useGame()?.id ?? null;
  const [hash, setHash] = useState("");
  const [hits, setHits] = useState<{ hash: string; list: HashHit[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const live = useMounted();

  const find = (e: FormEvent) => {
    e.preventDefault();
    const h = hash.trim();
    if (!game || !h) return;
    setBusy(true);
    modtools.hashLookup(game, h)
      .then((list) => { if (live.current) setHits({ hash: h, list }); })
      .catch((err) => toast(errorText(err), true))
      .finally(() => { if (live.current) setBusy(false); });
  };

  return (
    <Panel id="hash" title="Find a hash" icon="search" className="tp tp-hash">
      <form className="tp-hash-form row" onSubmit={find}>
        <div className="grow">
          <TextField value={hash} onChange={setHash} mono placeholder="7a8b9c0d" label="Hash"
            hint="From a TextureOverride or ShaderOverride section. Shows which mods, on or off, change it." />
        </div>
        <Button type="submit" variant="primary" icon="search" busy={busy} disabled={!hash.trim()}>Find</Button>
      </form>
      {hits && (hits.list.length === 0 ? (
        <p className="tp-none muted">No mod uses {hits.hash}.</p>
      ) : (
        <ul className="tp-list tp-hash-list">
          {hits.list.map((h, i) => (
            <li key={`${h.modId}-${h.ini}-${h.section}-${i}`} className="tp-hash-hit row">
              <button type="button" className="tp-link" title="Open in Mods" onClick={() => go({ view: "library", modId: h.modId })}>{h.name}</button>
              <span className="hint mono grow">{h.ini} [{h.section}]</span>
              <Badge tone={h.enabled ? "ok" : "muted"}>{h.enabled ? "On" : "Off"}</Badge>
            </li>
          ))}
        </ul>
      ))}
    </Panel>
  );
}

// ── packs ──

export function PacksPanel() {
  const g = useGame();
  const games = useGames();
  const withMods = games.filter((x) => x.modsDir && x.modCount > 0);

  const share = (scope: "game" | "all") => {
    if (!g) return;
    if (scope === "game" && g.modCount === 0) { toast(`There are no ${g.short} mods to share yet`); return; }
    if (scope === "all" && withMods.length === 0) { toast("There are no mods to share yet"); return; }
    emitApp({ type: "export-pack", game: g.id, scope });
  };

  const importOne = async () => {
    try {
      const files = await dialogs.pickFiles({ title: "Open a .gachamod file", extensions: ["gachamod"] });
      const path = files?.[0] ?? (inTauri() ? null : "C:\Users\Player\Downloads\Ellen skins.gachamod");
      if (path) emitApp({ type: "open-pack", path });
    } catch (e) { toast(errorText(e), true); }
  };

  return (
    <Panel id="packs" title=".gachamod files" icon="package" className="tp tp-packs">
      <p className="hint tp-intro">
        A .gachamod file lists mods with everything you set on them (on or off, options, key changes, profiles). Mods from
        GameBanana go in as links, so a whole library is usually a few KB and the other PC downloads the rest. Opening one
        in Windows also works.
      </p>
      <div className="tp-packs-a row">
        <Button icon="share" disabled={!g} onClick={() => share("game")}
          title={g ? `Every ${g.short} mod and profile in one file` : undefined}>Share {g?.short ?? ""} library</Button>
        {withMods.length > 1 && (
          <Button icon="share" onClick={() => share("all")} title={`Mods and profiles for ${withMods.map((x) => x.short).join(", ")}`}>Share every game</Button>
        )}
        <Button icon="import" onClick={() => void importOne()} title="Add the mods and profiles from a .gachamod file someone shared">Import a .gachamod</Button>
      </div>
    </Panel>
  );
}

// ── IMM ──

export function ImmPanel() {
  const games = useGames();
  const [info, setInfo] = useState<ImmInfo | null>(null);
  const [ask, setAsk] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const live = useMounted();

  useEffect(() => {
    let on = true;
    imm.detect().then((i) => { if (on) setInfo(i); }).catch((e) => { if (on && errorKind(e) !== "todo") toast(errorText(e), true); });
    return () => { on = false; };
  }, [tick]);

  if (!info?.found || info.games.length === 0) return null;
  const nameOf = (id: string) => games.find((g) => g.id === id)?.name ?? id;
  const asked = info.games.find((g) => g.game === ask);

  const move = async (game: string) => {
    try {
      const r = await imm.takeover(game);
      toast(r.notes[0] ?? `Moved the mods from Integrated Mod Manager`);
      if (r.notes.length > 1) toast(r.notes.slice(1).join(" "), true);
      emitApp({ type: "library-refresh", game });
      if (live.current) setTick((n) => n + 1);
    } catch (e) { toast(errorText(e), true); }
  };

  return (
    <Panel id="imm" title="Mods from Integrated Mod Manager" icon="swap" className="tp tp-imm">
      <p className="hint tp-intro">IMM keeps mods in its own folders. Moving them puts each one in Mods/Character/Mod name, keeps their options and GameBanana links, and turns off the ones that were off.</p>
      <ul className="tp-list tp-imm-list">
        {info.games.map((g) => (
          <li key={g.game} className="tp-imm-game row">
            <span className="tp-imm-name grow">
              <strong>{nameOf(g.game)}</strong>
              <span className="hint"> {plural(g.mods, "mod")}, {g.enabled} on{g.withSource ? `, ${g.withSource} linked to GameBanana` : ""}</span>
            </span>
            <Button icon="swap" onClick={() => setAsk(g.game)} title="Move them into the normal Mods folder, keeping their options and GameBanana links">Move mods from IMM</Button>
          </li>
        ))}
      </ul>
      {asked && (
        <Confirm title={`Move ${plural(asked.mods, "mod")} from IMM?`} yes="Move them" onClose={() => setAsk(null)} onYes={() => move(asked.game)}>
          <p>Close Integrated Mod Manager and {nameOf(asked.game)} first. The mods move out of IMM's folders, so IMM won't list them any more. Nothing is deleted.</p>
        </Confirm>
      )}
    </Panel>
  );
}
