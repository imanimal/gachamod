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
import { toast } from "../../ui/toast";
import { Badge, Button, Empty, IconButton, PageHeader, SearchField, Segmented, Skeleton, Tabs, Waiting, Toggle, formatBytes, timeAgo } from "../../ui/kit";
import { ExtensionFrame, NeedsNote } from "./ExtensionFrame";
import { lang, stops, t, tb, tn } from "../../lib/i18n";
import { gameShort } from "../../lib/games";
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
    // one toast for the lot; each update is still its own step on the undo list
    let n = 0;
    try { for (const u of updates) if (await installListed(u, true)) n++; } finally { setUpdatingAll(false); }
    if (n) toast(tn(n, "Updated {n} package", "Updated {n} packages"));
  };

  const match = (name: string, author: string, desc: string, k: string) =>
    (kind === "all" || k === kind) && (!q.trim() || `${name} ${author} ${desc}`.toLowerCase().includes(q.trim().toLowerCase()));
  const shownListed = listed.filter((p) => match(p.name, p.author, p.description, p.kind));
  const shownInstalled = (list ?? []).filter((e) => match(extName(e), e.manifest?.author ?? "", e.manifest?.description ?? "", e.kind));

  const more = (el: Element) => openMenu(el, [
    { label: t("Install a package folder"), icon: "folder", title: t("Copies a folder that has extension.json in it"), onClick: () => void installFromDisk(true) },
    "-",
    { header: t("Making one") },
    { label: t("Link a folder"), icon: "link", title: t("Uses the folder where it is, so your edits show when you open the page again"), onClick: () => void linkFolder() },
    { label: t("Share a package"), icon: "upload", title: t("Zips a package folder and opens the page where you send it in"), onClick: () => void sharePackage(repos) },
    { label: t("How to make one"), icon: "help", onClick: () => void shell.openUrl(DOCS_URL) },
    "-",
    { label: t("Extension lists"), icon: "settings", title: t("Add other repos in Settings"), onClick: () => go({ view: "settings", section: "set-ext-sources" }) },
  ]);

  const errors = (repos ?? []).filter((r) => r.error);
  return (
    <div className="page extensions">
      <PageHeader title={t("Extensions")} icon="puzzle" sub={t("Themes and extensions people made for gachamod")}
        actions={<>
          <IconButton icon="refresh" label={t("Check the lists again")} onClick={() => void loadRepos(true)} disabled={loading} />
          <Button icon="import" onClick={() => void installFromDisk(false)} title={t("Install a package .zip someone sent you")}>{t("Install from file")}</Button>
          <IconButton icon="more" label={t("More: install a folder, make and share a package")} onClick={(e) => more(e.currentTarget)} />
        </>}>
        <div className="ext-bar">
          <Tabs value={tab} onChange={(v) => patchRoute({ tab: v === "installed" ? "installed" : undefined })}
            tabs={[{ value: "available", label: t("Available"), icon: "browse", count: listed.length || undefined },
              { value: "installed", label: updates.length ? <>{t("Installed")} <Badge tone="info" icon="update">{updates.length}</Badge></> : t("Installed"), icon: "check",
                count: list?.length || undefined, title: updates.length ? tn(updates.length, "{n} has an update", "{n} have an update") : undefined }]} />
          <Segmented size="sm" label={t("Show")} value={kind} onChange={(v) => patchRoute({ section: v === "theme" ? "themes" : v === "extension" ? "extensions" : undefined })}
            options={[{ value: "all", label: t("All") }, { value: "theme", label: t("Themes") }, { value: "extension", label: t("Extensions") }]} />
          <SearchField value={q} onChange={setQ} placeholder={t("Search extensions")} className="ext-search" />
          {tab === "installed" && updates.length > 1 && (
            <Button variant="primary" size="sm" icon="update" busy={updatingAll} onClick={() => void updateAll()}
              title={t("Update {names}. Each one can be undone", { names: updates.map((u) => u.name).join(", ") })}>{t("Update all ({n})", { n: updates.length })}</Button>
          )}
        </div>
      </PageHeader>

      {tab === "available" ? (
        <>
          {errors.map((r) => (
            <p key={r.source} className="hint ext-err" title={r.source}>
              {r.name ? `${r.name}: ` : ""}{stops([r.error ? tb(r.error) : ""], true)}{r.fetchedAt ? (lang === "zh-CN" ? "" : " ") + t("Showing the list from {when}.", { when: timeAgo(r.fetchedAt) }) : ""}
            </p>
          ))}
          {!repos && loading ? (
            <Waiting what={t("Reading extension lists")}>
              <div className="ext-grid">{[0, 1, 2].map((i) => <Skeleton key={i} h="9.5rem" />)}</div>
            </Waiting>
          )
            : shownListed.length ? (
              <div className="ext-grid">
                {shownListed.map((p) => <ListedCard key={`${p.source}:${p.id}`} p={p} have={list?.find((e) => e.id === p.id) ?? null} />)}
              </div>
            ) : (
              <Empty icon="puzzle" title={q || kind !== "all" ? t("Nothing matches") : errors.length ? t("Couldn't load the extension list") : t("Nothing listed yet")}
                actions={errors.length ? <Button icon="refresh" busy={loading} onClick={() => void loadRepos(true)}>{t("Try again")}</Button> : undefined}>
                {q ? t("Try other words.") : ""}
              </Empty>
            )}
        </>
      ) : list === null ? <Waiting className="ext-wait" what={t("Reading your extensions")} />
        : shownInstalled.length ? (
          <div className="ext-grid">{shownInstalled.map((e) => <InstalledCard key={e.id} e={e} update={updateFor(e, listed)} />)}</div>
        ) : (
          <Empty icon="puzzle" title={list.length ? t("Nothing matches") : t("No extensions yet")}
            actions={!list.length ? <Button variant="primary" icon="browse" onClick={() => patchRoute({ tab: undefined })}>{t("See what's available")}</Button> : undefined}>
            {list.length ? t("Try other words.") : t("Themes and extensions you install show up here.")}
          </Empty>
        )}
    </div>
  );
}

