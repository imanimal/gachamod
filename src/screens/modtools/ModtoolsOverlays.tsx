// App-wide MODTOOLS layers: the .gachamod import window (app event open-pack), the share window (app events
// export-mods, export-profile, export-pack), and the "tools" nav badge. Owner: MODTOOLS area.
import { useEffect, useRef, useState } from "react";
import { held, inTauri } from "../../lib/tauri";
import { emitApp, go, onApp, useGameId, useGames, useRoute } from "../../lib/store";
import {
  dialogs, errorText, fileUrl, library, modtools, packs, shell,
  type ExportPlan, type GameId, type PackFiles, type PackPreview, type PackPreviewMod, type PackScope,
} from "../../lib/api";
import { modThumbs } from "../../lib/gamebanana";
import { gameName, gameShort } from "../../lib/games";
import { lang, t, tb, tn } from "../../lib/i18n";
import { Badge, Button, Checkbox, Dialog, Progress, Segmented, Skeleton, TextField, Toggle, formatBytes, timeAgo } from "../../ui/kit";
import { Icon } from "../../ui/Icon";
import { toast } from "../../ui/toast";
import { notesText, oxford } from "../../lib/notes";
import { conflictKey, fileName, fixSeenKey, markModSeen, markToolsSeen, setToolsCount } from "./toolsBadge";
import { useBrokenOn } from "../../lib/fixes";
import { badgeKeys, loadLint, useIgnored, useLint } from "./problems";
import "./modtools.css";
import { LazyImg } from "../../ui/LazyImg";

type ExportJob = { game: GameId; scope: PackScope; modIds: string[]; profileId: number | null };

export function ModtoolsOverlays() {
  const [importPath, setImportPath] = useState<string | null>(null);
  const [exportJob, setExportJob] = useState<ExportJob | null>(null);
  const game = useGameId();
  const route = useRoute();

  useEffect(() => onApp((e) => {
    if (e.type === "open-pack") setImportPath(e.path);
    else if (e.type === "export-mods") setExportJob({ game: e.game, scope: "mods", modIds: e.modIds, profileId: null });
    else if (e.type === "export-profile") setExportJob({ game: e.game, scope: "profile", modIds: [], profileId: e.profileId });
    else if (e.type === "export-pack") setExportJob({ game: e.game, scope: e.scope, modIds: [], profileId: null });
  }), []);

  // the tools badge: conflicts plus broken parts of mods that are on (not warnings, not ignored), once per game and
  // after library changes
  const lint = useLint(game);
  const ignored = useIgnored();
  useEffect(() => { if (game && lint) setToolsCount(game, "problems", badgeKeys(lint, ignored, game)); }, [game, lint, ignored]);
  // and mods a game update broke that are on, not set aside, while the warnings aren't muted
  const broken = useBrokenOn(game);
  useEffect(() => { if (game && broken) setToolsCount(game, "fixes", broken.map(fixSeenKey)); }, [game, broken]);
  // looking at a Tools page, or at a mod, clears what it shows from the badge
  const seenView = route.view === "tools" ? "tools" : "modId" in route && typeof route.modId === "string" ? route.modId : null;
  useEffect(() => {
    if (!game || !seenView) return;
    if (seenView === "tools") markToolsSeen(game); else markModSeen(game, seenView);
  }, [game, seenView]);
  useEffect(() => {
    if (!game) return;
    let live = true;
    let timer = 0;
    const count = () => {
      modtools.conflicts(game).then((g) => { if (live) setToolsCount(game, "conflicts", g.filter((x) => !x.ignored).map(conflictKey)); }).catch(() => {});
      void loadLint(game);
    };
    count();
    const offApp = onApp((e) => {
      if (e.type === "library-refresh" && e.game === game) { clearTimeout(timer); timer = window.setTimeout(count, 1500); }
    });
    const offLib = held(library.onChanged((p) => { if (p.game === game) { clearTimeout(timer); timer = window.setTimeout(count, 1500); } }));
    return () => { live = false; clearTimeout(timer); offApp(); offLib(); };
  }, [game]);

  return (
    <>
      {importPath && <PackImport key={importPath} path={importPath} onClose={() => setImportPath(null)} />}
      {exportJob && <PackExport key={`${exportJob.game}-${exportJob.scope}-${exportJob.profileId}-${exportJob.modIds.join(",")}`} job={exportJob} onClose={() => setExportJob(null)} />}
    </>
  );
}

