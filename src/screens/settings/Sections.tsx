// The panels of Settings, Mods and downloads (turning mods on, mods for adults, downloads and installing, automatic
// updates and scans, mods a game update broke, the trash) and Creators. Owner: SETTINGS/AI area.
import { useState } from "react";
import { errorText, library, type GameState } from "../../lib/api";
import { pref, setCreatorFlag, setNsfw, useCreators, useNsfw, type CreatorFlag, type CreatorFlags } from "../../lib/prefs";
import { useGame, useGames } from "../../lib/store";
import { Avatar, Button, Confirm, IconButton, Panel, Segmented, Select, Toggle, plural } from "../../ui/kit";
import { CreatorLink } from "../../ui/Links";
import { GameBadge } from "../../ui/GameBadge";
import { toast } from "../../ui/toast";
import { appUpdateCheckPref, autoRescanPref, enableNewPref, fixesAutoUpdatePref, installAllPartsPref, keepArchivesPref, modUpdateCheckPref, otherServersPref, trashDaysPref, useTrashDays } from "./automatic";
import { SetRow, useSetting } from "./parts";
import { fixWarningsPref } from "../../lib/fixes";
import { shuffleOutfits, shuffleWhenPref, type ShuffleWhen } from "../library/shuffle";

/** "Keys only while the character is on screen" for new installs (the install flow reads it). Same key as
 *  lib/keybinds.ts uses. */
const onScreenOnInstallPref = pref<boolean>("keys.onScreenOnInstall", false, (r) => (r === "1" ? true : r === "0" ? false : undefined), (v) => (v ? "1" : "0"));

// ── mods ──

const SHUFFLE_OPTIONS: Array<{ value: ShuffleWhen; label: string; title: string }> = [
  { value: "off", label: "Off", title: "Outfits change only when you change them" },
  { value: "play", label: "Each Play", title: "New outfits every time you press Play" },
  { value: "day", label: "Once a day", title: "New outfits at the first Play of the day" },
];

function ShuffleRow() {
  const when = shuffleWhenPref.use();
  const game = useGame();
  const [busy, setBusy] = useState(false);
  const now = async () => {
    if (!game) return;
    setBusy(true);
    try { await shuffleOutfits(game.id); } catch (e) { toast(errorText(e), true); } finally { setBusy(false); }
  };
  return (
    <SetRow id="set-shuffle" label="Shuffle outfits" hint="For every character with two or more mods, one goes on at random and the others off. Undo puts them back">
      <span className="set-shuffle">
        <Segmented<ShuffleWhen> value={when} onChange={(v) => void shuffleWhenPref.set(v, v === "off" ? "Stopped shuffling outfits" : v === "play" ? "Shuffling outfits at each Play" : "Shuffling outfits once a day")}
          label="When to shuffle" options={SHUFFLE_OPTIONS} size="sm" />
        <Button size="sm" icon="dice" busy={busy} disabled={!game} onClick={() => void now()} title={game ? `Shuffle ${game.short}'s outfits now` : "Set up a game first"}>Shuffle now</Button>
      </span>
    </SetRow>
  );
}

/** Also on the Downloads page, where installs happen. */
export function EnableNewSwitch({ size, label }: { size?: "sm"; label?: string }) {
  const on = enableNewPref.use();
  return <Toggle size={size} label={label} checked={on} onChange={(v) => void enableNewPref.set(v, v ? "New mods turn on when they install" : "New mods stay off until you turn them on")} />;
}

