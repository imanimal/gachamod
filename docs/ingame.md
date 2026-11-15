# In-game switching and toggle menu: research

Checked 2026-11-13. Read: No-Reload Mod Manager (NRMM) v3.3.1 source at commit 6bff7db and its issue tracker, XXMI-Libs-Package
(the 3DMigoto DLL source) master, ZZMI-Package, ZZZ Mod Hub source, and this repo's `ini.rs`, `xxmi.rs`, `devtools.rs` and
`docs/research.md`. Nothing from another project was run. Items marked UNCONFIRMED were not seen working and need a test in a
real game before we depend on them (list in section 9).

## In short

- NRMM draws nothing inside the game. There is no shader or HLSL file in its repo. Its "in-game menu" is its own always-on-top
  window, shown over a windowed or borderless game. It talks to the game with synthetic key presses and the mouse position.
- Switching without F10 works because every mod of a character stays loaded, and the app edits each mod's .ini once so its
  draw commands only run while a per-character number equals that mod's slot. Changing the number is instant.
- NRMM has no licence. We study the technique and write our own code, names and assets.
- NRMM's toggle buttons only press the mod's own key. It never reads variables, so it shows no state and no values. The
  toggle menu we want (global, built from detected binds, customisable) is not in NRMM. ZZZ Mod Hub (GPLv3) draws a real
  in-engine HUD with 3DMigoto shaders and is the closest thing to it.

## 1. NRMM at a glance

| | |
|---|---|
| Repo | Flutter/Dart desktop app plus a small C++ DLL. Windows, and Linux through a helper that runs inside Wine |
| Size | 125 stars, 17 forks, 73 issues and pull requests (6 open). Created 2025-04-24, v3.3.1 released 2026-10-28 |
| Users | About 10,000 downloads each on its ZZZ and Endfield GameBanana pages |
| Games | Wuthering Waves, Genshin, Honkai: Star Rail, Zenless Zone Zero, Arknights: Endfield. Not HI3 |
| Needs | An XXMI/3DMigoto folder with `d3dx.ini` and `d3d11.dll` next to `Mods` |

## 2. How NRMM works

### 2.1 What it writes into Mods

- `Mods\_MANAGED_\group_1` to `group_500`. One group is meant to hold the mods of one character, at most 500 mods per group.
  The user drags mod folders in. A mod's slot number is its place in the folder listing, so adding or removing a folder shifts
  later slots and the user has to press "Update Mod Data" again.
- `group_N.ini` in each group folder (generated), `manager_group.ini`, `nrmm_keypress.txt` and `nrmm_include.ini` in `_MANAGED_`.
- Every mod `.ini` is rewritten in place. Before the first write the original is copied next to it as `<name>.ini_managed_backup`.
  Writes go to `<file>.tmp` and are renamed over the original.
- Small sidecar files in group and mod folders: `groupname`, `modname`, `selectedindex`, `fav`, icon images, and flag files
  (`modforced`, `modsyntaxerrorremoved`, `modunoptimized`, `modnamespaced`).
- Removed mods move to `Mods\DISABLED_MANAGED_REMOVED`. A mod folder starting with `disabled` is skipped by 3DMigoto and by NRMM.
- Slot 0 of every group is "None": nothing from that group is active.

### 2.2 What it changes in a mod's .ini

The rewrite is idempotent: lines it added earlier are recognised and stripped, then added again. In order:

1. Every `.ini` under the mod is read (skipping `desktop.ini` and anything under a `disabled*` folder).
2. Sections that run draw commands get their whole body wrapped in `if <mod slot> == <group active slot>` ... `endif`.
   These are `[Present]`, the four `[Clear...View...]` sections, `[ShaderOverride*]`, `[TextureOverride*]` and the main
   `[ShaderRegex*]` section (names with no dot). Setting keys of those sections stay above the `if` (TextureOverride: `hash`,
   `match_*`, `format`, `width`, `height`, `filter_index` and the like; ShaderOverride: `hash`, `allow_duplicate_hash`,
   `depth_filter`, `partner`, `model`, `disable_scissor`, `filter_index`). `[CommandList*]`, `[CustomShader*]`, `[Resource*]`
   and `[Constants]` are never wrapped, because they only run when something wrapped calls them.
3. Every `[Key*]` section gets `condition = (<old condition>) && <same gate>`, or a new `condition` line when it had none.
   So an inactive mod's keys do nothing.
4. `[Constants]` gets `global $managed_slot_id = <slot>` (the section is created when missing; once per namespace).
5. TextureOverride sections with no `match_*` key get `match_priority = 0`, and ShaderOverride sections get
   `allow_duplicate_hash = true`, so XXMI stops showing warnings for the duplicate hashes several skins create.
6. The `if` and its `endif` must pair with the right lines. A mod with a stray `if` or `endif` would pair them wrongly, so NRMM
   runs a copy of the XXMI ini parser (a C++ DLL, `GetErroredFlowControlLines`) and puts `;-;` in front of lines it flags
   (unbalanced flow control, bad key conditions, a few lines that crash XXMI). Marks are removed again when the line is valid.
