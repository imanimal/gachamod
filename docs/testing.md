# Checking a game

The menu over the game while playing (docs/ingame.md, section 11) has only been tried in Zenless Zone Zero. Genshin
Impact, Honkai: Star Rail, Wuthering Waves and Arknights: Endfield use the same kind of loader, but each could differ in
whether it runs as administrator, whether it runs in exclusive fullscreen, and how it handles reloads. Players who have
those games check them with Help, Check this game, and the results come to the developer in PostHog.

## For players

1. Pick the game in the sidebar and start it with mods.
2. Open Help (the ? in the title bar), then Check this game.
3. If the menu while playing is off, turn it on (the check has a button to its settings).
4. Go through the three steps. Each has Yes, No and Skip, and most take a minute:

| Step | What you do | What gachamod checks by itself |
| --- | --- | --- |
| Open the menu | Press the menu key (F7) in the game | Whether gachamod heard the key, and whether the game was in exclusive fullscreen |
| Pick from the menu | Pick a skin in that menu | Whether the pick reached gachamod (the game then reloads) |
| Controller | Press both sticks in | Whether gachamod saw it |

5. Write anything that looked wrong, then press Send. It goes without an account. The window lists what's in it.

Rather not send from the app? Open an issue with the Game check form on GitHub and fill in the same answers.

## For the developer

### PostHog, once

1. Make an account at posthog.com. It asks for US or EU hosting when you sign up; either works.
2. In the project's settings, copy the project API key (it starts with `phc_`). It can only send events, so it's
   fine inside the installer.
3. Put it in a file named `.env` at the repo root (git ignores it):

   ```
   GACHAMOD_POSTHOG_KEY=phc_your_key
   GACHAMOD_POSTHOG_HOST=https://eu.i.posthog.com
   ```

   Leave out the second line for US hosting. `npm run installer` reads the file and says where it sends.
4. Build with `npm run installer` and hand out that installer. Builds from `npm run app` don't send usage counts or
   crashes (feedback and checks still go, if the key was set when they were built).

### Reading results

In PostHog, open SQL (or a new insight of the SQL kind) and run:

```sql
SELECT timestamp, properties.game, properties.importer, properties.loader_version, properties.window_mode,
       properties.game_admin, properties.elevated, properties.check_version,
       properties.menu_opened, properties.menu_heard, properties.menu_pick_changed, properties.menu_pick_seen,
       properties.pad_opened, properties.notes, properties.contact
FROM events
WHERE event = 'game check'
ORDER BY timestamp DESC
LIMIT 200
```

Save it to a dashboard. `menu_heard = none` with `game_admin = true` and `elevated = false` is Windows keeping the
key away; `menu_heard = fullscreen` is a game in exclusive fullscreen. `menu_pick_seen = true` with
`menu_pick_changed = no` means the pick went through but the game didn't reload (or the mod didn't draw). Checks with
`check_version` 1 tested live switching, which is gone. `loader_log` holds the end of d3d11_log.txt when the player attached logs (open the event in Activity
to read it).

docs/telemetry.md lists every value. Feedback lands as `feedback` events, crashes under Error tracking.

### Finding players

Something to post on the GameBanana pages, the README or a Discord:

> Play Genshin, Star Rail, Wuthering Waves or Endfield? gachamod's menu while you play has only been checked in
> Zenless Zone Zero. If you have five minutes, start your game, open Help, Check this game in gachamod and go through
> the steps. It sends the answers straight to me, no account needed.

### When a game passes

Move what was learned into docs/ingame.md (the game's loader, whether it runs as administrator, anything that needed a
fix) and take it off the list there.

### Still to check: fixers, uninstalling and reset

These have only run against the demo and unit tests (a stand-in .bat fixer).

- Fix on a mod that needs a fixer, for each game with one (GI Fix All Character Mods, HSR 3.3 fix, ZZZ fixers, EFMI
  1.1 fix): the fixer downloads, runs without a window it waits on, changes the mod, and the mod stops showing as
  broken. Note any fixer that wants arguments, a different working folder, or keys pressed, and teach `launch` that.
- Undo after a fixer run puts every changed file back, and files the fixer created are removed.
- A fixer with its own window (ZZZ Mod Fixer): it opens once for every mod that needs it, gachamod carries on about
  6 seconds after the fixer stops changing files without the window being closed, "Stop waiting" works, and each
  mod gets its own result and backup.
- A mod the fixer leaves broken shows what the fixer did and "Try again" in its details and in Tools > Fixes, and
  still does after a restart.
- The menu over the game: picking a skin closes it, the game comes forward and reloads, and the pick shows.
  Clicking into the game closes it. Browse installs a mod while the game runs.
- Settings, Games, Uninstall mod loader for one game, then Install again: the Mods folder and d3dx_user.ini are where
  they were and XXMI Launcher shows the loader as not installed in between.
- Uninstall XXMI Launcher: the launcher, loaders and shortcuts are in the Recycle Bin, the Mods folders are still in
  the XXMI folder, and the setup page offers to install again.
- Reset gachamod: the app restarts on the first-start page, the old database is in `backups/before-reset-<time>/`,
  and logs and older backups are still there.

### Still to check: installing XXMI from the app

The setup page's "Install mod loaders" (gacha-core `xxmi_setup.rs`) has only run against the demo and unit tests. On a
PC without XXMI, check:

- A full run for each game on the PC: XXMI Launcher opens afterwards, shows the importers as installed, and starts
  the game with mods.
- XXMI Launcher asks for administrator rights when it starts. Whether that prompt shows when gachamod starts it.
- Whether the loaders need the Visual C++ runtime on a fresh Windows, and what the game does without it.
- GitHub's limit for downloads without an account (60 API calls an hour per address) and the message it gives.
- Antivirus holding or removing `d3d11.dll` or `3dmloader.dll` right after the copy.
