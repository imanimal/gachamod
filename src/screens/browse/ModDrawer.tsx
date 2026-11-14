// A GameBanana mod's page in a wide drawer: gallery, creator and stats, files with Install buttons, the keys the
// description lists, the description as the author formatted it, update posts and comments. It opens over any screen
// from the route (a numeric route.modId, see OnlineOverlays). Owner: BROWSE area (docs/spec.md, "Downloads and Browse").
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { errorText, type GameState, type ModEntry, type QueueItem, type QueueSnapshot } from "../../lib/api";
import { gbLinkTarget, imageAt, isAbort, modPage, modUpdates, newestFile, queueModFile, sanitizeHtml, type GbFile, type GbImage, type GbMod, type GbUpdate } from "../../lib/gamebanana";
import { detectKeybinds } from "../../lib/keybinds";
import { likeMod, useAccount, useLiked } from "../../lib/account";
import { useNsfw } from "../../lib/prefs";
import { go, useGames } from "../../lib/store";
import { DescKeys } from "../../ui/DescKeys";
import { Badge, Button, Drawer, Empty, IconButton, Menu, Progress, Skeleton, formatBytes, formatCount, plural, timeAgo } from "../../ui/kit";
import { Icon } from "../../ui/Icon";
import { CategoryLink, CharLink, CreatorLink } from "../../ui/Links";
import { menuFor, openMenu } from "../../ui/ContextMenu";
import { Popover } from "../../ui/Popover";
import { toast } from "../../ui/toast";
import { openCreator, openExternal, takeWantFiles } from "./actions";
import { Comments } from "./Comments";
import { AdultSwitch } from "./GbBrowser";
import { Lightbox } from "./Lightbox";
import { openGbMod, useLibIndex } from "./state";
import { useQueue } from "./useQueue";

const activeStates = new Set(["waiting", "downloading", "installing", "needsChoice"]);

export function queueLabel(i: QueueItem): string {
  if (i.state === "downloading") return i.total ? `Downloading ${Math.floor((i.received / i.total) * 100)}%` : "Downloading";
  if (i.state === "installing") return "Installing";
  if (i.state === "needsChoice") return "Pick variants";
  return i.archive ? "Waiting to install" : "Waiting";
}

/** Clicks and keys inside sanitized GameBanana HTML: links (GameBanana mods and members open in the app, others in
 *  the browser), spoilers (click to show) and pictures (`onImage`). */
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
      else if (inApp && "member" in inApp) openCreator(inApp.member);
      else openExternal(url);
      return;
    }
    if (!key && onImage && t instanceof HTMLImageElement && t.classList.contains("gb-dimg")) { e.preventDefault(); onImage(t); }
  };
}

