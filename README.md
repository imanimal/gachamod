# gachamod

A mod manager for gacha games that load model mods through 3DMigoto: Genshin Impact, Honkai: Star Rail, Zenless Zone
Zero, Wuthering Waves, Honkai Impact 3rd and Arknights: Endfield through XXMI Launcher, plus games with their own
3DMigoto loader like Punishing: Gray Raven and Identity V. You browse GameBanana inside the app, install with one
click, and switch skins per character. It works alongside XXMI Launcher and starts the game through it.

It's early and Windows only.

## Install

Download `gachamod_<version>_x64-setup.exe` from the [latest release](https://github.com/imanimal/gachamod/releases/latest)
and run it. Windows may say it protected your PC, because the installer isn't code-signed: click More info, then Run
anyway. It installs for your Windows account and doesn't need administrator rights.

gachamod updates itself. A new version downloads in the background and installs when you close the app, or right
away if you click Restart in the toast. Settings, Automatic can turn that off.

To uninstall, open Windows Settings, Apps, Installed apps, and pick gachamod. Your mods stay in their folders. Tick
"Delete the application data" to also remove gachamod's settings, profiles and trash.

Play Genshin, Star Rail, Wuthering Waves or Endfield? Switching skins while you play has only been checked in Zenless
Zone Zero so far. Start your game, open Help, Check this game, and go through the steps. It takes about ten minutes
and sends the answers to the developer (docs/testing.md).

## What it does

- Finds your games and XXMI's importer folders on its own, and picks up the mods already in your Mods folders.
- Turns mods on and off by renaming folders the way 3DMigoto expects (`DISABLED Ellen - Bunny`), so nothing breaks
  if you stop using it. With one skin per character on, wearing a new skin takes off the old one.
- Keeps each mod's toggles (the values you set with its hotkeys) when you turn it off and on again.
- Profiles: save which mods are on and their options as a loadout with a name, colour, icon and banner, and switch
  between them.
- Shows a mod's hotkeys, options, missing files and conflicts with other mods, read from its .ini files.
- Checks GameBanana for newer files of the mods you have.
- Edits XXMI's launch settings (arguments, priority, FPS unlock and the like) and 3DMigoto's debug options, and can
  press F10 in the game for you after a change.
- Moves mods out of Integrated Mod Manager's folders if you used it before.

## .gachamod files

A `.gachamod` file is a zip with some mods, their option values and optionally a profile. Export one from the
library or a profile, send it to another computer, and double-click it there to import. The format is described in
`crates/gacha-core/src/pack.rs`.

## Links

The app registers `gachamod:` links, so a link like
`gachamod:https://gamebanana.com/mmdl/<file id>,Mod,<mod id>` downloads that file straight into the app. You can
also paste a GameBanana mod link anywhere in the window.

## Building

You need Rust, Node 20 or newer, and the Tauri prerequisites for Windows (WebView2 and the MSVC build tools).

```
npm install
npm run app
```

`npm run app` is the one to leave running while you work. It opens the real app against your real games, and it
picks up changes on its own:

- Anything under `src` (screens, styles, themes) shows in the open window within a second, without a restart.
- Anything in Rust (`crates/gacha-core`, `src-tauri`) rebuilds only what changed and restarts the window, usually
  in under a minute.

`npm run app:attach` does the same but uses a dev server that is already running on port 1420. `npm run dev` runs
the interface alone in a browser at http://localhost:1420 with made-up local data and the real GameBanana.
`npm run installer` makes a release build and an installer in `target/release/bundle/nsis`; that one is slow and only
needed to hand the app to someone else.

`npm run release -- 0.1.1` publishes version 0.1.1: it sets the version, builds the installer, signs the update with
`%USERPROFILE%\.tauri\gachamod.key`, pushes and makes the GitHub release that installed copies update from. Keep a
backup of that key. Without it, installed copies can't take another update.

## Licence

MIT. See LICENSE.
