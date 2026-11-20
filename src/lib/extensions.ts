// Installed extensions and the repos' lists, kept live for every screen, and the changes people make to them, each
// with Undo. Theme packages put their themes in the custom theme list (marked with `pkg`) and take them out again
// when they are turned off or removed. Owner: EXTENSIONS area (docs/extensions.md).
import { useEffect, useSyncExternalStore } from "react";
import { dialogs, errorText, extensions as api, settings, shell, type ExtInstallResult, type ExtRepo, type IndexEntry, type InstalledExt, type Packed } from "./api";
import { DEFAULT_EXT_SOURCE } from "./api/extensions";
import { linkToast, record, undo } from "./history";
import { currentGame } from "./store";
import { accountState } from "./account";
import { applyCustomTheme, customThemesPref, setThemePick, themePick, validateCustomTheme, type CustomTheme } from "./theme";
import { toast } from "../ui/toast";
import { gameName } from "./games";
import { t, tn } from "./i18n";
import { note as noteUsage } from "./telemetry";

function store<T>(initial: T) {
  let value = initial;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set: (v: T) => { value = v; subs.forEach((f) => f()); },
    sub: (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; },
  };
}

// ── installed ──

const installed = store<InstalledExt[] | null>(null);
let loading: Promise<InstalledExt[]> | null = null;
let synced = false;

export function reloadExtensions(): Promise<InstalledExt[]> {
  loading = api.list().then((list) => {
    installed.set(list);
    if (!synced) { synced = true; void syncAllThemes(list); }
    return list;
  }).catch((e) => { toast(errorText(e), true); installed.set(installed.get() ?? []); return installed.get() ?? []; });
  return loading;
}
const ensure = () => { if (!loading) void reloadExtensions(); };

/** Installed packages (null until loaded). */
export function useExtensions(): InstalledExt[] | null {
  useEffect(ensure, []);
  return useSyncExternalStore(installed.sub, installed.get);
}
export const extensionsNow = (): InstalledExt[] => { ensure(); return installed.get() ?? []; };

/** Turned on, readable and meant for this game. */
export const forGame = (list: InstalledExt[] | null, game: string | null | undefined) =>
  (list ?? []).filter((e) => e.enabled && e.manifest && (!e.manifest.games.length || (!!game && e.manifest.games.includes(game))));
export const characterTabs = (list: InstalledExt[] | null, game: string | null | undefined) => forGame(list, game).filter((e) => e.manifest!.characterTab);
export const extensionPages = (list: InstalledExt[] | null, game: string | null | undefined) => forGame(list, game).filter((e) => e.manifest!.page);
export const extName = (e: InstalledExt) => e.manifest?.name ?? e.id;

/** Bumped by "Reload pages" (linked folders), so open extension pages load again with the latest files. */
const reloads = store(0);
export const reloadPages = () => reloads.set(reloads.get() + 1);
export const usePageReloads = () => useSyncExternalStore(reloads.sub, reloads.get);

// ── repos ──

interface RepoState { repos: ExtRepo[] | null; loading: boolean }
const repoStore = store<RepoState>({ repos: null, loading: false });

export async function loadRepos(refresh = false) {
  if (repoStore.get().loading) return;
  repoStore.set({ ...repoStore.get(), loading: true });
  try { repoStore.set({ repos: await api.repos(refresh), loading: false }); }
  catch (e) { repoStore.set({ repos: repoStore.get().repos ?? [], loading: false }); toast(errorText(e), true); }
}
export function useRepos(): RepoState {
  useEffect(() => { if (!repoStore.get().repos) void loadRepos(); }, []);
  return useSyncExternalStore(repoStore.sub, repoStore.get);
}

export interface Listed extends IndexEntry { source: string; repo: string }
/** Every listed package once (the first repo that lists an id wins). */
export function listedPackages(repos: ExtRepo[] | null): Listed[] {
  const out: Listed[] = [];
  for (const r of repos ?? []) for (const p of r.packages) if (!out.some((x) => x.id === p.id)) out.push({ ...p, source: r.source, repo: r.name });
  return out;
}

