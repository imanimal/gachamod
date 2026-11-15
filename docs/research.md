# gachamod research notes (checked 2026-11-13)

Sources: XXMI Launcher source (SpectrumQT/XXMI-Launcher, main, latest release v2.5.0 published 2026-11-12), importer package repos, bo3b/3Dmigoto source (IniHandler.cpp, Override.cpp/h), live GameBanana API calls, GameBanana wiki 1999, IMM source (jpbhatt21/integrated-mod-manager), JASM+ source (zurce/JASM). Mod counts are from Mod/Index `_nRecordCount` on the day of checking.

---

## 1. Game list

### 1a. XXMI Launcher games (first-class targets)

All values below are read from `src/xxmi_launcher/core/packages/model_importers/<code>_package.py`. GameBanana ids verified with `GET https://gamebanana.com/apiv11/Game/<id>/ProfilePage`.

| id | Game | XXMI code / package repo | Importer (tools) repo | GB game id | GB mods |
|---|---|---|---|---|---|
| gi | Genshin Impact | GIMI / SilentNightSound/GIMI-Package | SilentNightSound/GI-Model-Importer | 8552 (gamebanana.com/games/8552) | 13321 |
| hsr | Honkai: Star Rail | SRMI / SpectrumQT/SRMI-Package | SilentNightSound/SR-Model-Importer (old, last push 2023) | 18366 | 2896 |
| zzz | Zenless Zone Zero | ZZMI / leotorrez/ZZMI-Package | leotorrez/ZZ-Model-Importer | 19567 | 5931 |
| ww | Wuthering Waves | WWMI / SpectrumQT/WWMI-Package (SpectrumQT/WWMI redirects here) | same | 20357 | 3106 |
| hi3 | Honkai Impact 3rd | HIMI / leotorrez/HIMI-Package | GB tool 16498 | 10349 | 143 |
| ef | Arknights: Endfield | EFMI / SpectrumQT/EFMI-Package | GB tool 21846 | 21842 | 793 |

The 3DMigoto DLLs used by all of them come from SpectrumQT/XXMI-Libs-Package.

Exe / folder data (XXMI config fields):

| id | game_exe_names | game_process_exe | game_folder_names | game_folder_children | importer_folder | inject mode | start_method default |
|---|---|---|---|---|---|---|---|
| gi | GenshinImpact.exe, YuanShen.exe | GenshinImpact.exe | Genshin Impact Game | GenshinImpact_Data | GIMI/ | HOOK | SHELL |
| hsr | StarRail.exe | StarRail.exe | Star Rail Games | StarRail_Data | SRMI/ | HOOK | NATIVE |
| zzz | ZenlessZoneZero.exe, ZenlessZoneZeroBeta.exe | ZenlessZoneZero.exe | ZenlessZoneZero Game | ZenlessZoneZero_Data | ZZMI/ | HOOK | NATIVE |
| ww | Wuthering Waves.exe (wrapper); process_exe_names Client-Win64-Shipping.exe at process_exe_rel_paths Client/Binaries/Win64 | Client-Win64-Shipping.exe | Wuthering Waves Game | Client, Data | WWMI/ | DIRECT | NATIVE |
| hi3 | BH3.exe | BH3.exe | Honkai Impact 3rd game | BH3_Data | HIMI/ | HOOK | NATIVE |
| ef | Endfield.exe | Endfield.exe | EndField Game | Endfield_Data | EFMI/ | DIRECT | NATIVE |

Enums: `InjectMode` = DIRECT / HOOK / SKIP. `GameLaunch` = DIRECT / STEAM / EPIC_GAMES / CUSTOM / MANUAL (default DIRECT). `StartMethod` = NATIVE / SHELL.

Typical install locations and how XXMI finds them:

