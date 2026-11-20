# Checking a game

Switching skins while playing (docs/ingame.md) has been tried in Zenless Zone Zero and Genshin Impact. Honkai: Star
Rail and Honkai Impact 3rd have the drawn menu without a check, since they draw the way those two do. They, Wuthering
Waves and Arknights: Endfield use the same kind of loader, but each could differ in whether it
runs as administrator, whether its loader reads keys when the game isn't in front, and how it handles reloads. Players
who have those games check them with Help, Check this game, and the results come to the developer in PostHog.

## For players

1. Pick the game in the sidebar and start it with mods.
2. Open Help (the ? in the title bar), then Check this game.
3. If no character switches in game yet, press Switch every character in game. Undo takes it back afterwards.
4. Go through the five steps. Each has Yes, No and Skip, and most take a minute:

| Step | What you do | What gachamod checks by itself |
| --- | --- | --- |
| Pick a skin from gachamod | Pick a skin in the check window | Whether the game saved the pick (it does 5 to 15 seconds later) |
| Open the menu | Press the menu key (F7) in the game | Whether gachamod heard the key and which menu it opened |
| Pick from the menu | Pick a skin in that menu | Whether gachamod read the pick back from the game |
| Reload | Press F10 in the game | Nothing, it asks whether the skins stayed |
| Controller | Press both sticks in | Whether gachamod saw it |

5. Write anything that looked wrong, then press Send. It goes without an account. The window lists what's in it.

Rather not send from the app? Open an issue with the Game check form on GitHub and fill in the same answers.

## For the developer

### PostHog, once

1. Make an account at posthog.com. It asks for US or EU hosting when you sign up; either works.
2. In the project's settings, copy the project API key (it starts with `phc_`). It can only send events, so it's
   fine inside the installer.
3. Run `npm run posthog-key` and paste the key. Typing is hidden. It asks both PostHog servers which one knows the
   key and saves the key and server to `%USERPROFILE%\.tauri\gachamod.env`, next to the update signing key, so a
   release made from a worktree finds it too. `npm run installer` reads the file and says where it sends. A `.env`
   at the repo root with the same two lines (`GACHAMOD_POSTHOG_KEY`, `GACHAMOD_POSTHOG_HOST`) works as well and wins
   over the saved one.
4. Build with `npm run installer` and hand out that installer. Builds from `npm run app` don't send usage counts or
   crashes (feedback and checks still go, if the key was set when they were built).

### Reading results

In PostHog, open SQL (or a new insight of the SQL kind) and run:

```sql
SELECT timestamp, properties.game, properties.importer, properties.loader_version, properties.window_mode,
       properties.game_admin, properties.elevated,
       properties.pick_changed, properties.pick_saved, properties.menu_opened, properties.menu_heard,
       properties.menu_pick_changed, properties.menu_pick_read, properties.reload_kept, properties.pad_opened,
       properties.notes, properties.contact
FROM events
WHERE event = 'game check'
ORDER BY timestamp DESC
LIMIT 200
```

Save it to a dashboard. A row with `pick_saved = yes` and `pick_changed = no` means the loader took the key but the
mod didn't draw the new skin; `pick_saved = no` with `game_admin = true` and `elevated = false` is Windows keeping
the keys away. `loader_log` holds the end of d3d11_log.txt when the player attached logs (open the event in Activity
to read it).

docs/telemetry.md lists every value. Feedback lands as `feedback` events, crashes under Error tracking.

### Finding players

Something to post on the GameBanana pages, the README or a Discord:

> Play Star Rail, Wuthering Waves or Endfield? gachamod's skin switching while you play has only been checked in
> Zenless Zone Zero and Genshin Impact. If you have ten minutes, start your game, open Help, Check this game in gachamod and
> go through the steps. It sends the answers straight to me, no account needed.

### When a game passes

Move what was learned into docs/ingame.md (the game's loader, whether it runs as administrator, anything that needed a
fix) and take it off the list there.

### Still to check: fixers, uninstalling and reset

These have only run against the demo and unit tests (a stand-in .bat fixer).

- Fix on a mod that needs a fixer, for each game with one (GI Fix All Character Mods, HSR 3.3 fix, ZZZ fixers, EFMI
  1.1 fix): the fixer downloads, runs without a window it waits on, changes the mod, and the mod stops showing as
  broken. Note any fixer that wants arguments, a different working folder, or keys pressed, and teach `launch` that.
- Undo after a fixer run puts every changed file back, and files the fixer created are removed.
- Add ORFix call on a real Genshin character mod that lacks the call (the Yelan Qipao mod: Head, Body, Dress and Extra
  bind only `ps-t0` and `ps-t1`): Tools > Problems shows the warning with the button already visible, one click
  adds `run = CommandList\global\ORFix\NNFix` after the light map binding of each part, and in game the green fur and
  yellow hair colors are gone. Undo puts the file back exactly as it was, and a mod that already has the call (any
  ORFix, NNFix or GIMI API call) is not flagged. Also a three-slot mod (the Varesa one) gets `ORFix`, not `NNFix`.