/** -1, 0 or 1, like app_update.rs: numbers compare as numbers, a release is newer than its pre-releases. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core = "", pre] = v.trim().replace(/^v/i, "").split("+")[0]!.split(/-(.*)/s);
    return { nums: core.split(".").map((n) => parseInt(n, 10) || 0), pre: pre ? pre.split(".") : [] };
  };
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) { const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0); if (d) return Math.sign(d); }
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1;
  for (let i = 0; i < Math.min(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i]!, q = y.pre[i]!;
    const d = /^\d+$/.test(p) && /^\d+$/.test(q) ? Number(p) - Number(q) : p.localeCompare(q);
    if (d) return Math.sign(d);
  }
  return Math.sign(x.pre.length - y.pre.length);
}

/** The listed version that would update an installed package, when there is a newer one. */
export function updateFor(e: InstalledExt, listed: Listed[]): Listed | null {
  if (!e.manifest || e.linked) return null;
  const l = listed.find((x) => x.id === e.id && (!e.source || x.source === e.source));
  return l && compareVersions(l.version, e.manifest.version) > 0 ? l : null;
}

// ── theme packages ──

/** Put a package's themes in the custom theme list (or take them out when it is off or gone). Ids stay the same
 *  across updates, so a game that uses one keeps it. */
async function syncThemes(id: string, on: boolean) {
  await customThemesPref.ready;
  const before = customThemesPref.get();
  let mine: CustomTheme[] = [];
  if (on) {
    const raw = await api.themes(id).catch(() => [] as unknown[]);
    mine = raw.map((r) => validateCustomTheme(r).theme).filter((th): th is CustomTheme => !!th)
      .map((th, i) => ({ ...th, id: i === 0 ? `custom:${id}` : `custom:${id.slice(0, 36)}-${i + 1}`, pkg: id }));
  }
  const old = before.filter((th) => th.pkg === id);
  if (JSON.stringify(old) === JSON.stringify(mine)) return;
  const at = before.findIndex((th) => th.pkg === id);
  const rest = before.filter((th) => th.pkg !== id);
  const after = at < 0 ? [...rest, ...mine] : [...rest.slice(0, at), ...mine, ...rest.slice(at)];
  await customThemesPref.set(after);
  applyCustomTheme(null);
}

/** Once a session: themes of packages that are gone come out, and installed theme packages' themes are there. */
async function syncAllThemes(list: InstalledExt[]) {
  await customThemesPref.ready;
  const gone = new Set(customThemesPref.get().map((th) => th.pkg).filter((p): p is string => !!p && !list.some((e) => e.id === p)));
  for (const id of gone) await syncThemes(id, false);
  for (const e of list) if (e.manifest?.themes.length) await syncThemes(e.id, e.enabled);
}

async function after(id: string | null) {
  const list = await reloadExtensions();
  if (!id) return;
  const e = list.find((x) => x.id === id);
  if (e?.manifest?.themes.length || !e) await syncThemes(id, !!e?.enabled);
}

// ── changes, each with Undo ──

/** For a theme package that's on: "Use for this game", which picks its first theme for the game on screen. */
function useThemeAction(id: string) {
  const e = installed.get()?.find((x) => x.id === id);
  const game = currentGame();
  const theme = customThemesPref.get().find((th) => th.pkg === id);
  if (!e?.enabled || !e.manifest?.themes.length || !game || !theme || themePick(game.id) === theme.id) return undefined;
  return {
    label: t("Use for this game"),
    run: () => {
      const before = themePick(game.id);
      setThemePick(game, theme.id);
      record({ label: t("Used the theme {theme} for {game}", { theme: theme.name, game: gameName(game) }), brief: t("Used the theme for this game"), undo: async () => setThemePick(game, before), redo: async () => setThemePick(game, theme.id) });
    },
  };
}

const isTheme = (e: Pick<InstalledExt, "kind">) => e.kind === "theme";

interface Step { undo: () => Promise<void>; redo: () => Promise<void> }

/** An install's Undo and Redo: Undo puts back what was there before (or removes it), Redo installs it again. */
function installStep(r: ExtInstallResult): Step {
  const id = r.extension.id;
  let back = r.replaced;
  let fwd: string | null = null;
  return {
    undo: async () => {
      if (back) fwd = (await api.restore(back)).replaced;
      else fwd = await api.remove(id);
      await after(id);
    },
    redo: async () => {
      if (fwd) back = (await api.restore(fwd)).replaced;
      await after(id);
    },
  };
}

