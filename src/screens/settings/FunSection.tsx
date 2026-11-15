// Settings > Fun: chill mode, the pity counter, seasonal touches, the year card and (while animal has it on) mod of
// the day. Everything here is off until turned on, except the mod of the day button. Owner: SETTINGS/AI area.
import { useEffect, useState } from "react";
import { library, type ModEntry } from "../../lib/api";
import { chillPref, pityPref, seasonalPref, usePityCount } from "../../lib/fun";
import { motdPref, useMotdOn } from "../../lib/motd";
import { playedIn } from "../../lib/playtime";
import { useGames } from "../../lib/store";
import { Button, Dialog, Panel, Segmented, Spinner, Toggle } from "../../ui/kit";
import { SetRow } from "./parts";

export function FunSection() {
  const chill = chillPref.use();
  const pity = pityPref.use();
  const pityN = usePityCount();
  const seasonal = seasonalPref.use();
  const motd = motdPref.use();
  const motdOn = useMotdOn();
  const [year, setYear] = useState(false);
  return (
    <Panel title="Fun" icon="sparkle" id="fun">
      <div className="set-rows">
        <SetRow id="set-chill" label="Chill mode" hint="The app's own words in lower case. Mod names, descriptions and anything people wrote stay as written">
          <Segmented<"off" | "on"> size="sm" label="Chill mode" value={chill ? "on" : "off"}
            onChange={(v) => void chillPref.set(v === "on", v === "on" ? "Turned on chill mode" : "Turned off chill mode")}
            options={[{ value: "off", label: "Off", title: "I like my UI uptight." }, { value: "on", label: "On", title: "chillax text" }]} />
        </SetRow>
        <SetRow id="set-pity" label="Pity counter"
          hint={pity ? `${pityN === 1 ? "1 mod" : `${pityN} mods`} opened in Browse since your last install. At 90 you hit hard pity` : "Counts the mods you open in Browse without installing one"}>
          <Toggle checked={pity} onChange={(v) => void pityPref.set(v, v ? "Turned on the pity counter" : "Turned off the pity counter")} />
        </SetRow>
        <SetRow id="set-seasonal" label="Seasonal touches" hint="Snow in late December, hearts on Valentine's Day. Not while Animations is off">
          <Toggle checked={seasonal} onChange={(v) => void seasonalPref.set(v, v ? "Turned on seasonal touches" : "Turned off seasonal touches")} />
        </SetRow>
        {motdOn && (
          <SetRow id="set-motd" label="Mod of the day" hint="A mod picked by animal, behind the gift button at the top of Browse">
            <Toggle checked={motd} onChange={(v) => void motdPref.set(v, v ? "Showing mod of the day" : "Hiding mod of the day")} />
          </SetRow>
        )}
        <SetRow id="set-year" label={`Your ${new Date().getFullYear()} in mods`} hint="What you installed, who you installed it for and how long you played">
          <Button size="sm" icon="calendar" onClick={() => setYear(true)}>See your year</Button>
        </SetRow>
      </div>
      {year && <YearDialog onClose={() => setYear(false)} />}
    </Panel>
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
        topChar: c ? { name: c[0].split("\u0000")[1]!, n: c[1].n, game: games.find((x) => x.id === c[1].game)?.short ?? "" } : null,
        topCreator: cr ? { name: cr[0], n: cr[1] } : null,
        hours: Math.round(secs / 360) / 10, topGame: g ? { name: games.find((x) => x.id === g[0])?.name ?? g[0], hours: Math.round(g[1] / 360) / 10 } : null,
        since: play.since,
      });
    })();
    return () => { live = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sinceThisYear = data && data.since && new Date(data.since).getFullYear() === y ? new Date(data.since).toLocaleDateString(undefined, { month: "long", day: "numeric" }) : null;
  return (
    <Dialog title={`Your ${y} in mods`} icon="calendar" onClose={onClose} size="sm" footer={<Button variant="primary" onClick={onClose}>Close</Button>}>
      {!data ? <Spinner /> : (
        <div className="year">
          <div className="year-stat"><b>{data.installed}</b><span>{data.installed === 1 ? "mod" : "mods"} installed this year, {data.total} in all</span></div>
          {data.topChar && <div className="year-stat"><b className="motd-name">{data.topChar.name}</b><span>has the most mods: {data.topChar.n}{games.length > 1 ? ` (${data.topChar.game})` : ""}</span></div>}
          {data.topCreator && <div className="year-stat"><b className="motd-name">{data.topCreator.name}</b><span>made {data.topCreator.n === 1 ? "1 of your mods" : `${data.topCreator.n} of your mods`}</span></div>}
          <div className="year-stat">
            <b>{data.hours ? `${data.hours} h` : "0 h"}</b>
            <span>{data.hours
              ? `played${data.topGame && games.length > 1 ? `, most of it in ${data.topGame.name}` : ""}${sinceThisYear ? `. Counted since ${sinceThisYear}` : ""}`
              : "played so far. gachamod counts it from when a game starts until it closes"}</span>
          </div>
        </div>
      )}
    </Dialog>
  );
}