export function ModDrawer({ game: here, modId, onClose }: { game: GameState; modId: number; onClose: () => void }) {
  const games = useGames();
  const nsfw = useNsfw();
  const snap = useQueue();
  const [mod, setMod] = useState<GbMod | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [reveal, setReveal] = useState(false);
  const [shown, setShown] = useState(0);
  const [lightbox, setLightbox] = useState<{ images: GbImage[]; start: number } | null>(null);
  const [older, setOlder] = useState(false);
  const [posts, setPosts] = useState<GbUpdate[] | null>(null);
  const [postsOpen, setPostsOpen] = useState(false);
  const [menu, setMenu] = useState<{ el: HTMLElement; file: GbFile; replaces: string } | null>(null);
  const filesRef = useRef<HTMLElement>(null);
  const descRef = useRef<HTMLDivElement>(null);
  const commentsRef = useRef<HTMLDivElement>(null);
  const [wantFiles] = useState(takeWantFiles);

  useEffect(() => {
    const c = new AbortController();
    setMod(null); setError(null); setPosts(null); setShown(0); setReveal(false); setPostsOpen(false);
    modPage(modId, c.signal)
      .then((m) => { if (!c.signal.aborted) { if (m) setMod(m); else setError("GameBanana didn't send this mod's page."); } })
      .catch((e) => { if (!c.signal.aborted && !isAbort(e)) setError(errorText(e)); });
    return () => c.abort();
  }, [modId, attempt]);

  useEffect(() => {
    if (mod && wantFiles) window.setTimeout(() => filesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }, [mod, wantFiles]);

  useEffect(() => {
    if (!postsOpen || posts || !mod) return;
    let live = true;
    modUpdates(mod.id).then((u) => { if (live) setPosts(u); }).catch(() => { if (live) setPosts([]); });
    return () => { live = false; };
  }, [postsOpen, posts, mod]);

  // the game it installs into: the mod's own game when that is set up here
  const target = mod?.game ? games.find((g) => g.gamebananaId === mod.game!.id) ?? null : here;
  const lib = useLibIndex(target?.id ?? here.id);
  const installed = lib.byMod.get(modId) ?? [];
  const archived = installed.length ? undefined : lib.archived.get(modId);

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

  const title = mod?.name ?? (error ? "Couldn't open this mod" : "Loading");
  const url = mod?.url ?? `https://gamebanana.com/mods/${modId}`;
  const blurred = !!mod?.nsfw && !reveal && nsfw !== "show";
  return (
    <Drawer title={title} onClose={onClose} width="min(60rem, 94vw)" className="gb-drawer"
      actions={<>
        {mod?.nsfw && <span className="gb-drawer-adult"><AdultSwitch value={nsfw} /></span>}
        {mod && <IconButton icon="more" label="More (right-click works too)" onClick={(e) => openMenu(e.currentTarget, menuFor("gbmod", { game: target?.id ?? here.id, card: mod }))} />}
        {mod && <LikeButton id={mod.id} name={mod.name} />}
        <IconButton icon="external" label="Open on GameBanana" onClick={() => openExternal(url)} />
      </>}>
      {error && <Empty icon="warn" title="Couldn't load this mod" actions={<Button icon="refresh" onClick={() => setAttempt((a) => a + 1)}>Try again</Button>}>{error}</Empty>}
      {!mod && !error && (
        <div className="gb-drawer-skel">
          <Skeleton className="gb-gallery-main" h="22rem" />
          <Skeleton w="60%" h="1.4rem" />
          <Skeleton w="90%" h="5rem" />
        </div>
      )}
      {mod && (
        <div className="gb-mod">
          <Gallery mod={mod} blurred={blurred} shown={shown} setShown={setShown}
            onOpen={(i) => setLightbox({ images: mod.images, start: i })} onReveal={() => setReveal(true)} />

          <div className="gb-mod-head">
            {mod.submitter && (
              <CreatorLink id={mod.submitter.id} name={mod.submitter.name} avatar={mod.submitter.avatar} modId={mod.id} className="gb-submitter" />
            )}
            <div className="gb-stats">
              <span className="gb-stat" title={`${mod.likes} likes`}><Icon name="heart" />{formatCount(mod.likes)}</span>
              <span className="gb-stat" title={`${mod.views} views`}><Icon name="eye" />{formatCount(mod.views)}</span>
              {mod.downloads !== null && <span className="gb-stat" title={`${mod.downloads} downloads`}><Icon name="downloads" />{formatCount(mod.downloads)}</span>}
              {(mod.comments ?? 0) > 0 && (
                <button type="button" className="gb-stat gb-stat-btn" title="Go to the comments" onClick={() => commentsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                  <Icon name="feed" />{plural(mod.comments ?? 0, "comment")}
                </button>
              )}
              <span className="gb-stat" title={`Added ${new Date(mod.added * 1000).toLocaleString()}, updated ${new Date(mod.updated * 1000).toLocaleString()}`}><Icon name="clock" />{timeAgo(mod.updated)}</span>
            </div>
          </div>
          <div className="gb-mod-tags">
            {mod.character && target && <CharLink game={target.id} name={mod.character} className="badge t-accent gb-tag-char" portrait />}
            {mod.character && !target && <Badge tone="accent" icon="characters">{mod.character}</Badge>}
            {mod.category && mod.category.name !== mod.character && (target
              ? <CategoryLink game={target.id} category={mod.category} className="badge" />
              : <Badge>{mod.category.name}</Badge>)}
            {mod.version && <Badge title="Version">{mod.version}</Badge>}
            {mod.nsfw && (nsfw === "show"
              ? <span className="gb-nsfw-mark is-inline" title={mod.ratings.join(", ") || "Marked for adults"}>18+</span>
              : <Badge tone="bad" title={mod.ratings.join(", ") || "Marked for adults"}>18+</Badge>)}
            {installed.length > 0 && (target?.id === here.id
              ? <Badge tone="ok" icon="check" title="In your mods. Click to see it there" onClick={() => go({ view: "library", modId: installed[0]!.id })}>Installed</Badge>
              : <Badge tone="ok" icon="check">Installed</Badge>)}
            {archived && (target?.id === here.id
              ? <Badge tone="info" icon="trash" title="You removed it before. Reinstalling brings back its settings. Click to see it in Mods, Trash" onClick={() => go({ view: "library", tab: "archive" })}>Removed</Badge>
              : <Badge tone="info" icon="trash" title="You removed it before. Reinstalling brings back its settings">Removed</Badge>)}
          </div>
          {mod.summary && <p className="gb-summary">{mod.summary}</p>}

          <section ref={filesRef} className="gb-files" aria-label="Files">
            <h3 className="sub-h">Files</h3>
            {!target && mod.game && <p className="hint">This is a mod for {mod.game.name}, which isn't set up in gachamod.</p>}
            <FileList mod={mod} game={target} installed={installed} archived={!!archived} snap={snap} older={older} setOlder={setOlder}
              onInstall={install} onMenu={(el, file, replaces) => setMenu({ el, file, replaces })} />
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
              {postsOpen && (posts === null ? <Skeleton w="100%" h="4rem" /> : posts.length === 0 ? <p className="muted">No update posts.</p> : (
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

          <div ref={commentsRef}><Comments key={mod.id} modId={mod.id} url={url} onLink={onPlain} /></div>
        </div>
      )}
      {lightbox && <Lightbox images={lightbox.images} start={lightbox.start} onClose={closeLightbox} />}
      {menu && (
        <Popover anchor={menu.el} onClose={() => setMenu(null)} label="File actions" width="14em">
          <Menu items={[{ label: "Reinstall", icon: "refresh", hint: "Download this file again and replace the installed copy", onClick: () => { const m = menu; setMenu(null); void install(m.file, m.replaces); } }]} />
        </Popover>
      )}
    </Drawer>
  );
}

function Gallery({ mod, blurred, shown, setShown, onOpen, onReveal }: {
  mod: GbMod; blurred: boolean; shown: number; setShown: (i: number) => void; onOpen: (i: number) => void; onReveal: () => void;
}) {
  const [broken, setBroken] = useState<Set<number>>(new Set());
  const img = mod.images[shown];
  if (!img) return <div className="gb-gallery gb-gallery-empty"><Icon name="image" /><span>No pictures</span></div>;
  return (
    <div className={`gb-gallery${blurred ? " is-nsfw" : ""}`}>
      <button type="button" className="gb-gallery-main" title={blurred ? "Show the pictures" : "Open full size"} onClick={() => (blurred ? onReveal() : onOpen(shown))}>
        {broken.has(shown)
          ? <span className="gb-img-broken"><Icon name="image" /></span>
          : <img src={imageAt(img, 800)} alt={img.caption ?? mod.name} loading="lazy" decoding="async"
              onError={() => setBroken((b) => new Set(b).add(shown))} />}
        {blurred && <span className="gb-nsfw-cover"><span className="gb-nsfw-badge is-inline">18+</span><span className="gb-nsfw-show on-img">Show pictures</span></span>}
      </button>
      {mod.images.length > 1 && (
        <div className="gb-gallery-thumbs" role="listbox" aria-label="Pictures">
          {mod.images.map((m, i) => (
            <button key={`${m.full}-${i}`} type="button" role="option" aria-selected={i === shown} className={`gb-thumb${i === shown ? " on" : ""}`}
              title={m.caption ?? `Picture ${i + 1}`} onClick={() => setShown(i)}>
              <img src={imageAt(m, 100)} alt="" loading="lazy" decoding="async" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FileList({ mod, game, installed, archived, snap, older, setOlder, onInstall, onMenu }: {
  mod: GbMod; game: GameState | null; installed: ModEntry[]; archived: boolean; snap: QueueSnapshot; older: boolean; setOlder: (v: boolean) => void;
  onInstall: (f: GbFile, replaces?: string) => void; onMenu: (el: HTMLElement, f: GbFile, replaces: string) => void;
}) {
  const newest = newestFile(mod);
  const current = mod.files.filter((f) => !f.archived);
  const old = mod.files.filter((f) => f.archived);
  if (!mod.files.length) return <p className="muted">This mod has no files to download.</p>;
  const row = (f: GbFile) => {
    const q = game ? snap.items.find((i) => i.req.game === game.id && i.req.fileId === f.id && activeStates.has(i.state)) : undefined;
    const same = installed.find((m) => m.source?.fileId === f.id);
    const base = installed[0];
    const baseTime = base?.source?.remoteUpdated ?? base?.installedAt ?? 0;
    let action;
    if (!game) {
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
          <Badge tone="ok" icon="check">Installed</Badge>
          <IconButton icon="more" label="More" onClick={(e) => onMenu(e.currentTarget, f, same.id)} />
        </div>
      );
    } else if (base) {
      const isNewer = f.added > baseTime;
      action = <Button variant={f === newest && isNewer ? "primary" : "secondary"} icon={isNewer ? "update" : "swap"}
        title={isNewer ? `Replace ${base.name} with this file. Its options, tags and on/off state stay.` : `Install this older file in place of ${base.name}`}
        onClick={() => onInstall(f, base.id)}>{isNewer ? "Update" : "Use this file"}</Button>;
    } else if (archived) {
      action = <Button variant={f === newest ? "primary" : "secondary"} icon="install" title="Download it again. Your settings, tags and profile places for it come back"
        onClick={() => onInstall(f)}>Reinstall</Button>;
    } else {
      action = <Button variant={f === newest ? "primary" : "secondary"} icon="install" onClick={() => onInstall(f)} title="Download this file and add it to Mods">Install</Button>;
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

/** Like on GameBanana, shown while signed in (Settings > Account). */
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
