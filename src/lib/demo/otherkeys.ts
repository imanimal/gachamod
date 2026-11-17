// Demo handlers for other apps' keys (lib/api/otherkeys.ts): a made-up Medal that takes a screenshot on F7 and saves
// a clip on F8, checked against the demo's skin menu keys. Its keys can be changed like the real Medal's, and it
// counts as closed. Owner: INGAME area.
import type { AppKeyChange, AppKeyClash, AppKeyMove, LiveInfo } from "../api";
import { call, registerDemo } from "../tauri";
import { demoDb, demoWait } from "./db";

const fail = (message: string) => { throw { kind: "invalid", message }; };
const OTHERS = [
  { appId: "medal", app: "Medal", does: "takes a screenshot", key: "F7" },
  { appId: "medal", app: "Medal", does: "saves a clip", key: "F8" },
];
/** The mod loaders' own keys, then free keys in the order they're offered (otherkeys.rs). */
const LOADER_KEYS = ["F6", "F10", "F12"];
const FREE = ["F9", "F11", "F8", "Ctrl+F9", "Ctrl+F8", "Ctrl+F7", "Ctrl+Alt+F9", "Ctrl+Alt+F8", "Ctrl+Alt+F7"];
const NEEDS = "Medal has to be closed first. Quit it from its tray icon";
const kept = new Set<string>();
/** How often a toast asked about each clash (three times at most). */
const asked = new Map<string, number>();

const menus = () => Promise.all(demoDb.games.map(async (g) => ({ game: g.id, name: g.name, info: await call<LiveInfo>("live_info", { game: g.id }) })));
const usedKeys = (games: Awaited<ReturnType<typeof menus>>) => new Set([...LOADER_KEYS, ...OTHERS.map((o) => o.key), ...games.map((g) => g.info.menu.key)]);

async function clashes(): Promise<AppKeyClash[]> {
  const games = await menus();
  const used = usedKeys(games);
  const out: AppKeyClash[] = [];
  for (const o of OTHERS) {
    const hit = games.filter((g) => g.info.groups.length > 0 && g.info.menu.key === o.key);
    const id = `${o.appId}|${o.key}`;
    if (!hit.length || kept.has(id)) continue;
    const suggestion = FREE.find((k) => !used.has(k)) ?? null;
    if (suggestion) used.add(suggestion);
    // the other app only gets a bare F key
    const otherKey = suggestion && /^F\d+$/.test(suggestion) ? suggestion : null;
    const said = `${o.app} ${o.does} on ${o.key}`;
    out.push({
      id, app: o.app, appId: o.appId, does: o.does, key: o.key, byDefault: false,
      menuGames: hit.map((g) => g.game), keyListGames: [], profile: false, suggestion, otherKey, otherNeeds: otherKey ? NEEDS : null,
      text: `${said}.`, ask: `${said}, the key that opens the skin menu${hit.length === 1 ? ` in ${hit[0]!.name}` : ""}.`,
    });
  }
  return out;
}

export function registerOtherKeysDemo() {
  registerDemo({
    otherkeys_clashes: async () => { await demoWait(80); return clashes(); },
    otherkeys_ask: async () => {
      if (demoDb.settings.get("otherKeys.ask") === "0") return [];
      const ask = (await clashes()).filter((c) => (asked.get(c.id) ?? 0) < 3);
      ask.forEach((c) => asked.set(c.id, (asked.get(c.id) ?? 0) + 1));
      return ask;
    },
    otherkeys_move: async ({ from, to }): Promise<AppKeyMove> => {
      await demoWait(120);
      const games = await menus();
      const out: AppKeyMove = { from: String(from), to: String(to), menuGames: [], keyListGames: [], text: "" };
      if (games.some((g) => g.info.menu.key === out.to)) fail(`${out.to} is already one of gachamod's keys. Pick another key`);
      for (const g of games.filter((x) => x.info.menu.key === out.from)) {
        await call("live_menu_set", { game: g.game, menu: { ...g.info.menu, key: out.to } });
        out.menuGames.push(g.game);
      }
      out.text = out.menuGames.length ? `The skin menu opens with ${out.to} now` : `None of gachamod's keys was ${out.from}`;
      return out;
    },
    otherkeys_change: async ({ appId, from, to, undo }): Promise<AppKeyChange> => {
      await demoWait(120);
      const theirs = OTHERS.find((o) => o.appId === String(appId) && o.key === String(from));
      if (!theirs) return fail(`No app uses ${String(from)} any more`);
      if (!undo && (!/^F\d+$/.test(String(to)) || usedKeys(await menus()).has(String(to)))) fail(`${String(to)} is already in use. Pick another key`);
      theirs.key = String(to);
      return { app: theirs.app, appId: theirs.appId, from: String(from), to: theirs.key, text: `${theirs.app} ${theirs.does} on ${theirs.key} now` };
    },
    otherkeys_keep: ({ appId, key, on }) => {
      const id = `${String(appId)}|${String(key)}`;
      if (on) kept.add(id); else kept.delete(id);
    },
  });
}