- A fixer with its own window (ZZZ Mod Fixer): it opens once for every mod that needs it, gachamod carries on about
  6 seconds after the fixer stops changing files without the window being closed, "Stop waiting" works, and each
  mod gets its own result and backup.
- A mod the fixer leaves broken shows what the fixer did and "Try again" in its details and in Tools > Fixes, and
  still does after a restart.
- The menu over the game: picking a skin keeps the menu open and the keyboard comes back to it once the keys have
  gone to the game. Clicking into the game still closes it. Browse installs a mod while the game runs.
- Settings, Games and mod loaders, Uninstall mod loader for one game, then Install again: the Mods folder and d3dx_user.ini are where
  they were and XXMI Launcher shows the loader as not installed in between.
- Uninstall XXMI Launcher: the launcher, loaders and shortcuts are in the Recycle Bin, the Mods folders are still in
  the XXMI folder, and the setup page offers to install again.
- Reset gachamod: the app restarts on the first-start page, the old database is in `backups/before-reset-<time>/`,
  and logs and older backups are still there.

### Still to check: the black window on more than one monitor

Players on 0.1.1-beta.3 with more than one monitor saw the main window go black after switching to another window
(and on one PC whenever it had focus); it only drew while the mouse moved over it. It doesn't happen on a single
monitor. Every window now starts with WebView2's occlusion check off, and its page draws a frame by itself every
second and after each focus change (docs/spec.md). Check, on such a PC:

- Switch to another window on the same monitor and on the other one, open a window over gachamod, and alt-tab back:
  the window keeps drawing each time.
- If it still goes black, turn Hardware acceleration off (Settings, Appearance) and try again.
- Restart from that setting's toast opens the window every time (the closing copy's WebView2 may still be running
  with the other flags; `main_window` tries again for a few seconds).
- `gachamod.exe --disable-gpu`, with gachamod closed and while it runs.
- The menu over a game still opens, with hardware acceleration on and off.
- After a blackout, `logs/rendering` holds an incident file. Check whether the screen read was black while WebView2's
  own picture (`incident-*.png`) wasn't: that points at Windows or the driver showing the window, not at the page.
  The rendering log's probe (WebView2's picture, the page's answer) has only run in unit tests and a normal start.
- The page's own redraws (`lib/redraw.ts`) and `recover` in `render.rs` (WebView2's view resized, then hidden and
  shown) have not run on a PC that blacks out. The incident file's last lines say which step brought the picture
  back, and the same summary arrives as a `render` crash report.
- Starting gachamod with `--browser-log` writes `%LOCALAPPDATA%\app.gachamod.desktop\EBWebView\chrome_debug.log` and
  opens a console window while it runs. A normal start opens no console window.

### Still to check: installing XXMI from the app

The setup page's "Install mod loaders" (gacha-core `xxmi_setup.rs`) has only run against the demo and unit tests. On a
PC without XXMI, check:

- A full run for each game on the PC: XXMI Launcher opens afterwards, shows the importers as installed, and starts
  the game with mods.
- XXMI Launcher asks for administrator rights when it starts. Whether that prompt shows when gachamod starts it.
- Whether the loaders need the Visual C++ runtime on a fresh Windows, and what the game does without it.
- GitHub's limit for downloads without an account (60 API calls an hour per address) and the message it gives.
- Antivirus holding or removing `d3d11.dll` or `3dmloader.dll` right after the copy.

### Still to check: desktop shortcuts and setup's choices

Built with `cargo check`, `tsc` and the demo only. With an installer from `npm run installer`:

- A fresh install with all three boxes on: both shortcuts on the desktop, quickstart's with the purple play icon,
  `quickstart.ico` next to gachamod.exe, and Windows asks for administrator when either one opens gachamod.
- Quickstart with gachamod closed, and again with it open: the game gachamod last had open starts with mods.
- Quickstart with gachamod closed: no window shows, a tray icon does, F7 opens the menu over the game, and about 5 s
  after the game is up Task Manager shows no msedgewebview2.exe under gachamod. After the game closes gachamod stays
  in the tray (or is gone 15 s later with Keep running in the background off). With Open gachamod with quickstart on,
  the window opens as before. With a game's folders unset, the window shows with the toast.
