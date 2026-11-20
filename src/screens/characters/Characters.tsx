// Characters (Agents in ZZZ ...): the roster with sharp portraits, each tile showing how many mods the character has
// and, behind it, the skin it wears now. Clicking one opens its page (CharacterPage.tsx). The roster grows on its own
// from GameBanana's character list, from the mods you install and from the characters you mark as owned (by hand, or
// imported from an optimizer export dropped on the page). "Only with mods", "Owned" and the sort are remembered.
// Owner: LIBRARY area (docs/spec.md, "Characters").
import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { dialogs, fileUrl, type GameId } from "../../lib/api";
import { charCount, charNoun } from "../../lib/games";
import { t, tn } from "../../lib/i18n";
import { usePortrait, usePortraitBatch } from "../../lib/portraits";
import { useNsfw } from "../../lib/prefs";
import { emitApp, go, useGame, useRoute } from "../../lib/store";
import { inTauri } from "../../lib/tauri";
import { menuHandler } from "../../ui/ContextMenu";
import { addDropTarget } from "../../ui/DropZone";
import { Icon } from "../../ui/Icon";
import { Button, Chip, Empty, IconButton, PageHeader, SearchField, Select, Skeleton, TextField, Toggle, Waiting } from "../../ui/kit";
import { Popover } from "../../ui/Popover";
import { useMods } from "../library/data";
import { moveInGrid } from "../library/gridNav";
import { ModDrawerHost } from "../library/ModDrawer";
import { characterMenu, noteLibrary } from "../library/menus";
import { CharacterPage } from "./CharacterPage";
import { byUid, dismissForeign, forgetUid, forgetUnrecognised, importForeign, importOwned, looksLikeExport, saveOwned, savedUid, setOwned, toggleOwned, useForeign, useOwned, useUnrecognised,
  type OwnedSource } from "./owned";
import { rosterOrder, rosterViewPref, useRoster, type RosterChar, type RosterSort } from "./roster";
import "../library/library.css";
import "./characters.css";
import { LazyImg } from "../../ui/LazyImg";
import { useModsFormat } from "../../lib/theme";

export function Characters() {
  const game = useGame()!;
  const gid = game.id;
  const route = useRoute();
  const { mods, setMods, loaded } = useMods(gid);
  const roster = useRoster(gid, mods);
  const view = rosterViewPref.use();
  const order = useMemo(() => (roster ? rosterOrder(roster, view) : []), [roster, view]);
  const ref = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);
  // a character's page in the Character list and Three panes layouts: the others down the left, and in Three panes the
  // mod's details docked on the right while its mods show (CharacterPage.tsx)
  const format = useModsFormat();
  const side = !!route.character && (format === "chars" || format === "panes");
  const docked = side && format === "panes" && !route.tab;
  useEffect(() => { if (loaded) noteLibrary(gid, mods); }, [gid, mods, loaded]);
  // the last character page you were on gets focus back on the roster
  useEffect(() => { if (route.character) opened.set(gid, route.character); }, [gid, route.character]);

  // an export dropped anywhere on the view marks its characters as owned (Tauri gives paths)
  useEffect(() => addDropTarget({
    el: () => ref.current,
    accepts: (paths) => paths.length === 1 && looksLikeExport(paths[0]!),
    onOver: setOver,
    onDrop: (paths) => void importOwned(gid, { path: paths[0]! }),
  }), [gid]);
  // in a plain browser (the demo) the file's text comes with the drop
  const dropProps = inTauri() ? {} : {
    onDragOver: (e: DragEvent) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } },
    onDragLeave: (e: DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); },
    onDrop: (e: DragEvent) => {
      const f = e.dataTransfer.files[0];
      setOver(false);
      if (!f || !looksLikeExport(f.name)) return;
      e.preventDefault();
      void f.text().then((text) => importOwned(gid, { text }));
    },
  };

  return (
    <div ref={ref} className={`page characters${side ? " has-side" : ""}${docked ? " has-pane" : ""}${over ? " is-drop" : ""}`} {...dropProps}>
      {route.character
        ? <CharacterPage game={gid} name={route.character} roster={roster} order={order} mods={mods} setMods={setMods} loaded={loaded} />
        : <Roster game={gid} roster={roster} loading={!loaded && !mods.length} ready={loaded && !!game.modsDir} />}
      <ModDrawerHost game={gid} mods={mods} loaded={loaded} docked={docked} />
      {over && <div className="char-drop" aria-hidden="true"><Icon name="import" /><strong>{t("Drop to mark these {noun} as owned", { noun: charNoun(gid).toLowerCase() })}</strong></div>}
    </div>
  );
}

// the search box keeps its text when you come back from a character's page
const searches = new Map<GameId, string>();
// and focus goes back to the tile you opened
const opened = new Map<GameId, string>();

