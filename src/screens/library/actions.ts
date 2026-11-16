// What can be done to installed mods, for every place that shows them (the grid, the bulk bar, the right-click menu,
// the details drawer): each change goes to the backend, reaches every screen through publish(), and records an Undo
// step. Owner: LIBRARY area.
import { errorText, library, profiles, shell, type GameId, type ModEntry, type Profile } from "../../lib/api";
import * as modtoolsApi from "../../lib/api/modtools";
import type { MetaPatch } from "../../lib/api/library";
import { checkUpdates, modPage, queueLatest } from "../../lib/gamebanana";
import { fixMods } from "../../lib/fixes";
import { record } from "../../lib/history";
import { currentRoute, emitApp, go } from "../../lib/store";
import { toast } from "../../ui/toast";
import { profilesChanged } from "../profiles/data";
import { changeStates, publish, removeMods, toggleMods } from "./data";
import { previewChanged } from "./Preview";
import { askOverlap } from "./overlap";
import { notesText } from "../../lib/notes";

/** "Ellen hoodie" or "3 mods". */
export const modsName = (list: ModEntry[]) => (list.length === 1 ? list[0]!.name : `${list.length} mods`);

const fail = (e: unknown) => toast(errorText(e), true);

// ── on and off ──

/** Turn mods on or off with Undo. `prior` is every mod of the game as it was (fetched when not given), so mods the
 *  one-skin rule turns off come back on Undo too. Turning mods on while their character has others on asks first
 *  (overlap.ts), by `at` or the focused element; `keep` (Shift, or "Turn on with others") keeps the others on without
 *  asking. False when nothing changed (the question was closed). */
export async function setOn(game: GameId, list: ModEntry[], on: boolean, prior?: ModEntry[], at?: Element | null, keep = false): Promise<boolean> {
  const ids = list.filter((m) => m.enabled !== on).map((m) => m.id);
  if (!ids.length) { toast(on ? "They're already on" : "They're already off"); return false; }
  const from = at ?? document.activeElement;
  try {
    const all = prior ?? await library.list(game);
    let turnOffOthers: boolean | undefined;
    if (on && keep) turnOffOthers = false;
    else if (on) {
      const going = ids.map((id) => all.find((m) => m.id === id) ?? list.find((m) => m.id === id)!);
      const c = await askOverlap(game, going, all, from);
      if (!c) return false;
      if (c.parent && going.length === 1 && !(await setParent(game, going[0]!, c.parent, all))) return false;
      turnOffOthers = c.turnOffOthers;
    }
    await toggleMods(game, ids, on, all, turnOffOthers);
    return true;
  } catch (e) { fail(e); return false; }
}

// ── sub-mods ──

/** Make a mod a sub-mod of another (an id), or a mod of its own again with "". With Undo. */
export async function setParent(game: GameId, mod: ModEntry, parent: string, all?: ModEntry[]): Promise<boolean> {
  const before = mod.parent ?? "";
  if (before === parent) return true;
  const list = all ?? await library.list(game).catch(() => [] as ModEntry[]);
  const name = (id: string) => list.find((m) => m.id === id)?.name ?? "the other mod";
  try {
    const run = async (p: string) => publish(game, { changed: [await library.updateMeta(game, mod.id, { parent: p })], removed: [], notes: [] });
    await run(parent);
    record({
      label: parent ? `Made ${mod.name} a sub-mod of ${name(parent)}` : `${mod.name} is a mod of its own again`,
      undo: () => run(before),
      redo: () => run(parent),
    });
    return true;
  } catch (e) { fail(e); return false; }
}

// ── details (name, character, tags, favourite, adult) ──

function oldValues(m: ModEntry, p: MetaPatch): MetaPatch {
  const o: MetaPatch = {};
  if (p.name !== undefined) o.name = m.name;
  if (p.character !== undefined) o.character = m.character ?? "";
  if (p.tags !== undefined) o.tags = m.tags;
  if (p.notes !== undefined) o.notes = m.notes ?? "";
  if (p.favorite !== undefined) o.favorite = m.favorite;
  if (p.nsfw !== undefined) o.nsfw = m.nsfw;
  if (p.version !== undefined) o.version = m.version ?? "";
  return o;
}

