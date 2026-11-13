# gachamod

A mod manager for gacha games that load model mods through 3DMigoto: Genshin Impact, Honkai: Star Rail, Zenless Zone
Zero, Wuthering Waves, Honkai Impact 3rd and Arknights: Endfield through XXMI Launcher, plus games with their own
3DMigoto loader like Punishing: Gray Raven and Identity V. You browse GameBanana inside the app, install with one
click, and switch skins per character. It works alongside XXMI Launcher and starts the game through it.

It's early and Windows only. There is no installer yet; build it from source (below).

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
npm run tauri dev
```

`npm run dev` runs the interface in a browser at http://localhost:1420 with made-up local data and the real
GameBanana. `npm run tauri build` makes an installer.

## Licence

MIT. See LICENSE.
