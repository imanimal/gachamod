// Extensions (view "extensions"): themes and extensions from the repos, and the ones installed. One click installs,
// updates, turns off or removes, each with Undo. A package's card says plainly what it can reach and which other
// apps it works with. `route.ext` shows an extension's own page. Reached from Settings, Custom themes and search.
// Owner: EXTENSIONS area (docs/extensions.md).
import { useMemo, useState } from "react";
import { fileUrl, shell, type ExtPermissions, type InstalledExt } from "../../lib/api";
import { extName, installFromDisk, installListed, linkFolder, listedPackages, loadRepos, reloadExtensions, reloadPages, removeExtension,
  setExtensionEnabled, sharePackage, updateFor, useExtensions, useRepos, type Listed } from "../../lib/extensions";
import { go, patchRoute, useGame, useGames, useRoute } from "../../lib/store";
import { menuHandler, openMenu, type MenuEntry } from "../../ui/ContextMenu";
import { Icon, type IconName } from "../../ui/Icon";
import { ICONS } from "../../ui/icons";
import { Badge, Button, Empty, IconButton, PageHeader, SearchField, Segmented, Skeleton, Tabs, Waiting, Toggle, formatBytes, timeAgo } from "../../ui/kit";
import { ExtensionFrame, NeedsNote } from "./ExtensionFrame";
import "./extensions.css";

export const DOCS_URL = "https://github.com/imanimal/gachamod-extensions/blob/main/docs/extensions.md";

/** An icon name a package picked, if the app has it. */
export const extIcon = (name: string | null | undefined, fallback: IconName = "puzzle"): IconName => (name && name in ICONS ? name as IconName : fallback);

type Kind = "all" | "theme" | "extension";

export function Extensions() {
  const route = useRoute();
  return route.ext ? <ExtensionPage id={route.ext} /> : <Catalog />;
}

