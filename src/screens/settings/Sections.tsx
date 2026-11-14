// Settings sections: Mods, Automatic, Storage and Creators. Owner: SETTINGS/AI area.
import { useState } from "react";
import { errorText, library, type GameState } from "../../lib/api";
import { pref, setCreatorFlag, setNsfw, useCreators, useNsfw, type CreatorFlag, type CreatorFlags } from "../../lib/prefs";
import { useGames } from "../../lib/store";
import { Avatar, Confirm, IconButton, Panel, Segmented, Select, Toggle, plural } from "../../ui/kit";
import { CreatorLink } from "../../ui/Links";
import { GameBadge } from "../../ui/GameBadge";
import { toast } from "../../ui/toast";
import { appUpdateCheckPref, autoRescanPref, fixesAutoUpdatePref, keepArchivesPref, modUpdateCheckPref, trashDaysPref, useTrashDays } from "./automatic";
import { SetRow, useSetting } from "./parts";

/** "Keys only while the character is on screen" for new installs (the install flow reads it). Same key as
 *  lib/keybinds.ts uses. */
const onScreenOnInstallPref = pref<boolean>("keys.onScreenOnInstall", false, (r) => (r === "1" ? true : r === "0" ? false : undefined), (v) => (v ? "1" : "0"));

// ── mods ──

export function ModsSection() {
  const shown = useGames().filter((g) => g.shown);
  const nsfw = useNsfw();
  return (
    <Panel title="Mods" icon="mods" id="mods">
      <div className="set-rows">
        <SetRow id="set-nsfw" label="Mods for adults" hint="Previews marked NSFW on GameBanana or by you">
          <Segmented value={nsfw} onChange={setNsfw} label="Mods for adults"
            options={[{ value: "hide", label: "Hide" }, { value: "blur", label: "Blur" }, { value: "show", label: "Show" }]} />
        </SetRow>
      </div>
      {shown.length > 0 && (
        <div className="set-pergame" id="set-pergame">
          <div className="set-pergame-h"><span />
            <span title="Turning on a skin turns off the character's other skins, so two never load at once">One skin per character</span>
            <span title="Presses F10 for you when you switch back to the game after a change. F10 makes 3DMigoto load the mods again">Reload in game</span>
          </div>
          {shown.map((g) => <PerGame key={g.id} game={g} />)}
        </div>
      )}
    </Panel>
  );
}

function PerGame({ game }: { game: GameState }) {
  const [one, setOne] = useSetting(`${game.id}.oneSkin`, "1");
  const [auto, setAuto] = useSetting(`${game.id}.autoReload`, "1");
  return (
    <div className="set-pergame-r">
      <span className="row"><GameBadge game={game} size={24} />{game.name}</span>
      <Toggle size="sm" checked={one !== "0"} onChange={(v) => setOne(v ? "1" : "0")} />
      <Toggle size="sm" checked={auto !== "0"} onChange={(v) => setAuto(v ? "1" : "0")} />
    </div>
  );
}

// ── automatic ──

type BoolPref = typeof appUpdateCheckPref;

function Switch({ p, on, off }: { p: BoolPref; on: string; off: string }) {
  const v = p.use();
  return <Toggle checked={v} onChange={(nv) => void p.set(nv, nv ? on : off)} />;
}

export function AutomaticSection() {
  const keep = keepArchivesPref.use();
  return (
    <Panel title="Automatic" icon="refresh" id="automatic">
      <div className="set-rows">
        <SetRow id="set-app-updates" label="Check for gachamod updates" hint="Once a day at start. Nothing installs unless you press Install">
          <Switch p={appUpdateCheckPref} on="Checking for gachamod updates" off="Stopped checking for gachamod updates" />
        </SetRow>
        <SetRow id="set-mod-updates" label="Check mods for updates" hint="When you open Mods, and every 30 minutes">
          <Switch p={modUpdateCheckPref} on="Checking mods for updates" off="Stopped checking mods for updates" />
        </SetRow>
        <SetRow id="set-rescan" label="Rescan mods when Mods opens" hint="Finds mods you added to the folder by hand">
          <Switch p={autoRescanPref} on="Rescanning mods on its own" off="Stopped rescanning mods on its own" />
        </SetRow>
        <SetRow id="set-archives" label="Delete downloaded archives" hint="The .zip or .7z goes once the mod is installed">
          <Toggle checked={!keep} onChange={(v) => void keepArchivesPref.set(!v, v ? "Deleting archives after installs" : "Keeping archives after installs")} />
        </SetRow>
        <SetRow id="set-fix-updates" label="Look for new mod fixers" tip="When a game update breaks mods, people post fixer tools on GameBanana. Tools > Fixes checks for new ones (at most once an hour) and lists them. Nothing is downloaded"
          hint="For mods a game update broke">
          <Switch p={fixesAutoUpdatePref} on="Looking for new mod fixers" off="Stopped looking for new mod fixers" />
        </SetRow>
        <SetRow id="set-onscreen" label="Toggles only while on screen, for new mods"
          tip="A mod's toggles stop working when its character isn't on screen, so two mods can share a key">
          <Switch p={onScreenOnInstallPref} on="New mods get toggles only while on screen" off="New mods keep their toggles as they are" />
        </SetRow>
      </div>
    </Panel>
  );
}