- All importers first scan `HKCU\SOFTWARE\Classes\Local Settings\Software\Microsoft\Windows\Shell\MuiCache`, `HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\FeatureUsage\AppSwitched` and `...\FeatureUsage\ShowJumpView` for value names containing the exe name, and take the part before the exe name as the folder (`reg_search_game_folders`).
- HoYoverse games (gi, hsr, zzz, hi3): XXMI walks `%APPDATA%\Cognosphere\HYP\` for every `gamedata.dat` and regex-matches `"installPath":"..."` / `"persistentInstallPath":"..."`. HoYoPlay default folders are `C:\Program Files\HoYoPlay\games\<game_folder_name>` (e.g. `...\games\Genshin Impact game\GenshinImpact.exe`). On this machine `HKCU\Software\Cognosphere\HYP` exists but has no install-path values; a per-game `GameInstallPath` value under `HKCU\Software\Cognosphere\HYP\1_0\<biz>` is UNCONFIRMED.
- Settings keys XXMI writes to (prove the game was run, do not hold paths): `HKCU\SOFTWARE\miHoYo\Genshin Impact` (CN: `HKCU\SOFTWARE\miHoYo\原神`), `HKCU\Software\Cognosphere\Star Rail`, `HKCU\Software\miHoYo\Honkai Impact 3rd`. `HKCU\Software\miHoYo\ZenlessZoneZero` also exists on this machine (ZZMI itself edits `ZenlessZoneZero_Data\Persistent\LocalStorage\GENERAL_DATA.bin` instead).
- Epic HoYoPlay installs are detected by `launcher_epic.exe` three folders above the game exe, or "epic" in the `config.ini` next to the exe. For Epic HSR and ZZZ, XXMI sets the working dir to `game_exe.parent.parent.parent` (otherwise login fails / crashes).
- Wuthering Waves: reads `%APPDATA%\KRLauncher\**\kr_starter_game.json`, key `path`. Folder must contain `Wuthering Waves.exe` plus `Client` and `Engine`. Default Kuro path (`C:\Wuthering Waves\Wuthering Waves Game`) is UNCONFIRMED.
- Endfield: known paths `C:\Program Files\GRYPHLINK\games\EndField Game` and `D:\GRYPHLINK\games\EndField Game`. Launcher is found via `HKCU\Software\GRYPHLINK\Launcher\94005b4608518100ed8df1d8107356a8` value `install_path`, or `C:\Program Files[ (x86)]\GRYPHLINK\Launcher.exe` / `...\Hypergryph Launcher\Launcher.exe`; display names "GRYPHLINK", "hypergryph launcher", "鹰角启动器".
- Steam app ids (Steam store search API): WW 3513350, HI3 1671200, Endfield 4732690, ZZZ 4162040. GI and HSR are not on Steam. XXMI matches Steam/Epic library entries by keyword (`endfield`, `genshin`, `honkai impact`, `starrail`/`star rail`, `wuthering`, `zenless`).

Special launch handling in XXMI:

- gi: unless game_launch is DIRECT, nothing special. With DIRECT and FPS unlock on, XXMI launches `Resources\Packages\GI-FPS-Unlocker\unlockfps_nc.exe` instead of the game and writes GamePath / AdditionalCommandLine into its config. It also edits graphics settings in registry (`GENERAL_DATA_h2389025596`) and writes `WINDOWS_HDR_ON_h3132281285` for HDR.
- hsr / zzz: Epic working-dir fix above. Graphics config edit (HSR `GraphicsSettings_Model_h2986158309`).
- ww: DIRECT inject. Launches via the `Wuthering Waves.exe` wrapper (fixes NVIDIA Optimus / some Steam crashes) unless `use_launch_options` is on, then starts the shipping exe directly. Default launch_options `-SkipSplash`, `d3d11_mode_cmd_args` `-dx11`, and adds `-krqlv=<resource_tier>` if not present. Edits `Client\Saved\LocalStorage` SQLite + Engine.ini cvars. WWMI needs DX11; a third-party DX12 ReShade add-on exists (lekarsenten/wwmi-dx12, GB tool 24450).
- ef: DIRECT inject. For non-Steam installs with NATIVE start it first starts GRYPHLINK `Games.exe` suspended + no window as a parent process, kills an existing one if running, then starts the game. Steam installs skip this.
- hi3: graphics registry edit only.

Brand colours: not researched.

### 1b. Other 3DMigoto-based gacha games on GameBanana (not in XXMI)

These use a plain or repacked 3DMigoto (often a GIMI/SRMI copy with an edited d3dx.ini). Same Mods folder / DISABLED / KeySwap conventions, but no official importer package and no XXMI integration.

| id | Game | GB id | GB mods | Loader on GB | Notes | Steam app |
|---|---|---|---|---|---|---|
| pgr | Punishing: Gray Raven | 19942 | 38 | "3dmigoto for PGR" (tool 21867, `pgr_mod_enabler.rar`) | Mixed: several top mods are Special K texture packs, others need 3DMigoto | 4125930 |
| p5x | Persona 5: The Phantom X | 20149 | 39 | "Phantom X 3dmigoto" (tool 21129) | GB has a "3DMigoto" root category (11 mods). Mods ship GIMI/SRMI repacks (`3dmigoto_gimi.zip`, `3dmigoto_srmi_for_p5x_repack`) | 3061570 |
| gf2 | Girls' Frontline 2: Exilium | 19494 | 79 | none listed as tool | Top mod says install GIMI and ships a `d3dxini.zip` | 3347400 |
| idv | Identity V | 19670 | 47 | "Identity V 3DMigoto" (tool 18906), "Doll Game Mod Launcher" (18991) | NetEase, not anime-gacha strictly but gacha | n/a |
| ss | Stella Sora | 23629 | 1 | none | Only mod ships `skymi.zip` ("SKYMI", name UNCONFIRMED) | 4813850 |
| at | Action Taimanin | 26307 | 4 | "Action Taimanin UNOFFICIAL Mod loader (3DMigoto)" (tool 24815), stock 3DMigoto 1.3.16, launches via Steam | Mods use key toggles | 1335200 |

Arknights: Endfield also has non-XXMI loaders (GB tool 21760, wakka810/3dmigoto-arknights-endfield).

### 1c. Gacha games on GameBanana with other mod formats

| Game | GB id | GB mods | Format |
|---|---|---|---|
| Neverness To Everness (nte) | 23012 | 417 | UE5 `.pak` (+ sig bypass), `.asi`, `.lua`. Loaders: "Neverness to Everness PAK Loader" (22610), Aurora Launcher (22803, github Daturaxoxo/Aurora, supports .pak/.asi/.lua, has a GB browser), NTEMM (22823), NTE Mod Manager (22807). Some authors also ship XXMI-style folders (per one guide, UNCONFIRMED). Steam 4508340 |
| Tower of Fantasy (tof) | 19491 | 6 | UE4 `.pak` + `.sig` files |
| Snowbreak: Containment Zone | 19719 | 1 | UE `.pak` (single mod) |
| Duet Night Abyss | 23677 | 1 | `.asi`/`.dll` drop-in (censorship remover, nyfair/dna-greendamn) |
| Blue Archive (PC) | 22951 | 29 | Unity AssetBundle replacement (UABEA / BA-MU, "BA Modding Toolkit" 23960) |
| Blue Archive (Mobile) | 18873 | 7 | AssetBundle |
| GODDESS OF VICTORY: NIKKE | 18055 | 4 | AssetBundle swaps, "NIKKE Mod Manager" (16887, outdated), Android manager (24895) |
| Umamusume Pretty Derby (Global) | 22548 | 30 | AssetBundles via UMML (tool 20289) |
| Limbus Company | 22655 | 2 | Sprite/asset replacement |
| BLUE PROTOCOL | 23033 | 4 | asset replacement (format UNCONFIRMED) |
| Brown Dust II | 22514 | 1 | UNCONFIRMED |
| Infinity Nikki 21527, Aether Gazer 21772, Azur Lane 19825, Etheria: Restart 22670, Silver Palace 24145 | | 0 | no mods |

Not found on GameBanana (NameMatch and search): Strinova / CalabiYau, Reverse: 1999, Ash Echoes, Path to Nowhere, Heaven Burns Red.

---

## 2. GameBanana API

All calls below were made without auth. No User-Agent was required (a request with none returned 200). No rate-limit headers are returned (`x-powered-by: Bananas`, `cf-cache-status: BYPASS`); limits are UNCONFIRMED, so cache and batch. The site's own frontend now calls `apiv13`; `apiv11` still works. A Postman collection is linked from the site footer: postman.com/s0nought/workspace/gb-api-v12.

### 2.1 Listing mods

```
GET https://gamebanana.com/apiv11/Mod/Index?_nPage=1&_nPerpage=15&_aFilters[Generic_Game]=8552&_sSort=Generic_MostDownloaded
```
- `_nPerpage` max 50 (51 returns `INVALID_PERPAGE`).
- Working `_sSort` values: `Generic_Newest`, `Generic_Oldest`, `Generic_LatestUpdated` (only mods with updates; count 4683 vs 13321), `Generic_LatestModified`, `Generic_MostDownloaded`, `Generic_MostLiked`, `Generic_MostViewed`, `Generic_MostCommented`, `Generic_LatestComment`. Rejected: `Generic_AToZ`, `Generic_Alphabetical`, `Generic_Name`, `default`, `new`, `updated`, `popular` (`UNKNOWN_SORT`). Note: MostDownloaded, MostViewed and MostCommented returned the same first three ids for GI; whether they really differ is UNCONFIRMED.
- Category filter: `_aFilters[Generic_Category]=<catId>`; it is recursive (18140 GI "Characters" returns 10932 mods from all character subcategories). Example: `.../Mod/Index?_nPage=1&_nPerpage=3&_aFilters[Generic_Category]=18140&_sSort=Generic_Newest`.
- `_aFilters[Generic_Name]` is rejected (`INVALID_FILTER_VALUE`); `_sName` is ignored.

Response (trimmed):
```json
{"_aMetadata":{"_nRecordCount":13321,"_bIsComplete":false,"_nPerpage":1},
 "_aRecords":[{"_idRow":406659,"_sModelName":"Mod","_sName":"Remove Transparency Filter (5.0 Update!)",
  "_sProfileUrl":"https://gamebanana.com/mods/406659","_tsDateAdded":1665766598,"_tsDateModified":1724827599,
  "_tsDateUpdated":1724827662,"_bHasFiles":true,"_aTags":["Software Used: Blender"],
  "_aPreviewMedia":{"_aImages":[{"_sType":"screenshot","_sBaseUrl":"https://images.gamebanana.com/img/ss/mods",
    "_sFile":"634991e630c4b.jpg","_sFile100":"100-90_634991e630c4b.jpg","_sFile220":"220-90_...","_sFile530":"530-90_...","_sFile800":"800-90_...",
    "_wFile220":220,"_hFile220":112}]},
  "_aSubmitter":{"_idRow":2176153,"_sName":"SilentNightSound","_sAvatarUrl":"..."},
  "_aGame":{"_idRow":8552,"_sName":"Genshin Impact"},
  "_aRootCategory":{"_sName":"Skins","_sProfileUrl":"https://gamebanana.com/mods/cats/17510","_sIconUrl":"..."},
  "_aSubCategory":{"_sName":"Skirk","_sProfileUrl":"https://gamebanana.com/mods/cats/37532","_sIconUrl":"..."},
  "_sVersion":"4.2","_bIsObsolete":false,"_sInitialVisibility":"show","_bHasContentRatings":false,
  "_nLikeCount":6612,"_nPostCount":762,"_nViewCount":1454287,"_bWasFeatured":true}]}
