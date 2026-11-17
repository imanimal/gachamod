// A GameBanana mod's page in a wide drawer: gallery, creator and stats, files with Install buttons, the keys the
// description lists, the description as the author formatted it, update posts and comments. It opens over any screen
// from the route (a numeric route.modId, see OnlineOverlays). A GameBanana tool (a fixer, route.toolId) opens in the
// same drawer with Download in place of Install: the file goes to the fixers folder and is never run.
// Owner: BROWSE area (docs/spec.md, "Downloads and Browse").
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { errorText, type GameState, type ModEntry, type QueueItem, type QueueSnapshot } from "../../lib/api";
import { downloadFixer, useFixerBusy, useFixerFiles } from "../../lib/fixes";
import { gbLinkTarget, imageAt, isAbort, isNotFound, modPage, modUpdates, newestFile, queueModFile, sanitizeHtml, toolPage, type GbFile, type GbImage, type GbMod, type GbUpdate } from "../../lib/gamebanana";
import { detectKeybinds } from "../../lib/keybinds";
import { likeMod, useAccount, useLiked } from "../../lib/account";
import { useNsfw } from "../../lib/prefs";
import { go, goIn, useGames } from "../../lib/store";
import { DescKeys } from "../../ui/DescKeys";
import { Badge, Button, Drawer, Empty, IconButton, Menu, Progress, Toggle, Waiting, formatBytes, plural, timeAgo } from "../../ui/kit";
import { Icon } from "../../ui/Icon";
import { CategoryLink, CharLink, CreatorLink } from "../../ui/Links";
import { openMenu } from "../../ui/ContextMenu";
import { Popover } from "../../ui/Popover";
import { toast } from "../../ui/toast";
import { openCreator, openExternal, takeWantFiles } from "./actions";
import { Comments } from "./Comments";
import { gbModItems } from "./menus";
import { AdultSwitch } from "./GbBrowser";
import { Lightbox } from "./Lightbox";
import { ModStats } from "./ModStats";
import { openGbMod, openGbTool, useLibIndex } from "./state";
import { useQueue } from "./useQueue";
import { openVariantPicker, useQueueItem } from "./cardQueue";
import { setOn, trashMods } from "../library/actions";
import { reveal, rowKeys, useSideScroll } from "./sideScroll";
import { ShowAll, useRowOpen } from "../../ui/ShowAll";
import { LazyImg } from "../../ui/LazyImg";
import { hintClass, useHint } from "../../shell/hints";

const activeStates = new Set(["waiting", "downloading", "installing", "needsChoice"]);

export function queueLabel(i: QueueItem): string {
  if (i.state === "downloading" && !i.received) return "Connecting";
  if (i.state === "downloading") return i.total ? `Downloading ${Math.floor((i.received / i.total) * 100)}%` : "Downloading";
  if (i.state === "installing") { const p = i.progress; return p && p.mods.length > 1 ? `Installing ${p.placed} of ${p.mods.length}` : "Installing"; }
  if (i.state === "needsChoice") return "Pick variants";
  return i.archive ? "Waiting to install" : "Waiting";
}

/** Clicks and keys inside sanitized GameBanana HTML: links (GameBanana mods, tools and members open in the app,
 *  others in the browser), spoilers (click to show) and pictures (`onImage`). */
export function descHandler(onImage?: (img: HTMLImageElement) => void) {
  return (e: MouseEvent | KeyboardEvent) => {
    const key = "key" in e;
    if (key && e.key !== "Enter" && e.key !== " ") return;
    const t = e.target as HTMLElement;
    const spoiler = t.closest<HTMLElement>(".gb-spoiler");
    if (spoiler && !spoiler.classList.contains("open")) { e.preventDefault(); spoiler.classList.add("open"); spoiler.removeAttribute("title"); return; }
    const a = t.closest<HTMLElement>("[data-href]");
    if (a) {
      e.preventDefault();
      const url = a.getAttribute("data-href");
      if (!url) return;
      const inApp = gbLinkTarget(url);
      if (inApp && "mod" in inApp) openGbMod(inApp.mod);
      else if (inApp && "tool" in inApp) openGbTool(inApp.tool);
      else if (inApp && "member" in inApp) openCreator(inApp.member);
      else openExternal(url);
      return;
    }
    if (!key && onImage && t instanceof HTMLImageElement && t.classList.contains("gb-dimg")) { e.preventDefault(); onImage(t); }
  };
}

