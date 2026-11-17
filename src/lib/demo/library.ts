// Demo handlers for the LIBRARY area's commands (lib/api/library.ts): mods, characters, trash and profiles, kept in
// demoDb so other areas' demos see the same library. Mods, previews, submitters and character icons are real
// GameBanana entries (fetched 2026-11-13), so "Open on GameBanana" leads somewhere. Owner: LIBRARY area.
import { registerDemo } from "../tauri";
import type { Character, ForeignImport, ForeignInfo, ModChange, ModEntry, OwnedImport, Profile, ProfilePatch } from "../api/types";
import type { ArchiveEntry, CharacterRef, MetaPatch, ModPart, ProfileSnapshot, SwitchReport, TrashEntry } from "../api/library";
import { demoDb, demoId, demoNow, demoWait } from "./db";

const SS = "https://images.gamebanana.com/img/ss/mods/";
const ICO = "https://images.gamebanana.com/img/ico/ModCategory/";

// [GameBanana mod id, name, character, submitter, preview file, version, added, updated]
type Seed = [number, string, string, string, string, string, number, number];

const ZZZ: Seed[] = [
  [537300, "Ellen Thicc & Simple", "Ellen Joe", "makosato", "530-90_66c815328eda2.jpg", "2", 1724388893, 1724388893],
  [574394, "The troubles of a shark", "Ellen Joe", "[Ash]", "530-90_6a22cd2986cf0.jpg", "2", 1739159141, 1767188116],
  [568002, "Ellen - Back to Black", "Ellen Joe", "Proxy Index", "530-90_678081fdda6dc.jpg", "1.2", 1736475267, 1741301032],
  [599335, "Ellen Joe shark hoodie tweak", "Ellen Joe", "qventurine", "530-90_684581564ea02.jpg", "", 1749385600, 1749385600],
  [563440, "Soul Vessel Miyabi", "Hoshimi Miyabi", "Ceeji", "530-90_6765ca3ad1078.jpg", "", 1734724716, 1734798831],
  [601544, "Sweety Miyabi", "Hoshimi Miyabi", "Desu4Ever", "530-90_68664ea6bbe54.jpg", "1.1 hotfix 2", 1750347589, 1753201501],
  [565171, "Miyabi 2B Outfit", "Hoshimi Miyabi", "FleurNaive", "530-90_676fd8c319fc1.jpg", "", 1735343860, 1735383449],
  [583065, "An Ordinary Day Jane Doe", "Jane Doe", "CompanyCommander", "530-90_67dea87da3348.jpg", "2.5.1", 1742645675, 1767712969],
  [543851, "Jacketless Jane", "Jane Doe", "Xsolaris", "530-90_66f065ae2a5f5.jpg", "v1.1", 1727031241, 1728575700],
  [687961, "John Doe", "Jane Doe", "scopeophilia", "530-90_6a3871fa8d7b0.jpg", "", 1782084988, 1782084988],
  [533514, "Zhu Yuan Fashion girl", "Zhu Yuan", "kongxinrumeng", "530-90_66b215eeafb02.jpg", "", 1722948603, 1722948603],
  [544174, "Gym Zhu Yuan", "Zhu Yuan", "bannanasplit", "530-90_66f2b42ed304e.jpg", "", 1727181998, 1727181998],
  [549230, "Objectively Better Burnice", "Burnice White", "Xsolaris", "530-90_67117af12bddf.jpg", "1.2", 1729198927, 1735836926],
  [605681, "Operation Yum Burnice", "Burnice White", "Selrew", "530-90_686d438db8eaa.jpg", "0.1.3", 1751991700, 1770726825],
  [558182, "Dark Yanagi", "Yanagi Tsukishiro", "teemkk", "530-90_67491d283ecb2.jpg", "4.4", 1732517244, 1749681935],
  [609502, "Miasmic Hunter Yanagi", "Yanagi Tsukishiro", "Lagspike", "530-90_6884fb618e446.jpg", "", 1753543721, 1753633352],
  [575138, "Astra's Miku cosplay", "Astra Yao", "iiPegon", "530-90_67ae7a7a03a57.jpg", "1.2", 1739488549, 1739572266],
  [571459, "Casual Astra", "Astra Yao", "jussiemeow", "530-90_67960e8259f0e.jpg", "", 1737887417, 1737892079],
  [578089, "Evelyn short formal dress", "Evelyn Chevalier", "DaisyMeow", "530-90_67c050674874a.jpg", "", 1740657040, 1741012955],
  [576030, "Sanguine Evelyn", "Evelyn Chevalier", "Ceeji", "530-90_67b26d6aaa2af.jpg", "", 1739747123, 1739747123],
  [534637, "Belle High Waisted", "Belle", "makosato", "530-90_6a4f2febf3dbc.jpg", "8", 1723360809, 1783866381],
  [568855, "Belle Schoolgirl", "Belle", "Desu4Ever", "530-90_678635341beda.jpg", "1.3", 1736847995, 1737646584],
  [540496, "Nicole High Waisted", "Nicole Demara", "makosato", "530-90_68d63656ed112.jpg", "2", 1725629636, 1758869317],
  [547826, "Nicole NEPS", "Nicole Demara", "ArcDestiny", "530-90_6795da449fdb1.jpg", "1.5", 1728626281, 1737873734],
];

const GI: Seed[] = [
  [482033, "Winter Furina", "Furina", "mimo4e", "530-90_656a73f24c539.jpg", "", 1701477971, 1703140941],
  [478481, "Furina: Focalors", "Furina", "Lumine_", "530-90_654edf3d68d0e.jpg", "5", 1699667525, 1700105368],
  [420426, "Playable Boss Raiden Shogun Outfit", "Raiden Shogun", "Moonling", "530-90_656d44b6cb3e6.jpg", "2.0", 1672727984, 1701662100],
  [491724, "Hacker Raiden Shogun", "Raiden Shogun", "DasBirb", "530-90_65af3ba15e511.jpg", "2.1", 1705983075, 1732112969],
  [483004, "Hu Tao Summer Collab Outfit", "Hu Tao", "DasBirb", "530-90_67020b6cb90ad.jpg", "2.0", 1702028903, 1728188793],
  [499718, "Adeptus Hu Tao", "Hu Tao", "mimo4e", "530-90_65eb6204021ed.jpg", "", 1709925436, 1713633873],
  [509492, "Arlecchino Boss Mod", "Arlecchino", "Aiui", "530-90_662a9cd96e1ca.jpg", "V4", 1714059631, 1714195006],
  [509289, "Arlecchino Maid Mod", "Arlecchino", "Aiui", "530-90_6628d6b0d730e.jpg", "", 1713952794, 1713952794],
  [477287, "Nahida Princess of Surasthana", "Nahida", "xxzero", "530-90_656d717bf1b26.jpg", "0.1", 1699003048, 1712634690],
  [449990, "SummerNahida", "Nahida", "NT.PLS", "530-90_648aedbe30602.jpg", "v1.2", 1686750761, 1693829837],
  [431511, "Yelan as Kafka", "Yelan", "voidnon", "530-90_66e887fbec50c.jpg", "", 1678497095, 1726515296],
  [476410, "Office Yelan", "Yelan", "Astutes", "530-90_653e3e22191bf.jpg", "3.0", 1698578006, 1698578006],
];