/** Change details of some mods as one step with Undo. `patchOf` gives each mod's change, or null to leave it. */
export async function patchMods(game: GameId, list: ModEntry[], patchOf: (m: ModEntry) => MetaPatch | null, label: string): Promise<boolean> {
  const after: Array<[string, MetaPatch]> = [];
  const before: Array<[string, MetaPatch]> = [];
  for (const m of list) {
    const p = patchOf(m);
    if (!p || !Object.keys(p).length) continue;
    after.push([m.id, p]);
    before.push([m.id, oldValues(m, p)]);
  }
  if (!after.length) return false;
  const apply = async (rows: Array<[string, MetaPatch]>) => {
    const changed: ModEntry[] = [];
    for (const [id, p] of rows) changed.push(await library.updateMeta(game, id, p));
    publish(game, { changed, removed: [], notes: [] });
  };
  try {
    await apply(after);
    record({ label, undo: () => apply(before), redo: () => apply(after) });
    return true;
  } catch (e) { fail(e); return false; }
}

export function renameMod(game: GameId, m: ModEntry, name: string) {
  const n = name.trim();
  if (!n || n === m.name) return Promise.resolve(false);
  return patchMods(game, [m], () => ({ name: n }), `Renamed ${m.name} to ${n}`);
}

export function setCharacter(game: GameId, list: ModEntry[], name: string) {
  const n = name.trim();
  const same = (m: ModEntry) => (m.character ?? "").toLowerCase() === n.toLowerCase();
  return patchMods(game, list, (m) => (same(m) ? null : { character: n }),
    n ? `Set ${modsName(list)} to ${n}` : `Cleared the character of ${modsName(list)}`);
}

export function addTag(game: GameId, list: ModEntry[], tag: string) {
  const t = tag.trim();
  if (!t) return Promise.resolve(false);
  return patchMods(game, list, (m) => (m.tags.some((x) => x.toLowerCase() === t.toLowerCase()) ? null : { tags: [...m.tags, t] }),
    `Tagged ${modsName(list)} "${t}"`);
}

export function removeTag(game: GameId, list: ModEntry[], tag: string) {
  const t = tag.toLowerCase();
  return patchMods(game, list, (m) => (m.tags.some((x) => x.toLowerCase() === t) ? { tags: m.tags.filter((x) => x.toLowerCase() !== t) } : null),
    `Removed the tag "${tag}" from ${modsName(list)}`);
}

export function setFavourite(game: GameId, list: ModEntry[], on: boolean) {
  return patchMods(game, list, (m) => (m.favorite === on ? null : { favorite: on }),
    on ? `Added ${modsName(list)} to favourites` : `Removed ${modsName(list)} from favourites`);
}

export function setAdult(game: GameId, list: ModEntry[], on: boolean) {
  return patchMods(game, list, (m) => (m.nsfw === on ? null : { nsfw: on }),
    on ? `Marked ${modsName(list)} as for adults` : `Marked ${modsName(list)} as fine for everyone`);
}

// ── trash, export, files and links ──

export async function trashMods(game: GameId, list: ModEntry[]) {
  if (!list.length) return;
  try { await removeMods(game, list); } catch (e) { fail(e); }
}

/** Make several mods the parts of one mod (each part switches on or off in its details). */
export async function combineMods(game: GameId, list: ModEntry[]) {
  if (list.length < 2) return;
  try {
    const c = await library.merge(game, list.map((m) => m.id));
    publish(game, c);
    toast(notesText(c.notes), false, c.changed[0] ? { label: "View parts", run: () => openDetails(c.changed[0]!, "parts") } : undefined);
  } catch (e) { fail(e); }
}

export function exportMods(game: GameId, list: ModEntry[]) {
  if (list.length) emitApp({ type: "export-mods", game, modIds: list.map((m) => m.id) });
}

export function openFolder(m: ModEntry) { shell.openPath(m.path).catch(fail); }
export function openOnGb(m: ModEntry) { if (m.source) shell.openUrl(m.source.url).catch(fail); }