/** Progress events while a pack job runs. */
function usePackProgress(on: boolean): number | null {
  const [p, setP] = useState<number | null>(null);
  useEffect(() => {
    if (!on) { setP(null); return; }
    setP(0);
    return held(packs.onProgress(({ done, total }) => setP(total > 0 ? done / total : null)));
  }, [on]);
  return p;
}

function useMounted() {
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  return live;
}

// ── export ──

const SCOPE_TITLE: Record<PackScope, string> = { mods: t("Share mods"), profile: t("Share profile"), game: t("Share library"), all: t("Share every game") };

/** Files up to this size send in most chat apps (the size the user aimed for). */
const SMALL_FILE = 20 * 1024 * 1024;

/** About how big the file comes out: links are a few hundred bytes a mod, files at most their size. */
function estimate(plan: ExportPlan, files: PackFiles): { size: number; upTo: boolean } {
  const links = Math.max(2048, plan.mods * 700 + plan.profiles * 400);
  if (files === "links") return { size: links, upTo: false };
  if (files === "unlinked") return { size: links + plan.unlinkedSize, upTo: plan.unlinkedSize > 0 };
  return { size: links + plan.totalSize, upTo: true };
}

function PackExport({ job, onClose }: { job: ExportJob; onClose: () => void }) {
  const games = useGames();
  const g = games.find((x) => x.id === job.game);
  const live = useMounted();
  const close = useRef(onClose);
  close.current = onClose;
  const [plan, setPlan] = useState<ExportPlan | null>(null);
  const [title, setTitle] = useState("");
  const [files, setFiles] = useState<PackFiles>("links");
  const [vars, setVars] = useState(true);
  const [busy, setBusy] = useState(false);
  const progress = usePackProgress(busy);

  useEffect(() => {
    packs.plan({ game: job.game, modIds: job.modIds, profileId: job.profileId, scope: job.scope, includeVars: false }).then((p) => {
      if (!live.current) return;
      setPlan(p);
      setTitle(p.title);
      // with every mod linked (or none) two of the choices make the same file
      setFiles(p.linked === 0 ? "files" : p.unlinked === 0 ? "links" : p.suggested);
    }).catch((e) => { toast(errorText(e), true); if (live.current) close.current(); });
  }, [job, live]);

  const what = (() => {
    if (!plan) return "";
    const mods = tn(plan.mods, "{n} mod", "{n} mods");
    const parts = plan.profiles ? t("{mods} and {profiles}", { mods, profiles: tn(plan.profiles, "{n} profile", "{n} profiles") }) : mods;
    if (job.scope === "all") return t("{what} from {games}", { what: parts, games: tn(plan.games.length, "{n} game", "{n} games") });
    return g ? t("{what} for {game}", { what: parts, game: gameName(g) }) : parts;
  })();

  const save = async () => {
    if (!plan) return;
    const name = `${fileName(title)}.gachamod`;
    let dest: string | null;
    try { dest = await dialogs.saveFile({ title: t("Save as"), defaultPath: name, extensions: ["gachamod"] }); }
    catch (e) { toast(errorText(e), true); return; }
    if (!dest && !inTauri()) dest = `C:\\Users\\Player\\Documents\\${name}`;
    if (!dest || !live.current) return;
    setBusy(true);
    try {
      const r = await packs.export({
        game: job.game, modIds: job.modIds, profileId: job.profileId, scope: job.scope, files, includeVars: vars, title: title.trim() || null, dest,
      });
      toast(t("Saved the file ({size})", { size: formatBytes(r.size) }), false, {
        label: t("Show in folder"), run: () => { shell.revealPath(r.path).catch((e) => toast(errorText(e), true)); },
      });
      if (live.current) onClose();
    } catch (e) {
      toast(errorText(e), true);
      if (live.current) setBusy(false);
    }
  };

  const copyLinks = () => {
    if (!plan?.links) return;
    navigator.clipboard.writeText(plan.links)
      .then(() => toast(tn(plan.linked, "Copied {n} link", "Copied {n} links")))
      .catch(() => toast(t("Couldn't copy to the clipboard"), true));
  };

  const est = plan ? estimate(plan, files) : null;
  const unnamed = plan && plan.unlinked > 0
    ? (() => {
      const list = plan.unlinkedNames.slice(0, 8);
      return oxford(plan.unlinked > list.length ? [...list, t("{n} more", { n: plan.unlinked - list.length })] : list, 99);
    })()
    : "";
  const size = est ? formatBytes(est.size) : "";
  const note = !plan || !est ? "" : files === "links"
    ? (plan.unlinked
      ? tn(plan.unlinked, "About {size}. The other PC downloads each mod from GameBanana and sets it up like yours. {n} mod without a GameBanana link only gets named, so send it another way: {names}.",
        "About {size}. The other PC downloads each mod from GameBanana and sets it up like yours. {n} mods without a GameBanana link only get named, so send them another way: {names}.", { size, names: unnamed })
      : t("About {size}. The other PC downloads each mod from GameBanana and sets it up like yours.", { size }))
    : files === "unlinked"
      ? (plan.unlinked
        ? (est.upTo
          ? tn(plan.unlinked, "Up to {size}. Mods from GameBanana go in as links, and the files of the {n} mod without one go in whole ({names}).",
            "Up to {size}. Mods from GameBanana go in as links, and the files of the {n} mods without one go in whole ({names}).", { size, names: unnamed })
          : tn(plan.unlinked, "About {size}. Mods from GameBanana go in as links, and the files of the {n} mod without one go in whole ({names}).",
            "About {size}. Mods from GameBanana go in as links, and the files of the {n} mods without one go in whole ({names}).", { size, names: unnamed }))
        : est.upTo ? t("Up to {size}. Mods from GameBanana go in as links.", { size }) : t("About {size}. Mods from GameBanana go in as links.", { size }))
      : plan.linked === 0
        ? t("Up to {size}. None of these mods have a GameBanana link, so their files go in.", { size })
        : t("Up to {size}. Every mod's files go in, so the other PC doesn't download anything. Good for a backup.", { size });
  const big = !!est && est.size > SMALL_FILE && files !== "links";
  const choices = !plan ? [] : ([
    plan.linked > 0 && { value: "links", label: t("Links only"), title: t("GameBanana links and your settings. The smallest file") },
    plan.linked > 0 && plan.unlinked > 0 && { value: "unlinked", label: t("Links + files"), title: t("Links for GameBanana mods, and the files of mods without a link") },
    { value: "files", label: t("All files"), title: t("Every mod's files, so the other PC downloads nothing") },
  ].filter(Boolean) as Array<{ value: PackFiles; label: string; title: string }>);
  const heading = job.scope === "game" && g ? t("Share {game} library", { game: gameShort(g) }) : SCOPE_TITLE[job.scope];

  return (
    <Dialog title={heading} icon="share" onClose={onClose} className="pack-dialog pack-export"
      locked={busy ? t("Saving the file") : undefined}
      footer={<>
        {plan && plan.linked > 0 && (
          <Button variant="ghost" icon="copy" disabled={busy} onClick={copyLinks} title={t("Copy the GameBanana links as text, to paste in a chat")}>{t("Copy links")}</Button>
        )}
        <span className="grow" />
        <Button variant="ghost" onClick={onClose} disabled={busy}>{t("Cancel")}</Button>
        <Button variant="primary" icon="export" busy={busy} disabled={!plan || !title.trim()} onClick={() => void save()}>{t("Save as...")}</Button>
      </>}>
      {!plan ? (
        <div className="pack-body stack" aria-busy="true"><Skeleton h="1.2rem" w="60%" /><Skeleton h="2.4rem" /><Skeleton h="2.4rem" /></div>
      ) : (
        <div className="pack-body stack">
          <p className="pack-what">{t("{what}, in one .gachamod file. Open it in gachamod on another PC, or send it to a friend.", { what })}</p>
          <TextField label={t("Title")} value={title} onChange={setTitle} placeholder={t("Ellen skins")} hint={t("Shown when the file is opened, and used as the file name.")} disabled={busy} />
          <div className="pack-files">
            <span className="field-l">{t("What goes in the file")}</span>
            {choices.length > 1 && <Segmented<PackFiles> label={t("What goes in the file")} value={files} onChange={setFiles} options={choices} />}
            <p className={`hint${big ? " pack-big" : ""}`}>
              {big ? t("{note} Over 20 MB, so it may not fit in a Discord message.", { note }) : note}
            </p>
          </div>
          <Toggle checked={vars} onChange={setVars} disabled={busy} label={t("Include options and key changes")}
            hint={t("The jacket, colour and other picks made with each mod's toggles, and keys you rebound or turned off.")} />
          {busy && <Progress value={progress} label={t("Saving")} />}
        </div>
      )}
    </Dialog>
  );
}

