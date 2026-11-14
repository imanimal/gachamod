# Mod fixers

Checked 2026-11-13. Data files are in `crates/gacha-core/data/fixes/<game>.json` (`zzz`, `ww`, `hsr`, `gi`, `ef`). HI3 has no fixer.

A game update changes buffer and texture hashes, and sometimes buffer layouts. The `hash = ...` lines in a mod's ini no longer match, so the mod stops loading or looks wrong. Community fixers rewrite those ini lines, and a few rewrite `.buf` files. This file says which fixers matter now, what each one does exactly, and what our JSON holds.

## Reading the JSON

```
{ "game", "current_version", "note", "sources": [..], "versions": [..], "upstream": [..], "conflicts": [..] }
```

- `versions[]` is a list of blocks `{version, source, hashes[], rules[]}`. The same version can appear more than once (one block per source, and rule-only blocks).
- `hashes[]` entry: `old`, `new` (8 lowercase hex), `character`, `part`, `kind` (`ib|draw|position|texcoord|blend|texture|main|other`), optional `from` (version the old hash belonged to), `also` (other characters with the same pair), `current` (the new hash is in the live 3.3 table, ZZZ only), `note`.
- Pairs chain (a to b to c). Loops exist: a hash can come back in a later version. Resolve with a visited set.
- The same old hash can map to different new hashes for different characters (shared textures). Match on character and part, not on the hash alone.
- `rules[]` entry: `kind` (`duplicate_section|remap_vertex_groups|stride_change|texture_slot|other`), `character`, `detail` (exact steps), `auto` (true = our engine can do it from the data alone), `binary` (true = rewrites a `.buf` or `.dds`), `tool`. Extra fields hold the data: `pairs`, `stubs`, `map`, `old`/`new` index lists, `trigger_hash`, `texcoord_hashes`, `replacements`.
- Back up every file before writing. Check the buffer size before converting, as the upstream tools do (they never guess).

## What the operations are

| Operation | Ini only | Rewrites a buffer | Where |
|---|---|---|---|
| Replace `hash = old` by `hash = new` (keep the old line commented) | yes | | all games |
| Texture twins: copy a section for the other resolution or LOD hash | yes | | ZZZ `pairs`, WW `derive` |
| IB stub: add `[TextureOverride..IB]` with `hash` and `match_priority = 0` | yes | | ZZZ |
| IB split: new `match_first_index` sections copied from old ones | yes | | HSR, ZZZ 1.x |
| Extra position hash (vertex explosion): copy section for a second hash | yes | | HSR |
| Line value replacement (`match_first_index`, `match_index_count`, counts) | yes | | WW `rules` |
| Slot to named resource (`ps-t3` to `Resource\ZZMI\Diffuse = ref`) | yes | | ZZZ, GI, HSR, EF |
| Texcoord stride change (COLOR byte to float, halves to floats) | | yes | ZZZ 3.2 and 1.x, HSR Welt |
| Bone index remap in a blend buffer | | yes | ZZZ Jane, Dialyn, Ellen, WW |
| Blend buffer stride 8 to 16 | | yes | WW |
| Wipe COLOR1 vertex mask in texcoord | | yes | WW 3.3 |
| Shape key, MaterialMap, hair fixes | | yes | WW, not described here |
| HSR 3.2 batched pose rewrite | structural | | HSR, upstream only |

Everything in the first block is exact text work. The binary ones are listed with exact transforms below, except where marked unclear.

## ZZZ

Newest game version in the data: 3.3. 778 hash pairs (1.1 to 3.3), 10 conflicts.