```
Index records have no `_nDownloadCount` and no numeric category id; parse the id from `_aSubCategory._sProfileUrl` (`/mods/cats/<id>`). `_sInitialVisibility` is `show` / `warn` / `hide` (hide = NSFW-rated).

Game feed (what IMM uses for its home page): `GET /apiv11/Game/19567/Subfeed?_sSort=new&_nPage=1&_csvModelInclusions=Mod`, `_sSort` in `default`/`new`/`updated`, 15 per page. Tools for a game: `GET /apiv11/Tool/Index?_nPage=1&_nPerpage=50&_aFilters[Generic_Game]=23012`. Game lookup by name: `GET /apiv11/Util/Game/NameMatch?_sName=Punishing`.

### 2.2 Text search within a game

```
GET https://gamebanana.com/apiv11/Util/Search/Results?_sModelName=Mod&_sOrder=best_match&_idGameRow=19567&_sSearchString=ellen&_nPage=1
```
`_sOrder`: `best_match`, `popularity`, `date`, `udate` (others rejected). Fixed 15 per page (`_nPerpage` ignored). Records have the same shape as Index records. `_sModelName` can also be `Tool` or `Game`.

### 2.3 Category tree

```
GET https://gamebanana.com/apiv11/Mod/Categories?_idGameRow=8552&_sSort=a_to_z&_bShowEmpty=true     (root categories)
GET https://gamebanana.com/apiv11/Mod/Categories?_idCategoryRow=18140&_sSort=a_to_z&_bShowEmpty=true (children)
```
`_sSort` is required in practice: omitting it fails with `Value 'most_items' not recognized`. `a_to_z` and `count` work. Returns a flat array:
```json
[{"_idRow":19510,"_sName":"Aether","_nItemCount":186,"_nCategoryCount":0,"_sUrl":"https://gamebanana.com/mods/cats/19510","_bIsObsolete":false,"_sIconUrl":"https://images.gamebanana.com/img/ico/ModCategory/699334094eb4e.png"}]
```
Character category roots (leaf children are one category per character, icon = character portrait):

| Game | Path to character list | Character parent id | count |
|---|---|---|---|
| gi | Skins 17510 > Characters 18140 | 18140 | 125 |
| hsr | Skins 22633 > Characters 22832 | 22832 | 91 |
| zzz | Character Skins 30305 (root) | 30305 | 64 (+ Bangboo Skins 30702, 22) |
| ww | Skins 29524 (root, children are characters) | 29524 | 61 |
| hi3 | Skins 20184 > Characters 23620 | 23620 | 40 |
| ef | Skins 35464 > Operators 42770 | 42770 | 34 |

Other GI roots: Weapons 18137 (Bows, Catalysts, Claymores, Polearms, Swords), Entities/NPCs 22725, UI 22474, Objects 18310, Other/Misc 12526, Gadget 23574, Waverider 24279, Cutscenes 48896. A mod's ProfilePage gives `_aCategory` (leaf, e.g. Lumine 19763) and `_aSuperCategory` (e.g. Characters 18140), so mapping to a character is `_aCategory._idRow` when `_aSuperCategory._idRow` is the character parent (for ww and zzz the parent is the root, so check `_aCategory` parent = root). IMM ships the same ids in `src/gameData.json`.

### 2.4 Mod detail

```
GET https://gamebanana.com/apiv11/Mod/434773/ProfilePage
```
Fields seen (trimmed):
```
_idRow, _sName, _sProfileUrl, _tsDateAdded, _tsDateModified, _tsDateUpdated, _nUpdatesCount, _bHasUpdates,
_sText (description HTML), _sDescription (one-line summary), _sFeedbackInstructions (HTML), _sVersion,
_aPreviewMedia (array of images, same shape as Index; may include _sCaption),
_aFiles[] { _idRow, _sFile, _nFilesize, _tsDateAdded, _nDownloadCount, _sDownloadUrl ("https://gamebanana.com/dl/<fileId>"),
            _sMd5Checksum, _sAnalysisState, _sAnalysisResult ("ok"), _sAnalysisResultVerbose, _sAvState, _sAvResult ("clean"),
            _bIsArchived, _bHasContents, _sVersion, _sDescription, _aAnalysisWarnings (only when present, e.g. {"contains_exe":[paths]}) },