7. Duplicate `namespace =` values across mods are renamed (`name_1`, `name_2`) and every `\name\` reference is rewritten.
   Known library namespaces (RabbitFx, ORFix, SlotFix, HealthBar, GIMI/SRMI/WWMI/ZZMI/EFMI cores, TexFx) are never renamed and
   must live outside `_MANAGED_`. NRMM reports missing and duplicated libraries.
8. The key editor disables a key by putting `;+;` in front of its section header and every line of the section.
9. A Restorer strips the manager lines again (pattern based, not from the backup) so mods can be shared.

### 2.3 The group file and how a pick reaches the game

Each `group_N.ini` has an explicit `namespace` (`modmanageragl\group_N`) and one persisted variable, `$active_slot`.
A mod's gate reads it by absolute name: `$\modmanageragl\group_N\active_slot`. Persisting means 3DMigoto saves it to
`d3dx_user.ini`, so the pick survives a restart.

How a number gets into that variable without a reload (the core trick):

- 3DMigoto exposes the Windows cursor to ini code as `cursor_screen_x` and `cursor_screen_y` (pixels, from `GetCursorInfo`).
- `group_N.ini` has a key section bound to `VK_CLEAR VK_RETURN` that runs `$active_slot = cursor_screen_x`, guarded by
  `$group_id == $\modmanageragl\group_manager\active_group_id`. `manager_group.ini` binds `VK_CLEAR VK_SPACE` to
  `$active_group_id = cursor_screen_y`.
- To pick slot S of group G the app: moves the cursor to (S, G), clips the cursor to a 1x1 pixel box, holds `VK_CLEAR`, taps
  `VK_SPACE` for 50 ms, taps `VK_RETURN` for 50 ms, releases, unclips and puts the cursor back. So the mouse position is the data
  channel and the key taps are the "send".
- Limits: coordinates must fit the screen, hence 500 groups and 500 slots.

### 2.4 Getting key presses into 3DMigoto

3DMigoto polls keys once per frame with `GetAsyncKeyState` (and XInput for pads), so `SendInput` taps work if held for a frame
or two. By default XXMI sets `check_foreground_window = 1` in `d3dx.ini [System]`: keys are only read while the foreground
window belongs to the game process. A manager window in front would be ignored. NRMM writes one of these, by what the DLL supports:

| DLL | What NRMM writes in `nrmm_keypress.txt` |
|---|---|
| Current XXMI libs (the string `additional_foreground_window` is in the DLL) | `[System] additional_foreground_window = <window title>` |
| NRMM's own old XXMI fork (now deprecated) | `[Loader] manager = <window title>` |
| Anything else, and Linux | `[System] check_foreground_window = 0` (keys work even when the game is not focused) |

`nrmm_include.ini` holds an `[IncludeKeypress]` section with `include = nrmm_keypress.txt`, so a `[System]` section in a file inside
`Mods` takes effect without editing `d3dx.ini`. The first time, the user presses F10. The XXMI source confirms the title match is
an exact string compare (`wcscmp`). NRMM's window title is `No Reload Mod Manager <Game_Name>`, set by the app per game.
The DLL probe reads `.rdata` of `d3d11.dll` and looks for the UTF-16 string.

### 2.5 The window and its inputs

- A frameless, always-on-top, skip-taskbar Flutter window, hidden by default. Alt+W (also Alt+S, Alt+A, Alt+D) is a system-wide
  hotkey. It shows the window only when the foreground process matches the configured process name for a game, otherwise it opens
  the tray menu. The window hides when it loses focus unless pinned.
- Gamepad: XInput polled by the app. Open with a button combo (LS+B, LS+A, LS+RB, Back+Start or LS+RS). The left stick moves like
  WASD, buttons act like F and Enter. Mouse works as normal.
- It has to show over the game, so the game must be windowed or borderless. Its own help text tells Linux users to avoid Fullscreen.
- Games are told apart by process name: `Client-Win64-Shipping.exe`, `GenshinImpact.exe`, `StarRail.exe`, `ZenlessZoneZero.exe`,
  `Endfield.exe` (editable). One manager instance serves several games at once.

### 2.6 Toggle buttons and keybinds

The Keys tab lists every `[Key*]` section of the selected mod: section name, `key` and `back` lines. Clicking a button parses the
key string and sends those keys with `SendInput` (shift keys last, 30 ms between keys). That is all. It does not read `type`,
`$var = list`, `condition`, or the current value, so there is no on/off state and no way to jump to a value. Keys can be edited
(text) or disabled (`;+;`). "Save mod customizations" copies values from `d3dx_user.ini` into the mod's `[Constants]` defaults.

### 2.7 Characters

There is no detection of the character on screen. A group is a folder the user makes per character. The group icon is guessed by
reading `hash =` lines of the group's first mods and looking them up in a community JSON (hash to character image, about 8 hex
digits, filled by form submissions). The "active" mod of a group is just the slot number.

## 3. Games and loaders

Why only five games: the game list, process names, default folders and icon tables are hard-coded. The path check wants
`d3dx.ini` and `d3d11.dll` beside `Mods`. The rewrite also needs a 3DMigoto that supports namespaces, cross-namespace variable
names (`$\ns\var`) and `persist` for namespaced variables. Old standalone 3DMigoto builds and 3rd-party DLLs fail the last part:
issues 10 and 11 are picks that were not remembered (fix: use the official XXMI libs, Unsafe Mode off). HI3 is not in its game list,
though nothing in the mechanism stops it.

| Loader | Game | Process | Notes for this feature |
|---|---|---|---|
| ZZMI | Zenless Zone Zero | `ZenlessZoneZero.exe` | Core namespace `ZZMIv1`, libraries SlotFix, HP bar and TTLib. Core ships a GPU text printer (section 6) |
| GIMI | Genshin Impact | `GenshinImpact.exe`, `YuanShen.exe` | Older mod style, often with the ORFix and RabbitFx libraries. Core namespaces `gimi`, `gimiv8` |
| SRMI | Honkai: Star Rail | `StarRail.exe` | Same style as GIMI. Core namespaces `srmi`, `srmiv1` |
| WWMI | Wuthering Waves | `Client-Win64-Shipping.exe` | Direct injection. Mods refer to the core by namespace `WWMIv1` (NRMM treats it as a library that must not be wrapped) |
| EFMI | Arknights: Endfield | `Endfield.exe` | Direct injection, same lineage as WWMI, core `EFMIv1`. Exporter bug with `(` in names (issue 37) |
| HIMI | Honkai Impact 3rd | `BH3.exe` | Not in NRMM. Core namespace UNCONFIRMED |
| Plain 3DMigoto | PGR, P5X, GF2 and others | per game | Works only if the DLL passes the checks above. `additional_foreground_window` may be missing, so fall back to `check_foreground_window = 0` (keys then fire when unfocused) |

All loaders share: `Mods` folder, `DISABLED*` exclusion, `d3dx_user.ini` next to `d3dx.ini`, F10 reload, `settings_auto_save_interval = 60`
and `clear_unknown_settings = 1` (saved values of variables that no longer exist are dropped after one more reload). The mechanism
in section 2 is loader-independent. Only the library list and process names differ.

## 4. Known limits and bugs (issue tracker)

- One active mod per group (issues 45, 1). Two mods for one character at once need two groups.
- No auto-quit with the game (57, 8), and with `check_foreground_window = 0` mod keys fire while the game is unfocused (8).
- Picks not remembered after restart: unofficial DLLs, or non-ASCII folder names with old DLLs (10, 11).
- Stray `if` or `endif` in a mod broke the gate (17). A mod that misbehaved only inside a group (5) was another mod interfering.
- Parentheses in names flagged as errors (37, an exporter bug). Intel GPU "model disappears" is not NRMM (21, 22).
- Reload time grows with the number of enabled mods. A third-party developer measured about 1.5 s of freeze per F10 with many
  mods (72). Disabling rarely used groups is the advice.
- Utility and shader mods (HealthBar, censor removers) must be single copies outside managed groups (2).
- Open requests: notes for toggles (12), randomise slot on start (20), update check from GameBanana links (36, 60).

## 5. Licence and what it means for us

- NRMM has no `LICENSE` file, the GitHub API reports no licence, and the README has none. That means all rights are reserved by
  default. Reading it is fine. Copying code, the `.ini` templates as written, icons or the hash JSON is not.
- On issue 72 (2026-10-30) another developer asked to reuse some of its ini rules with credit, and the author answered "It's fine, go
  ahead". That is a comment, not a licence, and it covers ideas and rules, not code. We use the ideas and write everything
  ourselves, with our own names (`gachamod\...`, not `modmanageragl`), our own templates and our own images. We credit NRMM in the
  About screen as the idea source.
- NRMM's C++ ini checker is derived from XXMI-Libs-Package, which is GPLv3 (3DMigoto is GPLv3). Do not copy it. We write our
  own flow-control check in Rust.
- ZZZ Mod Hub is GPLv3. This repo is MIT, so we read it for technique only and copy nothing. Same for 3DMigoto and XXMI source.
- Files we generate (ini, shaders, bitmaps) must be ours. Do not ship game art. Character images come from GameBanana or the wiki
  as the portraits module already does.

## 6. Other tools worth knowing

ZZZ Mod Hub (also listed as Fairy's Secret Folder, ZZZ focused) generates a real in-engine HUD. Its approach, in our words:

- A generator writes one ini per mod into a folder inside `Mods`, plus shared assets: one HLSL file that draws a rectangle, and PNG icons.
- It finds the mod's own mesh hashes and adds a `TextureOverride` that sets `$active_<id> = 1` whenever that mesh is drawn. The
  `[Present]` section clears it after each frame (`post`). So the HUD only exists for the character on screen. This is the only
  tool seen that tracks the on-screen character.
- A key toggles the HUD. Mouse position comes from `cursor_x`/`cursor_y` (fallbacks `cursor_window_*`, `cursor_screen_*`,
  divided by the window size). Click and drag are Key sections on `VK_LBUTTON` (`type = hold` for drag), gated by "hovering"
  variables computed with plain `if` arithmetic.
- Drawing is a `CustomShader` with `vs` and `ps` from the same file, `topology = triangle_strip`, `Draw = 4,0` (no vertex buffer, the
  vertex shader builds the corners from `SV_VertexID`), `blend = ADD SRC_ALPHA INV_SRC_ALPHA`, `cull = none`,
  `o0 = set_viewport bb` after `run = BuiltInCommandListUnbindAllRenderTargets`. Rectangle position and size go in as `IniParams`
  slot 87 (`x87`, `y87`, `z87`, `w87`), and the image is bound to `ps-t100`.
- Clicking a slot changes a variable: toggle `v = 1 - v`, cycle `v = v + 1` wrapping at the max, or `run =` a command list.
  State is shown by drawing the icon normally or with a dimmed shader. Eight slots per page. Icons only, no text.
- An older "classic" mode uses the loader core's text printer. ZZMI core has it: set `Resource\ZZMIv1\Text` (character bytes, `R8_UINT`)
  and `TextParams` (a structured buffer: rectangle, colours, background, border, anchors, alignment, font scale) and
  `run = CommandList\ZZMIv1\PrintText`. Inside, a compute shader lays the characters out and a vertex plus geometry shader emits one
  quad per character from a font texture (`Core/ZZMI/Fonts/LiberationSans-Bold.dds`; text at `t113`, params at `t114`, font at `t100`).
  Text is a static buffer, so changing wording means choosing between pre-made buffers. Other cores UNCONFIRMED.
- Unclear: it writes bare `$var` names in a namespaced HUD ini, which would not reach the mod's own variables, so it probably also
  injects lines into the mod's ini (its cleanup code strips marked injections). We do not copy this.

IMM (research.md) switches by renaming folders and sending F10, which costs the 1 to 2 s reload.

## 7. Techniques for our own implementation

Names below are ours. Check each against the spike list in section 9 before building on it.

### 7.1 Live groups (the no-reload gate)

A "live group" is a set of mutually exclusive mods, normally one character's skins. The library already knows characters from
GameBanana categories, so groups are made by the app, not by the user. One central generated ini, for example
`Mods\gachamod live\live.ini`, holds one persisted variable per group:

```
namespace = gachamod\live

[Constants]
global persist $g7 = 0
```

Each live mod's draw sections are wrapped, with the slot as a literal (no per-mod variable needed):

```
[TextureOverrideBody]
hash = 1a2b3c4d
match_priority = 0
; gachamod:begin
if $\gachamod\live\g7 == 3
    vb0 = ResourceBodyVB
    drawindexed = auto
endif
; gachamod:end
```

Keys get `condition = (<old>) && $\gachamod\live\g7 == 3`. Rules we keep from the NRMM analysis: the section lists in 2.2, settings keys
stay outside the `if`, never wrap CommandList, CustomShader, Resource or Constants, and never wrap library mods.

Differences we choose:

- Slot numbers come from our database and are never reused while a mod is in the group, not from folder order. Moving, adding or
  removing a mod then never shifts another mod's slot.
- We do not use `.ini_managed_backup` sidecars or flag files in mod folders. The original goes through `crate::backups`, the
  record of what was wrapped lives in our database, and the fenced `; gachamod:begin/end` comments make unwrapping deterministic
  and let us tell our edits from the author's.
- If a section's `if`/`endif` do not balance, do not wrap and do not comment out the author's lines. Leave the mod alone and show
  "can't be switched live: unbalanced if in <file>". Write the check ourselves.
- `ini.rs::parse` drops comments, blank lines and key case, so it cannot be used to rewrite. Add a separate line-preserving section
  splitter. Keep each file's encoding, BOM and line endings, and write through `xxmi::write_atomic`.
- Detect NRMM-managed mods (`modmanageragl` in an ini, a `_MANAGED_` folder) and refuse until the user restores them.
- Alternative we considered: leave library originals untouched and wrap a hard-linked mirror under `Mods`. It avoids editing the
  originals but splits state into two copies the rest of the app must hide. Not recommended for the first version.

### 7.2 The command channel (app to game, no reload)

Same idea as NRMM, one press instead of two. A central key section on a combination nobody uses, for example `VK_CLEAR VK_F13`
(F13 to F24 are valid key names in 3DMigoto), runs a command list that branches on `cursor_screen_y` and writes
`cursor_screen_x` into the matching variable:

```
[KeyGmSlot]
key = VK_CLEAR VK_F13
run = CommandListGmSlot

[CommandListGmSlot]
if cursor_screen_y == 7
    $g7 = cursor_screen_x
endif
```

Verbs use different keys: F13 pick a slot (y = group, x = slot), F14 apply a profile (x = profile number), F15 set a toggle (y = control
number, x = value). Rules: hold each key at least 90 ms (our `devtools::win::press_f10` already does this), clip the cursor to one
pixel during the tap, restore it after, and keep every coordinate under the smallest screen dimension (about 700). Reuse the
`windows_sys` input code in `devtools.rs`. DPI virtualisation of cursor coordinates in the game process is UNCONFIRMED (test at 125% and 150%).

The app cannot read live values back. It remembers what it sent, and re-syncs from `d3dx_user.ini` (3DMigoto rewrites it every 60 s,
on exit and on F10) using `ini::user_vars`. A profile must set all its values from a known baseline.

Foreground rule: write `[System] additional_foreground_window = <title>` through an included text file the way NRMM does (needs one F10
the first time), or through the XXMI config override `Importers.<CODE>.Importer.d3dx_ini` listed in `docs/research.md`. Our overlay window
title must equal that string exactly. Probe `d3d11.dll` for the UTF-16 string like NRMM, and fall back to `check_foreground_window = 0` with a plain warning.

### 7.3 Toggle detection and writing

`ini.rs` already finds `[Key*]` sections with kind (cycle, toggle, hold, activate), `key`/`back` lines, the variables and their value
lists, `persist`, defaults and current values, and guesses labels. A menu control is built from this:

| Detected | Control | Written how |
|---|---|---|
| `$v = 0,1`, cycle or toggle | switch | set `$v` directly to 0 or 1 |
| `$v = a,b,c,...` cycle | list | set `$v` to the chosen value (not "press until it lands") |
| `run = CommandList...`, activate | button | `run =` the command list, or tap the key |
| hold, or no variable and no run | key button | simulate the key as NRMM does |
| `condition = $active == 1` | note | "only works when the character is on screen" |

Direct writes need the variable to be addressable. Mod namespaces default to the ini path (`mods\furina\furina.ini`), which can hold
spaces and brackets that an expression may not accept (UNCONFIRMED, spike 4). For every live mod add an explicit `namespace = gachamod\m<id>` to each ini that
has none, only when no ini of that mod refers to another by path, and move the saved values in `d3dx_user.ini` to the new names (generalise
`ini::move_user_vars`). If that is not safe for a mod, append a setter block inside the mod's own namespace instead. It reads the channel
and assigns local names, so nothing outside needs the mod's name.

### 7.4 The menu: two ways to show it

| | Overlay window (like NRMM) | In-engine HUD (like ZZZ Mod Hub) |
|---|---|---|
| Effort | Low. A second Tauri window with our React UI, themes, search, icons | High. Generated ini and one shader, bitmaps for text |
| Needs | Windowed or borderless, foreground rule above, the channel | Cursor visible in game, nothing else |
| Exclusive fullscreen | Does not show | Works |
| Mouse | Normal | `cursor_*` variables plus `VK_LBUTTON` keys |
| Controller | XInput polled by the app | `XB_*` key names in Key sections (also move the character, since the game sees the pad) |
| State shown | From what the app remembers | Live, by reading variables |
| Search, filters, huge lists | Easy | Paging by hand |

Recommendation: ship the overlay window first. It reaches every loader and reuses the app's design. Treat the HUD as a second step. If we
build it, pre-render every label as a bitmap in the app (one image per label and state, or an atlas) and draw rectangles. That keeps it
independent of each loader's text printer and works for any language. The on/off look comes from choosing which bitmap to bind.

### 7.5 On-screen tracking (fixes keys of characters not on screen)

Per live mod, add one variable in our namespace, `$\gachamod\vis\m<id>`. Inside each wrapped mesh `TextureOverride` set it to 1. Clear all of
them with `post` in a generated `[Present]`. Add `&& $\gachamod\vis\m<id> == 1` to the mod's key conditions. Keys of characters that are not drawn stop
working. The pattern is the same one many mods already use (`$active`). Make it a per-mod switch: some mods have toggles for things that are
drawn with other hashes (menus, previews). The HUD can use the same flag to show only the characters on screen. UNCONFIRMED: key
evaluation order against the per-frame reset.

### 7.6 Profiles in game

A profile is a list of (group, slot) and (control, value). Generate one command list per profile in `live.ini` that sets every variable.
One channel tap (F14, x = profile) applies it, no F10. The existing in-game profile hotkeys (`hotkeys.rs`) then switch instantly for live
characters and fall back to rename plus F10 for the rest.

## 8. What the app can do better than NRMM

- Groups are automatic from GameBanana characters. No dragging mods into numbered folders. Search, categories and the library
  filters already work on the same mods.
- A live mod is still a normal library mod: enable, disable, trash, update and conflict checks keep working. Live is a per-mod option
  in the mod drawer (`InGameOptions`) and a section in Tools (`InGamePanel`).
- Toggles show real state and values, with names the player recognises. Per mod the user can rename a control, hide it, reorder it,
  pick an icon, group several, or leave a mod out of the menu. Stored in our database, never in the mod folder. Defaults come from
  `ini.rs` labels ("Jacket", "Hat") so most mods need no editing.
- One global menu: pinned toggles from any mod, search, "characters on screen first", recent.
- Profiles including toggle values (7.6).
- Keys of off-screen characters stop firing (7.5).
- Every change is undoable (`history.rs`), files go through `backups`, and unwrapping is exact.
- The first-run check is a plain list: loader version OK, `additional_foreground_window` OK, libraries outside live groups, mods that cannot go live and why.

## 9. Risks and what to test first

Risks:

- Memory and reload time. Every live mod is parsed at each reload, and NRMM's users report slower F10 with many mods. Resource files
  load the first time something binds them and are never unloaded (3DMigoto source), so inactive skins cost nothing until picked,
  but cycling many big skins in one session grows memory until the next reload. Offer "live" per character, not for the whole
  library, and show the number of live mods.
- Wrapping breaks some mods. Libraries and utility mods (SlotFix, HealthBar, ORFix, RabbitFx, cores) must never be wrapped. Mods whose `[Present]` or
  TextureOverride changes global state that other mods read, mods that call each other by path, mods with unbalanced `if`, and mods with
  non-ASCII or very long paths (200 characters or more) can fail. We detect and skip them, with a reason.
- Merged mods (several characters or several outfits in one folder) occupy one slot. They cannot be half live. Detect two or more character hash sets and
  say so. A multi-ini mod needs the same slot in all its inis.
- Mods with their own UI (a custom shader, the core text printer, a key that opens a menu). Mark them and do not add our own menu entries by default.
- The channel moves the real mouse for a few milliseconds, so it can be seen and can interfere with a held drag. Keep taps short.
  Using `SendInput` and `SetCursorPos` against a game with an anti-cheat is the same risk class as injection itself. Say so in the settings text.
- Persisted values orphan when a namespace changes. Migrate them in the same step as the rename and keep a backup.
- Two managers editing the same inis (NRMM, IMM) and unofficial DLLs that cannot save namespaced variables.

Spikes before building (each is a short test in a real game):

1. A wrapped TextureOverride with the same hash in two skins: no warning overlay, only the picked skin draws, pick survives restart.
2. One-press channel with (x, y) at 100%, 125% and 150% display scaling, and at 30 fps.
3. A Tauri window title equal to `additional_foreground_window` keeps keys alive. A `[System]` section from an included text file takes
   effect after one F10.
4. Cross-namespace read and write of a mod variable by an explicit `gachamod\m<id>` namespace, and an expression naming a mod with spaces in its path (to
   confirm we need the namespace step).
5. The on-screen flag against key order (7.5) with a real ZZZ mod that already uses `$active`.
6. If we build the HUD: cursor visibility in each game, click detection with `VK_LBUTTON`, and behaviour in exclusive fullscreen.

Suggested build order: 7.1 and 7.2 first (live groups, channel, foreground rule, a plain list in `InGamePanel` to pick slots), then
7.3 (toggle list and direct writes) with the overlay window, then 7.6 and 7.5, then the HUD if the overlay proves too limited.

## 10. What's built

7.1 and 7.2 are in `crates/gacha-core/src/live.rs`, with Tools > Switch skins in game (`InGamePanel`), the In game panel in a mod's
details (`InGameOptions`) and a Live tag on mod cards. Instead of the foreground rule, the app brings the game to the front for each tap
(`devtools::focus_game`), so no `[System]` change is written. With the game closed a pick is saved to `d3dx_user.ini` for the next start.

The channel in 7.2 was built with the cursor and didn't work in play: a game that hides the cursor puts it back in the
middle of its window every frame, so the loader read the middle, never (slot, group). Seen in ZZZ on 2026-11-14. The
channel is keys only now (`live_ini`, `win::tap`). While the app holds Clear, each of F13 to F22 it holds is one bit of a
number (ten `[KeyGachamodBit<n>]` sections of `type = hold`). A tap of F23 keeps that number as the group, and a tap of
F24 sets that group's `$g` to the number. With no group, the number 1 opens or closes the menu the game draws. A pick is
two numbers and takes a little under half a second, after the game is brought forward. Nothing depends on screen size
or display scaling any more.

The app's idea of what shows can be behind (a pick made in the game's own menu), so while the game runs a pick is always
sent, also when the app thinks that skin already shows. The game saves `d3dx_user.ini` about once a minute and on a
reload: a save newer than the app's last pick is read back (`load_synced`, `saved_since_sent`), so the app follows picks
made in the game.

Every character (`<game>.liveAll`, the switch in the panel, `live::set_all` and `auto_add`): every mod that has a
character, has an ini and isn't a sub-mod goes live, and new ones join after a scan. A mod taken out by hand is kept in
the store's `out` list and stays out until the switch is turned on again.

Buffer sizes: a mod with more vertices than the game's model has `[TextureOverride...VertexLimitRaise]` sections with
`override_vertex_count` and `override_byte_stride`. The loader reads those when it first meets the buffer, not when a
skin is picked. Gated, a skin that wasn't showing at the last reload drew wrong until one more F10 (seen in ZZZ with a
character whose only mod had been off). Both keys now count as settings and stay above the gate, and every skin of a
character asks for the largest count any of them needs for the same hash (`raises`, with the author's own number kept in
a `; gachamod:was` line). Not yet checked in a game: that a first pick now shows without an F10.

The library's own on/off goes through the same picks. `library::set_enabled` and `apply_states` (profile switches, so
profile hotkeys too) send live skins to `live::switch`: on picks that skin (the last one per character wins), off picks
none when it's the one showing. Their folders never rename, so nothing reloads. A live skin that isn't showing is on
standby: `ModEntry.standby` is set, `enabled` is false, and `loaded()` says the folder is on. Code that cares about the
folder (saved values, reloads) reads `loaded()`; everything the player sees reads `enabled`. Picks made while the game
runs queue up, and the command that made them calls `live::flush_sends` once the database lock is free. A scan or an
install gates a live skin again when its ini lost the gate (an update), and a skin back from the trash that isn't live
loses old gates.

Not built yet: 7.3 (toggles in the menu) and 7.6 (profiles with toggle values).

To check in each game: spikes 1 and 2 above, the gate on `$\gachamod\live\gN` from a mod's own namespace, and the pick surviving
a restart.

## 11. The menu while playing

The player opens a skin menu with one key (F7 by default, since F6 and F12 are the loaders' own and F10 reloads) or by
pressing both sticks of a controller in. The game's setting `<game>.liveMenu` picks which menu, with `<game>.liveMenuKey`
and `<game>.liveMenuPad` beside it (Tools > Switch skins in game, `MenuOptions`).

| Setting | What opens | Where the key lives |
|---|---|---|
| `window` (default) | gachamod's own window over the game. In exclusive fullscreen, the menu the game draws | The app holds the key while the game runs |
| `game` | Always the menu the game draws | A `[KeyMenuOpen]` section in live.ini |
| `off` | Nothing | Nowhere |

### The window over the game

`src-tauri/src/overlay.rs` and `src/screens/ingame/Overlay.tsx`. A second Tauri window (label `overlay`): no frame, always
on top, not in the taskbar, made when a game with live characters starts and dropped when it stops. The menu key is a
global shortcut registered with the profile hotkeys (`hotkeys.rs`), and a thread reads XInput for both sticks while such a
game runs. Opening places the window down the left side of the game's window and gives it the keyboard
(`devtools::raise`). It lists every live character, the ones picked last first, with each skin as a picture, and has a
search field. A pick goes through `overlay_pick` (the same `live::pick` and key channel as the app), which brings the
game forward, and the window hides when it loses focus. Esc, the menu key and B close it. Closing the main window ends
the app: the menu window is made again whenever its key is pressed, and would otherwise keep the app running with no
window to close.

The app can't show a window over exclusive fullscreen. `devtools::exclusive_fullscreen` asks Windows
(`SHQueryUserNotificationState` says a Direct3D program holds the screen), and then the key sends the number 1 with no
group, which runs `CommandListMenuToggle` in live.ini.

`npm run dev` then http://localhost:1420/#overlay shows the window's UI with demo data.

### The menu the game draws

`crates/gacha-core/src/live/menu.rs`. Files next to live.ini, all written by the app:

- `menu.hlsl`: one shader that draws a rectangle, a piece of a picture or a flat colour. No vertex buffer. Position, the
  piece and the window size arrive in IniParams 86 to 89, which the draw list saves and puts back.
- `menu<group>.dds`: one picture per character, a header and one row per skin with the thumbnail and name drawn in.
  Text is drawn by Windows (GDI), so names in any language show. Made for the screen's height and scaled by the shader.
- `menu0.dds`: the list of characters, one row each, when there are two or more.
- `menu.dds`: the two footers with the key hints, the scroll buttons and the check mark.
- `menu.json`: a hash per picture, so only pictures whose names or previews changed are made again.

Sections added to live.ini: `[Present]` runs `CommandListMenuFrame` while `$open` is 1, which works out the window size
(the same fallbacks as the ZZMI core's text printer), which row the mouse is over, and draws about six rectangles through
`[CustomShaderMenuQuad]`. Showing a row sets `$g<group>`, the number the gates read, so no tap from the app is needed.

Pages: one per character (by name) with its skins, and with two or more characters one more that lists the characters.
Up and down move, right (or A) shows the row, a click on a row shows it (hold Alt for the cursor). Left, or a click on a
character's header, goes to the list of characters with the cursor on the one that was open; right or a click there
opens a character. Enter does the same as right but isn't in the hints, since games open their chat on Enter.

Which character is on screen: every gated TextureOverride starts with `run = CommandList\gachamod\live\Seen<group>`,
which sets a flag that `[Present]` reads and clears. The menu opens on that character each time its key is pressed, and
the list of characters has its check on them. A live skin's keys also get `&& $\gachamod\live\open == 0`, so arrow keys
in the menu don't flip its toggles. Mods gated by an older version get both on the next scan.

Checked without a game: the shader compiles with fxc for vs_5_0 and ps_5_0, the generated sections balance their ifs and
only run lists that exist (tests in `menu.rs`), and the .dds reads back. `GACHAMOD_MENU_PNG=<folder> cargo test -p gacha-core
mock_picture` writes a picture of the menu and the generated sections there.

### Games that run as administrator

Zenless Zone Zero runs as administrator. Windows then drops every key an app that isn't one presses for the game
(`SendInput`), and never passes that app a hotkey pressed in the game. Seen in ZZZ on 2026-11-14: gachamod's F7 opened
its window while gachamod was in front and did nothing while the game was, and its F10 never reloaded the game.

- `devtools::keys_blocked` is true while the game runs as administrator and gachamod doesn't. The reload watcher then
  doesn't press F10. `devtools::f10_note` says "Press F10 in the game to load changes" once per game per run of the
  app, the first time a change waits for it; a reload asked for by hand still fails with the longer reason.
- A pick that can't be keyed in (the game runs as administrator, or wouldn't come to the front) waits in live.ini
  (`live::defer`, `Store.waiting` and `Store.ask`). `[CommandListGachamodAsked]`, run from `[Present]`, sets those
  groups once, on the first frame after a load, and stores the request's number in `$asked`, a saved value. Without it
  F10 did nothing for an app pick: the game's saved value wins over live.ini's default at a load, so the app's pick was
  lost, and when the game saved, the app read the old skin back. That is the "couldn't take a skin off" report of
  2026-11-14 (gachamod not an administrator, the game one, picks made in the app and in the game's menu).
- Until the game has saved `asked` equal to the request's number, what it saves for the waiting groups is older than the
  app's pick and isn't read back. A tap that does reach the game takes its group out of the request
  (`live::delivered`). With the game closed, waiting picks go into d3dx_user.ini, unless the game took them before it
  closed (then its saved values are the newer ones).
- A pick stays in the send queue until its tap is done, and those groups aren't read back meanwhile. Taps go one at a
  time (`TAPPING`), the drawn menu's toggle included, since two at once would key in a mix of both numbers.
- The game closed without a save since the app's last tap: the app's picks are newer, so they go into d3dx_user.ini
  rather than being read back from it.
- A group made while the game runs asks for its pick the same way, since its number may be one a removed group used
  and the game may still have that group's pick saved.
- A change to the `global persist $gN` defaults alone (a pick read back from the game) needs no reload, so a scan
  after an in-game pick doesn't press F10.
- live.ini binds the menu key in the game when gachamod can't hear it, which depends on whether gachamod runs as
  administrator in this run. `live::on_start` writes live.ini again when the app starts, and `note_elevation` does when
  the game starts, so switching gachamod between administrator and not doesn't leave F7 doing nothing.
- The app notes whether each game ran as administrator (`<game>.elevated`, `live::note_elevation`, when the game starts).
  While that is set and gachamod isn't an administrator, live.ini binds the menu key itself, whatever the setting, so the
  key opens the menu the game draws. `LiveInfo.blocked` puts a notice in the panel with "Restart as administrator"
  (`devtools::restart_elevated`: ShellExecute `runas`, and the new copy waits for the old one to quit).
- Under `npm run app` that button ends the dev run. Start the terminal as administrator and run `npm run app` from it.

### Checked in ZZZ on 2026-11-14

With gachamod and the game both running as administrator, the game borderless at 2560x1440 and 125% scaling:

- The drawn menu shows and is laid out right. It opens on the character on screen. Left shows the list of seven
  characters, Enter opens one, up, down and Enter pick a skin, and the outfit changes in the same moment.
- A pick from the app (`live::pick`), from the library's on and off (`set_enabled`) and from the menu window changes the
  skin through the key channel, also when the app's idea of what shows was behind.
- The app's F10 reloads the game, by hand (`dev_reload`) and by itself after a change while the game is in front.
- F7 opens gachamod's window over the game, and the number 1 with no group closes and opens the drawn menu.
- Every character made all seven characters with mods live, turned on the two mods that were off, and the game reloaded.

Checked again later the same day, the game as administrator and gachamod not (keys pressed by a separate elevated
helper, the app's logic driven from a small program on the real library):

- An app pick while the keys can't reach the game: live.ini gets the request, F10 shows the picked skin.
- Then a pick in the game's menu, then F10 again: the game's pick stays, the old request doesn't come back. The app reads
  the game's pick back once the game saves `asked`.
- The loader saves d3dx_user.ini 5 to 15 seconds after a change made by a key (the drawn menu or the key channel), not
  after a reload. F10 a second after a pick in the game's menu keeps that pick.
- The drawn menu: right shows a skin and opens a character on the list, left goes to the list, a click with Alt held
  picks a row, F7 closes. The hints read "→ show" and "→ open".
- A pick keyed in by an administrator copy of the app changes the skin at once, with no note.
- Every Velina skin raises buffer sizes (`override_vertex_count`); after one F10 each skin, also ones not shown at that
  load, drew right on its first pick. That settles the buffer size change above.
- A mod whose ini had an `endif` with no `if` (Pearlescent Angel Velina, hair part) was left out of "every character"
  without a word. The gate now turns such an endif into a comment (the loader skips it anyway); the mod joined and
  shows right, hair included.
- A download of a new character's mods joins "every character" at once (`live::settle` after an install), not at the
  next scan.

### Still to check

1. Both sticks pressed in open the menu, and the D-pad and A work in both menus.
2. Exclusive fullscreen with Over the game chosen: F7 opens the drawn menu. If nothing opens, Windows didn't report
   exclusive fullscreen, and Inside the game is the setting to use.
3. A mod toggle bound to an arrow key doesn't fire while the drawn menu is open (the mods here bind arrows only with
   Ctrl, Alt or Shift).
4. The other loaders. Their `check_foreground_window` may differ, and a game that doesn't run as administrator needs
   no administrator rights for gachamod. Players with those games run Help, Check this game (docs/testing.md).
5. An F10 pressed before the game saved a request it took (no key pressed since): the request runs again at that load.
   It sets the same skin the app picked, so it only matters if the player picked another one in the game and pressed
   F10 within a few seconds.

Known limits: the game also sees the keys and buttons pressed in the drawn menu. A pick from the app or the menu window
brings the game forward first and takes most of a second. XXMI Launcher writes `check_foreground_window` into d3dx.ini at
launch (it was 1 in these runs), so the loader only reads keys while the game is in front.

## Sources

NRMM repo and issues (github.com/Aglglg/No-Reload-Mod-Manager), its GameBanana pages (tools 19862, 21978), SpectrumQT/XXMI-Libs-Package
(`DirectX11/input.cpp`, `IniHandler.cpp`, `CommandList.cpp`, `vkeys.h`), leotorrez/ZZMI-Package (`d3dx.ini`, `Core/ZZMI/help.ini`, `main.ini`),
the-sea-man/ZZZ-Mod-Hub (`src-tauri/src/services/ui_generator`), bo3b/3Dmigoto (`COPYING.txt`), `docs/research.md`.
