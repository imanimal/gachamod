// The panels of Settings, Mods (turning mods on, mod update checks and rescans, mods a game update broke, the
// trash), Settings, Downloads, and the Creators and Mods for adults panels of Settings, GameBanana.
// Owner: SETTINGS/AI area.
import { useState } from "react";
import { errorText, library, type GameState } from "../../lib/api";
import { pref, setCreatorFlag, setNsfw, useCreators, useNsfw, type CreatorFlag, type CreatorFlags } from "../../lib/prefs";
import { go, useGame, useGames } from "../../lib/store";
import { Avatar, Button, Confirm, IconButton, Panel, Segmented, Select, Toggle } from "../../ui/kit";
import { nsfwTip } from "../browse/menus";
import { CreatorLink } from "../../ui/Links";
import { GameBadge } from "../../ui/GameBadge";
import { toast } from "../../ui/toast";
import { autoRescanPref, watchModsPref, enableNewPref, fixesAutoUpdatePref, installAllPartsPref, keepArchivesPref, modUpdateCheckPref, otherServersPref, reviewUnsurePref, trashDaysPref, useTrashDays } from "./automatic";
import { SetRow, useSetting } from "./parts";
import { MatchGbAdultRow } from "./AccountSection";
import { autoMutePref, fixWarningsPref } from "../../lib/fixes";
import { shuffleOutfits, shuffleWhenPref, type ShuffleWhen } from "../library/shuffle";
import { t, tn } from "../../lib/i18n";
import { gameName, gameShort } from "../../lib/games";

/** "Keys only while the character is on screen" for new installs (the install flow reads it). Same key as
 *  lib/keybinds.ts uses. */
const onScreenOnInstallPref = pref<boolean>("keys.onScreenOnInstall", false, (r) => (r === "1" ? true : r === "0" ? false : undefined), (v) => (v ? "1" : "0"));

// ── mods ──

const SHUFFLE_OPTIONS: Array<{ value: ShuffleWhen; label: string; title: string }> = [
  { value: "off", label: t("Off"), title: t("Outfits change only when you change them") },
  { value: "play", label: t("Each Play"), title: t("New outfits every time you press Play") },
  { value: "day", label: t("Once a day"), title: t("New outfits at the first Play of the day") },
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
    <SetRow id="set-shuffle" label={t("Shuffle outfits")} hint={t("For every character with two or more mods, one goes on at random and the others off. Undo puts them back")}>
      <span className="set-shuffle">
        <Segmented<ShuffleWhen> value={when} onChange={(v) => void shuffleWhenPref.set(v, v === "off" ? t("Stopped shuffling outfits") : v === "play" ? t("Shuffling outfits at each Play") : t("Shuffling outfits once a day"))}
          label={t("When to shuffle")} options={SHUFFLE_OPTIONS} size="sm" />
        <Button size="sm" icon="dice" busy={busy} disabled={!game} onClick={() => void now()} title={game ? t("Shuffle {game}'s outfits now", { game: gameShort(game) }) : t("Set up a game first")}>{t("Shuffle now")}</Button>
      </span>
    </SetRow>
  );
}

/** Also on the Downloads page, where installs happen. */
export function EnableNewSwitch({ size, label }: { size?: "sm"; label?: string }) {
  const on = enableNewPref.use();
  return <Toggle size={size} label={label} checked={on} onChange={(v) => void enableNewPref.set(v, v ? t("New mods turn on when they install") : t("New mods stay off until you turn them on"))} />;
}