/** Open a mod's details: in place on a page that shows mods, else in Mods. */
export function openDetails(m: Pick<ModEntry, "id">, section?: DrawerSection) {
  drawerSection = section ? { id: m.id, section } : null;
  const r = currentRoute();
  if (r.view === "library" || (r.view === "characters" && r.character) || (r.view === "profiles" && r.profile !== undefined)) go({ ...r, modId: m.id });
  else go({ view: "library", modId: m.id });
}
/** A part of the drawer to scroll to when it opens: its parts, toggles, conflicts, files and size, or its 3D view. It stays until
 *  the drawer has scrolled there (clearDrawerSection), so an effect that runs twice still finds it. */
export type DrawerSection = "keys" | "conflicts" | "files" | "model" | "ingame" | "parts";
let drawerSection: { id: string; section: DrawerSection } | null = null;
export const drawerSectionFor = (id: string): DrawerSection | null => (drawerSection?.id === id ? drawerSection.section : null);
export function clearDrawerSection() { drawerSection = null; }

// ── GameBanana ──

/** Fetch the first picture of a mod's GameBanana page as its preview. */
export async function previewFromGb(game: GameId, m: ModEntry) {
  if (!m.source) return;
  try {
    const page = await modPage(m.source.modId);
    const img = page?.images[0];
    const url = img ? img.s800 ?? img.full ?? img.s530 : null;
    if (!url) { toast(`${m.name} has no pictures on GameBanana`); return; }
    const e = await library.fetchPreview(game, m.id, url);
    publish(game, { changed: [e], removed: [], notes: [] });
    toast(`Got a preview for ${m.name}`);
  } catch (e) { toast(`Couldn't get a preview. ${errorText(e)}`, true); }
}

/** A mod's preview changed: every screen shows the new picture. */
export function previewSaved(game: GameId, e: ModEntry) { previewChanged(e.preview); publish(game, { changed: [e], removed: [], notes: [] }); }