| Fixer | Link | Licence | Covers | Status |
|---|---|---|---|---|
| ZZZ Mod Fixer (Community Update), Vonksdesu | github.com/Vonksdesu/ZZZ-Mod-Fixer (branch `gui-version`), GameBanana 23064 | MIT in the repo, GameBanana page CC BY-NC-ND 4.0 | 1.0 to 3.2, full support from 2.2 | Used today, 744 likes, updated 2026-10-10 |
| ZZZ-Model-Hash and ZZZ-Model-Fix-Tool, hefengchang (GreenLzz) | github.com/hefengchang/ZZZ-Model-Hash, .../ZZZ-Model-Fix-Tool, GameBanana 24146 | MIT | tables and change log 2.0 to 3.3, face fix 3.2 | Updated 2026-11-10 for 3.3 |
| Jane Doe and Dialyn remappers, Satan1c | github.com/Satan1c/ZZMI_tools (release 2.5) | GPL-3.0 | 2.5 and later | Needed for those two |
| ZZZ Mod Fixer v2.5e, ConfoundedHermit | GameBanana 21671 | CC BY-NC-ND 4.0 | up to 2.5 | Base of the Vonksdesu data, 370 likes, 17493 exe downloads |
| ZZZ 1.1 to 1.6 Fix, petrascyll | github.com/petrascyll/zzz-scripts, GameBanana 19341 and earlier | none stated, GameBanana CC BY-NC-ND 4.0 | 1.1 to 1.6 | Original, replaced by the two above |
| Fairy's Fixer, the-sea-man | GameBanana 24467, github.com/the-sea-man/ZZZ-Mod-Hub | app GPL-3.0 | up to 3.2, downloads its own fix data | Active, 2026-11-13 |
| ZZZ 1.7 / 2.0 fix, EnteleJiang | GameBanana 19807, 20010 | CC BY-NC-ND 4.0 | 1.7, 2.0, slot fix | Old |
| TexFix (HammyCatte), Texture and lighting repair (GreenLzz) | GameBanana 20096, 19291 | CC BY-NC-ND 4.0 | texture slots | Same idea as the slot rule below |
| Single character fixers (Promeia, Remielle 3.2, Vivian summer, Yanagi, face fixers) | GameBanana 23087, 24356, 21291, 21333, 24133 | CC BY-NC-ND 4.0 | one character each | Not read |

Used for data: the Vonksdesu modules (one python dict per character, 97 files) and the hefeng change log. Cross-checked, not emitted: petrascyll's `zzz_fix.py` (5 pairs were not in the MIT data) and the ZZZ Mod Hub database. The petrascyll and EnteleJiang tools have no reusable licence, so their data is only in the output where the MIT Vonksdesu repo repeats it.

Hash counts per target version: 1.1 50, 1.2 28, 1.3 27, 1.4 42, 1.5 24, 1.6 29, 1.7 6, 2.0 44, 2.1 25, 2.11 5, 2.2 9, 2.3 5, 2.4 9, 2.5 124, 2.7 11, 2.8 26, 2.81 31, 3.0 91, 3.1 75, 3.11 5, 3.2 98, 3.21 7, 3.3 7. A pair labelled with one version only (the source says "2.2: ..."), is filed under 3.2 with `from` set, because the Vonksdesu data maps those straight to the 3.2 hash.

Operations, with the exact transforms:

