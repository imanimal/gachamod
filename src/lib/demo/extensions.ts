// Demo handlers for extensions: one repo with the example packages from extensions-repo/ plus a sample that works
// with another app, "Character notes" installed (an older version, so it shows an update), and pages served as one
// HTML string with the bridge inlined. Owner: EXTENSIONS area.
import { registerDemo } from "../tauri";
import { DEFAULT_EXT_SOURCE, type AppStatus, type ExtManifest, type IndexEntry, type InstalledExt } from "../api/extensions";
import bridge from "../extension-bridge.js?raw";
import notesManifest from "../../../extensions-repo/packages/character-notes/extension.json";
import notesHtml from "../../../extensions-repo/packages/character-notes/notes.html?raw";
import notesJs from "../../../extensions-repo/packages/character-notes/notes.js?raw";
import notesCss from "../../../extensions-repo/packages/character-notes/notes.css?raw";
import notesIcon from "../../../extensions-repo/packages/character-notes/icon.svg?url";
import sakuraManifest from "../../../extensions-repo/packages/sakura-night/extension.json";
import sakuraTheme from "../../../extensions-repo/packages/sakura-night/theme.json";
import sakuraIcon from "../../../extensions-repo/packages/sakura-night/icon.svg?url";

const blank = { format: 1, homepage: null, icon: null, app: null, games: [], themes: [], characterTab: null, page: null,
  permissions: { library: false, player: false, net: [], files: [] }, needs: [] };
const manifestOf = (m: { permissions?: object; [k: string]: unknown }): ExtManifest =>
  ({ ...blank, ...m, permissions: { ...blank.permissions, ...m.permissions } } as unknown as ExtManifest);

const sampleHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
main{display:grid;gap:10px;max-width:46rem;padding:2px 2px 12px}p{margin:0;color:var(--text-2)}
button{justify-self:start;padding:8px 14px;border-radius:var(--radius-sm);border:0;background:var(--accent);color:var(--on-accent);cursor:pointer}
</style></head><body><main><p id="t">Looking for the companion app...</p><button id="b" hidden></button></main><script>
const t = document.getElementById("t"), b = document.getElementById("b");
async function show(ctx) {
  const [app] = await gachamod.apps();
  if (!app.installed) {
    t.textContent = "Once " + app.name + " is installed, this tab shows " + (ctx.character ? ctx.character.name + "'s" : "your") + " build from it and what to change.";
    b.hidden = true;
  } else {
    t.textContent = app.name + " is installed."; b.textContent = "Open " + app.name; b.hidden = false; b.onclick = () => gachamod.openApp(app.name);
  }
}
if (gachamod.context) show(gachamod.context);
gachamod.on("context", show);
</script></body></html>`;

interface Pkg { manifest: ExtManifest; files: Record<string, string>; icon: string | null; themes: unknown[] }
const CATALOG: Record<string, Pkg> = {
  "character-notes": {
    manifest: manifestOf(notesManifest), icon: notesIcon, themes: [],
    files: { "notes.html": notesHtml, "notes.js": notesJs, "notes.css": notesCss },
  },
  "sakura-night": { manifest: manifestOf(sakuraManifest), icon: sakuraIcon, themes: [sakuraTheme], files: {} },
  "build-check": {
    manifest: manifestOf({
      id: "build-check", name: "Build check (sample)", version: "0.1.0", author: "gachamod",
      description: "A sample of an extension that works with another app: it adds a Build tab to character pages and asks you to install the companion app first.",
      characterTab: { title: "Build", entry: "build.html" },
      permissions: { library: true, player: false, net: ["http://127.0.0.1:47900"], files: [] },
      needs: [{ name: "Companion app", url: "https://example.com", paths: ["%LOCALAPPDATA%\\Programs\\Companion\\companion.exe"], running: "http://127.0.0.1:47900/ping", open: "companion://", required: true }],
    }),
    icon: null, themes: [], files: { "build.html": sampleHtml },
  },
};

const daysAgo = (d: number) => Math.floor(Date.now() / 1000) - d * 86400;
const entryOf = (p: Pkg, version = p.manifest.version, updated = daysAgo(30)): IndexEntry => ({
  id: p.manifest.id, name: p.manifest.name, version, kind: p.manifest.characterTab || p.manifest.page ? "extension" : "theme",
  author: p.manifest.author, description: p.manifest.description, games: p.manifest.games, homepage: null, icon: p.icon, preview: null,
  download: `https://example.invalid/${p.manifest.id}-${version}.zip`, sha256: "0".repeat(64), size: 2048 + Object.values(p.files).join("").length,
  updated, app: null, permissions: p.manifest.permissions, needs: p.manifest.needs.map((n) => ({ name: n.name, url: n.url ?? null, required: n.required })),
});
const LISTED: IndexEntry[] = [
  entryOf(CATALOG["character-notes"]!, "1.1.0", daysAgo(2)),
  entryOf(CATALOG["sakura-night"]!, "1.0.0", daysAgo(12)),
  entryOf(CATALOG["build-check"]!),
];