export function ModsSection() {
  const shown = useGames().filter((g) => g.shown);
  return (
    <Panel title="Turning mods on and reloading the game" icon="mods" id="mods">
      <div className="set-rows">
        <SetRow id="set-enable-new" label="Turn on new mods" hint="A mod you install turns on right away, and its character's other skin turns off"
          tip="Off, new mods wait in Mods, turned off, until you turn them on. Updates keep the mod on or off as it was">
          <EnableNewSwitch />
        </SetRow>
        <ShuffleRow />
      </div>
      {shown.length > 0 && (
        <div className="set-pergame" id="set-pergame">
          <div className="set-pergame-h"><span />
            <span title="What happens when you turn on a mod and its character already has another one on. Sub-mods never count">Another skin already on</span>
            <span title="Presses the game's reload key for you when you switch back to it after a change, so 3DMigoto loads the mods again. The key is F10 unless the game's d3dx.ini sets another">Reload in game</span>
          </div>
          {shown.map((g) => <PerGame key={g.id} game={g} />)}
        </div>
      )}
    </Panel>
  );
}

/** Hide, blur or show mods marked for adults, everywhere in the app. */
export function AdultSection() {
  const nsfw = useNsfw();
  return (
    <Panel title="Mods for adults" icon="eye" id="adult">
      <div className="set-rows">
        <SetRow id="set-nsfw" label="Mods marked for adults" hint="Marked NSFW on GameBanana or by you. Hide leaves them out, Blur blurs their pictures until opened">
          <Segmented value={nsfw} onChange={setNsfw} label="Mods for adults"
            options={[{ value: "hide", label: "Hide" }, { value: "blur", label: "Blur" }, { value: "show", label: "Show", title: "Pictures show unblurred. Warning: No panic button, sorry" }]} />
        </SetRow>
      </div>
    </Panel>
  );
}

const ONE_SKIN: Array<{ value: string; label: string; title: string }> = [
  { value: "ask", label: "Ask", title: "Ask each time: turn the other off, keep both on, or make the new one a sub-mod of it" },
  { value: "auto", label: "Turn off", title: "Turn the other one off without asking, so two never load at once" },
  { value: "0", label: "Keep", title: "Keep both on without asking" },
];