_aArchivedFiles[] (older files, same shape),
_sDownloadUrl ("https://gamebanana.com/mods/download/<modId>"), _nDownloadCount, _nLikeCount, _nViewCount, _nPostCount,
_nThanksCount, _nSubscriberCount, _aContentRatings ({"sa":"Skimpy Attire","pn":"Partial Nudity","nu":"Full Nudity"}),
_sInitialVisibility (show/warn/hide), _bIsObsolete, _bIsTrashed, _bIsWithheld, _bIsPrivate, _aTags, _sLicense, _aLicenseChecklist,
_aSubmitter {_idRow,_sName,_sAvatarUrl,...}, _aCredits [{_sGroupName,_aAuthors[]}], _aGame {_idRow,_sName,_sAbbreviation,...},
_aCategory {_idRow,_sName,_sIconUrl}, _aSuperCategory {_idRow,_sName}, _aEmbeddables, _aFeaturings
```
There is no `_bIsNsfw`; use `_aContentRatings` / `_sInitialVisibility`.

`GET /apiv11/Mod/<id>/DownloadPage` returns just files, archived files, license, owner, donation methods. On `apiv13` it also returns `_aSupportedModManagers` (see 2.6).

Archive contents without downloading: `GET https://gamebanana.com/apiv13/File/1876199` (also apiv12; empty on apiv11) returns the file record plus `_aArchiveFileTree`, a nested object where folders are keys and files are numeric keys or arrays:
```json
"_aArchiveFileTree":{"Adventure Map+":{"0":"AdventureMap.ini","1":"MapDraw.ini","Buffers":["ib_chasm.ib","vb_chasm.buf"],"Regions":{"0":"DrawRegion.hlsl"}}}
```
`/dl/<fileId>` 302-redirects to `https://files.gamebanana.com/mods/<filename>`.