function Roster({ game, roster, loading, ready }: { game: GameId; roster: RosterChar[] | null; loading: boolean; ready: boolean }) {
  const view = rosterViewPref.use();
  const [search, setSearchState] = useState(() => searches.get(game) ?? "");
  const [showHidden, setShowHidden] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const setSearch = (s: string) => { searches.set(game, s); setSearchState(s); };
  const setView = (p: Partial<typeof view>) => void rosterViewPref.set({ ...view, ...p });

  const noun = charNoun(game), one = charNoun(game, true).toLowerCase();
  const hiddenCount = roster?.filter((c) => c.hidden).length ?? 0;
  const withMods = roster?.filter((c) => c.mods.length > 0).length ?? 0;
  const ownedCount = roster?.filter((c) => c.owned).length ?? 0;
  const q = search.trim().toLowerCase();
  const shown = useMemo(() => {
    const list = roster ? rosterOrder(roster, view, showHidden) : [];
    return q ? list.filter((c) => c.name.toLowerCase().includes(q)) : list;
  }, [roster, view, showHidden, q]);
  usePortraitBatch(game, shown.map((c) => c.name));
  useEffect(() => {
    const want = opened.get(game), a = document.activeElement;
    if (!want || (a && a !== document.body && !a.matches(".app > .view"))) return;
    const tile = [...(ref.current?.querySelectorAll<HTMLElement>(".roster-tile") ?? [])].find((el) => el.dataset.name === want);
    if (!tile) return;
    opened.delete(game);
    tile.focus({ preventScroll: true });
  }, [game, shown]);

  const sub = roster === null ? t("Loading the roster")
    : ownedCount ? t("{n} of {total} have mods installed, you own {owned}", { n: withMods, total: roster.length, owned: ownedCount })
    : t("{n} of {total} have mods installed", { n: withMods, total: roster.length });
  return (
    <>
      <PageHeader title={noun} icon="characters" sub={sub}
        actions={<>
          <SearchField value={search} onChange={setSearch} placeholder={t("Search {noun}", { noun: noun.toLowerCase() })} />
          <Toggle checked={view.onlyWithMods} onChange={(v) => setView({ onlyWithMods: v })} label={t("Only with mods")}
            title={t("Leave out {noun} with no mods installed", { noun: noun.toLowerCase() })} />
          <Chip on={!!view.owned} icon={view.owned ? "check" : undefined} count={ownedCount} onClick={() => setView({ owned: !view.owned })}
            title={view.owned ? t("Show every {noun}", { noun: one }) : t("Only the {noun} you own. Mark one with O or the right-click menu, or import them all", { noun: noun.toLowerCase() })}>{t("Owned")}</Chip>
          <Select<RosterSort> value={view.sort} onChange={(v) => setView({ sort: v })} title={t("Sort the roster")}
            options={[{ value: "mods", label: t("Most mods") }, { value: "recent", label: t("Recently modded") }, { value: "name", label: t("Name") }]} />
          {hiddenCount > 0 && (
            <Chip on={showHidden} icon="hide" count={hiddenCount} onClick={() => setShowHidden((v) => !v)}
              title={showHidden ? t("Leave out the ones you hid") : t("Show the ones you hid. To bring one back for good, right-click and pick Show in the roster")}>{t("Hidden")}</Chip>
          )}
          <ImportOwned game={game} />
        </>} />

      <Unrecognised game={game} />
      {ready && <OtherManagers game={game} />}

      {roster === null || loading ? (
        <Waiting what={roster === null ? t("Reading the character list") : t("Reading your mods")}>
          <div className="portraits roster">{Array.from({ length: 14 }, (_, i) => <Skeleton key={i} className="roster-skel" />)}</div>
        </Waiting>
      ) : !shown.length ? (
        view.owned && !q && !ownedCount ? (
          <Empty icon="characters" title={t("No owned {noun} yet", { noun: noun.toLowerCase() })} actions={<ImportOwned game={game} primary />}>
            {t("Import them from an optimizer or scanner export (drop the file here), or press O on one to mark it.")}
          </Empty>
        ) : (
          <Empty icon="characters" title={q ? t("No {noun} by that name", { noun: one }) : view.onlyWithMods ? t("No {noun} with mods yet", { noun: noun.toLowerCase() }) : t("No {noun} yet", { noun: noun.toLowerCase() })}>
            {q ? t("Try part of the name, like \"ell\".") : view.onlyWithMods ? t("Turn off \"Only with mods\" to see everyone.") : t("They come from GameBanana's list for this game and from the mods you have.")}
          </Empty>
        )
      ) : (
        <div ref={ref} className="portraits roster" role="group" aria-label={noun} onKeyDown={(e) => moveInGrid(e, ref.current, ".portrait")}>
          {shown.map((c) => <Tile key={c.name} game={game} c={c} />)}
        </div>
      )}
    </>
  );
}