// ── storage ──

const DAY_OPTIONS = [0, 1, 3, 7, 14, 30, 90, 365];

export function StorageSection() {
  const days = useTrashDays();
  const [ask, setAsk] = useState<{ days: number; count: number } | null>(null);
  const opts = (DAY_OPTIONS.includes(days) ? DAY_OPTIONS : [...DAY_OPTIONS, days].sort((a, b) => a - b))
    .map((d) => ({ value: String(d), label: d === 0 ? "Delete them right away" : d === 1 ? "1 day" : `${d} days` }));

  const save = (d: number) => void trashDaysPref.set(d, d ? `Removed mods keep their files ${d === 1 ? "1 day" : `${d} days`}` : "Removed mods' files go right away");
  const choose = async (d: number) => {
    if (d >= days) { save(d); return; }
    // fewer days deletes files that are past the new limit, which can't be undone: say how many first
    try {
      const now = Date.now() / 1000;
      const count = (await library.archive(null)).filter((e) => e.trashId !== null && e.removedAt + d * 86400 < now).length;
      if (count) setAsk({ days: d, count }); else save(d);
    } catch (e) { toast(errorText(e), true); }
  };

  return (
    <Panel title="Storage" icon="archive" id="storage">
      <div className="set-rows">
        <SetRow id="set-trash-days" label="Keep removed mods' files"
          hint="After that the files are deleted from your PC. A short record (name, settings, GameBanana link) stays in Mods, Trash so you can download the mod again">
          <Select value={String(days)} onChange={(v) => void choose(Number(v))} options={opts} />
        </SetRow>
      </div>
      {ask && (
        <Confirm title="Delete files now?" yes="Delete files" danger onClose={() => setAsk(null)} onYes={() => save(ask.days)}>
          {plural(ask.count, "removed mod")} {ask.count === 1 ? "is" : "are"} older than that, so {ask.count === 1 ? "its files go" : "their files go"} now and can't come back. A short record of each stays in Mods, Trash.
        </Confirm>
      )}
    </Panel>
  );
}

// ── creators ──

const LISTS: Array<{ flag: CreatorFlag; title: string; remove: string; tip: string }> = [
  { flag: "prio", title: "Prioritized", remove: "Stop prioritizing", tip: "Their mods come first in Browse and always count as high quality" },
  { flag: "fav", title: "Favourites", remove: "Remove from favourites", tip: "Listed first among your creators" },
  { flag: "sub", title: "Following", remove: "Stop following", tip: "Their new mods show on Home" },
  { flag: "blocked", title: "Blocked", remove: "Unblock", tip: "Their mods never show" },
];

export function CreatorsSection() {
  const all = useCreators();
  const list = Object.values(all);
  const any = LISTS.some((l) => list.some((c) => c[l.flag]));
  return (
    <Panel title="Creators" icon="user" id="creators">
      {!any && <p className="hint">Right-click a creator's name anywhere to follow, favourite, prioritize or block them.</p>}
      {LISTS.map((l) => {
        const people = list.filter((c) => c[l.flag]).sort((a, b) => a.name.localeCompare(b.name));
        if (!people.length) return null;
        return (
          <div key={l.flag} className="set-creators" id={`set-creators-${l.flag}`}>
            <h3 className="sub-h" title={l.tip}>{l.title} <span className="muted">{people.length}</span></h3>
            <div className="set-creator-list">
              {people.map((c) => <CreatorRow key={c.id} c={c} flag={l.flag} remove={l.remove} />)}
            </div>
          </div>
        );
      })}
    </Panel>
  );
}

function CreatorRow({ c, flag, remove }: { c: CreatorFlags; flag: CreatorFlag; remove: string }) {
  return (
    <div className="set-creator">
      <Avatar src={c.avatar} name={c.name} size={28} />
      <CreatorLink id={c.id} name={c.name} className="grow" />
      <IconButton size="sm" icon="x" label={`${remove}: ${c.name}`} onClick={() => setCreatorFlag(c, flag, false)} />
    </div>
  );
}