/** Record an install or update. A theme package's toast also offers to use it. `brief` is the toast's words, without
 *  the name. */
function recordInstall(r: ExtInstallResult, label: string, brief: string) {
  const use = useThemeAction(r.extension.id);
  const entry = record({ label, brief, ...installStep(r) }, !!use);
  if (!use) return;
  // the toast's Undo is the entry's: undoing from anywhere turns this toast into Redo
  let tid = 0;
  tid = toast(t("{label}.", { label: brief }), false, use, { label: t("Undo"), run: () => void undo(entry, tid) });
  linkToast(entry, tid);
}

/** Install or update a listed package and say what changed. Null when it failed (the error is toasted). */
async function installOne(p: Listed): Promise<{ r: ExtInstallResult; verb: string; brief: string } | null> {
  const had = installed.get()?.find((e) => e.id === p.id);
  try {
    const r = await api.install(p.source, p);
    noteUsage("extension installed", { kind: p.kind, update: !!had?.manifest });
    await after(p.id);
    const theme = isTheme(p);
    const [verb, brief] = had?.manifest
      ? (compareVersions(p.version, had.manifest.version) > 0
        ? [t("Updated {name} to {version}", { name: p.name, version: p.version }), theme ? t("Updated the theme") : t("Updated the extension")]
        : [t("Reinstalled {name}", { name: p.name }), theme ? t("Reinstalled the theme") : t("Reinstalled the extension")])
      : [t("Installed {name}", { name: p.name }), theme ? t("Installed the theme") : t("Installed the extension")];
    return { r, verb, brief };
  } catch (e) { toast(errorText(e), true); return null; }
}

/** Install or update a listed package. */
export async function installListed(p: Listed): Promise<boolean> {
  const done = await installOne(p);
  if (done) recordInstall(done.r, done.verb, done.brief);
  return !!done;
}

/** "Update all": update these packages as one Undo step, with one toast that counts them. Resolves to how many
 *  updated. */
export async function updatePackages(list: Listed[]): Promise<number> {
  const steps: Step[] = [];
  for (const p of list) {
    const done = await installOne(p);
    if (done) steps.push(installStep(done.r));
  }
  if (steps.length) {
    record({
      label: tn(steps.length, "Updated {n} package", "Updated {n} packages"),
      undo: async () => { for (const s of [...steps].reverse()) await s.undo(); },
      redo: async () => { for (const s of steps) await s.redo(); },
    });
  }
  return steps.length;
}

/** Install a package .zip, or a copy of a package folder (`folder`). */
export async function installFromDisk(folder = false) {
  const picked = folder ? await dialogs.pickFolder(t("Pick the package folder (the one with extension.json)"))
    : (await dialogs.pickFiles({ title: t("Pick a package"), extensions: ["zip"] }))?.[0];
  if (!picked) { if (!("__TAURI_INTERNALS__" in window)) toast(t("Installing from a file works in the app"), true); return; }
  try {
    const r = await api.installFile(picked);
    await after(r.extension.id);
    recordInstall(r, t("Installed {name}", { name: extName(r.extension) }), isTheme(r.extension) ? t("Installed the theme") : t("Installed the extension"));
  } catch (e) { toast(errorText(e), true); }
}

/** For making a package: use a folder where it is, so edits show after a reload. */
export async function linkFolder() {
  const picked = await dialogs.pickFolder(t("Pick the folder you're making the package in"));
  if (!picked) { if (!("__TAURI_INTERNALS__" in window)) toast(t("Linking a folder works in the app"), true); return; }
  try {
    const e = await api.linkFolder(picked);
    await after(e.id);
    record({ label: t("Linked {name}", { name: extName(e) }), brief: t("Linked the folder"), undo: async () => { await api.remove(e.id); await after(e.id); }, redo: async () => { await api.linkFolder(picked); await after(e.id); } });
  } catch (err) { toast(errorText(err), true); }
}