// ── cards ──

/** What a package can reach, in plain words. */
export function permissionLines(p: ExtPermissions): string[] {
  const out: string[] = [];
  if (p.library) out.push(t("Reads your mods and characters"));
  if (p.player) out.push(t("Reads your GameBanana name"));
  for (const o of p.net) {
    const m = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::(\d+))?$/.exec(o);
    out.push(m ? (m[2] ? t("Talks to an app on this PC (port {port})", { port: m[2] }) : t("Talks to an app on this PC")) : t("Connects to {site}", { site: o.replace(/^https:\/\//, "") }));
  }
  for (const f of p.files) out.push(t("Reads files in {folder}", { folder: f }));
  return out;
}

function Perms({ p, kind }: { p: ExtPermissions; kind: string }) {
  const lines = permissionLines(p);
  if (!lines.length) return kind === "theme" ? null : <p className="ext-perm-none">{t("Needs no permissions")}</p>;
  return <ul className="ext-perms" aria-label={t("Permissions")}>{lines.map((l) => <li key={l}><Icon name="shield" size={14} />{l}</li>)}</ul>;
}

function Games({ ids }: { ids: string[] }) {
  const games = useGames();
  if (!ids.length) return null;
  return <span className="ext-games" title={t("Only shows for these games")}>{ids.map((g) => { const x = games.find((y) => y.id === g); return x ? gameShort(x) : g; }).join(", ")}</span>;
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
    !have && { label: t("Install"), icon: "install", disabled: busy, onClick: () => void run() },
    !!newer && { label: t("Update to {version}", { version: p.version }), icon: "update", disabled: busy, onClick: () => void run() },
    !!have && { label: t("View under Installed"), icon: "check", onClick: () => patchRoute({ tab: "installed" }) },
    !!p.homepage && { label: t("Homepage"), icon: "external", onClick: () => void shell.openUrl(p.homepage!) },
  ];
  return (
    <article className="ext-card" onContextMenu={menuHandler(menu)}>
      <ExtIcon src={p.icon} kind={p.kind} />
      <div className="ext-main">
        <div className="ext-head">
          <div className="ext-top">
            <h3>{p.name}</h3>
            <span className="ext-ver">{p.version}</span>
            <Badge tone={p.kind === "theme" ? "info" : "muted"}>{p.kind === "theme" ? t("Theme") : t("Extension")}</Badge>
          </div>
          <div className="ext-act">
            {!have ? <Button variant="primary" icon="install" busy={busy} onClick={() => void run()} title={t("{size}. You can undo it", { size: formatBytes(p.size) })}>{t("Install")}</Button>
              : newer ? <Button variant="primary" icon="update" busy={busy} onClick={() => void run()} title={t("From {old} to {new}", { old: have.manifest!.version, new: p.version })}>{t("Update")}</Button>
              : <Badge tone="ok" icon="check" onClick={() => patchRoute({ tab: "installed" })} title={t("Installed. Click to see it under Installed")}>{t("Installed")}</Badge>}
            {p.homepage && <IconButton icon="external" label={t("Open its homepage")} onClick={() => void shell.openUrl(p.homepage!)} size="sm" />}
          </div>
        </div>
        <p className="ext-by">{t("By {author}", { author: p.author })}<Games ids={p.games} />{p.updated ? <span title={new Date(p.updated * 1000).toLocaleString(lang)}>{t("Updated {when}", { when: timeAgo(p.updated) })}</span> : null}</p>
        {p.description && <p className="ext-desc">{p.description}</p>}
        <Perms p={p.permissions} kind={p.kind} />
        {p.needs.map((n) => (
          <p key={n.name} className="ext-needs-line">
            <Icon name="link" size={14} />
            <span>{n.required ? t("Works with {app}, which you install yourself.", { app: n.name }) : t("Works with {app} (optional).", { app: n.name })}{" "}
              {n.url && <button type="button" className="ext-link" onClick={() => void shell.openUrl(n.url!)} title={n.url}>{t("Get {app}", { app: n.name })}</button>}</span>
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
    !!update && { label: t("Update to {version}", { version: update.version }), icon: "update", disabled: busy, onClick: () => void run() },
    !!m && { label: e.enabled ? t("Turn off {name}", { name }) : t("Turn on {name}", { name }), icon: "power", onClick: () => void setExtensionEnabled(e, !e.enabled) },
    m?.page && e.enabled && { label: t("Open {page}", { page: m.page.title }), icon: extIcon(m.page.icon), onClick: () => go({ view: "extensions", ext: e.id }) },
    { label: t("Open folder"), icon: "folder", onClick: () => void shell.openPath(e.dir) },
    e.linked && { label: t("Reload pages"), icon: "refresh", title: t("Shows your latest edits"), onClick: () => { void reloadExtensions(); reloadPages(); } },
    !!m?.homepage && { label: t("Homepage"), icon: "external", onClick: () => void shell.openUrl(m.homepage!) },
    "-",
    { label: e.linked ? t("Unlink") : t("Remove"), icon: "trash", danger: true, onClick: () => void removeExtension(e) },
  ];
  return (
    <article className={`ext-card${e.enabled ? "" : " is-off"}`} onContextMenu={menuHandler(() => menu)}>
      <ExtIcon src={fileUrl(e.icon)} kind={e.kind} />
      <div className="ext-main">
        <div className="ext-head">
          <div className="ext-top">
            <h3>{name}</h3>
            {m && <span className="ext-ver">{m.version}</span>}
            {e.linked && <Badge tone="info" icon="link" onClick={() => void shell.openPath(e.dir)} title={t("Used from {folder}. Click to open the folder", { folder: e.dir })}>{t("Linked folder")}</Badge>}
          </div>
          <div className="ext-act">
            {update && <Button variant="primary" size="sm" icon="update" busy={busy} onClick={() => void run()} title={t("From {old} to {new}", { old: m?.version ?? "", new: update.version })}>{t("Update")}</Button>}
            {m && <span title={e.enabled ? t("Turn {name} off", { name }) : t("Turn {name} on", { name })}><Toggle size="sm" checked={e.enabled} onChange={(v) => void setExtensionEnabled(e, v)} label={e.enabled ? t("On") : t("Off")} /></span>}
            <IconButton icon="more" size="sm" label={t("More (or right-click): open folder, remove")} onClick={(ev) => openMenu(ev.currentTarget, menu)} />
          </div>
        </div>
        {m && <p className="ext-by">{t("By {author}", { author: m.author })}<Games ids={m.games} />{e.source === null && !e.linked ? <span>{t("From a file")}</span> : null}</p>}
        {e.problem && <p className="ext-problem"><Icon name="warn" size={14} />{tb(e.problem)}</p>}
        {m?.description && <p className="ext-desc">{m.description}</p>}
        {m && (
          <div className="ext-where">
            {m.characterTab && <Badge tone="muted" icon="characters" onClick={() => go({ view: "characters" })} title={t("A tab on each character's page. Click to go to Characters")}>{t("Tab: {title}", { title: m.characterTab.title })}</Badge>}
            {m.page && <Badge tone="muted" icon={extIcon(m.page.icon)} onClick={() => go({ view: "extensions", ext: e.id })} title={e.enabled ? t("Has a page, also in the sidebar. Click to open it") : t("Turn it on to open its page")}>{t("Page: {title}", { title: m.page.title })}</Badge>}
            {m.themes.length > 0 && <Badge tone="muted" icon="palette" onClick={() => go({ view: "settings", section: "themes" })} title={t("Listed under Custom themes, where you pick one for a game")}>{tn(m.themes.length, "{n} theme", "{n} themes")}</Badge>}
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
  if (!list) return <Waiting className="ext-wait" what={t("Reading your extensions")} />;
  const m = e?.manifest;
  if (!e || !m?.page || !e.enabled || !game) {
    return (
      <div className="page">
        <Empty icon="puzzle" title={!e ? t("That extension isn't installed") : !e.enabled ? t("{name} is turned off", { name: extName(e) }) : t("That extension has no page")}
          actions={<Button icon="puzzle" onClick={() => go({ view: "extensions", tab: "installed" })}>{t("View extensions")}</Button>} />
      </div>
    );
  }
  const menu: MenuEntry[] = [
    { label: t("View in Extensions"), icon: "puzzle", onClick: () => go({ view: "extensions", tab: "installed" }) },
    e.linked && { label: t("Reload page"), icon: "refresh", onClick: () => { void reloadExtensions(); reloadPages(); } },
    { label: t("Turn off {name}", { name: m.name }), icon: "power", onClick: () => void setExtensionEnabled(e, false, true) },
  ];
  return (
    <div className="page ext-page">
      <PageHeader title={m.page.title} icon={extIcon(m.page.icon)} sub={m.page.title === m.name ? t("By {author}", { author: m.author }) : t("{name}, by {author}", { name: m.name, author: m.author })}
        actions={<IconButton icon="more" label={t("More")} onClick={(ev) => openMenu(ev.currentTarget, menu)} />} />
      <NeedsNote ext={e} />
      <ExtensionFrame key={`${e.id}:${m.version}`} ext={e} slot="page" game={game} />
    </div>
  );
}