That redirects again to `https://filecache<N>.gamebanana.com/mods/<filename>` (nginx, `accept-ranges: bytes`). Each
file always goes to the same N (checked 2026-11-15: 46 for one file, 41 or 20 or 52 for others). Hosts that serve
`/mods/` for any file: 20, 31, 35 to 47, 52, 53, 54 (1 to 80 checked; the rest answer 404 or not at all). The same
file came from filecache46 at 0.25 to 0.7 MB/s and from 20, 40 and 45 at 12 to 18 MB/s in the same minute; a few
minutes later 46 was fast and 35 and 42 were slow. So the slow one changes over time, and any other host has the
file. The host list is not documented anywhere and can change.

Single-property fetch: `GET /apiv11/Mod/434773?_csvProperties=_sName,_tsDateUpdated,_tsDateModified` returns just those keys.

### 2.5 Update checks and bulk endpoint

Bulk works:
```
GET https://gamebanana.com/apiv11/Mod/Multi?_csvRowIds=434773,406659,739560&_csvProperties=_idRow,_sName,_tsDateUpdated,_tsDateModified,_sVersion,_aFiles
```
Returns an array of objects with only the requested properties (`_csvProperties` is required, otherwise `EMPTY_PROPERTIES`). 100 ids in one call worked; the cap is UNCONFIRMED. `_aFiles` in Multi includes archived files (`_bIsArchived: true`).

Timestamps: `_tsDateAdded` (created), `_tsDateUpdated` (last posted Update entry, absent if never), `_tsDateModified` (any edit, including text). For "is there a newer file", compare max `_aFiles[]._tsDateAdded` (non-archived) against the install time or the installed file's `_idRow`; IMM does exactly this (max of file `_tsDateModified || _tsDateAdded`, cached 1 hour). Changelog entries: `GET /apiv11/Mod/434773/Updates?_nPage=1&_nPerpage=5` (records with `_sName`, `_tsDateAdded`, `_sText`). Comments: `/Mod/<id>/Posts?_nPage=1&_nPerpage=15&_sSort=popular`.

### 2.6 1-Click install

From GameBanana wiki 1999 ("1-Click Mod Installers", `GET /apiv11/Wiki/1999/ProfilePage`):
- The installer registers a custom URL scheme in the Windows registry. Link format is `schema:[URL_TO_ARCHIVE]` or `schema:[URL_TO_ARCHIVE],[MOD_TYPE],[MOD_ID]`, agreed with GameBanana per installer.
- GameBanana checks archive compatibility server-side per game and installer before showing the link.
- Authors opt out with an empty `.disable_gb1click` file, or `.disable_gb1click_{protocol}` for one installer.
- Must handle ZIP, RAR and 7z.
- Registration is done with GameBanana staff (the integration is server-side). It is not self-service via the API.

