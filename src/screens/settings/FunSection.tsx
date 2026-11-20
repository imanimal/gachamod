// Settings > Fun extras: chill mode, the pull button (in Surprise me's place), seasonal touches (ui/Seasonal.tsx), the year card and (while
// animal has it on) mod of the day. Everything here is off until turned on, except the mod of the day button.
// Owner: SETTINGS/AI area.
import { useEffect, useState } from "react";
import { errorText, library, type ModEntry } from "../../lib/api";
import { chillPref, PULL_PITY, pullPref, pullsSince, pullWord, seasonPref, type SeasonPick } from "../../lib/fun";
import { motdPref, useMotdOn } from "../../lib/motd";
import { clearPlayed, playedAll, playedIn, playtimePref, restorePlayed } from "../../lib/playtime";
import { go, useGame, useGames } from "../../lib/store";
import { Button, Dialog, Panel, Segmented, Select, Toggle, Waiting } from "../../ui/kit";
import { toast } from "../../ui/toast";
import { SetRow } from "./parts";
import { lang, t, tn } from "../../lib/i18n";
import { gameName, gameShort } from "../../lib/games";

const SEASONS: Array<{ value: SeasonPick; label: string }> = [
  { value: "off", label: t("Off") }, { value: "date", label: t("By the date") },
  { value: "winter", label: t("Winter") }, { value: "halloween", label: t("Halloween") },
  { value: "valentine", label: t("Valentine's Day") }, { value: "lunar", label: t("Lunar New Year") },
];

export function FunSection() {
  const chill = chillPref.use();
  const pull = pullPref.use();
  const pulls = pullsSince.use();
  const word = pullWord(useGame()?.id);
  const season = seasonPref.use();
  const motd = motdPref.use();
  const motdOn = useMotdOn();
  const [year, setYear] = useState(false);
  return (
    <Panel title={t("Fun extras")} icon="sparkle" id="fun">
      <div className="set-rows">
        <SetRow id="set-chill" label={t("Chill mode")} hint={t("Lower-case text in menus. Mod names stay as written")}>
          <Segmented<"off" | "on"> size="sm" label={t("Chill mode")} value={chill ? "on" : "off"}
            onChange={(v) => void chillPref.set(v === "on", v === "on" ? t("Turned on chill mode") : t("Turned off chill mode"))}
            options={[{ value: "off", label: t("Off"), title: t("I like my UI uptight.") }, { value: "on", label: t("On"), title: t("chillax text") }]} />
        </SetRow>
        <SetRow id="set-pull" label={t("{pull} button", { pull: word })}
          hint={pull && pulls
            ? t("Takes the place of Surprise me in Browse and on Home. It opens a random mod: 3 star for a recent one, 4 star for a well liked one, 5 star for one of the most liked. Every {pity}th pull without a 5 star is one ({pulls} so far)", { pity: PULL_PITY, pulls })
            : t("Takes the place of Surprise me in Browse and on Home. It opens a random mod: 3 star for a recent one, 4 star for a well liked one, 5 star for one of the most liked. Every {pity}th pull without a 5 star is one", { pity: PULL_PITY })}>
          <Toggle checked={pull} onChange={(v) => void pullPref.set(v, v ? t("Turned on the {pull} button", { pull: word }) : t("Turned off the {pull} button", { pull: word }))} />
        </SetRow>
        <SetRow id="set-seasonal" label={t("Seasonal touches")} hint={t("A small pattern along the bottom of the title bar and on the logo, drawn to match the theme. By the date: Halloween from 24 October, winter from 20 December to 2 January, Lunar New Year for two weeks, Valentine's Day on 14 February. The light along it stays still while Theme background motion is off")}>
          <span className="set-btns">
            <Button size="sm" variant="ghost" onClick={() => go({ view: "settings", section: "set-motion-bg" })} title={t("Opens Theme background motion in Appearance")}>{t("Background motion")}</Button>
            <Select<SeasonPick> value={season} onChange={(v) => {
              const label = SEASONS.find((s) => s.value === v)!.label;
              void seasonPref.set(v, t("Seasonal touches: {pick}", { pick: v === "off" || v === "date" ? label.toLowerCase() : label }));
            }} options={SEASONS} />
          </span>
        </SetRow>
        {motdOn && (
          <SetRow id="set-motd" label={t("Mod of the day")} hint={t("A mod picked by animal, behind the gift button at the top of Browse")}>
            <Toggle checked={motd} onChange={(v) => void motdPref.set(v, v ? t("Showing mod of the day") : t("Hiding mod of the day"))} />
          </SetRow>
        )}
        <SetRow id="set-year" label={t("Your {year} in mods", { year: String(new Date().getFullYear()) })} hint={t("What you installed, who you installed it for and how long you played")}>
          <Button size="sm" icon="calendar" onClick={() => setYear(true)}>{t("See your year")}</Button>
        </SetRow>
        <PlayTimeRow />
      </div>
      {year && <YearDialog onClose={() => setYear(false)} />}
    </Panel>
  );
}

