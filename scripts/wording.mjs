// Wording that reads like a template or a sales page, for text people read: release notes (scripts/release.mjs
// refuses to publish with any) and the app's own text (src/lib/i18n/wording.test.ts). Say what a thing does, plainly.
// A theme doesn't "wear" anything and an installer doesn't "get" an app: "starts in that game's theme".
//
//   node scripts/wording.mjs <file>...    lists the problems in each file

import { readFileSync } from "node:fs";

/** [pattern, why]. Patterns are matched case-insensitively against the text. */
export const WORDING = [
  [/—/, "em dash: use a period, comma, colon or parentheses"],
  // dressing things up as people or clothes
  // (a character wears a skin, which is fine; an app, a file or a page wearing a theme isn't)
  [/\bwear(s|ing)?\b[^.]{0,30}\b(theme|look|style|colou?rs?|branding)\b/, "\"wears\": say what it shows (\"starts in that game's theme\")"],
  [/\bdress(es|ed)? (up|in)\b/, "\"dressed in\": say what it shows"],
  [/\b(comes? alive|brings? .{1,30} to life|breathes? (new )?life)\b/, "figurative: say what changes"],
  [/\bfeels? (right )?at home\b/, "figurative: say what it does"],
  [/\b(magic(al|ally)?|sparkl\w*|delight(ful|s)?)\b/, "hype word"],
  // stock words
  [/\b(delve|seamless(ly)?|effortless(ly)?|elevat(e|es|ed|ing)|empower\w*|robust|leverag\w+|streamlin\w+|supercharg\w+|game-?changer|cutting-edge|revolutioni[sz]\w*|pivotal|tapestry|crucial|calmer)\b/, "stock word"],
  [/\b(unlock(s|ed|ing)? (the|your|new|more|a)\b)/, "\"unlock\" as hype: say what it adds"],
  [/\b(your|the|a) journey\b/, "\"journey\": say what happens"],
  [/\bembrac(e|es|ed|ing)\b/, "stock word"],
  [/\bnavigat(e|es|ing) (the|your|any) (complex|tricky|world|maze)/, "\"navigate\" meaning deal with"],
  // stock phrases
  [/\bwhether you'?re\b/, "\"Whether you're X or Y\""],
  [/\bsay goodbye to\b/, "\"Say goodbye to\""],
  [/\bit'?s not just\b/, "\"It's not just X, it's Y\""],
  [/(^|[.!?]\s+)imagine\b/, "\"Imagine...\""],
  [/\bit'?s (important|worth) (to note|noting)\b/, "filler"],
  [/\bat its (core|heart)\b/, "filler"],
  [/(^|[.!?]\s+)ultimately\b/, "filler"],
  [/\bin today'?s (world|age)\b/, "filler"],
  [/\b(designed|built) (to|for) (make|give|help|people|you|those|anyone|gamers|players)\b/, "\"Designed to / Built for\""],
  [/\blook no further\b/, "\"Look no further\""],
  [/\b(hassle-free|a breeze|with ease|like never before|next level|best-in-class|world-class)\b/, "hype phrase"],
  [/\b(makes|making) a real difference\b|\breal (work|problems|difference)\b/, "filler \"real\""],
];

/** Each problem as "<the words>: <why>". */
export function wordingProblems(text) {
  const out = [];
  for (const [re, why] of WORDING) {
    const m = new RegExp(re.source, "i").exec(text);
    if (m) out.push(`"${m[0].trim()}": ${why}`);
  }
  return out;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll("\\", "/").split("/").pop())) {
  let bad = 0;
  for (const f of process.argv.slice(2)) {
    for (const p of wordingProblems(readFileSync(f, "utf8"))) { console.log(`${f}: ${p}`); bad++; }
  }
  process.exit(bad ? 1 : 0);
}