export function ModsSection() {
  const shown = useGames().filter((g) => g.shown);
  return (
    <Panel title={t("Turning mods on and reloading the game")} icon="mods" id="mods">
      <div className="set-rows">
        <SetRow id="set-enable-new" label={t("Turn on new mods")} hint={t("A mod you install turns on right away, and its character's other skin turns off unless that game is set to Keep")}
          tip={t("Off, new mods wait in Mods, turned off, until you turn them on. Updates keep the mod on or off as it was")}>
          <EnableNewSwitch />
        </SetRow>
        <ShuffleRow />
      </div>
      {shown.length > 0 && (
        <div className="set-pergame" id="set-pergame">
          <div className="set-pergame-h"><span />
            <span title={t("What happens when you turn on a mod and its character already has another one on. Sub-mods never count. A mod that just installed only follows Keep: otherwise the other skin goes off, and Ctrl+Z puts it back")}>{t("Another skin already on")}</span>
            <span title={t("Presses the game's reload key for you when you switch back to it after a change, so 3DMigoto loads the mods again. The key is F10 unless the game's d3dx.ini sets another")}>{t("Reload in game")}</span>
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
    <Panel title={t("Mods for adults")} icon="eye" id="adult">
      <div className="set-rows">
        <SetRow id="set-nsfw" label={t("Mods marked for adults")} hint={t("Marked NSFW on GameBanana or by you. Hide leaves them out, Blur blurs their pictures until opened")}>
          <Segmented value={nsfw} onChange={setNsfw} label={t("Mods for adults")}
            options={[{ value: "hide", label: t("Hide"), title: nsfwTip("hide") }, { value: "blur", label: t("Blur"), title: nsfwTip("blur") }, { value: "show", label: t("Show"), title: nsfwTip("show") }]} />
        </SetRow>
        <MatchGbAdultRow id="set-gb-adult" />
      </div>
    </Panel>
  );
}

const ONE_SKIN: Array<{ value: string; label: string; title: string }> = [
  { value: "ask", label: t("Ask"), title: t("When you turn a mod on, ask: turn the other off, keep both on, or make the new one a sub-mod of it. A mod that just installed turns the other off without asking, and Ctrl+Z puts it back") },
  { value: "auto", label: t("Turn off"), title: t("Turn the other one off without asking, so two never load at once") },
  { value: "0", label: t("Keep"), title: t("Keep both on without asking") },
];

function PerGame({ game }: { game: GameState }) {
  // "1" is what older versions saved for the switch that was here: it asks now too
  const [one, setOne] = useSetting(`${game.id}.oneSkin`, "ask");
  const [auto, setAuto] = useSetting(`${game.id}.autoReload`, "1");
  return (
    <div className="set-pergame-r">
      <span className="row"><GameBadge game={game} size={24} />{gameName(game)}</span>
      <Segmented size="sm" label={t("{game}: another skin already on", { game: gameName(game) })} value={one === "auto" || one === "0" ? one : "ask"} onChange={setOne} options={ONE_SKIN} />
      <Toggle size="sm" ariaLabel={t("{game}: reload in game", { game: gameName(game) })} checked={auto !== "0"} onChange={(v) => setAuto(v ? "1" : "0")} />
    </div>
  );
}

// ── automatic ──

type BoolPref = typeof modUpdateCheckPref;

function Switch({ p, on, off }: { p: BoolPref; on: string; off: string }) {
  const v = p.use();
  return <Toggle checked={v} onChange={(nv) => void p.set(nv, nv ? on : off)} />;
}

/** What happens to a download and to the mod it installs. */
export function InstallingSection() {
  const keep = keepArchivesPref.use();
  return (
    <Panel title={t("Downloads and installing")} icon="downloads" id="installing">
      <div className="set-rows">
        <SetRow id="set-archives" label={t("Delete downloaded archives")} hint={t("The .zip or .7z goes once the mod is installed")}>
          <Toggle checked={!keep} onChange={(v) => void keepArchivesPref.set(!v, v ? t("Deleting archives after installs") : t("Keeping archives after installs"))} />
        </SetRow>
        <SetRow id="set-all-parts" label={t("Install every mod in an archive")} hint={t("Skips the window that asks which ones to install")}
          tip={t("Some downloads hold several mods, like a skin and its icons. They install as one mod, and its details let you turn each part on or off")}>
          <Switch p={installAllPartsPref} on={t("Archives with several mods install all of them")} off={t("Asking which mods to install from an archive")} />
        </SetRow>
        <SetRow id="set-other-servers" label={t("Move slow downloads to another server")} hint={t("When a GameBanana download stays under 1 MB/s")}
          tip={t("GameBanana sends each file to one of its file servers, and sometimes that server is slow while the others are fast. The download carries on from where it was on another one")}>
          <Switch p={otherServersPref} on={t("Slow downloads move to another server")} off={t("Downloads stay on the server GameBanana picks")} />
        </SetRow>
        <SetRow id="set-review-unsure" label={t("Ask me to check files gachamod can't place")} hint={t("Files with no .ini that nothing says where to put")}
          tip={t("They go in Mods as they came, and the download's row says so. This adds a message with a button that shows the files")}>
          <Switch p={reviewUnsurePref} on={t("Asking you to check files gachamod can't place")} off={t("Stopped asking about files gachamod can't place")} />
        </SetRow>
        <SetRow id="set-onscreen" label={t("Toggles only while on screen, for new mods")}
          tip={t("A mod's toggles stop working when its character isn't on screen, so two mods can share a key")}>
          <Switch p={onScreenOnInstallPref} on={t("New mods get toggles only while on screen")} off={t("New mods keep their toggles as they are")} />
        </SetRow>
      </div>
    </Panel>
  );
}

/** The checks gachamod runs on mods by itself. Each has a switch. gachamod's own updates are on About and updates. */
export function AutomaticSection() {
  return (
    <Panel title={t("Mod update checks and rescans")} icon="refresh" id="automatic">
      <div className="set-rows">
        <SetRow id="set-mod-updates" label={t("Check mods for updates")} hint={t("When you open Mods, and every 30 minutes")}>
          <Switch p={modUpdateCheckPref} on={t("Checking mods for updates")} off={t("Stopped checking mods for updates")} />
        </SetRow>
        <SetRow id="set-watch-mods" label={t("Watch Mods folders for changes")} hint={t("Mods you add, rename or delete in Explorer show up at once")}
          tip={t("gachamod rescans a game's Mods folder a moment after something changes there, including changes made by other mod managers")}>
          <Switch p={watchModsPref} on={t("Watching Mods folders for changes")} off={t("Stopped watching Mods folders")} />
        </SetRow>
        <SetRow id="set-rescan" label={t("Rescan mods when Mods opens")} hint={t("Finds mods you added to the folder by hand")}
          tip={t("While Mods folders are watched, this runs only the first time Mods opens after gachamod starts")}>
          <Switch p={autoRescanPref} on={t("Rescanning mods automatically")} off={t("Stopped rescanning mods automatically")} />
        </SetRow>
      </div>
    </Panel>
  );
}

/** Fixers and warnings for mods a game update broke. Tools > Fixes shows the same two. */
export function BrokenModsSection() {
  return (
    <Panel title={t("Mods a game update broke")} icon="wand" id="broken-mods">
      <div className="set-rows">
        <SetRow id="set-fix-updates" label={t("Look for new mod fixers")} tip={t("When a game update breaks mods, people post fixer tools on GameBanana. Tools > Fixes checks for new ones (at most once an hour) and lists them. Nothing is downloaded")}
          hint={t("Fixer tools that people post on GameBanana after a game update")}>
          <Switch p={fixesAutoUpdatePref} on={t("Looking for new mod fixers")} off={t("Stopped looking for new mod fixers")} />
        </SetRow>
        <SetRow id="set-fix-warn" label={t("Warn about broken mods")} hint={t("On mod cards, in a mod's details and in Tools > Fixes")}
          tip={t("Same as Mute in Tools > Fixes. Off hides the warnings, and nothing changes in the mods")}>
          <Switch p={fixWarningsPref} on={t("Showing the broken mod warnings")} off={t("Muted the broken mod warnings")} />
        </SetRow>
        <SetRow id="set-fix-automute" label={t("Turn off mods that need their author")} hint={t("Mods no fix here can repair go off and stop warning, without asking")}
          tip={t("Same as Always turn off and mute mods that need their author in Tools > Fixes. Undo turns them back on, and Muted in Tools > Fixes lists them")}>
          <Switch p={autoMutePref} on={t("Turning off mods that need their author")} off={t("Listing mods that need their author again")} />
        </SetRow>
        <SetRow label={t("Fixes in Tools")} hint={t("The fixers, the broken mods and the muted ones")}>
          <Button size="sm" icon="tools" onClick={() => go({ view: "tools", section: "fixes" })} title={t("Opens Tools > Fixes")}>{t("Open Fixes")}</Button>
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
    .map((d) => ({ value: String(d), label: tn(d, "{n} day", "{n} days") }));

  const save = (d: number) => void trashDaysPref.set(d, d ? tn(d, "Removed mods keep their files {n} day", "Removed mods keep their files {n} days") : t("Removed mods' files are deleted right away"));
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
    <Panel title={t("Trash and removed mods")} icon="archive" id="storage">
      <div className="set-rows">
        <SetRow id="set-trash-days" label={t("Keep removed mods' files")}
          hint={days
            ? t("Removed mods stay on your PC for a while so Put back works without downloading. Mods, Trash keeps their GameBanana link either way")
            : t("Off: removing a mod deletes its files. Mods, Trash keeps its GameBanana link and settings so you can download it again")}>
          <span className="set-inline">
            <Button size="sm" variant="ghost" icon="trash" onClick={() => go({ view: "library", tab: "archive" })} title={t("Opens Mods > Trash")}>{t("Open Trash")}</Button>
            {days > 0 && <Select value={String(days)} onChange={(v) => void choose(Number(v))} options={opts} />}
            <Toggle checked={days > 0} onChange={(v) => void choose(v ? 14 : 0)} />
          </span>
        </SetRow>
      </div>
      {ask && (
        <Confirm title={t("Delete files now?")} yes={t("Delete files")} danger onClose={() => setAsk(null)} onYes={() => save(ask.days)}>
          {tn(ask.count, "{n} removed mod is older than that, so its files go now. Each one's GameBanana link stays in Mods, Trash.", "{n} removed mods are older than that, so their files go now. Each one's GameBanana link stays in Mods, Trash.")}
        </Confirm>
      )}
    </Panel>
  );
}

// ── creators ──

const LISTS: Array<{ flag: CreatorFlag; title: string; remove: string; tip: string }> = [
  { flag: "prio", title: t("Prioritized"), remove: t("Stop prioritizing"), tip: t("Their mods come first in Browse and always count as high quality") },
  { flag: "fav", title: t("Favourites"), remove: t("Remove from favourites"), tip: t("Listed first among your creators") },
  { flag: "sub", title: t("Following"), remove: t("Stop following"), tip: t("Their new mods show on Home") },
  { flag: "blocked", title: t("Blocked"), remove: t("Unblock"), tip: t("Their mods never show") },
];

export function CreatorsSection() {
  const all = useCreators();
  const list = Object.values(all);
  const any = LISTS.some((l) => list.some((c) => c[l.flag]));
  return (
    <Panel title={t("Creators")} icon="user" id="creators">
      {!any && <p className="hint">{t("Right-click a creator's name anywhere to follow, favourite, prioritize or block them.")}</p>}
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
      <IconButton size="sm" icon="x" label={t("{action}: {creator}", { action: remove, creator: c.name })} onClick={() => setCreatorFlag(c, flag, false)} />
    </div>
  );
}