function Tile({ game, c }: { game: GameId; c: RosterChar }) {
  const nsfw = useNsfw();
  const p = usePortrait(game, c.name, c.icon);
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [p.src]);
  const wearing = c.mods.find((m) => m.enabled && m.preview && !(m.nsfw && nsfw !== "show"));
  const n = c.mods.length;
  const initials = c.name.split(/[\s:()]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  const onKey = (e: KeyboardEvent) => {
    if (e.key.toLowerCase() !== "o" || e.ctrlKey || e.altKey || e.metaKey) return;
    e.preventDefault();
    // on a roster of owned ones only, the tile goes away: that toasts with Undo
    void toggleOwned(game, c.name, !!rosterViewPref.get().owned && c.owned);
  };
  const mods = !n ? t("no mods yet") : c.on ? tn(n, "{n} mod, {on} on", "{n} mods, {on} on", { on: c.on }) : tn(n, "{n} mod, default outfit", "{n} mods, default outfit");
  return (
    <button type="button" className={`portrait roster-tile${n ? "" : " dim"}${c.hidden ? " is-hidden" : ""}${c.owned ? " is-owned" : ""}`}
      title={c.owned ? t("{name}: {mods}, owned. Press O to mark as not owned", { name: c.name, mods }) : t("{name}: {mods}. Press O to mark as owned", { name: c.name, mods })}
      data-name={c.name} onClick={() => go({ view: "characters", character: c.name })} onKeyDown={onKey}
      onContextMenu={menuHandler(() => characterMenu(game, c.name, true))}>
      {wearing && <span className="portrait-bg"><LazyImg src={fileUrl(wearing.preview)} alt="" decoding="async" /></span>}
      <span className={`portrait-img${p.sharp ? "" : " is-soft"}`}>
        {p.src && !broken
          ? <LazyImg src={p.src} alt="" decoding="async" draggable={false} onError={() => setBroken(true)} style={p.style} />
          : <span className="roster-tile-initials">{initials}</span>}
      </span>
      {c.owned && <span className="roster-owned" aria-label={t("Owned")}><Icon name="check" /></span>}
      {n > 0 && <span className="portrait-c">{n}</span>}
      <span className="portrait-n">{c.name}</span>
    </button>
  );
}

/** The Import button: pick an export file, read the player's profile by UID, or paste an export or a list of names.
 *  It also saves the owned list as gachamod's own file. */