const WW: Seed[] = [
  [530382, "Changli queen", "Changli", "Sarnya", "530-90_66a1a35936445.jpg", "1.1.1", 1721864305, 1721908992],
  [530696, "Chang Li Swimwear", "Changli", "gu_jun", "530-90_66a3021e03e3c.jpg", "1.21", 1721959024, 1722168679],
  [573664, "Beach Walk Camellya", "Camellya", "zhishixuebao", "530-90_67a90076b62ee.jpg", "V2.8", 1738859005, 1763829807],
  [555933, "Camellya Rozen 2tone", "Camellya", "Ceeji", "530-90_67379e3a0ccf3.jpg", "", 1731698464, 1731698464],
  [554340, "Ocean Blues Shorekeeper", "Shorekeeper", "mimo4e", "530-90_672e4b01c926a.jpg", "", 1731087119, 1737632171],
  [589147, "Laevatain Shorekeeper", "Shorekeeper", "Ceeji", "530-90_6802e85208bc1.jpg", "", 1745021475, 1745021475],
  [566908, "Figurine Carlotta", "Carlotta", "Ceeji", "530-90_677acf3f88cc7.jpg", "", 1736006209, 1736102978],
  [567381, "Coven Carlotta", "Carlotta", "Ceeji", "530-90_677c20a39bd3c.jpg", "", 1736188767, 1736188767],
];

// GameBanana character categories: [name, category id, icon file]
type CharSeed = [string, number, string];

const ZZZ_CHARS: CharSeed[] = [["Alexandrina Sebastiane", 30335, "68801f7c58e90.png"], ["Alice Thymefield", 38196, "68801f9b72225.png"], ["Anby Demara", 30336, "68801f9677d60.png"], ["Anton Ivanov", 30337, "68801f913ebfd.png"], ["Aria", 43004, "69838c9148df6.png"], ["Asaba Harumasa", 34036, "68801f84a739f.png"], ["Astra Yao", 34740, "6880201ac98e0.png"], ["Banyue", 41775, "6942f059d98a8.png"], ["Belle", 30334, "6880202023af0.png"], ["Ben Bigger", 30338, "68802025154a2.png"], ["Billy Kid", 30339, "6880202dd005a.png"], ["Burnice White", 32531, "6880203460d5d.png"], ["Caesar King", 32164, "6880203cc8387.png"], ["Cissia", 44398, "69c2e55b52ac8.png"], ["Claret Flint", 49001, "6a9d066da1f66.png"], ["Corin Wickes", 30340, "68802042411e5.png"], ["Dialyn", 41303, "6927284c29db9.png"], ["Ellen Joe", 30341, "68802045acf1f.png"], ["Evelyn Chevalier", 35123, "68802049b9df6.png"], ["Grace Howard", 30342, "6880204e4ab41.png"], ["Hoshimi Miyabi", 30579, "688020525e72e.png"], ["Hugo Vlad", 36836, "68802167b1f68.png"], ["Jane Doe", 30580, "6880216d8ef4e.png"], ["Ju Fufu", 37309, "6880218846023.png"], ["Koleda Belobog", 30343, "6880218e23b76.png"], ["Komano Manato", 40360, "68efc6b2b9a84.png"], ["Lighter", 33590, "6880219895db1.png"], ["Lucia Elowen", 40361, "68efc6a1177c8.png"], ["Luciana de Montefio", 30344, "6880219faadde.png"], ["Nangong Yu", 43311, "698e402d068a1.png"], ["Nekomiya Mana", 30345, "688021a8820be.png"], ["Nicole Demara", 30346, "688021b432ccd.png"], ["Norma Hollowell", 46552, "6a304901415ff.png"], ["Orphie Magnusson", 39946, "68d99a45ce153.png"], ["Pan Yinhu", 37308, "6880225a3a33c.png"], ["Phoenix Reffaella", 50547, "6ad824fcd2d32.png"], ["Piper Wheel", 30347, "68802260a03a1.png"], ["Promeia", 45448, "69fb61f79964f.png"], ["Pulchra Fellini", 35673, "68802267199f2.png"], ["Pyrois", 46646, "6a32cb4a6ed78.png"], ["Qingyi", 30578, "688022732c334.png"], ["Remielle Dan", 47714, "6a68e4b7a6ab0.png"], ["Roxy Ifrita Pryce", 49002, "6a9d06e5181aa.png"], ["Seed", 39338, "68be341ee0016.png"], ["Seth Lowell", 30577, "6880227aea7f7.png"], ["Severian Lowell", 50548, "6ad8256e398be.png"], ["Sigrid de L'Azur", 47715, "6a68e57e738cd.png"], ["Soldier 0 Anby", 35835, "688022812533e.png"], ["Soldier 11", 30348, "688020d182d71.png"], ["Soukaku", 30349, "688020d8b0588.png"], ["Starlight Billy", 46113, "6a1b3972a44fb.png"], ["Sunna", 43003, "69838c7f0b539.png"], ["Trigger", 36133, "688020e4257b1.png"], ["Velina Airgid", 46553, "6a3049153ba47.png"], ["Vivian Banshee", 36560, "688020fed3d80.png"], ["Von Lycaon", 30309, "68802109702bf.png"], ["Wise", 30316, "6880211ae3df6.png"], ["Yanagi Tsukishiro", 33018, "688021362ae6a.png"], ["Ye Shunguang", 42116, "69556970f28e6.png"], ["Yidhari Murphy", 40880, "690b8e4d43c77.png"], ["Yixuan", 37289, "6880212c0ae1e.png"], ["Yuzuha Ukinami", 38177, "688020f7c4ca0.png"], ["Zhao", 42118, "69556969eb1ee.png"], ["Zhu Yuan", 30350, "6880215c7dd3d.png"]];

const GI_CHARS: CharSeed[] = [["Aether", 19510, "699334094eb4e.png"], ["Arlecchino", 28961, "69932d67618a3.png"], ["Chasca", 33346, "69932db235576.png"], ["Citlali", 32438, "69932ddfa4c9f.png"], ["Clorinde", 29719, "69932de9f269c.png"], ["Columbina", 42455, "69932dfea0fac.png"], ["Eula", 19481, "69932e652c5b5.png"], ["Furina", 25471, "69932e994a69a.png"], ["Ganyu", 19483, "69932eae9695e.png"], ["Hu Tao", 19485, "69932ec3bbbdc.png"], ["Kaedehara Kazuha", 19486, "699332f650bbf.png"], ["Kamisato Ayaka", 19488, "6993330145d9c.png"], ["Keqing", 19490, "69932f38b093a.png"], ["Klee", 19491, "69932f5fd73b2.png"], ["Lumine", 19763, "69933429707b7.png"], ["Mavuika", 31621, "69932fcd359d0.png"], ["Nahida", 20058, "69932ff7540e5.png"], ["Navia", 26790, "69933001a1776.png"], ["Neuvillette", 25403, "699330164c084.png"], ["Nilou", 19495, "6993302093723.png"], ["Raiden Shogun", 19498, "699333314a08a.png"], ["Shenhe", 19503, "699330838b99c.png"], ["Skirk", 37532, "6993309b02d21.png"], ["Varesa", 35962, "699330ced3655.png"], ["Venti", 19340, "699330d8cecfc.png"], ["Xianyun", 27548, "69933102893b8.png"], ["Xiao", 19512, "6993310d13de9.png"], ["Yae Miko", 19515, "6993334985ffb.png"], ["Yelan", 19517, "6993314e83bf5.png"], ["Zhongli", 18989, "699331704ff9b.png"]];