interface Inst { manifest: ExtManifest; enabled: boolean; source: string | null; at: number }
const installed = new Map<string, Inst>([
  ["character-notes", { manifest: CATALOG["character-notes"]!.manifest, enabled: true, source: DEFAULT_EXT_SOURCE, at: Math.floor(Date.now() / 1000) - 86400 * 9 }],
]);
const trash = new Map<string, Inst>();
const storage = new Map<string, Record<string, unknown>>();

const view = (id: string, i: Inst): InstalledExt => ({
  id, manifest: i.manifest, kind: i.manifest.characterTab || i.manifest.page ? "extension" : "theme", enabled: i.enabled,
  dir: `C:\\Users\\Player\\AppData\\Roaming\\app.gachamod.desktop\\extensions\\${id}`, source: i.source, installedAt: i.at,
  linked: false, icon: CATALOG[id]?.icon ?? null, problem: null,
});
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fail = (message: string) => { throw { kind: "invalid", message }; };
const toTrash = (id: string): string | null => {
  const i = installed.get(id);
  if (!i) return null;
  const key = `${id}~${Date.now()}`;
  trash.set(key, i);
  installed.delete(id);
  return key;
};

/** A page as one HTML string: its CSS and scripts inlined and the bridge first. */
function pageHtml(id: string, entry: string): string {
  const files = CATALOG[id]?.files ?? {};
  let html = files[entry] ?? fail("That page isn't in the package");
  html = html.replace(/<link\s+rel="stylesheet"\s+href="([^"]+)"\s*\/?>/g, (all, f: string) => (files[f] !== undefined ? `<style>${files[f]}</style>` : all));
  html = html.replace(/<script\s+src="([^"]+)"\s*><\/script>/g, (all, f: string) => (files[f] !== undefined ? `<script>${files[f]}</script>` : all));
  const tag = `<script>${bridge}</script>`;
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (h) => h + tag) : tag + html;
}

export function registerExtensionsDemo() {
  registerDemo({
    extensions_list: () => [...installed].map(([id, i]) => view(id, i)).sort((a, b) => a.manifest!.name.localeCompare(b.manifest!.name)),
    extensions_repos: async () => {
      await wait(350);
      return [{ source: DEFAULT_EXT_SOURCE, name: "gachamod extensions", submit: "https://github.com/imanimal/gachamod-extensions/issues/new?template=submit.yml",
        packages: LISTED, error: null, fetchedAt: Math.floor(Date.now() / 1000) }];
    },
    extensions_install: async ({ source, entry }) => {
      const e = entry as IndexEntry;
      const p = CATALOG[e.id] ?? fail("That package isn't in the demo");
      await wait(500);
      const replaced = toTrash(e.id);
      const before = replaced ? trash.get(replaced) : undefined;
      installed.set(e.id, { manifest: { ...p.manifest, version: e.version }, enabled: before?.enabled ?? true, source: String(source), at: Math.floor(Date.now() / 1000) });
      return { extension: view(e.id, installed.get(e.id)!), replaced };
    },
    extensions_install_file: () => fail("Installing from a file works in the app"),
    extensions_link_folder: () => fail("Linking a folder works in the app"),
    extensions_remove: ({ id }) => toTrash(String(id)),
    extensions_restore: ({ key }) => {
      const i = trash.get(String(key)) ?? fail("That copy is gone from the trash");
      const id = String(key).split("~")[0]!;
      const replaced = toTrash(id);
      trash.delete(String(key));
      installed.set(id, i);
      return { extension: view(id, i), replaced };
    },
    extensions_set_enabled: ({ id, on }) => { const i = installed.get(String(id)); if (i) i.enabled = !!on; },
    extensions_themes: ({ id }) => CATALOG[String(id)]?.themes ?? [],
    extensions_needs: ({ id }) => (installed.get(String(id))?.manifest.needs ?? []).map((n): AppStatus => (
      { name: n.name, url: n.url ?? null, required: n.required, installed: false, path: null, running: n.running ? false : null, canOpen: false })),
    extensions_open_app: () => fail("That app isn't installed"),
    extensions_fetch: () => fail("The demo doesn't call other sites for extensions"),
    extensions_read_file: () => fail("The demo can't read files"),
    extensions_list_dir: () => fail("The demo can't read folders"),
    extensions_storage_get: ({ id }) => storage.get(String(id)) ?? {},
    extensions_storage_set: ({ id, key, value }) => {
      const s = { ...(storage.get(String(id)) ?? {}) };
      if (value === null || value === undefined) delete s[String(key)]; else s[String(key)] = value;
      storage.set(String(id), s);
    },
    extensions_pack_folder: () => fail("Making a package works in the app"),
    extensions_pack_theme: () => fail("Saving a package works in the app"),
    extensions_page_html: ({ id, entry }) => pageHtml(String(id), String(entry)),
  });
}