function ImportOwned({ game, primary }: { game: GameId; primary?: boolean }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [text, setText] = useState("");
  const [uid, setUid] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState<"file" | "uid" | "text" | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const noun = charNoun(game).toLowerCase();
  const owned = useOwned(game);
  const enka = byUid(game);
  useEffect(() => { if (anchor && enka) void savedUid(game).then((v) => { setSaved(!!v); setUid((u) => u || v); }); }, [anchor, enka, game]);
  const run = async (from: OwnedSource) => {
    setBusy("uid" in from ? "uid" : "text" in from ? "text" : "file");
    const r = await importOwned(game, from);
    setBusy(null);
    if (r) { setAnchor(null); setText(""); }
  };
  const uidOk = /^\d{6,10}$/.test(uid.trim());
  const pick = async () => {
    if (!inTauri()) { file.current?.click(); return; }
    const paths = await dialogs.pickFiles({ title: t("Pick an export that lists your {noun}", { noun }), extensions: ["json", "txt", "csv"] });
    if (paths?.[0]) await run({ path: paths[0] });
  };
  return (
    <>
      <Button variant={primary ? "primary" : "secondary"} icon="import" onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
        aria-haspopup="dialog" aria-expanded={!!anchor}
        title={t("Mark the {noun} you own: from an optimizer or scanner export (GOOD, SROD, ZOD, Enka.Network), any JSON that lists them, or pasted names. Dropping the file on this page works too", { noun })}>
        {t("Import owned")}
      </Button>
      <input ref={file} type="file" accept=".json,.txt,.csv,application/json,text/plain" hidden
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void f.text().then((txt) => run({ text: txt })); }} />
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} label={t("Import owned {noun}", { noun })} width="24em">
          <div className="own-import" onKeyDown={(e) => {
            if (e.key !== "Enter" || busy) return;
            if ((e.target as HTMLElement).closest(".own-uid")) { e.preventDefault(); if (uidOk) void run({ uid }); }
            else if (e.ctrlKey && text.trim()) { e.preventDefault(); void run({ text }); }
          }}>
            <Button variant="primary" icon="file" busy={busy === "file"} onClick={() => void pick()} title={t("Read the characters you own from a file an optimizer or scanner saved")}>{t("Choose an export file")}</Button>
            <p className="hint">{t("Genshin Optimizer (GOOD), Star Rail Optimizer (SROD), Zenless Optimizer (ZOD), Enka.Network, HSR scanners, Fribbels, Inventory Kamera, wuwatracker, a file gachamod saved, or any JSON that lists them.")}</p>
            {enka && (
              <div className="own-uid">
                <TextField label={t("Or read your profile by UID")} value={uid} onChange={(v) => setUid(v.replace(/\D/g, ""))} placeholder={t("9 or 10 digits")} />
                <Button busy={busy === "uid"} disabled={!uidOk || !!busy} onClick={() => void run({ uid })}
                  title={t("Reads your public profile on Enka.Network (no sign-in). Enter")}>{t("Read profile")}</Button>
                <span className="hint">{t("Marks the {noun} on your in-game showcase, so put the ones you have there first.", { noun })}</span>
                {saved && <Button size="sm" variant="ghost" onClick={() => { void forgetUid(game); setSaved(false); setUid(""); }}
                  title={t("gachamod keeps the UID you read last to fill this field. This removes it")}>{t("Forget my UID")}</Button>}
              </div>
            )}
            <TextField multiline rows={4} value={text} onChange={setText} placeholder={t("Or paste names, one per line, or the text of an export")} />
            <Button busy={busy === "text"} disabled={!text.trim() || !!busy} onClick={() => void run({ text })} title="Ctrl+Enter">{t("Mark as owned")}</Button>
            <div className="own-save">
              <Button size="sm" variant="ghost" icon="export" disabled={!owned?.size} onClick={() => void saveOwned(game)}
                title={owned?.size ? t("Saves the {count} you own as a JSON file. Import it here to get them back, on this PC or another", { count: charCount(game, owned.size) })
                  : t("Mark some {noun} as owned first", { noun })}>
                {t("Save my list as a file")}
              </Button>
              <Button size="sm" variant="ghost" icon="x" disabled={!owned?.size} onClick={() => void setOwned(game, [...(owned?.values() ?? [])], false, true)}
                title={owned?.size ? t("Marks all {count} as not owned. Undo brings them back", { count: charCount(game, owned.size) }) : t("Mark some {noun} as owned first", { noun })}>
                {t("Clear owned list")}
              </Button>
            </div>
          </div>
        </Popover>
      )}
    </>
  );
}

/** "3 not recognised": the names the last import couldn't match, behind a small link. */
function Unrecognised({ game }: { game: GameId }) {
  const u = useUnrecognised(game);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  if (!u?.names.length) return null;
  return (
    <div className="char-note">
      <button type="button" className="char-note-link" onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
        title={t("Names in the import that matched no character")}>
        {t("{n} not recognised", { n: u.names.length })}
      </button>
      <IconButton icon="x" size="sm" label={t("Forget these")} onClick={() => forgetUnrecognised(game)} />
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} label={t("Not recognised")} align="start" width="22em">
          <div className="own-unknown">
            <p className="hint">{t("Read as {format}. These matched no {noun}: new ones show up once GameBanana lists them. Mark the rest by hand with O.", { format: u.format, noun: charNoun(game, true).toLowerCase() })}</p>
            <ul>{u.names.map((n) => <li key={n}>{n}</li>)}</ul>
          </div>
        </Popover>
      )}
    </div>
  );
}

/** A quiet row when another mod manager (JASM, XXMM ...) saved names, characters or links gachamod hasn't read. */
function OtherManagers({ game }: { game: GameId }) {
  const f = useForeign(game, true);
  const [busy, setBusy] = useState(false);
  if (!f?.fillable) return null;
  const names = f.managers.map((m) => m.manager);
  const who = names.length > 1 ? t("{names} and {last}", { names: names.slice(0, -1).join(", "), last: names[names.length - 1]! }) : names[0] ?? t("another mod manager");
  return (
    <div className="char-note">
      <Icon name="import" />
      <span>{tn(f.fillable, "{n} mod has a name, {noun} or link saved by {who}.", "{n} mods have a name, {noun} or link saved by {who}.", { noun: charNoun(game, true).toLowerCase(), who })}</span>
      <Button size="sm" busy={busy} title={t("Reads their files and fills in what each mod is missing. Their files stay as they are")}
        onClick={() => { setBusy(true); void importForeign(game, () => emitApp({ type: "library-refresh", game })).finally(() => setBusy(false)); }}>
        {t("Import mods")}
      </Button>
      <IconButton icon="x" size="sm" label={t("Not now")} onClick={() => dismissForeign(game)} />
    </div>
  );
}