export async function removeExtension(e: InstalledExt) {
  try {
    let key = await api.remove(e.id);
    await after(e.id);
    record({
      label: e.linked ? t("Unlinked {name}", { name: extName(e) }) : t("Removed {name}", { name: extName(e) }),
      brief: e.linked ? t("Unlinked the folder") : isTheme(e) ? t("Removed the theme") : t("Removed the extension"),
      undo: async () => {
        if (key) key = (await api.restore(key)).replaced ?? null;
        else await api.linkFolder(e.dir);
        if (!e.enabled) await api.setEnabled(e.id, false);
        await after(e.id);
      },
      redo: async () => { key = await api.remove(e.id); await after(e.id); },
    });
  } catch (err) { toast(errorText(err), true); }
}

/** Turn a package on or off. Quiet by default, for the switch that shows it; `say` toasts it with Undo, for a button
 *  whose page goes away with it (an extension's own page or frame). */
export async function setExtensionEnabled(e: InstalledExt, on: boolean, say = false) {
  const set = async (v: boolean) => { await api.setEnabled(e.id, v); await after(e.id); };
  try {
    await set(on);
    record({
      label: on ? t("Turned on {name}", { name: extName(e) }) : t("Turned off {name}", { name: extName(e) }),
      brief: on ? t("Turned on the extension") : t("Turned off the extension"),
      undo: () => set(!on), redo: () => set(on),
    }, !say);
  } catch (err) { toast(errorText(err), true); }
}

// ── sharing ──

/** Where packages go to be listed: the first repo that takes submissions. */
export function submitUrl(repos: ExtRepo[] | null): string {
  return repos?.find((r) => r.submit)?.submit ?? "https://github.com/imanimal/gachamod-extensions/issues/new?template=submit.yml";
}

function shared(p: Packed, repos: ExtRepo[] | null) {
  toast(t("Saved the package. Attach the zip on the page that just opened"), false, { label: t("Show file"), run: () => { void shell.revealPath(p.path); } });
  void shell.openUrl(submitUrl(repos)).catch(() => {});
}

/** Zip a package folder for the repo and open the page to send it in. */
export async function sharePackage(repos: ExtRepo[] | null) {
  const folder = await dialogs.pickFolder(t("Pick the package folder (the one with extension.json)"));
  if (!folder) { if (!("__TAURI_INTERNALS__" in window)) toast(t("Making a package works in the app"), true); return; }
  const name = folder.split(/[\\/]/).filter(Boolean).pop() ?? "package";
  const out = await dialogs.saveFile({ title: t("Save the package"), defaultPath: `${name}.zip`, extensions: ["zip"] });
  if (!out) return;
  try { shared(await api.packFolder(folder, out), repos); } catch (e) { toast(errorText(e), true); }
}

/** Package one custom theme for the repo and open the page to send it in. The author is the GameBanana name when
 *  signed in (or the name an older version kept for its player card). */
export async function shareTheme(ct: CustomTheme) {
  const slug = ct.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "theme";
  const id = slug.length < 2 ? `${slug}-theme` : slug;
  const out = await dialogs.saveFile({ title: t("Save the theme package"), defaultPath: `${id}.zip`, extensions: ["zip"] });
  if (!out) { if (!("__TAURI_INTERNALS__" in window)) toast(t("Saving a package works in the app"), true); return; }
  const player = await settings.getJson<{ name?: string }>("player", {});
  const author = accountState().user?.name || player.name?.trim() || "Anonymous";
  const theme = { name: ct.name, base: ct.base, scheme: ct.scheme, tokens: ct.tokens, layout: ct.layout, ...(ct.css ? { css: ct.css } : {}) };
  // the package's description is published in the repo's list, so it stays English
  try { shared(await api.packTheme(theme, { id, name: ct.name, author, description: `A ${ct.scheme === "light" ? "light" : "dark"} theme on top of ${ct.base === "default" ? "Default" : ct.base}.` }, out), repoStore.get().repos); }
  catch (e) { toast(errorText(e), true); }
}

// ── extra repos (Settings) ──

const SOURCES = "extensions.sources";
export async function extraSources(): Promise<string[]> { return settings.getJson<string[]>(SOURCES, []); }
export async function setExtraSources(list: string[]) {
  const clean = [...new Set(list.map((s) => s.trim()).filter((s) => /^https:\/\/\S+$/.test(s) && s !== DEFAULT_EXT_SOURCE))];
  await settings.setJson(SOURCES, clean);
  await loadRepos(true);
}