/** The user's own preview picture, read before it's replaced or reset so Undo can put it back. */
export async function ownPreview(game: GameId, m: ModEntry): Promise<{ bytes: Uint8Array; ext: string } | null> {
  if (!m.customPreview || !m.preview) return null;
  try {
    const bytes = new Uint8Array(await library.customPreview(game, m.id));
    const ext = m.preview.split(/[?#]/)[0]!.split(".").pop()?.toLowerCase() ?? "";
    return bytes.length ? { bytes, ext: ["png", "jpg", "jpeg", "webp", "gif"].includes(ext) ? ext : "png" } : null;
  } catch { return null; }
}

/** Go back to the picture the mod came with (from its folder or GameBanana). Undo puts the user's own one back. */
export async function resetPreview(game: GameId, m: ModEntry) {
  if (!m.customPreview) return;
  try {
    const own = await ownPreview(game, m);
    previewSaved(game, await library.clearPreview(game, m.id));
    const label = `Reset the preview of ${m.name}`;
    if (!own) { toast(label); return; }
    record({
      label,
      undo: async () => previewSaved(game, await library.setPreviewData(game, m.id, own.bytes, own.ext)),
      redo: async () => previewSaved(game, await library.clearPreview(game, m.id)),
    });
  } catch (e) { toast(`Couldn't reset the preview. ${errorText(e)}`, true); }
}

/** Check some mods for updates now, keeping the marks on the others. */
export async function checkForUpdates(game: GameId, list: ModEntry[]) {
  const withSource = list.filter((m) => m.source);
  if (!withSource.length) { toast("Only mods from GameBanana can be checked"); return; }
  try {
    const found = new Set(await checkUpdates(withSource));
    const all = await library.list(game);
    const asked = new Set(withSource.map((m) => m.id));
    const marks = all.filter((m) => (asked.has(m.id) ? found.has(m.id) : m.updateAvailable)).map((m) => m.id);
    await library.markUpdates(game, marks);
    emitApp({ type: "library-refresh", game });
    const hits = withSource.filter((m) => found.has(m.id));
    if (!hits.length) toast(withSource.length === 1 ? `${withSource[0]!.name} is up to date` : "They're all up to date");
    else toast(`${hits.length === 1 ? `${hits[0]!.name} has` : `${hits.length} mods have`} an update`, false,
      { label: "Get it", run: () => void Promise.all(hits.map((m) => getUpdate(game, m))) });
  } catch (e) { fail(e); }
}

export async function getUpdate(game: GameId, m: ModEntry) {
  if (!m.source) return;
  try {
    const item = await queueLatest(game, m.source.modId, m.id);
    if (item) toast(`Downloading the update for ${m.name}`, false, { label: "Downloads", run: () => go("downloads") });
    else toast(`Couldn't find a newer file for ${m.name} on GameBanana`, true);
  } catch (e) { fail(e); }
}

// ── fixes and keys ──

/** Swap the outdated hashes of these mods (lib/fixes.ts says what happened, with Undo). */
export async function fixForUpdate(game: GameId, list: ModEntry[]) {
  try { await fixMods(game, list.map((m) => m.id)); } catch (e) { fail(e); }
}

type OnlyOnScreen = (game: GameId, ids: string[]) => Promise<unknown>;
/** "Keys only while on screen" from the KEYBINDS area, once it exists (modKeys.onlyOnScreen). It writes the inis with
 *  a backup and records its own Undo. */
export function onlyOnScreenFn(): OnlyOnScreen | null {
  const mk = Reflect.get(modtoolsApi, "modKeys") as { onlyOnScreen?: OnlyOnScreen } | undefined;
  return typeof mk?.onlyOnScreen === "function" ? mk.onlyOnScreen.bind(mk) : null;
}
export async function keysOnlyOnScreen(game: GameId, list: ModEntry[]) {
  const fn = onlyOnScreenFn();
  if (!fn) return;
  try { await fn(game, list.map((m) => m.id)); } catch (e) { fail(e); }
}

// ── profiles ──

/** Put mods in a profile or take them out, with Undo. The active profile follows what is on, so for it this turns
 *  them on or off. Another profile is switched to and back (each switch saves the profile it leaves, so nothing on
 *  screen or in any profile is lost). */
export async function setInProfile(game: GameId, p: Profile, list: ModEntry[], on: boolean) {
  const label = on ? `Added ${modsName(list)} to ${p.name}` : `Took ${modsName(list)} out of ${p.name}`;
  try {
    if (p.active) {
      const ids = list.map((m) => m.id);
      await changeStates(game, label, on ? ids : [], on ? [] : ids, await library.list(game));
      profilesChanged(game);
      return;
    }
    const members = new Set(await profiles.members(p.id));
    const ids = list.filter((m) => members.has(m.id) !== on).map((m) => m.id);
    if (!ids.length) { toast(on ? `Already in ${p.name}` : `Not in ${p.name}`); return; }
    const inside = async (states: Array<[string[], boolean]>) => {
      const from = (await profiles.list(game)).find((x) => x.active);
      await profiles.activate(p.id);
      const changed: string[] = [];
      try {
        for (const [part, want] of states) if (part.length) changed.push(...(await library.setEnabled(game, part, want)).changed.map((m) => m.id));
      } finally {
        if (from && from.id !== p.id) await profiles.activate(from.id);
        emitApp({ type: "library-refresh", game });
        profilesChanged(game);
      }
      return changed;
    };
    const touched = await inside([[ids, on]]);
    const all = [...new Set([...ids, ...touched])];
    const back: Array<[string[], boolean]> = [[all.filter((id) => !members.has(id)), false], [all.filter((id) => members.has(id)), true]];
    record({ label, undo: () => inside(back), redo: () => inside([[ids, on]]) });
  } catch (e) { fail(e); }
}

// ── profile lists for menus (menus are built at once, so they read what was loaded last) ──

const profileCache = new Map<GameId, { list: Profile[]; members: Map<number, Set<string>>; at: number }>();
const loading = new Set<GameId>();
export function warmProfiles(game: GameId, force = false) {
  const c = profileCache.get(game);
  if (loading.has(game) || (!force && c && Date.now() - c.at < 10_000)) return;
  loading.add(game);
  (async () => {
    const list = await profiles.list(game);
    const members = new Map<number, Set<string>>();
    for (const p of list) members.set(p.id, new Set(await profiles.members(p.id)));
    profileCache.set(game, { list, members, at: Date.now() });
  })().catch(() => {}).finally(() => loading.delete(game));
}
export function cachedProfiles(game: GameId) { warmProfiles(game); return profileCache.get(game) ?? null; }