/** Counting play time: the switch, what is kept so far and a reset (gacha-core playtime.rs does the counting). */
function PlayTimeRow() {
  const on = playtimePref.use();
  const games = useGames();
  const [kept, setKept] = useState<{ games: Record<string, number>; since: number } | null>(null);
  const reload = () => { playedAll().then(setKept).catch(() => {}); };
  useEffect(reload, []);
  const secs = kept ? Object.values(kept.games).reduce((a, b) => a + b, 0) : 0;
  const hours = (n: number) => Math.round(n / 360) / 10;
  const list = kept ? Object.entries(kept.games).sort((a, b) => b[1] - a[1]).map(([id, n]) => `${gameShort(games.find((g) => g.id === id)) || id} ${hours(n)} h`).join(", ") : "";
  const since = kept?.since ? new Date(kept.since).toLocaleDateString(lang, { month: "long", day: "numeric", year: "numeric" }) : "";
  const counted = !kept ? "" : !secs ? t("Nothing counted yet") : since ? t("Counted so far: {list}, since {date}", { list, date: since }) : t("Counted so far: {list}", { list });
  const reset = async () => {
    try {
      const before = await clearPlayed();
      reload();
      toast(t("Cleared the play time"), false, { label: t("Undo"), run: async () => { await restorePlayed(before); reload(); } });
    } catch (e) { toast(errorText(e), true); }
  };
  return (
    <SetRow id="set-playtime" label={t("Count play time")}
      hint={`${t("Adds up the hours each game is open, even while gachamod runs in the background. It stays on this PC and is never sent. Turning it off keeps what is already counted")}${counted ? `. ${counted}` : ""}`}>
      <span className="set-btns">
        <Button size="sm" variant="ghost" icon="trash" disabled={!secs} onClick={() => void reset()}
          title={secs ? t("Erases the {hours} h counted so far", { hours: hours(secs) }) : t("Nothing is counted yet")}>{t("Reset play time")}</Button>
        <Toggle checked={on} onChange={(v) => void playtimePref.set(v, v ? t("Turned on play time counting") : t("Turned off play time counting"))} />
      </span>
    </SetRow>
  );
}

interface Year {
  installed: number; total: number;
  topChar: { name: string; n: number; game: string } | null;
  topCreator: { name: string; n: number } | null;
  hours: number; topGame: { name: string; hours: number } | null; since: number;
}

function YearDialog({ onClose }: { onClose: () => void }) {
  const games = useGames().filter((g) => g.modsDir);
  const y = new Date().getFullYear();
  const [data, setData] = useState<Year | null>(null);
  const counting = playtimePref.use();
  useEffect(() => {
    let live = true;
    void (async () => {
      const lists = await Promise.all(games.map((g) => library.list(g.id).catch(() => [] as ModEntry[])));
      const from = new Date(y, 0, 1).getTime() / 1000;
      const all = lists.flat();
      const chars = new Map<string, { n: number; game: string }>(), creators = new Map<string, number>();
      for (const m of all) {
        if (m.character) { const k = `${m.game}\u0000${m.character}`; chars.set(k, { n: (chars.get(k)?.n ?? 0) + 1, game: m.game }); }
        const who = m.source?.submitter;
        if (who) creators.set(who, (creators.get(who) ?? 0) + 1);
      }
      const top = <T,>(m: Map<string, T>, n: (v: T) => number) => [...m].sort((a, b) => n(b[1]) - n(a[1]))[0];
      const c = top(chars, (v) => v.n), cr = top(creators, (v) => v);
      const play = await playedIn(y);
      const secs = Object.values(play.games).reduce((a, b) => a + b, 0);
      const g = top(new Map(Object.entries(play.games)), (v) => v);
      if (!live) return;
      setData({
        installed: all.filter((m) => m.installedAt >= from).length, total: all.length,
        topChar: c ? { name: c[0].split("\u0000")[1]!, n: c[1].n, game: gameShort(games.find((x) => x.id === c[1].game)) } : null,
        topCreator: cr ? { name: cr[0], n: cr[1] } : null,
        hours: Math.round(secs / 360) / 10, topGame: g ? { name: gameName(games.find((x) => x.id === g[0])) || g[0], hours: Math.round(g[1] / 360) / 10 } : null,
        since: play.since,
      });
    })();
    return () => { live = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sinceThisYear = data && data.since && new Date(data.since).getFullYear() === y ? new Date(data.since).toLocaleDateString(lang, { month: "long", day: "numeric" }) : null;
  return (
    <Dialog title={t("Your {year} in mods", { year: String(y) })} icon="calendar" onClose={onClose} size="sm" footer={<Button variant="primary" onClick={onClose}>{t("Close")}</Button>}>
      {!data ? <Waiting what={t("Counting your mods and play time")} /> : (
        <div className="year">
          <div className="year-stat"><b>{data.installed}</b><span>{tn(data.installed, "mod installed this year, {total} in all", "mods installed this year, {total} in all", { total: data.total })}</span></div>
          {data.topChar && <div className="year-stat"><b className="motd-name">{data.topChar.name}</b><span>{games.length > 1 ? t("has the most mods: {n} ({game})", { n: data.topChar.n, game: data.topChar.game }) : t("has the most mods: {n}", { n: data.topChar.n })}</span></div>}
          {data.topCreator && <div className="year-stat"><b className="motd-name">{data.topCreator.name}</b><span>{tn(data.topCreator.n, "made {n} of your mods", "made {n} of your mods")}</span></div>}
          <div className="year-stat">
            <b>{t("{hours} h", { hours: data.hours || 0 })}</b>
            <span>{!data.hours ? (counting ? t("played so far. gachamod counts it from when a game starts until it closes") : t("played so far. Play time counting is turned off"))
              : data.topGame && games.length > 1
                ? (sinceThisYear ? t("played, most of it in {game}. Counted since {date}", { game: data.topGame.name, date: sinceThisYear }) : t("played, most of it in {game}", { game: data.topGame.name }))
                : (sinceThisYear ? t("played. Counted since {date}", { date: sinceThisYear }) : t("played"))}</span>
          </div>
        </div>
      )}
    </Dialog>
  );
}
