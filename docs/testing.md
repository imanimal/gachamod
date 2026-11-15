# Checking a game

Switching skins while playing (docs/ingame.md) has only been tried in Zenless Zone Zero. Genshin Impact, Honkai:
Star Rail, Wuthering Waves and Arknights: Endfield use the same kind of loader, but each could differ in whether it
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

> Play Genshin, Star Rail, Wuthering Waves or Endfield? gachamod's skin switching while you play has only been
> checked in Zenless Zone Zero. If you have ten minutes, start your game, open Help, Check this game in gachamod and
> go through the steps. It sends the answers straight to me, no account needed.

### When a game passes

Move what was learned into docs/ingame.md (the game's loader, whether it runs as administrator, anything that needed a
fix) and take it off the list there.