function Catalog() {
  const route = useRoute();
  const tab = route.tab === "installed" ? "installed" : "available";
  const kind: Kind = route.section === "themes" ? "theme" : route.section === "extensions" ? "extension" : "all";
  const [q, setQ] = useState("");
  const list = useExtensions();
  const { repos, loading } = useRepos();
  const listed = useMemo(() => listedPackages(repos), [repos]);
  const updates = (list ?? []).flatMap((e) => updateFor(e, listed) ?? []);
  const [updatingAll, setUpdatingAll] = useState(false);
  const updateAll = async () => {
    setUpdatingAll(true);
    try { for (const u of updates) await installListed(u); } finally { setUpdatingAll(false); }
  };

  const match = (name: string, author: string, desc: string, k: string) =>
    (kind === "all" || k === kind) && (!q.trim() || `${name} ${author} ${desc}`.toLowerCase().includes(q.trim().toLowerCase()));
  const shownListed = listed.filter((p) => match(p.name, p.author, p.description, p.kind));
  const shownInstalled = (list ?? []).filter((e) => match(extName(e), e.manifest?.author ?? "", e.manifest?.description ?? "", e.kind));

  const more = (el: Element) => openMenu(el, [
    { label: "Install a package folder", icon: "folder", title: "Copies a folder that has extension.json in it", onClick: () => void installFromDisk(true) },
    "-",
    { header: "Making one" },
    { label: "Link a folder", icon: "link", title: "Uses the folder where it is, so your edits show when you open the page again", onClick: () => void linkFolder() },
    { label: "Share a package", icon: "upload", title: "Zips a package folder and opens the page where you send it in", onClick: () => void sharePackage(repos) },
    { label: "How to make one", icon: "help", onClick: () => void shell.openUrl(DOCS_URL) },
    "-",
    { label: "Extension lists", icon: "settings", title: "Add other repos in Settings", onClick: () => go({ view: "settings", section: "set-ext-sources" }) },
  ]);

  const errors = (repos ?? []).filter((r) => r.error);
  return (
    <div className="page extensions">
      <PageHeader title="Extensions" icon="puzzle" sub="Themes and extensions people made for gachamod"
        actions={<>
          <IconButton icon="refresh" label="Check the lists again" onClick={() => void loadRepos(true)} disabled={loading} />
          <Button icon="import" onClick={() => void installFromDisk(false)} title="Install a package .zip someone sent you">Install from file</Button>
          <IconButton icon="more" label="More: install a folder, make and share a package" onClick={(e) => more(e.currentTarget)} />
        </>}>
        <div className="ext-bar">
          <Tabs value={tab} onChange={(v) => patchRoute({ tab: v === "installed" ? "installed" : undefined })}
            tabs={[{ value: "available", label: "Available", icon: "browse", count: listed.length || undefined },
              { value: "installed", label: updates.length ? <>Installed <Badge tone="info" icon="update">{updates.length}</Badge></> : "Installed", icon: "check",
                count: list?.length || undefined, title: updates.length ? `${updates.length === 1 ? "1 has" : `${updates.length} have`} an update` : undefined }]} />
          <Segmented size="sm" label="Show" value={kind} onChange={(v) => patchRoute({ section: v === "theme" ? "themes" : v === "extension" ? "extensions" : undefined })}
            options={[{ value: "all", label: "All" }, { value: "theme", label: "Themes" }, { value: "extension", label: "Extensions" }]} />
          <SearchField value={q} onChange={setQ} placeholder="Search extensions" className="ext-search" />
          {tab === "installed" && updates.length > 1 && (
            <Button variant="primary" size="sm" icon="update" busy={updatingAll} onClick={() => void updateAll()}
              title={`Update ${updates.map((u) => u.name).join(", ")}. Each one can be undone`}>Update all ({updates.length})</Button>
          )}
        </div>
      </PageHeader>

      {tab === "available" ? (
        <>
          {errors.map((r) => (
            <p key={r.source} className="hint ext-err" title={r.source}>
              {r.name ? `${r.name}: ` : ""}{r.error}.{r.fetchedAt ? ` Showing the list from ${timeAgo(r.fetchedAt)}.` : ""}
            </p>
          ))}
          {!repos && loading ? (
            <Waiting what="Reading extension lists">
              <div className="ext-grid">{[0, 1, 2].map((i) => <Skeleton key={i} h="9.5rem" />)}</div>
            </Waiting>
          )
            : shownListed.length ? (
              <div className="ext-grid">
                {shownListed.map((p) => <ListedCard key={`${p.source}:${p.id}`} p={p} have={list?.find((e) => e.id === p.id) ?? null} />)}
              </div>
            ) : (
              <Empty icon="puzzle" title={q || kind !== "all" ? "Nothing matches" : errors.length ? "Couldn't load the extension list" : "Nothing listed yet"}
                actions={errors.length ? <Button icon="refresh" busy={loading} onClick={() => void loadRepos(true)}>Try again</Button> : undefined}>
                {q ? "Try other words." : ""}
              </Empty>
            )}
        </>
      ) : list === null ? <Waiting className="ext-wait" what="Reading your extensions" />
        : shownInstalled.length ? (
          <div className="ext-grid">{shownInstalled.map((e) => <InstalledCard key={e.id} e={e} update={updateFor(e, listed)} />)}</div>
        ) : (
          <Empty icon="puzzle" title={list.length ? "Nothing matches" : "No extensions yet"}
            actions={!list.length ? <Button variant="primary" icon="browse" onClick={() => patchRoute({ tab: undefined })}>See what's available</Button> : undefined}>
            {list.length ? "Try other words." : "Themes and extensions you install show up here."}
          </Empty>
        )}
    </div>
  );
}

// ── cards ──

/** What a package can reach, in plain words. */
export function permissionLines(p: ExtPermissions): string[] {
  const out: string[] = [];
  if (p.library) out.push("Reads your mods and characters");
  if (p.player) out.push("Reads your GameBanana name");
  for (const o of p.net) {
    const m = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::(\d+))?$/.exec(o);
    out.push(m ? `Talks to an app on this PC${m[2] ? ` (port ${m[2]})` : ""}` : `Connects to ${o.replace(/^https:\/\//, "")}`);
  }
  for (const f of p.files) out.push(`Reads files in ${f}`);
  return out;
}

function Perms({ p, kind }: { p: ExtPermissions; kind: string }) {
  const lines = permissionLines(p);
  if (!lines.length) return kind === "theme" ? null : <p className="ext-perm-none">Needs no permissions</p>;
  return <ul className="ext-perms" aria-label="What it can reach">{lines.map((l) => <li key={l}><Icon name="shield" size={14} />{l}</li>)}</ul>;
}

function Games({ ids }: { ids: string[] }) {
  const games = useGames();
  if (!ids.length) return null;
  return <span className="ext-games" title="Only shows for these games">{ids.map((g) => games.find((x) => x.id === g)?.short ?? g).join(", ")}</span>;
}