1. Hash replacement. Ini only. Done for every pair.
2. Texture twins. ZZZ has one hash per texture at 1024p and at 2048p. If the ini has a section for hash A and none for the twin B, copy the section for B. 2009 pairs in the rule. Ini only.
3. IB stubs. If a texture hash is overridden and the IB hash of that part has no section, add `[TextureOverride<Name>IB]`, `hash = <ib>`, `match_priority = 0`. 632 IB hashes, 7199 texture hashes. The upstream code gives no reason. Low value. Ini only.
4. Slot to named resource. `ps-t3` to `Resource\ZZMI\Diffuse = ref X`, `ps-t4` NormalMap, `ps-t5` LightMap, `ps-t6` MaterialMap, then `run = CommandList\ZZMI\SetTextures` after the run of lines. `ps-t17` to `Resource\RabbitFX\GlowMap = ref`, `ps-t18` to `Resource\RabbitFX\FXMap = ref`. Ini only. Do not port the Vonksdesu `run = CommandListSkinTexture` insert (788 triggers): current packages do not define that list.
5. 3.2 face texcoord (53 meshes, 46 characters). Buffer `vb1` of the face and eyebrow parts. Old layout 36 bytes per vertex: 4 x u8 color, then 8 floats. New layout 48 bytes: 4 x f32 color, then the same 8 floats. Color is `byte / 255.0`. Change `stride = 36` to `stride = 48` in the Resource that `vb1` binds (follow `run =` command lists, recursively). Run only when the ini has `hash =` one of `texcoord_hashes`, after the hash replacement. Skip if bytes per vertex (file size / vertex count from the blend buffer, size / 32) is already 48. Two tools carry the same 53 hashes (Vonksdesu, hefeng), so this one is solid.
6. Bone index remap, Dialyn body (blend hash `3d7e53cf`, position hash `ff36809b`). Blend buffer stride 32: 4 x f32 weights, then 4 x u32 bone indices. Rewrite only the indices through a 33 entry table (in the JSON). Same table in two tools. The 1.x tables are Belle 67 entries (1.1), Grace 55 (1.2), Ellen hair and legs 14 (1.4) and Lycaon 17, twice (1.4). All are in the JSON.
7. Bone index remap, Jane Doe 2.5. Same transform with two tables (Hair blend hash `e42171df`, 65 entries; Arms blend hash `d06a9206`, 61 entries). Only the buffer part is exact. The rest of the Jane fix is manual: duplicate the Hair sections as Arms sections, hook Blend instead of Position, split the `DrawIndexed` calls. Mark Jane as "needs the mod author" unless the mod was already made with the new split.
8. Old texcoord layout changes (1.1 to 1.4): Ellen hair 24 to 36 bytes, hair color float back to byte in 1.2 (7 hair meshes), `2e` (half) to `2f` (float) in Caesar and Koleda 1.3, Seth 4f to 4B in 1.4. Struct letters are `B` u8, `e` f16, `f` f32. Rules `stride_change` list them. Only old mods need them.
9. Generic bone index remap from a game dump (hefeng tool mode 1): needs a dump of the game mesh and matches vertices by position. Not possible from JSON. `auto` is false.
10. Unfixable: Wise swimwear hair and body, Belle neck, Roxy 3.21 split. The hefeng log marks "model changed, not fixable". Show "needs an update from the author".

Upstream for automatic updates:

- `https://raw.githubusercontent.com/hefengchang/ZZZ-Model-Hash/master/Hash%E5%8F%98%E5%8A%A8%E6%97%A5%E5%BF%97.txt`: the change log, newest on top. Format in the JSON `upstream` entry. Best single feed.
- `.../ZZZ-Model-Hash/master/角色hash表/<name>.json` (URL encode the folder): current hashes per character. Collect all `hash` values into a set. A mod hash that is an `old` in our data and not in that set is confirmed broken.
- `https://raw.githubusercontent.com/the-sea-man/ZZZ-Mod-Hub-DB/main/hash_lineage.json`: old to current with chains collapsed, version 3.2 now. No licence, use as a hint.
- Vonksdesu `gui-version` branch, `Source Codes/Assets/PlayerCharacterPYData/*.py`: parse with a regex or the python AST, never run.
- Satan1c `ZZ-Model-Importer-Assets` (freshest, 2026-11-11) and `leotorrez/ZZ-Model-Importer-Assets`: git history of `PlayerCharacterData/<Char>/hash.json`. Diff revisions per component. This is what `VersionFixerGenerator` in ZZMI_tools does and it is the way to cover a new version before anyone writes a fixer.

## Wuthering Waves

Newest game version in the data: 3.7. 2075 hash pairs (main 135, texture 1940), 18 vertex group remaps, 3 stride fixes, 704 derived texture pairs.

