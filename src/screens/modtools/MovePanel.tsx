// "Mods from other managers", in Tools > Share and import and at the top of Settings > Mods: every other mod manager
// found for the current game, each with one button that brings its mods, on/off state, presets and details into
// gachamod. Both copies call the same backend, so they always agree. Owner: MODTOOLS area.
// IMM and No Reload Mod Manager rewrite or hide mods, so taking over moves them (after a question). The rest keep
// mods gachamod can already see, or a folder outside Mods: those are copied in by default (one click, Undo in the
// toast and in the Undo history, Ctrl+Z), and moving instead is an option.
import { useEffect, useRef, useState } from "react";
import { dialogs, errorKind, errorText, imm, migrate, nrmm, shell, type ImmInfo, type MigrateMode, type NrmmInfo, type OtherManager } from "../../lib/api";
import { emitApp, useGame } from "../../lib/store";
import { record, undo as undoOp } from "../../lib/history";
import { gameShort } from "../../lib/games";
import { notesText } from "../../lib/notes";
import { t, tn } from "../../lib/i18n";
import { Button, Confirm, Panel, formatBytes } from "../../ui/kit";
import { toast } from "../../ui/toast";

type Ask = { title: string; body: string; yes: string; run: () => Promise<void> };

const quiet = (e: unknown) => errorKind(e) === "todo";

