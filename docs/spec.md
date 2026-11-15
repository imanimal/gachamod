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
- Nothing destructive happens to user files without a way back: removed mods go to the app's trash ("trash.days",
  default 14) and their details stay in the archive after that;
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
| LIBRARY | library.rs, profiles.rs | commands/library.rs, commands/profiles.rs | lib/api/library.ts, lib/demo/library.ts, screens/library/*, screens/characters/*, screens/profiles/* |
| MODTOOLS | ini.rs, pack.rs, imm.rs | commands/modtools.rs | lib/api/modtools.ts, lib/demo/modtools.ts, screens/modtools/* |
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
- Events (model.rs `events`): `library-changed {game}`, `queue` (QueueSnapshot), `variants-needed`, `game-state
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

Characters are matched through the game's alias table (see Characters below), so "raiden ei", "Shougun",
"雷电将军" and JASM's lowercase "raiden shogun" folder all land on Raiden Shogun. The group folders are tried first,
then the mod's own folder name.

A mod is off when any folder on its path has a DISABLED prefix (any case, with a space, `_` or `-`). Other managers
also turn mods off by renaming the inis (ModDeck's `DISABLED_mod.ini`, `mod.ini.disabled`): a folder whose inis are
all renamed like that is a mod that is off, and turning it on renames them back.

Folders another manager set up come in with what it knew (managers.rs). A new folder is adopted with that manager's
name, character, GameBanana link, author, version, tags, notes, picture, favourite and NSFW flags; a known mod only
gets the gaps filled (Characters view: "Bring them in", with Undo). Files read, never changed:
- JASM: `.JASM_ModConfig.json` and `.JASM_Cover.<ext>` (`Mods/<category>/<character>/<mod>`).
- XX Mod Manager and FlairX: `mod.json` (FlairX keeps previews as `preview001.jpg`).
- EMMM: `info.json` and `preview_custom.<ext>`.
- Fairy's Secret Folder: `.zmm-meta.json`, and `category.json` in the `<Character> - <Skin>` folder above.
- No Reload Mod Manager: `modname` and the group folder's `groupname` (`Mods/_MANAGED_/group_3/<mod>`).
- WZMM `modmeta.json`, GIMM `GIMM.json(c)`.

## Library (LIBRARY)

Rust: `library.rs` and `profiles.rs` as stubbed. Notes:
- scan: walk, adopt, upsert the `mods` table (data = ModEntry JSON), delete rows whose folders are gone, fill
  `size_bytes`, `file_count`, `ini_count` and `has_keys`/`conflicts` from `ini::quick_facts` (MODTOOLS; a stub
  returns defaults until then; compute conflicts by counting other enabled mods sharing any hash from quick_facts).
  Emits nothing itself (commands return the list). Must handle 1,000+ mods in under 2 seconds on an SSD: don't hash
  files, read inis only through quick_facts.
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
  bulk bar (Turn on, Turn off, Export, Remove). "Rescan" button and an automatic scan when the screen opens if the
  last scan is over 30 seconds old. Empty state explains where mods come from (Browse, or drop an archive).
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

- Install from GameBanana: the runner's downloaded picture becomes `preview.<ext>` whenever the mod has no
  `preview.*` of its own (other images don't count). If the download failed, the sidecar keeps `preview_url`.
- `mod_fetch_preview(game, id, url)` downloads an https picture (Content-Type png, jpeg, webp or gif, at most 25 MB)
  and saves it as `preview.<ext>`; preview files already there become `preview-original.<ext>`. With a custom preview
  set it is saved as `preview-gamebanana.<ext>` behind it. Returns the ModEntry.

### Trash and archive

- Trash files are kept "trash.days" days (setting, default 14, 0 to 3650; 0 deletes them right away). Expired trash
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
  - "bad" (Broken): a file that a used `[Resource]` needs is missing, an ini can't be read, the mod has no ini at
    all (inis that are only turned off don't count), or two inis change the same TextureOverride hash and
    match_first_index with no `match_priority` and at least one of them draws without an `if` (variants left on
    together draw over each other).
  - "warn" (Warning): a missing file named like a remap (`*RemapBlend.buf`, made by remap fix scripts for another
    model such as the Raiden boss), or `run = CommandListX` with no such section in the mod.
  - "info" (Note): a missing file whose `[Resource]` nothing names (3DMigoto loads a resource's file the first time
    a command uses it, so it never loads), an empty ini next to inis that load, an ini over 16 MB gachamod didn't
    read, a `[Key]` with no key line.
  A problem carries a fix when one is certain: "point" (the same file name is elsewhere in the mod: the one whose
  folder name starts like the wanted folder, the only one, or any when all copies are identical; the `filename =`
  lines change to its path from the ini's folder) and "keep" (rename the other overlapping inis DISABLED_<name>).
  lint_fix applies one after taking a backup (backups.rs), so it can be undone.
- hash_lookup: which mods (on or off) mention a hash, any case, with or without 0x.
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
`Mods/<Character>/<mod>` (character = the first path part of IMM's `data` key), DISABLED prefix for mods from the
DISABLED store, writes sidecars with `source` from IMM's `data[...].source` (GameBanana URL -> mod id), moves saved
vars (ini::move_user_vars), removes IMM's now-empty folders, rescans. Refuse while IMM runs
("integrated-mod-manager.exe").

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
- `screens/modtools/ModInsides.tsx`: sections "Options" (each persist var as a Segmented or Select over its values, current value selected,
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
  again" from GameBanana or "Find on GameBanana" for a broken part with no fix in the files, "Ignore" per mod and
  "Ignore all" (saved in setting "problems.ignored", listed under Ignored with "Show again"), "Fix all" for fixes
  that need no choice; Tools shows it first while something in it has a fix), HashLookupPanel (a field and results), PacksPanel (Share this game's library, Share
  every game when more than one has mods, Import a .gachamod), ImmPanel (shown when IMM is found: per game counts and "Move mods from IMM" with a Confirm,
  since it moves folders). Set the "tools" nav badge.
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
Rust: `install.rs` (stage with archive::extract into `<data>/staging/<id>`; find_roots per "Finding mods" over the
staging folder; place moves (rename, fall back to copy+delete across drives) into Mods; replace keeps the old
sidecar id, enabled state and folder name, moves the old folder to trash with reason "replaced" first; anything else new
comes in off (`DISABLED <name>`): installing never turns a mod on, the user does that from its details or GameBanana
page (which shows a switch once it is installed), so the one-skin question comes up there; preview_url
is downloaded to `preview.jpg` (best effort, short timeout); register with library::add_folder; clean staging.)
`queue.rs` + `runner.rs`: persistent queue (queue_items rows), up to 3 downloads at once, installs one at a time,
progress events throttled to ~8 per second per item, cancel and retry (resume via the .part file), NeedsChoice when
an archive holds several candidates (emit variants-needed; `queue_choose` installs the picked keys; setting
"downloads.allParts" "1" installs every key without asking). Several picked keys install as one mod whose parts are
the picked folders (`library::parts`, `set_part` renames a part's folder with DISABLED); a part that overrides a hash
an earlier part does starts off. `library::merge` combines existing mods the same way, and the first scan of each
game merges mods an older version installed one per folder from the same archive (setting "<game>.partsMerged"). Emits
`library-changed {game}` after installs and a `toast` event ("Installed Coca Cola for Ellen Joe") with `open: {game,
modId}`, which gives the toast an Open button for the mod's details. Downloads go to
`<data>/downloads/<game>/`; keep the archive (setting "downloads.keep" default "0": delete after install).
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

### Browse in detail (current build)

Mod of the day: picks live in `curated/mod-of-the-day.json` on the main branch (`{ enabled, picks: [{ date, game,
modId, name?, note? }] }`). `node scripts/motd.mjs <link> <game> [date] [note]` adds one, `on` / `off` switches the
feature; commit and push to publish. Only people who can push to the repository can change it, so the app needs no
sign-in or machine check. The app reads the file at most every 12 hours. While `enabled` is false nothing shows;
when true, Browse's header gets a gift button for the current game's pick (today's, or the latest within three
days), and Settings, Fun gets a switch to hide it (which also stops the reads).

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
  GRYPHLINK registry and folders, Steam library folders (libraryfolders.vdf) by steam_app, and the MuiCache /
  FeatureUsage registry scans (research 1a). A community game (xxmi false) gets an importer folder only from the
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
  or the exe directly (vanilla true, or no XXMI); then a background watcher (spawned thread) polls processes every 3
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
- `screens/home/PlayerCard.tsx`: the player card: avatar (pick a character portrait from any game's characterList,
  or an image file or URL), display name, a title line ("Proxy", "Trailblazer" ... free text), a banner strip, a
  "UID" style tag (free text), all from setting "player" (JSON). Click opens an edit dialog. Compact but pretty.
- `screens/tools/Tools.tsx` and `screens/settings/*`: owned by SETTINGS/AI now, see "Settings, Tools and the AI
  helper" below.
- `screens/settings/Onboarding.tsx`: first start window: runs games.detect, xxmi.status and imm.detect, each listed
  with its own state (running with a timer, done, or failed with the reason), and past 10 seconds what could be
  holding it. "Skip the search" appears after 5 seconds; results that arrive later still fill in. Then it shows found games
  as cards (game badge, folders, mod count) with toggles to show them, offers XXMI download link if not found
  (https://github.com/SpectrumQT/XXMI-Launcher/releases), offers "Move mods from IMM" when imm.detect finds it
  (MODTOOLS' ImmPanel logic: emit nothing, just go to Tools section "imm" after), then "Start". Sets setting
  "onboarded" = "1"; App only shows it when no game has a Mods folder, so also show it when that setting is missing.
  Shown games appear in the sidebar's game switcher (there is no rail any more).
  After "Start" a toast offers the tour once ("gm.tour"); it's always in the title bar's Help menu.
- One-game mode (Settings, Games, or "Only show X" in a game's menu; "gm.onlyGame"): only that game shows in the
  sidebar, its switcher and Ctrl+Tab. The other games stay set up, the switch menu lists them under "Other games",
  and search still finds them.
- Logs, crash reports, usage counts and feedback (`logs.rs`, `telemetry.rs`, `commands/report.rs`,
  `lib/telemetry.ts`; docs/telemetry.md has every event). The log and crash files live in `<data folder>/logs`.
  Usage counts and crash reports go to PostHog when they're on (both are on by default, with switches in Settings,
  Feedback and data, and a line in onboarding). Feedback is sent from a form opened from Settings, the title bar's
  Help menu, the search ("Send feedback") and a screen that hit an error.
- Running as administrator: Settings, Games has "Restart as administrator" and an "Always" switch (Windows'
  RUNASADMIN flag for gachamod.exe under HKCU AppCompatFlags\Layers, which the installer also sets when the player
  says yes; `src-tauri/windows/hooks.nsh`). The F10 note for a game that runs as administrator says why, and its toast
  has the restart button (`lib/elevation.ts`). A copy that isn't an administrator hands its link or file to one that is
  (`devtools::hand_to_elevated_copy`), since Windows hides that copy from the single-instance check.
- Check this game (`gamecheck.rs`, `screens/settings/GameCheck.tsx`, opened from the Help menu, Settings, Feedback and
  data, and the search): five steps through switching skins while playing, each answered Yes, No or Skip, next to
  what gachamod saw by itself (the game saved a pick, gachamod opened the menu, it read a pick back). The answers and
  the game's setup go to PostHog as one `game check` event. docs/testing.md is the tester's side.
- `npm run installer` builds the installer with build-machine folders written as `~` (scripts/build-installer.mjs).
- gachamod's own updates (`src-tauri/src/commands/app.rs`, Tauri's updater plugin; `app_update.rs` keeps version
  numbers). The feed is `releases/latest/download/latest.json` on imanimal/gachamod, and the updater only installs an
  installer signed with the key in `%USERPROFILE%\.tauri\gachamod.key` (its public half is in tauri.conf.json, plugins
  > updater). With "app.updateCheck" on (default), it checks 12 s after start and every 6 hours, downloads a newer
  version quietly and toasts "gachamod X is ready" with Restart now; at quit (`RunEvent::Exit`) it runs the installer
  without reopening gachamod. Settings, About shows the state (`app_update_status`) with Check now and Update now or
  Restart to update. The NSIS installer runs passive (a small progress window), per user, no administrator.
- `npm run release -- <version>` sets the version in tauri.conf.json, package.json, package-lock.json and Cargo.toml,
  builds the signed installer, writes latest.json, commits and pushes, and makes the GitHub release v<version>
  (scripts/release.mjs). Without --notes the notes are the commit subjects since the last release.
- Uninstalling (Windows' Installed apps) removes the program, its RUNASADMIN flag, and the `gachamod:` link and
  `.gachamod` file keys when they still open that copy (`hooks.nsh`). Mods stay where they are. "Delete the application
  data" also removes the data folder (settings, profiles, trash) and HKCU\Software\gachamod.
- Demo handlers for every SYSTEM command.

## Settings, Tools and the AI helper (SETTINGS/AI)

Files: `screens/settings/*` (not AccountSection.tsx), `screens/tools/*` (not FixesPanel.tsx), `screens/ai/*`,
`lib/ai.ts`, `src-tauri/src/commands/ai.rs`, `lib/demo/ai.ts`.

### Settings

- `Settings.tsx` (view "settings"): a list of sections on the left (sticky; the one in view is marked), the sections
  on the right. Every section and every single setting is a route: `go({ view: "settings", section })` with a section
  id (games, xxmi, integrations, appearance, themes, mods, automatic, storage, creators, hotkeys, account, ai,
  transfer, about) or a row id (`set-trash-days`, `set-onscreen` ...), which scrolls to the row and flashes it.
  A section that renders nothing (a part still being built) is left out of the list.
- `settingsSearch.ts` registers every section and setting in the global search with the words people use
  ("recycle bin" finds Keep removed mods' files), plus "Open XXMI Launcher" and the AI jobs (only while AI shows).
- Games: XXMI games, then community games (no XXMI support) with one plain line on what differs: they need their own
  3DMigoto loader (a link to it), and games without a GameBanana character category say so once.
- Appearance: theme per game with previews, light or dark for every theme at once ("Game's own" keeps each game's
  look: Teyvat and Talos-II light, the rest dark; or all dark, all light, follow the system; pref "gm.schemeMode"),
  with a per-theme choice under "Game's own", accent, layout (density, sidebar side, nav style, corners), text
  size, animations. Custom themes: list, apply, delete with Undo, import/export as JSON, and
  "Make one with your chatbot" (AI task "theme"). Applying is lib/theme.ts (THEMES).
- Automatic: one switch each, all prefs in `automatic.ts` that other areas read: `appUpdateCheckPref`
  ("app.updateCheck", shown as "Update gachamod automatically"), `modUpdateCheckPref` ("updates.check"), `autoRescanPref` ("library.autoScan": Mods and the
  first scan of a session), `keepArchivesPref` ("downloads.keep", shown as "Delete downloaded archives"),
  `fixesAutoUpdatePref` ("fixes.autoUpdate", read by lib/fixes.ts) and "keys.onScreenOnInstall" (default off).
- Storage: `trashDaysPref` ("trash.days", 0 to 3650, default 14; 0 deletes files at once, the record stays in
  Mods, Trash). Lowering it asks first when files would go now (that can't be undone). `trashPhrase()` finishes a
  sentence about it for LIBRARY's texts ("stay on your PC for 14 days").
- Creators: followed, favourite, prioritized and blocked lists from prefs `creators`, each name a link to the
  creator's page, an x to remove (setCreatorFlag, with Undo).
- AI helper: off / most useful (default) / everything, the chatbot, and the jobs as buttons.
- Mods also has "Shuffle outfits" (`screens/library/shuffle.ts`, pref "mods.shuffle": off, each Play, once a day at
  the first Play): every character with two or more mods gets one of them on at random and the others off, as one
  change with Undo. Mods hidden as for adults stay out. Also a dice button on Mods and "Shuffle outfits" in search.
- Fun (`FunSection.tsx`, `lib/fun.ts`), all off by default:
  - Chill mode ("fun.chill", html[data-chill], `styles/fun.css`): the app's own words in lower case. Content keeps
    its case (mod, character, creator and profile names, descriptions, comments, tags, paths, fields); a line that
    mixes both stays as written. Toasts and tips are lowercased whole.
  - Pity counter ("fun.pity"): counts mods opened in Browse since the last install; at 90 a toast says hard pity
    and it starts over.
  - Seasonal touches ("fun.seasonal", `ui/Seasonal.tsx`): a few snowflakes from 20 December, hearts on 14 February.
    Hidden when Animations is off.
  - Your year in mods: a dialog with mods installed this year, the character with the most mods, the creator of
    the most of them and hours played (`lib/playtime.ts` counts from game start to close, "stats.played").
  - Mod of the day (`lib/motd.ts`): see Browse.
- The Konami code (arrows, B, A; keyboard or controller) reveals a hidden theme, Clay ("fun.hiddenTheme"), and
  offers to use it. Hidden themes (`ThemeInfo.hidden`) stay out of Appearance until found.

### Tools

`Tools.tsx` (view "tools"): "fixes" (FixesPanel, FIXES), "launch", "ingame" (InGamePanel, INGAME), "migoto", "dev",
then MODTOOLS' panels. Wrappers hide when a panel renders nothing. Any setting XXMI Launcher owns (the backend's lock
message says "in XXMI Launcher" or "Only XXMI Launcher") shows an "Open XXMI Launcher" button next to it. "Start with"
is hidden for community games.

The "ingame" panel sets up which characters switch skins without a reload and how the skin menu opens while playing
(docs/ingame.md, section 11): gachamod's own window over the game (`src-tauri/src/overlay.rs`, `screens/ingame/Overlay.tsx`,
window label `overlay`), or a plainer menu the game draws itself (`crates/gacha-core/src/live/menu.rs`), which is also
what opens in exclusive fullscreen. The panel says which one is better and why.

### The AI helper

No API key and no account. The helper writes a prompt for the chatbot the user already uses (`chatbotPref`: ChatGPT,
Claude, Gemini, Copilot, Grok or another one with an optional web address), copies it and opens the chatbot. ChatGPT
(`chatgpt.com/?q=`), Claude (`claude.ai/new?q=`) and Grok (`grok.com/?q=`) get the prompt in the link when it fits
(7000 characters); the rest open the site and the user pastes. The user pastes the answer back.

- Every prompt asks for one ```json block in a fixed shape. `screens/ai/tasks.ts` reads it strictly: a reply that
  isn't that shape is refused with a plain reason; single entries that don't fit (an unknown mod number, a character
  the game doesn't have) are left out and listed. The window shows every change (before and after) before Apply.
- Before copying, the window lists what the prompt shares ("Names, folder names, characters, tags and adult flags of
  12 mods"); "See the prompt" shows all of it. File contents are never sent.
- Tasks (`AiTask.kind`): "mods" (goals: tidy names, set characters, add tags, or free text; applies
  through `library.updateMeta` with one Undo step and then lists what changed), "custom" (free text plus the picked
  mods; an answer and optional changes), "keys-offscreen" and "fix-mod" (the mods' key sections or found problems
  plus `detail`; the answer is exact edits and steps, shown with a button to the mod's folder; nothing is written
  because there is no ini write call yet), "recommend" (`detail` from lib/recommend.ts; ideas open as Browse
  searches or GameBanana pages), "theme" (a description; the answer is validated with `validateCustomTheme` and
  saved as a custom theme with Undo).
- Visibility (`aiShowPref`, "ai.show"): "off" hides every AI element (buttons, menu items, search entries, the
  first-run card, the helper itself); "useful" (default) shows entry points that save real work; "all" adds
  extras. Every entry point checks `aiShown("useful" | "extra")`.
- First-run card: once, a little after start when setup is done ("onboarded"), a small card (not a modal) bottom
  right with four things the helper does, chatbots to pick (apps found on this PC first, from
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
  empty enough to drag the window. The search box grows in from a key when the app opens, after the first setup and after the tour; on a
  narrow window it narrows before the breadcrumb does.
- What's running (`shell/Activity.tsx`, `lib/activity.ts`): every backend call and GameBanana request is noted
  with what it does and what can hold it up (`describeCall`, `HOLD`). Anything over 1.2 seconds shows in the title
  bar with its time ("Reading the Mods folder 4s"), turning to the warning colour past 10 seconds. Clicking it, or
  "Show what's running" in the palette, lists each wait with what could be holding it. On screen, waits use the
  kit's `Waiting` (a line saying what it's for, a counter after 3 seconds, and past 10 seconds what could be holding
  it), never a bare spinner. Network requests time out (30 seconds without an answer) so a dead connection becomes
  an error instead of a wait.
- Help menu: Take the tour, Keyboard and controller shortcuts (?), Search anything, Report a problem (GitHub issues).
- Tour (`shell/Tour.tsx`): six short steps, each lighting one part of the window (search, the game, pages,
  profiles, Play, Help) with a card beside it. Arrows or Enter move on, Escape or B closes. Steps whose part isn't
  on screen are skipped.
- Game switcher in the sidebar: the shown games' icons on one row; when they don't fit, the last slot is "+N",
  which opens the switch menu.
- Wheel scrolling (`lib/smoothScroll.ts`): each notch of a mouse wheel glides over about 250 ms instead of jumping.
  Touchpads and anything that handles the wheel itself are left alone; off when Animations is off.