Fixer that matters: Wuwa Mod Fixer by Moonholder, github.com/Moonholder/Wuwa_Mod_Fixer. GPL-3.0, 1038 stars, release v3.7.0 on 2026-10-11, last commit 2026-10-18. Release tags follow the game version. It is the only open fixer with live data. Others: Woju fixer (GameBanana 23937, needs asset files from a video, not used), Zesi 2.7 fix (GameBanana 20358, CC BY-NC-ND, "not for 2.8"), Nooble 2.4 and Gustav0_ 1.4 (old), wxt01 repair tool (needs a dump per mod, not used).

The tool is configuration driven: `config.json` is the whole fix. Our JSON takes the hash facts and rule parameters from it, per release tag, so each pair sits in the version where the config first knew the old hash. The code is not copied.

- `main_hashes`, `textures[new].replace`: hash replacement, ini only. The config is cumulative: an old hash from 2.6 maps straight to the newest hash.
- `textures[new].derive` (LOD, Gacha, wet, injured, lvMIN): texture twins. Ini only.
- `rules[]`: replace the value of lines starting with `line_prefix` (`match_first_index`, `match_index_count`, `$\WWMIv1\vg_count`, `run`). Each replacement is consumed once, in file order. Ini only.
- `vg_remaps`: bone index remap. WWMI blend buffers are stride 8 (4 x u8 index, 4 x u8 weight) or 16 (8 + 8). Only the first stride/2 bytes of a vertex are indices. With `component_remap` the table is per component and local: add that component's `vg_offset` (the number on the line containing `vg_offset` inside `[TextureOverrideComponent<N>]`) to both sides. Several remaps of one character compose in order. A `BlendRemapForward` buffer (blocks of 512 u16) gets the same map.
- `stride_fix`: blend stride 8 to 16. Per vertex `[i0 i1 i2 i3 w0 w1 w2 w3]` becomes `[i0 i1 i2 i3 0 0 0 0 w0 w1 w2 w3 0 0 0 0]`, `stride = 16` in the ini.
- Rendering 3.3 fix: texcoord (stride 16) bytes 4 to 7 of each vertex are the COLOR1 mask. Per component (found from the index ranges, `skip_components` excluded, default `[5]`), set them to 0 when they are 255,255,255,255, or with the option on when byte 4 or 6 is not 0.
- `shapekey_fix`, `hair_fix`, `materialmap_adapt`: described, `auto` false. Use the upstream tool.
- Stable textures (RabbitFX): replace hash overrides with RabbitFX slots. Not re-derived.

Upstream: `https://raw.githubusercontent.com/Moonholder/Wuwa_Mod_Fixer/main/config.json`. The format is the one above and the app can read it as it is. The tool itself refuses a config whose `min_required_version` is newer than the tool, so read `version.min_required_version` too. Release list: `api.github.com/repos/Moonholder/Wuwa_Mod_Fixer/releases/latest`.

## Honkai: Star Rail

1469 pairs (1.4 to 3.4), 43 conflicts (all depth mismatches, see below).

Fixer that matters: Another v3.3 HSR Fix, petrascyll, GameBanana 19559 (1788 likes, exe downloaded 78992 times, 2025-06-10, CC BY-NC-ND 4.0). No newer HSR fixer exists as of 2026-11-13. Related: Pipeline Convert Fix, Gustav0_ (19978, ND), ps-t slots to RabbitFX, solomoncyj (22998, MIT, 3 KB python), Universal HSR Mod Fixer (23752, repackages the 3.3 fix and runs code fetched from GitHub with `exec`). The GitHub copy (`petrascyll/hsr-scripts`) stops at 3.0C and has no licence.

Data: petrascyll's `hsr_fix.py` 3.0C (648 pairs, 1.4 to 3.0, hash facts only) plus the SR-Model-Importer-Assets history for 3.2 and later (541 pairs for 3.2, 7 for 3.4).

Operations:

