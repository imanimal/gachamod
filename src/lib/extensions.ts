// Installed extensions and the repos' lists, kept live for every screen, and the changes people make to them, each
// with Undo. Theme packages put their themes in the custom theme list (marked with `pkg`) and take them out again
// when they are turned off or removed. Owner: EXTENSIONS area (docs/extensions.md).
import { useEffect, useSyncExternalStore } from "react";
import { dialogs, errorText, extensions as api, settings, shell, type ExtInstallResult, type ExtRepo, type IndexEntry, type InstalledExt, type Packed } from "./api";
import { DEFAULT_EXT_SOURCE } from "./api/extensions";
import { record, undo } from "./history";
import { currentGame } from "./store";
import { accountState } from "./account";
import { applyCustomTheme, customThemesPref, setThemePick, themePick, validateCustomTheme, type CustomTheme } from "./theme";
import { toast } from "../ui/toast";

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
    mine = raw.map((r) => validateCustomTheme(r).theme).filter((t): t is CustomTheme => !!t)
      .map((t, i) => ({ ...t, id: i === 0 ? `custom:${id}` : `custom:${id.slice(0, 36)}-${i + 1}`, pkg: id }));
  }
  const old = before.filter((t) => t.pkg === id);
  if (JSON.stringify(old) === JSON.stringify(mine)) return;
  const at = before.findIndex((t) => t.pkg === id);
  const rest = before.filter((t) => t.pkg !== id);
  const after = at < 0 ? [...rest, ...mine] : [...rest.slice(0, at), ...mine, ...rest.slice(at)];
  await customThemesPref.set(after);
  applyCustomTheme(null);
}

