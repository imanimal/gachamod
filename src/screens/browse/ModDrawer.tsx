// A GameBanana mod's page in a wide drawer: gallery, stats, description, update posts and files with Install buttons.
// Owner: ONLINE area (docs/spec.md, "Downloads and Browse").
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Avatar, Badge, Button, Drawer, Empty, IconButton, Menu, Progress, Skeleton, formatBytes, formatCount, plural, timeAgo } from "../../ui/kit";
import { Icon } from "../../ui/Icon";
import { Popover } from "../../ui/Popover";
import { toast } from "../../ui/toast";
import { errorText, shell, type GameState, type ModEntry, type QueueItem, type QueueSnapshot } from "../../lib/api";
import { imageAt, isAbort, modPage, modUpdates, newestFile, queueModFile, sanitizeHtml, type GbFile, type GbMod, type GbUpdate } from "../../lib/gamebanana";
import { go } from "../../lib/store";
import { Lightbox } from "./Lightbox";
import type { NsfwMode } from "./Browse";

const activeStates = new Set(["waiting", "downloading", "installing", "needsChoice"]);

export function queueLabel(i: QueueItem): string {
  if (i.state === "downloading") return i.total ? `Downloading ${Math.floor((i.received / i.total) * 100)}%` : "Downloading";
  if (i.state === "installing") return "Installing";
  if (i.state === "needsChoice") return "Pick variants";
  return i.archive ? "Waiting to install" : "Waiting";
}

function openLink(e: MouseEvent | KeyboardEvent) {
  const a = (e.target as HTMLElement).closest<HTMLElement>("[data-href]");
  if (!a) return;
  if ("key" in e && e.key !== "Enter" && e.key !== " ") return;
  e.preventDefault();
  const url = a.getAttribute("data-href");
  if (url) shell.openUrl(url).catch((err) => toast(errorText(err), true));
}