const WW_CHARS: CharSeed[] = [["Aemeath", 43048, "69857299638aa.png"], ["Augusta", 39143, "69cd42cb12c57.png"], ["Camellya", 33179, "675b7f303af84.png"], ["Cantarella", 36003, "6812a36c23457.png"], ["Carlotta", 34264, "6812a3cf60524.png"], ["Cartethyia", 37392, "686f2a0b0506c.png"], ["Changli", 30265, "6683c68095b05.png"], ["Chisa", 41155, "69cd42d7aa81e.png"], ["Ciaccona", 36990, "686f2a130c551.png"], ["Encore", 30253, "6683c41aafe7c.png"], ["Galbrena", 40281, "69cd42fc3a18f.png"], ["Iuno", 39624, "69cd42f1bd149.png"], ["Jinhsi", 30264, "6683c65ae3201.png"], ["Jiyan", 30256, "6683c4cec9dfe.png"], ["Lupa", 37891, "686f2a1a391f8.png"], ["Phoebe", 35119, "6812a40cb85a4.png"], ["Phrolova", 38371, "68ab24ab15f8f.png"], ["Rover Female", 30250, "6683c35cd412e.png"], ["Rover Male", 30249, "6683c30d33704.png"], ["Sanhua", 30252, "6683c3d32a078.png"], ["Shorekeeper", 32220, "66f8c47b49ee8.png"], ["Verina", 30248, "6683c2db4c218.png"], ["Yinlin", 30261, "6683c5b7aea39.png"], ["Zani", 36665, "6812a2f8ddacc.png"], ["Zhezhi", 30472, "66bdde0a65151.png"]];

// per game: which seeds start off, which have an update waiting, which conflict, which are nsfw, which have keys
const OFF: Record<string, number[]> = {
  zzz: [574394, 568002, 599335, 601544, 565171, 543851, 687961, 544174, 605681, 609502, 571459, 576030, 568855, 547826],
  gi: [478481, 491724, 499718, 509289, 449990, 476410],
  ww: [530696, 555933, 589147, 567381],
};
// these keep an older copy (installed before their last GameBanana update), so the real update check finds them
const UPDATES = [558182, 583065, 534637, 420426, 573664];
const CONFLICTS = [534637, 540496];
const NSFW = [578089];
const FAVOURITES = [537300, 563440, 482033];
// removed before the demo starts: [GameBanana mod id, days ago, where it is now]
const REMOVED: Record<string, Array<[number, number, "trash" | "archive"]>> = {
  zzz: [[599335, 3, "trash"], [571459, 40, "archive"]],
  gi: [[476410, 9, "trash"]],
  ww: [[567381, 26, "archive"]],
};