function PerGame({ game }: { game: GameState }) {
  // "1" is what older versions saved for the switch that was here: it asks now too
  const [one, setOne] = useSetting(`${game.id}.oneSkin`, "ask");
  const [auto, setAuto] = useSetting(`${game.id}.autoReload`, "1");
  return (
    <div className="set-pergame-r">
      <span className="row"><GameBadge game={game} size={24} />{game.name}</span>
      <Segmented size="sm" label={`${game.name}: another skin already on`} value={one === "auto" || one === "0" ? one : "ask"} onChange={setOne} options={ONE_SKIN} />
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

/** What happens to a download and to the mod it installs. */
export function InstallingSection() {
  const keep = keepArchivesPref.use();
  return (
    <Panel title="Downloads and installing" icon="downloads" id="installing">
      <div className="set-rows">
        <SetRow id="set-archives" label="Delete downloaded archives" hint="The .zip or .7z goes once the mod is installed">
          <Toggle checked={!keep} onChange={(v) => void keepArchivesPref.set(!v, v ? "Deleting archives after installs" : "Keeping archives after installs")} />
        </SetRow>
        <SetRow id="set-all-parts" label="Install every mod in an archive" hint="Skips the window that asks which ones to install"
          tip="Some downloads hold several mods, like a skin and its icons. They install as one mod, and its details let you turn each part on or off">
          <Switch p={installAllPartsPref} on="Archives with several mods install all of them" off="Asking which mods to install from an archive" />
        </SetRow>
        <SetRow id="set-other-servers" label="Move slow downloads to another server" hint="When a GameBanana download stays under 1 MB/s"
          tip="GameBanana sends each file to one of its file servers, and sometimes that server is slow while the others are fast. The download carries on from where it was on another one">
          <Switch p={otherServersPref} on="Slow downloads move to another server" off="Downloads stay on the server GameBanana picks" />
        </SetRow>
        <SetRow id="set-onscreen" label="Toggles only while on screen, for new mods"
          tip="A mod's toggles stop working when its character isn't on screen, so two mods can share a key">
          <Switch p={onScreenOnInstallPref} on="New mods get toggles only while on screen" off="New mods keep their toggles as they are" />
        </SetRow>
      </div>
    </Panel>
  );
}

/** The checks gachamod runs by itself. Each has a switch. */
export function AutomaticSection() {
  return (
    <Panel title="Automatic updates and scans" icon="refresh" id="automatic">
      <div className="set-rows">
        <SetRow id="set-app-updates" label="Update gachamod automatically" hint="New versions download in the background and install when you close gachamod"
          tip="gachamod looks for a new version at start and every 6 hours. Off, it never looks by itself: use Check now in About and updates">
          <Switch p={appUpdateCheckPref} on="Updating gachamod automatically" off="Stopped updating gachamod automatically" />
        </SetRow>
        <SetRow id="set-mod-updates" label="Check mods for updates" hint="When you open Mods, and every 30 minutes">
          <Switch p={modUpdateCheckPref} on="Checking mods for updates" off="Stopped checking mods for updates" />
        </SetRow>
        <SetRow id="set-rescan" label="Rescan mods when Mods opens" hint="Finds mods you added to the folder by hand">
          <Switch p={autoRescanPref} on="Rescanning mods on its own" off="Stopped rescanning mods on its own" />
        </SetRow>
      </div>
    </Panel>
  );
}

/** Fixers and warnings for mods a game update broke. Tools > Fixes shows the same two. */
export function BrokenModsSection() {
  return (
    <Panel title="Mods a game update broke" icon="wand" id="broken-mods">
      <div className="set-rows">
        <SetRow id="set-fix-updates" label="Look for new mod fixers" tip="When a game update breaks mods, people post fixer tools on GameBanana. Tools > Fixes checks for new ones (at most once an hour) and lists them. Nothing is downloaded"
          hint="Fixer tools that people post on GameBanana after a game update">
          <Switch p={fixesAutoUpdatePref} on="Looking for new mod fixers" off="Stopped looking for new mod fixers" />
        </SetRow>
        <SetRow id="set-fix-warn" label="Warn about broken mods" hint="On mod cards, in a mod's details and in Tools > Fixes"
          tip="Same as Mute in Tools > Fixes. Off hides the warnings, and nothing changes in the mods">
          <Switch p={fixWarningsPref} on="Showing the broken mod warnings" off="Muted the broken mod warnings" />
        </SetRow>
      </div>
    </Panel>
  );
}

// ── storage ──

const DAY_OPTIONS = [1, 3, 7, 14, 30, 90, 365];

export function StorageSection() {
  const days = useTrashDays();
  const [ask, setAsk] = useState<{ days: number; count: number } | null>(null);
  const opts = (DAY_OPTIONS.includes(days) || days === 0 ? DAY_OPTIONS : [...DAY_OPTIONS, days].sort((a, b) => a - b))
    .map((d) => ({ value: String(d), label: d === 1 ? "1 day" : `${d} days` }));

  const save = (d: number) => void trashDaysPref.set(d, d ? `Removed mods keep their files ${d === 1 ? "1 day" : `${d} days`}` : "Removed mods' files are deleted right away");
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
    <Panel title="Trash and removed mods" icon="archive" id="storage">
      <div className="set-rows">
        <SetRow id="set-trash-days" label="Keep removed mods' files"
          hint={days
            ? "Removed mods stay on your PC for a while so Put back works without downloading. Mods, Trash keeps their GameBanana link either way"
            : "Off: removing a mod deletes its files. Mods, Trash keeps its GameBanana link and settings so you can download it again"}>
          <span className="set-inline">
            {days > 0 && <Select value={String(days)} onChange={(v) => void choose(Number(v))} options={opts} />}
            <Toggle checked={days > 0} onChange={(v) => void choose(v ? 14 : 0)} />
          </span>
        </SetRow>
      </div>
      {ask && (
        <Confirm title="Delete files now?" yes="Delete files" danger onClose={() => setAsk(null)} onYes={() => save(ask.days)}>
          {plural(ask.count, "removed mod")} {ask.count === 1 ? "is" : "are"} older than that, so {ask.count === 1 ? "its files go" : "their files go"} now. Each one's GameBanana link stays in Mods, Trash.
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