// ── import ──

type OnExisting = "skip" | "replace" | "keep_both";

function PackImport({ path, onClose }: { path: string; onClose: () => void }) {
  const games = useGames();
  const live = useMounted();
  const close = useRef(onClose);
  close.current = onClose;
  const [pack, setPack] = useState<PackPreview | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [onExisting, setOnExisting] = useState<OnExisting>("skip");
  const [useProfile, setUseProfile] = useState(false);
  const [thumbs, setThumbs] = useState<Map<number, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const progress = usePackProgress(busy);

  useEffect(() => {
    packs.inspect(path).then((p) => {
      if (!live.current) return;
      setPack(p);
      const ready = new Set(p.games.filter((g) => g.ready).map((g) => g.game));
      setChosen(new Set(p.mods.filter((m) => ready.has(m.game) && m.how !== "missing").map((m) => m.index)));
      setUseProfile(p.profiles.length > 0);
    }).catch((e) => { toast(errorText(e), true); if (live.current) close.current(); });
  }, [path, live]);

  // pictures for mods that only came as a link
  useEffect(() => {
    if (!pack) return;
    const ids = pack.mods.filter((m) => !m.preview && m.gbModId).map((m) => m.gbModId!);
    if (!ids.length) return;
    const ac = new AbortController();
    modThumbs(ids, ac.signal).then((found) => { if (live.current) setThumbs(found); }).catch(() => {});
    return () => ac.abort();
  }, [pack, live]);

  const ready = new Set(pack?.games.filter((g) => g.ready).map((g) => g.game) ?? []);
  const usable = (m: PackPreviewMod) => ready.has(m.game) && m.how !== "missing";
  const picked = pack?.mods.filter((m) => chosen.has(m.index)) ?? [];
  const existing = picked.filter((m) => m.existing).length;
  // what the button counts: Skip leaves out the mods already here
  const toImport = chosen.size - (onExisting === "skip" ? existing : 0);
  const fetched = picked.filter((m) => m.how === "download" && (!m.existing || onExisting !== "skip"));
  const inside = picked.filter((m) => m.how === "inside");
  const several = (pack?.games.length ?? 0) > 1;
  const active = pack?.profiles.find((p) => p.active) ?? pack?.profiles[0];
  const canProfile = !!pack && pack.profiles.some((p) => ready.has(p.game));

  const flip = (i: number, on: boolean) => setChosen((c) => { const n = new Set(c); if (on) n.add(i); else n.delete(i); return n; });

  const run = async () => {
    if (!pack) return;
    setBusy(true);
    try {
      const all = pack.mods.filter(usable);
      const every = all.length === chosen.size && all.every((m) => chosen.has(m.index));
      const r = await packs.import(path, { only: every ? [] : [...chosen].sort((a, b) => a - b), onExisting, applyProfile: useProfile && canProfile });
      for (const g of ready) emitApp({ type: "library-refresh", game: g });
      const parts = [
        r.added.length ? tn(r.added.length, "Added {n} mod.", "Added {n} mods.") : "",
        r.queued ? tn(r.queued, "Queued {n} download.", "Queued {n} downloads.") : "",
        r.replaced.length ? tn(r.replaced.length, "Replaced {n} mod.", "Replaced {n} mods.") : "",
        r.skipped ? tn(r.skipped, "Skipped {n} mod you already have.", "Skipped {n} mods you already have.") : "",
        r.profiles.length > 1 ? tn(r.profiles.length, "Made {n} profile.", "Made {n} profiles.") : "",
        r.profileId !== null ? t("Switched to the imported profile.") : "",
      ].filter(Boolean);
      const text = parts.length ? parts.join(lang === "zh-CN" ? "" : " ") : t("Nothing was imported.");
      const added = r.added;
      const target = pack.game;
      if (r.queued) {
        toast(text, false, { label: t("Show downloads"), run: () => go("downloads") });
      } else if (added.length && !r.replaced.length && r.profileId === null && !several) {
        toast(text, false, {
          label: t("Undo"),
          run: () => {
            library.remove(target, added)
              .then(() => { emitApp({ type: "library-refresh", game: target }); toast(tn(added.length, "Removed the imported mod. It's in the trash.", "Removed the imported mods. They're in the trash.")); })
              .catch((e) => toast(errorText(e), true));
          },
        });
      } else toast(text);
      if (r.notes.length) toast(notesText(r.notes), true);
      if (r.missing.length) {
        toast(tn(r.missing.length, "{n} mod wasn't in the file, only its name. Ask the sender for it.", "{n} mods weren't in the file, only their names. Ask the sender for those."));
      }
      if (live.current) onClose();
    } catch (e) {
      toast(errorText(e), true);
      if (live.current) setBusy(false);
    }
  };

  const summary = (() => {
    if (!pack) return "";
    const where = several ? tn(pack.games.length, "{n} game", "{n} games") : (gameName(games.find((g) => g.id === pack.game)) || pack.game);
    const mods = tn(pack.mods.length, "{n} mod", "{n} mods");
    const what = pack.profiles.length ? t("{mods} and {profiles}", { mods, profiles: tn(pack.profiles.length, "{n} profile", "{n} profiles") }) : mods;
    return pack.createdAt ? t("{what} for {where}, made {when}.", { what, where, when: timeAgo(pack.createdAt) }) : t("{what} for {where}.", { what, where });
  })();
  const fetchSize = fetched.reduce((s, m) => s + m.size, 0);
  const howNote = [
    !fetched.length ? "" : fetchSize
      ? tn(fetched.length, "{n} mod will download from GameBanana (about {size}) and get the sender's settings.", "{n} mods will download from GameBanana (about {size}) and get the sender's settings.", { size: formatBytes(fetchSize) })
      : tn(fetched.length, "{n} mod will download from GameBanana and get the sender's settings.", "{n} mods will download from GameBanana and get the sender's settings."),
    inside.length ? tn(inside.length, "{n} mod is inside the file.", "{n} mods are inside the file.") : "",
  ].filter(Boolean).join(lang === "zh-CN" ? "" : " ");

  return (
    <Dialog title={pack ? pack.title || t("Import mods") : t("Opening the file")} icon="import" size="lg" onClose={onClose} className="pack-dialog pack-import"
      locked={busy ? t("Importing") : undefined}
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={busy}>{t("Cancel")}</Button>
        <Button variant="primary" icon="import" busy={busy} disabled={!pack || (toImport === 0 && !(useProfile && canProfile))} onClick={() => void run()}
          title={chosen.size && !toImport ? t("You already have every mod picked. Pick Replace or Keep both to import them anyway") : undefined}>
          {toImport ? tn(toImport, "Import {n} mod", "Import {n} mods") : t("Import")}
        </Button>
      </>}>
      {!pack ? (
        <div className="pack-body stack" aria-busy="true"><Skeleton h="1.2rem" w="50%" /><Skeleton h="3.5rem" /><Skeleton h="3.5rem" /></div>
      ) : (
        <div className="pack-body stack">
          <p className="pack-what">{summary}</p>
          {pack.games.filter((g) => !g.ready).map((g) => (
            <p key={g.game} className="hint pack-skip"><Icon name="warn" /> {g.note ? tb(g.note) : t("{game} isn't set up here.", { game: gameName(g) })} {tn(g.mods, "{n} mod stays out.", "{n} mods stay out.")}</p>
          ))}
          <ul className="pack-mods" aria-label={t("Mods in the file")}>
            {pack.mods.map((m, i) => (
              <PackRow key={m.index} m={m}
                heading={several && pack.mods[i - 1]?.game !== m.game ? (gameName(games.find((g) => g.id === m.game)) || m.game) : null}
                thumb={m.gbModId ? thumbs.get(m.gbModId) ?? null : null}
                on={chosen.has(m.index)} disabled={busy || !usable(m)} onChange={(v) => flip(m.index, v)} />
            ))}
          </ul>
          {pack.mods.length > 1 && (
            <div className="pack-pick row">
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setChosen(new Set(pack.mods.filter(usable).map((m) => m.index)))}>{t("Select all")}</Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setChosen(new Set())}>{t("Select none")}</Button>
            </div>
          )}
          {existing > 0 && (
            <div className="pack-existing">
              <span className="field-l">{tn(existing, "{n} mod you already have", "{n} mods you already have")}</span>
              <Segmented<OnExisting> label={t("Mods you already have")} value={onExisting} onChange={setOnExisting} options={[
                { value: "skip", label: t("Skip"), title: t("Keep your copy and leave the file's out") },
                { value: "replace", label: t("Replace"), title: t("Use the file's copy, or download it again. Yours goes to the trash") },
                { value: "keep_both", label: t("Keep both"), title: t("Add the file's copy next to yours") },
              ]} />
            </div>
          )}
          {canProfile && pack.profiles.length === 1 && (
            <Toggle checked={useProfile} onChange={setUseProfile} disabled={busy} label={t("Use its profile \"{name}\"", { name: pack.profiles[0]!.name })}
              hint={t("Makes a profile with these mods and switches to it. Your other profiles stay as they are.")} />
          )}
          {canProfile && pack.profiles.length > 1 && (
            <Toggle checked={useProfile} onChange={setUseProfile} disabled={busy} label={tn(pack.profiles.length, "Add its {n} profile", "Add its {n} profiles")}
              hint={active ? t("Switches to \"{name}\", the one in use when the file was made. Your own profiles stay as they are.", { name: active.name }) : t("Your own profiles stay as they are.")} />
          )}
          {busy && <Progress value={progress} label={t("Importing")} />}
          {!busy && howNote && <p className="hint">{howNote}</p>}
        </div>
      )}
    </Dialog>
  );
}

