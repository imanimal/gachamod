# Other apps' global keys

Checked 16 Nov 2026. Recorders and overlays listen for keys in every app, so a key of theirs fires together with
gachamod's: Medal takes a screenshot on F7, which also opens the skin menu. `crates/gacha-core/src/otherkeys.rs` reads
the keys these apps have set and offers to move gachamod's key. For Medal it can change Medal's key instead, when
the player asks (see "Changing Medal's key"). Every other app's settings are only read.

Sources are vendor pages, the app's own source, other people's parsers, and one PC that has Medal, AMD Software,
Steam and OBS installed. Items marked UNCONFIRMED were not seen on a real install or in a primary source.

## What the app reads

| App | Where | Keys it ships with | Read by gachamod | Written |
|---|---|---|---|---|
| Medal | `%APPDATA%\Medal\medal-<user id>.db` (older Medal: `store\settings.json`) | F8 clip, F7 screenshot, Alt+F7 record, F10 switch game | the database, else the file | one value, on request |
| OBS Studio | `%APPDATA%\obs-studio\basic\profiles\<profile>\basic.ini` | none | the file | no |
| Steam | `<Steam>\userdata\<id>\config\localconfig.vdf` | F12 screenshot, Shift+Tab overlay | the file, else F12 "by default" | no |
| AMD Software | registry `Software\AMD\DVR` (HKLM, HKCU on top) | all with Ctrl+Shift or Alt | the registry | no |
| Xbox Game Bar | registry `HKCU\Software\Microsoft\Windows\CurrentVersion\GameDVR` | all with Win | the player's own shortcuts | no |
| NVIDIA App, GeForce Experience | registry `HKCU\Software\NVIDIA Corporation\Global\ShadowPlay\NVSPCAPS` | all with Alt | changed keys only | no |
| Bandicam | registry `HKCU\Software\BANDISOFT\BANDICAM\OPTION` | F12 record, F11 screenshot, F9 FPS counter | installed or not, then "by default" | no |

Not read, because their keys all have a modifier and no settings file is known: Outplayed and Overwolf, SteelSeries
Moments, Discord. Not read, because nothing shows whether they are installed: Fraps, Mirillis Action!.

## Medal

Everything here is from Medal's own app code (`resources\app.asar` of the install on the test PC, Nov 2026) and that
PC's files, unless it says otherwise.

- Medal keeps its settings in SQLite: `%APPDATA%\Medal\medal-<user id>.db` when signed in, `medal-guest.db` when not.
  The `User` row of `medal-guest.db` (`userId`, `guest`) says which. Both are in WAL mode.
- Table `key_values (key TEXT UNIQUE, value BLOB)`. A value is SQLite's binary JSON: Medal writes
  `INSERT OR REPLACE INTO key_values VALUES (?, jsonb(?))` and reads `SELECT json(value)`, straight from the
  database each time.
- Row `Hotkeys` is a list of `{"action": "...", "device": "keyboard", "type": "short_press", "inputs": "F7"}`.
  `inputs` joins modifiers and the key with ` + `: `"ALT + F7"`, `"ALT + SHIFT + d"`.
- The list Medal ships with, the same as the test PC's row: `clip;length=30` F8, `bookmark` F8, `segment_toggle`
  Alt+F7, `screenshot` F7, `switch_game` F10, `callback;event=dismiss` Alt+Shift+D. It is used when there is no
  `Hotkeys` row.
