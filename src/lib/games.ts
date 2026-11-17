// What the UI knows about each game beyond the backend's registry: what the game calls its characters, where the
// community wiki keeps character icons (GameBanana's are 32 px), and where community loaders come from.
// Owner: skeleton. Add a game here when it is added to crates/gacha-core/src/games.rs.
import type { GameId } from "./api";
import { t, tn } from "./i18n";

export interface GameMeta {
  /** What the game calls its playable characters: [one, many]. Used for labels ("Agents" in Zenless Zone Zero). */
  noun: [string, string];
  /** A MediaWiki with character pages. `icons` are file titles to try, with {name} for the character name; when none
   *  exists the page's lead image is used (cropped to the face). */
  wiki?: { host: string; icons?: string[]; api?: string };
  /** Where to get the community 3DMigoto loader, for games outside XXMI. */
  loader?: { url: string; label: string };
  /** The game's App Store id. Its 512 px icon (itunes.apple.com/lookup?id=..., CORS open) is the sharp game icon when
   *  the game's exe icon isn't available (the browser demo, a game not installed yet). */
  appStore?: number;
}

const META: Record<string, GameMeta> = {
  gi: { noun: [t("Character"), t("Characters")], appStore: 1517783697, wiki: { host: "genshin-impact.fandom.com", icons: ["{name} Icon.png"] } },
  hsr: { noun: [t("Character"), t("Characters")], appStore: 1599719154, wiki: { host: "honkai-star-rail.fandom.com", icons: ["Character {name} Icon.png"] } },
  zzz: { noun: [t("Agent"), t("Agents")], appStore: 1606356401, wiki: { host: "zenless-zone-zero.fandom.com", icons: ["Agent {name} Icon.png"] } },
  ww: { noun: [t("Resonator"), t("Resonators")], appStore: 6475033368, wiki: { host: "wutheringwaves.fandom.com", icons: ["Resonator {name}.png"] } },
  hi3: { noun: [t("Valkyrie"), t("Valkyries")], appStore: 1336342304, wiki: { host: "honkaiimpact3.fandom.com" } },
  ef: { noun: [t("Operator"), t("Operators")], appStore: 6752642477, wiki: { host: "endfield.wiki.gg", icons: ["{name} icon.png"] } },
  pgr: { noun: [t("Construct"), t("Constructs")], appStore: 1571685286, wiki: { host: "punishing-gray-raven.fandom.com" },
    loader: { url: "https://gamebanana.com/tools/games/19942", label: t("PGR loader tools on GameBanana") } },
  p5x: { noun: [t("Character"), t("Characters")], appStore: 6736754647, wiki: { host: "megamitensei.fandom.com" },
    loader: { url: "https://gamebanana.com/mods/cats/48600", label: t("P5X 3DMigoto on GameBanana") } },
  gf2: { noun: [t("Doll"), t("Dolls")], appStore: 6502505286, wiki: { host: "iopwiki.com", api: "https://iopwiki.com/api.php" },
    loader: { url: "https://gamebanana.com/tools/games/19494", label: t("GF2 loader tools on GameBanana") } },
  idv: { noun: [t("Character"), t("Characters")], appStore: 1347780764, wiki: { host: "id5.fandom.com" },
    loader: { url: "https://gamebanana.com/tools/games/19670", label: t("Identity V loader tools on GameBanana") } },
  ss: { noun: [t("Trekker"), t("Trekkers")], appStore: 6738407069,
    loader: { url: "https://gamebanana.com/tools/games/23629", label: t("Stella Sora loader tools on GameBanana") } },
  at: { noun: [t("Character"), t("Characters")], appStore: 1527533676,
    loader: { url: "https://gamebanana.com/tools/games/26307", label: t("Action Taimanin loader tools on GameBanana") } },
};

const FALLBACK: GameMeta = { noun: [t("Character"), t("Characters")] };

export const gameMeta = (id: GameId | null | undefined): GameMeta => (id ? META[id] : undefined) ?? FALLBACK;
/** "Agents", "Characters" ... for a game. `one` gives the singular. */
export const charNoun = (id: GameId | null | undefined, one = false) => gameMeta(id).noun[one ? 0 : 1];
/** A count of a game's characters in its own word: "3 agents", "1 resonator". One key per word, so languages that
 *  change the noun with the count (Russian) can. */
export function charCount(id: GameId | null | undefined, n: number): string {
  switch (gameMeta(id).noun[0]) {
    case "Agent": return tn(n, "{n} agent", "{n} agents");
    case "Resonator": return tn(n, "{n} resonator", "{n} resonators");
    case "Valkyrie": return tn(n, "{n} valkyrie", "{n} valkyries");
    case "Operator": return tn(n, "{n} operator", "{n} operators");
    case "Construct": return tn(n, "{n} construct", "{n} constructs");
    case "Doll": return tn(n, "{n} doll", "{n} dolls");
    case "Trekker": return tn(n, "{n} trekker", "{n} trekkers");
    default: return tn(n, "{n} character", "{n} characters");
  }
}
/** A game's name as players in the user's language know it ("原神" for Genshin Impact in Chinese). */
export const gameName = (g: { name: string } | null | undefined): string => (g ? t(g.name) : "");
/** A game's short name ("Genshin", "Zenless") in the user's language. */
export const gameShort = (g: { short: string } | null | undefined): string => (g ? t(g.short) : "");
/** "a" or "an" for a word: "an agent", "a resonator". */
export const article = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a");