const tidy = (s: string) => s.replace(/[<>:"/\\|?*]/g, "").trim();
const hexId = (n: number) => n.toString(16).padStart(32, "0");
const stripOff = (folder: string) => folder.replace(/^disabled[\s_-]*/i, "");

function seedMods(game: string, seeds: Seed[]): ModEntry[] {
  const modsDir = demoDb.games.find((g) => g.id === game)?.modsDir ?? "C:\\Users\\Player\\Mods";
  return seeds.map(([gbId, name, character, submitter, file, version, added, updated], i) => {
    const on = !OFF[game]?.includes(gbId);
    const folder = `${on ? "" : "DISABLED "}${tidy(name)}`;
    const group = tidy(character);
    return {
      id: hexId(gbId), game, name, folder, relPath: `${group}/${folder}`, path: `${modsDir}\\${group}\\${folder}`, enabled: on, character, group,
      source: { site: "gamebanana", modId: gbId, fileId: null, url: `https://gamebanana.com/mods/${gbId}`, submitter, fileName: null, remoteUpdated: UPDATES.includes(gbId) ? added : updated },
      version: version || null,
      // installed some days after the mod appeared, newest first in the list
      installedAt: Math.min(demoNow() - i * 86400 * 3, (UPDATES.includes(gbId) ? added : Math.max(added, updated)) + 86400 * 2),
      sizeBytes: Math.round((14 + ((gbId * 7) % 90)) * 1024 * 1024 * (1 + (gbId % 3) / 4)),
      fileCount: 9 + (gbId % 31), iniCount: 1 + (gbId % 3 === 0 ? 1 : 0), preview: SS + file,
      tags: gbId % 4 === 0 ? ["outfit"] : [], notes: null, favorite: FAVOURITES.includes(gbId), nsfw: NSFW.includes(gbId),
      hasKeys: gbId % 2 === 0, conflicts: CONFLICTS.includes(gbId) ? 1 : 0, updateAvailable: UPDATES.includes(gbId),
    };
  });
}

// mods without a character, put in by hand (no GameBanana page): [name, group folder or null for the top level]
const ZZZ_LOOSE: Array<[string, string | null]> = [
  ["RabbitFX", null], ["ORFix", null], ["Cleaner HUD", "UI"], ["Bigger subtitles", "UI"], ["Eous plushie", "OtherMisc"],
];

function looseMods(game: string, list: Array<[string, string | null]>): ModEntry[] {
  const modsDir = demoDb.games.find((g) => g.id === game)?.modsDir ?? "C:\\Users\\Player\\Mods";
  return list.map(([name, group], i) => ({
    id: hexId(900000 + i), game, name, folder: name, relPath: group ? `${group}/${name}` : name, path: `${modsDir}\\${group ? `${group}\\` : ""}${name}`,
    enabled: i < 3, character: null, group, source: null, version: null, installedAt: demoNow() - (i + 2) * 86400 * 5,
    sizeBytes: (40 + i * 170) * 1024, fileCount: 2 + i, iniCount: 1, preview: null, tags: [], notes: null, favorite: false, nsfw: false,
    hasKeys: false, conflicts: 0, updateAvailable: false,
  }));
}

const chars = (list: CharSeed[]): Character[] =>
  list.map(([name, id, icon]) => ({ name, gbCategoryId: id, icon: ICO + icon, modCount: 0, enabledCount: 0 }));

// profile rows: profile id -> mod id -> on
const members = new Map<number, Map<string, boolean>>();
let nextProfile = 1;
let nextTrash = 1;
const trash: Array<TrashEntry & { mod: ModEntry }> = [];
/** The preview a mod had before the user set their own (mod id to preview). */
const keptPreview = new Map<string, string | null>();

const err = (message: string, kind = "invalid") => ({ kind, message });
const mods = (game: string) => demoDb.mods.get(game) ?? [];
const setMods = (game: string, list: ModEntry[]) => demoDb.mods.set(game, list);
const findMod = (game: string, id: string) => {
  const m = mods(game).find((x) => x.id === id);
  if (!m) throw err("That mod isn't in the library anymore. Rescan to refresh the list");
  return m;
};

/** Parts of demo mods: an "Operation Yum" mod came with its icons in the same archive. */
const demoParts = new Map<string, ModPart[]>();
/** Give a demo mod parts (an install of several folders from one archive). */
export function demoSetParts(id: string, names: string[]) {
  demoParts.set(id, names.map((name, i) => ({ folder: name, name, enabled: true, iniCount: i + 1, sizeBytes: (18 + i * 7) * 1024 * 1024 })));
}
function partsOf(m: ModEntry): ModPart[] {
  let list = demoParts.get(m.id);
  if (!list) {
    const names = /operation yum/i.test(m.name) ? [m.name, "1 Icon Portrait", "2 Icon Big", "3 Icon Small"] : [];
    list = names.map((name, i) => ({ folder: name, name, enabled: true, iniCount: i === 0 ? 3 : 1, sizeBytes: i === 0 ? 129_000_000 : 180_000 + i * 40_000 }));
    demoParts.set(m.id, list);
  }
  return list;
}

const withParts = (m: ModEntry): ModEntry => ({ ...m, parts: partsOf(m).length });

function stamp(p: Profile): Profile {
  const rows = members.get(p.id);
  const ids = new Set(mods(p.game).map((m) => m.id));
  const count = rows ? [...rows].filter(([id, on]) => on && ids.has(id)).length : 0;
  return { ...p, modCount: count };
}

function capture(p: Profile) {
  members.set(p.id, new Map(mods(p.game).map((m) => [m.id, m.enabled])));
  p.updatedAt = demoNow();
}

function newProfile(game: string, name: string, extra: Partial<Profile> = {}): Profile {
  const t = demoNow();
  return { id: nextProfile++, game, name, icon: null, color: null, banner: null, description: null, active: false, modCount: 0, createdAt: t, updatedAt: t, hotkey: null, ...extra };
}

function freeName(game: string, name: string, except?: number) {
  const base = name.trim() || "Profile";
  const taken = (n: string) => (demoDb.profiles.get(game) ?? []).some((p) => p.id !== except && p.name.toLowerCase() === n.toLowerCase());
  let cand = base;
  for (let n = 2; taken(cand); n++) cand = `${base} (${n})`;
  return cand;
}

function profilesOf(game: string): Profile[] {
  let list = demoDb.profiles.get(game);
  if (!list || !list.length) {
    const d = newProfile(game, "Default", { active: true });
    capture(d);
    list = [d];
    demoDb.profiles.set(game, list);
  }
  return list;
}

function findProfile(id: number): Profile {
  for (const list of demoDb.profiles.values()) {
    const p = list.find((x) => x.id === id);
    if (p) return p;
  }
  throw err("That profile isn't there anymore");
}

function onChange(game: string, change: ModChange) {
  const active = (demoDb.profiles.get(game) ?? []).find((p) => p.active);
  if (!active || !change.changed.length) return;
  const rows = members.get(active.id) ?? new Map<string, boolean>();
  for (const m of change.changed) rows.set(m.id, m.enabled);
  members.set(active.id, rows);
  active.updatedAt = demoNow();
}

/** Rename one mod like the backend does; false when it already was in that state. */
function toggle(game: string, m: ModEntry, on: boolean): boolean {
  if ((m.enabled || !!m.standby) === on) return false;
  const base = stripOff(m.folder) || "Mod";
  const siblings = new Set(mods(game).filter((x) => x.group === m.group && x.id !== m.id).map((x) => x.folder.toLowerCase()));
  const want = on ? base : `DISABLED ${base}`;
  let folder = want;
  for (let n = 2; siblings.has(folder.toLowerCase()); n++) folder = `${want} (${n})`;
  const parentPath = m.path.slice(0, m.path.length - m.folder.length);
  m.folder = folder;
  m.relPath = m.group ? `${m.group}/${folder}` : folder;
  m.path = parentPath + folder;
  m.enabled = on;
  m.standby = false;
  if (!on) m.conflicts = 0;
  return true;
}

/** Live switching (demo/ingame.ts) plugs in here, like live.rs does in the backend's library. */
export const liveHooks: {
  /** Ids of the live skins among these. */
  live?: (game: string) => Set<string>;
  /** Switch live skins: on picks one, off picks none when it's showing. */
  switch?: (game: string, targets: Array<[string, boolean]>) => ModChange;
  /** A skin that isn't live came on: the character's live skins show none. */
  hide?: (game: string, character: string) => ModChange | null;
} = {};

/** Turn mods on or off. Live skins switch in game instead of being renamed (backend library::set_enabled). */
export function setEnabled(game: string, ids: string[], on: boolean, oneSkin: boolean): ModChange {
  const live = liveHooks.live?.(game) ?? new Set<string>();
  const picks = ids.filter((i) => live.has(i));
  if (!picks.length || !liveHooks.switch) return setFolders(game, ids, on, oneSkin);
  const rest = ids.filter((i) => !live.has(i));
  const change: ModChange = rest.length ? setFolders(game, rest, on, oneSkin) : { changed: [], removed: [], notes: [] };
  const sw = liveHooks.switch(game, picks.map((i) => [i, on]));
  if (oneSkin) {
    const shown = sw.changed.filter((e) => e.enabled && e.character).map((e) => e.character!.toLowerCase());
    const offs = mods(game).filter((o) => (o.enabled || o.standby) && !live.has(o.id) && !ids.includes(o.id) && shown.includes(o.character?.toLowerCase() ?? ""));
    if (offs.length) {
      const off = setFolders(game, offs.map((o) => o.id), false, false);
      change.changed.push(...off.changed);
    }
  }
  onChange(game, sw);
  change.changed.push(...sw.changed);
  change.notes.push(...sw.notes);
  return change;
}

/** Rename folders only, live skins included. */
export function setFolders(game: string, ids: string[], on: boolean, oneSkin: boolean): ModChange {
  const list = mods(game);
  const byId = new Map(list.map((m) => [m.id, m]));
  if (ids.length && !ids.some((id) => byId.has(id))) throw err("Those mods aren't in the library anymore. Rescan to refresh the list");
  const change: ModChange = { changed: [], removed: [], notes: [] };
  const turnedOn: string[] = [];
  for (const id of new Set(ids)) {
    const m = byId.get(id);
    if (!m) continue;
    if (on) turnedOn.push(id);
    if (toggle(game, m, on)) change.changed.push({ ...m });
  }
  if (on && oneSkin) {
    for (const id of turnedOn) {
      const m = byId.get(id);
      if (!m?.character) continue;
      const hidden = liveHooks.hide?.(game, m.character);
      if (hidden) { change.changed.push(...hidden.changed); change.notes.push(...hidden.notes); }
      const live = liveHooks.live?.(game);
      for (const o of list) {
        if (o.id === id || ids.includes(o.id) || !o.enabled || live?.has(o.id) || rootOf(o) === rootOf(m) || o.character?.toLowerCase() !== m.character.toLowerCase()) continue;
        if (toggle(game, o, false)) change.changed.push({ ...o });
      }
    }
  }
  onChange(game, change);
  return change;
}

const oneSkinOn = (game: string) => demoDb.settings.get(`${game}.oneSkin`) !== "0";
const rootOf = (m: ModEntry) => m.parent || m.id;

/** Sub-mods that were on when their parent went off (backend Sidecar::off_with_parent). */
const offWithParent = new Set<string>();

/** Sub-mods go with their parent (backend library::with_family): a sub-mod on brings its parent, a parent off takes
 *  its sub-mods, and on again brings back the ones that were on. */
function withFamily(game: string, ids: string[], on: boolean): { ids: string[]; notes: string[] } {
  const list = mods(game);
  const byId = new Map(list.map((m) => [m.id, m]));
  const out = [...ids];
  const notes: string[] = [];
  for (const id of ids) offWithParent.delete(id);
  if (on) {
    for (const id of ids) {
      const m = byId.get(id);
      const p = m?.parent ? byId.get(m.parent) : undefined;
      if (!m || !p || p.enabled || p.standby || out.includes(p.id)) continue;
      out.push(p.id);
      notes.push(`Turned on ${p.name} too, since ${m.name} is its sub-mod`);
    }
    for (const m of list) {
      if (m.parent && out.includes(m.parent) && !out.includes(m.id) && !m.enabled && offWithParent.has(m.id)) { out.push(m.id); offWithParent.delete(m.id); notes.push(`Turned its sub-mod ${m.name} back on`); }
    }
  } else {
    for (const m of list) {
      if (m.parent && ids.includes(m.parent) && !out.includes(m.id) && m.enabled) { out.push(m.id); offWithParent.add(m.id); notes.push(`Turned off its sub-mod ${m.name} too`); }
    }
  }
  return { ids: out, notes };
}

export function registerLibraryDemo() {
  if (!demoDb.mods.has("zzz")) {
    setMods("zzz", [...seedMods("zzz", ZZZ), ...looseMods("zzz", ZZZ_LOOSE)]);
    setMods("gi", seedMods("gi", GI));
    setMods("ww", seedMods("ww", WW));
    for (const [game, list] of Object.entries(REMOVED)) {
      for (const [gbId, days, where] of list) {
        const m = mods(game).find((x) => x.source?.modId === gbId);
        if (!m) continue;
        setMods(game, mods(game).filter((x) => x !== m));
        const t = { id: nextTrash++, game, modId: m.id, name: m.name, originalRel: m.relPath, size: m.sizeBytes, reason: "removed", removedAt: demoNow() - days * 86400, mod: m };
        if (where === "trash") trash.push(t);
        else archived.push(toArchive(t));
      }
    }
    demoDb.characters.set("zzz", chars(ZZZ_CHARS));
    demoDb.characters.set("gi", chars(GI_CHARS));
    demoDb.characters.set("ww", chars(WW_CHARS));
    demoDb.owned.set("gi", new Set(["Raiden Shogun", "Nahida", "Furina", "Zhongli", "Venti"]));
    demoDb.owned.set("zzz", new Set(["Ellen Joe", "Jane Doe", "Hoshimi Miyabi", "Belle", "Anby Demara", "Lighter"]));
    demoDb.owned.set("ww", new Set(["Rover Female", "Jinhsi", "Changli", "Verina"]));
    // two profiles per game: what is on now, and a second one
    const second: Record<string, [string, string, string, string]> = {
      zzz: ["Victoria Housekeeping", "🦈", "#3aa7a3", "Ellen, Lycaon's crew and the maid outfits"],
      gi: ["Fontaine nights", "🌊", "#4f7cff", "Furina and Arlecchino skins for the Fontaine quests"],
      ww: ["Beach day", "🏖️", "#ffb547", "Summer outfits only"],
    };
    for (const game of ["zzz", "gi", "ww"]) {
      const list = profilesOf(game);
      const first = list[0]!;
      first.icon = "⭐"; first.color = "#8b5cf6"; first.description = "What I play with most days";
      first.banner = mods(game).find((m) => m.enabled)?.preview ?? null;
      const [name, icon, color, description] = second[game]!;
      const p = newProfile(game, name, { icon, color, description, banner: mods(game)[1]?.preview ?? null, updatedAt: demoNow() - 86400 * 4 });
      // a different loadout: the first mod of each character turned off, the second on
      const seen = new Set<string>();
      members.set(p.id, new Map(mods(game).map((m) => {
        const c = m.character ?? m.id;
        const on = seen.has(c);
        seen.add(c);
        return [m.id, on];
      })));
      list.push(p);
    }
  }

  registerOwnedDemo();
  registerDemo({
    library_list: ({ game }) => mods(String(game)).map(withParts),
    library_scan: async ({ game }) => { await demoWait(450); return mods(String(game)).map(withParts); },
    mod_get: ({ game, id }) => withParts(findMod(String(game), String(id))),
    mod_parts: ({ game, id }) => partsOf(findMod(String(game), String(id))).map((p) => ({ ...p })),
    mods_merge: async ({ game, ids }) => {
      await demoWait(200);
      const g = String(game);
      const list = ((ids as string[]) ?? []).map((id) => findMod(g, id));
      if (list.length < 2) throw err("Pick at least two mods to combine");
      const lead = list.find((m) => m.enabled) ?? list[0]!;
      const rest = list.filter((m) => m !== lead);
      const names = [lead, ...rest].map((m) => m.name);
      const cut = lead.name.lastIndexOf(" - ");
      const prefix = cut > 0 && names.every((n) => n.startsWith(lead.name.slice(0, cut + 3))) ? lead.name.slice(0, cut + 3) : "";
      const name = prefix ? prefix.slice(0, -3) : lead.name;
      demoSetParts(lead.id, names.map((n) => n.slice(prefix.length)));
      Object.assign(lead, { name, folder: name, relPath: `${lead.group ?? "Other"}/${name}`, enabled: true, parts: list.length, iniCount: list.reduce((n, m) => n + m.iniCount, 0) });
      setMods(g, mods(g).filter((m) => !rest.includes(m)));
      return { changed: [{ ...lead }], removed: rest.map((m) => m.id), notes: [`Combined ${list.length} mods into ${name}`] };
    },
    mod_set_part: async ({ game, id, folder, on }) => {
      await demoWait(120);
      const m = findMod(String(game), String(id));
      const part = partsOf(m).find((p) => p.folder === folder);
      if (!part) throw err("That part isn't in the mod anymore. Reopen it to refresh the list");
      part.enabled = !!on;
      part.folder = on ? part.name : `DISABLED ${part.name}`;
      m.iniCount = partsOf(m).filter((p) => p.enabled).reduce((n, p) => n + p.iniCount, 0);
      return withParts(m);
    },
    mods_set_enabled: async ({ game, ids, on, turnOffOthers }) => {
      await demoWait(120);
      const fam = withFamily(String(game), (ids as string[]) ?? [], !!on);
      const others = typeof turnOffOthers === "boolean" ? turnOffOthers : oneSkinOn(String(game));
      const change = setEnabled(String(game), fam.ids, !!on, !!on && others);
      change.notes.unshift(...fam.notes);
      return change;
    },
    mods_overlapping: async ({ others }) => { await demoWait(60); return (others as string[]) ?? []; },
    mod_update_meta: ({ game, id, patch }) => {
      const m = findMod(String(game), String(id));
      const p = (patch ?? {}) as MetaPatch;
      const text = (s: string) => s.trim() || null;
      if (p.name !== undefined) m.name = p.name.trim() || stripOff(m.folder);
      if (p.character !== undefined) m.character = text(p.character);
      if (p.tags !== undefined) m.tags = [...new Map(p.tags.map((t) => t.trim()).filter(Boolean).map((t) => [t.toLowerCase(), t])).values()];
      if (p.notes !== undefined) m.notes = text(p.notes);
      if (p.favorite !== undefined) m.favorite = p.favorite;
      if (p.nsfw !== undefined) m.nsfw = p.nsfw;
      if (p.version !== undefined) m.version = text(p.version);
      if (p.parent !== undefined) {
        const all = mods(String(game));
        const pick = p.parent ? all.find((x) => x.id === p.parent) : undefined;
        if (p.parent && !pick) throw err("That mod isn't in the library anymore");
        const root = pick ? rootOf(pick) : null;
        if (root === m.id) throw err(`${pick!.name} is already a sub-mod of ${m.name}`);
        if (root && all.some((x) => x.parent === m.id)) throw err(`${m.name} has sub-mods of its own, so it can't be a sub-mod`);
        m.parent = root;
        offWithParent.delete(m.id);
      }
      return { ...m };
    },
    // the browser has no files to copy: a pasted or dropped image becomes a blob URL, the old preview is remembered
    mod_set_preview: () => { throw err("Picking a file needs the app. Paste or drop an image here instead"); },
    mod_set_preview_data: async ({ game, id, data, ext }) => {
      await demoWait(120);
      const g = String(game);
      const m = findMod(g, String(id));
      const type = String(ext) === "jpg" ? "image/jpeg" : `image/${String(ext)}`;
      if (!m.customPreview) keptPreview.set(m.id, m.preview);
      else if (m.preview?.startsWith("blob:")) URL.revokeObjectURL(m.preview);
      m.preview = URL.createObjectURL(new Blob([new Uint8Array(data as number[])], { type }));
      m.customPreview = true;
      onChange(g, { changed: [{ ...m }], removed: [], notes: [] });
      return { ...m };
    },
    mod_custom_preview: async ({ game, id }) => {
      const m = findMod(String(game), String(id));
      if (!m.customPreview || !m.preview) return new ArrayBuffer(0);
      return (await fetch(m.preview)).arrayBuffer();
    },
    mod_clear_preview: ({ game, id }) => {
      const g = String(game);
      const m = findMod(g, String(id));
      if (m.customPreview) {
        if (m.preview?.startsWith("blob:")) URL.revokeObjectURL(m.preview);
        m.preview = keptPreview.get(m.id) ?? null;
        keptPreview.delete(m.id);
        m.customPreview = false;
        onChange(g, { changed: [{ ...m }], removed: [], notes: [] });
      }
      return { ...m };
    },
    mod_move: ({ game, id, group }) => {
      const g = String(game);
      const m = findMod(g, String(id));
      const target = group ? tidy(String(group)) : null;
      if ((target ?? "").toLowerCase() === (m.group ?? "").toLowerCase()) return { ...m };
      const modsDir = demoDb.games.find((x) => x.id === g)?.modsDir ?? "";
      m.group = target;
      m.relPath = target ? `${target}/${m.folder}` : m.folder;
      m.path = `${modsDir}\\${m.relPath.replace(/\//g, "\\")}`;
      onChange(g, { changed: [{ ...m }], removed: [], notes: [] });
      return { ...m };
    },
    mods_remove: async ({ game, ids }) => {
      await demoWait(160);
      const g = String(game);
      const gone = new Set((ids as string[]) ?? []);
      const removed: string[] = [];
      for (const m of mods(g)) {
        if (!gone.has(m.id)) continue;
        trash.unshift({ id: nextTrash++, game: g, modId: m.id, name: m.name, originalRel: m.relPath, size: m.sizeBytes, reason: "removed", removedAt: demoNow(), mod: { ...m } });
        removed.push(m.id);
      }
      setMods(g, mods(g).filter((m) => !gone.has(m.id)));
      if (trashDays() === 0) purgeExpired();
      return { changed: [], removed, notes: [] } satisfies ModChange;
    },
    trash_list: ({ game }) => { purgeExpired(); return trash.filter((t) => t.game === game).map(({ mod: _mod, ...t }) => t); },
    trash_restore: ({ id }) => {
      const at = trash.findIndex((t) => t.id === Number(id));
      if (at < 0) throw err("That mod's files aren't in the trash anymore");
      const [t] = trash.splice(at, 1);
      const m = { ...t!.mod };
      if (mods(t!.game).some((x) => x.id === m.id)) m.id = demoId();
      setMods(t!.game, [m, ...mods(t!.game)]);
      const change: ModChange = { changed: [{ ...m }], removed: [], notes: [] };
      onChange(t!.game, change);
      return change;
    },
    trash_purge: ({ id }) => {
      if (id === null || id === undefined) return purgeExpired();
      const at = trash.findIndex((t) => t.id === Number(id));
      if (at < 0) return 0;
      purgeOne(at);
      return 1;
    },
    // removed mods: files in the trash first, then details only (LIBRARY's Archive tab)
    archive_list: ({ game }) => {
      purgeExpired();
      const g = game === null || game === undefined ? null : String(game);
      const until = trashDays() * 86400;
      const fromTrash: ArchiveEntry[] = trash.filter((t) => g === null || t.game === g).map((t) => ({
        ...archiveFields(t), key: `t${t.id}`, trashId: t.id, archiveId: null, filesUntil: t.removedAt + until,
      }));
      return [...fromTrash, ...archived.filter((a) => g === null || a.game === g)].sort((a, b) => b.removedAt - a.removedAt);
    },
    archive_forget: ({ keys }) => {
      let n = 0;
      for (const k of (keys as string[]) ?? []) {
        const id = Number(k.slice(1));
        const list: Array<{ id?: number; archiveId?: number | null }> = k.startsWith("t") ? trash : archived;
        const at = k.startsWith("t") ? trash.findIndex((t) => t.id === id) : archived.findIndex((a) => a.archiveId === id);
        if (at >= 0) { list.splice(at, 1); n++; }
      }
      return n;
    },
    mod_fetch_preview: async ({ game, id, url }) => {
      await demoWait(300);
      const g = String(game);
      const m = findMod(g, String(id));
      if (!m.customPreview) m.preview = String(url);
      onChange(g, { changed: [{ ...m }], removed: [], notes: [] });
      return { ...m };
    },
    characters_list: ({ game }) => {
      const g = String(game);
      const out = (demoDb.characters.get(g) ?? []).map((c) => ({ ...c, modCount: 0, enabledCount: 0 }));
      const index = new Map(out.map((c, i) => [c.name.toLowerCase(), i]));
      for (const m of mods(g)) {
        if (!m.character) continue;
        let i = index.get(m.character.toLowerCase());
        if (i === undefined) { out.push({ name: m.character, gbCategoryId: null, icon: null, modCount: 0, enabledCount: 0 }); i = out.length - 1; index.set(m.character.toLowerCase(), i); }
        out[i]!.modCount++;
        if (m.enabled) out[i]!.enabledCount++;
      }
      return out.sort((a, b) => b.enabledCount - a.enabledCount || b.modCount - a.modCount || a.name.localeCompare(b.name));
    },
    characters_sync: ({ game, list }) => {
      demoDb.characters.set(String(game), ((list as CharacterRef[]) ?? []).map((c) => ({ name: c.name, gbCategoryId: c.gbCategoryId ?? null, icon: c.icon ?? null, modCount: 0, enabledCount: 0 })));
    },
    mods_mark_updates: ({ game, ids }) => {
      const want = new Set((ids as string[]) ?? []);
      for (const m of mods(String(game))) m.updateAvailable = want.has(m.id);
    },

    profiles_list: ({ game }) => profilesOf(String(game)).map(stamp),
    profile_create: ({ game, name, copyFrom }) => {
      const g = String(game);
      const list = profilesOf(g);
      const p = newProfile(g, freeName(g, String(name ?? "")));
      if (copyFrom !== null && copyFrom !== undefined) {
        const src = findProfile(Number(copyFrom));
        Object.assign(p, { icon: src.icon, color: src.color, banner: src.banner, description: src.description, updatedAt: src.updatedAt });
        members.set(p.id, new Map(members.get(src.id) ?? []));
      } else capture(p);
      list.push(p);
      return stamp(p);
    },
    profile_update: ({ id, patch }) => {
      const p = findProfile(Number(id));
      const q = (patch ?? {}) as ProfilePatch;
      const text = (v: string | undefined, old: string | null) => (v === undefined ? old : v.trim() || null);
      if (q.name !== undefined && q.name.trim()) p.name = freeName(p.game, q.name, p.id);
      p.icon = text(q.icon, p.icon);
      p.color = text(q.color, p.color);
      p.banner = text(q.banner, p.banner);
      p.description = text(q.description, p.description);
      if (q.hotkey !== undefined) {
        const h = q.hotkey.trim();
        if (h && !/(^|\+)(Ctrl|Alt|Win)\+/.test(h)) throw err(`${h} needs Ctrl, Alt or Win with it`);
        if (h) for (const o of profilesOf(p.game)) if (o.hotkey === h) o.hotkey = null;
        p.hotkey = h || null;
      }
      return stamp(p);
    },
    profile_delete: ({ id }) => {
      const p = findProfile(Number(id));
      const list = profilesOf(p.game);
      if (list.length <= 1) throw err("This is the only profile. Make another one first, then delete this one", "conflict");
      const at = list.indexOf(p);
      list.splice(at, 1);
      if (p.active) list[Math.min(at, list.length - 1)]!.active = true;
      members.delete(p.id);
    },
    profile_activate: async ({ id }): Promise<SwitchReport> => {
      await demoWait(260);
      const p = findProfile(Number(id));
      const list = profilesOf(p.game);
      const out = list.find((x) => x.active && x.id !== p.id);
      if (out) capture(out);
      for (const x of list) x.active = x.id === p.id;
      const rows = members.get(p.id) ?? new Map<string, boolean>();
      const ons: string[] = [], offs: string[] = [];
      for (const m of mods(p.game)) {
        const want = rows.get(m.id) ?? (m.installedAt > p.updatedAt && m.enabled);
        if (want !== m.enabled) (want ? ons : offs).push(m.id);
      }
      const a = setEnabled(p.game, offs, false, false);
      const b = setEnabled(p.game, ons, true, false);
      const running = demoDb.games.find((g) => g.id === p.game)?.running ?? false;
      return { profile: stamp(p), change: { changed: [...a.changed, ...b.changed], removed: [], notes: [...a.notes, ...b.notes] }, varsPending: running };
    },
    // pretend another app holds Ctrl+Alt+T, so the "taken" mark can be seen in the browser
    hotkeys_sync: () => {
      const all = [...demoDb.profiles.values()].flat().map((p) => p.hotkey);
      return all.includes("Ctrl+Alt+T") ? [{ combo: "Ctrl+Alt+T", reason: "Ctrl+Alt+T is used by another app, so it can't switch profiles. Pick another key" }] : [];
    },
    profile_capture: ({ id }) => {
      const p = findProfile(Number(id));
      capture(p);
      return stamp(p);
    },
    profile_snapshot: ({ id }): ProfileSnapshot => {
      const p = findProfile(Number(id));
      return { profile: stamp(p), mods: [...(members.get(p.id) ?? [])].map(([modId, enabled]) => ({ modId, enabled })), vars: [] };
    },
    profile_restore: ({ snapshot }) => {
      const snap = snapshot as ProfileSnapshot;
      const s = snap.profile;
      const list = profilesOf(s.game);
      const taken = [...demoDb.profiles.values()].flat().some((x) => x.id === s.id);
      const id = !taken && s.id > 0 ? s.id : nextProfile++;
      nextProfile = Math.max(nextProfile, id + 1);
      const p: Profile = { ...s, id, name: freeName(s.game, s.name), active: false, modCount: 0 };
      if (s.active) { for (const x of list) x.active = false; p.active = true; }
      members.set(id, new Map(snap.mods.map((m) => [m.modId, m.enabled])));
      list.push(p);
      list.sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);
      return stamp(p);
    },
    profile_set_mods: async ({ profileId, modIds, enabled }): Promise<SwitchReport> => {
      await demoWait(120);
      const p = findProfile(Number(profileId));
      const known = new Set(mods(p.game).map((m) => m.id));
      const asked = (modIds as string[] | undefined) ?? [];
      const ids = asked.filter((m) => known.has(m));
      if (!ids.length && asked.length) throw err("Those mods aren't in the library anymore. Rescan to refresh the list");
      let change: ModChange = { changed: [], removed: [], notes: [] };
      if (p.active) change = setEnabled(p.game, ids, !!enabled, !!enabled && oneSkinOn(p.game));
      else {
        const rows = members.get(p.id) ?? new Map<string, boolean>();
        for (const m of ids) rows.set(m, !!enabled);
        members.set(p.id, rows);
        p.updatedAt = demoNow();
      }
      return { profile: stamp(p), change, varsPending: false };
    },
    profile_members: ({ id }) => {
      const p = findProfile(Number(id));
      const rows = members.get(p.id);
      const ids = new Set(mods(p.game).map((m) => m.id));
      return rows ? [...rows].filter(([mid, on]) => on && ids.has(mid)).map(([mid]) => mid) : [];
    },
  });
}

// ── the archive: removed mods whose trash files are gone, kept with their settings (backend: library/removed.rs) ──

const archived: ArchiveEntry[] = [];
let nextArchive = 1;
function trashDays() {
  const d = Number(demoDb.settings.get("trash.days") ?? 0);
  return Number.isFinite(d) ? Math.min(Math.max(Math.round(d), 0), 3650) : 14;
}

function archiveFields(t: TrashEntry & { mod: ModEntry }) {
  const m = t.mod;
  return {
    game: t.game, modId: t.modId, name: t.name, character: m.character, source: m.source, preview: m.preview, nsfw: m.nsfw, tags: m.tags,
    favorite: m.favorite, sizeBytes: t.size, removedAt: t.removedAt, reason: t.reason, hasOptions: m.hasKeys,
  };
}

function toArchive(t: TrashEntry & { mod: ModEntry }): ArchiveEntry {
  const id = nextArchive++;
  return { ...archiveFields(t), key: `a${id}`, trashId: null, archiveId: id, filesUntil: null };
}

/** Files leave the trash; the details move to the archive unless the mod is in the library again. */
function purgeOne(at: number) {
  const [t] = trash.splice(at, 1);
  if (!t || t.reason === "replaced" || mods(t.game).some((m) => m.id === t.modId)) return;
  for (let i = archived.length - 1; i >= 0; i--) if (archived[i]!.modId === t.modId) archived.splice(i, 1);
  archived.push(toArchive(t));
}

function purgeExpired(): number {
  const cutoff = demoNow() - trashDays() * 86400;
  let n = 0;
  for (let i = trash.length - 1; i >= 0; i--) if (trash[i]!.removedAt <= cutoff) { purgeOne(i); n++; }
  return n;
}

/** For a demo install: a removed copy of the same GameBanana mod comes back with its id and details, as the
 *  backend's install does. Returns the mod to add (the same object when nothing matches). */
export function demoRestoreRemoved(game: string, m: ModEntry): ModEntry {
  const gb = m.source?.modId;
  if (!gb) return m;
  const at = trash.findIndex((t) => t.game === game && t.reason !== "replaced" && t.mod.source?.modId === gb);
  const fromTrash = at >= 0 ? trash.splice(at, 1)[0] : undefined;
  const ai = fromTrash ? -1 : archived.findIndex((a) => a.game === game && a.source?.modId === gb);
  const old = fromTrash ? archiveFields(fromTrash) : ai >= 0 ? archived.splice(ai, 1)[0] : undefined;
  if (!old) return m;
  return { ...m, id: old.modId, name: old.name || m.name, character: old.character ?? m.character, tags: old.tags, favorite: old.favorite, nsfw: m.nsfw || old.nsfw };
}

// ── owned characters and other managers (owned.rs, managers.rs) ──

const ownedOf = (game: string) => {
  let s = demoDb.owned.get(game);
  if (!s) { s = new Set(); demoDb.owned.set(game, s); }
  return s;
};
const normName = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
/** A few of the alias table's names, enough for the demo. The app reads the full tables in gacha-core. */
const DEMO_AKA: Record<string, string[]> = {
  "Raiden Shogun": ["Ei", "Raiden", "Baal", "Shougun"], "Kamisato Ayaka": ["Ayaka"], "Kaedehara Kazuha": ["Kazuha"], "Yae Miko": ["Yae", "Miko"],
  "Aether": ["PlayerBoy"], "Lumine": ["PlayerGirl"], "Anby Demara": ["Anby", "Anbi"], "Hoshimi Miyabi": ["Miyabi"], "Ellen Joe": ["Ellen"],
  "Jane Doe": ["Jane"], "Nekomiya Mana": ["Nekomata"], "Rover Female": ["Female Rover"], "Rover Male": ["Male Rover"], "Jinhsi": ["Jinxi"],
};
const TRAVELER = /^traveler(anemo|geo|electro|dendro|hydro|pyro|cryo)?$/;

function demoNames(text: string): { format: string; game: string | null; names: string[] } {
  let v: unknown;
  try { v = JSON.parse(text.replace(/^\uFEFF/, "")); } catch {
    const names = text.split(/[\n\r,;\t|]/).map((s) => s.trim().replace(/^[-*\u2022]\s*/, "").replace(/^\d+[.)]\s*/, "")).filter(Boolean);
    return { format: "list of names", game: null, names };
  }
  const o = (v ?? {}) as { format?: string; characters?: Array<{ key?: string }> };
  const byFormat: Record<string, string> = { GOOD: "gi", SROD: "hsr", ZOD: "zzz" };
  const f = String(o.format ?? "").toUpperCase();
  if (f === "GACHAMOD") {
    const g = (o as { game?: unknown }).game;
    return { format: "gachamod list", game: typeof g === "string" ? g : null, names: ((o.characters ?? []) as unknown[]).filter((x): x is string => typeof x === "string") };
  }
  if (byFormat[f]) return { format: f, game: byFormat[f]!, names: (o.characters ?? []).map((c) => String(c.key ?? "")).filter(Boolean) };
  const names: string[] = [];
  const walk = (x: unknown, key: string, depth: number) => {
    if (depth > 10) return;
    if (Array.isArray(x)) x.forEach((y) => (typeof y === "string" ? names.push(y) : walk(y, key, depth + 1)));
    else if (x && typeof x === "object") for (const [k, y] of Object.entries(x)) walk(y, k.toLowerCase(), depth + 1);
    else if (typeof x === "string" && ["name", "key", "character", "charactername"].includes(key)) names.push(x);
  };
  walk(v, "", 0);
  return { format: "JSON file", game: null, names };
}