Seen live: per-file `_aFiles[]._aModManagerIntegrations[]._sDownloadUrl` on `apiv13/Mod/<id>/DownloadPage`. Celeste example:
```json
{"_idToolRow":6449,"_sModManagerAlias":"Olympus","_sShortAlias":"mm6449","_sInstallerName":"Olympus - Everest Installer",
 "_sDownloadUrl":"everest:https://gamebanana.com/mmdl/1823799,Mod,424541"}
```
So the format is `<scheme>:https://gamebanana.com/mmdl/<fileId>,Mod,<modId>` (or `,Tool,`). JASM+ parses exactly this with the regex `^(scheme):(https://(gamebanana.com|www.gamebanana.com)/mmdl/(\d+)),(Mod|Tool),(\d+)$`, scheme `jasm-plus`, registered at `HKCU\Software\Classes\jasm-plus` (default "URL:JASM+ 1-Click Installer", `URL Protocol` = "", `shell\open\command` = `"<exe>" "%1"`).

For the XXMI games, `apiv13/Mod/<id>/DownloadPage` lists `_aSupportedModManagers`:
- gi, hsr, ww, ef: `IntegratedModManager` (tool 21814, short alias mm21814) and `JasmPlus` (tool 23546, mm23546).
- zzz: the same two plus `FairysSecretFolder` (tool 24086, the-sea-man/ZZZ-Mod-Hub).
- hi3: none.
The page shows a "1-Click Install: This game supports 1-click mod installation via..." box. But for guests, none of the 10 newest mods per XXMI game, nor the top GI mod, had per-file `_aModManagerIntegrations` (Celeste did). It is UNCONFIRMED whether the per-file links only appear when logged in or depend on archive checks. XXMI Launcher itself registers no scheme and has no GameBanana integration. IMM registers `imm` and `wwmm` (tauri deep-link). Its handler accepts `imm://<host/path>` with an optional `/dl/<fileId>` suffix, `/game/<gbGameId>/` and `imm://mode/<game>`. Exactly what GameBanana emits for IMM is UNCONFIRMED.

GameBanana also has a newer "Remote Install" flow in its frontend (`Download.js`). It uses `POST RemoteInstall/Enroll/<alias>` (returns `_sPairingCommand`, a link to pair with the manager) and `POST RemoteInstall/<fileId>/<alias>`, shown when `_bSupportsRemoteInstall` is set. These need a logged-in user; the details are UNCONFIRMED.

### 2.7 Images

- Mod screenshots: `_sBaseUrl` + `/` + file, e.g. `https://images.gamebanana.com/img/ss/mods/64243ee03d888.jpg` (full).
- Sizes: `100-90_<file>`, `220-90_<file>`, `530-90_<file>`, `800-90_<file>` (keys `_sFile100/220/530/800` with `_w/_h` values). Only the first image usually has all sizes; the rest often only have `_sFile100`.
- Tools use `/img/ss/tools`. Category icons are `https://images.gamebanana.com/img/ico/ModCategory/<file>` (useful as character portraits). Game icons/banners are `/img/ico/games/`, `/img/banners/games/`.
- Embeddable banners: `https://gamebanana.com/mods/embeddables/<id>` with variants listed in `_aEmbeddables._aVariants`.

---

## 3. XXMI Launcher

### CLI (core/application.py argparse, `parse_known_args`, `&&` args filtered)

| flag | meaning |
|---|---|
| `exe_path` (positional) | Path to game .exe. If given without `--xxmi`, importer is detected from the path, its `game_folder` is set, and `--nogui` is forced |
| `-x`, `--xxmi <CODE>` | Set active importer (WWMI/ZZMI/SRMI/GIMI/HIMI/EFMI) |
| `-n`, `--nogui` | Start game with active importer without the launcher window |
| `-u`, `--update` | Force update check and install |
| `-s`, `--create_shortcut <str>` | Create desktop shortcut |
| `-un`, `--uninstall` | Remove downloaded packages from Resources |
| `-su`, `--silent_update` | Install updates without confirmation |
| `-h`, `--help`, `-help` | Help |

The launcher's own desktop shortcut runs `"XXMI Launcher.exe" --nogui --xxmi <CODE>` with working dir `<root>\Resources\Bin`. So `"%APPDATA%\XXMI Launcher\Resources\Bin\XXMI Launcher.exe" --nogui --xxmi ZZMI` is confirmed.

### Paths