function PackRow({ m, heading, thumb, on, disabled, onChange }:
  { m: PackPreviewMod; heading: string | null; thumb: string | null; on: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  const [broken, setBroken] = useState(false);
  const src = fileUrl(m.preview) ?? thumb;
  return (
    <>
      {heading && <li className="pack-game field-l" aria-hidden="true">{heading}</li>}
      <li className={`pack-mod${on ? " on" : ""}`} title={m.url ?? undefined}>
        <Checkbox checked={on} disabled={disabled} onChange={onChange} label={
          <span className="pack-mod-main">
            <span className="pack-mod-img" aria-hidden="true">
              {src && !broken ? <LazyImg src={src} alt="" decoding="async" onError={() => setBroken(true)} /> : <Icon name="package" />}
            </span>
            <span className="pack-mod-t">
              <span className="pack-mod-name">{m.name}</span>
              <span className="pack-mod-sub hint">{[m.character, m.size ? formatBytes(m.size) : ""].filter(Boolean).join(", ")}</span>
            </span>
          </span>
        } />
        <span className="pack-mod-tags">
          {m.how === "download" && <Badge tone="info" icon="downloads" title={t("Comes from GameBanana, then gets the sender's settings")}>{t("Download")}</Badge>}
          {m.how === "missing" && <Badge tone="warn" title={t("The file only names this mod. It has no GameBanana link and its files aren't inside")}>{t("No link")}</Badge>}
          {!m.enabled && <Badge tone="muted" title={t("Comes in turned off")}>{t("Off")}</Badge>}
          {m.existing && <Badge tone="ok" title={t("The same mod is already in your library")}>{t("In library")}</Badge>}
        </span>
      </li>
    </>
  );
}