function demoResolve(game: string, names: string[]): { found: string[]; unknown: string[] } {
  const roster = (demoDb.characters.get(game) ?? []).map((c) => c.name);
  const index = new Map<string, string[]>();
  for (const n of roster) {
    index.set(normName(n), [n]);
    for (const a of DEMO_AKA[n] ?? []) index.set(normName(a), [n]);
  }
  if (game === "gi") index.set("traveler", roster.filter((n) => n === "Aether" || n === "Lumine"));
  const found = new Set<string>();
  const unknown = new Set<string>();
  for (const raw of names) {
    const k = normName(raw);
    const hit = index.get(TRAVELER.test(k) ? "traveler" : k)
      ?? [...index.entries()].filter(([key]) => key.length >= 5 && k.includes(key)).map(([, v]) => v).sort((a, b) => b[0]!.length - a[0]!.length)[0];
    if (hit?.length) hit.forEach((n) => found.add(n));
    else unknown.add(raw);
  }
  return { found: [...found], unknown: [...unknown] };
}

const foreignDone = new Set<string>();
const DEMO_FOREIGN: Record<string, ForeignInfo> = {
  gi: { managers: [{ manager: "JASM", mods: 4 }], fillable: 4 },
  zzz: { managers: [{ manager: "XX Mod Manager", mods: 3 }, { manager: "FlairX", mods: 1 }], fillable: 4 },
};