export function MovePanel() {
  const g = useGame();
  const game = g?.id ?? null;
  const [immInfo, setImm] = useState<ImmInfo | null>(null);
  const [nrmmInfo, setNrmm] = useState<NrmmInfo | null>(null);
  const [others, setOthers] = useState<OtherManager[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [tick, setTick] = useState(0);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  useEffect(() => {
    if (!game) return;
    let on = true;
    imm.detect().then((i) => { if (on) setImm(i); }).catch((e) => { if (on && !quiet(e)) toast(errorText(e), true); });
    nrmm.detect().then((i) => { if (on) setNrmm(i); }).catch((e) => { if (on && !quiet(e)) toast(errorText(e), true); });
    migrate.detect(game, picked).then((l) => { if (on) setOthers(l); }).catch((e) => { if (on && !quiet(e)) toast(errorText(e), true); });
    return () => { on = false; };
  }, [game, picked, tick]);

  if (!g || !game) return null;
  const again = () => { if (live.current) setTick((n) => n + 1); };
  /** `openMods`: the message also has a button that opens the game's Mods folder, where moved mods went. */
  const done = (notes: string[], fallback: string, undo?: () => Promise<void>, openMods = false) => {
    const bad = notes.filter((n) => /couldn't|can't/i.test(n));
    const good = notes.filter((n) => !bad.includes(n));
    const dir = g.modsDir;
    const open = openMods && dir ? { label: t("Open folder"), run: () => { void shell.openPath(dir).catch((e) => toast(errorText(e), true)); } } : undefined;
    toast(good.length ? notesText(good) : fallback, false, undo ? { label: t("Undo"), run: undo } : open, undo ? open : undefined);
    if (bad.length) toast(notesText(bad), true);
    emitApp({ type: "library-refresh", game });
    again();
  };
  const job = async (key: string, run: () => Promise<void>) => {
    setBusy(key);
    try { await run(); } catch (e) { toast(errorText(e), true); } finally { if (live.current) setBusy(null); }
  };

  const immGame = immInfo?.found ? immInfo.games.find((x) => x.game === game && x.mods > 0) : undefined;
  const nrmmGame = nrmmInfo?.found ? nrmmInfo.games.find((x) => x.game === game && x.mods > 0) : undefined;
  const list = (others ?? []).filter((m) => m.id !== "imm" && m.inside + m.outside + m.presets > 0);

  const bringIn = (m: OtherManager, mode: MigrateMode) => job(m.id, async () => {
    let r = await migrate.import(game, m.id, { mode, picked });
    const fallback = r.profiles.length
      ? tn(r.profiles.length, "Brought in the mods from {name} and made {n} profile from the presets", "Brought in the mods from {name} and made {n} profiles from the presets", { name: m.name })
      : t("Brought in the mods from {name}", { name: m.name });
    // recorded for Ctrl+Z and the title bar's list too, so Undo is still there after the message closes
    const entry = record({
      label: t("Brought in the mods from {name}", { name: m.name }),
      undo: async () => {
        const left = await migrate.undo(r.undo);
        if (left.length) toast(notesText(left));
        emitApp({ type: "library-refresh", game });
        again();
      },
      redo: async () => {
        r = await migrate.import(game, m.id, { mode, picked });
        emitApp({ type: "library-refresh", game });
        again();
      },
    }, true);
    done(r.notes, fallback, async () => { await undoOp(entry); });
  });

  const choose = (file: boolean) => job("pick", async () => {
    const p = file
      ? (await dialogs.pickFiles({ title: t("Choose the other manager's backup file"), extensions: ["json"] }))?.[0] ?? null
      : await dialogs.pickFolder(t("Choose the other manager's folder"));
    if (p) setPicked(p);
  });

  const summary = (m: OtherManager) => {
    const parts: string[] = [];
    if (m.inside) parts.push(tn(m.inside, "{n} mod in Mods", "{n} mods in Mods"));
    if (m.outside) parts.push(tn(m.outside, "{n} mod in a separate folder ({size})", "{n} mods in a separate folder ({size})", { size: formatBytes(m.outsideBytes) }));
    if (m.presets) parts.push(tn(m.presets, "{n} preset", "{n} presets"));
    return parts.join(", ");
  };

  const empty = !immGame && !nrmmGame && list.length === 0;

  return (
    <Panel id="others" title={t("Mods from other managers")} icon="swap" className="tp tp-imm">
      <p className="hint tp-intro">
        {t("Brings in each mod with the on or off state, option values, GameBanana link and picture. Presets become profiles. Nothing is deleted.")}
      </p>
      {others === null && immInfo === null
        ? <p className="hint">{t("Looking for other mod managers")}</p>
        : empty && <p className="hint">{t("No other mod manager has {game} mods on this PC.", { game: gameShort(g) })}</p>}
      <ul className="tp-list tp-imm-list">
        {immGame && (
          <li className="tp-imm-game row">
            <span className="tp-imm-name grow">
              <strong>{t("Integrated Mod Manager")}</strong>
              <span className="hint"> {immGame.withSource
                ? tn(immGame.mods, "{n} mod, {on} on, {linked} linked to GameBanana", "{n} mods, {on} on, {linked} linked to GameBanana", { on: immGame.enabled, linked: immGame.withSource })
                : tn(immGame.mods, "{n} mod, {on} on", "{n} mods, {on} on", { on: immGame.enabled })}</span>
            </span>
            <Button icon="swap" busy={busy === "imm"} onClick={() => setAsk({
              title: tn(immGame.mods, "Move {n} mod from IMM?", "Move {n} mods from IMM?"),
              body: t("The mods move out of IMM's folders into the Mods folder, so IMM won't list them any more. Nothing is deleted."),
              yes: t("Move them"),
              run: () => job("imm", async () => { const r = await imm.takeover(game); done(r.notes, t("Moved the mods from Integrated Mod Manager"), undefined, true); }),
            })} title={t("Move them into the normal Mods folder, keeping their options and GameBanana links")}>{t("Move mods")}</Button>
          </li>
        )}
        {nrmmGame && (
          <li className="tp-imm-game row">
            <span className="tp-imm-name grow">
              <strong>{t("No Reload Mod Manager")}</strong>
              <span className="hint"> {tn(nrmmGame.mods, "{n} mod in {groups} groups", "{n} mods in {groups} groups", { groups: nrmmGame.groups })}</span>
            </span>
            <Button icon="swap" busy={busy === "nrmm"} onClick={() => setAsk({
              title: tn(nrmmGame.mods, "Move {n} mod from No Reload Mod Manager?", "Move {n} mods from No Reload Mod Manager?"),
              body: t("Each mod gets a separate ini again and moves to Mods/Character/Mod name. The mod showing in each group stays on. NRMM's files go to gachamod's trash."),
              yes: t("Move them"),
              run: () => job("nrmm", async () => { const r = await nrmm.takeover(game); done(r.notes, t("Moved the mods from No Reload Mod Manager"), undefined, true); }),
            })} title={t("Close No Reload Mod Manager first. Key changes you made there carry over")}>{t("Move mods")}</Button>
          </li>
        )}
        {list.map((m) => (
          <li key={m.id} className="tp-imm-game row">
            <span className="tp-imm-name grow" title={m.place}>
              <strong>{m.name}</strong>
              <span className="hint"> {summary(m)}</span>
              {m.notes.length > 0 && <span className="hint tp-imm-note"> {notesText(m.notes)}</span>}
            </span>
            {m.running
              ? <Button icon="refresh" onClick={again} title={t("{name} is open. Close it, then check again", { name: m.name })}>{t("Check again")}</Button>
              : <>
                <Button icon="swap" busy={busy === m.id} onClick={() => void bringIn(m, "copy")}
                  title={m.outside ? t("Copies the mods into Mods, so {name} keeps working. Undo is in the message after and in the Undo history (Ctrl+Z)", { name: m.name }) : t("Reads the details and presets. Undo is in the message after and in the Undo history (Ctrl+Z)")}>{t("Bring in")}</Button>
                {m.outside > 0 && (
                  <Button variant="ghost" size="sm" disabled={busy === m.id} onClick={() => setAsk({
                    title: t("Move the mods out of {name}?", { name: m.name }),
                    body: t("{name}'s folder is left empty and the links in Mods are replaced by the mods themselves, which saves {size} of disk space. {name} won't list them any more.", { name: m.name, size: formatBytes(m.outsideBytes) }),
                    yes: t("Move them"),
                    run: () => bringIn(m, "move"),
                  })} title={t("Moves instead of copying, to save disk space")}>{t("Move instead")}</Button>
                )}
              </>}
          </li>
        ))}
      </ul>
      <div className="row tp-imm-pick">
        <span className="hint grow">{picked ? t("Also looking in {path}", { path: picked }) : t("Choose SkinSelectImpact's folder or a Fairy's Secret Folder backup.")}</span>
        <Button variant="ghost" size="sm" icon="folder" disabled={busy === "pick"} onClick={() => void choose(false)}
          title={t("SkinSelectImpact's folder, or any manager gachamod didn't find by itself")}>{t("Choose a folder")}</Button>
        <Button variant="ghost" size="sm" icon="file" disabled={busy === "pick"} onClick={() => void choose(true)}
          title={t("The file Fairy's Secret Folder writes in Settings, Backup")}>{t("Choose a backup file")}</Button>
      </div>
      {ask && (
        <Confirm title={ask.title} yes={ask.yes} onClose={() => setAsk(null)} onYes={() => { const a = ask; setAsk(null); void a.run(); }}>
          <p>{ask.body}</p>
        </Confirm>
      )}
    </Panel>
  );
}