function ExtIcon({ src, kind }: { src: string | null | undefined; kind: string }) {
  const [bad, setBad] = useState(false);
  return (
    <div className="ext-ic" aria-hidden="true">
      {src && !bad ? <img src={src} alt="" onError={() => setBad(true)} /> : <Icon name={kind === "theme" ? "palette" : "puzzle"} />}
    </div>
  );
}

function ListedCard({ p, have }: { p: Listed; have: InstalledExt | null }) {
  const [busy, setBusy] = useState(false);
  const run = async () => { setBusy(true); try { await installListed(p); } finally { setBusy(false); } };
  const newer = have?.manifest && updateFor(have, [p]);
  const menu = (): MenuEntry[] => [
    !have && { label: "Install", icon: "install", disabled: busy, onClick: () => void run() },
    !!newer && { label: `Update to ${p.version}`, icon: "update", disabled: busy, onClick: () => void run() },
    !!have && { label: "View under Installed", icon: "check", onClick: () => patchRoute({ tab: "installed" }) },
    !!p.homepage && { label: "Homepage", icon: "external", onClick: () => void shell.openUrl(p.homepage!) },
  ];
  return (
    <article className="ext-card" onContextMenu={menuHandler(menu)}>
      <ExtIcon src={p.icon} kind={p.kind} />
      <div className="ext-main">
        <div className="ext-head">
          <div className="ext-top">
            <h3>{p.name}</h3>
            <span className="ext-ver">{p.version}</span>
            <Badge tone={p.kind === "theme" ? "info" : "muted"}>{p.kind === "theme" ? "Theme" : "Extension"}</Badge>
          </div>
          <div className="ext-act">
            {!have ? <Button variant="primary" icon="install" busy={busy} onClick={() => void run()} title={`${formatBytes(p.size)}. You can undo it`}>Install</Button>
              : newer ? <Button variant="primary" icon="update" busy={busy} onClick={() => void run()} title={`From ${have.manifest!.version} to ${p.version}`}>Update</Button>
              : <Badge tone="ok" icon="check" onClick={() => patchRoute({ tab: "installed" })} title="Installed. Click to see it under Installed">Installed</Badge>}
            {p.homepage && <IconButton icon="external" label="Open its homepage" onClick={() => void shell.openUrl(p.homepage!)} size="sm" />}
          </div>
        </div>
        <p className="ext-by">By {p.author}<Games ids={p.games} />{p.updated ? <span title={new Date(p.updated * 1000).toLocaleString()}>Updated {timeAgo(p.updated)}</span> : null}</p>
        {p.description && <p className="ext-desc">{p.description}</p>}
        <Perms p={p.permissions} kind={p.kind} />
        {p.needs.map((n) => (
          <p key={n.name} className="ext-needs-line">
            <Icon name="link" size={14} />
            <span>Works with {n.name}{n.required ? ", which you install yourself. " : " (optional). "}
              {n.url && <button type="button" className="ext-link" onClick={() => void shell.openUrl(n.url!)} title={n.url}>Get {n.name}</button>}</span>
          </p>
        ))}
      </div>
    </article>
  );
}