/** Once a session: themes of packages that are gone come out, and installed theme packages' themes are there. */
async function syncAllThemes(list: InstalledExt[]) {
  await customThemesPref.ready;
  const gone = new Set(customThemesPref.get().map((t) => t.pkg).filter((p): p is string => !!p && !list.some((e) => e.id === p)));
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

/** For a theme package that's on: "Use for <game>", which picks its first theme for the game on screen. */
function useThemeAction(id: string) {
  const e = installed.get()?.find((x) => x.id === id);
  const game = currentGame();
  const theme = customThemesPref.get().find((t) => t.pkg === id);
  if (!e?.enabled || !e.manifest?.themes.length || !game || !theme || themePick(game.id) === theme.id) return undefined;
  return {
    label: `Use for ${game.name}`,
    run: () => {
      const before = themePick(game.id);
      setThemePick(game, theme.id);
      record({ label: `Used the theme ${theme.name} for ${game.name}`, undo: async () => setThemePick(game, before), redo: async () => setThemePick(game, theme.id) });
    },
  };
}

/** Record an install or update: Undo puts back what was there before (or removes it), Redo installs it again. A theme
 *  package's toast also offers to use it. */
function recordInstall(r: ExtInstallResult, label: string) {
  const id = r.extension.id;
  let back = r.replaced;
  let fwd: string | null = null;
  const use = useThemeAction(id);
  const entry = record({
    label,
    undo: async () => {
      if (back) fwd = (await api.restore(back)).replaced;
      else fwd = await api.remove(id);
      await after(id);
    },
    redo: async () => {
      if (fwd) back = (await api.restore(fwd)).replaced;
      await after(id);
    },
  }, !!use);
  if (use) toast(`${label}.`, false, use, { label: "Undo", run: () => void undo(entry) });
}

export async function installListed(p: Listed): Promise<boolean> {
  const had = installed.get()?.find((e) => e.id === p.id);
  try {
    const r = await api.install(p.source, p);
    await after(p.id);
    const verb = had?.manifest ? (compareVersions(p.version, had.manifest.version) > 0 ? `Updated ${p.name} to ${p.version}` : `Reinstalled ${p.name}`) : `Installed ${p.name}`;
    recordInstall(r, verb);
    return true;
  } catch (e) { toast(errorText(e), true); return false; }
}

/** Install a package .zip, or a copy of a package folder (`folder`). */
export async function installFromDisk(folder = false) {
  const picked = folder ? await dialogs.pickFolder("Pick the package folder (the one with extension.json)")
    : (await dialogs.pickFiles({ title: "Pick a package", extensions: ["zip"] }))?.[0];
  if (!picked) { if (!("__TAURI_INTERNALS__" in window)) toast("Installing from a file works in the app", true); return; }
  try {
    const r = await api.installFile(picked);
    await after(r.extension.id);
    recordInstall(r, `Installed ${extName(r.extension)}`);
  } catch (e) { toast(errorText(e), true); }
}

/** For making a package: use a folder where it is, so edits show after a reload. */
export async function linkFolder() {
  const picked = await dialogs.pickFolder("Pick the folder you're making the package in");
  if (!picked) { if (!("__TAURI_INTERNALS__" in window)) toast("Linking a folder works in the app", true); return; }
  try {
    const e = await api.linkFolder(picked);
    await after(e.id);
    record({ label: `Linked ${extName(e)}`, undo: async () => { await api.remove(e.id); await after(e.id); }, redo: async () => { await api.linkFolder(picked); await after(e.id); } });
  } catch (err) { toast(errorText(err), true); }
}

export async function removeExtension(e: InstalledExt) {
  try {
    let key = await api.remove(e.id);
    await after(e.id);
    record({
      label: e.linked ? `Unlinked ${extName(e)}` : `Removed ${extName(e)}`,
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

export async function setExtensionEnabled(e: InstalledExt, on: boolean) {
  const set = async (v: boolean) => { await api.setEnabled(e.id, v); await after(e.id); };
  try {
    await set(on);
    record({ label: `${on ? "Turned on" : "Turned off"} ${extName(e)}`, undo: () => set(!on), redo: () => set(on) });
  } catch (err) { toast(errorText(err), true); }
}

// ── sharing ──

/** Where packages go to be listed: the first repo that takes submissions. */
export function submitUrl(repos: ExtRepo[] | null): string {
  return repos?.find((r) => r.submit)?.submit ?? "https://github.com/imanimal/gachamod-extensions/issues/new?template=submit.yml";
}

function shared(p: Packed, repos: ExtRepo[] | null) {
  toast(`Saved ${p.name} ${p.version}. Attach the zip on the page that just opened`, false, { label: "Show file", run: () => { void shell.revealPath(p.path); } });
  void shell.openUrl(submitUrl(repos)).catch(() => {});
}

/** Zip a package folder for the repo and open the page to send it in. */
export async function sharePackage(repos: ExtRepo[] | null) {
  const folder = await dialogs.pickFolder("Pick the package folder (the one with extension.json)");
  if (!folder) { if (!("__TAURI_INTERNALS__" in window)) toast("Making a package works in the app", true); return; }
  const name = folder.split(/[\\/]/).filter(Boolean).pop() ?? "package";
  const out = await dialogs.saveFile({ title: "Save the package", defaultPath: `${name}.zip`, extensions: ["zip"] });
  if (!out) return;
  try { shared(await api.packFolder(folder, out), repos); } catch (e) { toast(errorText(e), true); }
}

/** Package one custom theme for the repo and open the page to send it in. The author is the GameBanana name when
 *  signed in (or the name an older version kept for its player card). */
export async function shareTheme(t: CustomTheme) {
  const slug = t.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "theme";
  const id = slug.length < 2 ? `${slug}-theme` : slug;
  const out = await dialogs.saveFile({ title: "Save the theme package", defaultPath: `${id}.zip`, extensions: ["zip"] });
  if (!out) { if (!("__TAURI_INTERNALS__" in window)) toast("Saving a package works in the app", true); return; }
  const player = await settings.getJson<{ name?: string }>("player", {});
  const author = accountState().user?.name || player.name?.trim() || "Anonymous";
  const theme = { name: t.name, base: t.base, scheme: t.scheme, tokens: t.tokens, layout: t.layout, ...(t.css ? { css: t.css } : {}) };
  try { shared(await api.packTheme(theme, { id, name: t.name, author, description: `A ${t.scheme === "light" ? "light" : "dark"} theme on top of ${t.base === "default" ? "Default" : t.base}.` }, out), repoStore.get().repos); }
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