/** `tool`: modId is a GameBanana tool's id (a fixer), downloaded rather than installed. */
export function ModDrawer({ game: here, modId, tool = false, onClose }: { game: GameState; modId: number; tool?: boolean; onClose: () => void }) {
  const games = useGames();
  const nsfw = useNsfw();
  const snap = useQueue();
  const [mod, setMod] = useState<GbMod | null>(null);
  const [error, setError] = useState<string | null>(null);
  // GameBanana answered 404: the page was taken down
  const [gone, setGone] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [reveal, setReveal] = useState(false);
  const [shown, setShown] = useState(0);
  const [lightbox, setLightbox] = useState<{ images: GbImage[]; start: number } | null>(null);
  const [older, setOlder] = useState(false);
  // null until loaded, "error" when the posts couldn't be read
  const [posts, setPosts] = useState<GbUpdate[] | "error" | null>(null);
  const [footBusy, setFootBusy] = useState(false);
  const [postsOpen, setPostsOpen] = useState(false);
  const [menu, setMenu] = useState<{ el: HTMLElement; file: GbFile; base: ModEntry; same?: ModEntry } | null>(null);
  const filesRef = useRef<HTMLElement>(null);
  const descRef = useRef<HTMLDivElement>(null);
  const commentsRef = useRef<HTMLDivElement>(null);
  const [wantFiles] = useState(takeWantFiles);

  useEffect(() => {
    const c = new AbortController();
    setMod(null); setError(null); setGone(false); setPosts(null); setShown(0); setReveal(false); setPostsOpen(false);
    (tool ? toolPage : modPage)(modId, c.signal)
      .then((m) => { if (!c.signal.aborted) { if (m) setMod(m); else setError(`GameBanana didn't send this ${tool ? "tool" : "mod"}'s page.`); } })
      .catch((e) => {
        if (c.signal.aborted || isAbort(e)) return;
        setGone(isNotFound(e));
        setError(errorText(e));
      });
    return () => c.abort();
  }, [modId, attempt, tool]);

  useEffect(() => {
    if (mod && wantFiles) window.setTimeout(() => filesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }, [mod, wantFiles]);

  useEffect(() => {
    if (!postsOpen || posts !== null || !mod) return;
    let live = true;
    modUpdates(mod.id, mod.tool ? "Tool" : "Mod").then((u) => { if (live) setPosts(u); }).catch((e) => {
      console.warn("GameBanana updates:", e);
      if (live) setPosts("error");
    });
    return () => { live = false; };
  }, [postsOpen, posts, mod]);

  // the game it installs into: the mod's own game when that is set up here
  const target = mod?.game ? games.find((g) => g.gamebananaId === mod.game!.id) ?? null : here;
  const lib = useLibIndex(target?.id ?? here.id);
  // tool ids are their own numbers: a mod with the same id is a different thing
  const installed = tool ? [] : lib.byMod.get(modId) ?? [];
  const archived = installed.length || tool ? undefined : lib.archived.get(modId);
  const showInMods = (m: ModEntry | undefined = installed[0]) => { if (m && target) goIn(target.id, { view: "library", modId: m.id }); };
  const elsewhere = target && target.id !== here.id ? ` (switches to ${target.short})` : "";

  // the newest file's action stays in the footer, picked the same way as a Browse card's quick button
  const queued = useQueueItem(target?.id ?? here.id, tool ? -1 : modId);
  const newest = mod && !tool && target ? newestFile(mod) : null;
  const upd = installed.find((m) => m.updateAvailable);
  const foot = !newest ? null
    : queued?.state === "needsChoice" ? { icon: "layers" as const, label: "Pick parts", tip: "This download has several parts. Pick the ones to install", run: () => openVariantPicker(queued.id) }
    : queued ? { icon: "downloads" as const, label: "Show in Downloads", tip: queueLabel(queued), run: () => go("downloads") }
    : upd ? { icon: "update" as const, label: "Update", tip: `Replace ${upd.name} with ${newest.name}. Its options, tags and on/off state stay`, run: () => install(newest, upd.id) }
    : installed.length ? { icon: "mods" as const, label: "Show in Mods", tip: `Open it in Mods${elsewhere}`, run: () => showInMods() }
    : archived ? { icon: "install" as const, label: "Reinstall", tip: `Download ${newest.name} again. Your settings for it come back`, run: () => install(newest) }
    : { icon: "install" as const, label: "Install", tip: `Download ${newest.name} and add it to Mods`, run: () => install(newest) };
  const runFoot = async () => {
    if (!foot || footBusy) return;
    setFootBusy(true);
    try { await foot.run(); } finally { setFootBusy(false); }
  };

  const closeLightbox = useCallback(() => setLightbox(null), []);
  const found = useMemo(() => detectKeybinds(mod ? sanitizeHtml(mod.descriptionHtml) : ""), [mod]);
  const onDesc = useMemo(() => descHandler((img) => {
    const all = [...(descRef.current?.querySelectorAll<HTMLImageElement>("img.gb-dimg") ?? [])];
    setLightbox({ images: all.map((i) => ({ full: i.src, caption: i.alt || undefined })), start: Math.max(0, all.indexOf(img)) });
  }), []);
  const onPlain = useMemo(() => descHandler(), []);

  const install = async (file: GbFile, replaces?: string) => {
    if (!mod || !target) return;
    try {
      await queueModFile(target.id, mod, file, replaces);
      const verb = replaces ? "Updating" : archived ? "Reinstalling" : "Downloading";
      toast(`${verb} ${mod.name}${target.id !== here.id ? ` for ${target.short}` : ""}`, false, { label: "Show", run: () => go("downloads") });
    } catch (e) { toast(errorText(e), true); }
  };

  const jumpKeys = () => {
    if (!found.anchor) return;
    document.getElementById(found.anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const what = tool ? "fixer" : "mod";
  const title = mod?.name ?? (gone ? `This ${what} was removed` : error ? `Couldn't open this ${what}` : `Opening this ${what}`);
  const url = mod?.url ?? `https://gamebanana.com/${tool ? "tools" : "mods"}/${modId}`;
  const blurred = !!mod?.nsfw && !reveal && nsfw !== "show";
  return (
    <Drawer title={title} onClose={onClose} width="min(60rem, 94vw)" className="gb-drawer"
      footer={foot && newest && <>
        <span className="hint" style={{ marginRight: "auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={newest.name}>Newest file: {newest.name}</span>
        <Button variant="primary" icon={foot.icon} busy={footBusy} title={foot.tip} onClick={() => void runFoot()}>{foot.label}</Button>
      </>}
      actions={<>
        {mod?.nsfw && <span className="gb-drawer-adult"><AdultSwitch value={nsfw} /></span>}
        {mod && !tool && <IconButton icon="more" label="More actions (right-click or Shift+F10)" onClick={(e) => openMenu(e.currentTarget, gbModItems(target?.id ?? here.id, mod, true))} />}
        {mod && !tool && <LikeButton id={mod.id} name={mod.name} />}
        <IconButton icon="external" label="Open on GameBanana" onClick={() => openExternal(url)} />
      </>}>
      {error && (gone
        ? <Empty icon="warn" title={`This ${what} was removed from GameBanana`} actions={<>
            {installed.length > 0 && <Button variant="primary" icon="mods" title={`Open your copy in Mods${elsewhere}`} onClick={() => showInMods()}>Show in Mods</Button>}
            <Button icon="refresh" onClick={() => setAttempt((a) => a + 1)}>Try again</Button>
          </>}>
            {installed.length > 0 ? "GameBanana no longer has its page. Your installed copy stays in Mods." : "GameBanana no longer has its page."}
          </Empty>
        : <Empty icon="warn" title={`Couldn't load this ${what}`} actions={<Button icon="refresh" onClick={() => setAttempt((a) => a + 1)}>Try again</Button>}>{error}</Empty>)}
      {!mod && !error && (
        <Waiting className="gb-drawer-skel" what={`Asking GameBanana for this ${what}`}
          hold={`GameBanana may be slow right now. You can open the ${what} on GameBanana instead`}>
          <Button size="sm" variant="ghost" icon="external" onClick={() => openExternal(url)}>Open on GameBanana</Button>
        </Waiting>
      )}
      {mod && (
        <div className="gb-mod">
          <Gallery mod={mod} blurred={blurred} shown={shown} setShown={setShown}
            onOpen={(i) => setLightbox({ images: mod.images, start: i })} onReveal={() => setReveal(true)} />

          <div className="gb-mod-head">
            {mod.submitter && (
              <CreatorLink id={mod.submitter.id} name={mod.submitter.name} avatar={mod.submitter.avatar} modId={mod.id} className="gb-submitter" />
            )}
            <ModStats key={mod.id} mod={mod} act={!tool}
              onFiles={() => filesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
              onComments={() => commentsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })} />
          </div>
          <div className="gb-mod-tags">
            {mod.character && target && <CharLink game={target.id} name={mod.character} className="badge t-accent gb-tag-char" portrait />}
            {mod.character && !target && <Badge tone="accent" icon="characters">{mod.character}</Badge>}
            {mod.category && mod.category.name !== mod.character && (target && !tool
              ? <CategoryLink game={target.id} category={mod.category} className="badge" />
              : <Badge>{mod.category.name}</Badge>)}
            {mod.version && <Badge title="Version">{mod.version}</Badge>}
            {mod.nsfw && (nsfw === "show"
              ? <span className="gb-nsfw-mark is-inline" title={mod.ratings.join(", ") || "Marked for adults"}>18+</span>
              : <Badge tone="bad" title={mod.ratings.join(", ") || "Marked for adults"}>18+</Badge>)}
            {installed.length > 0 && (target?.id === here.id
              ? <>
                <Badge tone="ok" icon="check" title="In your mods. Click to see it there" onClick={() => go({ view: "library", modId: installed[0]!.id })}>Installed</Badge>
                <span className="gb-mod-on" title={installed[0]!.enabled ? "Turn it off" : "Turn it on. Settings, Mods and downloads decides whether new mods start on"}>
                  <Toggle size="sm" checked={installed[0]!.enabled} onChange={(v) => void setOn(here.id, [installed[0]!], v)} label={installed[0]!.enabled ? "On" : "Off"} ariaLabel={mod.name} />
                </span>
              </>
              : <Badge tone="ok" icon="check" title={`In your mods. Click to see it there${elsewhere}`} onClick={() => showInMods()}>Installed</Badge>)}
            {archived && (target?.id === here.id
              ? <Badge tone="info" icon="trash" title="You removed it before. Reinstalling brings back its settings. Click to see it in Mods, Trash" onClick={() => go({ view: "library", tab: "archive" })}>Removed</Badge>
              : <Badge tone="info" icon="trash" title="You removed it before. Reinstalling brings back its settings">Removed</Badge>)}
          </div>
          {mod.summary && <p className="gb-summary">{mod.summary}</p>}

          <section ref={filesRef} className="gb-files" aria-label="Files">
            <h3 className="sub-h">Files</h3>
            {tool ? (
              <ToolFiles tool={mod} game={target ?? here} older={older} setOlder={setOlder} />
            ) : (
              <>
                {!target && mod.game && <p className="hint">This is a mod for {mod.game.name}, which isn't set up in gachamod.</p>}
                <FileList mod={mod} game={target} installed={installed} archived={!!archived} snap={snap} older={older} setOlder={setOlder}
                  onInstall={install} onShow={showInMods} showTitle={`Open it in Mods${elsewhere}`} onMenu={(el, file, base, same) => setMenu({ el, file, base, same })} />
              </>
            )}
          </section>

          <DescKeys found={found} onJump={found.anchor ? jumpKeys : undefined} />

          {found.html && (
            <div ref={descRef} className="gb-desc selectable" onClick={onDesc} onKeyDown={onDesc} dangerouslySetInnerHTML={{ __html: found.html }} />
          )}

          {mod.updatesCount > 0 && (
            <section className="gb-posts">
              <button type="button" className="gb-posts-t" aria-expanded={postsOpen} onClick={() => setPostsOpen((o) => !o)}>
                <Icon name={postsOpen ? "down" : "chevron"} /><span>Update posts</span><span className="muted">{mod.updatesCount}</span>
              </button>
              {postsOpen && (posts === null ? <Waiting what="Loading update posts" hold="GameBanana may be slow right now. The posts are on the mod's GameBanana page too" /> : posts === "error" ? (
                <div className="row">
                  <span className="muted">Couldn't load the update posts.</span>
                  <Button size="sm" icon="refresh" onClick={() => setPosts(null)}>Try again</Button>
                  <Button size="sm" variant="ghost" icon="external" onClick={() => openExternal(url)}>Open on GameBanana</Button>
                </div>
              ) : posts.length === 0 ? (
                <div className="row">
                  <span className="muted">GameBanana sent no update posts for this mod.</span>
                  <Button size="sm" variant="ghost" icon="external" onClick={() => openExternal(url)}>Open on GameBanana</Button>
                </div>
              ) : (
                <ol className="gb-posts-list">
                  {posts.map((p) => (
                    <li key={p.id} className="gb-post">
                      <div className="gb-post-h"><strong>{p.name}</strong>{p.version && <Badge>{p.version}</Badge>}<span className="muted">{timeAgo(p.added)}</span></div>
                      {p.changes.length > 0 && <ul className="gb-post-changes">{p.changes.map((c, n) => <li key={n}>{c.cat && <span className="gb-post-cat">{c.cat}</span>} {c.text}</li>)}</ul>}
                      {p.text && <div className="gb-desc selectable" onClick={onPlain} onKeyDown={onPlain} dangerouslySetInnerHTML={{ __html: sanitizeHtml(p.text) }} />}
                    </li>
                  ))}
                </ol>
              ))}
            </section>
          )}

          <div ref={commentsRef}><Comments key={mod.id} modId={mod.id} model={tool ? "Tool" : "Mod"} url={url} onLink={onPlain} /></div>
        </div>
      )}
      {lightbox && <Lightbox images={lightbox.images} start={lightbox.start} onClose={closeLightbox} />}
      {menu && (
        <Popover anchor={menu.el} onClose={() => setMenu(null)} label="File actions" width="14em">
          <Menu items={menu.same ? [
            { label: "Reinstall", icon: "refresh", hint: "Download this file again and replace the installed copy", onClick: () => { const m = menu; setMenu(null); void install(m.file, m.same!.id); } },
            { label: "Install alongside", icon: "plus", hint: "Add this file again as a second mod, keeping the installed one", onClick: () => { const m = menu; setMenu(null); void install(m.file); } },
            "-",
            { label: "Move to trash", icon: "trash", danger: true, hint: "Remove it from Mods. It stays in the trash, with Undo in the toast", onClick: () => { const m = menu; setMenu(null); if (target) void trashMods(target.id, [m.same!]); } },
          ] : [
            { label: "Install alongside", icon: "plus", hint: `Add this file as its own mod and keep ${menu.base.name}`, onClick: () => { const m = menu; setMenu(null); void install(m.file); } },
            { label: `Replace ${menu.base.name}`, icon: "swap", hint: "Install this file in its place. Its options, tags and on/off state stay", onClick: () => { const m = menu; setMenu(null); void install(m.file, m.base.id); } },
          ]} />
        </Popover>
      )}
    </Drawer>
  );
}

function Gallery({ mod, blurred, shown, setShown, onOpen, onReveal }: {
  mod: GbMod; blurred: boolean; shown: number; setShown: (i: number) => void; onOpen: (i: number) => void; onReveal: () => void;
}) {
  const [broken, setBroken] = useState<Set<number>>(new Set());
  // the thumbnails scroll sideways with the wheel and follow the picture shown
  const thumbs = useRef<HTMLDivElement>(null);
  const [all, toggleAll] = useRowOpen("drawer.pictures");
  const edges = useSideScroll(thumbs, [mod.id, mod.images.length, all]);
  useEffect(() => {
    const row = thumbs.current, on = row?.querySelector(".gb-thumb.on");
    if (row && on) reveal(row, on);
  }, [shown, mod.id]);
  const img = mod.images[shown];
  if (!img) return <div className="gb-gallery gb-gallery-empty"><Icon name="image" /><span>No pictures</span></div>;
  return (
    <div className={`gb-gallery${blurred ? " is-nsfw" : ""}`}>
      <button type="button" className="gb-gallery-main" title={blurred ? "Show the pictures" : "Open full size"} onClick={() => (blurred ? onReveal() : onOpen(shown))}>
        {broken.has(shown)
          ? <span className="gb-img-broken"><Icon name="image" /></span>
          : <LazyImg src={imageAt(img, 800)} alt={img.caption ?? mod.name} decoding="async"
              onError={() => setBroken((b) => new Set(b).add(shown))} />}
        {blurred && <span className="gb-nsfw-cover"><span className="gb-nsfw-badge is-inline">18+</span><span className="gb-nsfw-show on-img">Show pictures</span></span>}
      </button>
      {mod.images.length > 1 && (
        <div className={`gb-gallery-thumbs-wrap${all ? " is-all" : ""}`}>
        <div ref={thumbs} className={`gb-gallery-thumbs${all ? " is-all" : ""}`} role="listbox" aria-label="Pictures" onKeyDown={(e) => rowKeys(e, ".gb-thumb")}>
          {mod.images.map((m, i) => (
            <button key={`${m.full}-${i}`} type="button" role="option" aria-selected={i === shown} className={`gb-thumb${i === shown ? " on" : ""}`}
              title={m.caption ?? `Picture ${i + 1}`} onClick={() => setShown(i)}>
              <LazyImg src={imageAt(m, 100)} alt="" decoding="async" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
            </button>
          ))}
        </div>
        <ShowAll open={all} onToggle={toggleAll} fits={!edges.left && !edges.right} label={`Show all ${mod.images.length} pictures`} />
        </div>
      )}
    </div>
  );
}

function FileList({ mod, game, installed, archived, snap, older, setOlder, onInstall, onMenu, onShow, showTitle, actionFor }: {
  mod: GbMod; game: GameState | null; installed: ModEntry[]; archived: boolean; snap: QueueSnapshot; older: boolean; setOlder: (v: boolean) => void;
  onInstall: (f: GbFile, replaces?: string) => void;
  /** A file row's More: `same` is the installed copy of this very file, `base` the mod's installed copy. */
  onMenu: (el: HTMLElement, f: GbFile, base: ModEntry, same?: ModEntry) => void;
  /** Opens an installed copy in Mods. */
  onShow?: (m: ModEntry) => void; showTitle?: string;
  /** Each file's button, in place of Install (a tool's Download). */
  actionFor?: (f: GbFile, newest: boolean) => ReactNode;
}) {
  const newest = newestFile(mod);
  const installHint = useHint("install");
  const current = mod.files.filter((f) => !f.archived);
  const old = mod.files.filter((f) => f.archived);
  if (!mod.files.length) return <p className="muted">This {mod.tool ? "fixer" : "mod"} has no files to download.</p>;
  const row = (f: GbFile) => {
    const q = game ? snap.items.find((i) => i.req.game === game.id && i.req.fileId === f.id && activeStates.has(i.state)) : undefined;
    const same = installed.find((m) => m.source?.fileId === f.id);
    const base = installed[0];
    // the file the installed copy came from: a later file only counts as an update when it's clearly newer (a day
    // or more) or carries the same name with another version number. Alternates uploaded together aren't updates.
    const baseFile = mod.files.find((x) => x.id === base?.source?.fileId);
    const baseTime = baseFile?.added ?? base?.source?.remoteUpdated ?? base?.installedAt ?? 0;
    let action;
    if (actionFor) {
      action = actionFor(f, f === newest);
    } else if (!game) {
      action = null;
    } else if (q) {
      action = (
        <div className="gb-file-q">
          <span className="hint">{queueLabel(q)}</span>
          <Progress value={q.state === "downloading" && q.total ? q.received / q.total : null} label={queueLabel(q)} />
        </div>
      );
    } else if (same) {
      action = (
        <div className="row">
          <Badge tone="ok" icon="check" title={onShow ? (showTitle ?? "Open it in Mods") : undefined} onClick={onShow && (() => onShow(same))}>Installed</Badge>
          <IconButton icon="more" label="Reinstall, install alongside or move to trash" onClick={(e) => onMenu(e.currentTarget, f, same, same)} />
        </div>
      );
    } else if (base) {
      const isNewer = f.added > baseTime && (f.added - baseTime >= 86400 || (!!baseFile && fileStem(f.name) === fileStem(baseFile.name)));
      action = (
        <div className="row">
          <Button variant={f === newest && isNewer ? "primary" : "secondary"} icon={isNewer ? "update" : "swap"}
            title={isNewer ? `Replace ${base.name} with this file. Its options, tags and on/off state stay` : `Install this file in place of ${base.name}. Its options, tags and on/off state stay`}
            onClick={() => onInstall(f, base.id)}>{isNewer ? "Update" : "Use this file"}</Button>
          <IconButton icon="more" label="Install alongside, or replace the installed copy" onClick={(e) => onMenu(e.currentTarget, f, base)} />
        </div>
      );
    } else if (archived) {
      action = <Button variant={f === newest ? "primary" : "secondary"} icon="install" title="Download it again. Your settings, tags and profile places for it come back"
        onClick={() => onInstall(f)}>Reinstall</Button>;
    } else {
      action = <Button variant={f === newest ? "primary" : "secondary"} icon="install" onClick={() => onInstall(f)} title="Download this file and add it to Mods"
        className={hintClass(installHint && f === newest).trim() || undefined}>Install</Button>;
    }
    const scan = f.analysis === "clean" ? null : f.analysis;
    return (
      <li key={f.id} className={`gb-file${f.archived ? " is-archived" : ""}`}>
        <div className="gb-file-main">
          <div className="gb-file-name"><Icon name="file" /><span className="selectable">{f.name}</span></div>
          <div className="gb-file-meta hint">
            <span>{formatBytes(f.size)}</span>
            <span title={new Date(f.added * 1000).toLocaleString()}>{timeAgo(f.added)}</span>
            <span>{plural(f.downloads, "download")}</span>
            {scan && <Badge tone={scan === "pending" ? "info" : "warn"} title="GameBanana's file check">{scan === "pending" ? "Being checked" : `Check: ${scan}`}</Badge>}
            {f.warnings?.map((w) => <Badge key={w} tone="muted" title="GameBanana's file check noticed this">{w}</Badge>)}
          </div>
          {f.description && <p className="gb-file-desc">{f.description}</p>}
        </div>
        {action && <div className="gb-file-act">{action}</div>}
      </li>
    );
  };
  return (
    <>
      <ul className="gb-file-list">{current.map(row)}</ul>
      {old.length > 0 && (
        <>
          <button type="button" className="gb-older" aria-expanded={older} onClick={() => setOlder(!older)}>
            <Icon name={older ? "down" : "chevron"} /><span>Older files</span><span className="muted">{old.length}</span>
          </button>
          {older && <ul className="gb-file-list">{old.map(row)}</ul>}
        </>
      )}
    </>
  );
}

/** A file name without its version numbers and extension, to tell a new version of a file from an alternate one. */
const fileStem = (name: string) => name.toLowerCase().replace(/\.(zip|rar|7z)$/, "").replace(/v?\d+([._-]\d+)*/g, "").replace(/[\s._-]+/g, "");

const NO_QUEUE: QueueSnapshot = { items: [] } as unknown as QueueSnapshot;

/** A tool's files with Download, saved in gachamod's fixers folder. Fix on a broken mod runs the one it needs. */
function ToolFiles({ tool, game, older, setOlder }: { tool: GbMod; game: GameState; older: boolean; setOlder: (v: boolean) => void }) {
  const have = useFixerFiles(game.id);
  const busy = useFixerBusy();
  const action = (f: GbFile, newest: boolean) => {
    const got = have.find((x) => x.fileId === f.id);
    if (busy.has(`file:${f.id}`)) return <Button busy disabled>Downloading</Button>;
    if (got) {
      return (
        <div className="row">
          <span className="hint">Downloaded</span>
          <IconButton icon="refresh" label="Download it again" onClick={() => void downloadFixer(game.id, tool, f)} />
        </div>
      );
    }
    return (
      <Button variant={newest ? "primary" : "secondary"} icon="downloads" title="Save it in gachamod's fixers folder"
        onClick={() => void downloadFixer(game.id, tool, f)}>Download</Button>
    );
  };
  return (
    <>
      <p className="hint">You don't need to download it yourself. Fix on a broken mod gets the fixer it needs and runs it on that mod.</p>
      <FileList mod={tool} game={game} installed={[]} archived={false} snap={NO_QUEUE} older={older} setOlder={setOlder}
        onInstall={() => {}} onMenu={() => {}} actionFor={action} />
    </>
  );
}

/** Like on GameBanana, shown while signed in (Settings, Account, links and AI). */
function LikeButton({ id, name }: { id: number; name: string }) {
  const acc = useAccount();
  const liked = useLiked(id);
  const [busy, setBusy] = useState(false);
  if (!acc.available || !acc.user) return null;
  return (
    <IconButton icon="heart" on={liked} disabled={busy} label={liked ? "Take back your like on GameBanana" : "Like on GameBanana. Nobody is notified"}
      onClick={() => { setBusy(true); void likeMod(id, name, !liked).finally(() => setBusy(false)); }} />
  );
}
