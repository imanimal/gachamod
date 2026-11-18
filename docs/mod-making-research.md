# Mod making research (checked 2026-11-17)

What people who make 3DMigoto/XXMI mods need, and what gachamod could do for them. Read from GameBanana's public
API (tutorials, tools, questions and their comments), GitHub READMEs and issues, and the community guide site at
[leotorrez.github.io/modding](https://leotorrez.github.io/modding/). Reddit's search refused automated reads and
Discord servers (AGMG and others) can't be read, so nothing below comes from either. Most help happens in AGMG, so
treat this as the public half of the picture.

## Who makes mods

Counted from every mod on GameBanana per game (`Mod/Index`, all pages, submitter id). A submitter isn't always the
author (ports and reuploads exist), so read these as upper bounds.

| Game | Mods | Submitters ever | Submitted in 2026 | One mod only | 20+ mods |
|---|---|---|---|---|---|
| Genshin Impact | 13,337 | 1,830 | 426 | 717 | 142 |
| Zenless Zone Zero | 5,963 | 1,159 | 511 | 488 | 61 |
| Wuthering Waves | 3,124 | 557 | 181 | 242 | 35 |
| Honkai: Star Rail | 2,905 | 559 | 155 | 251 | 31 |
| Arknights: Endfield | 801 | 224 | 224 | 113 | 4 |
| Honkai Impact 3rd | 143 | 41 | 8 | 20 | 0 |

- About 3,500 different submitters across the six games, and 1,234 posted something in 2026.
- A small core does most of the work: the top 10% of submitters posted 49 to 60% of the mods in GI, ZZZ, WW and HSR.
  About 40% of submitters posted one mod and stopped.
- Three groups show up in the comments and questions:
  - **Fix runners.** Players who never make a mod but edit inis after every patch. The tutorial
    [On Mod Hygiene](https://gamebanana.com/tuts/20467) is written by one who says they have fixed hundreds of mods.
  - **Model and texture makers.** Blender users who dump, edit and export. Most of the 3,500.
  - **Tool developers.** A few dozen people (SilentNightSound, SpectrumQT, leotorrez, petrascyll, Gustav0, caverabbit
    and others) who write the importers, the Blender add-ons and the patch fixers.
- Many makers are Chinese speaking. Several of the most used fix tools and tutorials are in Chinese
  ([tuts/20351](https://gamebanana.com/tuts/20351), [tuts/19708](https://gamebanana.com/tuts/19708)).

## The workflow

What a character mod takes today, in order. Texture-only and UI mods skip steps 4 and 5.

1. **Set up.** XXMI Launcher with hunting turned on for the game, Blender (WWMI Tools wants 4.5 or newer, XXMI Tools
   works from 3.6), the game's Blender add-on ([XXMI Tools](https://github.com/leotorrez/XXMITools) for GI, HSR, ZZZ
   and HI3, [WWMI Tools](https://github.com/SpectrumQT/WWMI-TOOLS) for WW,
   [EFMI Tools](https://github.com/SpectrumQT/EFMI-Tools) for EF), a DDS editor (Paint.NET, or Photoshop with Intel's
   plugin) and often [gui_collect](https://github.com/Petrascyll/gui_collect), which needs Python 3.9+.
2. **Get the vanilla model.** Either download it from an asset repo (one per game, listed on the
   [downloads page](https://leotorrez.github.io/modding/downloads)) or dump it yourself. The asset repos lag: the HSR
   one was called six months stale in [a question](https://gamebanana.com/questions/103871).
3. **Hunt and dump.** From the [hunting guide](https://leotorrez.github.io/modding/guides/hunting): disable every
   mod (F6 isn't enough, rename the Mods folder), turn hunting on before launching, press numpad 0, step through IBs
   and VBs with the numpad, "mark" one to copy its hash, then F8. The game freezes for one to three minutes and writes
   a FrameAnalysis folder of 3 to 24 GB ([tuts/18140](https://gamebanana.com/tuts/18140)). A targeted dump through
   gui_collect cut one example from 3.4 GB to 840 MB.
4. **Extract and import.** gui_collect (or WWMI Tools' own extractor) pulls the object out by IB hash and writes
   `hash.json`. Then File > Import > 3DMigoto frame analysis dump in Blender. gui_collect doesn't support Endfield
   ([question](https://gamebanana.com/questions/107979)).
5. **Edit in Blender.** Model, weight paint, keep vertex groups in the same number and order as the original, keep
   UV names like `TEXCOORD.xy`, keep shape key names (`Deform <n>`, `CUSTOM <n>`). The add-ons don't help with this
   part ([XXMI Tools guide](https://leotorrez.github.io/modding/guides/xxmi_tools)).
6. **Textures.** Edit the DDS files, save in the same format as the original (BC7 sRGB vs BC7 linear matters),
   power-of-two sizes. ZZZ and WW mods now bind textures by slot (SlotFix, RabbitFX "stable textures") instead of by
   hash so they survive updates ([SlotFix guide](https://gamebanana.com/tuts/18114),
   [stable textures](https://gamebanana.com/tuts/20005)).
7. **Export.** The add-on writes buffers and a generated ini into a folder. Export straight into the game's Mods
   folder is common.
8. **Write the ini by hand.** Toggles, key bindings, merged variants, menus, namespaces, LOD fixes. Generators help
   ([INI Tools](https://gamebanana.com/tools/18627), [Menu Creator](https://gamebanana.com/tools/22030),
   [RZMenu](https://gamebanana.com/tools/22556), the older
   [GIMI Mod Toggle Script](https://gamebanana.com/tools/11165)), but most of it is Notepad++.
9. **Test in game.** F10 reloads. With many mods F10 is slow, and the modded character should be off screen when it
   loads or it renders half done ([troubleshooting](https://leotorrez.github.io/modding/guides/troubleshooting)).
   Errors show as yellow on-screen text and in `d3d11_log.txt`.
10. **Package and post.** Zip the folder, take preview screenshots, write the toggle list, upload to GameBanana.
    GameBanana's bot rejects `.exe` files, so tools ship as Python or link off site
    ([ZZZ Mod Fixer](https://gamebanana.com/tools/23064), [TexFix](https://gamebanana.com/tools/20096)).
11. **After every game update, do it again.** Find which hashes changed, update the ini or wait for a community
    fixer, reupload, answer "fix please" comments.

## Pain points, ranked

Ranked by how often they show up and how much work they cost.

1. **Game updates break mods, every patch.** The most viewed tool for Genshin is
   [7.2 Fix All Character Mods](https://gamebanana.com/tools/16433) (1.1M views, 460 comments, most of them
   "x.y fix please"). In HSR nine of the top 15 tools are versions of [petrascyll's fixer](https://gamebanana.com/tools/19559),
   and ZZZ has six of his plus community ones. The most commented Genshin tutorial is [6.3 Yellow Mods and Easy Fix](https://gamebanana.com/tuts/18849)
   (214k views, 532 comments): a manual line-by-line ini edit. Some breaks can't be fixed by swapping hashes at all:
   old Belle mods needed their makers to start over ([ZZZ Mod Fixer comments](https://gamebanana.com/tools/23064)),
   and Genshin 5.4 normal maps "cannot be automated" per SilentNightSound. Fixers also break mods: one commenter's heads, arms and legs "bend all over the place" after running
   the ZZZ fixer. Of the last 1,000 GameBanana questions across the six
   games, 139 are about textures breaking and 18 ask for new hashes by name.
2. **Export errors that don't say what to do.** "Cannot find match for name" is the common one
   ([tuts/18033 comments](https://gamebanana.com/tuts/18033), [question](https://gamebanana.com/questions/109720),
   [XXMI Tools issue](https://github.com/leotorrez/XXMITools/issues)). It means object names don't match `hash.json`.
   Others: missing `.fmt` files, an ini template error, vertex colour and normal format bugs
   ([WWMI Tools issues](https://github.com/SpectrumQT/WWMI-Tools/issues?q=is%3Aissue)). Several people ask whether a
   finished mod can be imported back into Blender. It can't without the author's `.blend`.
3. **Getting a clean dump.** Mods left on poison the dump. A RabbitFX shader left in Mods makes WWMI Tools fail to
   parse the dump ([question](https://gamebanana.com/questions/110446)). Hunting needs a numpad (one commenter rebound
   it to F5/F6 in d3dx.ini), has to be on before launch, and each dump is gigabytes. Faces and shape keys often come out
   missing ("Frame dump is missing shapekeys data!").
4. **Textures.** Colours come out lighter after saving because the format or colour space doesn't match the original
   ([question](https://gamebanana.com/questions/109738), [WWMI Tools #27](https://github.com/SpectrumQT/WWMI-Tools/issues?q=is%3Aissue)).
   Diffuse, lightmap and material maps get swapped. A 2048x2048 DDS is 4 MB even when most of it is empty.
5. **Ini writing.** Toggles, merges and menus are hand written or made with scripts that non-coders can't run. On the
   merge script: "Honestly - this is way too advanced." and "I wasted several hours on this."
   ([tools/11165](https://gamebanana.com/tools/11165)). Key choice is a mess: `[` and `/` don't exist on many layouts,
   and leaving out `no_ctrl`-style hints makes one key fire two toggles ([On Mod Hygiene](https://gamebanana.com/tuts/20467)).
6. **Learning.** Guides are scattered, outdated or "under construction", and help lives in Discord. "every tut ive
   seen on youtube all either didnt work at all" ([question](https://gamebanana.com/questions/110307)). On the best
   written WW guide: "My hero, everyone was gatekeeping their knowledge from me."
   ([tuts/19096](https://gamebanana.com/tuts/19096)), and its author says they keep getting DMs the guide answers.
7. **Mod hygiene and conflicts.** Mods override vanilla hashes with copies of the original asset "for no reason",
   which blocks face or hair mods from stacking and bloats downloads (one user's ZZZ folder is 80 GB). Endfield mods
   with global ShaderOverride rules freeze each other, enough that someone wrote a
   [conflict auditor](https://gamebanana.com/tools/23870).
8. **Testing loop.** Every change is export, alt-tab, F10, wait, look. First use of a skill stutters while modded
   shaders compile unless `cache_shaders` is on ([tuts/19670](https://gamebanana.com/tuts/19670)).
9. **Trust in tools.** Fixers are random `.exe` files. GameBanana's bot rejects them, antivirus flags them, and an
   impersonator posted a fake "6.0 Fix all Character Mods!" that downloaded malware (pinned comment on
   [tools/16433](https://gamebanana.com/tools/16433)).

## Tools that exist, and what they leave out

| Tool | Does | Leaves out |
|---|---|---|
| [XXMI Launcher](https://github.com/SpectrumQT/XXMI-Launcher) (3.3k stars) | Installs and updates each importer, hunting and dump switches, launch options | No dump management, no linting, no packaging, nothing about hashes |
| [XXMI Tools](https://github.com/leotorrez/XXMITools) (154 stars), [WWMI Tools](https://github.com/SpectrumQT/WWMI-TOOLS) (172), EFMI Tools | Blender import, export, generated ini, shape keys, SlotFix lines | Error messages, editing, toggles beyond basics, any in-game step |
| [gui_collect](https://github.com/Petrascyll/gui_collect) (77 stars) | Extracts objects from a dump by IB hash, targeted dumps, texture typing | Python install, no Endfield |
| Asset repos (GI, HSR, ZZZ, WW) | Pre-dumped vanilla models with `hash.json` | Lag behind new characters and skins |
| Patch fixers: [GI](https://gamebanana.com/tools/16433), [HSR](https://gamebanana.com/tools/19559), [ZZZ](https://gamebanana.com/tools/23064), [WW (Wuwa_Mod_Fixer, ~1k stars)](https://github.com/Moonholder/Wuwa_Mod_Fixer), [EF](https://gamebanana.com/tools/22185) | Rewrite hashes and ini structure after an update, keep backups | One per game per version, exe trust issues, can damage mods that don't fit the pattern |
| Texture fixers: [TexFix](https://gamebanana.com/tools/20096), [ZZMI_tools](https://github.com/Satan1c/ZZMI_tools) (SlotFix applier, VG remapper, LOD generator) | Convert old texture binding to SlotFix or RabbitFX | Python or off-site exe |
| Ini helpers: [INI Tools](https://gamebanana.com/tools/18627), [Menu Creator](https://gamebanana.com/tools/22030), [RZMenu](https://gamebanana.com/tools/22556), [LOD Configuration Generator](https://gamebanana.com/tools/19967) | Toggles from Blender collections, in-game menus, LOD inis | Each covers some games, Blender only, early state |
| [3DMigoto Mod Viewer](https://gamebanana.com/tools/23590) | Opens a finished mod in 3D without the game, previews toggles, saves presets | Antivirus complaints, some texture methods don't load |
| [AG Remap](https://pypi.org/project/animegameremap) | Ports GI mods between a character and their skins | pip install |
| Mod managers ([IMM](https://gamebanana.com/tools/21814), [JASM](https://gamebanana.com/tools/14574), [No Reload Mod Manager](https://gamebanana.com/tools/19863)) | Players' side: install, toggle, auto F10 | Nothing for makers |

Nothing ties steps 3, 9, 10 and 11 together. Each maker stitches together the launcher, Explorer, Notepad++, Python
scripts and GameBanana's upload form.

## What gachamod already does for makers

- Tools > Mod makers: open the loader folder, d3dx.ini, d3dx_user.ini and ShaderFixes; Reload in game (F10); clear
  the shader cache; move frame dumps to the Recycle Bin; reset saved mod options with undo; the 3DMigoto log.
- Find a hash: which installed mods, on or off, touch a hash.
- Settings > Launch > Mod maker switches: hunting, dump shaders, hide warnings, enforce rendering, call logging, debug
  logging, log level.
- Fixes for broken mods after updates from compiled fix data (`docs/fixers.md`), conflicts, key clashes, `.gachamod`
  packs and a watcher on each Mods folder.

So the in-game end (test, reload, logs, fixes) is mostly there. The gaps are around dumps, hashes, checking a mod
before posting, and the patch-day loop.

## Feature ideas, ranked

Value is how many makers it helps and how often. Effort is a rough guess against the current code.

| # | Idea | Value | Effort |
|---|---|---|---|
| 1 | **Reload on export.** A switch in Mod makers: when files in a mod folder change and the game is running, gachamod sends the reload key once the writes settle. The watcher and `dev.reload` exist. Skip mods with a `.blend` save in progress, and say in the tip to keep the character off screen | High (every iteration) | Low |
| 2 | **Clean dump.** One button: turn hunting on, start the game with every mod and shader library (RabbitFX, ORFix) off, put everything back when the game closes. Show each FrameAnalysis folder with its size and time, open the newest, warn when the drive is low, and offer a targeted dump from a list of IB hashes | High (every new model, most beginner failures) | Medium |
| 3 | **Check a mod before posting.** Static checks on one mod folder: files the ini names that don't exist (and case mismatches), DDS format or size that differs from the vanilla texture it replaces, blocks that override vanilla assets with identical copies, hashes the current fix data says are stale, keys on `[ ] / ;` or other layout-dependent keys, keys missing `no_` hints that collide inside the mod, clashes with the game's own keys, ORFix lines in face sections, missing namespace. Each finding opens the file at the line | High | Medium (ini parser and key clash code exist) |
| 4 | **Name a hash, and see what changed.** Load `hash.json` from the asset repos and the fix data so Find a hash also searches by name ("Ellen BodyA Diffuse") and shows old to new per game version. Answers the "what's the new hash for X" questions without a dump | High (patch days) | Medium (data source licences to check) |
| 5 | **Patch day for your own mods.** A "My mods" view from the maker's GameBanana id: after an update, mark which of their posted mods the fix data says broke, fix a working copy, and build a new zip with a changelog line. Uses the existing fixers and the read-only GameBanana API; uploading stays on the site | High for active makers | Medium |
| 6 | **Package for GameBanana.** Build a zip from a mod folder without `.blend`, `.bak`, disabled inis, logs or caches; list its keys as a readme from the parsed ini; show the size and which files are vanilla copies | Medium | Low |
| 7 | **Log in plain words.** Read the 3DMigoto log after a reload and show each error as "Mod X: Textures/Body.dds is missing" with a button to the file | Medium | Low to medium |
| 8 | **Vanilla assets.** Download one character's folder from the asset repo for the game, so a beginner can open it in Blender without dumping. Say when the repo is older than the character | Medium (beginners) | Low |
| 9 | **Texture save check.** Read the DDS header of an edited texture and of the original and say when the format, colour space or size differs ("saved as BC7 linear, the original is BC7 sRGB"). Converting with texconv could come later | Medium | Low (check only) |
| 10 | **Blender add-on helper.** Find Blender installs, show which add-on and version each has for the selected game, and link the release | Low to medium | Medium |
| 11 | **Toggle and merge builder.** Combine several of the maker's own mod folders into one with a key or the in-game menu, no Python | Medium | High (merge edge cases broke every script so far) |
| 12 | **3D preview** of a finished mod, like 3DMigoto Mod Viewer | Medium | High |

Top five, weighing value against effort: 1 reload on export, 2 clean dump, 3 check before posting, 4 hash names and
changes, 5 patch day for your own mods.

Things to stay away from: running anyone's fixer exe, AI that edits inis (a community tool does this,
[tuts/20351](https://gamebanana.com/tuts/20351); gachamod keeps AI to simple jobs), and anything that helps around
anti-cheat.

## What needs testing with makers

- Whether auto reload helps or hurts: F10 with a large Mods folder takes seconds, and a reload during a half-written
  export could load a broken buffer. How long to wait after the last write.
- Whether makers export straight into Mods or into a work folder they copy later. Reload on export only helps the
  first group.
- Which checks in "check before posting" catch things makers miss, and which ones they'd turn off as noise.
- Whether a clean dump with every library off still renders the character correctly in each game (some games may need
  a core library on to draw at all).
- Whether makers would give gachamod their GameBanana id for "My mods", and whether they want a new zip or a patch.
- Hunting without a numpad: which keys they rebind to, so gachamod can offer that in the switches.
- Whether Chinese-speaking makers use GameBanana or other sites first (caimogu.cc and afdian links show up in inis).

## Open questions

- Licences of the asset repos and their `hash.json` files, for bundling or downloading them in the app.
- Whether the XXMI Tools templating branch (mentioned by a maintainer on [tools/18627](https://gamebanana.com/tools/18627))
  changes the generated ini enough to affect the linter.
- How many of the 3,500 submitters make models versus texture or UI edits. GameBanana categories might show it.
- What AGMG's own help channels ask most. Somebody with a Discord account would have to read them.
- Whether GameBanana would accept a direct upload from the app. The session-cookie API in `docs/gb-account.md` is
  read-mostly and unverified for writes.
