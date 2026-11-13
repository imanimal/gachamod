// App-wide MODTOOLS layers: the .gachamod import window (app event open-pack), the export window (app events
// export-mods, export-profile), and the "tools" nav badge. Owner: MODTOOLS area.
import { useEffect, useRef, useState } from "react";
import { held, inTauri } from "../../lib/tauri";
import { emitApp, onApp, useGameId, useGames } from "../../lib/store";
import {
  dialogs, errorText, fileUrl, library, modtools, packs, profiles, shell, type GameId, type PackPreview, type PackPreviewMod,
} from "../../lib/api";
import { Badge, Button, Checkbox, Dialog, Progress, Segmented, Skeleton, TextField, Toggle, formatBytes, plural, timeAgo } from "../../ui/kit";
import { Icon } from "../../ui/Icon";
import { toast } from "../../ui/toast";
import { fileName, problemCount, setToolsCount } from "./toolsBadge";
import "./modtools.css";

type ExportJob = { game: GameId; modIds: string[]; profileId: number | null };

export function ModtoolsOverlays() {
  const [importPath, setImportPath] = useState<string | null>(null);
  const [exportJob, setExportJob] = useState<ExportJob | null>(null);
  const game = useGameId();

  useEffect(() => onApp((e) => {
    if (e.type === "open-pack") setImportPath(e.path);
    else if (e.type === "export-mods") setExportJob({ game: e.game, modIds: e.modIds, profileId: null });
    else if (e.type === "export-profile") setExportJob({ game: e.game, modIds: [], profileId: e.profileId });
  }), []);

  // the tools badge: conflicts plus problems, once per game and after library changes
  useEffect(() => {
    if (!game) return;
    let live = true;
    let timer = 0;
    const count = () => {
      modtools.conflicts(game).then((g) => { if (live) setToolsCount(game, "conflicts", g.length); }).catch(() => {});
      modtools.lint(game).then((l) => { if (live) setToolsCount(game, "problems", problemCount(l)); }).catch(() => {});
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
      {exportJob && <PackExport key={`${exportJob.game}-${exportJob.profileId}-${exportJob.modIds.join(",")}`} job={exportJob} onClose={() => setExportJob(null)} />}
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

function PackExport({ job, onClose }: { job: ExportJob; onClose: () => void }) {
  const games = useGames();
  const g = games.find((x) => x.id === job.game);
  const live = useMounted();
  const [title, setTitle] = useState("");
  const [count, setCount] = useState<number | null>(job.profileId === null ? job.modIds.length : null);
  const [vars, setVars] = useState(true);
  const [busy, setBusy] = useState(false);
  const progress = usePackProgress(busy);

  // a default title: the profile's name, the one mod's name, or "<game> mods"
  useEffect(() => {
    const fallback = `${g?.short ?? "Game"} mods`;
    setTitle(fallback);
    if (job.profileId !== null) {
      profiles.list(job.game).then((list) => {
        const p = list.find((x) => x.id === job.profileId);
        if (!live.current || !p) return;
        setTitle(p.name);
        setCount(p.modCount);
      }).catch(() => {});
    } else if (job.modIds.length === 1) {
      library.get(job.game, job.modIds[0]!).then((m) => { if (live.current) setTitle(m.name); }).catch(() => {});
    }
  }, [job, g?.short, live]);

  const save = async () => {
    const name = `${fileName(title)}.gachamod`;
    let dest: string | null;
    try { dest = await dialogs.saveFile({ title: "Save mods as", defaultPath: name, extensions: ["gachamod"] }); }
    catch (e) { toast(errorText(e), true); return; }
    if (!dest && !inTauri()) dest = `C:\\Users\\Player\\Documents\\${name}`;
    if (!dest || !live.current) return;
    setBusy(true);
    try {
      const r = await packs.export({ game: job.game, modIds: job.modIds, profileId: job.profileId, includeVars: vars, title: title.trim() || null, dest });
      const file = r.path.split(/[\\/]/).pop() ?? r.path;
      toast(`Saved ${plural(r.mods, "mod")} to ${file} (${formatBytes(r.size)})`, false, {
        label: "Show in folder", run: () => { shell.revealPath(r.path).catch((e) => toast(errorText(e), true)); },
      });
      if (live.current) onClose();
    } catch (e) {
      toast(errorText(e), true);
      if (live.current) setBusy(false);
    }
  };

  return (
    <Dialog title={job.profileId !== null ? "Export profile" : "Export mods"} icon="export" onClose={onClose} className="pack-dialog pack-export"
      locked={busy ? "Saving the file" : undefined}
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" icon="export" busy={busy} disabled={!title.trim()} onClick={() => void save()}>Save as...</Button>
      </>}>
      <div className="pack-body stack">
        <p className="pack-what">
          {count === null ? "The profile's mods" : plural(count, "mod")}
          {g ? ` for ${g.name}` : ""}, in one .gachamod file you can open in gachamod on another PC or send to a friend.
        </p>
        <TextField label="Title" value={title} onChange={setTitle} placeholder="Ellen skins" hint="Shown when the file is opened, and used as the file name." disabled={busy} />
        <Toggle checked={vars} onChange={setVars} disabled={busy} label="Include picked options"
          hint="The jacket, colour and other choices you made with each mod's keys." />
        {busy && <Progress value={progress} label="Saving" />}
      </div>
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
  const [busy, setBusy] = useState(false);
  const progress = usePackProgress(busy);

  useEffect(() => {
    packs.inspect(path).then((p) => {
      if (!live.current) return;
      setPack(p);
      setChosen(new Set(p.mods.map((m) => m.index)));
      setUseProfile(p.kind === "profile" && !!p.profile);
    }).catch((e) => { toast(errorText(e), true); if (live.current) close.current(); });
  }, [path, live]);

  const game = games.find((g) => g.id === pack?.game);
  const existing = pack?.mods.filter((m) => m.existing && chosen.has(m.index)).length ?? 0;
  const picked = pack?.mods.filter((m) => chosen.has(m.index)) ?? [];
  const size = picked.reduce((s, m) => s + m.size, 0);

  const flip = (i: number, on: boolean) => setChosen((c) => { const n = new Set(c); if (on) n.add(i); else n.delete(i); return n; });

  const run = async () => {
    if (!pack) return;
    setBusy(true);
    try {
      const all = chosen.size === pack.mods.length;
      const r = await packs.import(path, { only: all ? [] : [...chosen].sort((a, b) => a - b), onExisting, applyProfile: useProfile && !!pack.profile });
      emitApp({ type: "library-refresh", game: pack.game });
      const parts = [
        r.added.length ? `Added ${plural(r.added.length, "mod")}` : "",
        r.replaced.length ? `replaced ${r.replaced.length}` : "",
        r.skipped ? `skipped ${r.skipped} you already have` : "",
        r.profileId !== null ? `switched to ${pack.profile?.name ?? "its profile"}` : "",
      ].filter(Boolean);
      const text = parts.length ? `${parts.join(", ").replace(/^./, (c) => c.toUpperCase())}.` : "Nothing was imported.";
      const added = r.added;
      const target = pack.game;
      if (added.length && !r.replaced.length && r.profileId === null) {
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
      if (live.current) onClose();
    } catch (e) {
      toast(errorText(e), true);
      if (live.current) setBusy(false);
    }
  };

  return (
    <Dialog title={pack ? pack.title || "Import mods" : "Opening the file"} icon="import" size="lg" onClose={onClose} className="pack-dialog pack-import"
      locked={busy ? "Importing" : undefined}
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" icon="import" busy={busy} disabled={!pack || chosen.size === 0} onClick={() => void run()}>
          {chosen.size ? `Import ${plural(chosen.size, "mod")}` : "Import"}
        </Button>
      </>}>
      {!pack ? (
        <div className="pack-body stack" aria-busy="true"><Skeleton h="1.2rem" w="50%" /><Skeleton h="3.5rem" /><Skeleton h="3.5rem" /></div>
      ) : (
        <div className="pack-body stack">
          <p className="pack-what">
            {plural(pack.mods.length, "mod")} for {game?.name ?? pack.game}, {formatBytes(pack.totalSize)}
            {pack.createdAt ? `, made ${timeAgo(pack.createdAt)}` : ""}.
          </p>
          <ul className="pack-mods" aria-label="Mods in the file">
            {pack.mods.map((m) => (
              <PackRow key={m.index} m={m} on={chosen.has(m.index)} disabled={busy} onChange={(v) => flip(m.index, v)} />
            ))}
          </ul>
          {pack.mods.length > 1 && (
            <div className="pack-pick row">
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setChosen(new Set(pack.mods.map((m) => m.index)))}>Select all</Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setChosen(new Set())}>Select none</Button>
            </div>
          )}
          {existing > 0 && (
            <div className="pack-existing">
              <span className="field-l">{plural(existing, "mod")} you already have</span>
              <Segmented<OnExisting> label="Mods you already have" value={onExisting} onChange={setOnExisting} options={[
                { value: "skip", label: "Skip", title: "Keep your copy and leave the pack's out" },
                { value: "replace", label: "Replace", title: "Use the pack's copy. Yours goes to Recently removed" },
                { value: "keep_both", label: "Keep both", title: "Add the pack's copy next to yours" },
              ]} />
            </div>
          )}
          {pack.profile && (
            <Toggle checked={useProfile} onChange={setUseProfile} disabled={busy} label={`Use its profile "${pack.profile.name}"`}
              hint="Makes a profile with these mods and switches to it." />
          )}
          {busy && <Progress value={progress} label="Importing" />}
          {!busy && <p className="hint">{plural(chosen.size, "mod")} picked, {formatBytes(size)}.</p>}
        </div>
      )}
    </Dialog>
  );
}

function PackRow({ m, on, disabled, onChange }: { m: PackPreviewMod; on: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  const [broken, setBroken] = useState(false);
  const src = fileUrl(m.preview);
  return (
    <li className={`pack-mod${on ? " on" : ""}`}>
      <Checkbox checked={on} disabled={disabled} onChange={onChange} label={
        <span className="pack-mod-main">
          <span className="pack-mod-img" aria-hidden="true">
            {src && !broken ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} /> : <Icon name="package" />}
          </span>
          <span className="pack-mod-t">
            <span className="pack-mod-name">{m.name}</span>
            <span className="pack-mod-sub hint">{[m.character, formatBytes(m.size)].filter(Boolean).join(", ")}</span>
          </span>
        </span>
      } />
      <span className="pack-mod-tags">
        {!m.enabled && <Badge tone="muted" title="Comes in turned off">Off</Badge>}
        {m.existing && <Badge tone="info" title="The same mod is already in your library">In library</Badge>}
      </span>
    </li>
  );
}
