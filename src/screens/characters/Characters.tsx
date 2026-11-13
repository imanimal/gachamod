// Characters: the game's roster with GameBanana portraits, each tile showing the skin it wears now. Picking one
// opens its skins: one click wears a skin (the only one on), "Default outfit" turns them all off, "Find more" opens
// Browse for that character. Owner: LIBRARY area (docs/spec.md, "Characters").
import { useEffect, useMemo, useRef, useState } from "react";
import { characters as charactersApi, errorText, settings, type Character, type ModEntry } from "../../lib/api";
import { characterList } from "../../lib/gamebanana";
import { consumeRoute, go, useGame, useRoute } from "../../lib/store";
import { Avatar, Badge, Button, Empty, IconButton, PageHeader, SearchField, Skeleton } from "../../ui/kit";
import { Icon } from "../../ui/Icon";
import { toast } from "../../ui/toast";
import { changeStates, useMods } from "../library/data";
import { moveInGrid } from "../library/gridNav";
import { Preview, useNsfwMode } from "../library/Preview";
import "../library/library.css";
import "./characters.css";

interface Tile extends Character { wearing: ModEntry | null; skins: ModEntry[] }

export function Characters() {
  const game = useGame()!;
  const gid = game.id;
  const route = useRoute();
  const { mods, loaded } = useMods(gid);
  const nsfw = useNsfwMode();
  const [chars, setChars] = useState<Character[] | null>(null);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<string | null>(route.character ?? null);
  const [busy, setBusy] = useState(false);
  const rosterRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (route.character) { setPicked(route.character); consumeRoute(["character"]); } }, [route.character]);

  // the roster: from the library, filled from GameBanana's character categories the first time
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        let list = await charactersApi.list(gid);
        if (!live) return;
        setChars(list);
        if (game.gbCharacterCategory && (!list.length || !list.some((c) => c.icon))) {
          const refs = await characterList(gid);
          if (!live || !refs.length) return;
          await charactersApi.sync(gid, refs.map((r) => ({ name: r.name, gbCategoryId: r.id, icon: r.icon })));
          list = await charactersApi.list(gid);
          if (live) setChars(list);
        }
      } catch (e) { if (live) { setChars((c) => c ?? []); toast(errorText(e), true); } }
    })();
    return () => { live = false; };
  }, [gid, game.gbCharacterCategory]);

  const tiles: Tile[] = useMemo(() => {
    const by = new Map<string, ModEntry[]>();
    for (const m of mods) {
      if (!m.character) continue;
      const k = m.character.toLowerCase();
      by.set(k, [...(by.get(k) ?? []), m]);
    }
    const seen = new Set<string>();
    const out: Tile[] = [];
    for (const c of chars ?? []) {
      const k = c.name.toLowerCase();
      seen.add(k);
      const skins = by.get(k) ?? [];
      out.push({ ...c, skins, modCount: skins.length, enabledCount: skins.filter((m) => m.enabled).length, wearing: skins.find((m) => m.enabled) ?? null });
    }
    for (const [k, skins] of by) {
      if (seen.has(k)) continue;
      out.push({ name: skins[0]!.character!, gbCategoryId: null, icon: null, skins, modCount: skins.length, enabledCount: skins.filter((m) => m.enabled).length, wearing: skins.find((m) => m.enabled) ?? null });
    }
    // characters with mods first, then the rest in the roster's order
    return out.map((t, i) => [t, i] as const)
      .sort(([a, i], [b, j]) => Number(b.modCount > 0) - Number(a.modCount > 0) || b.enabledCount - a.enabledCount || (a.modCount > 0 ? b.modCount - a.modCount : 0) || i - j)
      .map(([t]) => t);
  }, [chars, mods]);

  const q = search.trim().toLowerCase();
  const shown = q ? tiles.filter((t) => t.name.toLowerCase().includes(q)) : tiles;
  const current = picked ? tiles.find((t) => t.name.toLowerCase() === picked.toLowerCase()) ?? null : null;
  const withMods = tiles.filter((t) => t.modCount > 0).length;

  const wear = async (t: Tile, m: ModEntry) => {
    setBusy(true);
    try {
      const oneSkin = (await settings.get(`${gid}.oneSkin`)) !== "0";
      const others = oneSkin ? [] : t.skins.filter((s) => s.enabled && s.id !== m.id).map((s) => s.id);
      await changeStates(gid, `${t.name} is wearing ${m.name}`, m.enabled ? [] : [m.id], others, mods);
    } catch (e) { toast(errorText(e), true); }
    finally { setBusy(false); }
  };
  const defaultOutfit = async (t: Tile) => {
    setBusy(true);
    try { await changeStates(gid, `${t.name} is back in the default outfit`, [], t.skins.filter((s) => s.enabled).map((s) => s.id), mods); }
    catch (e) { toast(errorText(e), true); }
    finally { setBusy(false); }
  };

  return (
    <div className="page characters">
      <PageHeader title="Characters" icon="characters"
        sub={chars === null ? "Loading the roster" : `${withMods === 1 ? "1 character has" : `${withMods} characters have`} skins installed`}
        actions={<SearchField value={search} onChange={setSearch} placeholder="Find a character" />} />

      <div className={`chars-layout${current ? " has-panel" : ""}`}>
        {chars === null || (!loaded && !mods.length) ? (
          <div className="char-roster">{Array.from({ length: 12 }, (_, i) => <Skeleton key={i} className="char-tile-skel" />)}</div>
        ) : !shown.length ? (
          <Empty icon="characters" title={q ? "No character by that name" : "No characters yet"}>
            {q ? "Try part of the name, like \"ellen\"." : "Characters come from GameBanana's categories for this game, and from the mods you have."}
          </Empty>
        ) : (
          <div ref={rosterRef} className="char-roster" role="list" onKeyDown={(e) => moveInGrid(e, rosterRef.current, ".char-tile")}>
            {shown.map((t) => (
              <button key={t.name} type="button" role="listitem" className={`char-tile${current?.name === t.name ? " sel" : ""}${t.modCount ? "" : " is-empty"}`}
                aria-pressed={current?.name === t.name} title={t.wearing ? `${t.name}, wearing ${t.wearing.name}` : t.modCount ? `${t.name}, default outfit` : `${t.name}, no skins yet`}
                onClick={() => setPicked(current?.name === t.name ? null : t.name)}>
                {t.wearing && <Preview className="char-tile-bg" src={t.wearing.preview} blur={t.wearing.nsfw && nsfw !== "show"} />}
                <span className="char-tile-portrait">
                  {t.icon ? <img src={t.icon} alt="" loading="lazy" decoding="async" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
                    : <Avatar name={t.name} size={64} />}
                </span>
                <span className="char-tile-name">{t.name}</span>
                {t.modCount > 0 && <span className="char-tile-count badge">{t.enabledCount ? <Icon name="check" /> : null}{t.modCount === 1 ? "1 skin" : `${t.modCount} skins`}</span>}
              </button>
            ))}
          </div>
        )}

        {current && (
          <aside className="panel char-panel" aria-label={`${current.name}'s skins`}>
            <header className="char-panel-h">
              <Avatar src={current.icon} name={current.name} size={56} ring />
              <div className="char-panel-t">
                <h2>{current.name}</h2>
                <span className="hint">{current.wearing ? `Wearing ${current.wearing.name}` : "Default outfit"}</span>
              </div>
              <IconButton icon="x" label="Close" onClick={() => setPicked(null)} />
            </header>
            {current.skins.length ? (
              <div className="char-skins" role="list">
                {current.skins.map((m) => (
                  <button key={m.id} type="button" role="listitem" className={`char-skin${m.enabled ? " is-on" : ""}`} disabled={busy}
                    title={m.enabled ? `${m.name} is on` : `Wear ${m.name} (turns the other skins off)`} onClick={() => void wear(current, m)}>
                    <Preview className="char-skin-img" src={m.preview} blur={m.nsfw && nsfw !== "show"} icon="mods" />
                    <span className="char-skin-name">{m.name}</span>
                    {m.enabled ? <Badge tone="accent" icon="check">Wearing</Badge> : <span className="char-skin-act">Wear</span>}
                  </button>
                ))}
              </div>
            ) : (
              <p className="hint char-panel-none">No skins installed for {current.name} yet.</p>
            )}
            <div className="char-panel-a">
              <Button icon="undo" disabled={busy || !current.wearing} onClick={() => void defaultOutfit(current)}
                title="Turns off every skin for this character">Default outfit</Button>
              <Button variant="primary" icon="browse" onClick={() => go({ view: "browse", character: current.name })}>Find more</Button>
              {current.modCount > 0 && <Button variant="ghost" icon="mods" onClick={() => go({ view: "library", character: current.name })}>In Mods</Button>}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