- Hash replacement, ini only.
- IB split (49 body IBs, 1.6 to 2.0 and later): the rule `splits` lists `trigger_hash`, `new_hash`, `trg_indices`, `src_indices`. Ini only.
- Vertex explosion fix (22 characters): copy the position section for a second position hash. Ini only.
- Trailblazer path variants (Destruction, Preservation, Harmony): if the ini already has the hash of the other path, comment the section out, otherwise update. Ini only.
- Welt body texcoord, two steps: `<BBBBee` (8 bytes) to `<BBBBeeee` (12, TEXCOORD1 copied from the last pair) in 1.6 to 2.0, then `<BBBBeeee` to `<BBBBffff` (20) in 2.0 to 2.1. Buffer rewrite.
- 3.2 batched pose: not a hash swap. The mod hooks Blend instead of Position, the DrawCS and `DRAW_TYPE == 8` branch go, `$\SRMI\vertex_count` is set. Needs a trio table (blend, draw, position per part). Both tools are ND. `auto` is false. The best route is to link the upstream tool.
- Slot fix to RabbitFX stable textures (3.3): `auto` false, the script was not read.

Upstream: `api.github.com/repos/leotorrez/SR-Model-Importer-Assets/commits?path=PlayerCharacterData` for hash history (last push 2026-01-01). `datas/valid_hashes.json` in the agungmubarak1453 repo lists the trios. GameBanana `Tool/19559` for a newer fixer file.

## Genshin Impact

425 pairs (3.0 to 5.4). Fixer that matters: Fix All Character Mods, SilentNightSound, GameBanana 16433 (4318 likes, version 7.2 posted 2026-11-06 with 5445 exe downloads so far, script by Gustav0_ for the latest). Licence CC BY-NC-ND 4.0, so none of its data is in our JSON. It is the only source for hash changes from 5.5 to 7.2. Other tools:

- ORFix Applier (golanah921, now LeoMods_, GameBanana 16472, 618k views, 43155 exe downloads, version 4.2, ND): makes mods call ORFix (shipped by the GIMI package) instead of raw slots. Ini only, needs a character list. Related: Face Fix Updated (Sanddino 21052), ORFix tools 21138, 21063, 21131.
- 5.7 slot shift (ZaRe4p3r, GameBanana 20070, ND, marked outdated): `ps-t0` to `ps-t6`, `ps-t1` to `ps-t0`, `ps-t2` to `ps-t1`, plus a marker line. Ini only. Taken from the page text, the script was not read.
- 5.4: character normal maps changed, not automatable (SilentNightSound). The author has to replace them.
- HOYO SHA hash updater (17367, 2024, stale).

Data: the git history of `SilentNightSound/GI-Model-Importer-Assets` (`PlayerCharacterData/<Name>/hash.json`, GPL-3.0), diffed per component with reverted commits removed. Version labels come from the commit message, or from the release date when the message has none (`note` says so). The history has no GI hash fix after 2025-02, so 5.5 to 7.2 is missing.

## Arknights: Endfield

No data. The fixer that matters is EFMI Version 1.1 Fix by Gustav0_ (GameBanana 22185, 1064 likes, 35090 exe downloads, 2026-03-28, ND). It needs XXMI 0.8.0 and EFMI 1.2.0, requires `match_index_count` on every scope, updates hashes per character from data embedded in its source, and only handles mods made with EFMI-Tools. Others: AE12 Mod Batch Fixer (22472), KatTheDev tool (obsolete), WuDunYaKuSya Endfield Mod Repair (releases only, 15 profiles). `ef.json` has the sources, two rules marked not automatable, and the API address to watch.

## Honkai Impact 3rd

No fixer found. SilentNightSound's HIMI (GameBanana 16498) has not changed since 2024.

## Finding new fixers

GameBanana API, per game id (gi 8552, hsr 18366, zzz 19567, ww 20357, hi3 10349, ef 21842):

`https://gamebanana.com/apiv11/Tool/Index?_nPage=1&_nPerpage=50&_aFilters[Generic_Game]=<id>&_sSort=Generic_Newest`

