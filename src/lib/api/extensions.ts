// Extensions and themes from repos or files, and the calls extension pages make. Owner: EXTENSIONS area.
// Rust: crates/gacha-core/src/extensions.rs, src-tauri/src/commands/extensions.rs. Format: docs/extensions.md.
import { call, inTauri } from "../tauri";

export interface ExtPermissions {
  /** Read the mods, characters and owned characters of the game on screen. */
  library: boolean;
  /** Read the GameBanana name (title and UID are from older versions and usually empty). */
  player: boolean;
  /** Web origins it may call through gachamod. */
  net: string[];
  /** Folders it may read, like "%LOCALAPPDATA%\\Some App\\exports". */
  files: string[];
}

export interface ExtSlot { title: string; entry: string; icon?: string | null }

export interface NeededApp {
  name: string;
  url?: string | null;
  paths: string[];
  uninstallName?: string | null;
  running?: string | null;
  open?: string | null;
  required: boolean;
}

export interface ExtManifest {
  format: number;
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  homepage?: string | null;
  icon?: string | null;
  app?: string | null;
  games: string[];
  themes: string[];
  characterTab?: ExtSlot | null;
  page?: ExtSlot | null;
  permissions: ExtPermissions;
  needs: NeededApp[];
}

export type ExtKind = "theme" | "extension";

export interface InstalledExt {
  id: string;
  /** Null when `problem` says why it can't be used. */
  manifest: ExtManifest | null;
  kind: ExtKind;
  enabled: boolean;
  dir: string;
  /** The repo list it came from; null for a file. */
  source: string | null;
  installedAt: number;
  /** A folder used where it is, for making a package. */
  linked: boolean;
  /** The icon file's full path. */
  icon: string | null;
  problem: string | null;
}

export interface ExtInstallResult { extension: InstalledExt; replaced: string | null }

export interface IndexEntry {
  id: string;
  name: string;
  version: string;
  kind: ExtKind;
  author: string;
  description: string;
  games: string[];
  homepage?: string | null;
  icon?: string | null;
  preview?: string | null;
  download: string;
  sha256: string;
  size: number;
  updated: number;
  app?: string | null;
  permissions: ExtPermissions;
  needs: Array<{ name: string; url?: string | null; required: boolean }>;
}

export interface ExtRepo {
  source: string;
  name: string;
  /** Where people send a package to be listed. */
  submit: string | null;
  packages: IndexEntry[];
  /** Why the list couldn't be fetched (an older copy may still be shown). */
  error: string | null;
  fetchedAt: number;
}

export interface AppStatus {
  name: string;
  url: string | null;
  required: boolean;
  installed: boolean;
  path: string | null;
  /** Null when the package gives no way to tell. */
  running: boolean | null;
  canOpen: boolean;
}

export interface ExtFetchRequest { url: string; method?: string; headers?: Record<string, string>; body?: string }
export interface ExtFetchResponse { status: number; contentType: string | null; body: string }
export interface ExtDirEntry { name: string; dir: boolean; size: number; modified: number }
export interface Packed { path: string; id: string; name: string; version: string; size: number; sha256: string }
export interface ThemeMeta { id: string; name: string; version?: string; author: string; description?: string; games?: string[] }

/** gachamod's own repo; more are added in Settings (setting "extensions.sources"). */
export const DEFAULT_EXT_SOURCE = "https://raw.githubusercontent.com/imanimal/gachamod-extensions/main/index.json";

export const extensions = {
  list: () => call<InstalledExt[]>("extensions_list"),
  /** Every repo's list (kept 6 hours unless `refresh`). */
  repos: (refresh = false) => call<ExtRepo[]>("extensions_repos", { refresh }),
  install: (source: string, entry: IndexEntry) => call<ExtInstallResult>("extensions_install", { source, entry }),
  /** A package .zip, or a copy of a package folder. */
  installFile: (path: string) => call<ExtInstallResult>("extensions_install_file", { path }),
  /** Use a package folder where it is (for making one). */
  linkFolder: (path: string) => call<InstalledExt>("extensions_link_folder", { path }),
  /** Returns the trash key `restore` takes; null for an unlinked folder. */
  remove: (id: string) => call<string | null>("extensions_remove", { id }),
  restore: (key: string) => call<ExtInstallResult>("extensions_restore", { key }),
  setEnabled: (id: string, on: boolean) => call<void>("extensions_set_enabled", { id, on }),
  themes: (id: string) => call<unknown[]>("extensions_themes", { id }),
  needs: (id: string) => call<AppStatus[]>("extensions_needs", { id }),
  openApp: (id: string, name: string) => call<void>("extensions_open_app", { id, name }),
  fetch: (id: string, req: ExtFetchRequest) => call<ExtFetchResponse>("extensions_fetch", { id, req }),
  readFile: (id: string, path: string) => call<string>("extensions_read_file", { id, path }),
  listDir: (id: string, path: string) => call<ExtDirEntry[]>("extensions_list_dir", { id, path }),
  storageGet: (id: string) => call<Record<string, unknown>>("extensions_storage_get", { id }),
  storageSet: (id: string, key: string, value: unknown) => call<void>("extensions_storage_set", { id, key, value: value ?? null }),
  packFolder: (folder: string, out: string) => call<Packed>("extensions_pack_folder", { folder, out }),
  packTheme: (theme: unknown, meta: ThemeMeta, out: string) => call<Packed>("extensions_pack_theme", { theme, meta, out }),
  /** Where a page loads from: the gmext scheme in the app; in the browser demo, the page as one HTML string. */
  async pageSource(id: string, entry: string): Promise<{ url: string } | { html: string }> {
    if (!inTauri()) return { html: await call<string>("extensions_page_html", { id, entry }) };
    const path = entry.split("/").map(encodeURIComponent).join("/");
    const windows = /windows/i.test(navigator.userAgent);
    return { url: windows ? `http://gmext.localhost/${id}/${path}` : `gmext://localhost/${id}/${path}` };
  },
};
