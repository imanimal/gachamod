// The pull button (Settings, Fun extras; off until turned on): opens one random mod for the current game, gacha style.
// 3 star: one of the newest mods. 4 star: one of the 200 most liked. 5 star: one of the 50 most liked. A 5 star comes
// one pull in sixteen, and every 10th pull without one is a 5 star. Mods for adults follow Settings (hidden ones stay
// out), and hidden mods and blocked creators never come up. A short flash in the star colour plays first (not with
// Animations off). Owner: BROWSE area.
import { useState } from "react";
import type { GameState } from "../../lib/api";
import { PULL_PITY, pullPref, pullsSince, pullWord } from "../../lib/fun";
import { listMods, type GbCard, type GbSort } from "../../lib/gamebanana";
import { hiddenModsPref, isBlocked, nsfwPref } from "../../lib/prefs";
import { IconButton } from "../../ui/kit";
import { toast } from "../../ui/toast";
import { openGbMod } from "./state";

type Stars = 3 | 4 | 5;
/** Where each rarity draws from: a sort and the pages of it. */
const POOL: Record<Stars, { sort: GbSort; pages: number }> = { 5: { sort: "likes", pages: 1 }, 4: { sort: "likes", pages: 4 }, 3: { sort: "newest", pages: 4 } };

function roll(): Stars {
  if (pullsSince.get() + 1 >= PULL_PITY) return 5;
  const r = Math.random();
  return r < 1 / 16 ? 5 : r < 0.3 ? 4 : 3;
}

async function draw(game: GameState, stars: Stars): Promise<GbCard | null> {
  const { sort, pages } = POOL[stars];
  const hidden = new Set(hiddenModsPref.get());
  const ok = (c: GbCard) => !hidden.has(c.id) && !isBlocked(c.submitter?.id) && !(c.nsfw && nsfwPref.get() === "hide");
  // 4 star skips the first page (that's 5 star's)
  const first = stars === 4 ? 2 : 1;
  const page = first + Math.floor(Math.random() * (pages - first + 1));
  const list = (await listMods({ gbGameId: game.gamebananaId, sort, page, perPage: 50 })).items.filter(ok);
  return list[Math.floor(Math.random() * list.length)] ?? null;
}

function flash(stars: Stars): Promise<void> {
  if (document.documentElement.dataset.motion === "reduced" || matchMedia("(prefers-reduced-motion: reduce)").matches) return Promise.resolve();
  const el = document.createElement("div");
  el.className = `pull-flash pull-${stars}`;
  el.setAttribute("aria-hidden", "true");
  const row = document.createElement("div");
  row.className = "pull-stars";
  row.textContent = "★".repeat(stars);
  el.append(row);
  document.body.append(el);
  return new Promise((res) => {
    el.addEventListener("animationend", (e) => { if (e.target === el) { el.remove(); res(); } });
    setTimeout(() => { el.remove(); res(); }, 1600);
  });
}

export function PullButton({ game }: { game: GameState }) {
  const on = pullPref.use();
  const [busy, setBusy] = useState(false);
  if (!on) return null;
  const word = pullWord(game.id);
  const go = async () => {
    if (busy) return;
    setBusy(true);
    try {
      let stars = roll();
      let card = await draw(game, stars);
      // nothing left after the filters: try the next rarity down
      while (!card && stars > 3) { stars = (stars - 1) as Stars; card = await draw(game, stars); }
      if (!card) { toast(`Nothing to pull for ${game.short} right now. Try again in a moment`); return; }
      void pullsSince.set(stars === 5 ? 0 : pullsSince.get() + 1);
      await flash(stars);
      openGbMod(card.id);
    } catch (e) {
      toast(`The ${word} didn't go through: ${(e as { message?: string }).message ?? e}`, true);
    } finally { setBusy(false); }
  };
  const left = PULL_PITY - pullsSince.get();
  return (
    <IconButton icon="star" disabled={busy} onClick={() => void go()}
      label={busy ? `${word}: asking GameBanana for a mod` : `${word}: open a random ${game.short} mod. A 5 star is guaranteed in ${left === 1 ? "1 pull" : `${left} pulls`}`} />
  );
}