function InstalledCard({ e, update }: { e: InstalledExt; update: Listed | null }) {
  const [busy, setBusy] = useState(false);
  const m = e.manifest;
  const name = extName(e);
  const run = async () => { if (!update) return; setBusy(true); try { await installListed(update); } finally { setBusy(false); } };
  const menu: MenuEntry[] = [
    !!update && { label: `Update to ${update.version}`, icon: "update", disabled: busy, onClick: () => void run() },
    !!m && { label: e.enabled ? `Turn off ${name}` : `Turn on ${name}`, icon: "power", onClick: () => void setExtensionEnabled(e, !e.enabled) },
    m?.page && e.enabled && { label: `Open ${m.page.title}`, icon: extIcon(m.page.icon), onClick: () => go({ view: "extensions", ext: e.id }) },
    { label: "Open folder", icon: "folder", onClick: () => void shell.openPath(e.dir) },
    e.linked && { label: "Reload pages", icon: "refresh", title: "Shows your latest edits", onClick: () => { void reloadExtensions(); reloadPages(); } },
    !!m?.homepage && { label: "Homepage", icon: "external", onClick: () => void shell.openUrl(m.homepage!) },
    "-",
    { label: e.linked ? "Unlink" : "Remove", icon: "trash", danger: true, onClick: () => void removeExtension(e) },
  ];
  return (
    <article className={`ext-card${e.enabled ? "" : " is-off"}`} onContextMenu={menuHandler(() => menu)}>
      <ExtIcon src={fileUrl(e.icon)} kind={e.kind} />
      <div className="ext-main">
        <div className="ext-head">
          <div className="ext-top">
            <h3>{name}</h3>
            {m && <span className="ext-ver">{m.version}</span>}
            {e.linked && <Badge tone="info" icon="link" onClick={() => void shell.openPath(e.dir)} title={`Used from ${e.dir}. Click to open the folder`}>Linked folder</Badge>}
          </div>
          <div className="ext-act">
            {update && <Button variant="primary" size="sm" icon="update" busy={busy} onClick={() => void run()} title={`From ${m?.version} to ${update.version}`}>Update</Button>}
            {m && <span title={e.enabled ? `Turn ${name} off` : `Turn ${name} on`}><Toggle size="sm" checked={e.enabled} onChange={(v) => void setExtensionEnabled(e, v)} label={e.enabled ? "On" : "Off"} /></span>}
            <IconButton icon="more" size="sm" label="More (or right-click): open folder, remove" onClick={(ev) => openMenu(ev.currentTarget, menu)} />
          </div>
        </div>
        {m && <p className="ext-by">By {m.author}<Games ids={m.games} />{e.source === null && !e.linked ? <span>From a file</span> : null}</p>}
        {e.problem && <p className="ext-problem"><Icon name="warn" size={14} />{e.problem}</p>}
        {m?.description && <p className="ext-desc">{m.description}</p>}
        {m && (
          <div className="ext-where">
            {m.characterTab && <Badge tone="muted" icon="characters" onClick={() => go({ view: "characters" })} title="A tab on each character's page. Click to go to Characters">Tab: {m.characterTab.title}</Badge>}
            {m.page && <Badge tone="muted" icon={extIcon(m.page.icon)} onClick={() => go({ view: "extensions", ext: e.id })} title={e.enabled ? "Its own page, also in the sidebar. Click to open it" : "Turn it on to open its page"}>Page: {m.page.title}</Badge>}
            {m.themes.length > 0 && <Badge tone="muted" icon="palette" onClick={() => go({ view: "settings", section: "themes" })} title="Listed under Custom themes, where you pick one for a game">{m.themes.length === 1 ? "1 theme" : `${m.themes.length} themes`}</Badge>}
          </div>
        )}
        {m && <Perms p={m.permissions} kind={e.kind} />}
        {m && e.enabled && <NeedsNote ext={e} />}
      </div>
    </article>
  );
}

// ── an extension's own page ──

function ExtensionPage({ id }: { id: string }) {
  const list = useExtensions();
  const game = useGame();
  const e = list?.find((x) => x.id === id);
  if (!list) return <Waiting className="ext-wait" what="Reading your extensions" />;
  const m = e?.manifest;
  if (!e || !m?.page || !e.enabled || !game) {
    return (
      <div className="page">
        <Empty icon="puzzle" title={!e ? "That extension isn't installed" : !e.enabled ? `${extName(e)} is turned off` : "That extension has no page"}
          actions={<Button icon="puzzle" onClick={() => go({ view: "extensions", tab: "installed" })}>View extensions</Button>} />
      </div>
    );
  }
  const menu: MenuEntry[] = [
    { label: "View in Extensions", icon: "puzzle", onClick: () => go({ view: "extensions", tab: "installed" }) },
    e.linked && { label: "Reload page", icon: "refresh", onClick: () => { void reloadExtensions(); reloadPages(); } },
    { label: `Turn off ${m.name}`, icon: "power", onClick: () => void setExtensionEnabled(e, false) },
  ];
  return (
    <div className="page ext-page">
      <PageHeader title={m.page.title} icon={extIcon(m.page.icon)} sub={m.page.title === m.name ? `By ${m.author}` : `${m.name}, by ${m.author}`}
        actions={<IconButton icon="more" label="More" onClick={(ev) => openMenu(ev.currentTarget, menu)} />} />
      <NeedsNote ext={e} />
      <ExtensionFrame key={`${e.id}:${m.version}`} ext={e} slot="page" game={game} />
    </div>
  );
}
