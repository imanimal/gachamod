// Mod of the day: add a pick to curated/mod-of-the-day.json, or switch the feature on or off.
// Commit and push the file afterwards; the app reads it from the main branch within 12 hours.
//
//   node scripts/motd.mjs <gamebanana mod link or id> <game> [YYYY-MM-DD] [note]
//   node scripts/motd.mjs on | off
//
// <game> is the app's id: gi, hsr, zzz, ww, ef (and the community games' ids). The date defaults to today.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const file = fileURLToPath(new URL("../curated/mod-of-the-day.json", import.meta.url));
const feed = JSON.parse(readFileSync(file, "utf8"));
const [what, game, date, ...note] = process.argv.slice(2);
const save = () => writeFileSync(file, JSON.stringify(feed, null, 2) + "\n");

if (what === "on" || what === "off") {
  feed.enabled = what === "on";
  save();
  console.log(`Mod of the day is ${what}. Commit and push to publish it.`);
  process.exit(0);
}

const modId = Number((what ?? "").match(/(\d+)\/?$/)?.[1]);
if (!Number.isInteger(modId) || !game) {
  console.error("Usage: node scripts/motd.mjs <gamebanana mod link or id> <game> [YYYY-MM-DD] [note]   or   on | off");
  process.exit(1);
}
const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toLocaleDateString("en-CA");
const extra = date && !/^\d{4}-\d{2}-\d{2}$/.test(date) ? [date, ...note] : note;

let name;
try {
  const r = await fetch(`https://gamebanana.com/apiv11/Mod/${modId}?_csvProperties=_sName`);
  if (r.ok) name = (await r.json())._sName;
} catch { /* the name is only for the button's tip */ }

feed.picks = feed.picks.filter((p) => !(p.date === day && p.game === game));
feed.picks.push({ date: day, game, modId, ...(name ? { name } : {}), ...(extra.length ? { note: extra.join(" ") } : {}) });
feed.picks.sort((a, b) => a.date.localeCompare(b.date) || a.game.localeCompare(b.game));
// keep the file small: the last 60 days
const cutoff = new Date(Date.now() - 60 * 86400_000).toLocaleDateString("en-CA");
feed.picks = feed.picks.filter((p) => p.date >= cutoff);
save();
console.log(`${day}, ${game}: ${name ?? `mod ${modId}`}${feed.enabled ? "" : ". The feature is off; run with \"on\" to show it"}. Commit and push to publish it.`);
