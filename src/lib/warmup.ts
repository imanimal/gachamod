// The first time a game is opened in a session: refresh its character list from GameBanana (at most once a day) and
// scan its Mods folder, so every screen (Home included) shows real mods and mods get their characters from their
// folders before anything else asks. Runs quietly in the background. Owner: skeleton.
import { characters, library, settings, type GameState } from "./api";
import { characterList } from "./gamebanana";
import { emitApp } from "./store";

const done = new Set<string>();
const DAY = 86_400_000;

function lastSync(game: string): number {
  try { return Number(localStorage.getItem(`gm.charsync.${game}`)) || 0; } catch { return 0; }
}
function markSync(game: string) {
  try { localStorage.setItem(`gm.charsync.${game}`, String(Date.now())); } catch { /* storage off */ }
}

export async function warmUp(game: GameState): Promise<void> {
  if (!game.modsDir || done.has(game.id)) return;
  done.add(game.id);
  try {
    if (game.gbCharacterCategory && Date.now() - lastSync(game.id) > DAY) {
      const have = await characters.list(game.id).catch(() => []);
      const refs = await characterList(game.id);
      if (refs.length) {
        await characters.sync(game.id, refs.map((r) => ({ name: r.name, gbCategoryId: r.id, icon: r.icon })));
        markSync(game.id);
      } else if (have.some((c) => c.icon)) markSync(game.id);
    }
  } catch (e) {
    console.warn("character list:", e);
  }
  try {
    // Settings, Mod update checks and rescans, "Rescan mods when Mods opens" off: leave the folder alone
    if ((await settings.get("library.autoScan").catch(() => null)) === "0") return;
    await library.scan(game.id);
    emitApp({ type: "library-refresh", game: game.id });
  } catch (e) {
    console.warn("first scan:", e);
    done.delete(game.id);
  }
}
