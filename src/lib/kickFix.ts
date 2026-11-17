// Genshin Impact's "Illegal tool detected" kick: its anti-cheat flags the d3d11.dll XXMI loads mods with. gachamod
// links a community guide the player follows by hand, and warns before a start with mods until the player says they
// did it or GIMI's d3d11.dll isn't XXMI's own. It only reads the DLLs and never changes them (docs/spec.md,
// "Launching"). Shared by the Play button's warning and the Launch page, so both agree. Owner: SYSTEM area.
import { useEffect, useSyncExternalStore } from "react";
import { errorText, games, shell, type KickCheck } from "./api";
import { toast } from "../ui/toast";

export const GI_KICK_GUIDE = "https://gamebanana.com/tuts/19132";
/** The guide's first step: GIMI's last release, with 3dmigoto-GIMI-for-playing-mods.zip. Only opened in the browser. */
export const GIMI_DOWNLOAD = "https://github.com/SilentNightSound/GI-Model-Importer/releases/tag/v7.0";
export const openKickGuide = () => void shell.openUrl(GI_KICK_GUIDE).catch((e) => toast(errorText(e), true));

let check: KickCheck | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

/** Read Genshin Impact's check again. Null when it can't be read. */
export async function refreshKick(): Promise<KickCheck | null> {
  try { check = await games.kickCheck("gi"); } catch { check = null; }
  emit();
  return check;
}

/** The check as the Launch page shows it (null while it first loads). Read again each time the page opens and on
 *  coming back to the window (the player may have just pasted the DLL), since an XXMI update can put its own d3d11.dll
 *  back at any time. */
export function useKick(): KickCheck | null {
  useEffect(() => {
    void refreshKick();
    const back = () => void refreshKick();
    window.addEventListener("focus", back);
    return () => window.removeEventListener("focus", back);
  }, []);
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => check);
}

/** The player did the fix by hand (gachamod notes GIMI's d3d11.dll as it is now), or takes that back. */
export async function setKickFixDone(done: boolean) {
  try { await games.kickFixDone(done); } catch (e) { toast(errorText(e), true); }
  await refreshKick();
}
