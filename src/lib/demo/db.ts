// The demo backend's shared in-memory data, so every area's demo handlers see the same games, mods and profiles
// (an install in ONLINE's demo shows up in LIBRARY's list). Owner: skeleton; areas may add fields and seed data.
import type { Character, GameState, ModEntry, Profile } from "../api";

const game = (g: Partial<GameState> & Pick<GameState, "id" | "name" | "short" | "importer" | "gamebananaId" | "accent">): GameState => ({
  xxmi: g.importer !== "3DMigoto", gbCharacterCategory: null, theme: "default", installed: false, gameDir: null, importerDir: null, modsDir: null,
  viaXxmi: false, importerVersion: null, importerLatest: null, shown: false, running: false, modCount: 0, enabledCount: 0, ...g,
});

const xx = (code: string) => `C:\\Users\\Player\\AppData\\Roaming\\XXMI Launcher\\${code}`;

export const demoDb = {
  games: [
    game({ id: "gi", name: "Genshin Impact", short: "Genshin", importer: "GIMI", gamebananaId: 8552, gbCharacterCategory: 18140, accent: "#d3bc8e", theme: "gi",
      installed: true, gameDir: "C:\\Program Files\\HoYoPlay\\games\\Genshin Impact Game", importerDir: xx("GIMI"), modsDir: `${xx("GIMI")}\\Mods`, viaXxmi: true,
      importerVersion: "8.7.8", importerLatest: "8.8.1", shown: true }),
    game({ id: "hsr", name: "Honkai: Star Rail", short: "Star Rail", importer: "SRMI", gamebananaId: 18366, gbCharacterCategory: 22832, accent: "#a596f5", theme: "hsr" }),
    game({ id: "zzz", name: "Zenless Zone Zero", short: "ZZZ", importer: "ZZMI", gamebananaId: 19567, gbCharacterCategory: 30305, accent: "#ff7a1c", theme: "zzz",
      installed: true, gameDir: "C:\\Program Files\\HoYoPlay\\games\\ZenlessZoneZero Game", importerDir: xx("ZZMI"), modsDir: `${xx("ZZMI")}\\Mods`, viaXxmi: true,
      importerVersion: "1.5.0", importerLatest: "1.5.0", shown: true }),
    game({ id: "ww", name: "Wuthering Waves", short: "WuWa", importer: "WWMI", gamebananaId: 20357, gbCharacterCategory: 29524, accent: "#e9d58a", theme: "ww",
      installed: true, gameDir: "C:\\Program Files\\Wuthering Waves\\Wuthering Waves Game", importerDir: xx("WWMI"), modsDir: `${xx("WWMI")}\\Mods`, viaXxmi: true,
      importerVersion: "0.9.8", importerLatest: "0.9.8", shown: true }),
    game({ id: "hi3", name: "Honkai Impact 3rd", short: "HI3", importer: "HIMI", gamebananaId: 10349, gbCharacterCategory: 23620, accent: "#59c3f5" }),
    game({ id: "ef", name: "Arknights: Endfield", short: "Endfield", importer: "EFMI", gamebananaId: 21842, gbCharacterCategory: 42770, accent: "#f2e33a", theme: "ef",
      installed: true, gameDir: "C:\\Program Files\\GRYPHLINK\\games\\EndField Game", importerDir: xx("EFMI"), modsDir: `${xx("EFMI")}\\Mods`, viaXxmi: true,
      importerVersion: "1.2.3", importerLatest: "1.2.3", shown: true }),
    game({ id: "pgr", name: "Punishing: Gray Raven", short: "PGR", importer: "3DMigoto", gamebananaId: 19942, gbCharacterCategory: 35542, accent: "#e8433d" }),
    game({ id: "p5x", name: "Persona 5: The Phantom X", short: "P5X", importer: "3DMigoto", gamebananaId: 20149, accent: "#e6001a" }),
    game({ id: "gf2", name: "Girls' Frontline 2: Exilium", short: "GF2", importer: "3DMigoto", gamebananaId: 19494, accent: "#f0a33a" }),
    game({ id: "idv", name: "Identity V", short: "IDV", importer: "3DMigoto", gamebananaId: 19670, accent: "#b9a77a" }),
    game({ id: "ss", name: "Stella Sora", short: "Stella", importer: "3DMigoto", gamebananaId: 23629, accent: "#7fb7ff" }),
    game({ id: "at", name: "Action Taimanin", short: "Taimanin", importer: "3DMigoto", gamebananaId: 26307, accent: "#c05cff" }),
  ] as GameState[],
  /** Mods per game id. Seeded by LIBRARY's demo (demo/library.ts). */
  mods: new Map<string, ModEntry[]>(),
  characters: new Map<string, Character[]>(),
  /** Characters marked as owned, per game (LIBRARY). */
  owned: new Map<string, Set<string>>(),
  profiles: new Map<string, Profile[]>(),
  settings: new Map<string, string>(),
};

export const demoNow = () => Math.floor(Date.now() / 1000);
export const demoId = () => Math.random().toString(16).slice(2).padEnd(32, "0").slice(0, 32);
export const demoWait = (ms = 220) => new Promise((r) => setTimeout(r, ms));
