# GameBanana pages

Drafts of gachamod's GameBanana pages. Open `posts.html` in a browser (or `npm run dev`, then
http://localhost:1420/docs/gamebanana/posts.html), pick a game, read it, and use the copy buttons.

## How the pages fit together

- A GameBanana tool belongs to one game, so each game gets its own page in its Tools section: Genshin, Star Rail,
  ZZZ, WuWa, Endfield and HI3. The community games (PGR, P5X, GF2, Identity V, Stella Sora, Action Taimanin) share
  one template; only post those once Play and the loader setup work there.
- Every page has the installer. People download from the game they play, and "get it from the Genshin page" loses
  them. JASM, FlairX and Mod Manager Pro do the same.
- Most of the text is shared. Each page changes the opening, the theme, the example names and the fixes part. Edit
  the text once in `posts.html` and every page follows.
- Each page ends with links to the others. Post all of them, put their addresses in `LINKS` at the top of
  `posts.html`, then paste every body again so each page links to the rest.
- GameBanana's rule R.11 bans submitting the same thing to several games. Managers do it anyway and their pages stay
  up. If a moderator objects, keep the Genshin page whole and cut the others down to the opening plus a link to it
  (what IMM does).

## Filling in each page

- Title: gachamod. Summary: the line `posts.html` shows (about 110 characters).
- File: the installer. GameBanana marks exes "contains exe", which is normal for tools. Add the GitHub releases page
  as an alternate source once it's public.
- Screenshots: the gallery below. At least one is required.
- Body pictures: host them (the editor's image upload, imgur or postimg), add each address to `IMAGES`, then copy.
  The copied body says `[picture: ...]` wherever an address is missing. The editor keeps headings, lists, links,
  `<details>` and `<kbd>`, but drops tables and inline styles.
- Credits: in GameBanana's credits module, not the text (rule R.23). List below.
- Embedded media: a YouTube video if you make one.
- Tags: Windows, development state, Rust and TypeScript.
- Content rating: none needed while every picture keeps adult mods blurred, which is the app's default.
- Releases: post a GameBanana Update on every page with the changelog. GameBanana only accepts one when the page's
  file is the new version. Ticking "significant" bumps the page in the game's lists.

## Pictures

Gallery for each game, in this order. The first one is the thumbnail in GameBanana's lists, so make it the best.

1. Home in the game's theme, with updates showing and a few mods on
2. Browse filtered to one character
3. A mod opened from Browse, showing its files and Install
4. Mods (the library)
5. A mod's page at Toggles, ideally mid-rebind
6. The 3D view of a mod with a few toggles
7. Profiles with hotkeys set
8. Characters
9. Fixes with a few mods broken by an update
10. The plain theme, for people who don't want the game look

The body uses `home`, `browse`, `profiles`, `mod-keys`, `mod-3d` and `tools`, named `<game>-<picture>` (`ww-browse`).

Moving pictures sell it better than another still. Worth making: a GIF from Install in Browse to the mod showing up in
Mods (under 10 seconds), a clip of a profile hotkey changing skins in the game, and a key being rebound.

`shots/` holds drafts from the browser demo: fake libraries, a stand-in 3D model, no Star Rail or HI3. They're
ignored by git. Retake them from the finished app with a real library. For the demo,
`node docs/gamebanana/shoot.mjs docs/gamebanana/shots` takes them all at 1600×900 while `npm run dev` runs.

## Check before posting

- Fixes: the pages say most broken mods get fixed in one click. Try it after a real update in each game, and check
  what each game's data covers (`docs/fixers.md`). Endfield has no data and HI3 has no fixer, so their pages say so.
- Profile hotkeys switching and reloading mods in each game.
- The app's update check reads the GitHub releases of `imanimal/gachamod`, which is private. Make the releases public
  before launch or the check never finds anything.
- Switching skins without F10, GameBanana sign-in and extensions: check each one in the app, then add a line for it
  to the "Everything else" list.
- After the first release, ask GameBanana staff for 1-click install (their wiki page 1999). Once approved, an
  "install with gachamod" link shows on mod pages of the supported games.

## Credits

For the credits module on every page:

- Fix data: petrascyll, leotorrez, CaveRabbit, SilentNightSound, HummyCatte, shaojiang, ConfoundedHermit,
  Vonksdesu, ZumwaltDDG1000, EnteleJiang, hefengchang (GreenLzz), Satan1c, the-sea-man, Moonholder, Gustav0_,
  Nooble_, zlevir, sora_, golanah921, LeoMods_, ZaRe4p3r, Sanddino, solomoncyj, agungmubarak1453, Aksell94,
  KatTheDev, WuDunYaKuSya, Wo_ju, ZesilinaVT and the AGMG community
- XXMI Launcher and the model importers: SpectrumQT, SilentNightSound, leotorrez and their contributors
