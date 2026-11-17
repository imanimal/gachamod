// Notes from the backend and toasts often come one per mod with the same wording: "Options for A come back after you
// close the game", "Options for B come back ...". These fold such runs into one line with an Oxford comma, so a
// change to 12 mods says one thing instead of twelve. Notes that only share a word or two stay apart.
// Backend notes are folded in English (toast() translates the folded line by the backend's patterns); oxford() for
// the app's own text lists in the user's language.
import { lang, tn } from "./i18n";

/** "a, b, and c"; past `max` names the rest is counted: "a, b, and 4 more". In the user's language. */
export function oxford(names: string[], max = 8): string {
  if (lang === "en") return englishList(names, max);
  const shown = names.length > max ? names.slice(0, Math.max(1, max - 1)) : names;
  const more = names.length - shown.length;
  const parts = more > 0 ? [...shown, tn(more, "{n} more", "{n} more")] : shown;
  return new Intl.ListFormat(lang, { type: "conjunction" }).format(parts);
}

function englishList(names: string[], max: number): string {
  const shown = names.length > max ? names.slice(0, Math.max(1, max - 1)) : names;
  const parts = names.length > shown.length ? [...shown, `${names.length - shown.length} more`] : shown;
  if (parts.length <= 1) return parts.join("");
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

interface Run { prefix: string; suffix: string; names: string[] }

/** Where two notes stop agreeing from the start and from the end, cut back to whole words. */
function split(a: string, b: string): { prefix: string; suffix: string } | null {
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  // back to the start of the word that differs
  while (p > 0 && !/[\s([]/.test(a[p - 1]!)) p--;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  // forward to the end of the word that differs (keep the punctuation that follows it in the suffix)
  while (s > 0 && !/[\s:,.)\]]/.test(a[a.length - s]!)) s--;
  const prefix = a.slice(0, p), suffix = a.slice(a.length - s);
  const ma = a.slice(p, a.length - s), mb = b.slice(p, b.length - s);
  if (!ma || !mb || ma.length > 70 || mb.length > 70 || /\. /.test(ma) || /\. /.test(mb)) return null;
  // most of the note has to be shared wording, or they aren't the same kind of note
  if (prefix.length + suffix.length < Math.min(a.length, b.length) * 0.45 || prefix.length + suffix.length < 12) return null;
  return { prefix, suffix };
}

/** Fold notes that differ only in one name into one note each. Exact repeats go too. Order is kept. */
export function groupNotes(notes: string[]): string[] {
  const out: Array<string | Run> = [];
  for (const raw of notes) {
    const n = raw.trim().replace(/\.$/, "");
    if (!n) continue;
    let placed = false;
    for (let i = 0; i < out.length && !placed; i++) {
      const o = out[i]!;
      if (typeof o === "string") {
        if (o === n) { placed = true; break; }
        const sp = split(o, n);
        if (sp) {
          out[i] = { ...sp, names: [o.slice(sp.prefix.length, o.length - sp.suffix.length), n.slice(sp.prefix.length, n.length - sp.suffix.length)] };
          placed = true;
        }
      } else if (n.startsWith(o.prefix) && n.endsWith(o.suffix) && n.length > o.prefix.length + o.suffix.length) {
        const name = n.slice(o.prefix.length, n.length - o.suffix.length);
        if (!o.names.includes(name)) o.names.push(name);
        placed = true;
      }
    }
    if (!placed) out.push(n);
  }
  return out.map((o) => (typeof o === "string" ? o : `${o.prefix}${englishList(o.names, 8)}${o.suffix}`));
}

/** Notes as one toast's text. */
export const notesText = (notes: string[]) => groupNotes(notes).join(". ");
