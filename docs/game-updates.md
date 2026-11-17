# When a game gets a new version

What to do when someone says "gachamod needs updating for ZZZ 3.4" (or any game and version). The goal is a release
where mods the update broke show up as broken in Tools > Fixes and as many as possible get fixed in one click.

`docs/fixers.md` has the details on every fixer, the JSON format and the upstream feeds. This file is the order to do
things in. Work on a new `animal/` branch.

## 1. Find out what changed

Search before touching any data. Useful searches, with the game's short name and version:

- GameBanana tools for the game, newest first (ids in fixers.md, Finding new fixers):
  `https://gamebanana.com/apiv11/Tool/Index?_nPage=1&_nPerpage=50&_aFilters[Generic_Game]=<id>&_sSort=Generic_Newest`.
  Anything posted since the update with fix, hash, remap, repair, update or convert in the name. Open each one's
  `Tool/<id>/ProfilePage` and read the description and file names.
- GameBanana mods and threads posted in the days after the update that say "fixed for <version>": their update
  notes often list which characters broke.
- GitHub: the repos in fixers.md "Upstream" for that game (new commits, new release tags), plus a search for
  `<game> mod fix <version>`, `<game> hash <version>` and, for the HoYoverse games, `<game short> hash变动 <version>`
  and `<version> 修复`. Chinese modders often post the hash log first.
- The importer: the model importer's GitHub repo (`leotorrez/ZZMI-Package`, `SpectrumQT/WWMI-Package`, the list is in
  `crates/gacha-core/src/xxmi_setup.rs`) and `SpectrumQT/XXMI-Launcher`. A game update sometimes needs a new importer
  before any mod loads at all. Its release notes say so.
- The asset repos (`*-Model-Importer-Assets`): a commit that changes `PlayerCharacterData/<Char>/hash.json` after the
  update date is a hash change, and diffing that file gives old and new hashes even when no fixer exists yet.

Write down, per source: what it covers, its licence, and the date checked. Discord servers (AGMG and others) can't be
read, so if everything points there, say so in the report.

## 2. Update the importer side if needed

If the importer or XXMI Launcher has a release for the new version, check that gachamod's XXMI setup still installs
and updates it (`xxmi_setup.rs`, `xxmi.rs`). A changed config key or package layout needs a code change here. If
nothing changed, skip this.

## 3. Add the hash data

Data lives in `crates/gacha-core/data/fixes/<game>.json` and is compiled into the app, so changes only reach users
in a release.

- Add a `versions[]` block for the new version and source: `{version, source, hashes[], rules[]}`.
- Each hash: `old`, `new` (8 lowercase hex), `character`, `part`, `kind`, `from` (the version the old hash belonged
  to). Mark `current: true` when the new hash is in the source's live table.
- Set `current_version` to the new version and `generated` to today.
- Add the source to `sources[]` if it's new, with `license`, `checked` and `used`.
- A model rebuilt so that no swap can repair it (parts split or merged, mesh redone) gets a `model_change` rule with
  `trigger_hash` (old hashes that only the old model has) and `tool` (the fixer that comes closest). Those mods show
  "Needs its author".
- A change that needs a buffer rewrite gets a rule with `tool` set to the fixer that does it, so Fix downloads and
  runs that fixer.
- Licences: hashes and rule parameters are facts, so they can come from MIT or GPL tools (credit them in `sources[]`).
  Don't copy GPL files or code: gachamod is CC BY-ND, and GPL material can't go into it. CC BY-NC-ND fixers can't be
  copied either: only link them in `tool`, and gachamod downloads and runs the author's own file.
- Run into the same old hash going to two different new hashes? Add it to `conflicts[]` with what was chosen.

New characters in the update go in `crates/gacha-core/data/characters/<game>.json` (name as GameBanana spells it,
plus `aka`).

## 4. Check it

- `cargo test -p gacha-core`. Add a test in `fixes.rs` for one new pair and, if there is one, the new model change
  rule (the existing tests show the shape).
- `cargo check`, `npx tsc --noEmit`, `npm run build`.
- If a real mod broken by the update is around (or one can be downloaded from GameBanana), put it in the Mods folder
  and look at Tools > Fixes in `npm run app`: it should be listed with the right reason, and Fix should either swap
  the hashes or run the named fixer. Note in `docs/testing.md` what was and wasn't tried.

## 5. Update the docs

In `docs/fixers.md`: the game's "Newest game version in the data", the pair counts, new fixers in the table with
link, licence and status, the checked date at the top, and anything still missing under Gaps.

## 6. Report and release

Tell the user, in a few lines: which characters and parts changed, how many pairs were added, which fixers are new,
and what couldn't be found. Don't release without asking. When they say go, commit and run
`npm run release -- <next version>` (scripts/release.mjs has the details).
