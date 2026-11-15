# Usage counts, crash reports, feedback and logs

gachamod sends four kinds of data to the developer's PostHog project. Each one is listed here, along with what it
holds and how to turn it off.

| What | When | Off switch |
| --- | --- | --- |
| Usage counts | Every 5 minutes and when the app quits | Settings, Feedback and data, Usage counts |
| Crash reports | Same, for crash files not sent yet | Settings, Feedback and data, Crash reports |
| Feedback | When the player presses Send | Only sent by hand |
| Game checks | When the player sends the results of Check this game | Only sent by hand |

A build sends nothing unless `GACHAMOD_POSTHOG_KEY` was set when it was built (`npm run installer` warns when it
isn't). `GACHAMOD_POSTHOG_HOST` points at the EU server (`https://eu.i.posthog.com`) when the project lives there.
Debug builds (`npm run app`) send usage counts and crashes only with `GACHAMOD_TELEMETRY_DEV=1`, so the developer's
own clicks don't count. Feedback goes from any build that has the key.

## What every event carries

- `distinct_id`: a random id made for this install (`telemetry.id` in the app's settings). Feedback sent while usage
  counts are off gets a new random id instead, so it can't be tied to the counts.
- `$process_person_profile: false`, so PostHog keeps counts only and no profile of the player.
- `app_version`, `$os` (always Windows), `elevated` (gachamod runs as administrator), `dev` (a debug build).

## Usage events

`telemetry.rs` drops any event whose name isn't in this list. It also drops any value that isn't a number, a
true/false or a plain word of up to 60 letters, digits, spaces, dots, dashes and underscores. A path, a mod name with
other characters or a nested value can't get through. Events from the window also carry `game`, the short id of the
game picked in the sidebar (`zzz`, `gi`) or `none`.

| Event | Values | From |
| --- | --- | --- |
| `app started` | `games` (how many are shown), `always_admin` | Backend, once per start |
| `screen` | `view`, `tab`, `section` (from the route) | Every page change, and `overlay` when the menu over the game opens |
| `used` | `command`, `count` | Backend commands the window called since the last send, counted. Reads like `settings_get` aren't counted |
| `setting` | `key`, and `value` when it's `0`, `1`, `true` or `false` | A setting changed |
| `click` | `target` | A click on anything marked `data-t` (the feedback buttons, Restart as administrator, Tell the developer) |
| `input` | `kind`: `mouse`, `keyboard` or `controller` | The first use of each in a run |
| `f10 note` | `game`, `blocked` | The player was told to press F10 (`blocked`: the game runs as administrator) |

## Crash reports

Crash files are written to the logs folder. Each is sent as one `$exception` event, PostHog's error tracking format,
grouped by `$exception_fingerprint`.

- `panic`: a Rust panic. Holds the message, the thread, the source line and a backtrace.
- `ui`: an error in the window's code. Holds the message and the stack (with React's component stack for a screen
  that hit an error). Each message is sent once per run, five at most.
- `exit`: the last run ended without quitting and left no other crash file. Holds the end of the log. A killed
  process, a crash a panic hook can't see, and a Windows shutdown with gachamod open all look like this. Debug builds
  skip it, since `tauri dev` stops the app on every rebuild.

Messages, source lines and stacks go through `logs::scrub`, which replaces the user's home folder with `%USERPROFILE%`
and their Windows account name with `<user>`. `npm run installer` builds with `--remap-path-prefix`, so paths from
the build machine show as `~`. Sent files stay in the logs folder as `crash-*.sent.json`, and only the newest 20 are
kept.

## Feedback

The `feedback` event holds `kind` (`problem`, `idea` or `other`), `message`, and `contact` when one was given. It also
holds `screen` and `game` (where the player was), plus `log` when they left "Attach the end of gachamod's log" ticked
(the last 30 KB, scrubbed). To read feedback in PostHog, filter events by `feedback`. A PostHog destination can send
each new one to Discord or email.

## Game checks

Help, Check this game sends one `game check` event when the player presses Send (docs/testing.md has the steps). Like
feedback, it goes only by hand and with usage counts off.

| Value | What it is |
| --- | --- |
| `game`, `importer`, `via_xxmi`, `loader_version`, `xxmi_version`, `window_mode` | The game and how its mods load |
| `game_running`, `game_admin` | Whether the game ran, and as administrator |
| `foreground_check`, `reload_key` | d3dx.ini's `check_foreground_window` and `reload_config` |
| `menu_style`, `menu_key`, `menu_pad` | How the menu while playing was set up (`window` or `off`) |
| `menu_opened`, `menu_pick_changed`, `pad_opened` | The player's answers: `yes`, `no`, `skip`; for the controller also `no controller` |
| `menu_heard` | What gachamod saw when the key was pressed: `window` (it opened the menu), `fullscreen` (exclusive fullscreen, so it couldn't), `picked` or `none` |
| `pad_heard` | gachamod saw both sticks pressed and opened the menu |
| `menu_pick_seen` | A pick from the menu reached gachamod |
| `check_version` | 2. Goes up when the steps change (1 tested live switching, since removed) |
| `notes`, `contact` | What the player wrote |
| `log`, `loader_log` | When attached: the end of gachamod.log and of the loader's d3d11_log.txt, scrubbed like crashes |

To see results per game in PostHog, make an insight on `game check` broken down by `game`, or a SQL insight that
lists the answers (docs/testing.md has one).

## Logs

`<data folder>/logs/gachamod.log` (Settings, Feedback and data, Open logs folder) gets:

- the starts and quits;
- crashes;
- failed backend calls from the window (`<command> failed: <message>`);
- the window's `console.warn` and `console.error` lines;
- sends that didn't go out;
- turning "always as administrator" on or off.

Past about 1 MB it becomes `gachamod.old.log`.

## Still to check

1. A real send to PostHog. No build here had a key yet: the batch format follows PostHog's `/batch/` API, and the
   tests only check what goes into it.
2. The installer's question (`src-tauri/windows/hooks.nsh`): shown once on a fresh install, Yes writes Windows' "Run
   this program as an administrator" for gachamod.exe, and Run gachamod on the last page starts it as administrator.
   Updates and `/S` or `/P` installs don't ask. An upgrade with the full installer, which uninstalls the old version
   first, keeps the answer (`HKCU\Software\gachamod`, `admin`). Uninstalling removes the exe's flag, and the answer too
   when "Delete the application data" is ticked.
3. Settings, Run as administrator, Always: writes and removes the same setting. Not switched on this machine, since
   that changes how Windows starts the program.
4. While gachamod runs as administrator, a gachamod:// link or a double-clicked .gachamod file reaches it
   (`devtools::hand_to_elevated_copy`) instead of starting a second copy.