- MSI "Quick Installation" default root: `%AppData%\XXMI Launcher` (README). Portable zip can be anywhere.
- Exe: `<root>\Resources\Bin\XXMI Launcher.exe` (root = exe's parent's parent's parent, per app.py).
- Config: `<root>\XXMI Launcher Config.json`. Other root folders: `Resources`, `Themes`, `Backups`, `Locale`.
- Importer folder: `Importers.<CODE>.Importer.importer_folder` (default `GIMI/` etc.), relative to root unless absolute. So mods are in `<root>\<CODE>\Mods`, d3dx.ini is `<root>\<CODE>\d3dx.ini`, persisted vars are `<root>\<CODE>\d3dx_user.ini`, and the importer core is `<root>\<CODE>\Core\<CODE>\main.ini`.

### Config JSON keys

Top level: `Launcher`, `Packages`, `Importers`, `Security`.
- `Launcher`: `active_importer` (default "XXMI"), `enabled_importers` (list), `auto_update`, `auto_close`, `start_timeout`, `gui_theme`, `theme_mode`, `locale`, `log_level`, `proxy`, `nogui_context`, etc.
- `Importers.<CODE>`: `Importer` and `Migoto` objects.
- `Importers.<CODE>.Importer`: `game_folder`, `launcher_folder` (EFMI), `importer_folder`, `launch_options`, `use_launch_options`, `game_launch` (Direct/Steam/Epic Games/Custom/Manual), `start_method`, `xxmi_dll_inject_mode`, `xxmi_dll_init_delay`, `process_priority`, `process_timeout`, `window_mode`, `custom_launch`, `run_pre_launch*`, `run_post_load*`, `extra_libraries*`, `d3dx_ini` (overrides written into d3dx.ini), `configure_game`, `game_exe_names`, `game_folder_names`, `game_folder_children`, `process_exe_names`, `game_process_exe`, `d3d11_mode_cmd_args`, `shortcut_deployed`, `launch_count`. GIMI also has `unlock_fps`, `unlock_fps_value`, `disable_dcr`, `enable_hdr`. `disable_dcr` (GIMI, HIMI) is a leftover XXMI no longer reads: `configure_game` (acted on by GIMI, WWMI and ZZMI only) turns dynamic character resolution off for GI. `enforce_rendering` writes per-importer [Rendering] keys (`texture_hash` and `track_texture_updates` are 1 for WWMI, 0 for the rest). Migoto `log_level` is DISABLED, WARNING, INFO or DEBUG.

### Disabled mods convention

GIMI-Package and ZZMI-Package d3dx.ini:
```
[Include]
include = Core\GIMI\main.ini
include_recursive = Mods
exclude_recursive = DISABLED*
exclude_recursive = desktop.ini
```
In 3DMigoto `exclude_recursive` globs are converted with PCRE2 `PCRE2_CONVERT_GLOB` and compiled with `PCRE2_CASELESS`, so matching is case-insensitive. They are tested against each directory entry's name (file or folder) at every level, so `disabled_foo`, `DISABLED foo`, `DisabledX` folders and `DISABLED_x.ini` files are all skipped. Only files ending in exactly `.ini` (case-sensitive `wcscmp`) are loaded. Entries are sorted case-insensitively and ini files are processed before subfolders. XXMI's own mod optimizer reads the same patterns (default `DISABLED*`).

### Mod ini key bindings and variables (parser spec)

- Any section whose name starts with `Key` (prefix match, case-insensitive; e.g. `[KeySwap]`, `[KeyToggleCoat]`, `[Key1]`) is a binding.
- `key = <binding>` (repeatable; multiple `key` lines allowed) and `back = <binding>` (repeatable, only meaningful for cycle). A section with neither is ignored.
- A binding is a space-separated list. Single chars A-Z and 0-9 are allowed. Otherwise VK names with or without `VK_` (e.g. `VK_DOWN`, `DOWN`, `F6`) or hex codes. Modifier/negation tokens: `ctrl`, `alt`, `shift`, `windows`, `no_ctrl`, `no_alt`, `no_shift`, `no_windows`, `no_modifiers`. XInput: `XB_A`, `XB_LEFT_SHOULDER`, etc., optionally `XB2_...` for pad 2.
- `type = activate | hold | toggle | cycle` (default activate).
- Optional: `condition = <expr>` (common: `$active == 1`), `run = CommandList...`, `delay`, `release_delay`, `transition`, `release_transition`, `transition_type`, `release_transition_type` (linear/cosine), `wrap` (cycle, default true), `smart` (cycle, default true).
- Every other `$name = v1,v2,...` line is a variable assignment list. For cycle, the comma list is the sequence of values (blank entry = leave unchanged). For toggle/hold, one value is applied on press and reverted on release/second press.
- Variables are declared in `[Constants]`: `global $name = 0`, `global persist $name = 0` (persist = saved to d3dx_user.ini). Also IniParams `x`, `y`, `z`, `w`, `x1`... Values are floats.
- Variable names inside a mod ini are namespaced by the ini path. The full name is `$\` + namespace + `\` + name without `$`, lowercased. The namespace is the ini's path relative to the importer folder, e.g. `mods\furina\furina.ini`. If the ini declares `namespace = something` at the top, that string is used instead (e.g. XXMI core uses `$\wwmiv1\first_run`).
- Typical mod pattern:
```
[Constants]
global persist $swapvar = 0
global $active
[Present]
post $active = 0
[KeySwap]
condition = $active == 1
key = VK_DOWN
back = VK_UP
type = cycle
$swapvar = 0,1,2
```

d3dx_user.ini (written by 3DMigoto on exit, on F10 reload, and every `settings_auto_save_interval` seconds (60 in GIMI d3dx.ini); Ctrl+Alt+F10 `wipe_user_config` deletes it):
```
; AUTOMATICALLY GENERATED FILE - DO NOT EDIT
; ...
[Constants]
$\mods\furina\furina.ini\swapvar = 1
$\debugger\show_debug_output = 0
```
Each line is `<lowercased namespaced name> = <value printed with %.9g>`. The file is rewritten in full (only currently known persistent vars). Unknown entries trigger a warning and are dropped on the next save. It is read after all includes, so editing it while the game is closed (or before an F10) sets the values. Renaming or moving a mod folder changes the namespace and orphans its saved values; IMM rewrites these paths when it moves mods.

### Hot reload

- d3dx.ini: `reload_config = no_modifiers VK_F10` (also `reload_fixes`), and `check_foreground_window = 1`, so keys are only processed while the game window is in front.
- 3DMigoto has no IPC or file watcher for reloads (none found in source). The only external trigger is a synthetic key press. IMM watches the foreground window (title/process match). When the game gets focus and changes are pending, it sends F10 with `keybd_event(VK_F10, MapVirtualKey(VK_F10, MAPVK_VK_TO_VSC), ...)` down/up. An alternative mode briefly focuses the IMM window, sends F10, then restores the game (credited to "No Reload Mod Manager" by agulag). Game window titles IMM matches: "wuthering waves", "zenlesszonezero", "genshin impact", "honkai: star rail", "Endfield".
- `skip_early_includes_load = 1`, `config_initialization_delay = 0`: mods load on the first frame, not at DLL init.

---

## 4. Integrated Mod Manager (IMM)

- Repo: github.com/jpbhatt21/integrated-mod-manager (TypeScript + Tauri/Rust, 98 stars, last push 2026-09-21, no license file). GameBanana: tool 21814 (WW page has the installer, v4.0.0 setup exe), 21941 (HSR), 21942 (EF), mod page 593490. Author "yourbadluck". Previously "WuWa Mod Manager". Windows + Linux (deb/rpm/AppImage/flatpak).
- Games: WW, ZZZ, GI, HSR, EF (not HI3).
- Storage model: all mods live in `Mods\DISABLED - ALL MODS ARE STORED HERE (Managed by IMM)` (skipped by 3DMigoto), and enabled mods are symlinked into `Mods\DO NOT MODIFY (Managed by IMM)`. It backs up `d3dx_user.ini` to `d3dx_user_pre_imm.ini.bak` and rewrites namespaced var paths when moving mods.
- Features (from ReadMe / GB page / source):
  - Scans the Mods folder, groups mods by category/character (uses GB category ids from `gameData.json`), one-click enable/disable, delete.
  - Presets (batch toggle sets), with global hotkeys to switch presets in game.
  - Preview images per mod (downloaded with the mod or user-set), local image server.
  - Filter by enabled/disabled/character, search by name/category.
  - Conflict detection and resolution (same-hash mods).
  - Restore points (backup/restore mod state).
  - Online mode: browse GameBanana (Subfeed home, category lists, search, mod details, comments, update log), download queue with progress/history, auto-extract (bundled 7z), install with preview.
  - Update tracking: marks installed mods with a newer file than the install/view time (1-hour cache).
  - Paste a GameBanana link anywhere to open it; deep links `imm://` / `wwmm://`.
  - Auto reload (F10 injection, above), NSFW filter for online browsing, auto-launch game via XXMI, settings import/export, self-updater, tutorials.
  - "Edit mod config / edit mod info" tutorials exist; whether it edits KeySwap variables in d3dx_user.ini is UNCONFIRMED.
- Other managers listed for these games on GB: JASM+ (zurce/JASM, WinUI 3, GI/HSR/WW/ZZZ/EF, 1-click `jasm-plus:`), Fairy's Secret Folder (ZZZ, 1-click, in-game menu), XX Mod Manager (18601), No Reload Mod Manager (19862/19863/19876/21978), FlairX Mod Manager (20491), EMMM.V2, ARG Mod Manager, Mod Manager Pro, ModDeck (EF in-game overlay).
