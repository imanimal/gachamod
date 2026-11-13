// Home: the current game's hero with Play, the active profile, a few numbers, recent installs and what's new on
// GameBanana. Owner: SYSTEM area (docs/spec.md).
import { useEffect, useState, type CSSProperties } from "react";
import { Badge, Button, Card, Empty, PageHeader, Panel, Skeleton, plural, timeAgo } from "../../ui/kit";
import { Icon } from "../../ui/Icon";
import { toast } from "../../ui/toast";
import { dialogs, errorText, fileUrl, library, profiles, settings, shell, type ModEntry, type Profile } from "../../lib/api";
import { held } from "../../lib/tauri";
import { emitApp, go, onApp, useGame } from "../../lib/store";
import { gameInfo, imageAt, listMods, type GbCard } from "../../lib/gamebanana";
import { PlayButton } from "./PlayButton";
import "./home.css";

type Nsfw = "hide" | "blur" | "show";

function Thumb({ src, nsfw, mode, className }: { src?: string; nsfw: boolean; mode: Nsfw; className: string }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  return (
    <span className={`${className}${nsfw && mode === "blur" ? " nsfw-blur" : ""}`}>
      {src && !broken ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} /> : <Icon name="image" className="thumb-ph" />}
    </span>
  );
}

export function Home() {
  const game = useGame();
  const gameId = game?.id;
  const [banner, setBanner] = useState<string | null>(null);
  const [bannerOk, setBannerOk] = useState(true);
  const [mods, setMods] = useState<ModEntry[] | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [fresh, setFresh] = useState<GbCard[]>([]);
  const [nsfw, setNsfw] = useState<Nsfw>("blur");
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    if (!game) return;
    let live = true;
    gameInfo(game.gamebananaId).then((g) => { if (live) setBanner(g?.banner ?? null); }).catch(() => {});
    listMods({ gbGameId: game.gamebananaId, page: 1, perPage: 24, sort: "newest" }).then((r) => { if (live) setFresh(r.items.slice(0, 24)); }).catch(() => {});
    profiles.list(game.id).then((l) => { if (live) setProfile(l.find((p) => p.active) ?? null); }).catch(() => {});
    settings.get("ui.nsfw").then((v) => { if (live && (v === "hide" || v === "show" || v === "blur")) setNsfw(v); }).catch(() => {});
    return () => { live = false; };
  }, [gameId]); // eslint-disable-line react-hooks/exhaustive-deps

  // the library list, again whenever it changes
  useEffect(() => {
    if (!gameId) return;
    let live = true;
    const load = () => library.list(gameId).then((l) => { if (live) setMods(l); }).catch(() => { if (live) setMods([]); });
    void load();
    const off = held(library.onChanged((p) => { if (p.game === gameId) void load(); }));
    const offApp = onApp((e) => { if (e.type === "library-refresh" && e.game === gameId) void load(); });
    return () => { live = false; off(); offApp(); };
  }, [gameId]);

  if (!game) return null;

  const on = mods?.filter((m) => m.enabled).length ?? game.enabledCount;
  const total = mods?.length ?? game.modCount;
  const updates = mods?.filter((m) => m.updateAvailable).length ?? 0;
  const conflicts = mods?.filter((m) => m.enabled && m.conflicts > 0).length ?? 0;
  const recent = [...(mods ?? [])].sort((a, b) => b.installedAt - a.installedAt).filter((m) => !(m.nsfw && nsfw === "hide")).slice(0, 12);
  const newOnGb = fresh.filter((c) => !(c.nsfw && nsfw === "hide"));
  const importerUpdate = !!(game.importerLatest && game.importerVersion && game.importerLatest !== game.importerVersion);
  const status = game.viaXxmi
    ? `${game.importer}${game.importerVersion ? ` ${game.importerVersion}` : ""} via XXMI`
    : game.importerDir ? `${game.importer} loader` : game.gameDir ? "No mod loader set" : "Not set up yet";

  const rescan = async () => {
    setScanning(true);
    try {
      const list = await library.scan(game.id);
      setMods(list);
      emitApp({ type: "library-refresh", game: game.id });
      toast(`Found ${plural(list.length, "mod")}`);
    } catch (e) { toast(errorText(e), true); }
    finally { setScanning(false); }
  };
  const importPack = async () => {
    try {
      const r = await dialogs.pickFiles({ title: "Import a .gachamod", extensions: ["gachamod"] });
      if (r?.[0]) emitApp({ type: "open-pack", path: r[0] });
    } catch (e) { toast(errorText(e), true); }
  };
  const openMods = () => { if (game.modsDir) shell.openPath(game.modsDir).catch((e) => toast(errorText(e), true)); };

  return (
    <div className="page home">
      <PageHeader title={game.name} icon="home" sub={status} actions={<>
        <Button icon="folder" onClick={openMods} disabled={!game.modsDir} title={game.modsDir ?? "No Mods folder yet"}>Open Mods folder</Button>
        <Button icon="refresh" busy={scanning} onClick={() => void rescan()} disabled={!game.modsDir} title="Look through the Mods folder again">Rescan</Button>
        <Button icon="import" onClick={() => void importPack()} title="Add mods from a .gachamod file">Import .gachamod</Button>
      </>} />

      <section className="home-hero" style={{ "--g-accent": game.accent } as CSSProperties}>
        {banner && bannerOk
          ? <img className="home-hero-img" src={banner} alt="" loading="lazy" decoding="async" onError={() => setBannerOk(false)} />
          : <span className="home-hero-name" aria-hidden="true">{game.name}</span>}
        <div className="home-hero-body">
          <div className="home-hero-text">
            <p className="home-hero-status">
              {status}
              {importerUpdate && <Badge tone="info" icon="update" title={`XXMI Launcher installs ${game.importer} ${game.importerLatest} when it next starts`}>{game.importerLatest} available</Badge>}
            </p>
          </div>
          <PlayButton big />
        </div>
      </section>

      <div className="home-row">
        <Card className="home-profile" onClick={() => go("profiles")} title="Profiles">
          <span className="home-profile-stripe" style={{ "--g-accent": profile?.color ?? game.accent } as CSSProperties} aria-hidden="true" />
          <span className="home-profile-icon">{profile?.icon && !profile.icon.startsWith("char:") ? profile.icon : <Icon name="profiles" />}</span>
          <span className="home-profile-text">
            <span className="hint">Active profile</span>
            <span className="home-profile-name">{profile?.name ?? "None yet"}</span>
            {profile && <span className="hint">{plural(profile.modCount, "mod")}</span>}
          </span>
        </Card>
        <Card className="home-stat" onClick={() => go("library")} title="Open your mods">
          <span className="home-stat-n">{on}<span className="home-stat-of">/{total}</span></span><span className="hint">mods on</span>
        </Card>
        <Card className={`home-stat${updates ? " has" : ""}`} onClick={() => go("library")} title="Mods with a newer version on GameBanana">
          <span className="home-stat-n">{updates}</span><span className="hint">{updates === 1 ? "update waiting" : "updates waiting"}</span>
        </Card>
        <Card className={`home-stat${conflicts ? " bad" : ""}`} onClick={() => go({ view: "tools", section: "conflicts" })} title="Enabled mods that change the same thing">
          <span className="home-stat-n">{conflicts}</span><span className="hint">{conflicts === 1 ? "mod with conflicts" : "mods with conflicts"}</span>
        </Card>
      </div>

      <Panel title="Recently installed" icon="clock" className="home-recent" actions={<Button size="sm" variant="ghost" iconRight="chevron" onClick={() => go("library")}>All mods</Button>}>
        {mods === null
          ? <div className="home-strip">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="home-tile-skel" />)}</div>
          : recent.length === 0
            ? <Empty icon="mods" title="No mods yet" actions={<Button variant="primary" icon="browse" onClick={() => go("browse")}>Browse GameBanana</Button>}>
                Install from Browse, or drop an archive anywhere on this window.
              </Empty>
            : <div className="home-strip">
                {recent.map((m) => (
                  <Card key={m.id} className={`home-tile${m.enabled ? "" : " off"}`} onClick={() => go({ view: "library", modId: m.id })} title={m.name}>
                    <Thumb className="home-tile-img" src={fileUrl(m.preview)} nsfw={m.nsfw} mode={nsfw} />
                    <span className="home-tile-name">{m.name}</span>
                    <span className="hint">{m.character ?? "No character"} · {timeAgo(m.installedAt)}</span>
                  </Card>
                ))}
              </div>}
      </Panel>

      {newOnGb.length > 0 && (
        <Panel title="New on GameBanana" icon="sparkle" className="home-new" actions={<Button size="sm" variant="ghost" iconRight="chevron" onClick={() => go("browse")}>Browse</Button>}>
          <div className="home-strip rows-2">
            {newOnGb.map((c) => (
              <Card key={c.id} className="home-tile" onClick={() => go({ view: "browse", modId: c.id })} title={c.name}>
                <Thumb className="home-tile-img" src={imageAt(c.image, 220)} nsfw={c.nsfw} mode={nsfw} />
                <span className="home-tile-name">{c.name}</span>
                <span className="hint">{c.character ?? c.category?.name ?? "Mod"}{c.submitter ? ` · ${c.submitter.name}` : ""}</span>
              </Card>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
