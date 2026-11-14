# gachamod extensions

Themes and extensions for [gachamod](https://github.com/imanimal/gachamod). gachamod reads `index.json` from this
repo and lists everything in it under Extensions, where one click installs a package.

## Sending one in

Make the package in gachamod (Extensions, More, Share a package; for a theme, Settings, Custom themes, Share), then
[open a submission](https://github.com/imanimal/gachamod-extensions/issues/new?template=submit.yml) and attach the
zip. A pull request that adds a folder under `packages/` works too.

Extensions run code inside gachamod, so every package is read before it's listed. A package's permissions say what
it can reach (your mods, a folder, a website), and gachamod shows them before you install.

## How the repo works

- `packages/<id>/` holds each package as plain files, with `extension.json` at the top.
- On every push, `tools/build_index.py` zips each package into `dist/` and writes `index.json` with each zip's
  SHA-256. gachamod refuses a download that doesn't match.
- Pull requests only run the checks (`python tools/build_index.py --check`).

The package format and the page API are in gachamod's
[docs/extensions.md](https://github.com/imanimal/gachamod/blob/main/docs/extensions.md).
