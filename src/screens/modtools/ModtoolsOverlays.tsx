// App-wide MODTOOLS layers: the .gachamod import window (app event open-pack), the share window (app events
// export-mods, export-profile, export-pack), and the "tools" nav badge. Owner: MODTOOLS area.
import { useEffect, useRef, useState } from "react";
import { held, inTauri } from "../../lib/tauri";
import { emitApp, go, onApp, useGameId, useGames } from "../../lib/store";
import {
  dialogs, errorText, fileUrl, library, modtools, packs, shell,
  type ExportPlan, type GameId, type PackFiles, type PackPreview, type PackPreviewMod, type PackScope,
} from "../../lib/api";
import { modThumbs } from "../../lib/gamebanana";
import { Badge, Button, Checkbox, Dialog, Progress, Segmented, Skeleton, TextField, Toggle, formatBytes, plural, timeAgo } from "../../ui/kit";
import { Icon } from "../../ui/Icon";
import { toast } from "../../ui/toast";
import { fileName, setToolsCount } from "./toolsBadge";
import { badgeCount, loadLint, useIgnored, useLint } from "./problems";
import "./modtools.css";

type ExportJob = { game: GameId; scope: PackScope; modIds: string[]; profileId: number | null };

export function ModtoolsOverlays() {
  const [importPath, setImportPath] = useState<string | null>(null);
  const [exportJob, setExportJob] = useState<ExportJob | null>(null);
  const game = useGameId();

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
  useEffect(() => { if (game && lint) setToolsCount(game, "problems", badgeCount(lint, ignored, game)); }, [game, lint, ignored]);
  useEffect(() => {
    if (!game) return;
    let live = true;
    let timer = 0;
    const count = () => {
      modtools.conflicts(game).then((g) => { if (live) setToolsCount(game, "conflicts", g.length); }).catch(() => {});
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

const SCOPE_TITLE: Record<PackScope, string> = { mods: "Share mods", profile: "Share profile", game: "Share library", all: "Share every game" };

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
    const parts = [plural(plan.mods, "mod"), plan.profiles ? plural(plan.profiles, "profile") : ""].filter(Boolean).join(" and ");
    if (job.scope === "all") return `${parts} from ${plural(plan.games.length, "game")}`;
    return g ? `${parts} for ${g.name}` : parts;
  })();

  const save = async () => {
    if (!plan) return;
    const name = `${fileName(title)}.gachamod`;
    let dest: string | null;
    try { dest = await dialogs.saveFile({ title: "Save as", defaultPath: name, extensions: ["gachamod"] }); }
    catch (e) { toast(errorText(e), true); return; }
    if (!dest && !inTauri()) dest = `C:\\Users\\Player\\Documents\\${name}`;
    if (!dest || !live.current) return;
    setBusy(true);
    try {
      const r = await packs.export({
        game: job.game, modIds: job.modIds, profileId: job.profileId, scope: job.scope, files, includeVars: vars, title: title.trim() || null, dest,
      });
      const file = r.path.split(/[\\/]/).pop() ?? r.path;
      toast(`Saved ${file} (${formatBytes(r.size)})`, false, {
        label: "Show in folder", run: () => { shell.revealPath(r.path).catch((e) => toast(errorText(e), true)); },
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
      .then(() => toast(`Copied ${plural(plan.linked, "link")}`))
      .catch(() => toast("Couldn't copy to the clipboard", true));
  };

  const est = plan ? estimate(plan, files) : null;
  const unnamed = plan && plan.unlinked > 0
    ? `${plan.unlinkedNames.slice(0, 3).join(", ")}${plan.unlinked > 3 ? ` and ${plan.unlinked - 3} more` : ""}`
    : "";
  const them = plan?.unlinked === 1 ? "it" : "them";
  const note = !plan || !est ? "" : files === "links"
    ? `About ${formatBytes(est.size)}. The other PC downloads each mod from GameBanana and sets it up like yours.`
      + (plan.unlinked ? ` ${plural(plan.unlinked, "mod")} without a GameBanana link only get named, so send ${them} another way: ${unnamed}.` : "")
    : files === "unlinked"
      ? `${est.upTo ? "Up to" : "About"} ${formatBytes(est.size)}. Mods from GameBanana go in as links`
        + (plan.unlinked ? `, and the files of the ${plural(plan.unlinked, "mod")} without one go in whole (${unnamed}).` : ".")
      : plan.linked === 0
        ? `Up to ${formatBytes(est.size)}. None of these mods have a GameBanana link, so their files go in.`
        : `Up to ${formatBytes(est.size)}. Every mod's files go in, so the other PC doesn't download anything. Good for a backup.`;
  const big = !!est && est.size > SMALL_FILE && files !== "links";
  const choices = !plan ? [] : ([
    plan.linked > 0 && { value: "links", label: "Links only", title: "GameBanana links and your settings. The smallest file" },
    plan.linked > 0 && plan.unlinked > 0 && { value: "unlinked", label: "Links + files", title: "Links for GameBanana mods, and the files of mods without a link" },
    { value: "files", label: "All files", title: "Every mod's files, so the other PC downloads nothing" },
  ].filter(Boolean) as Array<{ value: PackFiles; label: string; title: string }>);
  const heading = job.scope === "game" && g ? `Share ${g.short} library` : SCOPE_TITLE[job.scope];

  return (
    <Dialog title={heading} icon="share" onClose={onClose} className="pack-dialog pack-export"
      locked={busy ? "Saving the file" : undefined}
      footer={<>
        {plan && plan.linked > 0 && (
          <Button variant="ghost" icon="copy" disabled={busy} onClick={copyLinks} title="Copy the GameBanana links as text, to paste in a chat">Copy links</Button>
        )}
        <span className="grow" />
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" icon="export" busy={busy} disabled={!plan || !title.trim()} onClick={() => void save()}>Save as...</Button>
      </>}>
      {!plan ? (
        <div className="pack-body stack" aria-busy="true"><Skeleton h="1.2rem" w="60%" /><Skeleton h="2.4rem" /><Skeleton h="2.4rem" /></div>
      ) : (
        <div className="pack-body stack">
          <p className="pack-what">{what}, in one .gachamod file. Open it in gachamod on another PC, or send it to a friend.</p>
          <TextField label="Title" value={title} onChange={setTitle} placeholder="Ellen skins" hint="Shown when the file is opened, and used as the file name." disabled={busy} />
          <div className="pack-files">
            <span className="field-l">What goes in the file</span>
            {choices.length > 1 && <Segmented<PackFiles> label="What goes in the file" value={files} onChange={setFiles} options={choices} />}
            <p className={`hint${big ? " pack-big" : ""}`}>
              {note}{big ? " Over 20 MB, so it may not fit in a Discord message." : ""}
            </p>
          </div>
          <Toggle checked={vars} onChange={setVars} disabled={busy} label="Include options and key changes"
            hint="The jacket, colour and other picks made with each mod's toggles, and keys you rebound or turned off." />
          {busy && <Progress value={progress} label="Saving" />}
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
    modThumbs(ids, ac.signal).then((t) => { if (live.current) setThumbs(t); }).catch(() => {});
    return () => ac.abort();
  }, [pack, live]);

  const ready = new Set(pack?.games.filter((g) => g.ready).map((g) => g.game) ?? []);
  const usable = (m: PackPreviewMod) => ready.has(m.game) && m.how !== "missing";
  const picked = pack?.mods.filter((m) => chosen.has(m.index)) ?? [];
  const existing = picked.filter((m) => m.existing).length;
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
      const switched = r.profileId !== null ? (active?.name ?? "its profile") : null;
      const parts = [
        r.added.length ? `added ${plural(r.added.length, "mod")}` : "",
        r.queued ? `${r.queued === 1 ? "1 download is" : `${r.queued} downloads are`} on the way` : "",
        r.replaced.length ? `replaced ${r.replaced.length}` : "",
        r.skipped ? `skipped ${r.skipped} you already have` : "",
        r.profiles.length > 1 ? `made ${plural(r.profiles.length, "profile")}` : "",
        switched ? `switched to ${switched}` : "",
      ].filter(Boolean);
      const text = parts.length ? `${parts.join(", ").replace(/^./, (c) => c.toUpperCase())}.` : "Nothing was imported.";
      const added = r.added;
      const target = pack.game;
      if (r.queued) {
        toast(text, false, { label: "Show downloads", run: () => go("downloads") });
      } else if (added.length && !r.replaced.length && r.profileId === null && !several) {
        toast(text, false, {
          label: "Undo",
          run: () => {
            library.remove(target, added)
              .then(() => { emitApp({ type: "library-refresh", game: target }); toast(`Removed the imported ${added.length === 1 ? "mod" : "mods"}. They're in Recently removed.`); })
              .catch((e) => toast(errorText(e), true));
          },
        });
      } else toast(text);
      if (r.notes.length) toast(r.notes.join(" "), true);
      if (r.missing.length) {
        toast(`The file only names ${r.missing.slice(0, 5).join(", ")}${r.missing.length > 5 ? ` and ${r.missing.length - 5} more` : ""}. Ask the sender for ${r.missing.length === 1 ? "it" : "those"}.`);
      }
      if (live.current) onClose();
    } catch (e) {
      toast(errorText(e), true);
      if (live.current) setBusy(false);
    }
  };

  const summary = (() => {
    if (!pack) return "";
    const where = several ? plural(pack.games.length, "game") : (games.find((g) => g.id === pack.game)?.name ?? pack.game);
    const profs = pack.profiles.length ? ` and ${plural(pack.profiles.length, "profile")}` : "";
    return `${plural(pack.mods.length, "mod")}${profs} for ${where}${pack.createdAt ? `, made ${timeAgo(pack.createdAt)}` : ""}.`;
  })();
  const fetchSize = fetched.reduce((s, m) => s + m.size, 0);
  const howNote = [
    fetched.length ? `${plural(fetched.length, "mod")} will download from GameBanana${fetchSize ? ` (about ${formatBytes(fetchSize)})` : ""} and get the sender's settings` : "",
    inside.length ? `${plural(inside.length, "mod")} ${inside.length === 1 ? "is" : "are"} inside the file` : "",
  ].filter(Boolean).join(". ");

  return (
    <Dialog title={pack ? pack.title || "Import mods" : "Opening the file"} icon="import" size="lg" onClose={onClose} className="pack-dialog pack-import"
      locked={busy ? "Importing" : undefined}
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" icon="import" busy={busy} disabled={!pack || (chosen.size === 0 && !(useProfile && canProfile))} onClick={() => void run()}>
          {chosen.size ? `Import ${plural(chosen.size, "mod")}` : "Import"}
        </Button>
      </>}>
      {!pack ? (
        <div className="pack-body stack" aria-busy="true"><Skeleton h="1.2rem" w="50%" /><Skeleton h="3.5rem" /><Skeleton h="3.5rem" /></div>
      ) : (
        <div className="pack-body stack">
          <p className="pack-what">{summary}</p>
          {pack.games.filter((g) => !g.ready).map((g) => (
            <p key={g.game} className="hint pack-skip"><Icon name="warn" /> {g.note ?? `${g.name} isn't set up here.`} Its {plural(g.mods, "mod")} stay out.</p>
          ))}
          <ul className="pack-mods" aria-label="Mods in the file">
            {pack.mods.map((m, i) => (
              <PackRow key={m.index} m={m}
                heading={several && pack.mods[i - 1]?.game !== m.game ? (games.find((g) => g.id === m.game)?.name ?? m.game) : null}
                thumb={m.gbModId ? thumbs.get(m.gbModId) ?? null : null}
                on={chosen.has(m.index)} disabled={busy || !usable(m)} onChange={(v) => flip(m.index, v)} />
            ))}
          </ul>
          {pack.mods.length > 1 && (
            <div className="pack-pick row">
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setChosen(new Set(pack.mods.filter(usable).map((m) => m.index)))}>Select all</Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setChosen(new Set())}>Select none</Button>
            </div>
          )}
          {existing > 0 && (
            <div className="pack-existing">
              <span className="field-l">{plural(existing, "mod")} you already have</span>
              <Segmented<OnExisting> label="Mods you already have" value={onExisting} onChange={setOnExisting} options={[
                { value: "skip", label: "Skip", title: "Keep your copy and leave the file's out" },
                { value: "replace", label: "Replace", title: "Use the file's copy, or download it again. Yours goes to Recently removed" },
                { value: "keep_both", label: "Keep both", title: "Add the file's copy next to yours" },
              ]} />
            </div>
          )}
          {canProfile && pack.profiles.length === 1 && (
            <Toggle checked={useProfile} onChange={setUseProfile} disabled={busy} label={`Use its profile "${pack.profiles[0]!.name}"`}
              hint="Makes a profile with these mods and switches to it. Your other profiles stay as they are." />
          )}
          {canProfile && pack.profiles.length > 1 && (
            <Toggle checked={useProfile} onChange={setUseProfile} disabled={busy} label={`Add its ${pack.profiles.length} profiles`}
              hint={active ? `Switches to "${active.name}", the one in use when the file was made. Your own profiles stay as they are.` : "Your own profiles stay as they are."} />
          )}
          {busy && <Progress value={progress} label="Importing" />}
          {!busy && howNote && <p className="hint">{howNote}.</p>}
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
              {src && !broken ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} /> : <Icon name="package" />}
            </span>
            <span className="pack-mod-t">
              <span className="pack-mod-name">{m.name}</span>
              <span className="pack-mod-sub hint">{[m.character, m.size ? formatBytes(m.size) : ""].filter(Boolean).join(", ")}</span>
            </span>
          </span>
        } />
        <span className="pack-mod-tags">
          {m.how === "download" && <Badge tone="info" icon="downloads" title="Comes from GameBanana, then gets the sender's settings">Download</Badge>}
          {m.how === "missing" && <Badge tone="warn" title="The file only names this mod. It has no GameBanana link and its files aren't inside">No link</Badge>}
          {!m.enabled && <Badge tone="muted" title="Comes in turned off">Off</Badge>}
          {m.existing && <Badge tone="ok" title="The same mod is already in your library">In library</Badge>}
        </span>
      </li>
    </>
  );
}