- A window that comes back from the tray (click, Open gachamod, the desktop shortcut, a GameBanana link, the menu
  over the game's Settings) has its normal size (maximized on a small screen), draws, not black, and the link or page
  it was opened for shows.
- The first close of a fresh install asks once; Esc keeps the window and asks again next close; Keep running and Quit
  are remembered. The tray menu's words are in the app's language. Play time on the year card counts a session
  played with the window closed.
- In the background with an update downloaded: it installs with no window and gachamod comes back in the tray on the
  new version.
- Boxes off, then Repair: the desktop stays as chosen. Settings, General's Remove, then Repair: the shortcut stays off.
- Quickstart's icon on the desktop turns into the open game's icon with the quickstart badge bottom right, and
  changes when you switch games (after a Repair too). A game's own quickstart from Settings has that game's icon,
  reads well at small desktop icon sizes, and starts that game whichever game was open.
- Uninstall takes both shortcuts, the games' own quickstarts and `quickstart.ico` away, and the folder goes.

### Still to check: the AI helper answering in the app

Claude Code was run with the helper's flags and streamed an answer. The rest were built from their docs.

- Codex signed in with a ChatGPT plan: Tidy mod names streams an answer and the window reads it.
- Antigravity (`agy`) signed in with a Google account: it's found in `%LOCALAPPDATA%\agy\bin`, Gemini asks it, the
  answer streams, and the process ends after the result. Signed out, Sign in opens the browser sign-in. Check that the
  stream-json input is read and that no update prompt or folder trust question blocks the run.
- A free Gemini key: a wrong key is refused with Google's reason, a good one saves and Gemini answers here. Restart
  gachamod: the key is still saved. Remove key, then the website opens again. Run past the daily limit once: the
  message gives the reset time.
- Stop during a run ends it (Task Manager shows no leftover `claude`, `codex`, `agy` or `node`).
- Reference files. Claude Code reading a run folder was checked with a small job: it read both files, the window
  named each one, and only the last message came back. Still to check in the app:
  - Make a theme with Claude Code. It reads a few stylesheets, the wait line names them, and the theme restyles more
    parts than one made by pasting.
  - Gemini CLI in plan mode reads its folder without asking to trust it.
  - Set characters for a whole library of a few hundred mods: the files are read in a few seconds and the prompt
    stays under the CLI's limit.
  - `<data>/ai` has no `run-` folders left after a run, a Stop or a timeout.
- Model and thinking. Claude Code 2.1.316 took `--effort` and streamed thinking summaries with
  `--thinking-display summarized`; its usage and context window were read from a live run. Still to check:
  - Opus and Haiku with each thinking level. Haiku may refuse some levels; the failure should name the option.
  - Codex with a typed model and each thinking level (`-m`, `-c model_reasoning_effort`), and whether its JSON has
    reasoning items and `reasoning_output_tokens`.
  - Gemini CLI with `-m pro`, `-m flash` and `-m flash-lite`, and whether its `init` and `result` lines carry the model
    and token counts.
  - The Gemini key with Flash-Lite and Pro, and each thinking level: `thinkingLevel` works on the current Flash, and a
    model that refuses it falls back to a budget without an error showing.
  - An older Claude Code that doesn't know `--thinking-display`: the run is asked again and answers.
  - Read 5 or more files in one run: the details list some under "at once".

### Still to check: starting games and the reload key

- Arknights: Endfield outside Steam, Play without mods (or Play with XXMI turned off): gachamod opens the GRYPHLINK
  launcher instead of `Endfield.exe`, and pressing Start there plays the game. Check the launcher is found from the
  game folder, the registry and `C:\Program Files\GRYPHLINK`.
- Zenless Zone Zero from Steam: Play, with XXMI Launcher closed, switches XXMI's Game Launch to Steam, the toast says
  so, and the game starts with mods (XXMI may restart Steam once to set the launch options). Play without mods starts
  it through Steam with no "launch from Steam" message. Detection finds the Steam folder, including when the game sits
  a folder below `steamapps\common\<app folder>`.
- A community game, Play without mods while its 3DMigoto loader is still open from the last run: the toast says the
  loader is running and to close it.
- A game whose d3dx.ini binds `reload_config` to something other than F10 (try `ctrl VK_F5`): Reload in Tools,
  the automatic reload after a change and every message name and press that key.
- A Mods folder with another name inside the loader folder (`Mods_Custom`, included from d3dx.ini): a mod's saved
  options show in its details and survive turning it off and on.
- ZZZ with live characters: after gachamod starts, d3dx.ini has `settings_auto_save_interval = 1` and a
  `d3dx.ini.gachamod.bak`. Pick a skin in the game's own menu (F7): My Mods and Tools show it within about two seconds.
  Turn off "Show skins picked in the game right away" and the value goes back to 60.
- Shift+click a live skin that isn't showing (My Mods and the F7 overlay): it turns on next to the skin showing, leaves
  in-game switching, and both show after a reload. Turn on a hair recolour next to an outfit of the same character: the
  outfit stays on. Another outfit turns the first one off.
- Change several mods quickly with the game in front: gachamod presses the reload key once, then waits at least 10
  seconds before the next press, and never more than three times a minute.
- Install a ShaderFixes-only download (ZZZ's Censor Remover): its files land in the loader's ShaderFixes folder, a
  backup is made, and after a restart the effect shows. Restoring the backup removes them again.
- Install a download with a `BufferValues` folder (LeoTools' FixDash.ini): it lands in `Mods/BufferValues` and fixes
  the mods it's meant for. Only LeoTools documents that folder, so check it loads from there.