Keep the highest `_tsDateAdded` seen. A tool is a fixer candidate when its name matches `fix|hash|remap|repair|update|convert` (case insensitive). Show it once as "new fixer" with the link. `Tool/<id>/ProfilePage` gives `_aFiles[]` with names and dates, which is how to notice a new version of a known fixer (for example `gifixversion72.exe`, `hsr_fix33d`). Do not download the archives automatically: most are CC BY-NC-ND and many exes are unsigned.

## Detecting broken installed mods

A mod is confirmed broken when an active `hash =` value is an `old` hash in our data, is not also a current hash of its game, and the mod's character matches the entry. The current set: all hashes of the hefeng tables (ZZZ), every `new` value and `textures` key of the WW config, the latest assets `hash.json` (HSR, GI). Without the current set, a loop (a hash that came back) would flag a good mod. Two different old hashes can be valid for different characters, so also compare the character.

## Conflicts

Conflict means one old hash maps to different new hashes in different sources and neither target lies on the other's chain. The JSON lists them in `conflicts` with what was chosen.

ZZZ (10):

- 7 where the Vonksdesu `gui-version` branch differs from its older `main` branch, the ZZZ Mod Hub database and the 3.3 hefeng table: old `9ceea795`, `9cddbf1e`, `21ee9a3f`, `6fc654e1`, `8e5ba7d0`, `b7ce5f0b`, `c42628a5` (Anby and Anton textures). The `gui-version` targets are not in the 3.3 table, the other targets are, so the other targets are kept.
- `287c161c`: `014159dd` (Ye Shunguang skin eyebrow texcoord, in hefeng log, `gui-version`, and the 3.2 face list) against `a5182b8a` (a Chinatsu position hash, typo in `main`). Kept `014159dd`.
- `84529dab` and `ef76b675`: the same old Wise texture hash is mapped differently for Wise, Belle temple and Wise temple skins. Context dependent, key by character. Only the Wise targets are emitted (the temple modules were removed from `gui-version`).

HSR (43): the old hash maps to a 3.0 hash in petrascyll's script and to a 3.2 hash in the assets history, because the part changed again in 3.2 and the assets history has no 3.0 dump. Both are kept; prefer the newer target on a game at 3.2 or later.

WW and GI have one source each, so no cross-source conflicts. Inside one source, an old texture hash can still lead to different new hashes for different characters or slots (WW 3 hashes, GI 16, HSR 13, ZZZ none). These are context dependent, not errors: match on character and part.

## Gaps

- GI 5.5 to 7.2 hash data and HSR 3.2/3.3 data exist only in ND licensed tools. They stay as links to the upstream tools,
  and their data isn't copied into gachamod.
- EF has no extracted data.
- ZZZ 3.3 has 7 pairs (the hefeng log). 120 of the 585 end-of-chain ZZZ hashes are not in the 3.3 table (86 of them textures, which the table covers only in part). They are unverified, not known wrong. `current: true` marks the others.
- Jane Doe needs hand work beyond the buffer remap. Mesh changes that cannot be fixed are listed in a ZZZ rule.
- WW shape key, hair and MaterialMap fixes are described, not specified. Use the upstream config and tool.
- No fixer was run and nothing was checked against a live game.
- GameBanana archives were not downloaded. The GI, HSR 3.3 and EFMI 1.1 sources are small zips (24 KB to 141 KB). Fetching them needs the project owner's approval, and the licence (ND) does not allow copying their data into the app.

## Credits

petrascyll, leotorrez, CaveRabbit, SilentNightSound, HummyCatte (HammyCatte), shaojiang, ConfoundedHermit, Vonksdesu, ZumwaltDDG1000, EnteleJiang, hefengchang (GreenLzz), Satan1c, the-sea-man, Moonholder, Gustav0_, Nooble_, zlevir, sora_, golanah921, LeoMods_, ZaRe4p3r, Sanddino, solomoncyj, agungmubarak1453, Aksell94, KatTheDev, WuDunYaKuSya, Wo_ju, ZesilinaVT, and the AGMG community.
