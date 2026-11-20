// Publish a release that installed copies update to.
//
//   npm run release                    release the version in src-tauri/tauri.conf.json
//   npm run release -- 0.1.1           set the version to 0.1.1 everywhere, commit it, then release
//   npm run release -- 0.1.1 --notes "Fixed the profile list"
//
// It builds the signed installer and gachamod setup (scripts/build-installer.mjs), writes latest.json, pushes the
// current branch and makes the GitHub release v<version> with them. Installed copies read latest.json from the newest
// release and only install an installer signed with the key in %USERPROFILE%\.tauri\gachamod.key, so keep a copy of
// that key somewhere safe: without it no update can reach installed copies.
//
// Needs a clean working tree and the GitHub CLI (gh) signed in. Without --notes, the notes list the commits since
// the last release.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { wordingProblems } from "./wording.mjs";

const REPO = "imanimal/gachamod";
const root = fileURLToPath(new URL("..", import.meta.url));
const at = (p) => join(root, p);
const keyFile = join(homedir(), ".tauri", "gachamod.key");

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: "utf8", stdio: opts.show ? "inherit" : "pipe", shell: !!opts.shell });
  if (r.status !== 0 && !opts.ok) {
    console.error(`\n${cmd} ${args.join(" ")} failed.${r.stderr ? `\n${r.stderr.trim()}` : ""}`);
    process.exit(1);
  }
  return { ok: r.status === 0, out: (r.stdout ?? "").trim() };
}
const fail = (text) => { console.error(text); process.exit(1); };

// ── arguments ──

const args = process.argv.slice(2);
let bump = null;
let notes = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--notes") notes = args[++i] ?? "";
  else if (/^v?\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(args[i])) bump = args[i].replace(/^v/, "");
  else fail(`Unknown argument "${args[i]}". Usage: npm run release -- [version] [--notes "text"]`);
}

// ── checks before anything changes ──

if (!run("gh", ["auth", "status"], { ok: true }).ok) fail("Sign in to the GitHub CLI first: gh auth login");
if (!process.env.TAURI_SIGNING_PRIVATE_KEY && !existsSync(keyFile)) {
  fail(`The update signing key isn't at ${keyFile}. Releases must be signed with it, or installed copies won't take them.`);
}
if (run("git", ["status", "--porcelain"]).out) fail("Commit or stash your changes first. A release is built from a commit.");
const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]).out;
if (branch !== "main") console.warn(`Releasing from ${branch}, not main.`);

const conf = () => JSON.parse(readFileSync(at("src-tauri/tauri.conf.json"), "utf8"));
const current = conf().version;
const version = bump ?? current;
const tag = `v${version}`;
if (run("gh", ["release", "view", tag, "-R", REPO], { ok: true }).ok) fail(`${tag} is already released. Pass a newer version: npm run release -- <version>`);

// ── notes ──

if (notes === null) {
  const last = run("git", ["describe", "--tags", "--abbrev=0", "--match", "v*"], { ok: true });
  const log = run("git", ["log", "--no-merges", "--format=- %s", ...(last.ok ? [`${last.out}..HEAD`] : [])]).out;
  notes = last.ok && log ? log : "First release.";
}

// the notes go out to everyone who downloads it: plain wording, checked before anything is built
const offNotes = wordingProblems(notes);
if (offNotes.length) fail(`The release notes read like a template. Reword them, or pass --notes:
${offNotes.map((o) => `  ${o}`).join("\n")}`);

// ── version bump ──

