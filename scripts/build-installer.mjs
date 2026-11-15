// Builds the Windows installer. Folders of the build machine under the user's home are written as "~" inside the
// programs (panic messages name source files), so nothing it makes carries user folder names. GACHAMOD_POSTHOG_KEY
// (and GACHAMOD_POSTHOG_HOST for PostHog's EU server) come from the environment or from a .env file at the repo root
// (git ignores it). Without the key the build sends no usage counts, crash reports, feedback or game checks. The update
// files (the installer's .sig) are signed with %USERPROFILE%\.tauri\gachamod.key or TAURI_SIGNING_PRIVATE_KEY; without
// either the installer is built unsigned and can't be released as an update.
//
// It makes:
//   target/release/bundle/nsis/gachamod_<version>_x64-setup.exe   NSIS's installer, which updates run
//   target/release/bundle/setup/gachamod-setup.exe                 what people download: gachamod setup (src-setup)
//                                                                  with that installer inside (src-setup/src/payload.rs)
//   target/release/bundle/setup/gachamod-setup-<game>.exe          the same file, named so it opens in a game's theme
// The NSIS installer also puts setup.exe next to gachamod for repair and uninstall (src-tauri/windows/hooks.nsh).
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const at = (p) => join(root, p);

const fromFile = {};
try {
  for (const line of readFileSync(at(".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(GACHAMOD_[A-Z_]+)\s*=\s*"?([^"#]*?)"?\s*$/);
    if (m) fromFile[m[1]] = m[2];
  }
} catch { /* no .env */ }
const env = { ...fromFile, ...process.env };

const home = env.USERPROFILE ?? env.HOME ?? "";
// CARGO_ENCODED_RUSTFLAGS keeps a folder name with spaces in one piece (its flags are split by 0x1f)
const flags = [env.RUSTFLAGS, home && `--remap-path-prefix=${home}=~`].filter(Boolean);
if (!env.GACHAMOD_POSTHOG_KEY) console.warn("GACHAMOD_POSTHOG_KEY isn't set: this build sends nothing to PostHog.");
else console.log(`Sending to PostHog at ${env.GACHAMOD_POSTHOG_HOST || "https://us.i.posthog.com"}.`);
const keyFile = join(homedir(), ".tauri", "gachamod.key");
const tauriArgs = ["tauri", "build"];
if (!env.TAURI_SIGNING_PRIVATE_KEY && existsSync(keyFile)) env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(keyFile, "utf8").trim();
if (env.TAURI_SIGNING_PRIVATE_KEY) env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ??= "";
else {
  console.warn(`No update signing key (${keyFile}): building without update files.`);
  // a config file rather than JSON on the command line, which the shell would mangle
  mkdirSync(at("target"), { recursive: true });
  writeFileSync(at("target/unsigned.conf.json"), JSON.stringify({ bundle: { createUpdaterArtifacts: false } }));
  tauriArgs.push("--config", "target/unsigned.conf.json");
}
const buildEnv = { ...env, RUSTFLAGS: "", CARGO_ENCODED_RUSTFLAGS: flags.join("\x1f") };
const run = (cmd, args) => spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: true, env: buildEnv }).status ?? 1;
const stop = (text, code = 1) => { console.error(text); process.exit(code); };

// ── gachamod setup ──

console.log("Building gachamod setup.");
if (run("npm", ["run", "build:setup"]) !== 0) stop("The setup window's page didn't build.");
if (run("cargo", ["build", "--profile", "setup", "-p", "gachamod-setup", "--features", "custom-protocol"]) !== 0) stop("gachamod setup didn't build.");
const setupExe = at("target/setup/gachamod-setup.exe");
// hooks.nsh packs this file in while it exists, so a plain `tauri build` later doesn't pick up an old one
const forNsis = at("target/gachamod-setup/setup.exe");
mkdirSync(at("target/gachamod-setup"), { recursive: true });
copyFileSync(setupExe, forNsis);

// ── gachamod and its NSIS installer ──

const status = run("npx", tauriArgs);
rmSync(forNsis, { force: true });
if (status !== 0) process.exit(status);

// ── the download: setup with the installer inside ──

const version = JSON.parse(readFileSync(at("src-tauri/tauri.conf.json"), "utf8")).version;
const nsisFile = at(`target/release/bundle/nsis/gachamod_${version}_x64-setup.exe`);
if (!existsSync(nsisFile)) stop(`tauri build didn't make ${nsisFile}.`);
const nsis = readFileSync(nsisFile);
const meta = Buffer.from(JSON.stringify({ version, appSize: statSync(at("target/release/gachamod.exe")).size }));
const trailer = Buffer.alloc(24);
trailer.writeBigUInt64LE(BigInt(meta.length), 0);
trailer.writeBigUInt64LE(BigInt(nsis.length), 8);
trailer.write("GMSETUP1", 16, "ascii");
const download = Buffer.concat([readFileSync(setupExe), nsis, meta, trailer]);

const out = at("target/release/bundle/setup");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
// src-setup/src/look.rs reads the game from the file name. scripts/release.mjs uploads every file in this folder.
const THEMED = ["genshin", "starrail", "zzz", "wuwa", "endfield"];
for (const name of ["gachamod-setup.exe", ...THEMED.map((g) => `gachamod-setup-${g}.exe`)]) writeFileSync(join(out, name), download);
console.log(`\nMade ${join(out, "gachamod-setup.exe")} (${(download.length / 1048576).toFixed(1)} MB) and a copy for each of ${THEMED.join(", ")}.`);
