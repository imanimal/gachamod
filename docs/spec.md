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
- Nothing destructive happens to user files without a way back: removed mods keep a record (name, settings,
  GameBanana link) so they can be downloaded again. Their files are deleted at once unless "Keep removed mods' files"
  is on ("trash.days", default 0);
  config files get a backup before the first write of a session.
- Anything automatic that might not work for every mod (like "toggles only while on screen") keeps the author's
  files and can be undone for one mod at a time, not only for all of them at once.

## Writing rules (all UI text, docs, comments, commit text)

Plain, short, specific. Sentence case. No em dashes (use a period, comma, colon or parentheses). No stock words
(seamless, effortless, robust, leverage, unlock, empower, elevate, streamline, supercharge, delve, journey, navigate,
embrace, crucial, cutting-edge, game-changer, revolutionize, pivotal, tapestry, landscape). No "Whether you're",
"Say goodbye to", "It's not just X", "Imagine", "Designed to", "Built for". No tagline fragments ("Fast. Simple.").
Say what a thing does with a concrete example. Never put personal
names, email addresses or `C:\Users\<name>` paths in code, docs or test data (use `%APPDATA%`, `Player`).

## Areas and file ownership

The code is split into six areas. Each owns the files below.

| Area | Rust (crates/gacha-core/src) | Tauri (src-tauri/src) | UI (src) |
|---|---|---|---|
| LIBRARY | library.rs, profiles.rs, watch.rs | commands/library.rs, commands/profiles.rs | lib/api/library.ts, lib/demo/library.ts, screens/library/*, screens/characters/*, screens/profiles/* |
| MODTOOLS | ini.rs, pack.rs, imm.rs, nrmm.rs, merged.rs, migrate.rs | commands/modtools.rs, commands/migrate.rs | lib/api/modtools.ts, lib/demo/modtools.ts, lib/api/migrate.ts, lib/demo/migrate.ts, screens/modtools/* |
| ONLINE | install.rs, queue.rs | commands/online.rs, runner.rs | lib/api/online.ts, lib/demo/online.ts, lib/gamebanana.ts, screens/browse/*, screens/downloads/* |
| SYSTEM | games.rs, xxmi.rs, launch.rs, devtools.rs, platform.rs | commands/system.rs | lib/api/system.ts, lib/demo/system.ts, screens/home/*, screens/tools/*, screens/settings/* |
| THEME | none | none | styles/** (fonts, base, kit, shell, themes), lib/theme.ts, ui/GameBadge.tsx markup, public/ assets for themes |
| EXTENSIONS | extensions.rs | commands/extensions.rs (and the `gmext` protocol) | lib/api/extensions.ts, lib/demo/extensions.ts, lib/extensions.ts, lib/extension-bridge.js, screens/extensions/* |

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
- Events (model.rs `events`): `library-changed {game}`, `queue` (QueueSnapshot, on state changes only),
  `queue-progress` (runner.rs, see Downloads), `variants-needed`, `game-state
  {game, running}`, `deep-link {url}`, `open-file {path}`, `toast {text, bad}`, `pack-progress {done, total}`.
- UI cross-area events (lib/store.ts `emitApp` / `onApp`): `open-pack {path}` (MODTOOLS opens its import window),
  `install-paths {paths}` (ONLINE installs dropped archives/folders into the current game), `export-mods {game,
  modIds}`, `export-profile {game, profileId}` and `export-pack {game, scope: "game" | "all"}` (MODTOOLS opens its
  share window), `open-gb-link {url}` (ONLINE
  opens that GameBanana mod in Browse, or queues the file for gachamod:// links), `library-refresh {game}` (LIBRARY
  reloads its list; ONLINE and MODTOOLS emit it after they add mods).
- Navigation: `go({ view, modId?, character?, search?, section? })` from lib/store.ts. Library opens the drawer of
  `modId` (a library id); Browse opens GameBanana mod `modId` (a number); `character` filters both; Settings and
  Tools scroll to the element with id `section`.
- Nav badges: `setBadge(view, { count, tone })`. LIBRARY sets "library" to the number of mods with updates. ONLINE
  sets "downloads" (running: tone "run"; finished with failures: tone "bad"). MODTOOLS sets "tools" to the number of
  enabled-mod conflicts plus broken problems in mods that are on (tone "bad"). Warnings, notes, mods that are off and
  problems the user ignored don't count.
- Current game: `useGame()`; switching games re-mounts the view (App keys `main.view` by game and view).
- Settings: small strings via `settings.get/set` (UI) or `Db::setting` (Rust). Key names are dotted and per game when
  per game: `"<game>.oneSkin"`, `"ui.nsfw"`, `"player"` (JSON, from older versions; only extensions read it now), `"xxmi.root"`, `"<game>.launch"` (JSON).

## Mods on disk

- A game's Mods folder comes only from `games::mods_dir(db, game)` (importer folder: `games::importer_dir`).
  A missing Mods folder is made again only when its parent still has d3dx.ini (a fresh loader install). One picked
  somewhere else (D:\ZZZ Mods) is never remade, since an empty folder would wipe the library on the next scan.
  Otherwise `mods_dir` returns NotSetUp ("has no Mods folder at ... anymore"), the games list sets `modsMissing`
  (`games::mods_missing`), a scan fails before touching the rows so the library stays, and the Mods page shows
  "Mods folder not found" with a way to pick it again or install the loader.
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
  the UI shows paths through `fileUrl()` (lib/api/common.ts, Tauri asset protocol). `ModEntry.thumb` is a copy
  about 400 px on its shorter side (see Previews); cards and lists use it, the drawer and lightbox use `preview`.

### Finding mods (library::scan, install::find_roots)

Walk the tree from the root (Mods, or a staging folder). Skip `desktop.ini`, `.git`, `ShaderFixes`, `ShaderCache`,
other tools' own folders at any depth (SkinSelectImpact's `AdditionalFiles_SSI`, Fairy's Secret Folder's
`zzzzzz_ZZZModManagerUI` and `000_ZzzManager_UI`, Hestia's `⬢HESTIA` details folder), and folders gachamod or IMM
manage for themselves only as noted below.
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

No Reload Mod Manager's `_MANAGED_` folder and its `group_<N>` folders hold its own inis beside the mods, so they
are groups, never mods (nrmm.rs). A mod in a group that NRMM gated (`global $managed_slot_id = k`) is on only when
`$\modmanageragl\group_<N>\active_slot` in d3dx_user.ini is k; gachamod won't turn those on or off ("No Reload Mod
Manager picks which mod of this group shows ...", with the move offered). Hestia turns a mod off by moving its files
into `DISABLED_BY_HESTIA` inside the mod's folder: that folder is the mod, off, and turning it on moves them back up.

Installs (install::place) first move files that have a fixed place: anything in a `ShaderFixes` folder goes to the
importer's ShaderFixes, anything in a `BufferValues` folder to `Mods/BufferValues` (LeoTools' FixDash.ini), and with
no mod in the archive, loose shader files (`<16 hex>-ps_replace.txt`) go to ShaderFixes too. Files there that would
change get a backup whose restore takes the install back out. `d3dx.ini` and `d3dx_user.ini` don't make a folder a
mod. When no mod is left but other files are (not readmes or pictures), they go in Mods as they came with a
`.gachamod.json`, so the library lists them, and the outcome's `unsure` says why. Loader files (d3d11.dll and the
like) are never swapped in. The Downloads row shows a Check files tag, and a toast asks to look at the files unless
`downloads.reviewUnsure` is off (Settings, Downloads and installing).

Characters are matched through the game's alias table (see Characters below), so "raiden ei", "Shougun",
"雷电将军" and JASM's lowercase "raiden shogun" folder all land on Raiden Shogun. The group folders are tried first,
then the mod's own folder name.

A mod is off when any folder on its path has a DISABLED prefix (any case, with a space, `_` or `-`). Other managers
also turn mods off by renaming the inis (ModDeck's `DISABLED_mod.ini`, `mod.ini.disabled`): a folder whose inis are
all renamed like that is a mod that is off, and turning it on renames them back. Turning on a mod inside a DISABLED
folder (`DISABLED_old.zip/Jane Gym`) names that folder back (`old.zip`); the other mods in it get DISABLED on their own
folders first, so only the one picked comes on.

Folders another manager set up come in with what it knew (managers.rs). A new folder is adopted with that manager's
name, character, GameBanana link, author, version, tags, notes, picture, favourite and NSFW flags; a known mod only
gets the gaps filled (Characters view: "Bring them in", with Undo). Files read, never changed:
- JASM and JASM+: `.JASM_ModConfig.json` and `.JASM_Cover.<ext>` (`Mods/<category>/<character>/<mod>`), including
  the date added, the skin it replaces, and JASM+ variants and add-ons (read, not yet turned into parts).
- SkinSelectImpact: `SSI.txt` (link and notes), older `SkinSelectImpact.txt` and `Url.txt`, `preview.png`; the
  character is the folder in `Mods/SkinSelectImpact/<Character>/<mod>`.
- `mod.json`, told apart by its keys: XX Mod Manager, FlairX (previews as `preview001.jpg`), ZZZ Mod Manager
  (`imagePath`, `keyswap`) and WuWa Mod Manager (`category` is the character, picture `thumbnail.png`). Placeholders
  like "Unknown" and "no description" are skipped.
- Peaky Mod Manager: `modinfo.json` (title, source, coverImage, character; other mod types become a tag).
- Hestia: `⬢HESTIA/metadata.json` and `⬢HESTIA/Personal Note.txt`; a mod it turned off has its files in
  `<mod>/DISABLED_BY_HESTIA`.
- EMMM: `info.json` and `preview_custom.<ext>` (pinned counts as favourite, `is_safe: false` as NSFW).
- d3dxSkinManage-Plus: `.d3dxmeta/info.json` and its `previews` folder (age rating R or X is NSFW).
- Fairy's Secret Folder: `.zmm-meta.json`, and `category.json` in the `<Character> - <Skin>` folder above.
- No Reload Mod Manager: `modname`, `modlink`, `icon.png`, `fav` and the group folder's `groupname`
  (`Mods/_MANAGED_/group_3/<mod>`).
- WZMM `modmeta.json`, GIMM `GIMM.json(c)`.
A name that is a link becomes the mod's page. uyujkk's Integrated Mod Manager and HoyoModManagerGo keep nothing per
mod (their details are in their own databases).

## Library (LIBRARY)

Mods layouts (layout pref "format" in `gm.layout`, `lib/theme.ts` `ModsFormat`; picked in Settings, Appearance,
Mods layout, on the setup page and on a first-start card, `screens/settings/FormatPicker.tsx`). Custom themes can't
set it. Every layout has the same features, keys and controller moves:
- Cards ("cards", default): the chip row over the grid, details in a drawer. Closest to SkinSelectImpact.
- Character list ("chars"): the same chips as a list down the left (with "All mods"), the mods beside it; a character's
  page puts its strip of the others there. Like JASM and ARG Mod Manager.
- Three panes ("panes"): the list, the mods, and the details docked on the right (kit `Drawer docked`), with a hint
  while no mod is picked. Picking another mod replaces the route instead of pushing one. Like Integrated Mod Manager
  and XX Mod Manager.
- Compact list ("rows"): every grid as dense rows, switch first, name, character and size in columns. The grid/list
  switch on Mods hides (the per-game choice is kept).
The first start picks the layout resembling a manager found on this PC (Integrated Mod Manager's folders: Three panes;
JASM's files: Character list; XX Mod Manager's: Three panes) unless one was picked already, and says so.

Rust: `library.rs` and `profiles.rs` as stubbed. Notes:
- scan: walk, adopt, upsert the `mods` table (data = ModEntry JSON), delete rows whose folders are gone, fill
  `size_bytes`, `file_count`, `ini_count` and `has_keys`/`conflicts` from `ini::quick_facts` (MODTOOLS; a stub
  returns defaults until then; compute conflicts by counting other enabled mods sharing any hash from quick_facts).
  Emits nothing itself (commands return the list). Must handle 1,000+ mods in under 2 seconds on an SSD: don't hash
  files, read inis only through quick_facts.
- watch.rs watches each set-up, shown game's Mods folder (notify, ReadDirectoryChangesW; recursive) and the folder
  above it (not recursive, so the Mods folder deleted and made again gets its watch back; the folder going away
  starts no scan, so its rows stay). A burst of changes settles
  per game into one scan: 700 ms after the last change, at most 4 s after the first. The scan is `library::scan`, the
  one Rescan runs, and `library-changed {game}` goes out only when the list differs. Ignored: paths the scan never
  reads (dot files such as sidecars, `gachamod live`, shader caches, d3dx_user.ini, logs, temp files) and a folder's
  own "modified" (its child's change comes as its own event). Installs, pack imports, IMM moves, toggles, moves,
  removes and scans `watch::hold` their game; a settled change waits until they let go. Scans write only what changed,
  so the scan after one finds nothing; a writer that answers every scan is ignored after two rounds. A folder that
  can't be watched is logged once and tried again on `watch::resync`, which runs when a game's folders, its shown
  flag or the setting "library.watch" ("0" is off) change.
- set_enabled: rename `X` to `DISABLED X` and back; if the target name exists, add " (2)". Move the saved variables
  (ini::move_user_vars) so turning a mod off and on keeps its options. One skin per character: when turning on a mod
  with a character, turn off the other enabled mods with the same character and say so in `notes` ("Turned off Coca
  Cola (Ellen Joe)"). `set_enabled_with(.., turn_off_others)` takes the user's answer; without one, setting
  `"<game>.oneSkin"` decides ("0" keeps them on, anything else turns them off). Afterwards call `profiles::on_change`.
- Asking (UI, `screens/library/overlap.ts`): turning one mod on from its switch, its details or its menu while its
  character has another mod on opens a small menu by the switch: "Turn off Coca Cola", "Keep both on", "Make it a
  sub-mod of Coca Cola". Closing it leaves the mod off. `"<game>.oneSkin"` "auto" turns the other off without asking,
  "0" keeps both; "ask" (default, and the old "1") asks. Settings, Mods: "Another skin already on" per game. Bulk
  turn-ons, profiles and hotkeys don't ask (the last one of each character wins, as before).
- Sub-mods: `Sidecar.parent` (an id; `ModEntry.parent`) marks an add-on that goes with another mod (a hair recolour
  for one outfit). Set through update_meta `parent` ("" unlinks); a sub-mod's parent stands in when picked as a parent,
  and a mod with sub-mods can't become one. Mods with the same root (parent or self) never trip the one-skin rule.
  Turning a sub-mod on turns its parent on; turning a parent off turns its sub-mods off and marks them
  `off_with_parent`, and turning it on again brings those back. Profile switches set states as saved, without these
  rules. UI: "Make sub-mod of" / "Unlink from X" in the mod menu, a "Sub-mod" tag on the card that opens the parent,
  and in the details a "Sub-mod of X" line or the list of its sub-mods with switches.
- update_meta writes the sidecar and the row. Changing `character` does not move the folder.
- move_to_group moves the folder (and saved vars), creating the group folder; removes the old group folder if empty.
- remove: move the folder to `<data>/trash/<game>/<trash id>/`; `trash` row; restore puts it back at its original
  relative path (or with " (2)"). What happens after that is in "Trash and archive" below.
- characters_sync: replace the game's `characters` rows (keep order as `sort`). characters(): every character row
  with counts, plus characters that only appear on mods (no icon), sorted by enabled mods then name.
- infer_character: case- and punctuation-insensitive match of any hint against character names and their parts
  ("Ellen Joe" matches "ellen", "EllenJoe", "ellen_joe_bunny"); prefer the longest match; ignore matches of 3
  letters or less unless exact.
- Profiles: see the module doc in profiles.rs. Creating the first profile "Default" happens in `list`. Activate does:
  capture the outgoing profile's vars (ini::user_vars for each mod it has on), set enabled states to match the
  incoming profile (mods not in the profile's rows keep their current state only if they were installed after the
  profile was last updated; otherwise off), write the incoming vars (unless the game runs: `vars_pending`), mark
  active. Mods added while a profile is active join it as they are (new installs are off).

UI:
- `screens/library/Library.tsx` (view "library", label "Mods"): header with search, filter chips (All, On, Off,
  Updates, Favourites, Problems), a chip row that scrolls sideways (wheel, arrow buttons, arrow keys): types for mods
  without a character (UI, Tools and fixes, Weapons, Other, from `libKind` in library/kinds.ts: group folder and tags
  first, then the name, with RabbitFX, ORFix and similar libraries always tools; route `kind`), then characters with
  portraits (from characters.list), sort (Recently added, Name,
  Character, Size), grid/list toggle (remember in localStorage). Mod cards: preview image (blur when nsfw and setting
  "ui.nsfw" is "blur"; hidden when "hide"), name, character (or the type, a link to that type's chip), a Toggle that turns the mod on/off immediately (with Undo
  through history.record), badges (Update, Conflict, Keys), a "..." menu (Open folder, Move to character, Export as
  .gachamod: `emitApp({type:"export-mods"})`, Open on GameBanana, Remove). Multi-select with Ctrl/Shift click and a
  bulk bar (Turn on, Turn off, Export, Remove). A mod's menu and its details set its problems aside (`lib/holds.ts`,
  setting "problems.held"): "Ignore problems" hides every warning (red marks, the Problems filter, Tools, the nav badge)
  and ignores its conflicts on both sides until "Show problems again"; "Wait for an update" hides the game update
  warning until the mod's file, version or install time changes, and its card says "Waiting for update". Tools >
  Fixes lists both under Muted, and its "Turn off and mute" waits for an update. "Rescan" button and an automatic scan when the screen opens if the
  last scan is over 30 seconds old; while Mods folders are watched, only the session's first visit scans. Empty state explains where mods come from (Browse, or drop an archive).
- Mod drawer (`Drawer` from the kit) on card click: big preview, name (editable inline), character picker (combobox
  over characters), tags, notes, source link, version, size, folder path with Open, then `<ModInsides mod={mod} />`
  from `screens/modtools/ModInsides.tsx` (MODTOOLS fills it), then Remove. Opens directly for `route.modId`.
- Installed and Trash (`route.tab` "archive"): a two-option switch, first in the header's action row, which always
  has its own line under the title, so the switch stays in the same place on both pages. `screens/library/Archive.tsx` lists removed mods from `library.archive`. A
  mod whose files are still on the PC says "Files on PC" with Put back and Delete; once "trash.days" passes it says
  "Record only" (name, settings, GameBanana link, no files) with Download again and Forget. The page says plainly
  that the files are what goes after the set days, and the record stays.
- Update check: on open (and every 30 min while open) call `checkUpdates(mods)` from lib/gamebanana.ts (ONLINE
  provides it; until then it returns []), then `library.markUpdates`. An Update badge's button queues the newest file
  with `meta.replaces` set (ONLINE's `queueModFile` helper in lib/gamebanana.ts, see ONLINE).
- `screens/characters/Characters.tsx` (view "characters"): a roster grid of character portraits (GameBanana icons
  via characters.list; characters with mods first). Each tile shows the active skin's preview behind the portrait,
  a count, and a tick when the character is owned. Selecting a character opens its page (`CharacterPage.tsx`). On
  first open, if characters are empty, fetch the list with `characterList(game)` from lib/gamebanana.ts and call
  `characters.sync`.
  - Owned characters (`owned.ts`): the "Owned" chip shows only them (remembered in the "characters.view" setting),
    even without mods. O on a tile or a character's page, the "Owned" item of the character menu (the controller's
    right stick press opens it) and the page's "Mark as owned" button flip it, each with Undo.
  - "Import owned" (or dropping a .json, .txt or .csv anywhere on the view) reads an export or a pasted list and ends
    in one toast, "Marked 47 characters as owned", with Undo. A file that belongs to another game goes to that game
    ("... in Star Rail"). Names that matched nothing sit behind a small "3 not recognised" link.
  - When another mod manager left names, characters or links that known mods lack, a quiet row offers "Bring them
    in" (managers.rs, with Undo).
- `screens/profiles/*` (HOME/PROFILES area). `Profiles.tsx` (view "profiles"): cards with a mural of the profile's
  mods (`ProfileThumb` size "card"; a banner the user picked wins), icon, colour stripe, name, mod count, hotkey and
  an "On now" badge. Clicking a card switches (toast with what changed and Undo). "New profile" (here, the sidebar,
  Home's + chip, search) opens the editor in create mode (`startNewProfile`, drawn by `NewProfileHost` in App): the
  name is filled in and selected, "Start with" picks the mods on now or no mods ("Empty profile" opens it on no mods),
  and Enter or Create makes it, so the defaults are one extra click. F2 renames on the card, Del deletes, arrows move
  between cards. Every change goes through `profiles/actions.ts` with Undo: create, duplicate, rename, edit
  (`ProfileEditor`: name, description, icon,
  colour, banner, hotkey), save the mods on now into a profile, delete (snapshot, delete, Undo restores it whole).
  `menus.ts` registers the "profile" right-click menu (switch, edit, rename, duplicate, save the mods on now into it,
  hotkey, export, delete) and the search's profile commands ("Switch to Story mode", "New profile with no mods";
  "loadout" and "preset" find them). `requestEdit(id, "all" | "rename" | "hotkey")` lets a menu anywhere open the
  editor: it goes to Profiles, which answers it. `ProfileIcon`'s `profileFace` picks the fallback picture (emoji,
  character portrait, the layers glyph for "Default", initials) for the cards and the sidebar's mini thumbnails.
- Demo (`lib/demo/library.ts`): seed ~24 believable mods for "zzz" (Ellen Joe, Miyabi, Jane Doe, Zhu Yuan, Burnice,
  Yanagi, Astra Yao, Evelyn ...), ~12 for "gi", ~8 for "ww", with GameBanana-style preview URLs from
  images.gamebanana.com where you can find real ones through the API, or none; characters with real GameBanana
  category icons (fetch once with the API while writing the demo and paste the URLs); two profiles per game.

## Previews, trash and archive, game icons, profile edits (BACKEND)

Rust: `previews.rs`, `library/removed.rs`, `library.rs`, `install.rs`, `profiles.rs`, `games.rs`, `platform.rs`.

### Previews

Mods ship textures as .jpg/.png too, so "the first image in the folder" is often a texture (a "Velina" mod showed
its body texture). A mod's picture, in order: the user's own (set_preview); `preview.*` in the mod root; the
sidecar's `preview` (GameBanana's picture saved at install, a file or a URL); the first root-level image that no ini
loads (`filename = ...`, resolved from the ini's folder) and that doesn't look like a texture (.dds, a folder named
like "Textures" or "tex", names with Diffuse, LightMap, NormalMap, MaterialMap, Texture, or ending in `_d` / `_n`).
Otherwise none, and the UI offers GameBanana's picture.

- Thumbnails (`previews.rs`): a local preview gets a copy 400 px on its shorter side (JPEG, or PNG when it has
  see-through parts) in `<data>/cache/thumbs`, named from the picture's file name, size and modified time, so a
  renamed or turned-off mod keeps it and a changed picture gets a new one. Remote pictures, GIFs and ones already
  that small get none. A scan fills `ModEntry.thumb` from the cache and makes missing ones on a background thread
  (the next scan picks them up); a single-mod change makes it right away.
- Install from GameBanana: the runner's downloaded picture becomes `preview.<ext>` whenever the mod has no
  `preview.*` of its own (other images don't count). If the download failed, the sidecar keeps `preview_url`.
- `mod_fetch_preview(game, id, url)` downloads an https picture (Content-Type png, jpeg, webp or gif, at most 25 MB)
  and saves it as `preview.<ext>`; preview files already there become `preview-original.<ext>`. With a custom preview
  set it is saved as `preview-gamebanana.<ext>` behind it. Returns the ModEntry.

### Trash and archive

- Trash files are kept "trash.days" days (setting, default 0, 0 to 3650; 0 deletes them right away). Expired trash
  is purged at startup, when the setting is saved (settings_set), on every archive or trash listing and after a
  remove at 0 days. A copy an update replaced (reason "replaced") is kept at least 10 minutes.
- Purging deletes the files and moves the record to the `archive` table: name, character, GameBanana source, tags,
  favourite, nsfw, notes (the ModEntry JSON), removedAt, whether it had saved options, and a copy of its preview (up
  to 3 MB) at `<data>/archive/<id>/preview.<ext>`. `mod_vars`, `profile_mods` and `profile_vars` rows stay. A
  "replaced" copy, or a mod whose id is in the library again, is not archived.
- `archive_list(game | null)`: trash entries (`key` "t<id>", `filesUntil` set) and archive entries ("a<id>"),
  newest first. `archive_forget(keys)`: deletes trash files, archive rows and preview copies, then the mod's kept
  values and profile rows once nothing else refers to its id.
- Reinstall: installing a GameBanana mod whose mod id matches a trash or archive entry (not "replaced", id not in the
  library) gives the new folder that entry's mod id, name, character, tags, notes and favourite. Its kept values are
  written back into d3dx_user.ini (ini::set_user_vars) when the mod is on and the game is closed, and its profile
  rows apply again as they are keyed by mod id. The entry is dropped and old trash files deleted. With several
  variants, an entry whose name matches goes to that variant, else to the first.

### Game icons

`game_icon(game)` takes the first icon of the game's exe (launch::game_exe in its game folder) at 256 px with
PrivateExtractIconsW, reads it as a 32-bit BI_RGB DIB (old icons without alpha use the mask) and saves
`<data>/icons/<game>.png`. It is taken again when the exe's path or modified time changes (setting
"<game>.iconStamp"). Null when the folder or exe is unknown, or off Windows.

### Profile edits

- `profile_members(id)`: ids of mods that are on in a profile.
- `profile_snapshot(id)` -> `{ profile, mods: [{ modId, enabled }], vars: [{ modId, ini, var, value }] }` (rows of
  removed mods included). `profile_restore(snapshot)` recreates it with the same id when free, a numbered name when
  another profile took the name, its hotkey, rows and values; a profile that was active is marked active again
  without touching files.
- `profile_set_mods(profileId, modIds, enabled)`: on the active profile a normal toggle (one skin per character,
  files renamed); on another profile only its rows change. Returns a SwitchReport (`varsPending` false).

### Characters

Characters come from GameBanana's category tree at runtime (characters_sync); nothing in Rust lists them. Character
categories (checked 2026-11-13): gi 18140, hsr 22832, zzz 30305, ww 29524, hi3 23620, ef 42770, pgr 35542, at 51169.
p5x, gf2, idv and ss have no character categories on GameBanana.

Other names for characters live in `crates/gacha-core/data/characters/<game>.json` (aliases.rs reads them at build
time). Each entry has `name` (GameBanana's category name), `ids` (in-game ids that exports use) and `aka` (nicknames,
in-game file names, optimizer keys, other languages). `groups` name a pair that one word covers (Traveler is Aether
and Lumine, Trailblazer is Caelus and Stelle, Rover is both Rovers); they only count when importing owned
characters. `skip` lists categories that are not characters ("NPCs & Entities"). To add a name, add it to `aka`; a
test checks that no name points at two characters. Spacing, case and punctuation never need an entry
("HuTao", "hu_tao" and "Hu Tao" are the same).

Matching rules (aliases.rs): a whole name wins, then a name found as whole words ("Raiden Shogun Bikini"), then a
name of five or more letters inside a longer word ("RaidenShogunBikini"), then a part of a roster name ("Miyabi"
for Hoshimi Miyabi) when no other character shares it. Short names like "Ei" only match as a whole word, so "Eight"
and "Eileen" stay unmatched. Everyday words in names ("White", "Bigger") don't count on their own. In "Yixuan on
Lucia" or "Valeriy over Varka" the character after "on", "over" or "as" is the one the mod is for. GameBanana names
missing from a table still match by these rules.

Owned characters (owned.rs, table `owned_characters`) are kept per game. Imports read:
- Genshin: GOOD (Genshin Optimizer, Inventory Kamera, Irminsul), Enka.Network profiles.
- Star Rail: SROD, HSR-Scanner and reliquary_archiver exports (`metadata.trailblazer` picks Stelle or Caelus),
  Fribbels optimizer saves, Enka.Network profiles.
- Zenless: ZOD, Enka.Network profiles.
- Wuthering Waves: Inventory Kamera (resonator ids as keys), wuwatracker pull history.
- HoYoLAB character lists and any other JSON: ids and names under the usual keys (`id`, `avatarId`, `name`,
  `character` ...), and lists of names.
- Plain text: one name per line, or separated by commas.
A format that names its game sends the characters there; otherwise the current game, or the game that matches when
the current one matches nothing.

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
- lint: problems for every mod, on or off, worst first. Severity says what happens in game:
  - "bad" (Broken): an ini can't be read, the mod has no ini at all (inis that are only turned off don't count), or
    two inis change the same TextureOverride hash and match_first_index with no `match_priority` and at least one of
    them draws without an `if` (variants left on together draw over each other).
  - "warn" (Warning): a file that a used `[Resource]` needs is missing (authors often leave lines for textures they
    didn't ship and the mod still shows fine, so it doesn't count on Tools), a missing file named like a remap
    (`*RemapBlend.buf`, made by remap fix scripts for another model such as the Raiden boss), or
    `run = CommandListX` with no such section in the mod, a namespace the mod uses that nothing installed defines
    (`run = CommandList\RabbitFX\Run` with no RabbitFX in Core or Mods: "missing_library"), and a `[ShaderRegex*]`
    with no `.pattern` section that runs CheckTextureOverride itself or in a command list it runs ("global_trigger",
    an FPS cost in every scene; XXMI Launcher asks about these on start).
  - "bad" also: an ini whose `namespace` is one the loader already loads from `Core\<importer>\Libraries`
    (ORFix, RabbitFX, SlotFix): "duplicate_library", fixed by "off".
  - "info" (Note): a missing file whose `[Resource]` nothing names (3DMigoto loads a resource's file the first time
    a command uses it, so it never loads), an empty ini next to inis that load, an ini over 16 MB gachamod didn't
    read, a `[Key]` with no key line.
  A problem carries a fix when one is certain: "point" (the same file name is elsewhere in the mod: the one whose
  folder name starts like the wanted folder, the only one, or any when all copies are identical; the `filename =`
  lines change to its path from the ini's folder), "keep" (rename the other overlapping inis DISABLED_<name>) and
  "off" (rename `ini` DISABLED_<name>). The loader and Mods folder come from the game's paths (lint, inspect), else
  from the first folder above the mod with a d3dx.ini.
  lint_fix applies one after taking a backup (backups.rs), so it can be undone.
- hash_lookup: which mods (on or off) mention a hash, any case, with or without 0x.
`merged.rs`: mods made by GIMI's merge script (`genshin_merge_mods.py`): an ini (any name, `-n` renames it) whose
first line is `; Merged Mod: <ini>, <ini>...` in swap order, or whose footer names the "mod merger script" (then the
`[Resource<name>.<n>]` folders give the variants). Each listed ini is found as `DISABLED<name>.ini` (or live, `-s`).
inspect sets `merged` (variants named after their folder, the folder path or ini name when two match) and
`VarInfo.names` on the swap var ("1" -> "Raiden Kimono"). merged_split makes each variant folder a mod of its own:
the variant the swap value shows gets its ini name back and the mod's sidecar (same id), the others get new
sidecars and stay off (`DISABLED...ini`), the merged ini and the old sidecar go; character from the sidecar, else
from the ini name. Files a `-c` merge kept only in another variant's folder are copied in (`copyFiles`,
`copyBytes`). Refused, with the reason in `blocked`: a listed ini is gone, a variant sits in the main folder or
shares a folder, an ini that isn't part of the merge, a shared file whose kept copy is gone. One backup (mod id
`<id>-split`) undoes it; rescan after.
`pack.rs` (.gachamod): a zip (deflate, level 6; zip64 on) with `gachamod.json` (Manifest) first. Format 2 holds
`games: [{game, mods, profiles}]`; format 1 (`game`, `mods`, `profile`) is still read. Each PackedMod carries its
sidecar (name, character, tags, notes, GameBanana source), rel_path without `DISABLED`, on or off, picked option
values, key changes (keys::shared_changes: rebinds, keys turned off, "only while on screen"), its ini paths and size.
A mod whose files go in sits under `mods/<n>/`; one with an empty `dir` is only a link.
- Scopes (ExportRequest.scope): `mods` (a selection), `profile` (one profile, its mods all on), `game` (every mod and
  profile of a game; the active profile uses the current on/off states), `all` (every set-up game with mods).
- Files (ExportRequest.files): `links` (no mod files: a library is a few KB, small enough for any chat app),
  `unlinked` (links, plus the files of mods without a GameBanana link), `files` (every mod's files, for a backup; the
  default when empty, for older callers). pack_plan counts mods, links and sizes first and suggests `unlinked` when
  those files fit in 20 MB, else `links`. Local profile banners up to 2 MB go under `media/`.
- Import: validate the manifest (an unknown higher format is an error with a clear message), skip games that aren't
  set up (the window says so; the import fails only when none is), refuse entries that escape their folder
  (archive::safe_relative). Mods with files: extract to staging, move into Mods at rel_path (DISABLED prefix when off,
  " (2)" for keep_both, replace sends the old folder to the trash with reason "replaced"), register, write vars. Link
  mods: one QueueRequest per GameBanana file (mods from one archive share it) carrying ModSetup rows in
  InstallMeta.setups; the command resolves them with Mod/Multi (pack::resolve: the shared file while GameBanana has
  it, else the newest; notes for files or mods that are gone) and adds them to the queue. install::place matches each
  setup to an archive candidate by variant key, then by ini paths, then one to one, and sets name, folder, sidecar,
  key changes and option values like the sender had them. Existing mods match by sidecar id, else by GameBanana mod
  (unless the variants differ). Profiles are made with profiles::restore, rows pointing at mods still downloading by
  their pre-assigned ids; the one in use when the file was made is switched to. Emit progress by bytes. A plain
  .zip/.7z of mods is not a .gachamod; that goes through ONLINE's install_local.
`imm.rs`: detect IMM's config folder (%LOCALAPPDATA%\Integrated Mod Manager (IMM)), map its game codes (WW, ZZ, GI,
SR, EF) to ours, count mods in IMM's two managed folders inside each game's Mods; takeover moves them to
`Mods/<Category>/<mod>` (the first path part of IMM's `data` key; it becomes the sidecar's character only when it
names a roster character, so "Uncategorized" or "UI" don't), DISABLED prefix for mods from the DISABLED store, writes
sidecars from IMM's `data[...]` (`source` GameBanana URL -> mod id, `tags`, `note`, `installedAt` or `addedAt` ->
installed time, `updatedAt` -> `remoteUpdated`; ms or s by size), moves saved vars (ini::move_user_vars), removes
IMM's now-empty folders, rescans. IMM's own folders are never mods: restore points (`<store>\RESTORE\RESTORE-<date>`,
also `DISABLED_RESTORE`) and `IGNORE` stay where they are (the result's notes say how many restore points were left),
and `<links>\.USER_PREFS\<Category>\<mod>.ini` (the values IMM sets at load) is read, its values plus
`data[...].vars[<ini>][<var>].pref` written for the moved mods where d3dx_user.ini has none (kept values for mods
that are off), then sent to the Recycle Bin. Each IMM preset becomes a profile (" (IMM)" on a name clash) with its
mods on and the other moved mods off, and its hotkey when hotkeys::normalize takes it and no profile of the game
has it. IMM's `<mod>\DISABLED_IMM_INI_BACKUP\default\...` copies go to originals::adopt, so "Put back original
files" undoes IMM's key edits too (only put back uses them). Refuse while IMM runs ("integrated-mod-manager.exe").
`nrmm.rs` ("Moving from No Reload Mod Manager"): `nrmm_detect` lists each game whose Mods folder has `_MANAGED_`
(groups, mods, how many show) and whether NRMM's settings file is there (%APPDATA%\com.aglg\No Reload Mod
Manager\shared_preferences.json). `nrmm_takeover` refuses while No_Reload_Mod_Manager.exe or the game runs, then for
each mod: writes each ini back from its `.ini_managed_backup` (gates, `;-;` marks, `match_priority` and
`allow_duplicate_hash` gone), keeps the user's NRMM key choices as gachamod's key changes (a rebind keeps the author's
line above it, a `;+;` key becomes "turned this key off"; originals.rs keeps the author's copy), gives a renamed
namespace (`name_1`) its own name back unless another moved mod has it, moves the mod to `Mods/<Character>/<modname>`
(the group's `groupname` matched to the roster; " (2)" when the name is taken; DISABLED unless it is its group's
active slot), moves saved values to the new path and namespace, and writes a sidecar with the name, `modlink`
(GameBanana id), `icon.png` and favourite. A mod with a gated ini and no copy stays where it is, with a note, and then
NRMM's folders stay too. NRMM's files (the inis as it left them, its copies, `modname` and the like, and the rest of
`_MANAGED_`) go to `<data>/trash/nrmm/<game>~<time>`. Returns an ImportResult; rescans.

### Moving from other managers (migrate.rs)

Switching from another manager is one click and loses nothing. managers.rs already reads what other managers leave in
each mod folder; migrate.rs covers the rest: mods they keep outside Mods (gachamod only sees the ones turned on),
their presets, and details kept in their own databases.

`detect(game, picked)` reads only (SQLite files open read-only) and lists each manager found: name, settings file,
its own folder, mods gachamod already sees (`inside`), mods outside Mods it can't see (`outside`) with the disk space
a copy takes, presets, and whether it is open. `picked` is a folder or file the user chose, for programs with no fixed
place. `import(game, manager, {mode, picked})` refuses while that manager or the game runs, then:
1. Places the outside mods in Mods at their path inside the manager's folder (`<Character>/<mod>` for managers that
   sort by character), turned off unless the manager had them on, " (2)" on a name clash.
2. Rescans. New folders are adopted with what other managers left in them (managers.rs).
3. Fills names, notes, tags, GameBanana links and favourites the manager kept elsewhere, only where the sidecar has
   nothing (or just the folder name). Option values JASM kept for mods that are off become their kept values.
4. Turns off mods the manager had off without renaming them (GB Mod Manager).
5. Makes a profile from each preset with exactly its mods on (and its option values, from JASM). A name already taken
   gets " (<Manager>)". A preset whose mods are all missing is skipped with a note.

`mode` is "copy" (default) or "move". Copy leaves the manager working: its links in Mods stay and are adopted (the
files stay in its folder; turning one off in gachamod renames the link), and only the mods it has off are copied in,
so the UI shows the disk cost first. Move is for leaving the other manager for good: each link is removed (only the
link, never what it points to) and the real folder moves into its place, and the off mods move in too. Copies a
manager made itself (GIMM, HoyoModManagerGo) are already real folders; their library copies stay where they are.

The result has the new mod ids, the profile names, notes and `undo`. `undo` deletes the profiles, puts details and
on/off states back, sends copies to the app's trash, and moves moved folders back where they came from with a link in
their place again.

What is read, per manager:
- JASM and JASM+: `%LOCALAPPDATA%\JASM\ApplicationData_<Genshin|Honkai|WuWa|ZZZ|Endfield>` (old Genshin:
  `ApplicationData`), `LocalSettings.json` (`ModManagerOptions`, JSON in a string, `ModsFolderPath`), presets
  `Presets\<name>.json` (`Mods: [{ModId, FullPath, Preferences}]`; ModId is the `Id` in the mod's
  `.JASM_ModConfig.json`, FullPath the fallback), and each mod's `Preferences` (`"<ini>\<var>": "<value>"`).
- XX Mod Manager: `%APPDATA%\xx-mod-manager\config.json` (`modSourcePath`, `modTargetPath` = Mods, `presetPath`);
  presets `{name, modIds}` where ids are the `id` in each mod's mod.json (or folder names), older ones an array.
- ZZZ ModManager: settings sit in localStorage, so its folder is found from its links in Mods; presets
  `<Mods>\..\presets\<name>.json` (arrays of folder names).
- Peaky Mod Manager: `%APPDATA%\peakymodmanager-v3\config.json` (`libraryPath`, `targetPath`); presets from its newest
  `<library>\Presets_Backup_<date>.json` (`{name: [folder names]}`), since the live ones are in localStorage.
- WZMM: `%APPDATA%\wzmm\settings.json` (`xxmiPath`), off mods in `<ZZMI>\dismods`, groups
  `%APPDATA%\wzmm\groups\<id>.json` (`{name, mods}`). Other variants in `modvars` stay where they are.
- GMM: `%APPDATA%\GenshinModManager\app_data*.sqlite` whose `settings.mods_folder_path` is this Mods folder; `assets`
  (name, description, author, category_tag by `folder_name`), `presets` and `preset_assets` (`is_enabled`).
- GIMM: `%APPDATA%\gimm\config.json` (`modFolder`, `gimiFolder`); a mod is on when its copy is in Mods.
- HoyoModManagerGo: `%LOCALAPPDATA%\HoyoModManagerGo\cache\hmm.db` (`mod`, `playlist`, `playlist_mod_cross_ref`), the
  store root from `root_mod_dir` in its rosedb files, mods at `<root>\<Genshin|StarRail|ZZZ|WuWa>\<character>\<folder>`,
  copies in Mods as `<id>_<folder>`.
- SkinSelectImpact: a portable folder with `Data\App_Settings.json` (`<GS|SR|WW|ZZ|AE>_Mods_Path`), found where the
  user picked or one level under Desktop, Downloads, Documents, `%LOCALAPPDATA%` and the game's folders (two levels
  when the folder name has "skin"). Presets in `Data\<prefix>_Presets.json`: items with `FolderName` (character) and
  `SubFolderName` (mod) under `Mods\SkinSelectImpact`. No sample file was available, so the reader takes the preset
  name from the item or the object around it; check it against a real file.
- EMMM: `%APPDATA%\com.reynalivan.emmm\app.db` (`games.mods_path`, `collections`, `collection_mods.mod_path`).
- Fairy's Secret Folder: its Settings > Backup file, picked by the user (`keys.mod_profiles`: JSON text of
  `[{name, tab, enabledModRelativePaths}]`, paths from `Mods\<tab's folder>`; `keys.favoriteMods`).
- WuWa Mod Manager: `<Mods>\presets.json` (`{presets: {id: {name, enabled_mods}}}`, ids from each mod.json).
- GB Mod Manager: `%USERPROFILE%\.gb-mod-manager\store.json` (`mods: {name, gbId, installPath, enabled}`).
- Integrated Mod Manager: presets in `config<CODE>.json` (`[{name, data: ["Character\\Mod"]}]`), found before and
  after imm.rs moves its mods.
- Any other link in Mods to a folder outside it: that folder is offered as "Another mod manager" (uyujkk's
  Integrated Mod Manager, for one).

A new manager is a reader function added to `READERS` in migrate.rs. Not brought over: Hestia's profiles (full
copies of Mods), MIMM's slot groups (it rewrites inis), WZMM's variants and FlairX's own XXMI folder.

Keys, `keys.rs` (KEYBINDS; tests in `keys/tests.rs`). Every edit changes the ini in place: comments, order, line
endings, BOM and encoding (UTF-8, UTF-16, other bytes) stay as they were, takes a `backups::take` first and returns
the Backup for Undo. Each change leaves a `; gachamod ...` comment line, so "put back" works from the file alone.
Before the first write to an ini, `originals.rs` keeps the author's copy in `<data>/originals/<game>/<mod id>/` with
a fingerprint of every version gachamod writes after it. When an edit leaves an ini with none of gachamod's markers
and the file is still one gachamod wrote, the kept copy is written instead, byte for byte. A file that was updated or
edited by hand since isn't rolled back: its markers come out and the rest stays, and the next write keeps a new copy.
- list: every `[Key*]` section with its `key =` and `back =` lines, readable labels, the author's condition, the
  author's line where gachamod changed it, and the mod's on-screen state: `own` (the mod gates its keys itself),
  `on`, `partial`, `off`, `cant` (nothing found that draws), `global` (no TextureOverride: UI mods), `none`.
- rebind: a binding the user pressed ("ctrl VK_F6", "XB_LEFT_SHOULDER XB_A") written in the line's own style: its
  `no_` guards (minus modifiers now held) and modifier spelling. Refuses F10. Rebinding back to the original drops the
  marker. set_off comments a section's key lines out; put_back takes every change out of a mod (keys, keys turned
  off, the on-screen check) using the kept copies.
- on_screen: sets `$gachamod_onscreen = 1` in the sections that draw the character, `post $gachamod_onscreen = 0` in
  [Present], `global $gachamod_onscreen = 0` in [Constants], and `condition = $gachamod_onscreen == 1` (or
  `(old) && ...`) on key sections that have no on-screen check. Draw sections, best first: ones that already set an
  on-screen variable, Position/Blend with vb or draw, vb or draw, ib or drawindexed; never texture-only or
  `override_*`. A key ini that draws nothing uses another ini's flag through its namespace (`$\Ns\gachamod_onscreen`).
  An on-screen check the author already has is a variable set to 1 in an override (or by another ini through its
  namespace) and reset to 0 in [Present] or a command list it runs; keys that need a variable only gated keys set
  (`$menu` opened by a gated `[KeyMenu]`) count too. Those mods are left alone. Off takes everything out again.
  on_screen_all does it for every mod of a game, one backup each; after_install does it for new installs when the
  setting `keys.onScreenOnInstall` is "1" (one call at the end of install.rs's place_inner). on_screen_mods lists
  the mods (on and off) that have gachamod's check, so it can come out of one mod whose toggles stop working.
- clashes: key lines of enabled mods that one press fires together (same keys, guards that allow both). A pair counts
  when either side works off screen, or both are for the same character.
- outline: override section names with up to 6 telling lines each, for the AI helper; on_screen takes the sections
  it picks as `draw`.

UI:
- `ui/KeyEditor.tsx` (in the mod drawer, above the options): the keys as rows (what it does, from the GameBanana
  description when one of its keys matches, else the section name), each key a chip: click, Enter or A, then press
  the new keys, mouse button or controller buttons (Esc or B alone cancels). A toggle per key turns it off; "Toggles
  only while on screen" and "Put back original files" act on the whole mod. Each change records Undo with its backup.
- `screens/modtools/ModInsides.tsx`: sections "Options" (each persist var as a Segmented or Select over its values, shown by `names`
  when given ("Raiden Kimono", not "2"), current value selected; a merged mod adds "Split into separate mods" with
  Undo, saying what copying shared files costs, or the `blocked` reason,
  change calls modtools.setVar; when the game runs show a note and disable), "Problems", "Conflicts" (with "Keep this
  one" that turns the others off through library.setEnabled), "Readme" (collapsible, monospace).
- `screens/modtools/ModtoolsOverlays.tsx`: listens to onApp: `open-pack` -> PackImport dialog (preview list with
  checkboxes and GameBanana pictures for link rows, badges Download / No link / Off / In library, games that aren't
  set up listed and left out, existing-mod handling Segmented: Skip / Replace / Keep both, "Use its profile" or "Add
  its N profiles" toggle, progress bar from packs.onProgress, result toast with "Show downloads" when it queued
  any, else Undo where possible); `export-mods` / `export-profile` / `export-pack` -> PackExport dialog ("Share ...":
  packs.plan, title, what goes in the file as a Segmented (Links only / Links + mods without one / Every mod's
  files) with a size estimate, include options and key changes toggle, "Copy links" for pasting in a chat, Save as
  via `dialogs.saveFile`, then a toast with "Show in folder").
- `screens/modtools/ToolsPanels.tsx` panels for SYSTEM's Tools screen: ConflictsPanel (groups with mod names, "Keep
  one" actions, followed by Key clashes: each clash with "Only while on screen" for mods it can fix and the key as a
  chip to rebind, plus "Toggles only while on screen for all mods", the AI helper for mods it couldn't do, and a
  list of the mods that have gachamod's check, each with "Take it out" (opens by itself after the all-mods action)),
  ProblemsPanel (ProblemsPanel.tsx: warnings and broken problems per mod, each fix as a button with Undo, "Download
  again" from GameBanana or "Find on GameBanana" for a missing file or broken part with no fix in the files (a quiet
  button when nothing is broken), "Ignore" per mod and
  "Ignore all" (saved in setting "problems.ignored", listed under Ignored with "Show again"), "Fix all" for fixes
  that need no choice; Tools shows it first while something in it has a fix), HashLookupPanel (a field and results), PacksPanel (Share this game's library, Share
  every game when more than one has mods, Import a .gachamod), MovePanel ("Mods from other managers", Tools > Sharing,
  section "others": a row per manager with mods for the current game. IMM and No Reload Mod Manager get "Move mods"
  with a Confirm, since they move folders; the rest from migrate.detect get "Bring in" (copy, one click, Undo in the
  toast) and "Move instead" with a Confirm when they keep mods outside Mods; a manager that is open shows "Check
  again"; "Choose a folder" and "Choose a backup file" pass `picked` for SkinSelectImpact and Fairy's Secret Folder).
  The first start (Onboarding) names the managers found (lib/otherManagers.ts) and links there. Set the "tools" nav badge.
- Demo handlers with believable data for every command.

## Downloads and Browse (ONLINE)

`lib/gamebanana.ts` (TypeScript, fetch, real API in demo and app; research section 2):
- `gameInfo(gbId)`: name, icon, banner (cache in sessionStorage).
- `listMods({ gbGameId, page, perPage<=50, sort, categoryId?, search? })` -> `{ items: GbCard[], total, complete }`
  using Mod/Index (sort keys: newest, updated, downloads, likes, views) or Util/Search/Results for text (15 per page).
  That search ignores who made a mod, so Browse first lists `modsByNamedCreator`: mods by a member named like the
  text (exactly) or like one of its words (close, see `nameClose`), matched against the other words. When no member
  fits and no mod on the plain search's first page has every word (GameBanana drops words it can't place), it reads
  up to 8 pages of a search for the other words for mods by a close name ("burnice haezeker" finds Burnice mods by
  "Haezeker_").
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
Rust: `install.rs` (stage with archive::extract into `<data>/staging/<id>`, then unpack archives inside it that
aren't inside a mod folder, up to 5 levels in all and 400 inner archives (a dropped folder gets the same); find_roots
per "Finding mods" over the staging folder. A bundle installs each mod on its own without asking: candidates are
separate mods when they came from different inner archives or match different characters, and the candidates of one
inner archive for one character become one mod with parts. An inner archive that won't open is noted in the toast.
A queue row always says what it is doing (`QueueItem.progress`, filled through `install::with_progress` and
`download::download_noting`): what a waiting row waits behind, connecting, a dropped connection's retry countdown, a
move to another server and why, checking the file, each archive being unpacked with its count and the size out so
far, and for a bundle the list of mods found with a tick for each one in place. A download with no new bytes for ten
seconds says so. Finished rows come in batches (`downloads/Batches.tsx`): a download added before the last one of a
batch finished, or within ten minutes of it, joins that batch. A batch has Turn all on, Turn all off and Clear. A row
that installed one mod has its switch; a row with several shows "3 of 18 on" and opens a list with a switch per mod,
Turn all on and Turn all off (open by itself for a quarter hour after it finishes). All of these go through
`toggleMods`, so the one-skin rule and Undo work as in Mods;
 place moves (rename, fall back to copy+delete across drives) into Mods; replace keeps the old
sidecar id, enabled state and folder name, moves the old folder to trash with reason "replaced" first; anything else new
comes in off (`DISABLED <name>`): the backend never turns a mod on. The UI then turns new mods on when "Turn on new
mods" (`mods.enableNew`) is on, through `library/afterInstall.ts` with the one-skin rule (see below); with it off the
user turns them on from the details or GameBanana page (which shows a switch once it is installed); preview_url
is downloaded to `preview.jpg` (best effort, short timeout); register with library::add_folder; clean staging.)
`queue.rs` + `runner.rs`: persistent queue (queue_items rows), up to 3 downloads at once, installs one at a time,
`queue` events with the full QueueSnapshot on state changes only; progress goes out as `queue-progress` (about 8 a
second, all running items together): `[{id, received, total}]` for downloads and `[{id, progress}]` for install
steps, and the UI patches those rows, cancel and retry (cancel keeps the .part file and retry resumes
from it, and the Downloads page offers Undo after a cancel; removing or clearing the row deletes it, and at start .part files no row points at are deleted), NeedsChoice when
an archive holds several candidates (emit variants-needed; `queue_choose` installs the picked keys; setting
"downloads.allParts" "1" installs every key without asking). Several picked keys install as one mod whose parts are
the picked folders (`library::parts`, `set_part` renames a part's folder with DISABLED); a part that overrides a hash
an earlier part does starts off. `library::merge` combines existing mods the same way, and the first scan of each
game merges mods an older version installed one per folder from the same archive (setting "<game>.partsMerged"). Emits
`library-changed {game}` after installs and a `toast` event ("Installed Coca Cola for Ellen Joe") with `open: {game,
modId}`, which gives the toast an Open button for the mod's details. Downloads go to
`<data>/downloads/<game>/`; keep the archive (setting "downloads.keep" default "0": delete after install).
A GameBanana download under 1 MB/s for 8 seconds, with 8 MB or more to go, carries on (a Range request from the
.part) on another `filecache<N>` server picked at random, at most 3 moves per download (`download::GAMEBANANA`).
Another server that fails, can't resume or gives another size sends it back to the `/dl/` link. Setting
"downloads.otherServers" "0" turns this off. Each move is logged.
`install_local`: archives (zip/7z/rar) and folders; for a folder, copy it (don't move the user's folder).
gachamod:// links (deep-link event -> app event open-gb-link): `gachamod:https://gamebanana.com/mmdl/<fileId>,Mod,
<modId>` queues that file at once; `gachamod://mod/<modId>` opens it in Browse.

UI:
- `screens/browse/Browse.tsx` (view "browse"): GameBanana for the current game. Top: search field, sort Segmented
  (Popular, New, Updated, Most liked), character chip strip with portraits (characterList), category menu, NSFW
  setting (Hide, Blur, Show; setting "ui.nsfw", default "blur"). A masonry or uniform grid of large preview cards
  (image, name, character, submitter avatar, likes, views, date, "Installed" or "Update" badge by matching
  source.modId against the library list) with infinite scroll: 50 mods a page, cards shown 36 at a time (18 on
  Home), and the next batch always loaded before it is needed, so scrolling near the end shows it at once. Skeleton
  cards only while that batch hasn't arrived yet.
  Clicking opens the mod page in a wide Drawer: image gallery with a lightbox (arrow keys), title, submitter, stats
  (the heart likes, the bell subscribes, the gift thanks the creator, downloads goes to the files, comments to the
  comments; signed out they start signing in to GameBanana), description (sanitised HTML), files list each with size, date, download count, analysis status and an Install
  button (primary on the newest file; "Update" when this mod is installed with an older file; "Reinstall" when same),
  "Open on GameBanana". Opening `route.modId` opens that page; `route.character` preselects the character chip.
- `screens/downloads/Downloads.tsx` (view "downloads"): active items with thumbnail, name, progress bar, speed and
  time left, cancel; finished items with "Show in Mods" (go library with modId), retry for failures, "Clear
  finished". Failures and pending choices not looked at yet are highlighted; one counts as seen when its row is
  hovered, focused or clicked, or after Downloads has been on screen 5 s (`screens/downloads/seen.ts`, kept in
  localStorage by id, state and finish time, so a retry that fails again is new).
- `screens/browse/OnlineOverlays.tsx`: the variant picker dialog (variants-needed: candidate cards with preview, ini
  count, size; checkboxes; "Install chosen"), handles `install-paths` (installs.local; needsChoice -> same picker;
  toast result), handles `open-gb-link` (parse; go to Browse with modId, or queue the file for mmdl links), keeps
  the downloads badge current from queue.onChange: running and waiting downloads, then unseen failures.
- Demo: queue handlers that fake progress over a few seconds and then add a mod to demoDb.mods.

### Browse in detail (current build)

Mod of the day: picks live in `curated/mod-of-the-day.json` on the main branch (`{ enabled, picks: [{ date, game,
modId, name?, note? }] }`). `node scripts/motd.mjs <link> <game> [date] [note]` adds one, `on` / `off` switches the
feature; commit and push to publish. Only people who can push to the repository can change it, so the app needs no
sign-in or machine check. The app reads the file at most every 12 hours. While `enabled` is false nothing shows;
when true, Browse's header gets a gift button for the current game's pick (today's, or the latest within three
days), and Settings, Fun extras gets a switch to hide it (which also stops the reads).

- One component, `GbBrowser { game, embedded?, onExpand?, character? }`, is the Browse page, the Home section
  (fixed height, Expand keeps the filters because they live in the per-game store) and the character page list
  (character fixed). `GbStrip` is a single scrolling row (wheel, arrows, keyboard, controller) with "See all".
- Sort, type, High quality, Following and Hide installed are remembered per game in localStorage
  `gm.browse.filters.<game>` (`useFilters`, `setFilters`). The character, category and search last only while the
  browser stays open: a browser that mounts fresh drops them (`beginVisit`) unless something opened it to show them
  (`openWithFilters`: a category link, See all, Expand). A saved filter set keeps them on purpose. Sorts: For you, New, Updated, Popular this week, Popular this month, Most downloaded, Most
  liked, Most viewed, and Relevance while searching: a new search switches to it (For you would only search its own
  picks) and clearing the search puts the earlier sort back. Week and month are worked out here from the newest pages (up to 10) ranked by likes + views/100 +
  comments/2, because Game/TopSubs only gives three. Picking a character clears the category and the other way
  round. Active filters show as chips you can remove one by one or with "Clear all".
- The character row and grid come from `useCharacterList(game)`: stale-while-revalidate from
  `gm.gb.chars.<game>`, refetched after a day or when a mod names a character category that isn't in the list
  (at most every 10 minutes). Nothing is hard-coded.
- Type: All types, Outfits, Recolors and textures, Weapons, Tools and fixes, UI, Other (`GbCard.kind`, from
  `kindOf` in gamebanana.ts). GameBanana only has categories, so inside Skins the name decides: "Danica Darker
  Recolor", "Claret Eye Recolour", "arlecchino makeup", "[Tex] ..." are texture edits, "X over Y" and names with
  outfit or body words are outfits, a "+ Makeup" part doesn't count, and a mod whose only "Software Used" tags are
  paint programs is a texture edit. In Other/Misc a mod is a tool when its name (without bracketed version notes)
  names a fix, remover, shader, ReShade, camera and so on. A picked type also narrows the GameBanana request to its
  top category where there is one (Skins, Other/Misc, UI).
- High quality is about the top fifth of a game's outfits for their age, and only outfits unless a type is picked
  (then the top fifth of that type). A = likes + views/100 + comments/2. shape(age) = (0.7(1 - e^(-age/0.9)) +
  0.3(1 - e^(-age/14))) * sqrt(1 + age/365), fitted on the 1,600 newest mods of ZZZ, GI, HSR and WW: a third of a
  mod's attention comes in its first day, about 70% within a week. bar and median are the 80th and 50th percentiles
  of A/shape over the type's mods aged 3 to 60 days among its 200 newest (kept a day, `gm.gb.hqbar.<gb id>[.kind]`).
  The creator's record T is the median A/shape of their mods in the game aged 3+ days (one request per creator,
  kept 3 days in `gm.gb.records`, only fetched when it could change the answer; kept ones are always used and at
  most 16 more are fetched a call). A creator with fewer than two such mods in the game takes their best record
  from another game that has a kept bar, as record / that bar times this game's bar (`borrowedRecord`), else the
  game's median, and T is at most 1.5 bar. When the bar can't be measured, the game's last kept bar is used at any
  age. est = (A + 0.25T) / (shape + 0.25), times 1.2 if featured; a mod passes when est >= bar (`hqScore`
  returns est / bar, `HQ_PASS` = 1). So a new mod by a creator whose mods usually reach the top fifth shows at
  once, and a day-old mod with 30 likes by a creator whose mods stay under 100 doesn't. Prioritised creators always
  pass. About 20% of outfits pass in each game measured.
- For you (a sort, a Home strip via `GbStrip { sort: "foryou" }`) and Surprise me (the dice button, also in Home and
  the search) come from `lib/recommend.ts`. Candidates: the month's most liked mods, the newest and most liked for
  the 4 characters with the most mods in the library, and new mods by followed or favourite creators. score =
  quality (capped 2.5) * (0.5 + character share) * (1 + 0.6 creator) * type weight; installed, removed, hidden and
  blocked mods never show, and each further pick for the same character or creator counts 18% less. Surprise me
  opens one of the best 25 at random (better ones more likely, not one it showed lately). Right-click the dice for
  "Ask your chatbot for ideas" (AI shown at "all"), a task of kind "recommend" with the library summary.
- Creators: Follow, Favourite, Prioritize and Block (setCreatorFlag, with Undo). Prioritised creators' mods come
  first with a crown; blocked ones are hidden everywhere. "Following only" merges the followed creators' newest
  mods. A creator page is `{ view: "browse", user: <id> }` (profile, their mods for this game, then other games).
  The `gm-find-creator` window event `{ name, modId }` finds a member id and opens that page.
- Any route with a numeric `modId` (Browse, Home, Downloads, character pages) opens the GameBanana drawer on top
  (`openGbMod`, closed with closeRoute(["modId"])). The drawer description keeps GameBanana's headings, colours
  (clamped so they read in light and dark), lists, tables, spoilers (click or Enter) and centring. Images open the
  lightbox, links to GameBanana mods and members open in the app, other links open in the browser, YouTube embeds
  become a link card. A Keys section lists the hotkeys found in the description; comments load when you scroll near
  them. Adult mods get an adult switch in the drawer header.
- Adult content: "Show" draws a small muted 18+ mark, "Blur" blurs the image and shows the red 18+ tag, "Hide"
  leaves the mod out of every list.
- Removed before: `library.archive(game)` (errors count as an empty list). A GameBanana mod whose id matches a
  removed mod says "Removed" (opens Mods, Trash) and its Install button reads "Reinstall".
- Menus: `gbmod` (install, choose a file, details, character page, creator submenu, open on GameBanana, copy link,
  adult options, not interested) and `creator`. Commands: "Search GameBanana for <text>", followed creators,
  "<character> mods online".
- Downloads shows the current game's items; the "All games" toggle (remembered, or route tab "all") shows every
  game grouped by game.

## Games, XXMI, launching, tools, settings (SYSTEM)

Rust:
- `games.rs` detect: XXMI first (xxmi::status: for each importer in the config with a game_folder or an existing
  importer folder, save game_dir, importer_dir = `<root>/<importer_folder>`, via_xxmi = true), then for games still
  without a game folder: HoYoPlay gamedata.dat under %APPDATA%\Cognosphere\HYP, KRLauncher kr_starter_game.json,
  GRYPHLINK registry and folders, Steam library folders (libraryfolders.vdf) by steam_app (the game may sit one
  folder below the app's install folder), and the MuiCache / FeatureUsage registry scans (research 1a). A community game (xxmi false) gets an importer folder only from the
  user. Never overwrite a folder the user picked unless it no longer exists (store a `user_set` flag in game_paths
  through `migrate` with an ALTER TABLE guarded by has_column). `list` fills importer_version/latest from XXMI's
  config, `running` from launch::running, and counts from the `mods` table (`SELECT data FROM mods WHERE game=?`,
  count enabled from the JSON).
- `xxmi.rs` per its module doc. `launch` runs `"<root>\Resources\Bin\XXMI Launcher.exe" --nogui --xxmi <CODE>` with
  the working dir `<root>\Resources\Bin`, detached, no console window.
- `launch.rs`: config reads XXMI fields when via_xxmi (launch_options, process_priority, window_mode, run_pre_launch*,
  run_post_load*, and game-specific extras: configure_game for GIMI, WWMI and ZZMI only (GI: turns off dynamic
  character resolution; XXMI no longer reads disable_dcr); GI unlock_fps, unlock_fps_value, enable_hdr; WW
  unlock_fps, disable_wounded_fx, force_max_lod_bias, mesh_lod_distance_lod_base_fov (these three need
  configure_game on), resource_tier; plus Migoto block, where enforce_rendering is XXMI only) and gachamod's own
  `"<game>.launch"` setting otherwise. set_config writes them back (xxmi::set_importer_config; XXMI must be closed:
  Error::Conflict "Close XXMI Launcher first, it saves its settings when it closes"). launch: via XXMI (vanilla false)
  or the exe directly (vanilla true, or no XXMI). The Steam copy of ZZZ (`STEAM_ONLY`, a game folder under
  `steamapps`) only starts from Steam: a direct start runs `steam.exe -silent -applaunch <app> <args>`, and the first
  start through XXMI while its Game Launch is "DIRECT" sets it to "STEAM" and raises ZZMI's process_timeout to 90 s
  (xxmi::launch_through_steam; an XXMI without `configure_platform_launch_options` is too old and the toast says to
  open it once so it updates). A Steam that has just started drops a `-applaunch` until it is signed in, so both
  paths get Steam ready first (`steam.rs`, `steam::get_ready`): Steam closed is started with `-silent`; then gachamod
  waits for the sign-in (`HKCU\Software\Valve\Steam\ActiveProcess` ActiveUser non-zero with a live pid, 90 s) and 5 s
  more. Through XXMI it also writes the launch options XXMI would (`xxmi::steam_launch_options`, research 1a) into the
  localconfig.vdf XXMI reads, with a backup and every other byte kept. A running Steam has to close for that
  (`-shutdown`, 30 s), so it restarts once and the toast says so; XXMI then finds the options equal and only sends its
  `-applaunch`. If XXMI restarts Steam anyway, `steam::watch_restart` sends `-applaunch` once after that Steam signs
  in, while XXMI still runs and Steam's `Apps\<app>` Running is 0. Every wait carries on with the launch when it runs
  out. Genshin Impact's FPS limit (`unlock_fps_value`) never goes above `GI_FPS_CAP` (120; above it the game
  disconnects the player with "Illegal tool detected"): the form shows and saves at most 120, and a start through XXMI
  lowers a higher value in XXMI's config first and says so in its toast. The same kick at 120 or lower usually means
  the anti-cheat flags XXMI's d3d11.dll. Settings › Launch for Genshin Impact links the community guide
  (gamebanana.com/tuts/19132: an older GIMI d3d11.dll kept in place with XXMI's Unsafe Mode) with a ban warning, and the global search finds it under "Illegal tool detected".
  Before a start with mods through XXMI, Play warns (home/KickWarning.tsx: Cancel, I did the fix, Play anyway) unless
  `launch::kick_check` finds the fix: GIMI's d3d11.dll differs from XXMI's own `Resources\Packages\XXMI\d3d11.dll`, or
  it equals the SHA-256 saved in `gi.kickFixDll` when the player said they did the fix (the Launch options panel's "I did this
  fix" switch, or the warning's button). An XXMI update that puts its own DLL back brings the warning back. gachamod
  only reads the two DLLs and never automates any part of the fix: no swapping, repacking or patching of XXMI's DLLs,
  and no other way of starting the game to get past the anti-cheat. For any game through XXMI, Settings › Launch also
  mirrors XXMI's own DLL settings under "How XXMI loads mods" (`LaunchConfig.dll`, search "How XXMI loads mods"):
  Injection mode (`xxmi_dll_inject_mode`: Hook, Direct, Skip) and Inject libraries (`extra_libraries_enabled`) save
  with the form; the player sets each by hand. XXMI signs Unsafe Mode and the library list (`unsafe_mode_signature`,
  `extra_libraries_signature`; it resets an unsigned one), so gachamod never turns Unsafe Mode on or edits the list,
  never touches either signature, and only turns Unsafe Mode off through its own command (`launch::unsafe_off`, so a
  stale form can't). The page reads the form again whenever the window gets focus, unless an edit is still unsaved.
  The Play warning for Genshin Impact walks through the guide's steps (`tools/KickSteps.tsx`; also under "Steps from
  the guide" on Settings › Launch, sharing the form there): open GIMI's v7.0 release page for
  3dmigoto-GIMI-for-playing-mods.zip, take d3d11.dll out by hand, open the GIMI folder to paste it (keep d3dx.ini), open
  XXMI Launcher to turn on Unsafe Mode, then Injection mode Direct and Inject libraries off as the settings themselves.
  A step shows a check when gachamod sees it done (the DLL steps once `kick_check` says `fixed`), read again whenever
  the window gets focus. gachamod never downloads, extracts or copies the DLL.
  Then a
  background watcher (spawned thread) polls processes every 3
  s for up to 10 minutes and emits game-state through a callback the command passes (add a `on_state` parameter
  pattern in the command, emitting events::GAME_STATE). running: process list via `tasklist /FO CSV /NH` (no extra
  crates) or the Toolhelp API through `windows-sys` if you add it; must take under 150 ms.
- `devtools.rs`: per its doc. reload_in_game: find the game's window (EnumWindows by process id or title), bring it
  forward, send F10 down/up with SendInput or keybd_event (add `windows-sys` with the needed features if you must),
  refuse with a clear message if the window isn't found.
- `platform.rs`: `gachamod` URL scheme (HKCU\Software\Classes\gachamod: default "URL:gachamod", "URL Protocol" "",
  shell\open\command `"<exe>" "%1"`), `.gachamod` file association (HKCU\Software\Classes\.gachamod -> gachamod.pack,
  with an icon from the exe and open command). Both are on by default: register_free on every start (dev builds too)
  takes whatever is free or held by another copy of gachamod, never one another program holds, and skips one the
  user turned off in Settings (setting `integration.<id>` = "0"; off removes gachamod's entry). The NSIS bundle also
  declares the association (tauri.conf.json).
- Background: a game-state poller for the current shown games every 5 s while the app is open is fine if cheap;
  otherwise only after a launch.

UI:
- `screens/home/*` (HOME/PROFILES area). `Home.tsx` (view "home") is a stack of full-width widgets, in the order
  and with the ones shown that the user set in Customise (setting "home.layout": `{ order, hidden }`, see
  `layout.ts`; unknown ids are dropped and new ones added at the end):
  - Play and profiles: the game's banner, name, loader status and "10 of 24 mods on", the big Play button, one chip
    per profile (one click switches, right-click for the profile menu, + saves the mods on now as a new one) and
    quick actions: Rescan, Check for updates, Open the Mods folder, Import .gachamod, Surprise me (dice, opens a
    random "For you" pick) and Hide/Blur/Show for mods for adults.
  - Updates (mods with a newer version, Update on each and Update all), New high-quality mods
    (`GbStrip { hq: true, sort: "new" }`), For you (`GbStrip { sort: "foryou" }`), Your characters (portraits with
    how many mods are on, click opens the character page), From creators you follow (`GbStrip { followed: true }`),
    Recently installed, and GameBanana (`GbBrowser embedded`, Expand opens Browse).
  - A widget with nothing to show (no updates, no follows yet) is left out. Customise (the button under the widgets,
    or "Customise Home" in search) shows every widget with Show/Hide and Move up/down (Alt+Up, Alt+Down); Done or
    Esc ends it, and all of it undoes as one step.
- `screens/home/PlayButton.tsx`: the Play button in the sidebar and on Home (game running: "Running" with the time,
  disabled; Starting until the game runs; Set up when no folder is set). The three-line button next to it ("More ways
  to start") has Play without mods, Open XXMI Launcher and Launch options. Ctrl+Enter presses Play.
- `shell/AccountCard.tsx`: the GameBanana account at the top of the sidebar, in place of the old player card (its
  classes stay so themes still dress it). Signed out it reads "Sign in" and one click opens GameBanana's sign-in
  window (`lib/account.ts`); signed in it shows the GameBanana name and picture, and a click opens: your GameBanana
  page (in Browse), follow who you follow there, sign out. Extensions asking for "player" get the GameBanana name.
  Signed in, "Mods for adults" follows the content settings on the GameBanana account ("Match my GameBanana
  settings", setting `"gb.matchAdult"`, on by default; under Mods for adults and under GameBanana account;
  command `gb_content_settings`). docs/gb-account.md, "Content settings", has when it applies and how the ratings map.
- `screens/tools/Tools.tsx` and `screens/settings/*`: owned by SETTINGS/AI now, see "Settings, Tools and the AI
  helper" below.
- First start (`screens/settings/Onboarding.tsx`, `lib/setup.ts`), no window and no questions:
  - When XXMI Launcher already has a game with a Mods folder, the app opens on it. One toast says what was found and
    that usage counts and crash reports are sent ("Turn those off"); others offer loaders for other games on this PC
    and moving mods Integrated Mod Manager keeps. A card bottom left (not a window) offers the Mods layouts, with the
    one resembling a manager found already picked; the setup page has the same picker. See "Library".
  - When no game has a Mods folder, the main view is the setup page: the games found and one button, "Install mod
    loaders", which downloads XXMI Launcher and each game's loader from GitHub and sets them up
    (`xxmi_install`, gacha-core `xxmi_setup.rs`; progress on "xxmi-setup"). No game found: "Look again". The page
    looks again every 10 seconds and on focus, and `watchSetup` keeps looking (focus, every 30 s) while a shown game
    has no Mods folder. Settings and Extensions stay reachable.
  - Everywhere a Mods folder is missing (Settings, Games, the Play button's Set up, a failed download and its toast),
    the first button installs the loader or looks again (`getReady`), and picking a folder by hand comes second
    (`pickModsFolder`).
  - Uninstalling (`xxmi_uninstall`, `xxmi_setup::uninstall`): Settings, Games has "Uninstall mod loader" per XXMI game
    and "Uninstall XXMI Launcher" (asks first). Files go to the Recycle Bin (`recycle.rs`); each Mods folder and
    d3dx_user.ini stay. One loader also comes out of XXMI's config (enabled importers, deployed version) so XXMI
    sees it as gone; all of them also takes the shortcuts that point into the XXMI folder. It refuses while XXMI
    Launcher or that game runs. The games forget the loader (`games::forget_loader`) and are looked for again. The
    toast has "Install again".
  - Sets "onboarded" = "1". A first setup turns on the first-start hints for that session (`shell/hints.ts`): Browse
    looks faintly selected until opened, the first Browse card's Install button and the drawer's Install button get
    a faint outline until the first install, and Downloads looks faintly selected while a download runs until
    opened. Settings, General, First-start hints turns them off ("hints.on"). There is no tour.
- Every window's WebView2 starts with `CalculateNativeWinOcclusion` disabled (`browser_flags` in
  `src-tauri/src/lib.rs`): with more than one monitor, WebView2 could decide the window was covered and stop drawing
  it, so it stayed black until the mouse moved over it.
- Every window's page keeps itself drawn (`lib/redraw.ts`): on some PCs the window was left black after another
  window took focus, until the page drew a frame. The page draws one frame a second while it is on screen and every
  frame for 2 s after focus, size or screen changes; `render.rs` asks for the same on the window's own focus, screen
  and scale events. A frame is a change nobody can see: a corner pixel, and for those 2 s a sheet over the window,
  both black at under 2%.
- Hardware acceleration (Settings, General; "app.gpu", default on). Off adds `--disable-gpu
  --disable-gpu-compositing`, from the next start (the toast has Restart). `src-tauri/src/lib.rs` reads it before it
  makes the main window ("create": false in tauri.conf.json), and the menu over the game uses the same flags, since
  WebView2 won't start a second window in the same folder with other flags. Starting `gachamod.exe --disable-gpu`
  saves it off first; a copy already running saves it and restarts.
- Rendering log ("render.log", default on; Settings, Feedback and privacy, and under Hardware acceleration in
  Appearance). `gacha-core render_log.rs` keeps the files in `<data folder>/logs/rendering`, `src-tauri render.rs`
  feeds it and `lib/renderWatch.ts` reports from the page. It logs window focus, moves, size and scale, screens
  changing, sleep gaps, WebView2 processes exiting (`ProcessFailed`), the page's frames stopping or slowing, long
  stalls and lost WebGL contexts. Every 2 s it reads the screen where the main window is (only while no other window
  covers it and the PC was used in the last 50 s). The first black read asks the page for frames; a second in a row
  is a blackout. If WebView2's own picture of the page isn't black then, `recover` makes WebView2's view a pixel
  shorter and back, then hides and shows it, reads the screen after each, and notes which brought the picture back.
  Each problem writes
  `incident-<time>.txt`: the window from every side (Windows, the screen, WebView2's own picture of the page saved as
  `.png`, the page's frame counter), `system.txt` (cards, drivers, screens, GPU scheduling, MPO), the last 400 events,
  graphics driver and WebView2 crash entries from the Windows event log, and the end of WebView2's `chrome_debug.log`
  when there is one. WebView2 only writes that file when gachamod starts with `--browser-log`, which adds
  `--enable-logging --v=0` to every window's flags and makes WebView2 open a console window. While crash reports are
  on, a summary of each incident goes to the developer as a `render` crash report (docs/telemetry.md). Feedback with logs
  attached sends the newest incident too.
- New mods turn on when they install ("mods.enableNew", default on; Settings, Mods, and the Downloads header). The
  runner's install toast lists the new ids (`installed`) and `library/afterInstall.ts` turns them on with the one-skin
  rule and one quiet Undo step. The first time it says so with "Keep new mods off". When the character now has two or
  more skins and isn't switched in game yet, the toast offers "Switch in game" (live switching).
- One-game mode (Settings, Games, or "Only show X" in a game's menu; "gm.onlyGame"): only that game shows in the
  sidebar, its switcher and Ctrl+Tab. The other games stay set up, the switch menu lists them under "Other games",
  and search still finds them.
- Logs, crash reports, usage counts and feedback (`logs.rs`, `telemetry.rs`, `commands/report.rs`,
  `lib/telemetry.ts`; docs/telemetry.md has every event). The log and crash files live in `<data folder>/logs`.
  Usage counts and crash reports go to PostHog when they're on (both are on by default, with switches in Settings,
  Feedback, privacy and logs, and a line in onboarding). Feedback is sent from a form opened from Settings, the title bar's
  Help menu, the search ("Send feedback") and a screen that hit an error.
- Running as administrator: Settings, Games has "Restart as administrator" and an "Always" switch (Windows'
  RUNASADMIN flag for gachamod.exe under HKCU AppCompatFlags\Layers, which the installer also sets when the player
  says yes; `src-tauri/windows/hooks.nsh`). The F10 note for a game that runs as administrator says why, and its toast
  has the restart button (`lib/elevation.ts`). A copy that isn't an administrator hands its link or file to one that is
  (`devtools::hand_to_elevated_copy`), since Windows hides that copy from the single-instance check.
- Check this game (`gamecheck.rs`, `screens/settings/GameCheck.tsx`, opened from the Help menu, Settings, Feedback and privacy,
  privacy and logs, and the search): five steps through switching skins while playing, each answered Yes, No or Skip, next to
  what gachamod saw by itself (the game saved a pick, gachamod opened the menu, it read a pick back). The answers and
  the game's setup go to PostHog as one `game check` event. docs/testing.md is the tester's side.
- `npm run installer` builds the installer and gachamod setup with build-machine folders written as `~`
  (scripts/build-installer.mjs).
- gachamod's own updates (`src-tauri/src/commands/app.rs`, Tauri's updater plugin; `app_update.rs` keeps version
  numbers). The feed is `releases/latest/download/latest.json` on imanimal/gachamod, and the updater only installs an
  installer signed with the key in `%USERPROFILE%\.tauri\gachamod.key` (its public half is in tauri.conf.json, plugins
  > updater). With "app.updateCheck" on (default), it checks 12 s after start and every 6 hours, downloads a newer
  version quietly and toasts "gachamod X is ready" with Restart now; at quit (`RunEvent::Exit`) it runs the installer
  without reopening gachamod. Set to "tell" (Only tell me), it checks on the same schedule, downloads nothing and
  emits `app-update-found` once per version, which toasts "gachamod X is out" with Update now. "0" never checks by
  itself. Settings, About shows the state (`app_update_status`) with Check now and Update now or
  Restart to update. The NSIS installer runs passive (a small progress window), per user, no administrator.
- `npm run release -- <version>` sets the version in tauri.conf.json, package.json, package-lock.json and Cargo.toml,
  builds the signed installer, writes latest.json, commits and pushes, and makes the GitHub release v<version>
  (scripts/release.mjs). Without --notes the notes are the commit subjects since the last release.
- Uninstalling removes the program, its RUNASADMIN flag, and the `gachamod:` link and `.gachamod` file keys when they
  still open that copy (`hooks.nsh`). Mods stay where they are. NSIS's own "Delete the application data" also removes
  the data folder (settings, profiles, trash) and HKCU\Software\gachamod.
- gachamod setup (`src-setup`, page in `src/setup`, `setup.html`): the window people download, install, repair and
  uninstall with. `gachamod-setup.exe` is the setup program with the NSIS installer appended (`payload.rs`;
  `scripts/build-installer.mjs` makes it and copies named for each game). It runs that installer quietly (`/S /D=`), so
  updates, the uninstall entry and `hooks.nsh` work as before, and any NSIS switch (`/S`, `/P`, `/D=`) passes straight
  to it. Its look (`look.rs`): `--theme <id>`, else a game named in its own file name (`gachamod-setup-zzz.exe`), the
  page that linked the download or the download's address (Windows' Zone.Identifier, `?theme=` or `?game=` too), else
  the look gachamod last showed, else Default. The app writes that look to `look.json` in its data folder when the
  theme changes (`save_look`, from `lib/theme.ts`), so repair and uninstall wear the game in use.
  - Every setup installs the same gachamod, which manages all games. A fresh install from a game's own setup (named
    by file, link or `--theme`, not by look.json) leaves `setup-game.json` in the data folder; the first start reads
    it once (`setup_game`) and turns on one-game mode for that game. `gachamod-setup.exe` leaves none.
  - Install: one button, with Options for the folder, desktop shortcut, starting as administrator, opening when done
    and setup's own look. The choices go to HKCU\Software\gachamod (`adminAsked`, `admin`, `desktopShortcut`), which
    `hooks.nsh` reads instead of asking. An older install shows Update; the same or newer shows Open, Repair and
    Uninstall. Versions compare with their beta part, so the beta.3 setup over beta.2 is an update.
  - Over an installed copy, when setup carries nothing newer (the `setup.exe` next to gachamod, or an old download),
    it asks GitHub for the newest version (`latest`, from `latest.json`, 10 second limit) and shows "Update to X" when
    it's newer. `update` downloads that installer like Repair does, so a copy of gachamod that won't open can still be
    updated. While it looks, a line says so; if GitHub can't be reached, a line says that with Try again.
  - The installer puts `setup.exe` next to gachamod and points the uninstall entry at it (`UninstallString`
    `setup.exe --uninstall`, `ModifyPath` for Repair or Uninstall, `QuietUninstallString` stays NSIS's). Settings,
    About has Open setup when it's there. Run from the install folder it copies itself to `%TEMP%` first so the folder
    can go.
  - Repair runs the installer inside setup when it's at least the installed version, else downloads the newest
    `latest.json` installer and checks its signature with the updater key. Uninstall runs `uninstall.exe /S _?=<dir>`,
    then removes setup.exe and the empty folder; "Also delete gachamod's data" moves the data folders to the Recycle
    Bin and clears HKCU\Software\gachamod.
  - Without WebView2 the download falls back to the plain NSIS installer (which installs WebView2, and offers to
    replace an older copy itself) and `--uninstall` to NSIS's uninstaller. Windows' Modify button opens the latest
    release page, whose setup carries the newest installer.
  - It's built with `--profile setup` (Cargo.toml: size over speed), about 6 MB instead of 13. `npm run setup` runs it
    from source against `npm run dev`; the page alone is http://localhost:1420/setup.html, with `?mode=`, `?theme=`,
    `?installed=<version>`, `?latest=<version>`, `?offline=1`, `?running=1` and `?fail=1` for the demo.
  - Checked on one PC: install, repair over the same version, uninstall from the window and with `/S`, closing a
    running gachamod, the desktop shortcut choice, temp cleanup, and the theme from the file name and from look.json.
    Not checked yet: a PC without WebView2, an update from 0.1.0 through the app's updater, repair when the download
    is older than the installed copy (the GitHub download), Update to X from `setup.exe` (also a GitHub download), and
    a theme from the page that linked the download.
- Demo handlers for every SYSTEM command.

## Settings, Tools and the AI helper (SETTINGS/AI)

Files: `screens/settings/*` (not AccountSection.tsx), `screens/tools/*` (not FixesPanel.tsx), `screens/ai/*`,
`lib/ai.ts`, `src-tauri/src/commands/ai.rs`, `lib/demo/ai.ts`.

### Settings

- `Settings.tsx` (view "settings"): pages listed on the left in groups (`Paged.tsx`, shared with Tools). A page
  holds the panels that belong together, so the list stays short. The groups follow the usual desktop order (the
  app in general, what it manages, the services it connects to, then feedback and the version), and no page is a
  single tiny panel that belongs with another. Page ids, with their panel ids: General has "general" (general,
  graphics), "appearance" (appearance, layout, themes), "hotkeys" and "fun"; Games and mods has "games" (games,
  xxmi), "launch" (launch, migoto, game-start), "mods" (mods, mod-folders, automatic, broken-mods, storage) and
  "downloads" (installing); Online has "gamebanana" (account, integrations, creators, adult), "ai" and "extensions";
  App has "feedback" (feedback, privacy, logs) and "about" (about, updates, transfer, repair). The pages are `PAGES`
  and the panels `SECTIONS` in `settingsSearch.ts`. Old page ids that are now panels ("account", "creators") still
  route, to the page that holds them.
- Page names are a word or two: General, Appearance, Hotkeys, Fun, Games, Launch, Mods, Downloads, GameBanana, AI
  helper, Extensions, Feedback and privacy, About and updates. Each page's hover tip lists everything on it, and its `keywords` keep the older long names
  ("Mods and downloads", "About and updates") so the search still finds them. A panel holds one kind of setting under
  a heading that names it: "Downloads and installing", "Mod update checks and rescans", "Mods a game update broke",
  "Trash and removed mods", "Hardware acceleration and rendering log", "gachamod updates", "Repair, reset or
  uninstall". A setting that fits no panel gets a new panel, not a row under a vague heading. The ids stay short and
  stable; only the names change.
- A search field sits above the page list in Settings and in Tools ("Search settings and tools"). It searches both
  menus at once: Settings' pages, panels and single settings (`settingsSearch.ts`) and Tools' pages and panels
  (`tools/toolsSearch.ts`), with `scoreCommand` from the global search, so keywords and translated names both match
  (`settings/menuSearch.ts`). While it has text, the page area shows the matching panels themselves, live, in the menu
  the search ran in (`SearchResults.tsx`): a Settings panel found from Tools works right there. Each page's panels sit
  under "In Settings, Appearance" with an Open button that goes to that page, and single settings that matched are lit.
  With no match it says so and offers the global search with the same words. Ctrl+F and / focus the field, Escape
  clears it and then leaves it for the page list, Arrow Down goes to the first result, and clearing it or picking a
  page brings the page back. Each screen registers its panels by route id (`registerPanels`) for this.
- A panel on a page has no fill
  or theme frame, only a thin outline in the theme's line colour, so a short page isn't a card floating over an
  empty screen. New Eridu blurs its background lettering behind these panels (`themes/zzz-screens.css`).
  Scrolling past the end of a page slides the next one up into view like one long scroll
  (scrolling up past the top brings back the one before, at its end). Spinning down a long page stops at its end;
  a new scroll there turns the page, and so does scrolling on once the page has sat at its end for 350 ms, unless
  the scroll is only winding down (touchpad glide, a free-spinning wheel). Page Down and Page Up do the same at
  the edges, Ctrl+Page Down and Ctrl+Page Up turn straight away, arrow keys move through the list, and a
  controller's triggers and right stick turn pages at the edges too (`padscroll` from lib/gamepad.ts).
  Each screen remembers its page for the session. Every page, panel and single setting is a route:
  `go({ view: "settings", section })` with a page id, a panel id (`storage`, `themes`) or a row id
  (`set-trash-days`, `set-onscreen` ...), which opens its page, scrolls to the panel or row and flashes it. A page
  that renders nothing is left out of the list.
- A setting sits where people look for it, and some show twice. Mods folders (`mod-folders`, on the Mods and
  downloads page) lists each game's Mods folder with Detect again, Change and Install mod loader or Find it; the same
  folders are under Games and their folders. Run as administrator is a panel on Launch options and a row under
  In-game profile hotkeys (one shared state in `Feedback.tsx`). The rendering log is under Log files and next to
  Hardware acceleration.
- Settings hold settings and Tools holds tools. Launch options (`Launch.tsx`, page "launch") has the Launch options
  and Mod maker switches panels, two views of one launch config per game (`useLaunch`) saved together 400 ms after
  the last change; leaving the page sends an edit that is still waiting. They show the game picked in the sidebar,
  with a game picker when more than one game shows. Any setting XXMI Launcher owns (the backend's lock message says
  "in XXMI Launcher" or "Only XXMI Launcher") shows an "Open XXMI Launcher" button next to it. "Start with" is hidden
  for community games. The 3DMigoto log, the shader cache and finding a hash stay in Tools › Mod makers, and each side
  has a button to the other (View log, Log settings).
- `lib/places.ts` gives a message that names a setting or a place a button that opens it. Toasts without a button
  of their own get it by their words, backend messages included ("has no Mods folder yet" gets "Mods folders",
  "IMM manages this mod" gets "Move from IMM"). `placeFor(text)` gives the same button to a note drawn in a page
  (Launch options uses it for a launch config that couldn't load or save).
- `settingsSearch.ts` also registers every section and setting in the global search with the words people use
  ("recycle bin" finds Keep removed mods' files), plus "Open XXMI Launcher" and the AI jobs (only while AI shows).
- Games: XXMI games, then community games (no XXMI support) with one plain line on what differs: they need their own
  3DMigoto loader (a link to it), and games without a GameBanana character category say so once.
- Appearance: theme per game with previews, light or dark for every theme at once ("Game's own" keeps each game's
  look: Teyvat and Talos-II light, the rest dark; or all dark, all light, follow the system; pref "gm.schemeMode"),
  with a per-theme choice under "Game's own", and accent (the "Theme and colours" panel); Mods layout (four drawn
  previews), layout (density, sidebar side, nav style, corners), text size, animations and first-start hints ("Layout, text size and animations");
  hardware acceleration with a copy of the rendering log row ("Hardware acceleration and rendering log"). Custom
  themes: list, apply, delete with Undo, import/export as JSON, an editor with a stylesheet box and the list of parts
  it can style, and "Make one with your chatbot" (AI task "theme"). Applying is lib/theme.ts (THEMES).
- What gachamod does by itself has one switch each, all prefs in `automatic.ts` that other areas read. They sit in
  three panels of Mods and downloads: "Mod update checks and rescans" (mod updates, watching Mods folders, rescans), "Downloads
  and installing" (archives, every mod in an archive, slow downloads, on-screen toggles for new mods) and "Mods a
  game update broke" (new fixers, the warnings). gachamod's own updates are not a mod setting: their control is under
  About and updates, gachamod updates, above Check now. The prefs: `appUpdateModePref`
  ("app.updateCheck": Install, Only tell me or Off, shown as "Update gachamod automatically"), `modUpdateCheckPref` ("updates.check"), `watchModsPref` ("library.watch", default on, shown as "Watch Mods
  folders for changes"; the backend reads it), `autoRescanPref` ("library.autoScan": Mods and the
  first scan of a session), `keepArchivesPref` ("downloads.keep", shown as "Delete downloaded archives"),
  `otherServersPref` ("downloads.otherServers", default on, shown as "Move slow downloads to another server"),
  `fixesAutoUpdatePref` ("fixes.autoUpdate", read by lib/fixes.ts) and "keys.onScreenOnInstall" (default off).
- Trash and removed mods: `trashDaysPref` ("trash.days", 0 to 3650, default 0; 0 deletes files at once, the record stays in
  Mods, Trash). Lowering it asks first when files would go now (that can't be undone). `trashPhrase()` finishes a
  sentence about it for LIBRARY's texts ("stay on your PC for 14 days").
- Creators: followed, favourite, prioritized and blocked lists from prefs `creators`, each name a link to the
  creator's page, an x to remove (setCreatorFlag, with Undo).
- AI helper: off / most useful (default) / everything, the chatbot, and the jobs as buttons.
- About and updates: "About gachamod" (version, data folder, tip jar), "gachamod updates", "Back up or move your
  settings" (export and import) and "Repair, reset or uninstall", which has "Reset gachamod" (asks first). `app_reset` leaves a note in the data folder, the window clears its own
  storage and `app_relaunch` restarts. At the next start, before the database opens, `reset::finish` deletes what
  can be fetched again (downloads, staging, caches, fixers, the GameBanana sign-in), keeps logs and backups, and
  moves everything else (the database, trash, extensions) to `backups/before-reset-<time>/`. Mods folders, games
  and XXMI Launcher are outside the data folder.
- "Turning mods on and reloading the game" also has "Shuffle outfits" (`screens/library/shuffle.ts`, pref "mods.shuffle": off, each Play, once a day at
  the first Play): every character with two or more mods gets one of them on at random and the others off, as one
  change with Undo. Mods hidden as for adults stay out. Also a dice button on Mods and "Shuffle outfits" in search.
- Fun extras (`FunSection.tsx`, `lib/fun.ts`), all off by default:
  - Chill mode ("fun.chill", html[data-chill], `styles/fun.css`): the app's own words in lower case. Content keeps
    its case (mod, character, creator and profile names, descriptions, comments, tags, paths, fields); a line that
    mixes both stays as written. Toasts and tips are lowercased whole.
  - Pull button ("fun.pull", `screens/browse/Pull.tsx`), named for the game (Wish, Warp, Signal Search, Convene,
    Headhunt): a star button in Browse's header that opens a random mod after a short flash in its star colour.
    3 star: a page of the newest. 4 star: pages 2 to 4 of the most liked. 5 star: the 50 most liked, one pull in
    sixteen, and every 10th pull without one ("fun.pulls" counts). Hidden mods, blocked creators and, when hidden,
    mods for adults stay out.
  - Seasonal touches ("fun.seasonal", `ui/Seasonal.tsx`): off, by the date (bats and pumpkins from 24 October,
    snowflakes from 20 December, hearts on 14 February), or one season all year. Hidden when Animations is off.
  - Your year in mods: a dialog with mods installed this year, the character with the most mods, the creator of
    the most of them and hours played (`lib/playtime.ts` counts from game start to close, "stats.played").
  - Mod of the day (`lib/motd.ts`): see Browse.
- The Konami code (arrows, B, A; keyboard or controller) reveals a hidden theme, Clay ("fun.hiddenTheme"), and
  offers to use it. Hidden themes (`ThemeInfo.hidden`) stay out of Appearance until found. On the keyboard, B and A
  that continue the code don't start a search.
- Opening screen (`src/splash`, Settings, General, "Opening screen", localStorage "gm.intro": missing for the
  theme's own, an intro id, or "0" for off): a solid screen with one tip (`splash/tips.ts`: an icon over a line, the
  Konami tip one start in twenty) while the app renders behind it, then an intro reveals the app
  (`splash/intros/<id>.ts`). By default it's the intro of the theme in use (a custom theme's base), so it follows the
  game through the theme's "Game's own": New Eridu, Teyvat, Astral Express, Solaris and Talos-II have their own, the
  rest the plain fade. index.html paints its colour before any script runs. It waits for
  App's `splashReady()` and the first screen's loading, at most 5 s, and an intro gets at most 4 s. A click, Escape,
  Enter, Space or a controller button skips it; the Konami code's keys don't. Animations off: the tip, then a fade.
  "Play it" in Settings replays it. In dev, `?intro=<game>` picks one and `&hold=1` keeps the tip up.

### Tools

`Tools.tsx` (view "tools"): pages like Settings (`settings/Paged.tsx`), a short list with no groups: "problems"
(Problems: problems, "fixes" from FIXES), "conflicts" (conflicts, "key-clashes"), "ingame" (In-game menu, from
INGAME: ingame, "keylist"), "packs" (Sharing: packs, "imm"), "disk" (Storage: "disk", "disk-big", "disk-dupes") and
"makers" (Mod makers: "dev", "hash"). The pages and
panels with their search words are in `toolsSearch.ts`. The panel ids still work as routes. A panel that renders
nothing (IMM when it isn't installed) is left out. Tools has no settings pages: launch options and 3DMigoto's
switches are in Settings › Launch (see Settings), and the search above the page list finds them from Tools too.

The "ingame" panel sets up which characters switch skins without a reload and how the skin menu opens while playing
(docs/ingame.md, section 11): gachamod's own window over the game (`src-tauri/src/overlay.rs`, `screens/ingame/Overlay.tsx`,
window label `overlay`), or a plainer menu the game draws itself (`crates/gacha-core/src/live/menu.rs`), which is also
what opens in exclusive fullscreen. The panel says which one is better and why.

The window over the game has three tabs: My mods (characters and their skins), Browse and Downloads. Browse and
Downloads are the app's own `GbBrowser`, `ModDrawer`, `CreatorPage` and `Downloads`, running on that window's own
page history. A change to those shows in the menu too, so check both. Pages the menu doesn't have open in the main
window (`skinMenu.openInApp`, event `app-go`, handled in `App.tsx`).

The key list (`crates/gacha-core/src/keylist.rs`, `lib/api/keylist.ts`, docs/ingame.md "The key list") shows each
mod's toggle keys while playing: the Keys tab of the window over the game (F8 by default), where a click on a key
rebinds it, or a panel the game draws in its top right corner (`live/menu.rs`). Its settings and the pick per mod are in the Key list panel on the same Tools page.

Other apps' keys (`crates/gacha-core/src/otherkeys.rs`, `lib/api/otherkeys.ts`, `screens/ingame/otherKeys.ts`,
docs/other-app-keys.md): recorders like Medal listen for keys in every app, so Medal's screenshot key F7 fires
together with the skin menu. gachamod reads those apps' settings and, when one of their keys is also the skin menu
key, the key list key or a profile hotkey, says so in a toast at start and when a game starts, and in a note in the
panel (`KeyClashNote`). "Use F9" moves gachamod's key in every game that used the old one; "Keep F7" stops the
question. For Medal the note also has "Change Medal's key": Medal gets the free key and gachamod keeps its own. That
writes one value in Medal's database, only while Medal is closed, after a copy of the database
(`medal-<user id>.db.gachamod.bak` next to it). No other app's settings are written. The setting `otherKeys.ask` =
`0` turns the toasts off.

### Storage

Tools › Storage (`screens/tools/Storage.tsx`, `crates/gacha-core/src/storage.rs`, `lib/api/storage.ts`) shows where
disk space goes. `storage_measure(false)` reads mod sizes from the library at once; `storage_measure(true)` then walks
the rest on a blocking thread, sending `storage-progress {step, game}` so the wait names what it reads ("Comparing ZZZ
mods that look alike"). Skip calls `storage_cancel`, and the report comes back with what it has (`complete` false).
The report stays for the session; "Measure again" redoes it, and mod changes from anywhere (`onPublish`) keep its mods
current.

What it counts, per game: mods on and off (from the scan), the trash (`<data>/trash/<game>`), kept archives and
unfinished downloads (`<data>/downloads/<game>`), backups of mod files (by their manifest's game), fix tools, the
loader folder's ShaderCache, FrameAnalysis dumps, d3d11_log.txt and the rest of it without Mods (left out when the
loader sits in the game folder), and mods another manager keeps outside Mods (`migrate::detect`). Shared by all
games: the database, thumbnails, other caches, logs, unpacked downloads, extensions, removed mods' pictures, settings
and database backups, anything else in the data folder, and XXMI Launcher without the importer and Mods folders.

- Panel "disk": the total, a game picker, and a breakdown by category (rows open to their items, each with Show in
  Explorer and its cleanup), by game (a row picks that game) or by character (a row opens Mods on that character).
- Panel "disk-big": the biggest mods, all or only the ones that are off, with open, Show in Explorer and Move to trash
  (`removeMods`, which asks first only when the trash keeps no files and the mod has no GameBanana link).
- Panel "disk-dupes": mods installed twice. "same": the files match byte for byte, leaving out dot files (the sidecar)
  and `preview.*` pictures; candidates are grouped by file names and sizes first, and only those are hashed.
  "download": the same GameBanana file and variant installed twice with files that differ now (sub-mods and their
  parents never count). IMM's folders, links to other managers' folders and mod folders inside another mod's folder
  are left out. The copy that stays is the newest of those that are on, else the
  newest. "Keep newest" sends the others to the trash as "replaced" (`storage_remove_copies`), so they wait at least
  10 minutes even when "trash.days" is 0 and Undo puts them back. "Keep one of each" does every "same" group.
- Suggestions show only after a full measure and only past a size: kept archives over 500 MB (Move to Recycle Bin,
  and a button to the archive setting while archives are kept), trash past "trash.days" over 50 MB (Delete now, as
  the setting says), a shader cache over 1 GB, frame dumps over 200 MB, a 3DMigoto log over 100 MB (Log settings),
  another manager's mods over 500 MB (Move them in). Each hides with its x and comes back only once its size has
  doubled (localStorage "gm.storage.tips").
- Archives go to the Recycle Bin (`storage_recycle_archives`), never the ones a download in the queue uses, .part
  files, or files written in the last two minutes. The shader cache and frame dumps use the `dev_` commands.
- Settings, Mods, Trash and removed mods has a "View storage" button here, and the trash rows here open Mods, Trash
  and the trash setting.

Left out on purpose: "unused for a long time" (the library doesn't record when a mod was last on, and a guess from
the install date would be wrong), deleting backups (they are what Undo restores), cleaning unpacked downloads (an
install may be using them), and emptying the whole trash from here (Mods, Trash does that with each mod in view).

### The AI helper

No API key and no account. The helper writes a prompt for the chatbot the user already uses (`chatbotPref`: ChatGPT,
Claude, Gemini, Copilot, Grok or another one with an optional web address), copies it and opens the chatbot. ChatGPT
(`chatgpt.com/?q=`), Claude (`claude.ai/new?q=`) and Grok (`grok.com/?q=`) get the prompt in the link when it fits
(7000 characters); the rest open the site and the user pastes. The user pastes the answer back.

- Every prompt asks for one ```json block in a fixed shape. `screens/ai/tasks.ts` reads it strictly: a reply that
  isn't that shape is refused with a plain reason; single entries that don't fit (an unknown mod number, a character
  the game doesn't have) are left out and listed. The window shows every change (before and after) before Apply.
- Before copying, the window lists what the prompt shares ("Names, folder names, characters and tags of 12 mods");
  "See the prompt" shows all of it. File contents are never sent.
- Adult mods (`aiHideAdultPref`, on by default; `hideFromAi`: marked for adults or explicit words in the name, folder
  or tags) are left out of mod lists without a word. Nothing in a prompt or the helper window says whether a mod is
  for adults: it doesn't matter for these jobs, and chatbots refuse a whole request over it. The toggles task still sends their ini outlines, without
  the mod's name, and swaps explicit words in file, section and key names for "Alt" (`neutralName`), mapping the
  answer back. A request where every mod is left out stops with a note and a button to the setting.
- Tasks (`AiTask.kind`): "mods" (goals: tidy names, set characters, add tags, or free text; applies
  through `library.updateMeta` with one Undo step and then lists what changed), "custom" (free text plus the picked
  mods; an answer and optional changes), "keys-offscreen" (the mods' key sections; the answer names the sections
  that draw the character and is applied through `modKeys.onScreen` with Undo; its `note` says it takes a strong
  chatbot), "recommend" (`detail` from lib/recommend.ts; ideas open as Browse
  searches or GameBanana pages), "theme" (a description; the prompt carries the tokens, how a game theme is built
  and the map of the window's parts, and asks for a stylesheet at that depth in a css block after the json one. An
  answer cut off partway applies up to its last whole rule, and the next answer can be pasted after it ("Paste the
  rest"). The answer is validated with `validateCustomTheme` and saved as a custom theme with Undo).
- Visibility (`aiShowPref`, "ai.show"): "off" hides every AI element (buttons, menu items, search entries, the
  first-run card, the helper itself); "useful" (default) shows entry points that save real work; "all" adds
  extras. Every entry point checks `aiShown("useful" | "extra")`.
- First-run card: once, 10 seconds into the first start after setup ("onboarded" already set), a small card (not a modal) bottom
  right with what the helper does, chatbots to pick (apps found on this PC first, from
  `ai_chatbots_installed`, which only checks known folders under %LOCALAPPDATA%), "No thanks" (hides it for good,
  "ai.intro") and "Turn AI off". It never mentions subscriptions.

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
- Every theme works fully light and fully dark. A theme whose own look mixes the two (Talos-II's charcoal stage on
  light sheets) gets `html[data-full]` when Appearance asks for all light or all dark, and draws one material
  throughout. Teyvat at night turns its cream sheets to navy (`themes/gi-night.css`).
- Custom themes: a base theme, token values, a layout and up to 160,000 characters of CSS, as much as a game theme
  uses. `scopeCss` reads the CSS with the browser's parser and puts every rule under `:root[data-custom]`, so plain
  `.btn { }` rules apply only while that theme is on and win over its base. `lib/theme-anatomy.ts` is the map of
  parts a theme can style, used by the chatbot prompt and the editor; its test checks every class in it still exists.

## Extensions (EXTENSIONS)

The package format, the page API and the repo layout are in [extensions.md](extensions.md). The public list is the
repo imanimal/gachamod-extensions (public, served from raw.githubusercontent.com). `extensions-repo/` here is the copy
it started from; the demo and tests use its example packages. Its `docs/extensions.md` must match ours (a test checks),
so push that copy to the public repo when the docs change.

- Extensions page (`view: "extensions"`, not in the sidebar): reached from Settings, Extensions, from Get more themes
  under Custom themes and from search. Tabs Available and Installed (`tab: "installed"`), a filter for All, Themes
  and Extensions, search (`/`), Refresh, Install from file and a More menu (Install a package folder, Link a folder,
  Share a package, How to make one, Extension lists).
- Available cards: Install, Update (when the list has a newer version) or an Installed tag that opens Installed.
  Each card says what the package can reach before it's installed. Installed cards: Update, an on/off toggle and a
  menu (Open folder, Reload pages for linked folders, Homepage, Remove). Tags for its tab, page and themes open them.
- Install, update, remove and turning a package off all toast with Undo. Replaced and removed copies go to the app's
  trash for 14 days.
- Theme packages add their themes to Custom themes (`pkg` set to the package id); they leave with the package. A
  custom theme's menu has Share to the theme list (packs it and opens the submission page).
- Pages run in `ExtensionFrame`: a sandboxed iframe. In the app it loads `http://gmext.localhost/<id>/<file>`
  (Rust serves the package files with a CSP and the bridge script first); in the demo it gets one HTML string.
  `extension-bridge.js` is `window.gachamod`; the frame answers its calls after checking permissions, and Rust checks
  `net` and `files` again.
- Character tabs show after the app's own tabs on each character page (`tab: "ext:<id>"`). Pages get a sidebar
  entry after the views (`view: "extensions", ext: id`).
- `needs`: when a required app is missing, the tab or page shows a note with a button to get it.
- Settings, Extensions: count and Browse extensions, Extension lists (extra `index.json` links, setting
  `extensions.sources`), Make your own (How to, Link a folder, Share).

## The window (shell)

- Title bar (`shell/Titlebar.tsx`): Back and Forward, the breadcrumb, then "Search anything" in the middle of the
  window (opens the palette, Ctrl+K), then what's running, Undo, Redo, Help and the window keys. Both sides stay
  empty enough to drag the window. The search box grows in from a key when the app opens and after the first setup; on a
  narrow window it narrows before the breadcrumb does.
- What's running (`shell/Activity.tsx`, `lib/activity.ts`): every backend call and GameBanana request is noted
  with what it does and what can hold it up (`describeCall`, `HOLD`). Anything over 1.2 seconds shows in the title
  bar with its time ("Reading the Mods folder 4s"), turning to the warning colour past 10 seconds. Clicking it, or
  "Show what's running" in the palette, lists each wait with what could be holding it. On screen, waits use the
  kit's `Waiting` (a line saying what it's for, a counter after 3 seconds, and past 10 seconds what could be holding
  it), never a bare spinner. Network requests time out (30 seconds without an answer) so a dead connection becomes
  an error instead of a wait.
- Help menu: Keyboard and controller shortcuts (?), Search anything, Report a problem (GitHub issues).
- Sidebar views, Ctrl+1 to Ctrl+8 (`KEY_VIEWS` in `shell/names.ts`): Home, Browse, Mods, Characters, Downloads,
  Profiles, Tools, Settings. Profiles has no view button: its list sits under the views, with "Manage profiles"
  (Ctrl+6) in its header and "New profile" at the end. Views are off until a game has a Mods folder.
- Pictures in lists load only once on screen (`ui/LazyImg.tsx`, 48 px early), not the browser's lazy loading, which
  starts more than a screen ahead.
- Game switcher in the sidebar: the shown games' icons on one row; when they don't fit, the last slot is "+N",
  which opens the switch menu.
- Wheel scrolling (`lib/smoothScroll.ts`): each notch of a mouse wheel glides over about 250 ms instead of jumping.
  Touchpads and anything that handles the wheel itself are left alone; off when Animations is off.