function setVersion(v) {
  const edit = (file, from, to) => {
    const text = readFileSync(at(file), "utf8");
    if (!from.test(text)) fail(`Couldn't find the version in ${file}.`);
    writeFileSync(at(file), text.replace(from, to));
  };
  edit("src-tauri/tauri.conf.json", /("version":\s*")[^"]+(")/, `$1${v}$2`);
  edit("package.json", /("version":\s*")[^"]+(")/, `$1${v}$2`);
  edit("Cargo.toml", /(\[workspace\.package\][^[]*?\nversion\s*=\s*")[^"]+(")/, `$1${v}$2`);
  const lock = JSON.parse(readFileSync(at("package-lock.json"), "utf8"));
  lock.version = v;
  if (lock.packages?.[""]) lock.packages[""].version = v;
  writeFileSync(at("package-lock.json"), JSON.stringify(lock, null, 2) + "\n");
}
if (bump && bump !== current) {
  console.log(`Version ${current} -> ${version}`);
  setVersion(version);
}

// ── build ──

console.log(`Building gachamod ${version}. This takes a few minutes.`);
const env = { ...process.env };
if (!env.TAURI_SIGNING_PRIVATE_KEY) env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(keyFile, "utf8").trim();
env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ??= "";
const build = spawnSync("node", [at("scripts/build-installer.mjs")], { cwd: root, stdio: "inherit", env });
if (build.status !== 0) fail("The build failed, so nothing was released. A version change stays in your working tree.");

const dir = at("target/release/bundle/nsis");
const nsis = `gachamod_${version}_x64-setup.exe`;
if (!existsSync(join(dir, nsis)) || !existsSync(join(dir, `${nsis}.sig`))) fail(`The build didn't make ${nsis} and its .sig in ${dir}.`);
const setupDir = at("target/release/bundle/setup");
const setups = existsSync(setupDir) ? readdirSync(setupDir).filter((f) => f.endsWith(".exe")).map((f) => join(setupDir, f)) : [];
if (!setups.some((f) => f.endsWith("gachamod-setup.exe"))) fail(`The build didn't make gachamod-setup.exe in ${setupDir}.`);
const out = at("target/release/bundle/release");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
// NSIS's installer goes up as the update file, so the download people pick is gachamod-setup.exe. The signature
// covers the file's bytes, not its name.
const update = `gachamod_${version}_update.exe`;
copyFileSync(join(dir, nsis), join(out, update));
copyFileSync(join(dir, `${nsis}.sig`), join(out, `${update}.sig`));
const signature = readFileSync(join(out, `${update}.sig`), "utf8").trim();
const url = `https://github.com/${REPO}/releases/download/${tag}/${update}`;
const latest = join(out, "latest.json");
writeFileSync(latest, JSON.stringify({
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: { "windows-x86_64": { signature, url }, "windows-x86_64-nsis": { signature, url } },
}, null, 2) + "\n");

// ── commit, push, publish ──

if (run("git", ["status", "--porcelain"]).out) {
  run("git", ["add", "src-tauri/tauri.conf.json", "package.json", "package-lock.json", "Cargo.toml", "Cargo.lock"]);
  run("git", ["commit", "-m", `Release ${version}`]);
}
run("git", ["push", "origin", "HEAD"], { show: true });
const sha = run("git", ["rev-parse", "HEAD"]).out;

const body = join(out, "notes.md");
writeFileSync(body, `${notes}

Download \`gachamod-setup.exe\` and run it. The installer isn't code-signed, so Windows may say it protected your PC. Click More info, then Run anyway.

The \`gachamod-setup-<game>.exe\` files install the same app. The only difference is that they start in that game's theme with only that game in the sidebar. To see your other games, turn off One-game mode in Settings, Games.

If you already have gachamod, you don't need to download anything. It gets the new version in the background and installs it when you close the app. \`${update}\` is the file it downloads.
`);
const off = wordingProblems(readFileSync(body, "utf8"));
if (off.length) fail(`The release notes read like a template. Reword:\n${off.map((o) => `  ${o}`).join("\n")}`);
run("gh", ["release", "create", tag, ...setups, join(out, update), join(out, `${update}.sig`), latest,
  "-R", REPO, "--target", sha, "--title", `gachamod ${version}`, "--notes-file", body, "--latest"], { show: true });
run("git", ["fetch", "--tags", "origin"], { ok: true });
console.log(`\nReleased https://github.com/${REPO}/releases/tag/${tag}`);
