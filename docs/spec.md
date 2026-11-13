# gachamod spec

gachamod is a Windows mod manager for gacha games that load mods through a 3DMigoto model importer (GIMI, SRMI,
ZZMI, WWMI, HIMI, EFMI and community 3DMigoto loaders). Mods come from GameBanana. It works with XXMI Launcher instead
of replacing it. Facts about the games, GameBanana's API, XXMI and IMM are in `docs/research.md`; read the parts your
area needs before writing code.

Stack: Tauri 2 (Rust) + React 19 + TypeScript + Vite. `crates/gacha-core` holds all logic (no UI). `src-tauri` is a
thin command layer. `src` is the UI. The UI runs in a plain browser with a demo backend (`npm run dev`, then open
http://localhost:1420) so screens can be built without Tauri.

## Product rules (every area)

- The common case is one click. Nothing asks a question it can answer itself. No modal where a toast will do.
  Changes that can be undone just happen and offer Undo (`lib/history.ts` `record()`); only things that can't be
  undone ask (`Confirm` in the kit).
- Anything unclear gets a hover tip (`title`). Icon-only buttons always have one (`IconButton` takes `label`).
- Every action works with mouse and keyboard. Lists and grids are reachable with Tab and arrow keys; the gamepad
  helper moves focus between focusable elements, so use real `<button>`s.
- Consistency: every screen starts with `PageHeader`, uses kit components and kit classes, and only theme tokens for
  colour (never a hex value in a screen's CSS). Screen CSS lives next to the screen (`screens/<area>/<name>.css`,
  imported by the screen) and only does layout.
- Advanced options exist for tinkerers but sit out of the way (a "More" section, a Tools screen).
- Nothing destructive happens to user files without a way back: removed mods go to the app's trash for 14 days;
  config files get a backup before the first write of a session.

## Writing rules (all UI text, docs, comments, commit text)

Plain, short, specific. Sentence case. No em dashes (use a period, comma, colon or parentheses). No stock words
(seamless, effortless, robust, leverage, unlock, empower, elevate, streamline, supercharge, delve, journey, navigate,
embrace, crucial, cutting-edge, game-changer, revolutionize, pivotal, tapestry, landscape). No "Whether you're",
"Say goodbye to", "It's not just X", "Imagine", "Designed to", "Built for". No tagline fragments ("Fast. Simple.").
Say what a thing does with a concrete example. Never put personal
names, email addresses or `C:\Users\<name>` paths in code, docs or test data (use `%APPDATA%`, `Player`).

## Areas and file ownership

The code is split into five areas. Each owns the files below.

| Area | Rust (crates/gacha-core/src) | Tauri (src-tauri/src) | UI (src) |
|---|---|---|---|
| LIBRARY | library.rs, profiles.rs | commands/library.rs, commands/profiles.rs | lib/api/library.ts, lib/demo/library.ts, screens/library/*, screens/characters/*, screens/profiles/* |
| MODTOOLS | ini.rs, pack.rs, imm.rs | commands/modtools.rs | lib/api/modtools.ts, lib/demo/modtools.ts, screens/modtools/* |
| ONLINE | install.rs, queue.rs | commands/online.rs, runner.rs | lib/api/online.ts, lib/demo/online.ts, lib/gamebanana.ts, screens/browse/*, screens/downloads/* |
| SYSTEM | games.rs, xxmi.rs, launch.rs, devtools.rs, platform.rs | commands/system.rs | lib/api/system.ts, lib/demo/system.ts, screens/home/*, screens/tools/*, screens/settings/* |
| THEME | none | none | styles/** (fonts, base, kit, shell, themes), lib/theme.ts, ui/GameBadge.tsx markup, public/ assets for themes |

Shared files (the skeleton's; change only by appending, and only when you must): `crates/gacha-core/src/model.rs`
(shared types), `src/lib/api/types.ts` (their TS twins), `src-tauri/src/lib.rs` (add a new command only inside your
area's block of `generate_handler!`, using Edit, never rewriting the file), `src/lib/demo/db.ts` (demo data),
`src/ui/kit.tsx` (THEME may change markup and add decoration; props stay), `src/App.tsx`, `src/lib/store.ts`.
Cargo.toml dependencies: add a crate to `crates/gacha-core/Cargo.toml` with Edit, one line, only if needed.


## Shared contract

- Types crossing to the UI are camelCase JSON (`#[serde(rename_all = "camelCase")]`). Each Rust type has a TS twin
  with the same field names in `src/lib/api/*.ts`. Change both together.
- Errors: `gacha_core::Error` serialises as `{ kind, message }`. The UI shows `errorText(e)` in a toast. Messages are
  written for players ("Close the game first, then try again"), never raw debug text.
- Commands run blocking work through `state::blocking`. Long file work (scan, install, pack import/export, IMM move)
  takes `&db::Shared` and locks only around row reads and writes, never during big copies.
- Events (model.rs `events`): `library-changed {game}`, `queue` (QueueSnapshot), `variants-needed`, `game-state
  {game, running}`, `deep-link {url}`, `open-file {path}`, `toast {text, bad}`, `pack-progress {done, total}`.
- UI cross-area events (lib/store.ts `emitApp` / `onApp`): `open-pack {path}` (MODTOOLS opens its import window),
  `install-paths {paths}` (ONLINE installs dropped archives/folders into the current game), `export-mods {game,
  modIds}` and `export-profile {game, profileId}` (MODTOOLS opens its export window), `open-gb-link {url}` (ONLINE
  opens that GameBanana mod in Browse, or queues the file for gachamod:// links), `library-refresh {game}` (LIBRARY
  reloads its list; ONLINE and MODTOOLS emit it after they add mods).
- Navigation: `go({ view, modId?, character?, search?, section? })` from lib/store.ts. Library opens the drawer of
  `modId` (a library id); Browse opens GameBanana mod `modId` (a number); `character` filters both; Settings and
  Tools scroll to the element with id `section`.
- Nav badges: `setBadge(view, { count, tone })`. LIBRARY sets "library" to the number of mods with updates. ONLINE
  sets "downloads" (running: tone "run"; finished with failures: tone "bad"). MODTOOLS sets "tools" to the number of
  enabled-mod conflicts plus problems (tone "bad").
- Current game: `useGame()`; switching games re-mounts the view (App keys `main.view` by game and view).
- Settings: small strings via `settings.get/set` (UI) or `Db::setting` (Rust). Key names are dotted and per game when
  per game: `"<game>.oneSkin"`, `"ui.nsfw"`, `"player"` (JSON), `"xxmi.root"`, `"<game>.launch"` (JSON).

## Mods on disk

- A game's Mods folder comes only from `games::mods_dir(db, game)` (importer folder: `games::importer_dir`).
- A mod is a folder under Mods. It is off when its name starts with `DISABLED` (3DMigoto's d3dx.ini has
  `exclude_recursive = DISABLED*`, case-insensitive, at every level). gachamod writes the prefix `DISABLED ` (with a
  space) and reads any case and separator (`library::display_folder`, `library::is_disabled_name`).
- Each mod folder holds `.gachamod.json` (model::Sidecar): a stable 32-hex id, display name, character, GameBanana
  source, version, install time, tags, notes, favourite, nsfw, preview file. Folders without one are adopted on scan
  (sidecar written, name from the folder, character guessed). Moving or renaming a folder never loses the id.
- New installs go to `Mods/<Character>/<Mod name>` when the character is known, else `Mods/<GameBanana category or
  "Other">/<Mod name>`. Existing mods stay where they are.
- Saved mod variables live in `<importer>/d3dx_user.ini` as `$\mods\<path of the .ini relative to Mods, lowercased,
  backslashes>\<var> = <value>` (exact format: docs/research.md section 3). Renaming a mod folder orphans them, so
  every rename or move calls `ini::move_user_vars(importer_dir, from_rel, to_rel)` (MODTOOLS implements; LIBRARY,
  ONLINE and MODTOOLS call it).
- Writing d3dx_user.ini while the game runs is pointless (3DMigoto rewrites it). Check `launch::running(game)`
  and return `Error::GameRunning`, or hold the write and say so.
- Preview images: `preview.(png|jpg|jpeg|webp|gif)` in the mod root wins; else the sidecar's `preview` (a file name
  in the folder or a URL); else the first image file in the mod root. `ModEntry.preview` is an absolute path or URL;
  the UI shows paths through `fileUrl()` (lib/api/common.ts, Tauri asset protocol).

### Finding mods (library::scan, install::find_roots)

Walk the tree from the root (Mods, or a staging folder). Skip `desktop.ini`, `.git`, `ShaderFixes`, `ShaderCache`,
and folders gachamod or IMM manage for themselves only as noted below.
1. A folder with `.gachamod.json` is a mod. Stop there.
2. A folder that directly holds at least one `*.ini` file (not `desktop.ini`) is a mod. Stop there. (A mod may hold
   sub-mods; they belong to it.)
3. Otherwise, if exactly one child folder (and only junk files like readme.txt, images, .url) leads to inis, the
   folder is a wrapper: the mod is that folder (keep the outer name when the inner name is generic like "mod",
   "Mods", "files" or equal to the outer one).
4. Otherwise the folder is a group (a character folder like "Ellen Joe", or GIMI's "character", "npc", "weapon"
   categories); recurse into each child.
At the Mods root, IMM's own folders "DISABLED - ALL MODS ARE STORED HERE (Managed by IMM)" and "DO NOT MODIFY
(Managed by IMM)" are groups (their mods count; MODTOOLS offers to move them out). A mod's `group` is its parent
folder relative to Mods (None at the top level). A group's name that matches a character makes that the mod's
character when the sidecar has none.

## Library (LIBRARY)

Rust: `library.rs` and `profiles.rs` as stubbed. Notes:
- scan: walk, adopt, upsert the `mods` table (data = ModEntry JSON), delete rows whose folders are gone, fill
  `size_bytes`, `file_count`, `ini_count` and `has_keys`/`conflicts` from `ini::quick_facts` (MODTOOLS; a stub
  returns defaults until then; compute conflicts by counting other enabled mods sharing any hash from quick_facts).
  Emits nothing itself (commands return the list). Must handle 1,000+ mods in under 2 seconds on an SSD: don't hash
  files, read inis only through quick_facts.
- set_enabled: rename `X` to `DISABLED X` and back; if the target name exists, add " (2)". Move the saved variables
  (ini::move_user_vars) so turning a mod off and on keeps its options. One skin per character: setting
  `"<game>.oneSkin"` (default "1"); when turning on a mod with a character, turn off the other enabled mods with the
  same character and say so in `notes` ("Turned off Coca Cola (Ellen Joe)"). Afterwards call
  `profiles::on_change`.
- update_meta writes the sidecar and the row. Changing `character` does not move the folder.
- move_to_group moves the folder (and saved vars), creating the group folder; removes the old group folder if empty.
- remove: move the folder to `<data>/trash/<game>/<trash id>/`; `trash` row; restore puts it back at its original
  relative path (or with " (2)"). Purge removes for good; purge(None) clears entries older than 14 days (call it at
  startup from the Library screen, once per session, quietly).
- characters_sync: replace the game's `characters` rows (keep order as `sort`). characters(): every character row
  with counts, plus characters that only appear on mods (no icon), sorted by enabled mods then name.
- infer_character: case- and punctuation-insensitive match of any hint against character names and their parts
  ("Ellen Joe" matches "ellen", "EllenJoe", "ellen_joe_bunny"); prefer the longest match; ignore matches of 3
  letters or less unless exact.
- Profiles: see the module doc in profiles.rs. Creating the first profile "Default" happens in `list`. Activate does:
  capture the outgoing profile's vars (ini::user_vars for each mod it has on), set enabled states to match the
  incoming profile (mods not in the profile's rows keep their current state only if they were installed after the
  profile was last updated; otherwise off), write the incoming vars (unless the game runs: `vars_pending`), mark
  active. Mods added while a profile is active join it enabled.

UI:
- `screens/library/Library.tsx` (view "library", label "Mods"): header with search, filter chips (All, On, Off,
  Updates, Favourites, Problems), character chip row with portraits (from characters.list), sort (Recently added, Name,
  Character, Size), grid/list toggle (remember in localStorage). Mod cards: preview image (blur when nsfw and setting
  "ui.nsfw" is "blur"; hidden when "hide"), name, character, a Toggle that turns the mod on/off immediately (with Undo
  through history.record), badges (Update, Conflict, Keys), a "..." menu (Open folder, Move to character, Export as
  .gachamod: `emitApp({type:"export-mods"})`, Open on GameBanana, Remove). Multi-select with Ctrl/Shift click and a
  bulk bar (Turn on, Turn off, Export, Remove). "Rescan" button and an automatic scan when the screen opens if the
  last scan is over 30 seconds old. Empty state explains where mods come from (Browse, or drop an archive).
- Mod drawer (`Drawer` from the kit) on card click: big preview, name (editable inline), character picker (combobox
  over characters), tags, notes, source link, version, size, folder path with Open, then `<ModInsides mod={mod} />`
  from `screens/modtools/ModInsides.tsx` (MODTOOLS fills it), then Remove. Opens directly for `route.modId`.
- Update check: on open (and every 30 min while open) call `checkUpdates(mods)` from lib/gamebanana.ts (ONLINE
  provides it; until then it returns []), then `library.markUpdates`. An Update badge's button queues the newest file
  with `meta.replaces` set (ONLINE's `queueModFile` helper in lib/gamebanana.ts, see ONLINE).
- `screens/characters/Characters.tsx` (view "characters"): a roster grid of character portraits (GameBanana icons
  via characters.list; characters with mods first). Each tile shows the active skin's preview behind the portrait
  and a count. Selecting a character opens a side panel: its installed skins as a carousel (click one to make it the
  only enabled skin: one click "Wear"), "Default outfit" (turn all off), and "Find more" (go to Browse filtered to
  that character). On first open, if characters are empty, fetch the list with `characterList(game)` from
  lib/gamebanana.ts and call `characters.sync`.
- `screens/profiles/Profiles.tsx` (view "profiles"): profile cards with banner image, icon (emoji or character
  portrait), colour stripe, name, description, mod count, active marker. Actions: Switch to, Edit (name, icon picker
  with emoji grid and character portraits, colour swatches plus custom, banner from a mod preview, a GameBanana image
  URL or a local file, description), Duplicate, Save current state (capture), Export (emitApp export-profile),
  Delete. "New profile" starts from what is on now. Switching shows a toast with what changed and Undo (switch back).
- `screens/profiles/ProfileSwitch.tsx`: compact switcher in the sidebar under the player card (active profile icon,
  name, chevron; a Popover listing profiles with their colours; "Manage profiles" goes to the view).
- Demo (`lib/demo/library.ts`): seed ~24 believable mods for "zzz" (Ellen Joe, Miyabi, Jane Doe, Zhu Yuan, Burnice,
  Yanagi, Astra Yao, Evelyn ...), ~12 for "gi", ~8 for "ww", with GameBanana-style preview URLs from
  images.gamebanana.com where you can find real ones through the API, or none; characters with real GameBanana
  category icons (fetch once with the API while writing the demo and paste the URLs); two profiles per game.

## Mod internals, .gachamod and IMM (MODTOOLS)

Rust `ini.rs`:
- Parse 3DMigoto ini syntax leniently: `[Section]`, `key = value`, `;` comments, `namespace = x` at the top,
  `global persist $var = 0` in [Constants], `[Key*]` sections (key, back, type, condition, `$var = 0,1,2`),
  `[TextureOverride*]` / `[ShaderOverride*]` sections with `hash = xxxxxxxx`, `[Resource*]` sections with
  `filename = path` (relative to the ini). Skip inis named `DISABLED*` and anything under a `DISABLED*` folder.
  Handle UTF-8 with or without BOM and UTF-16 LE (some mods ship it); never panic on bad input.
- quick_facts: ini count, has_keys (any Key section with key=), the TextureOverride hashes. Fast.
- inspect: keys with readable labels ("ctrl alt VK_UP" -> "Ctrl+Alt+Up", "no_modifiers x" -> "X", "VK_NUMPAD1" ->
  "Num 1", XB_ buttons -> "Pad A"), vars with current values from d3dx_user.ini and the values the key steps
  through, label guessed from the var name (`swapvar` -> "Swap", "jacket" -> "Jacket") or the key section name
  (`[KeyJacket]` -> "Jacket"), problems (missing Resource files, unreadable inis, no inis), conflicts (other enabled
  mods sharing hashes), readmes (txt/md files under 64 KB in the mod root, first 8 KB).
- d3dx_user.ini read/write per research section 3: keep all other lines exactly; write a backup
  `d3dx_user.ini.gachamod.bak` before the first write of a session; values formatted like 3DMigoto (%.9g: "1", "0.5").
- conflicts: group enabled mods by shared hashes. Ignore hashes that 5 or more enabled mods share (common shared
  buffers, often UI or effects). Include the character when all mods in a group share one.
- lint: problems for every mod (missing files, bad inis, duplicate hashes inside one mod is fine, skip it).
- hash_lookup: which mods (on or off) mention a hash, any case, with or without 0x.
`pack.rs` (.gachamod): a zip (deflate, level 6 for speed on big mods; zip64 on) with `gachamod.json` (Manifest) first
and each mod under `mods/<n>/` with its sidecar. Exports never include `DISABLED` prefixes in stored paths (state
is in the manifest). Include the profile banner under `media/` when it is a local file. Import: validate the
manifest
(format 1; an unknown higher format is an error with a clear message), refuse entries that escape their folder
(archive::safe_relative), extract each chosen mod to staging then move into Mods at its rel_path (DISABLED prefix
when not enabled; " (2)" on name clashes for keep_both; replace sends the old folder to the trash through
library::remove with reason "replaced"), write vars when the game is not running, register with library::add_folder,
create the profile when asked (profiles::create + update + activate). Emit progress by bytes. A plain .zip/.7z of
mods is not a .gachamod; that goes through ONLINE's install_local.
`imm.rs`: detect IMM's config folder (%LOCALAPPDATA%\Integrated Mod Manager (IMM)), map its game codes (WW, ZZ, GI,
SR, EF) to ours, count mods in IMM's two managed folders inside each game's Mods; takeover moves them to
`Mods/<Character>/<mod>` (character = the first path part of IMM's `data` key), DISABLED prefix for mods from the
DISABLED store, writes sidecars with `source` from IMM's `data[...].source` (GameBanana URL -> mod id), moves saved
vars (ini::move_user_vars), removes IMM's now-empty folders, rescans. Refuse while IMM runs
("integrated-mod-manager.exe").

UI:
- `screens/modtools/ModInsides.tsx`: sections "Keys" (each binding as a row: key chip(s), what it does, cycle values
  as small chips), "Options" (each persist var as a Segmented or Select over its values, current value selected,
  change calls modtools.setVar; when the game runs show a note and disable), "Problems", "Conflicts" (with "Keep this
  one" that turns the others off through library.setEnabled), "Readme" (collapsible, monospace).
- `screens/modtools/ModtoolsOverlays.tsx`: listens to onApp: `open-pack` -> PackImport dialog (preview list with
  checkboxes, existing-mod handling Segmented: Skip / Replace / Keep both, "Use its profile" toggle when the pack has
  one, progress bar from packs.onProgress, result toast with Undo where possible); `export-mods` / `export-profile`
  -> PackExport dialog (title, include options toggle, Save as dialog via `dialogs.saveFile` with a default name like
  "Ellen skins.gachamod", progress, then a toast with "Show in folder").
- `screens/modtools/ToolsPanels.tsx` panels for SYSTEM's Tools screen: ConflictsPanel (groups with mod names, "Keep
  one" actions), ProblemsPanel, HashLookupPanel (a field and results), PacksPanel (Export all mods of this game,
  Import a .gachamod), ImmPanel (shown when IMM is found: per game counts and "Move mods from IMM" with a Confirm,
  since it moves folders). Set the "tools" nav badge.
- Demo handlers with believable data for every command.

## Downloads and Browse (ONLINE)

`lib/gamebanana.ts` (TypeScript, fetch, real API in demo and app; research section 2):
- `gameInfo(gbId)`: name, icon, banner (cache in sessionStorage).
- `listMods({ gbGameId, page, perPage<=50, sort, categoryId?, search? })` -> `{ items: GbCard[], total, complete }`
  using Mod/Index (sort keys: newest, updated, downloads, likes, views) or Util/Search/Results for text (15 per page).
- `modPage(id)` -> GbMod (name, description HTML, summary, images at sizes, files with download URL, md5, size,
  added time, download count, analysis warnings, submitter with avatar, category and super category with ids,
  content ratings, initial visibility, likes, views, version, date added/updated, updates count).
- `modUpdates(id)` changelog; `characterList(game)` from `Mod/Categories?_idCategoryRow=<gbCharacterCategory>`
  (name, id, icon), cached 1 day in localStorage; `categories(game)` root categories.
- `checkUpdates(mods: ModEntry[])` -> ids of library mods whose GameBanana mod has a non-archived file added after
  `source.remoteUpdated` (or after installedAt when that is empty), using Mod/Multi in batches of 50 with
  `_csvProperties=_idRow,_tsDateUpdated,_aFiles`; cache 1 hour.
- `queueModFile(game, mod: GbMod, file, replaces?)` -> builds a QueueRequest (meta with name, character from the
  category when it is a character category, source, version, nsfw from content ratings or visibility, preview URL of
  the first image) and calls queue.add. `parseGbLink(url)` -> `{ modId, fileId? }` for gamebanana.com/mods/<id>,
  /dl/<fileId>, /mmdl/<fileId>,Mod,<modId>, and `gachamod:<same>` links.
- Sanitise description HTML before rendering: allow p, br, b, strong, i, em, u, s, a (https only, opens with
  shell.openUrl), img (https only), ul, ol, li, h1-h4, blockquote, span, div, hr, table bits, iframe only for YouTube
  (convert to a thumbnail link). Strip everything else and all on* attributes and styles.
Rust: `install.rs` (stage with archive::extract into `<data>/staging/<id>`; find_roots per "Finding mods" over the
staging folder; place moves (rename, fall back to copy+delete across drives) into Mods; replace keeps the old
sidecar id, enabled state and folder name, moves the old folder to trash with reason "replaced" first; preview_url
is downloaded to `preview.jpg` (best effort, short timeout); register with library::add_folder; clean staging.)
`queue.rs` + `runner.rs`: persistent queue (queue_items rows), up to 3 downloads at once, installs one at a time,
progress events throttled to ~8 per second per item, cancel and retry (resume via the .part file), NeedsChoice when
an archive holds several candidates (emit variants-needed; `queue_choose` installs the picked keys), emits
`library-changed {game}` after installs and a `toast` event ("Installed Coca Cola for Ellen Joe"). Downloads go to
`<data>/downloads/<game>/`; keep the archive (setting "downloads.keep" default "0": delete after install).
`install_local`: archives (zip/7z/rar) and folders; for a folder, copy it (don't move the user's folder).
gachamod:// links (deep-link event -> app event open-gb-link): `gachamod:https://gamebanana.com/mmdl/<fileId>,Mod,
<modId>` queues that file at once; `gachamod://mod/<modId>` opens it in Browse.

UI:
- `screens/browse/Browse.tsx` (view "browse"): GameBanana for the current game. Top: search field, sort Segmented
  (Popular, New, Updated, Most liked), character chip strip with portraits (characterList), category menu, NSFW
  setting (Hide, Blur, Show; setting "ui.nsfw", default "blur"). A masonry or uniform grid of large preview cards
  (image, name, character, submitter avatar, likes, views, date, "Installed" or "Update" badge by matching
  source.modId against the library list) with infinite scroll (IntersectionObserver), skeleton cards while loading.
  Clicking opens the mod page in a wide Drawer: image gallery with a lightbox (arrow keys), title, submitter, stats,
  description (sanitised HTML), files list each with size, date, download count, analysis status and an Install
  button (primary on the newest file; "Update" when this mod is installed with an older file; "Reinstall" when same),
  "Open on GameBanana". Opening `route.modId` opens that page; `route.character` preselects the character chip.
- `screens/downloads/Downloads.tsx` (view "downloads"): active items with thumbnail, name, progress bar, speed and
  time left, cancel; finished items with "Show in Mods" (go library with modId), retry for failures, "Clear
  finished". Sets the "downloads" badge.
- `screens/browse/OnlineOverlays.tsx`: the variant picker dialog (variants-needed: candidate cards with preview, ini
  count, size; checkboxes; "Install chosen"), handles `install-paths` (installs.local; needsChoice -> same picker;
  toast result), handles `open-gb-link` (parse; go to Browse with modId, or queue the file for mmdl links), keeps
  the downloads badge current from queue.onChange.
- Demo: queue handlers that fake progress over a few seconds and then add a mod to demoDb.mods.

## Games, XXMI, launching, tools, settings (SYSTEM)

Rust:
- `games.rs` detect: XXMI first (xxmi::status: for each importer in the config with a game_folder or an existing
  importer folder, save game_dir, importer_dir = `<root>/<importer_folder>`, via_xxmi = true), then for games still
  without a game folder: HoYoPlay gamedata.dat under %APPDATA%\Cognosphere\HYP, KRLauncher kr_starter_game.json,
  GRYPHLINK registry and folders, Steam library folders (libraryfolders.vdf) by steam_app, and the MuiCache /
  FeatureUsage registry scans (research 1a). A community game (xxmi false) gets an importer folder only from the
  user. Never overwrite a folder the user picked unless it no longer exists (store a `user_set` flag in game_paths
  through `migrate` with an ALTER TABLE guarded by has_column). `list` fills importer_version/latest from XXMI's
  config, `running` from launch::running, and counts from the `mods` table (`SELECT data FROM mods WHERE game=?`,
  count enabled from the JSON).
- `xxmi.rs` per its module doc. `launch` runs `"<root>\Resources\Bin\XXMI Launcher.exe" --nogui --xxmi <CODE>` with
  the working dir `<root>\Resources\Bin`, detached, no console window.
- `launch.rs`: config reads XXMI fields when via_xxmi (launch_options, process_priority, window_mode, run_pre_launch*,
  run_post_load*, and game-specific extras: GI unlock_fps, unlock_fps_value, disable_dcr, enable_hdr; WW
  unlock_fps, disable_wounded_fx, force_max_lod_bias, resource_tier; plus Migoto block) and gachamod's own
  `"<game>.launch"` setting otherwise. set_config writes them back (xxmi::set_importer_config; XXMI must be closed:
  Error::Conflict "Close XXMI Launcher first, it saves its settings when it closes"). launch: via XXMI (vanilla false)
  or the exe directly (vanilla true, or no XXMI); then a background watcher (spawned thread) polls processes every 3
  s for up to 10 minutes and emits game-state through a callback the command passes (add a `on_state` parameter
  pattern in the command, emitting events::GAME_STATE). running: process list via `tasklist /FO CSV /NH` (no extra
  crates) or the Toolhelp API through `windows-sys` if you add it; must take under 150 ms.
- `devtools.rs`: per its doc. reload_in_game: find the game's window (EnumWindows by process id or title), bring it
  forward, send F10 down/up with SendInput or keybd_event (add `windows-sys` with the needed features if you must),
  refuse with a clear message if the window isn't found.
- `platform.rs`: `gachamod` URL scheme (HKCU\Software\Classes\gachamod: default "URL:gachamod", "URL Protocol" "",
  shell\open\command `"<exe>" "%1"`), `.gachamod` file association (HKCU\Software\Classes\.gachamod -> gachamod.pack,
  with an icon from the exe and open command). register_free at startup only for what nobody else holds. The NSIS
  bundle also declares the association (tauri.conf.json).
- Background: a game-state poller for the current shown games every 5 s while the app is open is fine if cheap;
  otherwise only after a launch.

UI:
- `screens/home/Home.tsx` (view "home"): a game hero (GameBanana banner from gameInfo, game name, importer status:
  "ZZMI 1.5.0 via XXMI", update available note), the big Play button again with "Play without mods" in a menu, the
  active profile card, stats (mods on/total, updates waiting, conflicts), recently installed mods (from
  library.list sorted by installedAt), "New on GameBanana" strip (listMods newest, 10 cards; click opens Browse
  with modId), and quick actions (Open Mods folder, Rescan, Import .gachamod).
- `screens/home/PlayButton.tsx`: the sidebar's Play button (game running: "Running" state and disabled; via XXMI or
  direct; errors as toasts; a small menu chevron for "Play without mods" and "Open XXMI"; Ctrl+Enter presses it).
- `screens/home/PlayerCard.tsx`: the player card: avatar (pick a character portrait from any game's characterList,
  or an image file or URL), display name, a title line ("Proxy", "Trailblazer" ... free text), a banner strip, a
  "UID" style tag (free text), all from setting "player" (JSON). Click opens an edit dialog. Compact but pretty.
- `screens/tools/Tools.tsx` (view "tools"): sections with ids for deep links: "launch" (LaunchConfig form: via XXMI or
  direct, arguments, priority, window mode, pre-launch and post-load commands with wait toggles, game extras shown as
  toggles or fields by key with plain labels, close gachamod on launch), "migoto" (hunting, dump shaders, mute
  warnings, log level, calls/debug logging, enforce rendering, each with a one-line hint), "dev" (open importer
  folder, d3dx.ini, d3dx_user.ini, ShaderFixes; log viewer (dev.logTail, monospace, refresh); clear shader cache
  and frame dumps with sizes; reload mods in game; wipe saved values (Confirm)), then MODTOOLS panels (ConflictsPanel,
  ProblemsPanel, HashLookupPanel, PacksPanel, ImmPanel) imported from screens/modtools/ToolsPanels.tsx.
- `screens/settings/Settings.tsx` (view "settings", global): "games" (every game in the registry: shown toggle,
  detected folders with Change buttons via dialogs.pickFolder, Detect again; community games explain to pick the
  loader folder that holds d3dx.ini), "xxmi" (status, versions, open XXMI, custom XXMI folder), "appearance" (theme per
  game with previews: Default or New Eridu, scheme Dark/Light/System, reduced motion, text size), "mods" (one skin per
  character per game, NSFW Hide/Blur/Show, keep downloaded archives), "integrations" (gachamod links and .gachamod
  files: status and Register), "about" (version, data folder, licences).
- `screens/settings/Onboarding.tsx`: first start window: runs games.detect with a short animation, shows found games
  as cards (game badge, folders, mod count) with toggles to show them, offers XXMI download link if not found
  (https://github.com/SpectrumQT/XXMI-Launcher/releases), offers "Move mods from IMM" when imm.detect finds it
  (MODTOOLS' ImmPanel logic: emit nothing, just go to Tools section "imm" after), then "Start". Sets setting
  "onboarded" = "1"; App only shows it when no game has a Mods folder, so also show it when that setting is missing.
- Demo handlers for every SYSTEM command.

## Themes (THEME)

- Tokens and kit classes listed in `styles/base.css` and `styles/kit.css`. Default theme: polished, modern, calm,
  dark and light, accent = current game's colour (`--game-accent`). The rail, sidebar and title bar are part of the
  theme (`styles/shell.css`).
- New Eridu (`zzz`): the Zenless Zone Zero menu style, as close as CSS allows, for every kit class, the shell and
  common screen patterns (cards, grids, drawers, dialogs, chips, toggles, page headers, empty states, toasts).
  Applies when the current game is Zenless Zone Zero (or when picked in Settings).
- Fonts: bundle OFL fonts as woff2 under `styles/fonts/` with their licence files (install from npm @fontsource
  packages and copy, or download from Google Fonts' GitHub); never load fonts from the network at runtime.
- `lib/theme.ts` owns applying themes; `ui/GameBadge.tsx` markup may change for the rail's look.