export function ModDrawer({ game, modId, lib, snap, nsfw, onClose }: {
  game: GameState; modId: number; lib: ModEntry[]; snap: QueueSnapshot; nsfw: NsfwMode; onClose: () => void;
}) {
  const [mod, setMod] = useState<GbMod | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [reveal, setReveal] = useState(nsfw === "show");
  const [shown, setShown] = useState(0);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [older, setOlder] = useState(false);
  const [posts, setPosts] = useState<GbUpdate[] | null>(null);
  const [postsOpen, setPostsOpen] = useState(false);
  const [menu, setMenu] = useState<{ el: HTMLElement; file: GbFile; replaces: string } | null>(null);

  useEffect(() => {
    const c = new AbortController();
    setMod(null); setError(null); setPosts(null); setShown(0);
    modPage(modId, c.signal)
      .then((m) => { if (!c.signal.aborted) { if (m) setMod(m); else setError("GameBanana didn't send this mod's page."); } })
      .catch((e) => { if (!c.signal.aborted && !isAbort(e)) setError(errorText(e)); });
    return () => c.abort();
  }, [modId, attempt]);

  useEffect(() => {
    if (!postsOpen || posts || !mod) return;
    let live = true;
    modUpdates(mod.id).then((u) => { if (live) setPosts(u); }).catch(() => { if (live) setPosts([]); });
    return () => { live = false; };
  }, [postsOpen, posts, mod]);

  const closeLightbox = useCallback(() => setLightbox(null), []);
  const description = useMemo(() => (mod ? sanitizeHtml(mod.descriptionHtml) : ""), [mod]);

  const installed = lib.filter((m) => m.source?.modId === modId);
  const install = async (file: GbFile, replaces?: string) => {
    if (!mod) return;
    try {
      await queueModFile(game.id, mod, file, replaces);
      toast(`${replaces ? "Updating" : "Downloading"} ${mod.name}`, false, { label: "Show", run: () => go("downloads") });
    } catch (e) { toast(errorText(e), true); }
  };

  const title = mod?.name ?? (error ? "Couldn't open this mod" : "Loading");
  const url = mod?.url ?? `https://gamebanana.com/mods/${modId}`;
  return (
    <Drawer title={title} onClose={onClose} width="min(60rem, 94vw)" className="gb-drawer"
      actions={<IconButton icon="external" label="Open on GameBanana" onClick={() => shell.openUrl(url).catch((e) => toast(errorText(e), true))} />}>
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
          <Gallery mod={mod} blurred={mod.nsfw && !reveal && nsfw !== "show"} shown={shown} setShown={setShown}
            onOpen={(i) => setLightbox(i)} onReveal={() => setReveal(true)} />

          <div className="gb-mod-head">
            {mod.submitter && (
              <button type="button" className="gb-submitter" title={`${mod.submitter.name} on GameBanana`}
                onClick={() => shell.openUrl(mod.submitter!.url).catch((e) => toast(errorText(e), true))}>
                <Avatar src={mod.submitter.avatar} name={mod.submitter.name} size={28} />
                <span>{mod.submitter.name}</span>
              </button>
            )}
            <div className="gb-stats">
              <span className="gb-stat" title="Likes"><Icon name="heart" />{formatCount(mod.likes)}</span>
              <span className="gb-stat" title="Views"><Icon name="eye" />{formatCount(mod.views)}</span>
              {mod.downloads !== null && <span className="gb-stat" title="Downloads"><Icon name="downloads" />{formatCount(mod.downloads)}</span>}
              <span className="gb-stat" title={`Added ${new Date(mod.added * 1000).toLocaleDateString()}`}><Icon name="clock" />{timeAgo(mod.updated)}</span>
            </div>
          </div>
          <div className="gb-mod-tags">
            {mod.character && <Badge tone="accent" icon="characters">{mod.character}</Badge>}
            {mod.category && mod.category.name !== mod.character && <Badge>{mod.category.name}</Badge>}
            {mod.version && <Badge title="Version">{mod.version}</Badge>}
            {mod.nsfw && <Badge tone="warn" title={mod.ratings.join(", ") || "Marked for adults"}>18+</Badge>}
            {installed.length > 0 && <Badge tone="ok" icon="check">Installed</Badge>}
          </div>
          {mod.summary && <p className="gb-summary">{mod.summary}</p>}

          <section className="gb-files" aria-label="Files">
            <h3 className="sub-h">Files</h3>
            <FileList mod={mod} game={game} installed={installed} snap={snap} older={older} setOlder={setOlder}
              onInstall={install} onMenu={(el, file, replaces) => setMenu({ el, file, replaces })} />
          </section>

          {description && (
            <div className="gb-desc selectable" onClick={openLink} onKeyDown={openLink} dangerouslySetInnerHTML={{ __html: description }} />
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
                      {p.text && <div className="gb-desc selectable" onClick={openLink} onKeyDown={openLink} dangerouslySetInnerHTML={{ __html: sanitizeHtml(p.text) }} />}
                    </li>
                  ))}
                </ol>
              ))}
            </section>
          )}
        </div>
      )}
      {lightbox !== null && mod && <Lightbox images={mod.images} start={lightbox} onClose={closeLightbox} />}
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
      <button type="button" className="gb-gallery-main" title="Open full size" onClick={() => (blurred ? onReveal() : onOpen(shown))}>
        {broken.has(shown)
          ? <span className="gb-img-broken"><Icon name="image" /></span>
          : <img src={imageAt(img, 800)} alt={img.caption ?? mod.name} loading="lazy" decoding="async"
              onError={() => setBroken((b) => new Set(b).add(shown))} />}
        {blurred && <span className="gb-nsfw-cover"><Badge tone="warn">18+</Badge><span>Show pictures</span></span>}
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

function FileList({ mod, game, installed, snap, older, setOlder, onInstall, onMenu }: {
  mod: GbMod; game: GameState; installed: ModEntry[]; snap: QueueSnapshot; older: boolean; setOlder: (v: boolean) => void;
  onInstall: (f: GbFile, replaces?: string) => void; onMenu: (el: HTMLElement, f: GbFile, replaces: string) => void;
}) {
  const newest = newestFile(mod);
  const current = mod.files.filter((f) => !f.archived);
  const old = mod.files.filter((f) => f.archived);
  if (!mod.files.length) return <p className="muted">This mod has no files to download.</p>;
  const row = (f: GbFile) => {
    const q = snap.items.find((i) => i.req.game === game.id && i.req.fileId === f.id && activeStates.has(i.state));
    const same = installed.find((m) => m.source?.fileId === f.id);
    const base = installed[0];
    const baseTime = base?.source?.remoteUpdated ?? base?.installedAt ?? 0;
    let action;
    if (q) {
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
    } else {
      action = <Button variant={f === newest ? "primary" : "secondary"} icon="install" onClick={() => onInstall(f)}>Install</Button>;
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
        <div className="gb-file-act">{action}</div>
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
