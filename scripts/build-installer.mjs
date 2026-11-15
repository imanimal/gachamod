// Builds the Windows installer into target/release/bundle/nsis. Folders of the build machine under the user's home are
// written as "~" inside the program (panic messages name source files), so the installer carries no user folder
// names. GACHAMOD_POSTHOG_KEY (and GACHAMOD_POSTHOG_HOST for PostHog's EU server) come from the environment or from a
// .env file at the repo root (git ignores it). Without the key the build sends no usage counts, crash reports,
// feedback or game checks.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const fromFile = {};
try {
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
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
const r = spawnSync("npx", ["tauri", "build"], {
  stdio: "inherit",
  shell: true,
  env: { ...env, RUSTFLAGS: "", CARGO_ENCODED_RUSTFLAGS: flags.join("\x1f") },
});
process.exit(r.status ?? 1);
