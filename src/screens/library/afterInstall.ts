// Right after a new mod installs (not an update): with "Turn on new mods" (default), it turns on, and its character's
// other skin goes off unless "<game>.oneSkin" keeps both. One toast says what happened. The first time, the toast
// offers to keep new mods off instead; when a character now has two skins, it offers switching them while playing.
// Owner: LIBRARY area.
import { errorText, library, settings, type GameId } from "../../lib/api";
import { record } from "../../lib/history";
import { go, currentGame, setGame } from "../../lib/store";
import { toast, type ToastAction } from "../../ui/toast";
import { enableNewPref } from "../settings/automatic";
import { liveCharacterOf, liveReady, makeLive } from "../ingame/data";
import { publish, restoreStates } from "./data";
import { overlapping } from "./overlap";

const ASKED_KEY = "mods.enableNew.asked";
const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** `text` is the backend's "Installed X for Y". `modIds[0]` is the mod to turn on (the first of several variants). */
export async function afterInstall(text: string, game: GameId, modIds: string[]) {
  const open: ToastAction = { label: "Open", run: () => { if (currentGame()?.id !== game) setGame(game); go({ view: "library", modId: modIds[0] }); } };
  await enableNewPref.ready;
  if (!enableNewPref.get() || !modIds.length) { toast(`${text}. Turn it on in Mods`, false, open); return; }
  try {
    const all = await library.list(game);
    const mod = all.find((m) => m.id === modIds[0]);
    if (!mod || mod.enabled) { toast(text, false, open); return; }
    const others = liveCharacterOf(game, mod.id) ? [] : overlapping(mod, all);
    const keepBoth = others.length > 0 && (await settings.get(`${game}.oneSkin`).catch(() => null)) === "0";
    const change = await library.setEnabled(game, [mod.id], true, others.length ? !keepBoth : undefined);
    publish(game, change);
    const before = new Map(all.map((m) => [m.id, m.enabled]));
    const ids = change.changed.map((m) => m.id);
    const off = change.changed.filter((m) => !m.enabled);
    record({
      label: off.length ? `Turned on ${mod.name} and turned off ${off.length === 1 ? off[0]!.name : `${off.length} mods`}` : `Turned on ${mod.name}`,
      undo: () => restoreStates(game, before, ids),
      redo: async () => { publish(game, await library.setEnabled(game, [mod.id], true, others.length ? !keepBoth : undefined)); },
    }, true);

    // the first time: say it happens by itself, with the way out
    if ((await settings.get(ASKED_KEY).catch(() => null)) !== "1") {
      void settings.set(ASKED_KEY, "1").catch(() => {});
      toast(`${text} and turned it on. New mods turn on by themselves`, false, {
        label: "Keep new mods off",
        run: async () => {
          await enableNewPref.set(false);
          await restoreStates(game, before, ids);
          toast("New mods stay off until you turn them on", false, { label: "Open the setting", run: () => go({ view: "settings", section: "set-enable-new" }) });
        },
      });
      return;
    }

    // two skins for one character: switching them while playing is one click away
    const who = mod.character;
    const skins = who ? all.filter((m) => same(m.character, who) && !m.parent) : [];
    if (who && skins.length > 1 && !liveCharacterOf(game, mod.id) && liveReady(game)) {
      const lead = off.length ? `${text}. It's on, ${off.length === 1 ? off[0]!.name : `${off.length} other skins`} went off` : `${text}. It's on`;
      toast(`${lead}. Switch ${who}'s skins while you play?`, false, {
        label: "Switch in game",
        run: () => makeLive(game, skins.map((m) => m.id), who),
      });
      return;
    }
    toast(off.length ? `${text}. It's on, and ${off.length === 1 ? off[0]!.name : `${off.length} other skins`} went off` : `${text}. It's on`, false, open);
  } catch (e) {
    toast(`${text}, but it couldn't be turned on: ${errorText(e)}`, true, open);
  }
}
