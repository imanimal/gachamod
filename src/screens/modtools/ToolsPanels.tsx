// MODTOOLS panels for the Tools screen: conflicts, key clashes, problems, hash lookup, packs, moving from IMM.
// Owner: MODTOOLS area. SYSTEM's Tools screen renders them.
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { inTauri } from "../../lib/tauri";
import { currentGame, emitApp, onApp, useGame, useGames } from "../../lib/store";
import {
  dialogs, errorKind, errorText, imm, library, modKeys, modtools, shell, type ConflictGroup, type HashHit, type ImmInfo, type KeyClash, type KeyEdit,
  type ModSkip, type OnScreenMod,
} from "../../lib/api";
import { aiShown, askAi, useAiShow } from "../../lib/ai";
import { Badge, Button, Confirm, Panel, Skeleton, TextField, Waiting, plural } from "../../ui/kit";
import { Icon } from "../../ui/Icon";
import { KeyChip, keysChanged, onKeysChanged, recordBackups, recordEdit } from "../../ui/KeyEditor";
import { toast } from "../../ui/toast";
import { notesText, oxford } from "../../lib/notes";
import { jsonPref } from "../../lib/prefs";
import { conflictKey, dropShared, ignoreConflict, setToolsCount, turnOff } from "./toolsBadge";
import { SharedParts } from "./ModInsides";
import "./modtools.css";
import { ModLink } from "./ModLink";

/** Skipped mods grouped by why, so one reason is said once. */
function byReason(list: ModSkip[]): Array<[string, string[]]> {
  const m = new Map<string, string[]>();
  for (const s of list) m.set(s.reason, [...(m.get(s.reason) ?? []), s.name]);
  return [...m];
}

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

const Loading = ({ what }: { what: string }) => <Waiting what={what} className="tp-loading"><Skeleton h="2.6rem" /><Skeleton h="2.6rem" /></Waiting>;

// ── conflicts ──