function registerOwnedDemo() {
  registerDemo({
    owned_list: ({ game }) => [...ownedOf(String(game))].sort((a, b) => a.localeCompare(b)),
    owned_set: ({ game, names, owned }) => {
      const s = ownedOf(String(game));
      return ((names as string[]) ?? []).filter((n) => (owned ? !s.has(n) && !!s.add(n) : s.delete(n)));
    },
    owned_import: async ({ game, text }) => {
      await demoWait(250);
      const parsed = demoNames(String(text ?? ""));
      const g = parsed.game ?? String(game);
      const { found, unknown } = demoResolve(g, parsed.names);
      if (!found.length) {
        throw err(unknown.length ? `None of those names matched a character, for example "${unknown[0]}"`
          : "Found no characters in that. Try an export from an optimizer (GOOD, SROD, ZOD), an Enka.Network profile or a list of names");
      }
      const s = ownedOf(g);
      const added = found.filter((n) => !s.has(n));
      added.forEach((n) => s.add(n));
      const out: OwnedImport = { game: g, format: parsed.format, added, already: found.length - added.length, unknown };
      return out;
    },
    owned_import_file: () => { throw err("The demo can't read files by path. Drop the file on the page instead"); },
    owned_export: ({ game }) => JSON.stringify({ format: "gachamod", version: 1, game, characters: [...ownedOf(String(game))].sort((a, b) => a.localeCompare(b)) }, null, 2),
    owned_export_file: () => { throw err("The demo saves the list as a download instead"); },
    // the demo has no Enka.Network: a few roster characters stand in for the showcase
    owned_fetch: async ({ game, uid }) => {
      await demoWait(700);
      const g = String(game);
      if (!/^\d{6,10}$/.test(String(uid ?? "").trim())) throw err("A UID is the 9 or 10 digit number on your in-game profile");
      const show = (demoDb.characters.get(g) ?? []).map((c) => c.name).slice(0, 6);
      const s = ownedOf(g);
      const added = show.filter((n) => !s.has(n));
      added.forEach((n) => s.add(n));
      const out: OwnedImport = { game: g, format: "Enka.Network profile", added, already: show.length - added.length, unknown: [] };
      return out;
    },
    foreign_detect: ({ game }) => (foreignDone.has(String(game)) ? { managers: [], fillable: 0 } : DEMO_FOREIGN[String(game)] ?? { managers: [], fillable: 0 }),
    foreign_import: async ({ game }) => {
      await demoWait(500);
      const g = String(game);
      const info = foreignDone.has(g) ? undefined : DEMO_FOREIGN[g];
      foreignDone.add(g);
      const out: ForeignImport = { changed: info?.fillable ?? 0, managers: info?.managers.map((m) => m.manager) ?? [], undo: info ? [{ rel: g, sidecar: null }] : [], notes: [] };
      return out;
    },
    foreign_undo: ({ game }) => { foreignDone.delete(String(game)); },
  });
}