- Medal's help page agrees on F8 for a clip and Alt+F7 for a long recording
  ([how to record](https://support.medal.tv/support/solutions/articles/48001157618-how-to-record-and-make-clips)),
  and a [Medal blog post](https://blog.medal.tv/posts/how-to-be-a-cinematic-bf6-photographer-yes-its-a-thing) on F7
  for a screenshot. An F6 screenshot key was reported by a player and not found in any source: UNCONFIRMED. It is
  read from the row either way.
- Medal drops a key before the list reaches its recorder: `screenshot` when row `ScreenshotEnabled` is false,
  `switch_game` when `GameSwitchHotkeyEnabled` is false, `ptt_hold` unless `PushToTalkEnabled` is true, and any key
  with empty `inputs`. gachamod skips the same ones. On the test PC `ScreenshotEnabled` was false, so F7 is not
  reported there. Not tried in a game: UNCONFIRMED that F7 does nothing with it off.
- Older Medal kept all this in `%APPDATA%\Medal\store\settings.json` (`recorder.triggerHotkeys`,
  `recorder.screenshotEnabled`, `recorder.gameSwitchEnabled`, `recorder.pushToTalkKeyEnabled`). Three other projects
  read that file: [laugh-clipper](https://github.com/Bryson-he/laugh-clipper/blob/HEAD/laughclipper/medal.py),
  [hindsight](https://github.com/aattiaibrahim/hindsight/blob/HEAD/src-tauri/src/bench/recorders.rs),
  [capri-mods](https://github.com/lachydotmcg/capri-mods/blob/HEAD/mods/medal-clip/medal-clip.capri-code).
  Newer Medal copies it into the database once (row `settings_migration_version` = 2) and then goes by the database,
  so the file can be out of date. gachamod reads it only when there is no database, and never writes it.
- gachamod opens the database read only, so Medal can run meanwhile.

### Changing Medal's key

"Change Medal's key" in the note gives Medal the free key and leaves gachamod's alone.

- What is written: `UPDATE key_values SET value = jsonb_set(value, '$[N].inputs', 'F9') WHERE key = 'Hotkeys'`, once
  for each entry on the old key (clip and bookmark share F8), in one transaction. Nothing else in the row or the
  database changes; a test compares the bytes. The row is read back afterwards and the change fails if the key
  isn't there.
- Only while Medal is closed (`Medal.exe` and `MedalEncoder.exe` not running). Medal hands the keys to its recorder
  when it starts and when it changes one itself, and its settings page saves the whole list from what it has
  loaded, so a change made under a running Medal would not work until a restart and could be written over.
  gachamod says "Medal is running. Quit it from its tray icon, then try again" and writes nothing. It never closes
  or restarts Medal.
- Backup: before the first write of each gachamod run, the database is copied to
  `%APPDATA%\Medal\medal-<user id>.db.gachamod.bak` (and its write-ahead file, when it holds anything, to
  `...gachamod.bak-wal`). To go back, close Medal and copy it over `medal-<user id>.db`.
- The new key is always a bare F key that is free: not F6, F10 or F12, not one of gachamod's, not one any found app
  uses (Medal's own included). It is the same key "Use F9" offers.
- Only keys gachamod can write back exactly the way Medal wrote them (`F7`, `ALT + F7`, `ALT + SHIFT + d`) get the
  button, so Undo restores the old text exactly. Undo follows the same closed rule.
- No button when Medal has no `Hotkeys` row (it runs on the keys it ships with) or only the older settings.json.
- UNCONFIRMED: Medal sends its settings to its servers when it starts. Its code only shows them being sent, not
  fetched back over the local ones, but a changed key was not tried against a signed-in Medal start.

### Why the other apps have no button

- OBS: the format is from its source only. The test PC's OBS has no hotkeys, so a line was never seen, and OBS
  writes its settings back when it closes.
- AMD Software: the values are in HKLM (needs administrator), how a bare F key is spelled there is UNCONFIRMED,
  and its background service can't be asked to close.
- Steam, Xbox Game Bar, NVIDIA, Bandicam: storage unconfirmed or binary.

## OBS Studio

All from OBS source.

- Hotkeys are in `[Hotkeys]` of the profile's `basic.ini`
  ([OBSBasicSettings.cpp](https://github.com/obsproject/obs-studio/blob/master/frontend/settings/OBSBasicSettings.cpp)).
  The profile in use is `[Basic] ProfileDir` in `user.ini` (OBS 31 and later) or `global.ini`; that part comes from
  hindsight's reader, and matched the test PC. When it can't be found gachamod reads every profile.
- One line per action: `OBSBasic.StartRecording={"bindings":[{"key":"OBS_KEY_F9"}]}`. Modifiers are `"shift"`,
  `"control"`, `"alt"`, `"command"`, written only when true
  ([obs-hotkey.c](https://github.com/obsproject/obs-studio/blob/master/libobs/obs-hotkey.c),
  [key names](https://github.com/obsproject/obs-studio/blob/master/libobs/obs-hotkeys.h)).
- Action names are in
  [OBSBasic_Hotkeys.cpp](https://github.com/obsproject/obs-studio/blob/master/frontend/widgets/OBSBasic_Hotkeys.cpp):
  `OBSBasic.StartRecording`, `StopRecording`, `SaveReplayBuffer`, `Screenshot`, `StartStreaming` and more. An older
  OBS wrote the replay key as `ReplayBuffer={"ReplayBuffer.Save":[...]}`.
- OBS sets no keys itself. The test PC's profile had no `[Hotkeys]` section.
- Hotkeys of single sources and scenes are stored elsewhere and not read. UNCONFIRMED where.

## Steam

- Names and defaults are in Steam's own settings list
  ([steammessages_clientsettings.proto](https://github.com/SteamTracking/SteamTracking/blob/master/Protobufs/steammessages_clientsettings.proto)):
  `system\InGameOverlayScreenshotHotKey` is `KEY_F12`, `system\InGameOverlayShortcutKey` is `Shift\tKEY_TAB`. F12 is
  also in [Valve's docs](https://partner.steamgames.com/doc/features/screenshots).
- Modifiers and the key are separated by a tab, and the key is `KEY_<NAME>`.
- These are "user local" settings. That they land in `localconfig.vdf` is UNCONFIRMED: the three accounts on the test
  PC have a `system` block there but never changed the key, so the line isn't written.
- gachamod reads the newest `localconfig.vdf`, and without the line says F12 "by default". F12 is a loader key, so
  it only matters when a player picked it for gachamod.
- Steam's keys only work in games started with its overlay.

## AMD Software

- Values are text under `HKLM\Software\AMD\DVR`, with the player's own under `HKCU\Software\AMD\DVR`. Seen on the test
  PC and read the same way by
  [AMDHotkeys](https://github.com/johngibbs/AMDHotkeys/blob/HEAD/AMDHotkeys.psm1) and
  [replay-vault](https://github.com/ItsFlamme/replay-vault/blob/HEAD/src/amd.rs).
- Format: modifiers joined by `+`, a comma, the key: `Ctrl+Shift,I`, `Alt,R`, `Ctrl+Alt,VK_UP`. `none` is unbound.
  How a bare F key is written (`F7` or `VK_F7`) is UNCONFIRMED; gachamod takes both.
- `HotkeysDisabled` = 1 (a number, seen in HKCU) turns them all off.
- Names seen: `TakeScreenshotHotkey` (Ctrl+Shift+I), `ToggleDvrRecordingHotkey` (Ctrl+Shift+E),
  `SaveInstantReplayHotkey` (Ctrl+Shift+S), `SaveInstantGifHotkey`, `SaveInGameReplayHotkey`, `ToggleRsHotkey`
  (Alt+R), `ToggleDvrToolbarHotkey` (Alt+Z), `ToggleUpscaling` (Alt+U) and others ending in `Hotkey`.

## Xbox Game Bar

- The player's own shortcuts are number pairs under `HKCU\Software\Microsoft\Windows\CurrentVersion\GameDVR`
  ([Microsoft's settings list](https://learn.microsoft.com/en-us/windows/apps/develop/settings/settings-windows-11)):
  `VKTakeScreenshot` with `VKMTakeScreenshot`, and the same for `ToggleGameBar`, `ToggleRecording`,
  `SaveHistoricalVideo` and others. 0 means none. The test PC has none set.
- `VK...` is a virtual-key code and `VKM...` its modifiers, going by the
  [API they are saved from](https://learn.microsoft.com/en-us/uwp/api/windows.media.capture.appcapturealternateshortcutkeys).
  The modifier bits (Ctrl 1, Alt 2, Shift 4, Win 8) are from the `VirtualKeyModifiers` enum and were not seen in a
  real value: UNCONFIRMED.
- The shortcuts it ships with (Win+G, Win+Alt+R, Win+Alt+PrtScn) aren't stored and can't clash.

## NVIDIA App and GeForce Experience

- Third-party readers only:
  [nvidia-mem-replay](https://github.com/malinoskj2/nvidia-mem-replay/blob/HEAD/src/sys/hotkey.rs),
  [AlwaysShadow](https://github.com/Verpous/AlwaysShadow/blob/HEAD/src/fixer.c). The key did not exist on the test PC.
  UNCONFIRMED on a real install.
- Each hotkey is `<Name>Count` plus `<Name>0`, `<Name>1`..., binary, four bytes each: the number of keys, then one
  virtual-key code per value, modifiers first. Alt+F12 is count 2, `12 00 00 00`, `7B 00 00 00`.
- Known names: `DVRHKey` (record) and `IRToggleHKey` (Instant Replay). gachamod reads every `*HKeyCount` and calls
  the others "a shortcut".
- The keys it ships with (Alt+Z, Alt+F1, Alt+F9, Alt+Shift+F10,
  [NVIDIA](https://www.nvidia.com/en-us/geforce/news/nvidia-app-download-and-features/)) aren't written until
  changed, so gachamod can't see them. That is why it never suggests an Alt key.

## Bandicam

- Keys it ships with: F12 record, F11 screenshot, F9 FPS counter, F10 FPS limit
  ([hotkeys guide](https://www.bandicam.com/guide/hotkeys/)).
- Settings are under `HKCU\Software\BANDISOFT\BANDICAM\OPTION`
  ([export guide](https://www.bandicam.com/how-to-export-bandicam-setting/)). The names of the hotkey values are
  UNCONFIRMED, so gachamod only checks that the key exists and uses the keys above, "by default".

## Not read

- Outplayed (Overwolf): Ctrl+F5 record, Ctrl+F3 save replay, Ctrl+F2 screenshot
  ([Overwolf](https://support.overwolf.com/support/solutions/articles/9000284659-how-to-use-outplayed)). Where the
  player's own keys are stored is UNCONFIRMED.
- SteelSeries Moments: Alt+S, Alt+M, Alt+P
  ([SteelSeries](https://support.steelseries.com/hc/en-us/articles/360060558991-What-is-the-Moments-Shortcut)).
  Storage UNCONFIRMED.
- Discord: only the overlay key Shift+` is set
  ([Discord](https://support.discord.com/hc/en-us/articles/217659737)). Other keybinds are added by the user and
  kept inside the client. Storage UNCONFIRMED.
- Fraps: F9 records ([FAQ](https://www.fraps.com/faq.php)). F10 screenshot, F11 benchmark and F12 overlay are from
  guides only: UNCONFIRMED.
- Mirillis Action!: F9 records ([tutorial](https://mirillis.com/game-recording-action-tutorial)).
- ShareX uses PrintScreen keys, which gachamod can't hold.

## What gachamod does with it

- A clash is another app's key that equals the skin menu key of a game that has the menu, a key list key that is on,
  or a profile hotkey.
- "Use F9" moves the skin menu key (and the key list key) in every game that used the old key. Profile hotkeys are
  the player's pick, so that clash only links to the hotkey settings.
- "Change Medal's key" gives Medal the same free key and gachamod keeps its own (above). The toasts only carry
  "Use F9".
- A suggested key is never F6, F10 or F12 (the loaders' keys), a key gachamod already uses or a key any found app
  uses. Order: F9, F11, F8, then Ctrl+F9, Ctrl+F8, Ctrl+F7, then the same with Ctrl+Alt. F1 to F5 are left out
  because the games use them.
- "Keep F7" is saved in the setting `otherKeys.kept`. A toast asks about a clash three times at most
  (`otherKeys.asked`), and `otherKeys.ask` = `0` turns the toasts off.

## To check

- Medal with screenshots turned off: does F7 really do nothing in a game.
- Medal after "Change Medal's key", signed in: does the new key work after Medal starts, and does it stay.
- Steam after changing the screenshot key: is the line in `localconfig.vdf`.
- NVIDIA App after changing a key: value names and bytes.
- Game Bar with a shortcut of your own that has a modifier: the `VKM` number.
- AMD Software with a bare F key: how it is written.