export function ConflictsPanel() {
  const { game, list, reload } = useGameList<ConflictGroup>(modtools.conflicts);
  const [busy, setBusy] = useState<string | null>(null);
  const live = useMounted();
  const shown = list?.filter((g) => !g.ignored) ?? null;
  const ignored = list?.filter((g) => g.ignored) ?? [];
  useEffect(() => { if (game && shown) setToolsCount(game, "conflicts", shown.map(conflictKey)); }, [game, list]); // eslint-disable-line react-hooks/exhaustive-deps
  // Undo and changes made elsewhere (a mod's details) show here too
  useEffect(() => onApp((e) => { if (e.type === "library-refresh" && e.game === game) reload(); }), [game, reload]);

  const act = (tag: string, job: () => Promise<unknown>) => {
    setBusy(tag);
    job()
      .then(() => { if (live.current) reload(); })
      .catch((e) => toast(errorText(e), true))
      .finally(() => { if (live.current) setBusy(null); });
  };
  const keep = (g: ConflictGroup, keepId: string) => {
    if (!game) return;
    const others = g.mods.filter((m) => m.modId !== keepId);
    act(keepId, () => turnOff(game, others.map((m) => m.modId), others.map((m) => m.name)).then(() => emitApp({ type: "library-refresh", game })));
  };
  const ids = (g: ConflictGroup) => g.mods.map((m) => m.modId);
  const names = (g: ConflictGroup) => g.mods.map((m) => m.name);

  return (
    <Panel id="conflicts" title="Conflicts" icon="layers" className="tp tp-conflicts" count={shown ? shown.length : undefined}
      actions={<Button size="sm" variant="ghost" icon="refresh" onClick={reload} disabled={!list} title="Look for conflicts again">Check again</Button>}>
      <p className="hint tp-intro">Mods that are on and change the same parts of a model. Only one of them shows in game.
        Keep one, take the shared parts out of one so each shows the rest, or ignore it.</p>
      {!shown ? <Loading what="Looking for mods that clash" /> : shown.length === 0 ? (
        <p className="tp-none muted">No conflicts between the mods that are on{ignored.length ? ", apart from the ones you ignore" : ""}.</p>
      ) : (
        <ul className="tp-list tp-conflict-list">
          {shown.map((g) => {
            const key = ids(g).join(",");
            const n = plural(g.hashes.length, "shared part");
            return (
              <li key={key} className="tp-conflict">
                <div className="tp-conflict-h row">
                  {g.character && <span className="tp-conflict-char">{g.character}</span>}
                  <span className="grow"><SharedParts n={g.hashes.length} parts={g.mods[0]?.parts ?? g.hashes} /></span>
                  <Button size="sm" variant="ghost" icon="hide" busy={busy === `i:${key}`} disabled={!!busy}
                    title="Stop listing this conflict. Nothing in the mods changes, and it moves to Ignored below"
                    onClick={() => game && act(`i:${key}`, () => ignoreConflict(game, ids(g), names(g)))}>Ignore</Button>
                </div>
                <ul className="tp-conflict-mods">
                  {g.mods.map((m) => {
                    const others = oxford(g.mods.filter((o) => o.modId !== m.modId).map((o) => o.name));
                    return (
                      <li key={m.modId} className="tp-conflict-mod row">
                        <ModLink game={game} modId={m.modId} name={m.name} className="grow" />
                        <Button size="sm" variant="ghost" busy={busy === `d:${m.modId}`} disabled={!!busy}
                          title={`Take the ${n} out of ${m.name}'s files, so ${others} shows them and ${m.name} keeps the rest. Undo puts them back`}
                          onClick={() => game && act(`d:${m.modId}`, () => dropShared(game, m.modId, g.hashes))}>Remove from this mod</Button>
                        <Button size="sm" busy={busy === m.modId} disabled={!!busy} title={`Keep ${m.name} on and turn ${others} off`}
                          onClick={() => keep(g, m.modId)}>Keep this one</Button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
      {ignored.length > 0 && (
        <details className="tp-ignored">
          <summary className="hint">Ignored ({ignored.length})</summary>
          <ul className="tp-list">
            {ignored.map((g) => {
              const key = ids(g).join(",");
              return (
                <li key={key} className="tp-conflict-mod row">
                  <span className="grow">{oxford(names(g))} <span className="hint">({plural(g.hashes.length, "shared part")})</span></span>
                  <Button size="sm" variant="ghost" busy={busy === `u:${key}`} disabled={!!busy} title="Warn about these mods again"
                    onClick={() => game && act(`u:${key}`, () => ignoreConflict(game, ids(g), names(g), false))}>Stop ignoring</Button>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </Panel>
  );
}

// ── key clashes ──

/** Key clashes the user chose to ignore, by game. A clash is its key plus the mods sharing it, so another mod joining
 *  it shows it again. */
const ignoredClashesPref = jsonPref<Record<string, string[]>>("keyClashes.ignored", {});
const clashKey = (c: KeyClash) => `${c.label}|${[...new Set(c.keys.map((k) => k.modId))].sort().join("+")}`;
const clashNames = (c: KeyClash) => oxford([...new Set(c.keys.map((k) => k.name))]);
function ignoreClash(game: string, c: KeyClash, on: boolean) {
  const all = { ...ignoredClashesPref.get() };
  const k = clashKey(c);
  const now = (all[game] ?? []).filter((x) => x !== k);
  all[game] = on ? [...now, k] : now;
  if (!all[game]!.length) delete all[game];
  void ignoredClashesPref.set(all, on ? `Ignored the ${c.label} clash` : `Showing the ${c.label} clash again`);
}

export function KeyClashesPanel() {
  const { game, list, reload } = useGameList<KeyClash>(modKeys.clashes);
  const gated = useGameList<OnScreenMod>(modKeys.onScreenMods);
  const reloadGated = gated.reload;
  const [gatedOpen, setGatedOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<ModSkip[]>([]);
  const live = useMounted();
  const ignoredKeys = ignoredClashesPref.use();
  const ign = new Set(game ? ignoredKeys[game] ?? [] : []);
  const shown = list?.filter((c) => !ign.has(clashKey(c))) ?? null;
  const ignored = list?.filter((c) => ign.has(clashKey(c))) ?? [];
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
    <Panel id="key-clashes" title="Key clashes" icon="keyboard" className="tp tp-keys" count={shown ? shown.length : undefined}
      actions={<Button size="sm" variant="ghost" icon="refresh" onClick={reload} disabled={!list} title="Look for key clashes again">Check again</Button>}>
      <p className="hint tp-intro">Keys that two mods that are on both use, at times when both can react. Mods for different characters only clash when one of them takes keys while its character isn't on screen.</p>
      {!shown ? <Loading what="Reading mod keys" /> : shown.length === 0 ? (
        <p className="tp-none muted">No two mods that are on react to the same key{ignored.length ? ", apart from the clashes you ignore" : ""}.</p>
      ) : (
        <ul className="kc-list">
          {shown.map((c) => (
            <li key={c.keys.map((k) => `${k.modId}|${k.section}|${k.field}|${k.index}`).join(",")} className="kc-item">
              <div className="kc-h row">
                <span className="kbd">{c.label}</span>
                <span className="hint grow">{plural(new Set(c.keys.map((k) => k.modId)).size, "mod")}</span>
                <Button size="sm" variant="ghost" icon="hide" disabled={!game || !!busy}
                  title="Stop listing this clash. Nothing in the mods changes, and it moves to Ignored below"
                  onClick={() => game && ignoreClash(game, c, true)}>Ignore</Button>
              </div>
              <ul className="kc-mods">
                {c.keys.map((k) => (
                  <li key={`${k.modId}|${k.section}|${k.field}|${k.index}`} className="kc-mod">
                    <span className="kc-name">
                      <ModLink game={game} modId={k.modId} name={k.name} />
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
      {ignored.length > 0 && (
        <details className="tp-ignored">
          <summary className="hint">Ignored ({ignored.length})</summary>
          <ul className="tp-list">
            {ignored.map((c) => (
              <li key={clashKey(c)} className="tp-conflict-mod row">
                <span className="grow"><span className="kbd">{c.label}</span> {clashNames(c)}</span>
                <Button size="sm" variant="ghost" disabled={!game} title="Warn about this key clash again"
                  onClick={() => game && ignoreClash(game, c, false)}>Stop ignoring</Button>
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="kc-foot">
        <Button size="sm" icon="keyboard" busy={busy === "all-on"} disabled={!game || (!!busy && busy !== "all-on")}
          title="For every mod with toggles: its toggles work only while its character is on screen. Mods that already do this are left alone"
          onClick={() => all(true)}>Limit all toggles to on screen</Button>
        <Button size="sm" variant="ghost" busy={busy === "all-off"} disabled={!game || (!!busy && busy !== "all-off")}
          title="Take gachamod's on-screen check out of every mod again"
          onClick={() => all(false)}>Remove on-screen check from all</Button>
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
                      <ModLink game={game} modId={g.modId} name={g.name} />
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
          <p className="hint">{plural(skipped.length, "mod")} stayed as {skipped.length === 1 ? "it was" : "they were"}:</p>
          <ul className="kc-skipped hint">
            {byReason(skipped).map(([reason, names]) => (
              <li key={reason}>{oxford(names, 12)}: {reason.charAt(0).toLowerCase() + reason.slice(1)}</li>
            ))}
          </ul>
          {aiShown("useful") && game && (
            <Button size="sm" variant="ghost" icon="ai" title="Ask the AI helper which part of these mods draws the character, then apply its answer. Takes a strong chatbot, like Claude Opus 5.5"
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
  // results name the last game's mods: a game switch clears them
  useEffect(() => setHits(null), [game]);

  const find = (e: FormEvent) => {
    e.preventDefault();
    const h = hash.trim();
    if (!game || !h) return;
    setBusy(true);
    modtools.hashLookup(game, h)
      .then((list) => { if (live.current && currentGame()?.id === game) setHits({ hash: h, list }); })
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
              <ModLink game={game} modId={h.modId} name={h.name} />
              <span className="grow"><button type="button" className="tp-link hint mono" title={`Open ${h.ini}`}
                onClick={() => void openIni(game, h)}>{h.ini}</button> <span className="hint mono">[{h.section}]</span></span>
              <Badge tone={h.enabled ? "ok" : "muted"}>{h.enabled ? "On" : "Off"}</Badge>
            </li>
          ))}
        </ul>
      ))}
    </Panel>
  );
}

/** Open the ini a hash result names, in the app Windows uses for .ini files. */
async function openIni(game: string | null, h: HashHit) {
  if (!game) return;
  try {
    const m = await library.get(game, h.modId);
    await shell.openPath(`${m.path.replace(/[\\/]+$/, "")}\\${h.ini.replace(/\//g, "\\")}`);
  } catch (e) { toast(errorText(e), true); }
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
      const bad = r.notes.filter((n) => n.startsWith("Couldn't") || n.includes("couldn't"));
      const good = r.notes.filter((n) => !bad.includes(n));
      toast(good.length ? notesText(good) : "Moved the mods from Integrated Mod Manager");
      if (bad.length) toast(notesText(bad), true);
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
          <p>The mods move out of IMM's folders, so IMM won't list them any more. Nothing is deleted.</p>
        </Confirm>
      )}
    </Panel>
  );
}
