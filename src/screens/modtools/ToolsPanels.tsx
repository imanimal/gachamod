// MODTOOLS panels for the Tools screen: conflicts, key clashes, problems, hash lookup, packs.
// Owner: MODTOOLS area. SYSTEM's Tools screen renders them.
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { inTauri } from "../../lib/tauri";
import { currentGame, emitApp, onApp, useGame, useGames } from "../../lib/store";
import {
  dialogs, errorKind, errorText, library, modKeys, modtools, shell, type ConflictGroup, type HashHit, type KeyClash, type KeyEdit,
  type ModSkip, type OnScreenMod,
} from "../../lib/api";
import { aiShown, askAi, useAiShow } from "../../lib/ai";
import { gameShort } from "../../lib/games";
import { t, tb, tn } from "../../lib/i18n";
import { Badge, Button, Panel, Skeleton, TextField, Waiting } from "../../ui/kit";
import { Icon } from "../../ui/Icon";
import { KeyChip, keysChanged, onKeysChanged, recordBackups, recordEdit } from "../../ui/KeyEditor";
import { toast } from "../../ui/toast";
import { oxford } from "../../lib/notes";
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

/** "Couldn't read it" -> "couldn't read it", for a reason after a colon. */
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
/** How many mods a key clash has. */
const modCount = (c: KeyClash) => { const n = new Set(c.keys.map((k) => k.modId)).size; return tn(n, "{n} mod", "{n} mods"); };

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
    <Panel id="conflicts" title={t("Conflicts")} icon="layers" className="tp tp-conflicts" count={shown ? shown.length : undefined}
      actions={<Button size="sm" variant="ghost" icon="refresh" onClick={reload} disabled={!list} title={t("Look for conflicts again")}>{t("Check again")}</Button>}>
      <p className="hint tp-intro">{t("Mods that are on and change the same parts of a model. Only one of them shows in game. Keep one, take the shared parts out of one so each shows the rest, or ignore it.")}</p>
      {!shown ? <Loading what={t("Looking for mods that clash")} /> : shown.length === 0 ? (
        <p className="tp-none muted">{ignored.length ? t("No conflicts between the mods that are on, apart from the ones you ignore.") : t("No conflicts between the mods that are on.")}</p>
      ) : (
        <ul className="tp-list tp-conflict-list">
          {shown.map((g) => {
            const key = ids(g).join(",");
            return (
              <li key={key} className="tp-conflict">
                <div className="tp-conflict-h row">
                  {g.character && <span className="tp-conflict-char">{g.character}</span>}
                  <span className="grow"><SharedParts n={g.hashes.length} parts={g.mods[0]?.parts ?? g.hashes} /></span>
                  <Button size="sm" variant="ghost" icon="hide" busy={busy === `i:${key}`} disabled={!!busy}
                    title={t("Stop listing this conflict. Nothing in the mods changes, and it moves to Ignored below")}
                    onClick={() => game && act(`i:${key}`, () => ignoreConflict(game, ids(g), names(g)))}>{t("Ignore")}</Button>
                </div>
                <ul className="tp-conflict-mods">
                  {g.mods.map((m) => {
                    const others = oxford(g.mods.filter((o) => o.modId !== m.modId).map((o) => o.name));
                    return (
                      <li key={m.modId} className="tp-conflict-mod row">
                        <ModLink game={game} modId={m.modId} name={m.name} className="grow" />
                        <Button size="sm" variant="ghost" busy={busy === `d:${m.modId}`} disabled={!!busy}
                          title={tn(g.hashes.length, "Take the {n} shared part out of {mod}'s files, so {others} shows it and {mod} keeps the rest. Undo puts it back",
                            "Take the {n} shared parts out of {mod}'s files, so {others} shows them and {mod} keeps the rest. Undo puts them back", { mod: m.name, others })}
                          onClick={() => game && act(`d:${m.modId}`, () => dropShared(game, m.modId, g.hashes))}>{t("Remove from this mod")}</Button>
                        <Button size="sm" busy={busy === m.modId} disabled={!!busy} title={t("Keep {name} on and turn {others} off", { name: m.name, others })}
                          onClick={() => keep(g, m.modId)}>{t("Keep this one")}</Button>
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
          <summary className="hint">{t("Ignored ({n})", { n: ignored.length })}</summary>
          <ul className="tp-list">
            {ignored.map((g) => {
              const key = ids(g).join(",");
              return (
                <li key={key} className="tp-conflict-mod row">
                  <span className="grow">{oxford(names(g))} <span className="hint">({tn(g.hashes.length, "{n} shared part", "{n} shared parts")})</span></span>
                  <Button size="sm" variant="ghost" busy={busy === `u:${key}`} disabled={!!busy} title={t("Warn about these mods again")}
                    onClick={() => game && act(`u:${key}`, () => ignoreConflict(game, ids(g), names(g), false))}>{t("Stop ignoring")}</Button>
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
  void ignoredClashesPref.set(all, on ? t("Ignored the {key} clash", { key: c.label }) : t("Showing the {key} clash again", { key: c.label }));
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
        const n = r.changed.length;
        recordBackups(on ? tn(n, "Toggles of {n} mod work only while on screen", "Toggles of {n} mods work only while on screen")
          : tn(n, "Toggles of {n} mod work any time again", "Toggles of {n} mods work any time again"), r.changed.map((c) => ({ game, modId: c.modId, backup: c.backup })));
        r.changed.forEach((c) => keysChanged(game, c.modId));
        // show which mods got it, so the check can come out of one that misbehaves
        if (on && live.current) setGatedOpen(true);
      } else {
        toast(on ? t("Every mod with toggles already works this way") : t("No mod had gachamod's check to take out"));
      }
      if (live.current) setSkipped(on ? r.skipped : []);
    } catch (e) {
      toast(errorText(e), true);
    } finally {
      if (live.current) setBusy(null);
    }
  };

  return (
    <Panel id="key-clashes" title={t("Key clashes")} icon="keyboard" className="tp tp-keys" count={shown ? shown.length : undefined}
      actions={<Button size="sm" variant="ghost" icon="refresh" onClick={reload} disabled={!list} title={t("Look for key clashes again")}>{t("Check again")}</Button>}>
      <p className="hint tp-intro">{t("Keys that two mods that are on both use, at times when both can react. Mods for different characters only clash when one of them takes keys while its character isn't on screen.")}</p>
      {!shown ? <Loading what={t("Reading mod keys")} /> : shown.length === 0 ? (
        <p className="tp-none muted">{ignored.length ? t("No two mods that are on react to the same key, apart from the clashes you ignore.") : t("No two mods that are on react to the same key.")}</p>
      ) : (
        <ul className="kc-list">
          {shown.map((c) => (
            <li key={c.keys.map((k) => `${k.modId}|${k.section}|${k.field}|${k.index}`).join(",")} className="kc-item">
              <div className="kc-h row">
                <span className="kbd">{c.label}</span>
                <span className="hint grow">{modCount(c)}</span>
                <Button size="sm" variant="ghost" icon="hide" disabled={!game || !!busy}
                  title={t("Stop listing this clash. Nothing in the mods changes, and it moves to Ignored below")}
                  onClick={() => game && ignoreClash(game, c, true)}>{t("Ignore")}</Button>
              </div>
              <ul className="kc-mods">
                {c.keys.map((k) => (
                  <li key={`${k.modId}|${k.section}|${k.field}|${k.index}`} className="kc-mod">
                    <span className="kc-name">
                      <ModLink game={game} modId={k.modId} name={k.name} />
                      <span className="hint">{k.onScreen ? t("{what}, only while on screen", { what: k.what }) : t("{what}, any time", { what: k.what })}</span>
                    </span>
                    <span className="kc-acts">
                      {k.fixable && !k.onScreen && (
                        <Button size="sm" busy={busy === `os${k.modId}`} disabled={!!busy && busy !== `os${k.modId}`}
                          title={t("Make {name}'s keys work only while {character} is on screen. Ends the clash unless the other mod is for the same character", { name: k.name, character: k.character ?? t("its character") })}
                          onClick={() => edit(`os${k.modId}`, k.modId, () => modKeys.onScreen(game!, k.modId, true), t("Its toggles already work only while on screen"))}>{t("Only while on screen")}</Button>
                      )}
                      <KeyChip line={{ label: k.label, field: k.field, original: null, originalLabel: null, off: false }} disabled={!!busy}
                        title={t("Change this key in {name}: click, then press the new key, combination or controller buttons", { name: k.name })}
                        onBinding={(b) => edit(`k${k.modId}`, k.modId, () => modKeys.rebind(game!, k.modId, { ini: k.ini, section: k.section, field: k.field, index: k.index }, b), t("That's already the key"))} />
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
          <summary className="hint">{t("Ignored ({n})", { n: ignored.length })}</summary>
          <ul className="tp-list">
            {ignored.map((c) => (
              <li key={clashKey(c)} className="tp-conflict-mod row">
                <span className="grow"><span className="kbd">{c.label}</span> {clashNames(c)}</span>
                <Button size="sm" variant="ghost" disabled={!game} title={t("Warn about this key clash again")}
                  onClick={() => game && ignoreClash(game, c, false)}>{t("Stop ignoring")}</Button>
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="kc-foot">
        <Button size="sm" icon="keyboard" busy={busy === "all-on"} disabled={!game || (!!busy && busy !== "all-on")}
          title={t("For every mod with toggles: its toggles work only while its character is on screen. Mods that already do this are left alone")}
          onClick={() => all(true)}>{t("Limit all toggles to on screen")}</Button>
        <Button size="sm" variant="ghost" busy={busy === "all-off"} disabled={!game || (!!busy && busy !== "all-off")}
          title={t("Take gachamod's on-screen check out of every mod again")}
          onClick={() => all(false)}>{t("Remove on-screen check from all")}</Button>
      </div>
      {gated.list && gated.list.length > 0 && (
        <div className="kc-gated">
          <button type="button" className="kc-gated-t" aria-expanded={gatedOpen} onClick={() => setGatedOpen((o) => !o)}
            title={t("The mods gachamod added the on-screen check to. Take it out of any one whose toggles stop working in game")}>
            <Icon name={gatedOpen ? "down" : "chevron"} /><span>{t("Mods with gachamod's on-screen check")}</span><span className="muted">{gated.list.length}</span>
          </button>
          {gatedOpen && (
            <>
              <p className="hint">{t("If a mod's toggles stop working in game, take the check out of that mod. Its ini goes back to the copy gachamod kept from before.")}</p>
              <ul className="kc-gated-list">
                {gated.list.map((g) => (
                  <li key={g.modId} className="kc-mod">
                    <span className="kc-name">
                      <ModLink game={game} modId={g.modId} name={g.name} />
                      {(g.character || g.partial || !g.enabled) && (
                        <span className="hint">{[g.character, g.partial ? t("some of its files") : null, g.enabled ? null : t("turned off")].filter(Boolean).join(", ")}</span>
                      )}
                    </span>
                    <span className="kc-acts">
                      <Button size="sm" variant="ghost" icon="undo" busy={busy === `out${g.modId}`} disabled={!!busy && busy !== `out${g.modId}`}
                        title={t("Take the check out of {name}: its toggles work any time again and its ini goes back to how it was. Undo puts the check back", { name: g.name })}
                        onClick={() => edit(`out${g.modId}`, g.modId, () => modKeys.onScreen(game!, g.modId, false), t("Nothing to take out"))}>{t("Take it out")}</Button>
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
          <p className="hint">{tn(skipped.length, "{n} mod stayed as it was:", "{n} mods stayed as they were:")}</p>
          <ul className="kc-skipped hint">
            {byReason(skipped).map(([reason, names]) => (
              <li key={reason}>{t("{names}: {reason}", { names: oxford(names, 12), reason: lowerFirst(tb(reason)) })}</li>
            ))}
          </ul>
          {aiShown("useful") && game && (
            <Button size="sm" variant="ghost" icon="ai" title={t("Ask the AI helper which part of these mods draws the character, then apply its answer. Takes a strong chatbot, like {model}", { model: "Claude Opus 5.5" })}
              onClick={() => askAi({ kind: "keys-offscreen", game, modIds: skipped.slice(0, 8).map((s) => s.modId) })}>{t("Ask the AI helper")}</Button>
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
    <Panel id="hash" title={t("Find a hash")} icon="search" className="tp tp-hash">
      <form className="tp-hash-form row" onSubmit={find}>
        <div className="grow">
          <TextField value={hash} onChange={setHash} mono placeholder="7a8b9c0d" label={t("Hash")}
            hint={t("From a TextureOverride or ShaderOverride section. Shows which mods, on or off, change it.")} />
        </div>
        <Button type="submit" variant="primary" icon="search" busy={busy} disabled={!hash.trim()}>{t("Find")}</Button>
      </form>
      {hits && (hits.list.length === 0 ? (
        <p className="tp-none muted">{t("No mod uses {hash}.", { hash: hits.hash })}</p>
      ) : (
        <ul className="tp-list tp-hash-list">
          {hits.list.map((h, i) => (
            <li key={`${h.modId}-${h.ini}-${h.section}-${i}`} className="tp-hash-hit row">
              <ModLink game={game} modId={h.modId} name={h.name} />
              <span className="grow"><button type="button" className="tp-link hint mono" title={t("Open {file}", { file: h.ini })}
                onClick={() => void openIni(game, h)}>{h.ini}</button> <span className="hint mono">[{h.section}]</span></span>
              <Badge tone={h.enabled ? "ok" : "muted"}>{h.enabled ? t("On") : t("Off")}</Badge>
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
    if (scope === "game" && g.modCount === 0) { toast(t("There are no {game} mods to share yet", { game: gameShort(g) })); return; }
    if (scope === "all" && withMods.length === 0) { toast(t("There are no mods to share yet")); return; }
    emitApp({ type: "export-pack", game: g.id, scope });
  };

  const importOne = async () => {
    try {
      const files = await dialogs.pickFiles({ title: t("Open a .gachamod file"), extensions: ["gachamod"] });
      const path = files?.[0] ?? (inTauri() ? null : "C:\Users\Player\Downloads\Ellen skins.gachamod");
      if (path) emitApp({ type: "open-pack", path });
    } catch (e) { toast(errorText(e), true); }
  };

  return (
    <Panel id="packs" title={t(".gachamod files")} icon="package" className="tp tp-packs">
      <p className="hint tp-intro">
        {t("A .gachamod file lists mods with everything you set on them (on or off, options, key changes, profiles). Mods from GameBanana go in as links, so a whole library is usually a few KB and the other PC downloads the rest. Opening one in Windows also works.")}
      </p>
      <div className="tp-packs-a row">
        <Button icon="share" disabled={!g} onClick={() => share("game")}
          title={g ? t("Every {game} mod and profile in one file", { game: gameShort(g) }) : undefined}>{g ? t("Share {game} library", { game: gameShort(g) }) : t("Share library")}</Button>
        {withMods.length > 1 && (
          <Button icon="share" onClick={() => share("all")} title={t("Mods and profiles for {games}", { games: withMods.map((x) => gameShort(x)).join(", ") })}>{t("Share every game")}</Button>
        )}
        <Button icon="import" onClick={() => void importOne()} title={t("Add the mods and profiles from a .gachamod file someone shared")}>{t("Import a .gachamod")}</Button>
      </div>
    </Panel>
  );
}
