// Turning one mod on while its character already has another mod on that changes the same parts (a hash both
// override, checked by the backend): most skins don't go together, some do. Mods that change other parts (a hair
// recolour next to an outfit) turn on without a question. A small menu by the switch asks which: turn the other off,
// keep both, or make the new one a sub-mod of the other so the question never comes back. The "<game>.oneSkin" setting can answer for good
// ("auto" turns the other off, "0" keeps both; anything else asks), and the menu's last two entries set it.
// Owner: LIBRARY area.
import { library, settings, type GameId, type ModEntry } from "../../lib/api";
import { record } from "../../lib/history";
import { openMenu, type MenuEntry } from "../../ui/ContextMenu";
import { liveCharacterOf } from "../ingame/data";

/** The user's answer. `turnOffOthers` goes to library.setEnabled; `parent` makes the mod a sub-mod of that one. */
export interface OnChoice { turnOffOthers?: boolean; parent?: string }

const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const rootOf = (m: ModEntry) => m.parent || m.id;

/** The other mods that are on for the same character and aren't part of `mod`'s family (its parent, its sub-mods,
 *  the parent's other sub-mods). A sub-mod whose parent is off brings the parent on too, so the parent's character
 *  counts. */
export function overlapping(mod: ModEntry, all: ModEntry[]): ModEntry[] {
  const parent = mod.parent ? all.find((m) => m.id === mod.parent) : undefined;
  const who = mod.character ?? parent?.character;
  if (!who) return [];
  const root = rootOf(mod);
  return all.filter((o) => o.enabled && o.id !== mod.id && rootOf(o) !== root && same(o.character, who));
}

const shown = (el: Element) => el.isConnected && el.getClientRects().length > 0 && el.getBoundingClientRect().width > 0;
const shownOne = (sel: string) => [...document.querySelectorAll(sel)].find(shown) ?? null;

/** Where to show the question for a mod's card: the switch that was just used, or the card's footer on screen (other
 *  screens keep hidden copies of cards). */
export function anchorFor(modId: string): Element | null {
  const sel = `[data-mod="${CSS.escape(modId)}"]`;
  const active = document.activeElement;
  if (active && active.closest(sel) && shown(active)) return active;
  return shownOne(`${sel} .mod-card-foot`) ?? shownOne(sel);
}

/** Stop asking for this game: "auto" swaps outfits from now on, "0" keeps both on. Undo brings the question back. */
async function stopAsking(game: GameId, rule: "auto" | "0") {
  const key = `${game}.oneSkin`;
  const before = await settings.get(key).catch(() => null);
  await settings.set(key, rule).catch(() => {});
  record({
    label: rule === "auto"
      ? "Turning on a mod turns off the other ones of its character without asking now. Settings changes it back"
      : "Mods of one character turn on together without asking now. Settings changes it back",
    undo: async () => { await settings.set(key, before ?? "ask"); },
    redo: async () => { await settings.set(key, rule); },
  });
}

/** The mods on for the same characters as `going` that aren't part of their families, for turning several on at once. */
export function overlappingAll(going: ModEntry[], all: ModEntry[]): ModEntry[] {
  const roots = new Set(going.map(rootOf));
  const seen = new Set<string>();
  return going.flatMap((m) => overlapping(m, all)).filter((o) => !roots.has(rootOf(o)) && !seen.has(o.id) && !!seen.add(o.id));
}

/** Ask before turning mods on when their character has other mods on. Resolves {} when there's nothing to ask, the
 *  answer when there was, or null when the menu closed without one (leave them off). Live skins switch instead, so
 *  they never ask. Shift+click on a switch skips this and keeps the others on. */
export async function askOverlap(game: GameId, mods: ModEntry | ModEntry[], all: ModEntry[], at?: Element | null): Promise<OnChoice | null> {
  const going = (Array.isArray(mods) ? mods : [mods]).filter((m) => !liveCharacterOf(game, m.id));
  if (!going.length) return {};
  const near = overlappingAll(going, all).filter((o) => !liveCharacterOf(game, o.id));
  if (!near.length) return {};
  // of the character's other mods, only the ones that change the same parts count
  const same = await library.overlapping(game, going.map((m) => m.id), near.map((m) => m.id)).catch(() => near.map((m) => m.id));
  const others = near.filter((o) => same.includes(o.id));
  if (!others.length) return {};
  const rule = await settings.get(`${game}.oneSkin`).catch(() => null);
  if (rule === "auto") return { turnOffOthers: true };
  if (rule === "0") return { turnOffOthers: false };

  const mod = going[0]!;
  const many = going.length > 1;
  const whoOf = (m: ModEntry) => m.character ?? all.find((x) => x.id === m.parent)?.character ?? "";
  const names = [...new Set(going.map(whoOf).filter(Boolean))];
  const who = names.length === 1 ? names[0]! : "their characters";
  const one = others.length === 1 ? others[0]! : null;
  const hasSubs = all.some((m) => m.parent === mod.id);
  const anchor = (at && at !== document.body && shown(at) ? at : null)
    ?? anchorFor(mod.id) ?? shownOne(".mod-drawer .drawer-h") ?? { x: innerWidth / 2 - 120, y: innerHeight / 3 };

  return new Promise((resolve) => {
    let done = false;
    const pick = (c: OnChoice | null) => { if (!done) { done = true; resolve(c); } };
    const items: MenuEntry[] = [
      { header: one ? `Another ${who} mod is on` : `${others.length} other ${who} mods are on` },
      { label: one ? `Turn off ${one.name}` : `Turn off the other ${others.length}`, icon: "power",
        title: many ? `Only the ${going.length} you picked stay on for ${who}` : `Only ${mod.name} stays on for ${who}`, onClick: () => pick({ turnOffOthers: true }) },
      { label: one ? "Keep both on" : "Keep them all on", icon: "layers",
        title: "For mods that go together, like a hair recolour and an outfit. Shift+click on a switch does this without asking. If they change the same parts, the Conflict tag shows which one wins",
        onClick: () => pick({ turnOffOthers: false }) },
      one && !many && !hasSubs && { label: `Make it a sub-mod of ${one.name}`, icon: "link",
        title: `For an add-on that goes with ${one.name}. It turns off with ${one.name}, comes back with it, and this question won't come up for the two again`,
        onClick: () => pick({ turnOffOthers: false, parent: rootOf(one) }) },
      "-",
      { label: one ? "Turn off the other and don't ask again" : "Turn off the others and don't ask again", icon: "check",
        title: "From now on turning on a mod turns off the character's other mods that change the same parts, without this question. Settings has it as Another skin already on",
        onClick: () => { void stopAsking(game, "auto"); pick({ turnOffOthers: true }); } },
      { label: one ? "Keep both on and don't ask again" : "Keep them all on and don't ask again", icon: "check",
        title: "From now on a mod turns on next to the others of its character without this question. Settings has it as Another skin already on",
        onClick: () => { void stopAsking(game, "0"); pick({ turnOffOthers: false }); } },
    ];
    // the menu closes before a picked item runs: wait a tick so the pick wins
    openMenu(anchor, items, () => queueMicrotask(() => pick(null)));
  });
}
