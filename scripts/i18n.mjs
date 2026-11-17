// Checks the translations against the source. Every t("..."), tn(n, "...", "...") and tx("...") in src, plus the
// backend patterns in src/lib/i18n/backend.ts, is a key; each catalog should have every key with the same {names}.
//   node scripts/i18n.mjs                 counts per language, and keys whose {names} don't match
//   node scripts/i18n.mjs --missing ru    writes the missing keys for ru to i18n-missing-ru.json, with where they're used
//                                         (a plural line shows as { where, plural: true, one: "{n} mod" })
//   node scripts/i18n.mjs --unused        lists catalog keys no code uses any more
//   node scripts/i18n.mjs --merge         folds translator batches (src/lib/i18n/parts/<lang>-*.json) into the
//                                         catalogs, then deletes the batches
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(import.meta.dirname, "..");
const dir = join(root, "src", "lib", "i18n");
const LANGS = ["zh-CN", "es", "pt-BR", "ru"];
const SKIP = /[\\/](demo|dev)[\\/]|\.test\.tsx?$|fixtures/;

if (process.argv[2] === "--merge") {
  const parts = join(dir, "parts");
  const files = existsSync(parts) ? readdirSync(parts).filter((f) => f.endsWith(".json")) : [];
  for (const l of LANGS) {
    const mine = files.filter((f) => f.startsWith(`${l}-`)).sort();
    if (!mine.length) continue;
    const path = join(dir, `${l}.json`);
    const cat = JSON.parse(readFileSync(path, "utf8"));
    for (const f of mine) Object.assign(cat, JSON.parse(readFileSync(join(parts, f), "utf8")));
    writeFileSync(path, `${JSON.stringify(cat, null, 1)}
`);
    for (const f of mine) rmSync(join(parts, f));
    console.log(`${l}: merged ${mine.length} batches`);
  }
}

function walk(d, out = []) {
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !SKIP.test(p)) out.push(p);
  }
  return out;
}

const str = String.raw`"((?:[^"\\]|\\.)*)"`;
const unq = (s) => JSON.parse(`"${s}"`);
const keys = new Map(); // key -> [where]
const singular = new Map(); // plural key -> its English singular
const add = (k, where) => { const l = keys.get(k) ?? []; if (l.length < 3) l.push(where); keys.set(k, l); };

for (const file of walk(join(root, "src"))) {
  const text = readFileSync(file, "utf8");
  const rel = relative(root, file).replaceAll("\\", "/");
  const line = (i) => `${rel}:${text.slice(0, i).split("\n").length}`;
  for (const m of text.matchAll(new RegExp(String.raw`\b(?:t|tx)\(\s*${str}`, "g"))) add(unq(m[1]), line(m.index));
  for (const m of text.matchAll(new RegExp(String.raw`\btn\(\s*[^,()]+(?:\([^()]*\))?\s*,\s*${str}\s*,\s*${str}`, "g"))) { add(unq(m[2]), line(m.index)); singular.set(unq(m[2]), unq(m[1])); }
}
const backend = readFileSync(join(dir, "backend.ts"), "utf8");
for (const m of backend.matchAll(new RegExp(String.raw`^\s*${str},?\s*$`, "gm"))) add(unq(m[1]), "backend");

// the set of {names}: a translation may use one twice ("第 {pity} 抽")
const names = (s) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort().join(",");
const args = process.argv.slice(2);
let bad = 0;
for (const l of LANGS) {
  const cat = JSON.parse(readFileSync(join(dir, `${l}.json`), "utf8"));
  const missing = [...keys.keys()].filter((k) => !(k in cat));
  for (const [k, v] of Object.entries(cat)) {
    if (!keys.has(k)) continue;
    for (const form of typeof v === "string" ? [v] : Object.values(v)) {
      const want = names(k), got = names(form);
      // a plural form may leave out {n} ("один мод")
      if (got !== want && got !== want.split(",").filter((x) => x !== "n").join(",")) { bad++; console.log(`${l}: {names} differ for ${JSON.stringify(k)}`); }
    }
  }
  console.log(`${l}: ${keys.size - missing.length} of ${keys.size} translated`);
  if (args[0] === "--missing" && args[1] === l) {
    // a plural line says so and gives its singular: translate it as an object of plural forms
    const out = Object.fromEntries(missing.map((k) => [k, singular.has(k) ? { where: keys.get(k).join(" "), plural: true, one: singular.get(k) } : keys.get(k).join(" ")]));
    writeFileSync(join(root, `i18n-missing-${l}.json`), JSON.stringify(out, null, 1));
    console.log(`wrote i18n-missing-${l}.json (${missing.length} keys)`);
  }
  if (args[0] === "--unused") for (const k of Object.keys(cat)) if (!keys.has(k)) console.log(`${l} unused: ${JSON.stringify(k)}`);
}
process.exit(bad ? 1 : 0);
