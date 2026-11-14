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

Not built yet: 7.3 to 7.6. Profiles don't pick live skins yet, and the one-skin rule leaves live mods alone.

None of it has run in a real game. Spikes 1 and 2 above are the first things to check, plus the gate on `$\gachamod\live\gN` from
a mod's own namespace and the pick surviving a restart.

## Sources

NRMM repo and issues (github.com/Aglglg/No-Reload-Mod-Manager), its GameBanana pages (tools 19862, 21978), SpectrumQT/XXMI-Libs-Package
(`DirectX11/input.cpp`, `IniHandler.cpp`, `CommandList.cpp`, `vkeys.h`), leotorrez/ZZMI-Package (`d3dx.ini`, `Core/ZZMI/help.ini`, `main.ini`),
the-sea-man/ZZZ-Mod-Hub (`src-tauri/src/services/ui_generator`), bo3b/3Dmigoto (`COPYING.txt`), `docs/research.md`.
